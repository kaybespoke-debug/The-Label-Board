/* =====================================================================
   WHAT ONE MEMBER MAY DO INSIDE THEIR OWN STUDIO.

   rls_harness answers "can Studio A reach Studio B", and answers it
   well — 72 checks, none of which this duplicates. But every one of its
   assertions is about a boundary BETWEEN tenants, and three of the five
   security mutations the audit planted are inside one:

       app.may_read_key() ignoring the key
       customer_contacts readable without seeContact
       audit_log editable by the people it records

   All three sailed through every suite. Not because the rules were
   wrong — the staging probes proved the rules — but because nothing that
   runs offline asked the question. This is that suite.

   tools/mutation_drill.js plants those mutations and requires this file
   to go red for each. If you weaken a check here, the drill says so.

   usage: node supabase/tests/intra_tenant_harness.mjs
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

/* =====================================================================
   ONE STUDIO, FOUR PEOPLE
   ===================================================================== */
const BIZ = '99999999-9999-9999-9999-999999999999';
const U = {
  owner:   '9a000000-0000-0000-0000-000000000001',
  manager: '9a000000-0000-0000-0000-000000000002',
  staff:   '9a000000-0000-0000-0000-000000000003',
  viewer:  '9a000000-0000-0000-0000-000000000004',
};
await db.query(`insert into auth.users (id,email) values
  ($1,'o@intra.test'),($2,'m@intra.test'),($3,'s@intra.test'),($4,'v@intra.test')`,
  [U.owner, U.manager, U.staff, U.viewer]);
await db.query(`insert into public.businesses (id,name,slug,plan,status)
  values ($1,'One Studio','one-studio','pro','active')`, [BIZ]);
const BRANCH = await one(`insert into public.branches (business_id,name) values ($1,'Main') returning id`, [BIZ]);

for (const [k, u] of Object.entries(U)) {
  const rid = await one(`select id from public.business_roles where business_id=$1 and key=$2`, [BIZ, k]);
  await db.query(`insert into public.memberships (business_id,user_id,role,role_id,status)
    values ($1,$2,$3,$4,'active')
    on conflict (business_id,user_id) do update set role=excluded.role, role_id=excluded.role_id`,
    [BIZ, u, k, rid]);
}

/* does this role actually hold that permission? asked, never assumed */
const holds = async (who, perm) => {
  const m = (await q(`select role, role_id from public.memberships where business_id=$1 and user_id=$2`, [BIZ, U[who]]))[0];
  if (!m) return false;
  if (m.role === 'owner') return true;
  if (!m.role_id) return false;
  return (await one(`select count(*)::int from public.business_role_permissions
    where role_id=$1 and permission_key=$2`, [m.role_id, perm])) > 0;
};

/* =====================================================================
   1. app_state IS PER KEY, NOT PER MEMBERSHIP
   ===================================================================== */
section('1. A key you have no permission for is not yours to read');
{
  /* seeded as the studio itself so a false read is a refusal and not an
     empty table — the distinction the audit's probes kept finding */
  const KEYS = ['layi_dash_txns', 'layi_dash_audit', 'layi_dash_bills', 'layi_dash_staff',
                'layi_dash_settings', 'layi_dash_products'];
  for (const k of KEYS) {
    await db.query(`insert into public.app_state (business_id,key,data)
      values ($1,$2,'{"seeded":true}'::jsonb) on conflict (business_id,key) do nothing`, [BIZ, k]);
  }
  const seeded = await one(`select count(*)::int from public.app_state where business_id=$1`, [BIZ]);
  ok('every key under test has a row to read', seeded === KEYS.length, seeded + ' of ' + KEYS.length);

  /* THE MUTATION THIS CATCHES: may_read_key() ignoring p_key. If the key
     stops mattering, a viewer reads all six and this goes red. */
  let wrong = [];
  for (const k of KEYS) {
    const perm = await one(`select app.perm_for_key($1)`, [k]);
    for (const who of ['owner', 'manager', 'staff', 'viewer']) {
      const may = perm === null ? true : await holds(who, perm);
      const r = await asUser(U[who], `select data from public.app_state where business_id=$1 and key=$2`, [BIZ, k]);
      const saw = r.rows.length > 0;
      if (saw !== may) wrong.push(who + ' ' + (saw ? 'READ' : 'could not read') + ' ' + k + ' (needs ' + perm + ')');
    }
  }
  ok('each person reads exactly the keys their permissions allow', wrong.length === 0,
     wrong.join('; '));

  const viewerSees = await asUser(U.viewer, `select key from public.app_state where business_id=$1`, [BIZ]);
  ok('  and a viewer does NOT see all of them', viewerSees.rows.length < KEYS.length,
     'a viewer read ' + viewerSees.rows.length + ' of ' + KEYS.length + ' keys');

  const money = await asUser(U.viewer, `select data from public.app_state where business_id=$1 and key='layi_dash_txns'`, [BIZ]);
  ok('  specifically, a viewer cannot read the money', money.rows.length === 0,
     money.error || (money.rows.length + ' rows'));
  const trail = await asUser(U.staff, `select data from public.app_state where business_id=$1 and key='layi_dash_audit'`, [BIZ]);
  ok('  nor a staff member the audit trail', trail.rows.length === 0,
     trail.error || (trail.rows.length + ' rows'));
}

/* =====================================================================
   2. CONTACT DETAILS NEED seeContact
   ===================================================================== */
section('2. A client’s contact details need the permission for them');
{
  const cust = await one(`insert into public.customers (business_id,branch_id,name)
    values ($1,$2,'Mrs Oladuja') returning id`, [BIZ, BRANCH]);
  await db.query(`insert into public.customer_contacts (customer_id,business_id,branch_id,phone,email)
    values ($1,$2,$3,'+234 802 000 0000','o@example.test')`, [cust, BIZ, BRANCH]);

  /* THE MUTATION THIS CATCHES: customer_contacts_select using in_scope
     instead of seeContact. Then the viewer reads it and this goes red. */
  let wrong = [];
  for (const who of ['owner', 'manager', 'staff', 'viewer']) {
    const may = await holds(who, 'seeContact');
    const r = await asUser(U[who], `select phone, email from public.customer_contacts where business_id=$1`, [BIZ]);
    const saw = r.rows.length > 0;
    if (saw !== may) wrong.push(who + ' ' + (saw ? 'READ' : 'could not read') + ' the contact details, holds=' + may);
  }
  ok('contact details follow seeContact exactly', wrong.length === 0, wrong.join('; '));

  const v = await asUser(U.viewer, `select phone from public.customer_contacts where business_id=$1`, [BIZ]);
  ok('  a viewer is refused them', v.rows.length === 0, v.error || (v.rows.length + ' rows'));
  ok('  and the client record itself is still readable, so this is the FIELDS and not the person',
     (await asUser(U.viewer, `select name from public.customers where business_id=$1`, [BIZ])).rows.length === 1);

  /* naming the row directly is not a way round a rule about the row */
  const byId = await asUser(U.viewer, `select phone from public.customer_contacts where customer_id=$1`, [cust]);
  ok('  and asking for one client by id does not help', byId.rows.length === 0,
     byId.error || (byId.rows.length + ' rows'));
}

/* =====================================================================
   3. THE AUDIT TRAIL IS WRITTEN, NEVER REWRITTEN
   ===================================================================== */
section('3. History cannot be edited by the people it is about');
{
  await db.query(`select app.audit($1,'Something happened','once')`, [BIZ]);
  const n = await one(`select count(*)::int from public.audit_log where business_id=$1`, [BIZ]);
  ok('there is a line in the history', n >= 1, String(n));

  const row = await one(`select id from public.audit_log where business_id=$1 limit 1`, [BIZ]);

  /* THE MUTATION THIS CATCHES: an UPDATE or DELETE policy on audit_log.
     With one, the owner rewrites their own history and this goes red. */
  for (const who of ['owner', 'manager', 'staff', 'viewer']) {
    const upd = await asUser(U[who],
      `update public.audit_log set action='It did not happen' where id=$1 returning id`, [row]);
    const changed = await one(`select action from public.audit_log where id=$1`, [row]);
    ok(who + ' cannot rewrite a line of history',
       changed === 'Something happened', 'it now reads: ' + changed + ' (' + (upd.error || 'no error') + ')');
  }
  for (const who of ['owner', 'manager']) {
    await asUser(U[who], `delete from public.audit_log where id=$1`, [row]);
    const still = await one(`select count(*)::int from public.audit_log where id=$1`, [row]);
    ok(who + ' cannot delete one either', still === 1, 'rows left: ' + still);
  }

  /* and the actor is the server's answer, not the client's */
  const forged = await asUser(U.staff,
    `insert into public.audit_log (business_id, action, detail, actor_id)
     values ($1,'Forged','by somebody else',$2) returning id`, [BIZ, U.owner]);
  const forgedRow = forged.rows.length
    ? await one(`select actor_id from public.audit_log where id=$1`, [forged.rows[0].id]) : null;
  ok('a member cannot write history in somebody else’s name',
     forged.rows.length === 0 || forgedRow === U.staff,
     'the row records actor ' + forgedRow + ' for a write by staff');
}

/* =====================================================================
   4. AND THE PERMISSION FUNCTION ITSELF DISCRIMINATES
   ===================================================================== */
section('4. app.can() gives different answers to different people');
{
  /* THE MUTATION THIS CATCHES: app.can() returning true. If everybody
     holds everything, these stop differing and this goes red. */
  const answers = {};
  for (const who of ['owner', 'manager', 'staff', 'viewer']) {
    const r = await asUser(U[who], `select app.can($1,'audit') a, app.can($1,'seeCost') b,
                                           app.can($1,'orders') c, app.can($1,'users') d`, [BIZ]);
    answers[who] = r.rows[0] ? [r.rows[0].a, r.rows[0].b, r.rows[0].c, r.rows[0].d].join(',') : 'error';
  }
  ok('the owner holds all four', answers.owner === 'true,true,true,true', answers.owner);
  ok('a viewer does not', answers.viewer !== 'true,true,true,true', answers.viewer);
  ok('and the four roles do not all give the same answer',
     new Set(Object.values(answers)).size > 1, JSON.stringify(answers));
}

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + failures.length + ' failed');
for (const f of failures) console.log('  - ' + f);
if (!failures.length) {
  console.log('\nInside one studio, a key, a contact detail and a line of history\neach need the permission that guards them, and history needs one\nnobody has.');
}
process.exit(failures.length ? 1 : 0);
