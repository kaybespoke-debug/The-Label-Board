-- A studio may describe itself. It may not price itself.
--
-- businesses carried a blanket `grant update ... to authenticated` with a
-- policy of `app.is_business_admin(id)`. Correct as far as it went — you can
-- only touch your own row — and far too generous about WHICH row. Every
-- column was writable by the studio, including:
--
--   plan               a studio could put itself on 'premium'
--   status             and un-suspend itself
--   storage_cap_bytes  and grant itself a terabyte
--   storage_used_bytes and zero its own meter
--   notes              our private operator notes about them
--
-- Found by storage_rls_harness asking whether a tenant could raise its own
-- cap by writing the column instead of calling the function. It could. The
-- function was locked to service_role and the column behind it was open,
-- which is the usual shape of this mistake.
--
-- Postgres has column-level grants for exactly this. The policy still decides
-- WHICH row; the grant now decides WHICH COLUMNS. Both have to pass.
--
-- This is also what makes the stored plan tamper-proof. The feature gates in
-- the browser remain a commercial nudge — chasing a client is a wa.me link
-- with no server in the path, so nothing can enforce it — but the plan the
-- DATABASE believes, and therefore what the storage cap is computed from and
-- what we invoice, can no longer be edited by the tenant.

revoke update on public.businesses from authenticated;

-- Exactly the four the app writes in its presence upsert, and nothing else.
-- If a new column ever needs to be studio-writable, it has to be added here
-- deliberately rather than inherited by being on the table.
grant update (name, contact_email, last_seen_at, app_version)
  on public.businesses to authenticated;

-- anon never had it; make that explicit so a future blanket grant does not
-- quietly hand it over.
revoke update on public.businesses from anon;
