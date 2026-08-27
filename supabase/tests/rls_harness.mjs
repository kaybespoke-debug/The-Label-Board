/* =====================================================================
   Adversarial test of the tenant isolation policies.

   The point of this file is not to check that the app works. It is to
   attack the policies from the position of a signed-in tenant who is
   trying to reach another tenant's data, and to fail loudly if any of it
   gets through.

   It runs the real migration against a real Postgres (PGlite, Postgres 18
   compiled to WASM), so the policies under test are the ones that will be
   deployed, not a description of them.

   Two rules the tests hold themselves to:

     - Impersonation is done the way Supabase does it: SET LOCAL ROLE
       authenticated plus a request.jwt.claims GUC. Running as the
       superuser would bypass RLS entirely and every test would pass while
       proving nothing.
     - A blocked read must return zero rows, not an error. An error tells
       an attacker the row exists.

   Usage:  node supabase/tests/rls_harness.mjs
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

function section(title) { console.log('\n' + title); }

const db = await PGlite.create();

/* ---------------------------------------------------------------------
   Run a statement as a signed-in user, exactly as the API layer would:
   the authenticated role, with the caller's id in the JWT claims.
   Wrapped in a transaction so SET LOCAL is scoped to this call.
   --------------------------------------------------------------------- */
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

/* An anonymous caller: the anon role, no sub claim. */
async function asAnon(sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ role: 'anon' })]);
    await db.exec('set local role anon');
    const res = await db.query(sql, params);
    await db.exec('commit');
    return { rows: res.rows, error: null };
  } catch (e) {
    try { await db.exec('rollback'); } catch {}
    return { rows: [], error: e.message };
  }
}

/* Setup and fixtures run with full rights, like a migration or the
   service-role gateway would. */
async function asAdmin(sql, params = []) {
  const res = await db.query(sql, params);
  return res.rows;
}

/* PGlite attaches the whole WASM bundle to its errors, which buries the one
   line that matters. Keep the message, drop the rest. */
process.on('uncaughtException', e => {
  console.error('\nUNEXPECTED ERROR in the harness itself: ' + e.message);
  if (e.detail) console.error('  detail: ' + e.detail);
  if (e.query)  console.error('  query: ' + String(e.query).replace(/\s+/g, ' ').slice(0, 160));
  process.exit(2);
});
process.on('unhandledRejection', e => {
  console.error('\nUNEXPECTED ERROR in the harness itself: ' + (e?.message || e));
  if (e?.detail) console.error('  detail: ' + e.detail);
  if (e?.query)  console.error('  query: ' + String(e.query).replace(/\s+/g, ' ').slice(0, 160));
  process.exit(2);
});

// =====================================================================
console.log('Applying auth stub and the tenant isolation migration');
// =====================================================================
async function applyFile(label, path) {
  try {
    await db.exec(readFileSync(path, 'utf8'));
    console.log('  ' + label + ': applied cleanly');
  } catch (e) {
    // PGlite's raw error object is enormous; only the message is useful.
    console.error('  ' + label + ': FAILED — ' + e.message);
    if (e.hint) console.error('    hint: ' + e.hint);
    process.exit(1);
  }
}
await applyFile('auth stub', join(here, 'auth_stub.sql'));

// Every migration, in the order the CLI will apply them. Applying the whole
// set rather than one file is deliberate: the ordering bug that stopped these
// from applying at all only shows up when they run together.
const migDir = join(repo, 'supabase', 'migrations');
const migrations = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
for (const f of migrations) await applyFile(f, join(migDir, f));

// =====================================================================
// Fixtures: two unrelated studios, plus a third with two branches.
// =====================================================================
const U = {
  aOwner:   '11111111-1111-1111-1111-111111111111',
  aStaff:   '11111111-1111-1111-1111-111111111112',
  bOwner:   '22222222-2222-2222-2222-222222222221',
  cOwner:   '33333333-3333-3333-3333-333333333331',
  cBranch1: '33333333-3333-3333-3333-333333333332', // pinned to branch 1
  outsider: '99999999-9999-9999-9999-999999999999', // no membership at all
  platform: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
};

const ids = {};
async function seed() {
  const mk = async (slug, name) =>
    (await asAdmin('insert into businesses(name, slug) values ($1,$2) returning id', [name, slug]))[0].id;

  ids.bizA = await mk('studio-a', 'Studio A');
  ids.bizB = await mk('studio-b', 'Studio B');
  ids.bizC = await mk('studio-c', 'Studio C');

  const mkBranch = async (biz, name) =>
    (await asAdmin('insert into branches(business_id, name) values ($1,$2) returning id', [biz, name]))[0].id;

  ids.brA  = await mkBranch(ids.bizA, 'A Lagos');
  ids.brB  = await mkBranch(ids.bizB, 'B Abuja');
  ids.brC1 = await mkBranch(ids.bizC, 'C Ikeja');
  ids.brC2 = await mkBranch(ids.bizC, 'C Lekki');

  const mkMem = async (biz, user, role, branch = null) =>
    asAdmin('insert into memberships(business_id, user_id, role, branch_id) values ($1,$2,$3,$4)',
      [biz, user, role, branch]);

  await mkMem(ids.bizA, U.aOwner, 'owner');
  await mkMem(ids.bizA, U.aStaff, 'staff');
  await mkMem(ids.bizB, U.bOwner, 'owner');
  await mkMem(ids.bizC, U.cOwner, 'owner');
  await mkMem(ids.bizC, U.cBranch1, 'staff', ids.brC1);   // one branch only

  await asAdmin('insert into platform_admins(id, email) values ($1,$2)', [U.platform, 'kayode@thelabelboard.com']);

  // A customer, product, order, item and transaction in each of A and B.
  for (const [k, biz, br] of [['A', ids.bizA, ids.brA], ['B', ids.bizB, ids.brB]]) {
    ids['cust' + k] = (await asAdmin(
      'insert into customers(business_id, branch_id, name) values ($1,$2,$3) returning id',
      [biz, br, 'Customer ' + k]))[0].id;
    ids['prod' + k] = (await asAdmin(
      'insert into products(business_id, name, price) values ($1,$2,$3) returning id',
      [biz, 'Product ' + k, 1000]))[0].id;
    ids['ord' + k] = (await asAdmin(
      'insert into orders(business_id, branch_id, customer_id, ref, total) values ($1,$2,$3,$4,$5) returning id',
      [biz, br, ids['cust' + k], 'REF-' + k, 1000]))[0].id;
    ids['item' + k] = (await asAdmin(
      'insert into order_items(business_id, order_id, product_id, qty, price) values ($1,$2,$3,1,1000) returning id',
      [biz, ids['ord' + k], ids['prod' + k]]))[0].id;
    ids['txn' + k] = (await asAdmin(
      'insert into transactions(business_id, branch_id, order_id, amount) values ($1,$2,$3,1000) returning id',
      [biz, br, ids['ord' + k]]))[0].id;
    ids['staff' + k] = (await asAdmin(
      'insert into staff(business_id, branch_id, name, basic) values ($1,$2,$3,250000) returning id',
      [biz, br, 'Employee ' + k]))[0].id;
  }

  // Studio C: one order in each branch.
  ids.ordC1 = (await asAdmin(
    'insert into orders(business_id, branch_id, ref) values ($1,$2,$3) returning id',
    [ids.bizC, ids.brC1, 'C1']))[0].id;
  ids.ordC2 = (await asAdmin(
    'insert into orders(business_id, branch_id, ref) values ($1,$2,$3) returning id',
    [ids.bizC, ids.brC2, 'C2']))[0].id;
}
await seed();
console.log('  fixtures: 3 businesses, 4 branches, 5 memberships, data in each');

const TENANT_TABLES = ['customers','products','orders','order_items','transactions','staff','attendance'];

// =====================================================================
section('1. Structure: nothing is left unprotected');
// =====================================================================
{
  const rows = await asAdmin(`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and c.relname = any($1)`, [TENANT_TABLES]);
  ok('RLS enabled on all ' + TENANT_TABLES.length + ' tenant tables',
    rows.length === TENANT_TABLES.length && rows.every(r => r.relrowsecurity),
    rows.filter(r => !r.relrowsecurity).map(r => r.relname).join(','));
  ok('RLS FORCED on all tenant tables (owner is subject to it too)',
    rows.every(r => r.relforcerowsecurity),
    rows.filter(r => !r.relforcerowsecurity).map(r => r.relname).join(','));

  const nn = await asAdmin(`
    select table_name, is_nullable from information_schema.columns
    where table_schema='public' and column_name='business_id' and table_name = any($1)`, [TENANT_TABLES]);
  ok('every tenant table has business_id',
    nn.length === TENANT_TABLES.length,
    'found ' + nn.length);
  ok('business_id is NOT NULL everywhere',
    nn.every(r => r.is_nullable === 'NO'),
    nn.filter(r => r.is_nullable !== 'NO').map(r => r.table_name).join(','));

  // The clause whose absence is the classic hole.
  const missing = await asAdmin(`
    select tablename, policyname, cmd from pg_policies
    where schemaname='public' and tablename = any($1)
      and cmd in ('INSERT','UPDATE','ALL') and with_check is null`, [TENANT_TABLES]);
  ok('no write policy is missing WITH CHECK', missing.length === 0,
    missing.map(r => r.tablename + '.' + r.policyname).join(','));

  const pol = await asAdmin(`
    select tablename, count(*)::int n from pg_policies
    where schemaname='public' and tablename = any($1) group by tablename`, [TENANT_TABLES]);
  ok('all four commands covered on every tenant table',
    pol.length === TENANT_TABLES.length && pol.every(r => r.n === 4),
    pol.filter(r => r.n !== 4).map(r => r.tablename + '=' + r.n).join(','));

  const sd = await asAdmin(`
    select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.prosecdef`);
  // Every one of them, not a fixed count of them. Pinning the number at 3
  // made this fail the moment the partner portal added its own helpers,
  // which is a false alarm dressed as a security failure. The property
  // worth holding is that no SECURITY DEFINER function in app is ever left
  // with a mutable search_path; the floor keeps the check from passing
  // vacuously if the helpers were dropped altogether.
  const unpinned = sd.filter(r => !(r.proconfig || []).some(c => c.startsWith('search_path=')));
  ok('every SECURITY DEFINER function in app pins its search_path',
    sd.length >= 3 && unpinned.length === 0,
    unpinned.length ? unpinned.map(r => r.proname).join(', ') : 'only ' + sd.length + ' found');

  const vw = await asAdmin(`
    select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v'`);
  ok('every view is security_invoker (a view otherwise runs as its owner)',
    vw.length > 0 && vw.every(r => (r.reloptions || []).some(o => o.replace(/\s/g,'') === 'security_invoker=true')),
    vw.map(r => r.relname + ':' + JSON.stringify(r.reloptions)).join(' '));
}

// =====================================================================
section('2. Anonymous callers get nothing');
// =====================================================================
for (const t of TENANT_TABLES) {
  const r = await asAnon(`select * from ${t}`);
  ok('anon cannot read ' + t, r.rows.length === 0);
}
{
  const r = await asAnon('select * from businesses');
  ok('anon cannot read businesses', r.rows.length === 0);
  const s = await asAnon('select * from order_summary');
  ok('anon cannot read the order_summary view', s.rows.length === 0);
}

// =====================================================================
section('3. A member sees their own business and no more');
// =====================================================================
{
  const own = await asUser(U.aOwner, 'select id from orders');
  ok('Studio A sees its own orders', own.rows.length === 1 && own.rows[0].id === ids.ordA,
    JSON.stringify(own.rows));

  const all = await asUser(U.aOwner, 'select count(*)::int n from orders');
  ok('Studio A order count is 1, not 4', all.rows[0]?.n === 1, 'got ' + all.rows[0]?.n);

  // The attack that matters: name the row directly.
  const direct = await asUser(U.aOwner, 'select * from orders where id = $1', [ids.ordB]);
  ok('Studio A cannot read Studio B order by id', direct.rows.length === 0);
  ok('  and is told nothing, rather than refused', direct.error === null,
    'error was: ' + direct.error);

  for (const [t, key] of [['customers','custB'],['products','prodB'],['transactions','txnB'],['staff','staffB']]) {
    const r = await asUser(U.aOwner, `select * from ${t} where id = $1`, [ids[key]]);
    ok(`Studio A cannot read Studio B ${t} by id`, r.rows.length === 0);
  }

  // The child table people forget.
  const item = await asUser(U.aOwner, 'select * from order_items where id = $1', [ids.itemB]);
  ok('Studio A cannot read Studio B order_items by id', item.rows.length === 0);

  // And via a join, which is how it usually leaks.
  const joined = await asUser(U.aOwner,
    'select i.* from order_items i join orders o on o.id = i.order_id');
  ok('joining orders to items exposes only own rows', joined.rows.length === 1,
    'got ' + joined.rows.length);

  // The view.
  const view = await asUser(U.aOwner, 'select * from order_summary');
  ok('order_summary view is filtered to own business', view.rows.length === 1,
    'got ' + view.rows.length);

  // A user with no membership at all.
  const nobody = await asUser(U.outsider, 'select count(*)::int n from orders');
  ok('a signed-in user with no membership sees nothing', nobody.rows[0]?.n === 0,
    'got ' + nobody.rows[0]?.n);
}

// =====================================================================
section('4. Writes cannot cross the boundary');
// =====================================================================
{
  // Stamping a row with someone else's business_id.
  const ins = await asUser(U.aOwner,
    'insert into orders(business_id, ref) values ($1,$2) returning id', [ids.bizB, 'STOLEN']);
  ok('Studio A cannot INSERT a row into Studio B', ins.rows.length === 0 && ins.error !== null,
    ins.error ? '' : 'insert succeeded');

  // Updating another tenant's row.
  const upd = await asUser(U.aOwner,
    'update orders set total = 999999 where id = $1 returning id', [ids.ordB]);
  ok('Studio A cannot UPDATE a Studio B row', upd.rows.length === 0);
  const check = await asAdmin('select total from orders where id = $1', [ids.ordB]);
  ok('  Studio B row is unchanged', Number(check[0].total) === 1000, 'total is ' + check[0].total);

  // The WITH CHECK case: moving your own row into another tenant.
  const move = await asUser(U.aOwner,
    'update orders set business_id = $1 where id = $2 returning id', [ids.bizB, ids.ordA]);
  ok('Studio A cannot move its own row into Studio B', move.rows.length === 0 && move.error !== null,
    move.error ? '' : 'update succeeded');
  const still = await asAdmin('select business_id from orders where id = $1', [ids.ordA]);
  ok('  the row still belongs to Studio A', still[0].business_id === ids.bizA);

  // Deleting another tenant's row.
  const del = await asUser(U.aOwner, 'delete from orders where id = $1 returning id', [ids.ordB]);
  ok('Studio A cannot DELETE a Studio B row', del.rows.length === 0);
  const alive = await asAdmin('select count(*)::int n from orders where id = $1', [ids.ordB]);
  ok('  Studio B row still exists', alive[0].n === 1);

  // Stitching a child of one tenant onto a parent of another. Blocked by
  // the composite FK even before any policy is consulted.
  const stitch = await asUser(U.aOwner,
    'insert into order_items(business_id, order_id, qty, price) values ($1,$2,1,1) returning id',
    [ids.bizA, ids.ordB]);
  ok('cannot attach an item to another tenant\'s order', stitch.rows.length === 0 && stitch.error !== null,
    stitch.error ? '' : 'insert succeeded');

  // Same attempt at the schema level, with full rights: must still fail,
  // because this is a constraint rather than a policy.
  let fkHeld = false;
  try {
    await asAdmin('insert into order_items(business_id, order_id, qty, price) values ($1,$2,1,1)',
      [ids.bizA, ids.ordB]);
  } catch { fkHeld = true; }
  ok('the composite FK blocks it even for the service role', fkHeld);

  // A legitimate write must still work, or the policy is just a wall.
  const good = await asUser(U.aOwner,
    'insert into orders(business_id, branch_id, ref) values ($1,$2,$3) returning id',
    [ids.bizA, ids.brA, 'LEGIT']);
  ok('a member CAN write within their own business', good.rows.length === 1, good.error || '');
  if (good.rows.length) await asAdmin('delete from orders where id = $1', [good.rows[0].id]);
}

// =====================================================================
section('5. Branch scoping inside one business');
// =====================================================================
{
  const whole = await asUser(U.cOwner, 'select count(*)::int n from orders');
  ok('an unpinned member sees both branches', whole.rows[0]?.n === 2, 'got ' + whole.rows[0]?.n);

  const pinned = await asUser(U.cBranch1, 'select ref from orders order by ref');
  ok('a branch-pinned member sees only their branch',
    pinned.rows.length === 1 && pinned.rows[0].ref === 'C1',
    JSON.stringify(pinned.rows));

  const other = await asUser(U.cBranch1, 'select * from orders where id = $1', [ids.ordC2]);
  ok('a branch-pinned member cannot read the other branch by id', other.rows.length === 0);

  const cross = await asUser(U.cBranch1,
    'insert into orders(business_id, branch_id, ref) values ($1,$2,$3) returning id',
    [ids.bizC, ids.brC2, 'SNEAK']);
  ok('a branch-pinned member cannot write into the other branch',
    cross.rows.length === 0 && cross.error !== null, cross.error ? '' : 'insert succeeded');

  // Business-wide rows stay visible to a pinned member: products have no
  // branch, and a tailor in one studio still needs the catalogue.
  await asAdmin('insert into products(business_id, name) values ($1,$2)', [ids.bizC, 'Fabric']);
  const cat = await asUser(U.cBranch1, 'select count(*)::int n from products');
  ok('a branch-pinned member still sees business-wide rows', cat.rows[0]?.n === 1,
    'got ' + cat.rows[0]?.n);

  // Branch pinning must not become a way out of the business.
  const escape = await asUser(U.cBranch1, 'select count(*)::int n from orders where business_id = $1', [ids.bizA]);
  ok('branch pinning does not leak across businesses', escape.rows[0]?.n === 0);
}

// =====================================================================
section('6. Membership and the spine cannot be self-escalated');
// =====================================================================
{
  const own = await asUser(U.aStaff, 'select count(*)::int n from memberships');
  ok('staff see only their own membership row', own.rows[0]?.n === 1, 'got ' + own.rows[0]?.n);

  const team = await asUser(U.aOwner, 'select count(*)::int n from memberships');
  ok('an owner sees the whole team', team.rows[0]?.n === 2, 'got ' + team.rows[0]?.n);

  // The escalation that matters: granting yourself a membership elsewhere.
  const grab = await asUser(U.aStaff,
    'insert into memberships(business_id, user_id, role) values ($1,$2,$3) returning id',
    [ids.bizB, U.aStaff, 'owner']);
  ok('a user cannot grant themselves membership of another business',
    grab.rows.length === 0 && grab.error !== null, grab.error ? '' : 'insert succeeded');

  const promote = await asUser(U.aStaff,
    'update memberships set role = $1 where user_id = $2 returning id', ['owner', U.aStaff]);
  ok('staff cannot promote themselves to owner', promote.rows.length === 0);
  const role = await asAdmin('select role from memberships where user_id = $1', [U.aStaff]);
  ok('  their role is still staff', role[0].role === 'staff', 'got ' + role[0].role);

  const bizes = await asUser(U.aOwner, 'select count(*)::int n from businesses');
  ok('a member sees only their own business record', bizes.rows[0]?.n === 1, 'got ' + bizes.rows[0]?.n);

  const newBiz = await asUser(U.aOwner,
    'insert into businesses(name, slug) values ($1,$2) returning id', ['Rogue', 'rogue']);
  ok('nobody can create a business from a browser session',
    newBiz.rows.length === 0 && newBiz.error !== null, newBiz.error ? '' : 'insert succeeded');

  const killBiz = await asUser(U.aOwner, 'delete from businesses where id = $1 returning id', [ids.bizA]);
  ok('nobody can delete a business from a browser session', killBiz.rows.length === 0);

  // platform_admins has RLS on and no policy at all.
  const pa = await asUser(U.aOwner, 'select count(*)::int n from platform_admins');
  ok('platform_admins is invisible to tenants', (pa.rows[0]?.n ?? 0) === 0);
  const paAdd = await asUser(U.aOwner,
    'insert into platform_admins(id, email) values ($1,$2) returning id', [U.aStaff, 'x@y.z']);
  ok('a tenant cannot make themselves a platform admin',
    paAdd.rows.length === 0 && paAdd.error !== null, paAdd.error ? '' : 'insert succeeded');
}

// =====================================================================
section('7. Platform admins get no RLS shortcut');
// =====================================================================
{
  // Being a platform admin must NOT be enough to read tenant data from a
  // browser session. That is a deliberate decision: cross-tenant reads go
  // through the Edge Function gateway so they can be checked and logged.
  const asPlatform = await asUser(U.platform, 'select count(*)::int n from orders');
  ok('a platform admin session reads no tenant rows directly',
    asPlatform.rows[0]?.n === 0, 'got ' + asPlatform.rows[0]?.n);

  const knows = await asUser(U.platform, 'select app.is_platform_admin() as v');
  ok('  but app.is_platform_admin() does identify them (for the gateway)',
    knows.rows[0]?.v === true, JSON.stringify(knows.rows) + (knows.error || ''));

  const tenantClaim = await asUser(U.aOwner, 'select app.is_platform_admin() as v');
  ok('  and a tenant is not mistaken for one', tenantClaim.rows[0]?.v === false,
    JSON.stringify(tenantClaim.rows));

  // auth.uid() must be null-safe with no session at all, not raise.
  const noSession = await asAnon('select auth.uid() is null as v');
  ok('  auth.uid() is null rather than an error when unauthenticated',
    noSession.rows[0]?.v === true, noSession.error || JSON.stringify(noSession.rows));

  // The service role, used only server side, does see everything.
  const svc = await asAdmin('select count(*)::int n from orders');
  ok('the service role can read across tenants (for the gateway)', svc[0].n >= 4,
    'got ' + svc[0].n);
}

// =====================================================================
section('8. A new table added later is not silently exposed');
// =====================================================================
{
  // The realistic future failure: someone adds a table and forgets RLS.
  // This asserts the audit query that should run in CI catches it.
  await asAdmin(`create table public.measurements (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id),
    chest numeric)`);
  await asAdmin('grant select on public.measurements to authenticated');
  await asAdmin('insert into measurements(business_id, chest) values ($1, 42)', [ids.bizB]);

  const unguarded = await asAdmin(`
    select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and exists (select 1 from information_schema.columns col
                  where col.table_schema='public' and col.table_name=c.relname
                    and col.column_name='business_id')
      and not c.relrowsecurity`);
  ok('the audit query names a tenant table left without RLS',
    unguarded.length === 1 && unguarded[0].relname === 'measurements',
    JSON.stringify(unguarded.map(r => r.relname)));

  const leak = await asUser(U.aOwner, 'select count(*)::int n from measurements');
  ok('and confirms it really does leak until RLS is added', leak.rows[0]?.n === 1,
    'got ' + leak.rows[0]?.n);

  await asAdmin('drop table public.measurements');
}

// =====================================================================
section('9. Whole-schema audit across every migration');
// =====================================================================
{
  // The check that would have caught tlb_audit_log and tlb_trial_history.
  // Anything other than an empty result here is a live exposure.
  const un = await asAdmin('select table_name, is_tenant_table from app.unprotected_tables order by 1');
  ok('no table in the public schema is left without RLS', un.length === 0,
    un.map(r => r.table_name + (r.is_tenant_table ? ' (TENANT DATA)' : '')).join(', '));

  const anonGrants = await asAdmin(
    "select table_name, privilege_type from information_schema.role_table_grants " +
    "where grantee = 'anon' and table_schema = 'public' order by 1, 2");
  ok('the anon role holds no grants on any public table', anonGrants.length === 0,
    anonGrants.slice(0, 6).map(r => r.table_name + ':' + r.privilege_type).join(', '));

  const tables = await asAdmin(
    "select count(*)::int n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace " +
    "where ns.nspname = 'public' and c.relkind = 'r'");
  console.log('  (' + tables[0].n + ' tables in public, every one with RLS on)');

  // The audit log: readable by a platform admin, by nobody else, and
  // editable by no one at all.
  const st = await asAdmin(
    "insert into tlb_staff(auth_user_id, name, email, role) " +
    "values ($1,'Audit Fixture','fixture@thelabelboard.com','owner') returning id", [U.platform]);
  await asAdmin('insert into tlb_audit_log(staff_id, action) values ($1, $2)', [st[0].id, 'did_a_thing']);

  const byAdmin = await asUser(U.platform, 'select count(*)::int n from tlb_audit_log');
  ok('a platform admin can read the audit log', byAdmin.rows[0]?.n === 1,
    'got ' + byAdmin.rows[0]?.n + ' ' + (byAdmin.error || ''));

  const byTenant = await asUser(U.aOwner, 'select count(*)::int n from tlb_audit_log');
  ok('a tenant cannot read the audit log', (byTenant.rows[0]?.n ?? 0) === 0);

  const tamper = await asUser(U.platform,
    'update tlb_audit_log set action = $1 returning id', ['covered_tracks']);
  ok('even a platform admin cannot edit the audit log', tamper.rows.length === 0);

  const wipe = await asUser(U.platform, 'delete from tlb_audit_log returning id');
  ok('nor delete from it', wipe.rows.length === 0);

  // Trial history holds emails and IP addresses: no session, at all.
  await asAdmin(
    "insert into tlb_trial_history(customer_email, trial_start_date, ip_address) " +
    "values ('someone@example.com', current_date, '203.0.113.7')");
  const trialAdmin = await asUser(U.platform, 'select count(*)::int n from tlb_trial_history');
  ok('trial history (emails and IPs) is unreachable even for a platform admin',
    (trialAdmin.rows[0]?.n ?? 0) === 0, 'got ' + trialAdmin.rows[0]?.n);
  const trialTenant = await asUser(U.aOwner, 'select count(*)::int n from tlb_trial_history');
  ok('  and certainly for a tenant', (trialTenant.rows[0]?.n ?? 0) === 0);
  const trialAnon = await asAnon('select count(*)::int n from tlb_trial_history');
  ok('  and for anonymous callers', (trialAnon.rows[0]?.n ?? 0) === 0);
}

// =====================================================================
console.log('\n' + '='.repeat(66));
if (failures.length === 0) {
  console.log('ALL ' + pass + ' CHECKS PASSED');
  console.log('No tenant can read, write, alter or delete another tenant\'s data.');
} else {
  console.log(pass + ' passed, ' + failures.length + ' FAILED:');
  failures.forEach(f => console.log('  - ' + f));
}
console.log('='.repeat(66));
await db.close();
process.exit(failures.length ? 1 : 0);
