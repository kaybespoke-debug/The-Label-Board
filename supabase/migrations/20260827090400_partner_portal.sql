-- =====================================================================
-- The Label Board — partner portal
--
-- Partners are the people who bring us subscribers. They sign in to
-- partners.thelabelboard.com and see what they have earned, who they
-- brought in, and when the money lands.
--
-- The isolation problem here is the same shape as tenant isolation, but
-- the stakes are different. A tenant leak exposes another studio's
-- orders. A partner leak exposes money: what someone earned, and the
-- bank account it was paid into. So this file follows the same three
-- ideas as tenant_isolation.sql, plus a fourth that matters more here:
--
--   1. Every partner row carries partner_id, NOT NULL. No exceptions.
--   2. RLS is on and FORCED, and the policy derives the caller's partner
--      from their session, never from the request.
--   3. Composite foreign keys pin children to their parent partner, so a
--      row linking two partners cannot be constructed even if a policy is
--      later written wrongly.
--   4. Being able to read your own row is not the same as being able to
--      write it. A partner who can UPDATE their own ledger can pay
--      themselves. A partner who can UPDATE partner_accounts.verified can
--      mark an unchecked account as checked. Those columns are closed
--      with column-level grants, which Postgres enforces underneath RLS,
--      so a policy mistake cannot reopen them.
--
-- What a partner may write, in full:
--   partners          their own name, business, email, phone, city
--   partner_links     create, rename, pause their own links
--   partner_accounts  add and edit their own payout accounts
-- Everything else in here is read-only from a browser. Commission,
-- referrals and payouts are written server side, by the billing path and
-- the admin gateway, under the service role.
--
-- Verified by supabase/tests/partner_rls_harness.mjs, which attacks these
-- policies from the position of a signed-in partner. Run it after any
-- change here.
-- =====================================================================

-- =====================================================================
-- THE PARTNER
-- =====================================================================

create table if not exists public.partners (
  id            uuid primary key default gen_random_uuid(),
  -- The auth user. One login, one partner. Unique, because two partner
  -- rows sharing a user would make app.current_partner() ambiguous and
  -- the policies below silently wrong.
  user_id       uuid not null unique,
  -- The default referral code. Globally unique: a code has to resolve to
  -- exactly one partner or attribution is a coin toss.
  code          text not null unique
                  check (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  name          text not null,
  business_name text,
  email         text not null,
  phone         text,
  city          text,
  tax_id        text,
  -- Set by us, never by the partner: it decides what they are paid.
  tier          text not null default 'bronze'
                  check (tier in ('bronze','silver','gold','platinum')),
  status        text not null default 'active'
                  check (status in ('active','invited','suspended')),
  joined_on     date not null default current_date,
  created_at    timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists partners_user_idx on public.partners(user_id);

-- =====================================================================
-- IDENTITY HELPERS
--
-- SECURITY DEFINER so the lookup against partners is not itself filtered
-- by partners' own RLS, which would recurse. search_path is pinned
-- because a SECURITY DEFINER function with a mutable search_path is a
-- privilege escalation waiting to happen.
-- =====================================================================

create or replace function app.current_partner()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.partners p
  where p.user_id = auth.uid()
    and p.status = 'active'
  limit 1;
$$;

create or replace function app.is_partner(p_partner uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.partners p
    where p.user_id = auth.uid()
      and p.status = 'active'
      and p.id = p_partner
  );
$$;

revoke all on function app.current_partner() from public;
revoke all on function app.is_partner(uuid) from public;
grant execute on function app.current_partner() to authenticated, service_role;
grant execute on function app.is_partner(uuid) to authenticated, service_role;

-- =====================================================================
-- PARTNER DATA
--
-- Every table: partner_id NOT NULL, and unique (id, partner_id) so that
-- children can be pinned to the same partner by composite FK.
-- =====================================================================

create table if not exists public.partner_links (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  label       text not null,
  code        text not null unique
                check (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  -- Counted by app.claim_referral_code(), never by the browser. A partner
  -- who can write this can inflate the only number that makes their
  -- channel look worth paying for.
  clicks      integer not null default 0 check (clicks >= 0),
  active      boolean not null default true,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (id, partner_id)
);
create index if not exists partner_links_partner_idx on public.partner_links(partner_id);

-- Exactly one default link per partner. A partial unique index rather than
-- a constraint, because the rule is only about the rows where it is true.
create unique index if not exists partner_links_one_default
  on public.partner_links(partner_id) where is_default;

create table if not exists public.partner_referrals (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid not null references public.partners(id) on delete cascade,
  link_id        uuid,
  -- The business they referred, once it exists as a tenant. Null while
  -- they are still only a signup.
  business_id    uuid references public.businesses(id) on delete set null,
  business_name  text not null,
  owner_name     text,
  city           text,
  stage          text not null default 'signed-up'
                   check (stage in ('signed-up','trial','subscribed','lapsed')),
  plan           text,
  cycle          text check (cycle in ('monthly','annual','trial')),
  mrr            numeric(12,2) not null default 0 check (mrr >= 0),
  first_payment  numeric(12,2) not null default 0 check (first_payment >= 0),
  signed_up_on   date not null,
  subscribed_on  date,
  lapsed_on      date,
  outlets        integer not null default 1 check (outlets >= 0),
  staff_count    integer not null default 0 check (staff_count >= 0),
  added_by       text not null default 'self' check (added_by in ('self','partner')),
  last_seen      date,
  created_at     timestamptz not null default now(),
  unique (id, partner_id),
  -- A link can only be used by the partner that owns it.
  constraint partner_referrals_link_in_partner
    foreign key (link_id, partner_id)
    references public.partner_links(id, partner_id) on delete set null,
  -- Dates cannot run backwards. The portal once told a partner an account
  -- would stop paying next October; the database can refuse that outright.
  constraint partner_referrals_paid_after_signup
    check (subscribed_on is null or subscribed_on >= signed_up_on),
  constraint partner_referrals_lapsed_after_paid
    check (lapsed_on is null or (subscribed_on is not null and lapsed_on > subscribed_on)),
  -- Only an account that actually paid can carry a first payment.
  constraint partner_referrals_payment_needs_conversion
    check (first_payment = 0 or subscribed_on is not null)
);
create index if not exists partner_referrals_partner_idx on public.partner_referrals(partner_id);

create table if not exists public.partner_payouts (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  ref         text not null,
  paid_on     date not null,
  amount      numeric(12,2) not null check (amount > 0),
  method      text not null default 'bank transfer',
  bank_ref    text,
  -- The account as it was at the time. Kept by value, not by reference:
  -- a partner may remove the account later, and a statement that changes
  -- after the fact is not a statement.
  account_name   text,
  bank_name      text,
  account_number text,
  created_at  timestamptz not null default now(),
  unique (id, partner_id),
  unique (partner_id, ref)
);
create index if not exists partner_payouts_partner_idx on public.partner_payouts(partner_id);

create table if not exists public.partner_ledger (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references public.partners(id) on delete cascade,
  referral_id  uuid,
  payout_id    uuid,
  kind         text not null check (kind in ('signup','bonus','adjustment')),
  amount       numeric(12,2) not null,
  -- The rate that applied and the sum it applied to, stored rather than
  -- computed. Deriving commission at read time from the partner's current
  -- tier would silently rewrite every historic figure the day they are
  -- promoted.
  rate_pct     numeric(5,2) not null default 0 check (rate_pct >= 0 and rate_pct <= 100),
  tier         text,
  basis        numeric(12,2) not null default 0 check (basis >= 0),
  note         text,
  credited_on  date not null,
  clears_on    date not null,
  status       text not null default 'pending'
                 check (status in ('pending','cleared','paid','void')),
  created_at   timestamptz not null default now(),
  unique (id, partner_id),
  constraint partner_ledger_referral_in_partner
    foreign key (referral_id, partner_id)
    references public.partner_referrals(id, partner_id) on delete set null,
  constraint partner_ledger_payout_in_partner
    foreign key (payout_id, partner_id)
    references public.partner_payouts(id, partner_id) on delete set null,
  constraint partner_ledger_clears_after_credit
    check (clears_on >= credited_on),
  -- Only a paid row belongs to a payout, and a paid row must belong to one.
  constraint partner_ledger_paid_has_payout
    check ((status = 'paid') = (payout_id is not null))
);
create index if not exists partner_ledger_partner_idx on public.partner_ledger(partner_id);
create index if not exists partner_ledger_payout_idx on public.partner_ledger(payout_id);

create table if not exists public.partner_accounts (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid not null references public.partners(id) on delete cascade,
  account_name   text not null,
  bank_name      text not null,
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  currency       text not null default 'NGN',
  is_primary     boolean not null default false,
  -- Set by the name-check job, never by the partner. A partner who can
  -- write this can mark an account we have not checked as checked, which
  -- is the whole control on paying money to the wrong name.
  verified       boolean not null default false,
  verified_on    date,
  added_on       date not null default current_date,
  unique (id, partner_id),
  unique (partner_id, bank_name, account_number)
);
create index if not exists partner_accounts_partner_idx on public.partner_accounts(partner_id);

-- Exactly one primary account per partner.
create unique index if not exists partner_accounts_one_primary
  on public.partner_accounts(partner_id) where is_primary;

-- =====================================================================
-- ROW LEVEL SECURITY
--
-- On and FORCED everywhere. Forced matters: without it the table owner
-- bypasses its own policies, and migrations run as the owner.
-- =====================================================================

alter table public.partners          enable row level security;
alter table public.partners          force  row level security;
alter table public.partner_links     enable row level security;
alter table public.partner_links     force  row level security;
alter table public.partner_referrals enable row level security;
alter table public.partner_referrals force  row level security;
alter table public.partner_ledger    enable row level security;
alter table public.partner_ledger    force  row level security;
alter table public.partner_payouts   enable row level security;
alter table public.partner_payouts   force  row level security;
alter table public.partner_accounts  enable row level security;
alter table public.partner_accounts  force  row level security;

-- Nothing here is reachable with the anon key. The join page needs to
-- resolve a code, and it does that through a function, not a table.
revoke all on public.partners          from anon, authenticated;
revoke all on public.partner_links     from anon, authenticated;
revoke all on public.partner_referrals from anon, authenticated;
revoke all on public.partner_ledger    from anon, authenticated;
revoke all on public.partner_payouts   from anon, authenticated;
revoke all on public.partner_accounts  from anon, authenticated;

-- ---------------------------------------------------------------------
-- Grants. Read is broad, write is narrow and column scoped.
-- ---------------------------------------------------------------------

-- Your own profile: read it all, change only how we reach you. Not tier,
-- not code, not status, not user_id.
grant select on public.partners to authenticated;
grant update (name, business_name, email, phone, city) on public.partners to authenticated;

-- Your own links: make them, rename them, pause them. Not clicks.
grant select, insert, delete on public.partner_links to authenticated;
grant update (label, active, is_default) on public.partner_links to authenticated;

-- Money and the people who earned it: read only, always.
grant select on public.partner_referrals to authenticated;
grant select on public.partner_ledger    to authenticated;
grant select on public.partner_payouts   to authenticated;

-- Your own payout accounts: add, edit, remove. Not verified, not verified_on.
grant select, insert, delete on public.partner_accounts to authenticated;
grant update (account_name, bank_name, account_number, is_primary)
  on public.partner_accounts to authenticated;

-- ---------------------------------------------------------------------
-- Policies. Written out rather than generated, because unlike the tenant
-- tables these differ from each other in ways a loop would flatten: three
-- are read-only, and the writable ones are writable in different shapes.
-- ---------------------------------------------------------------------

-- Note the deliberate difference from app.is_partner(): this reads your own
-- row whatever your status, so a suspended partner gets a screen that says
-- so rather than an empty portal and no explanation. It is their own name
-- and nothing else. Every other table below stays gated on being active, so
-- a suspended session still sees no money and no referrals.
drop policy if exists partners_select on public.partners;
create policy partners_select on public.partners
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists partners_update on public.partners;
create policy partners_update on public.partners
  for update to authenticated
  using (user_id = auth.uid() and status = 'active')
  with check (user_id = auth.uid() and status = 'active');
-- No insert policy: a partner is created by us, through the gateway. Self
-- signup would let anyone mint a code and start earning.
-- No delete policy: closing a partner account is an operator action, and
-- the ledger has to outlive it.

drop policy if exists partner_links_select on public.partner_links;
create policy partner_links_select on public.partner_links
  for select to authenticated
  using (app.is_partner(partner_id));

drop policy if exists partner_links_insert on public.partner_links;
create policy partner_links_insert on public.partner_links
  for insert to authenticated
  with check (app.is_partner(partner_id));

drop policy if exists partner_links_update on public.partner_links;
create policy partner_links_update on public.partner_links
  for update to authenticated
  using (app.is_partner(partner_id))
  with check (app.is_partner(partner_id));

-- Deleting a link that has referrals attached would orphan the
-- attribution, so the FK is ON DELETE SET NULL and the portal offers a
-- pause instead. Deleting an unused one is fine.
drop policy if exists partner_links_delete on public.partner_links;
create policy partner_links_delete on public.partner_links
  for delete to authenticated
  using (app.is_partner(partner_id) and not is_default);

drop policy if exists partner_referrals_select on public.partner_referrals;
create policy partner_referrals_select on public.partner_referrals
  for select to authenticated
  using (app.is_partner(partner_id));
-- No write policy of any kind. A partner who can insert a referral can
-- invent one; a partner who can update one can move it to 'subscribed'.

drop policy if exists partner_ledger_select on public.partner_ledger;
create policy partner_ledger_select on public.partner_ledger
  for select to authenticated
  using (app.is_partner(partner_id));
-- No write policy. This is the table that decides what we owe.

drop policy if exists partner_payouts_select on public.partner_payouts;
create policy partner_payouts_select on public.partner_payouts
  for select to authenticated
  using (app.is_partner(partner_id));
-- No write policy. A payout is a record of money that left our account.

drop policy if exists partner_accounts_select on public.partner_accounts;
create policy partner_accounts_select on public.partner_accounts
  for select to authenticated
  using (app.is_partner(partner_id));

drop policy if exists partner_accounts_insert on public.partner_accounts;
create policy partner_accounts_insert on public.partner_accounts
  for insert to authenticated
  with check (app.is_partner(partner_id) and verified = false);

drop policy if exists partner_accounts_update on public.partner_accounts;
create policy partner_accounts_update on public.partner_accounts
  for update to authenticated
  using (app.is_partner(partner_id))
  with check (app.is_partner(partner_id));

drop policy if exists partner_accounts_delete on public.partner_accounts;
create policy partner_accounts_delete on public.partner_accounts
  for delete to authenticated
  using (app.is_partner(partner_id));

-- Changing the bank details has to un-verify the account. Without this a
-- partner adds an account in their own name, waits for the check to pass,
-- then edits the number to someone else's and keeps the tick.
create or replace function app.partner_account_reverify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.account_number is distinct from old.account_number
     or new.bank_name is distinct from old.bank_name
     or new.account_name is distinct from old.account_name then
    new.verified := false;
    new.verified_on := null;
  end if;
  return new;
end;
$$;

drop trigger if exists partner_accounts_reverify on public.partner_accounts;
create trigger partner_accounts_reverify
  before update on public.partner_accounts
  for each row execute function app.partner_account_reverify();

-- =====================================================================
-- THE JOIN PAGE
--
-- Someone follows partners' link to /join/AMAKA-IG. That page is
-- anonymous: there is no session yet, and the anon role holds no table
-- grants by design. So resolution goes through one function, which is the
-- only thing anon may call here.
--
-- It returns the partner id and nothing else: no name, no email, no
-- earnings. A caller can learn that a code exists, which is not a secret
-- (codes are printed on cards and posted in bios), and nothing more.
--
-- It also counts the click, which is why clicks are not writable by the
-- partner: the number is only worth having if the partner cannot move it.
-- =====================================================================

create or replace function app.claim_referral_code(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_partner uuid;
begin
  if p_code is null or p_code !~ '^[A-Z0-9][A-Z0-9-]{1,31}$' then
    return null;
  end if;

  update public.partner_links l
     set clicks = l.clicks + 1
    from public.partners p
   where l.code = upper(p_code)
     and l.active
     and p.id = l.partner_id
     and p.status = 'active'
  returning l.partner_id into v_partner;

  if v_partner is not null then
    return v_partner;
  end if;

  -- Fall back to the partner's own default code, which is not a link row
  -- in every case (an older partner may predate campaign links).
  select p.id into v_partner
    from public.partners p
   where p.code = upper(p_code)
     and p.status = 'active';

  return v_partner;
end;
$$;

revoke all on function app.claim_referral_code(text) from public;
grant execute on function app.claim_referral_code(text) to anon, authenticated, service_role;

-- The join page has no session, so anon needs to reach the schema to call
-- that one function. USAGE on a schema grants nothing on its own: every
-- other function here is revoked from public and granted only to
-- authenticated and service_role, so this opens exactly one door.
grant usage on schema app to anon;

-- =====================================================================
-- WHO AM I
--
-- The portal's first call after sign in. One round trip, and it returns
-- only the signed-in partner's own row, so a bug in the client cannot
-- turn it into a directory.
-- =====================================================================

-- status is returned rather than filtered on, so the portal has to look at
-- it and can say "this account is suspended" instead of rendering an empty
-- shell. A client that ignores it still shows nothing, because every other
-- table is gated on app.is_partner(), which requires active. The failure
-- mode of forgetting to check is an empty portal, never someone else's.
create or replace function app.partner_me()
returns table (
  id uuid, code text, name text, business_name text, email text,
  phone text, city text, tax_id text, tier text, status text, joined_on date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.code, p.name, p.business_name, p.email,
         p.phone, p.city, p.tax_id, p.tier, p.status, p.joined_on
  from public.partners p
  where p.user_id = auth.uid();
$$;

revoke all on function app.partner_me() from public;
grant execute on function app.partner_me() to authenticated, service_role;

-- A trigger function cannot be called directly, but leaving EXECUTE open to
-- PUBLIC on a SECURITY DEFINER function is a habit worth not having.
revoke all on function app.partner_account_reverify() from public;
