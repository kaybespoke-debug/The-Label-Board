-- Photos out of the database and into object storage.
--
-- WHY THIS EXISTS
--
-- Every photo a studio took was a base64 data URL inside an order record, and
-- orders ride the generic `app_state` path — so every photo was being written
-- into Postgres as JSON. That is the most expensive place it could possibly
-- go, on every axis at once:
--
--   * database storage is $0.125/GB/mo, file storage is $0.0213/GB/mo  (5.9x)
--   * base64 inflates the bytes by a third                             (1.33x)
--   * so the effective rate was $0.166/GB against $0.0213/GB           (7.8x)
--   * the Pro plan includes 8 GB of disk and 100 GB of file storage    (12.5x)
--   * database egress is always uncached at $0.09/GB; storage egress
--     served through the Smart CDN is cached at $0.03/GB               (3x)
--
-- And the shape was worse than the rate. `app_state` holds ONE row per
-- business per key, upserted whole, so a studio's entire photo library was
-- re-read on every sign-in and re-broadcast to every connected device on
-- every order update. Cost to serve scaled as library size x headcount — on
-- a plan that had just stopped limiting headcount.
--
-- WHAT THIS SETS UP
--
-- A private bucket, one folder per business, with the same wall every tenant
-- table already has: app.in_scope(). Plus a real, server-side storage cap
-- that a forged request cannot get past, because it is a row-level security
-- policy running inside Postgres rather than a number in a browser.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
-- Private. These are client measurements, fitting photos and finished pieces;
-- a public bucket would make every one of them readable by anyone holding the
-- URL, forever. Reads go through short-lived signed URLs instead.
--
-- 10 MB per file is deliberately generous against a ~150 KB compressed photo.
-- It exists to bound how far a studio can overshoot its cap on the last
-- upload (see storage_has_room below), not to be a normal limit anybody meets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'studio-media', 'studio-media', false, 10485760,
  array['image/webp','image/jpeg','image/png','image/gif','image/heic','image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. What a studio is allowed, and what it has used
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column if not exists storage_used_bytes bigint not null default 0,
  -- NULL means "whatever the plan says". A number here is a per-tenant
  -- override we set by hand when we agree a price with one studio, so a big
  -- multi-branch brand can have 500 GB or a terabyte without moving the cap
  -- for everybody else.
  add column if not exists storage_cap_bytes bigint,
  add column if not exists storage_cap_note text;

comment on column public.businesses.storage_cap_bytes is
  'Per-tenant storage override in bytes. NULL = use the plan default from app.plan_storage_bytes(). Set by an operator through admin-api when extra storage is sold, never by the tenant.';

-- The plan defaults, in one place, matching the app's PLANS. Bespoke is
-- deliberately not unlimited: it is "no fixed cap", which in practice means a
-- generous number set per contract on the row above. An actually unlimited
-- tier is an invitation to store video.
create or replace function app.plan_storage_bytes(p_plan text)
returns bigint
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case p_plan
    when 'trial'   then   2::bigint * 1000000000
    when 'starter' then  20::bigint * 1000000000   -- Basic
    when 'pro'     then 200::bigint * 1000000000
    when 'premium' then 1000::bigint * 1000000000  -- Bespoke: a floor, raised per contract
    else 2::bigint * 1000000000
  end
$$;

create or replace function app.storage_cap_for(p_business uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(b.storage_cap_bytes, app.plan_storage_bytes(b.plan))
  from public.businesses b
  where b.id = p_business
$$;

-- Is there room right now?
--
-- HONEST LIMITATION, stated here rather than discovered later: the storage
-- API inserts the object row and fills in its size afterwards, so a policy
-- evaluated at INSERT time cannot know how big THIS file is. It can only ask
-- whether the studio has room at all. Combined with the bucket's 10 MB file
-- limit, that means a studio can exceed its cap by at most one file. This is
-- a soft cap by construction and is the right trade: the alternative is
-- refusing uploads that would have fitted.
create or replace function app.storage_has_room(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(b.storage_used_bytes, 0) < app.storage_cap_for(p_business)
  from public.businesses b
  where b.id = p_business
$$;

-- How full, for the app to draw a meter and warn at 80% without summing
-- every object on every render.
create or replace function public.my_storage_usage()
returns table (business_id uuid, used_bytes bigint, cap_bytes bigint, pct numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id,
         coalesce(b.storage_used_bytes, 0),
         app.storage_cap_for(b.id),
         case when app.storage_cap_for(b.id) > 0
              then round(coalesce(b.storage_used_bytes,0)::numeric * 100 / app.storage_cap_for(b.id), 1)
              else 0 end
  from public.businesses b
  where app.in_scope(b.id, null)
$$;

revoke all on function public.my_storage_usage() from public;
grant execute on function public.my_storage_usage() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Keeping the running total honest
-- ---------------------------------------------------------------------------
-- Summing storage.objects on every upload would work and would get slower
-- every month. A trigger keeps one number current instead.
--
-- The business is the FIRST path segment. That is the whole isolation scheme:
-- <business_id>/<kind>/<uuid>.webp
create or replace function app.media_business_of(p_name text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare v uuid;
begin
  -- A malformed or non-uuid first segment returns NULL rather than raising,
  -- because a trigger that throws would take the whole upload down.
  begin
    v := (string_to_array(p_name, '/'))[1]::uuid;
  exception when others then
    return null;
  end;
  return v;
end
$$;

create or replace function app.media_usage_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_biz uuid;
  v_old bigint := 0;
  v_new bigint := 0;
begin
  if tg_op in ('INSERT','UPDATE') and new.bucket_id = 'studio-media' then
    v_biz := app.media_business_of(new.name);
    v_new := coalesce((new.metadata->>'size')::bigint, 0);
  end if;
  if tg_op in ('DELETE','UPDATE') and old.bucket_id = 'studio-media' then
    v_biz := coalesce(v_biz, app.media_business_of(old.name));
    v_old := coalesce((old.metadata->>'size')::bigint, 0);
  end if;

  if v_biz is not null and (v_new - v_old) <> 0 then
    update public.businesses
       set storage_used_bytes = greatest(0, coalesce(storage_used_bytes,0) + (v_new - v_old))
     where id = v_biz;
  end if;

  return coalesce(new, old);
end
$$;

drop trigger if exists media_usage_sync on storage.objects;
create trigger media_usage_sync
  after insert or update or delete on storage.objects
  for each row execute function app.media_usage_sync();

-- One-off reconciliation, so the counter is right even if it ever drifts.
create or replace function public.recount_storage_usage()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.businesses b
     set storage_used_bytes = coalesce((
       select sum(coalesce((o.metadata->>'size')::bigint, 0))
       from storage.objects o
       where o.bucket_id = 'studio-media'
         and app.media_business_of(o.name) = b.id
     ), 0)
$$;
revoke all on function public.recount_storage_usage() from public;
-- operators only, through the gateway
grant execute on function public.recount_storage_usage() to service_role;

-- ---------------------------------------------------------------------------
-- 4. The wall
-- ---------------------------------------------------------------------------
-- This is the part that makes the cap real rather than a number in a browser.
-- A tenant forging a request straight at the storage API still has to get
-- past these, and they run in Postgres.
drop policy if exists studio_media_select on storage.objects;
drop policy if exists studio_media_insert on storage.objects;
drop policy if exists studio_media_update on storage.objects;
drop policy if exists studio_media_delete on storage.objects;

create policy studio_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'studio-media'
    and app.in_scope(app.media_business_of(name), null)
  );

-- Two conditions, and both matter. The first is isolation: you may only write
-- into your own folder. The second is the cap.
create policy studio_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'studio-media'
    and app.in_scope(app.media_business_of(name), null)
    and app.storage_has_room(app.media_business_of(name))
  );

create policy studio_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'studio-media'
    and app.in_scope(app.media_business_of(name), null)
  )
  with check (
    bucket_id = 'studio-media'
    and app.in_scope(app.media_business_of(name), null)
  );

-- Deleting is NOT gated on having room. A studio that is full must be able to
-- clear space; refusing the one action that fixes the problem is how a cap
-- turns into a trap.
create policy studio_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'studio-media'
    and app.in_scope(app.media_business_of(name), null)
  );

-- ---------------------------------------------------------------------------
-- 5. Selling more space
-- ---------------------------------------------------------------------------
-- Called by admin-api, service role only. Extra storage costs us about
-- $0.0213/GB/month (~N28), so this is the row an operator writes after
-- agreeing a price — never something a tenant can reach.
create or replace function public.set_studio_storage_cap(
  p_business uuid, p_gb numeric, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_gb is not null and p_gb < 0 then
    raise exception 'A storage cap cannot be negative';
  end if;
  update public.businesses
     set storage_cap_bytes = case when p_gb is null then null
                                  else (p_gb * 1000000000)::bigint end,
         storage_cap_note  = p_note
   where id = p_business;
  if not found then
    raise exception 'No such studio: %', p_business;
  end if;
end
$$;
revoke all on function public.set_studio_storage_cap(uuid, numeric, text) from public;
grant execute on function public.set_studio_storage_cap(uuid, numeric, text) to service_role;

-- Backfill the counter for anything already there.
select public.recount_storage_usage();
