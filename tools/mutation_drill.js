/* =====================================================================
   BREAK THE SECURITY ON PURPOSE, AND CHECK SOMETHING NOTICES.
   =====================================================================
   The independent audit's process finding: five of ten deliberate
   security mutations were caught by nobody. Not because the rules were
   wrong — the probes proved the rules — but because the suite you run
   before a release did not include the checks that would have failed.

   A gate nobody runs is documentation. This runs the five mutations the
   audit named, against a throwaway database built from the migrations,
   and asserts that the relevant suite FAILS for each one. Then it puts
   the schema back and asserts it passes again.

   Nothing here touches staging or production. Each mutation is applied
   to a PGlite database that exists for the length of one check and is
   discarded, so there is no state to restore and nothing to leave
   behind — which is the other half of the audit's finding, that the
   temporary mutations must not survive in source.

   usage: node tools/mutation_drill.js
   ===================================================================== */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = process.cwd();
/* NOT IN supabase/migrations. The mutations deliberately weaken security, and
   a drill killed halfway used to leave one there — in the directory every
   apply reads, named so it sorts last, so the next person to run the
   migrations would have applied it. It never reached git, because the drill's
   own guard refused to start and said so, but "it was caught" is not the same
   as "it was safe". The file goes somewhere no migration runner looks, and
   the suites are told where by TLB_MUTATION_SQL. */
const SCRATCH = process.env.TEMP || process.env.TMPDIR || '/tmp';
const STAMP_PATH = path.join(SCRATCH, 'tlb-mutation-drill.sql');

let pass = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  PASS  ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };

/* The five the audit named, each with the suite that ought to object. */
const MUTATIONS = [
  {
    name: 'app.can() always says yes',
    sql: `create or replace function app.can(p_business uuid, p_perm text)
          returns boolean language sql stable security definer
          set search_path = public, pg_temp as $m$ select true $m$;`,
    caught_by: 'supabase/tests/intra_tenant_harness.mjs',
  },
  {
    name: 'app_state readable whatever the key',
    sql: `create or replace function app.may_read_key(p_business uuid, p_key text)
          returns boolean language sql stable security definer
          set search_path = public, pg_temp as $m$
            select app.in_scope(p_business, null) $m$;`,
    caught_by: 'supabase/tests/intra_tenant_harness.mjs',
  },
  {
    name: 'order_costs readable without seeCost',
    sql: `drop policy if exists order_costs_select on public.order_costs;
          create policy order_costs_select on public.order_costs for select to authenticated
            using (app.in_scope(business_id, null));`,
    caught_by: 'supabase/tests/orders_migration_harness.mjs',
  },
  {
    name: 'customer_contacts readable without seeContact',
    sql: `drop policy if exists customer_contacts_select on public.customer_contacts;
          create policy customer_contacts_select on public.customer_contacts for select to authenticated
            using (app.in_scope(business_id, null));`,
    caught_by: 'supabase/tests/intra_tenant_harness.mjs',
  },
  {
    /* THE OCTOBER PAIR. These two policies are the whole of the money
       boundary: without them a head of production reads what every order
       sold for, and a staff member reads what every client still owes.
       Both were readable by anybody with `orders` until this release, so
       a gate that cannot tell the difference is a gate that would have
       passed then too. */
    name: 'order_pricing readable without money',
    sql: `drop policy if exists order_pricing_select on public.order_pricing;
          create policy order_pricing_select on public.order_pricing for select to authenticated
            using (app.in_scope(business_id, null));`,
    caught_by: 'supabase/tests/orders_migration_harness.mjs',
  },
  {
    name: 'order_settlement readable without receivables',
    sql: `drop policy if exists order_settlement_select on public.order_settlement;
          create policy order_settlement_select on public.order_settlement for select to authenticated
            using (app.in_scope(business_id, null));`,
    caught_by: 'supabase/tests/orders_migration_harness.mjs',
  },
  {
    /* And the one that would put the money back where it came from. The
       trigger is what makes a stale client harmless: it strips the price
       out of the document on the way in, every write, for ever. */
    name: 'the order document may carry the price again',
    sql: `create or replace function app.order_doc_carries_no_secrets()
          returns trigger language plpgsql security invoker
          set search_path = public, pg_temp as $fn$
          begin
            return new;
          end $fn$;`,
    caught_by: 'supabase/tests/orders_migration_harness.mjs',
  },
  {
    name: 'the audit trail can be edited',
    sql: `drop policy if exists audit_log_update on public.audit_log;
          create policy audit_log_update on public.audit_log for update to authenticated
            using (app.in_scope(business_id, null)) with check (true);
          drop policy if exists audit_log_delete on public.audit_log;
          create policy audit_log_delete on public.audit_log for delete to authenticated
            using (app.in_scope(business_id, null));
          grant update, delete on public.audit_log to authenticated;`,
    caught_by: 'supabase/tests/intra_tenant_harness.mjs',
  },
];

function runSuite(file, mutationPath) {
  const r = spawnSync('node', [file], {
    encoding: 'utf8', shell: process.platform === 'win32',
    env: Object.assign({}, process.env,
      mutationPath ? { TLB_MUTATION_SQL: mutationPath } : { TLB_MUTATION_SQL: '' }),
  });
  return r.status === 0;
}

/* The mutation is a migration file that sorts last, so it is applied after
   everything it is meant to undo. It is deleted in a finally, and the drill
   refuses to start if one is already lying about from a crashed run. */
/* A leftover is now harmless — nothing reads that directory — so it is
   cleared rather than refused. The guard that matters is below: the drill
   also refuses to run if a mutation file has somehow appeared among the real
   migrations, which is the state that was dangerous. */
if (fs.existsSync(STAMP_PATH)) fs.unlinkSync(STAMP_PATH);
{
  const stray = fs.readdirSync(path.join(repo, 'supabase/migrations'))
                  .filter(f => /mutation_drill|TEMPORARY/i.test(f));
  if (stray.length) {
    console.error('There is a mutation file among the real migrations:\n  ' +
      stray.join('\n  ') + '\nDelete it before doing anything else. It weakens security and it must never be applied or committed.');
    process.exit(1);
  }
}

console.log('=== BREAKING THE SECURITY ON PURPOSE ===\n');
console.log('Each mutation is applied to a throwaway database built from the');
console.log('migrations, and the named suite must go red. Nothing persists.\n');

try {
  /* baseline: everything green before any of this */
  const suites = [...new Set(MUTATIONS.map(m => m.caught_by))];
  for (const s of suites) {
    ok('before any mutation, ' + path.basename(s) + ' passes', runSuite(s), 'it was already failing');
  }
  if (fails.length) {
    console.log('\nThe drill cannot mean anything while a suite is already red.');
    process.exit(1);
  }

  for (const m of MUTATIONS) {
    fs.writeFileSync(STAMP_PATH,
      '-- TEMPORARY. Written by tools/mutation_drill.js and deleted by it.\n' +
      '-- It is deliberately insecure. If you are reading this anywhere that\n' +
      '-- applies migrations, something went wrong.\n' + m.sql + '\n');
    const green = runSuite(m.caught_by, STAMP_PATH);
    fs.unlinkSync(STAMP_PATH);
    ok('"' + m.name + '" is caught by ' + path.basename(m.caught_by),
       !green, 'the suite passed with the security deliberately broken');
  }

  /* and back to normal */
  for (const s of suites) {
    ok('with the mutations gone, ' + path.basename(s) + ' passes again', runSuite(s));
  }
} finally {
  if (fs.existsSync(STAMP_PATH)) fs.unlinkSync(STAMP_PATH);
}

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fails.length + ' failed');
for (const f of fails) console.log('  - ' + f);
if (!fails.length) console.log('\nEvery one of the ' + MUTATIONS.length + ' breaks something. The gates are load-bearing.');
console.log('\nno mutation file left behind: ' + !fs.existsSync(STAMP_PATH));
process.exit(fails.length ? 1 : 0);
