-- =====================================================================
-- The Label Board — what the running apps actually talk to
--
-- The migrations before this one build the tenant spine and the operator
-- console's own tables. They do NOT build several things the shipped code
-- reaches for every day, because those were created by hand in the first
-- Supabase project from loose scripts at the repo root:
--
--   app_state        the customer app syncs nineteen storage keys here
--   profiles         a login, its role, and the business it belongs to
--   suppliers        the app's relational vendor store
--   platform_audit   every read and write the admin gateway serves
--   platform_tenant_summary()   the console's tenant list
--
-- A fresh project built only from supabase/migrations/ would be missing
-- all five, and the failures would be quiet: sync stops, sign-in fails,
-- the console shows nothing, and none of it says why.
--
-- It also fixes a live incompatibility. public.customers as created by
-- the tenant-isolation migration has name/phone/email; the app writes
-- whatsapp, address, note and a measurements blob. Those columns are
-- added here rather than by changing the app, because the app is the
-- product and the schema exists to serve it.
--
-- The loose scripts (supabase_setup.sql, supabase_platform.sql,
-- supabase_platform_api.sql) are superseded by this file and should not
-- be run against a new project: two of them create businesses,
-- platform_admins and customers with older shapes, and because they use
-- "create table if not exists", whichever ran first would win and the
-- row-level security policies would land on the wrong columns.
--
-- Verified by supabase/tests/rls_harness.mjs and app_schema_harness.mjs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- customers: the columns the app has always written
-- ---------------------------------------------------------------------
alter table public.customers add column if not exists whatsapp     text;
alter table public.customers add column if not exists address      text;
alter table public.customers add column if not exists note         text;
alter table public.customers add column if not exists measurements jsonb not null default '{}'::jsonb;
-- the app posts a customer with a name and nothing else; a NOT NULL name
-- with no default would reject that, and the app has no way to report it
alter table public.customers alter column name drop not null;

-- ---------------------------------------------------------------------
-- suppliers: vendors, couriers, makers and partners
--
-- Deliberately shaped like the app's own record rather than normalised:
-- the columns that get searched and filtered are real columns, and the
-- rest of the vendor rides in `data`. Normalising the rest would mean a
-- migration every time the app adds a field to a form.
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text,
  type        text,
  contact     text,
  note        text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint suppliers_id_business_key unique (id, business_id)
);

-- ---------------------------------------------------------------------
-- app_state: one row per business per storage key
--
-- The customer app keeps everything in localStorage and syncs each key
-- up as a JSON blob. This is that landing place. It is a blob store on
-- purpose: the app is local-first and its shapes change with the product,
-- so pinning them into columns would make every UI change a migration.
-- ---------------------------------------------------------------------
create table if not exists public.app_state (
  business_id uuid not null references public.businesses(id) on delete cascade,
  key         text not null,
  data        jsonb,
  updated_at  timestamptz not null default now(),
  primary key (business_id, key)
);

-- ---------------------------------------------------------------------
-- profiles: a login, its role, and the business it belongs to
--
-- auth user ids are stored, not foreign-keyed, matching the rest of the
-- schema: a deleted auth user must not take a business's records with it.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key,
  name        text,
  role_id     text not null default 'owner',
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id    text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_profiles_business on public.profiles (business_id);

-- ---------------------------------------------------------------------
-- platform_audit: what our own staff looked at, and changed
--
-- Reads are logged as well as writes. The point is being able to answer
-- "who looked at my studio", not only "who changed it".
-- ---------------------------------------------------------------------
create table if not exists public.platform_audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  admin_id    uuid,
  admin_email text,
  action      text not null,
  business_id uuid,
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists idx_platform_audit_at  on public.platform_audit (at desc);
create index if not exists idx_platform_audit_biz on public.platform_audit (business_id);

-- =====================================================================
-- POLICIES
--
-- Same rules as every other tenant table: scoped by app.in_scope(), RLS
-- forced so the owner is subject to it too, and anon revoked outright.
-- =====================================================================

alter table public.suppliers  enable row level security;
alter table public.suppliers  force  row level security;
alter table public.app_state  enable row level security;
alter table public.app_state  force  row level security;
alter table public.profiles   enable row level security;
alter table public.profiles   force  row level security;
alter table public.platform_audit enable row level security;
alter table public.platform_audit force  row level security;

create index if not exists idx_suppliers_business on public.suppliers (business_id);
create index if not exists idx_app_state_business on public.app_state (business_id);

do $$
declare
  t text;
begin
  foreach t in array array['suppliers','app_state']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format('create policy %I on public.%I for select to authenticated using (app.in_scope(business_id, null))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.in_scope(business_id, null))', t || '_insert', t);
    -- WITH CHECK on update as well as USING: without it a tenant can move
    -- its own row into another tenant by rewriting business_id
    execute format('create policy %I on public.%I for update to authenticated using (app.in_scope(business_id, null)) with check (app.in_scope(business_id, null))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app.in_scope(business_id, null))', t || '_delete', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- profiles: you may read the people in your own business, and edit only
-- yourself. Adding or removing a teammate goes through the team-admin
-- Edge Function, which checks the caller is an owner or manager server
-- side — a tenant that could insert profiles could invent an owner.
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_self on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (app.in_scope(business_id, null));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and app.in_scope(business_id, null));

revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;

-- platform_audit gets no policy at all. RLS is forced, so it is
-- unreadable and unwritable to anyone but the service role — which is
-- the only thing that should ever touch an audit log.
revoke all on public.platform_audit from anon, authenticated;

-- =====================================================================
-- WHAT THE CONSOLE READS
--
-- One row per studio with the numbers the operator console lists. A
-- function rather than a view because the console reaches it through the
-- admin gateway as service_role, and keeping it in one place means the
-- shape the console depends on is defined next to the tables it reads.
-- =====================================================================

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
    (select max(s.updated_at) from public.app_state s where s.business_id = b.id)
  from public.businesses b
  order by b.created_at desc;
$$;

-- Only our own gateway may call it. A tenant holding a valid session must
-- not be able to enumerate every studio on the platform.
revoke all on function public.platform_tenant_summary() from public, anon, authenticated;
grant execute on function public.platform_tenant_summary() to service_role;
