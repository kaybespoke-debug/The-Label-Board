// The Subscription panel must know which of four situations it is in.
//
// Shipped in layi-v60 and found during the release verification: the panel sat
// on "Loading…" for ever. BILLING was null for three different reasons and the
// panel could not tell them apart — nobody had asked yet, somebody asked and it
// failed, and this person has no subscription to look at. All three drew the
// same word, which is true of exactly one of them.
//
// Underneath that was a second fault, and it is the one worth a gate:
// fillSettings() hid the panel and then a visibility sweep three lines later
// set display on every settings panel from can(perm) and put it straight back.
// Two pieces of code deciding one thing. The ordering was the symptom; the
// second decider was the fault.
//
// So this checks both halves:
//   1. renderBillingPanel() is the ONLY thing that decides whether the panel is
//      on screen, and the sweep leaves it alone — proved by running the sweep
//      over stub panels and watching what it touches.
//   2. Each of the four states draws the right thing, and only one of them
//      draws a price anybody can press.
'use strict';
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(process.argv[2] || 'site/layi_dashboard.html', 'utf8');

const fails = [];
const F = m => fails.push(m);
let checks = 0;
const is = (name, cond, detail) => { checks++; if (!cond) F(name + (detail ? ' — ' + detail : '')); };

/* ---- a DOM just real enough to answer the question ---------------------- */
const made = {};
const mkEl = (id) => ({
  id: id || '', innerHTML: '', value: '', checked: false, textContent: '',
  style: {}, dataset: {}, tagName: 'DIV',
  classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  setAttribute(){}, getAttribute(){ return null; }, appendChild(c){ return c; },
  addEventListener(){}, removeEventListener(){}, focus(){},
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  getBoundingClientRect(){ return { height: 0, width: 0, top: 0, left: 0 }; },
  remove(){}, closest(){ return null; },
});
const el = (id) => made[id] || (made[id] = mkEl(id));

/* The panels the settings sweep walks. Three of them must be left alone by it:
   the two that were already exempt, and the one this gate is about. */
const settingsPanels = [
  Object.assign(mkEl('usersPanel'),        { dataset: { setperm: 'users' } }),
  Object.assign(mkEl('rolesPanel'),        { dataset: { setperm: 'users' } }),
  Object.assign(mkEl('subscriptionPanel'), { dataset: { setperm: 'setData' } }),
  Object.assign(mkEl('closingPanel'),      { dataset: { setperm: 'setData' } }),
  Object.assign(mkEl('planPanel'),         { dataset: { setperm: 'setData' } }),
];
made.subscriptionPanel = settingsPanels[2];
made.closingPanel = settingsPanels[3];
made.planPanel = settingsPanels[4];

const _ls = {};
const sandbox = {
  console: { log(){}, warn(){}, error(){}, info(){} },
  document: {
    getElementById: (i) => el(i),
    querySelector(){ return mkEl(); },
    querySelectorAll(sel) {
      if (String(sel) === '#view-settings .panel') return settingsPanels;
      return [];
    },
    createElement(){ return mkEl(); },
    addEventListener(){}, removeEventListener(){},
    body: mkEl(), documentElement: mkEl(), head: mkEl(),
    activeElement: null, visibilityState: 'visible',
  },
  localStorage: {
    getItem(k){ return k in _ls ? _ls[k] : null; },
    setItem(k, v){ _ls[k] = String(v); },
    removeItem(k){ delete _ls[k]; },
  },
  navigator: { userAgent: 'gate', onLine: true },
  location: { href: '', hostname: '', hash: '', search: '', pathname: '/' },
  history: { replaceState(){} },
  setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
  requestAnimationFrame(f){ try { f && f(); } catch(e) {} return 0; },
  alert(){}, confirm(){ return true; }, prompt(){ return null; },
  fetch(){ return Promise.resolve({ json: () => Promise.resolve({}), text: () => Promise.resolve('') }); },
  URL: { createObjectURL: () => '', revokeObjectURL(){} },
  Blob: function(){}, FileReader: function(){ this.readAsDataURL = () => {}; },
  matchMedia(){ return { matches: false, addListener(){}, addEventListener(){} }; },
  MessageChannel: function(){ this.port1 = {}; this.port2 = {}; },
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Intl,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);

let code = '';
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html))) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;
  const t = attrs.match(/type\s*=\s*["']([^"']+)["']/i);
  if (t && !/javascript|module/i.test(t[1])) continue;
  code += '\n;' + m[2] + '\n';
}
try { vm.runInContext(code, sandbox, { filename: 'layi-inline.js' }); }
catch (e) { console.error('the app did not load: ' + (e && e.message)); process.exit(1); }

const run = (expr) => vm.runInContext(expr, sandbox);
try { sandbox.demoLogin(); } catch (e) { console.error('demoLogin failed: ' + e.message); process.exit(1); }

const panel = made.subscriptionPanel;
const box = () => el('billingBox');
const shown = () => panel.style.display !== 'none';

// ---------------------------------------------------------------------
// 1. Nothing to show: no panel, and no apology either
// ---------------------------------------------------------------------
run("BILLING=null;BILLING_STATE='idle';renderBillingPanel();");
is('with no subscription to show the panel is hidden', !shown(), 'display=' + panel.style.display);
is('and draws nothing at all', !box().innerHTML, box().innerHTML.slice(0, 60));

// ---------------------------------------------------------------------
// 2. Genuinely loading
// ---------------------------------------------------------------------
run("BILLING_STATE='loading';renderBillingPanel();");
is('while it is actually loading, it says so', shown() && /Loading/.test(box().innerHTML),
   box().innerHTML.slice(0, 60));

// ---------------------------------------------------------------------
// 3. Asked, and could not get an answer
// ---------------------------------------------------------------------
run("BILLING=null;BILLING_STATE='unavailable';renderBillingPanel();");
is('an unavailable subscription is not left saying Loading', !/Loading/.test(box().innerHTML),
   box().innerHTML.slice(0, 80));
is('it says it is unavailable', /not available/i.test(box().innerHTML), box().innerHTML.slice(0, 80));
is('and reassures the studio nothing has changed', /nothing has changed/i.test(box().innerHTML));
is('and offers a way to try again', /loadBilling\(\)/.test(box().innerHTML));
is('and offers nothing to buy', !/startCheckout/.test(box().innerHTML), 'there is a checkout button');

// ---------------------------------------------------------------------
// 4. Loaded, with card payment switched off — the production state today
// ---------------------------------------------------------------------
const READY = {
  plan: 'pro', status: 'active', trial_ends_on: null,
  prices: [
    { plan: 'starter', cycle: 'monthly', amount: 20000, currency: 'NGN' },
    { plan: 'pro', cycle: 'monthly', amount: 49000, currency: 'NGN' },
  ],
  subscription: { plan: 'pro', cycle: 'monthly', price: 49000, started_on: '2026-09-01',
                  renews_on: '2026-10-01', is_trial: false, cancelled_at: null },
  payments: [], checkouts: [],
};
run('BILLING=' + JSON.stringify(READY) + ";BILLING_STATE='ready';CHECKOUT_LIVE=false;renderBillingPanel();");
is('with billing loaded the panel is shown', shown(), 'display=' + panel.style.display);
is('it names the plan', /Pro/.test(box().innerHTML), box().innerHTML.slice(0, 80));
is('and what the plans cost', /20,000/.test(box().innerHTML) && /49,000/.test(box().innerHTML));
is('but offers no checkout button while card payment is off',
   !/startCheckout/.test(box().innerHTML), 'a checkout button is on screen');
is('and says why, rather than leaving a dead end',
   /not switched on/i.test(box().innerHTML), box().innerHTML.slice(-140));
is('and does not offer to cancel something it cannot take payment for',
   !/cancelSubscription/.test(box().innerHTML));

// ---------------------------------------------------------------------
// 5. Loaded, with card payment on — the only state with a button
// ---------------------------------------------------------------------
run("CHECKOUT_LIVE=true;renderBillingPanel();");
is('with card payment on, the plans become buttons', /startCheckout/.test(box().innerHTML));
is('and the subscription can be cancelled', /cancelSubscription/.test(box().innerHTML));

// ---------------------------------------------------------------------
// 6. THE FAULT ITSELF. One decider, not two.
// ---------------------------------------------------------------------
run("BILLING=null;BILLING_STATE='idle';renderBillingPanel();");
const hiddenBefore = panel.style.display;
settingsPanels.forEach(p => { if (p.id !== 'subscriptionPanel') p.style.display = 'x'; });
try { run('fillSettings();'); } catch (e) { F('fillSettings threw: ' + e.message); }
is('the settings sweep does not overrule the panel it does not own',
   panel.style.display === hiddenBefore,
   'it was ' + hiddenBefore + ' and the sweep made it "' + panel.style.display + '"');
is('while the sweep still decides the panels it does own',
   made.closingPanel.style.display !== 'x',
   'the sweep stopped touching closingPanel');

// and the same thing said statically, because the sweep is one line and a
// future edit could re-add the id without running this file
const sweep = (html.match(/document\.querySelectorAll\('#view-settings \.panel'\)[^\n]*/) || [])[0] || '';
is('the sweep names subscriptionPanel as one it skips',
   /subscriptionPanel/.test(sweep), sweep.slice(0, 120));

// ---------------------------------------------------------------------
// 7. The subscription belongs to the studio, and does not travel with you
// ---------------------------------------------------------------------
// Somebody who owns one studio and manages another would otherwise carry the
// first one's money across to the second one's Settings.
const sStart = html.indexOf('async function switchStudio(');
const switchSrc = sStart < 0 ? '' : html.slice(sStart, html.indexOf('\n}', sStart));
is('switchStudio was found at all', !!switchSrc);
is('switching studios drops the subscription that was on screen',
   switchSrc.indexOf('BILLING=null') >= 0, 'it is carried across');
is('and asks for the new one', switchSrc.indexOf('loadBilling()') >= 0, 'it never asks again');

// ---------------------------------------------------------------------
// 8. Nothing here may reach for Flutterwave
// ---------------------------------------------------------------------
const fnSrc = (html.match(/function renderBillingPanel\(\)[\s\S]*?\n\}/) || [''])[0];
is('the panel itself talks to no payment provider',
   !/flutterwave|flw|checkout\.flutterwave/i.test(fnSrc), 'it names a provider');
is('and no state invents a subscription that is not there',
   !/fake|dummy|placeholder/i.test(fnSrc));

// ---------------------------------------------------------------------
console.log('Subscription panel audit:');
console.log('  states checked : idle, loading, unavailable, ready (card off), ready (card on)');
console.log('  ' + checks + ' checks');
if (fails.length) {
  console.log('\nFAILURES (' + fails.length + '):');
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('  ✓ one renderer decides whether the panel is on screen, every state');
console.log('    says something true, and only a configured card payment shows a');
console.log('    button.');
