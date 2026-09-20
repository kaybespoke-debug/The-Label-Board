-- =====================================================================
-- The 14 day free trial, and the one rule that makes it safe to give away.
--
-- Kayode, 20 September 2026:
--
--   "14-day free trial of the Pro plan. Card required at signup via
--    Flutterwave, but not charged until day 15."
--   "During the trial, the account has full Pro access (gates applied as
--    Pro)."
--   "If they cancel during the trial: no charge, access ends when the
--    trial ends."
--   "Partner commission must NOT trigger on a trial signup or during the
--    trial. Commission only starts when the first REAL charge succeeds
--    (day 15). A trial that never converts pays no commission. Enforce
--    this in the commission engine."
--
-- THE ONE THAT MATTERS
--
-- Everything else here is bookkeeping. The commission rule is the one that
-- costs real money if it is wrong, because a free trial plus a referral
-- programme is a machine for paying commission on revenue that never
-- arrived. Fourteen days is long enough to sign up, collect 8% of a
-- subscription nobody paid for, and walk away.
--
-- So it is enforced TWICE, and deliberately so:
--
--   1. partner_accrue_month skips a business that is still on trial.
--      That is the engine doing the right thing.
--   2. A trigger on partner_ledger REFUSES an accrual for a referral whose
--      business has never had a real payment. That is the engine being
--      unable to do the wrong thing, including by hand, including from the
--      console, including from a future Flutterwave webhook written by
--      somebody who has not read this file.
--
-- The second one is what the harness proves, because a rule that is only
-- in the function that happens to be called today is a rule that lasts
-- until somebody writes a second caller.
--
-- WHAT DECIDES WHEN COMMISSION STARTS
--
-- partner_referrals.subscribed_on, and nothing else. It is null through
-- the whole trial and is set by convert_trial_to_paid() on the day the
-- first real charge settles. Note what this means: NO migration in this
-- repo has ever set subscribed_on. It was written by hand. From here it
-- has exactly one writer, which is the point.
--
-- WHAT IS NOT HERE
--
-- Flutterwave. No key, no charge, no webhook. This file is the half that
-- decides what is true; the half that talks to a payment processor calls
-- convert_trial_to_paid() when a charge settles and cancel_trial() when
-- somebody stops. See BILLING.md. Both functions are service_role only,
-- so the browser can neither start nor convert a trial.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A trial is a dated thing on the business.
--
-- tlb_subscriptions already carries is_trial and trial_end_date, and that
-- stays our copy for the books. These two are the TENANT's copy, because
-- the app has to be able to say "6 days left" to the person using it and
-- a tenant cannot read a tlb_ table. Both are written by the functions
-- below and never separately, for the same reason set_studio_plan writes
-- both books at once: two dates that can disagree eventually will.
-- ---------------------------------------------------------------------
alter table public.businesses
  add column if not exists trial_started_on date,
  add column if not exists trial_ends_on    date,
  add column if not exists trial_cancelled_on date;

-- trial_started_on is HISTORY and outlives the trial: it is what stops a
-- business taking a second one. trial_ends_on is the live part and is
-- cleared on conversion, so "started but no longer ending" is the normal
-- state of every paying customer that began on a trial. An earlier draft
-- of this constraint required the two to be null together, which made
-- convert_trial_to_paid() fail on its own update.
alter table public.businesses
  drop constraint if exists businesses_trial_dates;
alter table public.businesses
  add constraint businesses_trial_dates
  check ((trial_ends_on is null or trial_started_on is not null)
         and (trial_ends_on is null or trial_ends_on >= trial_started_on)
         and (trial_cancelled_on is null or trial_started_on is not null));

comment on column public.businesses.trial_ends_on is
  'Last day of the free trial. Day 15 is the first charge. Written only by start_free_trial() and cleared only by convert_trial_to_paid().';

-- The tenant may not write any of these. The column grant from
-- 20260905130000 names the four columns a studio may update, and these
-- three are locked by being left out of it. Restated rather than assumed,
-- because that is the mistake the grant exists because of.
revoke update on public.businesses from authenticated, anon;
grant  update (name, contact_email, last_seen_at, app_version)
  on public.businesses to authenticated;

-- ---------------------------------------------------------------------
-- 2. "Full Pro access" is a real sentence with a real consequence.
--
-- plan_features already gives 'trial' every feature. plan_limits did NOT:
-- it gave a trial 1 studio and 3 logins while Pro gets 5 and 50. A studio
-- told it has full Pro access and then refused a second studio would be
-- right to say we had lied, so the ceilings move to match the words.
--
-- The card requirement is what makes this safe to hand out. An anonymous
-- trial with five studios would be worth farming; one that needs a real
-- instrument, checked against payment_methods, is not.
-- ---------------------------------------------------------------------
update public.plan_limits
   set max_studios = (select max_studios from public.plan_limits where plan = 'pro'),
       max_seats   = (select max_seats   from public.plan_limits where plan = 'pro')
 where plan = 'trial';

do $$
declare v_t record; v_p record;
begin
  select * into v_t from public.plan_limits where plan = 'trial';
  select * into v_p from public.plan_limits where plan = 'pro';
  if v_t.max_studios is distinct from v_p.max_studios
     or v_t.max_seats is distinct from v_p.max_seats then
    raise exception 'the trial is sold as full Pro access, so its ceilings must equal Pro: trial %/% against pro %/%',
      v_t.max_studios, v_t.max_seats, v_p.max_studios, v_p.max_seats;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Is this business inside a trial today?
-- ---------------------------------------------------------------------
create or replace function app.on_trial(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select b.trial_ends_on is not null and b.trial_ends_on >= current_date
     from public.businesses b where b.id = p_business),
    false);
$$;

-- Has this business ever actually paid us? The question the commission
-- engine asks, and the only one it should ask. A trial is not a payment
-- however long it has been running and however Pro it feels.
create or replace function app.has_paid(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tlb_payments p
    join public.tlb_customers c on c.id = p.customer_id
    where c.business_id = p_business
      and p.status = 'completed'
      and p.amount > 0);
$$;

revoke execute on function app.on_trial(uuid) from public, anon, authenticated;
revoke execute on function app.has_paid(uuid) from public, anon, authenticated;
grant  execute on function app.on_trial(uuid) to service_role;
grant  execute on function app.has_paid(uuid) to service_role;

-- The app's own view of its trial, so it can say how long is left.
create or replace function public.my_trial()
returns table (business_id uuid, plan text, on_trial boolean,
               trial_started_on date, trial_ends_on date,
               days_left int, cancelled boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.plan,
         (b.trial_ends_on is not null and b.trial_ends_on >= current_date),
         b.trial_started_on, b.trial_ends_on,
         case when b.trial_ends_on is null then null
              else greatest(0, (b.trial_ends_on - current_date) + 1) end,
         b.trial_cancelled_on is not null
  from public.businesses b
  where app.in_scope(b.id, null);
$$;

revoke all     on function public.my_trial() from public, anon;
grant  execute on function public.my_trial() to authenticated;

-- ---------------------------------------------------------------------
-- 4. THE GUARD. No commission on money that has not arrived.
--
-- A recurring or yearly accrual is only allowed to exist if the business
-- behind it has actually paid us at least once. Everything else about the
-- programme is a policy; this is a wall.
--
-- Manual kinds are left alone on purpose. 'bonus' and 'adjustment' are an
-- operator deliberately booking something, with their name on it in the
-- audit log, and refusing those would stop us correcting our own mistake.
-- ---------------------------------------------------------------------
create or replace function app.no_commission_before_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid;
  v_name     text;
begin
  if new.kind not in ('recurring', 'yearly') then
    return new;
  end if;

  select r.business_id, r.business_name into v_business, v_name
  from public.partner_referrals r where r.id = new.referral_id;

  -- A referral with no business row is historic test data, not a trial.
  if v_business is null then
    return new;
  end if;

  if app.has_paid(v_business) then
    return new;
  end if;

  raise exception
    'no commission on %: it has never paid us. A free trial is not a payment, and a trial that never converts earns nobody anything.',
    coalesce(v_name, v_business::text)
    using errcode = 'check_violation',
          hint = 'Commission starts when the first real charge settles. convert_trial_to_paid() is what moves it.';
end;
$$;

drop trigger if exists partner_ledger_no_commission_before_payment on public.partner_ledger;
create trigger partner_ledger_no_commission_before_payment
  before insert on public.partner_ledger
  for each row execute function app.no_commission_before_payment();

revoke execute on function app.no_commission_before_payment() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. The engine, told the same thing in its own words.
--
-- The body below is 20260920110000's partner_accrue_month COPIED, with one
-- condition added to the loop and nothing else touched. Retyping a shipped
-- function from memory silently changed three things on this project once
-- already, which is why the rule here is to copy and diff.
-- ---------------------------------------------------------------------
create or replace function public.partner_accrue_month(p_month date, p_partner uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_rate  numeric;
  v_basis numeric;
  v_kind  text;
  v_note  text;
  v_rows  int := 0;
  rec     record;
begin
  for rec in
    select r.id, r.partner_id, r.cycle, r.mrr, r.first_payment, r.business_id
    from public.partner_referrals r
    where (p_partner is null or r.partner_id = p_partner)
      and r.subscribed_on is not null
      and r.subscribed_on <= v_end
      and (r.lapsed_on is null or r.lapsed_on > v_end)
      -- ADDED 20 Sep 2026: a business inside its free trial has paid us
      -- nothing, so there is nothing to take a share of. The trigger above
      -- would refuse the insert anyway; this stops the engine trying, so a
      -- trial month is "nothing was owed" rather than an error.
      and (r.business_id is null or not app.on_trial(r.business_id))
  loop
    v_rate := public.partner_referral_rate(rec.id, v_end);
    if v_rate is null or v_rate = 0 then
      continue;
    end if;

    if rec.cycle = 'annual' then
      v_kind  := 'yearly';
      v_basis := rec.first_payment;
      v_note  := 'Commission on the year paid up front';
    else
      v_kind  := 'recurring';
      v_basis := rec.mrr;
      v_note  := 'Recurring commission for ' || to_char(v_start, 'Mon YYYY');
    end if;

    if v_basis is null or v_basis <= 0 then
      continue;
    end if;

    insert into public.partner_ledger
      (partner_id, referral_id, kind, amount, rate_pct, tier, basis, note,
       credited_on, clears_on, status, period)
    values
      (rec.partner_id, rec.id, v_kind,
       round(v_basis * v_rate / 100, 2), v_rate,
       (select label from public.partner_rate_bands where min_active = 0),
       v_basis, v_note,
       v_end, (v_end + interval '31 days')::date, 'pending', v_start)
    on conflict do nothing;

    if found then
      v_rows := v_rows + 1;
    end if;
  end loop;

  return v_rows;
end;
$$;

revoke execute on function public.partner_accrue_month(date, uuid) from public, anon, authenticated;
grant  execute on function public.partner_accrue_month(date, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 6. Starting one.
--
-- Fourteen days is the default and an argument rather than a constant, so
-- a longer trial agreed on a call is a parameter and not a migration.
-- The plan goes to 'trial', which plan_features already treats as having
-- everything and whose ceilings now equal Pro's.
-- ---------------------------------------------------------------------
create or replace function public.start_free_trial(
  p_business uuid, p_days int default 14)
returns date
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_ends date;
begin
  if p_days is null or p_days < 1 then
    raise exception 'a trial of % days makes no sense', p_days;
  end if;
  if not exists (select 1 from public.businesses where id = p_business) then
    raise exception 'no such business: %', p_business;
  end if;
  if exists (select 1 from public.businesses
              where id = p_business and trial_started_on is not null) then
    raise exception 'that business has already had its free trial'
      using hint = 'One per business. A second one is a plan change, not a trial.';
  end if;

  v_ends := current_date + (p_days - 1);

  update public.businesses
     set plan               = 'trial',
         trial_started_on   = current_date,
         trial_ends_on      = v_ends,
         trial_cancelled_on = null
   where id = p_business;

  -- our books say the same thing
  update public.tlb_subscriptions s
     set is_trial = true, trial_end_date = v_ends
   from public.tlb_customers c
  where c.id = s.customer_id and c.business_id = p_business and s.is_active;

  return v_ends;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Day 15: the first real charge settled.
--
-- This is the ONLY thing that starts a commission clock. It books the
-- payment through the function that already exists, moves the plan through
-- the function that already exists, and then sets subscribed_on, which is
-- what partner_referral_rate counts twelve months from.
--
-- p_paid_on rather than current_date, because a retry that succeeds on day
-- 17 is still the first charge and a back-dated re-run has to be possible.
-- ---------------------------------------------------------------------
create or replace function public.convert_trial_to_paid(
  p_business  uuid,
  p_plan      text,
  p_cycle     text,
  p_price     numeric,
  p_paid_on   date default current_date,
  p_reference text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_payment uuid;
begin
  if p_plan not in ('starter', 'pro', 'premium') then
    raise exception 'converting a trial needs a real plan, not %', p_plan;
  end if;
  if p_cycle not in ('monthly', 'annual') then
    raise exception 'converting a trial needs a real cycle, not %', p_cycle;
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'a conversion is a payment, so it needs an amount';
  end if;

  -- 1. the money, first, because everything below is only true if it landed
  v_payment := public.record_studio_payment(
    p_business, p_price, 'card',
    coalesce(p_reference, 'trial conversion'),
    'First charge after the free trial');

  -- 2. the plan they are now on
  perform app.set_studio_plan(p_business, p_plan, p_cycle, p_price);

  -- 3. the trial is over and does not come back
  update public.businesses
     set trial_ends_on = null, trial_cancelled_on = null
   where id = p_business;

  update public.tlb_subscriptions s
     set is_trial = false, trial_end_date = null
   from public.tlb_customers c
  where c.id = s.customer_id and c.business_id = p_business;

  -- 4. and NOW the commission clock starts, not a day before
  update public.partner_referrals
     set stage         = 'subscribed',
         plan          = p_plan,
         cycle         = p_cycle,
         mrr           = case when p_cycle = 'annual' then round(p_price / 12, 2) else p_price end,
         first_payment = p_price,
         subscribed_on = coalesce(subscribed_on, p_paid_on)
   where business_id = p_business;

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Cancelled during the trial: nothing is charged, and it runs out.
--
-- The referral is deliberately NOT lapsed. partner_referrals_lapsed_after_paid
-- refuses a lapse date on a referral that never subscribed, and it is right
-- to: a business that never paid cannot have stopped paying. It simply
-- stays at 'signed-up' for ever, earning nothing, which is the truth.
-- ---------------------------------------------------------------------
create or replace function public.cancel_trial(p_business uuid)
returns date
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_ends date;
begin
  select trial_ends_on into v_ends from public.businesses where id = p_business;
  if v_ends is null then
    raise exception 'that business is not on a trial';
  end if;

  update public.businesses
     set trial_cancelled_on = current_date
   where id = p_business;

  return v_ends;   -- they keep it until the last day they were promised
end;
$$;

-- ---------------------------------------------------------------------
-- 9. The day after: a trial that ended without a payment stops.
--
-- Run daily by the same scheduler that will run the charges. Split out so
-- it can be proved without one, and so "what happens on day 15" has an
-- answer that is a function rather than a paragraph.
--
-- suspended, not deleted and not closed. Their records are theirs and they
-- can still be exported, which is the promise the website makes.
-- ---------------------------------------------------------------------
create or replace function public.expire_finished_trials(p_on date default current_date)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_rows int;
begin
  update public.businesses b
     set status = 'suspended'
   where b.trial_ends_on is not null
     and b.trial_ends_on < p_on
     and b.status = 'active'
     and not app.has_paid(b.id);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Nobody but us.
--
-- Supabase grants execute on every new function in public to anon and
-- authenticated by default, and revoking from public does NOT undo it.
-- Each one is named. Starting a trial, converting one and cancelling one
-- all cost money, so none of them is reachable from a browser: the
-- Flutterwave webhook will come in through an Edge Function holding the
-- service role, the same way the console already does.
-- ---------------------------------------------------------------------
revoke execute on function public.start_free_trial(uuid, int)                                   from public, anon, authenticated;
revoke execute on function public.convert_trial_to_paid(uuid, text, text, numeric, date, text)  from public, anon, authenticated;
revoke execute on function public.cancel_trial(uuid)                                            from public, anon, authenticated;
revoke execute on function public.expire_finished_trials(date)                                  from public, anon, authenticated;
grant  execute on function public.start_free_trial(uuid, int)                                   to service_role;
grant  execute on function public.convert_trial_to_paid(uuid, text, text, numeric, date, text)  to service_role;
grant  execute on function public.cancel_trial(uuid)                                            to service_role;
grant  execute on function public.expire_finished_trials(date)                                  to service_role;
