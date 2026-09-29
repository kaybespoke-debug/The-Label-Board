-- =====================================================================
-- One definition of a seat, and one lock that every seat-consuming
-- operation takes first.
--
-- TWO PROBLEMS, BOTH PRE-EXISTING.
--
-- 1. app.enforce_seat_limit() counts memberships only. Once invitations
--    hold seats, a direct membership insert could take a seat that an
--    invitation had already reserved, and the ceiling would be wrong by
--    however many invitations were outstanding.
--
-- 2. It does `select count(*)` and then compares. That is check-then-act.
--    Two transactions committing at the same instant can both see 4 < 5
--    and both insert, leaving 6 seats on a 5-seat plan. The window is
--    milliseconds and needs two people accepting at once, so it is
--    unlikely rather than impossible. It is in shipped code today; Phase
--    1B is simply the first feature that makes concurrent membership
--    creation realistic.
--
-- WHY ONE LOCK OBJECT. A deadlock needs two or more lock objects taken
-- in different orders. There is exactly one here — the businesses row —
-- and every path takes it as its first lock, so a cycle cannot be
-- constructed. Postgres row locks are re-entrant within a transaction,
-- so a function that already holds it and then inserts a membership
-- finds the trigger's own `for update` returns immediately.
--
-- Additive: no behaviour changes until something starts writing
-- invitations, and nothing does yet.
-- =====================================================================

-- ---------------------------------------------------------------------
-- What counts as a seat.
--
-- 'suspended' memberships are deliberately excluded: a suspended login
-- is the documented way to free a seat without destroying the record.
-- A pending invitation counts, and stops counting the moment it is
-- cancelled or expires, with no action needed anywhere.
-- ---------------------------------------------------------------------
create or replace function app.seats_used(p_business uuid, p_exclude_membership uuid default null)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.memberships m
      where m.business_id = p_business
        and m.status in ('active','invited')
        and m.id is distinct from p_exclude_membership)
  + (select count(*) from public.team_invitations i
      where i.business_id = p_business
        and i.status = 'pending'
        and i.expires_at > now());
$$;

revoke all on function app.seats_used(uuid, uuid) from public;
grant execute on function app.seats_used(uuid, uuid) to service_role;

comment on function app.seats_used(uuid, uuid) is
  'Seats in use: active and invited memberships, plus pending unexpired '
  'invitations. The one definition; enforce_seat_limit and the invitation '
  'functions all use it so they cannot drift apart.';

-- ---------------------------------------------------------------------
-- The lock. Its own function so that "take the lock" is one thing with
-- one name, and a future path cannot take a subtly different one.
-- ---------------------------------------------------------------------
create or replace function app.lock_business_seats(p_business uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.businesses where id = p_business for update;
end;
$$;

revoke all on function app.lock_business_seats(uuid) from public;
grant execute on function app.lock_business_seats(uuid) to service_role;

comment on function app.lock_business_seats(uuid) is
  'The single lock object for seat accounting. Every seat-consuming path '
  'takes this FIRST, which is why a deadlock cannot be constructed.';

-- ---------------------------------------------------------------------
-- enforce_seat_limit, rewritten around both.
--
-- COPIED FROM 20260920100000_plan_limits.sql, which is where it is
-- currently defined, and changed in exactly three places:
--   1. takes the lock before counting
--   2. counts through app.seats_used instead of its own inline query
--   3. the message mentions invitations, because they now hold seats and
--      an owner told "5 of 5 used" with only 4 people is owed the reason
-- Everything else, including the two early returns and the errcode, is
-- what was shipped.
-- ---------------------------------------------------------------------
create or replace function app.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max int;
  v_now int;
  v_plan text;
begin
  -- a row that does not occupy a seat never needs checking
  if new.status not in ('active', 'invited') then
    return new;
  end if;
  -- nor does one that already occupied one
  if tg_op = 'UPDATE' and old.status in ('active', 'invited') then
    return new;
  end if;

  select max_seats into v_max from app.limits_for(new.business_id);
  if v_max is null then
    return new;
  end if;

  /* FIRST, before counting anything. Serialises every seat decision for
     this business; without it two concurrent inserts can both see room. */
  perform app.lock_business_seats(new.business_id);

  v_now := app.seats_used(new.business_id, new.id);

  if v_now < v_max then
    return new;
  end if;

  select plan into v_plan from public.businesses where id = new.business_id;
  raise exception
    'plan limit reached: % allows % team login(s) and this business already has % in use, counting pending invitations',
    coalesce(v_plan, 'this plan'), v_max, v_now
    using errcode = 'check_violation',
          hint = 'Move the business to a larger plan, agree a higher ceiling on the business itself, cancel a pending invitation, or suspend a login that is no longer used.';
end;
$$;

revoke all on function app.enforce_seat_limit() from public;
