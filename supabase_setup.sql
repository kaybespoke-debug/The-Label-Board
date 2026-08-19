-- ============================================================================
-- LAYI Studio OS — Supabase setup
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- It is idempotent (safe to run again). It creates the 4 tables the app talks to
-- (profiles, customers, suppliers, app_state) with row-level security keyed on a
-- business_id, so each business only ever sees its own data.
-- ============================================================================

-- 1) PROFILES — one row per login, linking an auth user to a business + role.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  role_id     text default 'owner',           -- matches the app's role ids: owner/manager/cre/tailor/accountant/…
  business_id uuid not null,                   -- everyone in the same business shares this
  created_at  timestamptz not null default now()
);

-- 2) CUSTOMERS — relational (the app queries these columns).
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  name         text,
  email        text,
  whatsapp     text,
  address      text,
  note         text,
  measurements jsonb default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists customers_business_idx on public.customers(business_id);

-- 3) SUPPLIERS / VENDORS — relational.
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  name        text,
  type        text,
  contact     text,
  note        text,
  data        jsonb default '{}'::jsonb,        -- everything else about the vendor
  created_at  timestamptz not null default now()
);
create index if not exists suppliers_business_idx on public.suppliers(business_id);

-- 4) APP_STATE — the generic store for every other data key
--    (orders, txns, staff, users, roles, products, supplies, bills, pots, tasks,
--     announcements, attendance, leave, shifts, campaigns, log, audit, settings).
--    One row per business + key; the app upserts a JSON blob and pulls it on login/Sync.
create table if not exists public.app_state (
  business_id uuid not null,
  key         text not null,
  data        jsonb,
  updated_at  timestamptz not null default now(),
  primary key (business_id, key)
);

-- ---------------------------------------------------------------------------
-- Row-level security: a signed-in user only touches rows for THEIR business.
-- ---------------------------------------------------------------------------
alter table public.profiles  enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.app_state enable row level security;

-- profiles: you can read/update your own profile row.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- a helper so the business policies read cleanly
create or replace function public.my_business_id() returns uuid
  language sql stable security definer set search_path = public as
$$ select business_id from public.profiles where id = auth.uid() $$;

-- customers / suppliers / app_state: scoped to your business.
drop policy if exists customers_by_business on public.customers;
create policy customers_by_business on public.customers
  for all to authenticated
  using (business_id = public.my_business_id())
  with check (business_id = public.my_business_id());

drop policy if exists suppliers_by_business on public.suppliers;
create policy suppliers_by_business on public.suppliers
  for all to authenticated
  using (business_id = public.my_business_id())
  with check (business_id = public.my_business_id());

drop policy if exists app_state_by_business on public.app_state;
create policy app_state_by_business on public.app_state
  for all to authenticated
  using (business_id = public.my_business_id())
  with check (business_id = public.my_business_id());

-- ---------------------------------------------------------------------------
-- Team accounts carry an optional linked staff record id (pay/attendance/reporting).
alter table public.profiles add column if not exists staff_id text;

-- ---------------------------------------------------------------------------
-- REALTIME: stream every device's changes live. Safe to re-run.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_state') then
    alter publication supabase_realtime add table public.app_state; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='customers') then
    alter publication supabase_realtime add table public.customers; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='suppliers') then
    alter publication supabase_realtime add table public.suppliers; end if;
end $$;

-- ---------------------------------------------------------------------------
-- CREATE YOUR FIRST LOGIN
-- 1) Dashboard → Authentication → Users → Add user  (email + password, "Auto confirm").
-- 2) Copy that user's UUID, then run the two lines below (pick any business_id UUID and reuse it
--    for every teammate of the same business — the app's built-in default is
--    11111111-1111-1111-1111-111111111111 if you want to match the demo):
--
--    insert into public.profiles (id, name, role_id, business_id)
--    values ('PASTE-AUTH-USER-UUID', 'Kay Ojomo', 'owner', '11111111-1111-1111-1111-111111111111');
--
-- 3) Open the app and sign in with that EMAIL + password (an email address, not a username,
--    is what triggers the live/cloud path). Your local data seeds the cloud on first login;
--    after that every change syncs, and the ↻ Sync button pulls the latest.
-- ============================================================================
