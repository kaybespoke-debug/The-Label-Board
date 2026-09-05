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

-- Enough of auth.users for the onboarding trigger to fire against.
--
-- studio_onboarding hangs a trigger off this table, which is the only place
-- an account actually comes into existence, and it is written to warn rather
-- than raise on failure — a trigger that raises here makes the account
-- creation itself fail, and the dashboard reports only "Database error
-- creating new user". The cost of that choice is that a broken trigger is
-- silent: the account exists, no studio does, and the app says "Signed in,
-- but your profile was not found".
--
-- Silent is exactly what a test is for. Only the three columns the trigger
-- reads, because a fuller copy of Supabase's table would drift from theirs
-- and start testing the copy.
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- =====================================================================
-- Enough of Supabase Storage to run the real storage policies.
--
-- studio_media_storage creates a bucket, hangs a trigger off
-- storage.objects and puts four policies on it. Those policies ARE the
-- storage cap and the tenant wall — a browser talks to the storage API
-- directly, so nothing in the app stands between a forged request and
-- this table. They have to be tested against the same shape Supabase
-- serves, not a paraphrase.
--
-- Only the columns the migration and the app actually touch. A fuller
-- copy of Supabase's table would drift from theirs and start testing
-- the copy instead of the policy.
--
-- Never applied to a real project: on a real project this schema is
-- already there, and `create ... if not exists` leaves it alone.
-- =====================================================================
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

-- Supabase ships storage with RLS on. Without this the policies exist and
-- are never consulted, and every test below would pass while the real
-- bucket was wide open.
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;
