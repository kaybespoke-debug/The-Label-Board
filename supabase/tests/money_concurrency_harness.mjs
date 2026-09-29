/* =====================================================================
   TWO DEVICES, TWO PAYMENTS, AND WHETHER BOTH SURVIVE.

   THE EXACT TEST:

     Device A records payment X.
     Device B, from stale state, records payment Y.
     Both complete successfully.
     X and Y must both exist, exactly once.

   Money is the one thing in this product where "last write wins" is not
   a tidy compromise. If a payment disappears, a studio chases a client
   who has already paid, or fails to chase one who has not.

   layi_dash_txns is one jsonb array per business. Each device reads the
   whole array, appends to it, and writes the whole thing back. Two
   devices that both had money to record therefore produce one surviving
   payment and one that never existed — no error, no conflict, no sign.

   This suite proves that first, so the fix is measured against a
   demonstrated failure rather than a described one, and then proves the
   relational path does not lose it.

   usage: node supabase/tests/money_concurrency_harness.mjs
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
    return { rows: [], error: String(e.message).split('\n')[0] };
  }
}

const BIZ = 'aca11111-1111-1111-1111-111111111111';
const OWNER = 'acb11111-1111-1111-1111-111111111111';
const STAFF = 'acb11111-1111-1111-1111-111111111112';
await db.query(`insert into auth.users (id,email) values ($1,'o@money.test'),($2,'s@money.test')`, [OWNER, STAFF]);
await db.query(`insert into public.businesses (id,name,slug,plan,status)
  values ($1,'Money Studio','money-studio','pro','active')`, [BIZ]);
const BRANCH = await one(`insert into public.branches (business_id,name) values ($1,'Main') returning id`, [BIZ]);
for (const [u, k] of [[OWNER, 'owner'], [STAFF, 'staff']]) {
  const rid = await one(`select id from public.business_roles where business_id=$1 and key=$2`, [BIZ, k]);
  await db.query(`insert into public.memberships (business_id,user_id,role,role_id,status)
    values ($1,$2,$3,$4,'active') on conflict (business_id,user_id) do update set role=excluded.role`,
    [BIZ, u, k, rid]);
}

/* =====================================================================
   1. THE DEFECT, DEMONSTRATED
   ===================================================================== */
section('1. The blob: two devices, one surviving payment');
{
  await db.query(`insert into public.app_state (business_id,key,data)
    values ($1,'layi_dash_txns','[]'::jsonb)
    on conflict (business_id,key) do update set data='[]'::jsonb`, [BIZ]);

  /* Device A reads the array. Device B reads the SAME array — it has not
     seen A's payment, because A has not written yet. This is not a race
     that needs precise timing: any two devices that were both offline for
     a minute produce it. */
  const readA = JSON.parse(JSON.stringify(await one(`select data from public.app_state where business_id=$1 and key='layi_dash_txns'`, [BIZ])));
  const readB = JSON.parse(JSON.stringify(readA));

  const X = { id: 'pay-X', amount: 50000, method: 'cash', at: '2026-09-29T10:00:00.000Z' };
  const Y = { id: 'pay-Y', amount: 75000, method: 'transfer', at: '2026-09-29T10:00:30.000Z' };

  readA.push(X);
  await asUser(OWNER, `update public.app_state set data=$2::jsonb where business_id=$1 and key='layi_dash_txns'`,
    [BIZ, JSON.stringify(readA)]);
  readB.push(Y);
  const wB = await asUser(OWNER, `update public.app_state set data=$2::jsonb where business_id=$1 and key='layi_dash_txns'`,
    [BIZ, JSON.stringify(readB)]);

  ok('both writes are accepted, with no error and no conflict', !wB.error, wB.error || '');

  const after = await one(`select data from public.app_state where business_id=$1 and key='layi_dash_txns'`, [BIZ]);
  const list = typeof after === 'string' ? JSON.parse(after) : after;
  const ids = (list || []).map(t => t.id);
  const total = (list || []).reduce((a, t) => a + Number(t.amount || 0), 0);

  ok('and a payment is gone', ids.length === 1,
     'the blob holds ' + ids.length + ' payments: ' + JSON.stringify(ids));
  console.log('        the studio recorded 125,000 and the server holds ' +
              total.toLocaleString() + '. This is the defect, not a bug in the test.');
}

/* =====================================================================
   2. THE SAME TWO PAYMENTS, AS ROWS
   ===================================================================== */
section('2. Rows: two devices, two payments');
{
  const order = await one(`insert into public.orders (business_id,branch_id,app_id,total,status)
    values ($1,$2,'ORD-MONEY',125000,'open') returning id`, [BIZ, BRANCH]);

  /* Same sequence, same staleness, no coordination between the devices. */
  const wa = await asUser(OWNER, `insert into public.transactions (business_id,branch_id,order_id,kind,amount,app_id)
    values ($1,$2,$3,'sale',50000,'pay-X') returning id`, [BIZ, BRANCH, order]);
  const wb = await asUser(OWNER, `insert into public.transactions (business_id,branch_id,order_id,kind,amount,app_id)
    values ($1,$2,$3,'sale',75000,'pay-Y') returning id`, [BIZ, BRANCH, order]);

  ok('both writes are accepted', !wa.error && !wb.error, (wa.error || '') + ' ' + (wb.error || ''));
  const n = await one(`select count(*)::int from public.transactions where business_id=$1`, [BIZ]);
  const sum = await one(`select coalesce(sum(amount),0) from public.transactions where business_id=$1`, [BIZ]);
  ok('both payments exist', n === 2, n + ' rows');
  ok('and the money is all of it', Number(sum) === 125000, String(sum));

  section('3. A retry does not become a second payment');
  {
    /* The device did not hear back and sends the same payment again. Its
       app-level id is what makes that a repeat rather than a new one. */
    const again = await asUser(OWNER, `insert into public.transactions (business_id,branch_id,order_id,kind,amount,app_id)
      values ($1,$2,$3,'sale',50000,'pay-X')
      on conflict (business_id, app_id) do nothing returning id`, [BIZ, BRANCH, order]);
    const n2 = await one(`select count(*)::int from public.transactions where business_id=$1`, [BIZ]);
    ok('a resend of the same payment leaves two, not three', n2 === 2,
       n2 + ' rows (' + (again.error || 'no error') + ')');
    const sum2 = await one(`select coalesce(sum(amount),0) from public.transactions where business_id=$1`, [BIZ]);
    ok('  and the total has not moved', Number(sum2) === 125000, String(sum2));
  }

  section('4. Timeout after the server committed');
  {
    /* Indistinguishable from the client's side: the row is there, the
       answer never arrived. The retry must be the same row. */
    const before = await one(`select count(*)::int from public.transactions where business_id=$1`, [BIZ]);
    for (let i = 0; i < 3; i++) {
      await asUser(OWNER, `insert into public.transactions (business_id,branch_id,order_id,kind,amount,app_id)
        values ($1,$2,$3,'sale',75000,'pay-Y')
        on conflict (business_id, app_id) do nothing`, [BIZ, BRANCH, order]);
    }
    const after = await one(`select count(*)::int from public.transactions where business_id=$1`, [BIZ]);
    ok('three retries of a committed payment add nothing', after === before, before + ' -> ' + after);
  }

  section('5. The balance is the order minus what was paid');
  {
    const bal = await one(`select o.total - coalesce((select sum(t.amount) from public.transactions t
        where t.order_id = o.id and t.kind='sale'),0)
      from public.orders o where o.id=$1`, [order]);
    ok('125,000 of work less 125,000 paid leaves nothing owing', Number(bal) === 0, String(bal));
  }

  section('6. And recording money is a permission, at the API');
  {
    const r = await asUser(STAFF, `insert into public.transactions (business_id,branch_id,order_id,kind,amount,app_id)
      values ($1,$2,$3,'sale',1,'pay-STAFF') returning id`, [BIZ, BRANCH, order]);
    const allowed = await one(`select count(*)::int from public.business_role_permissions p
      join public.business_roles r on r.id=p.role_id
      where r.business_id=$1 and r.key='staff' and p.permission_key='finance.record_payment'`, [BIZ]);
    ok('a staff member may record a payment only if their role says so',
       (r.rows.length > 0) === (allowed > 0),
       'holds=' + (allowed > 0) + ' wrote=' + (r.rows.length > 0) + ' ' + (r.error || ''));
  }

  section('7. Money cannot be moved to another studio');
  {
    const OTHER = 'aca22222-2222-2222-2222-222222222222';
    await db.query(`insert into public.businesses (id,name,slug,plan,status)
      values ($1,'Another','another-money','pro','active') on conflict do nothing`, [OTHER]);
    const r = await asUser(OWNER, `insert into public.transactions (business_id,kind,amount,app_id)
      values ($1,'sale',999,'pay-CROSS') returning id`, [OTHER]);
    ok('an owner of one studio cannot record money in another', r.rows.length === 0,
       r.error || (r.rows.length + ' rows'));
  }
}

console.log('\n' + '='.repeat(62));
section('8. The 76 payments on production, in the shape they are actually in');
{
  /* The live blob's shape, surveyed rather than guessed: dir in/out, cat
     order/sale/expense/supply, a stable id, an orderId on the money that
     came from an order, and eight more fields that have no column and must
     not be dropped. */
  const MB = 'aca33333-3333-3333-3333-333333333333';
  const MU = 'acb33333-3333-3333-3333-333333333333';
  await db.query(`insert into auth.users (id,email) values ($1,'m@blob.test')`, [MU]);
  await db.query(`insert into public.businesses (id,name,slug,plan,status)
    values ($1,'Blob Money','blob-money','pro','active')`, [MB]);
  await db.query(`insert into public.memberships (business_id,user_id,role,status)
    values ($1,$2,'owner','active') on conflict do nothing`, [MB, MU]);
  const mbranch = await one(`insert into public.branches (business_id,name) values ($1,'Abuja outlet') returning id`, [MB]);
  await db.query(`insert into public.orders (business_id,app_id,total,status) values ($1,'L-0001',200000,'open')`, [MB]);

  const TX = [
    {id:'t-a1', dir:'in',  cat:'order',   amount:110000, at:'2026-02-05', branch:'Abuja outlet', orderId:'L-0001',
     method:'Bank transfer', label:'A. Bakare payment', channel:'transfer'},
    {id:'t-a2', dir:'in',  cat:'sale',    amount:58000,  at:'2026-03-01', branch:'Abuja outlet', orderId:'L-0001',
     method:'Cash', label:'Counter sale', channel:'cash'},
    {id:'t-a3', dir:'out', cat:'expense', amount:45000,  at:'2026-03-02', branch:'Abuja outlet',
     method:'Cash', label:'Generator', vendor:'Fuel man', approval:'Approved', category:'Maintenance',
     dept:'Operations', recurring:false, approvedBy:'Kay'},
    {id:'t-a4', dir:'out', cat:'supply',  amount:180000, at:'2026-03-04', branch:'Abuja outlet',
     method:'Bank transfer', label:'Aso-oke', vendor:'Aso-oke weaver', category:'Materials'},
  ];
  const IN  = TX.filter(t => t.dir !== 'out').reduce((a,t) => a + t.amount, 0);
  const OUT = TX.filter(t => t.dir === 'out').reduce((a,t) => a + t.amount, 0);
  await db.query(`insert into public.app_state (business_id,key,data) values ($1,'layi_dash_txns',$2::jsonb)`,
    [MB, JSON.stringify(TX)]);

  const m = (await q(`select * from app.migrate_payments_to_rows($1)`, [MB]))[0];
  ok('every payment moved', Number(m.blob_payments) === 4 && Number(m.rows_after) === 4, JSON.stringify(m));
  ok('  and the money came with them', Number(m.rows_total) === IN + OUT, m.rows_total + ' vs ' + (IN + OUT));

  const r = await one(`select app.reconcile_payments($1)`, [MB]);
  const R = typeof r === 'string' ? JSON.parse(r) : r;
  ok('  nothing missing, nothing duplicated, nothing conflicting',
     (R.missing_identifiers||[]).length === 0 && (R.duplicate_identifiers||[]).length === 0
     && (R.conflicting_identifiers||[]).length === 0, JSON.stringify(R.missing_identifiers));
  ok('  money in matches', Number(R.source_money_in) === IN && Number(R.destination_money_in) === IN,
     R.source_money_in + ' / ' + R.destination_money_in);
  ok('  money out matches, and is not confused with money in',
     Number(R.source_money_out) === OUT && Number(R.destination_money_out) === OUT,
     R.source_money_out + ' / ' + R.destination_money_out);
  ok('  no amount and no direction mismatched',
     Number(R.amount_mismatches) === 0 && Number(R.direction_mismatches) === 0,
     R.amount_mismatches + ' / ' + R.direction_mismatches);
  ok('  the payments that named an order are linked to it',
     Number(R.orders_linked) === Number(R.orders_expected) && Number(R.orders_linked) === 2,
     R.orders_linked + ' of ' + R.orders_expected);
  ok('  and it is green', R.green === true, JSON.stringify(R.green));

  /* the eight fields with no column of their own */
  const kept = await one(`select detail from public.transactions where business_id=$1 and app_id='t-a3'`, [MB]);
  const d = typeof kept === 'string' ? JSON.parse(kept) : kept;
  ok('  the fields with no column are kept rather than dropped',
     !!d && d.vendor === 'Fuel man' && d.approval === 'Approved' && d.dept === 'Operations'
     && d.approvedBy === 'Kay' && d.cat === 'expense',
     JSON.stringify(d));

  ok('  running it twice changes nothing',
     Number((await q(`select * from app.migrate_payments_to_rows($1)`, [MB]))[0].rows_after) === 4);

  section('9. Retiring the payment blob, only once it reconciles');
  {
    /* break it first: a payment in the blob that never arrived */
    await db.query(`delete from public.transactions where business_id=$1 and app_id='t-a2'`, [MB]);
    const refused = await (async () => {
      try { await db.query(`select app.retire_payment_blob($1)`, [MB]); return null; }
      catch (e) { return String(e.message).split(String.fromCharCode(10))[0]; }
    })();
    ok('a studio whose money does not reconcile keeps its blob',
       /does not reconcile/.test(refused || ''), refused || 'IT WAS ALLOWED');
    ok('  and the blob is still there',
       (await one(`select count(*)::int from public.app_state where business_id=$1 and key='layi_dash_txns'`, [MB])) === 1);

    await q(`select * from app.migrate_payments_to_rows($1)`, [MB]);
    const out = await one(`select app.retire_payment_blob($1)`, [MB]);
    const O = typeof out === 'string' ? JSON.parse(out) : out;
    ok('once it does, the blob goes', O && O.retired === true, JSON.stringify(O && O.green));
    ok('  and every payment is still there as a row',
       (await one(`select count(*)::int from public.transactions where business_id=$1`, [MB])) === 4);
    ok('  and the total is untouched',
       Number(await one(`select coalesce(sum(amount),0) from public.transactions where business_id=$1`, [MB])) === IN + OUT);

    const stale = await asUser(MU,
      `insert into public.app_state (business_id,key,data) values ($1,'layi_dash_txns','[]'::jsonb)`, [MB]);
    ok('  and a stale client cannot put the money blob back',
       /out of date/.test(stale.error || ''), stale.error || 'IT WAS ACCEPTED');
  }
}
console.log(pass + ' passed, ' + failures.length + ' failed');
for (const f of failures) console.log('  - ' + f);
if (!failures.length) {
  console.log('\nTwo devices recording two payments produce two payments, a retry\nproduces none, and the balance is what is actually owed.');
}
process.exit(failures.length ? 1 : 0);
