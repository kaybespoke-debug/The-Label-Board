-- =====================================================================
-- A VERSION 3 BACKUP STILL KNOWS THE PRICE
-- =====================================================================
-- Moving the price into order_pricing left fourteen nights of production
-- backups behind. They are version 3 files: the money is in each order's
-- `doc`, where it always was, and there is no order_pricing array in the
-- file at all.
--
-- app.import_studio restores what the file holds with every user trigger
-- switched off, so a version 3 file restores orders whose documents still
-- carry `value` and `paid` — and nothing reads those any more. The studio
-- would come back complete in every visible respect with every order
-- showing a dash. The data is not lost; it is simply unreachable, which at
-- the moment somebody needs a restore is close enough to the same thing.
--
-- This is the second time in a fortnight that an export has been complete
-- except for the money. The first was the commissions. Writing the recovery
-- step into a runbook for somebody to remember at four in the morning is
-- not a fix, so the restore does it itself.
--
-- COPIED FROM 20261004120000 with one block added before the credential
-- scrub and nothing else touched.
create or replace function app.import_studio(p_json jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_biz   uuid;
  v_slug  text;
  v_t     text;
  v_key   text;
  v_i     int;
  v_ver   int;
  v_fwd   int := 0;
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
  v_ver  := coalesce((p_json->>'_version')::int, 1);
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

  /* ---------------------------------------------------------------- */
  /* THE MONEY, CARRIED FORWARD OUT OF AN OLDER FILE.                 */
  /* ---------------------------------------------------------------- */
  /* Version 4 is the first format that holds order_pricing and
     order_settlement. Anything older has the price and the paid figure
     in each order's document, and the triggers are off, so they are
     sitting there unread. The same two helpers the release used do the
     copy, so there is one definition of what a price is.

     It runs while the triggers are still disabled on purpose: the strip
     has to happen AFTER the copy, and doing it by name rather than by
     trigger means the order's rev is not bumped either. */
  if v_ver < 4 then
    insert into public.order_pricing (order_id, business_id, branch_id, value, discount, detail)
    select o.id, o.business_id, o.branch_id,
           coalesce((o.doc->>'value')::numeric, 0),
           coalesce((o.doc->>'discount')::numeric, 0),
           app.order_pricing_detail(o.doc)
    from public.orders o
    where o.business_id = v_biz and app.order_has_pricing(o.doc)
    on conflict (order_id) do nothing;
    get diagnostics v_fwd = row_count;

    insert into public.order_settlement (order_id, business_id, branch_id, paid, detail)
    select o.id, o.business_id, o.branch_id,
           coalesce((o.doc->>'paid')::numeric, 0),
           app.order_settlement_detail(o.doc)
    from public.orders o
    where o.business_id = v_biz and app.order_has_settlement(o.doc)
    on conflict (order_id) do nothing;

    /* and only now is it taken out of the document, by the same function
       the release used, so the two can never disagree */
    update public.orders set doc = app.order_doc_without_secrets(doc)
     where business_id = v_biz
       and (doc ?| array['value','discount','paid','potContribs']
            or (doc->'delivery') ? 'fee'
            or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(doc->'outfits')='array'
                       then doc->'outfits' else '[]'::jsonb end) f where f ? 'price')
            or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(doc->'saleItems')='array'
                       then doc->'saleItems' else '[]'::jsonb end) i where i ? 'unitPrice'));

    v_counts := v_counts || jsonb_build_object('money_carried_forward_from_v' || v_ver, v_fwd);
  end if;

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
    'exported ' || coalesce(p_json->>'_exported_at','at an unknown time')
    || ', format version ' || v_ver
    || case when v_ver < 4 then ' (the money was carried forward)' else '' end);

  return jsonb_build_object('restored', true, 'business_id', v_biz,
                            'export_version', v_ver, 'rows', v_counts);
end $fn$;

comment on function app.import_studio(jsonb) is
  'Restores a studio from an export. Reads the file''s _version: anything '
  'before 4 has the price and the paid figure inside each order''s document, '
  'so they are copied into order_pricing and order_settlement and then '
  'stripped, by the same functions the October release used. Without that a '
  'version 3 file restores a studio whose every order shows a dash.';
