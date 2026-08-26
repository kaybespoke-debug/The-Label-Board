-- =====================================================================
-- Closing two tables that were left without row level security.
--
-- Found by applying every migration to a real Postgres and then asking
-- which tables in the public schema have RLS off. Two came back:
--
--   tlb_audit_log      every admin action, with a details jsonb
--   tlb_trial_history  customer email addresses AND ip addresses
--
-- On Supabase this matters more than it looks. Tables in the public
-- schema are reachable with the anon key, which ships in the browser and
-- is not a secret. RLS off means world readable. The second table holds
-- personal data, so that is not an inconvenience, it is a breach.
--
-- Neither table is tenant scoped: both belong to the platform. So they
-- get no browser-facing policy at all. RLS on with no policy means no
-- session can read them, and the service role (used only server side by
-- the admin gateway) still can.
--
-- The audit log gets one narrow exception: a platform admin may read it,
-- because an audit trail nobody can read is not an audit trail. It stays
-- append-only from the browser's point of view: no update or delete
-- policy exists, so nobody can quietly edit their own tracks.
-- =====================================================================

alter table public.tlb_audit_log     enable row level security;
alter table public.tlb_audit_log     force  row level security;
alter table public.tlb_trial_history enable row level security;
alter table public.tlb_trial_history force  row level security;

revoke all on public.tlb_audit_log     from anon, authenticated;
revoke all on public.tlb_trial_history from anon, authenticated;

-- Platform admins may read the audit trail, and nothing else.
grant select on public.tlb_audit_log to authenticated;

drop policy if exists audit_log_platform_read on public.tlb_audit_log;
create policy audit_log_platform_read on public.tlb_audit_log
  for select to authenticated
  using (app.is_platform_admin());

-- No insert policy: entries are written by the gateway under the service
-- role, so a compromised admin session cannot forge history.
-- No update or delete policy, by design: an audit log that can be edited
-- is worse than none, because it looks trustworthy.

-- tlb_trial_history gets no policy whatsoever. It is read and written only
-- by the signup and billing paths, server side.

-- =====================================================================
-- Guard against the same mistake next time.
--
-- This is the query the tests assert on and the one to run after every
-- deploy. It names any table in the public schema with RLS switched off.
-- Kept as a view so it can be checked from the dashboard in one line:
--   select * from app.unprotected_tables;
-- An empty result is the only acceptable answer.
-- =====================================================================

create or replace view app.unprotected_tables as
  select n.nspname   as schema_name,
         c.relname   as table_name,
         exists (
           select 1 from information_schema.columns col
           where col.table_schema = n.nspname
             and col.table_name   = c.relname
             and col.column_name  = 'business_id'
         ) as is_tenant_table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

revoke all on app.unprotected_tables from anon, authenticated;
