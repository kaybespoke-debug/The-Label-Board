/* Leaving, coming back, and telling us it broke.
 *
 * Batch F added the three operations a real business eventually needs and
 * this app could not do: report a fault, take its data with it, and close.
 * All three are dangerous in the same direction — they touch every table at
 * once — so all three are tested the way the walls are tested, by trying
 * them as the wrong person first.
 *
 * Four properties matter more than the rest:
 *
 *   1. CLOSING IS NOT DELETING. A closed studio keeps every row for thirty
 *      days, the owner can still export it, and reopening puts everybody
 *      back as they were — the person who was suspended comes back
 *      suspended, not promoted.
 *
 *   2. A CLOSED STUDIO IS CLOSED. Not hidden, not read-only-ish: the
 *      memberships close with it, and since every policy in this database
 *      goes through an active membership, nothing is reachable. That is one
 *      mechanism rather than thirty policies to keep in step.
 *
 *   3. OUR BOOKS AND THE PARTNER'S EARNINGS SURVIVE THE PURGE. Both point
 *      at businesses with ON DELETE SET NULL, so a hard delete does not
 *      fail; it quietly cuts the link between a commission we owe and the
 *      studio it was earned on. What is written before the delete is what
 *      is left after it.
 *
 *   4. A FAULT REPORT CANNOT LIE ABOUT WHO WROTE IT, and a broken page
 *      cannot post its own loop. The first is the same source discipline as
 *      the audit log; the second is a ceiling in the database, because the
 *      client's throttle is inside the page that is broken.
 *
 * One thing this suite ASSERTS RATHER THAN HIDES: `postgres` on Supabase
 * holds BYPASSRLS, so FORCE ROW LEVEL SECURITY does not constrain a
 * SECURITY DEFINER function owned by it. Every one of these five functions
 * is therefore unrestricted once it starts, and its first line is the only
 * gate. That is why every refusal below is tested by calling the real
 * public.* entry point as the real role, never by inspecting the body.
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
/* Supabase's default privileges, in force before the migrations run, so a
   table or function created in public is as reachable here as it is there. */
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
const asUser = (user, sql, params = []) => asRole('authenticated', user, sql, params);
const admin = async (sql, params = []) => (await db.query(sql, params)).rows;

/* ---- one studio with four people in it, and a second studio nearby ---- */
const U = {
  ada:    '11111111-1111-1111-1111-111111111111',   // owner
  tunde:  '22222222-2222-2222-2222-222222222222',   // manager
  chidi:  '33333333-3333-3333-3333-333333333333',   // staff, suspended
  bola:   '44444444-4444-4444-4444-444444444444',   // owner of the other studio
  op:     '55555555-5555-5555-5555-555555555555',   // us
  kemi:   '66666666-6666-6666-6666-666666666666',   // partner who referred them
};
const BIZ  = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const BIZ2 = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';

await admin(`insert into auth.users (id,email) values
  ($1,'ada@example.com'),($2,'tunde@example.com'),($3,'chidi@example.com'),
  ($4,'bola@example.com'),($5,'op@thelabelboard.com'),($6,'kemi@example.com')`,
  [U.ada, U.tunde, U.chidi, U.bola, U.op, U.kemi]);
await admin(`insert into public.platform_admins (id,email,name) values ($1,'op@thelabelboard.com','Operator')`, [U.op]);
await admin(`insert into public.businesses (id,name,slug,plan,status) values
  ($1,'Lifecycle Studio','lifecycle-studio','pro','active'),
  ($2,'Lifecycle Neighbour','lifecycle-neighbour','starter','active')`, [BIZ, BIZ2]);
await admin(`insert into public.memberships (user_id,business_id,role,status) values
  ($1,$5,'owner','active'),
  ($2,$5,'manager','active'),
  ($3,$5,'staff','suspended'),
  ($4,$6,'owner','active')`, [U.ada, U.tunde, U.chidi, U.bola, BIZ, BIZ2]);
/* A membership already creates the profile, so this is on conflict rather
   than an insert — and finding that out is why the fixture is written by
   hand instead of assumed. */
await admin(`insert into public.profiles (id,name,role_id,business_id) values
  ($1,'Ada','owner',$5),($2,'Tunde','manager',$5),($3,'Chidi','staff',$5),($4,'Bola','owner',$6)
  on conflict (id) do update set name = excluded.name`,
  [U.ada, U.tunde, U.chidi, U.bola, BIZ, BIZ2]);

/* real work in it, so "kept" and "purged" are measurable rather than claimed */
await admin(`insert into public.customers (business_id,name,measurements) values
  ($1,'Mrs Oladuja','{}'::jsonb),($1,'Mr Eze','{}'::jsonb)`, [BIZ]);
await admin(`insert into public.orders (business_id,app_id,doc) values
  ($1,'L-0001','{"id":"L-0001"}'::jsonb),($1,'L-0002','{"id":"L-0002"}'::jsonb),($1,'L-0003','{"id":"L-0003"}'::jsonb)`, [BIZ]);
await admin(`insert into public.transactions (business_id,kind,amount,at) values
  ($1,'sale',50000,now())`, [BIZ]);
await admin(`insert into public.app_state (business_id,key,data) values
  ($1,'layi_dash_settings','{"biz":"Lifecycle Studio"}'::jsonb)`, [BIZ]);

/* the partner who referred them, and the commission record that must outlive
   the studio */
/* SIGNING UP ALREADY MAKES YOU A PARTNER. One referral programme means a
   trigger on auth.users creates the partner row, so this fixture finds the
   row rather than creating a second one — which is also the first thing
   this suite taught us about the schema it is testing. */
await admin(`insert into public.partners (user_id,code,name,email) values
  ($1,'KEMI2026','Kemi','kemi@example.com')
  on conflict (user_id) do update set name = excluded.name`, [U.kemi]);
const PARTNER = (await admin(`select id from public.partners where user_id=$1`, [U.kemi]))[0].id;
await admin(`insert into public.partner_referrals
  (partner_id,business_id,business_name,stage,plan,mrr,signed_up_on) values
  ($1,$2,'Lifecycle Studio','subscribed','pro',49000,current_date)`, [PARTNER, BIZ]);
/* and signing up already puts you on our books, which is the other thing
   the fixture had to be told rather than assume */
await admin(`insert into public.tlb_customers (business_name,business_type,owner_name,owner_email,business_id)
  values ('Lifecycle Studio','tailor','Ada','ada@example.com',$1)
  on conflict (owner_email) do update
    set business_name = excluded.business_name, business_id = excluded.business_id`, [BIZ]);

// =====================================================================
section('A fault report says who wrote it, and the browser does not decide');
// =====================================================================
{
  /* NO RETURNING, AND THAT IS THE SHAPE THE APP MUST USE TOO. A tenant has
     no SELECT on this table, and both RETURNING and PostgREST's
     return=representation run the SELECT policy — so asking for the row
     back turns a perfectly good write into "new row violates row-level
     security policy". Measured, not assumed: the first version of this
     suite failed on exactly that and nothing was wrong with the write. */
  const mine = await asUser(U.tunde,
    `insert into public.error_reports (business_id,kind,message,stack,at_url,app_version,ua)
     values ($1,'error','Cannot read properties of undefined','at renderOrders','/#orders','layi-v57','probe')`,
    [BIZ]);
  ok('a member can report a fault in their own studio', !mine.error, mine.error);

  const seen = await admin(`select source, user_id, kind from public.error_reports
                             where business_id=$1 and message like 'Cannot read%'`, [BIZ]);
  ok('the report is stamped as coming from a client', seen[0]?.source === 'client',
     'source=' + seen[0]?.source);
  ok('and carries the actor the database saw, not one it was given',
     seen[0]?.user_id === U.tunde, 'user_id=' + seen[0]?.user_id);

  /* THE LIE THAT MATTERS. Our own diagnostics are the only evidence we have
     when something breaks at 11pm; a client that can label itself 'server'
     can forge it. */
  const liar = await asUser(U.tunde,
    `insert into public.error_reports (business_id,kind,message,source,user_id)
     values ($1,'error','I am the server','server',$2)`, [BIZ, U.ada]);
  ok('a report claiming to be the server is accepted and relabelled', !liar.error, liar.error);
  const lied = await admin(`select source, user_id from public.error_reports
                             where business_id=$1 and message='I am the server'`, [BIZ]);
  ok('a member claiming to be the server is overruled', lied[0]?.source === 'client',
     'source=' + lied[0]?.source);
  ok('and claiming to be somebody else is overruled too', lied[0]?.user_id === U.tunde,
     'user_id=' + lied[0]?.user_id);

  const edge = await asRole('service_role', null,
    `insert into public.error_reports (business_id,kind,message,source)
     values ($1,'edge','team-admin: invite failed','server')`, [BIZ]);
  ok('an Edge Function can write a report at all', !edge.error, edge.error);
  const fromEdge = await admin(`select source from public.error_reports
                                 where business_id=$1 and kind='edge'`, [BIZ]);
  ok('and it is recorded as coming from the server', fromEdge[0]?.source === 'server',
     'source=' + fromEdge[0]?.source);

  const other = await asUser(U.bola,
    `insert into public.error_reports (business_id,kind,message) values ($1,'error','not mine')`, [BIZ]);
  ok('nobody reports a fault against another studio', !!other.error, 'it was accepted');

  const read = await asUser(U.ada, `select id from public.error_reports`);
  ok('a studio cannot read our diagnostics, not even the owner', read.rows.length === 0,
     'saw ' + read.rows.length + ' rows');
  const opRead = await asUser(U.op, `select id from public.error_reports`);
  ok('we can', opRead.rows.length >= 3, 'saw ' + opRead.rows.length + ' rows');

  const edit = await asUser(U.op, `update public.error_reports set message='tidier' where true returning id`);
  ok('nobody edits a fault report, us included', !!edit.error || edit.rows.length === 0,
     edit.error || 'it changed ' + edit.rows.length + ' rows');
  const wipe = await asUser(U.op, `delete from public.error_reports where true returning id`);
  ok('and nobody deletes one', !!wipe.error || wipe.rows.length === 0,
     wipe.error || 'it deleted ' + wipe.rows.length + ' rows');
}

// =====================================================================
section('A broken page cannot post its own loop');
// =====================================================================
{
  const before = Number((await admin(
    `select count(*) c from public.error_reports where business_id=$1`, [BIZ]))[0].c);
  await admin(`insert into public.error_reports (business_id,kind,message,source)
               select $1,'error','filler '||g,'client' from generate_series(1,250) g`, [BIZ]);
  const flooded = await asUser(U.tunde,
    `insert into public.error_reports (business_id,kind,message) values ($1,'error','one more')`, [BIZ]);
  const landed = Number((await admin(
    `select count(*) c from public.error_reports where message='one more'`))[0].c);
  ok('past the hourly ceiling a report is dropped, not refused',
     !flooded.error && landed === 0,
     flooded.error || ('it inserted ' + landed + ' row(s)'));

  /* and the ceiling is per studio, or one noisy tenant silences everybody */
  const neighbour = await asUser(U.bola,
    `insert into public.error_reports (business_id,kind,message) values ($1,'error','mine')`, [BIZ2]);
  const theirs = Number((await admin(
    `select count(*) c from public.error_reports where business_id=$1`, [BIZ2]))[0].c);
  ok('the ceiling is per studio', !neighbour.error && theirs === 1,
     neighbour.error || (theirs + ' rows for the neighbour'));

  await admin(`delete from public.error_reports where message like 'filler %'`);
  const after = Number((await admin(
    `select count(*) c from public.error_reports where business_id=$1`, [BIZ]))[0].c);
  ok('the filler is gone and the real reports remain', after === before, before + ' -> ' + after);
}

// =====================================================================
section('Only the owner closes a studio');
// =====================================================================
{
  const byManager = await asUser(U.tunde, `select public.close_studio($1,'nope')`, [BIZ]);
  ok('a manager cannot close the studio', !!byManager.error, 'it closed');
  ok('and is refused for the reason we gave rather than a crash',
     /only the owner/.test(byManager.error || ''), byManager.error);

  const byOutsider = await asUser(U.bola, `select public.close_studio($1,'nope')`, [BIZ]);
  ok('somebody from another studio cannot close it', !!byOutsider.error, 'it closed');

  const anonTry = await asRole('anon', null, `select public.close_studio($1,'nope')`, [BIZ]);
  ok('an anonymous caller cannot close it', !!anonTry.error, 'it closed');

  const still = await admin(`select status from public.businesses where id=$1`, [BIZ]);
  ok('after three refusals the studio is still open', still[0].status === 'active', still[0].status);
}

// =====================================================================
section('Closing keeps everything and stops everything');
// =====================================================================
let purgeAfter = null;
{
  const r = await asUser(U.ada, `select public.close_studio($1,'moving abroad') as j`, [BIZ]);
  ok('the owner closes the studio', !r.error, r.error);
  purgeAfter = r.rows[0]?.j?.purge_after;
  ok('and is told when it would be purged', !!purgeAfter, JSON.stringify(r.rows[0]?.j));

  const b = (await admin(`select status, closed_at, closed_by, closed_reason, purge_after
                            from public.businesses where id=$1`, [BIZ]))[0];
  ok('the studio is marked closed', b.status === 'closed', b.status);
  ok('with who closed it and why', b.closed_by === U.ada && b.closed_reason === 'moving abroad',
     b.closed_by + ' / ' + b.closed_reason);
  ok('and a purge date a month out',
     new Date(b.purge_after) - new Date(b.closed_at) > 29 * 86400000, String(b.purge_after));

  /* NOTHING WAS DELETED. This is the whole difference between closing and
     leaving, and the reason the grace period exists. */
  const counts = (await admin(`select
      (select count(*) from public.orders where business_id=$1) o,
      (select count(*) from public.customers where business_id=$1) c,
      (select count(*) from public.transactions where business_id=$1) t,
      (select count(*) from public.app_state where business_id=$1) s`, [BIZ]))[0];
  ok('every row is still there', Number(counts.o) === 3 && Number(counts.c) === 2
     && Number(counts.t) === 1 && Number(counts.s) === 1, JSON.stringify(counts));

  /* and nothing is reachable, for anybody who was in it */
  for (const [who, id] of [['the owner', U.ada], ['the manager', U.tunde]]) {
    const o = await asUser(id, `select id from public.orders where business_id=$1`, [BIZ]);
    const s = await asUser(id, `select key from public.app_state where business_id=$1`, [BIZ]);
    const w = await asUser(id,
      `insert into public.orders (business_id,app_id,doc) values ($1,'L-9999','{}'::jsonb) returning id`, [BIZ]);
    ok('a closed studio serves ' + who + ' no orders', o.rows.length === 0, 'saw ' + o.rows.length);
    ok('and no settings', s.rows.length === 0, 'saw ' + s.rows.length);
    ok('and accepts no writes from ' + who, !!w.error || w.rows.length === 0,
       w.error || 'it wrote a row');
  }

  const reclose = await asUser(U.ada, `select public.close_studio($1,'again')`, [BIZ]);
  ok('a closed studio cannot be closed twice', !!reclose.error, 'it closed again');
}

// =====================================================================
section('The owner can still take their data with them');
// =====================================================================
{
  /* THIS IS WHEN PEOPLE ASK. Nobody exports a studio the day before they
     close it; they close it, then think of the invoices. An export that
     only works while the studio is open is an export that is never used. */
  const e = await asUser(U.ada, `select public.export_studio($1) as j`, [BIZ]);
  ok('the person who closed it can still export it', !e.error, e.error);
  const j = e.rows[0]?.j || {};
  ok('the export names the studio', j.business?.name === 'Lifecycle Studio', JSON.stringify(j.business?.name));
  ok('and carries the orders', (j.orders || []).length === 3, (j.orders || []).length + ' orders');
  ok('and the clients', (j.customers || []).length === 2, (j.customers || []).length + ' clients');
  ok('and the money', (j.transactions || []).length === 1, (j.transactions || []).length + ' transactions');
  ok('and the team', (j.memberships || []).length === 3, (j.memberships || []).length + ' memberships');
  ok('and the audit trail, which no device holds in full', (j.audit_log || []).length > 0,
     (j.audit_log || []).length + ' lines');
  ok('and does not hand back the uuid of whoever closed it',
     !('closed_by' in (j.business || {})), 'closed_by is in the export');

  const byManager = await asUser(U.tunde, `select public.export_studio($1)`, [BIZ]);
  ok('a manager cannot export the studio', !!byManager.error, 'it exported');
  const byOutsider = await asUser(U.bola, `select public.export_studio($1)`, [BIZ]);
  ok('nor can somebody from another studio', !!byOutsider.error, 'it exported');
  const byAnon = await asRole('anon', null, `select public.export_studio($1)`, [BIZ]);
  ok('nor can an anonymous caller', !!byAnon.error, 'it exported');
}

// =====================================================================
section('Reopening puts everybody back as they were');
// =====================================================================
{
  const byManager = await asUser(U.tunde, `select public.reopen_studio($1)`, [BIZ]);
  ok('a manager cannot reopen it', !!byManager.error, 'it reopened');
  const byOutsider = await asUser(U.bola, `select public.reopen_studio($1)`, [BIZ]);
  ok('nor can somebody from another studio', !!byOutsider.error, 'it reopened');

  const r = await asUser(U.ada, `select public.reopen_studio($1)`, [BIZ]);
  ok('the person who closed it can reopen it', !r.error, r.error);

  const m = await admin(`select user_id, status, closed_from from public.memberships
                          where business_id=$1 order by role`, [BIZ]);
  const by = Object.fromEntries(m.map(x => [x.user_id, x]));
  ok('the owner is active again', by[U.ada]?.status === 'active', by[U.ada]?.status);
  ok('the manager is active again', by[U.tunde]?.status === 'active', by[U.tunde]?.status);
  /* THE ONE THAT WOULD HAVE BEEN A PROMOTION. Chidi was suspended before
     the studio closed. A reopen that sets everybody to 'active' quietly
     un-suspends the person the studio deliberately shut out. */
  ok('and the suspended member comes back suspended, not promoted',
     by[U.chidi]?.status === 'suspended', by[U.chidi]?.status);
  ok('nothing is left holding its old status', m.every(x => x.closed_from === null),
     JSON.stringify(m.map(x => x.closed_from)));

  const o = await asUser(U.ada, `select id from public.orders where business_id=$1`, [BIZ]);
  ok('the studio works again', o.rows.length === 3, 'saw ' + o.rows.length + ' orders');

  const notClosed = await asUser(U.ada, `select public.reopen_studio($1)`, [BIZ]);
  ok('an open studio cannot be reopened', !!notClosed.error, 'it reopened');
}

// =====================================================================
section('Purging is ours, and only after the thirty days');
// =====================================================================
{
  const openPurge = await asUser(U.op, `select public.purge_studio($1)`, [BIZ]);
  ok('an open studio cannot be purged', !!openPurge.error, 'it purged');
  ok('and the refusal says what to do first',
     /must be closed/.test(openPurge.error || ''), openPurge.error);

  await asUser(U.ada, `select public.close_studio($1,'closing for good')`, [BIZ]);

  const early = await asUser(U.op, `select public.purge_studio($1)`, [BIZ]);
  ok('a studio cannot be purged inside the grace period', !!early.error, 'it purged');
  ok('and the refusal says why', /grace period/.test(early.error || ''), early.error);

  /* the clock, moved rather than waited for */
  await admin(`update public.businesses set purge_after = now() - interval '1 day' where id=$1`, [BIZ]);

  const byOwner = await asUser(U.ada, `select public.purge_studio($1)`, [BIZ]);
  ok('the owner cannot purge their own studio', !!byOwner.error, 'it purged');
  const byManager = await asUser(U.tunde, `select public.purge_studio($1)`, [BIZ]);
  ok('a manager cannot purge it', !!byManager.error, 'it purged');

  const r = await asUser(U.op, `select public.purge_studio($1) as j`, [BIZ]);
  ok('we can purge it once the thirty days are up', !r.error, r.error);
  const kept = r.rows[0]?.j?.kept || {};
  ok('and are told what went', Number(kept.orders) === 3 && Number(kept.customers) === 2,
     JSON.stringify(kept));

  const gone = (await admin(`select count(*) c from public.businesses where id=$1`, [BIZ]))[0];
  ok('the studio is gone', Number(gone.c) === 0, gone.c + ' rows');
  const rows = (await admin(`select
      (select count(*) from public.orders where business_id=$1) o,
      (select count(*) from public.customers where business_id=$1) c,
      (select count(*) from public.app_state where business_id=$1) s,
      (select count(*) from public.memberships where business_id=$1) m`, [BIZ]))[0];
  ok('and so is everything that hung off it',
     Number(rows.o) === 0 && Number(rows.c) === 0 && Number(rows.s) === 0 && Number(rows.m) === 0,
     JSON.stringify(rows));
}

// =====================================================================
section('Our books and the partner’s earnings outlive the studio');
// =====================================================================
{
  const rec = await admin(`select * from public.tlb_closed_studios where business_id=$1`, [BIZ]);
  ok('a record of the studio remains', rec.length === 1, rec.length + ' rows');
  ok('with its name, which is how the ledger reads', rec[0]?.name === 'Lifecycle Studio', rec[0]?.name);
  ok('and what it was paying', rec[0]?.plan === 'pro', rec[0]?.plan);
  ok('and why it closed', rec[0]?.closed_reason === 'closing for good', rec[0]?.closed_reason);
  ok('and what was in it when it went', Number(rec[0]?.row_counts?.orders) === 3,
     JSON.stringify(rec[0]?.row_counts));

  /* THE ONE THAT WOULD HAVE GONE QUIET. ON DELETE SET NULL means a purge
     does not fail, it just severs the commission from its subject. */
  const ref = await admin(`select business_id, business_name, mrr from public.partner_referrals
                            where partner_id=$1`, [PARTNER]);
  ok('the referral survives the purge', ref.length === 1, ref.length + ' rows');
  ok('and still says which studio it was', ref[0]?.business_name === 'Lifecycle Studio',
     ref[0]?.business_name);
  ok('and still says what it was worth', Number(ref[0]?.mrr) === 49000, String(ref[0]?.mrr));
  ok('with the dead link honestly null rather than dangling', ref[0]?.business_id === null,
     String(ref[0]?.business_id));

  const cust = await admin(`select business_name, business_id from public.tlb_customers
                             where business_name='Lifecycle Studio'`);
  ok('our own customer record survives it too', cust.length === 1, cust.length + ' rows');
  ok('by name, not by a link that no longer resolves', cust[0]?.business_id === null,
     String(cust[0]?.business_id));

  const tenantRead = await asUser(U.bola, `select business_id from public.tlb_closed_studios`);
  ok('no studio reads the record of a studio that closed', tenantRead.rows.length === 0,
     'saw ' + tenantRead.rows.length + ' rows');
}

// =====================================================================
section('A person can leave, unless leaving breaks a studio');
// =====================================================================
{
  const B3 = 'dddddddd-0000-0000-0000-dddddddddddd';
  const U2 = {
    lola: '77777777-7777-7777-7777-777777777777',   // sole owner
    sade: '88888888-8888-8888-8888-888888888888',   // staff
    yemi: '99999999-9999-9999-9999-999999999999',   // second owner, added later
  };
  await admin(`insert into auth.users (id,email) values ($1,'lola@example.com'),($2,'sade@example.com'),($3,'yemi@example.com')`,
    [U2.lola, U2.sade, U2.yemi]);
  await admin(`insert into public.businesses (id,name,slug,plan,status) values ($1,'Leaver Studio','leaver-studio','starter','active')`, [B3]);
  await admin(`insert into public.memberships (user_id,business_id,role,status) values
    ($1,$3,'owner','active'),($2,$3,'staff','active')`, [U2.lola, U2.sade, B3]);
  await admin(`insert into public.profiles (id,name,role_id,business_id) values
    ($1,'Lola','owner',$3),($2,'Sade','staff',$3) on conflict (id) do nothing`, [U2.lola, U2.sade, B3]);

  /* SIGNING UP GAVE EACH OF THEM A STUDIO OF THEIR OWN. That is what
     provision_studio does for anybody who was not invited, so all three of
     these people already solely own a studio named after them before this
     section begins — and that, not the fixture, is why a plain refusal
     would have meant nobody could ever delete an account. */
  const own = await admin(`select b.name from public.businesses b
     join public.memberships m on m.business_id=b.id and m.user_id=$1 and m.role='owner'
     where b.id <> $2`, [U2.sade, B3]);
  ok('an ordinary signup already owns a studio of its own', own.length === 1,
     JSON.stringify(own.map(x => x.name)));

  const sole = await asUser(U2.lola, `select public.delete_my_account()`);
  ok('somebody who solely owns a studio cannot just delete their account', !!sole.error, 'it deleted');
  ok('and is told both ways out rather than left guessing',
     /only owner/.test(sole.error || '') && /close it as you go/.test(sole.error || ''), sole.error);
  const stillThere = await admin(`select count(*) c from public.memberships where user_id=$1 and status='active'`, [U2.lola]);
  ok('and is still where she was afterwards', Number(stillThere[0].c) === 2, stillThere[0].c + ' memberships');

  /* the same request, with the answer to the question it asked */
  const staff = await asUser(U2.sade, `select public.delete_my_account(true) as j`);
  ok('a staff member can leave once she says to close her own studio', !staff.error, staff.error);
  ok('and is told which studios were closed on the way out',
     (staff.rows[0]?.j?.studios_closed || []).length === 1,
     JSON.stringify(staff.rows[0]?.j));
  const sadeLeft = (await admin(`select
      (select count(*) from public.memberships where user_id=$1) m,
      (select count(*) from public.profiles where id=$1) p`, [U2.sade]))[0];
  ok('and is actually gone', Number(sadeLeft.m) === 0 && Number(sadeLeft.p) === 0,
     JSON.stringify(sadeLeft));
  const hers = await admin(`select status, purge_after from public.businesses b
     where b.slug like 'sade%'`);
  ok('her own studio is closed rather than destroyed',
     hers[0]?.status === 'closed' && !!hers[0]?.purge_after, JSON.stringify(hers[0]));

  /* THE STUDIO SHE WORKED FOR IS UNTOUCHED, which is the line between
     "closing what is mine" and "closing what I had a key to". */
  const bizStands = (await admin(`select status from public.businesses where id=$1`, [B3]))[0];
  ok('the studio she merely worked for is untouched', bizStands.status === 'active', bizStands.status);
  const teamLeft = await admin(`select count(*) c from public.memberships where business_id=$1`, [B3]);
  ok('and simply has one fewer person in it', Number(teamLeft[0].c) === 1, teamLeft[0].c + ' memberships');

  /* the other way out: hand the studio over */
  await admin(`insert into public.memberships (user_id,business_id,role,status) values ($1,$2,'owner','active')`, [U2.yemi, B3]);
  const handed = await asUser(U2.lola, `select public.delete_my_account() as j`);
  ok('handing the shared studio over is still not enough on its own',
     !!handed.error, 'it deleted');
  ok('because her own studio is still hers', /Lola/.test(handed.error || ''), handed.error);

  const now = await asUser(U2.lola, `select public.delete_my_account(true) as j`);
  ok('closing only what is solely hers lets her go', !now.error, now.error);
  const closed = now.rows[0]?.j?.studios_closed || [];
  ok('and exactly one studio was closed, hers', closed.length === 1 && /Lola/.test(closed[0]),
     JSON.stringify(closed));
  const owners = await admin(`select count(*) c from public.memberships
                               where business_id=$1 and role='owner' and status='active'`, [B3]);
  ok('the studio she handed over still has its new owner', Number(owners[0].c) === 1,
     owners[0].c + ' owners');
  const shared = (await admin(`select status from public.businesses where id=$1`, [B3]))[0];
  ok('and is still open', shared.status === 'active', shared.status);

  const anon = await asRole('anon', null, `select public.delete_my_account()`);
  ok('an anonymous caller deletes nobody', !!anon.error, 'it deleted');
}

// =====================================================================
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('\nClosing keeps everything, reopening puts everybody back as they');
console.log('were, and what we billed outlives the studio that was billed.');
