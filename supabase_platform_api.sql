-- ============================================================================
-- The Label Board — platform read API
--
-- Run AFTER supabase_platform.sql, in the same SQL Editor.
--
-- One function that returns a summary row per studio. It deliberately returns
-- COUNTS ONLY, never the studio's actual records: no client names, no figures,
-- no measurements. That is the "metadata by default" rule expressed in SQL
-- rather than trusted to the console to honour.
--
-- SECURITY DEFINER lets it read across tenants, so EXECUTE is revoked from
-- everyone except the service role. Only an Edge Function can call it, and that
-- function checks the caller is platform staff first.
-- ============================================================================

create or replace function public.platform_tenant_summary()
returns table (
  id            uuid,
  name          text,
  contact_email text,
  country       text,
  plan          text,
  status        text,
  trial_ends_at timestamptz,
  created_at    timestamptz,
  last_seen_at  timestamptz,
  app_version   text,
  users         bigint,
  customers     bigint,
  suppliers     bigint,
  orders        bigint,
  txns          bigint,
  staff         bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.name, b.contact_email, b.country, b.plan, b.status,
    b.trial_ends_at, b.created_at, b.last_seen_at, b.app_version,
    (select count(*) from public.profiles  p where p.business_id = b.id),
    (select count(*) from public.customers c where c.business_id = b.id),
    (select count(*) from public.suppliers s where s.business_id = b.id),
    coalesce((select jsonb_array_length(a.data) from public.app_state a
               where a.business_id = b.id and a.key = 'layi_dash_orders'
                 and jsonb_typeof(a.data) = 'array'), 0),
    coalesce((select jsonb_array_length(a.data) from public.app_state a
               where a.business_id = b.id and a.key = 'layi_dash_txns'
                 and jsonb_typeof(a.data) = 'array'), 0),
    coalesce((select jsonb_array_length(a.data) from public.app_state a
               where a.business_id = b.id and a.key = 'layi_dash_staff'
                 and jsonb_typeof(a.data) = 'array'), 0)
  from public.businesses b
  order by b.last_seen_at desc nulls last, b.created_at desc;
$$;

-- nobody reaches this from a browser, ever
revoke all on function public.platform_tenant_summary() from public, anon, authenticated;
grant execute on function public.platform_tenant_summary() to service_role;

-- ---------------------------------------------------------------------------
-- Audit: every time a staff member looks at something, we record it. This is
-- what makes "metadata by default, full access on request" enforceable rather
-- than a promise, and it is what you show a client who asks who saw their data.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_audit (
  id          bigserial primary key,
  admin_id    uuid references auth.users(id) on delete set null,
  admin_email text,
  action      text not null,
  business_id uuid,
  detail      jsonb,
  at          timestamptz not null default now()
);
create index if not exists platform_audit_at_idx  on public.platform_audit(at desc);
create index if not exists platform_audit_biz_idx on public.platform_audit(business_id, at desc);

alter table public.platform_audit enable row level security;
-- RLS on with no policy: closed to every client. Service role writes it.
revoke all on public.platform_audit from anon, authenticated;
revoke all on sequence public.platform_audit_id_seq from anon, authenticated;
-- ============================================================================
