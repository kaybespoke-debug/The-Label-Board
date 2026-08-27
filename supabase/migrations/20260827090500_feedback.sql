-- =====================================================================
-- The Label Board — feedback from studios to us
--
-- The operator console has queues for suggestions, feature requests,
-- complaints and support, and until now nothing could put anything in
-- them. A studio owner who hit a problem had no way to tell us inside
-- the product. This is the missing channel.
--
-- One table, because a suggestion and a support ticket differ only in
-- what we do about them, not in what they are: a studio wrote to us.
-- Splitting them would mean two of everything, and a complaint that
-- turns out to be a feature request would have to move house.
--
-- The isolation rules here are deliberately NOT the ones the tenant
-- tables use, and the differences are the whole point:
--
--   insert   a studio may write, scoped to itself. Same as anywhere.
--   select   a studio may read back only what it sent, so it can see
--            that we replied. It cannot read another studio's.
--   update   nobody. Once sent, a message is a record of what was said.
--            A studio changing "the app deleted my orders" into "all
--            good, thanks" after we acted on it helps no one.
--   delete   nobody, for the same reason.
--
-- Our own staff get no policy at all, exactly as the tenant tables do
-- it. The console reads this through supabase/functions/admin-api with
-- the service role, so cross-tenant reads happen in one audited place
-- and an XSS in the console cannot drain the table from a browser.
--
-- Replies live in their own table so a thread can grow without
-- rewriting the message that started it.
--
-- Verified by supabase/tests/feedback_rls_harness.mjs.
-- =====================================================================

-- Human-readable references. A studio quoting "TLB-2417" on the phone is
-- far easier than a uuid, and a sequence guarantees no two collide.
create sequence if not exists public.feedback_ref_seq start 2000;

create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,

  ref           text not null unique default ('TLB-' || nextval('public.feedback_ref_seq')),

  -- what kind of message this is. The console files it from here.
  --   suggestion  a small idea
  --   feature     something they want built
  --   complaint   something made them unhappy
  --   support     something is broken or they are stuck
  --   review      unprompted praise, which we may ask to quote
  kind          text not null check (kind in ('suggestion','feature','complaint','support','review')),

  title         text not null check (length(btrim(title)) between 1 and 160),
  body          text not null check (length(btrim(body)) between 1 and 4000),

  -- only meaningful on a review, and only ever 1 to 5
  rating        int  check (rating is null or rating between 1 and 5),

  -- how urgent the studio said it was. Our own triage lives on state.
  urgency       text not null default 'normal' check (urgency in ('normal','blocking')),

  -- where we reply. Optional: a studio may prefer we just read it.
  contact_name  text,
  contact_email text,

  -- what they were looking at, so support does not have to ask.
  context_page  text,
  app_version   text,

  -- our side of it
  state         text not null default 'new'
                check (state in ('new','open','in-progress','planned','resolved','declined')),

  created_at    timestamptz not null default now(),
  -- the signed-in user who sent it. Stored, not foreign-keyed: the rest of
  -- the schema treats auth user ids the same way, and a deleted account must
  -- not take a support ticket with it.
  created_by    uuid
);

create index if not exists idx_feedback_business on public.feedback (business_id);
create index if not exists idx_feedback_state    on public.feedback (state);
create index if not exists idx_feedback_kind     on public.feedback (kind);
create index if not exists idx_feedback_created  on public.feedback (created_at desc);

create table if not exists public.feedback_replies (
  id           uuid primary key default gen_random_uuid(),
  feedback_id  uuid not null references public.feedback(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  -- 'us' is a Label Board reply, 'them' is the studio adding to their own thread
  side         text not null check (side in ('us','them')),
  author       text,
  body         text not null check (length(btrim(body)) between 1 and 4000),
  at           timestamptz not null default now()
);

create index if not exists idx_feedback_replies_parent on public.feedback_replies (feedback_id, at);
create index if not exists idx_feedback_replies_biz    on public.feedback_replies (business_id);

-- =====================================================================
-- POLICIES
-- =====================================================================

alter table public.feedback         enable row level security;
alter table public.feedback         force  row level security;
alter table public.feedback_replies enable row level security;
alter table public.feedback_replies force  row level security;

drop policy if exists feedback_select on public.feedback;
drop policy if exists feedback_insert on public.feedback;

-- Read back only your own studio's messages.
create policy feedback_select on public.feedback
  for select to authenticated
  using (app.in_scope(business_id, null));

-- Write only as your own studio. WITH CHECK is what stops a client
-- stamping someone else's business_id onto a complaint.
create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (app.in_scope(business_id, null));

-- No update policy and no delete policy. With RLS forced, the absence of
-- a policy is a refusal, so this is not an oversight to be tidied up
-- later: it is the rule.

drop policy if exists feedback_replies_select on public.feedback_replies;
drop policy if exists feedback_replies_insert on public.feedback_replies;

create policy feedback_replies_select on public.feedback_replies
  for select to authenticated
  using (app.in_scope(business_id, null));

-- A studio may add to its own thread, but only ever as 'them'. A tenant
-- that could insert side='us' could forge a reply from support.
create policy feedback_replies_insert on public.feedback_replies
  for insert to authenticated
  with check (app.in_scope(business_id, null) and side = 'them');

revoke all on public.feedback         from anon;
revoke all on public.feedback_replies from anon;
grant select, insert on public.feedback         to authenticated;
grant select, insert on public.feedback_replies to authenticated;
grant usage on sequence public.feedback_ref_seq to authenticated;

-- =====================================================================
-- WHAT THE CONSOLE READS
--
-- A view rather than a join written out in the Edge Function, so the
-- shape the console depends on is defined once, here, next to the
-- tables it reads. security_invoker keeps RLS in force for anyone
-- calling it as themselves; the console reaches it as service_role,
-- which is the audited path.
-- =====================================================================

create or replace view public.feedback_inbox
with (security_invoker = true)
as
select
  f.id, f.ref, f.kind, f.title, f.body, f.rating, f.urgency,
  f.contact_name, f.contact_email, f.context_page, f.app_version,
  f.state, f.created_at, f.business_id,
  b.name  as business_name,
  b.plan  as business_plan,
  (select count(*) from public.feedback_replies r where r.feedback_id = f.id) as reply_count,
  (select max(r.at) from public.feedback_replies r where r.feedback_id = f.id) as last_reply_at
from public.feedback f
join public.businesses b on b.id = f.business_id;

revoke all on public.feedback_inbox from anon;
grant select on public.feedback_inbox to authenticated, service_role;
