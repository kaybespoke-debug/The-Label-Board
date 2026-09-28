-- =====================================================================
-- BATCH B — the permission refuses the request, not the screen
--
-- Until now app_state had one rule for all twenty one keys: in_scope, any
-- active member, read and write alike. So "Finance is hidden from a tailor"
-- was a claim about a menu, and a viewer could delete every order in the
-- studio. Measured on 28 September: a viewer's POST to layi_dash_orders
-- returned 200.
--
-- The key is a column, so RLS can see it. That is the whole of the idea.
--
-- READ AND WRITE ARE DIFFERENT QUESTIONS and the same key needs both
-- answers. A viewer may read orders and may not write them; a manager may
-- read the team and may not write accounts. Where the two permissions were
-- the same key, a viewer would have been able to write everything they
-- could see, so three keys were added rather than pretending otherwise.
--
-- WHAT IS DELIBERATELY LEFT WIDE. layi_dash_settings stays readable by
-- every member: the currency, the production stages and the company name on
-- an invoice are needed to draw any screen at all, and a studio where a
-- tailor cannot see the stage names is a studio that does not work. Its
-- WRITES were already guarded field by field on 28 September. The roles key
-- is readable for the same reason and for one more: what a manager is
-- allowed to do is not a secret from the manager.
--
-- WHAT THIS DOES NOT REACH, still. Fields inside a blob the reader may
-- fetch: o.cost, o.email, o.phone, o.whatsapp live inside layi_dash_orders,
-- so seeCost and seeContact remain UI-only until those fields move to rows.
-- That is Batch E and it is in the programme, not deferred. The catalogue
-- marks every one of them ui_only so no screen can claim otherwise.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Four keys the vocabulary was missing
-- ---------------------------------------------------------------------
-- `tasks` is asked for by the app (can('tasks') gates the Tasks tab) and was
-- simply absent from the catalogue. The other three exist because a viewer
-- holding the read permission would otherwise hold the write permission too.
insert into public.permission_catalogue (key, label, grp, sort, tier_min, enforceable) values
  ('tasks',             'Tasks',                  'Pages',  95,  null, 'database'),
  ('orders.edit',       'Create & edit orders',   'Orders', 255, null, 'database'),
  ('products.manage',   'Add & edit shop items',  'Pages',  25,  null, 'database'),
  ('customers.manage',  'Add & edit clients',     'Clients',35,  null, 'database'),
  ('finance.record_payment','Record a payment',   'Money',  205, null, 'database')
on conflict (key) do update set label = excluded.label, grp = excluded.grp,
  sort = excluded.sort, enforceable = excluded.enforceable;

-- ---------------------------------------------------------------------
-- 2. Which permission each key needs
-- ---------------------------------------------------------------------
-- Immutable and total: a key nobody has mapped returns null, and null means
-- "membership is enough", which is exactly today's behaviour. Nothing gets
-- LESS protection than it had.
create or replace function app.perm_for_key(p_key text)
returns text language sql immutable as $$
  select case p_key
    when 'layi_dash_orders'      then 'orders'
    when 'layi_dash_orders_done' then 'orders'
    when 'layi_dash_txns'        then 'receivables'
    when 'layi_dash_bills'       then 'expenses'
    when 'layi_dash_pots'        then 'funds'
    when 'layi_dash_appts'       then 'appts'
    when 'layi_dash_planner'     then 'appts'
    when 'layi_dash_staff'       then 'team'
    when 'layi_dash_users'       then 'team'
    when 'layi_dash_anns'        then 'team'
    when 'layi_dash_leave'       then 'team'
    when 'layi_dash_shifts'      then 'team'
    when 'layi_dash_log'         then 'team'
    when 'layi_dash_attendance'  then 'attendance'
    when 'layi_dash_products'    then 'products'
    when 'layi_dash_supplies'    then 'supplies'
    when 'layi_dash_campaigns'   then 'marketing'
    when 'layi_dash_tasks'       then 'tasks'
    when 'layi_dash_audit'       then 'audit'
    else null            -- settings and roles: every member reads them
  end;
$$;

create or replace function app.write_perm_for_key(p_key text)
returns text language sql immutable as $$
  select case p_key
    when 'layi_dash_orders'      then 'orders.edit'
    when 'layi_dash_orders_done' then 'orders.edit'
    when 'layi_dash_txns'        then 'finance.record_payment'
    when 'layi_dash_bills'       then 'expenses'
    when 'layi_dash_pots'        then 'funds'
    when 'layi_dash_appts'       then 'appts'
    when 'layi_dash_planner'     then 'appts'
    when 'layi_dash_staff'       then 'editStaff'
    when 'layi_dash_users'       then 'users'
    /* NOT layi_dash_roles. Its guard is the Phase 0 trigger, which is
       owner-only and says so. A key-level rule here would match zero rows
       for a non-owner instead, and PostgREST answers a zero-row write with
       200 and no message — the B1 shape, and caught by the Phase 0 probe
       the moment Batch B shadowed it. */
    when 'layi_dash_anns'        then 'team'
    when 'layi_dash_leave'       then 'team'
    when 'layi_dash_shifts'      then 'team'
    when 'layi_dash_log'         then 'team'
    when 'layi_dash_attendance'  then 'attendance'
    when 'layi_dash_products'    then 'products.manage'
    when 'layi_dash_supplies'    then 'supplies'
    when 'layi_dash_campaigns'   then 'marketing'
    when 'layi_dash_tasks'       then 'tasks'
    when 'layi_dash_audit'       then 'audit'
    when 'layi_dash_settings'    then 'settings'
    else null
  end;
$$;

-- One question, asked the same way everywhere.
create or replace function app.may_read_key(p_business uuid, p_key text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select case
    when not app.in_scope(p_business, null) then false
    when app.perm_for_key(p_key) is null then true
    else app.can(p_business, app.perm_for_key(p_key))
  end;
$$;

create or replace function app.may_write_key(p_business uuid, p_key text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select case
    when not app.in_scope(p_business, null) then false
    when app.write_perm_for_key(p_key) is null then true
    else app.can(p_business, app.write_perm_for_key(p_key))
  end;
$$;

grant execute on function app.may_read_key(uuid, text) to authenticated, service_role;
grant execute on function app.may_write_key(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. The defaults gain the four new keys
-- ---------------------------------------------------------------------
create or replace function app.default_permissions(p_tier text)
returns text[] language sql immutable as $$
  select case p_tier
    when 'owner' then
      (select array_agg(key) from public.permission_catalogue where key <> 'ownTasksOnly')
    when 'manager' then array[
      'orders','orders.edit','products','products.manage','customers','customers.manage',
      'marketing','logistics','supplies','team','branchSwitch','attendance','tasks',
      'expenses','sales','audit','settings',
      'money','receivables','finance.record_payment','seeContact','allOrders','editStaff',
      'update','canQC','canDispatch','appts','del',
      'setCatalog','setWorkflow','team.view','billing.view']
    when 'staff' then array[
      'orders','orders.edit','products','customers','customers.manage','supplies',
      'team','attendance','tasks',
      'money','seeContact','allOrders','update','canQC','canDispatch','appts','team.view']
    when 'viewer' then array[
      'orders','products','customers','team','money','allOrders','team.view']
    else array[]::text[]
  end;
$$;

-- and every system role already seeded catches up
insert into public.business_role_permissions (role_id, permission_key)
select r.id, k
from public.business_roles r
cross join lateral unnest(app.default_permissions(r.tier)) as k
where r.is_system
on conflict do nothing;

/* A custom role imported from a studio's own blob had `orders` but no
   `orders.edit`, because the key did not exist when they made it. Somebody
   who could edit orders on Friday must still be able to on Monday. */
insert into public.business_role_permissions (role_id, permission_key)
select p.role_id, n.key
from public.business_role_permissions p
join public.business_roles r on r.id = p.role_id and not r.is_system
cross join lateral (values
  ('orders','orders.edit'), ('products','products.manage'),
  ('customers','customers.manage'), ('finance','finance.record_payment'),
  ('receivables','finance.record_payment')
) as n(had, key)
where p.permission_key = n.had
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. app_state, per key
-- ---------------------------------------------------------------------
drop policy if exists app_state_select on public.app_state;
create policy app_state_select on public.app_state
  for select using (app.may_read_key(business_id, key));

drop policy if exists app_state_insert on public.app_state;
create policy app_state_insert on public.app_state
  for insert with check (app.may_write_key(business_id, key));

drop policy if exists app_state_update on public.app_state;
create policy app_state_update on public.app_state
  for update using (app.may_write_key(business_id, key))
  with check (app.may_write_key(business_id, key));

drop policy if exists app_state_delete on public.app_state;
create policy app_state_delete on public.app_state
  for delete using (app.may_write_key(business_id, key));

-- ---------------------------------------------------------------------
-- 5. The five remaining is_business_admin policies
-- ---------------------------------------------------------------------
-- RBAC_DESIGN.md section 4. memberships was done in Batch A when the probe
-- caught a manager promoting themselves.
drop policy if exists branches_insert on public.branches;
create policy branches_insert on public.branches
  for insert with check (app.can(business_id, 'branches.manage'));

drop policy if exists branches_update on public.branches;
create policy branches_update on public.branches
  for update using (app.can(business_id, 'branches.manage'))
  with check (app.can(business_id, 'branches.manage'));

drop policy if exists branches_delete on public.branches;
create policy branches_delete on public.branches
  for delete using (app.can(business_id, 'branches.manage'));

/* A studio is created by provision_studio or the console, never by a signed
   in member. is_business_admin made this unreachable in practice already,
   because it is false for an id you are not yet in; saying so explicitly
   removes a class of question. */
drop policy if exists businesses_insert on public.businesses;
create policy businesses_insert on public.businesses
  for insert with check (false);

/* MORE PERMISSIVE AND MORE RESTRICTIVE AT ONCE, and both on purpose.
   The row opens to any member so the sign-in presence ping works for
   everybody, which under is_business_admin silently did nothing for staff
   and viewers. The two columns that are the studio's identity, name and
   contact_email, stay owner-only through guard_business_identity, where
   before a manager could change both. Column-level grants already keep
   plan, seats, branches, storage caps and trial dates away from a browser
   entirely. */
drop policy if exists businesses_update on public.businesses;
create policy businesses_update on public.businesses
  for update using (app.in_scope(id, null)) with check (app.in_scope(id, null));

comment on function app.perm_for_key(text) is
  'Which permission a given app_state key needs to be READ. Null means '
  'membership is enough, which is what settings and roles need: a studio '
  'where a tailor cannot read the stage names does not work.';
comment on function app.write_perm_for_key(text) is
  'Which permission a given app_state key needs to be WRITTEN. Different '
  'from the read permission wherever a viewer holds the read one, because a '
  'viewer who can write everything they can see is not a viewer.';
