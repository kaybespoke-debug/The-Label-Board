-- =====================================================================
-- Test-only shim.
--
-- Supabase provides the auth schema and auth.uid() in every project. This
-- recreates just enough of it to run the same migration and the same
-- policies against a bare Postgres, so the tests exercise the real
-- policies rather than a paraphrase of them.
--
-- auth.uid() below is the same shape as Supabase's: read the sub claim out
-- of the request's JWT claims, which the API layer sets per request. In a
-- test we set that GUC ourselves to impersonate a signed-in user.
--
-- Never applied to a real project.
-- =====================================================================

-- Supabase creates these three roles when a project is provisioned, before
-- any migration runs. Recreated here so the ordering matches.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;

-- Shaped exactly like Supabase's own auth.uid(): the nullif comes BEFORE the
-- cast, because with no claims set current_setting returns an empty string and
-- ''::jsonb raises "input string ended unexpectedly". Casting first is a real
-- bug that only shows up on unauthenticated calls, which is precisely the path
-- these tests need to exercise.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  );
$$;

grant usage on schema auth to anon, authenticated, service_role;
