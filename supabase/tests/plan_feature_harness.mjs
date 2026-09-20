/* =====================================================================
   Plan features, proved at the API.

   Kayode asked for this to be shown rather than described:

     "show a Basic account blocked from Payroll, Inventory, Funds,
      Marketing and the chase list, both in the UI and at the API"

   This is the API half. The UI half is in audit_tiers.js, which runs the
   real app in a sandbox and checks every gated view refuses to render and
   offers the upgrade panel instead.

   Every block is shown twice: refused on Basic, and then the IDENTICAL
   write accepted on Pro with nothing else changed. A check that only ever
   sees the refusal cannot tell a working gate from a broken table.

   Usage:  node supabase/tests/plan_feature_harness.mjs
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
async function boom(sql, p = []) {
  try { await db.query(sql, p); return null; }
  catch (e) { return String(e.message).split('\n')[0]; }
}
async function asMember(userId, sql, p = []) {
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
    return { rows: [], error: String(e.message).split('\n')[0] };
  }
}

let n = 0;
async function studio(plan) {
  n++;
  const id = await one(
    `insert into public.businesses (name, slug, plan) values ($1,$2,$3) returning id`,
    ['Studio ' + n, 'studio-' + n + '-' + plan, plan]);
  const user = '00000000-0000-0000-0000-' + String(100000000000 + n);
  await db.query(`insert into auth.users (id, email) values ($1,$2)`, [user, 'u' + n + '@example.test']);
  /* the signup trigger gives that user their own studio; this attaches
     them to the one under test as well */
  await db.query(
    `insert into public.memberships (business_id, user_id, role, status)
     values ($1,$2,'owner','active') on conflict do nothing`, [id, user]);
  return { id, user };
}
const putState = (biz, key) => boom(
  `insert into public.app_state (business_id, key, data) values ($1,$2,'[]'::jsonb)
   on conflict (business_id, key) do update set data = excluded.data`, [biz, key]);

/* =====================================================================
   1. WHAT EACH PLAN INCLUDES
   ===================================================================== */
section('The catalogue is the list Kayode gave, and Basic has none of it');
const cat = (await q('select feature from public.plan_feature_catalogue order by 1')).map(r => r.feature);
const WANT = ['chase', 'companylog', 'funds', 'inventory', 'marketing',
              'payroll', 'reporting', 'reports', 'suppliers', 'team'];
ok('the ten features are the ten that were asked for',
  JSON.stringify(cat) === JSON.stringify(WANT), JSON.stringify(cat));
ok('Basic has none of them',
  (await one(`select count(*)::int from public.plan_features where plan = 'starter'`)) === 0);
for (const p of ['pro', 'premium', 'trial']) {
  ok(p + ' has all ten',
    (await one(`select count(*)::int from public.plan_features where plan = $1`, [p])) === WANT.length);
}

/* =====================================================================
   2. THE FIVE HE NAMED, REFUSED ON BASIC AND ACCEPTED ON PRO
   ===================================================================== */
section('Basic is refused, Pro is not, and nothing about the write changes');
const basic = await studio('starter');
const pro = await studio('pro');

const CASES = [
  ['Payroll',   'payroll',   null,                   'staff.basic'],
  ['Inventory', 'inventory', 'layi_dash_supplies',   'app_state'],
  ['Funds',     'funds',     'layi_dash_pots',       'app_state'],
  ['Marketing', 'marketing', 'layi_dash_campaigns',  'app_state'],
  ['Suppliers', 'suppliers', 'layi_dash_bills',      'app_state'],
  ['Rota and attendance', 'team', 'layi_dash_shifts', 'app_state']
];

for (const [name, feature, key] of CASES) {
  if (key) {
    const refused = await putState(basic.id, key);
    ok(name + ' is refused on Basic', !!refused, 'it was allowed');
    ok('  and the refusal says it is a Pro feature',
      /Pro feature/.test(String(refused)), String(refused));
    ok('  and the SAME write is accepted on Pro', (await putState(pro.id, key)) === null);
  }
}

/* payroll is a column, not a key */
const payBasic = await boom(
  `insert into public.staff (business_id, name, basic) values ($1,'Franklin',45000)`, [basic.id]);
ok('Payroll is refused on Basic', !!payBasic, 'it was allowed');
ok('  and the refusal says it is a Pro feature', /Pro feature/.test(String(payBasic)), String(payBasic));
ok('  but Basic may still keep the person, unpaid',
  (await boom(`insert into public.staff (business_id, name, basic) values ($1,'Franklin',0)`, [basic.id])) === null);
ok('  and the SAME pay rate is accepted on Pro',
  (await boom(`insert into public.staff (business_id, name, basic) values ($1,'Franklin',45000)`, [pro.id])) === null);

/* the two tenant tables */
const supBasic = await boom(
  `insert into public.suppliers (business_id, name) values ($1,'Aso-oke House')`, [basic.id]);
ok('Vendors and suppliers is refused on Basic', !!supBasic, 'it was allowed');
ok('  and the SAME row is accepted on Pro',
  (await boom(`insert into public.suppliers (business_id, name) values ($1,'Aso-oke House')`, [pro.id])) === null);

const proStaff = await one(`select id from public.staff where business_id = $1 limit 1`, [pro.id]);
const basicStaff = await one(`select id from public.staff where business_id = $1 limit 1`, [basic.id]);
const attBasic = await boom(
  `insert into public.attendance (business_id, staff_id, on_at) values ($1,$2,now())`, [basic.id, basicStaff]);
ok('Attendance is refused on Basic', !!attBasic, 'it was allowed');
ok('  and the SAME row is accepted on Pro',
  (await boom(`insert into public.attendance (business_id, staff_id, on_at) values ($1,$2,now())`, [pro.id, proStaff])) === null);

/* =====================================================================
   3. WHAT BASIC KEEPS
   ===================================================================== */
section('Basic keeps everything it was sold');
for (const key of ['layi_dash_orders', 'layi_dash_orders_done', 'layi_dash_txns',
                   'layi_dash_products', 'layi_dash_staff', 'layi_dash_users',
                   'layi_dash_roles', 'layi_dash_settings', 'layi_dash_tasks',
                   'layi_dash_appts', 'layi_dash_audit', 'layi_dash_planner']) {
  ok('Basic may write ' + key, (await putState(basic.id, key)) === null);
}
ok('and may keep customers',
  (await boom(`insert into public.customers (business_id, name) values ($1,'Mrs Oladuja')`, [basic.id])) === null);
ok('and may record a payment',
  (await boom(`insert into public.transactions (business_id, kind, amount) values ($1,'sale',50000)`, [basic.id])) === null);

/* =====================================================================
   4. FORGING THE REQUEST DOES NOT HELP
   =====================================================================
   The point of the whole migration. A signed-in owner of a Basic studio
   going straight at the table, with no app in the way, is refused by the
   same trigger. */
section('A signed-in Basic owner cannot write it by hand either');
const forged = await asMember(basic.user,
  `insert into public.app_state (business_id, key, data) values ($1,'layi_dash_pots','[]'::jsonb)`,
  [basic.id]);
ok('a forged app_state write is refused', forged.error !== null, 'it succeeded');
ok('  with the same sentence the app would show',
  /Pro feature/.test(String(forged.error)), String(forged.error));

const forgedSup = await asMember(basic.user,
  `insert into public.suppliers (business_id, name) values ($1,'Backdoor')`, [basic.id]);
ok('a forged suppliers write is refused', forgedSup.error !== null, 'it succeeded');

/* and they cannot grant themselves the feature */
const selfGrant = await asMember(basic.user,
  `insert into public.plan_features (plan, feature) values ('starter','funds')`);
ok('a studio cannot add itself to a plan feature', selfGrant.error !== null, 'it succeeded');
ok('nor may it write the catalogue',
  (await one(`select has_table_privilege('authenticated','public.plan_feature_catalogue','UPDATE')`)) === false);
ok('nor change its own plan',
  (await asMember(basic.user, `update public.businesses set plan = 'pro' where id = $1`, [basic.id])).error !== null ||
  (await one(`select plan from public.businesses where id = $1`, [basic.id])) === 'starter');

/* =====================================================================
   5. GOING DOWN A PLAN TAKES NOTHING AWAY
   ===================================================================== */
section('A studio that drops to Basic keeps what it already had');
const dropped = await studio('pro');
await putState(dropped.id, 'layi_dash_pots');
await db.query(`insert into public.suppliers (business_id, name) values ($1,'Idumota Textiles')`, [dropped.id]);
await db.query(`update public.businesses set plan = 'starter' where id = $1`, [dropped.id]);

ok('the funds it recorded are still there',
  (await one(`select count(*)::int from public.app_state where business_id = $1 and key = 'layi_dash_pots'`, [dropped.id])) === 1);
ok('and the suppliers it added are still there',
  (await one(`select count(*)::int from public.suppliers where business_id = $1`, [dropped.id])) === 1);
ok('it simply cannot add another supplier',
  !!(await boom(`insert into public.suppliers (business_id, name) values ($1,'Another')`, [dropped.id])));
ok('nor change what it recorded',
  !!(await putState(dropped.id, 'layi_dash_pots')));

/* =====================================================================
   6. THE APP ASKS RATHER THAN ASSUMES
   ===================================================================== */
section('The app can read what it is allowed to do');
const mine = await asMember(basic.user,
  `select feature, allowed from public.my_plan_features() where business_id = $1 order by feature`, [basic.id]);
ok('my_plan_features answers for the signed-in studio', mine.rows.length === WANT.length,
  mine.error || (mine.rows.length + ' rows'));
ok('and every one of them is off for Basic', mine.rows.every(r => r.allowed === false),
  JSON.stringify(mine.rows.filter(r => r.allowed)));
const theirs = await asMember(pro.user,
  `select feature, allowed from public.my_plan_features() where business_id = $1`, [pro.id]);
ok('and every one is on for Pro', theirs.rows.length === WANT.length && theirs.rows.every(r => r.allowed === true),
  theirs.error || JSON.stringify(theirs.rows.filter(r => !r.allowed)));
ok('an anonymous caller cannot run it',
  (await one(`select bool_or(has_function_privilege('anon', p.oid, 'execute'))
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname='public' and p.proname='my_plan_features'`)) !== true);

/* =====================================================================
   7. THE FOUR SURFACES SAY THE SAME THING
   =====================================================================
   The database, the app, the comparison table and the pricing cards. The
   app and the two pages are JavaScript and HTML this suite cannot run, so
   they are read as text. A gate that is enforced at 8% and sold at 6% is
   worse than no gate: the customer is refused something they were told
   they had. */
section('The database, the app and the website agree');
const appSrc = readFileSync(join(repo, 'site/layi_dashboard.html'), 'utf8');
const pricing = readFileSync(join(repo, 'web/pricing.html'), 'utf8');

const appBlock = appSrc.slice(appSrc.indexOf('const PLAN_FEATURES={'),
                              appSrc.indexOf('function planIncludes'));
const appKeys = (appBlock.match(/^\s{2}([a-z]+):\s*\{/gm) || [])
  .map(m => m.trim().replace(':', '').replace('{', '').trim()).sort();
ok('the app declares the same ten features as the database',
  JSON.stringify(appKeys) === JSON.stringify(WANT), JSON.stringify(appKeys));

/* every feature is a "Not included" row for Basic on the pricing page */
const ROWS = {
  chase: 'Chase list and payment reminders',
  funds: 'Funds, owner pay and retained profit',
  inventory: 'Inventory with automatic deduction',
  suppliers: 'Vendors and suppliers',
  team: 'Rota, attendance and leave',
  payroll: 'Payroll, piece rates and commission',
  companylog: 'Company log',
  marketing: 'Marketing lists and message templates',
  reporting: 'Reporting lines, so managers see their own team'
};
for (const [feature, label] of Object.entries(ROWS)) {
  const row = new RegExp('<td>' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</td>([\\s\\S]{0,240}?)</tr>')
    .exec(pricing);
  ok('the table has a row for ' + feature, !!row, label);
  if (row) {
    const cells = row[1].match(/<td[\s\S]*?<\/td>/g) || [];
    ok('  and Basic is Not included', /Not included/.test(cells[0] || ''), (cells[0] || '').slice(0, 60));
    ok('  and Pro has it', /Yes/.test(cells[1] || ''), (cells[1] || '').slice(0, 60));
  }
}
/* full reports is graded rather than withheld, so it reads differently */
ok('the table grades Reports rather than withholding it',
  /<td>Reports<\/td>[\s\S]{0,200}?Basic[\s\S]{0,120}?Full/.test(pricing));

/* ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(60));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\nA plan difference the database does not hold is a price nobody is held to.');
  process.exit(1);
}
console.log('\nBasic cannot write a Pro feature, by the app or by hand, and a\nstudio that drops to Basic keeps everything it already had.');
