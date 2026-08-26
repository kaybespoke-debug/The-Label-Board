-- The Label Board SaaS: Staff Management & Commissions Schema

-- 1. STAFF TABLE
create table if not exists public.tlb_staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique, -- Links to Supabase auth.users
  email text not null unique,
  name text not null,
  role text not null, -- owner, sales, operations, support
  is_active boolean default true,
  commission_rate numeric, -- For sales role only (0.0-1.0)
  phone text,
  avatar_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 2. COMMISSIONS TABLE (for sales tracking)
create table if not exists public.tlb_commissions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.tlb_staff(id) on delete cascade,
  customer_id uuid not null references public.tlb_customers(id) on delete cascade,
  subscription_id uuid references public.tlb_subscriptions(id) on delete set null,
  commission_amount numeric not null,
  payment_id uuid references public.tlb_payments(id) on delete set null,
  status text default 'pending', -- pending, paid, cancelled
  payment_date date,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 3. SUPPORT TICKETS TABLE
create table if not exists public.tlb_support_tickets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.tlb_customers(id) on delete cascade,
  assigned_to uuid references public.tlb_staff(id) on delete set null,
  title text not null,
  description text,
  status text default 'open', -- open, in_progress, resolved, closed
  priority text default 'medium', -- low, medium, high, urgent
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 4. TASKS TABLE
create table if not exists public.tlb_tasks (
  id uuid primary key default gen_random_uuid(),
  assigned_to uuid not null references public.tlb_staff(id) on delete cascade,
  customer_id uuid references public.tlb_customers(id) on delete set null,
  title text not null,
  description text,
  status text default 'pending', -- pending, in_progress, completed, cancelled
  due_date date,
  priority text default 'medium',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 5. AUDIT LOG TABLE (track all admin actions)
create table if not exists public.tlb_audit_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.tlb_staff(id) on delete cascade,
  action text not null, -- create_customer, update_subscription, etc
  entity_type text, -- customer, subscription, payment
  entity_id uuid,
  details jsonb,
  created_at timestamp with time zone default now()
);

-- INDEXES
create index idx_tlb_staff_email on public.tlb_staff(email);
create index idx_tlb_staff_role on public.tlb_staff(role);
create index idx_tlb_staff_active on public.tlb_staff(is_active);
create index idx_tlb_commissions_staff on public.tlb_commissions(staff_id);
create index idx_tlb_commissions_customer on public.tlb_commissions(customer_id);
create index idx_tlb_commissions_status on public.tlb_commissions(status);
create index idx_tlb_support_tickets_customer on public.tlb_support_tickets(customer_id);
create index idx_tlb_support_tickets_assigned on public.tlb_support_tickets(assigned_to);
create index idx_tlb_support_tickets_status on public.tlb_support_tickets(status);
create index idx_tlb_tasks_assigned on public.tlb_tasks(assigned_to);
create index idx_tlb_tasks_status on public.tlb_tasks(status);
create index idx_tlb_audit_log_staff on public.tlb_audit_log(staff_id);

-- ROW LEVEL SECURITY
alter table public.tlb_staff enable row level security;
alter table public.tlb_commissions enable row level security;
alter table public.tlb_support_tickets enable row level security;
alter table public.tlb_tasks enable row level security;

-- STAFF POLICIES
create policy "authenticated_can_read_own_staff_profile" on public.tlb_staff
  for select
  using (auth.uid() = auth_user_id);

create policy "owner_can_read_all_staff" on public.tlb_staff
  for select
  using (exists (select 1 from public.tlb_staff where auth_user_id = auth.uid() and role = 'owner'));

create policy "owner_can_manage_staff" on public.tlb_staff
  for insert
  with check (exists (select 1 from public.tlb_staff where auth_user_id = auth.uid() and role = 'owner'));

create policy "owner_can_update_staff" on public.tlb_staff
  for update
  using (exists (select 1 from public.tlb_staff where auth_user_id = auth.uid() and role = 'owner'))
  with check (exists (select 1 from public.tlb_staff where auth_user_id = auth.uid() and role = 'owner'));

-- COMMISSIONS POLICIES
create policy "sales_can_read_own_commissions" on public.tlb_commissions
  for select
  using (exists (
    select 1 from public.tlb_staff
    where tlb_staff.id = staff_id and tlb_staff.auth_user_id = auth.uid()
  ));

create policy "owner_can_read_all_commissions" on public.tlb_commissions
  for select
  using (exists (select 1 from public.tlb_staff where auth_user_id = auth.uid() and role = 'owner'));

create policy "owner_can_manage_commissions" on public.tlb_commissions
  for insert
  with check (exists (select 1 from public.tlb_staff where auth_user_id = auth.uid() and role = 'owner'));

-- SUPPORT TICKETS POLICIES
create policy "support_can_read_assigned_tickets" on public.tlb_support_tickets
  for select
  using (exists (
    select 1 from public.tlb_staff
    where tlb_staff.id = assigned_to and tlb_staff.auth_user_id = auth.uid()
  ) or exists (select 1 from public.tlb_staff where auth_user_id = auth.uid() and role = 'owner'));

create policy "support_can_update_tickets" on public.tlb_support_tickets
  for update
  using (exists (
    select 1 from public.tlb_staff
    where tlb_staff.id = assigned_to and tlb_staff.auth_user_id = auth.uid()
  ) or exists (select 1 from public.tlb_staff where auth_user_id = auth.uid() and role = 'owner'));

-- TASKS POLICIES
create policy "staff_can_read_own_tasks" on public.tlb_tasks
  for select
  using (exists (
    select 1 from public.tlb_staff
    where tlb_staff.id = assigned_to and tlb_staff.auth_user_id = auth.uid()
  ));

create policy "staff_can_update_own_tasks" on public.tlb_tasks
  for update
  using (exists (
    select 1 from public.tlb_staff
    where tlb_staff.id = assigned_to and tlb_staff.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.tlb_staff
    where tlb_staff.id = assigned_to and tlb_staff.auth_user_id = auth.uid()
  ));
