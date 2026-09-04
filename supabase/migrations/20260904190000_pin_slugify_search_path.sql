-- =====================================================================
-- app.slugify was the one function in this schema without a pinned
-- search_path, which Supabase's own linter noticed and the migration that
-- introduced it did not — its comment says "search_path is pinned, as
-- everywhere else here" two functions further down.
--
-- On its own it is pure string work and hard to abuse: regexp_replace,
-- lower and trim are all in pg_catalog, which is searched first whatever
-- the search_path says. What makes it worth fixing anyway is where it is
-- called from. provision_studio() is SECURITY DEFINER and runs on every
-- account creation, and a function reached from inside a definer context
-- is exactly where a mutable search_path stops being theoretical.
--
-- Pinning it costs nothing and makes the rule uniform, which matters more
-- than this one case: "every function in app pins its search_path" is a
-- rule a test can check, and "every function except the harmless one" is
-- not.
-- =====================================================================

create or replace function app.slugify(p text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(nullif(trim(both '-' from
    regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), ''), 'studio');
$$;

revoke all on function app.slugify(text) from public;
