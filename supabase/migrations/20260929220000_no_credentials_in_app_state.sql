-- =====================================================================
-- No authentication secret is reachable by holding a membership
-- =====================================================================
-- From the independent audit, measured rather than suspected: signed in as an
-- ordinary STAFF member of a studio, over the public API, on staging —
--
--   GET app_state?key=eq.layi_dash_settings  ->  200, ownerPassword, 8 chars
--   GET app_state?key=eq.layi_dash_users     ->  200, the owner's pin
--
-- and doLogin() accepted a username and that password. So a staff member could
-- read the owner's credential from their own phone and then sign in as the
-- owner on the studio's tablet, seeing every screen their role hides.
--
-- The app is fixed in three places: the local username/PIN login is refused
-- wherever there is a real backend, layi_dash_users is no longer synced at all,
-- and ownerPassword is stripped from every path that writes settings. This
-- migration is the half that does not depend on which build a device is
-- running, because a studio with an old tab open would otherwise put the
-- credential straight back.
--
-- Three things, in order: stop new ones arriving, remove the ones already
-- there, and narrow who could read one if it ever reappeared.

-- ---------------------------------------------------------------------
-- 1. Nothing that authenticates anybody may be stored here
-- ---------------------------------------------------------------------
-- STRIPPED, NOT REFUSED. Refusing the write would mean an old client's every
-- settings save fails — and settings is written by forty-seven places in the
-- app, most of them somebody doing their job. The same reasoning as
-- app.guard_studio_settings, which stamps the plan rather than rejecting the
-- row. The field is simply not stored.
create or replace function app.strip_credentials_from_state()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $fn$
begin
  if new.key = 'layi_dash_settings' and jsonb_typeof(new.data) = 'object' then
    new.data := new.data - 'ownerPassword';
    if jsonb_typeof(new.data -> 'company') = 'object' then
      new.data := jsonb_set(new.data, '{company}', (new.data -> 'company') - 'ownerPassword');
    end if;
  end if;

  /* layi_dash_users is the DEVICE's own account list and every row carries a
     `pin`. It describes a device, not a studio, so there is nothing here for
     it to be: a live studio's team is memberships + team-admin. An old build
     that still pushes it is answered with a refusal it will retry a few times
     and then show, rather than a silent drop, because a device that thinks it
     is syncing its accounts should be told it is not. */
  if new.key = 'layi_dash_users' then
    raise exception 'the device account list is not synced; it holds sign-in credentials'
      using errcode = '42501',
            hint = 'Team membership is stored in memberships, not in app_state.';
  end if;

  return new;
end $fn$;

drop trigger if exists app_state_no_credentials on public.app_state;
create trigger app_state_no_credentials before insert or update on public.app_state
  for each row execute function app.strip_credentials_from_state();

revoke all on function app.strip_credentials_from_state() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Remove what is already stored
-- ---------------------------------------------------------------------
-- The settings row keeps everything else; only the credential leaves. The
-- account list goes entirely — the device that owns it still has its own copy
-- in localStorage, which is where it belongs and where the local login reads
-- it from.
update public.app_state
   set data = (data - 'ownerPassword')
             || case when jsonb_typeof(data -> 'company') = 'object'
                     then jsonb_build_object('company', (data -> 'company') - 'ownerPassword')
                     else '{}'::jsonb end
 where key = 'layi_dash_settings'
   and jsonb_typeof(data) = 'object'
   and (data ? 'ownerPassword'
        or (jsonb_typeof(data -> 'company') = 'object' and (data -> 'company') ? 'ownerPassword'));

delete from public.app_state where key = 'layi_dash_users';

-- ---------------------------------------------------------------------
-- 3. And if one ever reappears, fewer people can reach it
-- ---------------------------------------------------------------------
-- Reading the account list needed `team`, which staff hold by default. Nothing
-- should be able to write it now, but the read is narrowed to `users`
-- — Accounts & roles — so the blast radius of a mistake is the people who
-- administer accounts rather than everybody in the workroom.
--
-- COPIED FROM THE DEPLOYED FUNCTION with one line changed, the rest byte for
-- byte as it has run since Batch B.
create or replace function app.perm_for_key(p_key text)
returns text language sql immutable
set search_path = public, pg_temp as $fn$
  select case p_key
    when 'layi_dash_orders'      then 'orders'
    when 'layi_dash_orders_done' then 'orders'
    when 'layi_dash_txns'        then 'receivables'
    when 'layi_dash_bills'       then 'expenses'
    when 'layi_dash_pots'        then 'funds'
    when 'layi_dash_appts'       then 'appts'
    when 'layi_dash_planner'     then 'appts'
    when 'layi_dash_staff'       then 'team'
    when 'layi_dash_users'       then 'users'   -- was 'team'
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
$fn$;

comment on function app.strip_credentials_from_state() is
  'No authentication secret is stored in app_state. ownerPassword is stripped '
  'from settings on the way in and the device account list is refused outright, '
  'because both were readable by every member of the studio.';

-- ---------------------------------------------------------------------
-- 4. A restore cannot put one back
-- ---------------------------------------------------------------------
-- COPIED FROM 20260929180000_studio_restore.sql, byte for byte, with nine
-- lines added and nothing else touched.
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

  /* AND A FILE WRITTEN BEFORE 29 SEPTEMBER 2026 STILL HAS THE CREDENTIAL IN IT.
     Every other way into app_state now meets app.strip_credentials_from_state,
     but a restore replays with the user triggers off — by design, because the
     rows were already judged when they were first written. That makes this the
     one remaining path that could put an owner password and a set of PINs back
     into a table every member of the studio can read. The same two statements
     as the cleanup, scoped to the studio being restored. Nothing else about the
     file is altered, and the counts still come from the file. */
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

  -- and the restore itself is recorded, as a server event, on the studio it
  -- restored, which is the first line of its new history
  perform app.audit(v_biz, 'Studio restored from an export',
    'exported ' || coalesce(p_json->>'_exported_at','at an unknown time'));

  return jsonb_build_object('restored', true, 'business_id', v_biz, 'rows', v_counts);
end $fn$;
