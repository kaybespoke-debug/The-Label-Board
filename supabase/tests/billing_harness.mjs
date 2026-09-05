/* What a studio is on, and what it has actually paid.
 *
 * The database has had tlb_customers, tlb_subscriptions and tlb_payments since
 * the console was first sketched — plan tiers, cycles, a monthly-equivalent
 * price, renewal and trial-end dates, payment references. None of it was ever
 * joined to a real tenant. public.businesses was the studio, tlb_customers was
 * a sales CRM, and nothing connected them, so a studio could sign up, be
 * provisioned and work for a month while carrying no subscription, no trial
 * clock and no payment history. The console reported its MRR as the plan's
 * list price: money nobody had been asked for.
 *
 * The two rules this holds:
 *
 *   Every studio has exactly one billing record and one active subscription,
 *   created when the studio is, not when somebody remembers.
 *
 *   businesses.plan and the active subscription never disagree. The first
 *   decides what the studio may DO; the second decides what we invoice. A
 *   studio paying for Pro while the app treats it as a trial is the kind of
 *   thing a customer discovers before we do.
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

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];

const signUp = (email, meta = {}) =>
  q(`insert into auth.users (email, raw_user_meta_data) values ($1,$2::jsonb) returning id`,
    [email, JSON.stringify(meta)]).then(r => r[0].id);

// ---------------------------------------------------------------------
section('Every studio is on the books from the moment it exists');
// ---------------------------------------------------------------------
{
  await signUp('billing.new@example.com', { business_name: 'Tolu Atelier' });
  const r = await one(`
    select b.id, b.plan,
      (select count(*) from tlb_customers c where c.business_id = b.id) as crm_rows,
      (select count(*) from tlb_subscriptions s
         join tlb_customers c on c.id = s.customer_id
        where c.business_id = b.id and s.is_active) as active_subs
    from businesses b where b.slug = 'tolu-atelier'`);
  ok('a new studio gets a billing record', +r.crm_rows === 1, r.crm_rows + ' rows');
  ok('and exactly one active subscription', +r.active_subs === 1, r.active_subs + ' active');

  const s = await one(`
    select s.plan_tier, s.is_trial, s.trial_end_date, s.monthly_equivalent_price
      from tlb_subscriptions s join tlb_customers c on c.id = s.customer_id
     where c.business_id = $1 and s.is_active`, [r.id]);
  ok('it starts on a trial', s.is_trial === true && s.plan_tier === 'trial', s.plan_tier);
  ok('the trial has an end date, so it can expire', !!s.trial_end_date, String(s.trial_end_date));
  ok('and a trial is worth nothing until it converts', Number(s.monthly_equivalent_price) === 0,
     String(s.monthly_equivalent_price));
}

// ---------------------------------------------------------------------
section('The studios that predate all this were not left behind');
// ---------------------------------------------------------------------
// The six seeded test studios were provisioned before billing existed. A
// backfill that quietly skips them would leave exactly the accounts most
// likely to be tested first with no subscription at all.
{
  const r = await one(`
    select count(*)::int as total,
           count(*) filter (where c.id is not null)::int as with_crm,
           count(*) filter (where s.id is not null)::int as with_sub
      from businesses b
      left join tlb_customers c on c.business_id = b.id
      left join tlb_subscriptions s on s.customer_id = c.id and s.is_active`);
  ok('every studio has a billing record', r.total === r.with_crm, r.with_crm + ' of ' + r.total);
  ok('and an active subscription', r.total === r.with_sub, r.with_sub + ' of ' + r.total);
}

// ---------------------------------------------------------------------
section('Running it twice does not double anybody up');
// ---------------------------------------------------------------------
{
  const biz = (await one(`select id from businesses where slug='tolu-atelier'`)).id;
  await q(`select app.ensure_billing_record($1)`, [biz]);
  await q(`select app.ensure_billing_record($1)`, [biz]);
  const r = await one(`
    select (select count(*) from tlb_customers c where c.business_id=$1) as crm,
           (select count(*) from tlb_subscriptions s join tlb_customers c on c.id=s.customer_id
             where c.business_id=$1 and s.is_active) as subs`, [biz]);
  ok('still one billing record', +r.crm === 1, String(r.crm));
  ok('still one active subscription', +r.subs === 1, String(r.subs));
}

// ---------------------------------------------------------------------
section('A plan change moves both books or neither');
// ---------------------------------------------------------------------
{
  const biz = (await one(`select id from businesses where slug='tolu-atelier'`)).id;
  await q(`select app.set_studio_plan($1,'pro','monthly',49000)`, [biz]);

  const r = await one(`
    select b.plan as app_plan, s.plan_tier as billed_plan, s.monthly_equivalent_price as price,
           s.is_trial, s.renewal_date, c.status as crm_status
      from businesses b
      join tlb_customers c on c.business_id = b.id
      join tlb_subscriptions s on s.customer_id = c.id and s.is_active
     where b.id = $1`, [biz]);
  ok('the app is told the studio is on Pro', r.app_plan === 'pro', r.app_plan);
  ok('and so are the books', r.billed_plan === 'pro', r.billed_plan);
  ok('at the price it was set to', Number(r.price) === 49000, String(r.price));
  ok('it is no longer a trial', r.is_trial === false);
  ok('it has a renewal date', !!r.renewal_date, String(r.renewal_date));
  ok('the CRM record follows', r.crm_status === 'active', r.crm_status);

  const hist = await one(`
    select count(*)::int as n from tlb_subscriptions s
      join tlb_customers c on c.id = s.customer_id
     where c.business_id = $1`, [biz]);
  ok('the old subscription is kept rather than overwritten', hist.n === 2,
     hist.n + ' — a studio\'s billing history should survive a plan change');
  const ended = await one(`
    select count(*)::int as n from tlb_subscriptions s
      join tlb_customers c on c.id = s.customer_id
     where c.business_id = $1 and not s.is_active and s.end_date is not null`, [biz]);
  ok('and it is closed off with an end date', ended.n === 1, String(ended.n));
}

// ---------------------------------------------------------------------
section('It refuses what it cannot bill');
// ---------------------------------------------------------------------
{
  const biz = (await one(`select id from businesses where slug='tolu-atelier'`)).id;
  for (const [args, why] of [
    [`$1,'enterprise','monthly',1000`, 'a plan the app does not know'],
    [`$1,'pro','weekly',1000`, 'a billing cycle nothing understands'],
    [`$1,'pro','monthly',-5`, 'a negative price'],
  ]) {
    let threw = false;
    try { await db.query(`select app.set_studio_plan(${args})`, [biz]); }
    catch (e) { threw = true; }
    ok('it refuses ' + why, threw, 'it was accepted');
  }
  const still = await one(`select plan from businesses where id=$1`, [biz]);
  ok('and a refusal leaves the studio where it was', still.plan === 'pro', still.plan);
}

// ---------------------------------------------------------------------
section('Revenue is what arrived, not what was quoted');
// ---------------------------------------------------------------------
// The console reported MRR as the plan's list price. That is what a studio
// would owe. Reporting it as revenue is how a business believes it is being
// paid while nothing has landed.
{
  const biz = (await one(`select id from businesses where slug='tolu-atelier'`)).id;
  const cust = (await one(`select id from tlb_customers where business_id=$1`, [biz])).id;
  const sub = (await one(`select id from tlb_subscriptions where customer_id=$1 and is_active`, [cust])).id;

  let r = await one(`select paid_to_date, payments_count from public.platform_billing_summary()
                      where business_id = $1`, [biz]);
  ok('a studio that has paid nothing shows nothing paid', Number(r.paid_to_date) === 0,
     String(r.paid_to_date));

  await q(`insert into tlb_payments (customer_id, subscription_id, amount, currency, status, payment_method, payment_date)
           values ($1,$2,49000,'NGN','completed','bank transfer', now())`, [cust, sub]);
  await q(`insert into tlb_payments (customer_id, subscription_id, amount, currency, status, payment_method, payment_date)
           values ($1,$2,49000,'NGN','pending','bank transfer', now())`, [cust, sub]);
  await q(`insert into tlb_payments (customer_id, subscription_id, amount, currency, status, payment_method, payment_date)
           values ($1,$2,49000,'NGN','failed','card', now())`, [cust, sub]);

  r = await one(`select paid_to_date, payments_count, last_paid_on
                   from public.platform_billing_summary() where business_id = $1`, [biz]);
  ok('a completed payment counts', Number(r.paid_to_date) === 49000, String(r.paid_to_date));
  ok('a pending one does not', Number(r.paid_to_date) !== 98000, String(r.paid_to_date));
  ok('nor does a failed one', Number(r.paid_to_date) === 49000, String(r.paid_to_date));
  ok('but all three are on the record', Number(r.payments_count) === 3, String(r.payments_count));
  ok('and the last payment is dated', !!r.last_paid_on, String(r.last_paid_on));
}

// ---------------------------------------------------------------------
section('None of it is readable from a browser');
// ---------------------------------------------------------------------
// What every subscriber pays is the platform's own book. It goes through
// admin-api under the service role and nowhere else.
{
  for (const fn of ['platform_billing_summary']) {
    const r = await one(`
      select has_function_privilege('anon', 'public.${fn}()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.${fn}()', 'execute') as auth,
             has_function_privilege('service_role', 'public.${fn}()', 'execute') as svc`);
    ok(fn + '() is closed to the anon key', r.anon === false);
    ok(fn + '() is closed to any signed-in user', r.auth === false);
    ok(fn + '() is open to the gateway', r.svc === true);
  }
  const r = await one(`
    select has_function_privilege('authenticated','app.set_studio_plan(uuid,text,text,numeric)','execute') as auth`);
  ok('a signed-in user cannot move themselves onto a better plan', r.auth === false);
}

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('\nBilling does not hold:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nEvery studio is on the books from the moment it exists, the app and');
console.log('the invoice never disagree, and revenue is what arrived.');
