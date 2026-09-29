-- =====================================================================
-- PHASE 0 — A STUDIO CANNOT PROMOTE ITSELF
--
-- MEASURED FIRST. tools/rbac_phase0_probe.js, a real session for a real
-- member, straight to PostgREST with no app in the path:
--
--   a manager  rewrote the studio's permission table   200, landed
--   a staff    rewrote the studio's permission table   200, landed
--   a VIEWER   rewrote the studio's permission table   200, landed
--   a viewer   set their own profiles.role_id='owner'  200, accepted
--
-- Eight failing assertions before this file existed. The elevation gave
-- the caller's own role finance, payroll, profit, the audit trail and
-- Accounts & roles.
--
-- TWO HOLES, AND CLOSING ONE DOES NOT CLOSE THE OTHER.
--
--   THE TABLE.  What every role may do lives in app_state under
--               layi_dash_roles, and app_state's RLS is in_scope — any
--               active member may write it. The permission table was
--               inside the data it governs, writable by the people it
--               restricts.
--
--   THE NAME.   Which role somebody holds is profiles.role_id, and
--               profiles_update_self lets anybody update their own row.
--               No policy reads it, so the claim bought nothing at the
--               database — but the APP reads it for every permission
--               decision, and Phase 2 will teach the database to care.
--               A field that must never be authority should not be
--               writable by the person it describes.
--
-- HOW TO TELL A BROWSER FROM THE PLATFORM, and the first version of this
-- file got it wrong in a way worth writing down.
--
-- It asked `current_user in ('authenticated','anon')`. Inside a SECURITY
-- DEFINER function current_user is the function's OWNER, so it was
-- 'postgres' on every call, the guard returned early every time, and the
-- probe still reported eight failures against a trigger that was installed
-- and running. Proved rather than guessed: a probe function returned
-- current_user=postgres, session_user=authenticator, jwt role=authenticated
-- for an ordinary member's request.
--
-- So the two guards ask different questions, because they are in different
-- positions:
--
--   app_state   SECURITY DEFINER, and asks the JWT's role claim. Nothing
--               but a browser writes app_state — no definer function does
--               — so 'authenticated' and 'anon' are held to the rule and
--               'service_role' and a direct connection are not.
--
--   profiles    SECURITY INVOKER, and asks current_user. It has to be:
--               public.accept_invitation is SECURITY DEFINER and writes
--               role_id and business_id while running as the INVITEE, with
--               that person's own JWT. Asking the JWT would refuse a
--               legitimate acceptance. Asking current_user distinguishes
--               exactly what matters — 'authenticated' at the top of a
--               request, 'postgres' inside a definer function,
--               'service_role' for the platform. The function reads no
--               tables, so invoker costs nothing.
--
-- THE OWNER KEEPS WORKING THROUGHOUT. The Roles & Permissions screen is
-- the only way to manage these until Phase 3 moves them into a table.
-- =====================================================================

create or replace function app.guard_studio_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_browser boolean := v_role in ('authenticated', 'anon');
  v_owner   boolean;
  v_old     jsonb;
  v_plan    text;
  k         text;
  protected constant text[] := array[
    'company',
    'branches', 'branchActivities',
    'productionStages', 'stagesV2',
    'setupDone', 'setupTeamBand', 'setupOutletsBand',
    'itemWord', 'teamTools',
    'ownerPassword', 'ownerPay', 'payroll'
  ];
begin
  /* ---- THE PERMISSION TABLE -----------------------------------------
     Whole-row, not field by field, and deliberately so: every byte of this
     key is an authorization decision. No part of it is written in the
     course of ordinary work, so there is no partial edit to argue about. */
  if new.key = 'layi_dash_roles' then
    if not v_browser then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.data is not distinct from new.data then
      return new;   -- a save that changes nothing is not a change
    end if;
    select exists (
      select 1 from public.memberships m
      where m.user_id = v_uid
        and m.business_id = new.business_id
        and m.status = 'active'
        and m.role = 'owner'
    ) into v_owner;
    if v_owner then
      return new;
    end if;
    raise exception
      'Only the studio owner can change what a role is allowed to do'
      using errcode = '42501',
            hint = 'Ask the owner to change this in Settings, Team, Roles and permissions.';
  end if;

  if new.key is distinct from 'layi_dash_settings' then
    return new;
  end if;

  /* Was auth.uid() is null until today. The JWT role says the same thing
     about the platform and says it about `anon` as well. */
  if not v_browser then
    return new;
  end if;

  select b.plan into v_plan from public.businesses b where b.id = new.business_id;
  new.data := coalesce(new.data, '{}'::jsonb);
  if v_plan is not null then
    new.data := jsonb_set(new.data, '{plan}', to_jsonb(v_plan), true);
  else
    new.data := new.data - 'plan';
  end if;

  select exists (
    select 1 from public.memberships m
    where m.user_id = v_uid
      and m.business_id = new.business_id
      and m.status = 'active'
      and m.role = 'owner'
  ) into v_owner;

  if v_owner then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.data := new.data - protected;
    return new;
  end if;

  v_old := coalesce(old.data, '{}'::jsonb);

  foreach k in array protected loop
    if (v_old -> k) is distinct from (new.data -> k) then
      raise exception
        'Only the studio owner can change the studio''s % setting', k
        using errcode = '42501',
              hint = 'That is part of the studio''s own setup. Ask the owner to change it.';
    end if;
  end loop;

  return new;
end;
$$;

comment on function app.guard_studio_settings() is
  'Two keys. layi_dash_roles is the studio''s permission table and is '
  'owner-only in full. layi_dash_settings is guarded field by field, and '
  'its plan is stamped from businesses.plan on every write by a browser.';

-- ---------------------------------------------------------------------
-- profiles: a label, never a claim
-- ---------------------------------------------------------------------
-- The customer app writes exactly one column here, `name`, from two places
-- (the first-run screen and My Profile). It has never written role_id,
-- business_id or staff_id from a browser, so refusing those costs nothing
-- today and closes the assignment half of the escalation before Phase 2
-- gives it teeth.
create or replace function app.guard_profile_authority()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  /* 'authenticated' and 'anon' are a browser at the top of a request.
     'postgres' is inside a SECURITY DEFINER function — accept_invitation
     writing a profile for the person accepting. 'service_role' is
     team-admin and admin-api. Only the first two are held to the rule. */
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.role_id is distinct from old.role_id then
    raise exception 'A profile cannot name its own role'
      using errcode = '42501',
            hint = 'Which studio someone belongs to and what they may do there '
                   'is the membership, not the profile.';
  end if;
  if new.business_id is distinct from old.business_id then
    raise exception 'A profile cannot move itself to another studio'
      using errcode = '42501';
  end if;
  if new.staff_id is distinct from old.staff_id then
    raise exception 'A profile cannot link itself to a staff record'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_authority_guard on public.profiles;
create trigger profiles_authority_guard
  before update on public.profiles
  for each row execute function app.guard_profile_authority();

comment on function app.guard_profile_authority() is
  'profiles.role_id is a display label. It is not authority anywhere, and '
  'from Phase 0 it is not writable from a browser either, so it cannot '
  'become one by accident later.';
