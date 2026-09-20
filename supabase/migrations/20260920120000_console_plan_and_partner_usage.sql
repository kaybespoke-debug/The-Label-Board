-- =====================================================================
-- What the operator console needs in order to be the source of truth.
--
-- Kayode, 20 September 2026:
--   "The admin portal must show each account's plan and usage against
--    these limits."
--   "The admin portal must let you see all partners, their referrals,
--    commission owed, and payout status — and must be the source of
--    truth the partner portal reads from."
--
-- Two reads. Neither writes anything and neither is reachable from a
-- browser: both are service_role only, and the console goes through the
-- admin-api gateway like everything else.
--
-- ON COPYING RATHER THAN RETYPING
--
-- platform_tenant_summary gains three columns, which means dropping and
-- recreating it because its return type changes. The body below is the
-- one from 20260918100000 with three selects added and NOTHING else
-- touched. A previous session retyped a shipped function from memory and
-- silently changed three things nobody had asked about, which is why the
-- rule here is to copy the body and diff it rather than write it again.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The tenant list, with the ceiling next to the usage.
--
-- seats_used is counted as active OR invited, which is the same
-- definition the limit trigger enforces. `members` above it counts only
-- active, and it stays that way because it answers a different question
-- ("how many people are actually in there"). Showing a studio refused a
-- sixth login while the console said it had five would be the console
-- and the database disagreeing about what a seat is.
-- ---------------------------------------------------------------------
drop function if exists public.platform_tenant_summary();

create or replace function public.platform_tenant_summary()
returns table (
  id             uuid,
  name           text,
  slug           text,
  plan           text,
  status         text,
  created_at     timestamptz,
  members        bigint,
  branches       bigint,
  orders         bigint,
  orders_30d     bigint,
  cohort         text,
  last_active_at timestamptz,
  seats_used     bigint,
  max_studios    int,
  max_seats      int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    l.max_seats
  from public.businesses b
  cross join lateral app.limits_for(b.id) l
  order by b.created_at desc;
$$;

revoke all    on function public.platform_tenant_summary() from public, anon, authenticated;
grant  execute on function public.platform_tenant_summary() to service_role;

-- ---------------------------------------------------------------------
-- 2. Every partner, what they have brought, and what we owe them.
--
-- One row per partner, from the ledger rather than from the rules, for
-- the same reason the portal's summary is: the ledger is what was
-- decided at the time and the rules are what we would decide today.
--
-- owed is cleared-and-unpaid, which is the figure that would actually
-- leave our account if a payout ran now. pending is credited but still
-- inside the 31 day hold. They are separate because paying out the
-- second one is how a programme ends up refunding money it has already
-- given away.
-- ---------------------------------------------------------------------
create or replace function public.platform_partner_summary()
returns table (
  id               uuid,
  code             text,
  name             text,
  business_name    text,
  email            text,
  phone            text,
  city             text,
  status           text,
  joined_on        date,
  -- Carried so the console can answer "did that invitation ever go out"
  -- from this one read. An invited partner who has not claimed their
  -- account has no user_id and is on pending_email instead, and a list
  -- that leaves them out cannot answer the first question anybody asks.
  user_id          uuid,
  pending_email    text,
  referrals        bigint,
  referrals_paying bigint,
  referrals_lapsed bigint,
  rate_pct         numeric,
  earned_total     numeric,
  pending_amount   numeric,
  owed_amount      numeric,
  paid_amount      numeric,
  last_payout_on   date,
  last_payout_ref  text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id, p.code, p.name, p.business_name,
    coalesce(p.email, p.pending_email),
    p.phone, p.city,
    p.status, p.joined_on,
    p.user_id, p.pending_email,
    (select count(*) from public.partner_referrals r where r.partner_id = p.id),
    (select count(*) from public.partner_referrals r
      where r.partner_id = p.id and r.subscribed_on is not null and r.lapsed_on is null),
    (select count(*) from public.partner_referrals r
      where r.partner_id = p.id and r.lapsed_on is not null),
    (select rate_pct from public.partner_rate_bands where min_active = 0),
    coalesce((select sum(l.amount) from public.partner_ledger l where l.partner_id = p.id), 0),
    coalesce((select sum(l.amount) from public.partner_ledger l
               where l.partner_id = p.id and l.status = 'pending'), 0),
    coalesce((select sum(l.amount) from public.partner_ledger l
               where l.partner_id = p.id and l.status = 'cleared' and l.payout_id is null), 0),
    coalesce((select sum(l.amount) from public.partner_ledger l
               where l.partner_id = p.id and l.status = 'paid'), 0),
    (select max(po.paid_on) from public.partner_payouts po where po.partner_id = p.id),
    (select po.ref from public.partner_payouts po
      where po.partner_id = p.id order by po.paid_on desc limit 1)
  from public.partners p
  order by p.joined_on desc nulls last, p.name;
$$;

revoke all    on function public.platform_partner_summary() from public, anon, authenticated;
grant  execute on function public.platform_partner_summary() to service_role;

-- ---------------------------------------------------------------------
-- 3. One partner's businesses, for the console to open.
--
-- Deliberately the SAME function the portal reads. If the console had
-- its own sum here, the two would drift the first time either was
-- changed, and the partner would be the one who noticed. The portal's
-- my_commission_summary is this with the partner filled in from the
-- session; the console passes the partner in because an operator is
-- looking at somebody else's.
-- ---------------------------------------------------------------------
comment on function public.partner_commission_summary(uuid) is
  'The per-business working for one partner. Read by the console directly and by the portal through my_commission_summary(), so the two cannot disagree.';
