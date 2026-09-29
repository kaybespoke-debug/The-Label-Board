-- =====================================================================
-- Locking a studio out is a billing action, so it waits for billing
-- =====================================================================
-- The unpaid-write guard is right and it is going to production this week
-- with everything else. What must NOT go with it is the part that acts:
-- Flutterwave is not configured yet, so a studio told "writing starts again
-- when the subscription is paid" would have no way to pay. That sentence has
-- to be true when somebody reads it.
--
-- So the mechanism ships switched off, behind a flag with a name that says
-- what it is, and the release that switches card payment on switches this on
-- in the same breath. A flag rather than a later migration because turning it
-- off again at two in the morning should not need a deploy.
create table if not exists public.platform_flags (
  key        text primary key,
  on_off     boolean not null default false,
  note       text,
  changed_at timestamptz not null default now()
);

insert into public.platform_flags (key, on_off, note) values
  ('enforce_unpaid_readonly', false,
   'Refuse writes from a studio that is not active. OFF until Flutterwave is '
   'configured and has passed staging end to end, because a studio cannot be '
   'told to pay when there is no way to pay.')
on conflict (key) do nothing;

alter table public.platform_flags enable row level security;
alter table public.platform_flags force row level security;
grant select on public.platform_flags to authenticated;
drop policy if exists platform_flags_read on public.platform_flags;
create policy platform_flags_read on public.platform_flags
  for select to authenticated using (app.is_platform_admin());
-- No write policy. Changing one is a deliberate act by somebody holding the
-- service role, and it is recorded by changed_at.

create or replace function app.flag(p_key text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $fn$
  select coalesce((select f.on_off from public.platform_flags f where f.key = p_key), false)
$fn$;
revoke all on function app.flag(text) from public, anon;
grant execute on function app.flag(text) to authenticated, service_role;

-- The guard, with one line added. Everything else is the body from
-- 20260929190000_flutterwave_subscriptions.sql, unchanged.
create or replace function app.refuse_write_when_unpaid()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $fn$
declare v_biz uuid; v_status text;
begin
  /* OFF UNTIL THERE IS A WAY TO PAY. Checked first, so that while the flag is
     down this trigger costs one cached lookup and decides nothing. */
  if not app.flag('enforce_unpaid_readonly') then
    return coalesce(new, old);
  end if;

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

revoke all on function app.refuse_write_when_unpaid() from public, anon, authenticated;

comment on table public.platform_flags is
  'Switches for behaviour that must ship before it acts. Read with app.flag(). '
  'No write policy: changing one is a deliberate act by the service role.';
