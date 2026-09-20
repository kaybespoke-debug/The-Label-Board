-- =====================================================================
-- Partner commission, flattened: one rate, twelve months, per business.
--
-- Kayode's specification, 20 September 2026, replacing the tiered model
-- that shipped the day before:
--
--     Flat 8% per referred business. No tiers, no milestone bonuses.
--     Monthly plan:  8% of each monthly payment, for 12 months while the
--                    business stays active, then it ends.
--     Yearly plan:   a one-time 8% of that year's payment.
--     Only while the business is active and paying. If it churns,
--     commission stops that day and nothing further is owed.
--     Only the partner earns. The referred business is a normal
--     full-price customer with no discount or reward.
--     Accrues monthly, pays out yearly, in naira.
--     The 12-month clock is per business, from the day it first pays.
--
-- WHY THIS IS THE THIRD SHAPE IN TWO DAYS, which is worth writing down
-- because the next person will wonder whether anybody was thinking.
--
--   The first was a one off share of a business's FIRST payment. It paid
--   a partner the same for a business that lasted a month as for one
--   that lasted five years, so it rewarded introductions rather than
--   good introductions.
--
--   The second fixed that and overcorrected: four years, a taper in
--   years three and four, and a rate that moved with a live count of
--   active businesses. Every rule in it was defensible and the answer to
--   "what will I earn on this one" was four numbers and two dates. For a
--   programme whose whole promise is that a partner can check the
--   working, that is a failure and not a detail.
--
--   This one is a single number and two conditions. It is worth less to
--   a partner with forty businesses than the ladder was, and it is worth
--   more to every partner who has not got there yet, which is all of
--   them.
--
-- WHAT THIS FILE CHANGES RATHER THAN ADDS
--
--   partner_rate_bands   collapses to a single band
--   partner_referral_rate  rewritten: the whole policy is in it
--   partner_accrue_month   rewritten: a yearly plan accrues once, and
--                          on the year's payment rather than the month
--   partner_milestones, partner_award_milestones   dropped
--
-- Nothing else shipped by an earlier migration is touched. partner_
-- clear_ledger and partner_payout_run are already right: the hold is
-- unchanged and the payout run was already yearly.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. One band.
--
-- The table stays rather than becoming a constant, for the reason it was
-- a table in the first place: Kayode will want to move the number one
-- day, and a number in a table is an update where a number in a function
-- is a migration. A single row with min_active 0 is a ladder with one
-- rung, which is exactly what a flat rate is.
-- ---------------------------------------------------------------------
delete from public.partner_rate_bands where min_active > 0;

insert into public.partner_rate_bands (min_active, rate_pct, label) values
  (0, 8, 'Partner')
on conflict (min_active) do update
  set rate_pct = excluded.rate_pct, label = excluded.label;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.partner_rate_bands;
  if v_n <> 1 then
    raise exception 'the programme is flat now, so there must be exactly one rate band, found %', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. The ledger learns that a yearly plan earns once.
--
-- A 'yearly' row is a different thing from a 'recurring' one and is
-- worth a kind of its own, because everything downstream that wants to
-- say "month 3 of 12" has to be able to tell that this is not one.
--
-- Two indexes rather than one. The first says a business cannot be paid
-- twice for the same month, which is what makes the monthly job safe to
-- re-run. The second says a business on a yearly plan cannot be paid
-- twice at all, which the first would not catch: a yearly plan renewing
-- in a different month is a different period and would slip through.
-- ---------------------------------------------------------------------
alter table public.partner_ledger
  drop constraint if exists partner_ledger_kind_check;
alter table public.partner_ledger
  add constraint partner_ledger_kind_check
  check (kind in ('signup', 'bonus', 'adjustment', 'recurring', 'yearly'));

alter table public.partner_ledger
  drop constraint if exists partner_ledger_period_shape;
alter table public.partner_ledger
  add constraint partner_ledger_period_shape
  check (
    (kind in ('recurring', 'yearly')
       and period is not null and period = date_trunc('month', period)::date)
    or (kind not in ('recurring', 'yearly') and period is null)
  );

drop index if exists partner_ledger_one_accrual_per_month;
create unique index partner_ledger_one_accrual_per_month
  on public.partner_ledger (referral_id, period)
  where kind in ('recurring', 'yearly');

create unique index if not exists partner_ledger_one_yearly_per_referral
  on public.partner_ledger (referral_id)
  where kind = 'yearly';

-- ---------------------------------------------------------------------
-- 3. When a referred business stops earning.
--
-- Per business, from its own first payment. It never resets and never
-- pauses, and the partner's other businesses have no effect on it.
--
-- A yearly plan has one payment and therefore one commission, so its
-- term is over the day it is credited. Returning the subscription date
-- rather than null saves every caller a special case, and reads
-- correctly in a portal: "nothing further due, 15 March".
-- ---------------------------------------------------------------------
create or replace function public.partner_referral_term_end(p_referral uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when r.subscribed_on is null then null
           when r.cycle = 'annual' then r.subscribed_on
           else (r.subscribed_on + interval '12 months')::date
         end
  from public.partner_referrals r
  where r.id = p_referral;
$$;

-- ---------------------------------------------------------------------
-- 4. The rate for ONE referred business on ONE day.
--
-- This is the whole policy in one function. Everything else calls it.
--
-- The order of the tests matters:
--
--   not active and paying  -> 0. Churn stops it the day it happens,
--                             whatever the clock says.
--   yearly plan            -> the band rate only inside the month it
--                             first paid, and 0 in every other month.
--                             That is what makes "once" true without
--                             the accrual having to go looking for
--                             whether it has already paid.
--   twelve months or more  -> 0, permanently.
--   otherwise              -> the band rate.
--
-- Still written as of a DATE rather than as of now, because every proof
-- and every back-dated re-run has to ask about a day that is not today.
-- And still reading the DATES rather than the stage column, for the
-- reason written above partner_active_paying in the earlier migration:
-- stage says where a referral stands today, and asking "was this paying
-- in April" of it gives April the answer for September.
-- ---------------------------------------------------------------------
create or replace function public.partner_referral_rate(p_referral uuid, p_on date)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.partner_referrals%rowtype;
  v_rate numeric;
begin
  select * into r from public.partner_referrals where id = p_referral;
  if not found then
    return 0;
  end if;

  if r.subscribed_on is null
     or r.subscribed_on > p_on
     or (r.lapsed_on is not null and r.lapsed_on <= p_on) then
    return 0;
  end if;

  select rate_pct into v_rate
  from public.partner_rate_bands
  where min_active = 0;
  if v_rate is null then
    return 0;
  end if;

  if r.cycle = 'annual' then
    if date_trunc('month', p_on) = date_trunc('month', r.subscribed_on) then
      return v_rate;
    end if;
    return 0;
  end if;

  if p_on >= (r.subscribed_on + interval '12 months')::date then
    return 0;
  end if;

  return v_rate;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. The monthly accrual.
--
-- Accrues one month, for one partner or for everybody, and returns the
-- number of rows it wrote so a caller can tell "nothing was owed" from
-- "it did not run".
--
-- The basis is the thing that changed here. A monthly plan is a share
-- of the month, so mrr. A yearly plan is a share of the year's payment,
-- so first_payment: taking 8% of a yearly customer's monthly EQUIVALENT
-- would pay their partner a twelfth of what they are owed, once, and it
-- would look like a rounding problem rather than a missing year.
--
-- on conflict do nothing, not an upsert. Re-running March must leave
-- March exactly as it was. Not inferring a conflict target either, so
-- that both indexes above are honoured by the same statement.
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
    select r.id, r.partner_id, r.cycle, r.mrr, r.first_payment
    from public.partner_referrals r
    where (p_partner is null or r.partner_id = p_partner)
      and r.subscribed_on is not null
      and r.subscribed_on <= v_end
      and (r.lapsed_on is null or r.lapsed_on > v_end)
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

-- ---------------------------------------------------------------------
-- 6. The working, for the portal and the console to read.
--
-- "The partner portal must show each partner their referred businesses,
--  which are active, the 8% applied, the accruing total, and when each
--  business's 12-month window ends."
--
-- One function, so the portal and the console cannot disagree about a
-- partner's figures: the console is the source of truth and this is what
-- it serves. Everything in it is derived from the ledger rather than
-- recomputed from the rules, because the ledger is what was decided at
-- the time and the rules are what we would decide today.
-- ---------------------------------------------------------------------
create or replace function public.partner_commission_summary(p_partner uuid)
returns table (
  referral_id     uuid,
  business_name   text,
  plan            text,
  cycle           text,
  subscribed_on   date,
  lapsed_on       date,
  is_active       boolean,
  rate_pct        numeric,
  months_credited int,
  term_ends_on    date,
  earned_total    numeric,
  earned_cleared  numeric,
  earned_paid     numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id,
         r.business_name,
         r.plan,
         r.cycle,
         r.subscribed_on,
         r.lapsed_on,
         (r.subscribed_on is not null and r.lapsed_on is null),
         (select rate_pct from public.partner_rate_bands where min_active = 0),
         (select count(*)::int from public.partner_ledger l
           where l.referral_id = r.id and l.kind in ('recurring', 'yearly')),
         public.partner_referral_term_end(r.id),
         coalesce((select sum(l.amount) from public.partner_ledger l
                    where l.referral_id = r.id), 0),
         coalesce((select sum(l.amount) from public.partner_ledger l
                    where l.referral_id = r.id and l.status = 'cleared'), 0),
         coalesce((select sum(l.amount) from public.partner_ledger l
                    where l.referral_id = r.id and l.status = 'paid'), 0)
  from public.partner_referrals r
  where r.partner_id = p_partner
  order by r.subscribed_on desc nulls last, r.business_name;
$$;

-- The portal asks about itself and nothing else. app.is_partner is the
-- same test every partner policy uses, and a caller who is not that
-- partner gets no rows rather than an error, which is the shape the
-- rest of the portal's reads already have.
create or replace function public.my_commission_summary()
returns table (
  referral_id     uuid,
  business_name   text,
  plan            text,
  cycle           text,
  subscribed_on   date,
  lapsed_on       date,
  is_active       boolean,
  rate_pct        numeric,
  months_credited int,
  term_ends_on    date,
  earned_total    numeric,
  earned_cleared  numeric,
  earned_paid     numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.* from public.partner_commission_summary(app.current_partner()) s
  where app.current_partner() is not null;
$$;

-- ---------------------------------------------------------------------
-- 7. The milestone bonuses are gone.
--
-- Dropped rather than emptied. An empty table and a function that awards
-- nothing is a programme that looks like it could come back on by
-- somebody inserting four rows, and the announcement telling partners it
-- has ended is not something to leave a switch under.
--
-- partner_ledger keeps 'bonus' in its kind constraint, because a manual
-- one-off is still a thing an operator might legitimately book, and
-- because dropping a value from a check constraint would break any row
-- already carrying it.
-- ---------------------------------------------------------------------
drop function if exists public.partner_award_milestones(uuid, date);
drop table if exists public.partner_milestones;

-- ---------------------------------------------------------------------
-- 8. Nobody but us runs the money.
--
-- Supabase grants execute on every new function in public to anon and
-- authenticated by default, and revoking from public does NOT undo that.
-- Each one has to be named. The harness tests the GRANT rather than the
-- call, because a function that errors for its own reasons looks exactly
-- like a function that was refused.
-- ---------------------------------------------------------------------
revoke execute on function public.partner_accrue_month(date, uuid)       from public, anon, authenticated;
revoke execute on function public.partner_referral_rate(uuid, date)      from public, anon, authenticated;
revoke execute on function public.partner_referral_term_end(uuid)        from public, anon, authenticated;
revoke execute on function public.partner_commission_summary(uuid)       from public, anon, authenticated;
grant  execute on function public.partner_accrue_month(date, uuid)       to service_role;
grant  execute on function public.partner_referral_rate(uuid, date)      to service_role;
grant  execute on function public.partner_referral_term_end(uuid)        to service_role;
grant  execute on function public.partner_commission_summary(uuid)       to service_role;

-- The one a partner may run, because it can only ever answer about them.
revoke execute on function public.my_commission_summary() from public, anon;
grant  execute on function public.my_commission_summary() to authenticated, service_role;
