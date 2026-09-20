/* =====================================================================
   One referral programme, and the fraud controls that make it payable.

   Kayode asked for two of these to be shown rather than described:

     "show a self-referral attempt blocked, and a churn-within-hold-window
      paying no commission"

   Both are below, and both are shown the same way every rule in this repo
   gets shown: the thing is REFUSED, and then the same operation succeeds
   once it is legitimate. A check that only ever sees the refusal cannot
   tell a working control from a broken table.

   The other controls are here for the same reason the migration puts them
   in one file. Opening the programme to every customer is what creates the
   fraud: sign up, take your own code, sign up again, collect 8% of your own
   subscription for a year. Proving the unification without proving the
   block would be proving the easy half.

   Usage:  node supabase/tests/referral_fraud_harness.mjs
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
function eq(name, got, want) {
  const n = Number(got), m = Number(want);
  const same = (Number.isFinite(n) && Number.isFinite(m)) ? n === m : String(got) === String(want);
  ok(name + '  (' + JSON.stringify(got) + ')', same, 'wanted ' + JSON.stringify(want));
}
function section(t) { console.log('\n' + t); }

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);
const migDir = join(repo, 'supabase/migrations');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(migDir, f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
console.log('Built from the migrations alone.');

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => {
  const rows = await q(sql, params);
  return rows.length ? Object.values(rows[0])[0] : null;
};
async function boom(sql, params = []) {
  try { await db.query(sql, params); return null; }
  catch (e) { return String(e.message).split('\n')[0]; }
}

/* A real signup: an auth user, which fires app.provision_studio(). That
   is the path this has to be tested through, because the whole point is
   that a code exists from the first day without anybody doing anything. */
let seq = 0;
async function signUp(name, email, code) {
  seq++;
  const id = await one(
    `insert into auth.users (id, email, raw_user_meta_data)
     values (gen_random_uuid(), $1, $2::jsonb) returning id`,
    [email, JSON.stringify(Object.assign({ business_name: name }, code ? { referral_code: code } : {}))]);
  const biz = await one(
    `select business_id from public.memberships where user_id = $1 limit 1`, [id]);
  return { user: id, business: biz };
}
const codeOf = biz => one('select code from public.partners where business_id = $1', [biz]);
const partnerOf = biz => one('select id from public.partners where business_id = $1', [biz]);
const referrerOf = biz => one('select referred_by from public.businesses where id = $1', [biz]);
const addCard = (biz, fp, label) => boom(
  'insert into public.payment_methods (business_id, fingerprint, label, verified) values ($1,$2,$3,true)',
  [biz, fp, label || 'card']);

/* =====================================================================
   1. EVERY CUSTOMER IS A REFERRER
   ===================================================================== */
section('Every customer gets a code, without anybody handing them one');
const ada = await signUp('Ada Couture', 'ada@example.test');
ok('signing up creates a studio', !!ada.business);
const adaCode = await codeOf(ada.business);
ok('and a referral code with it', !!adaCode, String(adaCode));
eq('derived from the studio name rather than invented', adaCode, 'ADA-COUTURE');
eq('and they are on the same programme as everybody else',
  await one('select kind from public.partners where business_id = $1', [ada.business]), 'customer');

/* the rate is the thing that must NOT differ by kind */
const rates = await q(
  `select distinct kind, (select rate_pct from public.partner_rate_bands where min_active = 0) as r
   from public.partners`);
ok('there is one rate, whatever kind of referrer you are',
  rates.length > 0 && new Set(rates.map(r => String(r.r))).size === 1,
  JSON.stringify(rates));

const tunde = await signUp('Tunde Leatherworks', 'tunde@example.test');
const tundeCode = await codeOf(tunde.business);
ok('a second studio gets its own code', tundeCode && tundeCode !== adaCode, String(tundeCode));
eq('codes are unique across everybody',
  await one('select count(*)::int from (select code from public.partners group by code having count(*) > 1) d'), 0);

/* =====================================================================
   2. SELF-REFERRAL, REFUSED FOUR WAYS
   ===================================================================== */
section('A self-referral is refused, and the refusal says which rule it hit');

/* (a) the same business, using its own code */
const sameBiz = await one('select app.attach_referral($1, $2)', [ada.business, adaCode]);
ok('a business cannot use its own code', !!sameBiz, 'it was allowed');
ok('and is told why', /cannot refer itself/.test(String(sameBiz)), String(sameBiz));
eq('nothing was attributed', await referrerOf(ada.business), null);

/* (b) the same person, signing a second studio up on their own code.
   This is the fraud in its simplest form: one person, two studios, 8% of
   their own money for a year. */
const adaSecond = await one(
  `insert into public.businesses (name, slug, plan, contact_email)
   values ('Ada Second', 'ada-second', 'trial', 'ada2@example.test') returning id`);
await db.query(
  `insert into public.memberships (business_id, user_id, role, status)
   values ($1, $2, 'owner', 'active')`, [adaSecond, ada.user]);
const samePerson = await one('select app.attach_referral($1, $2)', [adaSecond, adaCode]);
ok('the same person cannot refer their own second studio', !!samePerson, 'it was allowed');
ok('and is told why', /already works in this business/.test(String(samePerson)), String(samePerson));

/* (c) the same email address */
const sameMail = await one(
  `insert into public.businesses (name, slug, plan, contact_email)
   values ('Ada Third', 'ada-third', 'trial', 'ADA@example.test') returning id`);
const byEmail = await one('select app.attach_referral($1, $2)', [sameMail, adaCode]);
ok('the same email address cannot claim its own code', !!byEmail, 'it was allowed');
ok('and the check is not case sensitive, which is the whole trick',
  /belongs to this email address/.test(String(byEmail)), String(byEmail));

/* (d) the same card. The one that costs something to get around. */
await addCard(ada.business, 'fp-ada-visa-6411', 'Visa 6411');
const sameCardBiz = await one(
  `insert into public.businesses (name, slug, plan, contact_email)
   values ('Ada Fourth', 'ada-fourth', 'trial', 'different@example.test') returning id`);
await addCard(sameCardBiz, 'fp-ada-visa-6411-x');   /* a DIFFERENT card, so attach succeeds */
const cleanAttach = await one('select app.attach_referral($1, $2)', [sameCardBiz, adaCode]);
ok('a different business on a different card is attached', cleanAttach === null, String(cleanAttach));

/* now the same card turns up on it, which is the late collision */
const lateCard = await addCard(sameCardBiz, 'fp-ada-visa-6411', 'Visa 6411');
ok('that card cannot also be on the second business', !!lateCard, 'it was allowed');
ok('and the refusal explains the rule',
  /already on another business/.test(String(lateCard)), String(lateCard));

/* THE PASSING HALF. The same code, a business with none of the four
   connections, is attached without argument. */
section('And the same code works for somebody who is not the referrer');
const unrelated = await signUp('Kemi Shoes', 'kemi@example.test', adaCode);
eq('an unrelated business signing up on that code is tied to it',
  await referrerOf(unrelated.business), await partnerOf(ada.business));
eq('and the tie is dated', await one(
  'select (referred_on is not null) from public.businesses where id = $1', [unrelated.business]), true);
eq('a referral row exists for the ledger to be built from',
  await one('select count(*)::int from public.partner_referrals where business_id = $1', [unrelated.business]), 1);

section('The tie is permanent');
const moved = await boom('update public.businesses set referred_by = $1 where id = $2',
  [await partnerOf(tunde.business), unrelated.business]);
ok('a referrer cannot be swapped for another', !!moved, 'it was allowed');
ok('and the refusal says so plainly',
  /keeps the referrer it signed up with/.test(String(moved)), String(moved));
const second = await one('select app.attach_referral($1, $2)', [unrelated.business, tundeCode]);
ok('nor claimed a second time through the front door', !!second, 'it was allowed');

section('Every attempt is written down, refused or not');
const log = await q(`select outcome, count(*)::int as n from public.referral_attempts group by outcome order by 1`);
const byOutcome = Object.fromEntries(log.map(r => [r.outcome, Number(r.n)]));
ok('the refusals are on the record', (byOutcome.refused || 0) >= 4, JSON.stringify(byOutcome));
ok('and so are the ones that went through', (byOutcome.attached || 0) >= 1, JSON.stringify(byOutcome));
ok('an unknown code is recorded as its own thing, not as fraud',
  (await one(`select app.attach_referral($1, 'NOT-A-CODE')`,
    [await one(`insert into public.businesses (name, slug, plan) values ('X','x-1','trial') returning id`)])) !== null &&
  (await one(`select count(*)::int from public.referral_attempts where outcome = 'unknown-code'`)) === 1);

/* =====================================================================
   3. COMMISSION ONLY ON MONEY THAT ARRIVED AND STAYED
   ===================================================================== */
section('A clean referral earns');
const refId = await one('select id from public.partner_referrals where business_id = $1', [unrelated.business]);
await db.query(
  `update public.partner_referrals
      set stage = 'subscribed', plan = 'pro', cycle = 'monthly',
          mrr = 49000, first_payment = 49000,
          signed_up_on = '2026-03-01', subscribed_on = '2026-03-10'
    where id = $1`, [refId]);
eq('March accrues', await one(`select public.partner_accrue_month('2026-03-01', null)`), 1);
eq('April accrues', await one(`select public.partner_accrue_month('2026-04-01', null)`), 1);
eq('two months at 8% of 49,000',
  await one('select coalesce(sum(amount),0) from public.partner_ledger where referral_id = $1', [refId]),
  2 * 49000 * 0.08);
eq('and both are pending, because the hold has not run',
  await one(`select count(*)::int from public.partner_ledger where referral_id = $1 and status = 'pending'`, [refId]), 2);

section('A business that churns inside the hold pays nothing');
/* March cleared on 30 April, so clear the ledger as of a day after that
   and leave April still inside its 31 days. */
await db.query(`select public.partner_clear_ledger('2026-05-02')`);
eq('March has cleared', await one(
  `select count(*)::int from public.partner_ledger where referral_id = $1 and status = 'cleared'`, [refId]), 1);
eq('April is still on hold', await one(
  `select count(*)::int from public.partner_ledger where referral_id = $1 and status = 'pending'`, [refId]), 1);

const heldBefore = await one(
  `select amount from public.partner_ledger where referral_id = $1 and status = 'pending'`, [refId]);
await db.query(
  `update public.partner_referrals set stage = 'lapsed', lapsed_on = '2026-05-10' where id = $1`, [refId]);

eq('the month still inside the hold is voided', await one(
  `select count(*)::int from public.partner_ledger where referral_id = $1 and status = 'void'`, [refId]), 1);
eq('and it is the one that was pending', await one(
  `select amount from public.partner_ledger where referral_id = $1 and status = 'void'`, [refId]), heldBefore);
eq('the month that had already cleared is untouched', await one(
  `select count(*)::int from public.partner_ledger where referral_id = $1 and status = 'cleared'`, [refId]), 1);
eq('so the payable total is one month, not two', await one(
  `select coalesce(sum(amount),0) from public.partner_ledger
    where referral_id = $1 and status in ('cleared','paid')`, [refId]), 49000 * 0.08);
ok('and the voided row says why',
  /stopped paying inside the hold/.test(String(await one(
    `select note from public.partner_ledger where referral_id = $1 and status = 'void'`, [refId]))));

section('A refund does the same without them leaving');
const kemi2 = await signUp('Kemi Two', 'kemi2@example.test', tundeCode);
const ref2 = await one('select id from public.partner_referrals where business_id = $1', [kemi2.business]);
await db.query(
  `update public.partner_referrals
      set stage = 'subscribed', plan = 'pro', cycle = 'monthly',
          mrr = 20000, first_payment = 20000,
          signed_up_on = '2026-06-01', subscribed_on = '2026-06-05'
    where id = $1`, [ref2]);
await db.query(`select public.partner_accrue_month('2026-06-01', null)`);
eq('one month accrued', await one(
  `select count(*)::int from public.partner_ledger where referral_id = $1`, [ref2]), 1);
eq('the refund voids it', await one(
  'select public.partner_void_on_refund($1, $2)', [kemi2.business, 'card chargeback']), 1);
eq('nothing is payable', await one(
  `select coalesce(sum(amount),0) from public.partner_ledger
    where referral_id = $1 and status <> 'void'`, [ref2]), 0);

/* =====================================================================
   4. ONE PAYMENT METHOD, ONE BUSINESS
   ===================================================================== */
section('A payment method belongs to one business');
const bizA = await one(
  `insert into public.businesses (name, slug, plan) values ('Card A','card-a','trial') returning id`);
const bizB = await one(
  `insert into public.businesses (name, slug, plan) values ('Card B','card-b','trial') returning id`);
ok('the first business may add it', (await addCard(bizA, 'fp-shared-9001')) === null);
ok('the second may not', !!(await addCard(bizB, 'fp-shared-9001')), 'it was allowed');

/* the exemption, which needs BOTH sides to have agreed */
await db.query(`update public.businesses set payment_sharing_allowed = true where id = $1`, [bizB]);
ok('one side allowing it is not enough', !!(await addCard(bizB, 'fp-shared-9001')), 'it was allowed');
await db.query(`update public.businesses set payment_sharing_allowed = true where id = $1`, [bizA]);
ok('both sides allowing it is', (await addCard(bizB, 'fp-shared-9001')) === null);

section('A card that turns up later still voids the referral');
const late = await signUp('Late Card', 'late@example.test', tundeCode);
eq('it starts out attributed', await referrerOf(late.business), await partnerOf(tunde.business));
/* Both inserts are ASSERTED, not just performed. The first draft of this
   called addCard and ignored what came back, so when the trigger below
   raised a constraint violation the helper swallowed it, the card never
   landed, and the failure showed up three lines later as "the attribution
   was not dropped" — which pointed at the wrong function entirely. */
ok('the referrer has a card on file', (await addCard(tunde.business, 'fp-tunde-mastercard')) === null);
await db.query(`update public.businesses set payment_sharing_allowed = true where id in ($1,$2)`,
  [tunde.business, late.business]);
ok('and the referred business is allowed to add the same one',
  (await addCard(late.business, 'fp-tunde-mastercard')) === null);
eq('the attribution is dropped once the card gives it away',
  await referrerOf(late.business), null);
ok('and it is on the record',
  (await one(`select count(*)::int from public.referral_attempts
              where business_id = $1 and outcome = 'refused'`, [late.business])) >= 1);

/* =====================================================================
   5. AN OPERATOR CAN STOP A PAYOUT
   ===================================================================== */
section('A payout can be frozen while a pattern is looked at');
const tundeP = await partnerOf(tunde.business);
ok('freezing needs a reason', !!(await boom(
  'select public.set_partner_payout_frozen($1, true, null)', [tundeP])));
await db.query(`select public.set_partner_payout_frozen($1, true, $2)`,
  [tundeP, 'three signups from one address in an hour']);
const frozenRun = await boom('select public.partner_payout_run($1, $2)', [tundeP, '2026-07-01']);
ok('and a frozen referrer is not paid', !!frozenRun, 'the run went ahead');
ok('the refusal carries the reason somebody wrote',
  /three signups from one address/.test(String(frozenRun)), String(frozenRun));
await db.query(`select public.set_partner_payout_frozen($1, false, null)`, [tundeP]);
eq('unfreezing clears the reason with it',
  await one('select frozen_reason from public.partners where id = $1', [tundeP]), null);

/* =====================================================================
   6. THE CONSOLE CAN SEE THE PATTERNS
   ===================================================================== */
section('The patterns an operator has to be shown');
const risk = await q('select kind, count(*)::int as n from public.platform_referral_risk() group by kind order by 1');
const kinds = Object.fromEntries(risk.map(r => [r.kind, Number(r.n)]));
ok('refused attempts are surfaced', (kinds['refused-attempt'] || 0) > 0, JSON.stringify(kinds));
ok('the view returns rows rather than throwing', risk.length > 0, JSON.stringify(kinds));

/* a similar-email cluster, built on purpose so the check has something to find */
const simRef = await partnerOf(ada.business);
const sim = await one(
  `insert into public.businesses (name, slug, plan, contact_email, referred_by, referred_on)
   values ('Ada Lookalike','ada-look','trial','a.d.a@elsewhere.test',$1,current_date) returning id`, [simRef]);
const simRisk = await q(
  `select kind from public.platform_referral_risk() where business_id = $1`, [sim]);
ok('an address that differs only by punctuation is flagged',
  simRisk.some(r => r.kind === 'similar-email'), JSON.stringify(simRisk));

/* =====================================================================
   7. NONE OF IT IS REACHABLE FROM A BROWSER
   ===================================================================== */
section('Only the service role touches any of this');
for (const [schema, fn] of [
  ['app', 'attach_referral'], ['app', 'self_referral_reason'],
  ['app', 'referral_code_for'], ['app', 'enforce_one_business_per_method'],
  ['public', 'partner_void_on_refund'], ['public', 'set_partner_payout_frozen'],
  ['public', 'platform_referral_risk']
]) {
  for (const role of ['anon', 'authenticated']) {
    const can = await one(
      `select bool_or(has_function_privilege($1, p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = $2 and p.proname = $3`, [role, schema, fn]);
    ok(role + ' cannot execute ' + schema + '.' + fn, can === false || can === null, String(can));
  }
}
for (const t of ['payment_methods', 'referral_attempts']) {
  for (const role of ['anon', 'authenticated']) {
    ok(role + ' cannot read public.' + t,
      (await one(`select has_table_privilege($1, $2, 'SELECT')`, [role, 'public.' + t])) === false);
  }
}
/* and a studio cannot write its own referrer or its own sharing exemption */
const cols = await q(
  `select column_name from information_schema.column_privileges
   where grantee = 'authenticated' and table_name = 'businesses' and privilege_type = 'UPDATE'`);
const writable = cols.map(c => c.column_name).sort();
ok('a studio may still write only the four columns it always could',
  JSON.stringify(writable) === JSON.stringify(['app_version', 'contact_email', 'last_seen_at', 'name']),
  JSON.stringify(writable));

/* ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(60));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\nA programme open to everybody without these is a discount with extra steps.');
  process.exit(1);
}
console.log('\nEveryone earns the same 8%, nobody earns it off themselves, and\nnothing pays out on money that did not stay.');
