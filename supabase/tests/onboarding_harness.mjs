/* Does creating an account actually produce a studio?
 *
 * This exists because of one screenshot. A real sign-in, on a phone, against
 * the live project, answered:
 *
 *   Signed in, but your profile was not found:
 *   Cannot coerce the result to a single JSON object
 *
 * That account predated the trigger, so it was working as designed — but
 * nothing anywhere could have told us the difference between "this account
 * predates the trigger" and "the trigger is broken for everyone", because
 * provision_studio() warns rather than raises. It has to: a trigger that
 * raises on auth.users makes the account creation itself fail, and the
 * dashboard reports only "Database error creating new user" with no way to
 * find out why. So the failure mode is deliberately silent, and the only
 * honest way to run it is to fire it.
 *
 * Three paths, all real:
 *   claimed   a studio prepared in advance, waiting on an email
 *   partner   a partner prepared the same way, who must NOT get a studio
 *   fresh     nobody expected this address, so build them a studio
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
for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

// The trigger only exists if auth.users existed when the migration ran.
{
  const t = await q(`select tgname, tgenabled from pg_trigger
                      where tgrelid = 'auth.users'::regclass and not tgisinternal`);
  ok('the trigger is attached to auth.users at all',
     t.some(x => x.tgname === 'on_auth_user_created'),
     'found: ' + (t.map(x => x.tgname).join(', ') || 'nothing'));
  ok('and it is enabled', t.every(x => x.tgenabled === 'O'));
}

const signUp = (email, meta = {}) =>
  q(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [email, JSON.stringify(meta)]).then(r => r[0].id);

// ---------------------------------------------------------------------
section('An address a studio was waiting for');
// ---------------------------------------------------------------------
{
  const uid = await signUp('test.footwear@thelabelboard.com');
  const r = await q(
    `select b.name, b.slug, b.pending_owner_email,
            (select count(*) from profiles p where p.id = $1 and p.business_id = b.id) as profile,
            (select count(*) from memberships m where m.user_id = $1 and m.business_id = b.id
               and m.role = 'owner' and m.status = 'active') as membership,
            (select count(*) from branches br where br.business_id = b.id) as branches,
            (select s.data->'company'->>'name' from app_state s
              where s.business_id = b.id and s.key = 'layi_dash_settings') as settings_name
       from businesses b where b.slug = 'okoro-and-sons'`, [uid]);
  const b = r[0] || {};
  ok('the account is given a profile on the studio that was waiting', +b.profile === 1);
  ok('and an active owner membership', +b.membership === 1, 'this is what every policy reads');
  ok('the claim is cleared, so a second account cannot take the same studio',
     b.pending_owner_email === null, String(b.pending_owner_email));
  ok('the studio it lands in is the seeded one, not a new one',
     b.settings_name === 'Okoro & Sons Shoes', String(b.settings_name));
  ok('and it keeps its own branch', +b.branches === 1, String(b.branches));

  // the exact query the app runs after signInWithPassword
  const prof = await q(
    `select name, role_id, business_id, staff_id from profiles where id = $1`, [uid]);
  ok('the app\'s own profile lookup returns exactly one row',
     prof.length === 1, prof.length + ' row(s) — this is the "Cannot coerce" error');
  ok('and it says owner', prof[0] && prof[0].role_id === 'owner');
}

// ---------------------------------------------------------------------
section('An address nobody prepared');
// ---------------------------------------------------------------------
{
  const uid = await signUp('brand.new@example.com', { business_name: 'Tolu Atelier', name: 'Tolu' });
  const r = await q(
    `select b.name, b.slug, b.plan, b.contact_email,
            (select count(*) from branches br where br.business_id = b.id) as branches,
            (select p.name from profiles p where p.id = $1) as profile_name,
            (select m.role from memberships m where m.user_id = $1) as role
       from businesses b
       join profiles p on p.business_id = b.id and p.id = $1`, [uid]);
  const b = r[0] || {};
  ok('a studio is created for them', !!b.name, 'no business row');
  ok('named from the metadata the signup carried', b.name === 'Tolu Atelier', String(b.name));
  ok('with a slug made from that name', b.slug === 'tolu-atelier', String(b.slug));
  ok('on trial, not on a paid plan', b.plan === 'trial', String(b.plan));
  ok('with somewhere to work', +b.branches === 1, String(b.branches));
  ok('and they own it', b.role === 'owner', String(b.role));
  ok('their own name is on the profile', b.profile_name === 'Tolu', String(b.profile_name));
}

// ---------------------------------------------------------------------
section('An address with no metadata at all');
// ---------------------------------------------------------------------
// The dashboard's Add User form sends none, which is exactly how the test
// accounts get made.
{
  const uid = await signUp('zainab@example.com');
  const r = await q(
    `select b.name, b.slug from businesses b
      join profiles p on p.business_id = b.id where p.id = $1`, [uid]);
  ok('a studio is still created', r.length === 1, r.length + ' found');
  ok('named from the address rather than left blank',
     r[0] && r[0].name === 'Zainab', r[0] && String(r[0].name));
}

// ---------------------------------------------------------------------
section('Two studios that would want the same slug');
// ---------------------------------------------------------------------
{
  const uid = await signUp('second@example.com', { business_name: 'Tolu Atelier' });
  const r = await q(
    `select b.slug from businesses b join profiles p on p.business_id = b.id where p.id = $1`, [uid]);
  ok('the second one gets a slug of its own rather than failing',
     r.length === 1 && r[0].slug !== 'tolu-atelier', r[0] && String(r[0].slug));
  const all = await q(`select count(*)::int as n from businesses where slug like 'tolu-atelier%'`);
  ok('and both studios exist', all[0].n === 2, String(all[0].n));
}

// ---------------------------------------------------------------------
section('A partner is not a studio');
// ---------------------------------------------------------------------
{
  const uid = await signUp('test.partner@thelabelboard.com');
  const p = await q(`select id, name, pending_email from partners where user_id = $1`, [uid]);
  ok('a prepared partner is claimed by their address', p.length === 1, p.length + ' found');
  ok('and the claim is cleared', p[0] && p[0].pending_email === null);

  const biz = await q(`select count(*)::int as n from profiles where id = $1`, [uid]);
  ok('a partner is not handed a studio they never asked for', biz[0].n === 0,
     biz[0].n + ' profile row(s)');
  const mem = await q(`select count(*)::int as n from memberships where user_id = $1`, [uid]);
  ok('and gets no membership of one', mem[0].n === 0, String(mem[0].n));
}

// ---------------------------------------------------------------------
section('A partner who was ALSO prepared a studio gets both');
// ---------------------------------------------------------------------
// 21 September 2026. LAYI was prepared for layiojomo@gmail.com. Kayode
// created the account. He was attached to partner KUNLE, the studio was
// never claimed, and nothing said so: the business kept its pending
// address and the trigger returned happily.
//
// provision_studio opened with a partner claim that returned outright, so
// the prepared-studio branch below it was unreachable for anybody who had
// been invited as a partner first.
//
// The early return was not wrong, it was too wide. It exists to stop the
// INVENT path from handing a studio to somebody who never asked for one,
// which the section above still proves. A studio prepared by an operator
// is not a guess, and partner + studio is a combination this system
// supports on purpose: all six seeded test studios are both.
{
  await db.exec(`insert into partners (name, code, tier, status, joined_on, email, pending_email)
                 values ('Both Ways', 'BOTH-WAYS', 'bronze', 'active', current_date, 'both@example.com',
                         'both@example.com')`);
  await db.exec(`insert into businesses (name, slug, plan, status, contact_email, pending_owner_email)
                 values ('Both Ways Studio', 'both-ways-studio', 'trial', 'active',
                         'both@example.com', 'both@example.com')`);

  const uid = await signUp('both@example.com');

  const p = await q(`select pending_email from partners where user_id = $1`, [uid]);
  ok('the partner claim still happens', p.length === 1, p.length + ' found');
  ok('and is still cleared', p[0] && p[0].pending_email === null);

  const b = await q(`select pending_owner_email from businesses where slug = 'both-ways-studio'`);
  ok('the prepared studio is claimed too, not swallowed',
     b.length === 1 && b[0].pending_owner_email === null,
     'still pending: ' + String(b[0] && b[0].pending_owner_email));

  const prof = await q(
    `select count(*)::int as n from profiles p join businesses b on b.id = p.business_id
      where p.id = $1 and b.slug = 'both-ways-studio'`, [uid]);
  ok('they get a profile in it', prof[0].n === 1, String(prof[0].n));

  const mem = await q(
    `select count(*)::int as n from memberships m join businesses b on b.id = m.business_id
      where m.user_id = $1 and b.slug = 'both-ways-studio'
        and m.role = 'owner' and m.status = 'active'`, [uid]);
  ok('and own it', mem[0].n === 1, String(mem[0].n));

  const extra = await q(
    `select count(*)::int as n from memberships where user_id = $1`, [uid]);
  ok('and exactly one studio, not a second invented one', extra[0].n === 1, String(extra[0].n));

  // partners.user_id is UNIQUE, and the whole function is wrapped in
  // 'exception when others'. So the referral code the trigger hands every
  // new studio blows up for somebody who is already a partner, and the
  // rollback takes the profile and the membership with it. The account
  // ends up with no studio and a warning in a log nobody reads.
  const pn = await q(`select count(*)::int as n from partners where user_id = $1`, [uid]);
  ok('and still exactly one partner row, not a second one it cannot have',
     pn[0].n === 1, String(pn[0].n));

  const bill = await q(
    `select count(*)::int as n from tlb_customers c join businesses b on b.id = c.business_id
      where b.slug = 'both-ways-studio'`);
  ok('and the studio is on the books like any other', bill[0].n === 1, String(bill[0].n));
}

// ---------------------------------------------------------------------
section('Nobody is left stranded');
// ---------------------------------------------------------------------
// The footprint the bug left behind: a business still carrying a pending
// address for an account that already exists. The trigger runs once, at
// account creation, so this state never resolves itself. It should always
// be empty, in a fresh database and in the live one.
{
  const stranded = await q(
    `select b.slug, b.pending_owner_email
       from businesses b
       join auth.users u on lower(u.email) = lower(b.pending_owner_email)
      where b.pending_owner_email is not null`);
  ok('no studio is waiting on an address that has already signed up',
     stranded.length === 0,
     stranded.map(s => s.slug + ' <- ' + s.pending_owner_email).join(', '));
}

// ---------------------------------------------------------------------
section('Signing up twice does not build two studios');
// ---------------------------------------------------------------------
// Supabase can re-run this on an account that already exists, and the app
// re-reads profiles on every sign-in. A second business would leave the
// profile lookup returning two rows, which is the "Cannot coerce" error.
{
  const before = (await q(`select count(*)::int as n from businesses`))[0].n;
  await db.exec(`update auth.users set raw_user_meta_data = '{}'::jsonb
                  where email = 'brand.new@example.com'`);
  const uid = (await q(`select id from auth.users where email = 'brand.new@example.com'`))[0].id;
  await db.exec(`insert into auth.users (id, email) values ('${uid}', 'dup@example.com')
                 on conflict (id) do nothing`);
  const after = (await q(`select count(*)::int as n from businesses`))[0].n;
  ok('re-inserting the same account id creates no second studio', after === before,
     before + ' -> ' + after);
  const prof = await q(`select count(*)::int as n from profiles where id = $1`, [uid]);
  ok('and the profile lookup still returns exactly one row', prof[0].n === 1, String(prof[0].n));
}

// ---------------------------------------------------------------------
section('A new studio gets the Accountant role we ship');
// ---------------------------------------------------------------------
// The customer app has shipped an Accountant as a BUILT-IN role for a long
// time; the database knew only four system roles, so every studio's
// accountant arrived as a custom role carrying whatever its old
// layi_dash_roles blob happened to hold. Across nine production studios that
// produced three different accountants and one studio with none at all —
// not a customisation, a seeding difference. This is the test that a studio
// created from here on gets the same one every time.
{
  const uid = await signUp('ledger@example.com', { business_name: 'Ledger Works' });
  const biz = (await q(
    `select b.id from businesses b join profiles p on p.business_id = b.id where p.id = $1`,
    [uid]))[0];
  ok('the new studio exists to have roles at all', !!biz, 'no business row');

  const roles = await q(
    `select id, key, name, tier, is_system from business_roles where business_id = $1 order by key`,
    [biz.id]);
  ok('it is seeded with five roles, not four',
     roles.length === 5, roles.map(r => r.key).join(', '));

  const acc = roles.find(r => r.key === 'accountant');
  ok('one of them is the accountant', !!acc, roles.map(r => r.key).join(', '));
  ok('it is a role we ship rather than a custom one', acc && acc.is_system === true,
     String(acc && acc.is_system));
  ok('named Accountant', acc && acc.name === 'Accountant', String(acc && acc.name));

  /* The tier is the anchor for every authority check that is not a
     permission. An accountant reads the studio's money; it does not run the
     studio, so it sits on the staff tier like any other member. */
  ok('on the staff tier, so it carries no inherent authority',
     acc && acc.tier === 'staff', String(acc && acc.tier));

  const held = (await q(
    `select permission_key from business_role_permissions where role_id = $1 order by 1`,
    [acc.id])).map(r => r.permission_key);

  const EXPECTED = [
    /* `orders` is the READ key on public.orders and nothing else — writing
       takes orders.edit, deleting takes del, and the accountant holds
       neither. It was added once the role proof found an accountant being
       handed what an order sold for without being able to see which
       order. */
    'orders', 'allOrders', 'attendance', 'customers', 'customers.manage',
    'expenses', 'finance', 'finance.record_payment', 'funds', 'money',
    'payroll', 'receivables', 'sales', 'seeContact', 'seeCost', 'seeProfit',
    'tasks',
  ].sort();

  /* THE DECISION, on its own line, because it is the one this section was
     written for: an accountant chases what the studio is owed. Before this
     it was true only where a fallback happened to infer it — one studio in
     eight — and the server is about to start enforcing on the key itself
     rather than on whatever the app inferred. */
  ok('the accountant can see receivables', held.includes('receivables'),
     'holds: ' + held.join(', '));

  ok('and holds exactly the shipped set, no more and no less',
     JSON.stringify(held) === JSON.stringify(EXPECTED),
     'missing: ' + (EXPECTED.filter(k => !held.includes(k)).join(', ') || 'none') +
     ' | extra: ' + (held.filter(k => !EXPECTED.includes(k)).join(', ') || 'none'));

  /* What it must never be handed. Each of these would turn a role that
     reads the books into one that can change who reads them, or what they
     are kept in. The list is explicit rather than derived, so widening the
     accountant has to be a deliberate edit to this test. */
  const FORBIDDEN = ['team', 'team.view', 'editStaff', 'users', 'settings', 'audit',
                     'billing.view', 'billing.manage', 'ownership.transfer',
                     /* and reading an order is not the same as changing one */
                     'orders.edit', 'del', 'update', 'canQC', 'canDispatch',
                     'products', 'products.manage', 'setCatalog', 'setWorkflow'];
  const leaked = FORBIDDEN.filter(k => held.includes(k));
  ok('and no owner, admin, team-management or order-editing authority',
     leaked.length === 0, 'leaked: ' + leaked.join(', '));

  /* THE PAIR THAT MATTERS, SAID TWICE. The role reads orders and cannot
     touch them, which is the whole shape of this decision. */
  ok('it can read the orders it is reconciling', held.includes('orders'));
  ok('and cannot change one', !held.includes('orders.edit'));
  ok('nor delete one', !held.includes('del'));

  /* An owner can rename it — a studio may well say "Bookkeeper" — but not
     delete it or move its tier, which is what is_system means here and is
     the same deal the other four get. */
  ok('an owner cannot delete the role out from under the books',
     acc.is_system === true);
}

// ---------------------------------------------------------------------
section('And so does every studio that already existed');
// ---------------------------------------------------------------------
// Everything above runs through the trigger. The studios that were already
// there when the migration landed went through the backfill instead, which
// is a different code path and the one that had to leave a changed role
// alone. Every studio in this database, however it got here, ends up with
// one.
{
  const without = await q(
    `select b.name from businesses b
       where not exists (select 1 from business_roles r
                         where r.business_id = b.id and r.key = 'accountant')`);
  ok('no studio is left without an accountant', without.length === 0,
     without.map(b => b.name).join(', '));

  const short = await q(
    `select b.name, r.key from businesses b
       join business_roles r on r.business_id = b.id and r.key = 'accountant' and r.is_system
      where exists (select 1 from unnest(app.system_role_permissions('accountant')) k
                    where k not in (select permission_key from business_role_permissions p
                                    where p.role_id = r.id))`);
  ok('and every accountant we ship holds the whole set', short.length === 0,
     short.map(b => b.name).join(', '));

  /* The app and the database have to agree about this role, because in live
     mode getRoles() returns the DATABASE's copy and defaultRoles() is what
     a studio gets before it ever connects. The same accountant either way. */
  const html = readFileSync(join(repo, 'site/layi_dashboard.html'), 'utf8');
  const def = (html.match(/\{id:'accountant',name:'Accountant',builtin:true,perms:\{[^}]*\}/) || [''])[0];
  ok('the app ships an accountant definition to compare with', def.length > 0);
  ok('and it grants receivables in its own right, not by inference',
     /receivables:1/.test(def), def.slice(0, 160));
}

// ---------------------------------------------------------------------
section('An accountant a studio changed for itself is left alone');
// ---------------------------------------------------------------------
// The backfill takes over the accountant roles that arrived from the old
// blob, which on production are byte-identical to the one we ship. A studio
// that has since ticked a box on its own is a different thing: taking that
// role over would make it undeletable, and the set we ship does not contain
// whatever they added, so "standardise it" would have to mean either
// revoking their change or keeping a role that is no longer the one we
// ship. Neither is ours to choose, so it stays theirs.
//
// Re-applying the migration is also the test that it is idempotent, which
// is what makes it safe to run against a project twice.
{
  const MIG = '20261004110000_the_accountant_is_a_role_we_ship.sql';
  const sql = readFileSync(join(repo, 'supabase/migrations', MIG), 'utf8');

  const mk = async (slug) => {
    await db.exec(`insert into businesses (name, slug, plan, status)
                   values ('${slug}', '${slug}', 'trial', 'active')`);
    const id = (await q(`select id from businesses where slug = $1`, [slug]))[0].id;
    // the trigger has just given it the accountant we ship; put it back to
    // what the blob import left behind, which is what the backfill meets.
    await db.exec(`delete from business_role_permissions p
                    using business_roles r
                    where p.role_id = r.id and r.business_id = '${id}' and r.key = 'accountant'`);
    await db.exec(`update business_roles set is_system = false
                    where business_id = '${id}' and key = 'accountant'`);
    return id;
  };

  /* One studio with the eleven permissions seven production studios have,
     and nothing else: untouched, so it becomes the role we ship. */
  const plain = await mk('as-imported');
  await db.exec(`insert into business_role_permissions (role_id, permission_key)
    select r.id, k from business_roles r
    cross join lateral unnest(array['allOrders','attendance','customers','customers.manage',
      'finance','finance.record_payment','money','payroll','seeContact','seeCost','seeProfit']) k
    where r.business_id = '${plain}' and r.key = 'accountant'`);

  /* One studio that gave its accountant the Studio settings page, which is
     not in the set we ship and could only have been a person ticking it. */
  const theirs = await mk('changed-it');
  await db.exec(`insert into business_role_permissions (role_id, permission_key)
    select r.id, k from business_roles r
    cross join lateral unnest(array['money','finance','seeCost','settings']) k
    where r.business_id = '${theirs}' and r.key = 'accountant'`);

  await db.exec(sql);

  const of = async (biz) => (await q(
    `select r.is_system, (select count(*)::int from business_role_permissions p
        where p.role_id = r.id) as n,
       (select count(*)::int from business_role_permissions p
        where p.role_id = r.id and p.permission_key = 'receivables') as rec,
       (select count(*)::int from business_role_permissions p
        where p.role_id = r.id and p.permission_key = 'settings') as settings
      from business_roles r where r.business_id = $1 and r.key = 'accountant'`, [biz]))[0];

  const p = await of(plain);
  ok('an accountant that is still the imported one is taken over', p.is_system === true,
     String(p.is_system));
  ok('and brought up to the whole shipped set', p.n === 16, p.n + ' permissions');
  ok('so it gains receivables', p.rec === 1, String(p.rec));

  const t = await of(theirs);
  ok('an accountant the studio changed stays a custom role', t.is_system === false,
     String(t.is_system));
  ok('and keeps the permission they gave it', t.settings === 1, String(t.settings));
  ok('and is not quietly widened to the shipped set', t.n === 4, t.n + ' permissions');
  ok('so nothing was revoked from it either', t.n >= 4, t.n + ' permissions');

  /* and running it a second time changes nothing at all */
  await db.exec(sql);
  const p2 = await of(plain), t2 = await of(theirs);
  ok('applying the migration twice is the same as applying it once',
     p2.n === p.n && t2.n === t.n && p2.is_system === true && t2.is_system === false,
     JSON.stringify({ plain: p2.n, theirs: t2.n }));
}

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('\nCreating an account does not reliably produce a studio:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nAn account becomes a studio it can actually sign into, whether it');
console.log('was expected or not — and a partner stays a partner.');
