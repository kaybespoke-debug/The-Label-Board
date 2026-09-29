-- =====================================================================
-- Money stops being a blob
-- =====================================================================
-- layi_dash_txns is one jsonb array per business. Every device reads the
-- whole array, appends to it, and writes the whole thing back. So:
--
--   Device A reads [] and records a 50,000 deposit.
--   Device B, which has not seen A's write, reads [] and records 75,000.
--   Both writes are accepted. The studio took 125,000. The server holds
--   75,000, and the 50,000 never existed.
--
-- No error, no conflict, no sign. This is not a narrow race needing exact
-- timing — any two devices that were both offline for a minute produce it,
-- which on a shop floor with a phone and a tablet is most afternoons.
-- money_concurrency_harness demonstrates it before it tests the fix, so
-- the fix is measured against a failure that was shown rather than
-- described.
--
-- public.transactions has existed since August with branch-scoped RLS and
-- has never held a row, because the app writes the blob. Three things are
-- missing before it can: an identity the device can repeat, a rule that
-- recording money is a permission, and a rule that seeing it is another.
--
-- WHAT IS NOT HERE. The blob is not migrated and not retired by THIS file;
-- 20260929236000 does that, with its own reconciliation.
--
-- AN EARLIER DRAFT OF THIS COMMENT said production held no transactions at
-- all, "0 rows in the table AND 0 payments in the blob", and concluded there
-- was nothing to move. The table is indeed empty. The blob holds 76 payments
-- worth 7,457,600 across two studios. The count that was checked was the
-- empty one — the same mistake as reading a field list instead of the data,
-- made one file earlier and caught by looking before writing a migration.
-- It is left here rather than quietly deleted, because the next person is
-- likelier to check their numbers if they can see somebody else's go wrong.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A payment the device can name, and name again
-- ---------------------------------------------------------------------
-- THE IDEMPOTENCY KEY IS THE WHOLE ANSWER TO THE RETRY PROBLEM. A device
-- that sends a payment and never hears back cannot tell a lost request
-- from a lost reply. With an id it chose before sending, the second
-- attempt is recognisably the same payment; without one it is a second
-- payment, and the studio's books gain money nobody paid.
alter table public.transactions
  add column if not exists app_id     text,
  add column if not exists method     text,
  add column if not exists note       text,
  add column if not exists recorded_by uuid,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_app_id_per_business') then
    alter table public.transactions
      add constraint transactions_app_id_per_business unique (business_id, app_id);
  end if;
end $$;

create index if not exists transactions_business_order_idx
  on public.transactions(business_id, order_id);

-- ---------------------------------------------------------------------
-- 2. Who may record money, and who may see it
-- ---------------------------------------------------------------------
-- Both were app.in_scope(), which is "are you in this studio" and nothing
-- more: every member could read and write every payment. The two
-- permissions already exist and were already in the catalogue; they were
-- simply never asked here.
--
--   finance.record_payment   to write one
--   receivables              to read them
--
-- SELECT and INSERT are different questions on purpose. A shop assistant
-- may need to take a deposit without being shown what the studio is owed.
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions for select to authenticated
  using (app.can_here(business_id, 'receivables', branch_id));

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions for insert to authenticated
  with check (app.can_here(business_id, 'finance.record_payment', branch_id));

/* A RECORDED PAYMENT IS NOT AN EDITABLE ONE. Correcting money is a new
   line, not a rewrite of the old one, for the same reason the audit trail
   is append-only: a number that can be changed quietly is not a record of
   anything. Only an owner may delete, and only to undo a mistake made
   moments ago; the audit trigger records it either way. */
drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions for update to authenticated
  using (false) with check (false);

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions for delete to authenticated
  using (app.is_owner(business_id));

revoke all on public.transactions from anon, authenticated;
grant select, insert, delete on public.transactions to authenticated;

-- ---------------------------------------------------------------------
-- 3. The server decides who recorded it
-- ---------------------------------------------------------------------
-- Not the client. A payment that can be attributed to somebody else is a
-- way to make a cash shortfall look like another person's shift.
create or replace function app.stamp_transaction()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $fn$
begin
  new.recorded_by := auth.uid();
  if new.app_id is null or btrim(new.app_id) = '' then
    new.app_id := 'srv-' || gen_random_uuid()::text;
  end if;
  return new;
end $fn$;

drop trigger if exists transactions_stamp on public.transactions;
create trigger transactions_stamp before insert on public.transactions
  for each row execute function app.stamp_transaction();

revoke all on function app.stamp_transaction() from public, anon, authenticated;

comment on column public.transactions.app_id is
  'The id the device chose before sending. It is what makes a retry the '
  'same payment rather than a second one, and it is unique per studio.';
comment on column public.transactions.recorded_by is
  'Stamped by the server from auth.uid(). A client cannot attribute a '
  'payment to somebody else.';
