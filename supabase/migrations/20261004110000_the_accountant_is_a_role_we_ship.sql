-- =====================================================================
-- THE ACCOUNTANT IS A ROLE WE SHIP
-- =====================================================================
-- The customer app has shipped an Accountant role as builtin:true for a
-- long time. The database has only ever known four system roles, so every
-- studio's accountant arrived as a CUSTOM role, imported from the old
-- layi_dash_roles blob with whatever permissions that studio's copy of the
-- blob happened to carry on the day the import ran.
--
-- Measured on production, 4 October 2026, across nine studios:
--
--   * eight studios have an accountant role, one has none at all
--   * seven hold eleven permissions, one holds fifteen, and the difference
--     is exactly the four keys that the app's own PERM_FALLBACK resolves
--     to true for an accountant: expenses, funds, sales, receivables. The
--     studio with fifteen had simply run a newer build of the app before
--     its blob was imported.
--   * none of the nine holds the tasks page, which the shipped definition
--     grants.
--   * NO studio holds a single permission outside the shipped set. There
--     is no customisation here to protect: there is a seeding difference,
--     and the app's own model already says what the answer should be.
--   * no member anywhere holds the role yet, so this is the last moment
--     when standardising it is free.
--
-- The decision: accountant becomes the fifth role we ship, seeded like the
-- other four, and it includes receivables explicitly rather than
-- inheriting it from a fallback.
--
-- What it deliberately does NOT include: team, team.view, editStaff,
-- users, settings, audit, orders, products, billing.anything or
-- ownership.transfer. An accountant reads the studio's money. It does not
-- run the studio, change its settings or decide who else may read it. Its
-- tier stays staff, which is what every authority check that is not a
-- permission reads.

-- ---------------------------------------------------------------------
-- 1. What a system role is seeded with, by key rather than by tier
-- ---------------------------------------------------------------------
-- app.default_permissions(tier) is left exactly as it is. It is the right
-- answer for the four roles whose key IS their tier, and it is relied on
-- elsewhere. This wraps it rather than retyping it, so there is still one
-- definition of what a manager gets.
create or replace function app.system_role_permissions(p_key text)
returns text[] language sql stable
set search_path = public, pg_temp as $fn$
  select case p_key
    when 'accountant' then array[
      'customers','attendance','tasks',
      'money','receivables','expenses','funds','sales',
      'finance','finance.record_payment','payroll',
      'seeProfit','seeCost',
      'customers.manage','seeContact',
      'allOrders']
    else app.default_permissions(p_key)
  end;
$fn$;

comment on function app.system_role_permissions(text) is
  'What a role we SHIP is seeded with, keyed on the role key. Delegates to '
  'app.default_permissions for owner/manager/staff/viewer, whose key is their '
  'tier. accountant is the one role whose key is not a tier.';

-- ---------------------------------------------------------------------
-- 2. Five roles the moment a studio exists, not four
-- ---------------------------------------------------------------------
create or replace function app.seed_business_roles()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  insert into public.business_roles (business_id, key, name, tier, is_system)
  values (new.id, 'owner',      'Owner',      'owner',   true),
         (new.id, 'manager',    'Manager',    'manager', true),
         (new.id, 'staff',      'Staff',      'staff',   true),
         (new.id, 'viewer',     'Viewer',     'viewer',  true),
         (new.id, 'accountant', 'Accountant', 'staff',   true)
  on conflict (business_id, key) do nothing;

  insert into public.business_role_permissions (role_id, permission_key)
  select r.id, k
  from public.business_roles r
  cross join lateral unnest(app.system_role_permissions(r.key)) as k
  where r.business_id = new.id and r.is_system
  on conflict do nothing;

  return new;
end $fn$;

-- ---------------------------------------------------------------------
-- 3. The studios that already exist
-- ---------------------------------------------------------------------
-- Three different starting states, and the order matters: promote what is
-- already there before creating anything, so a studio is never given a
-- second accountant.
do $do$
declare
  v_std        text[] := app.system_role_permissions('accountant');
  v_promoted   int := 0;
  v_created    int := 0;
  v_granted    int := 0;
  v_left_alone text := '';
  r            record;
begin
  /* 3a. An accountant role a studio has CHANGED is not ours to take over.
         The test is exact rather than trusting the measurement above: a
         role holding any permission outside the shipped set has had a
         human decision applied to it, and it stays a custom role with
         every permission it has. Nothing is revoked from it and it is not
         promoted, because promoting it would stop its owner deleting it. */
  for r in
    select br.id, b.name as biz
    from public.business_roles br
    join public.businesses b on b.id = br.business_id
    where br.key = 'accountant' and not br.is_system
      and exists (select 1 from public.business_role_permissions p
                  where p.role_id = br.id and p.permission_key <> all (v_std))
  loop
    v_left_alone := v_left_alone || chr(10) || '    ' || r.biz || ' (role ' || r.id || ')';
  end loop;

  /* 3b. The untouched ones become the role we ship. */
  update public.business_roles br
     set is_system = true, tier = 'staff'
   where br.key = 'accountant' and not br.is_system
     and not exists (select 1 from public.business_role_permissions p
                     where p.role_id = br.id and p.permission_key <> all (v_std));
  get diagnostics v_promoted = row_count;

  /* 3c. A studio with no accountant at all gets one. */
  insert into public.business_roles (business_id, key, name, tier, is_system)
  select b.id, 'accountant', 'Accountant', 'staff', true
  from public.businesses b
  where not exists (select 1 from public.business_roles r2
                    where r2.business_id = b.id and r2.key = 'accountant')
  on conflict (business_id, key) do nothing;
  get diagnostics v_created = row_count;

  /* 3d. and every system accountant ends up with the whole set. ADDITIVE
         ONLY: there is no delete here, so a studio cannot lose a
         permission to this migration. */
  insert into public.business_role_permissions (role_id, permission_key)
  select r2.id, k
  from public.business_roles r2
  cross join lateral unnest(v_std) as k
  where r2.key = 'accountant' and r2.is_system
  on conflict do nothing;
  get diagnostics v_granted = row_count;

  raise notice 'accountant standardised: % promoted, % newly created, % permissions granted',
    v_promoted, v_created, v_granted;
  if v_left_alone <> '' then
    raise notice 'accountant roles LEFT ALONE because the studio had changed them:%', v_left_alone;
  end if;
end $do$;
