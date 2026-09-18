-- October early access: a fifth kind of enquiry, and a mark on the studios
-- that come in through it.
--
-- WHAT THIS IS FOR
-- The app has been used properly in exactly one studio: the one it was built
-- in. It claims six trades and two modes, and the ready-to-wear path, the
-- fabric counter and the multi-outlet roll-up have been reasoned about rather
-- than lived in. So a small number of real studios run on it through October,
-- a month before it goes on sale, and tell us what breaks.
--
-- THE ONE DESIGN RULE HERE
-- A place is taken when a studio ACCOUNT EXISTS, not when a form is submitted.
-- Kayode is inviting most of the first group directly, from studios he already
-- knows, and only the rest arrive through the website. If the count came from
-- the enquiries table, every studio he invited himself would be invisible to
-- it and the number on the screen would be wrong the day he started.
--
-- So the count lives on `businesses.cohort`, which both doors set:
--   through the website   enquiry -> accept -> inviteStudio -> business.cohort
--   invited directly                          inviteStudio -> business.cohort
-- One column, one number, and nothing to keep in sync.

-- ---------------------------------------------------------------------------
-- 1. the fifth kind, and the one new state
-- ---------------------------------------------------------------------------
-- 'earlyaccess' is a form of its own rather than a flag on a demo request,
-- because it is a different question. A demo request wants to be sold to. This
-- one is offering to do work for us.
--
-- 'waiting' is somebody who applied and is not getting one of the places. They
-- are not 'closed', which reads as refused, and not 'replied', which says
-- nothing about what they were told. They are on the November list and that is
-- a state we will want to filter and mail.
--
-- The constraints are inline in the create table, so Postgres named them. The
-- name is asserted rather than assumed: if it ever differs the migration stops
-- here instead of silently leaving the old constraint in place, which would
-- fail later at an insert nobody is watching.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.enquiries'::regclass and conname = 'enquiries_kind_check'
  ) then
    raise exception 'enquiries_kind_check is not where this migration expects it';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.enquiries'::regclass and conname = 'enquiries_state_check'
  ) then
    raise exception 'enquiries_state_check is not where this migration expects it';
  end if;
end $$;

alter table public.enquiries drop constraint enquiries_kind_check;
alter table public.enquiries add  constraint enquiries_kind_check
  check (kind in ('demo','contact','partner','referral','earlyaccess'));

alter table public.enquiries drop constraint enquiries_state_check;
alter table public.enquiries add  constraint enquiries_state_check
  check (state in ('new','open','replied','converted','waiting','spam','closed'));

-- ---------------------------------------------------------------------------
-- 2. which cohort a studio came in with
-- ---------------------------------------------------------------------------
-- Null for everybody who arrives normally. 'october-2026' for a tester. A text
-- column rather than a boolean because there will be a second cohort, and
-- "which group was this" is a question a boolean cannot answer a year later.
alter table public.businesses add column if not exists cohort text;

comment on column public.businesses.cohort is
  'Which intake this studio came in with, e.g. october-2026. Null for a normal signup. Set by admin-api at invitation; never writable by the studio.';

-- A partial index, because the whole point is that almost every row is null.
create index if not exists businesses_cohort_idx
  on public.businesses (cohort) where cohort is not null;

-- NOT added to the studio-writable grant list in 20260905130000. A studio
-- putting itself in the cohort would be putting itself on a free month, which
-- is the same class of mistake as a studio writing its own `plan`. The grant
-- there is the allow list and this column is deliberately not on it.

-- ---------------------------------------------------------------------------
-- 3. the two functions that validate the same values a second time
-- ---------------------------------------------------------------------------
-- Both re-check in the body rather than relying on the constraint, so both
-- have to be updated or the constraint widens and the door stays shut. That
-- duplication is on purpose: it is what turns a bad p_kind into a clean
-- refusal instead of a raised exception at the visitor.

create or replace function public.submit_enquiry(
  p_kind text, p_name text, p_email text, p_phone text,
  p_business text, p_message text, p_source_page text,
  p_extra jsonb default '{}'::jsonb, p_trap text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent int;
begin
  -- 1. a bot filled the honeypot. Write nothing, say nothing, and answer the
  --    same way a success answers, so it learns no more from being refused.
  if p_trap is not null and btrim(p_trap) <> '' then
    return;
  end if;

  -- 2. a kind we actually have a form for
  if p_kind is null or p_kind not in ('demo','contact','partner','referral','earlyaccess') then
    return;
  end if;

  -- 3. somebody has to be reachable, or there is nothing to do with it
  if (p_email is null or btrim(p_email) = '') and (p_phone is null or btrim(p_phone) = '') then
    return;
  end if;

  -- 4. one person hammering the form, or one bot that got past the honeypot,
  --    cannot fill the table. Same email, or same kind from anywhere, in the
  --    last minute.
  select count(*) into v_recent
  from public.enquiries
  where at > now() - interval '1 minute'
    and (
      (p_email is not null and btrim(p_email) <> '' and lower(email) = lower(btrim(p_email)))
      or kind = p_kind
    );
  if v_recent >= 20 then
    return;
  end if;

  insert into public.enquiries
    (kind, name, email, phone, business, message, source_page, extra)
  values (
    p_kind,
    nullif(btrim(coalesce(p_name, '')), ''),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_business, '')), ''),
    nullif(btrim(coalesce(p_message, '')), ''),
    nullif(btrim(coalesce(p_source_page, '')), ''),
    coalesce(p_extra, '{}'::jsonb)
  );
end $$;

revoke all    on function public.submit_enquiry(text,text,text,text,text,text,text,jsonb,text) from public, anon, authenticated;
grant  execute on function public.submit_enquiry(text,text,text,text,text,text,text,jsonb,text) to anon, authenticated;

create or replace function public.set_enquiry_state(
  p_id uuid, p_state text, p_by text default null, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_state not in ('new','open','replied','converted','waiting','spam','closed') then
    raise exception 'Unknown state: %', p_state;
  end if;
  update public.enquiries
     set state      = p_state,
         handled_by = coalesce(nullif(btrim(coalesce(p_by, '')), ''), handled_by),
         handled_at = now(),
         notes      = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
   where id = p_id;
end $$;

revoke execute on function public.set_enquiry_state(uuid,text,text,text) from public, anon, authenticated;
grant  execute on function public.set_enquiry_state(uuid,text,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. how many places are gone
-- ---------------------------------------------------------------------------
-- One number and nothing else. Written as its own function so that if the
-- public website is ever allowed to show a counter, there is something it can
-- call that cannot leak a studio name, an email address or a total headcount
-- of our customers. It is granted to service_role only today; opening it to
-- anon would be a deliberate act, not an oversight.
create or replace function public.cohort_taken(p_cohort text)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.businesses where cohort = p_cohort;
$$;

revoke all    on function public.cohort_taken(text) from public, anon, authenticated;
grant  execute on function public.cohort_taken(text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. two more columns on the console's tenant list
-- ---------------------------------------------------------------------------
-- `cohort`, so the console can show which studios are testers at all.
--
-- `orders_30d`, which is the whole point of watching a cohort. The list
-- already carries a lifetime `orders` count, and a lifetime count cannot tell
-- you that somebody stopped on day nine — it only ever goes up. The most
-- valuable conversation of the month is with the tester who went quiet, and
-- they are never the one who gets in touch.
--
-- The return type changes, and CREATE OR REPLACE cannot change a function's
-- OUT columns, so this drops and recreates. The grant goes with it, which is
-- why it is repeated below: a dropped function takes its grants with it, and
-- forgetting that leaves the console with a gateway that can no longer call
-- its own tenant list.
drop function if exists public.platform_tenant_summary();

create or replace function public.platform_tenant_summary()
returns table (
  id             uuid,
  name           text,
  slug           text,
  plan           text,
  status         text,
  created_at     timestamptz,
  members        bigint,
  branches       bigint,
  orders         bigint,
  orders_30d     bigint,
  cohort         text,
  last_active_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    b.id, b.name, b.slug, b.plan, b.status, b.created_at,
    (select count(*) from public.memberships m where m.business_id = b.id and m.status = 'active'),
    (select count(*) from public.branches  br where br.business_id = b.id),
    (select count(*) from public.orders    o  where o.business_id  = b.id),
    (select count(*) from public.orders    o  where o.business_id  = b.id
                                              and o.created_at > now() - interval '30 days'),
    b.cohort,
    (select max(s.updated_at) from public.app_state s where s.business_id = b.id)
  from public.businesses b
  order by b.created_at desc;
$$;

revoke all on function public.platform_tenant_summary() from public, anon, authenticated;
grant execute on function public.platform_tenant_summary() to service_role;
