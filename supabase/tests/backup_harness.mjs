/* =====================================================================
   THE BACKUPS HAPPEN, AND ONE OF THEM RESTORES.

   The recovery drill proved a studio comes back from an export. This
   proves an export is actually being taken — nightly, for every active
   studio, checksummed, pruned, and loud when it fails — and then takes
   one of the automatic backups and restores a studio from it, so the
   two halves are joined rather than each assumed from the other.

   The failure this is really about: a scheduled job that quietly stops.
   Nothing looks healthier than a backup table with rows in it, if the
   newest row is from March. So the suite checks the run record as well
   as the result, and checks that a studio that FAILS is reported rather
   than skipped.

   usage: node supabase/tests/backup_harness.mjs
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
function section(t) { console.log('\n' + t + '\n' + '-'.repeat(t.length)); }

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);

/* pg_cron is not in PGlite. The schedule is a one-line call at the end of
   the migration; the WORK is app.take_studio_backups(), which is what this
   suite drives directly. A stub keeps the migration applying so everything
   around it is still tested from the real file rather than a paraphrase. */
await db.exec(`
  create schema if not exists cron;
  create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
  create or replace function cron.schedule(p_name text, p_schedule text, p_command text)
  returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
    returning jobid $$;
  create or replace function cron.unschedule(p_name text)
  returns boolean language sql as $$
    delete from cron.job where jobname = p_name returning true $$;
`);

for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  let sql = readFileSync(join(repo, 'supabase/migrations', f), 'utf8');
  /* pg_cron is a compiled extension PGlite does not have. The LINE is
     dropped; everything else in the schedule migration — the job name, the
     cron expression, the command — runs against the stub above, so those
     are read from the real file rather than restated here. */
  /* PGlite has no pg_cron binary, and the schedule migration skips itself
     when the extension is unavailable. The stub schema above stands in for
     it so the job name, the cron expression and the command are read from
     the real migration rather than restated in this file. */
  sql = sql.replace(/create extension if not exists pg_cron;/g, '');
  sql = sql.replace(/pg_available_extensions where name = .pg_cron./g, "(values(1)) v where true");
  try { await db.exec(sql); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message); process.exit(1); }
}
console.log('Built from the migrations alone.');

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => { const r = await q(sql, p); return r.length ? Object.values(r[0])[0] : null; };
async function asUser(userId, sql, p = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userId, role: 'authenticated', iat: Math.floor(Date.now() / 1000) })]);
    await db.exec('set local role authenticated');
    const r = await db.query(sql, p);
    await db.exec('commit');
    return { rows: r.rows, error: null };
  } catch (e) {
    try { await db.exec('rollback'); } catch {}
    return { rows: [], error: String(e.message).split('\n')[0] };
  }
}

/* =====================================================================
   TWO STUDIOS WITH SOMETHING IN THEM, AND ONE THAT IS CLOSED
   ===================================================================== */
const A = 'ba000000-0000-0000-0000-00000000000a';
const B = 'ba000000-0000-0000-0000-00000000000b';
const SHUT = 'ba000000-0000-0000-0000-00000000000c';
const UA = 'bb000000-0000-0000-0000-00000000000a';
const UB = 'bb000000-0000-0000-0000-00000000000b';

await db.query(`insert into auth.users (id,email) values ($1,'a@bk.test'),($2,'b@bk.test')`, [UA, UB]);
await db.query(`insert into public.businesses (id,name,slug,plan,status) values
  ($1,'Studio A','studio-a-bk','pro','active'),
  ($2,'Studio B','studio-b-bk','pro','active'),
  ($3,'Shut Studio','shut-bk','pro','closed')`, [A, B, SHUT]);

for (const [biz, u] of [[A, UA], [B, UB]]) {
  const br = await one(`insert into public.branches (business_id,name) values ($1,'Main') returning id`, [biz]);
  await db.query(`insert into public.memberships (business_id,user_id,role,status)
    values ($1,$2,'owner','active') on conflict do nothing`, [biz, u]);
  const c = await one(`insert into public.customers (business_id,branch_id,name) values ($1,$2,'A Client') returning id`, [biz, br]);
  await db.query(`insert into public.customer_contacts (customer_id,business_id,branch_id,phone)
    values ($1,$2,$3,'+234 800 111 2222')`, [c, biz, br]);
  const o = await one(`insert into public.orders (business_id,branch_id,customer_id,app_id,status,doc)
    values ($1,$2,$3,'BK-1','open','{"garment":"Agbada"}'::jsonb) returning id`, [biz, br, c]);
  /* THE PRICE IS A ROW OF ITS OWN SINCE OCTOBER. orders.total was the
     selling price in a plain column every member with `orders` could
     read; it is order_pricing.value now, behind `money`. */
  await db.query(`insert into public.order_pricing (order_id,business_id,branch_id,value) values ($1,$2,$3,150000)`, [o, biz, br]);
  await db.query(`insert into public.order_settlement (order_id,business_id,branch_id,paid) values ($1,$2,$3,90000)`, [o, biz, br]);
  await db.query(`insert into public.order_costs (order_id,business_id,branch_id,cost) values ($1,$2,$3,40000)`, [o, biz, br]);
  await db.query(`insert into public.order_commissions (order_id,business_id,branch_id,total) values ($1,$2,$3,15000)`, [o, biz, br]);
  await db.query(`insert into public.order_contacts (order_id,business_id,branch_id,detail)
    values ($1,$2,$3,'{"delivery_location":"14 Bode Thomas"}'::jsonb)`, [o, biz, br]);
  await db.query(`insert into public.transactions (business_id,branch_id,order_id,kind,amount,app_id)
    values ($1,$2,$3,'sale',90000,'bk-t1')`, [biz, br, o]);
}

/* =====================================================================
   1. THE SCHEDULE EXISTS AT ALL
   ===================================================================== */
section('1. Something is scheduled, and it is the right thing');
{
  const job = (await q(`select jobname, schedule, command from cron.job where jobname='nightly-studio-backups'`))[0];
  ok('a nightly job is registered', !!job, 'nothing scheduled');
  ok('  it runs daily', !!job && /^\d+ \d+ \* \* \*$/.test(job.schedule), job && job.schedule);
  ok('  and it calls the backup round', !!job && /take_studio_backups/.test(job.command), job && job.command);
}

/* =====================================================================
   2. A ROUND
   ===================================================================== */
section('2. A round backs up every active studio and leaves the closed one');
let firstRun;
{
  firstRun = await one(`select app.take_studio_backups(14)`);
  const R = typeof firstRun === 'string' ? JSON.parse(firstRun) : firstRun;
  /* The seeded demo studios are backed up too, which is correct — the round
     takes every ACTIVE studio. So this asserts about its own two and about
     the relationship between the numbers, not about a total it does not own. */
  const activeNow = await one(`select count(*)::int from public.businesses where status='active'`);
  ok('it attempted every active studio', Number(R.attempted) === activeNow,
     R.attempted + ' of ' + activeNow);
  ok('  all of them succeeded', Number(R.succeeded) === activeNow && Number(R.failed) === 0,
     JSON.stringify(R));

  const perStudio = await q(`select business_id, count(*)::int n from app.studio_backups
     where business_id in ($1,$2) group by business_id order by business_id`, [A, B]);
  ok('  one backup each for the two under test', perStudio.length === 2 && perStudio.every(r => r.n === 1),
     JSON.stringify(perStudio));
  const shut = await one(`select count(*)::int from app.studio_backups where business_id=$1`, [SHUT]);
  ok('  and none for the closed studio', shut === 0, String(shut));

  const run = (await q(`select attempted, succeeded, failed, finished_at from app.backup_runs order by id desc limit 1`))[0];
  ok('the run is recorded, finished', !!run && !!run.finished_at, JSON.stringify(run));
}

section('3. Each backup is whole, and is its own studio');
{
  const rows = await q(`select business_id, payload, sha256, bytes from app.studio_backups
     where business_id in ($1,$2) order by business_id`, [A, B]);
  for (const r of rows) {
    const doc = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    const mine = r.business_id;
    ok('the backup names the studio it is of', doc.business && doc.business.id === mine,
       JSON.stringify(doc.business && doc.business.id));
    ok('  it carries the orders, costs, commissions and contacts',
       (doc.orders || []).length === 1 && (doc.order_costs || []).length === 1
       && (doc.order_commissions || []).length === 1 && (doc.order_contacts || []).length === 1,
       JSON.stringify([doc.orders?.length, doc.order_costs?.length, doc.order_commissions?.length, doc.order_contacts?.length]));
    ok('  and the money', (doc.transactions || []).length === 1);
    /* CROSS-TENANT: the other studio's id must not appear anywhere in it */
    const other = mine === A ? B : A;
    ok('  and nothing of the other studio is in it',
       !JSON.stringify(doc).includes(other), 'the other studio appears in this backup');
  }
  const bad = await one(`select count(*)::int from app.studio_backups s
     where encode(sha256(s.payload::text::bytea),'hex') <> s.sha256
        or octet_length(s.payload::text) <> s.bytes`);
  ok('every checksum and length agrees with its payload', bad === 0, bad + ' disagree');

  const id = await one(`select id from app.studio_backups limit 1`);
  const v = await one(`select app.verify_studio_backup($1)`, [id]);
  const V = typeof v === 'string' ? JSON.parse(v) : v;
  ok('verify says so too', V && V.intact === true, JSON.stringify(V));

  /* and it NOTICES when one is damaged, which is the only interesting case */
  await db.query(`update app.studio_backups set payload = payload || '{"tampered":true}'::jsonb where id=$1`, [id]);
  const v2 = await one(`select app.verify_studio_backup($1)`, [id]);
  const V2 = typeof v2 === 'string' ? JSON.parse(v2) : v2;
  ok('  and a damaged backup fails verification', V2 && V2.intact === false, JSON.stringify(V2));
  await db.query(`delete from app.studio_backups where id=$1`, [id]);
}

section('4. No secret is in a backup');
{
  const all = await one(`select coalesce(string_agg(payload::text, ' '),'') from app.studio_backups`);
  ok('there is something to look in', (all || '').length > 500, (all || '').length + ' bytes');
  for (const [what, probe] of [
    ['an owner password', /ownerPassword/],
    ['a device account list', /layi_dash_users/],
    ['a PIN', /"pin"\s*:/],
  ]) {
    ok('no backup carries ' + what, !probe.test(all || ''), 'found it');
  }
}

section('5. Nobody with an API key can read one');
{
  for (const [who, uid] of [['the owner of Studio A', UA], ['the owner of Studio B', UB]]) {
    const r = await asUser(uid, `select business_id from app.studio_backups`);
    ok(who + ' cannot read the backup table', r.rows.length === 0,
       r.error || (r.rows.length + ' rows'));
  }
  const anon = await (async () => {
    await db.exec('begin');
    try { await db.exec("set local role anon");
      const r = await db.query(`select count(*) from app.studio_backups`);
      await db.exec('commit'); return { rows: r.rows, error: null };
    } catch (e) { try { await db.exec('rollback'); } catch {} return { rows: [], error: e.message.split('\n')[0] }; }
  })();
  ok('and an anonymous caller certainly cannot', anon.rows.length === 0 || !!anon.error,
     anon.error || JSON.stringify(anon.rows));
  const pol = await one(`select count(*)::int from pg_policies where schemaname='app' and tablename='studio_backups'`);
  ok('  there is no policy on the table at all, which is the point', pol === 0, pol + ' policies');
}

section('6. Retention keeps the newest and drops the rest');
{
  for (let i = 0; i < 4; i++) await db.query(`select app.take_studio_backups(3)`);
  const counts = await q(`select business_id, count(*)::int n from app.studio_backups
     where business_id in ($1,$2) group by business_id`, [A, B]);
  ok('no studio keeps more than it is told to', counts.every(r => r.n <= 3),
     JSON.stringify(counts));
  ok('  and each still has some', counts.length === 2 && counts.every(r => r.n >= 1),
     JSON.stringify(counts));
  /* pruning is PER STUDIO: a busy studio must not evict a quiet one */
  const perA = counts.find(r => r.business_id === A);
  const perB = counts.find(r => r.business_id === B);
  ok('  and pruning one studio did not touch the other', !!perA && !!perB && perA.n === perB.n,
     JSON.stringify([perA && perA.n, perB && perB.n]));
}

section('7. A studio that fails is reported, and the others still run');
{
  await db.query(`delete from public.error_reports`);
  /* make Studio A's export throw, the way a real fault would: something the
     export reads is suddenly not there */
  await db.exec(`create or replace function app.export_studio_raw(p_business uuid)
    returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
    begin
      if p_business = '${A}'::uuid then
        raise exception 'the fault under test';
      end if;
      return jsonb_build_object('_export','studio','_version',3,
        'business', to_jsonb((select b from public.businesses b where b.id = p_business)));
    end $fn$;`);

  const before = await one(`select count(*)::int from app.studio_backups where business_id=$1`, [B]);
  const r = await one(`select app.take_studio_backups(14)`);
  const R = typeof r === 'string' ? JSON.parse(r) : r;
  ok('the round reports exactly one failure', Number(R.failed) === 1, JSON.stringify(R));
  ok('  and the rest still succeeded, so one fault did not stop the round',
     Number(R.succeeded) === Number(R.attempted) - 1, JSON.stringify(R));
  const after = await one(`select count(*)::int from app.studio_backups where business_id=$1`, [B]);
  ok('  Studio B still got its backup', after === before + 1, before + ' -> ' + after);

  const rep = (await q(`select business_id, source, kind, message from public.error_reports
                         where kind='error' and message like 'nightly studio backup failed%'`))[0];
  ok('the failure is reported where the app reports its own', !!rep, 'nothing reported');
  ok('  naming the studio', !!rep && rep.business_id === A, JSON.stringify(rep && rep.business_id));
  ok('  and saying what happened', !!rep && /fault under test/.test(rep.message || ''),
     JSON.stringify(rep && rep.message));
  const run = (await q(`select failed, detail from app.backup_runs order by id desc limit 1`))[0];
  ok('and the run says it failed rather than looking quiet', Number(run.failed) === 1,
     JSON.stringify(run));
}

/* =====================================================================
   8. THE HALF THAT MATTERS: ONE OF THESE RESTORES
   ===================================================================== */
section('8. A studio is restored from an automatic backup, not a hand-made one');
{
  /* put the real export back */
  for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(repo, 'supabase/migrations', f), 'utf8');
    if (!/export_studio_raw/.test(sql)) continue;
    try { await db.exec(sql); } catch (e) {
      if (!/pg_cron/.test(e.message)) throw e;
    }
  }
  await db.query(`select app.take_studio_backups(14)`);

  const BEFORE = (await q(`select
      (select count(*) from public.orders where business_id=$1) orders,
      (select coalesce(sum(value),0) from public.order_pricing where business_id=$1) money,
      (select coalesce(sum(paid),0) from public.order_settlement where business_id=$1) paid,
      (select coalesce(sum(cost),0) from public.order_costs where business_id=$1) costs,
      (select coalesce(sum(total),0) from public.order_commissions where business_id=$1) commissions,
      (select count(*) from public.order_contacts where business_id=$1) contacts,
      (select count(*) from public.transactions where business_id=$1) payments,
      (select count(*) from public.memberships where business_id=$1) members`, [B]))[0];

  const payload = await one(`select payload from app.studio_backups
     where business_id=$1 order by taken_at desc limit 1`, [B]);
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  ok('there is a backup to restore from', !!json && json.length > 200, (json || '').length + ' bytes');

  /* destroy it the way a project loss would */
  await db.query(`insert into public.platform_admins (id,email,name,role,active)
    values ($1,'op@bk.test','Operator','owner',true) on conflict (id) do update set active=true`, [UB]);
  await db.query(`update public.businesses set status='closed', purge_after = now() - interval '1 day' where id=$1`, [B]);
  await asUser(UB, `select public.purge_studio($1)`, [B]);
  ok('the studio is gone', (await one(`select count(*)::int from public.businesses where id=$1`, [B])) === 0);

  const res = await asUser(UB, `select public.import_studio($1::jsonb) as j`, [json]);
  ok('it comes back from the automatic backup', !res.error && res.rows[0]?.j?.restored === true,
     res.error || JSON.stringify(res.rows[0]?.j));

  const AFTER = (await q(`select
      (select count(*) from public.orders where business_id=$1) orders,
      (select coalesce(sum(value),0) from public.order_pricing where business_id=$1) money,
      (select coalesce(sum(paid),0) from public.order_settlement where business_id=$1) paid,
      (select coalesce(sum(cost),0) from public.order_costs where business_id=$1) costs,
      (select coalesce(sum(total),0) from public.order_commissions where business_id=$1) commissions,
      (select count(*) from public.order_contacts where business_id=$1) contacts,
      (select count(*) from public.transactions where business_id=$1) payments,
      (select count(*) from public.memberships where business_id=$1) members`, [B]))[0];
  for (const k of Object.keys(BEFORE)) {
    ok('  ' + k + ' came back', String(BEFORE[k]) === String(AFTER[k]),
       'was ' + BEFORE[k] + ', now ' + AFTER[k]);
  }

  /* THE THING THE DRILL FOUND LAST TIME, asked again: the restore must not
     leave memberships pointing at accounts that do not exist. */
  const orphans = await one(`select count(*)::int from public.memberships m
     where m.business_id=$1 and not exists (select 1 from auth.users u where u.id = m.user_id)`, [B]);
  ok('  and no membership points at an account that is not there', orphans === 0,
     orphans + ' orphaned memberships');
}

section('9. Health is reportable without touching a payload');
{
  const h = await q(`select * from app.backup_health()`);
  ok('health lists every active studio',
     h.length === (await one(`select count(*)::int from public.businesses where status='active'`)),
     h.length + ' rows');
  /* A studio with no backup yet reports null rather than lying with a zero,
     so the assertion is about the ones that HAVE one. */
  const withBackups = h.filter(r => r.backups > 0);
  ok('  and every studio that has one reports its age and whether it verifies',
     withBackups.length > 0 && withBackups.every(r => r.hours_old !== null && r.intact === true),
     JSON.stringify(withBackups.map(r => [r.studio, r.hours_old, r.intact])));
  const cols = Object.keys(h[0] || {});
  ok('  and no payload in it', !cols.includes('payload'), cols.join(','));
}

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + failures.length + ' failed');
for (const f of failures) console.log('  - ' + f);
if (!failures.length) {
  console.log('\nThe backups are taken on a schedule, each is whole and its own\nstudio’s, a damaged one is noticed, a failing studio is reported,\nand a studio was restored from one of the automatic copies.');
}
process.exit(failures.length ? 1 : 0);
