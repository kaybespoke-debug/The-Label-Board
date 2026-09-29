-- =====================================================================
-- Batch G: being paid
-- =====================================================================
-- Everything about money that a browser must not be trusted with, which is
-- all of it. Three properties decide whether this is a subscription system
-- or a form that says "thank you":
--
--   1. THE PRICE IS OURS. The browser says which plan and which cycle. It
--      never says what that costs. plan_prices is the only place a number
--      comes from, and it is the same number the pricing page publishes,
--      which billing_harness checks against web/pricing.html so the two
--      cannot drift.
--
--   2. THE WEBHOOK IS NOT BELIEVED, IT IS MATCHED. Flutterwave tells us a
--      reference. We look that reference up in our own billing_intents row,
--      which says which studio, which plan and how much we asked for. A
--      webhook that names a studio, a plan or an amount we never asked for
--      settles nothing.
--
--   3. IT HAPPENS ONCE. payment_events has a unique key on the provider's
--      own event id. A retried webhook — and they do retry — is recorded and
--      ignored, rather than paid for twice.
--
-- And one thing that had no consequence until now: a trial that ended unpaid
-- set businesses.status to 'suspended', and nothing in the database read it.
-- A studio that stopped paying kept the product. Section 6 is that.
--
-- ---------------------------------------------------------------------
-- 1. What a plan costs, in the only place it is allowed to be said
-- ---------------------------------------------------------------------
create table if not exists public.plan_prices (
  plan     text not null,
  cycle    text not null check (cycle in ('monthly','annual')),
  amount   numeric(14,2) not null check (amount > 0),
  currency text not null default 'NGN',
  active   boolean not null default true,
  primary key (plan, cycle)
);

-- Exactly what web/pricing.html publishes on 29 September 2026. The annual
-- figures are eleven months for twelve on Basic and eleven on Pro, which is
-- the page's arithmetic and not an invention here; billing_harness reads the
-- page and fails if they stop matching.
insert into public.plan_prices (plan, cycle, amount) values
  ('starter', 'monthly',  20000),
  ('starter', 'annual',  220000),
  ('pro',     'monthly',  49000),
  ('pro',     'annual',  539000)
on conflict (plan, cycle) do update set amount = excluded.amount, active = true;

alter table public.plan_prices enable row level security;
alter table public.plan_prices force row level security;
grant select on public.plan_prices to authenticated;
drop policy if exists plan_prices_read on public.plan_prices;
create policy plan_prices_read on public.plan_prices
  for select to authenticated using (active);
-- Readable by anybody signed in, because the app shows the price before it
-- takes a payment. NOT by anon, which rls_harness refuses outright and is
-- right to: the anon key holds no table grants at all here, and anything the
-- public web needs comes through a named RPC. The pricing page carries its
-- own numbers and does not read this table, which is exactly why
-- billing_harness checks that the two still agree.
--
-- Writable by nobody: there is no insert, update or delete policy, so
-- changing a price is a migration. That is the audit trail we want on a
-- number this important.

comment on table public.plan_prices is
  'What each plan costs. The only place a price comes from: a browser names a '
  'plan and a cycle and never an amount. Must agree with web/pricing.html, '
  'which billing_harness checks.';

-- ---------------------------------------------------------------------
-- 2. What we asked for, written down before we ask
-- ---------------------------------------------------------------------
-- This is the row that makes a webhook safe to act on. It is written when the
-- studio starts a checkout, by us, with the price from the table above, and
-- the reference in it is what Flutterwave is told. When the webhook arrives it
-- carries that reference and nothing else we trust.
create table if not exists public.billing_intents (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  tx_ref      text not null unique,
  plan        text not null,
  cycle       text not null check (cycle in ('monthly','annual')),
  amount      numeric(14,2) not null check (amount > 0),
  currency    text not null default 'NGN',
  status      text not null default 'pending'
                check (status in ('pending','paid','failed','abandoned')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz,
  fw_tx_id    text,
  note        text
);
create index if not exists billing_intents_business_idx
  on public.billing_intents(business_id, created_at desc);

alter table public.billing_intents enable row level security;
alter table public.billing_intents force row level security;
grant select on public.billing_intents to authenticated;
drop policy if exists billing_intents_select on public.billing_intents;
create policy billing_intents_select on public.billing_intents
  for select to authenticated
  using (app.is_owner(business_id) or app.is_platform_admin());
-- and no write policy at all: an intent is created by app.open_checkout and
-- settled by the webhook. A browser that could write one could ask to pay ₦1
-- for Pro.

-- ---------------------------------------------------------------------
-- 3. Every event the provider sent us, once
-- ---------------------------------------------------------------------
create table if not exists public.payment_events (
  id        bigserial primary key,
  provider  text not null default 'flutterwave',
  event_id  text not null,
  tx_ref    text,
  kind      text,
  at        timestamptz not null default now(),
  outcome   text,
  payload   jsonb,
  unique (provider, event_id)
);
create index if not exists payment_events_ref_idx on public.payment_events(tx_ref);

alter table public.payment_events enable row level security;
alter table public.payment_events force row level security;
grant select on public.payment_events to authenticated;
drop policy if exists payment_events_select on public.payment_events;
create policy payment_events_select on public.payment_events
  for select to authenticated using (app.is_platform_admin());

comment on table public.payment_events is
  'Every webhook the provider sent, keyed on its own event id. The unique '
  'constraint is the idempotency: a retry is recorded and ignored rather than '
  'paid for twice. Payloads are kept because a disputed payment is argued '
  'from them.';

-- ---------------------------------------------------------------------
-- 4. Starting a checkout
-- ---------------------------------------------------------------------
-- Owner only, and it refuses a downgrade the studio does not fit into rather
-- than taking the money and breaking their week. The price comes from
-- plan_prices; the caller's opinion about the amount is not a parameter.
create or replace function app.open_checkout(p_business uuid, p_plan text, p_cycle text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_amount numeric; v_cur text; v_ref text; v_seats int; v_studios int;
  v_max_seats int; v_max_studios int; v_over text;
begin
  if not app.is_owner(p_business) then
    raise exception 'only the owner can change the subscription' using errcode = '42501';
  end if;
  if p_cycle not in ('monthly','annual') then
    raise exception 'a subscription is monthly or annual' using errcode = '22023';
  end if;

  select amount, currency into v_amount, v_cur
    from public.plan_prices where plan = p_plan and cycle = p_cycle and active;
  if v_amount is null then
    raise exception 'there is no % % plan to buy', p_cycle, p_plan using errcode = '22023';
  end if;

  /* A DOWNGRADE THAT WOULD NOT FIT. Moving from Pro to Basic with thirty
     people and four outlets is a refusal, not a surprise: the plan limits are
     enforced by the database, so the studio would pay and then find they
     could not add anybody. Say so first, with the numbers. */
  select max_seats, max_studios into v_max_seats, v_max_studios
    from public.plan_limits where plan = p_plan;
  v_seats   := app.seats_used(p_business);
  select count(*) into v_studios from public.branches where business_id = p_business;
  if v_max_seats is not null and v_seats > v_max_seats then
    v_over := v_seats || ' people and that plan allows ' || v_max_seats;
  elsif v_max_studios is not null and v_studios > v_max_studios then
    v_over := v_studios || ' outlets and that plan allows ' || v_max_studios;
  end if;
  if v_over is not null then
    raise exception 'you have % — remove some first, or stay on your plan', v_over
      using errcode = '42P10';
  end if;

  /* The reference. Ours, unguessable, and carrying nothing about the studio:
     it is looked up, not parsed. */
  v_ref := 'tlb-' || replace(gen_random_uuid()::text, '-', '');

  /* Anything still pending for this studio is abandoned. Somebody who starts
     a checkout, changes their mind and starts another must not leave a live
     intent behind that a late webhook could settle. */
  update public.billing_intents
     set status = 'abandoned', note = 'replaced by a newer checkout'
   where business_id = p_business and status = 'pending';

  insert into public.billing_intents
    (business_id, tx_ref, plan, cycle, amount, currency, created_by)
  values (p_business, v_ref, p_plan, p_cycle, v_amount, v_cur, auth.uid());

  perform app.audit(p_business, 'Checkout started',
    p_plan || ' ' || p_cycle || ', ' || v_cur || ' ' || v_amount::text,
    'billing', v_ref, p_plan);

  return jsonb_build_object(
    'tx_ref', v_ref, 'amount', v_amount, 'currency', v_cur,
    'plan', p_plan, 'cycle', p_cycle);
end $fn$;

-- ---------------------------------------------------------------------
-- 5. Settling one
-- ---------------------------------------------------------------------
-- Called by the Edge Function AFTER it has re-queried the transaction at
-- Flutterwave, which is their own guidance and ours: the webhook body says
-- what somebody posted to us, and the verification endpoint says what
-- actually happened.
--
-- Everything this function is told about the studio, the plan and the price
-- comes from the intent, not from the caller. The caller supplies only what
-- the provider knows: the reference, the transaction id, what was actually
-- paid, and whether it succeeded.
create or replace function app.settle_checkout(
  p_event_id text, p_tx_ref text, p_fw_tx_id text,
  p_amount numeric, p_currency text, p_status text, p_payload jsonb default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare i record; v_outcome text; v_new boolean;
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'an event needs an id to be recorded once' using errcode = '22023';
  end if;

  /* ONCE. The insert is the lock: a retry loses the race against the unique
     key and is told so, rather than being applied twice. */
  insert into public.payment_events (event_id, tx_ref, kind, payload)
  values (p_event_id, p_tx_ref, p_status, p_payload)
  on conflict (provider, event_id) do nothing;
  get diagnostics v_new = row_count;
  if not v_new then
    return jsonb_build_object('applied', false, 'reason', 'already seen', 'event_id', p_event_id);
  end if;

  select * into i from public.billing_intents where tx_ref = p_tx_ref for update;
  if i.id is null then
    update public.payment_events set outcome = 'no such reference' where event_id = p_event_id;
    return jsonb_build_object('applied', false, 'reason', 'no such reference');
  end if;
  if i.status <> 'pending' then
    update public.payment_events set outcome = 'intent already ' || i.status where event_id = p_event_id;
    return jsonb_build_object('applied', false, 'reason', 'that checkout is already ' || i.status);
  end if;

  if lower(coalesce(p_status,'')) <> 'successful' then
    update public.billing_intents
       set status = 'failed', settled_at = now(), fw_tx_id = p_fw_tx_id,
           note = 'provider said ' || coalesce(p_status,'nothing')
     where id = i.id;
    update public.payment_events set outcome = 'failed' where event_id = p_event_id;
    perform app.audit(i.business_id, 'Payment failed',
      coalesce(p_status,'no status'), 'billing', p_tx_ref, i.plan);
    return jsonb_build_object('applied', true, 'paid', false, 'business_id', i.business_id);
  end if;

  /* PAID, BUT PAID FOR WHAT. A successful transaction for less than we asked,
     or in another currency, is not the thing we asked for. Recorded and
     refused rather than quietly upgrading the studio. */
  if p_currency is not null and upper(p_currency) <> upper(i.currency) then
    update public.payment_events set outcome = 'wrong currency' where event_id = p_event_id;
    perform app.audit(i.business_id, 'Payment in the wrong currency',
      coalesce(p_currency,'?') || ' for a ' || i.currency || ' plan', 'billing', p_tx_ref, i.plan);
    return jsonb_build_object('applied', true, 'paid', false, 'reason', 'wrong currency');
  end if;
  if p_amount is null or p_amount < i.amount then
    update public.payment_events set outcome = 'short' where event_id = p_event_id;
    perform app.audit(i.business_id, 'Payment short of the price',
      coalesce(p_amount,0)::text || ' of ' || i.amount::text, 'billing', p_tx_ref, i.plan);
    return jsonb_build_object('applied', true, 'paid', false, 'reason', 'less than the price');
  end if;

  perform app.set_studio_plan(i.business_id, i.plan, i.cycle, i.amount);
  perform public.record_studio_payment(i.business_id, p_amount, 'flutterwave', p_tx_ref,
    i.plan || ' ' || i.cycle);

  /* A studio that paid is not suspended, whatever it was before. This is the
     line that lets somebody who lapsed come back by paying. */
  update public.businesses set status = 'active'
   where id = i.business_id and status = 'suspended';

  update public.billing_intents
     set status = 'paid', settled_at = now(), fw_tx_id = p_fw_tx_id
   where id = i.id;
  update public.payment_events set outcome = 'paid' where event_id = p_event_id;

  perform app.audit(i.business_id, 'Subscription paid',
    i.plan || ' ' || i.cycle || ', ' || i.currency || ' ' || p_amount::text,
    'billing', p_tx_ref, i.plan);

  v_outcome := 'paid';
  return jsonb_build_object('applied', true, 'paid', true,
    'business_id', i.business_id, 'plan', i.plan, 'cycle', i.cycle);
end $fn$;

-- ---------------------------------------------------------------------
-- 6. Not paying has a consequence, and it is not losing your work
-- ---------------------------------------------------------------------
-- expire_finished_trials has set businesses.status to 'suspended' since
-- September and nothing in the database read it, so a studio whose trial ended
-- kept the product. It now means READ ONLY: every screen still opens, every
-- record is still there, the export still works and the studio can still tell
-- us something is wrong — but nothing new can be written until somebody pays.
--
-- One trigger function on nineteen tables rather than sixty policies rewritten,
-- because a predicate copied sixty times is a predicate that will differ in one
-- of them.
alter table public.tlb_subscriptions add column if not exists cancel_requested_at timestamptz;

create or replace function app.refuse_write_when_unpaid()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $fn$
declare v_biz uuid; v_status text;
begin
  /* BROWSERS ONLY. Our own functions run as the definer and must keep
     working: the export, the audit trail, the webhook settling a payment and
     the studio coming back to life all write while the studio is suspended. */
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  v_biz := coalesce(
    case when to_jsonb(coalesce(new, old)) ? 'business_id'
         then (to_jsonb(coalesce(new, old)) ->> 'business_id')::uuid end,
    null);
  if v_biz is null then return coalesce(new, old); end if;
  select status into v_status from public.businesses where id = v_biz;
  if v_status = 'active' or v_status is null then
    return coalesce(new, old);
  end if;
  raise exception 'this studio is % — everything is still here and still readable, and writing starts again when the subscription is paid', v_status
    using errcode = '42501';
end $fn$;

do $$
declare t text;
begin
  /* Not feedback or feedback_replies: a studio that has been suspended by
     mistake needs a way to say so, and that is the way.
     Not error_reports: we still want to know when it breaks.
     Not audit_log: a read-only session still records what it did.
     Not billing_intents: paying is the way out. */
  foreach t in array array[
    'app_state','attendance','branches','business_role_permissions','business_roles',
    'customers','customer_contacts','memberships','order_costs','order_items','orders',
    'payment_methods','products','staff','suppliers','transactions','team_invitations'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_unpaid_guard', t);
    execute format(
      'create trigger %I before insert or update or delete on public.%I
         for each row execute function app.refuse_write_when_unpaid()',
      t || '_unpaid_guard', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. Cancelling
-- ---------------------------------------------------------------------
-- Cancelling does not take the plan away today. The studio paid for a term and
-- keeps it to the end of that term; what cancelling stops is the renewal. The
-- date is returned so the screen can say it rather than implying it.
create or replace function app.cancel_subscription(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare v_cust uuid; s record;
begin
  if not app.is_owner(p_business) then
    raise exception 'only the owner can cancel the subscription' using errcode = '42501';
  end if;
  select id into v_cust from public.tlb_customers where business_id = p_business;
  select * into s from public.tlb_subscriptions
   where customer_id = v_cust and is_active order by start_date desc limit 1;
  if s.id is null then
    raise exception 'there is no subscription to cancel' using errcode = '42704';
  end if;
  if s.cancel_requested_at is not null then
    return jsonb_build_object('cancelled', true, 'runs_until', s.renewal_date,
      'note', 'this was already cancelled');
  end if;

  update public.tlb_subscriptions
     set cancel_requested_at = now(), updated_at = now()
   where id = s.id;

  perform app.audit(p_business, 'Subscription cancelled',
    'runs until ' || coalesce(s.renewal_date::text, 'the end of the term'),
    'billing', s.id::text, s.plan_tier);

  return jsonb_build_object('cancelled', true, 'runs_until', s.renewal_date,
    'note', 'Everything keeps working until then, and paying again resumes it.');
end $fn$;

-- and the other direction, for somebody who changes their mind before the term
-- runs out
create or replace function app.resume_subscription(p_business uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare v_cust uuid; s record;
begin
  if not app.is_owner(p_business) then
    raise exception 'only the owner can change the subscription' using errcode = '42501';
  end if;
  select id into v_cust from public.tlb_customers where business_id = p_business;
  select * into s from public.tlb_subscriptions
   where customer_id = v_cust and is_active order by start_date desc limit 1;
  if s.id is null or s.cancel_requested_at is null then
    raise exception 'there is no cancelled subscription to resume' using errcode = '42704';
  end if;
  if s.renewal_date is not null and s.renewal_date < current_date then
    raise exception 'that term has already run out; paying again is the way back'
      using errcode = '42P10';
  end if;
  update public.tlb_subscriptions
     set cancel_requested_at = null, updated_at = now() where id = s.id;
  perform app.audit(p_business, 'Subscription resumed', null, 'billing', s.id::text, s.plan_tier);
  return jsonb_build_object('resumed', true, 'renews_on', s.renewal_date);
end $fn$;

-- The term running out. Run on a schedule, and idempotent: a studio whose term
-- has ended and who has not paid again is suspended, which is read-only rather
-- than gone.
create or replace function public.expire_finished_terms(p_on date default current_date)
returns integer language plpgsql volatile security definer
set search_path = public, pg_temp as $fn$
declare v_rows int := 0; r record;
begin
  for r in
    select b.id, s.id as sub
      from public.businesses b
      join public.tlb_customers c on c.business_id = b.id
      join public.tlb_subscriptions s on s.customer_id = c.id and s.is_active
     where b.status = 'active'
       and s.is_trial is not true
       and s.renewal_date is not null
       and s.renewal_date < p_on
       and s.cancel_requested_at is not null
  loop
    update public.tlb_subscriptions
       set is_active = false, end_date = p_on, updated_at = now() where id = r.sub;
    update public.businesses set status = 'suspended' where id = r.id;
    perform app.audit(r.id, 'Subscription ended', 'the cancelled term ran out',
      'billing', r.sub::text, null);
    v_rows := v_rows + 1;
  end loop;
  return v_rows;
end $fn$;

-- ---------------------------------------------------------------------
-- 8. What the studio is allowed to know about its own money
-- ---------------------------------------------------------------------
-- studio_payments exists and is ours: it answers for every studio and is
-- granted to the service role. This is the owner's own, for their own studio,
-- and it is a separate function rather than a relaxed grant on that one.
create or replace function app.my_billing(p_business uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $fn$
declare v_cust uuid; j jsonb;
begin
  if not app.is_owner(p_business) then
    raise exception 'only the owner can see the subscription' using errcode = '42501';
  end if;
  select id into v_cust from public.tlb_customers where business_id = p_business;

  select jsonb_build_object(
    'plan', b.plan,
    'status', b.status,
    'trial_ends_on', b.trial_ends_on,
    'prices', coalesce((select jsonb_agg(jsonb_build_object(
                'plan', p.plan, 'cycle', p.cycle, 'amount', p.amount, 'currency', p.currency)
                order by p.plan, p.cycle)
              from public.plan_prices p where p.active), '[]'::jsonb),
    'subscription', (select jsonb_build_object(
                'plan', s.plan_tier, 'cycle', s.billing_cycle,
                'price', s.monthly_equivalent_price,
                'started_on', s.start_date, 'renews_on', s.renewal_date,
                'is_trial', s.is_trial, 'cancelled_at', s.cancel_requested_at)
              from public.tlb_subscriptions s
             where s.customer_id = v_cust and s.is_active
             order by s.start_date desc limit 1),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
                'amount', p.amount, 'currency', p.currency, 'status', p.status,
                'method', p.payment_method, 'reference', p.flutterwave_reference,
                'paid_on', p.payment_date, 'note', p.notes)
                order by p.payment_date desc)
              from public.tlb_payments p where p.customer_id = v_cust), '[]'::jsonb),
    'checkouts', coalesce((select jsonb_agg(jsonb_build_object(
                'tx_ref', i.tx_ref, 'plan', i.plan, 'cycle', i.cycle,
                'amount', i.amount, 'status', i.status, 'started', i.created_at)
                order by i.created_at desc)
              from public.billing_intents i where i.business_id = p_business), '[]'::jsonb))
    into j
  from public.businesses b where b.id = p_business;

  return coalesce(j, '{}'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------
-- 9. Who may call what
-- ---------------------------------------------------------------------
create or replace function public.open_checkout(p_business uuid, p_plan text, p_cycle text)
returns jsonb language sql security definer
set search_path = public, pg_temp as $fn$ select app.open_checkout(p_business, p_plan, p_cycle) $fn$;

create or replace function public.cancel_subscription(p_business uuid)
returns jsonb language sql security definer
set search_path = public, pg_temp as $fn$ select app.cancel_subscription(p_business) $fn$;

create or replace function public.resume_subscription(p_business uuid)
returns jsonb language sql security definer
set search_path = public, pg_temp as $fn$ select app.resume_subscription(p_business) $fn$;

create or replace function public.my_billing(p_business uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$ select app.my_billing(p_business) $fn$;

create or replace function public.settle_checkout(
  p_event_id text, p_tx_ref text, p_fw_tx_id text,
  p_amount numeric, p_currency text, p_status text, p_payload jsonb default null)
returns jsonb language sql security definer
set search_path = public, pg_temp as $fn$
  select app.settle_checkout(p_event_id, p_tx_ref, p_fw_tx_id, p_amount, p_currency, p_status, p_payload)
$fn$;

revoke all on function public.open_checkout(uuid, text, text)      from public, anon;
revoke all on function public.cancel_subscription(uuid)            from public, anon;
revoke all on function public.resume_subscription(uuid)            from public, anon;
revoke all on function public.my_billing(uuid)                     from public, anon;
grant execute on function public.open_checkout(uuid, text, text)   to authenticated;
grant execute on function public.cancel_subscription(uuid)         to authenticated;
grant execute on function public.resume_subscription(uuid)         to authenticated;
grant execute on function public.my_billing(uuid)                  to authenticated;

-- SETTLING IS NOT A BROWSER'S BUSINESS. This is the one that hands out a
-- plan, so it is the service role and nobody else, and the revoke names anon
-- and authenticated explicitly because Supabase grants execute on new public
-- functions to both and revoking from PUBLIC does not take that away.
revoke all on function public.settle_checkout(text, text, text, numeric, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_checkout(text, text, text, numeric, text, text, jsonb)
  to service_role;
revoke all on function public.expire_finished_terms(date) from public, anon, authenticated;
grant execute on function public.expire_finished_terms(date) to service_role;

revoke all on function app.open_checkout(uuid, text, text)   from public, anon, authenticated;
revoke all on function app.cancel_subscription(uuid)         from public, anon, authenticated;
revoke all on function app.resume_subscription(uuid)         from public, anon, authenticated;
revoke all on function app.my_billing(uuid)                  from public, anon, authenticated;
revoke all on function app.settle_checkout(text, text, text, numeric, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function app.refuse_write_when_unpaid()        from public, anon, authenticated;
