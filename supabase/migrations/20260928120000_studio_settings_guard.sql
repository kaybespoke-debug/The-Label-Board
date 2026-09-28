-- =====================================================================
-- THE STUDIO'S OWN DESCRIPTION IS THE OWNER'S, AND THE PLAN IS OURS
--
-- FOUND BY THE FIRST PERSON EVER INVITED INTO A STUDIO, 28 September 2026.
-- He accepted as MANAGER of Adé Bespoke and was handed the owner's first-run
-- questionnaire, and he completed it. Measured afterwards on that studio:
-- setupDone true, the production board reset to a garment preset, teamTools
-- switched on, and the plan set to 'pro'. Not "could have" — did.
--
-- The app has been fixed so the questionnaire only opens for an owner. This
-- file is the half that does not depend on the app being right.
--
-- WHY A TRIGGER AND NOT A POLICY. app_state is one jsonb blob per
-- (business_id, key) and layi_dash_settings holds the studio's identity next
-- to things anybody working there legitimately writes — the next invoice
-- number, inventory categories, message templates, the supplier list. There
-- are 47 places in the app that save this row and most of them are ordinary
-- work. An owner-only UPDATE policy would stop a manager issuing an invoice,
-- because issuing one bumps invoiceNo and writes the whole blob back. So the
-- rule has to be about FIELDS, and RLS cannot see fields.
--
-- WHAT IS NOT HERE, because it was already right: `authenticated` holds
-- column-level UPDATE on public.businesses for exactly four columns — name,
-- contact_email, last_seen_at, app_version. plan, max_seats, max_branches,
-- the storage caps, the trial dates, status, cohort and referred_by are
-- already unreachable from a browser whatever the policy says. Checked, not
-- assumed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The settings blob
-- ---------------------------------------------------------------------
create or replace function app.guard_studio_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner boolean;
  v_old   jsonb;
  v_plan  text;
  k       text;
  /* WHAT THE STUDIO IS, as opposed to what it is doing today. Business
     identity, the questionnaire's own answers, the production board, the
     outlets, and the two things that decide what people are paid.

     Deliberately NOT here, and it is a judgement call rather than an
     oversight: currency, customer tiers, message templates, product catalogue,
     inventory categories, defaults, the QC checklist, suppliers. Those are how
     a studio runs day to day and a manager changing one is doing their job.
     Say the word and any of them moves up. */
  protected constant text[] := array[
    'company',                                        -- name, address, email, phone, registration, logo, signature, bank details, tax
    'branches', 'branchActivities',                   -- outlet configuration
    'productionStages', 'stagesV2',                   -- the production board
    'setupDone', 'setupTeamBand', 'setupOutletsBand', -- the questionnaire's own answers
    'itemWord', 'teamTools',                          -- studio-wide wording and disclosure, both set by the questionnaire
    'ownerPassword', 'ownerPay', 'payroll'            -- the owner's own credential, and how the studio pays people
  ];
begin
  if new.key is distinct from 'layi_dash_settings' then
    return new;
  end if;

  /* NO END USER BEHIND THE REQUEST. The service role carries no `sub`, so
     auth.uid() is null for the operator console, admin-api and the Edge
     Functions. The platform is the thing that sets plans and fixes studios;
     this guard is about what a BROWSER may do. */
  if v_uid is null then
    return new;
  end if;

  /* ---- 1. THE PLAN IS NOT THE STUDIO'S TO WRITE ---------------------
     Not even the owner's. It is stamped from businesses.plan on every write,
     so a blob that claims 'premium' is corrected the next time anything
     saves, and there is no request shape that can set it.

     Stamped rather than rejected ON PURPOSE. Rejecting would mean every
     ordinary save fails for a studio whose blob has drifted from its
     subscription, which is a working app breaking over a field nobody
     touched. */
  select b.plan into v_plan from public.businesses b where b.id = new.business_id;
  new.data := coalesce(new.data, '{}'::jsonb);
  if v_plan is not null then
    new.data := jsonb_set(new.data, '{plan}', to_jsonb(v_plan), true);
  else
    new.data := new.data - 'plan';
  end if;

  select exists (
    select 1 from public.memberships m
    where m.user_id = v_uid
      and m.business_id = new.business_id
      and m.status = 'active'
      and m.role = 'owner'
  ) into v_owner;

  if v_owner then
    return new;
  end if;

  /* ---- 2. A FIRST WRITE OVERWRITES NOTHING --------------------------
     On INSERT there is no earlier answer to protect, and raising here would
     stop a manager saving anything at all in a studio whose owner has not
     signed in yet. So the row is allowed and the studio's description is
     simply not part of it: the protected keys are dropped and the owner
     supplies them when they arrive. */
  if tg_op = 'INSERT' then
    new.data := new.data - protected;
    return new;
  end if;

  v_old := coalesce(old.data, '{}'::jsonb);

  foreach k in array protected loop
    if (v_old -> k) is distinct from (new.data -> k) then
      raise exception
        'Only the studio owner can change the studio''s % setting', k
        using errcode = '42501',
              hint = 'That is part of the studio''s own setup. Ask the owner to change it.';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function app.guard_studio_settings() from public, anon, authenticated;

drop trigger if exists app_state_studio_settings_guard on public.app_state;
create trigger app_state_studio_settings_guard
  before insert or update on public.app_state
  for each row execute function app.guard_studio_settings();

comment on function app.guard_studio_settings() is
  'Field-level guard on the layi_dash_settings blob. The studio''s own '
  'description is owner-only; the plan is stamped from businesses.plan on '
  'every write and cannot be set from a browser at all. Ordinary operational '
  'fields in the same blob are untouched, because 47 places in the app write '
  'this row and most of them are somebody doing their job.';

-- ---------------------------------------------------------------------
-- 2. The business row
-- ---------------------------------------------------------------------
-- businesses_update is app.is_business_admin, which counts MANAGERS. That is
-- right for the row as a whole and wrong for the two columns a browser can
-- reach: the studio's name and its contact address are its identity, and the
-- operator console lists studios by that name.
--
-- UPDATE only. INSERT is left alone: the policy already refuses it for any
-- id the caller is not already an admin of, and provision_studio creates
-- studios as the definer with no session behind it.
create or replace function app.guard_business_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner boolean;
begin
  if v_uid is null then
    return new;
  end if;

  /* The app pings this row on every sign-in with last_seen_at and a version,
     and sends the name and contact address along unchanged. Nothing to do. */
  if new.name is not distinct from old.name
     and new.contact_email is not distinct from old.contact_email then
    return new;
  end if;

  select exists (
    select 1 from public.memberships m
    where m.user_id = v_uid
      and m.business_id = old.id
      and m.status = 'active'
      and m.role = 'owner'
  ) into v_owner;

  if v_owner then
    return new;
  end if;

  raise exception
    'Only the studio owner can change the studio''s name or contact address'
    using errcode = '42501';
end;
$$;

revoke all on function app.guard_business_identity() from public, anon, authenticated;

drop trigger if exists businesses_identity_guard on public.businesses;
create trigger businesses_identity_guard
  before update on public.businesses
  for each row execute function app.guard_business_identity();

comment on function app.guard_business_identity() is
  'A manager may report presence on the business row; only an owner may change '
  'what the studio is called or how it is contacted.';
