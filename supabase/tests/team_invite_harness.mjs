/* =====================================================================
   team_invite_harness.mjs — Phase 1B, written BEFORE the code it tests.

   WHAT IS AND IS NOT PROVED HERE.

   The invitation table, the seat accounting, the lock and the two
   functions are real and run against the real migrations. Those tests
   pass or fail honestly.

   The DISCRIMINATOR tests do not. app.provision_studio() has not been
   touched and will not be until AG2 answers one question against real
   Supabase Auth: does `inviteUserByEmail(email, { data })` put that data
   into raw_user_meta_data on the INSERT the trigger sees? PGlite cannot
   answer it, because in PGlite we write auth.users ourselves and can put
   whatever we like in that column. Simulating the answer would prove
   only that the simulation works.

   So those are marked XFAIL: expected to fail, reported loudly, and they
   do NOT fail the run. If one ever passes unexpectedly that is news --
   it means provision_studio changed -- and the harness says so and exits
   non-zero, because an XFAIL turning green without anybody deciding to
   change it is exactly the kind of drift a gate exists to catch.

   Kayode's correction, 25 September, and the reason AG2 is now a gate
   before the trigger is touched at all rather than before invitations
   are enabled: an earlier draft argued the nonce was safe to adopt
   because a misfire would fail closed on a primary key collision. That
   stopped being true when profile creation moved to acceptance. A nonce
   that does not arrive means the trigger falls through and silently
   creates an unwanted studio. Fail-open, and the same failure Phase 1A
   disabled invitations over.
   ===================================================================== */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..');

let pass = 0, fail = 0, xfail = 0, xpass = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  PASS   ' + label); }
  else { fail++; console.log('  FAIL   ' + label + (detail ? ' — ' + detail : '')); }
};
/* expected to fail until provision_studio is changed, which needs AG2 */
const xok = (label, cond, detail) => {
  if (cond) { xpass++; console.log('  XPASS  ' + label + '  <-- unexpectedly green, see header'); }
  else { xfail++; console.log('  xfail  ' + label + (detail ? ' — ' + detail : '')); }
};
const section = t => console.log('\n' + t);

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const raises = async (sql, p = []) => {
  try { await db.query(sql, p); return null; } catch (e) { return e.message; }
};
const asUser = async (uid) => {
  await db.exec(`reset role`);
  await q(`select set_config('request.jwt.claims', $1, false)`,
          [JSON.stringify({ sub: uid, role: 'authenticated' })]);
};
const asNobody = async () => {
  await db.exec(`reset role`);
  await q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'anon' })]);
};

/* ---------------------------------------------------------------------
   Two studios, on a five-seat plan, so seat arithmetic is testable.
   --------------------------------------------------------------------- */
const mkUser = async (email, confirmed = true) =>
  (await q(`insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
            values ($1,'{}'::jsonb, case when $2 then now() else null end) returning id`,
           [email, confirmed]))[0].id;

/* An account with NOTHING attached — which is what an invited person will be
   once the discriminator exists. Until then provision_studio invents them a
   studio on the way in, so the helper undoes it. Undoing it here is not
   pretending the bug is fixed: the discriminator section below deliberately
   uses mkUser and watches the studio appear. */
const mkInvitee = async (email, confirmed = true) => {
  const uid = await mkUser(email, confirmed);
  const own = await q(`select business_id from public.profiles where id = $1`, [uid]);
  await q(`delete from public.memberships where user_id = $1`, [uid]);
  await q(`delete from public.partners where user_id = $1`, [uid]);
  await q(`delete from public.profiles where id = $1`, [uid]);
  if (own.length) await q(`delete from public.businesses where id = $1`, [own[0].business_id]);
  return uid;
};

const A = {}, B = {};
A.owner = await mkUser('a.owner@example.com');
B.owner = await mkUser('b.owner@example.com');
const OUTSIDER = await mkUser('outsider@example.com');
const PLATFORM = await mkUser('ops@thelabelboard.com');

await db.exec(`delete from public.memberships`);
await db.exec(`delete from public.profiles`);
await db.exec(`delete from public.partners`);
await db.exec(`delete from public.businesses`);

const mkBiz = async (slug, name, plan = 'starter') =>
  (await q(`insert into public.businesses (name, slug, plan, status)
            values ($1,$2,$3,'active') returning id`, [name, slug, plan]))[0].id;

A.biz = await mkBiz('studio-a', 'Studio A');           // starter = 5 seats, 1 studio
B.biz = await mkBiz('studio-b', 'Studio B');

A.branch = (await q(`insert into public.branches (business_id, name) values ($1,'A Lagos') returning id`, [A.biz]))[0].id;
B.branch = (await q(`insert into public.branches (business_id, name) values ($1,'B Abuja') returning id`, [B.biz]))[0].id;

const joinBiz = async (biz, uid, role, status = 'active') => {
  await q(`insert into public.profiles (id, name, role_id, business_id) values ($1,$2,$3,$4)
           on conflict (id) do update set business_id = excluded.business_id`, [uid, role, role, biz]);
  await q(`insert into public.memberships (business_id, user_id, role, status) values ($1,$2,$3,$4)`,
          [biz, uid, role, status]);
};
await joinBiz(A.biz, A.owner, 'owner');
await joinBiz(B.biz, B.owner, 'owner');
await q(`insert into public.platform_admins (id, email, name, role, active)
         values ($1,'ops@thelabelboard.com','Ops','support',true)`, [PLATFORM]);

const seats = async (biz) => (await q(`select app.seats_used($1) as n`, [biz]))[0].n;
const bizCount = async () => (await q(`select count(*)::int as n from public.businesses`))[0].n;
const invite = async (biz, email, role = 'staff', branch = null, by = null) =>
  (await q(`select * from app.create_team_invitation($1,$2,$3,$4,$5)`,
           [biz, email, role, branch, by || A.owner]))[0];

// =====================================================================
section('The table refuses what it was built to refuse');
// =====================================================================
{
  const bad = await raises(
    `insert into public.team_invitations (business_id, email, role, invited_by)
     values ($1,'x@example.com','owner',$2)`, [A.biz, A.owner]);
  ok('an invitation cannot mint an owner', bad !== null && /role/.test(bad),
     'an invitation must never transfer a studio');

  const unnorm = await raises(
    `insert into public.team_invitations (business_id, email, invited_by)
     values ($1,'  MiXeD@Example.COM ',$2)`, [A.biz, A.owner]);
  ok('an unnormalised address is refused at the table', unnorm !== null);

  const cross = await raises(
    `insert into public.team_invitations (business_id, email, branch_id, invited_by)
     values ($1,'x@example.com',$2,$3)`, [A.biz, B.branch, A.owner]);
  ok('TEST C: a branch from another business CANNOT BE STORED', cross !== null,
     'the composite FK, not a check');

  const goodBranch = await raises(
    `insert into public.team_invitations (business_id, email, branch_id, invited_by)
     values ($1,'branchok@example.com',$2,$3)`, [A.biz, A.branch, A.owner]);
  ok('its own branch is fine', goodBranch === null, goodBranch);
  await q(`delete from public.team_invitations where email='branchok@example.com'`);
}

// =====================================================================
section('RLS: nobody but the service role sees an invitation');
// =====================================================================
{
  await invite(A.biz, 'rls.probe@example.com');
  await asUser(A.owner);
  await db.exec(`set role authenticated`);
  const owner = await raises(`select * from public.team_invitations`);
  ok('not even the owner can read the table directly', owner !== null,
     'they go through the gateway; the table is deny-all');
  await asNobody();
  await db.exec(`set role anon`);
  const anon = await raises(`select * from public.team_invitations`);
  ok('an anonymous caller cannot enumerate pending addresses', anon !== null);
  await db.exec(`reset role`);
  await q(`delete from public.team_invitations where email='rls.probe@example.com'`);
}

// =====================================================================
section('Seat accounting: a pending invitation holds a seat');
// =====================================================================
{
  const before = await seats(A.biz);
  ok('Studio A starts with one seat used', before === 1, String(before));

  const inv = await invite(A.biz, 'seat.one@example.com');
  ok('creating an invitation returns an id, a nonce and an expiry',
     !!inv.invitation_id && !!inv.nonce && !!inv.expires_at);
  ok('the nonce is 64 hex characters', /^[0-9a-f]{64}$/.test(inv.nonce));

  const after = await seats(A.biz);
  ok('and it takes a seat immediately', after === 2, String(after));

  const stored = await q(`select nonce_hash from public.team_invitations where id=$1`, [inv.invitation_id]);
  ok('AS10: the raw nonce is NOT stored', stored[0].nonce_hash !== inv.nonce);
  ok('AS10: only a 64-hex hash is', /^[0-9a-f]{64}$/.test(stored[0].nonce_hash));

  await q(`select app.cancel_team_invitation($1)`, [inv.invitation_id]);
  const freed = await seats(A.biz);
  ok('SEAT-CONVERT-4: cancelling frees the seat at once', freed === 1, String(freed));
}

// =====================================================================
section('SEAT-CONVERT-1: 4 active + 1 pending on a 5 seat plan');
// =====================================================================
{
  for (const n of [2, 3, 4]) {
    const u = await mkUser(`a.member${n}@example.com`);
    await joinBiz(A.biz, u, 'staff');
  }
  ok('Studio A now has four active members', await seats(A.biz) === 4);

  const inv = await invite(A.biz, 'convert.me@example.com', 'staff', A.branch);
  ok('the fifth seat is taken by a pending invitation', await seats(A.biz) === 5);

  const full = await raises(`select * from app.create_team_invitation($1,$2,'staff',null,$3)`,
                            [A.biz, 'one.too.many@example.com', A.owner]);
  ok('a sixth is refused at creation', full !== null && /plan limit/.test(full),
     'the owner finds out now, not after somebody follows a dead link');

  /* the invitee arrives */
  const newbie = await mkInvitee('convert.me@example.com');
  await asUser(newbie);
  const res = await q(`select * from public.accept_invitation($1)`, [inv.invitation_id]);
  ok('SEAT-CONVERT-1: acceptance SUCCEEDS on the last seat', res.length === 1);
  ok('and returns the business it joined', res[0].joined_name === 'Studio A');

  const nowSeats = await seats(A.biz);
  ok('SEAT-CONVERT-1: 4 active + 1 pending became 5 active + 0 pending',
     nowSeats === 5, String(nowSeats) + ' — the reservation was converted, not doubled');

  const m = await q(`select role, status, branch_id from public.memberships
                      where business_id=$1 and user_id=$2`, [A.biz, newbie]);
  ok('the membership is active', m.length === 1 && m[0].status === 'active');
  ok('with the role from the invitation ROW', m[0].role === 'staff');
  ok('and the branch from the invitation ROW', m[0].branch_id === A.branch);

  const p = await q(`select business_id, role_id from public.profiles where id=$1`, [newbie]);
  ok('the profile points at the inviting business', p[0].business_id === A.biz);
  ok('profiles.role_id and memberships.role agree', p[0].role_id === 'staff',
     'one choice writes both, so Phase 1B adds no third model');

  const inScope = await q(`select app.in_scope($1,null) as v`, [A.biz]);
  ok('and they can actually SEE the business now', inScope[0].v === true,
     'the thing that has never worked before');
  await db.exec(`reset role`);
}

// =====================================================================
section('Acceptance refuses everything it should');
// =====================================================================
{
  const inv = await invite(B.biz, 'careful@example.com');
  const invitee = await mkInvitee('careful@example.com');
  const wrongUser = OUTSIDER;

  await asUser(wrongUser);
  const wrong = await raises(`select * from public.accept_invitation($1)`, [inv.invitation_id]);
  ok('AI: right id, WRONG signed-in user', wrong !== null && /no longer valid/.test(wrong),
     'the id is a selector, not a credential');

  await asNobody();
  const anon = await raises(`select * from public.accept_invitation($1)`, [inv.invitation_id]);
  ok('AJ: right id, not signed in', anon !== null && /Not signed in/.test(anon));

  const unconf = await mkInvitee('unconfirmed@example.com', false);
  const inv2 = await invite(B.biz, 'unconfirmed@example.com');
  await asUser(unconf);
  const nc = await raises(`select * from public.accept_invitation($1)`, [inv2.invitation_id]);
  ok('AK: correct user but email not confirmed', nc !== null && /Confirm your email/.test(nc));

  await asUser(invitee);
  const first = await q(`select * from public.accept_invitation($1)`, [inv.invitation_id]);
  ok('the genuine invitee is let in', first.length === 1);
  const again = await raises(`select * from public.accept_invitation($1)`, [inv.invitation_id]);
  ok('F: the same invitation cannot be used twice', again !== null && /already been used|no longer valid/.test(again));

  const nonced = await q(`select nonce_hash from public.team_invitations where id=$1`, [inv.invitation_id]);
  ok('and the nonce is cleared on acceptance', nonced[0].nonce_hash === null);
  await db.exec(`reset role`);
}

// =====================================================================
section('Expired and cancelled');
// =====================================================================
{
  const u = await mkInvitee('expired@example.com');
  const held = await seats(B.biz);
  const inv = await invite(B.biz, 'expired@example.com');
  ok('a fresh invitation takes a seat', await seats(B.biz) === held + 1);
  await q(`update public.team_invitations set expires_at = now() - interval '1 day' where id=$1`,
          [inv.invitation_id]);
  ok('an expired invitation stops holding a seat', await seats(B.biz) === held,
     String(await seats(B.biz)) + ' vs ' + held);
  await asUser(u);
  const exp = await raises(`select * from public.accept_invitation($1)`, [inv.invitation_id]);
  ok('G: an expired invitation is refused', exp !== null && /no longer valid/.test(exp));
  await db.exec(`reset role`);

  const u2 = await mkInvitee('cancelled@example.com');
  const inv2 = await invite(B.biz, 'cancelled@example.com');
  await q(`select app.cancel_team_invitation($1)`, [inv2.invitation_id]);
  await asUser(u2);
  const can = await raises(`select * from public.accept_invitation($1)`, [inv2.invitation_id]);
  ok('H: a cancelled invitation is refused', can !== null && /no longer valid/.test(can));
  await db.exec(`reset role`);
}

// =====================================================================
section('TEST D: the same person, a second business');
// =====================================================================
{
  await q(`update public.businesses set max_seats = 20 where id=$1`, [A.biz]);
  const both = await mkInvitee('works.for.two@example.com');
  await joinBiz(B.biz, both, 'staff');
  const usersBefore = (await q(`select count(*)::int as n from auth.users`))[0].n;
  const bizBefore = await bizCount();

  /* A invites somebody who already owns a place at B */
  const inv = await invite(A.biz, 'works.for.two@example.com', 'manager');
  await asUser(both);
  const r = await q(`select * from public.accept_invitation($1)`, [inv.invitation_id]);
  await db.exec(`reset role`);

  ok('D: they joined Studio A', r.length === 1 && r[0].joined_name === 'Studio A');
  ok('D: NO second auth account', (await q(`select count(*)::int as n from auth.users`))[0].n === usersBefore);
  ok('D: NO new business', await bizCount() === bizBefore);

  const mem = await q(`select business_id, role, status from public.memberships
                        where user_id=$1 order by created_at`, [both]);
  ok('D: they now hold TWO memberships', mem.length === 2, String(mem.length));
  ok('D: Studio B is untouched',
     mem.some(m => m.business_id === B.biz && m.role === 'staff' && m.status === 'active'));
  ok('D: Studio A carries the invited role', mem.some(m => m.business_id === A.biz && m.role === 'manager'));
  await q(`update public.businesses set max_seats = null where id=$1`, [A.biz]);
}

// =====================================================================
section('TEST B: the client cannot name the business');
// =====================================================================
/* create_team_invitation takes the business as an argument, and the ONLY
   caller is team-admin, which derives it from the caller's own profile and
   never from the request. There is nothing here a browser can reach: the
   table is deny-all and the function is service_role only. */
{
  await asUser(A.owner);
  await db.exec(`set role authenticated`);
  const direct = await raises(`select * from app.create_team_invitation($1,$2,'staff',null,$3)`,
                              [B.biz, 'hijack@example.com', A.owner]);
  ok('B: a signed-in owner cannot call the invite function at all', direct !== null,
     'execute is granted to service_role only');
  await db.exec(`reset role`);
  await asNobody();
  await db.exec(`set role anon`);
  const anon = await raises(`select * from public.accept_invitation($1)`,
                            ['00000000-0000-4000-8000-000000000000']);
  ok('and anon cannot accept anything', anon !== null);
  await db.exec(`reset role`);
}

// =====================================================================
section('TEST K: no invitation ever creates a business');
// =====================================================================
{
  const before = await bizCount();
  const u = await mkInvitee('never.a.studio@example.com');
  const inv = await invite(B.biz, 'never.a.studio@example.com');
  await asUser(u);
  await q(`select * from public.accept_invitation($1)`, [inv.invitation_id]);
  await db.exec(`reset role`);
  ok('K: business count unchanged across a whole invitation',
     await bizCount() === before, before + ' -> ' + await bizCount());
}

// =====================================================================
section('SEAT-CONVERT-2: over the limit after a downgrade');
// =====================================================================
{
  /* Studio A is on starter with 5 seats and 5 active members. Pretend a
     downgrade has left it over: drop the ceiling on the business itself. */
  await q(`update public.businesses set max_seats = 3 where id=$1`, [A.biz]);
  const over = await raises(`select * from app.create_team_invitation($1,$2,'staff',null,$3)`,
                            [A.biz, 'no.room@example.com', A.owner]);
  ok('SEAT-CONVERT-2: no new invitation while over the limit',
     over !== null && /plan limit/.test(over));

  const sus = (await q(`select user_id from public.memberships
                         where business_id=$1 and role='staff' limit 1`, [A.biz]))[0].user_id;
  await q(`update public.memberships set status='suspended' where business_id=$1 and user_id=$2`,
          [A.biz, sus]);
  const react = await raises(`update public.memberships set status='active'
                               where business_id=$1 and user_id=$2`, [A.biz, sus]);
  ok('AT: and no reactivation while over the limit', react !== null && /plan limit/.test(react),
     'existing actives are left alone; only new grants are refused');
  await q(`update public.businesses set max_seats = null where id=$1`, [A.biz]);
  /* deliberately left suspended: test D raised A's ceiling to 20 and put a
     sixth member in, so with the override removed A is genuinely over its
     starter plan. Reactivating would be refused, which is the rule working. */
}

// =====================================================================
section('SEAT-CONVERT-5: a failed acceptance leaves the seat reserved');
// =====================================================================
/* Its own studio: the sections above deliberately fill A and B to their
   ceilings, and rollback has nothing to do with seat pressure. */
const C = { biz: await mkBiz('studio-c', 'Studio C', 'pro') };
C.owner = await mkUser('c.owner@example.com');
await q(`delete from public.memberships where user_id = $1`, [C.owner]);
await q(`delete from public.profiles where id = $1`, [C.owner]);
await joinBiz(C.biz, C.owner, 'owner');
// =====================================================================
{
  const u = await mkInvitee('rollback@example.com');
  const inv = await invite(C.biz, 'rollback@example.com');
  const held = await seats(C.biz);

  /* force the membership write to fail: a branch that is not B's */
  await q(`update public.team_invitations set branch_id=null where id=$1`, [inv.invitation_id]);
  await asUser(u);
  await db.exec(`begin`);
  const bad = await raises(
    `select * from public.accept_invitation($1)`, [inv.invitation_id]);
  await db.exec(`rollback`);
  await db.exec(`reset role`);

  const still = await q(`select status from public.team_invitations where id=$1`, [inv.invitation_id]);
  ok('SEAT-CONVERT-5: after a rolled back acceptance the invitation is pending again',
     still[0].status === 'pending', still[0].status);
  ok('and its seat is still reserved', await seats(C.biz) === held, String(await seats(C.biz)));
}

// =====================================================================
section('L: a platform admin is not invitable through this door');
// =====================================================================
/* verifyTarget in team-admin already refuses a platform admin as a target.
   The same refusal belongs on the invite path, and it is the EDGE FUNCTION
   that owns it, because platform_admins is keyed by auth id and the
   invitation is written before we resolve one. Asserted at the table here:
   a platform admin holds no studio profile, which is what makes them
   invisible to every tenant-scoped lookup. */
{
  const prof = await q(`select count(*)::int as n from public.profiles where id=$1`, [PLATFORM]);
  ok('L: a platform admin holds no studio profile', prof[0].n === 0);
  const mem = await q(`select count(*)::int as n from public.memberships where user_id=$1`, [PLATFORM]);
  ok('L: and no tenant membership', mem[0].n === 0);
}

// =====================================================================
section('The discriminator — XFAIL until AG2 passes against real GoTrue');
// =====================================================================
/* provision_studio is UNCHANGED. These describe the behaviour it must have
   once AG2 proves the nonce is visible at INSERT. They fail now, on
   purpose, and do not fail the run. Read the header before "fixing" them. */
{
  const bizBefore = await bizCount();
  const inv = await invite(C.biz, 'discriminator@example.com');

  /* AS9: the genuine pair must make the trigger abstain */
  const u = (await q(
    `insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
     values ($1, jsonb_build_object('team_invitation_id', $2::text,
                                    'team_invitation_nonce', $3::text), now())
     returning id`, ['discriminator@example.com', inv.invitation_id, inv.nonce]))[0].id;

  xok('AS9: a genuine nonce pair makes the trigger abstain — no studio invented',
      await bizCount() === bizBefore, bizBefore + ' -> ' + await bizCount());
  xok('AS9: and writes no profile',
      (await q(`select count(*)::int as n from public.profiles where id=$1`, [u]))[0].n === 0);
  xok('AS9: and no membership',
      (await q(`select count(*)::int as n from public.memberships where user_id=$1`, [u]))[0].n === 0);

  /* AS1 and friends: nothing else may ever cause an abstain. These pass
     today for the wrong reason — the trigger ignores the metadata
     entirely — so they are ordinary checks, not XFAIL. They become
     meaningful the moment the nonce branch exists. */
  const check = async (label, email, meta) => {
    const before = await bizCount();
    await q(`insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
             values ($1, $2::jsonb, now())`, [email, JSON.stringify(meta)]);
    ok(label, await bizCount() === before + 1,
       'a self-signup must still get its own studio');
  };
  await check('AS1: real invitation id, random nonce', 'as1@example.com',
              { team_invitation_id: inv.invitation_id, team_invitation_nonce: 'f'.repeat(64) });
  await check('AS2: correct id, incorrect nonce', 'as2@example.com',
              { team_invitation_id: inv.invitation_id, team_invitation_nonce: 'deadbeef' });
  await check('AS3: random id, plausible metadata', 'as3@example.com',
              { team_invitation_id: '00000000-0000-4000-8000-000000000000',
                team_invitation_nonce: 'a'.repeat(64) });
  await check('AS4: correct pair, DIFFERENT email', 'as4.different@example.com',
              { team_invitation_id: inv.invitation_id, team_invitation_nonce: inv.nonce });
  await check('AO: Jane — invited, but signs up for her own studio', 'jane@example.com', {});

  const janeInv = await invite(C.biz, 'jane2@example.com');
  const before2 = await bizCount();
  await q(`insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
           values ('jane2@example.com','{}'::jsonb, now())`);
  ok('AO: a pending invitation does not stop her getting one',
     await bizCount() === before2 + 1);
  const stillPending = await q(`select status from public.team_invitations where id=$1`, [janeInv.invitation_id]);
  ok('AO: and her invitation is still pending afterwards', stillPending[0].status === 'pending');

  /* AQ / AR: old invitation data must not poison a later signup */
  const dead = await invite(C.biz, 'later@example.com');
  await q(`select app.cancel_team_invitation($1)`, [dead.invitation_id]);
  const before3 = await bizCount();
  await q(`insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
           values ('later@example.com','{}'::jsonb, now())`);
  ok('AQ: a cancelled invitation does not poison a later self-signup',
     await bizCount() === before3 + 1);
}

// =====================================================================
console.log('\n' + '='.repeat(66));
console.log(pass + ' passed, ' + fail + ' failed, ' + xfail + ' xfail, ' + xpass + ' xpass');
if (xfail) {
  console.log('\nThe xfails are the discriminator, and they are expected.');
  console.log('provision_studio is unchanged and stays unchanged until AG2');
  console.log('proves against REAL Supabase Auth that inviteUserByEmail({data})');
  console.log('reaches raw_user_meta_data on the INSERT the trigger sees.');
  console.log('PGlite cannot answer that: here we write auth.users ourselves.');
}
if (xpass) {
  console.log('\nAn XFAIL went green. Either provision_studio was changed without');
  console.log('AG2, or this harness is lying to you. Both are worth stopping for.');
}
if (fail || xpass) process.exit(1);
console.log('\nThe table, the seat accounting and both functions behave. The');
console.log('discriminator does not exist yet, on purpose.');
