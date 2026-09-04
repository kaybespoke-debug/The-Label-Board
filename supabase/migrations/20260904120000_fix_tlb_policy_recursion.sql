-- =====================================================================
-- Four console tables were unreadable by any signed-in user.
--
-- staff_management wrote policies on tlb_staff whose USING clause reads
-- tlb_staff:
--
--   create policy owner_can_read_all_staff on public.tlb_staff
--     using (exists (select 1 from public.tlb_staff
--                    where auth_user_id = auth.uid() and role = 'owner'));
--
-- To decide whether a row of tlb_staff is visible, Postgres runs the
-- policy; the policy reads tlb_staff, which runs the policy. Postgres
-- detects the loop and raises 42P17 rather than answering. So every
-- select against tlb_staff failed, and so did tlb_commissions,
-- tlb_support_tickets and tlb_tasks, whose policies look up tlb_staff to
-- find out who is asking.
--
-- It stayed hidden because the operator console reaches these tables
-- through admin-api under the service role, which holds BYPASSRLS and so
-- never evaluates a policy. The tables were broken for every other
-- caller, and the first direct query from a browser would have found it.
--
-- The fix is the one already used by app.in_scope: put the lookup in a
-- SECURITY DEFINER function. The function's own reads are not subject to
-- tlb_staff's RLS, so the loop is broken at the point where it starts.
-- search_path is pinned, because a SECURITY DEFINER function with a
-- mutable search_path is a privilege escalation waiting to happen.
--
-- Who can see what is deliberately unchanged. This migration fixes the
-- recursion and nothing else, so it can be reasoned about on its own.
--
-- Two smaller corrections ride along, both about not depending on the
-- platform's defaults:
--
--   * The policies below say `to authenticated`. The originals named no
--     role, which in Postgres means PUBLIC, which includes anon. The
--     predicates all resolve false for anon, so nothing was reachable —
--     but a policy that says who it is for cannot be widened by accident.
--
--   * anon is revoked explicitly on every tlb_ table. Supabase grants
--     anon and authenticated blanket privileges on new tables in public,
--     and these tables never revoked them; they were relying on an
--     absence that a bare Postgres has and Supabase does not. RLS was
--     holding the line by itself. Now the grant is gone too.
--
-- That second point is why a test suite on bare Postgres could not have
-- caught this: the harnesses build a database that never had the default
-- grants in the first place. audit_tlb_policies.js checks it directly.
-- =====================================================================

-- Who is asking, resolved without re-entering tlb_staff's own policies.
create or replace function app.tlb_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id from public.tlb_staff s where s.auth_user_id = auth.uid() limit 1;
$$;

create or replace function app.is_tlb_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tlb_staff s
    where s.auth_user_id = auth.uid() and s.role = 'owner'
  );
$$;

revoke all on function app.tlb_staff_id() from public;
revoke all on function app.is_tlb_owner() from public;
grant execute on function app.tlb_staff_id() to authenticated, service_role;
grant execute on function app.is_tlb_owner() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- tlb_staff
-- ---------------------------------------------------------------------
drop policy if exists "authenticated_can_read_own_staff_profile" on public.tlb_staff;
drop policy if exists "owner_can_read_all_staff"                 on public.tlb_staff;
drop policy if exists "owner_can_manage_staff"                   on public.tlb_staff;
drop policy if exists "owner_can_update_staff"                   on public.tlb_staff;

-- Your own row, or every row if you are the owner. Same rule as before,
-- expressed so that reading it does not require reading it.
create policy tlb_staff_select on public.tlb_staff
  for select to authenticated
  using (auth_user_id = auth.uid() or app.is_tlb_owner());

create policy tlb_staff_insert on public.tlb_staff
  for insert to authenticated
  with check (app.is_tlb_owner());

create policy tlb_staff_update on public.tlb_staff
  for update to authenticated
  using (app.is_tlb_owner())
  with check (app.is_tlb_owner());

-- ---------------------------------------------------------------------
-- tlb_commissions
-- ---------------------------------------------------------------------
drop policy if exists "sales_can_read_own_commissions" on public.tlb_commissions;
drop policy if exists "owner_can_read_all_commissions" on public.tlb_commissions;
drop policy if exists "owner_can_manage_commissions"   on public.tlb_commissions;

create policy tlb_commissions_select on public.tlb_commissions
  for select to authenticated
  using (staff_id = app.tlb_staff_id() or app.is_tlb_owner());

create policy tlb_commissions_insert on public.tlb_commissions
  for insert to authenticated
  with check (app.is_tlb_owner());

-- ---------------------------------------------------------------------
-- tlb_support_tickets
-- ---------------------------------------------------------------------
drop policy if exists "support_can_read_assigned_tickets" on public.tlb_support_tickets;
drop policy if exists "support_can_update_tickets"        on public.tlb_support_tickets;

create policy tlb_support_tickets_select on public.tlb_support_tickets
  for select to authenticated
  using (assigned_to = app.tlb_staff_id() or app.is_tlb_owner());

-- The original had USING and no WITH CHECK, which lets somebody reassign a
-- ticket away from themselves and lose sight of it. WITH CHECK mirrors
-- USING so a row cannot be edited into a state its editor could not see.
create policy tlb_support_tickets_update on public.tlb_support_tickets
  for update to authenticated
  using (assigned_to = app.tlb_staff_id() or app.is_tlb_owner())
  with check (assigned_to = app.tlb_staff_id() or app.is_tlb_owner());

-- ---------------------------------------------------------------------
-- tlb_tasks
-- ---------------------------------------------------------------------
drop policy if exists "staff_can_read_own_tasks"   on public.tlb_tasks;
drop policy if exists "staff_can_update_own_tasks" on public.tlb_tasks;

create policy tlb_tasks_select on public.tlb_tasks
  for select to authenticated
  using (assigned_to = app.tlb_staff_id());

create policy tlb_tasks_update on public.tlb_tasks
  for update to authenticated
  using (assigned_to = app.tlb_staff_id())
  with check (assigned_to = app.tlb_staff_id());

-- ---------------------------------------------------------------------
-- The platform-admin policies could never be true.
--
-- saas_admin wrote thirteen policies shaped like this:
--
--   using (exists (select 1 from public.platform_admins
--                  where platform_admins.id = auth.uid()))
--
-- A subquery inside a policy runs as the caller and is itself subject to
-- RLS. platform_admins has RLS enabled and forced and deliberately has no
-- policy at all — tenant_isolation says so in as many words, because the
-- list of our own staff should not be readable from any browser. So the
-- subquery returns nothing no matter who asks, the exists() is always
-- false, and a signed-in platform admin reading tlb_customers gets zero
-- rows while the rows are sitting there.
--
-- Same story as the recursion: invisible from the console, which reads
-- these through admin-api under the service role and never evaluates a
-- policy. The moment anything queried them from a browser it would have
-- looked like an empty database.
--
-- app.is_platform_admin() was already written for this, in the same
-- migration that locked platform_admins down. It is SECURITY DEFINER, so
-- its lookup is not filtered by the RLS it is trying to answer for.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and tablename like 'tlb\_%'
      -- coalesce BOTH sides: an insert policy has no USING clause, so a
      -- bare `qual || ...` is null for exactly the policies that are
      -- hardest to notice missing.
      and coalesce(qual, '') || coalesce(with_check, '') like '%platform_admins%'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

do $$
declare
  t text;
begin
  -- select and insert everywhere; update only where saas_admin had it.
  foreach t in array array['tlb_customers','tlb_subscriptions','tlb_payments','tlb_pipeline','tlb_notes']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.is_platform_admin())',
      t || '_admin_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.is_platform_admin())',
      t || '_admin_insert', t);
  end loop;

  foreach t in array array['tlb_customers','tlb_subscriptions','tlb_pipeline']
  loop
    execute format(
      'create policy %I on public.%I for update to authenticated using (app.is_platform_admin()) with check (app.is_platform_admin())',
      t || '_admin_update', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Say what anon may have, rather than inheriting it.
-- ---------------------------------------------------------------------
revoke all on public.tlb_customers       from anon;
revoke all on public.tlb_subscriptions   from anon;
revoke all on public.tlb_payments        from anon;
revoke all on public.tlb_pipeline        from anon;
revoke all on public.tlb_notes           from anon;
revoke all on public.tlb_trial_history   from anon;
revoke all on public.tlb_staff           from anon;
revoke all on public.tlb_commissions     from anon;
revoke all on public.tlb_support_tickets from anon;
revoke all on public.tlb_tasks           from anon;
revoke all on public.tlb_audit_log       from anon;

-- Sequences get the same default treatment as tables, and were missed for
-- the same reason. anon holding USAGE on feedback_ref_seq cannot insert a
-- row — the table grant is gone — but it can call nextval() and walk the
-- counter forward, so studios would see their references jump from TLB-2003
-- to TLB-91000 and reasonably wonder what had been deleted.
revoke all on sequence public.feedback_ref_seq      from anon;
revoke all on sequence public.platform_audit_id_seq from anon, authenticated;

-- FORCE so the table owner is subject to its policies too. service_role
-- holds BYPASSRLS, so admin-api still reaches everything it needs.
alter table public.tlb_staff           force row level security;
alter table public.tlb_commissions     force row level security;
alter table public.tlb_support_tickets force row level security;
alter table public.tlb_tasks           force row level security;
alter table public.tlb_customers       force row level security;
alter table public.tlb_subscriptions   force row level security;
alter table public.tlb_payments        force row level security;
alter table public.tlb_pipeline        force row level security;
alter table public.tlb_notes           force row level security;
