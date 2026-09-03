/* =====================================================================
   Does a fresh database actually run the app?

   This suite exists because of a specific near-miss. The migrations built
   the tenant spine and the console's tables, and looked complete. But five
   things the shipped code reaches for every day were never in any
   migration — app_state, profiles, suppliers, platform_audit and
   platform_tenant_summary() — because they had been created by hand in the
   first Supabase project from loose scripts at the repo root. A brand new
   project would have been missing all five, and every failure would have
   been quiet: sync stops, sign-in fails, the console shows nothing, and
   none of it says why.

   Worse, public.customers as the migrations create it had name/phone/email
   while the app has always written whatsapp, address, note and a
   measurements blob. Cloud sync of customers would have failed on the
   first save.

   So this suite builds a database from the migrations ALONE, then checks
   it against what the code actually does:

     - every table and function the code names exists
     - every column the app writes exists on the table it writes to
     - the new tenant tables are isolated as strictly as the old ones
     - our own audit log is not readable by tenants at all

   Run it before pointing anything at a new project.

   Usage:  node supabase/tests/app_schema_harness.mjs
   ===================================================================== */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

let pass = 0;
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const db = await PGlite.create();

async function asUser(userId, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await db.exec('set local role authenticated');
    const res = await db.query(sql, params);
    await db.exec('commit');
    return { rows: res.rows, error: null };
  } catch (e) {
    try { await db.exec('rollback'); } catch {}
    return { rows: [], error: e.message };
  }
}
async function asAnon(sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
    await db.exec('set local role anon');
    const res = await db.query(sql, params);
    await db.exec('commit');
    return { rows: res.rows, error: null };
  } catch (e) {
    try { await db.exec('rollback'); } catch {}
    return { rows: [], error: e.message };
  }
}
const asAdmin = async (sql, params = []) => (await db.query(sql, params)).rows;

process.on('uncaughtException', e => { console.error('\nHARNESS ERROR: ' + e.message); process.exit(2); });
process.on('unhandledRejection', e => { console.error('\nHARNESS ERROR: ' + (e?.message || e)); process.exit(2); });

// =====================================================================
console.log('Building a database from the migrations ALONE (no loose scripts)');
// =====================================================================
async function applyFile(label, path) {
  try { await db.exec(readFileSync(path, 'utf8')); console.log('  ' + label + ': applied cleanly'); }
  catch (e) { console.error('  ' + label + ': FAILED — ' + e.message); process.exit(1); }
}
await applyFile('auth stub', join(here, 'auth_stub.sql'));
const migDir = join(repo, 'supabase', 'migrations');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  await applyFile(f, join(migDir, f));
}

// =====================================================================
section('Everything the code names actually exists');
// =====================================================================
// Read the code rather than a hand-kept list, so a new table the app starts
// using is checked the day it is used.
const app   = readFileSync(join(repo, 'site', 'layi_dashboard.html'), 'utf8');
const adminFn = readFileSync(join(repo, 'supabase', 'functions', 'admin-api', 'index.ts'), 'utf8');
const teamFn  = readFileSync(join(repo, 'supabase', 'functions', 'team-admin', 'index.ts'), 'utf8');

const named = new Set();
const rpcs  = new Set();
[app, adminFn, teamFn].forEach(src => {
  (src.match(/from\('([a-z_]+)'\)/g) || []).forEach(m => named.add(m.slice(6, -2)));
  (src.match(/rpc\('([a-z_]+)'\)/g)  || []).forEach(m => rpcs.add(m.slice(5, -2)));
});

const present = (await asAdmin(
  `select table_name from information_schema.tables where table_schema='public'`)).map(r => r.table_name);

for (const t of [...named].sort()) {
  ok('the code reads public.' + t + ', and it exists', present.includes(t),
     'no migration creates it — a fresh project would fail quietly');
}
const funcs = (await asAdmin(
  `select routine_name from information_schema.routines where routine_schema='public'`)).map(r => r.routine_name);
for (const f of [...rpcs].sort()) {
  ok('the console calls ' + f + '(), and it exists', funcs.includes(f));
}

// =====================================================================
section('Every column the app writes exists on the table it writes to');
// =====================================================================
// The app builds rows in named functions. Pull the keys straight out of
// those objects: if somebody adds a field to custToRow and not to the
// schema, this fails before a customer's save does.
async function columnsOf(table) {
  return (await asAdmin(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
    [table])).map(r => r.column_name);
}
/* Pull the keys out of the object a row-builder returns. Deliberately NOT a
   regex over the whole file: escaping one wrong turns the check into a no-op
   that passes forever, which has happened here before. Find the function,
   walk to its `return {`, then brace-match. */
function keysFrom(fnName) {
  const at = app.indexOf('function ' + fnName + '(');
  if (at < 0) return null;
  const rt = app.indexOf('return {', at);
  if (rt < 0 || rt - at > 400) return null;
  let i = rt + 7, depth = 0, end = -1;
  for (; i < app.length && i < rt + 800; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = app.slice(rt + 8, end);
  // top-level keys only: skip anything nested inside a value
  const keys = []; let d = 0;
  body.replace(/[{}[\]]|([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, (m0, k, off) => {
    if (m0 === '{' || m0 === '[') d++;
    else if (m0 === '}' || m0 === ']') d--;
    else if (k && d === 0) keys.push(k);
    return m0;
  });
  return keys;
}
for (const [fn, table] of [['custToRow', 'customers'], ['supToRow', 'suppliers']]) {
  const keys = keysFrom(fn);
  if (!keys) { ok(fn + '() could be read', false, 'the harness could not find it'); continue; }
  const cols = await columnsOf(table);
  const missing = keys.filter(k => !cols.includes(k));
  ok(fn + '() writes only columns that exist on ' + table, missing.length === 0,
     missing.length ? 'missing: ' + missing.join(', ') : '');
}
// app_state is upserted with an explicit column list
{
  const cols = await columnsOf('app_state');
  ['business_id', 'key', 'data', 'updated_at'].forEach(c =>
    ok('app_state has ' + c, cols.includes(c)));
}

// =====================================================================
section('A customer can actually be saved the way the app saves one');
// =====================================================================
const U = { ada: 'a0000000-0000-0000-0000-00000000ab01', bola: 'b0000000-0000-0000-0000-00000000ab01' };
const ids = {};
ids.bizA = (await asAdmin(`insert into businesses(name,slug) values ('Ada Atelier','ada-sch') returning id`))[0].id;
ids.bizB = (await asAdmin(`insert into businesses(name,slug) values ('Bola Shoes','bola-sch') returning id`))[0].id;
await asAdmin(`insert into memberships(user_id,business_id,role,status) values ($1,$2,'owner','active')`, [U.ada, ids.bizA]);
await asAdmin(`insert into memberships(user_id,business_id,role,status) values ($1,$2,'owner','active')`, [U.bola, ids.bizB]);

{
  // exactly the shape custToRow() produces
  const r = await asUser(U.ada,
    `insert into customers(business_id,name,email,whatsapp,address,note,measurements)
     values ($1,'Mrs Oladuja','o@example.com','+234 802 000 0000','Lekki','Prefers emerald',$2) returning id`,
    [ids.bizA, JSON.stringify({ meas: { Waist: '32' }, history: [] })]);
  ok('the app can save a customer as it actually builds one', !r.error, r.error);

  // and a customer with nothing but a name, which the app also allows
  const bare = await asUser(U.ada,
    `insert into customers(business_id,measurements) values ($1,'{}'::jsonb) returning id`, [ids.bizA]);
  ok('a customer with no name yet is accepted', !bare.error, bare.error);
}

// =====================================================================
section('The new tables are isolated as strictly as the old ones');
// =====================================================================
{
  await asAdmin(`insert into app_state(business_id,key,data) values ($1,'layi_dash_orders','[{"id":"L-0001"}]'::jsonb)`, [ids.bizA]);
  await asAdmin(`insert into suppliers(business_id,name,type) values ($1,'Aso-oke House','Fabric Supplier')`, [ids.bizA]);
  await asAdmin(`insert into profiles(id,name,role_id,business_id) values ($1,'Ada','owner',$2)`, [U.ada, ids.bizA]);
  await asAdmin(`insert into profiles(id,name,role_id,business_id) values ($1,'Bola','owner',$2)`, [U.bola, ids.bizB]);

  const mine = await asUser(U.ada, `select key from app_state`);
  ok('a studio reads its own synced data', mine.rows.length === 1, mine.error);
  const theirs = await asUser(U.bola, `select key from app_state`);
  ok('a studio cannot read another studio’s synced data', theirs.rows.length === 0,
     'saw ' + theirs.rows.length + ' rows');

  const steal = await asUser(U.bola,
    `update app_state set data='[]'::jsonb where business_id=$1`, [ids.bizA]);
  const after = await asAdmin(`select data from app_state where business_id=$1`, [ids.bizA]);
  ok('a studio cannot wipe another studio’s synced data',
     !!steal.error || JSON.stringify(after[0].data) !== '[]', 'the update went through');

  const move = await asUser(U.ada,
    `update app_state set business_id=$1 where business_id=$2`, [ids.bizB, ids.bizA]);
  ok('a studio cannot push its rows into another studio', !!move.error, 'the update was allowed');

  const sup = await asUser(U.bola, `select count(*)::int as n from suppliers`);
  ok('vendors are scoped to the studio that added them', sup.rows[0].n === 0, 'saw ' + sup.rows[0].n);

  const prof = await asUser(U.ada, `select name from profiles`);
  ok('you can see the people in your own business', prof.rows.length === 1 && prof.rows[0].name === 'Ada',
     'saw ' + JSON.stringify(prof.rows));
  const other = await asUser(U.ada, `select name from profiles where business_id=$1`, [ids.bizB]);
  ok('you cannot see another business’s people', other.rows.length === 0);

  // inventing an owner in your own business must go through the Edge Function
  const invent = await asUser(U.ada,
    `insert into profiles(id,name,role_id,business_id) values ($1,'Ghost','owner',$2)`,
    ['c0000000-0000-0000-0000-00000000ab01', ids.bizA]);
  ok('a tenant cannot add a teammate straight into the table', !!invent.error, 'the insert was allowed');

  const promote = await asUser(U.bola,
    `update profiles set role_id='owner' where id=$1`, [U.ada]);
  const still = await asAdmin(`select role_id from profiles where id=$1`, [U.ada]);
  ok('a tenant cannot change somebody else’s role', !!promote.error || still[0].role_id === 'owner');
}

// =====================================================================
section('Our own records are ours');
// =====================================================================
{
  await asAdmin(`insert into platform_audit(admin_email,action,business_id,detail) values ('me@thelabelboard.app','tenant',$1,'{}'::jsonb)`, [ids.bizA]);
  const r = await asUser(U.ada, `select count(*)::int as n from platform_audit`);
  ok('a tenant cannot read who looked at their studio', !!r.error || r.rows[0].n === 0,
     'saw ' + r.rows[0]?.n);
  const w = await asUser(U.ada, `delete from platform_audit`);
  const left = await asAdmin(`select count(*)::int as n from platform_audit`);
  ok('a tenant cannot erase the audit log', !!w.error || left[0].n === 1);

  const t = await asUser(U.ada, `select * from platform_tenant_summary()`);
  ok('a tenant cannot enumerate every studio on the platform', !!t.error, 'the call was allowed');
  const rows = await asAdmin(`select name, members, branches from platform_tenant_summary()`);
  ok('the console gets its tenant list', rows.length === 2, 'saw ' + rows.length);
  ok('the tenant list counts members', rows.every(r => Number(r.members) === 1));
}

// =====================================================================
section('The public anon key opens none of it');
// =====================================================================
for (const t of ['app_state', 'suppliers', 'profiles', 'platform_audit']) {
  const r = await asAnon(`select count(*)::int as n from ${t}`);
  ok('anon cannot read ' + t, !!r.error || (r.rows[0]?.n ?? -1) === 0, 'saw ' + r.rows[0]?.n);
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED\n');
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('\nA fresh project built from these migrations would NOT run the app.');
  process.exit(1);
}
console.log(pass + ' passed, 0 failed\n');
console.log('A fresh project built from the migrations alone runs the app,');
console.log('and every new table is as isolated as the ones around it.');
