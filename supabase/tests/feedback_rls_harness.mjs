/* =====================================================================
   Adversarial test of the feedback policies.

   This table holds what studios say to us, which sounds harmless until
   you consider what a leak actually exposes: one studio reading another
   studio's complaints tells them who is unhappy, who is struggling, and
   often who their staff are. And a message that can be edited after the
   fact is not a record of anything.

   So this suite attacks from three positions:

     - a studio reaching for ANOTHER studio's messages
     - a studio reaching for its OWN messages with a pen
     - a signed-out browser holding the anon key, which is public

   The second is the one worth dwelling on. Being able to read your own
   complaint is obviously fine. Being able to UPDATE it means the record
   of what was reported can be rewritten after we act on it, and being
   able to insert a reply as 'us' means a studio can forge a message from
   support. Both are refused here, and both are tested.

   Usage:  node supabase/tests/feedback_rls_harness.mjs
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
// Fixtures: two unrelated studios, each with an owner, and an outsider
// who belongs to neither.
// =====================================================================
const U = {
  ada:      'a0000000-0000-0000-0000-0000000000fb',
  bola:     'b0000000-0000-0000-0000-0000000000fb',
  outsider: '90000000-0000-0000-0000-0000000000fb'
};
const ids = {};

async function seed() {
  ids.bizA = (await asAdmin(
    `insert into businesses(name, slug) values ('Ada Atelier','ada-atelier') returning id`))[0].id;
  ids.bizB = (await asAdmin(
    `insert into businesses(name, slug) values ('Bola Shoes','bola-shoes') returning id`))[0].id;

  await asAdmin(
    `insert into memberships(user_id, business_id, role, status) values ($1,$2,'owner','active')`,
    [U.ada, ids.bizA]);
  await asAdmin(
    `insert into memberships(user_id, business_id, role, status) values ($1,$2,'owner','active')`,
    [U.bola, ids.bizB]);

  ids.msgA = (await asAdmin(
    `insert into feedback(business_id, kind, title, body, created_by)
     values ($1,'complaint','Orders vanished','Two orders disappeared after an update.',$2)
     returning id`, [ids.bizA, U.ada]))[0].id;
  ids.msgB = (await asAdmin(
    `insert into feedback(business_id, kind, title, body, created_by)
     values ($1,'feature','Shoe last library','Save lasts against a client.',$2)
     returning id`, [ids.bizB, U.bola]))[0].id;

  await asAdmin(
    `insert into feedback_replies(feedback_id, business_id, side, author, body)
     values ($1,$2,'us','Support','Looking into this now.')`, [ids.msgA, ids.bizA]);
}
await seed();

// =====================================================================
section('A studio can say something, and read back only its own');
// =====================================================================
{
  const r = await asUser(U.ada, `select ref, title from feedback order by created_at`);
  ok('Ada reads her own message', r.rows.length === 1 && r.rows[0].title === 'Orders vanished',
     r.error || 'saw ' + r.rows.length + ' rows');
  ok('Ada cannot read Bola’s message',
     !r.rows.some(x => x.title === 'Shoe last library'));

  const ins = await asUser(U.ada,
    `insert into feedback(business_id, kind, title, body) values ($1,'suggestion','Darker theme','Panels read light at night.') returning ref`,
    [ids.bizA]);
  ok('Ada can send a new message', !ins.error && /^TLB-\d+$/.test(ins.rows[0]?.ref || ''),
     ins.error || 'ref was ' + ins.rows[0]?.ref);

  const b = await asUser(U.bola, `select title from feedback`);
  ok('Bola sees only his own message', b.rows.length === 1 && b.rows[0].title === 'Shoe last library',
     b.error || 'saw ' + b.rows.length);
}

// =====================================================================
section('A studio cannot write on another studio’s behalf');
// =====================================================================
{
  const r = await asUser(U.ada,
    `insert into feedback(business_id, kind, title, body) values ($1,'complaint','Bola is terrible','Signed, definitely Bola.') returning id`,
    [ids.bizB]);
  ok('Ada cannot file a complaint AS Bola', !!r.error, 'the insert was allowed');

  const o = await asUser(U.outsider, `select count(*)::int as n from feedback`);
  ok('someone who belongs to no studio sees nothing', (o.rows[0]?.n ?? -1) === 0,
     o.error || 'saw ' + o.rows[0]?.n);

  const oi = await asUser(U.outsider,
    `insert into feedback(business_id, kind, title, body) values ($1,'support','Let me in','Please.') returning id`,
    [ids.bizA]);
  ok('an outsider cannot post into a studio they do not belong to', !!oi.error, 'the insert was allowed');
}

// =====================================================================
section('What was said stays said');
// =====================================================================
{
  const u = await asUser(U.ada,
    `update feedback set title = 'All fine actually', body = 'Never mind.' where id = $1`, [ids.msgA]);
  const still = await asAdmin(`select title from feedback where id = $1`, [ids.msgA]);
  ok('Ada cannot rewrite her own complaint after we act on it',
     !!u.error || still[0].title === 'Orders vanished',
     'title is now ' + still[0].title);

  const d = await asUser(U.ada, `delete from feedback where id = $1`, [ids.msgA]);
  const gone = await asAdmin(`select count(*)::int as n from feedback where id = $1`, [ids.msgA]);
  ok('Ada cannot delete her own complaint', !!d.error || gone[0].n === 1,
     'row count is ' + gone[0].n);

  const ds = await asUser(U.ada, `update feedback set state = 'resolved' where id = $1`, [ids.msgA]);
  const st = await asAdmin(`select state from feedback where id = $1`, [ids.msgA]);
  ok('a studio cannot mark its own ticket resolved', !!ds.error || st[0].state === 'new',
     'state is ' + st[0].state);
}

// =====================================================================
section('A studio cannot forge a reply from support');
// =====================================================================
{
  const r = await asUser(U.ada, `select side, body from feedback_replies where feedback_id = $1`, [ids.msgA]);
  ok('Ada can read our reply on her own thread', r.rows.length === 1 && r.rows[0].side === 'us',
     r.error || 'saw ' + r.rows.length);

  const own = await asUser(U.ada,
    `insert into feedback_replies(feedback_id, business_id, side, author, body)
     values ($1,$2,'them','Ada','Still happening today.') returning id`, [ids.msgA, ids.bizA]);
  ok('Ada can add to her own thread', !own.error, own.error);

  const forge = await asUser(U.ada,
    `insert into feedback_replies(feedback_id, business_id, side, author, body)
     values ($1,$2,'us','Support','We are giving you a refund.') returning id`, [ids.msgA, ids.bizA]);
  ok('Ada cannot post a reply that looks like it came from us', !!forge.error, 'the insert was allowed');

  const cross = await asUser(U.bola,
    `insert into feedback_replies(feedback_id, business_id, side, author, body)
     values ($1,$2,'them','Bola','Me too.') returning id`, [ids.msgA, ids.bizA]);
  ok('Bola cannot post into Ada’s thread', !!cross.error, 'the insert was allowed');

  const read = await asUser(U.bola, `select count(*)::int as n from feedback_replies`);
  ok('Bola cannot read Ada’s replies', (read.rows[0]?.n ?? -1) === 0,
     read.error || 'saw ' + read.rows[0]?.n);
}

// =====================================================================
section('The anon key, which is public, opens nothing');
// =====================================================================
{
  const r = await asAnon(`select count(*)::int as n from feedback`);
  ok('a signed-out browser cannot read feedback', !!r.error || (r.rows[0]?.n ?? -1) === 0,
     'saw ' + r.rows[0]?.n);
  const w = await asAnon(
    `insert into feedback(business_id, kind, title, body) values ($1,'support','anon','anon') returning id`,
    [ids.bizA]);
  ok('a signed-out browser cannot post feedback', !!w.error, 'the insert was allowed');
  const rr = await asAnon(`select count(*)::int as n from feedback_replies`);
  ok('a signed-out browser cannot read replies', !!rr.error || (rr.rows[0]?.n ?? -1) === 0,
     'saw ' + rr.rows[0]?.n);
  const v = await asAnon(`select count(*)::int as n from feedback_inbox`);
  ok('a signed-out browser cannot read the console’s inbox view', !!v.error || (v.rows[0]?.n ?? -1) === 0,
     'saw ' + v.rows[0]?.n);
}

// =====================================================================
section('Rubbish is refused at the door, not stored and dealt with later');
// =====================================================================
{
  const k = await asUser(U.ada,
    `insert into feedback(business_id, kind, title, body) values ($1,'rant','x','y')`, [ids.bizA]);
  ok('an unknown kind is refused', !!k.error, 'it was accepted');

  const e = await asUser(U.ada,
    `insert into feedback(business_id, kind, title, body) values ($1,'support','   ','y')`, [ids.bizA]);
  ok('a blank title is refused', !!e.error, 'it was accepted');

  const r = await asUser(U.ada,
    `insert into feedback(business_id, kind, title, body, rating) values ($1,'review','Great','Really good',9)`,
    [ids.bizA]);
  ok('a rating outside 1 to 5 is refused', !!r.error, 'it was accepted');

  const s = await asUser(U.ada,
    `insert into feedback(business_id, kind, title, body, state) values ($1,'support','x','y','invented')`,
    [ids.bizA]);
  ok('an invented state is refused', !!s.error, 'it was accepted');

  const long = 'x'.repeat(5000);
  const l = await asUser(U.ada,
    `insert into feedback(business_id, kind, title, body) values ($1,'support','Long',$2)`, [ids.bizA, long]);
  ok('a body over the limit is refused', !!l.error, 'it was accepted');
}

// =====================================================================
section('Our own console reads it through the service role, and only there');
// =====================================================================
{
  const rows = await asAdmin(`select ref, business_name, reply_count from feedback_inbox order by created_at`);
  ok('the inbox view shows every studio to the service role', rows.length >= 2,
     'saw ' + rows.length);
  ok('the inbox names the studio, so support knows who wrote in',
     rows.every(r => !!r.business_name));
  ok('the inbox counts replies', rows.some(r => Number(r.reply_count) > 0));

  // and a signed-in tenant reading the same view still sees only itself
  const t = await asUser(U.bola, `select count(*)::int as n from feedback_inbox`);
  ok('a studio reading the inbox view sees only its own rows', (t.rows[0]?.n ?? -1) === 1,
     t.error || 'saw ' + t.rows[0]?.n);
}

// =====================================================================
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED\n');
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('\nFeedback is not isolated. Do not ship this.');
  process.exit(1);
}
console.log(pass + ' passed, 0 failed\n');
console.log('Feedback holds: a studio can say something and read its own thread,');
console.log('cannot read or write another studio’s, cannot rewrite what it said,');
console.log('and cannot forge a reply from us.');
