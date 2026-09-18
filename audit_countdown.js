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
const SHIPPED = 'Opening in <span data-cfg="launchMonth">November</span>.';

/* A Date whose `now` is whatever we say. Everything else on it is the real
   one, because site.js and config.js both use Date.parse and this must not
   quietly change what a date string means. Without this the only way to test
   the last minute before launch would be to be there for it. */
function frozenDate(nowMs) {
  function D() {
    return arguments.length ? new Date(...arguments) : new Date(nowMs);
  }
  D.now = () => nowMs;
  D.parse = Date.parse;
  D.UTC = Date.UTC;
  D.prototype = Date.prototype;
  return D;
}

function run(launchDate, nowMs) {
  const el = {
    _text: 'Opening in November.',
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
  /* Every delay the clock asks for, captured rather than run. Running them
     would recurse forever, and the delay itself is the thing worth checking:
     a one second timer ticking for six weeks, or an hourly one in the last
     minute, are both bugs you cannot see by reading the sentence. */
  const delays = [];
  const sb = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    document: doc,
    location: { hash: '', pathname: '/index.html', href: '', search: '' },
    history: { replaceState() {} },
    navigator: { userAgent: 'node' },
    setTimeout: (fn, ms) => { delays.push(ms); return 0 },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    IntersectionObserver: function () { return { observe() {}, disconnect() {}, unobserve() {} } },
    Image: function () { return {} },
    fetch: async () => ({ ok: false }),
    Math, Date: nowMs === undefined ? Date : frozenDate(nowMs),
    JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, Error, Intl,
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
  return { removed: el._gone, text: el._text, delays: delays };
}

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/* Stand the clock at an exact distance from launch and ask what it says.
   The launch date is fixed here rather than read from the config, so these
   checks keep testing the bands after somebody changes the real date. */
const LAUNCH_AT = Date.parse('2026-11-01T00:00:00Z');
const standingAt = ms => run('2026-11-01', LAUNCH_AT - ms);
const text = ms => { const r = standingAt(ms); return r.removed ? null : r.text; };
const schedules = ms => { const r = standingAt(ms); return r.delays.length ? r.delays[0] : 0; };

/* ---- the page ships a sentence that is true before any script runs ---- */
const index = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
check(index.includes(SHIPPED),
  'the home page ships a readable sentence, so no JavaScript means vague rather than blank');
check(/data-opens/.test(index), 'the countdown has something to attach to');

/* ---- the clock gets finer as it closes ----
   Asserted as the WHOLE sentence, never as a pattern somewhere inside it. An
   earlier version checked /in 44 days/ and !/\d\d:\d\d/, and a mutant that
   appended an hours clock survived, because at a single digit hour "3:00"
   does not match \d\d:\d\d. A check that looks at part of a string passes for
   every string that happens to contain that part.

   These go through `ms`, so the bands are tested at the second rather than at
   whatever today happens to be. The launch morning is not something you can
   wait for twice. */
const STATIC = 'Opening in November.';
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

const BANDS = [
  [44 * DAY,                  'Opening in 44 days, in November.',      'six weeks out: days, and the month for context'],
  [3 * DAY,                   'Opening in 3 days, in November.',       'three days out: still days'],
  [2 * DAY,                   'Opening in 2 days, in November.',       'exactly two days: the last moment it says days'],
  [2 * DAY - 1 * SEC,         'Opening in 47 hours.',                  'a second under two days: it switches to hours'],
  [30 * HOUR,                 'Opening in 30 hours.',                  'thirty hours out: hours'],
  [24 * HOUR,                 'Opening in 24 hours.',                  'exactly a day: hours'],
  [24 * HOUR - 1 * SEC,       'Opening in 23 hours 59 minutes.',       'a second under a day: minutes appear'],
  [5 * HOUR + 12 * MIN,       'Opening in 5 hours 12 minutes.',        'the last day: hours and minutes'],
  [1 * HOUR,                  'Opening in 1 hour 0 minutes.',          'exactly an hour, and "1 hour" is not "1 hours"'],
  [1 * HOUR - 1 * SEC,        'Opening in 59 minutes 59 seconds.',     'a second under an hour: the seconds appear'],
  [14 * MIN + 32 * SEC,       'Opening in 14 minutes 32 seconds.',     'the last hour: minutes and seconds'],
  [1 * MIN + 1 * SEC,         'Opening in 1 minute 1 second.',         'singulars are singular, both of them'],
  [60 * SEC,                  'Opening in 1 minute 0 seconds.',        'exactly a minute'],
  [59 * SEC,                  'Opening in 59 seconds.',                'the last minute: seconds alone'],
  [1 * SEC,                   'Opening in 1 second.',                  'the last second, singular'],
];
BANDS.forEach(b => {
  const got = text(b[0]);
  check(got === b[1], b[2] + ' — expected "' + b[1] + '", got "' + got + '"');
});

/* ---- THE MOMENT IT MATTERS ---- */
/* The live path, on the real clock rather than a frozen one. The number is
   worked out here the same way the code does rather than typed in, because
   "44 days away" in calendar terms is 43 days and some hours in real ones,
   and the clock floors everywhere. Flooring is what keeps the bands
   consistent: 47 hours, 59 minutes, 1 second all floor too, and a countdown
   that rounds up is a countdown that overstates the time you have left. */
const liveAt = Date.parse(day(44) + 'T00:00:00Z');
const liveDays = Math.floor((liveAt - Date.now()) / 86400000);
let r = run(day(44));
check(!r.removed && r.text === 'Opening in ' + liveDays + ' days, in November.',
  'the live path on the real clock paints what the band function would (' + r.text + ')');

check(text(0) === null, 'at zero the clock is gone, not reading "in 0 seconds"');
check(text(-1 * SEC) === null, 'one second past, it is gone');

r = run(day(0));
check(r.removed, 'ON the launch day the sentence removes itself');

r = run(day(-1));
check(r.removed, 'the day after, it is gone rather than counting backwards');

r = run(day(-400));
check(r.removed, 'a launch date left behind for a year does not resurface as a negative number');

/* ---- it has to keep saying it ----
   A clock that paints once and stops is a screenshot. */
check(schedules(44 * DAY) > 0, 'far out, it schedules itself to say it again');
check(schedules(30 * SEC) > 0, 'in the last minute, it schedules itself to say it again');
check(schedules(30 * SEC) <= 1000,
  'in the last minute it repaints at least every second (' + schedules(30 * SEC) + 'ms)');
/* `>= 1000` was here first and a mutant that returned a flat 1000 survived it,
   because 1000 >= 1000. A bound that the thing you are forbidding satisfies is
   not a bound. Nothing on screen moves faster than once a day out here, so a
   repaint should be at least a minute apart. */
check(schedules(44 * DAY) >= 60000,
  'six weeks out it waits at least a minute, rather than ticking every second for nothing ('
  + schedules(44 * DAY) + 'ms)');

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
