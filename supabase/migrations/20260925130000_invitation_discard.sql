-- =====================================================================
-- Undoing an invitation that was written but never sent.
--
-- THE HOLE THIS CLOSES. The new-user flow writes team_invitations BEFORE
-- calling GoTrue, and it must: the trigger has to be able to see a
-- pending invitation at the moment the auth.users INSERT fires, and the
-- INSERT is the GoTrue call. Reverse the order and the trigger invents a
-- studio, which is the bug Phase 1A disabled invitations over.
--
-- But a pending invitation holds a seat. So if GoTrue then fails — rate
-- limited, a rejected address, a network drop — the studio is left with
-- a seat reserved for somebody who has no account and was never emailed.
-- A ghost. On a five-seat plan three of those is most of the studio's
-- capacity gone with nothing to show for it, and nobody would know why.
--
-- WHY NOT JUST DELETE THE ROW. Because then there is no record that it
-- ever happened, and "I invited her and nothing arrived" becomes
-- unanswerable. The row stays, cancelled, with a reason. It stops
-- holding a seat the moment its status changes, because app.seats_used
-- counts only pending rows.
--
-- WHY IT REPORTS RATHER THAN RETRIES. Blindly retrying account creation
-- after an unknown failure is how duplicate accounts get made. The
-- caller is told exactly what state things are in and stops.
-- =====================================================================

alter table public.team_invitations
  add column if not exists cancelled_reason text,
  add column if not exists cancelled_at     timestamptz;

comment on column public.team_invitations.cancelled_reason is
  'Why this invitation was withdrawn. Kept deliberately short and free of '
  'anything sensitive: it is an operational breadcrumb, not a log of what '
  'the upstream error said.';

-- ---------------------------------------------------------------------
-- app.discard_invitation — the compensating action.
--
-- IDEMPOTENT BY CONSTRUCTION. The update is conditional on status still
-- being 'pending', so a second call matches nothing and reports that it
-- had nothing to do. Calling it twice is not an error and never
-- double-releases a seat, because a seat is released by the status
-- changing, not by a counter moving.
--
-- Returns what actually happened rather than a bare boolean, because the
-- caller has to be able to tell "I cleaned it up" from "somebody else
-- already had" from "that invitation was already accepted, do not touch
-- it". The third is the one that matters: an accepted invitation must
-- never be discarded by a late-arriving failure handler.
-- ---------------------------------------------------------------------
create or replace function app.discard_invitation(
  p_invitation_id uuid,
  p_reason        text default 'account creation failed'
)
returns table (outcome text, seat_released boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_biz    uuid;
begin
  select status, business_id into v_status, v_biz
  from public.team_invitations where id = p_invitation_id;

  if v_status is null then
    return query select 'not_found'::text, false;
    return;
  end if;

  if v_status = 'accepted' then
    /* Somebody got in with it. A failure handler arriving after the fact
       must not undo a real membership. */
    return query select 'already_accepted'::text, false;
    return;
  end if;

  if v_status = 'cancelled' then
    return query select 'already_discarded'::text, false;
    return;
  end if;

  /* Lock first, same object as every other seat-changing path, so a
     discard cannot interleave with an acceptance or a creation. */
  perform app.lock_business_seats(v_biz);

  update public.team_invitations
     set status = 'cancelled',
         cancelled_reason = left(coalesce(p_reason, 'account creation failed'), 200),
         cancelled_at = now(),
         nonce_hash = null            -- the provenance signal dies with it
   where id = p_invitation_id
     and status = 'pending';

  if not found then
    /* Raced with an acceptance between the read and the update. The
       acceptance won, which is the right winner. */
    return query select 'already_accepted'::text, false;
    return;
  end if;

  return query select 'discarded'::text, true;
end;
$$;

revoke all on function app.discard_invitation(uuid, text) from public;
grant execute on function app.discard_invitation(uuid, text) to service_role;

comment on function app.discard_invitation(uuid, text) is
  'Compensating action for an invitation whose account creation failed. '
  'Idempotent: safe to call twice, never discards an accepted invitation, '
  'and releases the reserved seat by changing status rather than by moving '
  'a counter.';
