-- =====================================================================
-- Public wrappers so an Edge Function can actually call these.
--
-- FOUND ON STAGING, 26 September, and it could not have been found
-- anywhere else. PostgREST only exposes the schemas it is configured
-- with, and `app` is not one of them. So
-- `admin.schema('app').rpc('create_team_invitation', ...)` comes back
-- with `Invalid schema: app` — from an Edge Function holding the
-- service role key, which has every privilege in the database. The
-- privilege was never the problem; the route was.
--
-- Seventeen database suites were green the whole time, because PGlite
-- has no PostgREST. It tests SQL. This is the first thing in Phase 1B
-- that needed a real API in front of a real Postgres to catch, which is
-- the argument for the staging project in one paragraph.
--
-- THE PATTERN IS ALREADY HERE. public.set_studio_plan has wrapped
-- app.set_studio_plan since 5 September for exactly this reason, and
-- admin-api calls the public one. These three follow it exactly:
-- security INVOKER, so the wrapper adds no authority of its own and the
-- app.* function's own SECURITY DEFINER is what does the work; execute
-- revoked from public, anon and authenticated; granted to service_role
-- alone.
--
-- public.accept_invitation already lives in `public` and is granted to
-- `authenticated`, because the invitee calls it as themselves. It needs
-- no wrapper and gets none.
-- =====================================================================

create or replace function public.create_team_invitation(
  p_business   uuid,
  p_email      text,
  p_role       text,
  p_branch     uuid,
  p_invited_by uuid,
  p_expires_in interval default interval '14 days'
)
returns table (invitation_id uuid, nonce text, expires_at timestamptz)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  select * from app.create_team_invitation(
    p_business, p_email, p_role, p_branch, p_invited_by, p_expires_in);
$$;

revoke all on function public.create_team_invitation(uuid, text, text, uuid, uuid, interval)
  from public, anon, authenticated;
grant execute on function public.create_team_invitation(uuid, text, text, uuid, uuid, interval)
  to service_role;

create or replace function public.discard_invitation(
  p_invitation_id uuid,
  p_reason        text default 'account creation failed'
)
returns table (outcome text, seat_released boolean)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$ select * from app.discard_invitation(p_invitation_id, p_reason); $$;

revoke all on function public.discard_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.discard_invitation(uuid, text) to service_role;

create or replace function public.cancel_team_invitation(p_invitation_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$ select app.cancel_team_invitation(p_invitation_id); $$;

revoke all on function public.cancel_team_invitation(uuid) from public, anon, authenticated;
grant execute on function public.cancel_team_invitation(uuid) to service_role;

comment on function public.create_team_invitation(uuid, text, text, uuid, uuid, interval) is
  'PostgREST-reachable wrapper. The app schema is not exposed, so an Edge '
  'Function cannot call app.* by rpc however privileged its key is. Same '
  'pattern as public.set_studio_plan.';
