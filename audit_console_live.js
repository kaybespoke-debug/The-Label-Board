// Does the console actually use the gateway it was built around?
//
// admin-api has served `tenants` since it was written, and
// platform_tenant_summary() exists in the database to answer it. Nothing ever
// called either. So six studios could sign up, be provisioned, sign in and use
// the app, and the console's subscriber list would still show only the worked
// example — a convincing way to believe you have no customers.
//
// It was invisible because the demo is good: a list full of plausible
// subscribers looks exactly like a list that is working. The gap only shows if
// you know one particular real studio should be in it and it is not.
//
// So this checks the wiring rather than the rendering: every action admin-api
// is prepared to serve for the owner role is either called by the console or
// listed here as knowingly unused, and the ones that are called map onto the
// shape the console's pages already read.
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const api = fs.readFileSync(path.join(root, 'supabase/functions/admin-api/index.ts'), 'utf8');
const consoleJs = fs.readdirSync(path.join(root, 'admin/js'))
  .filter(f => f.endsWith('.js'))
  .map(f => fs.readFileSync(path.join(root, 'admin/js', f), 'utf8')).join('\n');

const fails = [];
const F = m => fails.push(m);

/* Actions the gateway is willing to perform for an owner. */
const owner = (api.match(/owner:\s*\[([^\]]+)\]/) || [])[1] || '';
const served = [...owner.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]);
if (!served.length) F('could not read the owner role\'s action list out of admin-api');

/* Actions the console actually asks for. */
const called = new Set([...consoleJs.matchAll(/liveCall\('([a-zA-Z]+)'/g)].map(m => m[1]));

/* Deliberately not called yet, each with the reason. An action sitting here is
   a decision; an action sitting in neither list is an oversight, which is what
   `tenants` was. */
const KNOWINGLY_UNUSED = {
  setStatus: 'suspending a studio is not offered from the console yet',
  setNote:   'studio notes are kept in the console\'s own records, not on the tenant row',
  audit:     'the audit trail has no page yet; admin-api logs to it regardless',
  /* The detail panel reads live studios now — it renders, it is reachable, and
     it names the right studio. What  returns over and above the list
     row is the studio's notes, and the subscriber panel has no notes section
     to put them in. Calling it would be a request whose answer is discarded,
     which is the same fault as never calling it, wearing a better disguise.
     It belongs here until the panel has somewhere to show them. */
  tenant:    'its only extra field is notes, and the panel has nowhere to show them',
};

served.forEach(a => {
  if (called.has(a)) return;
  if (a in KNOWINGLY_UNUSED) return;
  F('admin-api serves "' + a + '" and the console never calls it, so that half of the gateway does nothing');
});

Object.keys(KNOWINGLY_UNUSED).forEach(a => {
  if (!served.includes(a)) F('"' + a + '" is listed as knowingly unused but admin-api no longer serves it');
  if (called.has(a)) F('"' + a + '" is listed as knowingly unused but the console does call it — update the list');
});

/* The one that matters: real studios reach the subscriber list. */
if (!called.has('tenants'))
  F('the console never asks for tenants, so a real studio never appears as a subscriber');
if (!/DB\.subscribers\s*=\s*mergeLive\(/.test(consoleJs))
  F('tenants are fetched but never merged into DB.subscribers, so nothing shows them');
if (!/function liveToSubscriber/.test(consoleJs))
  F('there is no mapping from a tenant row onto the subscriber shape the pages read');

/* Live rows must be marked and keyed like every other live row, or mergeLive
   drops the demo ones it was supposed to keep, or duplicates on every poll. */
{
  const fn = (consoleJs.match(/function liveToSubscriber\(row\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  if (fn && !/live:\s*true/.test(fn)) F('a live subscriber is not marked live, so mergeLive cannot tell it from an example');
  if (fn && !/id:\s*'live-'/.test(fn)) F('a live subscriber id is not namespaced, so it can collide with an example id');
  if (fn && !/liveId:/.test(fn)) F('a live subscriber does not carry its real id, so it cannot be acted on');
}

/* Invented detail on a real customer is worse than blank detail: somebody
   acts on it. The console's example subscribers carry a whole CRM's worth of
   signal that does not exist for a real tenant. */
{
  const fn = (consoleJs.match(/function liveToSubscriber\(row\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  if (/ordersLast30:\s*\d/.test(fn)) F('a real studio is given a made-up order count');
  if (/health:\s*'healthy'/.test(fn)) F('a real studio is given a made-up health score');
  if (/phone:\s*'\+/.test(fn)) F('a real studio is given a made-up phone number');
}

console.log('Console gateway audit:');
console.log('  admin-api serves : ' + served.join(', '));
console.log('  console calls    : ' + [...called].sort().join(', '));
console.log('  knowingly unused : ' + Object.keys(KNOWINGLY_UNUSED).join(', '));
if (fails.length) {
  console.log('\n✗ ' + fails.length + ' problem(s):');
  fails.forEach(f => console.log('   - ' + f));
  process.exit(1);
}
console.log('  ✓ every action the gateway serves is either used or knowingly not, and real');
console.log('    studios reach the subscriber list without inventing detail about them');
