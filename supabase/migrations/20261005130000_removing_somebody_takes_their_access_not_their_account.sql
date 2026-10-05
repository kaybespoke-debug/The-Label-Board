-- ===========================================================================
-- REMOVE FROM STUDIO MEANS THE MEMBERSHIP, NOT THE PERSON.
--
-- Kayode's decision, 5 October: removing somebody takes away the membership.
-- Their account survives, they are signed out of every device and lose access
-- immediately, and their past work stays attributed to them.
--
-- WHAT THE CODE DID INSTEAD. team-admin's `delete` action removed the
-- membership, and then, if that studio was the only one they belonged to, it
-- deleted their profile and called auth.admin.deleteUser. So removing a
-- tailor from the only studio they worked in destroyed their account. There
-- is no undo for that, and being re-invited later would have meant a new
-- account and a new password.
--
-- WHY THIS NEEDS A DATABASE FUNCTION AT ALL. Two of the three parts need
-- nothing: the membership delete is an ordinary write, and attribution is
-- already safe because nothing in this database has a foreign key to
-- `profiles` or `memberships` -- work is attributed to `staff.id`, which
-- belongs to the studio rather than to the account (attendance.staff_id,
-- orders.assigned_to, tlb_commissions.staff_id). Checked on production:
-- eleven foreign keys point at auth.users, none at profiles or memberships.
--
-- The third part does. "Signed out of every device" means destroying their
-- sessions, which live in `auth.sessions` -- and PostgREST only exposes the
-- schemas in its search path, so an Edge Function holding the service role
-- key cannot reach the auth schema over HTTP at all. There is also no GoTrue
-- admin endpoint that logs a user out by id: the client's admin.signOut()
-- wants that user's own JWT, which we do not have and should not have.
--
-- So: one function, in public so PostgREST can see it, callable by nothing
-- except the service role.
--
-- WITHOUT IT, WHAT ACTUALLY HAPPENS. Not nothing, which is worth writing
-- down. Every policy in this schema reads `memberships` through app.can() and
-- app.in_scope(), so the moment the row is gone every read and every write is
-- refused -- they lose the DATA immediately whatever their token says. What
-- survives is the session: they stay signed in to an account that can see
-- nothing, and the app, which enters from a stored session on its own, would
-- show them a studio-shaped shell with nothing in it. Revoking the session is
-- what turns that into a sign-in screen.
-- ===========================================================================

create or replace function app.revoke_all_sessions(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_gone integer := 0;
begin
  if p_user is null then
    return 0;
  end if;

  /* DYNAMIC ON PURPOSE. Every other suite in this repository runs the
     migrations against a bare Postgres with a stubbed auth schema that has
     auth.users and nothing else. A static reference to auth.sessions would
     fail to compile there and take all twenty suites down with it. plpgsql
     does not validate dynamic SQL, and to_regclass answers without raising,
     so this applies to a bare stub and does the work on a real project. */
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
    get diagnostics v_gone = row_count;
  end if;

  /* Belt and braces. On a current GoTrue refresh_tokens.session_id cascades
     from the delete above, but it has not always, and a refresh token that
     outlives its session is exactly the thing that would let somebody back
     in after being removed. */
  if to_regclass('auth.refresh_tokens') is not null then
    /* Its own begin/end, because an exception handler attaches to a block and
       not to an `if`. */
    begin
      execute 'delete from auth.refresh_tokens where user_id = $1::text'
        using p_user;
    exception when others then
      /* The column has been uuid and text in different GoTrue versions, and
         the session delete above is the one that matters and has already
         happened. Swallowing here must not lose that. */
      null;
    end;
  end if;

  return v_gone;
end;
$fn$;

/* The wrapper PostgREST can see. It does nothing but forward, so there is one
   body to read and one place the delete happens. */
create or replace function public.revoke_all_sessions(p_user uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $fn$ select app.revoke_all_sessions(p_user); $fn$;

-- ---------------------------------------------------------------------------
-- AND NOBODY MAY CALL IT BUT THE SERVICE ROLE.
--
-- Supabase ships `alter default privileges in schema public grant all on
-- functions to anon, authenticated` on every project, so a new function in
-- public is EXECUTABLE BY THE PUBLIC ANON KEY from the moment it exists. This
-- one signs anybody out of everything. Revoking from `public` alone does NOT
-- undo a grant made directly to a role, which is the trap that has already
-- cost this repository one incident, so each role is named.
--
-- storage_rls_harness and tlb_policy_harness both check grants rather than
-- calls, because a call that fails for the wrong reason looks identical to a
-- call that is refused.
-- ---------------------------------------------------------------------------
revoke all on function app.revoke_all_sessions(uuid)    from public, anon, authenticated;
revoke all on function public.revoke_all_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_all_sessions(uuid) to service_role;

comment on function public.revoke_all_sessions(uuid) is
  'Destroys every session for one account, so a person removed from a studio '
  'is signed out of every device rather than left holding a token. Service '
  'role only: it is called by team-admin AFTER that function has established '
  'the caller is an owner of the studio the target belongs to.';
