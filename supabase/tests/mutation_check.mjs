/* Mutation testing: sabotage the migration in the five ways this actually
   goes wrong in real projects, and confirm the harness catches each one.
   A suite that cannot fail is decoration. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
import { execSync } from 'node:child_process';

const MIG = join(REPO, 'supabase', 'migrations', '20260827090000_tenant_isolation.sql');
const original = readFileSync(MIG, 'utf8');

const mutations = [
  {
    name: 'drop WITH CHECK from the generated UPDATE policy',
    why: 'the classic hole: a tenant can rewrite business_id and move its row to another tenant',
    apply: s => s.replace(
      "execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',\n                   t || '_update', t, pred, pred);",
      "execute format('create policy %I on public.%I for update to authenticated using (%s)',\n                   t || '_update', t, pred);")
  },
  {
    name: 'forget RLS on one tenant table',
    why: 'one table left open exposes every tenant on it',
    apply: s => s.replace(
      "    execute format('alter table public.%I enable row level security', t);",
      "    if t <> 'transactions' then execute format('alter table public.%I enable row level security', t); end if;")
  },
  {
    name: 'trust the row instead of the session (using true)',
    why: 'a policy that does not check the caller is not a policy',
    apply: s => s.replace(
      "    pred := case when has_branch\n                 then 'app.in_scope(business_id, branch_id)'\n                 else 'app.in_scope(business_id, null)'\n            end;",
      "    pred := 'true';")
  },
  {
    name: 'remove security_invoker from the view',
    why: 'a view then runs as its owner and returns every tenant',
    apply: s => s.replace('with (security_invoker = true) as', 'as')
  },
  {
    name: 'drop the composite FK pinning items to their order',
    why: 'children can then be stitched onto another tenant parent',
    apply: s => s.replace(
      `  constraint order_items_order_in_business
    foreign key (order_id, business_id)
    references public.orders(id, business_id) on delete cascade,`,
      '  constraint order_items_order_fk foreign key (order_id) references public.orders(id) on delete cascade,')
  }
];

let caughtAll = true;
console.log('Mutation testing the RLS harness\n' + '='.repeat(66));

for (const m of mutations) {
  const mutated = m.apply(original);
  if (mutated === original) {
    console.log('\nSKIP (mutation did not apply): ' + m.name);
    caughtAll = false;
    continue;
  }
  writeFileSync(MIG, mutated);
  let out = '', code = 0;
  try {
    out = execSync('node ' + JSON.stringify(join(HERE, 'rls_harness.mjs')), { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], cwd: HERE });
  } catch (e) {
    code = e.status ?? 1;
    out = (e.stdout || '') + (e.stderr || '');
  }
  const failLines = out.split('\n').filter(l => l.includes('FAIL'));
  const detected = code !== 0 || failLines.length > 0;
  console.log('\n' + (detected ? 'CAUGHT  ' : 'MISSED  ') + m.name);
  console.log('        risk: ' + m.why);
  if (detected) {
    const summary = out.split('\n').find(l => /\d+ passed, \d+ FAILED/.test(l));
    console.log('        ' + (summary ? summary.trim() : 'migration refused to apply'));
    failLines.slice(0, 4).forEach(l => console.log('        ' + l.trim()));
    if (failLines.length > 4) console.log('        ... and ' + (failLines.length - 4) + ' more');
  } else {
    caughtAll = false;
    console.log('        *** the suite did not notice this ***');
  }
}

writeFileSync(MIG, original);
console.log('\n' + '='.repeat(66));
console.log(caughtAll
  ? 'Every mutation was caught. The suite has teeth.'
  : 'At least one mutation slipped through; the suite needs another check.');
console.log('migration restored to original');
process.exit(caughtAll ? 0 : 1);
