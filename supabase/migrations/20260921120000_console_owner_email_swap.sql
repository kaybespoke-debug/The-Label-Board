-- =====================================================================
-- Move the console owner's login off a personal gmail address.
--
-- Kayode, 21 September 2026: layiojomo@gmail.com is to become the STUDIO
-- login in the customer app, and the console owner is to sign in as
-- layiwolaojomo@thelabelboard.com instead. Supabase's dashboard no longer
-- offers an email field, and the Auth admin API needs a service role key,
-- which is his to hold and not mine to handle. He asked me to run it
-- rather than risk a typo in a terminal, and this is the one path where
-- neither of us has to paste a key anywhere.
--
-- A one-off data change in a migration, which this repo has precedent for
-- (clear_cross_studio_contamination, seed_platform_owner). It is written
-- to be safe to run twice and safe to run anywhere.
--
-- THE EMAIL LIVES IN THREE PLACES and all three move together:
--
--   auth.users.email                  what sign-in looks up
--   auth.identities.identity_data     the email provider's own record
--   platform_admins.email             a label on our side, shown in the
--                                     console's staff list
--
-- auth.identities.email is GENERATED ALWAYS from identity_data, so it
-- follows on its own. provider_id was checked first and holds the user id
-- rather than the address, so it stays as it is.
--
-- WHAT DOES NOT CHANGE: the user id, the password, and therefore the
-- console access. admin-api authorises on platform_admins.id matched to
-- the auth user id, never on the address, so there is no moment where
-- the only operator account cannot get in.
-- =====================================================================
do $$
declare
  v_user uuid := '52c36410-76d1-4a4e-b86a-9250640a46b7';
  v_old  text := 'layiojomo@gmail.com';
  v_new  text := 'layiwolaojomo@thelabelboard.com';
begin
  -- A test database has a stubbed auth schema with no identities table.
  -- Return quietly rather than throw, so the suites do not silently skip
  -- this file and report green for a reason nobody intended.
  if to_regclass('auth.identities') is null then
    raise notice 'console_owner_email_swap: no auth.identities here, skipping';
    return;
  end if;

  -- Already done, or this is not that database. Either way, nothing to do.
  if not exists (select 1 from auth.users where id = v_user and lower(email) = v_old) then
    raise notice 'console_owner_email_swap: nothing to change';
    return;
  end if;

  -- Refuse rather than collide. Two accounts cannot share an address, and
  -- finding that out halfway through would leave the identity pointing at
  -- one address and the user row at another.
  if exists (select 1 from auth.users where lower(email) = v_new) then
    raise exception 'console_owner_email_swap: % already belongs to another account', v_new;
  end if;

  update auth.users
     set email = v_new,
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_user;

  update auth.identities
     set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new)),
         updated_at = now()
   where user_id = v_user
     and provider = 'email';

  update public.platform_admins
     set email = v_new
   where id = v_user;

  raise notice 'console_owner_email_swap: moved % to %', v_old, v_new;
end $$;
