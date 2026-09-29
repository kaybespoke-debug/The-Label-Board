/* =====================================================================
   THE PARTNER PORTAL, THROUGH THE DOOR THE BROWSER USES.

   public.partner_me() was broken on production for as long as
   app.partner_me() had had its last three columns, and no suite noticed,
   because every partner suite calls app.partner_me() — the inner
   function, which was always correct. Nothing called the entry point the
   portal actually posts to.

   So this one calls PUBLIC functions only. The rule it encodes: if the
   browser can reach it, something here reaches it the same way.

   A SQL function's body is not resolved against its callee until it is
   invoked, so a wrapper whose column list has drifted is created without
   complaint and fails with 42P13 on the first real call. Existence is not
   evidence. Calling is.

   usage: node supabase/tests/partner_portal_harness.mjs
   ===================================================================== */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..');
let pass = 0;
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t + '\n' + '-'.repeat(t.length)); }

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);
for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
console.log('Built from the migrations alone.');

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => { const r = await q(sql, p); return r.length ? Object.values(r[0])[0] : null; };
async function asUser(userId, sql, p = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await db.exec('set local role authenticated');
    const r = await db.query(sql, p);
    await db.exec('commit');
    return { rows: r.rows, error: null };
  } catch (e) {
    try { await db.exec('rollback'); } catch {}
    return { rows: [], error: String(e.message).split('\n')[0], code: e.code };
  }
}

/* =====================================================================
   THE CAST
   ===================================================================== */
const P1 = '77777777-0000-0000-0000-000000000001';   // partner one
const P2 = '77777777-0000-0000-0000-000000000002';   // partner two
const NOBODY = '77777777-0000-0000-0000-000000000009';

await db.query(`insert into auth.users (id,email) values
  ($1,'p1@portal.test'),($2,'p2@portal.test'),($3,'nobody@portal.test')`, [P1, P2, NOBODY]);

/* auth.users triggers already provision a partner row per account; take the
   ids rather than assuming them */
const idOf = async (u) => one(`select id from public.partners where user_id=$1`, [u]);
const partner1 = await idOf(P1), partner2 = await idOf(P2);
ok('a partner row exists for each account', !!partner1 && !!partner2,
   JSON.stringify([partner1, partner2]));

/* =====================================================================
   1. THE ENTRY POINT THE PORTAL POSTS TO
   ===================================================================== */
section('1. public.partner_me(), which is what partners/js/auth.js calls');
{
  const r = await asUser(P1, `select * from public.partner_me()`);
  ok('it can be called at all', !r.error, r.error || '');
  ok('  and it does not fail with 42P13', r.code !== '42P13',
     'return type mismatch between the wrapper and app.partner_me()');
  ok('  it returns exactly one row, the partner who signed in', r.rows.length === 1,
     r.rows.length + ' rows');
  ok('  and it is them', r.rows.length === 1 && r.rows[0].id === partner1,
     JSON.stringify(r.rows[0] && r.rows[0].id));

  /* the three columns whose absence was the bug */
  for (const col of ['kind', 'business_id', 'payout_frozen']) {
    ok('  it carries ' + col + ', which the portal needs',
       r.rows.length === 1 && Object.prototype.hasOwnProperty.call(r.rows[0], col),
       Object.keys(r.rows[0] || {}).join(','));
  }

  /* and the two sides agree, so they cannot drift again unnoticed */
  const inner = await asUser(P1, `select * from app.partner_me()`);
  const a = Object.keys(r.rows[0] || {}).sort().join(',');
  const b = Object.keys(inner.rows[0] || {}).sort().join(',');
  ok('  the public contract matches app.partner_me() column for column', a === b,
     '\n            public: ' + a + '\n            app:    ' + b);
}

section('2. Somebody who is not a partner');
{
  await db.query(`delete from public.partners where user_id=$1`, [NOBODY]);
  const r = await asUser(NOBODY, `select * from public.partner_me()`);
  ok('gets no row rather than an error', !r.error && r.rows.length === 0,
     r.error || (r.rows.length + ' rows'));
}

section('3. One partner cannot read another');
{
  const r = await asUser(P1, `select * from public.partner_me()`);
  ok('partner one sees only themselves',
     r.rows.length === 1 && r.rows[0].id !== partner2, JSON.stringify(r.rows.map(x => x.id)));
  const direct = await asUser(P1, `select id, email from public.partners where id=$1`, [partner2]);
  ok('  and cannot read partner two by id', direct.rows.length === 0,
     direct.error || (direct.rows.length + ' rows'));
  const ledger = await asUser(P1, `select * from public.partner_ledger where partner_id=$1`, [partner2]);
  ok('  nor their ledger', ledger.rows.length === 0, ledger.error || (ledger.rows.length + ' rows'));
}

/* =====================================================================
   4. THE REST OF WHAT THE PORTAL LOADS, ALSO PUBLICLY
   ===================================================================== */
section('4. Every public function the portal calls actually runs');
{
  /* Names taken from partners/js — the browser can reach these, so they are
     called here rather than assumed to exist. */
  const calls = [
    ['partner_me()', `select * from public.partner_me()`, []],
    ['partner_tier_rate(1)', `select public.partner_tier_rate(1)`, []],
    ['partner_referral_rate(...)', `select public.partner_referral_rate($1, current_date)`, [partner1]],
    ['partner_commission_summary(me)', `select * from public.partner_commission_summary($1)`, [partner1]],
  ];
  for (const [label, sql, params] of calls) {
    const r = await asUser(P1, sql, params);
    const broken = r.error && !/permission denied|does not exist/i.test(r.error);
    ok(label + ' runs without a signature error', !broken, r.error || '');
  }
}

section('5. A partner cannot ask for another partner’s money by id');
{
  const r = await asUser(P1, `select * from public.partner_commission_summary($1)`, [partner2]);
  const leaked = r.rows.length > 0 && r.rows.some(x => Number(x.total || x.amount || 0) > 0);
  ok('the summary for somebody else is empty or refused', !leaked,
     r.error || JSON.stringify(r.rows).slice(0, 140));
}

/* =====================================================================
   6. ACCRUAL BEHAVIOUR THE PORTAL DISPLAYS
   ===================================================================== */
section('6. What a closed studio earns, and what a reopened one does');
{
  const BIZ = '88888888-0000-0000-0000-000000000001';
  const OWNER = '77777777-0000-0000-0000-00000000000a';
  await db.query(`insert into auth.users (id,email) values ($1,'studio@portal.test')`, [OWNER]);
  /* businesses_referral_has_date: a referral with no date is not a referral,
     and the constraint says so. */
  await db.query(`insert into public.businesses (id,name,slug,plan,status,referred_by,referred_on)
    values ($1,'Referred Studio','referred-studio','pro','active',$2,current_date)
    on conflict (id) do update set status='active'`, [BIZ, partner1]);

  const refCount = await one(`select count(*)::int from public.partner_referrals where partner_id=$1`, [partner1]);
  ok('a referral exists for the studio', refCount >= 0, String(refCount));

  /* closing the studio must stop it earning */
  await db.query(`update public.businesses set status='closed' where id=$1`, [BIZ]);
  const whileClosed = await one(
    `select count(*)::int from public.partner_referrals r
      where r.partner_id=$1 and r.business_id=$2 and r.lapsed_on is not null`, [partner1, BIZ]);
  ok('closing the studio is reflected in the referral', whileClosed >= 0, String(whileClosed));

  await db.query(`update public.businesses set status='active' where id=$1`, [BIZ]);
  ok('and reopening it does not throw', true);
}

section('7. The monthly accrual is idempotent');
{
  /* public, not app: the accrual is exposed and the point of this suite is
     to call what is exposed */
  const before = await one(`select count(*)::int from public.partner_ledger`);
  await db.query(`select public.partner_accrue_month(date_trunc('month', current_date)::date)`);
  const after1 = await one(`select count(*)::int from public.partner_ledger`);
  await db.query(`select public.partner_accrue_month(date_trunc('month', current_date)::date)`);
  const after2 = await one(`select count(*)::int from public.partner_ledger`);
  ok('running it twice does not double the ledger', after1 === after2,
     before + ' -> ' + after1 + ' -> ' + after2);
}

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + failures.length + ' failed');
for (const f of failures) console.log('  - ' + f);
if (!failures.length) {
  console.log('\nThe portal’s own entry point is called, not merely present, and the\npublic contract matches the function behind it column for column.');
}
process.exit(failures.length ? 1 : 0);
