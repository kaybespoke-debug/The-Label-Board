-- =====================================================================
-- AN ACCOUNTANT CAN SEE THE ORDERS
-- =====================================================================
-- v68 handed the accountant what an order sold for and what has been paid
-- on it, and the role proof found that it could not see WHICH order: no
-- reference, no client, no date. It holds `allOrders` and not `orders`,
-- which is what the app has shipped for years, so it was neither new nor a
-- leak — but for a role whose whole job is reconciliation it was an
-- oversight rather than a boundary.
--
-- IS `orders` THE RIGHT KEY? Asked of the policies rather than assumed:
--
--   orders_select  app.can_here(business_id, 'orders', branch_id)
--                  and (allOrders or it is their own task)
--   orders_insert  app.can_here(business_id, 'orders.edit', branch_id)
--   orders_update  app.can_here(business_id, 'orders.edit', branch_id)
--   orders_delete  app.can_here(business_id, 'del', branch_id)
--
-- So `orders` is the read key and nothing else. Writing takes
-- `orders.edit` and deleting takes `del`, neither of which the accountant
-- holds or gains here. There is no narrower read mechanism to reach for:
-- `orders` IS the narrow one, and inventing an `orders.view` beside it
-- would be a new role architecture for no gain.
--
-- WHAT IT DOES NOT TOUCH: orders.edit, del, update, canQC, canDispatch,
-- products, supplies, team, team.view, editStaff, users, settings, audit,
-- billing.anything, ownership.transfer, setCatalog, setWorkflow. An
-- accountant reads the studio's orders and its money. It does not take an
-- order, change one, delete one, move one through production, manage
-- anybody or alter the studio.
--
-- The app is the other half of this and is changed in the same release:
-- it gates New Order, Edit and Duplicate on can('orders'), which is the
-- read key, so it has been offering those buttons to every `viewer` in all
-- nine studios and the server has been refusing them. Those affordances now
-- ask for `orders.edit`, which is what the database has always required.

-- ---------------------------------------------------------------------
-- 1. The role we ship gains the read key
-- ---------------------------------------------------------------------
-- COPIED FROM 20261004110000 with 'orders' added to the array and nothing
-- else changed.
create or replace function app.system_role_permissions(p_key text)
returns text[] language sql stable
set search_path = public, pg_temp as $fn$
  select case p_key
    when 'accountant' then array[
      /* the pages, and `orders` is the READ key — writing is orders.edit */
      'orders','allOrders','customers','attendance','tasks',
      'money','receivables','expenses','funds','sales',
      'finance','finance.record_payment','payroll',
      'seeProfit','seeCost',
      'customers.manage','seeContact']
    else app.default_permissions(p_key)
  end;
$fn$;

comment on function app.system_role_permissions(text) is
  'What a role we SHIP is seeded with, keyed on the role key. Delegates to '
  'app.default_permissions for owner/manager/staff/viewer, whose key is their '
  'tier. accountant is the one role whose key is not a tier. It holds '
  '`orders` for reading and NOT `orders.edit` or `del`, which is what the '
  'policies on public.orders distinguish.';

-- ---------------------------------------------------------------------
-- 2. The studios that already exist
-- ---------------------------------------------------------------------
-- ADDITIVE AND ONLY TO THE ROLE WE SHIP. A studio that has changed its own
-- accountant still has a custom role, and this does not reach into it: the
-- is_system flag is the line, and 20261004110000 is what drew it.
do $do$
declare
  v_granted int := 0;
  v_custom  int := 0;
begin
  insert into public.business_role_permissions (role_id, permission_key)
  select r.id, k
  from public.business_roles r
  cross join lateral unnest(app.system_role_permissions('accountant')) as k
  where r.key = 'accountant' and r.is_system
  on conflict do nothing;
  get diagnostics v_granted = row_count;

  select count(*) into v_custom
    from public.business_roles
   where key = 'accountant' and not is_system;

  raise notice 'accountant: % permissions granted, % custom accountant role(s) left alone',
    v_granted, v_custom;

  /* AND THE THINGS IT MUST STILL NOT HAVE. Belt to the brace above: if any
     of these ever appears on a role we ship, the seeding is wrong and this
     stops rather than letting it through quietly. */
  if exists (
    select 1 from public.business_role_permissions p
    join public.business_roles r on r.id = p.role_id
    where r.key = 'accountant' and r.is_system
      and p.permission_key in ('orders.edit','del','update','canQC','canDispatch',
                               'team','team.view','editStaff','users','settings','audit',
                               'billing.view','billing.manage','ownership.transfer',
                               'setCatalog','setWorkflow','products','products.manage')
  ) then
    raise exception 'the accountant we ship has gained authority it must not have';
  end if;
end $do$;
