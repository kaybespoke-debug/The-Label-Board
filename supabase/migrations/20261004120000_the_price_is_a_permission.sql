-- =====================================================================
-- THE PRICE IS A PERMISSION
-- =====================================================================
-- P2 took the things that leave the studio out of the order document —
-- costs, commissions, contact details — and put each behind the permission
-- that was supposed to govern it. It left the things the client pays
-- exactly where they were.
--
-- Measured on production, 4 October 2026, across 56 orders:
--
--   doc.value                 56 orders   the selling price
--   doc.discount              56 orders   (2 non-zero)
--   doc.outfits[].price       66 lines
--   doc.saleItems[].unitPrice 24 lines
--   doc.delivery.fee          35 orders
--   orders.total              56 rows     a second copy of the price, in a
--                                         plain readable column
--   doc.paid                  56 orders   (54 non-zero)   what has been paid
--   doc.potContribs[].amount  44 lines                    and what towards
--
-- Every one of those is readable by anybody who can open Orders. The role
-- model has said otherwise for months: `headprod` has `orders` and not
-- `money`, `staff` has `money` and not `receivables`. So the gap was never
-- a product question — it was the distance between what the roles say and
-- what the database does, and `money` and `receivables` were both marked
-- `ui_only` in the catalogue, which is the honest record of that.
--
-- There was a third copy nobody was using: public.order_summary, a
-- security_invoker view granted to authenticated, selecting o.total. No
-- file in this repository reads it. Protecting one copy and leaving another
-- is not protecting anything, so it goes.
--
-- WHAT EACH PERMISSION NOW MEANS, IN THE DATA
--
--   money        what the studio charges:  value, discount, the per-outfit
--                and per-item prices, the delivery fee
--   receivables  what has arrived and what is outstanding:  paid, the pot
--                contributions, and (already) the transactions ledger
--   seeCost      what it cost the studio:  order_costs, and commissions
--   seeProfit    margin — which nobody can compute without BOTH of the
--                above two, so it is protected by its inputs rather than by
--                a field of its own. There is no stored margin to gate.
--
-- The balance on an order is value - discount - paid. It needs `money` AND
-- `receivables`, and that falls out of the shape rather than being enforced
-- anywhere: a person with only `receivables` gets what was paid and cannot
-- derive what is left, which is the truthful answer.
--
-- THE SHAPE IS THE ONE THAT IS ALREADY HERE. Two more satellites of
-- public.orders, the same one-row-per-order, one-headline-number,
-- one-detail-document shape as order_costs, order_commissions and
-- order_contacts, so there is still one pattern to understand. Nothing
-- about the order architecture changes.

-- ---------------------------------------------------------------------
-- 1. Two more satellites
-- ---------------------------------------------------------------------
create table if not exists public.order_pricing (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  value       numeric not null default 0,
  discount    numeric not null default 0,
  detail      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists order_pricing_business_idx on public.order_pricing(business_id);

create table if not exists public.order_settlement (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete set null,
  paid        numeric not null default 0,
  detail      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists order_settlement_business_idx on public.order_settlement(business_id);

comment on table public.order_pricing is
  'What the studio charges for an order: the value, the discount and the '
  'per-line prices. Behind `money`, which is what the role model has said '
  'all along. The price used to live in orders.doc and in orders.total, '
  'both readable by anybody who could open Orders.';
comment on table public.order_settlement is
  'What has been paid against an order, and towards which pot. Behind '
  '`receivables` to read and `finance.record_payment` to change — the same '
  'pair that already governs the transactions ledger, so the order''s paid '
  'figure and the payments that produced it cannot disagree about who may '
  'touch them.';

alter table public.order_pricing    enable row level security;
alter table public.order_settlement enable row level security;
alter table public.order_pricing    force row level security;
alter table public.order_settlement force row level security;

/* Supabase grants all on new public tables in `public` to anon and
   authenticated by default, and `revoke from public` does not undo an
   explicit grant. So: revoke, then grant deliberately. */
revoke all on public.order_pricing    from anon, authenticated;
revoke all on public.order_settlement from anon, authenticated;
grant select, insert, update, delete on public.order_pricing    to authenticated;
grant select, insert, update, delete on public.order_settlement to authenticated;

-- ---------------------------------------------------------------------
-- 2. The policies
-- ---------------------------------------------------------------------
drop policy if exists order_pricing_select on public.order_pricing;
create policy order_pricing_select on public.order_pricing
  for select to authenticated using (app.can_here(business_id, 'money', branch_id));

/* SETTING a price is editing the order, so it takes both: seeing what the
   studio charges, and being allowed to change an order at all. order_costs
   uses one permission for both directions because a cost line has no
   meaning apart from the cost; a price does — it is the order. */
drop policy if exists order_pricing_write on public.order_pricing;
create policy order_pricing_write on public.order_pricing
  for insert to authenticated with check (app.can_here(business_id, 'money', branch_id)
                     and app.can_here(business_id, 'orders.edit', branch_id));

drop policy if exists order_pricing_update on public.order_pricing;
create policy order_pricing_update on public.order_pricing
  for update to authenticated using (app.can_here(business_id, 'money', branch_id)
                and app.can_here(business_id, 'orders.edit', branch_id))
  with check (app.can_here(business_id, 'money', branch_id)
          and app.can_here(business_id, 'orders.edit', branch_id));

drop policy if exists order_pricing_delete on public.order_pricing;
create policy order_pricing_delete on public.order_pricing
  for delete to authenticated using (app.can_here(business_id, 'money', branch_id)
                and app.can_here(business_id, 'orders.edit', branch_id));

drop policy if exists order_settlement_select on public.order_settlement;
create policy order_settlement_select on public.order_settlement
  for select to authenticated using (app.can_here(business_id, 'receivables', branch_id));

/* Reading what is owed and deciding that something has been paid are two
   different jobs, and app.write_perm_for_key already says so for the
   payments ledger: layi_dash_txns reads with `receivables` and writes with
   `finance.record_payment`. The order's paid figure is the same money. */
drop policy if exists order_settlement_write on public.order_settlement;
create policy order_settlement_write on public.order_settlement
  for insert to authenticated with check (app.can_here(business_id, 'finance.record_payment', branch_id));

drop policy if exists order_settlement_update on public.order_settlement;
create policy order_settlement_update on public.order_settlement
  for update to authenticated using (app.can_here(business_id, 'finance.record_payment', branch_id))
  with check (app.can_here(business_id, 'finance.record_payment', branch_id));

drop policy if exists order_settlement_delete on public.order_settlement;
create policy order_settlement_delete on public.order_settlement
  for delete to authenticated using (app.can_here(business_id, 'finance.record_payment', branch_id));

-- ---------------------------------------------------------------------
-- 3. Pulling the money out of a document
-- ---------------------------------------------------------------------
-- Written once and used three times: by the backfill below, by the
-- blob migration for a studio that has not moved yet, and by the
-- reconciliation that has to agree with both.
create or replace function app.order_pricing_detail(p_order jsonb)
returns jsonb language sql immutable
set search_path = public, pg_temp as $fn$
  select jsonb_strip_nulls(jsonb_build_object(
    'outfit_prices', coalesce((
      select jsonb_agg(jsonb_build_object('name', o->>'name', 'price', o->'price')
             order by n)
      from jsonb_array_elements(case when jsonb_typeof(p_order->'outfits')='array'
           then p_order->'outfits' else '[]'::jsonb end) with ordinality as t(o, n)
      where o ? 'price'), '[]'::jsonb),
    'item_prices', coalesce((
      select jsonb_agg(jsonb_build_object('productId', i->>'productId',
               'variantId', i->>'variantId', 'label', i->>'label',
               'qty', i->'qty', 'unitPrice', i->'unitPrice') order by n)
      from jsonb_array_elements(case when jsonb_typeof(p_order->'saleItems')='array'
           then p_order->'saleItems' else '[]'::jsonb end) with ordinality as t(i, n)
      where i ? 'unitPrice'), '[]'::jsonb),
    'delivery_fee', case when jsonb_typeof(p_order->'delivery')='object'
                           and (p_order->'delivery') ? 'fee'
                         then p_order->'delivery'->'fee' else null end));
$fn$;

create or replace function app.order_settlement_detail(p_order jsonb)
returns jsonb language sql immutable
set search_path = public, pg_temp as $fn$
  select jsonb_build_object('pot_contribs',
    coalesce(case when jsonb_typeof(p_order->'potContribs')='array'
                  then p_order->'potContribs' else '[]'::jsonb end, '[]'::jsonb));
$fn$;

/* THE ONE QUESTION THIS MIGRATION HAS TO GET RIGHT. A document with no
   money in it at all must not produce a pricing row worth nothing, because
   a row worth nothing is indistinguishable from an order that is free, and
   the whole point of the satellites is that an ABSENT row means "not for
   you" while a zero means "nothing". */
create or replace function app.order_has_pricing(p_order jsonb)
returns boolean language sql immutable
set search_path = public, pg_temp as $fn$
  select p_order ? 'value' or p_order ? 'discount'
      or app.order_pricing_detail(p_order) <> jsonb_build_object(
           'outfit_prices', '[]'::jsonb, 'item_prices', '[]'::jsonb);
$fn$;

create or replace function app.order_has_settlement(p_order jsonb)
returns boolean language sql immutable
set search_path = public, pg_temp as $fn$
  select p_order ? 'paid'
      or jsonb_array_length(case when jsonb_typeof(p_order->'potContribs')='array'
                                 then p_order->'potContribs' else '[]'::jsonb end) > 0;
$fn$;

revoke all on function app.order_pricing_detail(jsonb)    from public, anon, authenticated;
revoke all on function app.order_settlement_detail(jsonb) from public, anon, authenticated;
revoke all on function app.order_has_pricing(jsonb)       from public, anon, authenticated;
revoke all on function app.order_has_settlement(jsonb)    from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. The door, widened
-- ---------------------------------------------------------------------
-- COPIED FROM 20260929230000 with the money keys added and nothing else
-- changed. Every client writes through this, for ever, so a stale build
-- that still sends the price in the document cannot put it back.
create or replace function app.order_doc_carries_no_secrets()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $fn$
declare
  v_items jsonb;
begin
  if jsonb_typeof(new.doc) <> 'object' then
    return new;
  end if;

  /* Money that leaves the studio, and the people it goes to. */
  new.doc := new.doc - 'costs' - 'cost' - 'commissions'
                     - 'directorAmount' - 'directorPct' - 'directorOn'
                     - 'referralAmount' - 'referrerId';

  /* How to reach the client. `phone` has never appeared in the live data and
     is listed because the app's own writers still name it. */
  new.doc := new.doc - 'email' - 'whatsapp' - 'address' - 'phone';

  /* What the client pays, and what they have paid. Added October 2026: these
     were the last money fields still in the document, and the role model had
     said for months that they were a permission question. */
  new.doc := new.doc - 'value' - 'discount' - 'paid' - 'potContribs';

  /* A cost hiding one level down, inside each sold item, and now the price
     beside it. This is the one the original finding missed: 36 of the
     production items carry the cost. */
  if jsonb_typeof(new.doc -> 'saleItems') = 'array' then
    select jsonb_agg(case when jsonb_typeof(e) = 'object'
                          then e - 'unitCost' - 'unitPrice' else e end)
      into v_items
      from jsonb_array_elements(new.doc -> 'saleItems') e;
    new.doc := jsonb_set(new.doc, '{saleItems}', coalesce(v_items, '[]'::jsonb));
  end if;

  /* And a price one level down inside each outfit. */
  if jsonb_typeof(new.doc -> 'outfits') = 'array' then
    select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'price' else e end)
      into v_items
      from jsonb_array_elements(new.doc -> 'outfits') e;
    new.doc := jsonb_set(new.doc, '{outfits}', coalesce(v_items, '[]'::jsonb));
  end if;

  /* And an address hiding one level down, inside the delivery block, and now
     the fee as well. The courier, the tracking number and whether it is
     switched on are ordinary order information and stay. */
  if jsonb_typeof(new.doc -> 'delivery') = 'object' then
    new.doc := jsonb_set(new.doc, '{delivery}',
                         (new.doc -> 'delivery') - 'location' - 'fee');
  end if;

  /* NOT STRIPPED, on purpose: outfits[].meas and .person. Measurements are
     already member-readable — public.customers.measurements is gated by the
     `customers` permission and nothing stricter — so pulling them out of doc
     would claim a boundary the rest of the app does not keep. Holding the
     existing line is honest; inventing a new one here and nowhere else is
     not. Recorded so the next person does not think it was missed. */

  return new;
end $fn$;

revoke all on function app.order_doc_carries_no_secrets() from public, anon, authenticated;

-- and the same list, for the migration path
create or replace function app.order_doc_without_secrets(p_order jsonb)
returns jsonb language plpgsql immutable
set search_path = public, pg_temp as $fn$
declare v_doc jsonb; v_items jsonb;
begin
  if jsonb_typeof(p_order) <> 'object' then return '{}'::jsonb; end if;
  v_doc := p_order - 'costs' - 'cost' - 'commissions'
                   - 'directorAmount' - 'directorPct' - 'directorOn'
                   - 'referralAmount' - 'referrerId'
                   - 'email' - 'whatsapp' - 'address' - 'phone'
                   - 'value' - 'discount' - 'paid' - 'potContribs';
  if jsonb_typeof(v_doc -> 'saleItems') = 'array' then
    select jsonb_agg(case when jsonb_typeof(e) = 'object'
                          then e - 'unitCost' - 'unitPrice' else e end)
      into v_items from jsonb_array_elements(v_doc -> 'saleItems') e;
    v_doc := jsonb_set(v_doc, '{saleItems}', coalesce(v_items, '[]'::jsonb));
  end if;
  if jsonb_typeof(v_doc -> 'outfits') = 'array' then
    select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'price' else e end)
      into v_items from jsonb_array_elements(v_doc -> 'outfits') e;
    v_doc := jsonb_set(v_doc, '{outfits}', coalesce(v_items, '[]'::jsonb));
  end if;
  if jsonb_typeof(v_doc -> 'delivery') = 'object' then
    v_doc := jsonb_set(v_doc, '{delivery}', (v_doc -> 'delivery') - 'location' - 'fee');
  end if;
  return v_doc;
end $fn$;

revoke all on function app.order_doc_without_secrets(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. The orders that are already rows
-- ---------------------------------------------------------------------
-- The copy happens first and is RECONCILED BEFORE ANYTHING IS REMOVED,
-- order by order, the same discipline the P2 promotion used. A document
-- cannot be stripped on the strength of a count.
do $do$
declare
  v_orders  int;
  v_priced  int;
  v_settled int;
  v_bad     text := '';
  r         record;
begin
  select count(*) into v_orders from public.orders;
  if v_orders = 0 then
    raise notice 'no orders are rows yet; nothing to move';
    return;
  end if;

  /* TWO NUMBERS FOR ONE PRICE IS NOT A MIGRATION'S DECISION.
       doc.value is the app's field and orders.total was written from it, so
       they agree on every production order — checked, 4 October 2026: 56
       orders, both sides ₦8,954,600, not one disagreement, and no order
       carrying a doc.total at all. If they ever DO disagree, one of them is
       wrong and choosing between them is a question for a person, so this
       stops with the orders named rather than picking the larger, the
       smaller or the one that happens to be first.

       Staging had two: fixture rows written by the e2e-fixture function,
       which put the price in doc.total and left doc.value at zero. This
       caught them, which is the point. */
  for r in
    select o.app_id, o.id, b.name as biz,
           (o.doc->>'value')::numeric as doc_value,
           (to_jsonb(o)->>'total')::numeric as col_total
    from public.orders o join public.businesses b on b.id = o.business_id
    where o.doc ? 'value'
      and coalesce((o.doc->>'value')::numeric, 0)
          is distinct from coalesce((to_jsonb(o)->>'total')::numeric, 0)
  loop
    v_bad := v_bad || chr(10) || '    ' || r.biz || ' ' || coalesce(r.app_id, r.id::text)
          || ': doc.value=' || coalesce(r.doc_value::text,'-')
          || ' but orders.total=' || coalesce(r.col_total::text,'-');
  end loop;
  if v_bad <> '' then
    raise exception 'two different prices for the same order, and nothing here may choose between them:%', v_bad;
  end if;

  insert into public.order_pricing (order_id, business_id, branch_id, value, discount, detail) -- BACKFILL
  select o.id, o.business_id, o.branch_id,
         /* to_jsonb rather than o.total, so this reads the same whether the
            column is still here or already gone. The backup harness applies
            this migration a second time to a database that HAS orders in
            it, which is the only way it proves a restore from an automatic
            copy, and `o.total` would stop it dead. */
         coalesce((o.doc->>'value')::numeric, (to_jsonb(o)->>'total')::numeric, 0),
         coalesce((o.doc->>'discount')::numeric, 0),
         app.order_pricing_detail(o.doc)
  from public.orders o
  where app.order_has_pricing(o.doc) or coalesce((to_jsonb(o)->>'total')::numeric, 0) <> 0
  on conflict (order_id) do update
    set value = excluded.value, discount = excluded.discount,
        detail = excluded.detail, branch_id = excluded.branch_id, updated_at = now();

  insert into public.order_settlement (order_id, business_id, branch_id, paid, detail)
  select o.id, o.business_id, o.branch_id,
         coalesce((o.doc->>'paid')::numeric, 0),
         app.order_settlement_detail(o.doc)
  from public.orders o
  where app.order_has_settlement(o.doc)
  on conflict (order_id) do update
    set paid = excluded.paid, detail = excluded.detail,
        branch_id = excluded.branch_id, updated_at = now();

  /* IDENTIFIER BY IDENTIFIER. Not "the totals agree" — every order whose
     document carried a price must have a pricing row carrying the same
     number, and the same for what was paid. Anything else stops the
     migration with the orders named. */
  for r in
    select o.app_id, o.id,
           (o.doc->>'value')::numeric  as doc_value,
           (o.doc->>'paid')::numeric   as doc_paid,
           (to_jsonb(o)->>'total')::numeric as col_total,
           p.value as row_value, s.paid as row_paid
    from public.orders o
    left join public.order_pricing    p on p.order_id = o.id
    left join public.order_settlement s on s.order_id = o.id
    where (o.doc ? 'value' and coalesce(p.value, -1) is distinct from coalesce((o.doc->>'value')::numeric, 0))
       or (o.doc ? 'paid'  and coalesce(s.paid,  -1) is distinct from coalesce((o.doc->>'paid')::numeric, 0))
       or (coalesce((to_jsonb(o)->>'total')::numeric,0) <> 0
           and coalesce(p.value,-1) is distinct from coalesce((o.doc->>'value')::numeric, (to_jsonb(o)->>'total')::numeric, 0))
  loop
    v_bad := v_bad || chr(10) || '    ' || coalesce(r.app_id, r.id::text)
          || ' doc.value=' || coalesce(r.doc_value::text,'-')
          || ' total=' || coalesce(r.col_total::text,'-')
          || ' row=' || coalesce(r.row_value::text,'(none)')
          || ' | doc.paid=' || coalesce(r.doc_paid::text,'-')
          || ' row=' || coalesce(r.row_paid::text,'(none)');
  end loop;
  if v_bad <> '' then
    raise exception 'the money did not come across for these orders:%', v_bad;
  end if;

  select count(*) into v_priced  from public.order_pricing;
  select count(*) into v_settled from public.order_settlement;
  raise notice 'money moved into rows: % orders, % priced, % settled',
    v_orders, v_priced, v_settled;

  /* ONLY NOW, AND WITHOUT TOUCHING THE REVISION.
       The obvious way to write this is `set doc = doc`, letting the
       before-update trigger do the stripping, so there is one copy of the
       list. Two triggers on public.orders make that the wrong shape:

       orders_rev bumps rev on every update, and rev is the concurrency
       control every installed phone holds. Bumping all of them at once
       means a conflict dialog on the next edit of every order in the
       studio, for a cleanup nobody asked about.

       orders_unpaid_guard REFUSES writes for a studio that is behind on
       its subscription. A migration that cannot clean up the orders of a
       studio in arrears is a migration that leaves the price readable
       exactly where the money is already difficult.

       So the user triggers come off for the length of the cleanup and the
       stripping is applied by name. app.order_doc_without_secrets and
       app.order_doc_carries_no_secrets hold the SAME LIST on purpose, and
       both say so: if one changes the other must. */
  alter table public.orders disable trigger user;
  update public.orders set doc = app.order_doc_without_secrets(doc)
   where doc ?| array['value','discount','paid','potContribs']
      or (doc->'delivery') ? 'fee'
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(doc->'outfits')='array'
                 then doc->'outfits' else '[]'::jsonb end) f where f ? 'price')
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(doc->'saleItems')='array'
                 then doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitPrice');
  alter table public.orders enable trigger user;

  /* and nothing was left behind */
  select count(*) into v_orders from public.orders o
   where o.doc ?| array['value','discount','paid','potContribs']
      or (o.doc->'delivery') ? 'fee'
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'outfits')='array'
                 then o.doc->'outfits' else '[]'::jsonb end) f where f ? 'price')
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'saleItems')='array'
                 then o.doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitPrice');
  if v_orders <> 0 then
    raise exception '% order documents still carry money after the cleanup', v_orders;
  end if;
end $do$;

-- ---------------------------------------------------------------------
-- 6. The column that was the second copy
-- ---------------------------------------------------------------------
-- orders.total held the selling price in a plain column that every member
-- with `orders` could read, and public.order_summary published it again to
-- anybody at all with a login. The price now has one home.
drop view if exists public.order_summary;

alter table public.orders drop column if exists total;

-- order_items has a `price` column and a SELECT policy of app.in_scope —
-- any member of the studio. It holds ZERO rows on production and nothing in
-- the shipped app writes it, which is why it was never found before. It is
-- an order's price either way, so it answers to the same permission.
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select to authenticated using (app.can(business_id, 'money'));

drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items
  for insert to authenticated with check (app.can(business_id, 'money')
                     and app.can(business_id, 'orders.edit'));

drop policy if exists order_items_update on public.order_items;
create policy order_items_update on public.order_items
  for update to authenticated using (app.can(business_id, 'money')
                and app.can(business_id, 'orders.edit'))
  with check (app.can(business_id, 'money')
          and app.can(business_id, 'orders.edit'));

drop policy if exists order_items_delete on public.order_items;
create policy order_items_delete on public.order_items
  for delete to authenticated using (app.can(business_id, 'money')
                and app.can(business_id, 'del'));

-- ---------------------------------------------------------------------
-- 7. The catalogue stops saying these are decorations
-- ---------------------------------------------------------------------
-- `enforceable` is the repository's own record of which permissions the
-- database keeps and which only hide a button. Two of them move today.
update public.permission_catalogue set enforceable = 'database'
 where key in ('money', 'receivables');

comment on column public.permission_catalogue.enforceable is
  'database = the server refuses it; ui_only = the app hides it and an '
  'ordinary HTTP request would not be refused. money and receivables became '
  'database-enforced in October 2026 when the price and the paid figure '
  'moved out of orders.doc. seeProfit stays ui_only and is honest about it: '
  'margin is not stored, so it cannot be refused — it is protected by '
  'needing both money (order_pricing) and seeCost (order_costs) to compute.';

-- ---------------------------------------------------------------------
-- 8. A studio that has NOT moved yet
-- ---------------------------------------------------------------------
-- COPIED FROM 20260929233000, with orders.total gone and the two new
-- satellites written beside the three that were already there. Nothing else
-- about it is touched. A studio still on the blob must come across with its
-- prices, or this release would be the one that loses them.
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
      (business_id, branch_id, customer_id, app_id, ref, status,
       doc, assigned_to, created_at)
    values (
      p_business, v_branch, v_cust, r.e->>'id',
      nullif(r.e->>'invoiceNo',''),
      r.st,
      app.order_doc_without_secrets(r.e),
      nullif(btrim(coalesce(r.e->>'makerId','')), ''),
      coalesce((r.e->>'createdAt')::timestamptz, now())
    )
    on conflict (business_id, app_id) do update
      set branch_id   = excluded.branch_id,
          customer_id = excluded.customer_id,
          ref         = excluded.ref,
          status      = excluded.status,
          doc         = excluded.doc,
          assigned_to = excluded.assigned_to,
          created_at  = excluded.created_at
    returning id into v_id;

    if app.order_has_pricing(r.e) then
      insert into public.order_pricing (order_id, business_id, branch_id, value, discount, detail)
      values (v_id, p_business, v_branch,
              coalesce((r.e->>'value')::numeric, 0),
              coalesce((r.e->>'discount')::numeric, 0),
              app.order_pricing_detail(r.e))
      on conflict (order_id) do update
        set value = excluded.value, discount = excluded.discount,
            detail = excluded.detail, branch_id = excluded.branch_id, updated_at = now();
    else
      delete from public.order_pricing where order_id = v_id;
    end if;

    if app.order_has_settlement(r.e) then
      insert into public.order_settlement (order_id, business_id, branch_id, paid, detail)
      values (v_id, p_business, v_branch,
              coalesce((r.e->>'paid')::numeric, 0),
              app.order_settlement_detail(r.e))
      on conflict (order_id) do update
        set paid = excluded.paid, detail = excluded.detail,
            branch_id = excluded.branch_id, updated_at = now();
    else
      delete from public.order_settlement where order_id = v_id;
    end if;

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
    (select coalesce(sum(p.value),0) from public.order_pricing p where p.business_id = p_business),
    v_costs,
    (app.reconcile_orders(p_business) ->> 'green')::boolean;
end $fn$;

-- ---------------------------------------------------------------------
-- 9. and the reconciliation that has to agree with it
-- ---------------------------------------------------------------------
-- COPIED FROM 20260929233000. Three changes and no others: the money comes
-- from order_pricing rather than orders.total; what was paid is checked as
-- well, which it never was; and the list of keys a document must no longer
-- carry gains the four money ones.
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
  'destination_money', (select coalesce(sum(p.value),0) from public.order_pricing p where p.business_id = p_business),
  'source_paid',       (select coalesce(sum(coalesce((e->>'paid')::numeric,0)),0) from src),
  'destination_paid',  (select coalesce(sum(s.paid),0) from public.order_settlement s where s.business_id = p_business),
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
                     'referralAmount','referrerId','email','whatsapp','address','phone',
                     'value','discount','paid','potContribs']
      or coalesce(o.doc->'delivery'->>'location','') <> ''
      or (o.doc->'delivery') ? 'fee'
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'saleItems')='array'
                 then o.doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitCost' or i ? 'unitPrice')
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'outfits')='array'
                 then o.doc->'outfits' else '[]'::jsonb end) f where f ? 'price'))
) || jsonb_build_object('green', (
     (select count(*) from src) = (select count(*) from dst)
 and (select count(*) from j where dst_id is null) = 0
 /* CONFLICTING, not duplicate. Two identical copies of one order are a
    bookkeeping artefact; two DIFFERENT versions are a decision nobody has
    made yet, and a migration must not make it for them. */
 and (select count(*) from src where versions > 1) = 0
 and (select coalesce(sum(coalesce((e->>'value')::numeric,0)),0) from src)
   = (select coalesce(sum(p.value),0) from public.order_pricing p where p.business_id = p_business)
 and (select coalesce(sum(coalesce((e->>'paid')::numeric,0)),0) from src)
   = (select coalesce(sum(s.paid),0) from public.order_settlement s where s.business_id = p_business)
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
                     'referralAmount','referrerId','email','whatsapp','address','phone',
                     'value','discount','paid','potContribs']
      or coalesce(o.doc->'delivery'->>'location','') <> ''
      or (o.doc->'delivery') ? 'fee'
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'saleItems')='array'
                 then o.doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitCost' or i ? 'unitPrice')
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.doc->'outfits')='array'
                 then o.doc->'outfits' else '[]'::jsonb end) f where f ? 'price')) = 0
));
$fn$;

comment on function app.reconcile_orders(uuid) is
  'Compares the blob with the rows identifier by identifier. An order in both '
  'the active and the finished list is counted once; two copies that DIFFER '
  'are a conflict and refuse the retirement, because choosing between two '
  'versions of an order is not a migration''s decision to make. Since October '
  '2026 the money it compares is order_pricing.value and order_settlement.paid, '
  'because orders.total is gone.';

-- ---------------------------------------------------------------------
-- 10. A backup carries the whole studio, and that now means these two
-- ---------------------------------------------------------------------
-- app.export_studio_raw IS the backup format — the nightly round stores
-- what it returns — and app.export_studio is its guard. So the body is the
-- one that gains the two tables, COPIED FROM 20261004100000 with nothing
-- else touched, and the restore list COPIED FROM 20260930100000 with the
-- same two added after orders, which they hang off.

create or replace function app.export_studio_raw(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare b record; j jsonb;
begin
  select * into b from public.businesses where id = p_business;
  if b.id is null then
    raise exception 'no such studio' using errcode = '42704';
  end if;

  j := jsonb_build_object(
    '_app', 'The Label Board',
    '_export', 'studio',
    '_version', 4,
    '_exported_at', now(),
    'business', to_jsonb(b) - 'closed_by',
    'branches',      coalesce((select jsonb_agg(to_jsonb(t)) from public.branches t         where t.business_id = p_business), '[]'::jsonb),
    'memberships',   coalesce((select jsonb_agg(to_jsonb(t)) from public.memberships t      where t.business_id = p_business), '[]'::jsonb),
    'profiles',      coalesce((select jsonb_agg(to_jsonb(t)) from public.profiles t         where t.business_id = p_business), '[]'::jsonb),
    'business_roles',coalesce((select jsonb_agg(to_jsonb(t)) from public.business_roles t   where t.business_id = p_business), '[]'::jsonb),
    'role_permissions', coalesce((select jsonb_agg(to_jsonb(t)) from public.business_role_permissions t
                                   where t.role_id in (select id from public.business_roles where business_id = p_business)), '[]'::jsonb),
    'app_state',     coalesce((select jsonb_agg(to_jsonb(t)) from public.app_state t        where t.business_id = p_business), '[]'::jsonb),
    'orders',        coalesce((select jsonb_agg(to_jsonb(t)) from public.orders t           where t.business_id = p_business), '[]'::jsonb),
    'order_costs',   coalesce((select jsonb_agg(to_jsonb(t)) from public.order_costs t      where t.business_id = p_business), '[]'::jsonb),
    /* AND THE TWO FROM OCTOBER. What the studio charges and what has been
       paid left orders.doc for the same reason the costs did. The same
       omission cost the commissions a restore a few days ago: a studio
       came back complete in every visible respect and without one. */
    'order_pricing',    coalesce((select jsonb_agg(to_jsonb(t)) from public.order_pricing t    where t.business_id = p_business), '[]'::jsonb),
    'order_settlement', coalesce((select jsonb_agg(to_jsonb(t)) from public.order_settlement t where t.business_id = p_business), '[]'::jsonb),
    'order_commissions', coalesce((select jsonb_agg(to_jsonb(t)) from public.order_commissions t where t.business_id = p_business), '[]'::jsonb),
    'order_contacts',    coalesce((select jsonb_agg(to_jsonb(t)) from public.order_contacts t    where t.business_id = p_business), '[]'::jsonb),
    'order_items',   coalesce((select jsonb_agg(to_jsonb(t)) from public.order_items t      where t.business_id = p_business), '[]'::jsonb),
    'customers',     coalesce((select jsonb_agg(to_jsonb(t)) from public.customers t        where t.business_id = p_business), '[]'::jsonb),
    'customer_contacts', coalesce((select jsonb_agg(to_jsonb(t)) from public.customer_contacts t where t.business_id = p_business), '[]'::jsonb),
    'transactions',  coalesce((select jsonb_agg(to_jsonb(t)) from public.transactions t     where t.business_id = p_business), '[]'::jsonb),
    'suppliers',     coalesce((select jsonb_agg(to_jsonb(t)) from public.suppliers t        where t.business_id = p_business), '[]'::jsonb),
    'products',      coalesce((select jsonb_agg(to_jsonb(t)) from public.products t         where t.business_id = p_business), '[]'::jsonb),
    'staff',         coalesce((select jsonb_agg(to_jsonb(t)) from public.staff t            where t.business_id = p_business), '[]'::jsonb),
    'attendance',    coalesce((select jsonb_agg(to_jsonb(t)) from public.attendance t       where t.business_id = p_business), '[]'::jsonb),
    'payment_methods', coalesce((select jsonb_agg(to_jsonb(t)) from public.payment_methods t where t.business_id = p_business), '[]'::jsonb),
    'feedback',      coalesce((select jsonb_agg(to_jsonb(t)) from public.feedback t         where t.business_id = p_business), '[]'::jsonb),
    'audit_log',     coalesce((select jsonb_agg(to_jsonb(t)) from public.audit_log t        where t.business_id = p_business), '[]'::jsonb));

  return j;
end $fn$;

revoke all on function app.export_studio_raw(uuid) from public, anon, authenticated;

create or replace function app.import_studio(p_json jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_biz   uuid;
  v_slug  text;
  v_t     text;
  v_key   text;
  v_i     int;
  v_counts jsonb := '{}'::jsonb;
  v_tables text[][] := array[
    ['branches','branches'],
    ['business_roles','business_roles'],
    ['business_role_permissions','role_permissions'],
    ['memberships','memberships'],
    ['profiles','profiles'],
    ['app_state','app_state'],
    ['customers','customers'],
    ['customer_contacts','customer_contacts'],
    ['products','products'],
    ['suppliers','suppliers'],
    ['staff','staff'],
    ['attendance','attendance'],
    ['orders','orders'],
    ['order_costs','order_costs'],
    ['order_commissions','order_commissions'],
    ['order_contacts','order_contacts'],
    ['order_pricing','order_pricing'],
    ['order_settlement','order_settlement'],
    ['order_items','order_items'],
    ['transactions','transactions'],
    ['payment_methods','payment_methods'],
    ['feedback','feedback'],
    ['audit_log','audit_log']
  ];
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform can restore a studio' using errcode = '42501';
  end if;
  if coalesce(p_json->>'_export','') <> 'studio' then
    raise exception 'that is not a studio export' using errcode = '22023';
  end if;

  v_biz  := (p_json->'business'->>'id')::uuid;
  v_slug := p_json->'business'->>'slug';
  if v_biz is null then
    raise exception 'the export names no studio' using errcode = '22023';
  end if;
  if exists (select 1 from public.businesses where id = v_biz) then
    raise exception 'studio % is still here; purge it first, or restore into a fresh project', v_biz
      using errcode = '42P10';
  end if;
  if v_slug is not null and exists (select 1 from public.businesses where slug = v_slug) then
    raise exception 'the address % is taken by another studio', v_slug using errcode = '42P10';
  end if;

  alter table public.businesses disable trigger user;
  for v_i in 1 .. array_length(v_tables, 1) loop
    execute format('alter table public.%I disable trigger user', v_tables[v_i][1]);
  end loop;

  insert into public.businesses
  select * from jsonb_populate_record(null::public.businesses, p_json->'business');

  for v_i in 1 .. array_length(v_tables, 1) loop
    v_t := v_tables[v_i][1];
    v_key := v_tables[v_i][2];
    execute format(
      'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)',
      v_t, v_t) using coalesce(p_json->v_key, '[]'::jsonb);
    v_counts := v_counts || jsonb_build_object(
      v_t, jsonb_array_length(coalesce(p_json->v_key, '[]'::jsonb)));
  end loop;

  perform setval(pg_get_serial_sequence('public.audit_log','id'),
                 greatest(coalesce((select max(id) from public.audit_log), 1), 1));

  for v_i in 1 .. array_length(v_tables, 1) loop
    execute format('alter table public.%I enable trigger user', v_tables[v_i][1]);
  end loop;
  alter table public.businesses enable trigger user;

  update public.app_state
     set data = (data - 'ownerPassword')
               || case when jsonb_typeof(data -> 'company') = 'object'
                       then jsonb_build_object('company', (data -> 'company') - 'ownerPassword')
                       else '{}'::jsonb end
   where business_id = v_biz and key = 'layi_dash_settings'
     and jsonb_typeof(data) = 'object'
     and (data ? 'ownerPassword'
          or (jsonb_typeof(data -> 'company') = 'object' and (data -> 'company') ? 'ownerPassword'));
  delete from public.app_state where business_id = v_biz and key = 'layi_dash_users';

  perform app.audit(v_biz, 'Studio restored from an export',
    'exported ' || coalesce(p_json->>'_exported_at','at an unknown time'));

  return jsonb_build_object('restored', true, 'business_id', v_biz, 'rows', v_counts);
end $fn$;

comment on function app.export_studio_raw(uuid) is
  'A studio, whole, with no permission check: app.export_studio is the '
  'guard and the nightly round is the other caller. Version 3 added '
  'order_commissions and order_contacts, which P2 created and nothing added '
  'here. Version 4 adds order_pricing and order_settlement for the same '
  'reason, and a studio restored from a version 3 file has orders worth '
  'nothing — which is why the version is in the file.';
