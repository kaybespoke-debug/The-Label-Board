-- =====================================================================
-- P2 — moving the orders, and proving they arrived
-- =====================================================================
-- THE DEPLOYED MIGRATION COULD NOT BE USED, and finding out why is the reason
-- this file exists. app.migrate_orders_to_rows was written against a field
-- shape the data does not have. Computed against the 68 live orders without
-- running it:
--
--   reads e->>'total'   no order has a `total` field  -> writes 0 for all 68,
--                                                        losing 9,650,600
--   reads e->>'status'  no order has a `status` field -> all 68 become 'open',
--                                                        including the 12 done
--   reads e->>'cost'    no order has a `cost` field   -> zero cost rows
--   doc = e - 'cost' - 'email' - 'phone' - 'whatsapp'
--                       strips four names, three of which do not exist, so
--                       `costs` survives into doc on 68 of 68 orders
--   customer_id, assigned_to                          -> never set
--   returns matched = rows_after >= blob_orders       -> reports TRUE while
--                                                        doing all of the above
--
-- It is granted to authenticated and any owner can call it today. Nothing in
-- the app calls it, which is the only reason this is a hazard rather than an
-- incident. It is replaced below rather than deleted, so an old client that
-- somehow reaches it gets the correct behaviour instead of a missing function.
--
-- The real field names, for the next person: `value` not total, `costs` not
-- cost, `stageIndex` and which of the two keys it lives in rather than status.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. What the document may keep
-- ---------------------------------------------------------------------
-- The same subtraction as app.order_doc_carries_no_secrets, written once and
-- used by both, so the trigger and the migration cannot drift into disagreeing
-- about what a secret is.
create or replace function app.order_doc_without_secrets(p_order jsonb)
returns jsonb language plpgsql immutable
set search_path = public, pg_temp as $fn$
declare v_doc jsonb; v_items jsonb;
begin
  if jsonb_typeof(p_order) <> 'object' then return '{}'::jsonb; end if;
  v_doc := p_order - 'costs' - 'cost' - 'commissions'
                   - 'directorAmount' - 'directorPct' - 'directorOn'
                   - 'referralAmount' - 'referrerId'
                   - 'email' - 'whatsapp' - 'address' - 'phone';
  if jsonb_typeof(v_doc -> 'saleItems') = 'array' then
    select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'unitCost' else e end)
      into v_items from jsonb_array_elements(v_doc -> 'saleItems') e;
    v_doc := jsonb_set(v_doc, '{saleItems}', coalesce(v_items, '[]'::jsonb));
  end if;
  if jsonb_typeof(v_doc -> 'delivery') = 'object' then
    v_doc := jsonb_set(v_doc, '{delivery}', (v_doc -> 'delivery') - 'location');
  end if;
  return v_doc;
end $fn$;

-- The three sums, also written once, because the migration computes them and
-- the reconciliation checks them and they must mean the same thing.
create or replace function app.order_cost_total(p_order jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $fn$
  select coalesce((select sum(coalesce((c->>'amount')::numeric,0))
                   from jsonb_array_elements(case when jsonb_typeof(p_order->'costs')='array'
                        then p_order->'costs' else '[]'::jsonb end) c), 0);
$fn$;

create or replace function app.order_item_cost_total(p_order jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $fn$
  select coalesce((select sum(coalesce((i->>'unitCost')::numeric,0) * coalesce((i->>'qty')::numeric,1))
                   from jsonb_array_elements(case when jsonb_typeof(p_order->'saleItems')='array'
                        then p_order->'saleItems' else '[]'::jsonb end) i), 0);
$fn$;

create or replace function app.order_commission_total(p_order jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $fn$
  select coalesce((select sum(coalesce((c->>'amount')::numeric,0))
                   from jsonb_array_elements(case when jsonb_typeof(p_order->'commissions')='array'
                        then p_order->'commissions' else '[]'::jsonb end) c), 0)
       + coalesce((p_order->>'directorAmount')::numeric, 0)
       + coalesce((p_order->>'referralAmount')::numeric, 0);
$fn$;

revoke all on function app.order_doc_without_secrets(jsonb)  from public, anon, authenticated;
revoke all on function app.order_cost_total(jsonb)           from public, anon, authenticated;
revoke all on function app.order_item_cost_total(jsonb)      from public, anon, authenticated;
revoke all on function app.order_commission_total(jsonb)     from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. The migration
-- ---------------------------------------------------------------------
-- Idempotent by (business_id, app_id). Running it twice writes the same rows.
-- Running it after the blob changed updates them. It NEVER touches the blob:
-- retiring the source is a separate, later, explicitly approved step, and a
-- migration that deletes its own evidence cannot be checked afterwards.
create or replace function app.migrate_orders_to_rows(p_business uuid)
returns table(blob_orders integer, rows_before integer, rows_after integer,
              blob_total numeric, rows_total numeric, costs_written integer,
              matched boolean)
language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_before   int;
  v_costs    int := 0;
  r          record;
  v_id       uuid;
  v_branch   uuid;
  v_cust     uuid;
  v_cost     numeric;
  v_itemcost numeric;
  v_comm     numeric;
  v_contact  jsonb;
  v_name     text;
begin
  select count(*) into v_before from public.orders o where o.business_id = p_business;

  for r in
    select e,
           case when key = 'layi_dash_orders_done' then 'done' else 'open' end as st
    from public.app_state s,
         lateral jsonb_array_elements(s.data) e
    where s.business_id = p_business
      and s.key in ('layi_dash_orders','layi_dash_orders_done')
      and jsonb_typeof(s.data) = 'array'
  loop
    continue when coalesce(r.e->>'id','') = '';

    /* Branch by name. Every branch name on production resolves; one that does
       not leaves branch_id null, which is "the whole business" and is visible
       to more people rather than fewer, so the reconciliation counts it. */
    v_branch := null;
    if coalesce(r.e->>'branch','') <> '' then
      select b.id into v_branch from public.branches b
       where b.business_id = p_business
         and lower(btrim(b.name)) = lower(btrim(r.e->>'branch'))
       limit 1;
    end if;

    /* Client by name, CREATED IF ABSENT. 25 of the 68 live orders name a
       client with no customers row; linking only to existing ones would drop
       the relationship on more than a third of them. */
    v_cust := null;
    v_name := nullif(btrim(r.e->>'client'), '');
    if v_name is not null then
      select c.id into v_cust from public.customers c
       where c.business_id = p_business
         and lower(btrim(c.name)) = lower(v_name)
       limit 1;
      if v_cust is null then
        insert into public.customers (business_id, branch_id, name)
        values (p_business, v_branch, v_name)
        returning id into v_cust;
      end if;
    end if;

    insert into public.orders
      (business_id, branch_id, customer_id, app_id, ref, status, total,
       doc, assigned_to, created_at)
    values (
      p_business, v_branch, v_cust, r.e->>'id',
      nullif(r.e->>'invoiceNo',''),
      r.st,
      coalesce((r.e->>'value')::numeric, 0),
      app.order_doc_without_secrets(r.e),
      nullif(btrim(coalesce(r.e->>'makerId','')), ''),
      coalesce((r.e->>'createdAt')::timestamptz, now())
    )
    on conflict (business_id, app_id) do update
      set branch_id   = excluded.branch_id,
          customer_id = excluded.customer_id,
          ref         = excluded.ref,
          status      = excluded.status,
          total       = excluded.total,
          doc         = excluded.doc,
          assigned_to = excluded.assigned_to,
          created_at  = excluded.created_at
    returning id into v_id;

    -- ---- what it cost, behind seeCost ----------------------------------
    v_cost     := app.order_cost_total(r.e);
    v_itemcost := app.order_item_cost_total(r.e);
    if v_cost <> 0 or v_itemcost <> 0 then
      insert into public.order_costs (order_id, business_id, branch_id, cost, detail)
      values (v_id, p_business, v_branch, v_cost,
              jsonb_build_object(
                'lines', coalesce(r.e->'costs','[]'::jsonb),
                'item_costs', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'productId', i->>'productId', 'variantId', i->>'variantId',
                           'label', i->>'label', 'qty', i->'qty', 'unitCost', i->'unitCost'))
                  from jsonb_array_elements(case when jsonb_typeof(r.e->'saleItems')='array'
                       then r.e->'saleItems' else '[]'::jsonb end) i
                  where (i->>'unitCost') is not null), '[]'::jsonb),
                'item_cost_total', v_itemcost))
      on conflict (order_id) do update
        set cost = excluded.cost, detail = excluded.detail,
            branch_id = excluded.branch_id, updated_at = now();
      v_costs := v_costs + 1;
    else
      delete from public.order_costs where order_id = v_id;
    end if;

    -- ---- what people earned, also behind seeCost -----------------------
    v_comm := app.order_commission_total(r.e);
    if v_comm <> 0 or jsonb_array_length(coalesce(r.e->'commissions','[]'::jsonb)) > 0 then
      insert into public.order_commissions (order_id, business_id, branch_id, total, detail)
      values (v_id, p_business, v_branch, v_comm,
              jsonb_build_object(
                'lines', coalesce(r.e->'commissions','[]'::jsonb),
                'director', jsonb_build_object('on', r.e->'directorOn',
                              'pct', r.e->'directorPct', 'amount', r.e->'directorAmount'),
                'referral', jsonb_build_object('referrerId', r.e->>'referrerId',
                              'amount', r.e->'referralAmount')))
      on conflict (order_id) do update
        set total = excluded.total, detail = excluded.detail,
            branch_id = excluded.branch_id, updated_at = now();
    else
      delete from public.order_commissions where order_id = v_id;
    end if;

    -- ---- how to reach them, behind seeContact --------------------------
    v_contact := '{}'::jsonb;
    if coalesce(r.e->'delivery'->>'location','') <> '' then
      v_contact := v_contact || jsonb_build_object('delivery_location', r.e->'delivery'->>'location');
    end if;
    if coalesce(r.e->>'email','')    <> '' then v_contact := v_contact || jsonb_build_object('email',    r.e->>'email');    end if;
    if coalesce(r.e->>'whatsapp','') <> '' then v_contact := v_contact || jsonb_build_object('whatsapp', r.e->>'whatsapp'); end if;
    if coalesce(r.e->>'address','')  <> '' then v_contact := v_contact || jsonb_build_object('address',  r.e->>'address');  end if;

    if v_contact <> '{}'::jsonb then
      insert into public.order_contacts (order_id, business_id, branch_id, detail)
      values (v_id, p_business, v_branch, v_contact)
      on conflict (order_id) do update
        set detail = excluded.detail, branch_id = excluded.branch_id, updated_at = now();
    else
      delete from public.order_contacts where order_id = v_id;
    end if;
  end loop;

  return query
  select
    (select count(*)::int from public.app_state s, lateral jsonb_array_elements(s.data) x
      where s.business_id = p_business and s.key in ('layi_dash_orders','layi_dash_orders_done')
        and jsonb_typeof(s.data) = 'array' and coalesce(x->>'id','') <> ''),
    v_before,
    (select count(*)::int from public.orders o where o.business_id = p_business),
    (select coalesce(sum(coalesce((x->>'value')::numeric,0)),0)
       from public.app_state s, lateral jsonb_array_elements(s.data) x
      where s.business_id = p_business and s.key in ('layi_dash_orders','layi_dash_orders_done')
        and jsonb_typeof(s.data) = 'array' and coalesce(x->>'id','') <> ''),
    (select coalesce(sum(o.total),0) from public.orders o where o.business_id = p_business),
    v_costs,
    /* NOT >=. The old one used >= and would have called a migration that
       wrote the wrong rows a success. This asks the reconciliation. */
    (app.reconcile_orders(p_business) ->> 'green')::boolean;
end $fn$;

-- ---------------------------------------------------------------------
-- 3. The reconciliation
-- ---------------------------------------------------------------------
-- Identifier by identifier, not count against count. A count says 68 = 68
-- while every row holds the wrong money.
create or replace function app.reconcile_orders(p_business uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$
with src as (
  select e,
         e->>'id' as app_id,
         case when s.key = 'layi_dash_orders_done' then 'done' else 'open' end as st
  from public.app_state s, lateral jsonb_array_elements(s.data) e
  where s.business_id = p_business
    and s.key in ('layi_dash_orders','layi_dash_orders_done')
    and jsonb_typeof(s.data) = 'array'
    and coalesce(e->>'id','') <> ''
),
dst as (
  select o.* from public.orders o where o.business_id = p_business
),
j as (
  select src.*, dst.id dst_id, dst.total dst_total, dst.status dst_status,
         dst.branch_id dst_branch, dst.customer_id dst_cust, dst.assigned_to dst_assigned
  from src left join dst on dst.app_id = src.app_id
)
select jsonb_build_object(
  'business_id', p_business,
  'source_orders',      (select count(*) from src),
  'destination_orders', (select count(*) from dst),
  'source_identifiers',      (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from src),
  'destination_identifiers', (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from dst where app_id is not null),
  'missing_identifiers',   (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from j where dst_id is null),
  'duplicate_identifiers', (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb)
                              from (select app_id from src group by app_id having count(*) > 1) d),
  'extra_identifiers',     (select coalesce(jsonb_agg(o.app_id order by o.app_id),'[]'::jsonb)
                              from dst o where o.app_id is not null
                               and not exists (select 1 from src where src.app_id = o.app_id)),
  'source_money',      (select coalesce(sum(coalesce((e->>'value')::numeric,0)),0) from src),
  'destination_money', (select coalesce(sum(total),0) from dst),
  'source_cost',       (select coalesce(sum(app.order_cost_total(e)),0) from src),
  'destination_cost',  (select coalesce(sum(c.cost),0) from public.order_costs c where c.business_id = p_business),
  'source_item_cost',      (select coalesce(sum(app.order_item_cost_total(e)),0) from src),
  'destination_item_cost', (select coalesce(sum(coalesce((c.detail->>'item_cost_total')::numeric,0)),0)
                              from public.order_costs c where c.business_id = p_business),
  'source_commission',      (select coalesce(sum(app.order_commission_total(e)),0) from src),
  'destination_commission', (select coalesce(sum(k.total),0) from public.order_commissions k where k.business_id = p_business),
  'source_contacts',      (select count(*) from src where coalesce(e->'delivery'->>'location','') <> ''
                             or coalesce(e->>'email','') <> '' or coalesce(e->>'whatsapp','') <> ''
                             or coalesce(e->>'address','') <> ''),
  'destination_contacts', (select count(*) from public.order_contacts t where t.business_id = p_business),
  'branch_mismatches', (select count(*) from j where dst_id is not null and dst_branch is distinct from
                          (select b.id from public.branches b where b.business_id = p_business
                            and lower(btrim(b.name)) = lower(btrim(coalesce(j.e->>'branch',''))) limit 1)),
  'customer_mismatches', (select count(*) from j where dst_id is not null
                            and lower(btrim(coalesce((select c.name from public.customers c where c.id = j.dst_cust),'')))
                             is distinct from lower(btrim(coalesce(j.e->>'client','')))),
  'assignment_mismatches', (select count(*) from j where dst_id is not null
                              and coalesce(dst_assigned,'') is distinct from coalesce(nullif(btrim(coalesce(j.e->>'makerId','')),''),'')),
  'status_mismatches', (select count(*) from j where dst_id is not null and dst_status is distinct from st),
  'doc_still_carrying_a_secret', (select count(*) from dst o where
      o.doc ?| array['costs','cost','commissions','directorAmount','directorPct','directorOn',
                     'referralAmount','referrerId','email','whatsapp','address','phone']
      or coalesce(o.doc->'delivery'->>'location','') <> ''
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'saleItems')='array'
                 then o.doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitCost'))
) || jsonb_build_object('green', (
     (select count(*) from src) = (select count(*) from dst)
 and (select count(*) from j where dst_id is null) = 0
 and (select count(*) from (select app_id from src group by app_id having count(*) > 1) d) = 0
 and (select coalesce(sum(coalesce((e->>'value')::numeric,0)),0) from src)
   = (select coalesce(sum(total),0) from dst)
 and (select coalesce(sum(app.order_cost_total(e)),0) from src)
   = (select coalesce(sum(c.cost),0) from public.order_costs c where c.business_id = p_business)
 and (select coalesce(sum(app.order_commission_total(e)),0) from src)
   = (select coalesce(sum(k.total),0) from public.order_commissions k where k.business_id = p_business)
 and (select count(*) from src where coalesce(e->'delivery'->>'location','') <> ''
        or coalesce(e->>'email','') <> '' or coalesce(e->>'whatsapp','') <> ''
        or coalesce(e->>'address','') <> '')
   = (select count(*) from public.order_contacts t where t.business_id = p_business)
 and (select count(*) from j where dst_id is not null and dst_status is distinct from st) = 0
 and (select count(*) from dst o where
      o.doc ?| array['costs','cost','commissions','directorAmount','directorPct','directorOn',
                     'referralAmount','referrerId','email','whatsapp','address','phone']
      or coalesce(o.doc->'delivery'->>'location','') <> ''
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'saleItems')='array'
                 then o.doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitCost')) = 0
));
$fn$;

create or replace function public.reconcile_my_orders(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if not app.is_owner(p_business) then
    raise exception 'Only the studio owner can check the order migration'
      using errcode = '42501';
  end if;
  return app.reconcile_orders(p_business);
end $fn$;

revoke all on function app.reconcile_orders(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_my_orders(uuid) from public, anon;
grant execute on function public.reconcile_my_orders(uuid) to authenticated, service_role;

comment on function app.reconcile_orders(uuid) is
  'Compares the blob with the rows identifier by identifier, money, cost, '
  'commission and contact totals included, and checks that no secret survived '
  'into orders.doc. `green` is the only thing a retirement may be based on.';
