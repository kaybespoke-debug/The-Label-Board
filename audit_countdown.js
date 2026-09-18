// The one sentence on the website that changes by itself.
//
// "Opening to new businesses in 44 days" is the only thing on this site whose
// correctness depends on what day it is. It goes wrong on exactly one morning:
// the one we open. Nobody is looking at the marketing site that day, and a
// countdown sitting at "in 0 days", or counting into negatives, is worse than
// never having had one.
//
// So it is tested at the boundary rather than looked at. site.js runs inside a
// fake document here, the way the console gates run the console, and the date
// is moved around it.
//
// Written after trying to check this in a real browser and finding that
// `opensIn` lives inside site.js's IIFE, so every call silently did nothing and
// every case "passed" against the untouched static sentence.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = __dirname;

const fail = [];
const ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

const SITE_JS = fs.readFileSync(path.join(root, 'web/js/site.js'), 'utf8');
const CONFIG_JS = fs.readFileSync(path.join(root, 'web/js/config.js'), 'utf8');

/* The element exactly as index.html ships it, static sentence included. If the
   page ever stops shipping a readable sentence, this string stops matching the
   page and the check below it catches that separately. */
const SHIPPED = 'Opening to new businesses in <span data-cfg="launchMonth">November</span>.';

function run(launchDate) {
  const el = {
    _text: 'Opening to new businesses in November.',
    _attrs: { 'data-opens': '', class: 'opens' },
    _gone: false,
    get textContent() { return this._text },
    set textContent(v) { this._text = String(v) },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null },
    setAttribute(k, v) { this._attrs[k] = String(v) },
    removeAttribute(k) { delete this._attrs[k] },
    remove() { this._gone = true },
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    style: {}, addEventListener() {}, querySelectorAll() { return [] },
  };
  let booted = null;
  const doc = {
    addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') booted = fn },
    removeEventListener() {},
    querySelector(sel) { return sel === '[data-opens]' ? (el._gone ? null : el) : null },
    querySelectorAll(sel) {
      if (el._gone) return [];
      if (sel === '[data-opens]') return [el];
      if (sel === '[data-cfg]') return [];
      return [];
    },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {}, classList: el.classList } },
    documentElement: { classList: el.classList, scrollWidth: 0, clientWidth: 0 },
    body: { classList: el.classList, appendChild() {}, contains() { return true } },
    head: { appendChild() {} },
  };
  const sb = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    document: doc,
    location: { hash: '', pathname: '/index.html', href: '', search: '' },
    history: { replaceState() {} },
    navigator: { userAgent: 'node' },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    IntersectionObserver: function () { return { observe() {}, disconnect() {}, unobserve() {} } },
    Image: function () { return {} },
    fetch: async () => ({ ok: false }),
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, Error, Intl,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, URLSearchParams,
  };
  sb.addEventListener = () => {};
  sb.removeEventListener = () => {};
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  sb.window.scrollTo = () => {};
  vm.createContext(sb);
  vm.runInContext(CONFIG_JS, sb, { filename: 'config.js' });
  /* the date under test, set the way somebody editing config.js would */
  vm.runInContext('SITE.launchDate = ' + JSON.stringify(launchDate) + ';', sb);
  vm.runInContext(SITE_JS, sb, { filename: 'site.js' });
  if (!booted) throw new Error('site.js never registered a DOMContentLoaded handler');
  booted();
  return { removed: el._gone, text: el._text };
}

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/* ---- the page ships a sentence that is true before any script runs ---- */
const index = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
check(index.includes(SHIPPED),
  'the home page ships a readable sentence, so no JavaScript means vague rather than blank');
check(/data-opens/.test(index), 'the countdown has something to attach to');

/* ---- counting down ----
   Asserted as the WHOLE sentence, not as a pattern somewhere inside it. The
   first version of this checked /in 44 days/ and !/\d\d:\d\d/, and a mutant
   that appended an hours clock survived it, because at a single digit hour
   "3:00" does not match \d\d:\d\d. A check that looks at part of a string
   passes for every string that happens to contain that part. */
const STATIC = 'Opening to new businesses in November.';

let r = run(day(44));
check(r.text === 'Opening to new businesses in 44 days, in November.',
  'a launch six weeks out reads exactly as a number of days and the month (' + r.text + ')');

r = run(day(2));
check(r.text === 'Opening to new businesses in 2 days, in November.',
  'two days out reads as two days (' + r.text + ')');

r = run(day(1));
check(r.text === 'Opening to new businesses tomorrow.',
  'the last day reads as tomorrow rather than "in 1 days" (' + r.text + ')');
check(!r.removed, 'the day before we open, the sentence is still there');

/* ---- THE MORNING IT MATTERS ---- */
r = run(day(0));
check(r.removed, 'ON the launch day the sentence removes itself rather than saying "in 0 days"');

r = run(day(-1));
check(r.removed, 'the day after, it is gone rather than counting backwards');

r = run(day(-400));
check(r.removed, 'a launch date left behind for a year does not resurface as a negative number');

/* ---- a wrong date must make it quiet, not wrong ----
   Exact match again, and for the same reason. /in November\.$/ passed happily
   on "Opening to new businesses in NaN days, in November." because that also
   ends in November. A dropped isNaN guard survived the first version of this
   check while printing NaN on the home page. */
['the first of never', '', 'November-ish', '2026-13-45'].forEach(bad => {
  const out = run(bad);
  check(!out.removed && out.text === STATIC,
    'an unusable date (' + JSON.stringify(bad) + ') leaves the static sentence untouched (' + out.text + ')');
});
/* said separately, because "no NaN on the page" is the thing a reader cares
   about and it should fail by that name rather than as a string mismatch */
['the first of never', '2026-13-45'].forEach(bad => {
  const out = run(bad);
  check(!/NaN|undefined|Invalid/.test(out.text),
    'an unusable date (' + JSON.stringify(bad) + ') never prints NaN at a visitor');
});

/* ---- the date lives in one place ---- */
const cfg = fs.readFileSync(path.join(root, 'web/js/config.js'), 'utf8');
check((cfg.match(/launchDate:/g) || []).length === 1, 'the launch date is written once in the configuration');
check(!/2026-11-01/.test(index), 'the launch date is not also typed into the page, where it would drift');
const others = ['features.html', 'pricing.html', 'about.html', 'contact.html', 'waitlist.html']
  .filter(p => /data-opens/.test(fs.readFileSync(path.join(root, 'web', p), 'utf8')));
check(others.length === 0, 'only the home page carries the countdown, so there is one of it (' + others.join(', ') + ')');

console.log('');
ok.forEach(m => console.log('  pass  ' + m));
fail.forEach(m => console.log('  FAIL  ' + m));
console.log('\n' + '='.repeat(60));
console.log(ok.length + ' passed, ' + fail.length + ' failed');
if (!fail.length) {
  console.log('\nThe one sentence that changes by itself takes itself off on the');
  console.log('morning we open, instead of sitting at zero.');
}
process.exit(fail.length ? 1 : 0);
