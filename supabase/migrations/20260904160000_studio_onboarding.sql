-- =====================================================================
-- Nothing turned a new account into a studio.
--
-- The app signs in with signInWithPassword, then reads profiles for the
-- business_id, and stops if there is not one: "Signed in, but your profile
-- was not found". Nothing anywhere created that row. So a working login
-- got you a dead end, and standing up a studio meant hand-writing four
-- records in the right order — the auth user, a business, a profile and a
-- membership — with a foreign key and an RLS policy waiting on each one.
--
-- That is the job of a trigger on auth.users, which is where the account
-- actually comes into existence, whether it arrives from the dashboard,
-- from a signup form, or from team-admin.
--
-- Two paths, because both are real:
--
--   claimed   a business already exists carrying this email in
--             pending_owner_email. The account becomes its owner and the
--             claim is cleared. This is how a studio can be prepared —
--             named, given its trade, its stages and its catalogue —
--             before anybody has a password.
--
--   fresh     no such business. One is created from the account's
--             metadata (business_name, or the email's local part), with a
--             default branch, and the account owns it.
--
-- Either way the account ends up with a profile and an active owner
-- membership, which is what every policy in the database reads.
--
-- SECURITY DEFINER because it writes tables whose RLS is forced and whose
-- policies ask app.in_scope() — which reads memberships, which this is in
-- the middle of creating. search_path is pinned, as everywhere else here.
--
-- Deliberately not an exception if anything goes wrong: a trigger that
-- raises on auth.users insert makes the account creation itself fail, so
-- a bad slug collision would present as "could not create user" with no
-- hint why. It warns and lets the account exist; the studio can be
-- attached afterwards.
-- =====================================================================

alter table public.businesses add column if not exists contact_email       text;
alter table public.businesses add column if not exists last_seen_at        timestamptz;
alter table public.businesses add column if not exists app_version         text;
alter table public.businesses add column if not exists pending_owner_email text;

create unique index if not exists businesses_pending_owner_email_key
  on public.businesses (lower(pending_owner_email))
  where pending_owner_email is not null;

-- ---------------------------------------------------------------------
-- Let a studio write its own presence row.
--
-- reportTenantPresence() upserts { id, name, contact_email, last_seen_at,
-- app_version }. supabase-js sends an upsert as INSERT .. ON CONFLICT, and
-- Postgres wants INSERT privilege for that even when it resolves to an
-- update — and businesses deliberately had no insert policy, because
-- creating a business is a signup operation and does not belong to the
-- browser. So presence was refused, silently, by design.
--
-- This keeps that rule and still lets the upsert through: the check is
-- is_business_admin(id), which is false for any id the caller does not
-- already own. A studio cannot conjure a business, because it would have
-- to be an admin of an id that has no membership rows at all.
-- ---------------------------------------------------------------------
drop policy if exists businesses_insert on public.businesses;
create policy businesses_insert on public.businesses
  for insert to authenticated
  with check (app.is_business_admin(id));

-- ---------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------
create or replace function app.slugify(p text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(trim(both '-' from
    regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), ''), 'studio');
$$;

create or replace function app.provision_studio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_biz    uuid;
  v_name   text;
  v_slug   text;
  v_n      int := 0;
begin
  -- 1. a studio prepared for this address, waiting to be claimed
  select b.id into v_biz
  from public.businesses b
  where b.pending_owner_email is not null
    and lower(b.pending_owner_email) = lower(new.email)
  limit 1;

  if v_biz is not null then
    update public.businesses set pending_owner_email = null where id = v_biz;
  else
    -- 2. otherwise, a new one from whatever the account told us
    v_name := coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      initcap(split_part(new.email, '@', 1)));

    v_slug := app.slugify(v_name);
    while exists (select 1 from public.businesses where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := app.slugify(v_name) || '-' || v_n::text;
    end loop;

    insert into public.businesses (name, slug, plan, status, contact_email)
    values (v_name, v_slug, 'trial', 'active', new.email)
    returning id into v_biz;

    insert into public.branches (business_id, name)
    values (v_biz, 'Main studio');
  end if;

  -- 3. the two rows every policy in the database reads
  insert into public.profiles (id, name, role_id, business_id)
  values (new.id,
          coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
                   initcap(split_part(new.email, '@', 1))),
          'owner', v_biz)
  on conflict (id) do update set business_id = excluded.business_id;

  insert into public.memberships (business_id, user_id, role, status)
  values (v_biz, new.id, 'owner', 'active')
  on conflict (business_id, user_id) do update
    set role = 'owner', status = 'active';

  return new;
exception when others then
  -- An account that exists without a studio can be fixed. An account that
  -- could not be created because a trigger raised cannot be diagnosed at all
  -- from the dashboard, which reports only "Database error creating new user".
  raise warning 'provision_studio failed for %: %', new.email, sqlerrm;
  return new;
end;
$$;

revoke all on function app.provision_studio() from public;
revoke all on function app.slugify(text) from public;

-- Only attach where there is an auth schema to attach to. The harnesses
-- build this on a bare Postgres.
do $$
begin
  if to_regclass('auth.users') is null then
    raise notice 'no auth schema here — provision_studio trigger not attached';
    return;
  end if;
  execute 'drop trigger if exists on_auth_user_created on auth.users';
  execute 'create trigger on_auth_user_created
             after insert on auth.users
             for each row execute function app.provision_studio()';
end $$;
