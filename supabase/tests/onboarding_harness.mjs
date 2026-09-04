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

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('\nCreating an account does not reliably produce a studio:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nAn account becomes a studio it can actually sign into, whether it');
console.log('was expected or not — and a partner stays a partner.');
