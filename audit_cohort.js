// Render the two new screens the console gate does not reach, with live-shaped
// rows, and fail on a throw or on any of the tells that a value was undefined.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = __dirname;

function mkEl() {
  return {
    innerHTML: '', outerHTML: '', value: '', checked: false, textContent: '', style: {},
    dataset: {}, options: [], children: [], scrollTop: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    setAttribute() {}, getAttribute() { return null }, removeAttribute() {}, appendChild(c) { return c },
    addEventListener() {}, removeEventListener() {}, querySelector() { return null },
    querySelectorAll() { return [] }, closest() { return null }, focus() {}, select() {},
    remove() {}, click() {}
  };
}
const els = {};
const sb = {
  console: { log() {}, warn() {}, error() {}, debug() {} },
  document: {
    getElementById(id) { return els[id] || (els[id] = mkEl()) },
    querySelector() { return mkEl() }, querySelectorAll() { return [] },
    createElement() { return mkEl() }, addEventListener() {}, removeEventListener() {},
    body: mkEl(), documentElement: mkEl(), head: mkEl(), execCommand() { return true }
  },
  localStorage: (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } }; })(),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0,
  navigator: { userAgent: 'node', onLine: true },
  location: { href: '', hash: '', search: '', pathname: '/', reload() {} },
  history: { replaceState() {} }, URLSearchParams,
  alert() {}, confirm() { return true }, prompt() { return '' },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  fetch: async () => ({ ok: false, json: async () => ({}), text: async () => '' }),
  crypto: { getRandomValues: a => a, subtle: {} },
  Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, Error, Intl,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary')
};
sb.window = sb; sb.globalThis = sb; sb.self = sb;
sb.window.scrollTo = () => {}; sb.window.open = () => {};
vm.createContext(sb);

const indexHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const files = [...indexHtml.matchAll(/src="(js\/[a-z0-9]+\.js)"/g)].map(m => m[1]);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(root, 'admin', f), 'utf8'), sb, { filename: f });
}
const run = e => vm.runInContext(e, sb);

const fail = [];
const ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

/* The shapes liveToSubscriber produces, which is what this screen will really
   be handed: a tester who is working, one who stopped, and one who never
   opened it at all. lastSeen empty and ordersLast30 null are both real —
   a studio that never signed in has no app_state row. */
const today = new Date();
const iso = d => new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10);
run('COHORT.key = "october-2026";');
run(`DB.subscribers = ${JSON.stringify([
  { id: 'c1', name: 'The Ada Label', owner: 'Adaeze Okonkwo', email: 'a@x.com', city: 'Lagos', phone: '',
    plan: 'starter', planName: 'Basic', status: 'active', mrr: 27000, users: 4, seats: 3,
    joined: iso(20), renewsOn: '', renewIn: 20, pastDue: false, health: 'healthy',
    cohort: 'october-2026', lastSeen: iso(0), ordersLast30: 31, businesses: [], referrals: [],
    referralLedger: [], referralEarned: 0, notes: [] },
  { id: 'c2', name: 'Kano Leatherworks', owner: 'Musa Ibrahim', email: 'm@x.com', city: 'Kano', phone: '',
    plan: 'starter', planName: 'Basic', status: 'active', mrr: 27000, users: 2, seats: 3,
    joined: iso(20), renewsOn: '', renewIn: 20, pastDue: false, health: 'steady',
    cohort: 'october-2026', lastSeen: iso(11), ordersLast30: 2, businesses: [], referrals: [],
    referralLedger: [], referralEarned: 0, notes: [] },
  { id: 'c3', name: 'Chioma Eze', owner: 'Chioma Eze', email: 'c@x.com', city: 'Abuja', phone: '',
    plan: 'starter', planName: 'Basic', status: 'active', mrr: 27000, users: 1, seats: 3,
    joined: iso(18), renewsOn: '', renewIn: 20, pastDue: false, health: 'onboarding',
    cohort: 'october-2026', lastSeen: '', ordersLast30: null, businesses: [], referrals: [],
    referralLedger: [], referralEarned: 0, notes: [] },
  { id: 'n1', name: 'Not A Tester', owner: 'Someone', email: 's@x.com', city: 'Lagos', phone: '',
    plan: 'pro', planName: 'Pro', status: 'active', mrr: 65000, users: 9, seats: 99,
    joined: iso(400), renewsOn: '', renewIn: 9, pastDue: false, health: 'healthy',
    cohort: '', lastSeen: iso(1), ordersLast30: 80, businesses: [], referrals: [],
    referralLedger: [], referralEarned: 0, notes: [] }
])};`);

/* the tester screen */
let html = '';
try {
  run('UI.filters.subscribers = "cohort";');
  html = String(run('PAGES.subscribers()'));
  check(true, 'the cohort tab renders without throwing');
} catch (e) {
  check(false, 'the cohort tab renders without throwing — threw: ' + e.message);
}
check(/Kano Leatherworks/.test(html), 'a tester who went quiet is on the screen');
check(/Not A Tester/.test(html) === false || /October early access<\/h3>/.test(html),
  'the cohort panel is about the cohort');
check(/Never opened it/.test(html), 'a studio that never signed in is called out, not shown as 0 days');
check(/Quiet 11 days/.test(html), 'days since last opened are counted from the real date');
check(/2 to chase today/.test(html), 'the header counts the ones needing a chase');
/* ordering is the point of the screen */
check(html.indexOf('Chioma Eze') < html.indexOf('Kano Leatherworks')
   && html.indexOf('Kano Leatherworks') < html.indexOf('The Ada Label'),
  'the quiet ones sort above the working ones');
check(!/undefined|NaN|\[object Object\]/.test(html), 'nothing renders as undefined, NaN or [object Object]');

/* the enquiries screen with an early access queue on it */
run(`DB.enquiries = ${JSON.stringify([
  { id: 'e1', live: true, at: '2026-09-15T09:00:00Z', kind: 'earlyaccess', name: 'First In', email: 'f@x.com',
    phone: '', business: 'First Studio', message: 'hello', source_page: 'waitlist.html', extra: {},
    state: 'new', handled_by: '', handled_at: '', notes: '' },
  { id: 'e2', live: true, at: '2026-09-16T09:00:00Z', kind: 'earlyaccess', name: 'Second In', email: 's@x.com',
    phone: '', business: 'Second Studio', message: 'hi', source_page: 'waitlist.html', extra: {},
    state: 'waiting', handled_by: '', handled_at: '', notes: '' },
  { id: 'e3', live: true, at: '2026-09-17T09:00:00Z', kind: 'demo', name: 'A Demo', email: 'd@x.com',
    phone: '', business: 'Demo Co', message: 'demo please', source_page: 'book.html', extra: {},
    state: 'new', handled_by: '', handled_at: '', notes: '' }
])};`);
let eh = '';
try {
  run('UI.filters.enquiries = "earlyaccess";');
  eh = String(run('PAGES.enquiries()'));
  check(true, 'the early access tab renders without throwing');
} catch (e) {
  check(false, 'the early access tab renders without throwing — threw: ' + e.message);
}
check(/First In/.test(eh) && /Second In/.test(eh), 'both early access enquiries are listed');
check(!/A Demo/.test(eh), 'a demo request is not in the early access queue');
check(eh.indexOf('First In') < eh.indexOf('Second In'), 'the queue reads oldest first');
check(/Places left/.test(eh), 'places left is on the screen');
check(/>5 <span[^>]*>of 8</.test(eh), 'places left counts the studios, not the enquiries (3 taken of 8)');
check(/Invite a studio directly/.test(eh), 'a studio can be invited without an enquiry');
check(!/undefined|NaN|\[object Object\]/.test(eh), 'the enquiries screen has no undefined in it');

/* somebody moved to the November list keeps their queue number */
let wh = '';
try { run('UI.filters.enquiries = "waiting";'); wh = String(run('PAGES.enquiries()')); } catch (e) { wh = 'threw: ' + e.message; }
check(/Second In/.test(wh), 'the November list shows who is on it');
check(/<td>2<\/td>/.test(wh), 'a studio moved to the November list keeps the position it arrived at');

console.log('');
ok.forEach(m => console.log('  pass  ' + m));
fail.forEach(m => console.log('  FAIL  ' + m));
console.log('\n' + '='.repeat(60));
console.log(ok.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
