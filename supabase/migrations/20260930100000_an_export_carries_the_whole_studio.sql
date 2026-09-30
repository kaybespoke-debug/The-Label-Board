-- =====================================================================
-- An export that leaves two tables behind is not a backup
-- =====================================================================
-- Found by actually performing a recovery rather than reading the runbook:
-- supabase/tests/recovery_drill.mjs exports a studio, destroys it, puts it
-- back from the file, and then counts. Two counts did not match.
--
--   commissions came back — was 30000, now 0
--   order_contacts came back — was 1, now 0
--
-- order_commissions and order_contacts were created by P2, hours after
-- export_studio's table list was written, and nothing joined them up. A
-- studio restored from a backup would have come back complete in every
-- visible respect — its orders, its clients, its money, its history — and
-- silently without a single commission or delivery address. Nobody would
-- have noticed until somebody asked what Ada was owed.
--
-- This is the whole argument for rehearsing a restore instead of trusting
-- one. The export ran, the restore ran, both reported success, and the data
-- was gone.
--
-- THE GENERAL PROBLEM, not just these two. A new per-studio table has to be
-- added to three lists — the export, the import, and the trigger-disable
-- loop inside it — and forgetting any of them loses data quietly. The drill
-- now fails when a studio-scoped table is missing from the export, so the
-- next one is caught by a test rather than by a recovery that went wrong.
-- =====================================================================

create or replace function app.export_studio(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare b record; j jsonb;
begin
  select * into b from public.businesses where id = p_business;
  if b.id is null then
    raise exception 'no such studio' using errcode = '42704';
  end if;
  if not (app.is_owner(p_business)
          or app.is_platform_admin()
          or (b.status = 'closed' and b.closed_by is not null and b.closed_by = auth.uid()
              and (b.purge_after is null or now() <= b.purge_after))) then
    raise exception 'only the owner of this studio can export it' using errcode = '42501';
  end if;

  j := jsonb_build_object(
    '_app', 'The Label Board',
    '_export', 'studio',
    '_version', 3,
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
    /* THE TWO THAT WERE MISSING. P2 put what a job cost the studio and where
       it was delivered into tables of their own, so that seeCost and
       seeContact could be refusals rather than hidden fields. Neither was
       ever added here. */
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

  insert into public.audit_log (business_id, action, detail)
  values (p_business, 'Studio exported', 'full server-side export');

  return j;
end $fn$;

-- ---------------------------------------------------------------------
-- And the restore puts them back
-- ---------------------------------------------------------------------
-- COPIED FROM 20260929220000, which is the version with the credential
-- scrub, with two rows added to v_tables and nothing else touched. Order
-- matters: both hang off orders, so they follow it.
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

comment on function app.export_studio(uuid) is
  'A studio, whole. Version 3 added order_commissions and order_contacts, '
  'which P2 created and nothing added here — a restore came back complete '
  'in every visible respect and without a single commission.';
