-- =====================================================================
-- Who operates the platform.
--
-- admin-api refuses everyone by default: it looks the caller up in
-- platform_admins and, finding nothing, answers "This account is not a
-- Label Board staff account". So until a row exists here, the operator
-- console is shut to its owner too. SUPABASE_SETUP.md step 4 is this.
--
-- Written as a lookup by email rather than a pasted uuid. Two reasons:
--
--   * A migration carrying a hardcoded auth.users id is only true of the
--     project it was written against. On any other one it would insert a
--     row pointing at an account that does not exist — and platform_admins
--     has no foreign key to auth.users, so nothing would object. It would
--     simply sit there granting owner rights to a uuid nobody holds.
--
--   * This way a rebuilt project reproduces its operator as long as the
--     account exists, and quietly does nothing when it does not. Restoring
--     from the migrations alone should not leave you locked out of your
--     own console.
--
-- The password is not here and never will be. It is set in Auth, by hand,
-- and this only says that whoever holds that account is the owner.
--
-- role must be one of owner / finance / support / developer — those are
-- the four admin-api knows, and each is allowed a different set of
-- actions. owner is the only one that can read the audit log.
-- =====================================================================

-- Guarded on auth.users existing at all, not just on the row existing. The
-- test harnesses build this schema on a bare Postgres with only auth.uid()
-- stubbed, and a migration that cannot run there is a migration the suites
-- cannot check anything else through.
do $$
begin
  if to_regclass('auth.users') is null then
    raise notice 'no auth schema here — skipping the platform owner seed';
    return;
  end if;

  execute $seed$
    insert into public.platform_admins (id, name, role, active, email)
    select u.id, 'Kayode', 'owner', true, u.email
    from auth.users u
    where u.email = 'layiojomo@gmail.com'
    on conflict (id) do update
      set name   = excluded.name,
          role   = excluded.role,
          active = excluded.active,
          email  = excluded.email
  $seed$;
end $$;
