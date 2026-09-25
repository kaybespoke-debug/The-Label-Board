-- =====================================================================
-- Creating an invitation, and accepting one. Two functions, one
-- transaction each, one lock taken first in both.
--
-- NEITHER IS CALLED BY ANYTHING YET. team-admin's invite action is still
-- the 503 from Phase 1A. These exist so the behaviour can be tested
-- before the part that depends on GoTrue is written.
-- =====================================================================

-- ---------------------------------------------------------------------
-- app.create_team_invitation
--
-- ONE TRANSACTION: lock, count, insert. If the seat check fails nothing
-- is written at all — which was the point Kayode made about the earlier
-- two-RPC shape, where a failure between them could leave an invitation
-- with no seat or a seat with no invitation.
--
-- Returns the raw nonce exactly once. It is not stored. A database dump
-- yields no usable provenance signal, for the same reason it yields no
-- usable passwords.
-- ---------------------------------------------------------------------
create or replace function app.create_team_invitation(
  p_business   uuid,
  p_email      text,
  p_role       text,
  p_branch     uuid,
  p_invited_by uuid,
  p_expires_in interval default interval '14 days'
)
returns table (invitation_id uuid, nonce text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_max   int;
  v_used  int;
  v_nonce text;
  v_id    uuid;
  v_exp   timestamptz;
begin
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'A valid email address is needed' using errcode = '22023';
  end if;
  if coalesce(p_role,'') not in ('manager','staff','viewer') then
    raise exception 'role must be manager, staff or viewer' using errcode = '22023';
  end if;

  /* FIRST. Everything below counts seats, so nothing below may race. */
  perform app.lock_business_seats(p_business);

  /* Already one of them? The unique key on memberships would catch it
     later, but at acceptance rather than here, which is the wrong place
     to find out. */
  if exists (select 1 from public.memberships m
              join auth.users u on u.id = m.user_id
             where m.business_id = p_business
               and lower(btrim(u.email)) = v_email
               and m.status in ('active','invited')) then
    raise exception 'That person is already on this team' using errcode = '23505';
  end if;

  select max_seats into v_max from app.limits_for(p_business);
  if v_max is not null then
    v_used := app.seats_used(p_business);
    if v_used >= v_max then
      raise exception
        'plan limit reached: % seat(s) are in use, counting pending invitations', v_used
        using errcode = 'check_violation',
              hint = 'Cancel a pending invitation, suspend an unused login, or move to a larger plan.';
    end if;
  end if;

  /* 256 bits, generated in the database so the raw value never passes
     through application memory on the way in. */
  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp   := now() + p_expires_in;

  insert into public.team_invitations
    (business_id, email, role, branch_id, invited_by, expires_at,
     nonce_hash, nonce_issued_at)
  values
    (p_business, v_email, p_role, p_branch, p_invited_by, v_exp,
     encode(extensions.digest(v_nonce, 'sha256'), 'hex'), now())
  returning id into v_id;

  return query select v_id, v_nonce, v_exp;
end;
$$;

revoke all on function app.create_team_invitation(uuid, text, text, uuid, uuid, interval) from public;
grant execute on function app.create_team_invitation(uuid, text, text, uuid, uuid, interval) to service_role;

-- ---------------------------------------------------------------------
-- app.accept_invitation
--
-- Called by the INVITEE, as themselves. The invitation id is a SELECTOR,
-- not a credential: holding it grants nothing, because every check below
-- has to pass as well.
--
-- ORDER IS THE WHOLE ANSWER TO THE SEAT QUESTION. On a five-seat plan
-- with four active members and this pending invitation, seats_used is
-- already 5. Inserting the membership first would make it 6 and be
-- refused. So the invitation is CONSUMED FIRST, which releases its
-- reservation, and the membership then takes the seat it was holding.
-- 4 active + 1 pending becomes 5 active + 0 pending, in one transaction.
--
-- Replay is prevented by the conditional update, not by secrecy. Two
-- simultaneous calls both reach it, Postgres serialises them on the row,
-- the first sets 'accepted', the second matches zero rows and raises.
-- ---------------------------------------------------------------------
create or replace function public.accept_invitation(p_invitation_id uuid)
returns table (joined_business uuid, joined_name text, joined_role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_ok      boolean;
  v_inv     public.team_invitations%rowtype;
  v_max     int;
  v_used    int;
  v_name    text;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  /* The caller's identity comes from their session and their email from
     auth.users. Neither is read from the request. */
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

  /* The invitation names an address; the session proves who you are.
     Both must agree, so knowing an id is useless without the mailbox. */
  if v_inv.email <> v_email then
    raise exception 'That invitation is no longer valid' using errcode = '22023';
  end if;
  if v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    raise exception 'That invitation is no longer valid' using errcode = '22023';
  end if;

  perform app.lock_business_seats(v_inv.business_id);

  /* CONSUME FIRST — this is what converts the reservation rather than
     adding to it. `where status = 'pending'` is the concurrency control. */
  update public.team_invitations
     set status = 'accepted', accepted_at = now(), accepted_by = v_uid,
         nonce_hash = null
   where id = p_invitation_id
     and status = 'pending';
  if not found then
    raise exception 'That invitation has already been used' using errcode = '23505';
  end if;

  /* Now the seat this invitation was holding is free, so the membership
     about to be written takes it rather than a second one. */
  select max_seats into v_max from app.limits_for(v_inv.business_id);
  if v_max is not null then
    v_used := app.seats_used(v_inv.business_id);
    if v_used >= v_max then
      raise exception
        'plan limit reached: % seat(s) are in use', v_used
        using errcode = 'check_violation',
              hint = 'The studio is over its plan. Ask the owner to free a seat.';
    end if;
  end if;

  select b.name into v_name from public.businesses b where b.id = v_inv.business_id;

  /* profiles.role_id is the app's own free-text role; memberships.role is
     the one RLS reads. Phase 1B writes both from the single choice on the
     invitation, so it does not add a third model of ownership. */
  insert into public.profiles (id, name, role_id, business_id)
  values (v_uid,
          coalesce(nullif(btrim((select raw_user_meta_data ->> 'name' from auth.users where id = v_uid)), ''),
                   initcap(split_part(v_email, '@', 1))),
          v_inv.role, v_inv.business_id)
  on conflict (id) do update
    set business_id = excluded.business_id,
        role_id     = excluded.role_id;

  insert into public.memberships (business_id, user_id, branch_id, role, status)
  values (v_inv.business_id, v_uid, v_inv.branch_id, v_inv.role, 'active')
  on conflict (business_id, user_id) do update
    set role = excluded.role, branch_id = excluded.branch_id, status = 'active';

  return query select v_inv.business_id, v_name, v_inv.role;
end;
$$;

revoke all on function public.accept_invitation(uuid) from public;
revoke all on function public.accept_invitation(uuid) from anon;
grant execute on function public.accept_invitation(uuid) to authenticated;

comment on function public.accept_invitation(uuid) is
  'The invitee accepts, as themselves. The id is a selector, not a credential: '
  'the session must resolve to the address the invitation names, with a '
  'confirmed email. Consumes the invitation BEFORE writing the membership so '
  'the reserved seat is converted rather than double counted.';

-- ---------------------------------------------------------------------
-- Cancelling. Releases the seat the moment it commits, because
-- seats_used only counts pending rows.
-- ---------------------------------------------------------------------
create or replace function app.cancel_team_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.team_invitations
     set status = 'cancelled', nonce_hash = null
   where id = p_invitation_id and status = 'pending';
  return found;
end;
$$;

revoke all on function app.cancel_team_invitation(uuid) from public;
grant execute on function app.cancel_team_invitation(uuid) to service_role;
