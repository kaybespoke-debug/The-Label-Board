/* Does account_directory say the right thing, and is it shut to everybody but
   us? Runs the real migrations at a real Postgres.

   Note on the setup: there is a trigger on auth.users that gives a brand new
   account a studio of its own, and another that claims a pending partner. So
   creating a user does NOT produce a blank slate, and the tidying below is not
   ceremony: without it every account in this test is a studio user and the
   flags all read true for the wrong reason. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.cwd();
let pass = 0; const fails = [];
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fails.push(n); console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } }

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8')); }
  catch (e) { console.log('  ..    skipped ' + f + ' (' + String(e.message).split('\n')[0] + ')'); }
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const one = async (s, p = []) => { const r = await q(s, p); return r.length ? Object.values(r[0])[0] : null; };

const D = '@zz-directory.invalid';
async function blankUser(local) {
  const id = await one(
    `insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), $1, now()) returning id`,
    [local + D]);
  /* undo whatever the signup triggers handed it, so each case below is the
     one thing it says it is */
  await db.query(`delete from public.memberships where user_id = $1`, [id]);
  await db.query(`delete from public.profiles   where id = $1`, [id]);
  await db.query(`delete from public.partners   where user_id = $1`, [id]);
  return id;
}

const op = await blankUser('operator');
const partner = await blankUser('partner');
const owner = await blankUser('owner');
const both = await blankUser('both');
await blankUser('nobody');

await db.query(`insert into public.platform_admins (id, email, name, role, active) values ($1,$2,'Op','owner',true)`, [op, 'operator' + D]);
const biz = await one(`insert into public.businesses (name, slug, plan, status) values ('Directory Studio','directory-studio','starter','active') returning id`);
await db.query(`insert into public.memberships (business_id, user_id, role, status) values ($1,$2,'owner','active')`, [biz, owner]);
await db.query(`insert into public.memberships (business_id, user_id, role, status) values ($1,$2,'owner','active')`, [biz, both]);
await db.query(`insert into public.partners (user_id, code, name, email) values ($1,'PCODE','P',$2)`, [partner, 'partner' + D]);
await db.query(`insert into public.partners (user_id, code, name, email) values ($1,'BOTHCODE','B',$2)`, [both, 'both' + D]);

console.log('\naccount_directory says what each account is');
const row = async local => (await q(`select * from public.account_directory where email = $1`, [local + D]))[0];

const o = await row('operator');
ok('an operator is flagged as one', o.is_operator === true);
ok('and its console role is shown  (' + o.operator_role + ')', o.operator_role === 'owner');
ok('and it is neither a studio nor a partner', o.is_partner === false && o.is_studio_user === false);
ok('belongs_to reads operator  (' + o.belongs_to + ')', o.belongs_to === 'operator');

const p = await row('partner');
ok('a partner is flagged as one', p.is_partner === true);
ok('and its code is shown  (' + p.partner_code + ')', p.partner_code === 'PCODE');
ok('belongs_to reads partner  (' + p.belongs_to + ')', p.belongs_to === 'partner');

const w = await row('owner');
ok('a studio owner is flagged as one', w.is_studio_user === true);
ok('and the studio is named  (' + w.studio + ')', w.studio === 'Directory Studio');
ok('and the role inside it  (' + w.studio_role + ')', w.studio_role === 'owner');
ok('belongs_to reads studio  (' + w.belongs_to + ')', w.belongs_to === 'studio');

const b = await row('both');
ok('somebody who is two things is shown as two  (' + b.belongs_to + ')', b.belongs_to === 'partner + studio');
ok('which is exactly what Make a partner creates', b.is_partner && b.is_studio_user);

const n = await row('nobody');
ok('an account with nothing behind it reads unattached  (' + n.belongs_to + ')', n.belongs_to === 'unattached');
ok('which is what an unfinished invitation looks like', !n.is_operator && !n.is_partner && !n.is_studio_user);

console.log('\nAnd nobody but us can read it');
for (const who of ['anon', 'authenticated']) {
  const granted = await one(
    `select count(*) from information_schema.role_table_grants
      where table_schema='public' and table_name='account_directory' and grantee=$1`, [who]);
  ok('not readable by ' + who + '  (' + granted + ')', Number(granted) === 0);
}
const svc = await one(
  `select count(*) from information_schema.role_table_grants
    where table_schema='public' and table_name='account_directory'
      and grantee='service_role' and privilege_type='SELECT'`);
ok('and it IS readable by service_role', Number(svc) === 1);

console.log('\n' + (fails.length ? fails.length + ' FAILED: ' + fails.join('; ') : pass + ' passed, 0 failed'));
process.exit(fails.length ? 1 : 0);
