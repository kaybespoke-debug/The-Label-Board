-- =====================================================================
-- P4 — the partner portal, which nobody could sign into
-- =====================================================================
-- public.partner_me() has been broken on production since app.partner_me()
-- gained its last three columns. The wrapper is
--
--     select * from app.partner_me();
--
-- declared as returning eleven columns, while the function it selects from
-- returns fourteen. Postgres does not notice at CREATE time, because the body
-- of a SQL function is not resolved against the callee's signature until it
-- runs. It notices on the first call, with 42P13 — "return type mismatch" —
-- and that call is the partner's login. So every partner login failed, and
-- the portal's only symptom was a sign-in that did not work.
--
-- WHY IT WAS NOT CAUGHT. app_schema_harness checks that a function EXISTS.
-- The partner harnesses call app.partner_me(), which is correct and has
-- always worked. Nothing called the entry point the browser actually uses,
-- so the one broken thing was the one thing untested. That is the real
-- finding; the column count is just how it showed up.
--
-- THE FIX IS THE WRAPPER, NOT THE FUNCTION. app.partner_me() is right: the
-- portal needs `kind` to tell a partner from a studio-partner, `business_id`
-- to link the two, and `payout_frozen` to stop showing a payout that is not
-- coming. Narrowing the inner function to match the stale wrapper would take
-- three working fields away to make a mistake symmetrical.
--
-- SPELLED OUT RATHER THAN `select *`, which is how the two drifted apart in
-- the first place: with the columns named, adding one to app.partner_me()
-- breaks this file in git rather than breaking a login in production.
-- =====================================================================

-- The return type changes, so it cannot be replaced in place.
drop function if exists public.partner_me();

create function public.partner_me()
returns table (
  id            uuid,
  code          text,
  name          text,
  business_name text,
  email         text,
  phone         text,
  city          text,
  tax_id        text,
  tier          text,
  status        text,
  joined_on     date,
  kind          text,
  business_id   uuid,
  payout_frozen boolean
)
language sql
stable
set search_path = public, pg_temp as $fn$
  select m.id, m.code, m.name, m.business_name, m.email,
         m.phone, m.city, m.tax_id, m.tier, m.status, m.joined_on,
         m.kind, m.business_id, m.payout_frozen
  from app.partner_me() m;
$fn$;

revoke all on function public.partner_me() from public, anon;
grant execute on function public.partner_me() to authenticated, service_role;

comment on function public.partner_me() is
  'The portal''s own entry point. Its column list is spelled out on purpose: '
  'it drifted from app.partner_me() behind a select *, and the first anyone '
  'knew was 42P13 on a partner trying to sign in.';
