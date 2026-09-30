-- =====================================================================
-- Deleting an account takes two steps and a fresh sign-in
-- =====================================================================
-- delete_my_account() is one call. It ends every membership, deletes the
-- profile, and closes any studio the person solely owns, immediately and
-- with nothing to undo it. The sole-owner guard is good and stays; what is
-- missing is any moment where the person is shown what is about to happen
-- and has to say yes to that specific thing.
--
-- WHAT THIS IS NOT. It is not a second password, and it is not an obstacle
-- course. Somebody who wants their data gone has a right to have it gone,
-- and making that harder to exercise would be the wrong fix for the wrong
-- problem. Nothing here adds a credential, a waiting period, an appeal, or
-- a retention window. The account is deleted the moment it is confirmed.
--
-- WHAT IT IS. Two things the existing Supabase identity already provides:
--
--   1. A PREVIEW THEN A CONFIRMATION. The first call deletes nothing. It
--      returns exactly what will go — which studios close, how many
--      memberships end — and opens a fifteen-minute window. The second call
--      does the work. A misdirected tap cannot delete an account, because
--      one tap is not enough and the second one comes after reading a list.
--
--   2. A FRESH SIGN-IN. The confirming request must carry a token issued in
--      the last ten minutes, and the person must type their own email
--      address. Both are checked against auth.users and auth.jwt(), which
--      is the identity they already have. A laptop left open in a workroom
--      cannot be used to delete somebody's account an hour later.
--
-- The email is typed rather than clicked because it is the one thing that
-- cannot be done by accident, and it is the same address the account signs
-- in with, so there is nothing new to remember or store.
-- =====================================================================

create table if not exists public.account_deletion_requests (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  preview     jsonb not null default '{}'::jsonb
);

alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;

/* A person may see and cancel their own request and nobody else's. There is
   deliberately no policy for anyone else: the platform does not need to
   read these, and a pending deletion is not a thing to leave lying about. */
drop policy if exists adr_select on public.account_deletion_requests;
create policy adr_select on public.account_deletion_requests for select to authenticated
  using (user_id = auth.uid());
drop policy if exists adr_delete on public.account_deletion_requests;
create policy adr_delete on public.account_deletion_requests for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.account_deletion_requests from anon, authenticated;
grant select, delete on public.account_deletion_requests to authenticated;

-- ---------------------------------------------------------------------
-- 1. What would actually happen
-- ---------------------------------------------------------------------
-- Shown before anything is done, because "are you sure" is not a question
-- anybody can answer without being told what they are sure about.
create or replace function app.account_deletion_preview()
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
    'memberships', (select count(*) from public.memberships m
                     where m.user_id = auth.uid() and m.status = 'active'),
    'studios_you_would_leave', (select coalesce(jsonb_agg(bz.name order by bz.name),'[]'::jsonb)
      from public.memberships m join public.businesses bz on bz.id = m.business_id
     where m.user_id = auth.uid() and m.status = 'active'),
    /* the ones nobody else owns: these CLOSE, which is the part somebody
       would most regret not having been told */
    'studios_that_would_close', (select coalesce(jsonb_agg(bz.name order by bz.name),'[]'::jsonb)
      from public.memberships m join public.businesses bz on bz.id = m.business_id
     where m.user_id = auth.uid() and m.role = 'owner' and m.status = 'active'
       and bz.status = 'active'
       and not exists (select 1 from public.memberships o
                        where o.business_id = m.business_id and o.user_id <> auth.uid()
                          and o.role = 'owner' and o.status = 'active')),
    'partner_account', (select count(*) from public.partners p where p.user_id = auth.uid())
  );
$fn$;

create or replace function public.preview_account_deletion()
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$ select app.account_deletion_preview() $fn$;

-- ---------------------------------------------------------------------
-- 2. Asking
-- ---------------------------------------------------------------------
create or replace function public.request_account_deletion()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare v_uid uuid := auth.uid(); v_prev jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_prev := app.account_deletion_preview();
  insert into public.account_deletion_requests (user_id, requested_at, preview)
  values (v_uid, now(), v_prev)
  on conflict (user_id) do update set requested_at = now(), preview = excluded.preview;
  return v_prev || jsonb_build_object(
    'requested', true,
    'confirm_within_minutes', 15,
    'confirm_by_typing', 'your email address');
end $fn$;

create or replace function public.cancel_account_deletion()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  delete from public.account_deletion_requests where user_id = auth.uid();
  return jsonb_build_object('cancelled', true);
end $fn$;

-- ---------------------------------------------------------------------
-- 3. Meaning it
-- ---------------------------------------------------------------------
create or replace function public.confirm_account_deletion(
  p_email text,
  p_close_solely_owned boolean default false)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_uid   uuid := auth.uid();
  v_asked timestamptz;
  v_email text;
  v_iat   bigint;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;

  select requested_at into v_asked from public.account_deletion_requests where user_id = v_uid;
  if v_asked is null then
    raise exception 'ask first: nothing is deleted without being shown what would go'
      using errcode = '42501';
  end if;
  if v_asked < now() - interval '15 minutes' then
    delete from public.account_deletion_requests where user_id = v_uid;
    raise exception 'that request is more than fifteen minutes old; ask again'
      using errcode = '42501';
  end if;

  /* THE SAME ADDRESS THE ACCOUNT SIGNS IN WITH. Not a new secret — the one
     they already have, typed rather than clicked, because typing it is the
     one thing that cannot happen by accident. */
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;
  if v_email is null or v_email <> lower(btrim(coalesce(p_email,''))) then
    raise exception 'that is not the email address this account signs in with'
      using errcode = '42501';
  end if;

  /* A FRESH SIGN-IN. iat is when this token was issued; a session resumed
     from last week carries an old one. Ten minutes is long enough to read
     the list and type an address, and short enough that a laptop left open
     in a workroom is not a way to delete somebody's account. */
  begin
    v_iat := (auth.jwt() ->> 'iat')::bigint;
  exception when others then v_iat := null;
  end;
  if v_iat is null or to_timestamp(v_iat) < now() - interval '10 minutes' then
    raise exception 'sign in again before deleting your account'
      using errcode = '42501',
            hint = 'This confirms it is you and not a session somebody left open.';
  end if;

  delete from public.account_deletion_requests where user_id = v_uid;
  return app.delete_my_account(p_close_solely_owned);
end $fn$;

-- ---------------------------------------------------------------------
-- 4. And the old one-step door is closed
-- ---------------------------------------------------------------------
-- Left in place and made to refuse, rather than dropped: a client that has
-- not updated gets a sentence telling it what to do instead of a missing
-- function, and nothing that used to delete an account in one call still
-- can. app.delete_my_account is unchanged and still does the work; it is
-- reachable only through the confirmation above.
-- The default stays: create or replace cannot remove one, and a client that
-- calls it with no argument should still get the sentence rather than
-- "function does not exist", which is a different and less useful problem.
create or replace function public.delete_my_account(p_close_solely_owned boolean default false)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  raise exception 'deleting an account now takes two steps'
    using errcode = '42501',
          hint = 'Call request_account_deletion() to see what would go, then confirm_account_deletion(your email).';
end $fn$;

revoke all on function app.account_deletion_preview()          from public, anon, authenticated;
revoke all on function public.preview_account_deletion()       from public, anon;
revoke all on function public.request_account_deletion()       from public, anon;
revoke all on function public.cancel_account_deletion()        from public, anon;
revoke all on function public.confirm_account_deletion(text, boolean) from public, anon;
revoke all on function public.delete_my_account(boolean)       from public, anon;
grant execute on function public.preview_account_deletion()    to authenticated;
grant execute on function public.request_account_deletion()    to authenticated;
grant execute on function public.cancel_account_deletion()     to authenticated;
grant execute on function public.confirm_account_deletion(text, boolean) to authenticated;
grant execute on function public.delete_my_account(boolean)    to authenticated;

comment on function public.confirm_account_deletion(text, boolean) is
  'Deletes the account. Requires a request made in the last fifteen minutes, '
  'the account''s own email typed out, and a token issued in the last ten. '
  'No new credential: all three come from the identity they already have.';
