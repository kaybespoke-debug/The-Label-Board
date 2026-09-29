/* =====================================================================
   P2 — the orders leave the blob, and the blob stops being a way round
   seeCost and seeContact.

   THE SHAPE HERE IS THE SHAPE ON PRODUCTION. The 68 live orders were
   surveyed field by field before this was written, and the fixture carries
   all of it: `value` rather than `total`, `costs` rather than `cost`, no
   `status` field at all, and — the part that matters — three sensitive
   things that hide one level down where a field-list glance does not find
   them:

       saleItems[].unitCost     a cost, inside a sold item
       delivery.location        a delivery address, inside the delivery block
       commissions[].amount     what a person earned

   A fixture built from the schema instead of from the data would have
   missed all three, which is exactly how the deployed migration function
   came to strip `cost`, `email`, `phone` and `whatsapp` — four names, three
   of which no order has ever had.

   Every refusal is shown next to the same read succeeding for somebody who
   is allowed it. A check that only ever sees the refusal cannot tell a
   working rule from an empty table.

   Usage:  node supabase/tests/orders_migration_harness.mjs
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

/* =====================================================================
   THE STUDIO
   ===================================================================== */
const BIZ = '11111111-1111-1111-1111-111111111111';
const U = {
  owner:   '22222222-0000-0000-0000-000000000001',
  manager: '22222222-0000-0000-0000-000000000002',
  staff:   '22222222-0000-0000-0000-000000000003',
  viewer:  '22222222-0000-0000-0000-000000000004',
  nocost:  '22222222-0000-0000-0000-000000000005',
  nocontact: '22222222-0000-0000-0000-000000000006',
  outsider:  '22222222-0000-0000-0000-000000000007',
};
const OTHER = '33333333-3333-3333-3333-333333333333';

await db.query(`insert into auth.users (id,email) values
  ($1,'owner@p2.test'),($2,'manager@p2.test'),($3,'staff@p2.test'),($4,'viewer@p2.test'),
  ($5,'nocost@p2.test'),($6,'nocontact@p2.test'),($7,'outsider@p2.test')`,
  [U.owner, U.manager, U.staff, U.viewer, U.nocost, U.nocontact, U.outsider]);
await db.query(`insert into public.businesses (id,name,slug,plan,status) values
  ($1,'The Blob Studio','blob-studio','pro','active'),
  ($2,'Somebody Else','somebody-else','pro','active')`, [BIZ, OTHER]);
const LAGOS = await one(`insert into public.branches (business_id,name) values ($1,'Lagos') returning id`, [BIZ]);
await one(`insert into public.branches (business_id,name) values ($1,'Abuja') returning id`, [BIZ]);

async function joinStudio(user, roleKey) {
  const roleId = await one(`select id from public.business_roles where business_id=$1 and key=$2`, [BIZ, roleKey]);
  await db.query(`insert into public.memberships (business_id,user_id,role,role_id,status)
    values ($1,$2,$3,$4,'active') on conflict (business_id,user_id) do update
      set role=excluded.role, role_id=excluded.role_id, status='active'`, [BIZ, user, roleKey, roleId]);
  return roleId;
}
await joinStudio(U.owner, 'owner');
await joinStudio(U.manager, 'manager');
await joinStudio(U.staff, 'staff');
await joinStudio(U.viewer, 'viewer');
await db.query(`insert into public.memberships (business_id,user_id,role,status)
  values ($1,$2,'owner','active') on conflict do nothing`, [OTHER, U.outsider]);

/* THE DEFAULT MANAGER DOES NOT HOLD seeCost, and that is not an oversight:
   on production only owner and accountant do. But a suite that proves "a role
   without seeCost is refused" against a role that never had it proves nothing
   at all — the refusal and an empty table look identical. So the manager here
   is granted both, and becomes the control that CAN see, against which the two
   custom roles are each manager minus exactly one permission. */
for (const p of ['seeCost', 'seeContact']) {
  await db.query(`insert into public.business_role_permissions (role_id, permission_key)
    select id, $2 from public.business_roles where business_id=$1 and key='manager'
    on conflict do nothing`, [BIZ, p]);
}

/* Two custom roles, each a manager minus exactly one permission. The
   difference between them and the manager is the whole assertion. */
async function customRole(key, name, drop) {
  /* tier decides what the role inherits; these two are managers in every
     respect except the one permission each is missing. */
  const id = await one(`insert into public.business_roles (business_id,key,name,tier)
    values ($1,$2,$3,'manager') returning id`, [BIZ, key, name]);
  await db.query(`insert into public.business_role_permissions (role_id, permission_key)
    select $1, p.permission_key from public.business_role_permissions p
     where p.role_id = (select id from public.business_roles where business_id=$2 and key='manager')
       and p.permission_key <> $3`, [id, BIZ, drop]);
  return id;
}
const roleNoCost    = await customRole('nocost',    'Floor manager (no costs)',   'seeCost');
const roleNoContact = await customRole('nocontact', 'Floor manager (no contact)', 'seeContact');
/* memberships.role is the TIER and role_id is the actual role. Both of
   these are managers by tier, each pointing at a role that is a manager
   minus one permission. */
for (const [u, r] of [[U.nocost, roleNoCost], [U.nocontact, roleNoContact]]) {
  await db.query(`insert into public.memberships (business_id,user_id,role,role_id,status)
    values ($1,$2,'manager',$3,'active')`, [BIZ, u, r]);
}

/* the manager must actually HAVE the two permissions, or "refused without it"
   proves nothing */
const managerHas = async (perm) => one(
  `select count(*)::int from public.business_role_permissions p
     join public.business_roles r on r.id = p.role_id
    where r.business_id=$1 and r.key='manager' and p.permission_key=$2`, [BIZ, perm]);

/* =====================================================================
   THE BLOB, IN THE PRODUCTION SHAPE
   ===================================================================== */
const order = (i, opts = {}) => ({
  id: 'O-' + String(1000 + i),
  client: opts.client || ('Client ' + i),
  branch: opts.branch || 'Lagos',
  value: opts.value,
  paid: Math.floor(opts.value / 2),
  discount: 0,
  createdAt: '2026-09-' + String(10 + (i % 10)).padStart(2, '0') + 'T09:00:00.000Z',
  garment: 'Agbada', kind: 'bespoke', channel: 'walk-in',
  currency: 'NGN', fx: 1, stageIndex: 3, due: '2026-10-15',
  makerId: opts.makerId || '',
  invoiceNo: null,
  satisfaction: 5,
  email: '', whatsapp: '', address: '',          // present and empty, as on production
  costs: (opts.costs || []).map((a, n) => ({ label: 'Fabric ' + n, amount: a, supplier: 'Aso-oke House' })),
  commissions: (opts.commissions || []).map((a, n) => ({ staffId: 'st-' + n, kind: 'maker', work: 'sewing', amount: a, paid: false })),
  directorOn: !!opts.director, directorPct: opts.director ? 10 : 0, directorAmount: opts.director || null,
  referrerId: opts.referrer || '', referralAmount: opts.referral || 0,
  saleItems: (opts.items || []).map((it, n) => ({
    productId: 'p-' + n, variantId: '', label: 'Item ' + n,
    qty: it.qty, unitPrice: it.price, unitCost: it.cost })),
  outfits: [{ name: 'Main', type: 'agbada', style: 'classic', method: 'bespoke',
              price: opts.value, stageIndex: 3, person: 'Wearer ' + i,
              meas: { Chest: '40', Waist: '34' }, measNote: 'loose', measFit: 'regular',
              materials: [], finish: '', photos: [] }],
  delivery: opts.deliverTo
    ? { enabled: true, company: 'GIG', fee: 3500, status: 'booked', tracking: 'GIG-' + i, location: opts.deliverTo }
    : { enabled: false, company: '', fee: 0, status: '', tracking: '' },
  updates: [{ at: '2026-09-20T10:00:00.000Z', by: 'Ada', stage: 2, note: 'cut', worker: 'Ada', workerId: 'st-0', photos: [] }],
  qc: { status: 'passed', at: '2026-09-22T10:00:00.000Z', by: 'Ada', note: '', items: [] },
  batch: { on: false, qty: 1, reached: 0 },
  potContribs: [{ potId: 'pot-1', amount: 1000 }],
  stockUsed: [{ supplyId: 'sup-1', qty: 2 }],
  clientPhotos: ['https://example.test/a.jpg'],
  group: { on: false },
});

const ACTIVE = [
  order(1, { value: 250000, costs: [60000, 15000], commissions: [30000], items: [{ qty: 2, price: 50000, cost: 20000 }], deliverTo: '14 Bode Thomas, Surulere' }),
  order(2, { value: 180000, costs: [40000], commissions: [20000, 5000], items: [], branch: 'Abuja' }),
  order(3, { value: 90000, costs: [], commissions: [], items: [{ qty: 1, price: 90000, cost: 30000 }], client: 'Brand New Person' }),
  order(4, { value: 120000, costs: [25000], commissions: [], items: [], director: 12000, referrer: 'ref-1', referral: 4000, makerId: 'st-7' }),
];
const DONE = [
  order(5, { value: 300000, costs: [70000, 10000], commissions: [35000], items: [], deliverTo: 'Shop 4, Balogun Market' }),
];

/* Three clients exist already; "Brand New Person" deliberately does not, the
   way 25 of the 68 live orders name somebody with no customers row. */
for (const nm of ['Client 1', 'Client 2', 'Client 4', 'Client 5']) {
  await db.query(`insert into public.customers (business_id, branch_id, name) values ($1,$2,$3)`, [BIZ, LAGOS, nm]);
}

await db.query(`insert into public.app_state (business_id,key,data) values ($1,'layi_dash_orders',$2::jsonb)`, [BIZ, JSON.stringify(ACTIVE)]);
await db.query(`insert into public.app_state (business_id,key,data) values ($1,'layi_dash_orders_done',$2::jsonb)`, [BIZ, JSON.stringify(DONE)]);

const SRC_VALUE = [...ACTIVE, ...DONE].reduce((a, o) => a + o.value, 0);
const SRC_COST = [...ACTIVE, ...DONE].reduce((a, o) => a + o.costs.reduce((x, c) => x + c.amount, 0), 0);
const SRC_ITEMCOST = [...ACTIVE, ...DONE].reduce((a, o) => a + o.saleItems.reduce((x, i) => x + i.unitCost * i.qty, 0), 0);
const SRC_COMM = [...ACTIVE, ...DONE].reduce((a, o) =>
  a + o.commissions.reduce((x, c) => x + c.amount, 0) + (o.directorAmount || 0) + (o.referralAmount || 0), 0);
const SRC_CONTACTS = [...ACTIVE, ...DONE].filter(o => o.delivery.location).length;

/* =====================================================================
   1. THE BYPASS, BEFORE
   ===================================================================== */
section('1. Before: the blob hands a viewer everything');
{
  ok('the manager really does hold seeCost', (await managerHas('seeCost')) === 1);
  ok('and seeContact', (await managerHas('seeContact')) === 1);

  const r = await asMember(U.viewer, `select data from public.app_state where business_id=$1 and key='layi_dash_orders'`, [BIZ]);
  const got = r.rows.length ? JSON.stringify(r.rows[0].data) : '';
  ok('a viewer can read the orders blob at all', r.rows.length === 1, r.error || 'no rows');
  ok('  and it contains the costs', /"amount":60000/.test(got));
  ok('  and the commissions', /"amount":30000/.test(got));
  ok('  and a unit cost inside a sold item', /"unitCost":20000/.test(got));
  ok('  and a delivery address', /Bode Thomas/.test(got));
}

/* =====================================================================
   2. THE MIGRATION
   ===================================================================== */
section('2. The migration runs, and reports on itself');
const mig = (await q(`select * from app.migrate_orders_to_rows($1)`, [BIZ]))[0];
ok('it moved every order', Number(mig.blob_orders) === 5 && Number(mig.rows_after) === 5,
   JSON.stringify(mig));
ok('and the money came with them', Number(mig.blob_total) === SRC_VALUE && Number(mig.rows_total) === SRC_VALUE,
   'blob ' + mig.blob_total + ' vs rows ' + mig.rows_total + ', expected ' + SRC_VALUE);
ok('and it calls itself matched only via the reconciliation', mig.matched === true, JSON.stringify(mig.matched));

section('3. The reconciliation, identifier by identifier');
const rec = await one(`select app.reconcile_orders($1)`, [BIZ]);
const R = typeof rec === 'string' ? JSON.parse(rec) : rec;
ok('source and destination agree on the count', R.source_orders === R.destination_orders,
   R.source_orders + ' vs ' + R.destination_orders);
ok('no identifier is missing', (R.missing_identifiers || []).length === 0, JSON.stringify(R.missing_identifiers));
ok('none is duplicated', (R.duplicate_identifiers || []).length === 0, JSON.stringify(R.duplicate_identifiers));
ok('and none appeared from nowhere', (R.extra_identifiers || []).length === 0, JSON.stringify(R.extra_identifiers));
ok('the money matches', Number(R.source_money) === Number(R.destination_money) && Number(R.source_money) === SRC_VALUE,
   R.source_money + ' vs ' + R.destination_money);
ok('the costs match', Number(R.source_cost) === Number(R.destination_cost) && Number(R.source_cost) === SRC_COST,
   R.source_cost + ' vs ' + R.destination_cost);
ok('the unit costs inside the items match', Number(R.source_item_cost) === Number(R.destination_item_cost) && Number(R.source_item_cost) === SRC_ITEMCOST,
   R.source_item_cost + ' vs ' + R.destination_item_cost);
ok('the commissions match', Number(R.source_commission) === Number(R.destination_commission) && Number(R.source_commission) === SRC_COMM,
   R.source_commission + ' vs ' + R.destination_commission);
ok('every delivery address arrived', Number(R.source_contacts) === Number(R.destination_contacts) && Number(R.source_contacts) === SRC_CONTACTS,
   R.source_contacts + ' vs ' + R.destination_contacts);
ok('no branch mismatched', Number(R.branch_mismatches) === 0, String(R.branch_mismatches));
ok('no client mismatched, including the one with no customer row',
   Number(R.customer_mismatches) === 0, String(R.customer_mismatches));
ok('no assignment mismatched', Number(R.assignment_mismatches) === 0, String(R.assignment_mismatches));
ok('the five completed/active states are right', Number(R.status_mismatches) === 0, String(R.status_mismatches));
ok('and not one secret survived into doc', Number(R.doc_still_carrying_a_secret) === 0, String(R.doc_still_carrying_a_secret));
ok('so the reconciliation is green', R.green === true, JSON.stringify(R.green));

section('4. It is idempotent');
{
  const again = (await q(`select * from app.migrate_orders_to_rows($1)`, [BIZ]))[0];
  ok('running it twice writes the same five rows', Number(again.rows_after) === 5, JSON.stringify(again));
  ok('and the money did not double', Number(again.rows_total) === SRC_VALUE, String(again.rows_total));
  const r2 = await one(`select app.reconcile_orders($1)`, [BIZ]);
  ok('and it is still green', (typeof r2 === 'string' ? JSON.parse(r2) : r2).green === true);
  const c = await one(`select count(*)::int from public.customers where business_id=$1`, [BIZ]);
  ok('and it did not create the missing client twice', c === 5, c + ' customers');
}

/* =====================================================================
   5. THE SIX ROLES, AT THE API
   ===================================================================== */
section('5. After: who can read what');
const CAST = [['the owner', U.owner], ['a manager', U.manager], ['a staff member', U.staff],
               ['a viewer', U.viewer], ['a role without seeCost', U.nocost], ['a role without seeContact', U.nocontact]];
/* Asked of the database rather than assumed. The default roles are not what
   a reasonable person guesses: a manager does NOT hold seeCost, and a staff
   member DOES hold seeContact. Writing the answers here by hand is how a
   suite ends up asserting the product's behaviour is a bug. */
const holds = async (uid, perm) => (await one(
  `select count(*)::int from public.memberships m
     join public.business_role_permissions p on p.role_id = m.role_id
    where m.business_id=$1 and m.user_id=$2 and p.permission_key=$3`, [BIZ, uid, perm])) > 0
  || (await one(`select count(*)::int from public.memberships m
       where m.business_id=$1 and m.user_id=$2 and m.role='owner'`, [BIZ, uid])) > 0;

for (const [who, uid] of CAST) {
  const r = await asMember(uid, `select app_id, total, status from public.orders where business_id=$1 order by app_id`, [BIZ]);
  ok(who + ' still reads the orders', r.rows.length === 5, r.error || (r.rows.length + ' rows'));
}
for (const [what, table, col, perm] of [
  ['the costs',             'order_costs',       'cost',   'seeCost'],
  ['the commissions',       'order_commissions', 'total',  'seeCost'],
  ['the delivery addresses','order_contacts',    'detail', 'seeContact'],
]) {
  for (const [who, uid] of CAST) {
    const may = await holds(uid, perm);
    const r = await asMember(uid, `select ${col} from public.${table} where business_id=$1`, [BIZ]);
    ok(who + (may ? ' holds ' + perm + ' and sees ' + what
                  : ' lacks ' + perm + ' and is refused ' + what),
       may ? r.rows.length > 0 : r.rows.length === 0, r.error || (r.rows.length + ' rows'));
  }
}

section('6. And the document they CAN read carries nothing it should not');
for (const [who, uid] of CAST) {
  const r = await asMember(uid, `select doc from public.orders where business_id=$1`, [BIZ]);
  const blob = JSON.stringify(r.rows.map(x => x.doc));
  ok(who + ' gets a document with no cost, commission or address in it',
     !/"costs"|"commissions"|"unitCost"|Bode Thomas|Balogun|"directorAmount"|"referralAmount"/.test(blob),
     blob.slice(0, 160));
}
ok('and the ordinary order information survived', await (async () => {
  const r = await asMember(U.staff, `select doc from public.orders where business_id=$1 and app_id='O-1001'`, [BIZ]);
  const d = r.rows[0] && r.rows[0].doc;
  const doc = typeof d === 'string' ? JSON.parse(d) : d;
  return !!doc && doc.garment === 'Agbada' && doc.stageIndex === 3
      && Array.isArray(doc.updates) && doc.updates.length === 1
      && Array.isArray(doc.saleItems) && doc.saleItems.length === 1
      && doc.saleItems[0].unitPrice === 50000
      && doc.delivery && doc.delivery.tracking === 'GIG-1' && doc.delivery.fee === 3500;
})(), 'the stage, the history, the item price and the courier must all still be there');

section('7. Nobody reaches another studio, whatever they hold');
for (const t of ['orders', 'order_costs', 'order_commissions', 'order_contacts']) {
  const r = await asMember(U.outsider, `select * from public.${t} where business_id=$1`, [BIZ]);
  ok('an owner of another studio reads nothing from ' + t, r.rows.length === 0, r.error || (r.rows.length + ' rows'));
}

section('8. And the old key is not a way back in');
{
  const w = await asMember(U.staff,
    `update public.app_state set data = data || '[]'::jsonb where business_id=$1 and key='layi_dash_orders' returning key`, [BIZ]);
  const expectedCostRows = [...ACTIVE, ...DONE].filter(o =>
    o.costs.reduce((a, c) => a + c.amount, 0) !== 0 ||
    o.saleItems.reduce((a, i) => a + i.unitCost * i.qty, 0) !== 0).length;
  ok('a staff member writing the legacy key cannot put a cost anywhere protected',
     (await one(`select count(*)::int from public.order_costs where business_id=$1`, [BIZ])) === expectedCostRows,
     'expected ' + expectedCostRows + ' protected cost rows; the write said: ' + (w.error || 'accepted'));

  /* the doc trigger, asked directly: an ordinary member updating an order
     cannot smuggle a cost back into the document */
  const sneak = await asMember(U.staff,
    `update public.orders set doc = doc || '{"costs":[{"amount":99999}],"address":"somewhere"}'::jsonb
      where business_id=$1 and app_id='O-1001' returning app_id`, [BIZ]);
  const after = await one(`select (doc ? 'costs') or (doc ? 'address') from public.orders where business_id=$1 and app_id='O-1001'`, [BIZ]);
  ok('and cannot smuggle one back into the order document', after === false,
     'write said: ' + (sneak.error || 'accepted') + ', doc now carries it: ' + after);
}

/* =====================================================================
   */
console.log('\n' + '='.repeat(62));
section('9. Retiring the source, which refuses unless the copy is proven');
{
  /* A stale client first: the studio HAS rows now, so the old key is refused
     rather than quietly accepted and dropped. Refused, not stripped —
     silently dropping an order write would tell a studio their morning's
     work had saved when it had not. */
  const stale = await asMember(U.owner,
    `insert into public.app_state (business_id,key,data) values ($1,'layi_dash_orders','[]'::jsonb)
     on conflict (business_id,key) do update set data = excluded.data`, [BIZ]);
  ok('an out-of-date app is refused, and told why',
     /out of date/.test(stale.error || ''), stale.error || 'IT WAS ACCEPTED');

  /* An unmigrated studio must NOT be refused, or this release breaks every
     studio that has not moved yet. */
  const FRESH = '44444444-4444-4444-4444-444444444444';
  const fuser = '22222222-0000-0000-0000-000000000009';
  await db.query(`insert into auth.users (id,email) values ($1,'fresh@p2.test')`, [fuser]);
  await db.query(`insert into public.businesses (id,name,slug,plan,status)
    values ($1,'Not Moved Yet','not-moved-yet','pro','active')`, [FRESH]);
  await db.query(`insert into public.memberships (business_id,user_id,role,status)
    values ($1,$2,'owner','active') on conflict do nothing`, [FRESH, fuser]);
  const fresh = await asMember(fuser,
    `insert into public.app_state (business_id,key,data) values ($1,'layi_dash_orders','[]'::jsonb)`, [FRESH]);
  ok('a studio that has not moved yet still writes its blob exactly as before',
     !fresh.error, fresh.error || '');

  /* The refusal shown before the acceptance. The reconciliation is broken
     the way it would really break — a source order with no destination row —
     by removing one that was migrated. Adding a ghost to the blob is not
     possible any more, because the trigger two checks up refuses it, which
     is that trigger doing its job. */
  await db.query(`delete from public.orders where business_id=$1 and app_id='O-1002'`, [BIZ]);
  const refused = await (async () => {
    try { await db.query(`select app.retire_order_blob($1)`, [BIZ]); return null; }
    catch (e) { return String(e.message).split(String.fromCharCode(10))[0]; }
  })();
  ok('retiring is REFUSED while one order is unaccounted for',
     /does not reconcile/.test(refused || ''), refused || 'IT WAS ALLOWED');
  ok('  and the blob is still there', (await one(
     `select count(*)::int from public.app_state where business_id=$1 and key like 'layi_dash_orders%'`, [BIZ])) === 2);

  /* Now migrate the straggler and try again. */
  await q(`select * from app.migrate_orders_to_rows($1)`, [BIZ]);
  const out = await one(`select app.retire_order_blob($1)`, [BIZ]);
  const O = typeof out === 'string' ? JSON.parse(out) : out;
  ok('once every order is accounted for, it is allowed', O && O.retired === true, JSON.stringify(O && O.green));
  ok('  and both keys are gone', (await one(
     `select count(*)::int from public.app_state where business_id=$1 and key like 'layi_dash_orders%'`, [BIZ])) === 0);
  ok('  and the orders are all still there as rows', (await one(
     `select count(*)::int from public.orders where business_id=$1`, [BIZ])) === 5);
  ok('  and it was recorded in the studio history', (await one(
     `select count(*)::int from public.audit_log where business_id=$1 and action='Legacy order store retired'`, [BIZ])) === 1);

  /* And with the blob gone the bypass is gone: the read this harness opened
     with now returns nothing at all. */
  const gone = await asMember(U.viewer,
    `select data from public.app_state where business_id=$1 and key='layi_dash_orders'`, [BIZ]);
  ok('the read that handed a viewer every cost now returns nothing',
     gone.rows.length === 0, gone.error || (gone.rows.length + ' rows'));
}

section('10. And the catalogue stops overstating itself');
{
  const rows = await q(`select key, enforceable from public.permission_catalogue
    where key in ('seeCost','seeContact','money','receivables') order by key`);
  const by = Object.fromEntries(rows.map(r => [r.key, r.enforceable]));
  ok('seeCost is enforced by the database now', by.seeCost === 'database', JSON.stringify(by));
  ok('and seeContact', by.seeContact === 'database', JSON.stringify(by));
  ok('money is still honestly marked ui_only, because it still is',
     by.money === 'ui_only', JSON.stringify(by));
  ok('and so is receivables', by.receivables === 'ui_only', JSON.stringify(by));
}
console.log(pass + ' passed, ' + failures.length + ' failed');
for (const f of failures) console.log('  - ' + f);
if (!failures.length) {
  console.log('\nThe orders are rows, every figure reconciles identifier by\nidentifier, and the blob is no longer a way round seeCost or\nseeContact for anybody.');
}
process.exit(failures.length ? 1 : 0);
