-- =====================================================================
-- Who is this account, and which of the four apps is it for?
--
-- Kayode, 20 September 2026, looking at Authentication -> Users:
--
--   "thelabelboard is one project but the customer app, the console, the
--    partner portal will also have users on supabase, theres currently no
--    way to make that distinction."
--
-- He is right. One project means one auth.users, and that list shows an
-- email and a uuid and nothing else. A studio owner, one of our operators
-- and a referral partner sit next to each other and look identical. The
-- distinction DOES exist, but only by opening three different tables and
-- matching ids by hand.
--
-- So this is a view that answers the question in one place. It is not a
-- new source of truth: every column below is read from the table that
-- already decides it, which is why nothing here can drift.
--
--   operator      a row in platform_admins with the same id
--   partner       a row in partners with user_id
--   studio        a row in memberships with user_id
--
-- A person can be more than one. A studio owner who refers another
-- business becomes a partner and keeps their studio, which is the whole
-- point of the "Make a partner" button on the console. So these are
-- flags, not a single "type" column: the moment it is one column,
-- somebody has to decide which of two true things to show.
--
-- WHY IT IS A VIEW AND NOT A COLUMN ON auth.users
--
-- Writing a "kind" into user metadata would be a fourth copy of something
-- three tables already know, and it would be the copy nobody updates when
-- a partner is deleted. Reading it costs nothing and it cannot be stale.
--
-- WHO CAN READ IT
--
-- Us, and nothing else. It exposes every email on the platform and when
-- each account last signed in. A view over auth.users runs with its
-- owner's rights unless told otherwise, so a grant to anon here would
-- hand out the whole user table. Every grant is revoked explicitly below,
-- because Supabase grants select on a new view in public to anon and
-- authenticated by default and revoking from public does not undo it.
-- =====================================================================
-- security_invoker, which rls_harness insists on for every view in this schema
-- and was right to. A view without it runs with its OWNER's rights, so the
-- grants below would be the only thing standing between a caller and every
-- email on the platform. With it, the view can only ever show what the caller
-- could already have read, and the grant is a second lock rather than the
-- only one.
create or replace view public.account_directory
with (security_invoker = true) as
select
  u.id,
  u.email,
  u.created_at,
  u.last_sign_in_at,
  u.email_confirmed_at is not null as confirmed,
  u.banned_until is not null and u.banned_until > now() as banned,

  -- our own staff, in the console
  exists (select 1 from public.platform_admins a where a.id = u.id and a.active) as is_operator,
  (select a.role from public.platform_admins a where a.id = u.id) as operator_role,

  -- a referral partner, in the portal
  exists (select 1 from public.partners p where p.user_id = u.id) as is_partner,
  (select p.code from public.partners p where p.user_id = u.id) as partner_code,

  -- somebody inside a studio, in the customer app
  exists (select 1 from public.memberships m where m.user_id = u.id and m.status = 'active') as is_studio_user,
  (select b.name from public.memberships m
     join public.businesses b on b.id = m.business_id
    where m.user_id = u.id and m.status = 'active'
    order by m.created_at limit 1) as studio,
  (select m.role from public.memberships m
    where m.user_id = u.id and m.status = 'active'
    order by m.created_at limit 1) as studio_role,

  -- the one line an operator actually reads
  case
    when not exists (select 1 from public.platform_admins a where a.id = u.id and a.active)
     and not exists (select 1 from public.partners p where p.user_id = u.id)
     and not exists (select 1 from public.memberships m where m.user_id = u.id and m.status = 'active')
      then 'unattached'
    else concat_ws(' + ',
      case when exists (select 1 from public.platform_admins a where a.id = u.id and a.active) then 'operator' end,
      case when exists (select 1 from public.partners p where p.user_id = u.id) then 'partner' end,
      case when exists (select 1 from public.memberships m where m.user_id = u.id and m.status = 'active') then 'studio' end)
  end as belongs_to
from auth.users u;

comment on view public.account_directory is
  'Every auth account and which of the apps it belongs to. Read only, us only. '
  'An account can be more than one thing at once, so these are flags rather '
  'than a type. "unattached" means an account exists with nothing behind it, '
  'which is usually an invitation that was never completed.';

revoke all on public.account_directory from public, anon, authenticated;
grant select on public.account_directory to service_role;
