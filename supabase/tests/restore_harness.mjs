/* The restore drill.
 *
 * A backup nobody has restored is a file nobody knows the shape of. This
 * suite is the drill, run every time, against a database built from the
 * migrations alone:
 *
 *   1. build a studio with real work in it — orders with costs, clients with
 *      contact details, money, a team, a branch, a role with permissions and
 *      an audit trail
 *   2. export it the way the owner would
 *   3. purge it, for real, so nothing is left to fall back on
 *   4. restore it from the file alone
 *   5. compare both sides row for row, naira for naira, and check the parts
 *      that a careless restore would quietly change
 *
 * Step 5 is the point. A restore that gets the counts right and the history
 * wrong looks like a success and is not: the audit trail would say the
 * operator who ran the restore did everything the studio ever did, and the
 * suspended member would come back able to sign in. Both are asserted here
 * because both were real risks in the first version.
 */
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
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);
const migDir = join(repo, 'supabase/migrations');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(migDir, f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message.split('\n')[0]); process.exit(1); }
}
console.log('Built from the migrations alone.');

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
const admin = async (sql, params = []) => (await db.query(sql, params)).rows;

const U = {
  ada:   'a1111111-1111-1111-1111-111111111111',
  tunde: 'a2222222-2222-2222-2222-222222222222',
  chidi: 'a3333333-3333-3333-3333-333333333333',
  op:    'a5555555-5555-5555-5555-555555555555',
};
const BIZ = 'aaaa0000-0000-0000-0000-00000000aaaa';
const BR  = 'bbbb0000-0000-0000-0000-00000000bbbb';

await admin(`insert into auth.users (id,email) values
  ($1,'ada@drill.test'),($2,'tunde@drill.test'),($3,'chidi@drill.test'),($4,'op@thelabelboard.com')`,
  [U.ada, U.tunde, U.chidi, U.op]);
await admin(`insert into public.platform_admins (id,email,name) values ($1,'op@thelabelboard.com','Operator')`, [U.op]);
await admin(`insert into public.businesses (id,name,slug,plan,status) values
  ($1,'Drill Studio','drill-studio','pro','active')`, [BIZ]);
await admin(`insert into public.branches (id,business_id,name) values ($1,$2,'Yaba')`, [BR, BIZ]);
await admin(`insert into public.memberships (user_id,business_id,role,status) values
  ($1,$4,'owner','active'),($2,$4,'manager','active'),($3,$4,'staff','suspended')`,
  [U.ada, U.tunde, U.chidi, BIZ]);
await admin(`insert into public.profiles (id,name,role_id,business_id) values
  ($1,'Ada','owner',$4),($2,'Tunde','manager',$4),($3,'Chidi','staff',$4)
  on conflict (id) do update set name = excluded.name`, [U.ada, U.tunde, U.chidi, BIZ]);

/* real work: three orders, two of them with a cost, two clients, one of whom
   has contact details, money in and money out, and a settings blob */
const orderIds = [];
/* A DISCOUNT AND A PART PAYMENT ON PURPOSE. All three figures have to come
   back out of an older backup, and a fixture where the discount is zero and
   nothing has been paid cannot tell a carry-forward that works from one
   that silently writes nothing. */
for (const [ref, total, discount, paid, cost] of [
  ['L-0001', 45000,  5000, 20000, 18000],
  ['L-0002', 120000,     0, 60000, 52000],
  ['L-0003', 9000,    1500,     0,     0],
]) {
  const r = await admin(`insert into public.orders (business_id,branch_id,app_id,ref,doc)
    values ($1,$2,$3,$3,$4) returning id`,
    [BIZ, BR, ref, JSON.stringify({ id: ref })]);
  orderIds.push(r[0].id);
  /* THE PRICE IS A ROW OF ITS OWN SINCE OCTOBER. orders.total was the
     selling price in a plain column every member with `orders` could
     read; it is order_pricing.value now, behind `money`, and what has been
     paid is order_settlement.paid behind `receivables`. */
  await admin(`insert into public.order_pricing (order_id,business_id,branch_id,value,discount)
    values ($1,$2,$3,$4,$5)`, [r[0].id, BIZ, BR, total, discount]);
  if (paid) await admin(`insert into public.order_settlement (order_id,business_id,branch_id,paid)
    values ($1,$2,$3,$4)`, [r[0].id, BIZ, BR, paid]);
  if (cost) await admin(`insert into public.order_costs (order_id,business_id,branch_id,cost) values ($1,$2,$3,$4)`,
    [r[0].id, BIZ, BR, cost]);
}
const cust = await admin(`insert into public.customers (business_id,branch_id,name,measurements)
  values ($1,$2,'Mrs Oladuja','{"meas":{"Waist":"32"}}'::jsonb),($1,$2,'Mr Eze','{}'::jsonb) returning id`, [BIZ, BR]);
await admin(`insert into public.customer_contacts (customer_id,business_id,branch_id,phone,email)
  values ($1,$2,$3,'+234 802 000 0000','o@drill.test')`, [cust[0].id, BIZ, BR]);
await admin(`insert into public.transactions (business_id,branch_id,kind,amount,at) values
  ($1,$2,'sale',45000,now()),($1,$2,'sale',120000,now()),($1,$2,'expense',30000,now())`, [BIZ, BR]);
/* THE MONEY IS THE THREE TRANSACTIONS ABOVE, not a layi_dash_txns blob.
   This used to seed both, which is a state no studio can be in any more:
   once a studio's payments are rows, writing that key is refused with "this
   app is out of date". The suite was asserting that an export carries a
   legacy blob it will never see again; what matters is that it carries the
   rows, which section 3 checks. */
await admin(`insert into public.app_state (business_id,key,data) values
  ($1,'layi_dash_settings','{"biz":"Drill Studio","currency":"NGN"}'::jsonb)`, [BIZ]);
await admin(`insert into public.suppliers (business_id,name,type) values ($1,'Aso-oke House','Fabric Supplier')`, [BIZ]);
await admin(`insert into public.products (business_id,name,price) values ($1,'Agbada',85000)`, [BIZ]);
await admin(`insert into public.staff (business_id,branch_id,name,job_title) values ($1,$2,'Chidi','Tailor')`, [BIZ, BR]);

/* a role the studio changed itself, because a restore that loses the roles
   loses who may do what, which is the part nobody notices until somebody
   cannot open a screen */
await admin(`delete from public.business_role_permissions p
  using public.business_roles r
  where p.role_id = r.id and r.business_id = $1 and r.key = 'staff' and p.permission_key = 'money'`, [BIZ]);
await admin(`insert into public.business_role_permissions (role_id, permission_key)
  select r.id, 'audit' from public.business_roles r where r.business_id=$1 and r.key='manager'
  on conflict do nothing`, [BIZ]);

const beforeCounts = (await admin(`select
  (select count(*) from public.orders where business_id=$1) orders,
  (select count(*) from public.order_costs where business_id=$1) costs,
  (select count(*) from public.customers where business_id=$1) customers,
  (select count(*) from public.customer_contacts where business_id=$1) contacts,
  (select count(*) from public.transactions where business_id=$1) txns,
  (select count(*) from public.app_state where business_id=$1) state,
  (select count(*) from public.memberships where business_id=$1) members,
  (select count(*) from public.business_roles where business_id=$1) roles,
  (select count(*) from public.audit_log where business_id=$1) audit,
  (select coalesce(sum(value),0) from public.order_pricing where business_id=$1) order_total,
  (select coalesce(sum(cost),0) from public.order_costs where business_id=$1) cost_total,
  (select coalesce(sum(amount),0) from public.transactions where business_id=$1) money`, [BIZ]))[0];

const beforeAudit = (await admin(`select action, actor, source from public.audit_log
  where business_id=$1 order by id`, [BIZ]));
const beforePerms = (await admin(`select r.key, p.permission_key from public.business_roles r
  join public.business_role_permissions p on p.role_id = r.id
  where r.business_id=$1 order by 1,2`, [BIZ]));

// =====================================================================
section('The studio has something worth losing');
// =====================================================================
ok('it has orders', Number(beforeCounts.orders) === 3, beforeCounts.orders + '');
ok('two of them cost something', Number(beforeCounts.costs) === 2, beforeCounts.costs + '');
ok('it has clients, one with contact details',
   Number(beforeCounts.customers) === 2 && Number(beforeCounts.contacts) === 1,
   beforeCounts.customers + ' / ' + beforeCounts.contacts);
ok('it has money', Number(beforeCounts.money) === 195000, beforeCounts.money + '');
ok('and an audit trail the database wrote itself', Number(beforeCounts.audit) > 0,
   beforeCounts.audit + ' lines');
ok('and a permission table the studio changed', beforePerms.length > 0, beforePerms.length + ' grants');

// =====================================================================
section('The owner exports it');
// =====================================================================
let file = null;
{
  const e = await asUser(U.ada, `select public.export_studio($1) as j`, [BIZ]);
  ok('the export runs', !e.error, e.error);
  file = e.rows[0]?.j;
  ok('and is a studio export', file?._export === 'studio', JSON.stringify(file?._export));
  ok('carrying every order', (file?.orders || []).length === 3, (file?.orders || []).length + '');
  ok('every cost', (file?.order_costs || []).length === 2, (file?.order_costs || []).length + '');
  ok('the contact details a device may never have held',
     (file?.customer_contacts || []).length === 1, (file?.customer_contacts || []).length + '');
  ok('the roles and what they may do',
     (file?.business_roles || []).length >= 4 && (file?.role_permissions || []).length > 0,
     (file?.business_roles || []).length + ' roles, ' + (file?.role_permissions || []).length + ' grants');
  ok('and the audit trail', (file?.audit_log || []).length > 0, (file?.audit_log || []).length + '');
}

// =====================================================================
section('It is purged, for real');
// =====================================================================
{
  await asUser(U.ada, `select public.close_studio($1,'the drill')`, [BIZ]);
  await admin(`update public.businesses set purge_after = now() - interval '1 day' where id=$1`, [BIZ]);
  const p = await asUser(U.op, `select public.purge_studio($1)`, [BIZ]);
  ok('the purge runs', !p.error, p.error);
  const left = (await admin(`select
    (select count(*) from public.businesses where id=$1) b,
    (select count(*) from public.orders where business_id=$1) o,
    (select count(*) from public.audit_log where business_id=$1) a`, [BIZ]))[0];
  ok('and there is nothing left to fall back on',
     Number(left.b) === 0 && Number(left.o) === 0 && Number(left.a) === 0, JSON.stringify(left));
}

// =====================================================================
section('Only we can restore, and only from a real export');
// =====================================================================
{
  const byTenant = await asUser(U.ada, `select public.import_studio($1::jsonb)`, [JSON.stringify(file)]);
  ok('a studio owner cannot restore a studio', !!byTenant.error, 'it restored');
  const byAnon = await asRole('anon', null, `select public.import_studio($1::jsonb)`, [JSON.stringify(file)]);
  ok('nor can an anonymous caller', !!byAnon.error, 'it restored');
  const junk = await asUser(U.op, `select public.import_studio('{"hello":"world"}'::jsonb)`);
  ok('and a file that is not an export is refused', !!junk.error, 'it restored');
  ok('with a sentence rather than a crash', /not a studio export/.test(junk.error || ''), junk.error);
}

// =====================================================================
section('The restore');
// =====================================================================
{
  const r = await asUser(U.op, `select public.import_studio($1::jsonb) as j`, [JSON.stringify(file)]);
  ok('it restores', !r.error, r.error);
  ok('as the same studio, not a copy of it', r.rows[0]?.j?.business_id === BIZ,
     String(r.rows[0]?.j?.business_id));

  const after = (await admin(`select
    (select count(*) from public.orders where business_id=$1) orders,
    (select count(*) from public.order_costs where business_id=$1) costs,
    (select count(*) from public.customers where business_id=$1) customers,
    (select count(*) from public.customer_contacts where business_id=$1) contacts,
    (select count(*) from public.transactions where business_id=$1) txns,
    (select count(*) from public.app_state where business_id=$1) state,
    (select count(*) from public.memberships where business_id=$1) members,
    (select count(*) from public.business_roles where business_id=$1) roles,
    (select coalesce(sum(value),0) from public.order_pricing where business_id=$1) order_total,
    (select coalesce(sum(cost),0) from public.order_costs where business_id=$1) cost_total,
    (select coalesce(sum(amount),0) from public.transactions where business_id=$1) money`, [BIZ]))[0];

  for (const k of ['orders','costs','customers','contacts','txns','state','members','roles']) {
    ok('the same number of ' + k, String(after[k]) === String(beforeCounts[k]),
       beforeCounts[k] + ' -> ' + after[k]);
  }
  for (const k of ['order_total','cost_total','money']) {
    ok('the same ' + k.replace('_', ' '), Number(after[k]) === Number(beforeCounts[k]),
       beforeCounts[k] + ' -> ' + after[k]);
  }

  const b = (await admin(`select name, slug, plan, status, closed_at, purge_after
                            from public.businesses where id=$1`, [BIZ]))[0];
  ok('the studio has its name back', b.name === 'Drill Studio', b.name);
  ok('and its address', b.slug === 'drill-studio', b.slug);
  ok('and its plan', b.plan === 'pro', b.plan);
  /* IT COMES BACK AS IT WAS EXPORTED, which here is open, because the export
     was taken before the studio closed. That is the right behaviour and it is
     worth naming: the restore replays a file, it does not decide a state. The
     closing that came after the export is not in the file and is therefore
     not in the restore, and neither is the purge date. */
  ok('and comes back in the state it was exported in', b.status === 'active', b.status);
  ok('with no closing date left over from the purge it went through',
     !b.closed_at && !b.purge_after, JSON.stringify({ closed_at: b.closed_at, purge_after: b.purge_after }));
}

// =====================================================================
section('The parts a careless restore would quietly change');
// =====================================================================
{
  const afterAudit = (await admin(`select action, actor, source from public.audit_log
    where business_id=$1 order by id`, [BIZ]));
  /* One extra line: the restore records itself. Everything before it must be
     exactly what it was. */
  ok('the history is back, with the restore added to the end',
     afterAudit.length === beforeAudit.length + 1,
     beforeAudit.length + ' -> ' + afterAudit.length);
  ok('and the last line says what happened',
     /restored/i.test(afterAudit[afterAudit.length - 1]?.action || ''),
     afterAudit[afterAudit.length - 1]?.action);

  const sameHistory = beforeAudit.every((row, i) =>
    afterAudit[i] && afterAudit[i].action === row.action
    && String(afterAudit[i].actor) === String(row.actor)
    && afterAudit[i].source === row.source);
  /* THE ONE THAT WOULD HAVE LOOKED FINE. With the audit trigger left on, every
     restored line would name the operator who ran the restore, because that is
     precisely what the trigger is for. The counts would still have matched. */
  ok('every restored line still names who actually did it, not who restored it',
     sameHistory, JSON.stringify({ was: beforeAudit.slice(0, 3), now: afterAudit.slice(0, 3) }));

  const afterPerms = (await admin(`select r.key, p.permission_key from public.business_roles r
    join public.business_role_permissions p on p.role_id = r.id
    where r.business_id=$1 order by 1,2`, [BIZ]));
  ok('the permission table is the studio’s own, not a fresh seed',
     afterPerms.length === beforePerms.length
     && afterPerms.every((x, i) => x.key === beforePerms[i].key
        && x.permission_key === beforePerms[i].permission_key),
     beforePerms.length + ' -> ' + afterPerms.length);
  ok('so the permission the studio took away is still away',
     !afterPerms.some(x => x.key === 'staff' && x.permission_key === 'money'),
     'staff can see money again');
  ok('and the one it granted is still granted',
     afterPerms.some(x => x.key === 'manager' && x.permission_key === 'audit'),
     'the manager lost the audit permission');

  /* the suspended member. A restore that sets everybody active hands a key
     back to the person the studio deliberately shut out. */
  const m = await admin(`select user_id, status, closed_from from public.memberships where business_id=$1`, [BIZ]);
  const by = Object.fromEntries(m.map(x => [x.user_id, x]));
  ok('the suspended member is still suspended', by[U.chidi]?.closed_from === 'suspended'
     || by[U.chidi]?.status === 'suspended',
     JSON.stringify(by[U.chidi]));

  /* the sequence. Restoring rows with their own ids and leaving the sequence
     behind hands the next real event an id that is already taken. */
  const next = await admin(`insert into public.audit_log (business_id, action, detail)
    values ($1,'A new event after the restore','') returning id`, [BIZ]);
  ok('a new event after the restore gets an id of its own', next.length === 1,
     'the sequence was left behind');
}

// =====================================================================
section('And the studio works again');
// =====================================================================
{
  /* No reopening step, and that is the measurement: the studio the file came
     from was working, so the studio the file produced is working, with nobody
     having to know a second command. */
  const o = await asUser(U.ada, `select id from public.orders where business_id=$1`, [BIZ]);
  ok('the owner sees their three orders', o.rows.length === 3, 'saw ' + o.rows.length);
  const c = await asUser(U.ada, `select cost from public.order_costs where business_id=$1`, [BIZ]);
  ok('and the costs', c.rows.length === 2, 'saw ' + c.rows.length);
  const k = await asUser(U.ada, `select phone from public.customer_contacts where business_id=$1`, [BIZ]);
  ok('and the client contact details', k.rows.length === 1 && /802 000 0000/.test(k.rows[0].phone),
     JSON.stringify(k.rows));
  /* one app_state key now, not two: the money moved out of app_state and
     into transactions, which the manager reads above */
  const staff = await asUser(U.tunde, `select key from public.app_state where business_id=$1`, [BIZ]);
  ok('and the manager can work', staff.rows.length === 1, 'saw ' + staff.rows.length);
  const suspended = await asUser(U.chidi, `select id from public.orders where business_id=$1`, [BIZ]);
  ok('while the suspended member still cannot', suspended.rows.length === 0,
     'saw ' + suspended.rows.length + ' orders');
}

// =====================================================================
section('It refuses to restore over a studio that is still there');
// =====================================================================
{
  const again = await asUser(U.op, `select public.import_studio($1::jsonb)`, [JSON.stringify(file)]);
  ok('a second restore is refused', !!again.error, 'it restored twice');
  ok('and says why', /still here/.test(again.error || ''), again.error);
  const counts = (await admin(`select count(*) c from public.orders where business_id=$1`, [BIZ]))[0];
  ok('and nothing was doubled by the attempt', Number(counts.c) === 3, counts.c + ' orders');
}

// =====================================================================
section('A backup taken before the price moved still knows the price');
// =====================================================================
// Eighteen production backups were version 3 files: the money is in each
// order's document, where it always was, and there is no order_pricing
// array in the file at all. The restore runs with every user trigger
// switched off, so a version 3 file would put those documents back
// untouched and nothing would read them — a studio complete in every
// visible respect with every order showing a dash.
//
// This is the second time in a fortnight that an export has been complete
// except for the money; the first was the commissions. So app.import_studio
// reads the file's _version and carries it forward itself, rather than
// leaving a step in a runbook for somebody to remember at four in the
// morning.
//
// The same studio, purged and restored again, because that IS the recovery
// path. Rewriting every identifier to build a second studio would be
// testing a shape nobody will ever restore.
{
  /* A genuine version 3 file, built from the version 4 one the way
     app.export_studio_raw built them before October: the money back inside
     each document, and the two arrays gone. */
  const v3 = JSON.parse(JSON.stringify(file));
  v3._version = 3;
  const priceOf = {}, paidOf = {};
  for (const p of v3.order_pricing || []) priceOf[p.order_id] = p;
  for (const t of v3.order_settlement || []) paidOf[t.order_id] = t;
  for (const o of v3.orders || []) {
    const p = priceOf[o.id], t = paidOf[o.id];
    if (p) o.doc = Object.assign({}, o.doc, { value: Number(p.value), discount: Number(p.discount) });
    if (t) o.doc = Object.assign({}, o.doc, { paid: Number(t.paid) });
  }
  const SRC = {
    orders: (v3.orders || []).length,
    ids: (v3.orders || []).map(o => o.app_id).sort(),
    price: (v3.order_pricing || []).reduce((a, p) => a + Number(p.value || 0), 0),
    discount: (v3.order_pricing || []).reduce((a, p) => a + Number(p.discount || 0), 0),
    paid: (v3.order_settlement || []).reduce((a, p) => a + Number(p.paid || 0), 0),
  };
  delete v3.order_pricing;
  delete v3.order_settlement;

  ok('the version 3 file carries the money in the documents and nowhere else',
     SRC.price > 0 && SRC.paid > 0
     && (v3.orders || []).every(o => o.doc && o.doc.value != null)
     && !v3.order_pricing && !v3.order_settlement,
     JSON.stringify(SRC));
  ok('  and a discount worth checking', SRC.discount > 0, String(SRC.discount));

  /* purge the studio the version 4 file restored, so the version 3 one has
     somewhere to go — the real path, not a contrivance. A studio has to be
     closed before it can be purged, which is the rule the first purge in
     this file goes through too. */
  await asUser(U.ada, `select public.close_studio($1,'the version 3 drill')`, [BIZ]);
  await admin(`update public.businesses set purge_after = now() - interval '1 day' where id=$1`, [BIZ]);
  const p2 = await asUser(U.op, `select public.purge_studio($1)`, [BIZ]);
  ok('the studio is purged again', !p2.error, p2.error);
  const gone = await admin(`select count(*) c from public.businesses where id=$1`, [BIZ]);
  ok('  and really gone', Number(gone[0].c) === 0, gone[0].c + ' left');

  const r = await asUser(U.op, `select public.import_studio($1::jsonb) as j`, [JSON.stringify(v3)]);
  ok('the version 3 file restores', !r.error, r.error);

  if (!r.error) {
    const j = r.rows[0] && r.rows[0].j;
    ok('  and the restore says which format it read',
       j && Number(j.export_version) === 3, JSON.stringify(j && j.export_version));

    const got = (await admin(`select
        (select count(*) from public.orders where business_id=$1) orders,
        (select coalesce(sum(value),0) from public.order_pricing where business_id=$1) price,
        (select coalesce(sum(discount),0) from public.order_pricing where business_id=$1) discount,
        (select coalesce(sum(paid),0) from public.order_settlement where business_id=$1) paid,
        (select count(*) from public.order_pricing where business_id=$1) priced,
        (select count(*) from public.order_settlement where business_id=$1) settled,
        (select count(*) from public.orders where business_id=$1
          and (doc ?| array['value','discount','paid','potContribs']
               or (doc->'delivery') ? 'fee')) leftover`, [BIZ]))[0];

    ok('  every order came back', Number(got.orders) === SRC.orders,
       got.orders + ' of ' + SRC.orders);
    const ids = (await admin(`select app_id from public.orders where business_id=$1 order by app_id`, [BIZ]))
      .map(x => x.app_id);
    ok('  with the same identifiers, not merely the same count',
       JSON.stringify(ids) === JSON.stringify(SRC.ids),
       JSON.stringify(ids) + ' vs ' + JSON.stringify(SRC.ids));

    ok('  THE SELLING PRICE is preserved exactly',
       Number(got.price) === SRC.price, got.price + ' vs ' + SRC.price);
    ok('  THE DISCOUNT is preserved exactly',
       Number(got.discount) === SRC.discount, got.discount + ' vs ' + SRC.discount);
    ok('  WHAT HAD BEEN PAID is preserved exactly',
       Number(got.paid) === SRC.paid, got.paid + ' vs ' + SRC.paid);
    ok('  and every order that had money has a row for it',
       Number(got.priced) === (v3.orders || []).filter(o => o.doc && o.doc.value != null).length,
       got.priced + ' priced, ' + got.settled + ' settled');

    ok('  and the documents carry none of it any more',
       Number(got.leftover) === 0, got.leftover + ' documents still have money in them');

    /* AND THE BALANCE, WHICH IS THE POINT OF KEEPING BOTH. It is
       value - discount - paid, so it only exists if both halves came
       across, and it is what a studio actually looks at. */
    const bal = (await admin(`select
        coalesce(sum(p.value - p.discount - coalesce(s.paid,0)),0) as owed
      from public.order_pricing p
      left join public.order_settlement s on s.order_id = p.order_id
      where p.business_id=$1`, [BIZ]))[0];
    ok('  so the outstanding balance is the one the file described',
       Number(bal.owed) === SRC.price - SRC.discount - SRC.paid,
       bal.owed + ' vs ' + (SRC.price - SRC.discount - SRC.paid));

    /* and the walls are still up on what came back */
    const reach = await asUser(U.ada, `select value from public.order_pricing where business_id=$1`, [BIZ]);
    ok('  the owner reads the restored prices', reach.rows.length > 0, reach.error);
    const outsider = await asUser(U.op, `select value from public.order_pricing where business_id=$1`, [BIZ]);
    ok('  and an operator with no membership does not',
       outsider.rows.length === 0, 'saw ' + outsider.rows.length);
  }
}

// =====================================================================
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('\nA studio was exported, purged, and put back from the file alone:');
console.log('same rows, same money, same history, same permissions.');
