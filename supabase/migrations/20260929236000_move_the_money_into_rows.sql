-- =====================================================================
-- The 76 payments, moved and reconciled
-- =====================================================================
-- CORRECTING THE FILE BEFORE THIS ONE. 20260929235000 says production
-- "holds no transactions at all — 0 rows in the table AND 0 payments in the
-- blob". The first half is true and the second is not: production holds 76
-- payments worth 7,457,600 in layi_dash_txns across two studios. The table
-- was empty, so the count that was checked was the empty one. The same
-- mistake as reading a field list instead of the data, one file later.
--
-- So the money needs what the orders needed: a migration that survives being
-- run twice, a reconciliation that compares identifiers rather than counts,
-- and a retirement that refuses unless that studio is green.
--
-- THE REAL SHAPE, surveyed rather than assumed:
--
--   dir=in  cat=order    30 payments   3,731,600   all carry an orderId
--   dir=in  cat=sale     24 payments   1,392,000   all carry an orderId
--   dir=out cat=expense  16 payments   1,254,000
--   dir=out cat=supply    6 payments   1,080,000
--
-- transactions.kind is constrained to sale, refund or expense, so `dir`
-- decides it and `cat` is kept in the detail rather than mashed into it.
-- Nothing is discarded: every one of the sixteen fields lands somewhere.
-- =====================================================================

alter table public.transactions
  add column if not exists detail jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 1. Moving them
-- ---------------------------------------------------------------------
create or replace function app.migrate_payments_to_rows(p_business uuid)
returns table(blob_payments integer, rows_before integer, rows_after integer,
              blob_total numeric, rows_total numeric, matched boolean)
language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_before int;
  r        record;
  v_branch uuid;
  v_order  uuid;
begin
  select count(*) into v_before from public.transactions t where t.business_id = p_business;

  for r in
    select (array_agg(e))[1] e, app_id, count(distinct e) versions
    from (
      select e, e->>'id' app_id
      from public.app_state s, lateral jsonb_array_elements(s.data) e
      where s.business_id = p_business and s.key = 'layi_dash_txns'
        and jsonb_typeof(s.data) = 'array' and coalesce(e->>'id','') <> ''
    ) x group by app_id
  loop
    v_branch := null;
    if coalesce(r.e->>'branch','') <> '' then
      select b.id into v_branch from public.branches b
       where b.business_id = p_business
         and lower(btrim(b.name)) = lower(btrim(r.e->>'branch')) limit 1;
    end if;

    /* the payment's order, by the app-level id the blob carries */
    v_order := null;
    if coalesce(r.e->>'orderId','') <> '' then
      select o.id into v_order from public.orders o
       where o.business_id = p_business and o.app_id = r.e->>'orderId' limit 1;
    end if;

    insert into public.transactions
      (business_id, branch_id, order_id, kind, amount, at, app_id, method, note, detail)
    values (
      p_business, v_branch, v_order,
      case when lower(coalesce(r.e->>'dir','in')) = 'out' then 'expense' else 'sale' end,
      coalesce((r.e->>'amount')::numeric, 0),
      coalesce((r.e->>'at')::timestamptz, now()),
      r.e->>'id',
      nullif(r.e->>'method',''),
      nullif(r.e->>'label',''),
      /* everything the columns do not hold, kept rather than dropped */
      (r.e - 'id' - 'amount' - 'at' - 'method' - 'label' - 'branch' - 'orderId' - 'dir')
    )
    on conflict (business_id, app_id) do update
      set branch_id = excluded.branch_id,
          order_id  = excluded.order_id,
          kind      = excluded.kind,
          amount    = excluded.amount,
          at        = excluded.at,
          method    = excluded.method,
          note      = excluded.note,
          detail    = excluded.detail;
  end loop;

  return query
  select
    (app.reconcile_payments(p_business) ->> 'source_payments')::int,
    v_before,
    (select count(*)::int from public.transactions t where t.business_id = p_business),
    (app.reconcile_payments(p_business) ->> 'source_money')::numeric,
    (select coalesce(sum(t.amount),0) from public.transactions t where t.business_id = p_business),
    (app.reconcile_payments(p_business) ->> 'green')::boolean;
end $fn$;

-- ---------------------------------------------------------------------
-- 2. Proving they arrived
-- ---------------------------------------------------------------------
create or replace function app.reconcile_payments(p_business uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$
with raw as (
  select e, e->>'id' app_id
  from public.app_state s, lateral jsonb_array_elements(s.data) e
  where s.business_id = p_business and s.key = 'layi_dash_txns'
    and jsonb_typeof(s.data) = 'array' and coalesce(e->>'id','') <> ''
),
src as (
  select app_id, (array_agg(e))[1] e, count(*) copies, count(distinct e) versions
  from raw group by app_id
),
dst as (select t.* from public.transactions t where t.business_id = p_business),
j as (select src.*, dst.id dst_id, dst.amount dst_amount, dst.kind dst_kind
      from src left join dst on dst.app_id = src.app_id)
select jsonb_build_object(
  'business_id', p_business,
  'source_rows',     (select count(*) from raw),
  'source_payments', (select count(*) from src),
  'destination_payments', (select count(*) from dst),
  'missing_identifiers',   (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from j where dst_id is null),
  'duplicate_identifiers', (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from src where copies > 1),
  'conflicting_identifiers', (select coalesce(jsonb_agg(app_id order by app_id),'[]'::jsonb) from src where versions > 1),
  'extra_identifiers', (select coalesce(jsonb_agg(t.app_id order by t.app_id),'[]'::jsonb) from dst t
                          where t.app_id is not null and not exists (select 1 from src where src.app_id = t.app_id)),
  'source_money',      (select coalesce(sum(coalesce((e->>'amount')::numeric,0)),0) from src),
  'destination_money', (select coalesce(sum(amount),0) from dst),
  'source_money_in',   (select coalesce(sum(coalesce((e->>'amount')::numeric,0)),0) from src
                          where lower(coalesce(e->>'dir','in')) <> 'out'),
  'destination_money_in', (select coalesce(sum(amount),0) from dst where kind <> 'expense'),
  'source_money_out',  (select coalesce(sum(coalesce((e->>'amount')::numeric,0)),0) from src
                          where lower(coalesce(e->>'dir','in')) = 'out'),
  'destination_money_out', (select coalesce(sum(amount),0) from dst where kind = 'expense'),
  'amount_mismatches', (select count(*) from j where dst_id is not null
                          and coalesce(dst_amount,0) <> coalesce((e->>'amount')::numeric,0)),
  'direction_mismatches', (select count(*) from j where dst_id is not null
                          and (dst_kind = 'expense') <> (lower(coalesce(e->>'dir','in')) = 'out')),
  'orders_linked', (select count(*) from dst where order_id is not null),
  'orders_expected', (select count(*) from src where coalesce(e->>'orderId','') <> ''
                        and exists (select 1 from public.orders o
                                    where o.business_id = p_business and o.app_id = e->>'orderId'))
) || jsonb_build_object('green', (
     (select count(*) from src) = (select count(*) from dst)
 and (select count(*) from j where dst_id is null) = 0
 and (select count(*) from src where versions > 1) = 0
 and (select coalesce(sum(coalesce((e->>'amount')::numeric,0)),0) from src)
   = (select coalesce(sum(amount),0) from dst)
 and (select coalesce(sum(coalesce((e->>'amount')::numeric,0)),0) from src where lower(coalesce(e->>'dir','in')) <> 'out')
   = (select coalesce(sum(amount),0) from dst where kind <> 'expense')
 and (select count(*) from j where dst_id is not null
        and coalesce(dst_amount,0) <> coalesce((e->>'amount')::numeric,0)) = 0
 and (select count(*) from j where dst_id is not null
        and (dst_kind = 'expense') <> (lower(coalesce(e->>'dir','in')) = 'out')) = 0
));
$fn$;

-- ---------------------------------------------------------------------
-- 3. Retiring the source, only once it is proven
-- ---------------------------------------------------------------------
create or replace function app.refuse_retired_payment_blob()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if new.key = 'layi_dash_txns'
     and exists (select 1 from public.transactions t where t.business_id = new.business_id) then
    raise exception 'payments are stored as rows for this studio; this app is out of date'
      using errcode = '42501',
            hint = 'Close and reopen the app to update, then try again.';
  end if;
  return new;
end $fn$;

drop trigger if exists app_state_no_retired_payments on public.app_state;
create trigger app_state_no_retired_payments before insert or update on public.app_state
  for each row execute function app.refuse_retired_payment_blob();

create or replace function app.retire_payment_blob(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare v_rec jsonb; v_removed int;
begin
  v_rec := app.reconcile_payments(p_business);
  if coalesce((v_rec->>'green')::boolean, false) is not true then
    raise exception 'that studio''s money does not reconcile, so it stays where it is'
      using errcode = '23514', detail = v_rec::text;
  end if;
  delete from public.app_state where business_id = p_business and key = 'layi_dash_txns';
  get diagnostics v_removed = row_count;
  perform app.audit(p_business, 'Legacy payment store retired',
    (v_rec->>'source_payments') || ' payments reconciled and moved into rows');
  return v_rec || jsonb_build_object('blob_rows_removed', v_removed, 'retired', true);
end $fn$;

revoke all on function app.migrate_payments_to_rows(uuid)    from public, anon, authenticated;
revoke all on function app.reconcile_payments(uuid)          from public, anon, authenticated;
revoke all on function app.retire_payment_blob(uuid)         from public, anon, authenticated;
revoke all on function app.refuse_retired_payment_blob()     from public, anon, authenticated;

create or replace function public.reconcile_my_payments(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if not app.is_owner(p_business) then
    raise exception 'Only the studio owner can check the payment migration'
      using errcode = '42501';
  end if;
  return app.reconcile_payments(p_business);
end $fn$;
revoke all on function public.reconcile_my_payments(uuid) from public, anon;
grant execute on function public.reconcile_my_payments(uuid) to authenticated, service_role;

comment on function app.reconcile_payments(uuid) is
  'Compares layi_dash_txns with public.transactions payment by payment: '
  'identifiers, every amount, money in and money out separately, and the '
  'direction of each. green is the only thing a retirement may rest on.';
