/* The storage cap and the photo wall, tested where they actually live.
 *
 * This is the suite that has to be right, because storage is the only thing
 * left protecting margin on Pro. Pro sells unlimited staff, so seats no
 * longer bound anything; a studio's bill to us is its photo library and the
 * cost of serving it.
 *
 * And the browser talks to the Storage API DIRECTLY. There is no server of
 * ours in the path — no gateway, no edge function, nothing to check a plan.
 * A tenant holding their own anon key and their own session can POST at
 * /storage/v1/object/studio-media/<anything> all day. So these four policies
 * are not a second line of defence behind the app; they are the ONLY line.
 * A cap that lives in JavaScript is a number a determined customer edits.
 *
 * Two properties matter more than the rest, and both are here:
 *
 *   1. A studio cannot write into, read from, or delete out of another
 *      studio's folder, however the path is spelled — no prefix, a prefix
 *      that is not a uuid, or one dressed up with ../ to look like theirs.
 *
 *   2. Running out of storage must never cost a studio their business.
 *      Uploads pause. Orders, clients, finance, payments and every other
 *      text record keep working, and every photo already there stays
 *      readable. A cap that takes the books down is not a cap, it is an
 *      outage we billed for.
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
   table created in public is as reachable here as it is there. */
await db.exec(`
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
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
const admin = async (sql, params = []) => (await db.query(sql, params)).rows;

/* ---- two studios, two owners, nothing shared --------------------------- */
const [ada, nneka] = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
];
const [bizA, bizB] = [
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
];
await admin(`insert into auth.users (id,email) values ($1,'ada@example.com'),($2,'nneka@example.com')`, [ada, nneka]);
/* Names and slugs the seed migration does not already use, or the insert
   collides with the six studios it creates. */
await admin(`insert into public.businesses (id,name,slug,plan,status) values
  ($1,'Storage Test One','storage-test-one','starter','active'),
  ($2,'Storage Test Two','storage-test-two','pro','active')
  on conflict (id) do update set plan = excluded.plan`, [bizA, bizB]);
await admin(`insert into public.memberships (user_id,business_id,role,status) values
  ($1,$3,'owner','active'),($2,$4,'owner','active')
  on conflict do nothing`, [ada, nneka, bizA, bizB]);

const put = (user, biz, file, size) =>
  asRole('authenticated', user,
    `insert into storage.objects (bucket_id,name,owner,metadata)
     values ('studio-media', $1, $2, jsonb_build_object('size', $3::bigint))`,
    [biz + '/progress/' + file, user, size]);

const putRaw = (user, path, size) =>
  asRole('authenticated', user,
    `insert into storage.objects (bucket_id,name,owner,metadata)
     values ('studio-media', $1, $2, jsonb_build_object('size', $3::bigint))`,
    [path, user, size]);

const usedBytes = async biz =>
  Number((await admin(`select storage_used_bytes u from public.businesses where id=$1`, [biz]))[0].u);

// ---------------------------------------------------------------------
section('The bucket is private and shaped as intended');
// ---------------------------------------------------------------------
{
  const b = await admin(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='studio-media'`);
  ok('the studio-media bucket exists', b.length === 1);
  ok('and is PRIVATE — a client measurement photo is not world-readable by URL',
    b[0] && b[0].public === false);
  ok('and caps a single file, so an over-cap overshoot is bounded',
    b[0] && Number(b[0].file_size_limit) > 0 && Number(b[0].file_size_limit) <= 20 * 1024 * 1024,
    String(b[0] && b[0].file_size_limit));
  ok('and accepts images only', b[0] && (b[0].allowed_mime_types || []).includes('image/webp'));
}

// ---------------------------------------------------------------------
section('A studio writes only into its own folder');
// ---------------------------------------------------------------------
{
  const own = await put(ada, bizA, 'own.webp', 150000);
  ok('a studio can upload into its own folder', own.error === null, own.error);

  const other = await put(ada, bizB, 'stolen.webp', 150000);
  ok('and CANNOT upload into another studio\'s folder', other.error !== null,
    'the insert was allowed — one studio can write photos into another\'s account');

  /* Every way of spelling a path that is not theirs. media_business_of()
     returns NULL for anything whose first segment is not a uuid, and
     in_scope(NULL) is false, so all of these fail closed rather than
     landing in an unowned folder nobody is billed for. */
  for (const [label, path] of [
    ['with no business prefix at all', 'progress/loose.webp'],
    ['with a non-uuid prefix', 'not-a-uuid/progress/x.webp'],
    ['dressed up with ../ to look like theirs', '../' + bizB + '/progress/x.webp'],
    ['with an empty first segment', '/progress/x.webp']
  ]) {
    const r = await putRaw(ada, path, 1000);
    ok('a path ' + label + ' is refused', r.error !== null, path);
  }
}

// ---------------------------------------------------------------------
section('A studio reads and deletes only its own');
// ---------------------------------------------------------------------
{
  await admin(`insert into storage.objects (bucket_id,name,owner,metadata)
    values ('studio-media', $1, $2, '{"size":90000}'::jsonb) on conflict do nothing`,
    [bizB + '/progress/nneka-private.webp', nneka]);

  const mine = await asRole('authenticated', ada,
    `select name from storage.objects where bucket_id='studio-media'`);
  ok('a studio sees its own objects', mine.rows.length > 0);
  ok('and NONE of another studio\'s',
    mine.rows.every(r => r.name.startsWith(bizA + '/')),
    mine.rows.map(r => r.name).join(', '));

  const theirs = await asRole('authenticated', nneka,
    `select name from storage.objects where bucket_id='studio-media'`);
  ok('and the wall stands in both directions',
    theirs.rows.length > 0 && theirs.rows.every(r => r.name.startsWith(bizB + '/')));

  const del = await asRole('authenticated', ada,
    `delete from storage.objects where bucket_id='studio-media' and name like $1`, [bizB + '/%']);
  const stillThere = await admin(`select count(*) c from storage.objects where name like $1`, [bizB + '/%']);
  ok('one studio cannot delete another\'s photos', Number(stillThere[0].c) > 0);

  const anon = await asRole('anon', null, `select name from storage.objects where bucket_id='studio-media'`);
  ok('and a signed-out caller sees nothing at all',
    anon.rows.length === 0, String(anon.rows.length) + ' rows visible to anon');
}

// ---------------------------------------------------------------------
section('The running total is kept by the database, not the app');
// ---------------------------------------------------------------------
/* The app could send us any number it liked. The counter the cap reads is
   maintained by a trigger on the objects themselves, so it reflects what is
   actually stored rather than what a client claimed to store. */
{
  const before = await usedBytes(bizA);
  await put(ada, bizA, 'counted-1.webp', 250000);
  const after = await usedBytes(bizA);
  ok('an upload increases the studio\'s used bytes', after === before + 250000,
    before + ' -> ' + after);

  await asRole('authenticated', ada,
    `delete from storage.objects where bucket_id='studio-media' and name=$1`,
    [bizA + '/progress/counted-1.webp']);
  const afterDel = await usedBytes(bizA);
  ok('and deleting a photo gives the space back', afterDel === before, String(afterDel));

  await admin(`select public.recount_storage_usage()`);
  const recounted = await usedBytes(bizA);
  const summed = Number((await admin(
    `select coalesce(sum((metadata->>'size')::bigint),0) s from storage.objects
     where bucket_id='studio-media' and name like $1`, [bizA + '/%']))[0].s);
  ok('and a recount agrees with the objects on disk', recounted === summed,
    recounted + ' vs ' + summed);
}

// ---------------------------------------------------------------------
section('The cap is enforced in the database');
// ---------------------------------------------------------------------
{
  const capA = Number((await admin(`select app.storage_cap_for($1) c`, [bizA]))[0].c);
  const capB = Number((await admin(`select app.storage_cap_for($1) c`, [bizB]))[0].c);
  ok('Basic is capped at 20 GB', capA === 20e9, String(capA));
  ok('Pro is capped at 200 GB', capB === 200e9, String(capB));
  ok('and Pro gets more room than Basic', capB > capA);

  // fill Basic right up
  await admin(`update public.businesses set storage_used_bytes = $2 where id = $1`, [bizA, 20e9]);
  const over = await put(ada, bizA, 'one-too-many.webp', 150000);
  ok('a studio at its cap cannot upload another photo', over.error !== null,
    'the upload was allowed despite the studio being full');

  /* The forged request. This is the whole point of putting the cap in a
     policy: there is no app in the way, and it still fails. */
  ok('and that refusal comes from the database, not the app',
    /row-level security|violates/i.test(over.error || ''), over.error);

  // deleting must still work, or the cap is a trap
  const freeUp = await asRole('authenticated', ada,
    `delete from storage.objects where bucket_id='studio-media' and name like $1`, [bizA + '/%']);
  ok('a full studio can still DELETE to make room', freeUp.error === null, freeUp.error);

  await admin(`update public.businesses set storage_used_bytes = 0 where id = $1`, [bizA]);
  const again = await put(ada, bizA, 'after-clearing.webp', 150000);
  ok('and can upload again once it has', again.error === null, again.error);
}

// ---------------------------------------------------------------------
section('Running out of storage never takes the business down');
// ---------------------------------------------------------------------
/* The rule from the brief, made a test: at 100% they can still use
   everything and view what is already there. Only new photo uploads pause.
   A studio that cannot record an order because it has too many photos would
   be a far worse product than one that never had photos. */
{
  await admin(`update public.businesses set storage_used_bytes = $2 where id = $1`, [bizA, 25e9]);
  ok('the studio is over its cap for this test',
    (await admin(`select app.storage_has_room($1) r`, [bizA]))[0].r === false);

  const order = await asRole('authenticated', ada,
    `insert into public.app_state (business_id,key,data) values ($1,'layi_dash_orders','[{"id":"o1"}]'::jsonb)
     on conflict (business_id,key) do update set data = excluded.data`, [bizA]);
  ok('a FULL studio can still save an order', order.error === null, order.error);

  const cust = await asRole('authenticated', ada,
    `insert into public.customers (business_id,name) values ($1,'A Client')`, [bizA]);
  ok('and still add a client', cust.error === null, cust.error);

  const read = await asRole('authenticated', ada,
    `select name from storage.objects where bucket_id='studio-media' and name like $1`, [bizA + '/%']);
  ok('and still see every photo it already had', read.error === null && read.rows.length > 0,
    read.error || (read.rows.length + ' visible'));

  const upload = await put(ada, bizA, 'blocked.webp', 100000);
  ok('while only the new upload is refused', upload.error !== null);
}

// ---------------------------------------------------------------------
section('Selling more space, without moving anybody else');
// ---------------------------------------------------------------------
{
  await admin(`select public.set_studio_storage_cap($1, 500, 'Agreed 500GB, invoiced monthly')`, [bizA]);
  const raised = Number((await admin(`select app.storage_cap_for($1) c`, [bizA]))[0].c);
  ok('an override raises one studio\'s cap', raised === 500e9, String(raised));
  ok('and is recorded with why', (await admin(
    `select storage_cap_note n from public.businesses where id=$1`, [bizA]))[0].n.includes('500GB'));

  const others = Number((await admin(`select app.storage_cap_for($1) c`, [bizB]))[0].c);
  ok('and nobody else moved', others === 200e9, String(others));

  const nowFits = await put(ada, bizA, 'after-upgrade.webp', 150000);
  ok('the studio that bought space can upload again', nowFits.error === null, nowFits.error);

  await admin(`select public.set_studio_storage_cap($1, null, null)`, [bizA]);
  ok('and clearing the override returns them to their plan\'s cap',
    Number((await admin(`select app.storage_cap_for($1) c`, [bizA]))[0].c) === 20e9);

  /* Only we can do this. A tenant granting themselves a terabyte would make
     the whole exercise decorative. */
  const self = await asRole('authenticated', ada, `select public.set_studio_storage_cap($1, 9999)`, [bizA]);
  ok('a tenant CANNOT raise their own cap', self.error !== null, 'a studio granted itself more storage');
  const anonSet = await asRole('anon', null, `select public.set_studio_storage_cap($1, 9999)`, [bizA]);
  ok('and neither can a signed-out caller', anonSet.error !== null);

  const capRead = await asRole('authenticated', ada,
    `update public.businesses set storage_cap_bytes = 9999999999999 where id = $1`, [bizA]);
  const capNow = Number((await admin(`select coalesce(storage_cap_bytes,0) c from public.businesses where id=$1`, [bizA]))[0].c);
  ok('nor by writing the column directly', capNow !== 9999999999999,
    'a studio set its own storage_cap_bytes');
}

// ---------------------------------------------------------------------
section('A studio can see how full it is');
// ---------------------------------------------------------------------
{
  await admin(`update public.businesses set storage_used_bytes = $2 where id = $1`, [bizA, 16e9]);
  const u = await asRole('authenticated', ada, `select * from public.my_storage_usage()`);
  ok('a studio can read its own usage', u.error === null && u.rows.length > 0, u.error);

  /* Ada belongs to more than one business here, and legitimately: creating
     the auth.users row fires app.provision_studio(), which gives every new
     account a studio of its own. So the invariant is not "exactly one row" —
     it is "every row is a business they actually belong to, and no others". */
  const mine = (await admin(`select business_id from public.memberships where user_id=$1 and status='active'`, [ada]))
    .map(r => r.business_id);
  ok('and sees every studio they belong to, and only those',
    u.rows.length === mine.length && u.rows.every(r => mine.includes(r.business_id)),
    'returned ' + u.rows.length + ' of ' + mine.length);

  const row = u.rows.find(r => r.business_id === bizA);
  ok('their own studio is in it', !!row);
  ok('with a percentage the app can warn on at 80%', row && Number(row.pct) === 80,
    row && String(row.pct));
  ok('and the cap it is measured against', row && Number(row.cap_bytes) === 20e9,
    row && String(row.cap_bytes));

  // and nothing about anybody else's
  ok('and nothing about a studio they are not in',
    !u.rows.some(r => r.business_id === bizB));
  const anonU = await asRole('anon', null, `select * from public.my_storage_usage()`);
  ok('a signed-out caller learns nothing', anonU.error !== null || anonU.rows.length === 0);
}

console.log('\n' + '='.repeat(66));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL ' + pass + ' CHECKS PASSED');
console.log('Photos are walled per studio, the cap is enforced by the database');
console.log('rather than the app, and a full studio keeps its books.');
console.log('='.repeat(66));
