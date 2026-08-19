#!/usr/bin/env node
/**
 * verify.js — runs every gate against the app in one command.
 *
 *   node audit/verify.js path/to/layi_dashboard.html
 *   node audit/verify.js                 # defaults to ./layi_dashboard.html
 *
 * Exit code 0 = all gates green. Non-zero = at least one gate failed.
 * Run this BEFORE and AFTER any change. A change that turns a gate red is a regression.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = path.resolve(process.argv[2] || 'layi_dashboard.html');
if (!fs.existsSync(app)) { console.error('Cannot find app file: ' + app); process.exit(2); }
const here = __dirname;

const GATES = [
  ['parsecheck.js',       'Parse            ', 'Every inline <script> block parses. Catches the #1 hazard: a straight apostrophe inside a single-quoted JS string.'],
  ['smoke_dash_fixes.js', 'Runtime smoke    ', 'Loads the app in a stubbed DOM, seeds demo data, and calls every dashboard drill function for real.'],
  ['check_sync.js',       'Figure sync      ', 'A KPI card and its drill-down must total the SAME period + branch. This is the bug class that caused "₦1.8m on the card, ₦0 in the popup".'],
  ['audit_branches.js',   'Branch parity    ', 'Renders the dashboard for EVERY studio; fails if any card jumps to a tab instead of opening a breakdown, or shows another branch\'s data.'],
  ['audit_roles.js',      'Role parity      ', 'Renders every role\'s dashboard (owner/manager/accountant/CRE/tailor/assistant) on every studio. Fails on tab-jumps, stale appointment forms, wrong finance exposure, dead Orders cards.'],
  ['audit_perms.js',      'Permission matrix', 'Asserts each role\'s exact access, that NEW permissions fall back to old behaviour (no regressions for existing accounts), and that toggling one permission does not bleed into others.'],
  ['audit_cards.js',      'Dead-card sweep  ', 'Renders every tab for every role on every studio; fails if any KPI stat card has no drill-down.'],
  ['audit_reporting.js',  'Reporting lines  ', 'Fails on a self-report, a reporting loop, or a manager pointing at a deleted staff member; verifies the guards catch each and that leaving reassigns reports up the chain.'],
  ['audit_branch_staff.js','Branch staff scope', 'Fails if a single-branch view lists a staff member from another studio, or if the branch switcher has no "All studios" option.'],
  ['audit_branch_labels.js','Branch row labels ', 'In the All-studios view every list row must show which studio it belongs to; in a single-branch view it must not.'],
  ['audit_accounts.js',    'Account ↔ staff  ', 'The New Account form offers to create a matching staff record when none is linked; accepting creates it one-to-one, declining shows a "no linked staff" hint, and a staff record links to at most one account.'],
  ['audit_period.js',      'Period response  ', 'The dashboard finance KPI cards must track the period/calendar selector and their drills must total the same period; Outstanding must stay an all-orders snapshot.'],
  ['audit_sync.js',        'Cloud-sync cover ', 'Every persisted data key must be wired to Supabase exactly once (relational pusher or app_state), and save() must stay a no-op offline.'],
  ['audit_webimport.js',  'Website import   ', 'Website orders map to the right studio record (retail / made-to-measure / consultation), money counts only when actually paid, and re-importing never duplicates.'],
  ['audit_moneyin.js',    'Money In hub     ', 'Every inflow is channel-tagged; a hand-logged payment is cash-received only (never double counts the accrual P&L); the hub is period + branch scoped and each channel figure reconciles with its drill-down.'],
  ['audit_simplicity.js', 'Progressive UI   ', 'A one-person shop hides the team & HR cluster (Team, Rota, Attendance, Leave, Company log, Payroll); it reveals automatically on hiring a 2nd teammate or adding a studio, and an explicit Settings toggle overrides. Hidden views redirect to the dashboard.'],
  ['audit_offline.js',    'Offline strength ', 'Offline reads as a feature: the connection pill stays hidden while online, appears with a "saved on this device" reassurance when the network drops, clears on reconnect, and the info modal explains nothing is lost.'],
  ['audit_print.js',      'Printable sheets ', 'Job sheet (work order + measurements), measurement sheet and stock list each generate branded, populated, branch-scoped printable HTML and are wired to a button in the UI. (Invoices/receipts already print.)'],
  ['audit_ownerpay.js',   'Owner pay        ', 'The owner can be paid five ways (% profit / % order value / fixed per order / fixed per outfit / monthly salary), set once globally and inherited by new orders; each basis computes correctly and stays capped to profit, and salary posts exactly one monthly cost.'],
  ['audit_notify.js',     'Notifications    ', 'The bell is a live activity feed: local sale/payment/status actions and (once live) other devices\' actions via realtime chime and drop in; a Settings panel controls sound, chime voice, volume, per-event toggles and pop-ups; Web Push stays scaffolded/dormant with SW handlers ready for go-live.'],
  ['audit_storage.js',    'Storage          ', 'Per-tenant storage is metered from image bytes only (text ignored), tiers set the limit (Free 1GB → Atelier 1TB), a Settings meter renders usage, and saveImageAsset() is the single pass-through seam that routes to cloud storage at go-live.'],
  ['audit_import.js',     'Import / migrate ', 'Six tolerant CSV importers (customers & measurements, orders, stock, staff, vendors, finances) match columns by alias so exports from other software line up; every importer is idempotent (matched records update, never duplicate); orders reuse the safe importWebOrders() path and keep the deposit as money paid; the migrate screen builds all six cards.'],
  ['audit_whatsapp.js',   'WhatsApp auto    ', 'The auto-WhatsApp seam exists and stays DORMANT until an endpoint is set and the app is live (today\'s manual hand-off is unchanged); milestone hooks fire on order-created and ready; the Settings panel explains the go-live requirement; and no WhatsApp API token ever ships in the client.'],
];

let failed = [];
console.log('Verifying: ' + app + '\n');
for (const [script, label, why] of GATES) {
  const p = path.join(here, script);
  if (!fs.existsSync(p)) { console.log('  SKIP  ' + label.trim() + ' (missing ' + script + ')'); continue; }
  try {
    const out = execFileSync('node', [p, app], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
    const last = out.trim().split('\n').filter(Boolean).pop() || 'ok';
    console.log('  PASS  ' + label + '  ' + last.trim());
  } catch (e) {
    failed.push(script);
    const out = ((e.stdout||'') + (e.stderr||'')).trim();
    console.log('  FAIL  ' + label);
    out.split('\n').slice(-12).forEach(l => console.log('        ' + l));
  }
}

console.log('');
if (failed.length) {
  console.log('=== ' + failed.length + ' GATE(S) FAILED: ' + failed.join(', ') + ' ===');
  console.log('Do not ship. Each gate above prints why it exists; fix the cause, not the test.');
  process.exit(1);
}
console.log('=== ALL GATES GREEN ===');
