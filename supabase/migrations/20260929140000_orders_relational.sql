-- =====================================================================
-- BATCH E, part one — orders become rows, and the sensitive parts leave
--
-- WHY. seeCost and seeContact have been UI-only since they were written,
-- and the reason is mechanical: o.cost, o.email, o.phone and o.whatsapp
-- live inside layi_dash_orders, one blob per business, and anybody allowed
-- to open Orders must be able to fetch it. So the permission hid four
-- fields on a screen and hid nothing from a request. The same applies to
-- "only the orders assigned to you" and to branch scope: a blob has one
-- branch_id, which is none.
--
-- THE SMALLEST SHAPE THAT ACTUALLY ENFORCES IT. One row per order rather
-- than one row per business, with the order's own document in a jsonb
-- column and the three things that must be separately permitted pulled
-- out: cost into its own table, contact into public.customers, which is
-- relational already and which this app has been syncing since September.
--
-- The device keeps a single local array, exactly as today, and every one
-- of the thirty three readers and thirty six writers is untouched. What
-- changes is what the cloud holds and what the cloud will hand back: a
-- tailor's device receives rows for their branch, without costs, and
-- assembles the same array from them. The local copy can only contain what
-- the server was willing to send, which is the right model for an app that
-- has to work on a phone with no signal.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. orders: the skeleton that was there, given a body
-- ---------------------------------------------------------------------
-- public.orders has existed since the tenant-isolation work in August with
-- branch-scoped RLS and has never held a row, because the app writes blobs.
-- These columns are what it needs to hold one.
alter table public.orders
  add column if not exists app_id      text,
  add column if not exists doc         jsonb not null default '{}'::jsonb,
  add column if not exists assigned_to text,
  add column if not exists rev         bigint not null default 1,
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists updated_by  uuid;

alter table public.orders alter column ref drop not null;
alter table public.orders alter column total set default 0;
alter table public.orders alter column status set default 'open';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_app_id_per_business') then
    alter table public.orders add constraint orders_app_id_per_business unique (business_id, app_id);
  end if;
end $$;

create index if not exists orders_business_branch_idx on public.orders(business_id, branch_id);
create index if not exists orders_assigned_idx on public.orders(business_id, assigned_to);

/* rev is the whole of the conflict story and it is not the client's to
   set. Every update bumps it; a client that wants to change a row says
   which revision it read, and a stale write matches no row. */
create or replace function app.bump_order_rev()
returns trigger language plpgsql as $$
begin
  new.rev := coalesce(old.rev, 0) + 1;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end $$;

drop trigger if exists orders_rev on public.orders;
create trigger orders_rev before update on public.orders
  for each row execute function app.bump_order_rev();

-- ---------------------------------------------------------------------
-- 2. what an order costs, kept apart from what it sells for
-- ---------------------------------------------------------------------
create table if not exists public.order_costs (
  order_id     uuid primary key references public.orders(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid,
  cost         numeric not null default 0,
  detail       jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  constraint order_costs_branch_in_business
    foreign key (branch_id, business_id)
    references public.branches(id, business_id) on delete restrict
);
create index if not exists order_costs_business_idx on public.order_costs(business_id);

-- ---------------------------------------------------------------------
-- 3. the audit trail, which nobody can rewrite
-- ---------------------------------------------------------------------
-- layi_dash_audit is an app_state blob: readable and writable as one value,
-- so anybody who could read the history could replace it. An audit trail
-- that the person being audited can edit is a decoration.
--
-- INSERT is open to any member, because everybody's actions get recorded.
-- SELECT needs the audit permission. There is NO update policy and NO
-- delete policy, so those are refused for everyone, for ever, without a
-- rule anybody has to remember.
create table if not exists public.audit_log (
  id           bigserial primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid,
  at           timestamptz not null default now(),
  actor        uuid,
  actor_label  text,
  action       text not null,
  detail       text,
  entity       text,
  entity_id    text
);
create index if not exists audit_log_business_at_idx on public.audit_log(business_id, at desc);

/* The row records who did it, and the server decides who that was. A
   client that names somebody else is overruled rather than refused: the
   write is the important part. */
create or replace function app.stamp_audit_actor()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    new.actor := auth.uid();
  end if;
  new.at := coalesce(new.at, now());
  return new;
end $$;

drop trigger if exists audit_log_actor on public.audit_log;
create trigger audit_log_actor before insert on public.audit_log
  for each row execute function app.stamp_audit_actor();

-- ---------------------------------------------------------------------
-- 4. who may see and do what, per row
-- ---------------------------------------------------------------------
alter table public.order_costs enable row level security;
alter table public.order_costs force row level security;
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_costs to authenticated;
grant select, insert on public.audit_log to authenticated;
grant usage, select on sequence public.audit_log_id_seq to authenticated;

/* THE STAFF LINK. profiles.staff_id says which staff record this account
   is, and Phase 0 made it unwritable from a browser, so it is safe to read
   as a fact. It is what makes "only the orders assigned to you" a rule the
   database can apply rather than a filter the screen applies. */
create or replace function app.my_staff_id()
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select p.staff_id from public.profiles p where p.id = auth.uid();
$$;
grant execute on function app.my_staff_id() to authenticated, service_role;

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select using (
    app.can_here(business_id, 'orders', branch_id)
    and ( app.can(business_id, 'allOrders')
          or assigned_to is null
          or assigned_to = app.my_staff_id() )
  );

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert with check (app.can_here(business_id, 'orders.edit', branch_id));

/* USING guards the row you can see, WITH CHECK guards the row you leave
   behind. Both, because moving an order from a branch you may touch into
   one you may not is the case a single clause misses. */
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update using (app.can_here(business_id, 'orders.edit', branch_id))
  with check (app.can_here(business_id, 'orders.edit', branch_id));

drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders
  for delete using (app.can_here(business_id, 'del', branch_id));

drop policy if exists order_costs_select on public.order_costs;
create policy order_costs_select on public.order_costs
  for select using (app.can_here(business_id, 'seeCost', branch_id));

drop policy if exists order_costs_write on public.order_costs;
create policy order_costs_write on public.order_costs
  for insert with check (app.can_here(business_id, 'seeCost', branch_id));

drop policy if exists order_costs_update on public.order_costs;
create policy order_costs_update on public.order_costs
  for update using (app.can_here(business_id, 'seeCost', branch_id))
  with check (app.can_here(business_id, 'seeCost', branch_id));

drop policy if exists order_costs_delete on public.order_costs;
create policy order_costs_delete on public.order_costs
  for delete using (app.can_here(business_id, 'seeCost', branch_id));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert with check (app.in_scope(business_id, null));

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select using (app.can(business_id, 'audit'));

-- deliberately no update policy and no delete policy on audit_log

/* Contact details are already relational and already branch-scoped. What
   was missing is that reading them needs a permission of its own: a
   viewer may see that an order exists without seeing the client's phone
   number. */
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select using (app.can_here(business_id, 'seeContact', branch_id));

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert with check (app.can_here(business_id, 'customers.manage', branch_id));

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update using (app.can_here(business_id, 'customers.manage', branch_id))
  with check (app.can_here(business_id, 'customers.manage', branch_id));

drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers
  for delete using (app.can_here(business_id, 'customers.manage', branch_id));

comment on table public.order_costs is
  'What an order cost to make, kept in its own table so seeCost is a '
  'refusal rather than a hidden field. One row per order, same branch.';
comment on table public.audit_log is
  'Append-only. INSERT for any member, SELECT for the audit permission, and '
  'no update or delete policy at all, so history cannot be rewritten by the '
  'people it records.';

-- ---------------------------------------------------------------------
-- 5. Every studio gets the four system roles the moment it exists
-- ---------------------------------------------------------------------
-- CAUGHT BY rls_harness, and it was a product bug rather than a test one.
-- rbac_foundation seeded roles for every business that existed WHEN IT RAN.
-- A studio created afterwards got none, so its owner worked (the tier
-- short-circuits app.can) and everybody they invited held nothing at all.
-- With Batch B that meant no pages; with Batch E it means not seeing a
-- single order. A trigger rather than a line inside provision_studio,
-- because a studio can also be created by the console and by a migration.
create or replace function app.seed_business_roles()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into public.business_roles (business_id, key, name, tier, is_system)
  values (new.id, 'owner',   'Owner',   'owner',   true),
         (new.id, 'manager', 'Manager', 'manager', true),
         (new.id, 'staff',   'Staff',   'staff',   true),
         (new.id, 'viewer',  'Viewer',  'viewer',  true)
  on conflict (business_id, key) do nothing;

  insert into public.business_role_permissions (role_id, permission_key)
  select r.id, k
  from public.business_roles r
  cross join lateral unnest(app.default_permissions(r.tier)) as k
  where r.business_id = new.id and r.is_system
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists businesses_seed_roles on public.businesses;
create trigger businesses_seed_roles after insert on public.businesses
  for each row execute function app.seed_business_roles();

insert into public.business_roles (business_id, key, name, tier, is_system)
select b.id, r.key, r.name, r.key, true
from public.businesses b
cross join (values ('owner','Owner'),('manager','Manager'),('staff','Staff'),('viewer','Viewer')) as r(key,name)
on conflict (business_id, key) do nothing;

insert into public.business_role_permissions (role_id, permission_key)
select r.id, k from public.business_roles r
cross join lateral unnest(app.default_permissions(r.tier)) as k
where r.is_system
on conflict do nothing;

-- A membership written without a role gets the one for its tier. Same
-- reasoning: an invitation, the console and a migration all create these,
-- and a membership with no role can do nothing at all.
create or replace function app.default_membership_role()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.role_id is null then
    select r.id into new.role_id from public.business_roles r
    where r.business_id = new.business_id and r.key = new.role limit 1;
  end if;
  return new;
end $$;

drop trigger if exists memberships_default_role on public.memberships;
create trigger memberships_default_role before insert or update on public.memberships
  for each row execute function app.default_membership_role();

update public.memberships m
set role_id = (select r.id from public.business_roles r
               where r.business_id = m.business_id and r.key = m.role)
where m.role_id is null;
