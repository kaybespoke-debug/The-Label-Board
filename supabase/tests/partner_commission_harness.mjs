/* =====================================================================
   Partner commission: the tier ladder, the four year clock, and the
   promise that nothing already credited is ever recomputed.

   Kayode asked for five behaviours to be shown rather than described:

     1. a partner at 4 paying earns 0, and crossing to 5 unlocks 6% on
        ALL of their businesses, not just the fifth
     2. a partner falling from 30 active to 20 accrues the next month at
        7% while the 8% months already written stay exactly as they were
     3. a business reaching year 3 drops to 3%, and reaching year 5 drops
        to 0 and stops for good
     4. a churned business stops earning immediately
     5. every payout period reads the partner's live active count

   Every one of them is asserted against a real Postgres running the real
   migrations, not against a reimplementation of the rules in JavaScript.
   A test that reimplements the thing it is testing proves that two people
   made the same mistake.

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
/* Numbers compare as numbers. numeric(5,2) comes back as '6.00' and a
   plpgsql literal as '3', and a string compare would have failed on the
   difference between those two spellings rather than on the rule. */
function eq(name, got, want) {
  const n = Number(got), m = Number(want);
  const same = (Number.isFinite(n) && Number.isFinite(m)) ? n === m : String(got) === String(want);
  ok(name + '  (' + JSON.stringify(got) + ')', same, 'wanted ' + JSON.stringify(want));
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
  const id = await one(
    `insert into public.partners (user_id, code, name, email)
     values (gen_random_uuid(), $1, $2, $3) returning id`,
    [code, 'Partner ' + code, code.toLowerCase() + '@example.test']);
  return id;
}
async function addReferral(partnerId, { paidOn, mrr = 100000, lapsedOn = null }) {
  seq++;
  const stage = lapsedOn ? 'lapsed' : (paidOn ? 'subscribed' : 'signed-up');
  return await one(
    `insert into public.partner_referrals
       (partner_id, business_name, stage, mrr, signed_up_on, subscribed_on, lapsed_on)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [partnerId, 'Business ' + seq, stage, mrr, paidOn || '2026-01-01', paidOn, lapsedOn]);
}
const rate = (ref, on) => one('select public.partner_referral_rate($1, $2)', [ref, on]);
const active = (p, on) => one('select public.partner_active_paying($1, $2)', [p, on]);
const accrue = (month, p) => one('select public.partner_accrue_month($1, $2)', [month, p]);

/* =====================================================================
   THE LADDER
   ===================================================================== */
section('The ladder is the one Kayode specified');
eq('0 active is 0%',  await one('select public.partner_tier_rate(0)'),  '0.00');
eq('4 active is 0%',  await one('select public.partner_tier_rate(4)'),  '0.00');
eq('5 active is 6%',  await one('select public.partner_tier_rate(5)'),  '6.00');
eq('14 active is 6%', await one('select public.partner_tier_rate(14)'), '6.00');
eq('15 active is 7%', await one('select public.partner_tier_rate(15)'), '7.00');
eq('29 active is 7%', await one('select public.partner_tier_rate(29)'), '7.00');
eq('30 active is 8%', await one('select public.partner_tier_rate(30)'), '8.00');
eq('300 active is still 8%', await one('select public.partner_tier_rate(300)'), '8.00');

/* =====================================================================
   1. FOUR PAYING EARNS NOTHING. THE FIFTH UNLOCKS ALL FIVE.
   ===================================================================== */
section('1. Crossing to five unlocks every business, not only the fifth');
const p1 = await makePartner('UNLOCK');
const firstFour = [];
for (let i = 0; i < 4; i++) firstFour.push(await addReferral(p1, { paidOn: '2026-01-10' }));

eq('four are counted as active', await active(p1, '2026-02-28'), 4);
eq('the first business earns nothing at four', await rate(firstFour[0], '2026-02-28'), '0');
eq('nothing accrues for the whole partner at four', await accrue('2026-02-01', p1), 0);
eq('and the ledger is empty',
   await one('select count(*) from public.partner_ledger where partner_id = $1', [p1]), '0');

const fifth = await addReferral(p1, { paidOn: '2026-03-05' });
eq('five are counted as active', await active(p1, '2026-03-31'), 5);
eq('the FIRST business now earns 6, not just the fifth', await rate(firstFour[0], '2026-03-31'), '6.00');
eq('and so does the fifth', await rate(fifth, '2026-03-31'), '6.00');
eq('March accrues five rows', await accrue('2026-03-01', p1), 5);
eq('every March row is at 6%',
   await one(`select count(*) from public.partner_ledger
              where partner_id = $1 and period = '2026-03-01' and rate_pct = 6`, [p1]), '5');
eq('and February is still empty, it was not back-filled',
   await one(`select count(*) from public.partner_ledger
              where partner_id = $1 and period = '2026-02-01'`, [p1]), '0');

section('   the monthly job is safe to run twice');
eq('a second run of March writes nothing', await accrue('2026-03-01', p1), 0);
eq('and March still has exactly five rows',
   await one(`select count(*) from public.partner_ledger
              where partner_id = $1 and period = '2026-03-01'`, [p1]), '5');

/* =====================================================================
   2. FALLING FROM 30 TO 20: FORWARD ONLY, NO CLAWBACK
   ===================================================================== */
section('2. Falling from 30 active to 20 changes the next month and nothing else');
const p2 = await makePartner('DROP');
const thirty = [];
for (let i = 0; i < 30; i++) thirty.push(await addReferral(p2, { paidOn: '2026-01-10' }));

eq('thirty active', await active(p2, '2026-04-30'), 30);
eq('the rate is 8', await rate(thirty[0], '2026-04-30'), '8.00');
eq('April accrues thirty rows', await accrue('2026-04-01', p2), 30);
const aprilTotal = await one(
  `select coalesce(sum(amount),0) from public.partner_ledger
   where partner_id = $1 and period = '2026-04-01'`, [p2]);
eq('April is 30 x 100000 x 8%', aprilTotal, '240000.00');

/* ten of them churn on 1 May */
for (let i = 0; i < 10; i++) {
  await db.query(
    `update public.partner_referrals set stage = 'lapsed', lapsed_on = '2026-05-01' where id = $1`,
    [thirty[i]]);
}
eq('twenty active in May', await active(p2, '2026-05-31'), 20);
eq('a survivor now rates 7, not 8', await rate(thirty[29], '2026-05-31'), '7.00');
eq('May accrues twenty rows', await accrue('2026-05-01', p2), 20);
eq('May is 20 x 100000 x 7%',
   await one(`select coalesce(sum(amount),0) from public.partner_ledger
              where partner_id = $1 and period = '2026-05-01'`, [p2]), '140000.00');

section('   and April was not touched');
eq('April total is the same number it was', await one(
  `select coalesce(sum(amount),0) from public.partner_ledger
   where partner_id = $1 and period = '2026-04-01'`, [p2]), aprilTotal);
eq('every April row still says 8%', await one(
  `select count(*) from public.partner_ledger
   where partner_id = $1 and period = '2026-04-01' and rate_pct = 8`, [p2]), '30');
eq('no April row was voided or adjusted', await one(
  `select count(*) from public.partner_ledger
   where partner_id = $1 and period = '2026-04-01' and status <> 'pending'`, [p2]), '0');

section('   climbing back lifts it again, also forward only');
for (let i = 0; i < 10; i++) {
  await db.query(
    `update public.partner_referrals set stage = 'subscribed', lapsed_on = null where id = $1`,
    [thirty[i]]);
}
eq('thirty active again in June', await active(p2, '2026-06-30'), 30);
eq('June rates 8 again', await rate(thirty[29], '2026-06-30'), '8.00');
await accrue('2026-06-01', p2);
eq('June is at 8%', await one(
  `select count(*) from public.partner_ledger
   where partner_id = $1 and period = '2026-06-01' and rate_pct = 8`, [p2]), '30');
eq('May is STILL at 7%, the climb did not reach back', await one(
  `select count(*) from public.partner_ledger
   where partner_id = $1 and period = '2026-05-01' and rate_pct = 7`, [p2]), '20');

/* =====================================================================
   3. THE FOUR YEAR CLOCK
   ===================================================================== */
section('3. Year three tapers to 3, year five stops for good');
const p3 = await makePartner('CLOCK');
/* five paying so the tier is unlocked, all starting the same day */
const clock = [];
for (let i = 0; i < 5; i++) clock.push(await addReferral(p3, { paidOn: '2026-01-01' }));
const c = clock[0];

eq('day one is the tier rate',            await rate(c, '2026-01-01'), '6.00');
eq('one day before two years, tier rate', await rate(c, '2027-12-31'), '6.00');
eq('the day it turns two, 3%',            await rate(c, '2028-01-01'), '3.00');
eq('three and a half years, still 3%',    await rate(c, '2029-07-01'), '3.00');
eq('one day before four years, 3%',       await rate(c, '2029-12-31'), '3.00');
eq('the day it turns four, nothing',      await rate(c, '2030-01-01'), '0');
eq('and ten years on, still nothing',     await rate(c, '2036-01-01'), '0');

section('   the clock is per business and the tier does not move it');
/* thirty more, so the partner is at the top band, and the old one is
   still in its taper years */
for (let i = 0; i < 30; i++) await addReferral(p3, { paidOn: '2029-01-01' });
eq('the partner is at 35 active', await active(p3, '2029-07-01'), 35);
eq('the top band is 8%', await one('select public.partner_tier_rate(35)'), '8.00');
eq('the OLD business is still on its taper, not lifted to 8', await rate(c, '2029-07-01'), '3.00');
eq('a business past four years is not revived by the top band', await rate(c, '2030-06-01'), '0');

section('   an accrual run reflects the clock');
const wrote = await accrue('2030-06-01', p3);
eq('the expired ones are skipped, the newer ones accrue', wrote, 30);
eq('nothing was written for the expired business', await one(
  `select count(*) from public.partner_ledger
   where referral_id = $1 and period = '2030-06-01'`, [c]), '0');

/* =====================================================================
   4. CHURN STOPS IT THAT DAY
   ===================================================================== */
section('4. A churned business stops earning immediately');
const p4 = await makePartner('CHURN');
const ch = [];
for (let i = 0; i < 6; i++) ch.push(await addReferral(p4, { paidOn: '2026-01-10' }));
eq('six active, so 6%', await rate(ch[0], '2026-06-30'), '6.00');

await db.query(
  `update public.partner_referrals set stage = 'lapsed', lapsed_on = '2026-07-01' where id = $1`,
  [ch[0]]);
eq('the day it lapses it earns nothing', await rate(ch[0], '2026-07-01'), '0');
eq('and a month later, nothing',         await rate(ch[0], '2026-08-31'), '0');
eq('the day BEFORE it lapsed is untouched', await rate(ch[0], '2026-06-30'), '6.00');
eq('July accrues five, not six', await accrue('2026-07-01', p4), 5);
eq('the churned one has no July row', await one(
  `select count(*) from public.partner_ledger
   where referral_id = $1 and period = '2026-07-01'`, [ch[0]]), '0');

section('   and the churn drops the whole partner back under the threshold');
for (let i = 1; i < 3; i++) {
  await db.query(
    `update public.partner_referrals set stage = 'lapsed', lapsed_on = '2026-08-01' where id = $1`,
    [ch[i]]);
}
eq('three active is below five', await active(p4, '2026-08-31'), 3);
eq('so the survivors earn nothing either', await rate(ch[5], '2026-08-31'), '0');
eq('August accrues nothing at all', await accrue('2026-08-01', p4), 0);
eq('but July is still five rows at 6%', await one(
  `select count(*) from public.partner_ledger
   where partner_id = $1 and period = '2026-07-01' and rate_pct = 6`, [p4]), '5');

/* =====================================================================
   5. EVERY PERIOD READS THE LIVE COUNT
   ===================================================================== */
section('5. Each period is worked out from the count at the time');
const p5 = await makePartner('LIVE');
const grow = [];
for (let i = 0; i < 5; i++) grow.push(await addReferral(p5, { paidOn: '2026-01-05' }));
await accrue('2026-02-01', p5);
for (let i = 0; i < 10; i++) grow.push(await addReferral(p5, { paidOn: '2026-03-05' }));
await accrue('2026-03-01', p5);
for (let i = 0; i < 15; i++) grow.push(await addReferral(p5, { paidOn: '2026-04-05' }));
await accrue('2026-04-01', p5);

eq('February was worked out at 6%', await one(
  `select distinct rate_pct from public.partner_ledger
   where partner_id = $1 and period = '2026-02-01'`, [p5]), '6.00');
eq('March at 7%, because fifteen were active by then', await one(
  `select distinct rate_pct from public.partner_ledger
   where partner_id = $1 and period = '2026-03-01'`, [p5]), '7.00');
eq('April at 8%', await one(
  `select distinct rate_pct from public.partner_ledger
   where partner_id = $1 and period = '2026-04-01'`, [p5]), '8.00');
eq('three different rates are on the books at once', await one(
  `select count(distinct rate_pct) from public.partner_ledger where partner_id = $1`, [p5]), '3');

/* =====================================================================
   THE LEDGER IS A RECORD, NOT A FORMULA
   ===================================================================== */
section('The ledger stores what was decided, not how to decide it again');
eq('every recurring row carries the rate it was worked out at', await one(
  `select count(*) from public.partner_ledger where kind = 'recurring' and rate_pct is null`), '0');
eq('and the sum it applied to', await one(
  `select count(*) from public.partner_ledger where kind = 'recurring' and basis = 0`), '0');
eq('and the amount is the two of them multiplied', await one(
  `select count(*) from public.partner_ledger
   where kind = 'recurring' and amount <> round(basis * rate_pct / 100, 2)`), '0');
eq('no recurring row is missing its period', await one(
  `select count(*) from public.partner_ledger where kind = 'recurring' and period is null`), '0');

section('The database refuses a second accrual for the same month');
const dup = await db.query(
  `select id, partner_id, referral_id, period from public.partner_ledger
   where kind = 'recurring' limit 1`);
const row = dup.rows[0];
let refused = false;
try {
  await db.query(
    `insert into public.partner_ledger
       (partner_id, referral_id, kind, amount, rate_pct, basis, credited_on, clears_on, period)
     values ($1, $2, 'recurring', 1, 1, 1, current_date, current_date, $3)`,
    [row.partner_id, row.referral_id, row.period]);
} catch (e) { refused = true; }
ok('a duplicate month is refused by the index, not by the job', refused);

section('A period on the wrong kind, or not a first of month, is refused');
let badShape = false;
try {
  await db.query(
    `insert into public.partner_ledger
       (partner_id, referral_id, kind, amount, rate_pct, basis, credited_on, clears_on, period)
     values ($1, $2, 'recurring', 1, 1, 1, current_date, current_date, '2026-03-17')`,
    [row.partner_id, null, ]);
} catch (e) { badShape = true; }
ok('a mid-month period is refused', badShape);

let bonusWithPeriod = false;
try {
  await db.query(
    `insert into public.partner_ledger
       (partner_id, kind, amount, rate_pct, basis, credited_on, clears_on, period)
     values ($1, 'bonus', 1, 0, 0, current_date, current_date, '2026-03-01')`,
    [row.partner_id]);
} catch (e) { bonusWithPeriod = true; }
ok('a bonus carrying a period is refused', bonusWithPeriod);

section('A lapsed referral cannot exist without the day it lapsed');
/* The whole engine reads dates rather than the stage column, so that a
   question about April still gets April's answer after a May churn. That is
   only sound if a lapsed row is required to carry its date. Without this a
   row marked lapsed with no date would accrue for ever. */
let needsDate = false;
try {
  await db.query(
    `insert into public.partner_referrals
       (partner_id, business_name, stage, mrr, signed_up_on, subscribed_on)
     values ($1, 'No date', 'lapsed', 50000, '2026-01-01', '2026-01-01')`,
    [p4]);
} catch (e) { needsDate = true; }
ok('a lapsed referral with no lapsed_on is refused', needsDate);

/* =====================================================================
   NOBODY BUT US RUNS THE ENGINE
   Testing the GRANT, not the call: a function that throws for its own
   reasons looks exactly like one that was refused.
   ===================================================================== */
section('The rules cannot be run from a browser');
for (const fn of ['partner_accrue_month', 'partner_referral_rate', 'partner_active_paying']) {
  for (const who of ['anon', 'authenticated']) {
    const granted = await one(
      `select count(*) from information_schema.role_routine_grants
       where routine_schema = 'public' and routine_name = $1 and grantee = $2`, [fn, who]);
    eq(fn + ' is not executable by ' + who, granted, '0');
  }
}
eq('the rate ladder itself is readable by a signed-in partner', await one(
  `select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'partner_rate_bands'
     and grantee = 'authenticated' and privilege_type = 'SELECT'`), '1');
for (const priv of ['INSERT', 'UPDATE', 'DELETE']) {
  eq('a partner cannot ' + priv + ' the rate ladder', await one(
    `select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'partner_rate_bands'
       and grantee = 'authenticated' and privilege_type = $1`, [priv]), '0');
}

/* ---------- result ---------- */
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' failed');
  failures.forEach(f => console.log('  FAIL  ' + f));
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('='.repeat(60));
