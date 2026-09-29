-- =====================================================================
-- A studio that stops paying stops earning its partner a commission
-- =====================================================================
-- Found by the cross-app audit before this release was promoted, and it is
-- the kind that costs real money quietly.
--
-- Accrual asks one question: is `partner_referrals.lapsed_on` null. It does
-- not look at payments and it does not look at the studio. Until this week
-- that was nearly safe, because the only way to stop was a trial running out
-- and a trial has no `subscribed_on`, so it never accrued anything.
--
-- Batches F and G gave a studio two new ways to stop — an owner closing it,
-- and a term running out unpaid — and neither of them touched
-- `partner_referrals`. So a studio could close in October and its referrer
-- would have gone on earning eight per cent of a subscription nobody was
-- paying, every month, for the rest of the twelve.
--
-- The machinery to stop it already existed and nothing was calling it:
-- setting `lapsed_on` fires `partner_referrals_void_on_churn`, which voids
-- the pending ledger rows. This is the missing call, on the one event that
-- actually means "they stopped": `businesses.status` leaving 'active'.
--
-- AND IT GOES BOTH WAYS. A studio suspended in error, or one that pays and
-- comes back, has its referral un-lapsed — otherwise a support fix would
-- permanently cost the partner their twelve months, and nobody would notice
-- that either. Cleared rather than re-dated, so the original clock is what
-- resumes.
create or replace function app.referral_follows_studio()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status <> 'active' then
    /* ONLY A REFERRAL THAT EVER PAID CAN LAPSE, and the date has to be after
       the day it started. partner_referrals_lapsed_after_paid says exactly
       that and is right: a business that never subscribed has nothing to stop
       paying. Without the first condition, expire_finished_trials would have
       thrown for every trial studio with a referrer — caught by trial_harness
       on the first run, which is a suspension path this trigger reaches and
       closing is not. Without the second, a studio that subscribed and closed
       on the same day would too. */
    update public.partner_referrals r
       set lapsed_on = greatest(current_date, r.subscribed_on + 1),
           stage = case when r.stage in ('subscribed','trial') then 'lapsed' else r.stage end
     where r.business_id = new.id
       and r.lapsed_on is null
       and r.subscribed_on is not null;
  else
    /* Back to active, so the referral is too.
       THE FIRST VERSION OF THIS ONLY RESTORED ROWS LAPSED SINCE
       new.closed_at, which never matched: reopen_studio clears closed_at in
       the same statement, so by the time this AFTER trigger runs the date it
       was comparing against is already null. It silently restored nothing,
       and the suite caught it.
       ACCEPTED, AND WORTH NAMING: this cannot tell a referral this trigger
       lapsed from one an operator lapsed by hand, so bringing a studio back
       to active un-lapses both. That direction is the safe one. The other way
       round, a support fix would quietly cost a partner the rest of their
       twelve months and nobody would ever see it. */
    update public.partner_referrals r
       set lapsed_on = null,
           stage = case when r.stage = 'lapsed' then 'subscribed' else r.stage end
     where r.business_id = new.id
       and r.lapsed_on is not null
       and r.subscribed_on is not null;
  end if;

  return new;
end $fn$;

drop trigger if exists businesses_referral_follows on public.businesses;
create trigger businesses_referral_follows after update of status on public.businesses
  for each row execute function app.referral_follows_studio();

revoke all on function app.referral_follows_studio() from public, anon, authenticated;

comment on function app.referral_follows_studio() is
  'A studio leaving active lapses its referral, which voids the pending '
  'commission; coming back clears it again. Accrual reads lapsed_on and '
  'nothing else, so without this a closed studio kept earning its referrer '
  '8% a month of a subscription nobody was paying.';

-- ---------------------------------------------------------------------
-- And the console has to be able to see the difference
-- ---------------------------------------------------------------------
-- platform_tenant_summary returns `status`, and the console maps 'closed' to
-- "expired" and everything else to "active". A studio suspended for
-- non-payment therefore read as a healthy active subscriber with its list
-- price counted as MRR. Two columns are added so an operator can tell a
-- studio the owner closed on the 12th, purging on the 11th of next month,
-- from one that simply lapsed.
--
-- COPIED, NOT REWRITTEN. The body below is the one from
-- 20260920120000_console_plan_and_partner_usage.sql with two selects added
-- and nothing else touched. Dropping and recreating is forced by the return
-- type changing.
--
-- The body below is pg_get_functiondef output from the live project, with two
-- selects added at the end and nothing else touched. The version this file
-- first carried was retyped from memory and was wrong in four places at once:
-- it read last_active_at from businesses.last_seen_at instead of the newest
-- app_state row, took the limits from plan_limits instead of app.limits_for,
-- invented a max_studios_override column, and added an is_platform_admin
-- filter the original does not have. That is the rule working.
drop function if exists public.platform_tenant_summary();

create or replace function public.platform_tenant_summary()
returns table (
  id uuid, name text, slug text, plan text, status text,
  created_at timestamptz, members bigint, branches bigint, orders bigint,
  orders_30d bigint, cohort text, last_active_at timestamptz,
  seats_used bigint, max_studios integer, max_seats integer,
  closed_at timestamptz, purge_after timestamptz)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select
    b.id, b.name, b.slug, b.plan, b.status, b.created_at,
    (select count(*) from public.memberships m where m.business_id = b.id and m.status = 'active'),
    (select count(*) from public.branches  br where br.business_id = b.id),
    (select count(*) from public.orders    o  where o.business_id  = b.id),
    (select count(*) from public.orders    o  where o.business_id  = b.id
                                              and o.created_at > now() - interval '30 days'),
    b.cohort,
    (select max(s.updated_at) from public.app_state s where s.business_id = b.id),
    (select count(*) from public.memberships m
      where m.business_id = b.id and m.status in ('active', 'invited')),
    l.max_studios,
    l.max_seats,
    b.closed_at,
    b.purge_after
  from public.businesses b
  cross join lateral app.limits_for(b.id) l
  order by b.created_at desc;
$fn$;

revoke all on function public.platform_tenant_summary() from public, anon, authenticated;
grant execute on function public.platform_tenant_summary() to service_role;
