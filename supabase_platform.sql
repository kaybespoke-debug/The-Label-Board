-- ============================================================================
-- The Label Board — PLATFORM tables
--
-- This is the software business's own layer, not a studio's. It answers
-- "who are our customers, what are they on, and are they still using it".
--
-- Run once in the Label Board Supabase project:
--   Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Idempotent, so it is safe to run again.
--
-- SECURITY MODEL (deliberate, do not loosen without thinking it through):
--   * A studio can read its OWN businesses row and update only the harmless
--     columns on it. Column-level GRANTs stop a tenant promoting itself to a
--     bigger plan by writing to its own row.
--   * platform_admins is invisible to tenants entirely. No grants at all.
--   * Staff NEVER query these tables from a browser. The admin console goes
--     through service-role Edge Functions that check the caller is staff and
--     log what they did. That keeps tenant isolation absolute even if an admin
--     session is stolen.
-- ============================================================================

-- 1) BUSINESSES — one row per studio using the software. Our customer list.
create table if not exists public.businesses (
  id             uuid primary key,                       -- the same business_id every tenant row carries
  name           text,                                   -- the studio's own name, as they set it
  contact_email  text,
  country        text,
  plan           text        not null default 'trial',   -- trial | studio | growth | atelier
  status         text        not null default 'active',  -- active | past_due | paused | cancelled
  trial_ends_at  timestamptz default (now() + interval '30 days'),
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz,                            -- refreshed each time someone signs in
  app_version    text,                                   -- which build they are running
  notes          text                                    -- internal, staff only
);
create index if not exists businesses_last_seen_idx on public.businesses(last_seen_at desc nulls last);
create index if not exists businesses_plan_idx      on public.businesses(plan, status);

-- 2) PLATFORM_ADMINS — our own staff. Tenants can never see this table exists.
create table if not exists public.platform_admins (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  role       text        not null default 'support',     -- owner | support | developer | finance
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.businesses     enable row level security;
alter table public.platform_admins enable row level security;

-- a studio sees and touches only its own row
drop policy if exists businesses_own on public.businesses;
create policy businesses_own on public.businesses
  for all to authenticated
  using (id = public.my_business_id())
  with check (id = public.my_business_id());

-- platform_admins has RLS on and NO policy, so it is closed to every client.
-- Only the service role (inside an Edge Function) can read it.

-- ---------------------------------------------------------------------------
-- Column grants: the row is theirs, but the commercial fields are ours.
-- Without this a studio could simply set its own plan to 'atelier'.
-- ---------------------------------------------------------------------------
revoke all on public.businesses      from anon, authenticated;
revoke all on public.platform_admins from anon, authenticated;

grant select (id, name, contact_email, country, plan, status, trial_ends_at,
              created_at, last_seen_at, app_version)
  on public.businesses to authenticated;

-- a studio may introduce itself and say it is alive, nothing more
grant insert (id, name, contact_email, country, last_seen_at, app_version)
  on public.businesses to authenticated;
grant update (name, contact_email, country, last_seen_at, app_version)
  on public.businesses to authenticated;

-- note there is no DELETE grant: a studio cannot remove itself from our records

-- ---------------------------------------------------------------------------
-- Backfill: every business_id already in the data becomes a row, so existing
-- studios are not invisible. Runs safely on an empty database too.
-- ---------------------------------------------------------------------------
insert into public.businesses (id, created_at)
select distinct p.business_id, now()
from public.profiles p
where p.business_id is not null
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- MAKE YOURSELF PLATFORM STAFF
-- Use the SAME auth user id you used for your studio profile, or create a
-- separate staff login (cleaner: keeps your own studio account distinct).
--
--   insert into public.platform_admins (id, name, role)
--   values ('PASTE-AUTH-USER-UUID', 'Kay Ojomo', 'owner')
--   on conflict (id) do update set name = excluded.name, role = excluded.role;
--
-- Roles are for later: 'support' sees metadata and can open a logged support
-- session, 'developer' sees errors and versions, 'finance' sees plans and
-- billing state, 'owner' sees everything.
-- ============================================================================
