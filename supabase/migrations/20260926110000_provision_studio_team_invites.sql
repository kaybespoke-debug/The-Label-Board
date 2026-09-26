-- =====================================================================
-- provision_studio learns a fourth path: an invited teammate.
--
-- WHAT IT DOES. Nothing. That is the whole point. When it recognises the
-- auth.users INSERT that our own invitation caused, it returns having
-- written no business, no profile and no membership. Those are written
-- later by public.accept_invitation, running as the invitee, reading the
-- business, role and branch from the team_invitations ROW.
--
-- WHY A NONCE AND NOT SOMETHING SIMPLER.
--
--   "a pending invitation exists for this email" is not a discriminator.
--   Somebody invited by a studio who then independently signs up to start
--   their OWN label would have been silently abstained, landing in an app
--   with nothing in it and no explanation. Kayode caught that.
--
--   new.invited_at looked like the answer and is not. Measured against
--   real GoTrue on staging, 25 September: it is NULL at INSERT for every
--   invited account. GoTrue stamps it a fraction of a millisecond later
--   in a follow-up UPDATE — the stored value is 0.834ms EARLIER than
--   created_at, yet an AFTER INSERT trigger still reads null. A clue was
--   sitting in production all along: a 72ms gap on the one real
--   invitation this project ever sent.
--
--   So: a one-time nonce, minted in the database, only its sha256 kept,
--   passed to GoTrue as invite metadata and read back here. It carries
--   PROVENANCE ONLY — which INSERT this is. No business, no role, no
--   branch is ever read from metadata, because metadata is something a
--   browser can write and this row is not.
--
-- WHY THE EMAIL CHECK MATTERS AS MUCH AS THE HASH. Without it, anyone
-- who learned a valid pair could sign up under a different address and be
-- abstained. With it the pair is bound to one address, and auth.users.email
-- is unique, so the nonce is spent by the act of using it.
--
-- EVERY CONDITION MUST HOLD. Any failure falls straight through to the
-- behaviour below, unchanged. A forged pair is indistinguishable from no
-- pair at all.
--
-- PROVEN BEFORE IT WAS WRITTEN. AG2 and eleven end-to-end cases ran
-- against real Supabase Auth on the staging project: a genuine pair
-- abstains; a wrong nonce, a wrong id and a wrong email each fall through
-- and get their own studio; an invited person who self-signs-up first
-- keeps their own studio and can still accept later. The function this
-- migration installs fingerprints 906720c960146b4f412dd2f05f25e0fe there.
--
-- COPIED FROM 20260921150000_partner_and_studio_together.sql, the current
-- definition, and diffed mechanically: 0 lines removed, 39 added, being
-- two locals and one branch. This function has five generations and
-- copying the wrong one on 21 September silently undid two features.
-- =====================================================================

create or replace function app.provision_studio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_biz     uuid;
  v_partner uuid;
  v_name    text;
  v_slug    text;
  v_n       int := 0;
  v_code    text;
  v_ref     text;
  v_inv_id  text;
  v_nonce   text;
begin
  /* ---- AN INVITED TEAMMATE, PROVED BY A ONE-TIME SERVER NONCE ----
     The metadata carries PROVENANCE ONLY: which INSERT this is. Business,
     role and branch are never read from it. They are read from the
     invitation row at acceptance, by app.accept_invitation, which runs
     later and as the invitee.

     Verified against real GoTrue on staging, 25 September (AG2): both keys
     ARE present in raw_user_meta_data at this point, values intact. The
     obvious alternative, new.invited_at, is NULL here -- GoTrue stamps it a
     fraction of a millisecond later in a follow-up UPDATE -- so it could
     never have worked.

     Every condition must hold. Any failure falls straight through to the
     behaviour below, unchanged, because a person who was invited and then
     independently signs up to start their own studio must still get one. */
  v_inv_id := new.raw_user_meta_data ->> 'team_invitation_id';
  v_nonce  := new.raw_user_meta_data ->> 'team_invitation_nonce';

  if v_inv_id is not null and v_nonce is not null then
    if exists (
      select 1 from public.team_invitations i
      where i.id::text = v_inv_id
        and i.nonce_hash is not null
        and i.nonce_hash = encode(extensions.digest(v_nonce, 'sha256'), 'hex')
        and i.status = 'pending'
        and i.expires_at > now()
        and i.email = lower(btrim(new.email))
    ) then
      /* Single use: the signal dies here, so the same pair can never
         identify a second INSERT even if the metadata is read later. */
      update public.team_invitations
         set nonce_hash = null
       where id::text = v_inv_id;
      return new;          -- no business, no profile, no membership
    end if;
  end if;

  -- 0. a partner prepared for this address is claimed first
  select p.id into v_partner
  from public.partners p
  where p.pending_email is not null
    and lower(p.pending_email) = lower(new.email)
    and p.user_id is null
  limit 1;

  if v_partner is not null then
    update public.partners
       set user_id = new.id, pending_email = null
     where id = v_partner;
  end if;

  -- 1. a studio prepared for this address, waiting to be claimed
  select b.id into v_biz
  from public.businesses b
  where b.pending_owner_email is not null
    and lower(b.pending_owner_email) = lower(new.email)
  limit 1;

  if v_biz is not null then
    update public.businesses set pending_owner_email = null where id = v_biz;
  elsif v_partner is not null then
    -- claimed as a partner and no studio was prepared for them: they are a
    -- partner and nothing else. Never invent one. This is the case the old
    -- early return existed for, and it is still refused.
    return new;
  else
    -- 2. otherwise, a new one from whatever the account told us
    v_name := coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      initcap(split_part(new.email, '@', 1)));

    v_slug := app.slugify(v_name);
    while exists (select 1 from public.businesses where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := app.slugify(v_name) || '-' || v_n::text;
    end loop;

    insert into public.businesses (name, slug, plan, status, contact_email)
    values (v_name, v_slug, 'trial', 'active', new.email)
    returning id into v_biz;

    insert into public.branches (business_id, name)
    values (v_biz, 'Main studio');
  end if;

  insert into public.profiles (id, name, role_id, business_id)
  values (new.id,
          coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
                   initcap(split_part(new.email, '@', 1))),
          'owner', v_biz)
  on conflict (id) do update set business_id = excluded.business_id;

  insert into public.memberships (business_id, user_id, role, status)
  values (v_biz, new.id, 'owner', 'active')
  on conflict (business_id, user_id) do update
    set role = 'owner', status = 'active';

  -- A studio with no subscription row is a studio nobody is counting.
  perform app.ensure_billing_record(v_biz);

  -- ADDED 20 Sep 2026: every customer is a referrer. One programme, so
  -- the code exists from the first day rather than being something an
  -- operator has to remember to hand out.
  if not exists (select 1 from public.partners where business_id = v_biz)
     and not exists (select 1 from public.partners where user_id = new.id) then
    select name into v_name from public.businesses where id = v_biz;
    v_code := app.referral_code_for(v_name);
    insert into public.partners
      (user_id, code, name, business_name, email, status, joined_on, kind, business_id)
    values
      (new.id, v_code,
       coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
                initcap(split_part(new.email, '@', 1))),
       v_name, new.email, 'active', current_date, 'customer', v_biz);
  end if;

  -- ADDED 20 Sep 2026: and if they arrived on somebody's code, the tie is
  -- made here, where the business and the account both exist for the
  -- first time. attach_referral does the self-referral checks and writes
  -- the attempt down either way.
  v_ref := nullif(btrim(new.raw_user_meta_data ->> 'referral_code'), '');
  if v_ref is not null then
    perform app.attach_referral(v_biz, v_ref);
  end if;

  return new;
exception when others then
  raise warning 'provision_studio failed for %: %', new.email, sqlerrm;
  return new;
end;
$$;

revoke all on function app.provision_studio() from public;
