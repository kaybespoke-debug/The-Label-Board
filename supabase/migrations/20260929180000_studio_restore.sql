-- =====================================================================
-- Putting a studio back
-- =====================================================================
-- app.export_studio hands a studio everything it has. That is worth
-- something on its own — it is what somebody means when they ask for their
-- data — but it is not a backup until somebody has put one back. A file
-- nobody has restored is a file nobody knows the shape of.
--
-- So this is the other half, and supabase/tests/restore_harness.mjs is the
-- drill: export a studio with real work in it, purge it, restore it from the
-- export alone, and compare both sides row for row and naira for naira.
--
-- WHAT THIS IS NOT. It is not Supabase's backup. Supabase keeps the whole
-- project and that is what a lost database is restored from; RECOVERY.md has
-- that procedure. This is the one-studio case, which is the common one: a
-- studio that deleted something, or a device that went wrong, where
-- restoring the whole project would take every other studio back with it.
--
-- THE ORIGINAL IDS, ON PURPOSE. A studio is restored as itself, with the
-- same business id and the same row ids, so a device that still has the
-- studio open simply resyncs. Remapping every id across twenty tables is
-- more code, more to get wrong, and produces a studio that every existing
-- device treats as a stranger. The cost is that a studio cannot be restored
-- beside a copy of itself: if the id or the slug is still taken this refuses
-- and says so, which is the loud failure rather than the quiet one.
--
-- THE TRIGGERS COME OFF FOR THE DURATION, and this is the part to read
-- twice. Restoring history with the audit trigger on would stamp every line
-- with the operator who ran the restore, because that is what the trigger is
-- for. Restoring branches with the plan limit on would refuse a studio whose
-- plan has since changed. Every one of those guards is right about a live
-- write and wrong about a replay of writes that were already checked when
-- they happened. DISABLE TRIGGER USER leaves the foreign keys in force, so
-- the shape is still verified; it is only the judgement that is suspended,
-- and only inside this transaction, so a failure anywhere puts it all back.
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
  -- parents before children, and the same list is used to take the triggers
  -- off and put them back, so the two cannot drift apart
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
    /* Counted from the file rather than from the table, because that is the
       number a caller wants to compare against, and because two of these
       tables are not scoped by business_id at all. */
    v_counts := v_counts || jsonb_build_object(
      v_t, jsonb_array_length(coalesce(p_json->v_key, '[]'::jsonb)));
  end loop;

  -- The audit log is the one table with a sequence, and a restore that leaves
  -- it behind hands the next real event an id that is already taken.
  perform setval(pg_get_serial_sequence('public.audit_log','id'),
                 greatest(coalesce((select max(id) from public.audit_log), 1), 1));

  for v_i in 1 .. array_length(v_tables, 1) loop
    execute format('alter table public.%I enable trigger user', v_tables[v_i][1]);
  end loop;
  alter table public.businesses enable trigger user;

  -- and the restore itself is recorded, as a server event, on the studio it
  -- restored, which is the first line of its new history
  perform app.audit(v_biz, 'Studio restored from an export',
    'exported ' || coalesce(p_json->>'_exported_at','at an unknown time'));

  return jsonb_build_object('restored', true, 'business_id', v_biz, 'rows', v_counts);
end $fn$;

create or replace function public.import_studio(p_json jsonb)
returns jsonb language sql security definer
set search_path = public, pg_temp as $fn$ select app.import_studio(p_json) $fn$;

revoke all on function public.import_studio(jsonb) from public, anon;
grant execute on function public.import_studio(jsonb) to authenticated;
revoke all on function app.import_studio(jsonb) from public, anon, authenticated;

comment on function app.import_studio(jsonb) is
  'Restores one studio from an app.export_studio file, as itself, with its '
  'original ids. Platform admins only. Refuses if the studio or its address '
  'is still there. Guard triggers are suspended for the replay and the '
  'foreign keys are not.';
