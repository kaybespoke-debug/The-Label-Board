-- =====================================================================
-- Exports that happen whether or not anybody remembers
-- =====================================================================
-- The recovery drill proved the restore works. It also measured the thing
-- that made the proof hollow: the Recovery Point Objective was "whenever
-- somebody last pressed the button", because nothing took an export on a
-- schedule. A tested restore of a backup nobody takes is a tested restore
-- of nothing.
--
-- WHAT THIS IS. The export that is already tested, taken nightly for every
-- active studio, checksummed, kept for a fortnight, and loud when it fails.
-- No new backup format: app.export_studio is the format, and
-- restore_harness and recovery_drill already prove a studio comes back from
-- it. Inventing a second one would mean inventing a second restore path and
-- testing that too.
--
-- WHAT THIS IS NOT, and the distinction matters more than the feature. These
-- backups live INSIDE the project they back up. They ride along in the
-- platform's own daily physical backup, so they are off-box, but they are
-- not off-provider: if the Supabase project is deleted, they go with it, and
-- Supabase's own documentation is explicit that deleting a project
-- permanently removes its backups too. What they are genuinely good for is
-- the much likelier disaster — one studio's data wrecked by a bad import, a
-- mistaken bulk edit, a sync that went wrong — where yesterday's copy of
-- that one studio is exactly what is wanted and nothing else has to be
-- touched. Off-provider copies need a destination that is somebody's
-- decision, not a migration's.
--
-- WHY IN THE DATABASE RATHER THAN IN STORAGE. Postgres cannot write to the
-- Storage API; doing so needs pg_net calling an Edge Function, which is two
-- more moving parts that can fail silently in the middle of the night. A
-- table is checked by the same backup, the same RLS and the same tests as
-- everything else here. If the off-provider leg is built later, it reads
-- from this table, which is the right seam anyway.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Where they go
-- ---------------------------------------------------------------------
-- In the `app` schema, which PostgREST does not expose. That alone is not
-- enough — anon and authenticated both hold USAGE on it — so the table also
-- forces RLS and has no policy at all. Three independent reasons nothing
-- with an API key can read one studio's backup, let alone another's.
create table if not exists app.studio_backups (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  taken_at       timestamptz not null default now(),
  export_version int,
  payload        jsonb not null,
  sha256         text not null,
  bytes          bigint not null
);

create index if not exists studio_backups_business_time
  on app.studio_backups(business_id, taken_at desc);

alter table app.studio_backups enable row level security;
alter table app.studio_backups force row level security;
revoke all on app.studio_backups from public, anon, authenticated;

-- Every run, whether or not it went well, so a silence can be told from a
-- success. A job that only writes a row when it works looks identical to a
-- job that stopped running in March.
create table if not exists app.backup_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  attempted   int not null default 0,
  succeeded   int not null default 0,
  failed      int not null default 0,
  detail      jsonb not null default '{}'::jsonb
);

alter table app.backup_runs enable row level security;
alter table app.backup_runs force row level security;
revoke all on app.backup_runs from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. The export, without the permission check and without the audit line
-- ---------------------------------------------------------------------
-- app.export_studio checks that the caller owns the studio, which is right
-- for a person and impossible for a scheduled job: pg_cron has no auth.uid()
-- and belongs to nobody. The alternative — having the job impersonate a
-- platform admin — would mean a nightly task running as a real person who
-- did not ask for it.
--
-- So the body moves here, unchecked and unreachable, and export_studio
-- becomes its guard. The backup job calls this one. Nothing else may.
--
-- IT ALSO DOES NOT WRITE "Studio exported" TO THE STUDIO'S HISTORY. A
-- person exporting their studio is an event worth recording; a machine
-- doing it at 2am for fourteen nights running is noise in the one log that
-- is supposed to be worth reading. The run is recorded in backup_runs.
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

-- And the human-facing one becomes its guard, unchanged in what it permits.
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

  j := app.export_studio_raw(p_business);

  insert into public.audit_log (business_id, action, detail)
  values (p_business, 'Studio exported', 'full server-side export');

  return j;
end $fn$;

-- ---------------------------------------------------------------------
-- 3. The nightly round
-- ---------------------------------------------------------------------
-- ONE STUDIO FAILING MUST NOT STOP THE OTHERS. Each is its own block, so a
-- studio with something odd in it costs that studio its backup for the
-- night and costs the other eight nothing. The failure is written where the
-- app's other failures already go.
create or replace function app.take_studio_backups(p_retain int default 14)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_run    bigint;
  b        record;
  j        jsonb;
  t        text;
  v_ok     int := 0;
  v_fail   int := 0;
  v_n      int := 0;
  v_detail jsonb := '[]'::jsonb;
  v_msg    text;
begin
  insert into app.backup_runs default values returning id into v_run;

  for b in select id, name from public.businesses where status = 'active' order by id loop
    v_n := v_n + 1;
    begin
      j := app.export_studio_raw(b.id);
      t := j::text;

      insert into app.studio_backups (business_id, export_version, payload, sha256, bytes)
      values (b.id, (j->>'_version')::int, j,
              encode(sha256(t::bytea), 'hex'),
              octet_length(t));

      /* Retention: the most recent p_retain for this studio, and no more.
         Pruned per studio rather than globally, so a busy studio cannot
         push a quiet one's only backup out of the window. */
      delete from app.studio_backups old
       where old.business_id = b.id
         and old.id not in (select s.id from app.studio_backups s
                             where s.business_id = b.id
                             order by s.taken_at desc
                             limit greatest(p_retain, 1));

      v_ok := v_ok + 1;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_fail := v_fail + 1;
      v_detail := v_detail || jsonb_build_object('business_id', b.id, 'error', v_msg);
      /* WHERE THE APP'S OWN CRASHES GO, so there is one place to look.

         error_reports has a vocabulary already: source is client or server,
         kind is error, rejection, edge or sync. A nightly job is the server
         having an error, so it says so, rather than widening a constraint to
         admit a word of its own.

         The first draft wrote source='backup', which both check constraints
         refused — and the "exception when others then null" below swallowed
         that completely, so the round reported its failure count correctly
         and reported nothing anywhere a person would look. backup_harness
         caught it because it asserts the REPORT lands, not merely that the
         count is right. A silent fallback needs a test that is not satisfied
         by silence. */
      begin
        insert into public.error_reports (business_id, source, kind, message)
        values (b.id, 'server', 'error',
                left('nightly studio backup failed: ' || coalesce(v_msg,'unknown'), 500));
      exception when others then null;
      end;
    end;
  end loop;

  update app.backup_runs
     set finished_at = now(), attempted = v_n, succeeded = v_ok,
         failed = v_fail, detail = jsonb_build_object('failures', v_detail)
   where id = v_run;

  return jsonb_build_object('run', v_run, 'attempted', v_n,
                            'succeeded', v_ok, 'failed', v_fail);
end $fn$;

revoke all on function app.take_studio_backups(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Proving a backup is still the backup it was
-- ---------------------------------------------------------------------
-- A checksum written beside the thing it checksums catches the failure that
-- actually happens — a truncated or partially written payload — and does not
-- pretend to catch tampering by somebody who can write the table, which is
-- nobody with an API key.
create or replace function app.verify_studio_backup(p_id uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
    'id', s.id,
    'business_id', s.business_id,
    'taken_at', s.taken_at,
    'bytes', s.bytes,
    'intact', encode(sha256(s.payload::text::bytea), 'hex') = s.sha256
      and octet_length(s.payload::text) = s.bytes)
  from app.studio_backups s where s.id = p_id;
$fn$;

-- What a person needs to see to know the backups are alive: the newest one
-- per studio, how old it is, and whether it still verifies. No payloads.
create or replace function app.backup_health()
returns table (business_id uuid, studio text, backups int,
               newest timestamptz, hours_old numeric, bytes bigint, intact boolean)
language sql stable security definer
set search_path = public, pg_temp as $fn$
  select b.id, b.name,
         (select count(*)::int from app.studio_backups s where s.business_id = b.id),
         (select max(s.taken_at) from app.studio_backups s where s.business_id = b.id),
         round(extract(epoch from (now() - (select max(s.taken_at) from app.studio_backups s
                                             where s.business_id = b.id))) / 3600.0, 1),
         (select s.bytes from app.studio_backups s where s.business_id = b.id
           order by s.taken_at desc limit 1),
         (select encode(sha256(s.payload::text::bytea),'hex') = s.sha256
            from app.studio_backups s where s.business_id = b.id
           order by s.taken_at desc limit 1)
  from public.businesses b
  where b.status = 'active'
  order by b.name;
$fn$;

revoke all on function app.verify_studio_backup(uuid) from public, anon, authenticated;
revoke all on function app.backup_health()           from public, anon, authenticated;

comment on table app.studio_backups is
  'A nightly copy of each active studio, in the same format restore_harness '
  'and recovery_drill already restore from. Inside the project, so it shares '
  'the project''s fate: this is for a studio wrecked by a bad import, not '
  'for the provider disappearing.';
comment on function app.take_studio_backups(int) is
  'One studio failing costs that studio its backup for the night and the '
  'others nothing. Every run is recorded whether or not it worked, so a job '
  'that stopped in March does not look like a job with nothing to report.';
