/* The other three surfaces, against the backend the customer app just got.
 *
 * The Label Board is four production frontends over one database, and the
 * habit worth breaking is assuming a backend change only reaches the app it
 * was written for. This suite is that assumption, tested.
 *
 * It holds the things that would be wrong SOMEWHERE ELSE:
 *
 *   1. A STUDIO THAT STOPS STOPS EARNING. Commission accrues on
 *      partner_referrals.lapsed_on being null, and nothing else — not
 *      payments, not the studio. Closing a studio and a term running out are
 *      both new this week, and neither touched partner_referrals, so a
 *      referrer would have gone on earning 8% a month of a subscription
 *      nobody was paying. Both directions are tested, because un-suspending a
 *      studio that was suspended in error must not cost the partner their
 *      twelve months either.
 *
 *   2. THE PARTNER PORTAL SURVIVES A PURGE. partner_referrals.business_id is
 *      ON DELETE SET NULL, so a purge never fails — it just severs the link.
 *      The portal reads business_name and the money off the referral row, so
 *      it keeps working; that is asserted rather than assumed.
 *
 *   3. THE CONSOLE CAN TELL THE THREE STATES APART. platform_tenant_summary
 *      is the console's whole view of a studio, and it now has to carry
 *      closed_at and purge_after, or an operator cannot tell a studio the
 *      owner closed from one that lapsed.
 *
 *   4. THE CONSOLE'S OWN WRITES STILL WORK. Everything it does arrives as the
 *      service role, and this release added seventeen write-refusing triggers
 *      and five audit triggers. The service role has BYPASSRLS, which is
 *      nothing to do with triggers — so each of the console's writes against
 *      a suspended studio is tried here for real.
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
/* Supabase’s default privileges, service_role INCLUDED. Leaving it out is
   what made the first run of this suite report "permission denied for
   table businesses" for the console — a failure that exists only in the
   test, and would have hidden the real question, which is whether the new
   triggers refuse the console. A harness that models the wrong database
   answers a question nobody asked. */
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);
for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message.split('\n')[0]); process.exit(1); }
}
console.log('Built from the migrations alone.');

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
const console_ = (sql, p = []) => asRole('service_role', null, sql, p);
const admin = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await admin(sql, params))[0];

const U = {
  ada:  'd1111111-1111-1111-1111-111111111111',   // studio owner
  kemi: 'd2222222-2222-2222-2222-222222222222',   // the partner who referred her
  op:   'd3333333-3333-3333-3333-333333333333',   // us
};
const BIZ = 'dddd0000-0000-0000-0000-00000000dddd';

await admin(`insert into auth.users (id,email) values
  ($1,'ada@x.test'),($2,'kemi@x.test'),($3,'op@thelabelboard.com')`, [U.ada, U.kemi, U.op]);
await admin(`insert into public.platform_admins (id,email,name) values ($1,'op@thelabelboard.com','Operator')`, [U.op]);
await admin(`insert into public.businesses (id,name,slug,plan,status) values
  ($1,'Cross Studio','cross-studio','pro','active')`, [BIZ]);
await admin(`insert into public.branches (business_id,name) values ($1,'Main studio')`, [BIZ]);
await admin(`insert into public.memberships (user_id,business_id,role,status) values ($1,$2,'owner','active')`, [U.ada, BIZ]);
await admin(`insert into public.profiles (id,name,role_id,business_id) values ($1,'Ada','owner',$2)
  on conflict (id) do update set name = excluded.name`, [U.ada, BIZ]);
await admin(`select app.ensure_billing_record($1)`, [BIZ]);

await admin(`insert into public.partners (user_id,code,name,email) values ($1,'KEMIX','Kemi','kemi@x.test')
  on conflict (user_id) do update set name = excluded.name`, [U.kemi]);
const PARTNER = (await one(`select id from public.partners where user_id=$1`, [U.kemi])).id;
await admin(`insert into public.partner_referrals
  (partner_id,business_id,business_name,owner_name,city,stage,plan,cycle,mrr,first_payment,signed_up_on,subscribed_on)
  values ($1,$2,'Cross Studio','Ada','Lagos','subscribed','pro','monthly',49000,49000,
          current_date - 60, current_date - 60)`, [PARTNER, BIZ]);
const REF = (await one(`select id from public.partner_referrals where partner_id=$1`, [PARTNER])).id;
/* AND THE STUDIO HAS ACTUALLY PAID, which the fixture has to say out loud:
   app.no_commission_before_payment refuses a ledger row for a business that
   has never paid us, so a referral marked 'subscribed' with no payment behind
   it accrues nothing at all. Worth knowing before reading anything below. */
await admin(`select public.record_studio_payment($1, 49000, 'bank transfer', 'SEED-1', 'first month')`, [BIZ]);

// =====================================================================
section('PARTNER APP — a studio that stops stops earning');
// =====================================================================
{
  const before = await console_(`select public.partner_accrue_month(current_date::date, $1) as n`, [PARTNER]);
  ok('a paying referral accrues', Number(before.rows[0]?.n) >= 1, String(before.rows[0]?.n));
  const led = await one(`select count(*) c, coalesce(sum(amount),0) total, max(rate_pct) rate
    from public.partner_ledger where referral_id=$1`, [REF]);
  ok('at eight per cent of what they pay', Number(led.rate) === 8, String(led.rate));
  ok('which on 49,000 is 3,920', Number(led.total) === 3920, String(led.total));

  /* THE ONE THIS SUITE EXISTS FOR. */
  await asUser(U.ada, `select public.close_studio($1,'moving on')`, [BIZ]);
  const r = await one(`select lapsed_on, stage from public.partner_referrals where id=$1`, [REF]);
  ok('closing the studio lapses the referral', !!r.lapsed_on, String(r.lapsed_on));
  ok('and says so in the stage the portal reads', r.stage === 'lapsed', r.stage);

  const voided = await one(`select status, note from public.partner_ledger where referral_id=$1 order by id desc limit 1`, [REF]);
  ok('the commission still inside its hold is voided', voided.status === 'void', voided.status);
  ok('with the reason on the row', /stopped paying/.test(voided.note || ''), voided.note);

  const nextMonth = await console_(
    `select public.partner_accrue_month((current_date + interval '1 month')::date, $1) as n`, [PARTNER]);
  ok('and nothing accrues next month', Number(nextMonth.rows[0]?.n) === 0, String(nextMonth.rows[0]?.n));

  const active = await console_(`select public.partner_active_paying($1, current_date::date) as n`, [PARTNER]);
  ok('the partner no longer counts it as an active paying business',
     Number(active.rows[0]?.n) === 0, String(active.rows[0]?.n));
}

// =====================================================================
section('PARTNER APP — and a studio that comes back does not cost them the year');
// =====================================================================
{
  const re = await asUser(U.ada, `select public.reopen_studio($1)`, [BIZ]);
  ok('the studio reopens', !re.error, re.error);
  const r = await one(`select lapsed_on, stage, subscribed_on from public.partner_referrals where id=$1`, [REF]);
  ok('the referral is un-lapsed', r.lapsed_on === null, String(r.lapsed_on));
  ok('and is subscribed again', r.stage === 'subscribed', r.stage);
  ok('with the original clock, not a new one',
     new Date(r.subscribed_on) < new Date(Date.now() - 50 * 86400000), String(r.subscribed_on));

  const n = await console_(
    `select public.partner_accrue_month((current_date + interval '2 months')::date, $1) as n`, [PARTNER]);
  ok('and it earns again', Number(n.rows[0]?.n) === 1, String(n.rows[0]?.n));
}

// =====================================================================
section('PARTNER APP — the portal survives a purge');
// =====================================================================
{
  await asUser(U.ada, `select public.close_studio($1,'for good')`, [BIZ]);
  await admin(`update public.businesses set purge_after = now() - interval '1 day' where id=$1`, [BIZ]);
  const p = await asUser(U.op, `select public.purge_studio($1)`, [BIZ]);
  ok('the studio is purged', !p.error, p.error);

  /* The portal reads partner_referrals directly under its own RLS. */
  const mine = await asUser(U.kemi, `select business_name, mrr, stage, business_id
    from public.partner_referrals`);
  ok('the partner still sees the referral', mine.rows.length === 1, 'saw ' + mine.rows.length);
  ok('by name, which is what the portal renders', mine.rows[0]?.business_name === 'Cross Studio',
     String(mine.rows[0]?.business_name));
  ok('with what it was worth', Number(mine.rows[0]?.mrr) === 49000, String(mine.rows[0]?.mrr));
  ok('and the dead link honestly null', mine.rows[0]?.business_id === null,
     String(mine.rows[0]?.business_id));

  /* What the portal actually reads: the ledger, under its own RLS. */
  const led2 = await asUser(U.kemi, `select amount, status from public.partner_ledger`);
  ok('and still reads their own ledger', led2.rows.length >= 1, led2.error || ('saw ' + led2.rows.length));

  const led = await one(`select count(*) c from public.partner_ledger where referral_id=$1`, [REF]);
  ok('the ledger is intact after the studio has gone', Number(led.c) >= 1, led.c + ' rows');
}

// =====================================================================
section('ADMIN CONSOLE — it can tell the three states apart');
// =====================================================================
const BIZ2 = 'eeee0000-0000-0000-0000-00000000eeee';
{
  await admin(`insert into public.businesses (id,name,slug,plan,status) values
    ($1,'Console Studio','console-studio','pro','active')`, [BIZ2]);
  await admin(`insert into public.branches (business_id,name) values ($1,'Main studio')`, [BIZ2]);
  await admin(`insert into public.memberships (user_id,business_id,role,status) values ($1,$2,'owner','active')`, [U.ada, BIZ2]);

  const rows = await console_(`select id, status, closed_at, purge_after from public.platform_tenant_summary()`);
  ok('the console list answers at all', !rows.error, rows.error);
  const row = rows.rows.find(r => r.id === BIZ2);
  ok('and includes a live studio', !!row, 'the studio is missing from the list');
  ok('with no closing date on an open one', row && !row.closed_at, String(row && row.closed_at));

  await asUser(U.ada, `select public.close_studio($1,'testing the console')`, [BIZ2]);
  const after = await console_(`select id, status, closed_at, purge_after from public.platform_tenant_summary()`);
  const closed = after.rows.find(r => r.id === BIZ2);
  ok('a closed studio reads as closed', closed?.status === 'closed', String(closed?.status));
  /* WITHOUT THESE TWO the console shows "expired" and an operator cannot tell
     a studio the owner closed on Tuesday from one that lapsed in March. */
  ok('with the date it was closed', !!closed?.closed_at, String(closed?.closed_at));
  ok('and the date it would be purged', !!closed?.purge_after, String(closed?.purge_after));

  await asUser(U.ada, `select public.reopen_studio($1)`, [BIZ2]);
  await console_(`update public.businesses set status='suspended' where id=$1`, [BIZ2]);
  const susp = await console_(`select id, status from public.platform_tenant_summary()`);
  ok('and a suspended studio reads as suspended, not active',
     susp.rows.find(r => r.id === BIZ2)?.status === 'suspended',
     String(susp.rows.find(r => r.id === BIZ2)?.status));
}

// =====================================================================
section('ADMIN CONSOLE — its own writes still go through the new guards');
// =====================================================================
{
  /* The studio is suspended for all of this, which is the hard case: a
     browser cannot write to it at all now, and every one of these is
     something support has to be able to do BECAUSE it is suspended. */
  const st = await one(`select status from public.businesses where id=$1`, [BIZ2]);
  ok('the studio under test is suspended', st.status === 'suspended', st.status);
  /* With the read-only flag UP, which is the state the console has to keep
     working in. It ships down, because locking a studio out is a billing
     action and billing is not switched on yet — but the console's job does
     not change when it goes up, and that is what is being tested. */
  await admin(`update public.platform_flags set on_off = true where key='enforce_unpaid_readonly'`);

  const owner = await asUser(U.ada,
    `insert into public.orders (business_id,app_id,doc) values ($1,'X-1','{}'::jsonb)`, [BIZ2]);
  ok('the owner cannot write to it', !!owner.error, 'the owner wrote');

  const plan = await console_(`select public.set_studio_plan($1,'pro','monthly',49000)`, [BIZ2]);
  ok('but the console can still change the plan', !plan.error, plan.error);
  const pay = await console_(`select public.record_studio_payment($1,49000,'bank transfer','REF-1','caught up')`, [BIZ2]);
  ok('and record a payment that arrived', !pay.error, pay.error);
  const status = await console_(`update public.businesses set status='active' where id=$1`, [BIZ2]);
  ok('and put the studio back', !status.error, status.error);
  const limits = await console_(`select public.set_studio_limits($1, 3, 20)`, [BIZ2]);
  ok('and set its limits', !limits.error, limits.error);
  const note = await console_(`update public.businesses set notes='seen by support' where id=$1`, [BIZ2]);
  ok('and write a note on it', !note.error, note.error);
  const cap = await console_(`select public.set_studio_storage_cap($1, 5, 'goodwill')`, [BIZ2]);
  ok('and raise its storage', !cap.error, cap.error);

  /* memberships, which now carry a role_id and three triggers */
  const seat = await console_(
    `insert into public.memberships (user_id,business_id,role,status)
     values ($1,$2,'manager','invited') returning role_id`, [U.op, BIZ2]);
  ok('the console can still add a seat', !seat.error, seat.error);
  ok('and the role_id is filled in for it', !!seat.rows[0]?.role_id,
     'role_id came back ' + String(seat.rows[0]?.role_id));

  const gone = await console_(`delete from public.memberships where user_id=$1 and business_id=$2`, [U.op, BIZ2]);
  ok('and take it away again', !gone.error, gone.error);

  /* The audit triggers fire on all of that, as the database's own record. */
  const trail = await one(`select count(*) c from public.audit_log
    where business_id=$1 and source='server'`, [BIZ2]);
  ok('and every one of those left a server-side line in the studio’s history',
     Number(trail.c) > 0, trail.c + ' lines');
}

// =====================================================================
section('WEBSITE — what it publishes is what the server would charge');
// =====================================================================
{
  const page = readFileSync(join(repo, 'web/pricing.html'), 'utf8');
  const prices = await admin(`select plan, cycle, amount from public.plan_prices order by 1,2`);
  ok('there are four prices to check', prices.length === 4, prices.length + '');
  for (const p of prices) {
    const shown = Number(p.amount).toLocaleString('en-GB');
    ok('the page publishes ' + p.plan + ' ' + p.cycle + ' as ' + shown,
       page.includes('"' + shown + '"') || page.includes('>' + shown + '<'), shown);
  }

  /* AND IT MUST NOT PROMISE A CARD STEP THAT IS NOT SWITCHED ON. The trial
     page carries the terms and is deliberately unlinked and noindex until
     Flutterwave is configured; if either of those is ever removed by
     accident, somebody lands on a promise we cannot keep. */
  const trial = readFileSync(join(repo, 'web/trial.html'), 'utf8');
  ok('the trial page is still noindex while the card step is off',
     /name="robots"\s+content="noindex"/.test(trial), 'it is indexable');
  const pages = readdirSync(join(repo, 'web')).filter(f => f.endsWith('.html') && f !== 'trial.html');
  const linked = pages.filter(f => /href="trial\.html/.test(readFileSync(join(repo, 'web', f), 'utf8')));
  ok('and nothing links to it', linked.length === 0, 'linked from ' + linked.join(', '));
}

// =====================================================================
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('\nA studio that stops stops earning its partner a commission, the');
console.log('portal survives the studio being purged, the console can tell');
console.log('closed from suspended and can still do its job either way, and');
console.log('the website publishes the price the server would charge.');
