-- =====================================================================
-- One referral programme, and the fraud controls that make it payable.
--
-- Kayode's specification, 20 September 2026:
--
--   "Unify the programme: every customer can be a partner. One referral
--    programme, everyone gets a referral code/link, everyone earns the
--    same flat 8%. No separate customer-vs-partner tracks."
--
--   "Build referral attribution via unique referral codes: a new business
--    signing up with a code is permanently tied to that referrer, and
--    commission is calculated automatically on their payments."
--
--   "Anti-fraud must be built in, not bolted on."
--
-- WHY THIS IS ONE MIGRATION AND NOT FOUR
--
-- The unification and the anti-fraud are the same change. The moment
-- every customer has a referral code, the cheapest fraud in the world
-- becomes available: sign up, take your own code, sign up again, and
-- collect 8% of your own subscription for a year. A programme that opens
-- to everybody without a self-referral block is not a generous programme,
-- it is a discount with extra steps and a worse audit trail.
--
-- THE FIVE CONTROLS, AND WHAT EACH ONE IS ACTUALLY FOR
--
--   1. No self-referral. Checked on four axes, because "the same person"
--      has four meanings: the same account, the same business, the same
--      email address, and the same card. Three of them are cheap to fake
--      and one is not, which is why the fourth exists.
--
--   2. A payment method belongs to one business. This is the control that
--      does the real work. A fraudster can make twenty email addresses in
--      a minute; they cannot make twenty cards. Enforced as a trigger
--      rather than a unique index so an operator can allow a genuine
--      shared card, which happens: one owner paying for two studios.
--
--   3. Commission only on money that arrived and stayed. Already true of
--      the accrual; what is new is that churn or a refund inside the 31
--      day hold VOIDS the pending rows rather than letting them clear.
--
--   4. The attribution is permanent and one-way. Set once, never moved,
--      and never set to a referrer the business is a self-referral of.
--
--   5. A payout can be frozen per referrer, by an operator, with a reason
--      that goes on the record.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- Card numbers. `payment_methods.fingerprint` is whatever the payment
-- processor gives back that identifies an instrument without being one:
-- a token, or a hash. Nothing in this schema can hold a PAN, and the
-- column is text rather than a number so nobody is tempted.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A referrer can be a customer.
--
-- partners was built for people who are NOT customers: fabric houses,
-- associations, consultants. business_id is how a customer joins the
-- same table without a second one. It is nullable because the original
-- kind of partner still exists and still has no studio.
--
-- kind records how somebody arrived, and decides NOTHING about what they
-- earn. That is the whole point of the unification, and it is worth a
-- constraint rather than a comment: see the check below.
-- ---------------------------------------------------------------------
alter table public.partners
  add column if not exists business_id uuid references public.businesses(id) on delete set null,
  add column if not exists kind text not null default 'partner',
  add column if not exists payout_frozen boolean not null default false,
  add column if not exists frozen_reason text,
  add column if not exists frozen_at timestamptz;

alter table public.partners
  drop constraint if exists partners_kind_check;
alter table public.partners
  add constraint partners_kind_check check (kind in ('customer', 'partner'));

-- A customer-referrer must be a customer, and an outside partner must not
-- claim to be one. Without this, `kind` drifts into being decorative.
alter table public.partners
  drop constraint if exists partners_kind_matches_business;
alter table public.partners
  add constraint partners_kind_matches_business
  check ((kind = 'customer' and business_id is not null)
      or (kind = 'partner'  and business_id is null));

-- One referrer per business. A studio has one referral code, not one per
-- person who signs into it.
create unique index if not exists partners_one_per_business
  on public.partners (business_id) where business_id is not null;

alter table public.partners
  drop constraint if exists partners_frozen_has_reason;
alter table public.partners
  add constraint partners_frozen_has_reason
  check (not payout_frozen or frozen_reason is not null);

comment on column public.partners.kind is
  'How this referrer arrived: customer (a studio) or partner (a fabric house, association, consultant). It decides nothing about the rate. Everybody earns the same.';

-- ---------------------------------------------------------------------
-- 2. A code that is unique, readable, and derived rather than invented.
-- ---------------------------------------------------------------------
create or replace function app.referral_code_for(p_name text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_code text;
  v_n    int := 0;
begin
  v_base := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]+', '-', 'g'));
  v_base := btrim(v_base, '-');
  v_base := left(v_base, 20);
  -- The pattern the claim function accepts needs a leading alphanumeric
  -- and at least two characters, so a studio called "&" still gets a code.
  if v_base !~ '^[A-Z0-9]' or length(v_base) < 2 then
    v_base := 'TLB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  end if;

  v_code := v_base;
  while exists (select 1 from public.partners where code = v_code) loop
    v_n := v_n + 1;
    v_code := left(v_base, 20) || '-' || v_n::text;
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. A business remembers who sent it, once and for ever.
-- ---------------------------------------------------------------------
alter table public.businesses
  add column if not exists referred_by uuid references public.partners(id) on delete set null,
  add column if not exists referred_on date,
  -- The operator's escape hatch for a genuine shared card. Off by default,
  -- because the default has to be the safe one.
  add column if not exists payment_sharing_allowed boolean not null default false;

alter table public.businesses
  drop constraint if exists businesses_referral_has_date;
alter table public.businesses
  add constraint businesses_referral_has_date
  check ((referred_by is null) = (referred_on is null));

-- Permanent. A referrer who can be changed afterwards is a referrer who
-- will be changed afterwards, by whoever is closest to the money at the
-- time. Clearing it is allowed, because voiding a referral that turned out
-- to be a self-referral has to be possible; pointing it at somebody ELSE
-- is not.
create or replace function app.pin_referral()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.referred_by is not null
     and new.referred_by is not null
     and new.referred_by <> old.referred_by then
    raise exception 'a business keeps the referrer it signed up with; it cannot be moved to another'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_referral_is_permanent on public.businesses;
create trigger businesses_referral_is_permanent
  before update of referred_by on public.businesses
  for each row execute function app.pin_referral();

-- ---------------------------------------------------------------------
-- 4. Payment methods: one instrument, one business.
--
-- No card number can be stored here. fingerprint is whatever the
-- processor returns that identifies an instrument without being one.
-- ---------------------------------------------------------------------
create table if not exists public.payment_methods (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  fingerprint  text not null check (length(btrim(fingerprint)) >= 8),
  label        text,
  -- "Distinct REAL payment method". An unverified instrument is a claim;
  -- a verified one is a payment that actually went through. Only the
  -- second kind unlocks commission.
  verified     boolean not null default false,
  added_at     timestamptz not null default now(),
  unique (business_id, fingerprint)
);

create index if not exists payment_methods_fingerprint_idx
  on public.payment_methods (fingerprint);

alter table public.payment_methods enable row level security;
alter table public.payment_methods force  row level security;

-- Nobody reads this from a browser. Not the studio whose card it is
-- either: there is nothing here they cannot see on their own statement,
-- and a table of fingerprints is a table worth nobody being able to
-- enumerate. No policy exists, so with RLS forced nothing reaches it
-- except the service role.
revoke all on public.payment_methods from anon, authenticated;

-- The control that does the real work.
create or replace function app.enforce_one_business_per_method()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_other uuid;
  v_mine_ok boolean;
  v_other_ok boolean;
begin
  select pm.business_id into v_other
  from public.payment_methods pm
  where pm.fingerprint = new.fingerprint
    and pm.business_id <> new.business_id
  limit 1;

  if v_other is null then
    return new;
  end if;

  select payment_sharing_allowed into v_mine_ok  from public.businesses where id = new.business_id;
  select payment_sharing_allowed into v_other_ok from public.businesses where id = v_other;

  -- BOTH sides have to be allowed. One business being exempt cannot drag
  -- another into sharing a card without anybody having agreed to it.
  if coalesce(v_mine_ok, false) and coalesce(v_other_ok, false) then
    return new;
  end if;

  raise exception
    'that payment method is already on another business; each business needs its own'
    using errcode = 'check_violation',
          hint = 'If one owner genuinely pays for both, allow payment sharing on both businesses first.';
end;
$$;

drop trigger if exists payment_methods_one_business on public.payment_methods;
create trigger payment_methods_one_business
  before insert or update of fingerprint, business_id on public.payment_methods
  for each row execute function app.enforce_one_business_per_method();

revoke execute on function app.enforce_one_business_per_method() from public, anon, authenticated;
revoke execute on function app.pin_referral()                    from public, anon, authenticated;
revoke execute on function app.referral_code_for(text)           from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Is this referral somebody referring themselves?
--
-- Four axes, because "the same person" has four meanings and they cost
-- different amounts to fake:
--
--   same business   free to attempt, trivially caught
--   same account    free to attempt, trivially caught
--   same email      one minute of work to get around
--   same card       the one that actually costs something
--
-- Returns the REASON rather than a boolean, so the refusal can say which
-- rule was hit and the attempt log can record it. Returns null when the
-- referral is clean.
-- ---------------------------------------------------------------------
create or replace function app.self_referral_reason(p_partner uuid, p_business uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  p public.partners%rowtype;
  b public.businesses%rowtype;
begin
  select * into p from public.partners  where id = p_partner;
  select * into b from public.businesses where id = p_business;
  if not found or p.id is null then
    return 'that referral code does not belong to anybody';
  end if;

  if p.business_id is not null and p.business_id = p_business then
    return 'a business cannot refer itself';
  end if;

  if p.user_id is not null and exists (
       select 1 from public.memberships m
       where m.business_id = p_business and m.user_id = p.user_id) then
    return 'the person who owns that code already works in this business';
  end if;

  if coalesce(p.email, p.pending_email) is not null
     and b.contact_email is not null
     and lower(coalesce(p.email, p.pending_email)) = lower(b.contact_email) then
    return 'that code belongs to this email address';
  end if;

  -- The card. Only meaningful when the referrer is themselves a customer,
  -- because that is the only case where they have a business with cards on
  -- it to share.
  if p.business_id is not null and exists (
       select 1
       from public.payment_methods a
       join public.payment_methods c on c.fingerprint = a.fingerprint
       where a.business_id = p.business_id
         and c.business_id = p_business) then
    return 'this business pays with the same method as the business that referred it';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Every attempt, accepted or refused, is written down.
--
-- A refusal that leaves no trace is a refusal nobody can count. The
-- console's risk view is built on this, and so is any future answer to
-- "how much fraud did we actually stop".
-- ---------------------------------------------------------------------
create table if not exists public.referral_attempts (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  partner_id  uuid references public.partners(id) on delete set null,
  business_id uuid references public.businesses(id) on delete cascade,
  outcome     text not null check (outcome in ('attached', 'refused', 'unknown-code')),
  reason      text,
  at          timestamptz not null default now()
);

create index if not exists referral_attempts_partner_idx on public.referral_attempts (partner_id, at desc);
create index if not exists referral_attempts_business_idx on public.referral_attempts (business_id);

alter table public.referral_attempts enable row level security;
alter table public.referral_attempts force  row level security;
revoke all on public.referral_attempts from anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Attach a referral, or refuse it and say why.
--
-- The one way a business gets a referrer. It is idempotent on success and
-- it never moves an existing tie, which the trigger in section 3 would
-- refuse anyway; doing it here as well means the caller gets a sentence
-- instead of a constraint violation.
-- ---------------------------------------------------------------------
create or replace function app.attach_referral(p_business uuid, p_code text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_partner uuid;
  v_reason  text;
  v_already uuid;
begin
  if p_code is null or btrim(p_code) = '' then
    return null;
  end if;

  select referred_by into v_already from public.businesses where id = p_business;
  if v_already is not null then
    insert into public.referral_attempts (code, partner_id, business_id, outcome, reason)
    values (upper(p_code), v_already, p_business, 'refused', 'already referred by somebody');
    return 'this business already has a referrer';
  end if;

  select p.id into v_partner
  from public.partners p
  where p.code = upper(btrim(p_code)) and p.status = 'active';

  if v_partner is null then
    insert into public.referral_attempts (code, partner_id, business_id, outcome, reason)
    values (upper(btrim(p_code)), null, p_business, 'unknown-code', 'no active referrer has that code');
    return 'that referral code is not one of ours';
  end if;

  v_reason := app.self_referral_reason(v_partner, p_business);
  if v_reason is not null then
    insert into public.referral_attempts (code, partner_id, business_id, outcome, reason)
    values (upper(btrim(p_code)), v_partner, p_business, 'refused', v_reason);
    return v_reason;
  end if;

  update public.businesses
     set referred_by = v_partner, referred_on = current_date
   where id = p_business;

  -- The referral row the ledger is built from. business_name is copied by
  -- value because a studio renaming itself must not rewrite a partner's
  -- historic statement.
  insert into public.partner_referrals
    (partner_id, business_id, business_name, stage, signed_up_on)
  select v_partner, b.id, b.name, 'signed-up', current_date
  from public.businesses b
  where b.id = p_business
    and not exists (select 1 from public.partner_referrals r where r.business_id = b.id);

  insert into public.referral_attempts (code, partner_id, business_id, outcome, reason)
  values (upper(btrim(p_code)), v_partner, p_business, 'attached', null);

  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. A card arriving late can still expose a self-referral.
--
-- The email and account checks happen at signup. The card usually does
-- not exist yet at that point, so the fourth axis has to be checked again
-- when a payment method is added. The referral is voided rather than the
-- payment refused: they are still a customer and should still be able to
-- pay us. What they stop being is a commission.
-- ---------------------------------------------------------------------
create or replace function app.recheck_referral_on_payment_method()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_partner uuid;
  v_reason  text;
begin
  select referred_by into v_partner from public.businesses where id = new.business_id;
  if v_partner is null then
    return new;
  end if;

  v_reason := app.self_referral_reason(v_partner, new.business_id);
  if v_reason is null then
    return new;
  end if;

  update public.businesses
     set referred_by = null, referred_on = null
   where id = new.business_id;

  /* A late self-referral is NOT a churn, and saying it is breaks a
     constraint that is right: partner_referrals_lapsed_after_paid refuses a
     lapse date on a referral that never subscribed, because a business that
     never paid cannot have stopped paying. This was caught by the harness
     rather than by review, and it would have shipped as a payment method
     insert that silently failed.

     So: a referral that never converted is DELETED, because it should never
     have existed and referral_attempts below is its audit trail. One that
     did convert is lapsed from the day after its first payment at the
     earliest, so the date constraint holds however old the referral is. */
  delete from public.partner_referrals
   where business_id = new.business_id and subscribed_on is null;

  update public.partner_referrals
     set stage = 'lapsed',
         lapsed_on = greatest(current_date, subscribed_on + 1)
   where business_id = new.business_id and lapsed_on is null;

  update public.partner_ledger l
     set status = 'void',
         note = coalesce(l.note, '') || ' [voided: ' || v_reason || ']'
   where l.status = 'pending'
     and l.referral_id in (select id from public.partner_referrals where business_id = new.business_id);

  insert into public.referral_attempts (code, partner_id, business_id, outcome, reason)
  values ('(payment method)', v_partner, new.business_id, 'refused', v_reason);

  return new;
end;
$$;

drop trigger if exists payment_methods_recheck_referral on public.payment_methods;
create trigger payment_methods_recheck_referral
  after insert on public.payment_methods
  for each row execute function app.recheck_referral_on_payment_method();

revoke execute on function app.recheck_referral_on_payment_method() from public, anon, authenticated;
revoke execute on function app.self_referral_reason(uuid, uuid)     from public, anon, authenticated;
revoke execute on function app.attach_referral(uuid, text)          from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. Churn or a refund inside the hold pays nothing.
--
-- "Commission only ever on real, paid subscriptions, held through the
--  existing 31-day clearing window; if a business refunds or churns in
--  that window, no commission pays."
--
-- So the rule is not "stop accruing", which was already true. It is that
-- anything still PENDING when they leave never clears. A row that has
-- already cleared is money we decided was safe, and it stays theirs.
-- ---------------------------------------------------------------------
create or replace function app.void_pending_on_churn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.lapsed_on is null or old.lapsed_on is not null then
    return new;
  end if;

  update public.partner_ledger
     set status = 'void',
         note = coalesce(note, '') || ' [voided: stopped paying inside the hold]'
   where referral_id = new.id
     and status = 'pending';

  return new;
end;
$$;

drop trigger if exists partner_referrals_void_on_churn on public.partner_referrals;
create trigger partner_referrals_void_on_churn
  after update of lapsed_on, stage on public.partner_referrals
  for each row execute function app.void_pending_on_churn();

revoke execute on function app.void_pending_on_churn() from public, anon, authenticated;

-- A refund does the same thing without the business leaving.
create or replace function public.partner_void_on_refund(p_business uuid, p_reason text default 'payment refunded')
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_rows int;
begin
  update public.partner_ledger l
     set status = 'void',
         note = coalesce(l.note, '') || ' [voided: ' || coalesce(p_reason, 'refund') || ']'
   where l.status = 'pending'
     and l.referral_id in (select id from public.partner_referrals where business_id = p_business);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function public.partner_void_on_refund(uuid, text) from public, anon, authenticated;
grant  execute on function public.partner_void_on_refund(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 10. A frozen payout does not run.
--
-- The body below is 20260919160000's partner_payout_run COPIED, with one
-- check added at the top and nothing else touched. Retyping a shipped
-- function from memory silently changed three things on this project
-- once already, which is why the rule here is to copy and diff.
-- ---------------------------------------------------------------------
create or replace function public.partner_payout_run(p_partner uuid, p_on date default current_date)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_total   numeric;
  v_payout  uuid;
  v_ref     text;
  v_acct    public.partner_accounts%rowtype;
  v_frozen  boolean;
  v_why     text;
begin
  -- ADDED 20 Sep 2026: an operator can stop one referrer being paid while
  -- a pattern is looked at. It raises rather than returning null, because
  -- null already means "nothing was owed" and those are different answers.
  select payout_frozen, frozen_reason into v_frozen, v_why
  from public.partners where id = p_partner;
  if coalesce(v_frozen, false) then
    raise exception 'payouts to partner % are frozen: %', p_partner, coalesce(v_why, 'no reason recorded')
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount), 0) into v_total
  from public.partner_ledger
  where partner_id = p_partner and status = 'cleared' and payout_id is null;

  if v_total <= 0 then
    return null;
  end if;

  select * into v_acct
  from public.partner_accounts
  where partner_id = p_partner and is_primary
  limit 1;

  if v_acct.id is null then
    raise exception 'partner % has no primary account, nothing was paid', p_partner;
  end if;
  if not v_acct.verified then
    raise exception 'partner % has an unverified account, nothing was paid', p_partner;
  end if;

  v_ref := 'PO-' || to_char(p_on, 'YYYY') || '-' ||
           upper(substr(replace(p_partner::text, '-', ''), 1, 6));

  insert into public.partner_payouts
    (partner_id, ref, paid_on, amount, method,
     account_name, bank_name, account_number)
  values
    (p_partner, v_ref, p_on, v_total, 'bank transfer',
     v_acct.account_name, v_acct.bank_name, v_acct.account_number)
  returning id into v_payout;

  update public.partner_ledger
     set status = 'paid', payout_id = v_payout
   where partner_id = p_partner and status = 'cleared' and payout_id is null;

  return v_payout;
end;
$$;

revoke execute on function public.partner_payout_run(uuid, date) from public, anon, authenticated;
grant  execute on function public.partner_payout_run(uuid, date) to service_role;

create or replace function public.set_partner_payout_frozen(
  p_partner uuid, p_frozen boolean, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_frozen and coalesce(btrim(p_reason), '') = '' then
    raise exception 'freezing a payout needs a reason, because somebody will ask';
  end if;
  update public.partners
     set payout_frozen = p_frozen,
         frozen_reason = case when p_frozen then p_reason else null end,
         frozen_at     = case when p_frozen then now() else null end
   where id = p_partner;
  if not found then
    raise exception 'no such partner: %', p_partner;
  end if;
end;
$$;

revoke execute on function public.set_partner_payout_frozen(uuid, boolean, text) from public, anon, authenticated;
grant  execute on function public.set_partner_payout_frozen(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------
-- 11. What the console has to be able to see.
--
-- "flag suspicious patterns (same card, similar emails, rapid signups)"
--
-- Every row is a PATTERN, not an accusation. Three of the four kinds have
-- innocent explanations, and the console says so. The one that does not
-- is a refused attempt, which by definition already failed.
-- ---------------------------------------------------------------------
create or replace function public.platform_referral_risk()
returns table (
  partner_id    uuid,
  partner_name  text,
  partner_code  text,
  business_id   uuid,
  business_name text,
  kind          text,
  detail        text,
  at            timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- a card on two businesses, where one of them referred the other
  select p.id, p.name, p.code, b.id, b.name,
         'shared-payment',
         'This business and its referrer pay with the same method',
         b.created_at
  from public.businesses b
  join public.partners p on p.id = b.referred_by
  where p.business_id is not null
    and exists (
      select 1 from public.payment_methods a
      join public.payment_methods c on c.fingerprint = a.fingerprint
      where a.business_id = p.business_id and c.business_id = b.id)

  union all

  -- addresses that differ only by punctuation or a trailing number, which
  -- is what ada@x.com, ada1@x.com and a.da@x.com look like to a person
  select p.id, p.name, p.code, b.id, b.name,
         'similar-email',
         'Contact address looks like the referrer''s: ' || coalesce(b.contact_email, ''),
         b.created_at
  from public.businesses b
  join public.partners p on p.id = b.referred_by
  where b.contact_email is not null
    and coalesce(p.email, p.pending_email) is not null
    and regexp_replace(lower(split_part(b.contact_email, '@', 1)), '[^a-z]', '', 'g')
      = regexp_replace(lower(split_part(coalesce(p.email, p.pending_email), '@', 1)), '[^a-z]', '', 'g')
    and lower(b.contact_email) <> lower(coalesce(p.email, p.pending_email))

  union all

  -- more than three referrals in a day from one referrer. Legitimate for
  -- an association signing its members up at an event, which is exactly
  -- why it is a flag and not a block.
  select p.id, p.name, p.code, null::uuid, null::text,
         'rapid-signups',
         count(*)::text || ' businesses referred on ' || r.signed_up_on::text,
         max(r.created_at)
  from public.partner_referrals r
  join public.partners p on p.id = r.partner_id
  group by p.id, p.name, p.code, r.signed_up_on
  having count(*) > 3

  union all

  -- and everything that was already refused
  select a.partner_id, p.name, p.code, a.business_id, b.name,
         'refused-attempt', a.reason, a.at
  from public.referral_attempts a
  left join public.partners p on p.id = a.partner_id
  left join public.businesses b on b.id = a.business_id
  where a.outcome <> 'attached'

  order by 8 desc nulls last;
$$;

revoke execute on function public.platform_referral_risk() from public, anon, authenticated;
grant  execute on function public.platform_referral_risk() to service_role;

-- ---------------------------------------------------------------------
-- 12. Every business gets a code, including the ones already here.
--
-- The body below is COPIED from the CURRENT app.provision_studio(), which
-- is 20260905090000's, with two blocks added before the final `return new`
-- and nothing else changed.
--
-- The first draft copied 20260904180000's instead, which is one generation
-- behind: the billing migration had since added `perform
-- app.ensure_billing_record(v_biz)` to it. Copying the wrong generation is
-- the same failure as retyping from memory, and it looks identical in the
-- diff. billing_harness caught it immediately, which is the only reason it
-- is not still there. When replacing a function, grep every migration for
-- its name and copy the LAST one.
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
  v_code    text;
  v_ref     text;
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

  -- A studio with no subscription row is a studio nobody is counting.
  perform app.ensure_billing_record(v_biz);

  -- ADDED 20 Sep 2026: every customer is a referrer. One programme, so
  -- the code exists from the first day rather than being something an
  -- operator has to remember to hand out.
  if not exists (select 1 from public.partners where business_id = v_biz) then
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

-- Every business that already exists gets one too, or the programme is
-- open to everybody who signs up tomorrow and to nobody who is already
-- here. Owner first, because a code belongs to a person.
do $$
declare r record; v_code text;
begin
  for r in
    select b.id, b.name, b.contact_email,
           (select m.user_id from public.memberships m
             where m.business_id = b.id and m.role = 'owner' and m.status = 'active'
             order by m.created_at limit 1) as owner_id
    from public.businesses b
    where not exists (select 1 from public.partners p where p.business_id = b.id)
  loop
    if r.owner_id is null then
      continue;   -- nobody signs into it yet; it gets a code when somebody does
    end if;
    -- and not if that person is already a partner in their own right
    if exists (select 1 from public.partners p where p.user_id = r.owner_id) then
      update public.partners
         set business_id = r.id, kind = 'customer'
       where user_id = r.owner_id and business_id is null;
      continue;
    end if;
    v_code := app.referral_code_for(r.name);
    insert into public.partners
      (user_id, code, name, business_name, email, status, joined_on, kind, business_id)
    values
      (r.owner_id, v_code, coalesce(r.name, 'Studio'), r.name, r.contact_email,
       'active', current_date, 'customer', r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 13. The portal shows a customer-referrer their own code.
-- ---------------------------------------------------------------------
/* The return type gains three columns, so it has to be dropped and
   recreated rather than replaced. Postgres refuses to change the shape of
   an existing function in place, and the error it gives ("cannot change
   return type of existing function") names the function but not the file. */
drop function if exists app.partner_me();

create or replace function app.partner_me()
returns table (
  id uuid, code text, name text, business_name text, email text,
  phone text, city text, tax_id text, tier text, status text, joined_on date,
  kind text, business_id uuid, payout_frozen boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.code, p.name, p.business_name, p.email,
         p.phone, p.city, p.tax_id, p.tier, p.status, p.joined_on,
         p.kind, p.business_id, p.payout_frozen
  from public.partners p
  where p.user_id = auth.uid()
$$;

revoke all    on function app.partner_me() from public, anon;
grant  execute on function app.partner_me() to authenticated, service_role;
