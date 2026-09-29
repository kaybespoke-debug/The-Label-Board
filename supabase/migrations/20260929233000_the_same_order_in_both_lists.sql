-- =====================================================================
-- P2 — when the same order is in both lists
-- =====================================================================
-- Found by running the reconciliation against production before promoting
-- anything, which is the entire reason it compares identifiers rather than
-- counts.
--
-- Studio a3b0c40c has 40 order entries and 28 identifiers. All twelve of its
-- "completed" orders are ALSO in its active list, and the copies are
-- byte-identical — 12 identical, 0 differing. The studio has 28 orders, not
-- 40, and is worth 4,477,300 rather than 5,173,300: the difference was the
-- same twelve orders counted twice.
--
-- HOW IT HAPPENS. _writeOrders() splits one array into two keys on every
-- save, active and finished, by asking orderIsSettled(). An entry in both
-- means a write landed in one key without the matching removal from the
-- other — a half-applied save, or two devices seeding the same studio. The
-- app does not notice because getOrders() reads only the active key; the
-- finished key is a secondary index, and a stale entry in it is invisible.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT.
--
-- An identifier appearing twice with IDENTICAL content is a bookkeeping
-- artefact. There is no question to answer and nothing to lose, so it is
-- deduplicated and the order is migrated once.
--
-- An identifier appearing twice with DIFFERENT content is two versions of
-- one order, and choosing between them is not a migration's decision to
-- make. That still refuses, loudly, and names the identifiers.
--
-- So `green` stops requiring "no duplicates" and starts requiring "no
-- CONFLICTING duplicates", and every total is computed over the
-- deduplicated set. Counting the source rows twice was the bug; refusing
-- to move a studio because of it would have been the wrong fix.
-- =====================================================================

create or replace function app.reconcile_orders(p_business uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$
with raw as (
  select e, e->>'id' as app_id,
         (s.key = 'layi_dash_orders_done') as from_done
  from public.app_state s, lateral jsonb_array_elements(s.data) e
  where s.business_id = p_business
    and s.key in ('layi_dash_orders','layi_dash_orders_done')
    and jsonb_typeof(s.data) = 'array'
    and coalesce(e->>'id','') <> ''
),
/* One row per identifier. FINISHED WINS: an order in both lists is one the
   studio has marked finished at some point, and that is also what the
   migration does, so the two cannot disagree about it. */
src as (
  select app_id,
         (array_agg(e order by from_done desc))[1] as e,
         bool_or(from_done) as is_done,
         count(*) as copies,
         count(distinct e) as versions
  from raw group by app_id
),
dst as (select o.* from public.orders o where o.business_id = p_business),
j as (
  select src.*, dst.id dst_id, dst.status dst_status, dst.branch_id dst_branch,
         dst.customer_id dst_cust, dst.assigned_to dst_assigned
  from src left join dst on dst.app_id = src.app_id
)
select jsonb_build_object(
  'business_id', p_business,
  'source_rows',        (select count(*) from raw),
  'source_orders',      (select count(*) from src),
  'destination_orders', (select count(*) from dst),
  'source_identifiers',      (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from src),
  'destination_identifiers', (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from dst where app_id is not null),
  'missing_identifiers',   (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from j where dst_id is null),
  'duplicate_identifiers', (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from src where copies > 1),
  'conflicting_identifiers', (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from src where versions > 1),
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
  'status_mismatches', (select count(*) from j where dst_id is not null
                          and dst_status is distinct from (case when is_done then 'done' else 'open' end)),
  'doc_still_carrying_a_secret', (select count(*) from dst o where
      o.doc ?| array['costs','cost','commissions','directorAmount','directorPct','directorOn',
                     'referralAmount','referrerId','email','whatsapp','address','phone']
      or coalesce(o.doc->'delivery'->>'location','') <> ''
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'saleItems')='array'
                 then o.doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitCost'))
) || jsonb_build_object('green', (
     (select count(*) from src) = (select count(*) from dst)
 and (select count(*) from j where dst_id is null) = 0
 /* CONFLICTING, not duplicate. Two identical copies of one order are a
    bookkeeping artefact; two DIFFERENT versions are a decision nobody has
    made yet, and a migration must not make it for them. */
 and (select count(*) from src where versions > 1) = 0
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
 and (select count(*) from j where dst_id is not null
        and dst_status is distinct from (case when is_done then 'done' else 'open' end)) = 0
 and (select count(*) from dst o where
      o.doc ?| array['costs','cost','commissions','directorAmount','directorPct','directorOn',
                     'referralAmount','referrerId','email','whatsapp','address','phone']
      or coalesce(o.doc->'delivery'->>'location','') <> ''
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'saleItems')='array'
                 then o.doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitCost')) = 0
));
$fn$;

-- ---------------------------------------------------------------------
-- And the migration walks the same deduplicated set
-- ---------------------------------------------------------------------
-- COPIED FROM 20260929231000 with the loop's source replaced and nothing
-- else touched. Previously it iterated the raw entries, so an order in both
-- lists was written twice and its status depended on which list the planner
-- reached last.
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
    with raw as (
      select e, e->>'id' as app_id, (s.key = 'layi_dash_orders_done') as from_done
      from public.app_state s, lateral jsonb_array_elements(s.data) e
      where s.business_id = p_business
        and s.key in ('layi_dash_orders','layi_dash_orders_done')
        and jsonb_typeof(s.data) = 'array'
        and coalesce(e->>'id','') <> ''
    )
    select (array_agg(e order by from_done desc))[1] as e,
           case when bool_or(from_done) then 'done' else 'open' end as st
    from raw group by app_id
  loop
    v_branch := null;
    if coalesce(r.e->>'branch','') <> '' then
      select b.id into v_branch from public.branches b
       where b.business_id = p_business
         and lower(btrim(b.name)) = lower(btrim(r.e->>'branch'))
       limit 1;
    end if;

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
    (app.reconcile_orders(p_business) ->> 'source_orders')::int,
    v_before,
    (select count(*)::int from public.orders o where o.business_id = p_business),
    (app.reconcile_orders(p_business) ->> 'source_money')::numeric,
    (select coalesce(sum(o.total),0) from public.orders o where o.business_id = p_business),
    v_costs,
    (app.reconcile_orders(p_business) ->> 'green')::boolean;
end $fn$;

comment on function app.reconcile_orders(uuid) is
  'Compares the blob with the rows identifier by identifier. An order in both '
  'the active and the finished list is counted once; two copies that DIFFER '
  'are a conflict and refuse the retirement, because choosing between two '
  'versions of an order is not a migration''s decision to make.';
