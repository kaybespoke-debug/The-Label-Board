/* =====================================================================
   team_admin_harness.mjs — the Edge Function that holds the service role
   key, tested against a real Postgres.

   WHAT THIS IS. `team-admin` is Deno and cannot be imported here. So this
   harness does not run the function; it runs the function's ONE security
   decision — verifyTarget — against the real schema, the real migrations
   and real rows, with two businesses, both owners, both staff and a
   platform admin.

   That decision is the whole vulnerability. On 23 September 2026 an audit
   found `team-admin` would reset the password of ANY account on the
   platform for any studio owner who asked, because it scoped a WRITE and
   read the error instead of reading the row back:

       .from('profiles').update({...}).eq('id', id).eq('business_id', biz)
       if (error) return 400            <-- null. A zero-row write is fine.
       auth.admin.updateUserById(id)    <-- somebody else's account.

   So the harness asserts the two things that matter, on real data:

     1. the lookup the fixed code performs returns NOTHING for every
        foreign id, so the guard refuses; and
     2. the lookup the BROKEN code performed reports success for those
        same ids, which is why it never refused.

   Point 2 is the important half. A test that only shows the new code
   passing cannot tell a working guard from a guard that is never reached.

   WHAT THIS IS NOT. It does not execute the deployed function, so it
   cannot prove the HTTP layer, the JWT check or the invite email. Those
   are T09, T10 and the runtime half of T01 to T05 in AUDIT_2026-09-23.md
   and they need a staging project, which does not exist yet. Every one of
   them is listed as SKIPPED at the end of this run, with the reason.
   ===================================================================== */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..');

let pass = 0, fail = 0;
const skipped = [];
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
};
const skip = (id, label, why) => { skipped.push({ id, label, why }); };
const section = t => console.log('\n' + t);

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

/* ---------------------------------------------------------------------
   The cast, exactly as the brief asks for it.
   --------------------------------------------------------------------- */
const mkUser = async (email) =>
  (await q(`insert into auth.users (email, raw_user_meta_data)
            values ($1,'{}'::jsonb) returning id`, [email]))[0].id;

/* provision_studio fires on insert and builds a studio per account, which
   is not the shape we want here — we want two studios with four people in
   them. So: make the accounts, then rewrite profiles and memberships to
   the arrangement under test. */
const A = {}, B = {};
A.owner = await mkUser('a.owner@example.com');
A.staff = await mkUser('a.staff@example.com');
B.owner = await mkUser('b.owner@example.com');
B.staff = await mkUser('b.staff@example.com');
const PLATFORM = await mkUser('ops@thelabelboard.com');

await db.exec(`delete from public.memberships`);
await db.exec(`delete from public.profiles`);
await db.exec(`delete from public.partners`);
await db.exec(`delete from public.businesses`);

const mkBiz = async (slug, name) =>
  (await q(`insert into public.businesses (name, slug, plan, status)
            values ($1,$2,'pro','active') returning id`, [name, slug]))[0].id;

A.biz = await mkBiz('studio-a', 'Studio A');
B.biz = await mkBiz('studio-b', 'Studio B');

const join_ = async (biz, uid, role) => {
  await q(`insert into public.profiles (id, name, role_id, business_id)
           values ($1,$2,$3,$4)`, [uid, role + ' person', role, biz]);
  await q(`insert into public.memberships (business_id, user_id, role, status)
           values ($1,$2,$3,'active')`, [biz, uid, role === 'owner' ? 'owner' : 'staff']);
};
await join_(A.biz, A.owner, 'owner');
await join_(A.biz, A.staff, 'cre');
await join_(B.biz, B.owner, 'owner');
await join_(B.biz, B.staff, 'cre');

/* A platform admin is Label Board staff. They hold NO profile in any
   studio, which is the whole point, and is why verifyTarget misses them. */
await q(`insert into public.platform_admins (id, email, name, role, active)
         values ($1,'ops@thelabelboard.com','Ops','support',true)`, [PLATFORM]);

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

/* ---------------------------------------------------------------------
   The two lookups, fixed and broken, as functions of (caller, target).
   --------------------------------------------------------------------- */

/* THE FIX. Read the row back. Returns the decision the Edge Function makes. */
async function verifyTarget(callerBiz, targetId) {
  if (!targetId) return { ok: false, status: 400 };
  const staff = await q(`select id from public.platform_admins where id = $1`, [targetId]);
  if (staff.length) return { ok: false, status: 403 };
  const rows = await q(
    `select id from public.profiles where id = $1 and business_id = $2`, [targetId, callerBiz]);
  if (!rows.length) return { ok: false, status: 403 };
  return { ok: true, status: 200 };
}

/* THE BUG, preserved deliberately. A scoped write, and its error read as
   the verdict. This is what shipped on 3 May and ran until 23 September. */
async function brokenGuardSaysProceed(callerBiz, targetId) {
  try {
    await q(`update public.profiles set name = name
              where id = $1 and business_id = $2`, [targetId, callerBiz]);
    return true;            // no error raised => the old code carried on
  } catch { return false; }
}

// =====================================================================
section('The cast');
// =====================================================================
{
  const n = await q(`select
      (select count(*)::int from public.businesses) as biz,
      (select count(*)::int from public.profiles) as profiles,
      (select count(*)::int from public.platform_admins) as admins`);
  ok('two businesses', n[0].biz === 2, String(n[0].biz));
  ok('four studio people', n[0].profiles === 4, String(n[0].profiles));
  ok('one platform admin, with no studio profile', n[0].admins === 1, String(n[0].admins));
  const pa = await q(`select count(*)::int as n from public.profiles where id = $1`, [PLATFORM]);
  ok('the platform admin holds no profile anywhere', pa[0].n === 0, String(pa[0].n));
}

// =====================================================================
section('TEST 1 & 12 — A_OWNER acts on A_STAFF, and it still works');
// =====================================================================
/* The fix must not have closed the feature. A guard that refuses
   everything passes every negative test and ships a broken product. */
{
  const v = await verifyTarget(A.biz, A.staff);
  ok('T01/T12 A_OWNER may update A_STAFF', v.ok === true, 'status ' + v.status);

  await q(`update public.profiles set role_id = 'mgr' where id = $1 and business_id = $2`,
          [A.staff, A.biz]);
  const r = await q(`select role_id from public.profiles where id = $1`, [A.staff]);
  ok('T12 the update actually lands', r[0].role_id === 'mgr', r[0].role_id);
}

// =====================================================================
section('TESTS 2-8 — every foreign target is refused');
// =====================================================================
{
  const CASES = [
    ['T02', 'A_OWNER updates B_STAFF', B.staff],
    ['T03', 'A_OWNER resets B_OWNER’s password', B.owner],
    ['T04', 'A_OWNER updates PLATFORM_ADMIN', PLATFORM],
    ['T05', 'A_OWNER deletes B_STAFF', B.staff],
    ['T06', 'A_OWNER deletes B_OWNER', B.owner],
    ['T07', 'A_OWNER deletes PLATFORM_ADMIN', PLATFORM],
    ['T08', 'A_OWNER targets an unknown UUID', UNKNOWN],
  ];

  for (const [id, label, target] of CASES) {
    const v = await verifyTarget(A.biz, target);
    ok(`${id} ${label} — refused`, v.ok === false, 'guard allowed it');
    ok(`${id} ${label} — 403, not a 400 or a 500`, v.status === 403, 'status ' + v.status);
  }

  /* And nothing moved. The guard returning false is only half the claim;
     the other half is that no row changed while we were proving it. */
  const after = await q(`select count(*)::int as n from public.profiles
                          where business_id = $1`, [B.biz]);
  ok('B still has both of its people', after[0].n === 2, String(after[0].n));
  const admin = await q(`select count(*)::int as n from public.platform_admins where id = $1`,
                        [PLATFORM]);
  ok('the platform admin is untouched', admin[0].n === 1, String(admin[0].n));
  const u = await q(`select count(*)::int as n from auth.users
                      where id in ($1,$2,$3)`, [B.owner, B.staff, PLATFORM]);
  ok('all three auth accounts still exist', u[0].n === 3, String(u[0].n));
}

// =====================================================================
section('The bug itself: why the old code never refused');
// =====================================================================
/* This is the section that gives the rest its meaning. If a scoped write
   raised an error for a foreign id, the original code would have been
   safe and there would have been no vulnerability. It does not. */
{
  for (const [label, target] of [
    ['B_STAFF', B.staff], ['B_OWNER', B.owner],
    ['PLATFORM_ADMIN', PLATFORM], ['an unknown UUID', UNKNOWN],
  ]) {
    const proceeded = await brokenGuardSaysProceed(A.biz, target);
    ok(`the OLD scoped-write guard waved ${label} through`, proceeded === true,
       'if this ever fails, the premise of the whole fix has changed');
  }
  console.log('        ^ these PASS on purpose. They are the vulnerability,');
  console.log('          reproduced, so the fix below is measured against it.');

  for (const [label, target] of [
    ['B_STAFF', B.staff], ['B_OWNER', B.owner],
    ['PLATFORM_ADMIN', PLATFORM], ['an unknown UUID', UNKNOWN],
  ]) {
    const v = await verifyTarget(A.biz, target);
    ok(`the NEW read-back guard stops ${label}`, v.ok === false);
  }
}

// =====================================================================
section('TEST 11 — A_STAFF cannot do an owner-only action');
// =====================================================================
/* The Edge Function gates on profiles.role_id === 'owner' before any
   mutating action. Checked here against the row the function reads. */
{
  const r = await q(`select role_id from public.profiles where id = $1`, [A.staff]);
  ok('T11 A_STAFF is not owner in the row team-admin reads',
     r[0].role_id !== 'owner', r[0].role_id);
  const o = await q(`select role_id from public.profiles where id = $1`, [A.owner]);
  ok('T11 A_OWNER is', o[0].role_id === 'owner', o[0].role_id);
}

// =====================================================================
section('Ownership cannot be borrowed from the other studio');
// =====================================================================
/* B_OWNER is an owner — just not of A. The guard is scoped by business,
   not by whether the target happens to be an owner somewhere. */
{
  const v = await verifyTarget(A.biz, B.owner);
  ok('being an owner of B does not make you visible to A', v.ok === false);
  const back = await verifyTarget(B.biz, A.owner);
  ok('and it does not work in the other direction either', back.ok === false);
  const own = await verifyTarget(B.biz, B.staff);
  ok('B_OWNER can still act within B', own.ok === true, 'status ' + own.status);
}

// =====================================================================
section('Invitations are ON, and what had to be true first');
// =====================================================================
/* THIS SECTION USED TO ASSERT THE OPPOSITE, and that is the point of
   rewriting it rather than deleting it.

   It read "the switch exists and is off", "it returns before it validates
   anything", "it returns before it reaches auth", "it answers 503". Those
   guarded an inert path that existed because inviteUserByEmail inserted into
   auth.users, provision_studio fired, and the invitee became the owner of a
   brand new studio named after them: 9 businesses became 10.

   That hole was closed on 25 September. The switch stayed shut for another
   fortnight because the COMMENT explaining it was never revisited. So the
   four assertions were not wrong when written and are not wrong now — they
   are stale, and deleting them would throw away the record of what the
   switch was for. They are replaced by assertions on the thing that made it
   safe to open. */
{
  const fn = readFileSync(join(repo, 'supabase/functions/team-admin/index.ts'), 'utf8');
  const app = readFileSync(join(repo, 'site/layi_dashboard.html'), 'utf8');

  ok('the app switch is on',
     /const TEAM_INVITES_ENABLED=true/.test(app),
     'the owner would still be shown "temporarily unavailable"');

  const inviteAt = fn.indexOf("if (action === 'invite')");
  ok('the invite action still exists', inviteAt >= 0);
  const body = fn.slice(inviteAt, fn.indexOf("\n    if (action === 'update')", inviteAt));

  /* The replacement for "it returns before it validates anything". The
     inert path is gone, so the claim worth making is that NOTHING refuses
     before the work — a leftover early return is how a feature gets
     declared on and stay off. */
  ok('nothing refuses invitations before they are attempted',
     !/invites_disabled/.test(fn) && !/TEAM_INVITES_ENABLED\b/.test(body),
     'an early return is still in the invite path');

  /* And the order the function works in, which is what makes a failure
     safe: the invitation row (and its seat lock) BEFORE the account, and
     the email last, so a mail failure can undo both. */
  const invRow = body.indexOf('create_team_invitation');
  const acct = body.indexOf('generateLink');
  const mail = body.indexOf('sendViaResend');
  ok('the invitation row is created before the account',
     invRow >= 0 && acct >= 0 && invRow < acct,
     'inv ' + invRow + ', account ' + acct);
  ok('and the email is sent last of the three',
     mail > acct, 'mail ' + mail + ', account ' + acct);
  ok('a mail failure discards the invitation AND the account it just made',
     /discard_invitation[\s\S]{0,400}?deleteUser/.test(body),
     'an invitation nobody was told about holds a seat and expires silently');
  ok('the studio is never told why an address was refused beyond "already has an account"',
     /already\|registered\|exists/.test(body));

  ok('editing an existing teammate is untouched',
     /function saveUserCloud\(id\)/.test(app) && /callTeamAdmin\('update'/.test(app));
}

// =====================================================================
section('The trigger: nothing for an invited insert, a studio for a stranger');
// =====================================================================
/* THE ASSERTION THAT REPLACED "this is the bug".
   A bare insert into auth.users still builds a studio, and that is correct
   and must stay correct: somebody who signs up on their own account must get
   one. What changed is that an insert carrying a VALID one-time nonce writes
   nothing at all. Both halves are measured here, because a test that only
   shows the invited case passing cannot tell a working nonce check from a
   trigger that has stopped building studios for anybody. */
{
  const bizBefore = (await q(`select count(*)::int as n from businesses`))[0].n;
  const usersBefore = (await q(`select count(*)::int as n from auth.users`))[0].n;

  /* --- half one: a stranger. unchanged behaviour. --- */
  const stranger = await mkUser('signs.up.alone@example.com');
  const bizAfterStranger = (await q(`select count(*)::int as n from businesses`))[0].n;
  ok('an uninvited account still gets a studio of its own',
     bizAfterStranger === bizBefore + 1,
     bizBefore + ' -> ' + bizAfterStranger);
  const sp = await q(`select role_id from profiles where id = $1`, [stranger]);
  ok('  and owns it', sp.length === 1 && sp[0].role_id === 'owner');

  /* --- half two: an invited teammate. the new behaviour. --- */
  const nonce = 'test-nonce-' + Math.random().toString(36).slice(2);
  const invited = 'real.teammate@example.com';
  const inv = (await q(
    `insert into public.team_invitations
       (business_id, email, role, invited_by, nonce_hash, nonce_issued_at)
     values ($1,$2,'staff',$3, encode(extensions.digest($4,'sha256'),'hex'), now())
     returning id`, [A.biz, invited, A.owner, nonce]))[0].id;

  const bizBefore2 = (await q(`select count(*)::int as n from businesses`))[0].n;
  const teammate = (await q(
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, jsonb_build_object(
       'name','Idara Umah',
       'team_invitation_id', $2::text,
       'team_invitation_nonce', $3::text))
     returning id`, [invited, inv, nonce]))[0].id;
  const bizAfter2 = (await q(`select count(*)::int as n from businesses`))[0].n;

  ok('AN INVITED INSERT INVENTS NOTHING', bizAfter2 === bizBefore2,
     bizBefore2 + ' -> ' + bizAfter2 + ' (this is what the switch was for)');
  ok('  no profile', (await q(`select 1 from profiles where id=$1`, [teammate])).length === 0);
  ok('  no membership', (await q(`select 1 from memberships where user_id=$1`, [teammate])).length === 0);
  ok('  and no referral partner row either',
     (await q(`select 1 from partners where user_id=$1`, [teammate])).length === 0,
     'every customer is a referrer, but a teammate is not a customer');

  /* SINGLE USE. The nonce is spent by the insert above, so the same pair
     cannot identify a second one. Without this, metadata read later would
     still be a valid pass. */
  const spent = await q(`select nonce_hash from team_invitations where id=$1`, [inv]);
  ok('  the nonce is spent, not reusable', spent[0].nonce_hash === null);

  const bizBefore3 = (await q(`select count(*)::int as n from businesses`))[0].n;
  const replay = (await q(
    `insert into auth.users (email, raw_user_meta_data)
     values ('replay@example.com', jsonb_build_object(
       'team_invitation_id', $1::text, 'team_invitation_nonce', $2::text))
     returning id`, [inv, nonce]))[0].id;
  ok('  so replaying it falls through and builds a studio instead of passing',
     (await q(`select count(*)::int as n from businesses`))[0].n === bizBefore3 + 1,
     'a spent nonce must not keep working');

  /* A WRONG NONCE IS NOT A PASS, which is the whole security claim. */
  const inv2 = (await q(
    `insert into public.team_invitations
       (business_id, email, role, invited_by, nonce_hash, nonce_issued_at)
     values ($1,'guesser@example.com','staff',$2, encode(extensions.digest('right','sha256'),'hex'), now())
     returning id`, [A.biz, A.owner]))[0].id;
  const bizBefore4 = (await q(`select count(*)::int as n from businesses`))[0].n;
  await q(`insert into auth.users (email, raw_user_meta_data)
           values ('guesser@example.com', jsonb_build_object(
             'team_invitation_id', $1::text, 'team_invitation_nonce','wrong'))`, [inv2]);
  ok('a WRONG nonce is refused and falls through to the ordinary path',
     (await q(`select count(*)::int as n from businesses`))[0].n === bizBefore4 + 1,
     'guessing the invitation id must not be enough');

  /* clean up this harness's own mess so later sections count straight */
  for (const u of [stranger, teammate, replay]) {
    await q(`delete from memberships where user_id = $1`, [u]);
    await q(`delete from partners where user_id = $1`, [u]);
    await q(`delete from profiles where id = $1`, [u]);
  }
  await q(`delete from memberships where user_id in (select id from auth.users where email='guesser@example.com')`);
  await q(`delete from partners where user_id in (select id from auth.users where email='guesser@example.com')`);
  await q(`delete from profiles where id in (select id from auth.users where email='guesser@example.com')`);
  await q(`delete from team_invitations where id in ($1,$2)`, [inv, inv2]);
  await q(`delete from businesses where id not in ($1,$2)`, [A.biz, B.biz]);
  await q(`delete from auth.users where id <> all($1::uuid[])`,
          [[A.owner, A.staff, B.owner, B.staff, PLATFORM]]);
  const back = (await q(`select count(*)::int as n from auth.users`))[0].n;
  ok('harness cleaned up after itself', back === usersBefore, back + ' vs ' + usersBefore);
}

// =====================================================================
section('Accepting an invitation, all the way to a membership');
// =====================================================================
/* The half nothing covered: the invitation existed, the trigger stood aside,
   and then what. accept_invitation runs AS THE INVITEE, so it is the one
   piece of this feature a studio owner does not control. */
{
  const email = 'accepts@example.com';
  const uid = (await q(
    `insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
     values ($1, '{"name":"Accepts Properly"}'::jsonb, now()) returning id`, [email]))[0].id;
  /* the trigger made them a studio, because no nonce was carried; strip it so
     this section tests acceptance rather than provisioning */
  await q(`delete from memberships where user_id=$1`, [uid]);
  await q(`delete from partners where user_id=$1`, [uid]);
  await q(`delete from profiles where id=$1`, [uid]);
  await q(`delete from businesses where id not in ($1,$2)`, [A.biz, B.biz]);

  const branch = (await q(`select id from branches where business_id=$1 limit 1`, [A.biz]))[0]?.id ?? null;
  const mkInv = async (addr, role, expires) => (await q(
    `insert into public.team_invitations
       (business_id, email, role, branch_id, invited_by, expires_at)
     values ($1,$2,$3,$4,$5, $6) returning id`,
    [A.biz, addr, role, branch, A.owner, expires]))[0].id;

  const asThem = async (sql, params = []) => {
    await db.exec('begin');
    await db.exec(`set local role authenticated`);
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true)`);
    try { const r = await db.query(sql, params); await db.exec('commit'); return { rows: r.rows }; }
    catch (e) { await db.exec('rollback'); return { error: e.message }; }
  };

  /* --- somebody else's invitation --- */
  const notTheirs = await mkInv('someone.else@example.com', 'staff', '2099-01-01');
  let r = await asThem(`select * from public.accept_invitation($1)`, [notTheirs]);
  ok('an invitation for another address is refused',
     !!r.error && /no longer valid/.test(r.error), r.error || 'it was accepted');

  /* --- an expired one --- */
  const expired = await mkInv(email, 'staff', '2020-01-01');
  r = await asThem(`select * from public.accept_invitation($1)`, [expired]);
  ok('an expired invitation is refused', !!r.error && /no longer valid/.test(r.error));
  /* At most one PENDING invitation per address per business
     (team_invitations_one_live), so the expired one has to be retired before
     the real one can exist. Cancelling is what an owner would do. */
  await q(`update team_invitations set status='cancelled', cancelled_at=now()
            where id=$1`, [expired]);
  ok('  with the SAME words, so nothing is disclosed',
     /no longer valid/.test(r.error || ''),
     'a different message for each case is an oracle');

  /* --- the real one --- */
  const good = await mkInv(email, 'manager', '2099-01-01');
  r = await asThem(`select * from public.accept_invitation($1)`, [good]);
  ok('the right invitation is accepted', !r.error && r.rows?.length === 1, r.error);
  ok('  and reports which studio they joined',
     r.rows?.[0]?.joined_business === A.biz);

  const m = await q(`select role, branch_id, status from memberships
                      where user_id=$1 and business_id=$2`, [uid, A.biz]);
  ok('  a membership exists', m.length === 1);
  ok('  with the role from the INVITATION, not from anything they sent',
     m[0]?.role === 'manager', m[0]?.role);
  ok('  and the branch from the invitation', m[0]?.branch_id === branch);
  ok('  active', m[0]?.status === 'active');
  ok('  and a profile naming that studio',
     (await q(`select business_id from profiles where id=$1`, [uid]))[0]?.business_id === A.biz);

  /* --- single use --- */
  r = await asThem(`select * from public.accept_invitation($1)`, [good]);
  ok('the same invitation cannot be accepted twice',
     !!r.error, r.error ? '' : 'it was accepted a second time');

  /* --- an unconfirmed account --- */
  const unconf = (await q(
    `insert into auth.users (email, raw_user_meta_data)
     values ('never.confirmed@example.com','{}'::jsonb) returning id`))[0].id;
  await q(`delete from memberships where user_id=$1`, [unconf]);
  await q(`delete from partners where user_id=$1`, [unconf]);
  await q(`delete from profiles where id=$1`, [unconf]);
  await q(`delete from businesses where id not in ($1,$2)`, [A.biz, B.biz]);
  const forUnconf = await mkInv('never.confirmed@example.com', 'staff', '2099-01-01');
  await db.exec('begin');
  await db.exec(`set local role authenticated`);
  await db.exec(`select set_config('request.jwt.claims', '{"sub":"${unconf}","role":"authenticated"}', true)`);
  let unconfErr = '';
  try { await db.query(`select * from public.accept_invitation($1)`, [forUnconf]); await db.exec('commit'); }
  catch (e) { unconfErr = e.message; await db.exec('rollback'); }
  ok('an account that never confirmed its email cannot accept',
     /Confirm your email/.test(unconfErr), unconfErr || 'it was accepted');

  await q(`delete from memberships where user_id = any($1::uuid[])`, [[uid, unconf]]);
  await q(`delete from profiles where id = any($1::uuid[])`, [[uid, unconf]]);
  await q(`delete from team_invitations where business_id=$1`, [A.biz]);
  await q(`delete from auth.users where id = any($1::uuid[])`, [[uid, unconf]]);
}

// =====================================================================
section('Remove from studio: the membership, not the person');
// =====================================================================
/* Kayode's decision, 5 October. The account survives, they are signed out of
   every device, and their past work stays attributed to them.

   What this replaces: `delete` removed the membership and then, if that was
   their only studio, deleted the profile AND called auth.admin.deleteUser.
   Removing a tailor from the only studio they had worked in destroyed their
   account. */
{
  /* auth.sessions is not in the test stub, because no suite needed it until
     now. Built here rather than in auth_stub.sql so twenty other suites keep
     the schema they were written against. */
  await db.exec(`create table if not exists auth.sessions (
                   id uuid primary key default gen_random_uuid(),
                   user_id uuid not null references auth.users(id) on delete cascade,
                   created_at timestamptz not null default now())`);

  const email = 'leaver@example.com';
  const uid = (await q(
    `insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
     values ($1,'{"name":"Leaver"}'::jsonb, now()) returning id`, [email]))[0].id;
  await q(`delete from memberships where user_id=$1`, [uid]);
  await q(`delete from partners where user_id=$1`, [uid]);
  await q(`delete from profiles where id=$1`, [uid]);
  await q(`delete from businesses where id not in ($1,$2)`, [A.biz, B.biz]);

  await q(`insert into profiles (id,name,role_id,business_id) values ($1,'Leaver','cre',$2)`, [uid, A.biz]);
  await q(`insert into memberships (business_id,user_id,role,status)
           values ($1,$2,'staff','active')`, [A.biz, uid]);

  /* their work, attributed the way the app attributes it: to a STAFF record,
     which belongs to the studio and not to the account */
  const staffId = (await q(`insert into staff (business_id, name, user_id, basic)
           values ($1,'Leaver',$2, 50000) returning id`, [A.biz, uid]))[0].id;
  const attId = (await q(`insert into attendance (business_id, staff_id, on_at)
           values ($1,$2, now()) returning id`, [A.biz, staffId]))[0].id;

  await q(`insert into auth.sessions (user_id) values ($1),($1),($1)`, [uid]);
  ok('they have sessions on three devices',
     (await q(`select count(*)::int n from auth.sessions where user_id=$1`, [uid]))[0].n === 3);

  /* ---- what the gateway now does ---- */
  await q(`delete from memberships where user_id=$1 and business_id=$2`, [uid, A.biz]);
  const revoked = (await q(`select public.revoke_all_sessions($1) as n`, [uid]))[0].n;
  await q(`delete from profiles where id=$1`, [uid]);

  ok('the membership is gone',
     (await q(`select 1 from memberships where user_id=$1`, [uid])).length === 0);
  ok('every session is destroyed, so they are signed out of every device',
     revoked === 3 && (await q(`select count(*)::int n from auth.sessions where user_id=$1`, [uid]))[0].n === 0,
     'revoked ' + revoked);
  ok('THEIR ACCOUNT SURVIVES',
     (await q(`select 1 from auth.users where id=$1`, [uid])).length === 1,
     'this is the whole decision');
  ok('  so they keep their email address and their password',
     (await q(`select email from auth.users where id=$1`, [uid]))[0].email === email);

  ok('their attendance is still attributed to them',
     (await q(`select staff_id from attendance where id=$1`, [attId]))[0]?.staff_id === staffId);
  ok('  and the staff record it hangs off is still there',
     (await q(`select 1 from staff where id=$1`, [staffId])).length === 1);
  ok('  with the link back to their account intact, so re-inviting is continuous',
     (await q(`select user_id from staff where id=$1`, [staffId]))[0]?.user_id === uid);

  /* and access really is gone, not merely unlabelled */
  await db.exec('begin');
  await db.exec(`set local role authenticated`);
  await db.exec(`select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true)`);
  const seen = (await db.query(`select count(*)::int as n from public.orders`)).rows[0].n;
  await db.exec('commit');
  ok('they can no longer read the studio’s orders', seen === 0, seen + ' rows');

  /* ---- and nobody but the service role may sign anybody out ---- */
  for (const role of ['anon', 'authenticated']) {
    const can = (await q(
      `select has_function_privilege($1, 'public.revoke_all_sessions(uuid)', 'execute') as y`,
      [role]))[0].y;
    ok(role + ' may NOT revoke sessions', can === false,
       'a function that signs anybody out of everything, reachable with the public key');
  }
  ok('and app.revoke_all_sessions is not reachable either',
     (await q(`select has_function_privilege('authenticated','app.revoke_all_sessions(uuid)','execute') as y`))[0].y === false);

  await q(`delete from attendance where id=$1`, [attId]);
  await q(`delete from staff where id=$1`, [staffId]);
  await q(`delete from auth.users where id=$1`, [uid]);
}

// =====================================================================
section('Skipped, and why');
// =====================================================================
skip('T09', 'Unauthenticated request returns 401',
     'needs the deployed function over HTTP; no staging project exists');
skip('T10', 'Forged or invalid JWT returns 401',
     'needs real GoTrue token verification; cannot be reproduced in PGlite');
skip('T01-T08 (runtime)', 'The same cases end to end against the HTTP endpoint',
     'the decision is proved here against real rows; the transport is not');
skip('INVITE', 'An invited teammate receives an email and sets their own password',
     'needs a mail provider and a real redirect URL allowlist');
skipped.forEach(s => console.log('  SKIP  ' + s.id + ' ' + s.label + '\n        ' + s.why));

// =====================================================================
console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fail + ' failed, ' + skipped.length + ' skipped');
if (fail) process.exit(1);
console.log('\nA studio owner reaches their own team and stops there, proved');
console.log('against the real schema. The transport layer is not covered:');
console.log('see the skips above and AUDIT_2026-09-23.md.');
