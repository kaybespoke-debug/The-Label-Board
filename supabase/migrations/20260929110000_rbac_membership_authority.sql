-- =====================================================================
-- BATCH A, second half — only an owner writes a membership
--
-- FOUND BY tools/rbac_batch_a_probe.js, which is why it was written before
-- the batch was called done: a MANAGER pointed their own membership at the
-- owner role and came back with 44 permissions. 200 OK.
--
-- memberships_update was app.is_business_admin, which counts managers. That
-- was defensible while a membership carried only a tier a manager could not
-- usefully change. The moment it carries role_id it IS the assignment half
-- of the permission system, and the people it governs were allowed to write
-- it. RBAC_DESIGN.md section 4, rows 6-9.
--
-- Three invariants, each a way a permission system eats itself:
--   nobody edits their own membership         (not even the owner)
--   only an owner edits anybody's             (a manager is not an admin)
--   a studio always keeps one active owner    (whoever is asking)
-- =====================================================================

-- anything the probe left pointing at a role above its tier
update public.memberships m
set role_id = (select r.id from public.business_roles r
               where r.business_id = m.business_id and r.key = m.role)
where m.role_id in (select id from public.business_roles where key = 'owner')
  and m.role <> 'owner';

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select using (user_id = auth.uid() or app.can(business_id, 'team.view'));

drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships
  for insert with check (app.is_owner(business_id));

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships
  for update using (app.is_owner(business_id) and user_id <> auth.uid())
  with check (app.is_owner(business_id) and user_id <> auth.uid());

drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships
  for delete using (app.is_owner(business_id) and user_id <> auth.uid());

create or replace function app.guard_last_owner()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
declare v_biz uuid; v_left int;
begin
  /* BROWSERS ONLY, and this is a retreat from where it started.
     It first held for everybody including the service role, on the argument
     that the console is not exempt from leaving somebody able to run the
     place. Two things then said otherwise. A studio being deleted cascades
     to its memberships and the last owner's row goes with it, so a studio
     could not be deleted at all. And team_invite_harness clears its fixtures
     with one delete across every membership, which is exactly what an
     operator offboarding a studio would do.

     For a browser the invariant is nearly unreachable anyway — a membership
     write is owner-only and never your own row, so an owner cannot remove
     themselves and cannot be the last one removed by somebody else. This is
     belt to that brace.

     ACCEPTED LIMITATION, recorded rather than hidden: the platform can leave
     a studio without an owner. admin-api writes every call to tlb_audit_log,
     and no console screen offers it, but nothing in the database refuses it. */
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  v_biz := coalesce(old.business_id, new.business_id);
  /* THE STUDIO ITSELF IS GOING. businesses cascades to memberships and the
     parent row is deleted first, so a missing business means this row is
     being swept up rather than somebody being removed from a studio that
     will still be there tomorrow. Without this a studio could never be
     deleted at all — caught by team_invite_harness, which tears its own
     fixtures down. */
  if tg_op = 'DELETE' and not exists (select 1 from public.businesses b where b.id = v_biz) then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and new.role = 'owner' and new.status = 'active'
     and old.role = 'owner' and old.status = 'active' then
    return new;
  end if;
  if old.role <> 'owner' or old.status <> 'active' then
    return coalesce(new, old);
  end if;
  select count(*) into v_left
  from public.memberships m
  where m.business_id = v_biz and m.role = 'owner' and m.status = 'active'
    and m.id <> old.id;
  if v_left = 0 then
    raise exception 'A studio must keep at least one owner'
      using errcode = '23514',
            hint = 'Make somebody else an owner first, then change this one.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists memberships_last_owner_guard on public.memberships;
create trigger memberships_last_owner_guard
  before update or delete on public.memberships
  for each row execute function app.guard_last_owner();

comment on function app.guard_last_owner() is
  'The last active owner of a studio cannot be demoted, suspended or removed. '
  'Applies to the service role too: the console is not exempt from leaving '
  'somebody able to run the place.';

-- ---------------------------------------------------------------------
-- Public wrappers. The app schema is not exposed to PostgREST, so the
-- browser and the probes need a door. Same pattern as the invitation
-- wrappers: security INVOKER, no authority of its own.
-- ---------------------------------------------------------------------
create or replace function public.can(p_business uuid, p_perm text)
returns boolean language sql stable security invoker
set search_path = public, pg_temp as $$ select app.can(p_business, p_perm); $$;
revoke all on function public.can(uuid, text) from public, anon;
grant execute on function public.can(uuid, text) to authenticated, service_role;

create or replace function public.my_permissions(p_business uuid)
returns table (permission_key text)
language sql stable security definer
set search_path = public, pg_temp as $$
  select c.key from public.permission_catalogue c where app.is_owner(p_business)
  union
  select p.permission_key
  from public.memberships m
  join public.business_role_permissions p on p.role_id = m.role_id
  where m.user_id = auth.uid() and m.business_id = p_business and m.status = 'active';
$$;
revoke all on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated, service_role;

create or replace function public.my_membership(p_business uuid)
returns table (role_id uuid, role_key text, role_name text, tier text, branch_id uuid)
language sql stable security definer
set search_path = public, pg_temp as $$
  select m.role_id, r.key, r.name, m.role, m.branch_id
  from public.memberships m
  left join public.business_roles r on r.id = m.role_id
  where m.user_id = auth.uid() and m.business_id = p_business and m.status = 'active'
  limit 1;
$$;
revoke all on function public.my_membership(uuid) from public, anon;
grant execute on function public.my_membership(uuid) to authenticated, service_role;

comment on function public.my_permissions(uuid) is
  'Everything this person may do in this studio, resolved from their membership '
  'role. The owner tier returns the whole catalogue without the permission table '
  'being consulted, so no edit to a role can lock an owner out.';
