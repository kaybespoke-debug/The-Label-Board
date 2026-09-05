-- Revoking from PUBLIC is not revoking from anon.
--
-- set_studio_storage_cap() and recount_storage_usage() were written as
-- service-role-only and said so:
--
--   revoke all on function ... from public;
--   grant execute on function ... to service_role;
--
-- which is the shape that looks right and is not. Supabase ships
--
--   alter default privileges in schema public grant all on functions
--     to anon, authenticated;
--
-- on every project, so a function created in `public` is executable by the
-- anon key from the moment it exists. `revoke from public` removes the
-- PUBLIC pseudo-role's grant and leaves the explicit grants to anon and
-- authenticated exactly where they were.
--
-- Found by pointing the anon key at the live project after deploying. It
-- did not fail. It set a studio's storage cap to 9,999 GB, unauthenticated,
-- from a key that ships in the browser of every studio we have.
--
-- This is the same trap tlb_policy_harness was written for after four tables
-- turned out to be reachable the same way. That harness sets the default
-- privileges for TABLES before running the migrations; storage_rls_harness
-- did too, and still missed this, because nobody had set them for FUNCTIONS.
-- Both are set now, and the harness asserts the revoke rather than the
-- intention behind it.

revoke execute on function public.set_studio_storage_cap(uuid, numeric, text) from anon, authenticated;
revoke execute on function public.recount_storage_usage() from anon, authenticated;

-- my_storage_usage() is deliberately different: a studio reading how full it
-- is, filtered by app.in_scope(), which is exactly what the meter needs.
-- authenticated keeps it; anon has no business with it.
revoke execute on function public.my_storage_usage() from anon;
grant  execute on function public.my_storage_usage() to authenticated;

-- The billing functions from the previous migration were written the same
-- way and deserve the same treatment rather than the benefit of the doubt.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_studio_plan','record_studio_payment',
                        'platform_billing_summary','studio_payments',
                        'platform_tenant_summary','set_studio_storage_cap',
                        'recount_storage_usage')
  loop
    execute format('revoke execute on function %s from anon, authenticated', fn.sig);
  end loop;
end $$;

-- and undo the damage the check itself did
update public.businesses
   set storage_cap_bytes = null, storage_cap_note = null
 where storage_cap_note = 'anon';
