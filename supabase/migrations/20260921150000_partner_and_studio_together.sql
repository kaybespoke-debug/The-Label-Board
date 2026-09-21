-- =====================================================================
-- A partner who has also been prepared a studio gets both.
--
-- FOUND THE HARD WAY, 21 September 2026. LAYI was prepared for
-- layiojomo@gmail.com by 20260921140000. Kayode created the account.
-- The studio was not claimed, he was attached to partner KUNLE instead,
-- and nothing anywhere said so: the business kept its pending address,
-- the trigger returned happily, and the account directory quietly read
-- "partner".
--
-- app.provision_studio() opened with a partner claim that returned
-- outright, so the prepared-studio branch below it was never reached.
--
-- THE EARLY RETURN WAS NOT WRONG, IT WAS TOO WIDE. It exists to stop
-- step 2, which invents a studio out of the account's own metadata for
-- anybody who arrives unexpected. Handing a brand new studio to somebody
-- who was invited as a referral partner is exactly the accident it was
-- put there to prevent, and onboarding_harness has guarded it since
-- September the 4th.
--
-- A studio prepared in step 1 is a different thing entirely. It is an
-- operator writing down, in advance, that this address owns this
-- business. There is nothing to guess and nothing to guard against.
-- Partner AND studio is a supported combination: all six seeded test
-- studios are both, and account_directory has a `belongs_to` value that
-- says "partner + studio" in as many words.
--
-- So the claim still happens first and still suppresses step 2. It no
-- longer suppresses step 1.
--
-- COPIED FROM 20260920130000_one_referral_programme.sql, WHICH IS THE
-- CURRENT ONE. This function has been redefined four times and the
-- first draft of this migration copied the September 4th generation,
-- which silently undid the billing record added on the 5th and the
-- referral code added on the 20th. `billing_harness` caught it in under
-- a minute. Before touching it again: grep every migration for the
-- name, take the LAST, and diff what you are about to apply against it.
--
-- Three changes, and the diff against that file is exactly three:
--
--   1. the partner claim's `return new` becomes an `end if`
--   2. the studio branch gains `elsif v_partner is not null then
--      return new`, which is where the old behaviour now lives
--   3. the customer referral code is skipped when the account ALREADY
--      has a partner row
--
-- Three matters more than it looks. `partners.user_id` is UNIQUE, so
-- giving a studio its referral code fails for somebody who is already a
-- partner — and the whole function is wrapped in `exception when others`,
-- which rolls back the subtransaction. The profile and the membership go
-- with it. The account would have ended up with no studio at all and one
-- warning in a log nobody reads. Which is, near enough, what happened.
-- =====================================================================

create or replace function app.provision_studio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_biz     uuid;
  v_partner uuid;
  v_name    text;
  v_slug    text;
  v_n       int := 0;
  v_code    text;
  v_ref     text;
begin
  -- 0. a partner prepared for this address is claimed first
  select p.id into v_partner
  from public.partners p
  where p.pending_email is not null
    and lower(p.pending_email) = lower(new.email)
    and p.user_id is null
  limit 1;

  if v_partner is not null then
    update public.partners
       set user_id = new.id, pending_email = null
     where id = v_partner;
  end if;

  -- 1. a studio prepared for this address, waiting to be claimed
  select b.id into v_biz
  from public.businesses b
  where b.pending_owner_email is not null
    and lower(b.pending_owner_email) = lower(new.email)
  limit 1;

  if v_biz is not null then
    update public.businesses set pending_owner_email = null where id = v_biz;
  elsif v_partner is not null then
    -- claimed as a partner and no studio was prepared for them: they are a
    -- partner and nothing else. Never invent one. This is the case the old
    -- early return existed for, and it is still refused.
    return new;
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

  -- A studio with no subscription row is a studio nobody is counting.
  perform app.ensure_billing_record(v_biz);

  -- ADDED 20 Sep 2026: every customer is a referrer. One programme, so
  -- the code exists from the first day rather than being something an
  -- operator has to remember to hand out.
  if not exists (select 1 from public.partners where business_id = v_biz)
     and not exists (select 1 from public.partners where user_id = new.id) then
    select name into v_name from public.businesses where id = v_biz;
    v_code := app.referral_code_for(v_name);
    insert into public.partners
      (user_id, code, name, business_name, email, status, joined_on, kind, business_id)
    values
      (new.id, v_code,
       coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
                initcap(split_part(new.email, '@', 1))),
       v_name, new.email, 'active', current_date, 'customer', v_biz);
  end if;

  -- ADDED 20 Sep 2026: and if they arrived on somebody's code, the tie is
  -- made here, where the business and the account both exist for the
  -- first time. attach_referral does the self-referral checks and writes
  -- the attempt down either way.
  v_ref := nullif(btrim(new.raw_user_meta_data ->> 'referral_code'), '');
  if v_ref is not null then
    perform app.attach_referral(v_biz, v_ref);
  end if;

  return new;
exception when others then
  raise warning 'provision_studio failed for %: %', new.email, sqlerrm;
  return new;
end;
$$;

revoke all on function app.provision_studio() from public;

-- ---------------------------------------------------------------------
-- And attach anybody the old shape left stranded.
--
-- The trigger only ever runs once, at the moment the account is created,
-- so fixing it does nothing for an account that has already arrived. A
-- business still carrying a pending address for an account that exists
-- is the exact footprint of the bug, and it is a footprint worth keeping
-- an eye on: it should always be empty.
--
-- Written as a loop over that condition rather than as a one-off for
-- LAYI, because the same swallow could have happened to any studio
-- prepared for somebody who was already waiting as a partner, and
-- because this is then safe to run at any point in the future.
--
-- It does the same four things the trigger does, in the same order, so a
-- repaired account is indistinguishable from one that arrived cleanly.
-- ---------------------------------------------------------------------

do $$
declare r record; n int := 0; v_code text; v_name text;
begin
  for r in
    select b.id as biz, b.name as biz_name, u.id as uid, u.email as email,
           u.raw_user_meta_data as meta
      from public.businesses b
      join auth.users u on lower(u.email) = lower(b.pending_owner_email)
     where b.pending_owner_email is not null
  loop
    update public.businesses set pending_owner_email = null where id = r.biz;

    insert into public.profiles (id, name, role_id, business_id)
    values (r.uid,
            coalesce(nullif(btrim(r.meta ->> 'name'), ''),
                     initcap(split_part(r.email, '@', 1))),
            'owner', r.biz)
    on conflict (id) do update set business_id = excluded.business_id;

    insert into public.memberships (business_id, user_id, role, status)
    values (r.biz, r.uid, 'owner', 'active')
    on conflict (business_id, user_id) do update
      set role = 'owner', status = 'active';

    perform app.ensure_billing_record(r.biz);

    -- same guard as the trigger, for the same reason: user_id is unique
    if not exists (select 1 from public.partners where business_id = r.biz)
       and not exists (select 1 from public.partners where user_id = r.uid) then
      select name into v_name from public.businesses where id = r.biz;
      v_code := app.referral_code_for(v_name);
      insert into public.partners
        (user_id, code, name, business_name, email, status, joined_on, kind, business_id)
      values
        (r.uid, v_code,
         coalesce(nullif(btrim(r.meta ->> 'name'), ''),
                  initcap(split_part(r.email, '@', 1))),
         v_name, r.email, 'active', current_date, 'customer', r.biz);
    end if;

    n := n + 1;
    raise notice 'attached % to % (was stranded)', r.email, r.biz_name;
  end loop;
  raise notice 'stranded studios attached: %', n;
end $$;
