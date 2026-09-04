-- =====================================================================
-- The operator console could not have signed anybody in.
--
-- admin-api is the console's only door to the database. Before it answers
-- anything it asks who is knocking:
--
--   admin.from('platform_admins').select('id,name,role,active')
--
-- and tenant_isolation creates that table as (id, email, added_at). The
-- select names three columns that do not exist, PostgREST refuses the
-- whole query, `staff` comes back null, and every caller — including
-- Kayode — is told "This account is not a Label Board staff account".
-- The console would have been shut to everyone, with an error message
-- confidently describing the wrong cause.
--
-- role is not cosmetic either: admin-api keys its whole permission table
-- off it (owner, finance, support, developer) and refuses any action the
-- role does not list. Without the column there is no role, so there are
-- no permitted actions.
--
-- businesses.notes is the same story one table over. admin-api reads it
-- for the studio detail panel and writes it for setNote; the migration
-- never created it, so both fail.
--
-- Why no test caught it: app_schema_harness reads the shipped code to
-- decide what the database must provide, which is the right idea, but it
-- only read the three browser apps. The Edge Functions are shipped code
-- too, and they are the half that talks to the tables the browser is
-- deliberately not allowed to touch. The harness now reads them as well.
--
-- The plan and status vocabularies are fixed in admin-api rather than
-- here: the customer app's PLANS, the console, and this schema all
-- already agree on trial/starter/pro/premium and active/suspended/closed.
-- admin-api alone said studio/growth/atelier and past_due/paused/
-- cancelled, so it is the one that was out of step, and widening the
-- constraint to admit its values would have made the disagreement
-- permanent instead of ending it.
-- =====================================================================

alter table public.platform_admins add column if not exists name   text;
alter table public.platform_admins add column if not exists active boolean not null default true;
alter table public.platform_admins add column if not exists role   text not null default 'support';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.platform_admins'::regclass
      and conname  = 'platform_admins_role_check'
  ) then
    alter table public.platform_admins
      add constraint platform_admins_role_check
      check (role in ('owner','finance','support','developer'));
  end if;
end $$;

-- What we have written down about a studio. Ours, not theirs: it is
-- reachable only through admin-api under the service role, and every read
-- of it is logged to platform_audit like any other.
alter table public.businesses add column if not exists notes text;

-- platform_admins keeps its deliberate absence of any policy — RLS is on
-- and forced, so no browser session can read the list of our own staff,
-- whatever columns it now has. admin-api reaches it under the service
-- role, which holds BYPASSRLS.
