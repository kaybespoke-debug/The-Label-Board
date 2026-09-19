-- =====================================================================
-- Milestone bonuses, and the yearly payout run.
--
-- The two halves of the partner programme that the page already promised
-- and nothing computed. Kayode, 19 September 2026: "milestone bonuses,
-- build to our specs" and "the yearly payout run, build it".
--
-- The spec for the bonuses is the one printed on the partners page and
-- held in the portal's MILESTONES, and the three are now checked against
-- each other by audit_web.js and by the commission harness:
--
--     5 paying businesses    N25,000
--    10 paying businesses    N50,000
--    20 paying businesses    N100,000
--    30 paying businesses    N150,000
--
-- "Paid the day you reach each one, in addition to the commission you
-- have already earned."
--
-- THE TWO DECISIONS WORTH ARGUING WITH
--
-- 1. A milestone is awarded ONCE, for ever. A partner who reaches 20,
--    falls to 12 and climbs back to 20 is not paid the 20 bonus twice.
--    This is the same forward-only rule as the commission rate: what has
--    been credited is never taken back, and the other side of that coin
--    is that crossing the same line again is not a new event. The unique
--    index enforces it rather than the job remembering to.
--
-- 2. A payout run with nothing owed creates NO payout row. partner_payouts
--    already refuses a non-positive amount, and a zero row in a partner's
--    statement history is a thing they have to ask about.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The milestones, as data.
-- ---------------------------------------------------------------------
create table if not exists public.partner_milestones (
  at_active int primary key check (at_active > 0),
  amount    numeric(12,2) not null check (amount > 0)
);

insert into public.partner_milestones (at_active, amount) values
  (5, 25000), (10, 50000), (20, 100000), (30, 150000)
on conflict (at_active) do update set amount = excluded.amount;

alter table public.partner_milestones enable row level security;
alter table public.partner_milestones force  row level security;

drop policy if exists partner_milestones_read on public.partner_milestones;
create policy partner_milestones_read on public.partner_milestones
  for select to authenticated using (true);

revoke all on public.partner_milestones from anon;
grant select on public.partner_milestones to authenticated;

-- ---------------------------------------------------------------------
-- 2. The ledger remembers which milestone a bonus was for.
--
-- Without this the only thing distinguishing one bonus row from another
-- is its note, and "have we already paid the 20 bonus" becomes a text
-- search. The unique index is what makes the award job safe to re-run and
-- safe against a partner crossing the same line twice.
-- ---------------------------------------------------------------------
alter table public.partner_ledger
  add column if not exists milestone int;

alter table public.partner_ledger
  drop constraint if exists partner_ledger_milestone_shape;
alter table public.partner_ledger
  add constraint partner_ledger_milestone_shape
  check ((milestone is null) or (kind = 'bonus' and milestone > 0));

create unique index if not exists partner_ledger_one_bonus_per_milestone
  on public.partner_ledger (partner_id, milestone)
  where milestone is not null;

-- ---------------------------------------------------------------------
-- 3. Award whatever they have reached and have not been paid for.
--
-- Awards every unreached milestone at or below the count, not just the
-- highest, so a partner who signs ten businesses in one week gets both
-- the 5 and the 10. Returns what it paid out, so a caller can tell the
-- difference between "nothing was due" and "it did not run".
-- ---------------------------------------------------------------------
create or replace function public.partner_award_milestones(p_partner uuid, p_on date default current_date)
returns numeric
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_active int;
  v_total  numeric := 0;
  m        record;
begin
  v_active := public.partner_active_paying(p_partner, p_on);

  for m in
    select ms.at_active, ms.amount
    from public.partner_milestones ms
    where ms.at_active <= v_active
      and not exists (
        select 1 from public.partner_ledger l
        where l.partner_id = p_partner and l.milestone = ms.at_active)
    order by ms.at_active
  loop
    insert into public.partner_ledger
      (partner_id, kind, amount, rate_pct, basis, note,
       credited_on, clears_on, status, milestone)
    values
      (p_partner, 'bonus', m.amount, 0, 0,
       'Milestone bonus, ' || m.at_active || ' paying businesses',
       p_on, (p_on + interval '31 days')::date, 'pending', m.at_active)
    on conflict do nothing;

    if found then
      v_total := v_total + m.amount;
    end if;
  end loop;

  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Clearing: pending becomes cleared once the hold is up.
--
-- Separate from the payout run on purpose. Clearing is a statement about
-- the money being safe; paying is a statement about it having left our
-- account. Running them together would make it impossible to see a
-- partner's cleared balance before a run.
-- ---------------------------------------------------------------------
create or replace function public.partner_clear_ledger(p_on date default current_date)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update public.partner_ledger
     set status = 'cleared'
   where status = 'pending'
     and clears_on <= p_on;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. The yearly payout run.
--
-- Everything cleared and not yet paid, for one partner, in one payout,
-- stamped with the bank account as it was on the day. The account is
-- copied by value into partner_payouts because a partner can remove an
-- account later, and a statement that changes after the fact is not a
-- statement. That is the existing table's design; this fills it in.
--
-- Returns the payout id, or null when there was nothing to pay. Null
-- rather than an error: "nothing was owed this year" is an ordinary
-- outcome of a yearly run, not a failure.
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
begin
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

  -- A payout to an account we have not name-checked is how money reaches
  -- the wrong person. The run stops rather than guessing.
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

-- ---------------------------------------------------------------------
-- 6. None of it runs from a browser.
--
-- Supabase grants execute on every new function in public to anon and
-- authenticated by default, and granting to somebody else does not take
-- that away. Each one is named. storage_rls_harness sweeps for the ones
-- that get missed, and has already caught one in this programme.
-- ---------------------------------------------------------------------
revoke execute on function public.partner_award_milestones(uuid, date) from public, anon, authenticated;
revoke execute on function public.partner_clear_ledger(date)           from public, anon, authenticated;
revoke execute on function public.partner_payout_run(uuid, date)       from public, anon, authenticated;
grant  execute on function public.partner_award_milestones(uuid, date) to service_role;
grant  execute on function public.partner_clear_ledger(date)           to service_role;
grant  execute on function public.partner_payout_run(uuid, date)       to service_role;
