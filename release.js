#!/usr/bin/env node
/* =====================================================================
   ONE COMMAND THAT RUNS EVERYTHING.
   =====================================================================
   The independent audit's process finding was not that a rule was wrong.
   It was that FIVE OF TEN deliberate security mutations were caught by
   nobody — because the checks that would have caught them were suites you
   had to remember to run, in three different places, one of which needed
   a staging session and was therefore never part of a release.

   A gate you have to remember is not a gate.

       node release.js              everything that runs offline
       node release.js --staging    the above, plus the real-session probes
       node release.js --quick      the app gates only, for a fast loop

   Anything that fails stops the release. There is no "known failure"
   list, because the moment there is one nobody reads the output.
   ===================================================================== */
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const STAGING = args.includes('--staging');

/* Offline: no network, no credentials, runs anywhere. */
const APP = [
  ['node', ['verify.js'], 'the customer app, 25 gates'],
  ['node', ['audit_safearea.js'], 'nothing pinned under a phone’s furniture'],
  ['node', ['audit_web.js'], 'the public website'],
  ['node', ['audit_partners.js'], 'the partner portal, statically'],
];

/* The database, built from the migrations alone in PGlite. */
const DB = [
  'app_schema_harness', 'rls_harness', 'intra_tenant_harness', 'feedback_rls_harness', 'partner_rls_harness',
  'tlb_policy_harness', 'onboarding_harness', 'billing_harness', 'plan_limits_harness',
  'partner_commission_harness', 'referral_fraud_harness', 'plan_feature_harness',
  'trial_harness', 'account_directory_harness', 'storage_rls_harness',
  'lifecycle_harness', 'restore_harness', 'subscription_harness', 'cross_app_harness',
  'upgrade_harness', 'orders_migration_harness', 'money_concurrency_harness',
  'recovery_drill', 'backup_harness', 'partner_portal_harness',
  'team_invite_harness', 'materials_harness',
].map(n => ['node', ['supabase/tests/' + n + '.mjs'], n.replace(/_/g, ' ')]);

const INVENTORY = [
  ['node', ['supabase/tests/schema_inventory.mjs', '--check'], 'the migrations still produce what is recorded'],
];

/* Real sessions against staging. These are the ones that were never in a
   release command, which is the whole reason the mutations survived.

   THEY SHARE FIXTURES AND MUST NOT RUN CONCURRENTLY with each other or with
   anything else pointed at staging. They sign the same seeded people into
   the same seeded studios and clean up after themselves; two at once is two
   suites clearing each other's members mid-run. A "per-key permissions"
   failure that passes when run alone is almost always this. They run in
   series here deliberately — do not be tempted to parallelise them for the
   ten minutes it would save. */
const STAGING_PROBES = [
  ['node', ['tools/credential_probe.js'], 'no credential reachable by a membership'],
  ['node', ['tools/sensitive_data_probe.js'], 'costs, contacts and an honest audit trail'],
  ['node', ['tools/rbac_phase0_probe.js'], 'role authority'],
  ['node', ['tools/rbac_batch_a_probe.js'], 'membership authority'],
  ['node', ['tools/rbac_batch_b_probe.js'], 'per-key permissions'],
  ['node', ['tools/rbac_batch_c_probe.js'], 'invitations and seats'],
  ['node', ['tools/branch_scope_probe.js'], 'branch scope'],
  ['node', ['tools/order_migration_probe.js'], 'orders relational, six roles'],
  ['node', ['tools/forged_tenant_probe.js'], 'a forged tenant is a claim, not authority'],
  ['node', ['tools/money_role_probe.js'], 'the price and the paid figure, five roles'],
  ['node', ['tools/auth_recovery_probe.js'], 'sign-in and recovery'],
];

const MUTATION = [
  ['node', ['tools/mutation_drill.js'], 'the gates fail when security is broken on purpose'],
];

let steps = QUICK ? APP : [...APP, ...DB, ...INVENTORY];
if (STAGING) steps = [...steps, ...STAGING_PROBES, ...MUTATION];

const t0 = Date.now();
const failed = [];
let n = 0;

for (const [cmd, argv, label] of steps) {
  n++;
  const head = String(n).padStart(2, ' ') + '/' + steps.length + '  ' + label;
  process.stdout.write(head.padEnd(62, '.'));
  const t = Date.now();
  const r = spawnSync(cmd, argv, { encoding: 'utf8', shell: process.platform === 'win32' });
  const secs = ((Date.now() - t) / 1000).toFixed(1) + 's';
  if (r.status === 0) {
    console.log(' ok ' + secs);
  } else {
    console.log(' FAILED ' + secs);
    failed.push({ label, argv: argv.join(' '), out: (r.stdout || '') + (r.stderr || '') });
  }
}

console.log('\n' + '='.repeat(62));
if (!failed.length) {
  console.log(steps.length + ' checks, all green, in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  if (!STAGING) console.log('\nThis did NOT include the real-session probes. Before a release:\n  node release.js --staging');
  process.exit(0);
}
console.log(failed.length + ' of ' + steps.length + ' FAILED\n');
for (const f of failed) {
  console.log('-'.repeat(62));
  console.log('  ' + f.label + '   (node ' + f.argv + ')');
  const lines = f.out.split('\n').filter(l => /FAIL|Error|error:|failed/i.test(l)).slice(0, 12);
  for (const l of lines) console.log('    ' + l.trim().slice(0, 160));
}
process.exit(1);
