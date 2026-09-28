-- =====================================================================
-- BATCH A — RBAC FOUNDATION
--
-- Built to RBAC_DESIGN.md v2. Additive: nothing here is read by any policy
-- yet, so every member keeps working exactly as they did. Batch A puts the
-- facts in place; Batch B makes them decide things.
--
-- WHAT THIS REPLACES. Three role systems that disagreed:
--   memberships.role      four tiers the database believes, two of which
--                         it cannot tell apart
--   profiles.role_id      ONE row per person for the whole platform,
--                         overwritten by accept_invitation, and the source
--                         of every permission decision the app makes
--   layi_dash_roles       the permission table, per business and correct
--                         about that, living inside the data it governs
--
-- After this migration: what a role may do is rows, which role somebody
-- holds is their MEMBERSHIP, and both belong to one business.
--
-- AND ONE LIVE BUG IT FIXES ON THE WAY. accept_invitation writes
-- profiles.role_id as the tier — 'staff', 'viewer' — and no such role
-- exists in the app's role table (owner, manager, cre, tailor,
-- accountant). Measured in the browser: with role_id='staff',
-- currentRole() is undefined and can('orders') is false. An invited staff
-- member has been landing in an app where nothing at all is permitted. The
-- back-fill below gives every membership a real role.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The catalogue — which permissions EXIST, platform-wide
-- ---------------------------------------------------------------------
-- Global on purpose, and it is the only global thing here: it defines the
-- vocabulary and the labels, so the Roles screen is data-driven and adding
-- a permission does not need an app release. No grant is global — every
-- grant is a row under a role under one business.
create table if not exists public.permission_catalogue (
  key          text primary key,
  label        text not null,
  grp          text not null,
  sort         int  not null default 0,
  /* 'owner' means untickable: reserved to the owner tier however the role
     is configured. Billing and ownership are not checkboxes. */
  tier_min     text check (tier_min in ('owner')),
  /* THE HONEST COLUMN. 'database' means a request that skips the app is
     refused. 'ui_only' means it hides something on a screen inside a blob
     the reader is allowed to fetch. RBAC_DESIGN.md section 10. */
  enforceable  text not null default 'ui_only'
                 check (enforceable in ('database', 'ui_only')),
  created_at   timestamptz not null default now()
);

insert into public.permission_catalogue (key, label, grp, sort, tier_min, enforceable) values
  -- pages
  ('orders',        'Production',                     'Pages',  10, null, 'database'),
  ('products',      'Shop',                           'Pages',  20, null, 'database'),
  ('customers',     'Customers',                      'Pages',  30, null, 'database'),
  ('marketing',     'Marketing',                      'Pages',  40, null, 'database'),
  ('logistics',     'Logistics',                      'Pages',  50, null, 'database'),
  ('supplies',      'Supplies & suppliers',           'Pages',  60, null, 'database'),
  ('team',          'Team',                           'Pages',  70, null, 'database'),
  ('branchSwitch',  'Switch branches',                'Pages',  80, null, 'database'),
  ('attendance',    'Attendance',                     'Pages',  90, null, 'database'),
  ('finance',       'Finance',                        'Money', 100, null, 'database'),
  ('expenses',      'Expenses',                       'Money', 110, null, 'database'),
  ('funds',         'Funds & reserves',               'Money', 120, null, 'database'),
  ('sales',         'Sales (retail)',                 'Money', 130, null, 'database'),
  ('payroll',       'Payroll & salaries',             'Money', 140, null, 'ui_only'),
  ('audit',         'Audit trail',                    'Studio',150, null, 'database'),
  ('settings',      'Settings',                       'Studio',160, null, 'database'),
  ('users',         'Accounts & roles',               'Studio',170, null, 'database'),
  -- what a role may do
  ('money',         'See prices & amounts',           'Money', 200, null, 'ui_only'),
  ('receivables',   'See balances owed & payments in','Money', 210, null, 'ui_only'),
  ('seeProfit',     'See profit & margins',           'Money', 220, null, 'ui_only'),
  ('seeCost',       'See cost prices',                'Money', 230, null, 'ui_only'),
  ('seeContact',    'See customer contact details',   'Clients',240, null,'ui_only'),
  ('allOrders',     'See all orders',                 'Orders',250, null, 'ui_only'),
  ('editStaff',     'Edit staff profiles & records',  'Team',  260, null, 'ui_only'),
  ('update',        'Post production updates',        'Orders',270, null, 'ui_only'),
  ('canQC',         'Do quality checks',              'Orders',280, null, 'ui_only'),
  ('canDispatch',   'Dispatch orders',                'Orders',290, null, 'ui_only'),
  ('appts',         'Manage appointments',            'Orders',300, null, 'database'),
  ('del',           'Delete orders',                  'Orders',310, null, 'ui_only'),
  ('setCatalog',    'Settings: catalog & tiers',      'Studio',320, null, 'database'),
  ('setCompany',    'Settings: company details',      'Studio',330, null, 'database'),
  ('setWorkflow',   'Settings: workflow & recipes',   'Studio',340, null, 'database'),
  ('setBranches',   'Settings: branches & outlets',   'Studio',350, null, 'database'),
  ('setData',       'Import, backup & wipe data',     'Studio',360, null, 'database'),
  ('ownTasksOnly',  'Only their own work',            'Orders',370, null, 'ui_only'),
  -- added by RBAC v2
  ('team.view',     'See who is on the team',         'Team',  400, null, 'database'),
  ('team.invite',   'Invite people',                  'Team',  410, null, 'database'),
  ('team.remove',   'Remove people',                  'Team',  420, null, 'database'),
  ('branches.manage','Add and rename branches',       'Studio',430, null, 'database'),
  ('business.edit', 'Change the studio''s details',   'Studio',440, null, 'database'),
  ('data.export',   'Export the studio''s data',      'Studio',450, null, 'database'),
  ('finance.export','Export financial data',          'Money', 460, null, 'database'),
  ('billing.view',  'See the subscription',           'Billing',470, null,'database'),
  ('billing.manage','Change the subscription',        'Billing',480, 'owner','database'),
  ('ownership.transfer','Transfer ownership',         'Billing',490, 'owner','database')
on conflict (key) do update
  set label = excluded.label, grp = excluded.grp, sort = excluded.sort,
      tier_min = excluded.tier_min, enforceable = excluded.enforceable;

-- ---------------------------------------------------------------------
-- 2. Roles, per business
-- ---------------------------------------------------------------------
create table if not exists public.business_roles (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  key          text not null,
  name         text not null,
  /* The TIER is the system fact and the permission table cannot change it.
     owner is authority, not a capability: app.can() short-circuits on it,
     so no edit to any role can lock an owner out of their own studio. */
  tier         text not null check (tier in ('owner','manager','staff','viewer')),
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, key),
  /* so a membership can key on both and a role from another studio is not
     merely rejected, it is unstorable — the same trick the branch columns
     have used since September */
  unique (id, business_id)
);
create index if not exists business_roles_business_idx on public.business_roles(business_id);

create table if not exists public.business_role_permissions (
  role_id        uuid not null references public.business_roles(id) on delete cascade,
  permission_key text not null references public.permission_catalogue(key),
  granted_at     timestamptz not null default now(),
  granted_by     uuid,
  primary key (role_id, permission_key)
);

alter table public.memberships
  add column if not exists role_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_role_in_business') then
    alter table public.memberships
      add constraint memberships_role_in_business
      foreign key (role_id, business_id)
      references public.business_roles(id, business_id) on delete set null;
  end if;
end $$;

alter table public.team_invitations
  add column if not exists role_id uuid references public.business_roles(id) on delete set null;

-- ---------------------------------------------------------------------
-- 3. The defaults
-- ---------------------------------------------------------------------
-- RBAC_DESIGN.md section 9. A manager does NOT see profit, cost or payroll
-- by default, and cannot invite or remove people: what a garment costs and
-- what everybody earns are the owner's business until the owner says
-- otherwise, and the team list is who can read the studio. All four are one
-- tick away.
create or replace function app.default_permissions(p_tier text)
returns text[] language sql immutable as $$
  select case p_tier
    when 'owner' then
      (select array_agg(key) from public.permission_catalogue where key <> 'ownTasksOnly')
    when 'manager' then array[
      'orders','products','customers','marketing','logistics','supplies','team',
      'branchSwitch','attendance','expenses','sales','audit','settings',
      'money','receivables','seeContact','allOrders','editStaff',
      'update','canQC','canDispatch','appts','del',
      'setCatalog','setWorkflow','team.view','billing.view']
    when 'staff' then array[
      'orders','products','customers','supplies','team','attendance',
      'money','seeContact','allOrders','update','canQC','canDispatch','appts',
      'team.view']
    when 'viewer' then array[
      'orders','products','customers','team','money','allOrders','team.view']
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------------
-- 4. Seed every business
-- ---------------------------------------------------------------------
insert into public.business_roles (business_id, key, name, tier, is_system)
select b.id, r.key, r.name, r.key, true
from public.businesses b
cross join (values
  ('owner','Owner'), ('manager','Manager'), ('staff','Staff'), ('viewer','Viewer')
) as r(key, name)
on conflict (business_id, key) do nothing;

insert into public.business_role_permissions (role_id, permission_key)
select r.id, k
from public.business_roles r
cross join lateral unnest(app.default_permissions(r.tier)) as k
where r.is_system
on conflict do nothing;

/* Anything the studio built for itself. The app has shipped five built-in
   roles and a create-your-own button since long before this, and a studio
   that renamed "Client Relations" to "Front of house" keeps it. owner and
   manager are skipped because the system rows above already carry those
   keys; everything else lands as a non-system role on the staff tier,
   which is the conservative direction. */
insert into public.business_roles (business_id, key, name, tier, is_system)
select a.business_id, e->>'id', coalesce(nullif(e->>'name',''), e->>'id'), 'staff', false
from public.app_state a
cross join lateral jsonb_array_elements(a.data) e
where a.key = 'layi_dash_roles'
  and jsonb_typeof(a.data) = 'array'
  and coalesce(e->>'id','') <> ''
  and (e->>'id') not in ('owner','manager','staff','viewer')
on conflict (business_id, key) do nothing;

/* and their permissions, exactly as the studio had them, filtered to keys
   the catalogue knows. A key the catalogue has never heard of is dropped
   rather than carried: the foreign key would refuse it anyway, and a
   silently kept typo is the failure this whole table exists to prevent. */
insert into public.business_role_permissions (role_id, permission_key)
select r.id, p.key
from public.app_state a
cross join lateral jsonb_array_elements(a.data) e
join public.business_roles r
  on r.business_id = a.business_id and r.key = e->>'id' and not r.is_system
cross join lateral jsonb_each_text(coalesce(e->'perms','{}'::jsonb)) p(key, val)
join public.permission_catalogue c on c.key = p.key
where a.key = 'layi_dash_roles'
  and jsonb_typeof(a.data) = 'array'
  and p.val in ('1','true')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. Give every existing membership a role
-- ---------------------------------------------------------------------
-- profiles.role_id first, because that is what the person has actually been
-- using; the membership TIER second, which is the conservative fallback and
-- the one that repairs every invited staff member and viewer.
update public.memberships m
set role_id = coalesce(
  (select r.id from public.business_roles r
   join public.profiles p on p.id = m.user_id
   where r.business_id = m.business_id
     and p.business_id = m.business_id
     and r.key = p.role_id),
  (select r.id from public.business_roles r
   where r.business_id = m.business_id and r.key = m.role)
)
where m.role_id is null;

-- ---------------------------------------------------------------------
-- 6. The three questions
-- ---------------------------------------------------------------------
create or replace function app.is_owner(p_business uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.business_id = p_business
      and m.status = 'active'
      and m.role = 'owner'
  );
$$;

-- WHAT. Capability only, and deliberately no branch argument: an optional
-- branch that defaults to null is exactly how a branch-restricted member
-- ends up reading another branch.
create or replace function app.can(p_business uuid, p_perm text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.business_id = p_business
      and m.status = 'active'
      and ( m.role = 'owner'
            or exists (select 1 from public.business_role_permissions p
                       where p.role_id = m.role_id and p.permission_key = p_perm) )
  );
$$;

-- WHAT and WHERE. Every policy on a table with a branch_id uses this, with
-- that table's own column — never a value from the request.
create or replace function app.can_here(p_business uuid, p_perm text, p_branch uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select app.can(p_business, p_perm) and app.in_scope(p_business, p_branch);
$$;

-- Whether this member speaks for the whole business. Anything that
-- aggregates across branches asks this as well as app.can().
create or replace function app.has_all_branches(p_business uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.business_id = p_business
      and m.status = 'active' and m.branch_id is null
  );
$$;

grant execute on function app.can(uuid, text) to authenticated, service_role;
grant execute on function app.can_here(uuid, text, uuid) to authenticated, service_role;
grant execute on function app.has_all_branches(uuid) to authenticated, service_role;
grant execute on function app.is_owner(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Who may read and write the new tables
-- ---------------------------------------------------------------------
alter table public.permission_catalogue enable row level security;
alter table public.permission_catalogue force row level security;
alter table public.business_roles enable row level security;
alter table public.business_roles force row level security;
alter table public.business_role_permissions enable row level security;
alter table public.business_role_permissions force row level security;

grant select on public.permission_catalogue to authenticated;
grant select on public.business_roles to authenticated;
grant insert, update, delete on public.business_roles to authenticated;
grant select on public.business_role_permissions to authenticated;
grant insert, delete on public.business_role_permissions to authenticated;

drop policy if exists permission_catalogue_read on public.permission_catalogue;
create policy permission_catalogue_read on public.permission_catalogue
  for select to authenticated using (true);

drop policy if exists business_roles_select on public.business_roles;
create policy business_roles_select on public.business_roles
  for select using (app.in_scope(business_id, null));

/* The permission table is the owner's, and this is the same rule Phase 0
   put on layi_dash_roles, in its permanent home. */
drop policy if exists business_roles_insert on public.business_roles;
create policy business_roles_insert on public.business_roles
  for insert with check (app.is_owner(business_id) and not is_system);

drop policy if exists business_roles_update on public.business_roles;
create policy business_roles_update on public.business_roles
  for update using (app.is_owner(business_id)) with check (app.is_owner(business_id));

drop policy if exists business_roles_delete on public.business_roles;
create policy business_roles_delete on public.business_roles
  for delete using (app.is_owner(business_id) and not is_system);

drop policy if exists business_role_permissions_select on public.business_role_permissions;
create policy business_role_permissions_select on public.business_role_permissions
  for select using (exists (
    select 1 from public.business_roles r
    where r.id = role_id and app.in_scope(r.business_id, null)));

drop policy if exists business_role_permissions_insert on public.business_role_permissions;
create policy business_role_permissions_insert on public.business_role_permissions
  for insert with check (exists (
    select 1 from public.business_roles r
    where r.id = role_id and app.is_owner(r.business_id)));

drop policy if exists business_role_permissions_delete on public.business_role_permissions;
create policy business_role_permissions_delete on public.business_role_permissions
  for delete using (exists (
    select 1 from public.business_roles r
    where r.id = role_id and app.is_owner(r.business_id)));

-- ---------------------------------------------------------------------
-- 8. Two things a permission system must never allow
-- ---------------------------------------------------------------------
-- A system role's tier is the anchor for everything else. Renaming one is
-- fine — a studio may well want "Head of workroom" instead of "Manager" —
-- but changing what tier it is, or deleting it, is not.
create or replace function app.guard_business_role()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.is_system and new.tier is distinct from old.tier then
    raise exception 'The % role''s level cannot be changed', old.key
      using errcode = '42501',
            hint = 'Rename it if you like. What it IS is what the rest of the studio is anchored to.';
  end if;
  if old.is_system and new.is_system is distinct from old.is_system then
    raise exception 'A built-in role cannot be turned into a custom one'
      using errcode = '42501';
  end if;
  if old.key = 'owner' and new.key is distinct from old.key then
    raise exception 'The owner role cannot be renamed away' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists business_roles_guard on public.business_roles;
create trigger business_roles_guard
  before update on public.business_roles
  for each row execute function app.guard_business_role();

-- And nobody removes a permission from the owner role. app.can() does not
-- read it for an owner, so this is belt to that brace: it stops a screen
-- ever DRAWING an owner as though they were limited.
create or replace function app.guard_owner_permissions()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
declare v_key text; v_system boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  select r.key, r.is_system into v_key, v_system
  from public.business_roles r where r.id = coalesce(new.role_id, old.role_id);
  if v_system and v_key = 'owner' and tg_op = 'DELETE' then
    raise exception 'The owner can do everything, and that is not a setting'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists business_role_permissions_guard on public.business_role_permissions;
create trigger business_role_permissions_guard
  before delete on public.business_role_permissions
  for each row execute function app.guard_owner_permissions();

comment on table public.business_roles is
  'What a role is called and what level it sits at, per business. The tier '
  'is the system fact; the permissions are rows in business_role_permissions.';
comment on table public.business_role_permissions is
  'One row per granted permission. A row, not a JSON key, so a typo is '
  'refused by the foreign key instead of silently denying access forever.';
