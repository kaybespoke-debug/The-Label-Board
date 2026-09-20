/* =====================================================================
   Partner commission: one rate, twelve months, per business.

   Rewritten 20 September 2026, one day after the version it replaces.
   That suite asserted a tier ladder, a four year clock and a taper, and
   every one of those checks would have gone on passing against a
   programme we had stopped running. Worth saying plainly, because it is
   the failure mode this file is most exposed to: a test can rot into
   proving the opposite of the truth, and it does it silently.

   Kayode asked for these to be shown rather than described:

     1. a monthly referral pays 8% for 12 months and then stops
     2. a churned business stops that day, and the day before is untouched
     3. a yearly referral pays 8% once, on the year's payment
     4. the partner portal's figures are the console's figures
     5. only the partner earns

   Every one is asserted against a real Postgres running the real
   migrations. A test that reimplements the rules it is testing proves
   only that the same person made the same mistake twice.

   Usage:  node supabase/tests/partner_commission_harness.mjs
   ===================================================================== */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

let pass = 0;
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
/* Numbers compare as numbers. numeric(5,2) comes back as '8.00' and a
   plpgsql literal as '8', and a string compare would fail on the
   difference between those two spellings rather than on the rule. */
function eq(name, got, want) {
  const n = Number(got), m = Number(want);
  const same = (Number.isFinite(n) && Number.isFinite(m)) ? n === m : String(got) === String(want);
  ok(name + '  (' + JSON.stringify(got) + ')', same, 'wanted ' + JSON.stringify(want));
}
/* PGlite hands a `date` back as a JavaScript Date, which stringifies with a
   time and a zone on it. Comparing that against '2027-01-15' fails on the
   formatting rather than on the rule, and the first failure then reads like
   a wrong answer instead of a wrong shape. */
function day(v) {
  if (v == null) return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function section(t) { console.log('\n' + t); }

const db = await PGlite.create();

/* ---------- the schema, from the shipped migrations ---------- */
await db.exec(readFileSync(join(here, 'auth_stub.sql'), 'utf8'));
const migrations = readdirSync(join(repo, 'supabase', 'migrations'))
  .filter(f => f.endsWith('.sql')).sort();
for (const f of migrations) {
  const sql = readFileSync(join(repo, 'supabase', 'migrations', f), 'utf8');
  try { await db.exec(sql); }
  catch (e) {
    /* Some migrations reach for Supabase-only pieces. The partner tables
       and everything this suite touches do not, so a skip here is loud
       rather than silent: it prints, and the assertions below still have
       to pass. */
    console.log('  ..    skipped ' + f + ' (' + String(e.message).split('\n')[0] + ')');
  }
}

async function q(sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows;
}
async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows.length ? Object.values(rows[0])[0] : null;
}

/* ---------- a partner, and n referred businesses ---------- */
let seq = 0;
async function makePartner(code) {
  return await one(
    `insert into public.partners (user_id, code, name, email)
     values (gen_random_uuid(), $1, $2, $3) returning id`,
    [code, 'Partner ' + code, code.toLowerCase() + '@example.test']);
}
/* mrr is what they pay a month; firstPayment is what arrived the first
   time, which for a yearly plan is the whole year. Both are stored on
   the referral because the accrual needs a different one for each cycle
   and neither can be derived from the other without knowing which. */
async function addReferral(partnerId, opts) {
  const { paidOn, mrr = 49000, firstPayment = null, lapsedOn = null, cycle = 'monthly' } = opts;
  seq++;
  const stage = lapsedOn ? 'lapsed' : (paidOn ? 'subscribed' : 'signed-up');
  return await one(
    `insert into public.partner_referrals
       (partner_id, business_name, stage, plan, cycle, mrr, first_payment,
        signed_up_on, subscribed_on, lapsed_on)
     values ($1, $2, $3, 'pro', $4, $5, $6, $7, $8, $9) returning id`,
    [partnerId, 'Business ' + seq, stage, paidOn ? cycle : 'trial', mrr,
     firstPayment == null ? mrr : firstPayment,
     paidOn || '2026-01-01', paidOn, lapsedOn]);
}
const rate = (ref, on) => one('select public.partner_referral_rate($1, $2)', [ref, on]);
const termEnd = ref => one('select public.partner_referral_term_end($1)', [ref]);
const accrue = (month, p) => one('select public.partner_accrue_month($1, $2)', [month, p]);
const ledgerFor = ref => q(
  'select kind, period, amount, rate_pct, basis from public.partner_ledger where referral_id = $1 order by period', [ref]);
const totalFor = ref => one(
  'select coalesce(sum(amount),0) from public.partner_ledger where referral_id = $1', [ref]);

/* Walks a whole year of accrual runs, the way the monthly job will. */
async function runMonths(partner, fromYm, count) {
  let [y, m] = fromYm.split('-').map(Number);
  let wrote = 0;
  for (let i = 0; i < count; i++) {
    wrote += Number(await accrue(
      y + '-' + String(m).padStart(2, '0') + '-01', partner));
    m++; if (m > 12) { m = 1; y++; }
  }
  return wrote;
}

/* =====================================================================
   THE RATE
   ===================================================================== */
section('One rate, and it is eight per cent');
const bands = await q('select min_active, rate_pct, label from public.partner_rate_bands order by min_active');
eq('there is exactly one band', bands.length, 1);
eq('it starts at zero businesses', bands[0] && bands[0].min_active, 0);
eq('and it pays 8%', bands[0] && bands[0].rate_pct, '8.00');

/* The anti-ladder proof. Under the old programme the rate a business
   earned depended on how many OTHER businesses the partner had, and the
   whole point of this change is that it no longer does. */
section('A partner with one business earns the same rate as one with forty');
const small = await makePartner('SMALL');
const large = await makePartner('LARGE');
const smallRef = await addReferral(small, { paidOn: '2026-01-10' });
let largeFirst = null;
for (let i = 0; i < 40; i++) {
  const r = await addReferral(large, { paidOn: '2026-01-10' });
  if (i === 0) largeFirst = r;
}
eq('the one-business partner earns 8%', await rate(smallRef, '2026-03-31'), '8.00');
eq('the forty-business partner earns 8% on each', await rate(largeFirst, '2026-03-31'), '8.00');
ok('and the two are the same number',
  String(await rate(smallRef, '2026-03-31')) === String(await rate(largeFirst, '2026-03-31')));

/* =====================================================================
   1. A MONTHLY REFERRAL PAYS FOR TWELVE MONTHS AND THEN STOPS
   ===================================================================== */
section('A monthly plan earns for twelve months, then it ends');
const pm = await makePartner('MONTHLY');
const monthly = await addReferral(pm, { paidOn: '2026-01-15', mrr: 49000 });

eq('the term ends twelve months after the first payment', day(await termEnd(monthly)), '2027-01-15');
eq('month one earns',        await rate(monthly, '2026-01-31'), '8.00');
eq('month twelve earns',     await rate(monthly, '2026-12-31'), '8.00');
eq('the day before the term is up still earns', await rate(monthly, '2027-01-14'), '8.00');
eq('the day the term is up earns nothing',      await rate(monthly, '2027-01-15'), '0');
eq('and a year later, still nothing',           await rate(monthly, '2028-01-15'), '0');

/* run the job for eighteen months and see where it stops */
const wroteMonthly = await runMonths(pm, '2026-01', 18);
eq('eighteen runs write twelve accruals', wroteMonthly, 12);
const monthlyRows = await ledgerFor(monthly);
eq('twelve rows, no more', monthlyRows.length, 12);
eq('the first is January 2026', day(monthlyRows[0].period), '2026-01-01');
eq('the last is December 2026', day(monthlyRows[11].period), '2026-12-01');
ok('every row is a recurring accrual', monthlyRows.every(r => r.kind === 'recurring'));
ok('every row is 8% of the month they paid',
  monthlyRows.every(r => Number(r.amount) === 49000 * 0.08 && Number(r.basis) === 49000),
  JSON.stringify(monthlyRows[0]));
eq('so twelve months of a 49,000 plan is 47,040', await totalFor(monthly), 12 * 49000 * 0.08);

/* re-running is the thing that will actually happen at eleven at night */
const again = await runMonths(pm, '2026-01', 18);
eq('running the whole year again writes nothing', again, 0);
eq('and the total is unchanged', await totalFor(monthly), 12 * 49000 * 0.08);

/* =====================================================================
   2. A CHURNED BUSINESS STOPS THAT DAY
   ===================================================================== */
section('A business that stops paying stops earning that day');
const pc = await makePartner('CHURN');
const churned = await addReferral(pc, {
  paidOn: '2026-01-15', mrr: 20000, lapsedOn: '2026-04-20'
});

eq('the month before it left earns',     await rate(churned, '2026-03-31'), '8.00');
eq('the day before it left earns',       await rate(churned, '2026-04-19'), '8.00');
eq('the day it left earns nothing',      await rate(churned, '2026-04-20'), '0');
eq('and every day after earns nothing',  await rate(churned, '2026-05-31'), '0');

const wroteChurn = await runMonths(pc, '2026-01', 12);
const churnRows = await ledgerFor(churned);
eq('it accrued for the three whole months it was paying', wroteChurn, 3);
eq('and wrote three rows', churnRows.length, 3);
eq('the last of them is March', day(churnRows[2].period), '2026-03-01');
eq('nothing further is owed', await totalFor(churned), 3 * 20000 * 0.08);

/* April is the interesting one: it left on the 20th, and the accrual
   reads the rate on the LAST day of the month, so April is not a part
   month, it is no month. That is the rule Kayode asked for — "if it
   churns, commission stops that day, nothing further owed" — rather
   than a pro rata, which would mean a partner's statement carrying a
   figure nobody can check against a payment that was never made. */
ok('April, the month it left in, earned nothing at all',
  !churnRows.some(r => day(r.period) === '2026-04-01'),
  JSON.stringify(churnRows.map(r => day(r.period))));

/* =====================================================================
   3. A YEARLY REFERRAL PAYS EIGHT PER CENT ONCE
   ===================================================================== */
section('A yearly plan earns once, on the year that was paid');
const py = await makePartner('YEARLY');
/* 539,000 is eleven months for twelve of a 49,000 plan, which is what
   the website and the console both say a year costs. */
const yearly = await addReferral(py, {
  paidOn: '2026-03-10', cycle: 'annual', mrr: 44917, firstPayment: 539000
});

eq('the term ends the day it started, because there is one payment',
  day(await termEnd(yearly)), '2026-03-10');
eq('the month they paid earns',        await rate(yearly, '2026-03-31'), '8.00');
eq('the month after earns nothing',    await rate(yearly, '2026-04-30'), '0');
eq('and nor does any month before',    await rate(yearly, '2026-02-28'), '0');

const wroteYearly = await runMonths(py, '2026-01', 24);
eq('twenty-four runs write exactly one accrual', wroteYearly, 1);
const yearlyRows = await ledgerFor(yearly);
eq('one row', yearlyRows.length, 1);
eq('and it is marked as the yearly kind', yearlyRows[0].kind, 'yearly');
eq('the basis is the year they paid, not the monthly equivalent',
  yearlyRows[0].basis, '539000.00');
eq('so the commission is 8% of the year', await totalFor(yearly), 539000 * 0.08);

/* The mistake this is guarding against: taking 8% of the MONTHLY
   equivalent once would pay a partner a twelfth of what they are owed,
   and it would look like a rounding problem rather than a missing year. */
ok('which is not 8% of the monthly equivalent',
  Number(await totalFor(yearly)) !== 44917 * 0.08);

/* the database refuses a second yearly row even in a different month */
const dup = await db.query(
  `insert into public.partner_ledger
     (partner_id, referral_id, kind, amount, rate_pct, basis, note, credited_on, clears_on, status, period)
   values ($1, $2, 'yearly', 1, 8, 1, 'a second one', '2027-03-31', '2027-05-01', 'pending', '2027-03-01')`,
  [py, yearly]).then(() => null, e => String(e.message).split('\n')[0]);
ok('and a second yearly credit is refused by the database, not by the job',
  dup !== null, 'it was allowed');

/* =====================================================================
   4. THE PORTAL AND THE CONSOLE READ THE SAME NUMBERS
   ===================================================================== */
section('The portal shows the working, and it is the console\'s working');
const summary = await q('select * from public.partner_commission_summary($1)', [pm]);
eq('one row per referred business', summary.length, 1);
const s = summary[0];
ok('it names the business', /^Business [0-9]+$/.test(String(s.business_name)), String(s.business_name));
eq('it carries the rate',          s.rate_pct, '8.00');
eq('it counts the months credited', s.months_credited, 12);
eq('it says when the clock runs out', day(s.term_ends_on), '2027-01-15');
eq('and the total agrees with the ledger', s.earned_total, await totalFor(monthly));
ok('it says the business is still active', s.is_active === true, String(s.is_active));

const churnSummary = (await q('select * from public.partner_commission_summary($1)', [pc]))[0];
ok('a business that left is not shown as active', churnSummary.is_active === false);
eq('and its total is what it earned before it left', churnSummary.earned_total, 3 * 20000 * 0.08);
eq('a lapsed business still reports its term end', day(churnSummary.term_ends_on), '2027-01-15');

/* Same numbers, two readers. The portal calls my_commission_summary,
   which is the same function with the partner filled in from the
   session, so there is no second sum anywhere to drift. */
const bodyPortal = await one(
  `select pg_get_functiondef(p.oid) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_commission_summary'`);
ok('the portal reads the console\'s function rather than summing again',
  /partner_commission_summary/.test(String(bodyPortal)), String(bodyPortal).slice(0, 200));

/* =====================================================================
   5. ONLY THE PARTNER EARNS
   ===================================================================== */
section('Nothing credits the business that was referred');
const everyLedgerRow = await q(
  'select kind, referral_id, partner_id from public.partner_ledger');
ok('every ledger row belongs to a partner', everyLedgerRow.every(r => !!r.partner_id));
ok('and to the business that earned it', everyLedgerRow.every(r => !!r.referral_id));
ok('there is no reward, credit or discount table for a referred business',
  (await one(`select count(*)::int from information_schema.tables
              where table_schema = 'public'
                and (table_name like '%referral_reward%' or table_name like '%referral_credit%')`)) === 0);

/* =====================================================================
   6. THE PROGRAMME THAT ENDED IS GONE, NOT DORMANT
   ===================================================================== */
section('No tier ladder and no milestone bonus survives');
eq('the milestone table is gone',
  await one(`select count(*)::int from information_schema.tables
             where table_schema = 'public' and table_name = 'partner_milestones'`), 0);
eq('and so is the function that awarded them',
  await one(`select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'partner_award_milestones'`), 0);
eq('there is no second rate band to climb to',
  await one('select count(*)::int from public.partner_rate_bands where min_active > 0'), 0);

/* partner_active_paying survives because the console still wants to know
   how many of a partner's businesses are paying. What it must no longer
   do is decide a rate. */
const rateBody = await one(
  `select pg_get_functiondef(p.oid) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'partner_referral_rate'`);
ok('the rate no longer depends on how many businesses a partner has',
  !/partner_active_paying/.test(String(rateBody)));
ok('and it does depend on the cycle, because that is the rule now',
  /cycle/.test(String(rateBody)));

/* =====================================================================
   7. NONE OF IT RUNS FROM A BROWSER
   =====================================================================
   The grant is tested rather than the call, because a function that
   errors for its own reasons looks exactly like a function that was
   refused. Supabase grants execute on every new function in public to
   anon and authenticated by default and `revoke ... from public` does
   not undo that, which this project has been caught by twice. */
section('Only the service role moves money');
for (const fn of ['partner_accrue_month', 'partner_referral_rate', 'partner_referral_term_end',
                  'partner_commission_summary', 'partner_clear_ledger', 'partner_payout_run']) {
  for (const role of ['anon', 'authenticated']) {
    const can = await one(
      `select bool_or(has_function_privilege($1, p.oid, 'execute'))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $2`, [role, fn]);
    ok(role + ' cannot execute ' + fn, can === false || can === null, String(can));
  }
}
const partnerMay = await one(
  `select bool_or(has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_commission_summary'`);
ok('a signed-in partner may read their own summary', partnerMay === true);
const anonMay = await one(
  `select bool_or(has_function_privilege('anon', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_commission_summary'`);
ok('and an anonymous caller may not', anonMay === false || anonMay === null, String(anonMay));

/* The band table is readable, because the portal prints the rate it is
   paid from, and writable by nobody. */
ok('a signed-in partner may read the rate they are paid at',
  (await one("select has_table_privilege('authenticated', 'public.partner_rate_bands', 'SELECT')")) === true);
ok('and may not change it',
  (await one("select has_table_privilege('authenticated', 'public.partner_rate_bands', 'UPDATE')")) === false);

/* =====================================================================
   8. THE THREE SURFACES QUOTE THE SAME PROGRAMME
   ===================================================================== */
section('The website and the portal quote the database');
const bandPct = Number(bands[0].rate_pct);
const portalSrc = readFileSync(join(repo, 'partners/js/data.js'), 'utf8');
const siteSrc = readFileSync(join(repo, 'web/partners.html'), 'utf8');

const portalRate = Number((portalSrc.match(/const RATE_PCT = (\d+);/) || [])[1]);
const portalTerm = Number((portalSrc.match(/const TERM_MONTHS = (\d+);/) || [])[1]);
eq('the portal carries the database rate', portalRate, bandPct);
eq('and the twelve month term', portalTerm, 12);
ok('the website prints the same rate', new RegExp('\\b' + bandPct + '%').test(siteSrc),
  'no ' + bandPct + '% on web/partners.html');
ok('and says how long a business earns for', /twelve months|12 months/i.test(siteSrc));
ok('the website no longer offers a milestone bonus', !/milestone/i.test(siteSrc));

/* ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(60));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\nA partner can check every one of these against their own bank.');
  process.exit(1);
}
console.log('\nOne rate, twelve months, per business, and it stops the day\nthey do. The portal reads the console\'s figures, not its own.');
