/* Being paid, and what happens when we are not.
 *
 * This is the suite where a mistake costs money rather than embarrassment, so
 * every one of these is tried as the wrong caller first. Five properties:
 *
 *   1. THE PRICE IS OURS. A browser names a plan and a cycle. There is no
 *      amount parameter to name — asserted by reading the function's own
 *      signature, because an argument that does not exist cannot be abused.
 *      And the price in the database is the price on the pricing page, which
 *      this suite reads off disk, because two numbers kept in two places
 *      diverge.
 *
 *   2. THE WEBHOOK IS MATCHED, NOT BELIEVED. It carries a reference; the
 *      studio, the plan and the amount come from our own intent row. A webhook
 *      that names a studio we never billed, an amount we never asked for, or a
 *      reference we never issued settles nothing.
 *
 *   3. IT HAPPENS ONCE. Providers retry. The same event twice must not be two
 *      payments, and the second attempt is tested with the identical body.
 *
 *   4. NOT PAYING MEANS READ ONLY, NOT GONE. Every record still readable, the
 *      export still working, the complaint channel still open, and paying
 *      still possible — while nothing new can be written. Until Batch G,
 *      businesses.status was set to 'suspended' and nothing in the database
 *      read it, so a studio whose trial ended kept the product.
 *
 *   5. CANCELLING IS NOT LOSING IT TODAY. A studio paid for a term and keeps
 *      the term. What stops is the renewal.
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
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
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
const gateway = (sql, p = []) => asRole('service_role', null, sql, p);
const admin = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await admin(sql, params))[0];

const U = {
  ada:   'c1111111-1111-1111-1111-111111111111',
  tunde: 'c2222222-2222-2222-2222-222222222222',
  bola:  'c3333333-3333-3333-3333-333333333333',
  op:    'c4444444-4444-4444-4444-444444444444',
};
const BIZ = 'cccc0000-0000-0000-0000-00000000cccc';

await admin(`insert into auth.users (id,email) values
  ($1,'ada@sub.test'),($2,'tunde@sub.test'),($3,'bola@sub.test'),($4,'op@thelabelboard.com')`,
  [U.ada, U.tunde, U.bola, U.op]);
await admin(`insert into public.platform_admins (id,email,name) values ($1,'op@thelabelboard.com','Operator')`, [U.op]);
await admin(`insert into public.businesses (id,name,slug,plan,status) values
  ($1,'Sub Studio','sub-studio','trial','active')`, [BIZ]);
await admin(`insert into public.branches (business_id,name) values ($1,'Main studio')`, [BIZ]);
await admin(`insert into public.memberships (user_id,business_id,role,status) values
  ($1,$3,'owner','active'),($2,$3,'manager','active')`, [U.ada, U.tunde, BIZ]);
await admin(`insert into public.profiles (id,name,role_id,business_id) values
  ($1,'Ada','owner',$3),($2,'Tunde','manager',$3)
  on conflict (id) do update set name = excluded.name`, [U.ada, U.tunde, BIZ]);
await admin(`select app.ensure_billing_record($1)`, [BIZ]);

// =====================================================================
section('The price is ours, and it is the price we publish');
// =====================================================================
{
  /* NO AMOUNT TO PASS. The cheapest possible guarantee: the argument does not
     exist, so no caller can supply it and no future reviewer has to check
     whether one is validated. */
  const sig = await one(`select pg_get_function_identity_arguments(p.oid) a
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='open_checkout'`);
  ok('a browser cannot name a price, because there is no price argument',
     !/amount|price|numeric/i.test(sig.a), sig.a);

  const page = readFileSync(join(repo, 'web/pricing.html'), 'utf8');
  const rows = await admin(`select plan, cycle, amount from public.plan_prices order by plan, cycle`);
  const money = n => Number(n).toLocaleString('en-GB');
  for (const r of rows) {
    const shown = money(r.amount);
    ok('the pricing page publishes ' + r.plan + ' ' + r.cycle + ' as ' + shown,
       page.includes('"' + shown + '"') || page.includes('>' + shown + '<'),
       shown + ' is not on the page');
  }
  ok('Basic is 20,000 a month', Number(rows.find(r => r.plan === 'starter' && r.cycle === 'monthly').amount) === 20000);
  ok('Pro is 49,000 a month', Number(rows.find(r => r.plan === 'pro' && r.cycle === 'monthly').amount) === 49000);

  const tenant = await asUser(U.ada, `update public.plan_prices set amount = 1 where plan='pro' returning plan`);
  ok('an owner cannot rewrite a price', !!tenant.error || tenant.rows.length === 0,
     tenant.error || 'it changed ' + tenant.rows.length + ' rows');
  const anon = await asRole('anon', null, `select amount from public.plan_prices`);
  ok('the anon key reads no prices from the table', !!anon.error || anon.rows.length === 0,
     anon.error || 'saw ' + anon.rows.length + ' rows');
  const signedIn = await asUser(U.tunde, `select amount from public.plan_prices`);
  ok('anybody signed in can, because the app shows the price', signedIn.rows.length === 4,
     'saw ' + signedIn.rows.length);
}

// =====================================================================
section('Only the owner starts a checkout');
// =====================================================================
let ref = null;
{
  const byManager = await asUser(U.tunde, `select public.open_checkout($1,'pro','monthly')`, [BIZ]);
  ok('a manager cannot start one', !!byManager.error, 'it started');
  const byOutsider = await asUser(U.bola, `select public.open_checkout($1,'pro','monthly')`, [BIZ]);
  ok('nor can somebody from outside the studio', !!byOutsider.error, 'it started');
  const byAnon = await asRole('anon', null, `select public.open_checkout($1,'pro','monthly')`, [BIZ]);
  ok('nor can an anonymous caller', !!byAnon.error, 'it started');

  const madeUp = await asUser(U.ada, `select public.open_checkout($1,'platinum','monthly')`, [BIZ]);
  ok('a plan we do not sell is refused', !!madeUp.error, 'it started');
  const weekly = await asUser(U.ada, `select public.open_checkout($1,'pro','weekly')`, [BIZ]);
  ok('a cycle we do not sell is refused', !!weekly.error, 'it started');

  const r = await asUser(U.ada, `select public.open_checkout($1,'pro','monthly') as j`, [BIZ]);
  ok('the owner starts one', !r.error, r.error);
  ref = r.rows[0]?.j?.tx_ref;
  ok('and gets a reference back', !!ref && ref.startsWith('tlb-'), String(ref));
  ok('priced from the table, not from the request',
     Number(r.rows[0]?.j?.amount) === 49000, String(r.rows[0]?.j?.amount));

  const i = await one(`select * from public.billing_intents where tx_ref=$1`, [ref]);
  ok('the intent says which studio', i.business_id === BIZ, i.business_id);
  ok('and what we asked for', i.plan === 'pro' && i.cycle === 'monthly' && Number(i.amount) === 49000,
     JSON.stringify({ plan: i.plan, cycle: i.cycle, amount: i.amount }));
  ok('and is pending until somebody pays', i.status === 'pending', i.status);
  ok('and the plan has not moved on the strength of an intention',
     (await one(`select plan from public.businesses where id=$1`, [BIZ])).plan === 'trial');

  /* CHANGING YOUR MIND MUST NOT LEAVE A LIVE INTENT. Two pending references
     mean a late webhook for the abandoned one can settle a plan the studio no
     longer wanted. */
  const second = await asUser(U.ada, `select public.open_checkout($1,'starter','monthly') as j`, [BIZ]);
  ok('starting another one works', !second.error, second.error);
  const firstNow = await one(`select status from public.billing_intents where tx_ref=$1`, [ref]);
  ok('and abandons the one before it', firstNow.status === 'abandoned', firstNow.status);
  ref = second.rows[0]?.j?.tx_ref;
}

// =====================================================================
section('A downgrade that would not fit is refused, with the numbers');
// =====================================================================
{
  /* Pro allows five outlets and fifty seats; Basic allows one and five. A
     studio on Pro with four outlets cannot be sold Basic, because the database
     enforces those limits and it would pay and then find it could not work. */
  await admin(`insert into public.branches (business_id,name) values
    ($1,'Abuja'),($1,'Ibadan'),($1,'Kano')`, [BIZ]);
  const down = await asUser(U.ada, `select public.open_checkout($1,'starter','monthly')`, [BIZ]);
  ok('the downgrade is refused', !!down.error, 'it started');
  ok('and says how many and how many are allowed',
     /4 outlets/.test(down.error || '') && /allows 1/.test(down.error || ''), down.error);
  await admin(`delete from public.branches where business_id=$1 and name in ('Abuja','Ibadan','Kano')`, [BIZ]);
}

// =====================================================================
section('Settling is the gateway’s, and nobody else’s');
// =====================================================================
{
  const r = await one(`select
    has_function_privilege('anon','public.settle_checkout(text,text,text,numeric,text,text,jsonb)','execute') as anon,
    has_function_privilege('authenticated','public.settle_checkout(text,text,text,numeric,text,text,jsonb)','execute') as auth,
    has_function_privilege('service_role','public.settle_checkout(text,text,text,numeric,text,text,jsonb)','execute') as svc`);
  ok('settle_checkout is closed to the anon key', r.anon === false);
  ok('and to anybody signed in', r.auth === false);
  ok('and open to the gateway', r.svc === true);

  const tryIt = await asUser(U.ada,
    `select public.settle_checkout('evt-hack',$1,'fw-1',49000,'NGN','successful')`, [ref]);
  ok('an owner cannot settle their own checkout', !!tryIt.error, 'it settled');
}

// =====================================================================
section('A webhook is matched against what we asked for');
// =====================================================================
{
  const unknown = await gateway(
    `select public.settle_checkout('evt-unknown','tlb-never-issued','fw-9',49000,'NGN','successful') as j`);
  ok('a reference we never issued settles nothing',
     unknown.rows[0]?.j?.applied === false, JSON.stringify(unknown.rows[0]?.j));
  ok('and the attempt is still recorded',
     Number((await one(`select count(*) c from public.payment_events where event_id='evt-unknown'`)).c) === 1);

  const abandoned = await one(`select tx_ref from public.billing_intents
    where business_id=$1 and status='abandoned' limit 1`, [BIZ]);
  const late = await gateway(
    `select public.settle_checkout('evt-late',$1,'fw-8',49000,'NGN','successful') as j`, [abandoned.tx_ref]);
  ok('a late webhook for an abandoned checkout settles nothing',
     late.rows[0]?.j?.applied === false, JSON.stringify(late.rows[0]?.j));
  ok('and the studio is still on its trial',
     (await one(`select plan from public.businesses where id=$1`, [BIZ])).plan === 'trial');

  const short = await gateway(
    `select public.settle_checkout('evt-short',$1,'fw-7',1,'NGN','successful') as j`, [ref]);
  ok('a successful payment for less than the price does not buy the plan',
     short.rows[0]?.j?.paid === false, JSON.stringify(short.rows[0]?.j));
  ok('and says which', /less than the price/.test(short.rows[0]?.j?.reason || ''),
     short.rows[0]?.j?.reason);
  ok('the studio is still on its trial after a short payment',
     (await one(`select plan from public.businesses where id=$1`, [BIZ])).plan === 'trial');
  ok('and the refusal is in the studio’s own history',
     Number((await one(`select count(*) c from public.audit_log
       where business_id=$1 and action like 'Payment short%'`, [BIZ])).c) === 1);

  const wrongCur = await gateway(
    `select public.settle_checkout('evt-usd',$1,'fw-6',49000,'USD','successful') as j`, [ref]);
  ok('a payment in another currency does not buy the plan',
     wrongCur.rows[0]?.j?.paid === false, JSON.stringify(wrongCur.rows[0]?.j));

  const failed = await gateway(
    `select public.settle_checkout('evt-fail',$1,'fw-5',49000,'NGN','failed') as j`, [ref]);
  ok('a failed payment is applied as a failure', failed.rows[0]?.j?.paid === false,
     JSON.stringify(failed.rows[0]?.j));
  const i = await one(`select status, note from public.billing_intents where tx_ref=$1`, [ref]);
  ok('and the checkout is marked failed rather than left pending', i.status === 'failed', i.status);
  ok('with what the provider actually said', /failed/.test(i.note || ''), i.note);
}

// =====================================================================
section('And when one really is paid');
// =====================================================================
{
  const started = await asUser(U.ada, `select public.open_checkout($1,'pro','annual') as j`, [BIZ]);
  const r2 = started.rows[0].j.tx_ref;
  ok('an annual checkout is priced annually', Number(started.rows[0].j.amount) === 539000,
     String(started.rows[0].j.amount));

  const paid = await gateway(
    `select public.settle_checkout('evt-good',$1,'fw-100',539000,'NGN','successful',
       '{"event":"charge.completed"}'::jsonb) as j`, [r2]);
  ok('it applies', paid.rows[0]?.j?.paid === true, JSON.stringify(paid.rows[0]?.j));

  const b = await one(`select plan, status from public.businesses where id=$1`, [BIZ]);
  ok('the studio is on Pro', b.plan === 'pro', b.plan);
  const s = await one(`select s.plan_tier, s.billing_cycle, s.monthly_equivalent_price, s.renewal_date
    from public.tlb_subscriptions s join public.tlb_customers c on c.id=s.customer_id
   where c.business_id=$1 and s.is_active`, [BIZ]);
  ok('with an annual subscription', s.plan_tier === 'pro' && s.billing_cycle === 'annual',
     s.plan_tier + ' ' + s.billing_cycle);
  ok('and a renewal date about a year out',
     new Date(s.renewal_date) - new Date() > 360 * 86400000, String(s.renewal_date));
  const p = await one(`select p.amount, p.payment_method, p.flutterwave_reference, p.status
    from public.tlb_payments p join public.tlb_customers c on c.id=p.customer_id
   where c.business_id=$1 order by p.payment_date desc limit 1`, [BIZ]);
  ok('the money is on the books as what arrived', Number(p.amount) === 539000, String(p.amount));
  ok('with the provider and the reference', p.payment_method === 'flutterwave'
     && p.flutterwave_reference === r2, p.payment_method + ' / ' + p.flutterwave_reference);

  /* THE RETRY. Providers retry, and the identical body must not be a second
     payment. */
  const again = await gateway(
    `select public.settle_checkout('evt-good',$1,'fw-100',539000,'NGN','successful',
       '{"event":"charge.completed"}'::jsonb) as j`, [r2]);
  ok('the same event again is ignored', again.rows[0]?.j?.applied === false,
     JSON.stringify(again.rows[0]?.j));
  ok('and says it has seen it', /already seen/.test(again.rows[0]?.j?.reason || ''),
     again.rows[0]?.j?.reason);
  const payments = await one(`select count(*) c from public.tlb_payments p
    join public.tlb_customers c on c.id=p.customer_id where c.business_id=$1`, [BIZ]);
  ok('the studio was charged once', Number(payments.c) === 1, payments.c + ' payments');

  /* and a DIFFERENT event for a checkout that is already paid */
  const dupe = await gateway(
    `select public.settle_checkout('evt-good-2',$1,'fw-101',539000,'NGN','successful') as j`, [r2]);
  ok('a second event for a settled checkout settles nothing again',
     dupe.rows[0]?.j?.applied === false, JSON.stringify(dupe.rows[0]?.j));
  ok('still one payment', Number((await one(`select count(*) c from public.tlb_payments p
    join public.tlb_customers c on c.id=p.customer_id where c.business_id=$1`, [BIZ])).c) === 1);
}

// =====================================================================
section('Not paying means read only, and not gone');
// =====================================================================
{
  await admin(`insert into public.app_state (business_id,key,data) values
    ($1,'layi_dash_settings','{"biz":"Sub Studio"}'::jsonb)`, [BIZ]);
  await admin(`insert into public.orders (business_id,app_id,doc,total) values
    ($1,'L-0001','{"id":"L-0001"}'::jsonb,45000)`, [BIZ]);
  await admin(`update public.businesses set status='suspended' where id=$1`, [BIZ]);

  const read = await asUser(U.ada, `select id from public.orders where business_id=$1`, [BIZ]);
  ok('every record is still readable', read.rows.length === 1, 'saw ' + read.rows.length);
  const write = await asUser(U.ada,
    `insert into public.orders (business_id,app_id,doc) values ($1,'L-0002','{}'::jsonb)`, [BIZ]);
  ok('but nothing new can be written', !!write.error, 'it wrote a row');
  ok('and the refusal says the work is still there',
     /still here and still readable/.test(write.error || ''), write.error);
  const edit = await asUser(U.ada,
    `update public.app_state set data='{"biz":"renamed"}'::jsonb where business_id=$1`, [BIZ]);
  ok('nor edited', !!edit.error, 'it edited');
  const wipe = await asUser(U.ada, `delete from public.orders where business_id=$1`, [BIZ]);
  ok('nor deleted', !!wipe.error, 'it deleted');
  const byStaff = await asUser(U.tunde,
    `insert into public.customers (business_id,name,measurements) values ($1,'X','{}'::jsonb)`, [BIZ]);
  ok('and it applies to everybody, not just the owner', !!byStaff.error, 'it wrote');

  /* THE THREE THINGS THAT MUST STILL WORK while suspended, because each of
     them is how a studio gets out of being suspended or gets its data. */
  const tell = await asUser(U.ada,
    `insert into public.feedback (business_id,kind,title,body,created_by)
     values ($1,'support','I have paid','the bank debited me',$2)`, [BIZ, U.ada]);
  ok('a suspended studio can still tell us something is wrong', !tell.error, tell.error);
  const exp = await asUser(U.ada, `select public.export_studio($1) as j`, [BIZ]);
  ok('and can still take its data', !exp.error && (exp.rows[0]?.j?.orders || []).length === 1,
     exp.error || JSON.stringify((exp.rows[0]?.j?.orders || []).length));
  const pay = await asUser(U.ada, `select public.open_checkout($1,'pro','monthly') as j`, [BIZ]);
  ok('and can still pay, which is the way out', !pay.error, pay.error);

  /* paying brings it back */
  const back = await gateway(
    `select public.settle_checkout('evt-back',$1,'fw-200',49000,'NGN','successful') as j`,
    [pay.rows[0].j.tx_ref]);
  ok('the payment applies', back.rows[0]?.j?.paid === true, JSON.stringify(back.rows[0]?.j));
  const b = await one(`select status, plan from public.businesses where id=$1`, [BIZ]);
  ok('and the studio is working again', b.status === 'active', b.status);
  const nowWrite = await asUser(U.ada,
    `insert into public.orders (business_id,app_id,doc) values ($1,'L-0003','{}'::jsonb)`, [BIZ]);
  ok('writing starts again the moment it is paid', !nowWrite.error, nowWrite.error);
}

// =====================================================================
section('Cancelling stops the renewal, not the month');
// =====================================================================
{
  const byManager = await asUser(U.tunde, `select public.cancel_subscription($1)`, [BIZ]);
  ok('a manager cannot cancel the subscription', !!byManager.error, 'it cancelled');

  const c = await asUser(U.ada, `select public.cancel_subscription($1) as j`, [BIZ]);
  ok('the owner can', !c.error, c.error);
  ok('and is told the date it runs until', !!c.rows[0]?.j?.runs_until,
     JSON.stringify(c.rows[0]?.j));

  const b = await one(`select plan, status from public.businesses where id=$1`, [BIZ]);
  ok('the plan does not change today', b.plan === 'pro' && b.status === 'active',
     b.plan + ' / ' + b.status);
  const stillWorks = await asUser(U.ada,
    `insert into public.orders (business_id,app_id,doc) values ($1,'L-0004','{}'::jsonb)`, [BIZ]);
  ok('and the studio keeps working', !stillWorks.error, stillWorks.error);

  const twice = await asUser(U.ada, `select public.cancel_subscription($1) as j`, [BIZ]);
  ok('cancelling twice is not an error, it is the same answer',
     !twice.error && twice.rows[0]?.j?.cancelled === true, twice.error);

  const r = await asUser(U.ada, `select public.resume_subscription($1) as j`, [BIZ]);
  ok('and it can be resumed before the term runs out', !r.error, r.error);
  const sub = await one(`select s.cancel_requested_at from public.tlb_subscriptions s
    join public.tlb_customers c on c.id=s.customer_id where c.business_id=$1 and s.is_active`, [BIZ]);
  ok('with nothing left marked cancelled', sub.cancel_requested_at === null,
     String(sub.cancel_requested_at));
}

// =====================================================================
section('And when the cancelled term does run out');
// =====================================================================
{
  await asUser(U.ada, `select public.cancel_subscription($1)`, [BIZ]);
  const notYet = await gateway(`select public.expire_finished_terms() as n`);
  ok('nothing expires while the term is still running', Number(notYet.rows[0]?.n) === 0,
     String(notYet.rows[0]?.n));
  const stillOn = await one(`select status from public.businesses where id=$1`, [BIZ]);
  ok('and the studio is untouched', stillOn.status === 'active', stillOn.status);

  await admin(`update public.tlb_subscriptions s set renewal_date = current_date - 1
    where s.customer_id = (select id from public.tlb_customers where business_id=$1) and s.is_active`, [BIZ]);
  const ran = await gateway(`select public.expire_finished_terms() as n`);
  ok('once it has run out, the term ends', Number(ran.rows[0]?.n) === 1, String(ran.rows[0]?.n));
  const after = await one(`select status from public.businesses where id=$1`, [BIZ]);
  ok('and the studio goes read-only rather than away', after.status === 'suspended', after.status);
  const rows = await one(`select count(*) c from public.orders where business_id=$1`, [BIZ]);
  ok('with every order still there', Number(rows.c) >= 3, rows.c + ' orders');
  const again = await gateway(`select public.expire_finished_terms() as n`);
  ok('and running it again changes nothing', Number(again.rows[0]?.n) === 0, String(again.rows[0]?.n));

  const resumeTooLate = await asUser(U.ada, `select public.resume_subscription($1)`, [BIZ]);
  ok('resuming after the term has gone is refused, with paying as the way back',
     !!resumeTooLate.error, 'it resumed');
}

// =====================================================================
section('What the owner can see about their own money');
// =====================================================================
{
  const byManager = await asUser(U.tunde, `select public.my_billing($1)`, [BIZ]);
  ok('a manager cannot read the subscription', !!byManager.error, 'it read');
  const byOutsider = await asUser(U.bola, `select public.my_billing($1)`, [BIZ]);
  ok('nor can somebody from another studio', !!byOutsider.error, 'it read');

  const m = await asUser(U.ada, `select public.my_billing($1) as j`, [BIZ]);
  ok('the owner can', !m.error, m.error);
  const j = m.rows[0]?.j || {};
  ok('and sees what plan they are on', j.plan === 'pro', String(j.plan));
  ok('and that the studio is suspended', j.status === 'suspended', String(j.status));
  ok('and what they have paid', (j.payments || []).length === 2,
     (j.payments || []).length + ' payments');
  ok('and every checkout they started, settled or not',
     (j.checkouts || []).length >= 4, (j.checkouts || []).length + ' checkouts');
  ok('and the prices, so the screen can offer them', (j.prices || []).length === 4,
     (j.prices || []).length + ' prices');

  /* A tenant reads their own intents and nobody else's. */
  const mine = await asUser(U.ada, `select tx_ref from public.billing_intents`);
  ok('an owner reads their own checkouts from the table too', mine.rows.length >= 4,
     'saw ' + mine.rows.length);
  const theirs = await asUser(U.bola, `select tx_ref from public.billing_intents`);
  ok('and another studio reads none of them', theirs.rows.length === 0, 'saw ' + theirs.rows.length);
  const events = await asUser(U.ada, `select event_id from public.payment_events`);
  ok('and nobody but us reads the provider’s events', events.rows.length === 0,
     'saw ' + events.rows.length);
}

// =====================================================================
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('\nThe price is ours, the webhook is matched rather than believed,');
console.log('a retry is not a second payment, and not paying costs a studio');
console.log('its writing and never its work.');
