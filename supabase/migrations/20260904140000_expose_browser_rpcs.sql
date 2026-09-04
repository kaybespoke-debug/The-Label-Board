-- =====================================================================
-- The partner portal could not have signed anybody in either.
--
-- partners/js/auth.js finishes its one-time-code flow by asking the
-- database who just signed in:
--
--   POST /rest/v1/rpc/partner_me
--
-- and partner_portal creates that function as app.partner_me(). PostgREST
-- only serves the schemas the project exposes, which is `public` and
-- `graphql_public` unless somebody changes it, so the call comes back
-- PGRST202 "Could not find the function public.partner_me". The code is
-- accepted, the session is created, and then the portal cannot find out
-- whose session it is — which reads as a broken login with no error worth
-- showing.
--
-- app.claim_referral_code() has the same problem and has simply not been
-- noticed yet, because nothing calls it: the website is still static. It
-- was granted to anon on purpose — it is the one thing an anonymous
-- visitor is meant to be able to do, so a referral link can be credited
-- before anyone has an account. It would have failed the day the website
-- started using it.
--
-- Two ways to fix this. Expose the `app` schema to PostgREST, or wrap the
-- two functions that are meant to be called from a browser.
--
-- Wrapping, because the point of `app` is that it is NOT the API. It
-- holds in_scope(), is_business_admin(), is_platform_admin(), is_partner()
-- and tlb_staff_id() — the machinery every policy in the database is built
-- on, granted to authenticated because policies run as the caller.
-- Exposing the schema would publish all of it as callable REST endpoints.
-- None of them would leak another tenant's data, since each one only ever
-- answers about the caller, but it turns the security machinery into
-- public API surface, and the next helper somebody adds is published by
-- default rather than by decision.
--
-- So: two wrappers, named in public, each delegating to the app function
-- that does the real work. SECURITY INVOKER, so the wrapper adds no
-- privilege of its own — the definer function behind it is what pins the
-- answer to auth.uid(), exactly as before.
-- =====================================================================

create or replace function public.partner_me()
returns table (
  id uuid, code text, name text, business_name text, email text,
  phone text, city text, tax_id text, tier text, status text, joined_on date
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select * from app.partner_me();
$$;

revoke all on function public.partner_me() from public, anon;
grant execute on function public.partner_me() to authenticated, service_role;

-- Anonymous on purpose: somebody following a referral link has no account
-- yet. It returns a partner id and counts a click; it reads nothing about
-- the partner and writes nothing else.
create or replace function public.claim_referral_code(p_code text)
returns uuid
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  select app.claim_referral_code(p_code);
$$;

revoke all on function public.claim_referral_code(text) from public;
grant execute on function public.claim_referral_code(text) to anon, authenticated, service_role;
