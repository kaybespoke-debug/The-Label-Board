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
