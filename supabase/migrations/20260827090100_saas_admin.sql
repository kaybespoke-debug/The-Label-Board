-- The Label Board SaaS Admin Schema
-- Manages customers, subscriptions, payments, and pipeline

-- 1. CUSTOMERS TABLE
create table if not exists public.tlb_customers (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  business_type text not null, -- e.g., fashion_label, retail, wholesale
  owner_name text not null,
  owner_email text not null unique,
  owner_phone text,
  location text, -- city, country
  website text,
  notes text,
  status text default 'prospect', -- prospect, trial, active, churned, inactive
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 2. SUBSCRIPTIONS TABLE
create table if not exists public.tlb_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.tlb_customers(id) on delete cascade,
  plan_tier text not null, -- starter, pro, enterprise
  billing_cycle text not null, -- monthly, quarterly, 6months, annual, custom
  monthly_equivalent_price numeric not null, -- normalized to monthly for comparison
  start_date date not null,
  end_date date, -- when current subscription ends
  renewal_date date, -- next renewal date
  is_trial boolean default false,
  trial_end_date date, -- when free trial ends
  is_active boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 3. PAYMENTS TABLE
create table if not exists public.tlb_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.tlb_customers(id) on delete cascade,
  subscription_id uuid references public.tlb_subscriptions(id) on delete set null,
  amount numeric not null,
  currency text default 'NGN',
  status text not null, -- pending, completed, failed, refunded
  payment_method text, -- flutterwave, manual, etc
  flutterwave_reference text unique,
  payment_date timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 4. PIPELINE TRACKING TABLE
create table if not exists public.tlb_pipeline (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.tlb_customers(id) on delete cascade,
  stage text not null, -- discovery, interested, trial, negotiation, active, lost
  stage_entered_at timestamp with time zone default now(),
  deal_value numeric, -- estimated or confirmed deal value
  probability_percent integer default 0, -- 0-100 for sales forecasting
  next_action text,
  next_action_date date,
  updated_at timestamp with time zone default now()
);

-- 5. FOLLOW-UP NOTES TABLE
create table if not exists public.tlb_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.tlb_customers(id) on delete cascade,
  note_type text not null, -- followup, conversation, issue, feedback
  content text not null,
  created_by text, -- email of staff member
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 6. TRIAL HISTORY (Fraud Prevention)
create table if not exists public.tlb_trial_history (
  id uuid primary key default gen_random_uuid(),
  customer_email text not null,
  trial_start_date date not null,
  trial_end_date date,
  customer_id uuid references public.tlb_customers(id) on delete set null,
  ip_address text,
  created_at timestamp with time zone default now()
);

-- INDEXES
create index idx_tlb_customers_email on public.tlb_customers(owner_email);
create index idx_tlb_customers_status on public.tlb_customers(status);
create index idx_tlb_subscriptions_customer on public.tlb_subscriptions(customer_id);
create index idx_tlb_subscriptions_active on public.tlb_subscriptions(is_active);
create index idx_tlb_subscriptions_renewal on public.tlb_subscriptions(renewal_date);
create index idx_tlb_payments_customer on public.tlb_payments(customer_id);
create index idx_tlb_payments_status on public.tlb_payments(status);
create index idx_tlb_pipeline_customer on public.tlb_pipeline(customer_id);
create index idx_tlb_notes_customer on public.tlb_notes(customer_id);
create index idx_tlb_trial_history_email on public.tlb_trial_history(customer_email);

-- ROW LEVEL SECURITY
alter table public.tlb_customers enable row level security;
alter table public.tlb_subscriptions enable row level security;
alter table public.tlb_payments enable row level security;
alter table public.tlb_pipeline enable row level security;
alter table public.tlb_notes enable row level security;

-- Allow platform_admins to see all data
create policy "platform_admins_can_read_all_customers" on public.tlb_customers
  for select
  using (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_read_all_subscriptions" on public.tlb_subscriptions
  for select
  using (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_read_all_payments" on public.tlb_payments
  for select
  using (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_read_all_pipeline" on public.tlb_pipeline
  for select
  using (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_read_all_notes" on public.tlb_notes
  for select
  using (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

-- Allow platform_admins to insert/update/delete
create policy "platform_admins_can_insert_customers" on public.tlb_customers
  for insert
  with check (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_update_customers" on public.tlb_customers
  for update
  using (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ))
  with check (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_insert_subscriptions" on public.tlb_subscriptions
  for insert
  with check (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_update_subscriptions" on public.tlb_subscriptions
  for update
  using (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ))
  with check (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_insert_payments" on public.tlb_payments
  for insert
  with check (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_insert_pipeline" on public.tlb_pipeline
  for insert
  with check (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_update_pipeline" on public.tlb_pipeline
  for update
  using (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ))
  with check (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));

create policy "platform_admins_can_insert_notes" on public.tlb_notes
  for insert
  with check (exists (
    select 1 from public.platform_admins
    where platform_admins.id = auth.uid()
  ));
