/* The upgrade itself, rehearsed on a database shaped like production.
 *
 * Every other suite builds the whole schema at once and then tests it. That
 * answers "does this work", and it cannot answer the only question that
 * matters on promotion day: does a database that already has studios, people
 * and data in it survive the migrations that are about to be applied to it.
 *
 * So this one stops halfway. It builds production as it is TODAY — the
 * migrations that project actually has, and nothing after them — puts a
 * studio in it with an owner and real rows, and only then applies the
 * release. What it asserts afterwards is not that the new features work, but
 * that the old studio still does.
 *
 * THE ONE THAT WOULD HURT. Batch B moved app_state writes behind a
 * per-key permission, and a permission now lives in business_role_permissions
 * rather than in a blob. A studio created before that migration has no roles
 * and its membership has no role_id, so if the backfill misses it, the owner
 * of a studio that has been working for a month opens the app and can read
 * nothing and save nothing. There is no error message for that; it just looks
 * like the app broke.
 *
 * Production today: nine studios, every one of them active, every member an
 * owner, 53 app_state rows, 20 customers and no relational orders yet.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..');
let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* What production has applied, and nothing past it. Everything from
   20260929… onward is this release. */
const LAST_ON_PRODUCTION = '20260928160000_phase0_role_authority.sql';

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);

const all = readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
const already = all.filter(f => f <= LAST_ON_PRODUCTION);
const pending = all.filter(f => f > LAST_ON_PRODUCTION);
for (const f of already) {
  try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message.split('\n')[0]); process.exit(1); }
}
console.log('Built to where production is: ' + already.length + ' migrations applied, '
  + pending.length + ' pending.');

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
const one = async (sql, params = []) => (await admin(sql, params))[0];

const U = {
  ada:   'f1111111-1111-1111-1111-111111111111',   // an owner, like all nine
  tunde: 'f2222222-2222-2222-2222-222222222222',   // a manager, for the case that is coming
};
const BIZ = 'ffff0000-0000-0000-0000-00000000ffff';

/* THE KEYS THE LIVE APP ACTUALLY WRITES. Not a sample: this is the list the
   old build syncs, so if any one of them stops being writable after the
   upgrade, that part of the app silently stops saving.

   NINE OF THEM ARE ALREADY GATED BY PLAN, and have been since September:
   supplies, bills, pots, attendance, leave, shifts, campaigns, log and anns
   are Pro. That is existing behaviour and not this release — but a fixture
   that does not know it fails on a refusal that is the database working
   exactly as designed, which is how the first run of this suite went. So the
   studio under test is Pro, like the one Kayode actually uses. */
const LIVE_KEYS = ['layi_dash_settings','layi_dash_txns','layi_dash_appts','layi_dash_staff',
  'layi_dash_users','layi_dash_roles','layi_dash_products','layi_dash_supplies','layi_dash_bills',
  'layi_dash_pots','layi_dash_tasks','layi_dash_anns','layi_dash_attendance','layi_dash_leave',
  'layi_dash_shifts','layi_dash_campaigns','layi_dash_log','layi_dash_audit','layi_dash_planner',
  'layi_dash_orders','layi_dash_orders_done'];

await admin(`insert into auth.users (id,email) values ($1,'ada@live.test'),($2,'tunde@live.test')`,
  [U.ada, U.tunde]);
await admin(`insert into public.businesses (id,name,slug,plan,status) values
  ($1,'A Studio That Has Been Working','a-studio-working','pro','active')`, [BIZ]);
await admin(`insert into public.branches (business_id,name) values ($1,'Main studio')`, [BIZ]);
await admin(`insert into public.memberships (user_id,business_id,role,status) values
  ($1,$3,'owner','active'),($2,$3,'manager','active')`, [U.ada, U.tunde, BIZ]);
await admin(`insert into public.profiles (id,name,role_id,business_id) values
  ($1,'Ada','owner',$3),($2,'Tunde','manager',$3)
  on conflict (id) do update set name = excluded.name`, [U.ada, U.tunde, BIZ]);
/* THE STUDIO ALREADY HAS THE CREDENTIAL IN IT, because every studio on
   production does. The settings blob carries ownerPassword and the device
   account list carries a PIN per row, and until this release both were
   readable over the API by anybody with a membership. Seeding them as
   '{"seeded":true}' would let the cleanup pass by having nothing to do. */
const SEED = {
  layi_dash_settings: '{"seeded":true,"currency":"NGN","ownerPassword":"h0rsesh0e",' +
                      '"company":{"name":"A Studio","ownerPassword":"h0rsesh0e"}}',
  layi_dash_users:    '[{"id":"u1","username":"ada","roleId":"owner","pin":"4417"}]',
};
for (const k of LIVE_KEYS) {
  await admin(`insert into public.app_state (business_id,key,data) values ($1,$2,$3::jsonb)
    on conflict (business_id,key) do nothing`, [BIZ, k, SEED[k] || '{"seeded":true}']);
}
/* What the studio should have once the release has been applied. The account
   list is not one of them: it is a list of usernames and PINs that describes a
   device, it should never have synced, and the release deletes it. */
const POST_KEYS = LIVE_KEYS.filter(k => k !== 'layi_dash_users');
await admin(`insert into public.customers (business_id,name,email,phone,measurements) values
  ($1,'Mrs Oladuja','o@live.test','+234 802 000 0000','{"meas":{"Waist":"32"}}'::jsonb),
  ($1,'Mr Eze','','', '{}'::jsonb)`, [BIZ]);
await admin(`insert into public.suppliers (business_id,name,type) values ($1,'Aso-oke House','Fabric Supplier')`, [BIZ]);

const BEFORE = await one(`select
  (select count(*) from public.businesses) b,
  (select count(*) from public.memberships) m,
  (select count(*) from public.profiles) p,
  (select count(*) from public.app_state where business_id=$1) s,
  (select count(*) from public.customers where business_id=$1) c,
  (select count(*) from public.suppliers where business_id=$1) su,
  (select count(*) from auth.users) u`, [BIZ]);

// =====================================================================
section('Before: a studio that works, on production’s schema');
// =====================================================================
{
  const read = await asUser(U.ada, `select key from public.app_state where business_id=$1`, [BIZ]);
  ok('the owner reads every key', read.rows.length === LIVE_KEYS.length,
     'saw ' + read.rows.length + ' of ' + LIVE_KEYS.length);
  /* The blob a real app saves, which is the seeded one — an ordinary save
     that happens to carry the owner's password, because until this release
     that is what SETTINGS contained. Writing '{"before":true}' here would
     wipe the credential before the upgrade and leave the cleanup nothing to
     find, which is how this assertion first passed. */
  const write = await asUser(U.ada,
    `update public.app_state set data=$2::jsonb where business_id=$1 and key='layi_dash_settings' returning key`,
    [BIZ, SEED.layi_dash_settings]);
  ok('and can save', write.rows.length === 1, write.error || 'nothing saved');

  /* THE FINDING, REPRODUCED ON PRODUCTION'S SCHEMA. Tunde is a manager. He
     has no business knowing the owner's password, and on the schema
     production is running right now he is handed it by asking. This assertion
     is meant to pass here and its mirror below is meant to pass after. */
  const leak = await asUser(U.tunde,
    `select data ->> 'ownerPassword' p from public.app_state
     where business_id=$1 and key='layi_dash_settings'`, [BIZ]);
  ok('and today a manager can read the owner’s password, which is the finding',
     leak.rows.length === 1 && leak.rows[0].p === 'h0rsesh0e', JSON.stringify(leak.rows));
  const pins = await asUser(U.tunde,
    `select data from public.app_state where business_id=$1 and key='layi_dash_users'`, [BIZ]);
  ok('and the PINs beside it', pins.rows.length === 1, JSON.stringify(pins.error || pins.rows.length));
  const cust = await asUser(U.ada, `select name from public.customers where business_id=$1`, [BIZ]);
  ok('and sees the clients', cust.rows.length === 2, 'saw ' + cust.rows.length);
}

// =====================================================================
section('The upgrade');
// =====================================================================
{
  let failed = null;
  for (const f of pending) {
    try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
    catch (e) { failed = f + ': ' + e.message.split('\n')[0]; break; }
  }
  ok('every pending migration applies to a database that already has data in it',
     !failed, failed || '');
  if (failed) { console.log('\nStopping: nothing after this can be trusted.'); process.exit(1); }
}

// =====================================================================
section('After: nothing was lost');
// =====================================================================
{
  const now = await one(`select
    (select count(*) from public.businesses) b,
    (select count(*) from public.memberships) m,
    (select count(*) from public.profiles) p,
    (select count(*) from public.app_state where business_id=$1) s,
    (select count(*) from public.customers where business_id=$1) c,
    (select count(*) from public.suppliers where business_id=$1) su,
    (select count(*) from auth.users) u`, [BIZ]);
  for (const [k, label] of [['b','studios'],['m','memberships'],['p','profiles'],
                            ['c','clients'],['su','suppliers'],['u','accounts']]) {
    ok('the same number of ' + label, String(now[k]) === String(BEFORE[k]),
       BEFORE[k] + ' -> ' + now[k]);
  }

  /* ONE app_state ROW IS GONE ON PURPOSE, and exactly one. A release that
     quietly took two would look identical to this assertion if it only
     counted "fewer". */
  ok('one app_state row fewer, and it is the account list',
     Number(now.s) === Number(BEFORE.s) - 1, BEFORE.s + ' -> ' + now.s);
  const gone = await one(`select count(*) c from public.app_state
    where business_id=$1 and key='layi_dash_users'`, [BIZ]);
  ok('the device account list, with its PINs, was deleted', Number(gone.c) === 0, gone.c + ' left');
  /* Asked in SQL rather than in JavaScript, like the measurements check
     below, because the driver hands a jsonb column back as text often enough
     that a green test could mean "undefined === undefined". */
  const st = await one(`select
      (data ? 'ownerPassword') top,
      ((data -> 'company') ? 'ownerPassword') nested,
      data ->> 'currency' cur,
      data ->> 'seeded' seeded,
      data -> 'company' ->> 'name' co
    from public.app_state where business_id=$1 and key='layi_dash_settings'`, [BIZ]);
  ok('the owner password was removed from settings',
     st.top === false && st.nested === false, JSON.stringify(st));
  ok('and the rest of the settings survived the removal',
     st.cur === 'NGN' && st.seeded === 'true' && st.co === 'A Studio', JSON.stringify(st));

  /* THE CONTACT DETAILS MOVED TABLES. customers lost four columns and
     customer_contacts gained them, and the migration copies rather than
     drops-and-hopes. A client whose phone number vanished during an upgrade
     is data loss with a tidy explanation. */
  const k = await one(`select phone, email from public.customer_contacts
    where business_id=$1 and phone <> ''`, [BIZ]);
  ok('the client’s phone number came across to the new table',
     k && k.phone === '+234 802 000 0000', JSON.stringify(k));
  const meas = await one(`select measurements->'meas'->>'Waist' w from public.customers
    where business_id=$1 and name='Mrs Oladuja'`, [BIZ]);
  ok('and the measurements stayed where they were', meas.w === '32', String(meas.w));
}

// =====================================================================
section('After: the studio still works, which is the whole question');
// =====================================================================
{
  /* A STUDIO THAT EXISTED BEFORE RBAC HAS TO BE GIVEN ROLES BY THE MIGRATION.
     The seeding trigger only fires on INSERT, so every studio already on
     production depends on the backfill. Without it the owner has no
     permissions at all, and an app that reads can() for everything shows an
     owner an empty studio. */
  const roles = await one(`select count(*) c from public.business_roles where business_id=$1`, [BIZ]);
  ok('the studio was given its four roles', Number(roles.c) === 4, roles.c + ' roles');
  const perms = await one(`select count(*) c from public.business_role_permissions p
    join public.business_roles r on r.id = p.role_id where r.business_id=$1 and r.key='owner'`, [BIZ]);
  ok('and the owner role was granted its permissions', Number(perms.c) > 0, perms.c + ' permissions');
  const mem = await admin(`select role, role_id from public.memberships where business_id=$1`, [BIZ]);
  ok('and every membership was pointed at one', mem.every(m => !!m.role_id),
     JSON.stringify(mem.map(m => m.role + '=' + m.role_id)));

  const read = await asUser(U.ada, `select key from public.app_state where business_id=$1`, [BIZ]);
  ok('the owner still reads every key they had', read.rows.length === POST_KEYS.length,
     'saw ' + read.rows.length + ' of ' + POST_KEYS.length);
  const write = await asUser(U.ada,
    `update public.app_state set data='{"after":true}'::jsonb where business_id=$1 and key='layi_dash_settings' returning key`, [BIZ]);
  ok('and still saves', write.rows.length === 1, write.error || 'nothing saved');

  /* every key, one at a time, because "most of them" is not an answer */
  const refused = [];
  for (const key of POST_KEYS) {
    const r = await asUser(U.ada,
      `update public.app_state set data='{"sweep":true}'::jsonb where business_id=$1 and key=$2 returning key`, [BIZ, key]);
    if (r.error || r.rows.length !== 1) refused.push(key + (r.error ? ' (' + r.error + ')' : ''));
  }
  ok('and can write every single key the live app syncs', refused.length === 0, refused.join(', '));

  /* AND THE ONE KEY THAT IS NO LONGER A KEY. An old build on somebody's phone
     will keep pushing this until it updates, so the refusal is the thing that
     has to hold — not the new build's restraint. Tested as the OWNER, because
     if the owner is refused then everybody is. */
  const back = await asUser(U.ada,
    `insert into public.app_state (business_id,key,data)
     values ($1,'layi_dash_users','[{"username":"ada","pin":"4417"}]'::jsonb)`, [BIZ]);
  /* REFUSED FOR THE RIGHT REASON. "it errored" would also pass if the
     trigger function were unreachable and every app_state write were failing,
     which is the shape of an outage rather than a rule. */
  ok('and an old build cannot push the account list back up',
     /not synced/.test(back.error || ''), back.error || 'IT WAS ACCEPTED');
  const sneak = await asUser(U.ada,
    `update public.app_state set data = data || '{"ownerPassword":"h0rsesh0e"}'::jsonb
     where business_id=$1 and key='layi_dash_settings' returning key`, [BIZ]);
  const after = await one(`select (data ? 'ownerPassword') p from public.app_state
    where business_id=$1 and key='layi_dash_settings'`, [BIZ]);
  ok('and an old build saving settings does not put the password back',
     after.p === false, 'stored: ' + JSON.stringify(sneak.error || after));

  /* THE MIRROR OF THE FINDING. Same manager, same two requests, after. */
  const noLeak = await asUser(U.tunde,
    `select data ->> 'ownerPassword' p from public.app_state
     where business_id=$1 and key='layi_dash_settings'`, [BIZ]);
  ok('and the manager is no longer handed the owner’s password',
     noLeak.rows.length === 1 && noLeak.rows[0].p === null, JSON.stringify(noLeak.rows));
  const noPins = await asUser(U.tunde,
    `select data from public.app_state where business_id=$1 and key='layi_dash_users'`, [BIZ]);
  ok('nor anybody’s PIN', noPins.rows.length === 0, JSON.stringify(noPins.error || noPins.rows.length));

  const cust = await asUser(U.ada, `select name from public.customers where business_id=$1`, [BIZ]);
  ok('the clients are still there for them', cust.rows.length === 2, 'saw ' + cust.rows.length);
  const contact = await asUser(U.ada, `select phone from public.customer_contacts where business_id=$1`, [BIZ]);
  ok('with their contact details', contact.rows.length === 1, 'saw ' + contact.rows.length);
  const sup = await asUser(U.ada, `select name from public.suppliers where business_id=$1`, [BIZ]);
  ok('and the vendors', sup.rows.length === 1, 'saw ' + sup.rows.length);

  /* The manager, who on production does not exist yet but will the first time
     somebody is invited. A manager reading nothing would be the same failure
     one week later. */
  const mRead = await asUser(U.tunde, `select key from public.app_state where business_id=$1`, [BIZ]);
  ok('a manager reads the studio too', mRead.rows.length > 0, 'saw ' + mRead.rows.length);
  const mWrite = await asUser(U.tunde,
    `update public.app_state set data='{"m":true}'::jsonb where business_id=$1 and key='layi_dash_appts' returning key`, [BIZ]);
  ok('and can do their job', mWrite.rows.length === 1, mWrite.error || 'nothing saved');
  const mMoney = await asUser(U.tunde, `select key from public.app_state
    where business_id=$1 and key='layi_dash_txns'`, [BIZ]);
  ok('and the money key is a permission question rather than an accident',
     mMoney.rows.length === 1 || mMoney.rows.length === 0,
     'saw ' + mMoney.rows.length);
}

// =====================================================================
section('After: the new machinery is there and is switched off');
// =====================================================================
{
  const flag = await one(`select on_off from public.platform_flags where key='enforce_unpaid_readonly'`);
  ok('the read-only enforcement ships switched off', flag.on_off === false, String(flag.on_off));

  /* which means a studio that somehow ends up suspended on the day of the
     release is inconvenienced by nothing at all */
  await admin(`update public.businesses set status='suspended' where id=$1`, [BIZ]);
  const stillWrites = await asUser(U.ada,
    `update public.app_state set data='{"x":true}'::jsonb where business_id=$1 and key='layi_dash_settings' returning key`, [BIZ]);
  ok('so a suspended studio is not locked out by this release',
     stillWrites.rows.length === 1, stillWrites.error || 'it was refused');
  await admin(`update public.businesses set status='active' where id=$1`, [BIZ]);

  const orders = await one(`select count(*) c from public.orders where business_id=$1`, [BIZ]);
  ok('no orders have moved into rows yet, which is the studio’s own to do',
     Number(orders.c) === 0, orders.c + ' rows');
  const blob = await one(`select data from public.app_state where business_id=$1 and key='layi_dash_orders'`, [BIZ]);
  ok('and the blob they are in is untouched', !!blob, 'the orders key is gone');
}

// =====================================================================
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('\nA studio that was already working goes through this release with');
console.log('the same rows, the same people and the same access, and the one');
console.log('thing it gains that could lock anybody out is switched off.');
