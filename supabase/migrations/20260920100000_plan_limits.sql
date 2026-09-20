-- =====================================================================
-- Plan limits, enforced by the database rather than asked for politely.
--
-- Kayode's specification, 20 September 2026:
--
--     Basic    1 studio,  5 team logins
--     Pro      5 studios, 50 team logins
--     Bespoke  as many of each as the contract says
--     Trial    1 studio,  3 team logins
--
--   "These limits must be enforced server-side (a Basic account cannot
--    create a 2nd studio or a 6th login; a Pro account cannot exceed 5
--    studios or 50 logins), not just displayed."
--
-- WHY THIS IS NEW RATHER THAN A CHANGE
--
-- There was no server-side plan limit at all. The app has had PLANS with
-- studios and seats since the beginning, and the comment above it says
-- plainly that it is "a nudge, not a control" because it runs in the
-- customer's own browser. That was the right thing to write down and the
-- wrong thing to leave standing, because the console was billing for a
-- ceiling nothing held anyone to.
--
-- THE FOUR RULES THAT DECIDE THE SHAPE OF THIS
--
-- 1. Being over a limit never takes anything away. A studio that drops
--    from Pro to Basic keeps its five studios, all its staff and all its
--    data. It simply cannot add another. That is why every check below
--    is on INSERT, and why the membership trigger deliberately lets an
--    existing member be edited, suspended and reinstated. Refusing to
--    let somebody FIX a record because they are over a limit would be
--    punishing them for having grown before they downgraded.
--
-- 2. The limits are data, not numbers buried in a function, so moving
--    one is an update rather than a migration, and so the console and
--    the portal can show the same table they are held to.
--
-- 3. A Bespoke business has no list limit, because it has no list price.
--    businesses.max_branches and businesses.max_seats carry whatever was
--    agreed. They are NULL by default, which means "follow the plan",
--    and they are deliberately not writable by the tenant: the column
--    grant added in 20260905130000 names exactly four columns, so these
--    two are locked by having been left out of it rather than by
--    anything new here. plan_limits_harness asserts that.
--
-- 4. The error a caller gets has to say what the limit IS and what they
--    have. "new row violates check constraint" tells a studio owner
--    nothing and tells whoever they call nothing either.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. What each plan includes.
--
-- NULL means "not capped here": for premium because the contract says,
-- and never for the three that have a list price. The check constraint
-- on businesses.plan already fixes the set of plans, so a row here for
-- a plan that does not exist is impossible and a plan with no row would
-- be caught by the assertion below.
-- ---------------------------------------------------------------------
create table if not exists public.plan_limits (
  plan        text primary key
                check (plan in ('trial', 'starter', 'pro', 'premium')),
  max_studios int check (max_studios is null or max_studios > 0),
  max_seats   int check (max_seats   is null or max_seats   > 0),
  label       text not null
);

insert into public.plan_limits (plan, max_studios, max_seats, label) values
  ('trial',   1,    3,    'Trial'),
  ('starter', 1,    5,    'Basic'),
  ('pro',     5,    50,   'Pro'),
  ('premium', null, null, 'Bespoke')
on conflict (plan) do update
  set max_studios = excluded.max_studios,
      max_seats   = excluded.max_seats,
      label       = excluded.label;

-- Every plan the businesses table will accept has to have a row, or a
-- studio on that plan would be silently uncapped. Worth failing the
-- migration over: an uncapped plan is invisible until the bill is wrong.
do $$
declare v_missing text;
begin
  select string_agg(p, ', ') into v_missing
  from unnest(array['trial', 'starter', 'pro', 'premium']) p
  where not exists (select 1 from public.plan_limits l where l.plan = p);
  if v_missing is not null then
    raise exception 'plan_limits has no row for: %, so a studio on it would be uncapped', v_missing;
  end if;
end $$;

alter table public.plan_limits enable row level security;
alter table public.plan_limits force  row level security;

-- Readable by anyone signed in, because both the app and the console
-- show a studio what its plan includes. Writable by nobody: no insert,
-- update or delete policy exists, and with RLS forced that includes the
-- table owner.
drop policy if exists plan_limits_read on public.plan_limits;
create policy plan_limits_read on public.plan_limits
  for select to authenticated using (true);

-- BOTH roles, not just anon. Supabase's default privileges grant all on a
-- new table in public to anon AND authenticated, and `revoke ... from anon`
-- leaves the other one holding insert, update and delete. RLS would stop
-- the write silently reaching any row, which is the part that makes this
-- hard to notice: the statement succeeds, updates nothing, and reports no
-- error. plan_limits_harness asks for the privilege rather than trying the
-- write, for exactly that reason.
revoke all    on public.plan_limits from anon, authenticated;
grant  select on public.plan_limits to authenticated;

-- ---------------------------------------------------------------------
-- 2. What ONE business is allowed, which may not be what its plan says.
--
-- Bespoke is agreed per business, so the agreement has to live on the
-- business. These are also the escape hatch for the ordinary plans: a
-- studio we have promised a sixth login to gets a number here rather
-- than a special plan nobody can find later.
-- ---------------------------------------------------------------------
alter table public.businesses
  add column if not exists max_branches int,
  add column if not exists max_seats    int;

alter table public.businesses
  drop constraint if exists businesses_max_branches_positive;
alter table public.businesses
  add constraint businesses_max_branches_positive
  check (max_branches is null or max_branches > 0);

alter table public.businesses
  drop constraint if exists businesses_max_seats_positive;
alter table public.businesses
  add constraint businesses_max_seats_positive
  check (max_seats is null or max_seats > 0);

comment on column public.businesses.max_branches is
  'Agreed studio ceiling for this business. NULL means follow plan_limits. Not writable by the tenant.';
comment on column public.businesses.max_seats is
  'Agreed login ceiling for this business. NULL means follow plan_limits. Not writable by the tenant.';

-- The column grant from 20260905130000 names the four columns a studio
-- may write. Re-stating it here rather than trusting that nobody has
-- since run a blanket `grant update on public.businesses`, which is the
-- mistake that migration exists because of.
revoke update on public.businesses from authenticated, anon;
grant  update (name, contact_email, last_seen_at, app_version)
  on public.businesses to authenticated;

-- ---------------------------------------------------------------------
-- 3. The effective limits, in one place, so nothing works them out twice.
-- ---------------------------------------------------------------------
create or replace function app.limits_for(p_business uuid)
returns table (max_studios int, max_seats int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(b.max_branches, l.max_studios),
         coalesce(b.max_seats,    l.max_seats)
  from public.businesses b
  join public.plan_limits l on l.plan = b.plan
  where b.id = p_business;
$$;

-- What a business is USING, next to what it is allowed. The console draws
-- its usage bars from this and the app draws its plan panel from the
-- browser-facing wrapper below, so there is one definition of "a seat".
--
-- A seat is a membership that is active or invited. An invitation counts
-- because the login exists the moment it is sent: not counting it would
-- let a business invite its way past the ceiling and only discover the
-- problem when people started accepting.
create or replace function app.usage_for(p_business uuid)
returns table (studios int, seats int, max_studios int, max_seats int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select count(*)::int from public.branches br where br.business_id = p_business),
         (select count(*)::int from public.memberships m
           where m.business_id = p_business and m.status in ('active', 'invited')),
         l.max_studios,
         l.max_seats
  from app.limits_for(p_business) l;
$$;

-- The browser-facing half. app.in_scope is the same filter every tenant
-- policy uses, so a studio can only ever ask about itself, and asking is
-- all it can do: nothing here writes.
create or replace function public.my_plan_usage()
returns table (business_id uuid, plan text, studios int, seats int,
               max_studios int, max_seats int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.plan, u.studios, u.seats, u.max_studios, u.max_seats
  from public.businesses b
  cross join lateral app.usage_for(b.id) u
  where app.in_scope(b.id, null);
$$;

revoke all    on function public.my_plan_usage() from public, anon;
grant  execute on function public.my_plan_usage() to authenticated;

-- The console asks about somebody else's business, so it is service_role
-- only. Supabase grants execute on every new function in public to anon
-- and authenticated by default and granting to somebody else does not
-- take that away, so each one is named. These two are in app rather than
-- public, which is not reachable over PostgREST at all, but naming them
-- costs nothing and the next one might not be.
revoke execute on function app.limits_for(uuid) from public, anon, authenticated;
revoke execute on function app.usage_for(uuid)  from public, anon, authenticated;
grant  execute on function app.limits_for(uuid) to service_role;
grant  execute on function app.usage_for(uuid)  to service_role;

-- ---------------------------------------------------------------------
-- 4. A studio cannot add a studio it is not entitled to.
--
-- On INSERT only. See rule 1 at the top: renaming or moving an outlet a
-- business is already trading from must keep working whatever the plan
-- says, because the alternative is telling somebody they may not correct
-- a spelling mistake until they upgrade.
-- ---------------------------------------------------------------------
create or replace function app.enforce_branch_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max int;
  v_now int;
  v_plan text;
begin
  select max_studios into v_max from app.limits_for(new.business_id);
  if v_max is null then
    return new;                       -- Bespoke, or an agreed ceiling of none
  end if;

  select count(*) into v_now from public.branches where business_id = new.business_id;
  if v_now < v_max then
    return new;
  end if;

  select plan into v_plan from public.businesses where id = new.business_id;
  raise exception
    'plan limit reached: % allows % studio(s) and this business already has %',
    coalesce(v_plan, 'this plan'), v_max, v_now
    using errcode = 'check_violation',
          hint = 'Move the business to a larger plan, or agree a higher ceiling on the business itself.';
end;
$$;

drop trigger if exists branches_plan_limit on public.branches;
create trigger branches_plan_limit
  before insert on public.branches
  for each row execute function app.enforce_branch_limit();

-- ---------------------------------------------------------------------
-- 5. And cannot add a login it is not entitled to.
--
-- This one also fires on UPDATE, for one case only: a membership coming
-- BACK from suspended. Reinstating somebody is the same act as adding
-- them as far as the ceiling is concerned, and without it a business at
-- its limit could suspend one person, invite another, and reinstate the
-- first.
--
-- Everything else about an existing member is left alone, including
-- changing their role, their branch and suspending them. audit_tiers
-- has a check with the same name as the reason: "editing an existing
-- team account is never blocked by the seat limit, which punishes a
-- studio for being over rather than for adding".
-- ---------------------------------------------------------------------
create or replace function app.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max int;
  v_now int;
  v_plan text;
begin
  -- a row that does not occupy a seat never needs checking
  if new.status not in ('active', 'invited') then
    return new;
  end if;
  -- nor does one that already occupied one
  if tg_op = 'UPDATE' and old.status in ('active', 'invited') then
    return new;
  end if;

  select max_seats into v_max from app.limits_for(new.business_id);
  if v_max is null then
    return new;
  end if;

  select count(*) into v_now
  from public.memberships
  where business_id = new.business_id
    and status in ('active', 'invited')
    and id is distinct from new.id;

  if v_now < v_max then
    return new;
  end if;

  select plan into v_plan from public.businesses where id = new.business_id;
  raise exception
    'plan limit reached: % allows % team login(s) and this business already has %',
    coalesce(v_plan, 'this plan'), v_max, v_now
    using errcode = 'check_violation',
          hint = 'Move the business to a larger plan, agree a higher ceiling on the business itself, or suspend a login that is no longer used.';
end;
$$;

drop trigger if exists memberships_plan_limit on public.memberships;
create trigger memberships_plan_limit
  before insert or update on public.memberships
  for each row execute function app.enforce_seat_limit();

-- Trigger functions are never called directly. Revoking anyway, because
-- the sweep in storage_rls_harness reads grants rather than intentions
-- and a security definer function nobody meant to expose is exactly the
-- thing it is looking for.
revoke execute on function app.enforce_branch_limit() from public, anon, authenticated;
revoke execute on function app.enforce_seat_limit()   from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. The operator's way to agree a different ceiling.
--
-- Service role only, and it writes the columns the tenant cannot. NULL
-- puts a business back onto its plan's limits, which is the thing an
-- operator will want after a Bespoke contract ends and is the reason
-- this takes two nullable arguments rather than two required ones.
-- ---------------------------------------------------------------------
create or replace function app.set_studio_limits(
  p_business uuid, p_max_studios int, p_max_seats int)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.businesses where id = p_business) then
    raise exception 'no such business: %', p_business;
  end if;
  if p_max_studios is not null and p_max_studios < 1 then
    raise exception 'a studio ceiling of % makes no sense', p_max_studios;
  end if;
  if p_max_seats is not null and p_max_seats < 1 then
    raise exception 'a login ceiling of % makes no sense', p_max_seats;
  end if;

  update public.businesses
     set max_branches = p_max_studios,
         max_seats    = p_max_seats
   where id = p_business;
end;
$$;

create or replace function public.set_studio_limits(
  p_business uuid, p_max_studios int, p_max_seats int)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$ select app.set_studio_limits(p_business, p_max_studios, p_max_seats); $$;

revoke execute on function app.set_studio_limits(uuid, int, int)    from public, anon, authenticated;
revoke execute on function public.set_studio_limits(uuid, int, int) from public, anon, authenticated;
grant  execute on function app.set_studio_limits(uuid, int, int)    to service_role;
grant  execute on function public.set_studio_limits(uuid, int, int) to service_role;
