-- =====================================================================
-- Partner commission: recurring, tiered, and on a four year clock.
--
-- Kayode's specification, 19 September 2026. This replaces a one off
-- share of each referred business's FIRST payment with a recurring share
-- of what they keep paying, and it is the reason every number on the
-- partners page changed.
--
--   Tier, from the partner's CURRENT count of active paying referrals:
--       0-4   0%     earning is not unlocked yet
--       5-14  6%
--       15-29 7%
--       30+   8%
--
--   Clock, per referred business, from the day IT first paid:
--       years 1-2   the tier rate
--       years 3-4   3%, a loyalty taper
--       year 5 on   0%, and that business never earns again
--
--   The clock is per business. It never resets and never pauses, and the
--   partner's total count moving has no effect on it.
--
-- THE THREE RULES THAT DECIDE THE SHAPE OF ALL OF THIS
--
-- 1. Forward only, in both directions. A partner who falls from 30 active
--    to 20 drops from 8% to 7% on FUTURE accruals. Nothing already
--    credited is recomputed, and nothing is clawed back. A partner who
--    climbs back lifts again, also only forward. This is why the ledger
--    stores rate_pct and basis by value: the row is a record of what was
--    decided that month, not a formula to be re-evaluated later. The
--    original partner_portal migration already said this in a comment and
--    it is worth saying twice.
--
-- 2. Nothing accrues for a business that is not active and paying. Churn
--    stops it that day, and its four year clock stops mattering.
--
-- 3. The rules live here, not in the portal. A rate the browser works out
--    is a rate the browser can be persuaded to work out differently. Same
--    discipline as tenant isolation and the plan limits.
--
-- WHAT THIS FILE DOES NOT DO
--
-- It does not touch any function shipped by an earlier migration. The one
-- existing object it changes is the partner_ledger kind constraint, which
-- gains a value, and that is done by name rather than by retyping the
-- table. A previous session retyped a shipped function from memory and
-- silently changed three things nobody asked for.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The rate ladder, as data rather than as a number buried in code.
--
-- A table because Kayode will want to move these without a migration one
-- day, and because the portal and the console should show the same
-- ladder they are paid from rather than their own copy of it.
-- ---------------------------------------------------------------------
create table if not exists public.partner_rate_bands (
  -- the lowest active-paying count this band covers
  min_active int primary key check (min_active >= 0),
  rate_pct   numeric(5,2) not null check (rate_pct >= 0 and rate_pct <= 100),
  label      text not null
);

insert into public.partner_rate_bands (min_active, rate_pct, label) values
  (0,  0, 'Getting started'),
  (5,  6, 'Unlocked'),
  (15, 7, 'Established'),
  (30, 8, 'Senior')
on conflict (min_active) do update
  set rate_pct = excluded.rate_pct, label = excluded.label;

-- A band at zero has to exist or the lookup below has no floor and a new
-- partner's rate comes back null instead of nothing.
do $$
begin
  if not exists (select 1 from public.partner_rate_bands where min_active = 0) then
    raise exception 'partner_rate_bands has no zero band, every rate lookup would return null';
  end if;
end $$;

alter table public.partner_rate_bands enable row level security;
alter table public.partner_rate_bands force  row level security;

-- Readable by anyone signed in, because the portal shows the ladder.
-- Writable by nobody: no policy for insert, update or delete exists, and
-- with RLS forced that includes the table owner.
drop policy if exists partner_rate_bands_read on public.partner_rate_bands;
create policy partner_rate_bands_read on public.partner_rate_bands
  for select to authenticated using (true);

revoke all on public.partner_rate_bands from anon;
grant select on public.partner_rate_bands to authenticated;

-- ---------------------------------------------------------------------
-- 2. The ledger learns to hold a recurring accrual.
--
-- kind gains 'recurring'. period is the month the accrual is FOR, which
-- is what makes the monthly job safe to run twice: the unique index
-- refuses the second row rather than paying a partner twice for March.
-- ---------------------------------------------------------------------
alter table public.partner_ledger
  drop constraint if exists partner_ledger_kind_check;
alter table public.partner_ledger
  add constraint partner_ledger_kind_check
  check (kind in ('signup','bonus','adjustment','recurring'));

alter table public.partner_ledger
  add column if not exists period date;

-- Only a recurring row carries a period, and it is always a first of month.
alter table public.partner_ledger
  drop constraint if exists partner_ledger_period_shape;
alter table public.partner_ledger
  add constraint partner_ledger_period_shape
  check (
    (kind = 'recurring' and period is not null and period = date_trunc('month', period)::date)
    or (kind <> 'recurring' and period is null)
  );

-- One accrual per referred business per month. This is the whole
-- protection against a double run, and it is in the database rather than
-- in the job, because the job is the thing that will be re-run by hand at
-- eleven at night when a month looks wrong.
create unique index if not exists partner_ledger_one_accrual_per_month
  on public.partner_ledger (referral_id, period)
  where kind = 'recurring';

-- ---------------------------------------------------------------------
-- 2b. A lapsed referral has to say WHEN it lapsed.
--
-- Everything below reads the dates rather than the stage, so that asking
-- about a past month gives the answer that month had. That is only safe if
-- a lapsed row cannot exist without its date: without this constraint a row
-- marked lapsed with a null lapsed_on would go on accruing for ever, and it
-- would look like a rounding problem rather than a missing date.
-- ---------------------------------------------------------------------
alter table public.partner_referrals
  drop constraint if exists partner_referrals_lapsed_has_date;
alter table public.partner_referrals
  add constraint partner_referrals_lapsed_has_date
  check (stage <> 'lapsed' or lapsed_on is not null);

-- ---------------------------------------------------------------------
-- 3. Who is active and paying, on a given day.
--
-- Written as of a date rather than as of now, because every proof and
-- every back-dated recalculation needs to ask the question about a day
-- that is not today. A function that can only answer "now" cannot be
-- tested against the past.
-- ---------------------------------------------------------------------
-- The DATES decide this, not the stage column, and the first draft of this
-- function got it wrong. stage is a description of where a referral stands
-- today; subscribed_on and lapsed_on are a record of when it moved. Asking
-- "was this paying on 30 April" of the stage column gives the answer for
-- today, so the moment a business churned in May, April started reporting
-- that it had never been paying and a re-run of April would have quietly
-- paid the partner less than the April they were already shown. The harness
-- caught it on the assertion that the day BEFORE a churn is untouched.
--
-- This is only sound because a lapsed referral is now required to carry the
-- day it lapsed. That constraint is added below.
create or replace function public.partner_active_paying(p_partner uuid, p_on date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.partner_referrals r
  where r.partner_id = p_partner
    and r.subscribed_on is not null
    and r.subscribed_on <= p_on
    and (r.lapsed_on is null or r.lapsed_on > p_on);
$$;

-- ---------------------------------------------------------------------
-- 4. The band for a count.
-- ---------------------------------------------------------------------
create or replace function public.partner_tier_rate(p_active integer)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select b.rate_pct
  from public.partner_rate_bands b
  where b.min_active <= greatest(coalesce(p_active, 0), 0)
  order by b.min_active desc
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- 5. The rate for ONE referred business on ONE day.
--
-- This is the whole policy in one place. Everything else calls it.
--
-- The order of the tests matters and is not arbitrary:
--
--   not active and paying  -> 0. A churned business earns nothing from
--                             the day it churns, whatever its clock says.
--   four years or more     -> 0, permanently. Checked before the tier so
--                             that a partner climbing to 30 cannot revive
--                             a business that has already run out.
--   tier is 0              -> 0. Below five paying, nothing is unlocked,
--                             and that includes the taper years. Earning
--                             is unlocked by the count or not at all.
--   under two years        -> the tier rate.
--   otherwise              -> 3, the taper, flat and not a share of tier.
-- ---------------------------------------------------------------------
create or replace function public.partner_referral_rate(p_referral uuid, p_on date)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r        public.partner_referrals%rowtype;
  v_active int;
  v_tier   numeric;
begin
  select * into r from public.partner_referrals where id = p_referral;
  if not found then
    return 0;
  end if;

  -- dates, not stage, for the reason written above partner_active_paying
  if r.subscribed_on is null
     or r.subscribed_on > p_on
     or (r.lapsed_on is not null and r.lapsed_on <= p_on) then
    return 0;
  end if;

  if p_on >= (r.subscribed_on + interval '4 years')::date then
    return 0;
  end if;

  v_active := public.partner_active_paying(r.partner_id, p_on);
  v_tier   := public.partner_tier_rate(v_active);
  if v_tier is null or v_tier = 0 then
    return 0;
  end if;

  if p_on < (r.subscribed_on + interval '2 years')::date then
    return v_tier;
  end if;

  return 3;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. The monthly accrual.
--
-- Accrues for one month, for one partner or for everybody. Returns the
-- number of ledger rows it wrote, so a caller can tell the difference
-- between "nothing was owed" and "it did not run".
--
-- The rate is read on the LAST day of the month being accrued, which is
-- the decision that makes "forward only" true in practice: a partner who
-- crosses a threshold mid-month earns the new rate on that whole month,
-- and one who falls below it earns the lower rate on that whole month,
-- and neither touches any month already written.
--
-- on conflict do nothing, not an upsert. Re-running March must leave
-- March exactly as it was, including a rate that has since changed.
-- ---------------------------------------------------------------------
create or replace function public.partner_accrue_month(p_month date, p_partner uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_rate  numeric;
  v_rows  int := 0;
  rec     record;
begin
  for rec in
    select r.id, r.partner_id, r.mrr
    from public.partner_referrals r
    where (p_partner is null or r.partner_id = p_partner)
      and r.subscribed_on is not null
      and r.subscribed_on <= v_end
      and (r.lapsed_on is null or r.lapsed_on > v_end)
      and r.mrr > 0
  loop
    v_rate := public.partner_referral_rate(rec.id, v_end);
    if v_rate is null or v_rate = 0 then
      continue;
    end if;

    insert into public.partner_ledger
      (partner_id, referral_id, kind, amount, rate_pct, tier, basis, note,
       credited_on, clears_on, status, period)
    values
      (rec.partner_id, rec.id, 'recurring',
       round(rec.mrr * v_rate / 100, 2), v_rate,
       (select label from public.partner_rate_bands
         where min_active <= public.partner_active_paying(rec.partner_id, v_end)
         order by min_active desc limit 1),
       rec.mrr,
       'Recurring commission for ' || to_char(v_start, 'Mon YYYY'),
       v_end, (v_end + interval '31 days')::date, 'pending', v_start)
    on conflict (referral_id, period) where kind = 'recurring' do nothing;

    if found then
      v_rows := v_rows + 1;
    end if;
  end loop;

  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Nobody but us runs any of this.
--
-- Supabase grants execute on new functions in public to anon and
-- authenticated by default, and revoking from public does NOT undo that.
-- Each one has to be named. The harness tests the grant rather than the
-- call, because a function that errors for its own reasons looks exactly
-- like a function that was refused.
-- ---------------------------------------------------------------------
revoke execute on function public.partner_accrue_month(date, uuid)   from public, anon, authenticated;
revoke execute on function public.partner_referral_rate(uuid, date)   from public, anon, authenticated;
revoke execute on function public.partner_active_paying(uuid, date)   from public, anon, authenticated;
grant  execute on function public.partner_accrue_month(date, uuid)    to service_role;
grant  execute on function public.partner_referral_rate(uuid, date)   to service_role;
grant  execute on function public.partner_active_paying(uuid, date)   to service_role;

-- The ladder lookup is the one safe thing to read: it is the same numbers
-- the partners page prints, and the portal needs it to show the ladder. It
-- still has to be revoked from anon FIRST. Granting to authenticated does not
-- take anon away, because anon never had to be granted it: Supabase hands
-- execute on every new function in public to anon and authenticated by
-- default. storage_rls_harness caught this one within a minute of the
-- migration existing, which is the second time that sweep has earned its
-- keep on exactly this mistake.
revoke execute on function public.partner_tier_rate(integer) from public, anon;
grant  execute on function public.partner_tier_rate(integer) to authenticated, service_role;
