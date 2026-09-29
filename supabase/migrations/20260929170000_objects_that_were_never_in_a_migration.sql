-- =====================================================================
-- Sixteen objects that existed on staging and in no migration
-- =====================================================================
-- This repo already learned this lesson once: five objects had been made by
-- hand and were missing from the migrations entirely, so a fresh project
-- would have run none of it. It happened again, in the same way, during
-- Batches E and F — SQL applied straight at the project while the file that
-- was supposed to carry it went out of step.
--
-- Found by comparing the two: build a database from the migrations alone,
-- list every column, function, policy and trigger, and ask the real project
-- for the same list. 753 objects against 769. The sixteen were:
--
--   audit_log.source, audit_log.entity_label      the columns the whole
--                                                 audit-authenticity claim
--                                                 rests on
--   app.audit(...)                                the only writer that can
--                                                 produce a server event
--   app.audit_branches / _business / _invitation
--     / _membership / _permissions                and their five triggers
--   app.stamp_audit_actor                         with the source line that
--                                                 the repo's copy lacked
--   app.migrate_orders_to_rows, public.migrate_my_orders
--   public.account_for_recovery
--
-- The worst of them is the audit layer. tools/sensitive_data_probe.js proves
-- that a client cannot forge a server event — and it was proving it against
-- a column that a fresh project would not have had. The probe was right
-- about the database it was pointed at and would have been meaningless
-- against a new one.
--
-- COPIED, NOT REWRITTEN. Every definition below is pg_get_functiondef and
-- pg_get_triggerdef output from the live project, reformatted only where
-- this file needed the text to be readable. Retyping a shipped function from
-- memory is how three things change that nobody asked for.
--
-- ---------------------------------------------------------------------
-- 1. The two columns
-- ---------------------------------------------------------------------
alter table public.audit_log add column if not exists source text not null default 'client';
alter table public.audit_log add column if not exists entity_label text;
alter table public.audit_log drop constraint if exists audit_log_source_known;
alter table public.audit_log add constraint audit_log_source_known
  check (source in ('client','server'));

comment on column public.audit_log.source is
  'Who wrote this line: a browser, or the database itself. Stamped by '
  'app.stamp_audit_actor from current_user, never by the caller, so a client '
  'cannot present itself as the server.';

-- ---------------------------------------------------------------------
-- 2. The stamping trigger, with the line the repo copy was missing
-- ---------------------------------------------------------------------
-- SECURITY INVOKER, which is load-bearing and was the second bug of this
-- shape in the project. As a DEFINER function current_user is always the
-- owner, so every row looked server-written; as an INVOKER function it is
-- 'authenticated' for a browser and the owner for anything a definer
-- function does on the way past, which is what the distinction means.
create or replace function app.stamp_audit_actor()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is not null then
    new.actor := auth.uid();
  end if;
  new.at := coalesce(new.at, now());
  if current_user in ('authenticated', 'anon') then
    new.source := 'client';
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------
-- 3. The only writer that can produce a server event
-- ---------------------------------------------------------------------
create or replace function app.audit(p_business uuid, p_action text, p_detail text default null::text, p_entity text default null::text, p_entity_id text default null::text, p_entity_label text default null::text, p_branch uuid default null::uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_business is null then return; end if;
  /* THE STUDIO IS GOING. Deleting a business cascades to its memberships and
     its branches, and the AFTER DELETE audit triggers then try to record
     "Member removed" against a business row that has already gone — a
     foreign-key violation that made purge_studio impossible. The same
     mistake and the same fix as app.guard_last_owner: a missing business
     means this row is being swept up rather than somebody doing something.
     Found by the lifecycle drill, which purged a studio for real; it had
     never been tried on the live project either, so this line is the one
     change to a copied definition in this file and it is a fix, not a
     rewrite. What survives a purge is tlb_closed_studios, not a log line
     pointing at nothing. */
  if not exists (select 1 from public.businesses b where b.id = p_business) then
    return;
  end if;
  insert into public.audit_log
    (business_id, branch_id, actor, actor_label, action, detail, entity, entity_id, entity_label, source)
  values (p_business, p_branch, auth.uid(),
          (select p.name from public.profiles p where p.id = auth.uid()),
          p_action, p_detail, p_entity, p_entity_id, p_entity_label, 'server');
end $function$;

-- ---------------------------------------------------------------------
-- 4. The five things the database records whether or not the app asks
-- ---------------------------------------------------------------------
-- These are the events a studio cannot be trusted to report about itself:
-- who was let in, who was made an owner, what a role may do, what the studio
-- is called. They fire on the table rather than in the app, so a write that
-- reaches the database by any route is recorded by the same line of code.
create or replace function app.audit_branches()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    perform app.audit(new.business_id, 'Branch added', new.name, 'branch', new.id::text, new.name);
  elsif tg_op = 'DELETE' then
    perform app.audit(old.business_id, 'Branch removed', old.name, 'branch', old.id::text, old.name);
  elsif new.name is distinct from old.name then
    perform app.audit(new.business_id, 'Branch renamed',
      old.name || ' → ' || new.name, 'branch', new.id::text, new.name);
  end if;
  return coalesce(new, old);
end $function$;

create or replace function app.audit_business()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.name is distinct from old.name then
    perform app.audit(new.id, 'Studio renamed',
      coalesce(old.name, '?') || ' → ' || coalesce(new.name, '?'), 'business', new.id::text, new.name);
  end if;
  if new.plan is distinct from old.plan then
    perform app.audit(new.id, 'Plan changed',
      coalesce(old.plan, '?') || ' → ' || coalesce(new.plan, '?'), 'business', new.id::text, new.name);
  end if;
  if new.status is distinct from old.status then
    perform app.audit(new.id, 'Studio ' || coalesce(new.status, '?'), null, 'business', new.id::text, new.name);
  end if;
  return new;
end $function$;

create or replace function app.audit_invitation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    perform app.audit(new.business_id, 'Invitation sent', new.email || ' as ' || new.role,
      'invitation', new.id::text, new.email, new.branch_id);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform app.audit(new.business_id, 'Invitation ' || new.status, new.email,
      'invitation', new.id::text, new.email, new.branch_id);
  end if;
  return new;
end $function$;

create or replace function app.audit_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_who text; v_role text;
begin
  select coalesce(p.name, u.email) into v_who
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = coalesce(new.user_id, old.user_id);
  select r.name into v_role from public.business_roles r where r.id = new.role_id;

  if tg_op = 'INSERT' then
    perform app.audit(new.business_id, 'Member added',
      coalesce(v_who, 'somebody') || ' as ' || coalesce(v_role, new.role),
      'member', new.user_id::text, v_who, new.branch_id);
  elsif tg_op = 'DELETE' then
    perform app.audit(old.business_id, 'Member removed',
      coalesce(v_who, 'somebody'), 'member', old.user_id::text, v_who, old.branch_id);
  else
    if new.role_id is distinct from old.role_id or new.role is distinct from old.role then
      perform app.audit(new.business_id, 'Role changed',
        coalesce(v_who, 'somebody') || ' → ' || coalesce(v_role, new.role),
        'member', new.user_id::text, v_who, new.branch_id);
    end if;
    if new.branch_id is distinct from old.branch_id then
      perform app.audit(new.business_id, 'Branch access changed',
        coalesce(v_who, 'somebody'), 'member', new.user_id::text, v_who, new.branch_id);
    end if;
    if new.status is distinct from old.status then
      perform app.audit(new.business_id, 'Member ' || new.status,
        coalesce(v_who, 'somebody'), 'member', new.user_id::text, v_who, new.branch_id);
    end if;
  end if;
  return coalesce(new, old);
end $function$;

create or replace function app.audit_permissions()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_biz uuid; v_role text;
begin
  select r.business_id, r.name into v_biz, v_role
  from public.business_roles r where r.id = coalesce(new.role_id, old.role_id);
  if v_biz is null then return coalesce(new, old); end if;
  perform app.audit(v_biz,
    case when tg_op = 'INSERT' then 'Permission granted' else 'Permission removed' end,
    coalesce(new.permission_key, old.permission_key) || ' → ' || coalesce(v_role, 'a role'),
    'role', coalesce(new.role_id, old.role_id)::text, v_role);
  return coalesce(new, old);
end $function$;

drop trigger if exists audit_branches_t on public.branches;
create trigger audit_branches_t after insert or delete or update on public.branches
  for each row execute function app.audit_branches();

drop trigger if exists audit_businesses on public.businesses;
create trigger audit_businesses after update on public.businesses
  for each row execute function app.audit_business();

drop trigger if exists audit_invitations on public.team_invitations;
create trigger audit_invitations after insert or update on public.team_invitations
  for each row execute function app.audit_invitation();

drop trigger if exists audit_memberships on public.memberships;
create trigger audit_memberships after insert or delete or update on public.memberships
  for each row execute function app.audit_membership();

drop trigger if exists audit_role_permissions on public.business_role_permissions;
create trigger audit_role_permissions after insert or delete on public.business_role_permissions
  for each row execute function app.audit_permissions();

-- ---------------------------------------------------------------------
-- 5. Moving a studio's orders out of the blob and into rows
-- ---------------------------------------------------------------------
-- Repeatable, owner-only, and it deletes nothing: the blob stays until the
-- rows have been read back. It returns both sides — the count and the money
-- total from the blob and from the rows — so the caller can compare rather
-- than hope. That is what made its own first bug visible, when SELECT INTO
-- with no row set NULL and it reported zero orders as a success.
create or replace function app.migrate_orders_to_rows(p_business uuid)
returns table(blob_orders integer, rows_before integer, rows_after integer, blob_total numeric, rows_total numeric, costs_written integer, matched boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_blob   jsonb := '[]'::jsonb;
  v_done   jsonb := '[]'::jsonb;
  v_all    jsonb;
  v_before int;
  v_costs  int := 0;
  e        jsonb;
  v_branch uuid;
  v_id     uuid;
  v_cost   numeric;
begin
  select count(*) into v_before from public.orders o where o.business_id = p_business;

  v_blob := coalesce((select data from public.app_state
                      where business_id = p_business and key = 'layi_dash_orders'), '[]'::jsonb);
  v_done := coalesce((select data from public.app_state
                      where business_id = p_business and key = 'layi_dash_orders_done'), '[]'::jsonb);

  if jsonb_typeof(v_blob) <> 'array' then v_blob := '[]'::jsonb; end if;
  if jsonb_typeof(v_done) <> 'array' then v_done := '[]'::jsonb; end if;
  v_all := v_blob || v_done;

  for e in select jsonb_array_elements(v_all) loop
    if coalesce(e->>'id', '') = '' then
      continue;
    end if;

    v_branch := null;
    if coalesce(e->>'branch', '') <> '' then
      select b.id into v_branch from public.branches b
      where b.business_id = p_business
        and lower(btrim(b.name)) = lower(btrim(e->>'branch'))
      limit 1;
    end if;

    insert into public.orders
      (business_id, branch_id, app_id, ref, status, total, doc, created_at)
    values (
      p_business, v_branch, e->>'id',
      nullif(e->>'invoiceNo', ''),
      coalesce(nullif(e->>'status', ''), 'open'),
      coalesce((e->>'total')::numeric, 0),
      (e - 'cost' - 'email' - 'phone' - 'whatsapp'),
      coalesce((e->>'createdAt')::timestamptz, now())
    )
    on conflict (business_id, app_id) do update
      set doc = excluded.doc,
          branch_id = excluded.branch_id,
          ref = excluded.ref,
          status = excluded.status,
          total = excluded.total
    returning id into v_id;

    v_cost := coalesce((e->>'cost')::numeric, 0);
    if v_cost <> 0 then
      insert into public.order_costs (order_id, business_id, branch_id, cost)
      values (v_id, p_business, v_branch, v_cost)
      on conflict (order_id) do update set cost = excluded.cost, updated_at = now();
      v_costs := v_costs + 1;
    end if;
  end loop;

  return query
  select
    jsonb_array_length(v_all),
    v_before,
    (select count(*)::int from public.orders o where o.business_id = p_business),
    (select coalesce(sum(coalesce((x->>'total')::numeric, 0)), 0) from jsonb_array_elements(v_all) x),
    (select coalesce(sum(o.total), 0) from public.orders o where o.business_id = p_business),
    v_costs,
    (select count(*)::int from public.orders o where o.business_id = p_business) >= jsonb_array_length(v_all);
end;
$function$;

create or replace function public.migrate_my_orders(p_business uuid)
returns table(blob_orders integer, rows_before integer, rows_after integer, blob_total numeric, rows_total numeric, costs_written integer, matched boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not app.is_owner(p_business) then
    raise exception 'Only the studio owner can move the studio onto the new store'
      using errcode = '42501';
  end if;
  return query select * from app.migrate_orders_to_rows(p_business);
end $function$;

-- ---------------------------------------------------------------------
-- 6. What auth-recover is allowed to know about an address
-- ---------------------------------------------------------------------
-- Two booleans and nothing else: whether the account is confirmed, which
-- decides between a reset link and an invitation, and whether one was sent
-- in the last minute. Granted to the service role only, because the whole
-- point of auth-recover is that the browser learns nothing about whether an
-- address exists.
create or replace function public.account_for_recovery(p_email text)
returns table(confirmed boolean, recently_sent boolean)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select (u.email_confirmed_at is not null) as confirmed,
         (u.recovery_sent_at is not null and u.recovery_sent_at > now() - interval '1 minute') as recently_sent
  from auth.users u
  where lower(btrim(u.email)) = lower(btrim(p_email))
    and u.deleted_at is null
  limit 1;
$function$;

revoke all on function public.account_for_recovery(text) from public, anon, authenticated;
grant execute on function public.account_for_recovery(text) to service_role;

revoke all on function public.migrate_my_orders(uuid) from public, anon;
grant execute on function public.migrate_my_orders(uuid) to authenticated, service_role;

revoke all on function app.audit(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function app.migrate_orders_to_rows(uuid) from public, anon, authenticated;
revoke all on function app.audit_branches()    from public, anon, authenticated;
revoke all on function app.audit_business()    from public, anon, authenticated;
revoke all on function app.audit_invitation()  from public, anon, authenticated;
revoke all on function app.audit_membership()  from public, anon, authenticated;
revoke all on function app.audit_permissions() from public, anon, authenticated;
