-- =====================================================================
-- A partner could not exist before their account did.
--
-- partners.user_id was NOT NULL, so there was no way to prepare a partner
-- — their code, their tier, their referral link — before somebody had
-- signed up. And nothing created the row on signup either, so the portal's
-- one-time-code flow ended at app.partner_me() returning nothing and the
-- portal deciding it did not know who had just signed in.
--
-- Same shape as the studio fix: let the row exist first, carrying the
-- address that will claim it, and have the trigger on auth.users attach
-- the account when it appears.
--
-- user_id becomes nullable to allow that. It costs nothing: every partner
-- policy is `user_id = auth.uid()` or app.is_partner(), and auth.uid() is
-- never null for a signed-in caller, so an unclaimed row is invisible to
-- everybody rather than visible to anybody. Postgres allows repeated nulls
-- in a unique index, so several can wait at once.
--
-- A partner is not a studio. An address claiming a partner row gets a
-- partner and no business, because handing a referral partner a studio
-- they never asked for would put a whole second product in front of
-- somebody who came to be paid commission.
-- =====================================================================

alter table public.partners alter column user_id drop not null;
alter table public.partners add column if not exists pending_email text;

create unique index if not exists partners_pending_email_key
  on public.partners (lower(pending_email))
  where pending_email is not null;

-- ---------------------------------------------------------------------
-- Claim a prepared partner, or fall through to the studio path.
-- ---------------------------------------------------------------------
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
begin
  -- 0. a partner prepared for this address wins outright
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
    return new;
  end if;

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
  raise warning 'provision_studio failed for %: %', new.email, sqlerrm;
  return new;
end;
$$;

revoke all on function app.provision_studio() from public;

-- ---------------------------------------------------------------------
-- One partner to test against, with enough behind them that the portal
-- has something to show: a referral that converted, one that has not yet,
-- a commission that has cleared and one still pending, and a payout that
-- has been made. A portal tested against an empty account only proves the
-- empty state.
-- ---------------------------------------------------------------------
do $$
declare
  v_p    uuid;
  v_link uuid;
  v_r1   uuid;
  v_r2   uuid;
  v_pay  uuid;
begin
  select id into v_p from public.partners where code = 'TEST-PARTNER';
  if v_p is null then
    insert into public.partners (code, name, business_name, email, phone, city,
                                 tier, status, joined_on, pending_email)
    values ('TEST-PARTNER', 'Chidi Okafor', 'Okafor Consulting',
            'test.partner@thelabelboard.com', '+234 800 000 0001', 'Lagos',
            'silver', 'active', current_date - 120, 'test.partner@thelabelboard.com')
    returning id into v_p;
  end if;

  select id into v_link from public.partner_links where partner_id = v_p and is_default;
  if v_link is null then
    insert into public.partner_links (partner_id, label, code, clicks, active, is_default)
    values (v_p, 'Main link', 'TEST-PARTNER', 34, true, true)
    returning id into v_link;
  end if;

  -- converted, paying monthly
  select id into v_r1 from public.partner_referrals
   where partner_id = v_p and business_name = 'Zainab Couture';
  if v_r1 is null then
    insert into public.partner_referrals
      (partner_id, link_id, business_name, owner_name, city, stage, plan, cycle,
       mrr, first_payment, signed_up_on, subscribed_on, outlets, staff_count, added_by, last_seen)
    values (v_p, v_link, 'Zainab Couture', 'Zainab Bello', 'Abuja', 'subscribed',
            'pro', 'monthly', 25000, 25000, current_date - 90, current_date - 83,
            1, 4, 'self', current_date - 1)
    returning id into v_r1;
  end if;

  -- signed up, still on trial, nothing owed yet
  select id into v_r2 from public.partner_referrals
   where partner_id = v_p and business_name = 'Tunde Leatherworks';
  if v_r2 is null then
    insert into public.partner_referrals
      (partner_id, link_id, business_name, owner_name, city, stage, cycle,
       mrr, first_payment, signed_up_on, outlets, staff_count, added_by, last_seen)
    values (v_p, v_link, 'Tunde Leatherworks', 'Tunde Adeyemi', 'Aba', 'trial',
            'trial', 0, 0, current_date - 12, 1, 2, 'partner', current_date - 2)
    returning id into v_r2;
  end if;

  -- a payout that has been made, and the cleared commission it settled
  select id into v_pay from public.partner_payouts where partner_id = v_p and ref = 'PO-0001';
  if v_pay is null then
    insert into public.partner_payouts
      (partner_id, ref, paid_on, amount, method, bank_ref, account_name, bank_name, account_number)
    values (v_p, 'PO-0001', current_date - 30, 7500, 'bank transfer', 'TRF-88213',
            'Chidi Okafor', 'GTBank', '0123456789')
    returning id into v_pay;
  end if;

  if not exists (select 1 from public.partner_ledger where partner_id = v_p and note = 'First month, Zainab Couture') then
    insert into public.partner_ledger
      (partner_id, referral_id, payout_id, kind, amount, rate_pct, tier, basis, note,
       credited_on, clears_on, status)
    values (v_p, v_r1, v_pay, 'signup', 7500, 30, 'silver', 25000,
            'First month, Zainab Couture', current_date - 83, current_date - 53, 'paid');
  end if;

  -- and one still waiting to clear, so the portal has a pending balance
  if not exists (select 1 from public.partner_ledger where partner_id = v_p and note = 'Second month, Zainab Couture') then
    insert into public.partner_ledger
      (partner_id, referral_id, kind, amount, rate_pct, tier, basis, note,
       credited_on, clears_on, status)
    values (v_p, v_r1, 'signup', 7500, 30, 'silver', 25000,
            'Second month, Zainab Couture', current_date - 20, current_date + 10, 'pending');
  end if;

  if not exists (select 1 from public.partner_accounts where partner_id = v_p) then
    insert into public.partner_accounts
      (partner_id, account_name, bank_name, account_number, currency, is_primary, verified, verified_on)
    values (v_p, 'Chidi Okafor', 'GTBank', '0123456789', 'NGN', true, true, current_date - 100);
  end if;
end $$;
