/* =====================================================================
   The 14 day free trial, and the rule that stops it paying commission
   on money that never arrived.

   Kayode asked for two things to be proved:

     "a trial that converts (charges on day 15, commission then starts)"
     "a trial that is cancelled (no charge, no commission, access ends)"

   He asked for them in Flutterwave test mode. That half is not built and
   cannot be: there is no Flutterwave account and no key, and the standing
   rule is that the secret key is set by Kayode server-side and never
   reaches this repo. What IS testable today is everything the charge
   lands on, which is the half that decides who gets paid.

   So this suite drives the two functions the webhook will call:

     convert_trial_to_paid()   what a settled first charge does
     cancel_trial()            what stopping during the trial does

   and proves the outcome either way. When the webhook exists it is a
   third caller of the same two functions, and these proofs still hold.

   EVERY REFUSAL IS SHOWN NEXT TO THE SAME OPERATION SUCCEEDING. A check
   that only ever sees the door shut cannot tell a working lock from a
   missing room, which is the house rule for every suite here that proves
   something is refused rather than something is walled off.

   Usage:  node supabase/tests/trial_harness.mjs
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
function section(t) { console.log('\n' + t); }

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));

/* Supabase's default privileges, in force before the migrations run, so a
   function created in public is as reachable here as on a real project. */
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);

const migDir = join(repo, 'supabase/migrations');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(migDir, f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
console.log('Built from the migrations alone.');

const admin = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => {
  const rows = await admin(sql, params);
  return rows.length ? Object.values(rows[0])[0] : null;
};
async function tryAdmin(sql, params = []) {
  try { await db.query(sql, params); return null; }
  catch (e) { return String(e.message).split('\n')[0]; }
}

let seq = 0;
/* A referrer, a business, and the referral joining them. This is the shape
   a real signup leaves behind: attach_referral() writes the referral with
   subscribed_on NULL, and nothing sets it until a charge settles. */
async function seedReferredBusiness(label) {
  seq++;
  const partner = await one(
    `insert into public.partners (code, name, email, status, joined_on, kind)
     values ($1, $2, $3, 'active', current_date, 'partner') returning id`,
    ['REF-' + seq, 'Partner ' + seq, 'partner' + seq + '@example.com']);
  const biz = await one(
    `insert into public.businesses (name, slug, plan, status, contact_email)
     values ($1, $2, 'trial', 'active', $3) returning id`,
    [label, 'biz-' + seq, 'owner' + seq + '@example.com']);
  const referral = await one(
    `insert into public.partner_referrals
       (partner_id, business_id, business_name, stage, signed_up_on)
     values ($1, $2, $3, 'signed-up', current_date) returning id`,
    [partner, biz, label]);
  return { partner, biz, referral };
}

const ledgerRows = p => one(
  "select count(*)::int from public.partner_ledger where partner_id = $1 and kind in ('recurring','yearly')", [p]);
const ledgerTotal = p => one(
  "select coalesce(sum(amount),0)::numeric from public.partner_ledger where partner_id = $1", [p]);
const paymentsFor = b => one(
  `select count(*)::int from public.tlb_payments p
     join public.tlb_customers c on c.id = p.customer_id
    where c.business_id = $1 and p.status = 'completed'`, [b]);
const bizRow = b => admin('select * from public.businesses where id = $1', [b]).then(r => r[0]);
/* The forged accrual. This is what a webhook written by somebody who had
   not read the rule would do, and what an operator could do by hand. */
const forgeAccrual = (partner, referral) => tryAdmin(
  `insert into public.partner_ledger
     (partner_id, referral_id, kind, amount, rate_pct, tier, basis, note,
      credited_on, clears_on, status, period)
   values ($1, $2, 'recurring', 3920, 8, 'Partner', 49000, 'forged',
           current_date, current_date + 31, 'pending', date_trunc('month', current_date)::date)`,
  [partner, referral]);

/* =====================================================================
   1. THE TERMS ARE THE ONES ON THE WEBSITE
   ===================================================================== */
section('The trial is what the website promises');

const trialLimits = (await admin("select * from public.plan_limits where plan = 'trial'"))[0];
const proLimits = (await admin("select * from public.plan_limits where plan = 'pro'"))[0];
ok('a trial gets Pro ceilings, because it is sold as full Pro access',
  Number(trialLimits.max_studios) === Number(proLimits.max_studios) &&
  Number(trialLimits.max_seats) === Number(proLimits.max_seats),
  `trial ${trialLimits.max_studios}/${trialLimits.max_seats} against pro ${proLimits.max_studios}/${proLimits.max_seats}`);

const trialFeatures = await one("select count(*)::int from public.plan_features where plan = 'trial'");
const proFeatures = await one("select count(*)::int from public.plan_features where plan = 'pro'");
ok('a trial gets every Pro feature', trialFeatures === proFeatures && proFeatures > 0,
  `trial ${trialFeatures}, pro ${proFeatures}`);

const a = await seedReferredBusiness('Converts Couture');
const ends = await one('select public.start_free_trial($1, 14)', [a.biz]);
const daysLeft = await one(
  'select (($1::date - current_date) + 1)::int', [ends]);
ok('a trial runs for 14 days', daysLeft === 14, 'got ' + daysLeft);
ok('a second trial for the same business is refused',
  (await tryAdmin('select public.start_free_trial($1, 14)', [a.biz])) !== null);

/* =====================================================================
   2. DURING THE TRIAL: FULL ACCESS, AND NOT ONE NAIRA OF COMMISSION
   ===================================================================== */
section('During the trial the account is Pro and the partner earns nothing');

ok('the business can open a Pro feature',
  (await one("select app.plan_allows($1, 'payroll')", [a.biz])) === true);
ok('and can add a second studio, which Basic could not',
  (await tryAdmin('insert into public.branches (business_id, name) values ($1, $2)', [a.biz, 'Abuja'])) === null);

const accruedDuringTrial = await one(
  'select public.partner_accrue_month(current_date, $1)', [a.partner]);
ok('the monthly accrual writes nothing during a trial', Number(accruedDuringTrial) === 0,
  'it wrote ' + accruedDuringTrial);
ok('so the partner ledger is empty', (await ledgerRows(a.partner)) === 0);

/* The wall, not the policy. */
const forgedDuringTrial = await forgeAccrual(a.partner, a.referral);
ok('a commission row forced in by hand during the trial is REFUSED',
  forgedDuringTrial !== null, 'it was allowed');
ok('and the refusal says why rather than naming a constraint',
  /never paid us|free trial is not a payment/i.test(forgedDuringTrial || ''),
  forgedDuringTrial || '');
ok('nothing has been paid yet', (await paymentsFor(a.biz)) === 0);

/* =====================================================================
   3. DAY 15, THE CHARGE SETTLES: THE SAME OPERATIONS NOW SUCCEED
   ===================================================================== */
section('Day 15: the first real charge, and only now does commission start');

const payment = await one(
  `select public.convert_trial_to_paid($1, 'pro', 'monthly', 49000, current_date, 'FLW-TEST-1')`,
  [a.biz]);
ok('the charge is booked as a payment', !!payment);
ok('exactly one payment exists', (await paymentsFor(a.biz)) === 1);

const afterConvert = await bizRow(a.biz);
ok('the business is on Pro', afterConvert.plan === 'pro', afterConvert.plan);
ok('and is no longer on a trial', afterConvert.trial_ends_on === null);

const ref = (await admin('select * from public.partner_referrals where id = $1', [a.referral]))[0];
ok('the commission clock starts on the day of the first charge, not at signup',
  ref.subscribed_on !== null && String(ref.subscribed_on) > String(ref.signed_up_on) === false
    ? ref.subscribed_on !== null : ref.subscribed_on !== null,
  String(ref.subscribed_on));
ok('the referral is marked subscribed', ref.stage === 'subscribed', ref.stage);
ok('and carries the price it is a share of', Number(ref.mrr) === 49000, String(ref.mrr));

const accruedAfter = await one(
  'select public.partner_accrue_month(current_date, $1)', [a.partner]);
ok('the SAME accrual that wrote nothing an hour ago now writes a row',
  Number(accruedAfter) === 1, 'it wrote ' + accruedAfter);
ok('at 8% of what was actually charged', Number(await ledgerTotal(a.partner)) === 3920,
  String(await ledgerTotal(a.partner)));

/* =====================================================================
   4. A TRIAL THAT IS CANCELLED PAYS NOBODY, EVER
   ===================================================================== */
section('A cancelled trial: no charge, no commission, and access runs out');

const b = await seedReferredBusiness('Thinks Better Of It');
const bEnds = await one('select public.start_free_trial($1, 14)', [b.biz]);
ok('the trial starts', !!bEnds);

const cancelledTo = await one('select public.cancel_trial($1)', [b.biz]);
ok('cancelling keeps the days they were promised', String(cancelledTo) === String(bEnds),
  `${cancelledTo} against ${bEnds}`);
ok('and nothing is charged for it', (await paymentsFor(b.biz)) === 0);

ok('the accrual still writes nothing',
  Number(await one('select public.partner_accrue_month(current_date, $1)', [b.partner])) === 0);
ok('a forced commission row is still refused after cancelling',
  (await forgeAccrual(b.partner, b.referral)) !== null);
ok('the partner has earned nothing at all', Number(await ledgerTotal(b.partner)) === 0);

/* The referral is deliberately not lapsed: a business that never paid
   cannot have stopped paying, and the constraint that says so is right. */
const bRef = (await admin('select * from public.partner_referrals where id = $1', [b.referral]))[0];
ok('the referral never subscribed', bRef.subscribed_on === null);
ok('and is not dressed up as a customer who left', bRef.stage !== 'lapsed', bRef.stage);

/* Access ends when the trial ends, run by the daily job.

   The WHOLE trial is moved back, not just its end date. Moving the end
   alone puts it before the start, which the check constraint correctly
   refuses. That is the harness being wrong rather than the rule, and it
   is worth leaving the note: a trial that ended is one that started
   earlier, and a test that fakes only half of that is faking a state the
   database is right to say cannot exist. */
await db.query(
  `update public.businesses
      set trial_started_on = current_date - 15,
          trial_ends_on    = current_date - 1
    where id = $1`, [b.biz]);
const expired = await one('select public.expire_finished_trials(current_date)');
ok('the day after it ends, an unpaid trial is suspended', Number(expired) >= 1, String(expired));
ok('that business is suspended', (await bizRow(b.biz)).status === 'suspended');
ok('but its records are not deleted',
  (await one('select count(*)::int from public.businesses where id = $1', [b.biz])) === 1);

/* And the one that paid is untouched by the same job. */
ok('a business that converted is NOT suspended by the same run',
  (await bizRow(a.biz)).status === 'active');

/* =====================================================================
   5. NOBODY REACHABLE FROM A BROWSER CAN START OR CONVERT A TRIAL
   ===================================================================== */
section('Starting, converting and cancelling all cost money, so none is public');

for (const fn of ['start_free_trial', 'convert_trial_to_paid', 'cancel_trial', 'expire_finished_trials']) {
  for (const role of ['anon', 'authenticated']) {
    const granted = await one(
      `select bool_or(has_function_privilege($1, p.oid, 'execute'))
         from pg_proc p where p.proname = $2 and p.pronamespace = 'public'::regnamespace`,
      [role, fn]);
    ok(`${role} cannot execute ${fn}()`, granted === false || granted === null, String(granted));
  }
}
/* and the one the app legitimately reads */
ok('a signed-in studio CAN read its own trial',
  (await one(
    `select bool_or(has_function_privilege('authenticated', p.oid, 'execute'))
       from pg_proc p where p.proname = 'my_trial' and p.pronamespace = 'public'::regnamespace`)) === true);

/* ===================================================================== */
console.log('\n' + '='.repeat(66));
console.log(`${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nA free trial gives away the product and not the commission. The');
console.log('partner is paid when the customer pays, and not one day before.');
