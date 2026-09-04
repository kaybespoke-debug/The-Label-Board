/* The console's own tables, tested the way Supabase actually serves them.
 *
 * Every other suite here builds a bare Postgres and runs the migrations at
 * it. That is the right test for the tenant tables, which grant and revoke
 * explicitly. It is the wrong test for the tlb_ tables, which granted
 * nothing and relied on an absence — and a bare Postgres has that absence
 * for free, while Supabase does not.
 *
 * Supabase ships this on every project:
 *
 *   alter default privileges in schema public
 *     grant all on tables to anon, authenticated;
 *
 * so a table created in public is world-reachable with the anon key from
 * the moment it exists, and RLS is the only thing standing in the way.
 * This suite sets that default first, so the database under test has the
 * privileges the real one has, and the policies are actually reached.
 *
 * It exists because four tables — tlb_staff, tlb_commissions,
 * tlb_support_tickets, tlb_tasks — raised 42P17 for every signed-in
 * caller. Their policies read tlb_staff to decide who was asking, and
 * reading tlb_staff runs the policy that reads tlb_staff. The operator
 * console never noticed because it reaches them through admin-api under
 * the service role, which holds BYPASSRLS and evaluates no policy at all.
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

// Supabase's default privileges, set BEFORE the migrations so that each
// create table picks them up exactly as it would on a real project.
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`);

const migDir = join(repo, 'supabase/migrations');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(migDir, f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
console.log('Built from the migrations, with Supabase default privileges in force.');

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
const asAdmin = async (sql, params = []) => (await db.query(sql, params)).rows;

const TLB = ['tlb_customers', 'tlb_subscriptions', 'tlb_payments', 'tlb_pipeline',
             'tlb_notes', 'tlb_trial_history', 'tlb_staff', 'tlb_commissions',
             'tlb_support_tickets', 'tlb_tasks', 'tlb_audit_log'];

// ---------------------------------------------------------------------
section('No policy eats itself');
// ---------------------------------------------------------------------
// 42P17 is not a permission failure. It means the table cannot be read by
// anybody at all through RLS, which is a broken feature wearing the mask
// of a strict one.
const OWNER = '00000000-0000-0000-0000-0000000000a1';
const SALES = '00000000-0000-0000-0000-0000000000a2';
for (const t of TLB) {
  const r = await asRole('authenticated', OWNER, `select 1 from public.${t} limit 1`);
  ok('reading ' + t + ' as a signed-in user does not recurse',
     !r.error || !/infinite recursion/i.test(r.error), r.error || '');
}

// ---------------------------------------------------------------------
section('The anon key reaches none of it');
// ---------------------------------------------------------------------
// These tables are the platform's own books: who our subscribers are, what
// they pay, what our staff earn. No browser session should hold a grant on
// them, whatever the policies happen to say today.
for (const t of TLB) {
  const granted = await asAdmin(
    `select coalesce(string_agg(distinct a.privilege_type, ','), '') as p
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(c.relacl) a
      where n.nspname = 'public' and c.relname = $1
        and a.grantee::regrole::text = 'anon'`, [t]);
  ok('anon holds no privilege on ' + t, (granted[0]?.p || '') === '', granted[0]?.p || '');

  const r = await asRole('anon', null, `select 1 from public.${t} limit 1`);
  ok('anon cannot read ' + t, !!r.error, r.error ? '' : 'returned rows');
}

// ---------------------------------------------------------------------
section('RLS is on and forced');
// ---------------------------------------------------------------------
// Without FORCE, the table owner is exempt from its own policies. That is
// the account migrations run as, and the account a mistake runs as.
for (const t of TLB) {
  const r = await asAdmin(
    `select c.relrowsecurity as on, c.relforcerowsecurity as forced
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname=$1`, [t]);
  ok('RLS is enabled and forced on ' + t, r[0]?.on === true && r[0]?.forced === true,
     'enabled=' + r[0]?.on + ' forced=' + r[0]?.forced);
}

// ---------------------------------------------------------------------
section('Every policy names the role it is for');
// ---------------------------------------------------------------------
// A policy created without `to <role>` applies to PUBLIC, which includes
// anon. Today the predicates return false for anon, so nothing leaks; the
// point is that it should not depend on the predicate.
{
  const loose = await asAdmin(
    `select tablename, policyname from pg_policies
      where schemaname = 'public' and 'public' = any(coalesce(roles,'{}'))
      order by 1, 2`);
  ok('no policy is left open to PUBLIC', loose.length === 0,
     loose.map(r => r.tablename + '.' + r.policyname).join(', '));
}

// ---------------------------------------------------------------------
section('And the rules still say what they meant to say');
// ---------------------------------------------------------------------
// Fixing the recursion is only half of it. These check that the repaired
// policies grant the same access the originals described.
{
  await asAdmin(`insert into public.tlb_staff (id, auth_user_id, email, name, role)
                 values ('00000000-0000-0000-0000-0000000000b1', $1, 'owner@x', 'Owner', 'owner'),
                        ('00000000-0000-0000-0000-0000000000b2', $2, 'sales@x', 'Sales', 'sales')`,
                [OWNER, SALES]);
  await asAdmin(`insert into public.tlb_customers (id, business_name, business_type, owner_name, owner_email)
                 values ('00000000-0000-0000-0000-0000000000c1','Studio','fashion_label','A','a@x')`);
  await asAdmin(`insert into public.tlb_commissions (staff_id, customer_id, commission_amount)
                 values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1', 100),
                        ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c1', 200)`);
  await asAdmin(`insert into public.tlb_tasks (assigned_to, title)
                 values ('00000000-0000-0000-0000-0000000000b1','Owner task'),
                        ('00000000-0000-0000-0000-0000000000b2','Sales task')`);

  const ownerSees = await asRole('authenticated', OWNER, 'select id from public.tlb_staff');
  ok('an owner sees the whole team', ownerSees.rows.length === 2,
     ownerSees.error || (ownerSees.rows.length + ' row(s)'));

  const salesSees = await asRole('authenticated', SALES, 'select id from public.tlb_staff');
  ok('everybody else sees only their own staff row', salesSees.rows.length === 1,
     salesSees.error || (salesSees.rows.length + ' row(s)'));

  const salesComm = await asRole('authenticated', SALES, 'select id from public.tlb_commissions');
  ok('sales sees its own commission and not the other one', salesComm.rows.length === 1,
     salesComm.error || (salesComm.rows.length + ' row(s)'));

  const ownerComm = await asRole('authenticated', OWNER, 'select id from public.tlb_commissions');
  ok('an owner sees every commission', ownerComm.rows.length === 2,
     ownerComm.error || (ownerComm.rows.length + ' row(s)'));

  const salesTasks = await asRole('authenticated', SALES, 'select id from public.tlb_tasks');
  ok('a task belongs to the person it is assigned to', salesTasks.rows.length === 1,
     salesTasks.error || (salesTasks.rows.length + ' row(s)'));

  // A staff member must not be able to promote themselves to owner.
  const promote = await asRole('authenticated', SALES,
    `update public.tlb_staff set role = 'owner' where auth_user_id = $1 returning id`, [SALES]);
  ok('a staff member cannot promote themselves to owner', promote.rows.length === 0,
     promote.rows.length + ' row(s) updated');

  // Nor hand themselves somebody else's commission.
  const steal = await asRole('authenticated', SALES,
    `update public.tlb_commissions set staff_id = '00000000-0000-0000-0000-0000000000b2'
      where staff_id = '00000000-0000-0000-0000-0000000000b1' returning id`);
  ok('a staff member cannot reassign a commission to themselves', steal.rows.length === 0,
     steal.rows.length + ' row(s) updated');
}

// ---------------------------------------------------------------------
section('A policy that can never be true is not security, it is a bug');
// ---------------------------------------------------------------------
// The thirteen platform-admin policies tested a subquery against
// platform_admins, which has RLS and no policy, so the subquery returned
// nothing for everybody and the policies were dead. Locked and broken look
// identical from outside unless something checks the permitted case too.
{
  const ADMIN = '00000000-0000-0000-0000-0000000000d1';
  const NOBODY = '00000000-0000-0000-0000-0000000000d2';
  await asAdmin(`insert into public.platform_admins (id, email) values ($1, 'kayode@x')`, [ADMIN]);

  for (const t of ['tlb_customers', 'tlb_subscriptions', 'tlb_payments', 'tlb_pipeline', 'tlb_notes']) {
    const seen = await asRole('authenticated', ADMIN, `select 1 from public.${t}`);
    ok('a platform admin can read ' + t, seen.error === null, seen.error || '');
  }

  // tlb_customers has a row from the block above, so this distinguishes
  // "allowed and empty" from "allowed and actually returning it".
  const rows = await asRole('authenticated', ADMIN, 'select id from public.tlb_customers');
  ok('a platform admin sees the subscriber that exists', rows.rows.length === 1,
     rows.error || (rows.rows.length + ' row(s)'));

  const outsider = await asRole('authenticated', NOBODY, 'select id from public.tlb_customers');
  ok('somebody who is not a platform admin sees no subscribers', outsider.rows.length === 0,
     outsider.rows.length + ' row(s)');
}

// ---------------------------------------------------------------------
section('Every function in app pins its search_path');
// ---------------------------------------------------------------------
// The whole security model rests on app.in_scope() and its neighbours, and
// most of them are SECURITY DEFINER. A definer function with a mutable
// search_path can be pointed at somebody else's table by whoever calls it.
// app.slugify shipped without one and the migration that added it claimed
// two functions later that search_path is pinned "as everywhere else here"
// — a rule with one exception is not a rule, and Supabase's linter found
// it before this suite did.
{
  const fns = await asAdmin(
    `select p.proname, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' order by p.proname`);
  ok('there are app functions to check at all', fns.length > 0, 'found none');
  for (const f of fns) {
    ok('app.' + f.proname + ' pins its search_path',
       (f.proconfig || []).some(c => String(c).startsWith('search_path=')),
       f.prosecdef ? 'and it is SECURITY DEFINER, so this is not cosmetic' : '');
  }
}

console.log('\n' + '='.repeat(60));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('\nThe console tables do not behave as they do on Supabase:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nWith Supabase’s default privileges in force, the console tables');
console.log('reach nobody they should not, and no policy reads the table it guards.');
