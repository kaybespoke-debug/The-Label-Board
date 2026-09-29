-- =====================================================================
-- The invitation carries the ROLE, and acceptance writes it to the
-- membership.
--
-- COPIED FROM THE DEPLOYED FUNCTION, not retyped. Four changes, each
-- marked; everything else is byte for byte what has run since 26
-- September, including the consume-before-insert ordering that makes a
-- pending seat convert instead of doubling.
--
-- This is also what repairs the bug in section 0 of RBAC_DESIGN.md: the
-- old body wrote profiles.role_id as the tier ('staff', 'viewer'), which
-- matches no role in the app's table, so an invited staff member arrived
-- with currentRole() undefined and no permissions at all.
-- =====================================================================
create or replace function public.accept_invitation(p_invitation_id uuid)
returns table(joined_business uuid, joined_name text, joined_role text)
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_ok      boolean;
  v_inv     public.team_invitations%rowtype;
  v_max     int;
  v_used    int;
  v_name    text;
  v_role_id uuid;   -- CHANGED 1: which business role this invitation grants
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select lower(btrim(u.email)), (u.email_confirmed_at is not null)
    into v_email, v_ok
  from auth.users u where u.id = v_uid;

  if v_email is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if not v_ok then
    raise exception 'Confirm your email address first' using errcode = '28000';
  end if;

  select * into v_inv from public.team_invitations where id = p_invitation_id;
  if not found then
    raise exception 'That invitation is no longer valid' using errcode = '22023';
  end if;

  if v_inv.email <> v_email then
    raise exception 'That invitation is no longer valid' using errcode = '22023';
  end if;
  if v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    raise exception 'That invitation is no longer valid' using errcode = '22023';
  end if;

  perform app.lock_business_seats(v_inv.business_id);

  update public.team_invitations
     set status = 'accepted', accepted_at = now(), accepted_by = v_uid,
         nonce_hash = null
   where id = p_invitation_id and status = 'pending';
  if not found then
    raise exception 'That invitation has already been used' using errcode = '23505';
  end if;

  select max_seats into v_max from app.limits_for(v_inv.business_id);
  if v_max is not null then
    v_used := app.seats_used(v_inv.business_id);
    if v_used >= v_max then
      raise exception 'plan limit reached: % seat(s) are in use', v_used
        using errcode = 'check_violation',
              hint = 'The studio is over its plan. Ask the owner to free a seat.';
    end if;
  end if;

  select b.name into v_name from public.businesses b where b.id = v_inv.business_id;

  /* CHANGED 2. The invitation names a role; if it does not — every
     invitation sent before Batch A — fall back to the system role for its
     tier, so nobody arrives with nothing. */
  v_role_id := coalesce(
    v_inv.role_id,
    (select r.id from public.business_roles r
      where r.business_id = v_inv.business_id and r.key = v_inv.role));

  /* CHANGED 3. profiles.role_id carries the ROLE KEY rather than the tier,
     so the label matches a role that exists. It is still only a label. */
  insert into public.profiles (id, name, role_id, business_id)
  values (v_uid,
          coalesce(nullif(btrim((select raw_user_meta_data ->> 'name' from auth.users where id = v_uid)), ''),
                   initcap(split_part(v_email, '@', 1))),
          coalesce((select r.key from public.business_roles r where r.id = v_role_id), v_inv.role),
          v_inv.business_id)
  on conflict (id) do update
    set business_id = excluded.business_id, role_id = excluded.role_id;

  /* CHANGED 4: role_id travels with the membership, which is where
     authority lives. */
  insert into public.memberships (business_id, user_id, branch_id, role, status, role_id)
  values (v_inv.business_id, v_uid, v_inv.branch_id, v_inv.role, 'active', v_role_id)
  on conflict (business_id, user_id) do update
    set role = excluded.role, branch_id = excluded.branch_id,
        status = 'active', role_id = excluded.role_id;

  return query select v_inv.business_id, v_name, v_inv.role;
end;
$function$;
