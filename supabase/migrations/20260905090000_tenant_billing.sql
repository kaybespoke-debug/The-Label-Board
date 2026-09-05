-- =====================================================================
-- Nothing billed anybody.
--
-- The database has had the right tables since saas_admin: tlb_customers,
-- tlb_subscriptions and tlb_payments, with plan tiers, billing cycles, a
-- monthly-equivalent price, renewal dates, trial end dates and payment
-- references. What it has never had is a link between any of that and a
-- real tenant. public.businesses is the studio; tlb_customers is a sales
-- CRM; nothing joined them. So a studio could sign up, be provisioned and
-- use the app while carrying no subscription, no trial clock and no
-- payment history, and the console reported its MRR as the plan's list
-- price — money nobody had been asked for, let alone had taken.
--
-- Three things here.
--
-- 1. The link. tlb_customers.business_id, nullable because a prospect is
--    real before a tenant exists — somebody in the pipeline who has not
--    signed up yet is the normal case for a CRM. Unique where present, so
--    one studio cannot end up with two billing records quietly disagreeing
--    about what it pays.
--
-- 2. A billing record for every studio, made at the moment the studio is,
--    by the same trigger that provisions it. A tenant with no subscription
--    row is a tenant nobody is counting, and the gap between signing up and
--    an operator noticing is exactly where that happens. Every new studio
--    starts on a 14 day trial, on the books, with an end date.
--
-- 3. One answer to "what does this studio pay". businesses.plan is what the
--    APP reads to decide what a studio may do; tlb_subscriptions is what we
--    bill against. Those must never disagree, so app.set_studio_plan()
--    writes both or neither, and admin-api calls it rather than updating
--    either by hand.
--
-- Deliberately not here: taking money. No gateway, no card, no webhook. An
-- operator records a payment that has already happened, the same way a
-- studio records how its own customer paid. That was the decision for the
-- studios and it is the right one for us too while there are tens of
-- subscribers rather than thousands: a Flutterwave integration is a
-- fortnight of work and a permanent liability, and it can be added behind
-- tlb_payments without any of this changing.
-- =====================================================================

alter table public.tlb_customers add column if not exists business_id uuid
  references public.businesses(id) on delete set null;

create unique index if not exists tlb_customers_business_key
  on public.tlb_customers (business_id) where business_id is not null;

create index if not exists tlb_subscriptions_customer_active
  on public.tlb_subscriptions (customer_id) where is_active;

-- How long a new studio gets before we ask for money.
create or replace function app.trial_days()
returns int language sql immutable set search_path = pg_catalog, pg_temp
as $$ select 14 $$;

-- ---------------------------------------------------------------------
-- Give a studio its billing record.
--
-- Split out of the trigger so it can also be run for the studios that were
-- provisioned before any of this existed, and so it is idempotent: called
-- twice, a studio still has exactly one CRM row and one active trial.
-- ---------------------------------------------------------------------
create or replace function app.ensure_billing_record(p_business uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cust  uuid;
  v_biz   public.businesses%rowtype;
  v_email text;
begin
  select * into v_biz from public.businesses where id = p_business;
  if not found then return null; end if;

  select id into v_cust from public.tlb_customers where business_id = p_business;
  if v_cust is null then
    -- owner_email is unique on tlb_customers and a studio may not have given
    -- one, so fall back to something derived and unmistakably ours rather
    -- than colliding with a real address or failing the insert.
    v_email := coalesce(nullif(btrim(v_biz.contact_email), ''),
                        v_biz.slug || '@studios.thelabelboard.com');

    insert into public.tlb_customers
      (business_name, business_type, owner_name, owner_email, location, status, business_id)
    values (v_biz.name, 'fashion_label', coalesce(v_biz.name, 'Owner'), v_email,
            null, case when v_biz.plan = 'trial' then 'trial' else 'active' end, p_business)
    on conflict (owner_email) do update set business_id = excluded.business_id
    returning id into v_cust;
  end if;

  -- one active subscription, and only one
  if not exists (select 1 from public.tlb_subscriptions s
                  where s.customer_id = v_cust and s.is_active) then
    insert into public.tlb_subscriptions
      (customer_id, plan_tier, billing_cycle, monthly_equivalent_price,
       start_date, renewal_date, is_trial, trial_end_date, is_active)
    values (v_cust,
            coalesce(nullif(v_biz.plan, ''), 'trial'),
            'monthly',
            0,                                   -- a trial is worth nothing until it converts
            current_date,
            current_date + app.trial_days(),
            v_biz.plan = 'trial',
            case when v_biz.plan = 'trial' then current_date + app.trial_days() end,
            true);
  end if;

  return v_cust;
end;
$$;

revoke all on function app.ensure_billing_record(uuid) from public;
grant execute on function app.ensure_billing_record(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Move a studio onto a plan: both books, or neither.
--
-- businesses.plan gates what the studio may do in the app.
-- tlb_subscriptions is what we invoice against. A studio paying for Pro
-- while the app still treats it as a trial, or the reverse, is the kind of
-- disagreement nobody notices until a customer does.
-- ---------------------------------------------------------------------
create or replace function app.set_studio_plan(
  p_business uuid, p_plan text, p_cycle text, p_price numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cust uuid;
begin
  if p_plan not in ('trial','starter','pro','premium') then
    raise exception 'unknown plan %', p_plan;
  end if;
  if p_cycle not in ('monthly','annual','trial') then
    raise exception 'unknown billing cycle %', p_cycle;
  end if;
  if p_price < 0 then
    raise exception 'a plan cannot cost less than nothing';
  end if;

  v_cust := app.ensure_billing_record(p_business);
  if v_cust is null then raise exception 'no such studio %', p_business; end if;

  update public.businesses set plan = p_plan where id = p_business;

  -- the old subscription ends today rather than being overwritten, so the
  -- history of what a studio has been on survives a plan change
  update public.tlb_subscriptions
     set is_active = false, end_date = current_date, updated_at = now()
   where customer_id = v_cust and is_active;

  insert into public.tlb_subscriptions
    (customer_id, plan_tier, billing_cycle, monthly_equivalent_price,
     start_date, renewal_date, is_trial, trial_end_date, is_active)
  values (v_cust, p_plan, p_cycle, p_price, current_date,
          case when p_cycle = 'annual' then current_date + 365
               when p_cycle = 'monthly' then current_date + 30
               else current_date + app.trial_days() end,
          p_plan = 'trial',
          case when p_plan = 'trial' then current_date + app.trial_days() end,
          true);

  update public.tlb_customers
     set status = case when p_plan = 'trial' then 'trial' else 'active' end,
         updated_at = now()
   where id = v_cust;
end;
$$;

revoke all on function app.set_studio_plan(uuid, text, text, numeric) from public;
grant execute on function app.set_studio_plan(uuid, text, text, numeric) to service_role;

-- ---------------------------------------------------------------------
-- What every studio is on and what it has paid, in one read.
--
-- Sums only what actually arrived: payments marked completed. A plan's
-- list price is what a studio would owe, and reporting it as revenue is
-- how a business believes it is being paid when it is not.
-- ---------------------------------------------------------------------
create or replace function public.platform_billing_summary()
returns table (
  business_id      uuid,
  business_name    text,
  customer_id      uuid,
  plan             text,
  billing_cycle    text,
  monthly_price    numeric,
  is_trial         boolean,
  trial_ends_on    date,
  renews_on        date,
  started_on       date,
  paid_to_date     numeric,
  last_paid_on     timestamptz,
  payments_count   bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    b.id, b.name, c.id,
    s.plan_tier, s.billing_cycle, coalesce(s.monthly_equivalent_price, 0),
    coalesce(s.is_trial, false), s.trial_end_date, s.renewal_date, s.start_date,
    coalesce((select sum(p.amount) from public.tlb_payments p
               where p.customer_id = c.id and p.status = 'completed'), 0),
    (select max(p.payment_date) from public.tlb_payments p
       where p.customer_id = c.id and p.status = 'completed'),
    (select count(*) from public.tlb_payments p where p.customer_id = c.id)
  from public.businesses b
  left join public.tlb_customers c on c.business_id = b.id
  left join public.tlb_subscriptions s on s.customer_id = c.id and s.is_active
  order by b.name;
$$;

revoke all on function public.platform_billing_summary() from public, anon, authenticated;
grant execute on function public.platform_billing_summary() to service_role;

-- ---------------------------------------------------------------------
-- Provision billing alongside the studio itself.
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
begin
  select p.id into v_partner
  from public.partners p
  where p.pending_email is not null
    and lower(p.pending_email) = lower(new.email)
    and p.user_id is null
  limit 1;

  if v_partner is not null then
    update public.partners set user_id = new.id, pending_email = null where id = v_partner;
    return new;
  end if;

  select b.id into v_biz
  from public.businesses b
  where b.pending_owner_email is not null
    and lower(b.pending_owner_email) = lower(new.email)
  limit 1;

  if v_biz is not null then
    update public.businesses set pending_owner_email = null where id = v_biz;
  else
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

    insert into public.branches (business_id, name) values (v_biz, 'Main studio');
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

  return new;
exception when others then
  raise warning 'provision_studio failed for %: %', new.email, sqlerrm;
  return new;
end;
$$;

revoke all on function app.provision_studio() from public;

-- Backfill: every studio that already exists gets its billing record too.
do $$
declare r record;
begin
  for r in select id from public.businesses loop
    perform app.ensure_billing_record(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- The gateway's door to it.
--
-- admin-api reaches the database through PostgREST like everything else,
-- and PostgREST serves `public` — not `app`. app.partner_me() was
-- unreachable for exactly this reason and the portal could not sign
-- anybody in. Same shape of wrapper, same reason for not simply exposing
-- the app schema: it holds the machinery every policy is built on.
--
-- service_role only. This moves a studio between plans and no browser
-- session should be able to reach it, whoever they are signed in as.
-- ---------------------------------------------------------------------
create or replace function public.set_studio_plan(
  p_business uuid, p_plan text, p_cycle text, p_price numeric)
returns void
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$ select app.set_studio_plan(p_business, p_plan, p_cycle, p_price); $$;

revoke all on function public.set_studio_plan(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.set_studio_plan(uuid, text, text, numeric) to service_role;

-- Recording a payment that has already happened. No gateway, no card: an
-- operator writes down what arrived, the same way a studio records how its
-- own customer paid. The subscription is resolved here rather than passed
-- in, so a payment can never be filed against another studio's plan.
create or replace function public.record_studio_payment(
  p_business uuid, p_amount numeric, p_method text, p_reference text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cust uuid;
  v_sub  uuid;
  v_id   uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'a payment must be for something';
  end if;
  select id into v_cust from public.tlb_customers where business_id = p_business;
  if v_cust is null then
    v_cust := app.ensure_billing_record(p_business);
  end if;
  if v_cust is null then raise exception 'no such studio %', p_business; end if;

  select id into v_sub from public.tlb_subscriptions
   where customer_id = v_cust and is_active limit 1;

  insert into public.tlb_payments
    (customer_id, subscription_id, amount, currency, status, payment_method,
     flutterwave_reference, payment_date, notes)
  values (v_cust, v_sub, p_amount, 'NGN', 'completed',
          coalesce(nullif(btrim(p_method), ''), 'bank transfer'),
          nullif(btrim(p_reference), ''), now(), nullif(btrim(p_note), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_studio_payment(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.record_studio_payment(uuid, numeric, text, text, text) to service_role;

-- What a studio has paid, for its detail panel.
create or replace function public.studio_payments(p_business uuid)
returns table (
  id uuid, business_id uuid, business_name text, amount numeric, currency text,
  status text, payment_method text, reference text, paid_on timestamptz, notes text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, c.business_id, b.name, p.amount, p.currency, p.status, p.payment_method,
         p.flutterwave_reference, p.payment_date, p.notes
  from public.tlb_payments p
  join public.tlb_customers c on c.id = p.customer_id
  left join public.businesses b on b.id = c.business_id
  -- A null business means every studio, for the Payments page. Passing an id
  -- means one, for its detail panel. One function rather than two so the shape
  -- of a payment cannot drift between the list and the panel.
  where p_business is null or c.business_id = p_business
  order by p.payment_date desc nulls last;
$$;

revoke all on function public.studio_payments(uuid) from public, anon, authenticated;
grant execute on function public.studio_payments(uuid) to service_role;
