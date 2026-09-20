-- =====================================================================
-- Plan features, enforced by the database.
--
-- Kayode, 20 September 2026:
--
--   "Basic must NOT include: chase list/reminders, Funds/owner pay/
--    retained profit, Inventory with auto-deduction, low-stock warnings,
--    vendors/suppliers, rota/attendance/leave, payroll/piece rates/
--    commission, company log, marketing lists/templates, reporting lines,
--    full reports. All of those are Pro (and Bespoke). Basic keeps:
--    orders, production, customers and measurements, invoices/receipts,
--    basic money-in/money-out, retail sales, view-only 'see who owes
--    you', plus its scale limits."
--
--   "Enforce every gate server-side, not just hidden buttons - a Basic
--    account must be genuinely unable to open or use a Pro feature even
--    by forging a request, the same way tenant isolation is enforced."
--
-- WHAT WAS THERE BEFORE. One key, `chase`, in a constant in the browser.
-- The comparison table marked eight rows "Not included" for Basic and the
-- software enforced none of them. A Basic studio could open Payroll,
-- Inventory, Marketing and Funds and use all of them.
--
-- WHERE THE BOUNDARY ACTUALLY IS
--
-- The app keeps its records in two places: tenant tables, and app_state,
-- which is one JSONB row per storage key. So a feature is enforceable
-- exactly where it OWNS data, and the gate goes on the write:
--
--   inventory    app_state layi_dash_supplies
--   suppliers    app_state layi_dash_bills, and the suppliers table
--   funds        app_state layi_dash_pots
--   team         app_state layi_dash_attendance / _leave / _shifts,
--                and the attendance table
--   marketing    app_state layi_dash_campaigns
--   companylog   app_state layi_dash_log, layi_dash_anns
--   payroll      staff.basic, which is the pay rate every payroll figure
--                is computed from
--
-- WRITES ARE BLOCKED, READS ARE NOT, and that is deliberate. It is the
-- rule audit_tiers has had since the beginning and it is the right one: a
-- studio that drops from Pro to Basic keeps everything it already had and
-- simply cannot add more. Hiding records somebody is still trading on
-- would be data loss from their chair. A NEW Basic account has nothing in
-- these keys, so reads return nothing anyway.
--
-- THREE FEATURES HAVE NO SERVER SURFACE, and saying so is better than
-- pretending otherwise:
--
--   chase      sending a reminder is a wa.me link opened on the device.
--              There is no server in that path and there cannot be one
--              until we send messages ourselves. The app has said this
--              in a comment since the beginning.
--   reporting  reporting lines are read-side arithmetic over staff rows
--              Basic legitimately holds.
--   reports    the same: a fuller report is a different sum over the
--              same orders.
--
-- All three are gated in the app and listed in my_plan_features(), so a
-- client cannot quietly grant itself one, but a determined person with
-- the anon key could still compute them for themselves. What they cannot
-- do is STORE anything, which is what makes a feature usable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The features, as data.
-- ---------------------------------------------------------------------
create table if not exists public.plan_feature_catalogue (
  feature text primary key,
  label   text not null,
  blurb   text not null
);

insert into public.plan_feature_catalogue (feature, label, blurb) values
  ('chase',      'Chase list and payment reminders', 'See who owes you on any plan. Chasing them is Pro.'),
  ('funds',      'Funds, owner pay and retained profit', 'Set money aside, pay yourself, and see what the business kept.'),
  ('inventory',  'Inventory and low stock warnings',  'Stock that comes off the shelf when a job uses it, and tells you when it is running out.'),
  ('suppliers',  'Vendors and suppliers',             'Who you buy from, what you owe them, and what each job cost.'),
  ('team',       'Rota, attendance and leave',        'Who is working when, who turned up, and who is off.'),
  ('payroll',    'Payroll, piece rates and commission', 'What each person earned, by salary, by piece or by commission.'),
  ('companylog', 'Company log',                       'Notices and announcements everyone on the team can see.'),
  ('marketing',  'Marketing lists and message templates', 'Segments built from what you already recorded, and the messages to send them.'),
  ('reporting',  'Reporting lines',                   'Managers see their own team rather than everybody.'),
  ('reports',    'Full reports',                      'The whole picture rather than the headline figures.')
on conflict (feature) do update
  set label = excluded.label, blurb = excluded.blurb;

create table if not exists public.plan_features (
  plan    text not null check (plan in ('trial', 'starter', 'pro', 'premium')),
  feature text not null references public.plan_feature_catalogue(feature) on delete cascade,
  primary key (plan, feature)
);

-- Pro, Bespoke and the trial get everything. Basic gets none of them:
-- what Basic has is the list above that is NOT in this catalogue, which
-- is orders, production, customers and measurements, invoices, money in
-- and out, retail sales and a read-only view of who owes it.
insert into public.plan_features (plan, feature)
select p, c.feature
from unnest(array['trial', 'pro', 'premium']) p
cross join public.plan_feature_catalogue c
on conflict do nothing;

delete from public.plan_features where plan = 'starter';

-- A plan with no row at all would be silently ungated, so the set is
-- asserted rather than assumed.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.plan_features where plan = 'pro';
  if v_n <> (select count(*) from public.plan_feature_catalogue) then
    raise exception 'pro does not have every feature: % of %',
      v_n, (select count(*) from public.plan_feature_catalogue);
  end if;
  if exists (select 1 from public.plan_features where plan = 'starter') then
    raise exception 'Basic has a feature it should not have';
  end if;
end $$;

alter table public.plan_feature_catalogue enable row level security;
alter table public.plan_feature_catalogue force  row level security;
alter table public.plan_features          enable row level security;
alter table public.plan_features          force  row level security;

drop policy if exists plan_feature_catalogue_read on public.plan_feature_catalogue;
create policy plan_feature_catalogue_read on public.plan_feature_catalogue
  for select to authenticated using (true);
drop policy if exists plan_features_read on public.plan_features;
create policy plan_features_read on public.plan_features
  for select to authenticated using (true);

-- BOTH roles. Supabase's default privileges grant all on a new table in
-- public to anon AND authenticated, and revoking from anon alone leaves
-- the other holding insert, update and delete. RLS would make the write
-- touch no rows and report no error, which is what makes it hard to see.
revoke all    on public.plan_feature_catalogue from anon, authenticated;
revoke all    on public.plan_features          from anon, authenticated;
grant  select on public.plan_feature_catalogue to authenticated;
grant  select on public.plan_features          to authenticated;

-- ---------------------------------------------------------------------
-- 2. Which storage key belongs to which feature.
-- ---------------------------------------------------------------------
create table if not exists public.plan_state_keys (
  state_key text primary key,
  feature   text not null references public.plan_feature_catalogue(feature) on delete cascade
);

insert into public.plan_state_keys (state_key, feature) values
  ('layi_dash_supplies',   'inventory'),
  ('layi_dash_bills',      'suppliers'),
  ('layi_dash_pots',       'funds'),
  ('layi_dash_attendance', 'team'),
  ('layi_dash_leave',      'team'),
  ('layi_dash_shifts',     'team'),
  ('layi_dash_campaigns',  'marketing'),
  ('layi_dash_log',        'companylog'),
  ('layi_dash_anns',       'companylog')
on conflict (state_key) do update set feature = excluded.feature;

alter table public.plan_state_keys enable row level security;
alter table public.plan_state_keys force  row level security;
revoke all on public.plan_state_keys from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Does this business have this feature?
-- ---------------------------------------------------------------------
create or replace function app.plan_allows(p_business uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.businesses b
    join public.plan_features f on f.plan = b.plan
    where b.id = p_business and f.feature = p_feature
  );
$$;

-- The message a studio sees has to name the feature and the way out of
-- it, or the app shows a shrug. This builds one sentence so the wording
-- cannot drift between the four triggers below.
create or replace function app.feature_refusal(p_feature text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select label from public.plan_feature_catalogue where feature = p_feature),
    p_feature) || ' is a Pro feature. Upgrade to unlock it.';
$$;

-- ---------------------------------------------------------------------
-- 4. app_state: the gate that covers six of the ten.
-- ---------------------------------------------------------------------
create or replace function app.enforce_state_feature()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_feature text;
begin
  select feature into v_feature
  from public.plan_state_keys where state_key = new.key;

  if v_feature is null then
    return new;                       -- not a gated key
  end if;
  if app.plan_allows(new.business_id, v_feature) then
    return new;
  end if;

  raise exception '%', app.feature_refusal(v_feature)
    using errcode = 'check_violation',
          hint = 'This studio is on a plan that does not include it.';
end;
$$;

drop trigger if exists app_state_plan_feature on public.app_state;
create trigger app_state_plan_feature
  before insert or update on public.app_state
  for each row execute function app.enforce_state_feature();

-- ---------------------------------------------------------------------
-- 5. The two tenant tables that belong to a feature.
-- ---------------------------------------------------------------------
create or replace function app.enforce_table_feature()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_feature text := tg_argv[0];
begin
  if app.plan_allows(new.business_id, v_feature) then
    return new;
  end if;
  raise exception '%', app.feature_refusal(v_feature)
    using errcode = 'check_violation',
          hint = 'This studio is on a plan that does not include it.';
end;
$$;

drop trigger if exists suppliers_plan_feature on public.suppliers;
create trigger suppliers_plan_feature
  before insert or update on public.suppliers
  for each row execute function app.enforce_table_feature('suppliers');

drop trigger if exists attendance_plan_feature on public.attendance;
create trigger attendance_plan_feature
  before insert or update on public.attendance
  for each row execute function app.enforce_table_feature('team');

-- ---------------------------------------------------------------------
-- 6. Payroll, which is a column rather than a table.
--
-- staff.basic is the pay rate every payroll figure is computed from. A
-- studio without payroll may still keep its people, their names, their
-- job titles and their branch; what it may not do is record what they
-- are paid. Zero is allowed so a Basic studio can add staff normally.
-- ---------------------------------------------------------------------
create or replace function app.enforce_payroll_feature()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.basic, 0) = 0 then
    return new;
  end if;
  if app.plan_allows(new.business_id, 'payroll') then
    return new;
  end if;
  raise exception '%', app.feature_refusal('payroll')
    using errcode = 'check_violation',
          hint = 'A studio without payroll can keep its people, but not what they are paid.';
end;
$$;

drop trigger if exists staff_plan_feature on public.staff;
create trigger staff_plan_feature
  before insert or update of basic on public.staff
  for each row execute function app.enforce_payroll_feature();

-- ---------------------------------------------------------------------
-- 7. What the app is allowed to do, read from the database.
--
-- The app has a PLAN_FEATURES constant of its own, and it has to, because
-- it runs offline. This is what makes that constant a mirror rather than
-- the source: the app asks, and anything it believes that disagrees with
-- this is wrong. A client that grants itself a feature still cannot write
-- anything, because section 4 does not consult the client.
-- ---------------------------------------------------------------------
create or replace function public.my_plan_features()
returns table (business_id uuid, plan text, feature text, label text, blurb text, allowed boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.plan, c.feature, c.label, c.blurb,
         exists (select 1 from public.plan_features f
                  where f.plan = b.plan and f.feature = c.feature)
  from public.businesses b
  cross join public.plan_feature_catalogue c
  where app.in_scope(b.id, null)
  order by c.feature;
$$;

revoke all     on function public.my_plan_features() from public, anon;
grant  execute on function public.my_plan_features() to authenticated;

revoke execute on function app.plan_allows(uuid, text)      from public, anon, authenticated;
revoke execute on function app.feature_refusal(text)        from public, anon, authenticated;
revoke execute on function app.enforce_state_feature()      from public, anon, authenticated;
revoke execute on function app.enforce_table_feature()      from public, anon, authenticated;
revoke execute on function app.enforce_payroll_feature()    from public, anon, authenticated;
grant  execute on function app.plan_allows(uuid, text)      to service_role;
