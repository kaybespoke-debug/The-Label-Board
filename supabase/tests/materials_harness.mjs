/* =====================================================================
   A MATERIAL'S COST PRICE IS A seeCost THING.

   The status check of 5 October asked one question and Kayode answered
   it: the materials sat in a JSON blob behind `supplies`, a blob is
   all-or-nothing, so anybody who could count the stock could read what
   the studio paid for it. The materials are rows now with a cost
   satellite, the same shape v68 gave an order's money.

   This suite proves the four things that can go wrong:

     1. the boundary itself — quantities with `supplies`, money with
        `seeCost`, and NEVER the second without the permission
     2. the average is real. It is computed from the costed movement
        history, not from whatever somebody last typed, so a restock in
        October cannot rewrite what a metre cost in June
     3. the migration brings the 48 live materials across with their
        quantities, their ledgers and an opening average equal to the
        cost they carry today — reconciled item by item
     4. nothing about it creates an expense. Materials are expensed when
        they are BOUGHT. A cost on an order is for margin only, and a
        cash P&L that counted it twice would overstate what the studio
        spent.

   Built from the migrations alone, at a bare Postgres, like every other
   suite here.

   usage: node supabase/tests/materials_harness.mjs
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
/* Supabase's own default grants, so `revoke from public` is not mistaken
   for a wall. tlb_policy_harness documents why this matters. */
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`);
for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message.split('\n')[0]); process.exit(1); }
}
console.log('Built from the migrations alone.');

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];

/* A real session for a real member. COPIED FROM restore_harness, and the
   transaction is the point: `set local` lives until the end of the
   enclosing transaction, and PGlite gives every loose statement one of its
   own, so without begin/commit the role is discarded before the query runs
   and every policy passes. The first draft of this suite did that and
   reported a stock keeper reading costs, an outsider reading another
   studio, and anon reading everything — all of which were the harness
   being wrong rather than the database. */
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
    return { rows: [], error: e.message.split('\n')[0] };
  }
}
const asUser = (u, sql, p = []) => asRole('authenticated', u, sql, p);

// =====================================================================
section('A studio, with stock and people who may see different things');
// =====================================================================
const BIZ = 'b0000000-0000-0000-0000-00000000b001';
const U = {
  owner:   'c0000000-0000-0000-0000-0000000000c1',
  keeper:  'c0000000-0000-0000-0000-0000000000c2',   // supplies, NO seeCost
  buyer:   'c0000000-0000-0000-0000-0000000000c3',   // supplies AND seeCost
  tailor:  'c0000000-0000-0000-0000-0000000000c4',   // neither
};
await db.query(`insert into auth.users (id,email) values
  ($1,'owner@mat.test'),($2,'keeper@mat.test'),($3,'buyer@mat.test'),($4,'tailor@mat.test')`,
  [U.owner, U.keeper, U.buyer, U.tailor]);
await db.query(`insert into public.businesses (id,name,slug,plan,status)
  values ($1,'Stockroom Studio','stockroom','pro','active')`, [BIZ]);
const BR = (await one(`insert into public.branches (business_id,name) values ($1,'Lagos') returning id`, [BIZ])).id;

/* Two custom roles, each a manager minus exactly one thing, because the
   difference between them IS the assertion. */
async function role(key, name, drop) {
  const id = (await one(`insert into public.business_roles (business_id,key,name,tier)
    values ($1,$2,$3,'manager') returning id`, [BIZ, key, name])).id;
  await db.query(`insert into public.business_role_permissions (role_id, permission_key)
    select $1, p.permission_key from public.business_role_permissions p
     where p.role_id = (select id from public.business_roles where business_id=$2 and key='manager')
       and p.permission_key <> all($3)`, [id, BIZ, drop]);
  return id;
}
/* the manager control must actually hold both, or "refused without it"
   proves nothing */
for (const p of ['supplies', 'seeCost']) {
  await db.query(`insert into public.business_role_permissions (role_id, permission_key)
    select id, $2 from public.business_roles where business_id=$1 and key='manager'
    on conflict do nothing`, [BIZ, p]);
}
const rKeeper = await role('keeper', 'Stock keeper', ['seeCost']);
const rBuyer  = await role('buyer',  'Buyer',        []);
const rTailor = await role('tailorx','Workroom',     ['supplies', 'seeCost']);

await db.query(`insert into public.memberships (business_id,user_id,role,role_id,status) values
  ($1,$2,'owner',null,'active'),
  ($1,$3,'manager',$6,'active'),
  ($1,$4,'manager',$7,'active'),
  ($1,$5,'manager',$8,'active')`,
  [BIZ, U.owner, U.keeper, U.buyer, U.tailor, rKeeper, rBuyer, rTailor]);

const held = async (uid, perm) => Number((await one(
  `select count(*) c from public.memberships m
     join public.business_role_permissions p on p.role_id = m.role_id
    where m.business_id=$1 and m.user_id=$2 and p.permission_key=$3`, [BIZ, uid, perm])).c) > 0
  || Number((await one(`select count(*) c from public.memberships
       where business_id=$1 and user_id=$2 and role='owner'`, [BIZ, uid])).c) > 0;

ok('the stock keeper may count stock', await held(U.keeper, 'supplies'));
ok('  and may NOT see cost', !(await held(U.keeper, 'seeCost')));
ok('the buyer may do both', (await held(U.buyer, 'supplies')) && (await held(U.buyer, 'seeCost')));
ok('the workroom may do neither', !(await held(U.tailor, 'supplies')) && !(await held(U.tailor, 'seeCost')));
if (failures.length) { console.log('\nthe cast is wrong; nothing below would mean anything'); process.exit(1); }

// =====================================================================
section('1. The average is history, not the last thing somebody typed');
// =====================================================================
const MAT = (await one(`insert into public.materials
  (business_id,branch_id,app_id,name,cat,unit,qty,reorder,code)
  values ($1,$2,'s-1','Emerald lace','Fabric','metres',0,5,'FAB-26-001') returning id`, [BIZ, BR])).id;

/* three receipts at three different prices, which is the whole point */
for (const [n, qty, cost, when] of [[1, 10, 9000, '2026-06-01'], [2, 10, 11000, '2026-08-01'], [3, 20, 10000, '2026-09-01']]) {
  const mv = (await one(`insert into public.material_moves
    (business_id,material_id,branch_id,kind,qty,note,at,app_key)
    values ($1,$2,$3,'in',$4,'Received',$5,$6) returning id`, [BIZ, MAT, BR, qty, when, 'r' + n])).id;
  await db.query(`insert into public.material_move_costs (move_id,business_id,unit_cost,total_cost)
    values ($1,$2,$3,$4)`, [mv, BIZ, cost, qty * cost]);
}
await db.query(`update public.materials set qty = 40 where id = $1`, [MAT]);

{
  const c = await one(`select avg_cost, last_paid from public.material_costs where material_id=$1`, [MAT]);
  /* (10×9000 + 10×11000 + 20×10000) / 40 = 400000/40 = 10000 */
  ok('the weighted average is the money over the quantity',
     Number(c.avg_cost) === 10000, 'avg_cost is ' + c.avg_cost);
  ok('and "last paid" is the most recent receipt, not the average',
     Number(c.last_paid) === 10000, 'last_paid is ' + c.last_paid);

  /* AND THE THING THAT USED TO BE IMPOSSIBLE: a later, dearer receipt must
     not reach backwards. */
  const mv = (await one(`insert into public.material_moves
    (business_id,material_id,branch_id,kind,qty,note,at,app_key)
    values ($1,$2,$3,'in',10,'Received dear','2026-10-01','r4') returning id`, [BIZ, MAT, BR])).id;
  await db.query(`insert into public.material_move_costs (move_id,business_id,unit_cost,total_cost)
    values ($1,$2,20000,200000)`, [mv, BIZ]);
  const c2 = await one(`select avg_cost, last_paid from public.material_costs where material_id=$1`, [MAT]);
  /* 600000 / 50 = 12000 */
  ok('a dearer restock moves the average forward', Number(c2.avg_cost) === 12000, String(c2.avg_cost));
  ok('  and "last paid" follows it', Number(c2.last_paid) === 20000, String(c2.last_paid));
  const old = await one(`select c.unit_cost from public.material_moves mv
    join public.material_move_costs c on c.move_id = mv.id
    where mv.material_id=$1 and mv.app_key='r1'`, [MAT]);
  ok('  and JUNE STILL COST WHAT JUNE COST, which is the whole reason the '
     + 'movements have a cost table', Number(old.unit_cost) === 9000, String(old.unit_cost));

  /* self-healing: delete the dear one and the average goes back */
  await db.query(`delete from public.material_move_costs where move_id =
    (select id from public.material_moves where material_id=$1 and app_key='r4')`, [MAT]);
  const c3 = await one(`select avg_cost from public.material_costs where material_id=$1`, [MAT]);
  ok('the average is recomputed from history rather than nudged, so it '
     + 'cannot drift', Number(c3.avg_cost) === 10000, String(c3.avg_cost));
}

// =====================================================================
section('2. Quantities are stock-keeping. Cost is a permission.');
// =====================================================================
for (const [who, uid] of [['the owner', U.owner], ['the stock keeper', U.keeper],
                          ['the buyer', U.buyer], ['the workroom', U.tailor]]) {
  const maySt = await held(uid, 'supplies');
  const mayCo = await held(uid, 'seeCost');

  const mats = await asUser(uid, `select name, qty from public.materials where business_id=$1`, [BIZ]);
  ok(who + (maySt ? ' counts the stock' : ' is refused the stock'),
     maySt ? mats.rows.length > 0 : mats.rows.length === 0,
     mats.error || mats.rows.length + ' rows');

  const moves = await asUser(uid, `select qty, kind from public.material_moves where business_id=$1`, [BIZ]);
  ok('  ' + (maySt ? 'and the movement ledger' : 'and the ledger with it'),
     maySt ? moves.rows.length > 0 : moves.rows.length === 0,
     moves.error || moves.rows.length + ' rows');

  const costs = await asUser(uid, `select avg_cost from public.material_costs where business_id=$1`, [BIZ]);
  ok('  ' + (mayCo ? 'and IS told what it cost' : 'and is NOT told what it cost'),
     mayCo ? costs.rows.length > 0 : costs.rows.length === 0,
     costs.error || 'the API returned ' + costs.rows.length + ' row(s)');

  const mc = await asUser(uid, `select unit_cost from public.material_move_costs where business_id=$1`, [BIZ]);
  ok('  ' + (mayCo ? 'nor what any single receipt cost' : 'nor what any single receipt cost'),
     mayCo ? mc.rows.length > 0 : mc.rows.length === 0,
     mc.error || mc.rows.length + ' rows');
}

section('  and not through an embed either');
{
  /* The shape that carries a refused table in on the back of a permitted
     one. It caught nobody out in v68 because it was tested; it is tested
     here for the same reason. */
  const r = await asUser(U.keeper, `select m.name, c.avg_cost
    from public.materials m left join public.material_costs c on c.material_id = m.id
    where m.business_id=$1`, [BIZ]);
  const leaked = r.rows.some(x => x.avg_cost !== null && x.avg_cost !== undefined);
  ok('a join from materials to their costs hands the stock keeper nulls',
     !leaked && r.rows.length > 0, r.error || JSON.stringify(r.rows.slice(0, 2)));
}

section('  and a read boundary with a writable table behind it is not one');
{
  const w = await asUser(U.keeper,
    `update public.material_costs set avg_cost = 1 where business_id=$1 returning material_id`, [BIZ]);
  ok('the stock keeper cannot set a cost either',
     w.rows.length === 0, w.error || 'it wrote ' + w.rows.length + ' row(s)');
  const still = await one(`select avg_cost from public.material_costs where material_id=$1`, [MAT]);
  ok('  and the average is untouched', Number(still.avg_cost) === 10000, String(still.avg_cost));

  const h = await asUser(U.keeper,
    `update public.material_moves set qty = 999 where material_id=$1 returning id`, [MAT]);
  ok('and NOBODY rewrites a movement, the keeper included',
     h.rows.length === 0, h.error || 'it wrote ' + h.rows.length + ' row(s)');
  const o = await asUser(U.owner,
    `update public.material_moves set qty = 999 where material_id=$1 returning id`, [MAT]);
  ok('  not even the owner: a miscount is corrected by another movement',
     o.rows.length === 0, o.error || 'it wrote ' + o.rows.length + ' row(s)');
}

// =====================================================================
section('3. Another studio reaches none of it');
// =====================================================================
{
  const OTHER = 'b0000000-0000-0000-0000-00000000b002';
  const outsider = 'c0000000-0000-0000-0000-0000000000c9';
  await db.query(`insert into auth.users (id,email) values ($1,'out@mat.test')`, [outsider]);
  await db.query(`insert into public.businesses (id,name,slug,plan,status)
    values ($1,'Somebody Else','somebody-else-mat','pro','active')`, [OTHER]);
  await db.query(`insert into public.memberships (business_id,user_id,role,status)
    values ($1,$2,'owner','active')`, [OTHER, outsider]);
  for (const t of ['materials', 'material_costs', 'material_moves', 'material_move_costs']) {
    const r = await asUser(outsider, `select * from public.${t} where business_id=$1`, [BIZ]);
    ok('an owner of another studio reads nothing from ' + t,
       r.rows.length === 0, r.error || r.rows.length + ' rows');
  }
  const anon = await asRole('anon', null, `select * from public.material_costs`);
  ok('and the public key reads nothing at all', anon.rows.length === 0,
     anon.error || anon.rows.length + ' rows');
}

// =====================================================================
section('4. The 48 that are already here, migrated and reconciled');
// =====================================================================
{
  /* The live blob's shape, exactly: an id, a branch by NAME, a single
     cost field, and a movement ledger that records quantities and no
     money. Three materials, one of them with no supplier and no ledger,
     because that is also a real row. */
  const BLOB = [
    { id: 's-10', branch: 'Lagos', cat: 'Fabric', subcat: 'Lace', name: 'Royal lace',
      qty: 6, unit: 'metres', reorder: 5, cost: 9000, supplierId: 'sp-1', note: 'For agbada',
      updatedAt: '2026-09-01T00:00:00.000Z',
      moves: [{ at: '2026-08-01', type: 'in', qty: 10, note: 'Opening stock', ref: '' },
              { at: '2026-08-20', type: 'out', qty: 4, note: 'Used on order', ref: 'L-0003' }] },
    { id: 's-11', branch: 'Lagos', cat: 'Threads', subcat: '', name: 'Gold thread',
      qty: 12, unit: 'spools', reorder: 4, cost: 1500, supplierId: '', note: '',
      updatedAt: '2026-09-02T00:00:00.000Z',
      moves: [{ at: '2026-07-01', type: 'in', qty: 12, note: 'Opening stock', ref: '' }] },
    { id: 's-12', branch: 'Lagos', cat: 'Other', subcat: '', name: 'Loose buttons',
      qty: 40, unit: 'pcs', reorder: 10, cost: 0, supplierId: '', note: 'no cost known',
      updatedAt: '2026-09-03T00:00:00.000Z', moves: [] },
  ];
  /* A STUDIO OF ITS OWN. The reconciliation compares this studio's blob
     against this studio's rows, so a material added by hand in section 1
     would make it red for the right reason and the wrong one. */
  const MBIZ = 'b0000000-0000-0000-0000-00000000b003';
  await db.query(`insert into public.businesses (id,name,slug,plan,status)
    values ($1,'Blob Stockroom','blob-stockroom','pro','active')`, [MBIZ]);
  const MBR = (await one(`insert into public.branches (business_id,name)
    values ($1,'Lagos') returning id`, [MBIZ])).id;
  await db.query(`insert into public.suppliers (business_id,name,data)
    values ($1,'Aso-oke House','{"id":"sp-1"}'::jsonb)`, [MBIZ]);
  await db.query(`insert into public.app_state (business_id,key,data)
    values ($1,'layi_dash_supplies',$2::jsonb)`, [MBIZ, JSON.stringify(BLOB)]);

  const r = await one(`select app.migrate_materials_to_rows($1) as j`, [MBIZ]);
  const j = typeof r.j === 'string' ? JSON.parse(r.j) : r.j;
  ok('the migration runs', !!j, JSON.stringify(j));
  ok('  and reconciles green', j.green === true, JSON.stringify(j));
  ok('  every material came across', Number(j.destination_materials) === 3,
     j.destination_materials + ' of ' + j.source_materials);
  ok('  none missing', Array.isArray(j.missing) && j.missing.length === 0, JSON.stringify(j.missing));
  ok('  no quantity disagrees', Array.isArray(j.quantity_mismatches)
     && j.quantity_mismatches.length === 0, JSON.stringify(j.quantity_mismatches));
  ok('  every movement came across', Number(j.destination_moves) === Number(j.source_moves),
     j.destination_moves + ' of ' + j.source_moves);

  /* THE NUMBER THAT PROVES THE OPENING AVERAGE. Stock on hand valued at
     cost has to be identical on both sides, or the average did not come
     across whatever the counts say. 6×9000 + 12×1500 + 40×0 = 72,000. */
  ok('  and the stock on hand is worth the same on both sides',
     Number(j.source_stock_at_cost) === Number(j.destination_stock_at_cost)
     && Number(j.source_stock_at_cost) === 72000,
     j.source_stock_at_cost + ' vs ' + j.destination_stock_at_cost);

  const lace = await one(`select c.avg_cost, c.last_paid from public.materials m
    join public.material_costs c on c.material_id = m.id
    where m.business_id=$1 and m.app_id='s-10'`, [MBIZ]);
  ok('  the typed cost became the opening average', Number(lace.avg_cost) === 9000, String(lace.avg_cost));
  ok('  and reads as the last price paid too, because it is all we know',
     Number(lace.last_paid) === 9000, String(lace.last_paid));

  const none = await one(`select c.avg_cost from public.materials m
    join public.material_costs c on c.material_id = m.id
    where m.business_id=$1 and m.app_id='s-12'`, [MBIZ]);
  ok('  a material with no cost known gets a row saying zero, not no row '
     + 'at all, because an absent row means "not for you"',
     none && Number(none.avg_cost) === 0, JSON.stringify(none));

  ok('  the branch name resolved to a branch', Number((await one(
     `select count(*) c from public.materials where business_id=$1 and branch_id=$2`, [MBIZ, MBR])).c) === 3);
  ok('  and the supplier reference resolved to a supplier', Number((await one(
     `select count(*) c from public.materials where business_id=$1 and supplier_id is not null`, [MBIZ])).c) === 1);

  /* the out-movement carries no cost, because money only enters on a
     receipt */
  const outCost = await one(`select count(*) c from public.material_moves mv
    join public.material_move_costs mc on mc.move_id = mv.id
    where mv.business_id=$1 and mv.kind='out'`, [MBIZ]);
  ok('  an out-movement is not costed: money enters on a receipt',
     Number(outCost.c) === 0, String(outCost.c));

  /* idempotent */
  const again = await one(`select app.migrate_materials_to_rows($1) as j`, [MBIZ]);
  const j2 = typeof again.j === 'string' ? JSON.parse(again.j) : again.j;
  ok('running it twice changes nothing', j2.green === true
     && Number(j2.destination_materials) === 3
     && Number(j2.destination_moves) === Number(j.destination_moves),
     JSON.stringify({ mats: j2.destination_materials, moves: j2.destination_moves }));
  ok('  and the valuation is still the same',
     Number(j2.destination_stock_at_cost) === 72000, String(j2.destination_stock_at_cost));

  /* the blob is untouched: nothing destructive happens here */
  const blobStill = await one(`select jsonb_array_length(data) n from public.app_state
    where business_id=$1 and key='layi_dash_supplies'`, [MBIZ]);
  ok('and the blob it read is still exactly where it was',
     Number(blobStill.n) === 3, String(blobStill.n));
}

// =====================================================================
section('5. A material cost NEVER becomes an expense');
// =====================================================================
{
  /* THE ONE THAT PROTECTS THE P&L. A studio's cash books count a material
     ONCE, when it is bought. The cost that lands on an order is for
     margin: it says what that job consumed. If it also wrote a
     transaction, every metre of lace would be counted twice and the
     studio would think it spent double.

     So: the whole materials release must not create a single transaction.
     Measured, not asserted. */
  const before = Number((await one(`select count(*) c from public.transactions where business_id=$1`, [BIZ])).c);

  const mv = (await one(`insert into public.material_moves
    (business_id,material_id,branch_id,kind,qty,note,ref,at,app_key)
    values ($1,$2,$3,'out',2,'Used on order','L-9001',now(),'use-1') returning id`, [BIZ, MAT, BR])).id;
  await db.query(`insert into public.material_move_costs (move_id,business_id,unit_cost,total_cost)
    values ($1,$2,10000,20000)`, [mv, BIZ]);

  const after = Number((await one(`select count(*) c from public.transactions where business_id=$1`, [BIZ])).c);
  ok('using stock on an order creates no transaction', after === before,
     before + ' -> ' + after);

  const r2 = await one(`select app.migrate_materials_to_rows($1) as j`, [BIZ]);
  const after2 = Number((await one(`select count(*) c from public.transactions where business_id=$1`, [BIZ])).c);
  ok('and migrating the whole blob creates none either', after2 === before,
     before + ' -> ' + after2);

  /* and nothing in the four tables is wired to the ledger at all */
  const trg = await q(`select c.relname, t.tgname from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and not t.tgisinternal
      and c.relname in ('materials','material_costs','material_moves','material_move_costs')`);
  const names = trg.map(x => x.relname + '.' + x.tgname);
  const suspicious = trg.filter(x => /txn|transaction|expense|finance/i.test(x.tgname));
  ok('no trigger on any materials table mentions a transaction or an expense',
     suspicious.length === 0, names.join(', ') || 'no triggers at all');

  /* the belt to that brace: the recalc function must not touch
     transactions, read as source rather than inferred from behaviour */
  const src = await one(`select pg_get_functiondef(p.oid) d from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname='migrate_materials_to_rows'`);
  ok('and the migration function names no transaction table in its body',
     !/public\.transactions/i.test(String(src.d)), 'it references public.transactions');
}

// =====================================================================
section('6. An export carries the stock, and a restore puts it back');
// =====================================================================
{
  const e = await one(`select app.export_studio_raw($1) as j`, [BIZ]);
  const file = typeof e.j === 'string' ? JSON.parse(e.j) : e.j;
  ok('the export says version 5', Number(file._version) === 5, String(file._version));
  for (const k of ['materials', 'material_costs', 'material_moves', 'material_move_costs']) {
    ok('  and carries ' + k, Array.isArray(file[k]) && file[k].length > 0,
       k + ': ' + JSON.stringify((file[k] || []).length));
  }
  /* the valuation survives the round trip on paper, which is what a
     restore will rebuild from */
  const valued = (file.materials || []).reduce((a, m) => {
    const c = (file.material_costs || []).find(x => x.material_id === m.id);
    return a + Number(m.qty || 0) * Number((c && c.avg_cost) || 0);
  }, 0);
  const live = Number((await one(`select coalesce(round(sum(m.qty*c.avg_cost),2),0) v
    from public.materials m join public.material_costs c on c.material_id=m.id
    where m.business_id=$1`, [BIZ])).v);
  ok('  and the file values the stock at exactly what the studio does',
     Math.abs(valued - live) < 0.01, valued + ' vs ' + live);
}

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('\nThe materials boundary is not safe to promote:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nStock is stock-keeping and cost is a permission. The average is');
console.log('computed from what was actually paid, a later restock cannot');
console.log('rewrite an older margin, and none of it touches the cash books.');
