/* =====================================================================
   Plan limits, proved against a real Postgres running the real
   migrations rather than against a second implementation of the rules.

   Kayode asked for these to be shown failing and then passing:

     - a Basic account blocked from creating a 2nd studio or a 6th login
     - a Pro account blocked at the 6th studio or the 51st login
     - and the same insert succeeding once the plan allows it

   So each limit is asserted twice: once refused on the smaller plan and
   once accepted on the larger one, with nothing about the insert itself
   changing between the two. A check that only ever sees the refusal
   cannot tell a working limit from a broken table.

   The three rules underneath, which are what the awkward cases below are
   really about:

     1. Being over a limit never takes anything away. A studio that drops
        from Pro to Basic keeps everything it had.
     2. Editing an existing member is never blocked, because refusing to
        let somebody fix a record punishes them for having grown.
     3. Reinstating a suspended login IS adding one, or a business at its
        ceiling could rotate people through it for ever.

   Usage:  node supabase/tests/plan_limits_harness.mjs
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
function section(t) { console.log('\n' + t); }

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));

/* Supabase's default privileges, in force before the migrations run, so a
   table or function created in public is as reachable here as it is on a
   real project. Without this the grant checks at the bottom pass for the
   wrong reason: a bare Postgres never handed anon anything to revoke. */
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);

const migDir = join(repo, 'supabase/migrations');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(migDir, f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
console.log('Built from the migrations alone.');

const admin = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => {
  const rows = await admin(sql, params);
  return rows.length ? Object.values(rows[0])[0] : null;
};
/* Returns the error instead of throwing, because a refusal is the result
   this suite is testing and half of these calls are meant to fail. */
async function tryAdmin(sql, params = []) {
  try { await db.query(sql, params); return null; }
  catch (e) { return String(e.message).split('\n')[0]; }
}
async function asRole(role, userId, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify(userId ? { sub: userId, role } : { role })]);
    await db.exec('set local role ' + role);
    const res = await db.query(sql, params);
    await db.exec('commit');
    return { rows: res.rows, error: null };
  } catch (e) {
    try { await db.exec('rollback'); } catch {}
    return { rows: [], error: String(e.message).split('\n')[0] };
  }
}

let seq = 0;
async function makeBusiness(plan) {
  seq++;
  return await one(
    'insert into public.businesses (name, slug, plan) values ($1,$2,$3) returning id',
    ['Studio ' + seq, 'studio-' + seq + '-' + plan, plan]);
}
const addBranch = (biz, name) =>
  tryAdmin('insert into public.branches (business_id, name) values ($1,$2)', [biz, name]);
async function addSeat(biz, status = 'active') {
  return await tryAdmin(
    'insert into public.memberships (business_id, user_id, role, status) values ($1, gen_random_uuid(), $2, $3)',
    [biz, 'staff', status]);
}
const branchCount = biz => one('select count(*)::int from public.branches where business_id = $1', [biz]);
const seatCount = biz => one(
  "select count(*)::int from public.memberships where business_id = $1 and status in ('active','invited')", [biz]);

/* =====================================================================
   1. THE TABLE SAYS WHAT KAYODE SAID
   ===================================================================== */
section('The limits are the ones that were asked for');
const limits = Object.fromEntries((await admin(
  'select plan, max_studios, max_seats from public.plan_limits')).map(r => [r.plan, r]));

ok('Basic is 1 studio', Number(limits.starter.max_studios) === 1, JSON.stringify(limits.starter));
ok('Basic is 5 team logins', Number(limits.starter.max_seats) === 5, JSON.stringify(limits.starter));
ok('Pro is 5 studios', Number(limits.pro.max_studios) === 5, JSON.stringify(limits.pro));
ok('Pro is 50 team logins', Number(limits.pro.max_seats) === 50, JSON.stringify(limits.pro));
ok('Bespoke has no fixed studio ceiling', limits.premium.max_studios === null);
ok('Bespoke has no fixed login ceiling', limits.premium.max_seats === null);
ok('the trial is 1 studio and 3 logins',
  Number(limits.trial.max_studios) === 1 && Number(limits.trial.max_seats) === 3);

/* =====================================================================
   2. A BASIC ACCOUNT, FAILING THEN PASSING
   ===================================================================== */
section('Basic is blocked at a 2nd studio, and the same insert works on Pro');
const basic = await makeBusiness('starter');
ok('the first studio is allowed', (await addBranch(basic, 'Lagos')) === null);

const secondOnBasic = await addBranch(basic, 'Abuja');
ok('a 2nd studio on Basic is refused', secondOnBasic !== null, 'it was allowed');
ok('and the refusal says what the limit is and what they have',
  /allows 1 studio/.test(secondOnBasic || '') && /already has 1/.test(secondOnBasic || ''),
  secondOnBasic);
ok('and nothing was written', Number(await branchCount(basic)) === 1);

/* the only thing that changes is the plan */
await admin("update public.businesses set plan = 'pro' where id = $1", [basic]);
ok('the SAME insert is allowed once the business is on Pro',
  (await addBranch(basic, 'Abuja')) === null);
ok('and now there are two', Number(await branchCount(basic)) === 2);

section('Basic is blocked at a 6th login, and the same insert works on Pro');
const seats = await makeBusiness('starter');
for (let i = 0; i < 5; i++) {
  const e = await addSeat(seats);
  if (e) ok('login ' + (i + 1) + ' of 5 is allowed', false, e);
}
ok('five logins are allowed on Basic', Number(await seatCount(seats)) === 5);

const sixth = await addSeat(seats);
ok('a 6th login on Basic is refused', sixth !== null, 'it was allowed');
ok('and the refusal names the ceiling',
  /allows 5 team login/.test(sixth || '') && /already has 5/.test(sixth || ''), sixth);
ok('and nothing was written', Number(await seatCount(seats)) === 5);

await admin("update public.businesses set plan = 'pro' where id = $1", [seats]);
ok('the SAME insert is allowed once the business is on Pro', (await addSeat(seats)) === null);
ok('and now there are six', Number(await seatCount(seats)) === 6);

/* =====================================================================
   3. PRO HAS A CEILING TOO
   ===================================================================== */
section('Pro stops at 5 studios and 50 logins');
const pro = await makeBusiness('pro');
for (let i = 1; i <= 5; i++) {
  const e = await addBranch(pro, 'Outlet ' + i);
  if (e) ok('studio ' + i + ' of 5 is allowed on Pro', false, e);
}
ok('five studios are allowed on Pro', Number(await branchCount(pro)) === 5);
const sixthStudio = await addBranch(pro, 'Outlet 6');
ok('a 6th studio on Pro is refused', sixthStudio !== null, 'it was allowed');
ok('and the refusal names Pro and its ceiling',
  /pro allows 5 studio/.test(sixthStudio || ''), sixthStudio);

const proSeats = await makeBusiness('pro');
for (let i = 0; i < 50; i++) await addSeat(proSeats);
ok('fifty logins are allowed on Pro', Number(await seatCount(proSeats)) === 50);
const fiftyFirst = await addSeat(proSeats);
ok('a 51st login on Pro is refused', fiftyFirst !== null, 'it was allowed');
ok('and nothing was written', Number(await seatCount(proSeats)) === 50);

/* =====================================================================
   4. BESPOKE IS WHATEVER WAS AGREED
   ===================================================================== */
section('Bespoke follows its contract, not a list');
const bespoke = await makeBusiness('premium');
for (let i = 1; i <= 9; i++) await addBranch(bespoke, 'Outlet ' + i);
ok('Bespoke is not capped by the plan table', Number(await branchCount(bespoke)) === 9);

/* and an agreed ceiling can be lower than "none" */
await admin('select app.set_studio_limits($1, $2, $3)', [bespoke, 9, 12]);
ok('an agreed ceiling can be set on the business itself',
  (await addBranch(bespoke, 'Outlet 10')) !== null, 'the 10th was allowed');

/* an agreed ceiling can also RAISE an ordinary plan, which is the case an
   operator hits when a Basic studio has been promised one more login */
const promised = await makeBusiness('starter');
for (let i = 0; i < 5; i++) await addSeat(promised);
ok('Basic still stops at five before the promise', (await addSeat(promised)) !== null);
await admin('select app.set_studio_limits($1, $2, $3)', [promised, null, 6]);
ok('and allows the sixth once it is agreed on the business', (await addSeat(promised)) === null);
ok('while the studio ceiling still follows the plan',
  Number(await one('select max_studios from app.limits_for($1)', [promised])) === 1);

/* putting the override back to null returns it to the plan */
await admin('select app.set_studio_limits($1, null, null)', [promised]);
ok('clearing the agreement puts the business back on its plan limits',
  Number(await one('select max_seats from app.limits_for($1)', [promised])) === 5);

/* =====================================================================
   5. BEING OVER A LIMIT TAKES NOTHING AWAY
   ===================================================================== */
section('Downgrading never removes what a studio already has');
const dropped = await makeBusiness('pro');
for (let i = 1; i <= 4; i++) await addBranch(dropped, 'Outlet ' + i);
for (let i = 0; i < 9; i++) await addSeat(dropped);
await admin("update public.businesses set plan = 'starter' where id = $1", [dropped]);

ok('all four studios are still there after dropping to Basic',
  Number(await branchCount(dropped)) === 4);
ok('all nine logins are still there', Number(await seatCount(dropped)) === 9);
ok('but it cannot add a fifth studio', (await addBranch(dropped, 'Outlet 5')) !== null);
ok('and cannot add a tenth login', (await addSeat(dropped)) !== null);

section('Editing somebody who already exists is never blocked');
const memberId = await one(
  'select id from public.memberships where business_id = $1 limit 1', [dropped]);
ok('a member of an over-limit business can still be given a different role',
  (await tryAdmin("update public.memberships set role = 'manager' where id = $1", [memberId])) === null);
ok('and can still be suspended', (await tryAdmin(
  "update public.memberships set status = 'suspended' where id = $1", [memberId])) === null);

/* Rule 3. Reinstating is adding, or a business at its ceiling could
   suspend one person, invite another, and reinstate the first. */
const rotating = await makeBusiness('starter');
const first = await one(
  "insert into public.memberships (business_id, user_id, role, status) values ($1, gen_random_uuid(), 'staff', 'active') returning id",
  [rotating]);
for (let i = 0; i < 4; i++) await addSeat(rotating);
ok('five logins fill a Basic account', Number(await seatCount(rotating)) === 5);
await admin("update public.memberships set status = 'suspended' where id = $1", [first]);
ok('suspending one frees a seat', Number(await seatCount(rotating)) === 4);
ok('so a new login can be added', (await addSeat(rotating)) === null);
ok('and reinstating the suspended one is refused, because that would be six',
  (await tryAdmin("update public.memberships set status = 'active' where id = $1", [first])) !== null,
  'the business rotated past its ceiling');

/* =====================================================================
   6. THE CONSOLE CAN SEE USAGE AGAINST THE LIMIT
   ===================================================================== */
section('Usage is readable next to the limit it is measured against');
const usage = (await admin('select * from app.usage_for($1)', [dropped]))[0];
ok('usage counts the studios', Number(usage.studios) === 4, JSON.stringify(usage));
/* Eight rather than nine: one of them was suspended a few lines above. A
   suspended login does not occupy a seat, which is the whole reason a
   business at its ceiling has a way to make room without deleting anybody. */
ok('usage counts the logins, and a suspended one is not one of them',
  Number(usage.seats) === 8, JSON.stringify(usage));
ok('and reports the limit it is over', Number(usage.max_studios) === 1 && Number(usage.max_seats) === 5,
  JSON.stringify(usage));

/* An invitation occupies a seat the moment it is sent, or a business
   could invite its way past the ceiling and find out when people
   started accepting. */
const inviting = await makeBusiness('starter');
await addSeat(inviting, 'invited');
ok('an invitation counts as a seat', Number(await seatCount(inviting)) === 1);
const invitedUsage = (await admin('select * from app.usage_for($1)', [inviting]))[0];
ok('and the console sees it that way too', Number(invitedUsage.seats) === 1);

/* =====================================================================
   7. THE STUDIO CAN SEE ITS OWN, AND NOTHING ELSE
   ===================================================================== */
section('A studio reads its own usage and cannot write its own ceiling');
const owner = '33333333-3333-3333-3333-333333333333';
await admin("insert into auth.users (id, email) values ($1, 'owner@example.test')", [owner]);
const mine = await makeBusiness('starter');
await admin(
  "insert into public.memberships (business_id, user_id, role, status) values ($1,$2,'owner','active')",
  [mine, owner]);
await admin("insert into public.branches (business_id, name) values ($1, 'Lagos')", [mine]);

/* Two businesses, not one, and that is correct: creating the auth user
   fires app.provision_studio(), so this person already owns the studio
   their own sign-up made before they were added to this one. The check is
   that they see THIS one and see it right, not that they see one thing. */
const seen = await asRole('authenticated', owner, 'select * from public.my_plan_usage()');
const row = seen.rows.find(r => r.business_id === mine);
ok('my_plan_usage answers for a business they belong to',
  !!row, seen.error || JSON.stringify(seen.rows));
ok('and reports its plan and its ceiling',
  !!row && row.plan === 'starter' &&
  Number(row.max_seats) === 5 && Number(row.studios) === 1,
  JSON.stringify(row));
const theirs = new Set((await admin(
  "select business_id from public.memberships where user_id = $1 and status = 'active'",
  [owner])).map(r => r.business_id));
ok('and returns nothing they are not a member of',
  seen.rows.length === theirs.size && seen.rows.every(r => theirs.has(r.business_id)),
  seen.rows.length + ' rows against ' + theirs.size + ' memberships');

/* THE POINT OF THE WHOLE MIGRATION. A plan limit the tenant can edit is
   a nudge, which is what the app's own comment says it is. The column
   grant from 20260905130000 names four writable columns and these two
   are not among them, so this is locked by having been left out. */
const raise = await asRole('authenticated', owner,
  'update public.businesses set max_seats = 500 where id = $1', [mine]);
ok('a studio cannot raise its own login ceiling', raise.error !== null, 'it succeeded');
const raiseBranches = await asRole('authenticated', owner,
  'update public.businesses set max_branches = 500 where id = $1', [mine]);
ok('nor its own studio ceiling', raiseBranches.error !== null, 'it succeeded');
const rePlan = await asRole('authenticated', owner,
  "update public.businesses set plan = 'premium' where id = $1", [mine]);
ok('nor put itself on a bigger plan', rePlan.error !== null, 'it succeeded');

ok('the ceiling really is unchanged',
  (await one('select max_seats from public.businesses where id = $1', [mine])) === null);

/* And the table of limits is readable but not writable, because both the
   app and the console show a studio what its plan includes. */
const readBands = await asRole('authenticated', owner, 'select count(*) from public.plan_limits');
ok('a signed-in studio may read the plan table', readBands.error === null, readBands.error);
/* Asked as a privilege, not tried as a write. With RLS forced and no
   update policy, an UPDATE matches no rows, changes nothing and reports
   no error, so trying it proves nothing either way. This is how the
   missing `revoke ... from authenticated` on this table survived its
   first draft: the write already looked harmless. */
const mayWriteBands = await one(
  "select has_table_privilege('authenticated', 'public.plan_limits', 'UPDATE')");
ok('and has no privilege to write it', mayWriteBands === false, String(mayWriteBands));
const mayInsertBands = await one(
  "select has_table_privilege('anon', 'public.plan_limits', 'SELECT')");
ok('and an anonymous caller cannot even read it', mayInsertBands === false, String(mayInsertBands));

/* =====================================================================
   8. NONE OF THE MACHINERY IS REACHABLE FROM A BROWSER
   =====================================================================
   The grant is tested rather than the call. A function that errors for
   its own reasons looks exactly like a function that was refused, and
   Supabase grants execute on every new function in public to anon and
   authenticated by default, which `revoke ... from public` does not
   undo. That mistake has been caught twice on this project already. */
section('Only the service role runs the limits');
const banned = [
  ['public', 'set_studio_limits'],
  ['app', 'set_studio_limits'],
  ['app', 'limits_for'],
  ['app', 'usage_for'],
  ['app', 'enforce_branch_limit'],
  ['app', 'enforce_seat_limit']
];
for (const [schema, fn] of banned) {
  for (const role of ['anon', 'authenticated']) {
    const can = await one(
      `select bool_or(has_function_privilege($1, p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = $2 and p.proname = $3`, [role, schema, fn]);
    ok(role + ' cannot execute ' + schema + '.' + fn, can === false || can === null, String(can));
  }
}
const mayRead = await one(
  `select bool_or(has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_plan_usage'`);
ok('a signed-in studio may run my_plan_usage', mayRead === true);
const anonRead = await one(
  `select bool_or(has_function_privilege('anon', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_plan_usage'`);
ok('and an anonymous caller may not', anonRead === false || anonRead === null, String(anonRead));

/* =====================================================================
   9. THE FOUR SURFACES AGREE
   =====================================================================
   The website, the app, the console and the database all carry these
   numbers. Three of them are JavaScript this suite cannot run, so it
   reads them as text and compares the figures. A limit that is enforced
   at 5 and sold at 3 is worse than no limit: the customer is refused
   something they were told they had. */
section('The database, the console and the app agree on the limits');
const adminSrc = readFileSync(join(repo, 'admin/js/data.js'), 'utf8');
const appSrc = readFileSync(join(repo, 'site/layi_dashboard.html'), 'utf8');

for (const [id, name] of [['starter', 'Basic'], ['pro', 'Pro']]) {
  const want = limits[id];
  const con = new RegExp("id: '" + id + "'[^}]*?studios: (\\d+), seats: (\\d+)").exec(adminSrc);
  ok('the console carries the ' + name + ' limits', !!con &&
    Number(con[1]) === Number(want.max_studios) && Number(con[2]) === Number(want.max_seats),
    con ? con[1] + '/' + con[2] + ' against ' + want.max_studios + '/' + want.max_seats : 'not found');

  const app = new RegExp("id:'" + id + "'[^}]*?studios:(\\d+), *seats:(\\d+)").exec(appSrc);
  ok('the app carries the ' + name + ' limits', !!app &&
    Number(app[1]) === Number(want.max_studios) && Number(app[2]) === Number(want.max_seats),
    app ? app[1] + '/' + app[2] + ' against ' + want.max_studios + '/' + want.max_seats : 'not found');
}

/* ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(60));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\nA plan limit the database does not hold is a price nobody is held to.');
  process.exit(1);
}
console.log('\nEvery ceiling is the database\'s, not the browser\'s, and a studio\nover one keeps everything it already had.');
