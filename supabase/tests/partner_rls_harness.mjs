/* =====================================================================
   Adversarial test of the partner portal policies.

   Same method as rls_harness.mjs, aimed at a different boundary. A tenant
   leak exposes another studio's orders. A partner leak exposes money:
   what someone earned, and the bank account it was paid into. So this
   suite attacks from two positions, not one:

     - a signed-in partner reaching for ANOTHER partner's rows
     - a signed-in partner reaching for their OWN rows with a pen

   The second is the one that is easy to get wrong. Being able to read
   your own ledger is obviously fine. Being able to UPDATE it means you
   can pay yourself. Most of the checks below are about that.

   A separate file from rls_harness.mjs on purpose: that suite covers the
   tenant boundary and is edited independently, and two people appending
   to one harness is how you get merge conflicts in a security test.

   Usage:  node supabase/tests/partner_rls_harness.mjs
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
function section(title) { console.log('\n' + title); }

const db = await PGlite.create();

/* Run a statement as a signed-in user, exactly as the API layer would. */
async function asUser(userId, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await db.exec('set local role authenticated');
    const res = await db.query(sql, params);
    await db.exec('commit');
    return { rows: res.rows, error: null };
  } catch (e) {
    try { await db.exec('rollback'); } catch {}
    return { rows: [], error: e.message };
  }
}
async function asAnon(sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ role: 'anon' })]);
    await db.exec('set local role anon');
    const res = await db.query(sql, params);
    await db.exec('commit');
    return { rows: res.rows, error: null };
  } catch (e) {
    try { await db.exec('rollback'); } catch {}
    return { rows: [], error: e.message };
  }
}
/* The service role: what the billing path and the admin gateway use. */
async function asAdmin(sql, params = []) {
  const res = await db.query(sql, params);
  return res.rows;
}

process.on('uncaughtException', e => {
  console.error('\nUNEXPECTED ERROR in the harness itself: ' + e.message);
  if (e.detail) console.error('  detail: ' + e.detail);
  process.exit(2);
});
process.on('unhandledRejection', e => {
  console.error('\nUNEXPECTED ERROR in the harness itself: ' + (e?.message || e));
  if (e?.detail) console.error('  detail: ' + e.detail);
  process.exit(2);
});

// =====================================================================
console.log('Applying auth stub and every migration');
// =====================================================================
async function applyFile(label, path) {
  try {
    await db.exec(readFileSync(path, 'utf8'));
    console.log('  ' + label + ': applied cleanly');
  } catch (e) {
    console.error('  ' + label + ': FAILED — ' + e.message);
    if (e.hint) console.error('    hint: ' + e.hint);
    process.exit(1);
  }
}
await applyFile('auth stub', join(here, 'auth_stub.sql'));
const migDir = join(repo, 'supabase', 'migrations');
for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
  await applyFile(f, join(migDir, f));
}

// =====================================================================
// Fixtures: two unrelated partners, one suspended, one outsider.
// =====================================================================
const U = {
  a:         'a0000000-0000-0000-0000-000000000001',
  b:         'b0000000-0000-0000-0000-000000000001',
  suspended: '50000000-0000-0000-0000-000000000001',
  outsider:  '90000000-0000-0000-0000-000000000001'
};
const ids = {};

async function seed() {
  const mk = async (userId, code, name, status = 'active') => (await asAdmin(
    `insert into partners(user_id, code, name, business_name, email, tier, status)
     values ($1,$2,$3,$4,$5,'gold',$6) returning id`,
    [userId, code, name, name + ' Ltd', name.toLowerCase() + '@example.com', status]))[0].id;

  ids.a = await mk(U.a, 'AMAKA', 'Amaka');
  ids.b = await mk(U.b, 'TOMI', 'Tomi');
  ids.susp = await mk(U.suspended, 'SUSP', 'Suspended', 'suspended');

  const link = async (partner, code, label, isDefault) => (await asAdmin(
    `insert into partner_links(partner_id, code, label, is_default, clicks)
     values ($1,$2,$3,$4,100) returning id`, [partner, code, label, isDefault]))[0].id;

  ids.aLink = await link(ids.a, 'AMAKA-IG', 'Instagram', true);
  ids.bLink = await link(ids.b, 'TOMI-WA', 'WhatsApp', true);

  const referral = async (partner, linkId, name) => (await asAdmin(
    `insert into partner_referrals(partner_id, link_id, business_name, stage, plan, cycle,
       mrr, first_payment, signed_up_on, subscribed_on)
     values ($1,$2,$3,'subscribed','pro','monthly',49000,49000,
             current_date - 60, current_date - 45) returning id`,
    [partner, linkId, name]))[0].id;

  ids.aRef = await referral(ids.a, ids.aLink, 'Stella Couture');
  ids.bRef = await referral(ids.b, ids.bLink, 'Regal Threads');

  const payout = async (partner, ref) => (await asAdmin(
    `insert into partner_payouts(partner_id, ref, paid_on, amount, account_name, bank_name, account_number)
     values ($1,$2,current_date - 10, 10780, 'Someone', 'GTB', '0148820371') returning id`,
    [partner, ref]))[0].id;

  ids.aPayout = await payout(ids.a, 'PO-2026-08');
  ids.bPayout = await payout(ids.b, 'PO-2026-08');

  const ledger = async (partner, refId, payoutId, status) => (await asAdmin(
    `insert into partner_ledger(partner_id, referral_id, payout_id, kind, amount, rate_pct,
       tier, basis, credited_on, clears_on, status)
     values ($1,$2,$3,'signup',10780,22,'gold',49000,
             current_date - 45, current_date - 14, $4) returning id`,
    [partner, refId, payoutId, status]))[0].id;

  ids.aLedger = await ledger(ids.a, ids.aRef, ids.aPayout, 'paid');
  ids.bLedger = await ledger(ids.b, ids.bRef, ids.bPayout, 'paid');

  const account = async (partner, num, verified) => (await asAdmin(
    `insert into partner_accounts(partner_id, account_name, bank_name, account_number,
       is_primary, verified, verified_on)
     values ($1,'Account Holder','Guaranty Trust Bank',$2,true,$3,
             case when $3 then current_date else null end) returning id`,
    [partner, num, verified]))[0].id;

  ids.aAcct = await account(ids.a, '0148820371', true);
  ids.bAcct = await account(ids.b, '2009114466', true);
}
await seed();
console.log('  fixtures: two partners, one suspended, one outsider');

// =====================================================================
section('1. A partner sees their own rows, and only their own');
// =====================================================================
{
  const TABLES = ['partners', 'partner_links', 'partner_referrals',
    'partner_ledger', 'partner_payouts', 'partner_accounts'];

  for (const t of TABLES) {
    const mine = await asUser(U.a, `select count(*)::int n from ${t}`);
    ok(`${t}: partner A sees exactly their own row`, mine.rows[0]?.n === 1,
      'got ' + mine.rows[0]?.n);
  }

  // Named directly, which is the attack a filter-in-the-client design loses to.
  const byId = await asUser(U.a, 'select count(*)::int n from partner_ledger where id = $1', [ids.bLedger]);
  ok('naming another partner\'s ledger row by id returns nothing',
    byId.rows[0]?.n === 0, 'got ' + byId.rows[0]?.n);

  const acct = await asUser(U.a,
    'select account_number from partner_accounts where partner_id = $1', [ids.b]);
  ok('another partner\'s bank account is unreachable', acct.rows.length === 0);

  const earn = await asUser(U.a,
    'select coalesce(sum(amount),0)::float t from partner_ledger where partner_id = $1', [ids.b]);
  ok('and so is what they earned', (earn.rows[0]?.t ?? 0) === 0, 'got ' + earn.rows[0]?.t);

  // A blocked read is empty, not an error. An error confirms the row exists.
  ok('a blocked read returns zero rows rather than an error', byId.error === null,
    String(byId.error));
}

// =====================================================================
section('2. Money is read-only from a browser');
// =====================================================================
{
  const pay = await asUser(U.a,
    `insert into partner_ledger(partner_id, kind, amount, credited_on, clears_on, status)
     values ($1,'bonus',5000000,current_date,current_date,'cleared')`, [ids.a]);
  ok('a partner cannot write themselves a bonus', pay.error !== null,
    'the insert succeeded');

  const bump = await asAdmin('select amount from partner_ledger where id = $1', [ids.aLedger]);
  await asUser(U.a, 'update partner_ledger set amount = 999999 where id = $1', [ids.aLedger]);
  const after = await asAdmin('select amount from partner_ledger where id = $1', [ids.aLedger]);
  ok('a partner cannot raise the value of their own commission',
    String(after[0].amount) === String(bump[0].amount),
    bump[0].amount + ' became ' + after[0].amount);

  await asUser(U.a, "update partner_ledger set status = 'cleared' where id = $1", [ids.aLedger]);
  const st = await asAdmin('select status from partner_ledger where id = $1', [ids.aLedger]);
  ok('nor mark a held commission as ready to pay', st[0].status === 'paid',
    'became ' + st[0].status);

  await asUser(U.a, 'delete from partner_ledger where id = $1', [ids.aLedger]);
  const still = await asAdmin('select count(*)::int n from partner_ledger where id = $1', [ids.aLedger]);
  ok('nor delete a row they would rather we forgot', still[0].n === 1);

  const inv = await asUser(U.a,
    `insert into partner_referrals(partner_id, business_name, stage, signed_up_on)
     values ($1,'Invented Studio','subscribed',current_date)`, [ids.a]);
  ok('a partner cannot invent a referral', inv.error !== null, 'the insert succeeded');

  await asUser(U.a, "update partner_referrals set stage = 'subscribed', first_payment = 790000 where id = $1", [ids.aRef]);
  const ref = await asAdmin('select first_payment from partner_referrals where id = $1', [ids.aRef]);
  ok('nor promote one to a bigger first payment', String(ref[0].first_payment) === '49000.00',
    'became ' + ref[0].first_payment);

  const po = await asUser(U.a,
    `insert into partner_payouts(partner_id, ref, paid_on, amount)
     values ($1,'PO-FAKE',current_date,500000)`, [ids.a]);
  ok('a partner cannot record a payout that never happened', po.error !== null,
    'the insert succeeded');
}

// =====================================================================
section('3. Your own row is not yours to rewrite');
// =====================================================================
{
  await asUser(U.a, "update partners set tier = 'platinum' where user_id = $1", [U.a]);
  const tier = await asAdmin('select tier from partners where id = $1', [ids.a]);
  ok('a partner cannot promote themselves to a better rate', tier[0].tier === 'gold',
    'became ' + tier[0].tier);

  await asUser(U.a, "update partners set code = 'BETTERCODE' where user_id = $1", [U.a]);
  const code = await asAdmin('select code from partners where id = $1', [ids.a]);
  ok('nor change the code their attribution runs on', code[0].code === 'AMAKA',
    'became ' + code[0].code);

  await asUser(U.a, "update partners set status = 'active' where id = $1", [ids.susp]);
  const susp = await asAdmin('select status from partners where id = $1', [ids.susp]);
  ok('nor lift a suspension, their own or anyone else\'s', susp[0].status === 'suspended');

  await asUser(U.a, 'update partners set user_id = $1 where id = $2', [U.outsider, ids.a]);
  const owner = await asAdmin('select user_id from partners where id = $1', [ids.a]);
  ok('nor hand their partner record to another login', owner[0].user_id === U.a);

  // What they may change, they may change.
  const upd = await asUser(U.a, "update partners set phone = '+234 800 000 0000' where user_id = $1", [U.a]);
  const phone = await asAdmin('select phone from partners where id = $1', [ids.a]);
  ok('but they can still update their own phone number',
    upd.error === null && phone[0].phone === '+234 800 000 0000', String(upd.error));

  const mint = await asUser(U.outsider,
    `insert into partners(user_id, code, name, email) values ($1,'NEWCODE','Nobody','n@example.com')`,
    [U.outsider]);
  ok('a stranger cannot mint themselves a partner account', mint.error !== null,
    'the insert succeeded');
}

// =====================================================================
section('4. The numbers a partner is judged on');
// =====================================================================
{
  await asUser(U.a, 'update partner_links set clicks = 99999 where id = $1', [ids.aLink]);
  const clicks = await asAdmin('select clicks from partner_links where id = $1', [ids.aLink]);
  ok('a partner cannot inflate their own click count', clicks[0].clicks === 100,
    'became ' + clicks[0].clicks);

  const rename = await asUser(U.a, "update partner_links set label = 'Renamed' where id = $1", [ids.aLink]);
  ok('but renaming a link still works', rename.error === null, String(rename.error));

  const steal = await asUser(U.a,
    `insert into partner_links(partner_id, code, label) values ($1,'STOLEN','Theirs')`, [ids.b]);
  ok('a partner cannot create a link under another partner\'s id', steal.error !== null,
    'the insert succeeded');

  const mine = await asUser(U.a,
    `insert into partner_links(partner_id, code, label) values ($1,'AMAKA-TT','TikTok')`, [ids.a]);
  ok('but they can create one of their own', mine.error === null, String(mine.error));

  const dupe = await asUser(U.a,
    `insert into partner_links(partner_id, code, label) values ($1,'TOMI-WA','Copy')`, [ids.a]);
  ok('a code already in use cannot be taken from another partner', dupe.error !== null,
    'the insert succeeded');

  await asUser(U.a, 'delete from partner_links where id = $1', [ids.aLink]);
  const dflt = await asAdmin('select count(*)::int n from partner_links where id = $1', [ids.aLink]);
  ok('the default link cannot be deleted', dflt[0].n === 1);

  const two = await asAdmin(
    `insert into partner_links(partner_id, code, label, is_default) values ($1,'AMAKA-X','X',true)`,
    [ids.a]).then(() => null).catch(e => e.message);
  ok('a partner cannot end up with two default links', two !== null, 'a second default was allowed');
}

// =====================================================================
section('5. Payout accounts: the tick is not the partner\'s to give');
// =====================================================================
{
  const selfVerify = await asUser(U.a,
    `insert into partner_accounts(partner_id, account_name, bank_name, account_number, verified)
     values ($1,'Me','Access Bank','1111111111',true)`, [ids.a]);
  ok('an account cannot be added pre-verified', selfVerify.error !== null,
    'the insert succeeded');

  const added = await asUser(U.a,
    `insert into partner_accounts(partner_id, account_name, bank_name, account_number)
     values ($1,'Me','Access Bank','1111111111')`, [ids.a]);
  ok('but an unverified one can be added', added.error === null, String(added.error));

  await asUser(U.a, 'update partner_accounts set verified = true where partner_id = $1', [ids.a]);
  const v = await asAdmin(
    "select count(*)::int n from partner_accounts where partner_id = $1 and account_number = '1111111111' and verified",
    [ids.a]);
  ok('and a partner cannot then tick it themselves', v[0].n === 0);

  // The real attack: get verified on your own name, then swap the number.
  await asUser(U.a, "update partner_accounts set account_number = '7777777777' where id = $1", [ids.aAcct]);
  const swapped = await asAdmin('select account_number, verified from partner_accounts where id = $1', [ids.aAcct]);
  ok('changing the number on a verified account clears the tick',
    swapped[0].account_number === '7777777777' && swapped[0].verified === false,
    JSON.stringify(swapped[0]));

  const theirs = await asUser(U.a,
    "update partner_accounts set account_number = '0000000000' where id = $1", [ids.bAcct]);
  const untouched = await asAdmin('select account_number from partner_accounts where id = $1', [ids.bAcct]);
  ok('another partner\'s account cannot be edited',
    untouched[0].account_number === '2009114466', String(theirs.error));

  const bad = await asUser(U.a,
    `insert into partner_accounts(partner_id, account_name, bank_name, account_number)
     values ($1,'Me','Access Bank','12345')`, [ids.a]);
  ok('a malformed account number is refused by the database, not just the form',
    bad.error !== null, 'the insert succeeded');
}

// =====================================================================
section('6. Rows that cross partners cannot be built at all');
// =====================================================================
{
  const cross = await asAdmin(
    `insert into partner_ledger(partner_id, referral_id, kind, amount, credited_on, clears_on)
     values ($1,$2,'signup',1000,current_date,current_date)`, [ids.a, ids.bRef])
    .then(() => null).catch(e => e.message);
  ok('even the service role cannot attach one partner\'s ledger to another\'s referral',
    cross !== null, 'it was allowed');

  const crossLink = await asAdmin(
    `insert into partner_referrals(partner_id, link_id, business_name, signed_up_on)
     values ($1,$2,'Cross','2026-01-01')`, [ids.a, ids.bLink])
    .then(() => null).catch(e => e.message);
  ok('nor a referral to a link that belongs to someone else', crossLink !== null, 'it was allowed');

  const crossPayout = await asAdmin(
    `insert into partner_ledger(partner_id, payout_id, kind, amount, credited_on, clears_on, status)
     values ($1,$2,'signup',1000,current_date,current_date,'paid')`, [ids.a, ids.bPayout])
    .then(() => null).catch(e => e.message);
  ok('nor a commission onto another partner\'s payout', crossPayout !== null, 'it was allowed');
}

// =====================================================================
section('7. The shape of the data is enforced, not just hoped for');
// =====================================================================
{
  const backwards = await asAdmin(
    `insert into partner_referrals(partner_id, business_name, stage, signed_up_on, subscribed_on)
     values ($1,'Backwards','subscribed','2026-06-01','2026-05-01')`, [ids.a])
    .then(() => null).catch(e => e.message);
  ok('an account cannot start paying before it signed up', backwards !== null, 'it was allowed');

  const future = await asAdmin(
    `insert into partner_referrals(partner_id, business_name, stage, signed_up_on, subscribed_on, lapsed_on)
     values ($1,'Future','lapsed','2026-01-01','2026-02-01','2026-01-15')`, [ids.a])
    .then(() => null).catch(e => e.message);
  ok('nor stop paying before it started', future !== null, 'it was allowed');

  const unpaid = await asAdmin(
    `insert into partner_referrals(partner_id, business_name, stage, signed_up_on, first_payment)
     values ($1,'Never Paid','trial','2026-01-01',49000)`, [ids.a])
    .then(() => null).catch(e => e.message);
  ok('an account that never converted cannot carry a first payment', unpaid !== null, 'it was allowed');

  const orphanPaid = await asAdmin(
    `insert into partner_ledger(partner_id, kind, amount, credited_on, clears_on, status)
     values ($1,'signup',1000,current_date,current_date,'paid')`, [ids.a])
    .then(() => null).catch(e => e.message);
  ok('a commission marked paid must name the payout that paid it', orphanPaid !== null, 'it was allowed');

  const clearsFirst = await asAdmin(
    `insert into partner_ledger(partner_id, kind, amount, credited_on, clears_on)
     values ($1,'signup',1000,current_date,current_date - 5)`, [ids.a])
    .then(() => null).catch(e => e.message);
  ok('a commission cannot clear before it was credited', clearsFirst !== null, 'it was allowed');

  const twoRows = await asAdmin(
    `insert into partners(user_id, code, name, email) values ($1,'SECOND','Second','s@example.com')`,
    [U.a]).then(() => null).catch(e => e.message);
  ok('one login cannot own two partner accounts', twoRows !== null, 'it was allowed');
}

// =====================================================================
section('8. Suspended, anonymous, and unknown callers');
// =====================================================================
{
  // Their own row stays readable on purpose, so the portal can say why they
  // are locked out. Nothing else is.
  const susp = await asUser(U.suspended, "select status from partners");
  ok('a suspended partner sees only their own row, and its status',
    susp.rows.length === 1 && susp.rows[0].status === 'suspended',
    JSON.stringify(susp.rows));
  const suspEdit = await asUser(U.suspended, "update partners set phone = '000' where user_id = $1", [U.suspended]);
  const suspPhone = await asAdmin('select phone from partners where id = $1', [ids.susp]);
  ok('  and cannot edit even that', suspPhone[0].phone === null, String(suspEdit.error));

  const suspLedger = await asUser(U.suspended, 'select count(*)::int n from partner_ledger');
  ok('  and nothing of what they used to earn', suspLedger.rows[0]?.n === 0);

  const out = await asUser(U.outsider, 'select count(*)::int n from partner_ledger');
  ok('a signed-in user who is not a partner sees nothing', out.rows[0]?.n === 0,
    'got ' + out.rows[0]?.n);

  for (const t of ['partners', 'partner_links', 'partner_referrals',
    'partner_ledger', 'partner_payouts', 'partner_accounts']) {
    const anon = await asAnon(`select count(*)::int n from ${t}`);
    ok(`${t}: anonymous callers get nothing`,
      anon.error !== null || (anon.rows[0]?.n ?? 0) === 0, 'got ' + anon.rows[0]?.n);
  }

  const grants = await asAdmin(
    "select table_name, privilege_type from information_schema.role_table_grants " +
    "where grantee = 'anon' and table_schema = 'public' and table_name like 'partner%'");
  ok('the anon role holds no grant on any partner table', grants.length === 0,
    grants.map(g => g.table_name + ':' + g.privilege_type).join(', '));
}

// =====================================================================
section('9. The join page, which has no session at all');
// =====================================================================
{
  const before = (await asAdmin('select clicks from partner_links where code = $1', ['TOMI-WA']))[0].clicks;
  const claim = await asAnon('select app.claim_referral_code($1) as p', ['TOMI-WA']);
  ok('an anonymous visitor can resolve a code to its partner',
    claim.rows[0]?.p === ids.b, String(claim.error) + ' got ' + claim.rows[0]?.p);

  const after = (await asAdmin('select clicks from partner_links where code = $1', ['TOMI-WA']))[0].clicks;
  ok('and following the link counts the click, server side', after === before + 1,
    before + ' -> ' + after);

  const dflt = await asAnon('select app.claim_referral_code($1) as p', ['AMAKA']);
  ok('a partner\'s own default code resolves too', dflt.rows[0]?.p === ids.a);

  const unknown = await asAnon('select app.claim_referral_code($1) as p', ['NOSUCHCODE']);
  ok('an unknown code resolves to nothing rather than erroring',
    unknown.error === null && unknown.rows[0]?.p === null, String(unknown.error));

  const junk = await asAnon('select app.claim_referral_code($1) as p', ["'; drop table partners; --"]);
  ok('a malformed code is rejected before it reaches a query',
    junk.error === null && junk.rows[0]?.p === null, String(junk.error));
  const alive = await asAdmin('select count(*)::int n from partners');
  ok('  and the partners table is still there', alive[0].n >= 3);

  const suspCode = await asAnon('select app.claim_referral_code($1) as p', ['SUSP']);
  ok('a suspended partner\'s code stops attributing', suspCode.rows[0]?.p === null);

  await asAdmin('update partner_links set active = false where code = $1', ['AMAKA-IG']);
  const paused = await asAnon('select app.claim_referral_code($1) as p', ['AMAKA-IG']);
  ok('a paused link stops attributing', paused.rows[0]?.p === null, 'got ' + paused.rows[0]?.p);
  await asAdmin('update partner_links set active = true where code = $1', ['AMAKA-IG']);

  // The function returns an id and nothing else. No name, no email, no earnings.
  const cols = await asAdmin(
    "select pg_get_function_result(p.oid) r from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
    "where n.nspname='app' and p.proname='claim_referral_code'");
  ok('it returns only an id, never partner details', cols[0].r === 'uuid', cols[0].r);
}

// =====================================================================
section('10. Who am I');
// =====================================================================
{
  const me = await asUser(U.a, 'select * from app.partner_me()');
  ok('partner_me returns exactly one row, the caller\'s', me.rows.length === 1 &&
    me.rows[0].code === 'AMAKA', JSON.stringify(me.rows.map(r => r.code)));

  const outsider = await asUser(U.outsider, 'select count(*)::int n from app.partner_me()');
  ok('and nothing at all for someone who is not a partner', outsider.rows[0]?.n === 0);

  // partner_me returns the suspended partner WITH their status, so the client
  // is forced to look at it rather than quietly rendering an empty portal.
  const susp = await asUser(U.suspended, 'select status from app.partner_me()');
  ok('a suspended partner is told they are suspended, not shown a blank page',
    susp.rows.length === 1 && susp.rows[0].status === 'suspended', JSON.stringify(susp.rows));

  const anon = await asAnon('select count(*)::int n from app.partner_me()');
  ok('or for an anonymous caller', anon.error !== null || anon.rows[0]?.n === 0);

  // It must not become a directory if the client is wrong about who it is.
  const cur = await asUser(U.a, 'select app.current_partner() as p');
  ok('current_partner is derived from the session, not from a parameter',
    cur.rows[0]?.p === ids.a, 'got ' + cur.rows[0]?.p);
}

// =====================================================================
section('11. Whole-schema audit of the partner tables');
// =====================================================================
{
  const rls = await asAdmin(`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'partner%'
    order by 1`);
  ok('every partner table has RLS on', rls.length === 6 && rls.every(r => r.relrowsecurity),
    rls.filter(r => !r.relrowsecurity).map(r => r.relname).join(','));
  ok('and FORCED, so the owner does not bypass its own policies',
    rls.every(r => r.relforcerowsecurity),
    rls.filter(r => !r.relforcerowsecurity).map(r => r.relname).join(','));

  // The three read-only tables must have no write policy of any kind.
  const writes = await asAdmin(`
    select tablename, policyname, cmd from pg_policies
    where schemaname = 'public'
      and tablename in ('partner_referrals','partner_ledger','partner_payouts')
      and cmd <> 'SELECT'`);
  ok('the three money tables carry no write policy at all', writes.length === 0,
    writes.map(w => w.tablename + '.' + w.cmd).join(', '));

  // Every SECURITY DEFINER function here must pin its search_path.
  const defs = await asAdmin(`
    select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef
      and p.proname in ('current_partner','is_partner','claim_referral_code',
                        'partner_me','partner_account_reverify')`);
  ok('all five partner functions run SECURITY DEFINER', defs.length === 5,
    'found ' + defs.length);
  ok('and every one pins its search_path',
    defs.every(d => (d.proconfig || []).some(c => c.startsWith('search_path='))),
    defs.filter(d => !(d.proconfig || []).some(c => c.startsWith('search_path=')))
      .map(d => d.proname).join(', '));
}

// =====================================================================
console.log('\nA partner nobody has claimed yet belongs to nobody');
// =====================================================================
// user_id became nullable so a partner can be prepared — code, tier,
// referral link — before anybody has signed up, and the trigger on
// auth.users attaches the account when it appears. Every policy here is
// `user_id = auth.uid()` or app.is_partner(), and auth.uid() is never null
// for a signed-in caller, so an unclaimed row should be invisible rather
// than unowned-and-therefore-open. Worth proving rather than reasoning
// about, because "null matches nothing" is exactly the kind of thing that
// is true until somebody writes `is not distinct from`.
{
  const un = (await asAdmin(
    `insert into partners(user_id, code, name, business_name, email, tier, status, pending_email)
     values (null, 'UNCLAIMED-1', 'Nobody Yet', 'Pending Co', 'pending@x', 'bronze', 'active', 'pending@x')
     returning id`))[0].id;
  await asAdmin(`insert into partner_links(partner_id, label, code, is_default)
                 values ($1, 'Main', 'UNCLAIMED-1', true)`, [un]);
  await asAdmin(`insert into partner_ledger(partner_id, kind, amount, rate_pct, basis, credited_on, clears_on, status)
                 values ($1, 'signup', 9999, 30, 33330, current_date, current_date, 'pending')`, [un]);

  for (const [who, uid] of [['another partner', U.a], ['a signed-out visitor', U.outsider]]) {
    const r = await asUser(uid, `select id from partners where id = $1`, [un]);
    ok('an unclaimed partner is invisible to ' + who, r.rows.length === 0,
       r.error || (r.rows.length + ' row(s)'));
    const l = await asUser(uid, `select id from partner_ledger where partner_id = $1`, [un]);
    ok('and so is the money against it, to ' + who, l.rows.length === 0,
       l.error || (l.rows.length + ' row(s)'));
  }
  const anon = await asAnon(`select id from partners where id = $1`, [un]);
  ok('and to the anon key', anon.rows.length === 0, anon.error || (anon.rows.length + ' row(s)'));

  // and nobody can claim it from a browser by writing their own id onto it
  const grab = await asUser(U.a,
    `update partners set user_id = $1 where id = $2 returning id`, [U.a, un]);
  ok('a partner cannot claim an unclaimed row by writing their own id onto it',
     grab.rows.length === 0, grab.rows.length + ' row(s) updated');
}

// =====================================================================
console.log('\n' + '='.repeat(66));
if (failures.length === 0) {
  console.log('ALL ' + pass + ' CHECKS PASSED');
  console.log('No partner can read another partner\'s money, and no partner');
  console.log('can write their own.');
} else {
  console.log(pass + ' passed, ' + failures.length + ' FAILED:');
  failures.forEach(f => console.log('  - ' + f));
}
console.log('='.repeat(66));
await db.close();
process.exit(failures.length ? 1 : 0);
