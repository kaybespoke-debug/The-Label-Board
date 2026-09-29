-- =====================================================================
-- Batch F: what happens when it goes wrong, and when somebody leaves
-- =====================================================================
-- Three things this app could not do until now, all of them things a real
-- business needs and none of them visible in a feature list:
--
--   1. tell us it broke. An error in a browser in Ibadan at 11pm was a
--      sentence the studio might or might not repeat to us.
--   2. hand a studio its own data, including the parts a device never
--      held because the person at it was not allowed to see them.
--   3. let a studio leave. Nothing in the database permitted deleting a
--      business, so "we are closing" had no answer at all, and a plain
--      cascade would have been the wrong one: it takes our own books and
--      the referring partner's earnings with it.
--
-- ---------------------------------------------------------------------
-- 1. Error reports
-- ---------------------------------------------------------------------
-- Diagnostics, not an audit trail, and kept apart from audit_log on
-- purpose: the audit trail is the studio's record of who did what and the
-- studio reads it, while this is our record of what broke and the studio
-- has no reason to. One table for both browsers and Edge Functions, with
-- the same source discipline as the audit log, because a client that can
-- claim to be the server can forge the only evidence we have.
create table if not exists public.error_reports (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete set null,
  user_id     uuid,
  source      text not null default 'client' check (source in ('client','server')),
  kind        text not null check (kind in ('error','rejection','edge','sync')),
  message     text not null,
  stack       text,
  at_url      text,
  app_version text,
  ua          text,
  at          timestamptz not null default now()
);
create index if not exists error_reports_at_idx on public.error_reports(at desc);
create index if not exists error_reports_business_idx on public.error_reports(business_id, at desc);

-- COUNTING IS A SEPARATE FUNCTION, AND IT HAS TO BE.
-- The stamping trigger must be SECURITY INVOKER, because current_user is the
-- only way to tell a browser from an Edge Function. But a SECURITY INVOKER
-- trigger's own SELECT is the invoker's SELECT, and a tenant has no SELECT
-- on this table at all — so the count came back 0 however many rows were
-- there, and the ceiling silently did not exist. Caught by the suite, which
-- flooded the table and then watched the next report go straight in.
-- It has to be callable BY the trigger, which means callable by whoever is
-- inserting, which means it must not answer questions about a studio the
-- caller has nothing to do with. For those it answers -1, which the trigger
-- reads as "not my question" and passes straight to the policy, so a
-- cross-studio attempt is REFUSED rather than quietly dropped. The two have
-- to be different: a flood is the app's own fault and must not break it,
-- while filing a report against somebody else's studio is an answer the
-- caller should get.
create or replace function app.error_reports_recently(p_business uuid)
returns int language sql stable security definer
set search_path = public, pg_temp as $$
  select case
    when auth.uid() is null or app.in_scope(p_business, null)
      then (select count(*)::int from public.error_reports r
             where r.business_id = p_business and r.at > now() - interval '1 hour')
    else -1
  end
$$;

-- WHO AND WHAT WROTE IT, decided here rather than by the caller. The same
-- shape as app.stamp_audit_actor and for the same reason: current_user
-- inside a SECURITY DEFINER function is always the function owner, so the
-- question has to be asked by a SECURITY INVOKER trigger, where current_user
-- is still authenticated for a browser and service_role for an Edge
-- Function. Getting this backwards once already demoted every server event
-- in the audit log to 'client'.
create or replace function app.stamp_error_report()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
declare v_recent int;
begin
  if current_user in ('authenticated', 'anon') then
    new.source  := 'client';
    new.user_id := auth.uid();
  else
    new.source  := coalesce(new.source, 'server');
    if new.source not in ('client','server') then new.source := 'server'; end if;
  end if;

  -- A LOOP THAT REPORTS ITS OWN LOOPING is the failure mode here: one
  -- broken render throwing on every frame would post thousands of rows,
  -- and the client's own throttle is inside the same broken page. So the
  -- ceiling is in the database, where the broken page cannot reach it.
  -- Two hundred an hour per studio is far more than a real fault needs and
  -- far less than a loop produces.
  if new.business_id is not null then
    v_recent := app.error_reports_recently(new.business_id);
    if v_recent >= 200 then
      return null;   -- dropped, not refused: reporting must never break the app
    end if;
  end if;

  new.message := left(coalesce(new.message,''), 2000);
  new.stack   := left(new.stack, 8000);
  new.at_url  := left(new.at_url, 500);
  new.ua      := left(new.ua, 400);
  if new.message = '' then new.message := '(no message)'; end if;
  return new;
end $$;

drop trigger if exists error_reports_stamp on public.error_reports;
create trigger error_reports_stamp before insert on public.error_reports
  for each row execute function app.stamp_error_report();

alter table public.error_reports enable row level security;
alter table public.error_reports force row level security;
grant select, insert on public.error_reports to authenticated;
-- An Edge Function reports its own failures, and it arrives as the service
-- role, which holds BYPASSRLS but not the table privilege. Without this
-- grant the only reports we would ever get are the browser's, which is the
-- half of the system we can already see from the outside.
grant select, insert on public.error_reports to service_role;

-- A member may report a fault in their own studio and read nothing back.
-- No SELECT for a tenant at all: this is our diagnostics, it will carry
-- stack traces from other people's sessions, and a studio that could read
-- it would learn things about its own staff that no screen offers.
drop policy if exists error_reports_insert on public.error_reports;
create policy error_reports_insert on public.error_reports
  for insert to authenticated
  with check (business_id is null or app.in_scope(business_id, null));

drop policy if exists error_reports_select on public.error_reports;
create policy error_reports_select on public.error_reports
  for select to authenticated
  using (app.is_platform_admin());

-- and no UPDATE or DELETE policy, so nobody edits the record of a fault.

-- A NOTE FOR WHOEVER WRITES THE CLIENT. There is no SELECT for a tenant, so
-- an insert must not ask for the row back: PostgREST's `return=representation`
-- and SQL's RETURNING both run the SELECT policy, and a policy that refuses
-- turns a perfectly good write into "new row violates row-level security
-- policy". The same trap swallowed the first audit_log write in Batch E.
comment on table public.error_reports is
  'What broke, reported by the browser or by an Edge Function. Append-only. '
  'source is stamped by the database: a client cannot claim to be the server. '
  'Two hundred rows an hour per studio, after which further reports are '
  'dropped silently, because a broken page must not be able to post its own loop.';

-- ---------------------------------------------------------------------
-- 2. A studio can leave
-- ---------------------------------------------------------------------
-- Closing is not deleting, and the gap between them is the point. A studio
-- that closes keeps everything for thirty days: the owner can still export
-- it, can change their mind, and our own books still say what we billed
-- and who referred them. Only after the thirty days, and only by us, does
-- anything actually go.
alter table public.businesses
  add column if not exists closed_at     timestamptz,
  add column if not exists closed_by     uuid,
  add column if not exists closed_reason text,
  add column if not exists purge_after   timestamptz;

-- A membership is closed WITH THE STUDIO and remembers what it was, so
-- reopening restores the person who was suspended as suspended rather than
-- promoting them back to active.
alter table public.memberships add column if not exists closed_from text;
alter table public.memberships drop constraint if exists memberships_status_check;
alter table public.memberships add constraint memberships_status_check
  check (status in ('active','invited','suspended','closed'));

-- WHY CLOSING THE MEMBERSHIPS IS THE WHOLE ENFORCEMENT.
-- app.in_scope, app.can and app.is_owner all require an active membership,
-- and every policy in this database goes through one of them. Setting the
-- memberships to closed therefore stops reads and writes everywhere at
-- once, with no policy surgery and nothing to keep in step. It also means
-- the owner can no longer prove they are the owner, which is exactly why
-- the closed-studio operations below identify their caller by
-- businesses.closed_by instead.
create or replace function app.close_studio(p_business uuid, p_reason text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_purge timestamptz; v_status text;
begin
  if not app.is_owner(p_business) then
    raise exception 'only the owner can close a studio' using errcode = '42501';
  end if;
  select status into v_status from public.businesses where id = p_business for update;
  if v_status is null then
    raise exception 'no such studio' using errcode = '42704';
  end if;
  if v_status <> 'active' then
    raise exception 'this studio is already %', v_status using errcode = '42P10';
  end if;

  v_purge := now() + interval '30 days';
  update public.businesses
     set status = 'closed', closed_at = now(), closed_by = auth.uid(),
         closed_reason = left(p_reason, 500), purge_after = v_purge
   where id = p_business;

  update public.memberships
     set closed_from = status, status = 'closed'
   where business_id = p_business and status <> 'closed';

  insert into public.audit_log (business_id, action, detail)
  values (p_business, 'Studio closed', coalesce(left(p_reason,200), 'no reason given'));

  return jsonb_build_object(
    'closed', true, 'purge_after', v_purge,
    'note', 'Everything is kept until the purge date. Reopening restores it.');
end $$;

-- Reopening is for the person who closed it, or for us. It cannot be for
-- "the owner", because closing took that away by design.
create or replace function app.reopen_studio(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare b record;
begin
  select * into b from public.businesses where id = p_business for update;
  if b.id is null then
    raise exception 'no such studio' using errcode = '42704';
  end if;
  if not (app.is_platform_admin()
          or (b.closed_by is not null and b.closed_by = auth.uid())) then
    raise exception 'only the person who closed this studio can reopen it'
      using errcode = '42501';
  end if;
  if b.status <> 'closed' then
    raise exception 'this studio is not closed' using errcode = '42P10';
  end if;
  if b.purge_after is not null and now() > b.purge_after then
    raise exception 'the thirty days are up; this studio can no longer be reopened here'
      using errcode = '42P10';
  end if;

  update public.businesses
     set status = 'active', closed_at = null, closed_by = null,
         closed_reason = null, purge_after = null
   where id = p_business;

  update public.memberships
     set status = coalesce(nullif(closed_from,''), 'active'), closed_from = null
   where business_id = p_business and status = 'closed';

  insert into public.audit_log (business_id, action, detail)
  values (p_business, 'Studio reopened', '');

  return jsonb_build_object('reopened', true);
end $$;

-- WHAT WE KEEP WHEN A STUDIO GOES. partner_referrals and tlb_customers
-- both point at businesses with ON DELETE SET NULL, so a hard delete does
-- not fail: it quietly removes the link between a commission we owe and
-- the studio it was earned on. This row is what survives, written before
-- the delete rather than reconstructed after it.
create table if not exists public.tlb_closed_studios (
  business_id   uuid primary key,
  name          text not null,
  slug          text,
  plan          text,
  created_at    timestamptz,
  closed_at     timestamptz,
  closed_reason text,
  purged_at     timestamptz not null default now(),
  purged_by     uuid,
  row_counts    jsonb not null default '{}'::jsonb
);
alter table public.tlb_closed_studios enable row level security;
alter table public.tlb_closed_studios force row level security;
grant select on public.tlb_closed_studios to authenticated;
drop policy if exists tlb_closed_studios_select on public.tlb_closed_studios;
create policy tlb_closed_studios_select on public.tlb_closed_studios
  for select to authenticated using (app.is_platform_admin());

create or replace function app.purge_studio(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare b record; v_counts jsonb;
begin
  if not app.is_platform_admin() then
    raise exception 'only the platform can purge a studio' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = p_business for update;
  if b.id is null then
    raise exception 'no such studio' using errcode = '42704';
  end if;
  if b.status <> 'closed' then
    raise exception 'a studio must be closed before it can be purged' using errcode = '42P10';
  end if;
  if b.purge_after is null or now() < b.purge_after then
    raise exception 'the grace period has not run out yet' using errcode = '42P10';
  end if;

  v_counts := jsonb_build_object(
    'orders',       (select count(*) from public.orders       where business_id = p_business),
    'customers',    (select count(*) from public.customers    where business_id = p_business),
    'transactions', (select count(*) from public.transactions where business_id = p_business),
    'memberships',  (select count(*) from public.memberships  where business_id = p_business),
    'app_state',    (select count(*) from public.app_state    where business_id = p_business));

  insert into public.tlb_closed_studios
    (business_id, name, slug, plan, created_at, closed_at, closed_reason, purged_by, row_counts)
  values (b.id, b.name, b.slug, b.plan, b.created_at, b.closed_at, b.closed_reason,
          auth.uid(), v_counts)
  on conflict (business_id) do update
    set purged_at = now(), purged_by = auth.uid(), row_counts = excluded.row_counts;

  delete from public.businesses where id = p_business;

  return jsonb_build_object('purged', true, 'kept', v_counts);
end $$;

-- ---------------------------------------------------------------------
-- 3. The studio's own data, all of it, from the server
-- ---------------------------------------------------------------------
-- The app already exports what the browser is holding. That is not the
-- same as the studio's data: a manager's device never held the costs, a
-- workroom device never held the phone numbers, and no device holds more
-- than the last six hundred lines of the audit trail. This is the owner's
-- copy, assembled where all of it is visible.
create or replace function app.export_studio(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare b record; j jsonb;
begin
  select * into b from public.businesses where id = p_business;
  if b.id is null then
    raise exception 'no such studio' using errcode = '42704';
  end if;
  -- An active studio's owner, or the person who closed it, within the
  -- grace period. Somebody leaving must be able to take their data with
  -- them AFTER they have closed the account, because that is when they
  -- will think to ask for it.
  if not (app.is_owner(p_business)
          or app.is_platform_admin()
          or (b.status = 'closed' and b.closed_by is not null and b.closed_by = auth.uid()
              and (b.purge_after is null or now() <= b.purge_after))) then
    raise exception 'only the owner of this studio can export it' using errcode = '42501';
  end if;

  j := jsonb_build_object(
    '_app', 'The Label Board',
    '_export', 'studio',
    '_version', 2,
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
end $$;

-- ---------------------------------------------------------------------
-- 4. A person can leave
-- ---------------------------------------------------------------------
-- The refusal is the feature. Deleting the last owner of a studio that is
-- still running leaves a business nobody can administer, which is not a
-- thing to discover afterwards.
--
-- AND ALMOST EVERYBODY IS IN THAT POSITION, which the lifecycle suite found
-- the first time it ran. Signing up provisions a studio, so anybody who
-- arrived by signing up rather than by invitation is the sole owner of at
-- least one. A refusal alone would therefore mean nobody could ever delete
-- their account without first working out what a "studio" was and closing
-- it. So the caller says which they mean: refuse and tell me, or close them
-- on the way out. Closing still gives each studio the thirty days, so
-- nothing is destroyed by saying yes in a hurry.
create or replace function app.delete_my_account(p_close_solely_owned boolean default false)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_stuck text; v_closed text[] := '{}'; b record; v_left int;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  for b in
    select m.business_id, bz.name
      from public.memberships m
      join public.businesses bz on bz.id = m.business_id
     where m.user_id = v_uid and m.role = 'owner' and m.status = 'active'
       and bz.status = 'active'
       and not exists (
         select 1 from public.memberships o
          where o.business_id = m.business_id and o.user_id <> v_uid
            and o.role = 'owner' and o.status = 'active')
  loop
    if not p_close_solely_owned then
      v_stuck := concat_ws(', ', v_stuck, b.name);
    else
      perform app.close_studio(b.business_id, 'owner deleted their account');
      v_closed := v_closed || b.name;
    end if;
  end loop;

  if v_stuck is not null and v_stuck <> '' then
    raise exception 'you are the only owner of %; hand it to somebody else, or ask to close it as you go', v_stuck
      using errcode = '42501';
  end if;

  insert into public.audit_log (business_id, action, detail)
  select m.business_id, 'Member deleted their own account', ''
    from public.memberships m where m.user_id = v_uid;

  delete from public.memberships where user_id = v_uid;
  delete from public.profiles    where id = v_uid;
  select count(*) into v_left from public.memberships where user_id = v_uid;

  return jsonb_build_object('deleted', true, 'memberships_left', v_left,
                            'studios_closed', to_jsonb(v_closed));
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
-- Every one of these is browser-callable, so it is exposed in public and
-- granted to authenticated only. The revoke is belt to the braces; the
-- actual gate is each function's first line, because Supabase grants
-- execute on new functions in public to anon and authenticated by default
-- and revoking from PUBLIC does not take those away.
create or replace function public.close_studio(p_business uuid, p_reason text default null)
returns jsonb language sql security definer
set search_path = public, pg_temp as $$ select app.close_studio(p_business, p_reason) $$;

create or replace function public.reopen_studio(p_business uuid)
returns jsonb language sql security definer
set search_path = public, pg_temp as $$ select app.reopen_studio(p_business) $$;

create or replace function public.export_studio(p_business uuid)
returns jsonb language sql security definer
set search_path = public, pg_temp as $$ select app.export_studio(p_business) $$;

create or replace function public.delete_my_account(p_close_solely_owned boolean default false)
returns jsonb language sql security definer
set search_path = public, pg_temp as $$ select app.delete_my_account(p_close_solely_owned) $$;

create or replace function public.purge_studio(p_business uuid)
returns jsonb language sql security definer
set search_path = public, pg_temp as $$ select app.purge_studio(p_business) $$;

revoke all on function public.close_studio(uuid, text)  from public, anon;
revoke all on function public.reopen_studio(uuid)       from public, anon;
revoke all on function public.export_studio(uuid)       from public, anon;
revoke all on function public.delete_my_account(boolean) from public, anon;
revoke all on function public.purge_studio(uuid)        from public, anon;
grant execute on function public.close_studio(uuid, text) to authenticated;
grant execute on function public.reopen_studio(uuid)      to authenticated;
grant execute on function public.export_studio(uuid)      to authenticated;
grant execute on function public.delete_my_account(boolean) to authenticated;
grant execute on function public.purge_studio(uuid)       to authenticated;

revoke all on function app.close_studio(uuid, text) from public, anon, authenticated;
revoke all on function app.reopen_studio(uuid)      from public, anon, authenticated;
revoke all on function app.export_studio(uuid)      from public, anon, authenticated;
revoke all on function app.delete_my_account(boolean) from public, anon, authenticated;
revoke all on function app.purge_studio(uuid)       from public, anon, authenticated;
revoke all on function app.stamp_error_report()     from public, anon, authenticated;

revoke all on function app.error_reports_recently(uuid) from public, anon;
grant execute on function app.error_reports_recently(uuid) to authenticated, service_role;
