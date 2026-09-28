/* Every object the migrations produce, as one sorted list.
 *
 * This exists because it has now happened twice that SQL was applied straight
 * at a Supabase project and the migration that was supposed to carry it went
 * out of step. The first time it was five objects. The second time it was
 * sixteen, including the two columns and six functions the whole
 * audit-authenticity claim rests on — so a probe was proving that a client
 * could not forge a server event against a column that a fresh project would
 * not have had.
 *
 * Nothing in the repo referenced those objects by name, so no gate that reads
 * the app could have found them. Only counting both sides finds them.
 *
 *   node supabase/tests/schema_inventory.mjs               rewrite the snapshot
 *   node supabase/tests/schema_inventory.mjs --check       fail if it moved
 *   node supabase/tests/schema_inventory.mjs --fingerprint one md5 to compare
 *   node supabase/tests/schema_inventory.mjs --sql         the query to run live
 *
 * The snapshot in supabase/schema_inventory.txt is what a database built from
 * the migrations alone contains. To check a LIVE project, run the --sql query
 * there and compare its md5 with --fingerprint: one number, and if it differs,
 * diff the two lists to see which objects. That is the whole drift check.
 *
 * Staging and the migrations agreed on 4839a6f993b9ba2415da3f07c40cd874 over
 * 830 objects on 29 September 2026, which is the first time anybody had
 * checked.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..', '..');
const snapshot = join(repo, 'supabase/schema_inventory.txt');

const LIVE_SQL = `with l as (
  select 'col ' || table_name || '.' || column_name as t from information_schema.columns where table_schema='public'
  union all select 'fn app.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app'
  union all select 'fn public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all select 'pol ' || tablename || '.' || policyname from pg_policies where schemaname='public'
  union all select 'trg ' || c.relname || '.' || t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
)
select string_agg(t, chr(10) order by t) from l;`;

if (process.argv.includes('--sql')) {
  console.log(LIVE_SQL);
  process.exit(0);
}

const db = await PGlite.create();
await db.exec(readFileSync(join(repo, 'supabase/tests/auth_stub.sql'), 'utf8'));
const dir = join(repo, 'supabase/migrations');
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(dir, f), 'utf8')); }
  catch (e) { console.error('  ' + f + ': FAILED — ' + e.message.split('\n')[0]); process.exit(1); }
}

const lines = [];
const add = (rows, fn) => { for (const r of rows) lines.push(fn(r)); };
add((await db.query(`select table_name t, column_name c from information_schema.columns
  where table_schema='public'`)).rows, r => 'col ' + r.t + '.' + r.c);
add((await db.query(`select p.proname p, pg_get_function_identity_arguments(p.oid) a
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app'`)).rows,
  r => 'fn app.' + r.p + '(' + r.a + ')');
add((await db.query(`select p.proname p, pg_get_function_identity_arguments(p.oid) a
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows,
  r => 'fn public.' + r.p + '(' + r.a + ')');
add((await db.query(`select tablename t, policyname p from pg_policies where schemaname='public'`)).rows,
  r => 'pol ' + r.t + '.' + r.p);
add((await db.query(`select c.relname t, g.tgname g from pg_trigger g join pg_class c on c.oid=g.tgrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not g.tgisinternal`)).rows,
  r => 'trg ' + r.t + '.' + r.g);

const text = lines.sort().join('\n') + '\n';

if (process.argv.includes('--fingerprint')) {
  const { createHash } = await import('node:crypto');
  console.log(createHash('md5').update(text.replace(/\n$/, '')).digest('hex')
    + '  ' + lines.length + ' objects');
  process.exit(0);
}

if (process.argv.includes('--check')) {
  if (!existsSync(snapshot)) {
    console.error('No snapshot yet. Run without --check to write one.');
    process.exit(1);
  }
  const was = readFileSync(snapshot, 'utf8');
  if (was === text) {
    console.log(lines.length + ' objects, unchanged.');
    process.exit(0);
  }
  const a = new Set(was.trim().split('\n'));
  const b = new Set(text.trim().split('\n'));
  const gone = [...a].filter(x => !b.has(x));
  const added = [...b].filter(x => !a.has(x));
  console.log('The migrations no longer produce what the snapshot records.');
  for (const x of gone) console.log('  - ' + x);
  for (const x of added) console.log('  + ' + x);
  console.log('\nIf this was deliberate, rerun without --check and commit the snapshot.');
  process.exit(1);
}

writeFileSync(snapshot, text);
console.log(lines.length + ' objects written to supabase/schema_inventory.txt');
