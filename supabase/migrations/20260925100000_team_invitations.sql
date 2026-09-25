-- =====================================================================
-- team_invitations — a business owner asking somebody to join THEIR
-- studio, written by the server, before any account exists.
--
-- WHY THIS TABLE EXISTS. app.provision_studio() has three paths and all
-- three end in owning something: claim a partner, claim a business that
-- was waiting for you and become its owner, or invent a business and
-- become its owner. There is no path that attaches somebody to a
-- business that already exists. So `team-admin` wrote `profiles`
-- directly, and `profiles` is a table no RLS policy consults — which is
-- why a teammate would have held a profile and been able to read
-- nothing. Production agrees: zero non-owner profiles, zero non-owner
-- memberships. It has never worked.
--
-- THE TRUST BOUNDARY, which is the whole point of the table. A browser
-- can put anything in raw_user_meta_data. It cannot make us write a row
-- here. So business_id, role and branch_id are read from this row and
-- never from a request, exactly as businesses.pending_owner_email
-- already works for studio owners and partners.pending_email for
-- partners. This is the third instance of one established pattern, not
-- a new idea.
--
-- ADDITIVE AND INERT. Nothing reads this table yet. provision_studio is
-- deliberately NOT changed by this migration: whether the nonce below
-- can be seen by the trigger at INSERT time is an open question about
-- GoTrue that has to be answered against real Supabase Auth first
-- (AG2 in PHASE_1B_DESIGN.md). Applying this migration changes no
-- behaviour anywhere.
-- =====================================================================

create table if not exists public.team_invitations (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,

  /* Stored already normalised, and the constraint means a future writer
     cannot bypass the normalisation by accident. Matching is then plain
     equality, which uses the index. */
  email         text not null,
  constraint team_invitations_email_normalised
    check (email = lower(btrim(email)) and email <> '' and position('@' in email) > 1),

  /* Deliberately NOT 'owner'. An invitation never mints a second owner:
     transferring a studio is a different act with different consequences
     and it should not ride in on this. The four values match
     memberships.role so the mapping is identity, not translation. */
  role          text not null default 'staff'
                  check (role in ('manager','staff','viewer')),

  /* NULL means every branch, which is what app.in_scope already means by
     a null branch_id on a membership. The composite key is the same one
     six other tables use: a branch from another business cannot be
     stored here, it is not merely rejected by a check. */
  branch_id     uuid,
  constraint team_invitations_branch_in_business
    foreign key (branch_id, business_id)
    references public.branches(id, business_id) on delete restrict,

  invited_by    uuid not null,

  /* Three states, not four. "Expired" is expires_at < now(), computed,
     because a stored expiry needs a job to write it, there is no
     scheduler here, and between runs the stored value would be wrong. */
  status        text not null default 'pending'
                  check (status in ('pending','accepted','cancelled')),

  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  accepted_at   timestamptz,
  accepted_by   uuid,

  /* ONE-TIME PROVENANCE SIGNAL, and nothing else.
     Its only job is to let the trigger recognise the auth.users INSERT
     that our own invitation caused, so that a person who was invited but
     independently signs up to start their OWN studio is not silently
     abstained. It carries no authority: business, role and branch are
     read from the columns above.
     Only the hash is kept. The raw value is returned once, to the Edge
     Function that sends the invitation, and is never stored, logged,
     emailed or put in a URL. Cleared on use, so the signal is
     single-use in the row as well as by construction. */
  nonce_hash    text,
  constraint team_invitations_nonce_hash_shape
    check (nonce_hash is null or nonce_hash ~ '^[0-9a-f]{64}$'),
  nonce_issued_at timestamptz,

  /* an accepted invitation must say when and by whom */
  constraint team_invitations_accepted_is_stamped
    check (status <> 'accepted' or (accepted_at is not null and accepted_by is not null))
);

/* At most ONE live invitation per address per business. Partial, so that
   accepted and cancelled rows stay for the record and do not block a
   fresh invitation to somebody who was cancelled by mistake. */
create unique index if not exists team_invitations_one_live
  on public.team_invitations (business_id, email)
  where status = 'pending';

/* The lookup the trigger will make on every single signup, once AG2 has
   settled whether it can. Partial for the same reason. */
create index if not exists team_invitations_pending_email
  on public.team_invitations (email)
  where status = 'pending';

/* What the owner's team screen lists. */
create index if not exists team_invitations_business_status
  on public.team_invitations (business_id, status);

-- ---------------------------------------------------------------------
-- RLS: on, forced, and NOT ONE POLICY.
--
-- With RLS enabled and no policy, every role that is not a superuser and
-- does not have BYPASSRLS is denied everything. The only reader is the
-- service role inside an Edge Function, which is already owner-gated.
-- Seven tables in this schema already work exactly this way.
--
-- The grants are revoked as well as the policies withheld. Supabase
-- ships `alter default privileges ... grant all on tables to anon,
-- authenticated`, so a new table in public is reachable with the public
-- key from the moment it exists. RLS masks that today; it should not be
-- the only thing standing there. The audit found the same latent grant
-- sitting on platform_admins.
--
-- A pending invitation holds somebody's email address before they have
-- agreed to anything, which makes this the most sensitive small table in
-- the schema. Nobody enumerates it.
-- ---------------------------------------------------------------------
alter table public.team_invitations enable row level security;
alter table public.team_invitations force row level security;

revoke all on public.team_invitations from public;
revoke all on public.team_invitations from anon;
revoke all on public.team_invitations from authenticated;
grant select, insert, update, delete on public.team_invitations to service_role;

comment on table public.team_invitations is
  'Server-written invitations to join an EXISTING business. business_id, role '
  'and branch_id are trusted state and are never read from a request. '
  'nonce_hash is a one-time provenance signal for the auth.users INSERT and '
  'carries no authority. See PHASE_1B_DESIGN.md.';
