-- Website enquiries, where the operator console can see them.
--
-- The four forms on the public site — book a demo, contact, partner
-- application, referral — post to Netlify Forms and land in Netlify's
-- dashboard. Nothing touches this database, so the console cannot see a
-- single enquiry: the one screen whose job is "how is the business doing"
-- is blind to everybody trying to become a customer.
--
-- The Netlify path is deliberately NOT removed. It works without JavaScript,
-- it carries Netlify's spam filtering, and a form that quietly stopped
-- reaching anybody would be the worst possible failure here. The site now
-- posts to BOTH: Netlify as it always did, and this, so the console has a
-- copy it can work from.

create table if not exists public.enquiries (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  kind         text not null check (kind in ('demo','contact','partner','referral')),
  name         text,
  email        text,
  phone        text,
  business     text,
  message      text,
  source_page  text,
  -- everything the form carried that does not have a column of its own, so a
  -- new field on a form is never silently dropped on the floor
  extra        jsonb not null default '{}'::jsonb,
  -- how we are dealing with it
  state        text not null default 'new'
               check (state in ('new','open','replied','converted','spam','closed')),
  handled_by   text,
  handled_at   timestamptz,
  notes        text
);

create index if not exists enquiries_at_idx    on public.enquiries (at desc);
create index if not exists enquiries_state_idx on public.enquiries (state);
create index if not exists enquiries_kind_idx  on public.enquiries (kind);

-- ---------------------------------------------------------------------------
-- Nobody reads this but us
-- ---------------------------------------------------------------------------
-- RLS with no policies at all: the service role bypasses it, everyone else
-- gets nothing. The console reaches this through admin-api like every other
-- cross-tenant read, and the grants are revoked as well as the policies
-- withheld, because Supabase grants tables in `public` to anon and
-- authenticated by default and a policy-less table with a grant still
-- answers "0 rows" rather than "denied" — which is fine until somebody adds
-- a permissive policy for an unrelated reason.
alter table public.enquiries enable row level security;
alter table public.enquiries force row level security;
revoke all on public.enquiries from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The one door in
-- ---------------------------------------------------------------------------
-- This function is DELIBERATELY callable by anon. It is the only one in this
-- schema that is, and the harness asserts both halves of that: that this one
-- is reachable, and that no other operator function is.
--
-- Because it is public it does its own doorkeeping. A SECURITY DEFINER
-- function that anyone on the internet may call is a hole unless it is
-- narrower than the table behind it: this one cannot read, cannot update,
-- cannot choose a state, and returns nothing an attacker can learn from.
create or replace function public.submit_enquiry(
  p_kind        text,
  p_name        text default null,
  p_email       text default null,
  p_phone       text default null,
  p_business    text default null,
  p_message     text default null,
  p_source_page text default null,
  p_extra       jsonb default '{}'::jsonb,
  p_trap        text default null      -- honeypot: filled in means a bot
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent int;
begin
  -- 1. the honeypot. Answer TRUE so a bot learns nothing from being refused,
  --    and write nothing.
  if p_trap is not null and length(btrim(p_trap)) > 0 then
    return true;
  end if;

  -- 2. a kind we actually have a form for
  if p_kind is null or p_kind not in ('demo','contact','partner','referral') then
    return false;
  end if;

  -- 3. something to act on. An enquiry with no way to reply is not an
  --    enquiry, it is a row.
  if coalesce(btrim(p_email),'') = '' and coalesce(btrim(p_phone),'') = '' then
    return false;
  end if;

  -- 4. throttle. Not a defence against a determined flood — that is what the
  --    edge is for — but enough that one broken script or one bored person
  --    cannot fill the table. Same email, or same kind from anywhere, in the
  --    last five minutes.
  select count(*) into v_recent
  from public.enquiries
  where at > now() - interval '5 minutes'
    and (
      (p_email is not null and lower(email) = lower(btrim(p_email)))
      or kind = p_kind
    );
  if v_recent >= 20 then
    return false;
  end if;

  insert into public.enquiries
    (kind, name, email, phone, business, message, source_page, extra)
  values (
    p_kind,
    left(btrim(p_name), 160),
    left(lower(btrim(p_email)), 200),
    left(btrim(p_phone), 60),
    left(btrim(p_business), 200),
    left(btrim(p_message), 4000),
    left(btrim(p_source_page), 200),
    coalesce(p_extra, '{}'::jsonb)
  );
  return true;
exception when others then
  -- Never surface a database error to an anonymous caller, and never let a
  -- failure here break the form: Netlify has the submission regardless.
  return false;
end
$$;

-- Revoked from all three FIRST, then granted back deliberately. Without the
-- revoke from anon and authenticated this function would be reachable only
-- because Supabase's default privileges happen to grant it — the grant below
-- would be decorative, and the day that default changed the website's only
-- way in would close silently, with every form still appearing to work.
-- Written this way the grant is the thing that opens the door, so a test that
-- removes it actually sees the door shut.
revoke all on function public.submit_enquiry(text,text,text,text,text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_enquiry(text,text,text,text,text,text,text,jsonb,text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the console reads
-- ---------------------------------------------------------------------------
create or replace function public.platform_enquiries(p_state text default null)
returns setof public.enquiries
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.enquiries
  where p_state is null or state = p_state
  order by at desc
  limit 500
$$;

create or replace function public.set_enquiry_state(
  p_id uuid, p_state text, p_by text default null, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_state not in ('new','open','replied','converted','spam','closed') then
    raise exception 'Unknown state: %', p_state;
  end if;
  update public.enquiries
     set state = p_state,
         handled_by = coalesce(p_by, handled_by),
         handled_at = now(),
         notes = coalesce(p_notes, notes)
   where id = p_id;
  if not found then
    raise exception 'No such enquiry';
  end if;
end
$$;

-- Operator-only, and it takes BOTH revokes. This is the second time the two
-- halves have been got right separately, so they are written together with
-- the reason:
--
--   from public              Postgres grants EXECUTE to PUBLIC on every new
--                            function, and anon inherits from PUBLIC. Revoking
--                            only from anon leaves `=X/postgres` in the ACL and
--                            the function wide open.
--   from anon, authenticated Supabase ALSO grants them explicitly via default
--                            privileges, which revoking from PUBLIC does not
--                            touch.
--
-- Written the first way, the last set of functions were callable by the anon
-- key. Written the second way, these two were. The harness asserts the
-- privilege itself rather than either revoke.
revoke execute on function public.platform_enquiries(text) from public, anon, authenticated;
revoke execute on function public.set_enquiry_state(uuid,text,text,text) from public, anon, authenticated;
grant  execute on function public.platform_enquiries(text) to service_role;
grant  execute on function public.set_enquiry_state(uuid,text,text,text) to service_role;
