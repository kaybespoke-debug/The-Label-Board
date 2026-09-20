-- =====================================================================
-- partner_tier_rate does not need to be SECURITY DEFINER.
--
-- Applied 19 September 2026, straight after the two migrations above it,
-- because Supabase's own linter flagged it the moment they landed:
--
--   "Function public.partner_tier_rate(p_active integer) can be executed
--    by the authenticated role as a SECURITY DEFINER function via
--    /rest/v1/rpc/partner_tier_rate."
--
-- It was right. The function was written definer out of habit, alongside
-- the five around it, and a definer function sitting on the public API
-- that any signed-in user can call is a thing to justify rather than to
-- leave lying about.
--
-- This one has nothing to justify: it reads partner_rate_bands, which
-- authenticated can already SELECT, because that table has a read policy
-- for exactly this reason — the portal shows the ladder it is paid from.
-- As INVOKER it returns the same answer through the same policy, and the
-- public API carries one fewer function running as its owner.
--
-- The other five stay SECURITY DEFINER and stay revoked from anon and
-- authenticated. They read and write other partners' money, and the
-- harness asserts that every one of them is unreachable from a browser.
-- =====================================================================
create or replace function public.partner_tier_rate(p_active integer)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select b.rate_pct
  from public.partner_rate_bands b
  where b.min_active <= greatest(coalesce(p_active, 0), 0)
  order by b.min_active desc
  limit 1;
$$;

revoke execute on function public.partner_tier_rate(integer) from public, anon;
grant  execute on function public.partner_tier_rate(integer) to authenticated, service_role;
