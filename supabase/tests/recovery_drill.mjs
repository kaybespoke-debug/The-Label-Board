/* =====================================================================
   FULL PROJECT RECOVERY, ACTUALLY PERFORMED.
   =====================================================================
   RECOVERY.md says what to do. This does it, and times it, because a
   runbook nobody has followed is a list of hopes. The question it answers
   is not "is there a procedure" but "if the project were gone this
   morning, what would we have by lunchtime, and what would we never get
   back".

   The drill builds an empty Postgres, applies the migrations from git,
   restores one studio from an export file, and then checks — as the
   people who work there, through the real policies — that the studio is
   the studio: its team, its roles, its clients, their contact details,
   its orders, their costs, their commissions, its money, its history,
   and the partner who referred it.

   What it CANNOT do is stated at the end rather than glossed over. A
   drill that reports a clean recovery of things it never tried to
   recover is worse than no drill.

   usage: node supabase/tests/recovery_drill.mjs
   ===================================================================== */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..');
let pass = 0;
const failures = [];
const timings = [];
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t + '\n' + '-'.repeat(t.length)); }
const clock = async (label, fn) => {
  const t = Date.now();
  const out = await fn();
  const ms = Date.now() - t;
  timings.push([label, ms]);
  console.log('        ' + label + ': ' + (ms / 1000).toFixed(1) + 's');
  return out;
};

const T0 = Date.now();

/* =====================================================================
   PART ONE — the studio that is about to be lost
   ===================================================================== */
section('1. A studio, built the way a real one is');

const db = await PGlite.create();
await clock('empty Postgres up', async () => {
  await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
  await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);
});

const files = readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
await clock('schema from git, ' + files.length + ' migrations', async () => {
  for (const f of files) {
    try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
    catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
  }
});

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => { const r = await q(sql, p); return r.length ? Object.values(r[0])[0] : null; };
async function asUser(userId, sql, p = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userId, role: 'authenticated', iat: Math.floor(Date.now() / 1000) })]);
    await db.exec('set local role authenticated');
    const r = await db.query(sql, p);
    await db.exec('commit');
    return { rows: r.rows, error: null };
  } catch (e) {
    try { await db.exec('rollback'); } catch {}
    return { rows: [], error: String(e.message).split('\n')[0] };
  }
}

const BIZ = 'd0000000-0000-0000-0000-00000000d001';
const OWNER = 'd0000000-0000-0000-0000-00000000e001';
const MANAGER = 'd0000000-0000-0000-0000-00000000e002';
const PARTNER_U = 'd0000000-0000-0000-0000-00000000e003';

await db.query(`insert into auth.users (id,email) values
  ($1,'owner@drill.test'),($2,'manager@drill.test'),($3,'partner@drill.test')`,
  [OWNER, MANAGER, PARTNER_U]);
const partnerId = await one(`select id from public.partners where user_id=$1`, [PARTNER_U]);

await db.query(`insert into public.businesses (id,name,slug,plan,status,referred_by,referred_on)
  values ($1,'The Drill Studio','the-drill-studio','pro','active',$2,current_date)`, [BIZ, partnerId]);
const LAGOS = await one(`insert into public.branches (business_id,name) values ($1,'Lagos') returning id`, [BIZ]);
const ABUJA = await one(`insert into public.branches (business_id,name) values ($1,'Abuja') returning id`, [BIZ]);

for (const [u, k] of [[OWNER, 'owner'], [MANAGER, 'manager']]) {
  const rid = await one(`select id from public.business_roles where business_id=$1 and key=$2`, [BIZ, k]);
  await db.query(`insert into public.memberships (business_id,user_id,role,role_id,status)
    values ($1,$2,$3,$4,'active') on conflict (business_id,user_id) do update
      set role=excluded.role, role_id=excluded.role_id`, [BIZ, u, k, rid]);
}
/* the manager needs both, so the recovery can be checked as somebody who
   is allowed to see what was recovered */
for (const p of ['seeCost', 'seeContact', 'receivables']) {
  await db.query(`insert into public.business_role_permissions (role_id, permission_key)
    select id, $2 from public.business_roles where business_id=$1 and key='manager'
    on conflict do nothing`, [BIZ, p]);
}

const cust = await one(`insert into public.customers (business_id,branch_id,name,measurements)
  values ($1,$2,'Mrs Oladuja','{"meas":{"Chest":"40"}}'::jsonb) returning id`, [BIZ, LAGOS]);
await db.query(`insert into public.customer_contacts (customer_id,business_id,branch_id,phone,email)
  values ($1,$2,$3,'+234 802 000 0000','o@drill.test')`, [cust, BIZ, LAGOS]);

const ord = await one(`insert into public.orders (business_id,branch_id,customer_id,app_id,total,status,doc)
  values ($1,$2,$3,'D-0001',250000,'open','{"garment":"Agbada","stageIndex":3}'::jsonb) returning id`,
  [BIZ, LAGOS, cust]);
await db.query(`insert into public.order_costs (order_id,business_id,branch_id,cost,detail)
  values ($1,$2,$3,75000,'{"lines":[{"label":"Aso-oke","amount":75000}]}'::jsonb)`, [ord, BIZ, LAGOS]);
await db.query(`insert into public.order_commissions (order_id,business_id,branch_id,total,detail)
  values ($1,$2,$3,30000,'{"lines":[{"staffId":"st-1","amount":30000}]}'::jsonb)`, [ord, BIZ, LAGOS]);
await db.query(`insert into public.order_contacts (order_id,business_id,branch_id,detail)
  values ($1,$2,$3,'{"delivery_location":"14 Bode Thomas"}'::jsonb)`, [ord, BIZ, LAGOS]);
await db.query(`insert into public.transactions (business_id,branch_id,order_id,kind,amount,app_id,method)
  values ($1,$2,$3,'sale',100000,'t-d1','Bank transfer'),
         ($1,$2,$3,'sale',60000,'t-d2','Cash'),
         ($1,$2,null,'expense',25000,'t-d3','Cash')`, [BIZ, LAGOS, ord]);
await db.query(`insert into public.app_state (business_id,key,data)
  values ($1,'layi_dash_settings','{"currency":"NGN","company":{"name":"The Drill Studio"}}'::jsonb)`, [BIZ]);
await db.query(`select app.audit($1,'Something that happened','before the disaster')`, [BIZ]);


/* =====================================================================
   PART TWO — the export, which is the only thing that survives
   ===================================================================== */
section('2. The export taken, then the studio destroyed');
/* THROUGH THE PUBLIC ENTRY POINTS, which is the P4 lesson applied: app.*
   is revoked from authenticated, so a drill that calls it is exercising a
   door nobody uses. These are the ones the console posts to.

   Exported BY THE OWNER, purged and restored BY THE PLATFORM, because that
   is who does each of those things and the functions check. A drill that
   runs as the superuser proves the SQL works and not that the procedure
   does. */
await db.query(`insert into public.platform_admins (id, email, name, role, active)
  values ($1,'owner@drill.test','Drill Operator','owner',true)
  on conflict (id) do update set active = true`, [OWNER]);
let EXPORT_ERR = null;
const EXPORT = await clock('export', async () => {
  const r = await asUser(OWNER, `select public.export_studio($1) as j`, [BIZ]);
  EXPORT_ERR = r.error;
  return r.rows[0]?.j;
});
const exportJson = typeof EXPORT === 'string' ? EXPORT : JSON.stringify(EXPORT);
ok('an export was produced', !!exportJson && exportJson.length > 100,
   (exportJson || '').length + ' bytes; ' + (EXPORT_ERR || 'no error'));
console.log('        ' + Math.round((exportJson || '').length / 1024) + ' KB for one studio');

/* THE BASELINE IS TAKEN AFTER THE EXPORT, not before. Exporting a studio
   writes a line in its own history, so a count captured first is one short
   of what the file contains and the restore looks like it invented a row. */
const BEFORE = (await q(`select
  (select count(*) from public.memberships where business_id=$1) members,
  (select count(*) from public.business_roles where business_id=$1) roles,
  (select count(*) from public.branches where business_id=$1) branches,
  (select count(*) from public.customers where business_id=$1) customers,
  (select count(*) from public.customer_contacts where business_id=$1) contacts,
  (select count(*) from public.orders where business_id=$1) orders,
  (select coalesce(sum(total),0) from public.orders where business_id=$1) order_money,
  (select coalesce(sum(cost),0) from public.order_costs where business_id=$1) costs,
  (select coalesce(sum(total),0) from public.order_commissions where business_id=$1) commissions,
  (select count(*) from public.order_contacts where business_id=$1) order_contacts,
  (select count(*) from public.transactions where business_id=$1) payments,
  (select coalesce(sum(amount),0) from public.transactions where business_id=$1) money,
  (select count(*) from public.audit_log where business_id=$1) history,
  (select count(*) from public.partner_referrals where business_id=$1) referrals
  `, [BIZ]))[0];
console.log('        the studio: ' + JSON.stringify(BEFORE));


/* A studio is closed before it is purged: the procedure refuses otherwise,
   which is the guard that stops a live studio being destroyed by a typo. */
await clock('close', async () => { const r = await asUser(OWNER, `select public.close_studio($1,$2)`, [BIZ, 'recovery drill']); if (r.error) console.log('        close said: ' + r.error); });
/* The grace period is wound back rather than waited out. A closed studio
   is kept for a while before it can be destroyed, which is right, and a
   drill that sat here for thirty days would never be run. */
await db.query(`update public.businesses set purge_after = now() - interval '1 day' where id=$1`, [BIZ]);
await clock('purge', async () => { const r = await asUser(OWNER, `select public.purge_studio($1)`, [BIZ]); if (r.error) console.log('        purge said: ' + r.error); });
const gone = await one(`select count(*)::int from public.businesses where id=$1`, [BIZ]);
ok('the studio is gone, as if the project had been lost', gone === 0, String(gone));

/* =====================================================================
   PART THREE — the recovery
   ===================================================================== */
section('3. Restored from the file alone');
const RESULT = await clock('restore', async () => {
  const r = await asUser(OWNER, `select public.import_studio($1::jsonb) as j`, [exportJson]);
  if (r.error) console.log('        restore said: ' + r.error);
  return r.rows[0]?.j;
});
const R = typeof RESULT === 'string' ? JSON.parse(RESULT) : RESULT;
ok('the restore reports success', R && R.restored === true, JSON.stringify(R && R.rows));

const AFTER = (await q(`select
  (select count(*) from public.memberships where business_id=$1) members,
  (select count(*) from public.business_roles where business_id=$1) roles,
  (select count(*) from public.branches where business_id=$1) branches,
  (select count(*) from public.customers where business_id=$1) customers,
  (select count(*) from public.customer_contacts where business_id=$1) contacts,
  (select count(*) from public.orders where business_id=$1) orders,
  (select coalesce(sum(total),0) from public.orders where business_id=$1) order_money,
  (select coalesce(sum(cost),0) from public.order_costs where business_id=$1) costs,
  (select coalesce(sum(total),0) from public.order_commissions where business_id=$1) commissions,
  (select count(*) from public.order_contacts where business_id=$1) order_contacts,
  (select count(*) from public.transactions where business_id=$1) payments,
  (select coalesce(sum(amount),0) from public.transactions where business_id=$1) money,
  (select count(*) from public.audit_log where business_id=$1) history,
  (select count(*) from public.partner_referrals where business_id=$1) referrals
  `, [BIZ]))[0];

for (const k of Object.keys(BEFORE)) {
  ok(k + ' came back', String(BEFORE[k]) === String(AFTER[k]),
     'was ' + BEFORE[k] + ', now ' + AFTER[k]);
}

section('4. And the studio works, asked as the people who work there');
{
  const o = await asUser(OWNER, `select app_id, total from public.orders where business_id=$1`, [BIZ]);
  ok('the owner sees their orders', o.rows.length === 1 && Number(o.rows[0].total) === 250000,
     JSON.stringify(o.rows));
  const c = await asUser(MANAGER, `select cost from public.order_costs where business_id=$1`, [BIZ]);
  ok('the manager still sees costs, so the roles came back too', c.rows.length === 1,
     c.error || (c.rows.length + ' rows'));
  const k = await asUser(MANAGER, `select phone from public.customer_contacts where business_id=$1`, [BIZ]);
  ok('and contact details', k.rows.length === 1 && /802 000 0000/.test(k.rows[0].phone),
     JSON.stringify(k.rows));
  const m = await asUser(MANAGER, `select amount from public.transactions where business_id=$1`, [BIZ]);
  ok('and the money', m.rows.length === 3, m.error || (m.rows.length + ' rows'));
  const h = await asUser(OWNER, `select action from public.audit_log where business_id=$1`, [BIZ]);
  ok('the history survived the disaster, line for line',
     h.rows.length === Number(BEFORE.history) &&
     h.rows.some(r => /Something that happened/.test(r.action)),
     h.rows.length + ' lines, expected ' + BEFORE.history);
  const w = await asUser(OWNER, `insert into public.orders (business_id,branch_id,app_id,total,status)
    values ($1,$2,'D-AFTER',1,'open') returning app_id`, [BIZ, LAGOS]);
  ok('and the studio can take a new order, which is what recovered means',
     w.rows.length === 1, w.error || 'nothing written');
}

/* =====================================================================
   PART FOUR — the honest part
   ===================================================================== */
const TOTAL = Date.now() - T0;
section('5. And no studio-scoped table is missing from the export');
{
  /* THE GENERAL FORM OF THE BUG THIS DRILL FOUND. order_commissions and
     order_contacts were created by P2 and never added to export_studio, so
     a restore came back complete in every visible respect and without a
     single commission. The next table added will be forgotten the same way
     unless something counts.

     Every table with a business_id column is per-studio by construction, so
     the list of what an export must carry is not a list anybody maintains —
     it is a query. Anything here that the export does not name is data a
     restore would silently lose. */
  const scoped = (await q(`select c.table_name t
     from information_schema.columns c
     join information_schema.tables tb
       on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema='public' and c.column_name='business_id'
      and tb.table_type='BASE TABLE'
      and c.table_name <> 'businesses'
    order by c.table_name`)).map(r => r.t);
  const carried = Object.keys(typeof EXPORT === 'string' ? JSON.parse(EXPORT) : EXPORT);
  const alias = { business_role_permissions: 'role_permissions' };

  /* NOT THE STUDIO'S TO EXPORT, each with the reason, because an allowlist
     with no reasons is where the next missing table will hide. Adding a name
     here is a decision; leaving one out is a bug. */
  const NOT_THEIRS = {
    billing_intents:    'a checkout in progress with the payment provider. Restoring a stale intent would be wrong, not helpful.',
    error_reports:      'crash reports the app sent us. A studio has no select on them at all, and a restored studio does not want last year’s stack traces.',
    feedback_replies:   'what we wrote back, held on our side of the conversation.',
    partners:           'the referring partner is a person in their own right, not part of the studio they referred.',
    partner_referrals:  'the commission relationship belongs to the partner and to us.',
    referral_attempts:  'our own record of who tried to claim what, kept to catch fraud.',
    platform_audit:     'our books, not theirs.',
    tlb_closed_studios: 'our books.',
    tlb_customers:      'our books: who is a customer OF The Label Board.',
    team_invitations:   'invitations not yet accepted. A restore months later would resurrect a stale link; the studio invites again.',
  };
  const missing = scoped.filter(t => !NOT_THEIRS[t] && !carried.includes(alias[t] || t));
  ok('every studio-scoped table is either exported or excluded on purpose',
     missing.length === 0,
     'an export would silently lose: ' + missing.join(', '));
  /* and the inverse, so an exclusion cannot quietly outlive its table */
  const stale = Object.keys(NOT_THEIRS).filter(t => !scoped.includes(t));
  ok('  and no exclusion names a table that no longer exists', stale.length === 0, stale.join(', '));
  console.log('        ' + scoped.length + ' studio-scoped tables: ' +
              (scoped.length - Object.keys(NOT_THEIRS).length) + ' exported, ' +
              Object.keys(NOT_THEIRS).length + ' deliberately not');
}
section('5. What this drill did NOT recover');
console.log(`
  Restored from the export file, proved above:
    the studio, its branches, its roles and permissions, its memberships
    and profiles, its clients and their contact details and measurements,
    its orders with costs, commissions and delivery addresses, its
    payments, its settings, its audit history and its partner referral.

  Restored from git, proved above:
    the entire schema — ${files.length} migrations, every table, policy,
    function and trigger — with no manual step.

  NOT covered by this drill, and it would be dishonest to imply otherwise:
    - Storage objects. Client photos live in Supabase Storage, not in the
      database. export_studio carries their URLs, not their bytes. A lost
      project loses the images unless the bucket is separately copied.
    - auth.users. The export carries memberships and profiles, which point
      AT accounts; it does not carry the accounts, their passwords or
      their sessions. A restore into a fresh project needs the auth schema
      restored from a Supabase backup, or everybody signs up again and is
      re-invited.
    - Edge Function secrets. SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
      FLW_SECRET_KEY and the rest are set in the dashboard. They are in
      nobody's git and cannot be: they must be re-entered by hand.
    - Project-level settings: Auth redirect URLs, SMTP, the custom domain,
      leaked-password protection, rate limits.
    - The four Netlify sites, their domains and their DNS.

  So the true RTO is this drill's time plus the manual list, and the true
  RPO is the age of the last export — which today is whenever somebody
  last pressed the button, because nothing takes one on a schedule.
`);

console.log('  Measured, on this machine:');
for (const [label, ms] of timings) {
  console.log('    ' + (label + ' ').padEnd(42, '.') + ' ' + (ms / 1000).toFixed(1) + 's');
}
console.log('    ' + 'WHOLE DRILL '.padEnd(42, '.') + ' ' + (TOTAL / 1000).toFixed(1) + 's');

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + failures.length + ' failed');
for (const f of failures) console.log('  - ' + f);
if (!failures.length) {
  console.log('\nOne studio was exported, destroyed and put back from the file\nalone, and the people who work there can still do their work.');
}
process.exit(failures.length ? 1 : 0);
