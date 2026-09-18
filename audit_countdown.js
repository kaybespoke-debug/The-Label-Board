// The countdown clock on the home page.
//
// It is the only thing on this website whose correctness depends on what time
// it is, and it goes wrong on exactly one morning: the one we open. Nobody is
// looking at the marketing site that day, and four segments sitting at
// 00:00:00:00, or counting backwards, is worse than never having had a clock.
//
// So it is tested at the boundary rather than looked at. site.js runs inside a
// fake document here, the way the console gates run the console, and the clock
// is frozen at exact distances from launch: both sides of every rollover, the
// second before, the second after.
//
// Two things this was written after.
//
// Trying to check it in a real browser: `opensIn` lives inside site.js's IIFE,
// so every call silently did nothing and every case "passed" against an
// untouched page. A test that cannot fail is not a test.
//
// And the clock's numbers must never be in the HTML. A countdown with numbers
// typed into the markup is wrong for everybody whose JavaScript did not
// arrive, and it looks completely fine while it is wrong.
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
/* what that sentence reads as once the config has been painted into it, which
   is what a visitor with no JavaScript, or a broken date, is left with */
const STATIC = 'Opening in November.';

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

function node(attrs, text) {
  return {
    _text: text === undefined ? '' : text,
    _attrs: Object.assign({}, attrs),
    _classes: [],
    _gone: false,
    get textContent() { return this._text },
    set textContent(v) { this._text = String(v) },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null },
    setAttribute(k, v) { this._attrs[k] = String(v) },
    removeAttribute(k) { delete this._attrs[k] },
    hasAttribute(k) { return k in this._attrs },
    remove() { this._gone = true },
    classList: {
      _o: null,
      add(c) { if (this._o._classes.indexOf(c) < 0) this._o._classes.push(c) },
      remove(c) { this._o._classes = this._o._classes.filter(x => x !== c) },
      contains(c) { return this._o._classes.indexOf(c) >= 0 },
      toggle() {},
    },
    style: {}, addEventListener() {}, querySelectorAll() { return [] },
  };
}

function run(launchDate, nowMs) {
  /* The four segments, exactly as index.html ships them: hidden, and with no
     numbers in them. If the code ever reveals the clock before filling it, or
     fills it without revealing it, these say so. */
  const cells = { d: node({ 'data-cd': 'd' }, '--'), h: node({ 'data-cd': 'h' }, '--'),
                  m: node({ 'data-cd': 'm' }, '--'), s: node({ 'data-cd': 's' }, '--') };
  const el = node({ 'data-opens': '', hidden: '', class: 'clock' });
  el.querySelector = sel => {
    const m = /\[data-cd="(\w)"\]/.exec(sel);
    return m ? cells[m[1]] : null;
  };
  const line = node({ 'data-opens-text': '', class: 'opens' }, 'Opening in November.');
  [el, line, cells.d, cells.h, cells.m, cells.s].forEach(n => { n.classList._o = n });

  let booted = null;
  const doc = {
    addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') booted = fn },
    removeEventListener() {},
    querySelector(sel) {
      if (sel === '[data-opens]') return el._gone ? null : el;
      if (sel === '[data-opens-text]') return line._gone ? null : line;
      return null;
    },
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
  return {
    removed: el._gone,
    lineRemoved: line._gone,
    hidden: el.hasAttribute('hidden'),
    lineHidden: line._classes.indexOf('sr-only') >= 0,
    lineText: line._text,
    read: cells.d._text + ':' + cells.h._text + ':' + cells.m._text + ':' + cells.s._text,
    delays: delays,
  };
}

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/* Stand the clock at an exact distance from launch and ask what it says.
   The launch date is fixed here rather than read from the config, so these
   checks keep testing the bands after somebody changes the real date. */
const LAUNCH_AT = Date.parse('2026-11-01T00:00:00Z');
const standingAt = ms => run('2026-11-01', LAUNCH_AT - ms);
const reads = ms => standingAt(ms).read;
const schedules = ms => { const r = standingAt(ms); return r.delays.length ? r.delays[0] : 0; };

/* ---- the page ships something true before any script runs ---- */
const index = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
check(index.includes(SHIPPED),
  'the home page ships a readable sentence, so no JavaScript means vague rather than blank');
check(/data-opens\b/.test(index), 'the countdown has something to attach to');
/* The one that would be embarrassing: a countdown whose numbers are typed
   into the HTML is wrong for everybody whose JavaScript did not arrive, and
   it looks completely fine while it is wrong. */
check(/<b data-cd="d">--<\/b>/.test(index) && !/<b data-cd="d">\d/.test(index),
  'the clock ships with no numbers in it, so only the script that knows the date can fill it');
check(/class="clock"[^>]*\shidden\b/.test(index),
  'the clock ships hidden, so a browser with no JavaScript never shows an empty one');
['d', 'h', 'm', 's'].forEach(k => check(index.includes('data-cd="' + k + '"'),
  'the clock has a ' + k + ' segment to fill'));

/* ---- what the four segments read, at exact distances from launch ----
   Asserted as all four together, never as one number or a pattern inside a
   string. An earlier version of this gate checked /in 44 days/ and a mutant
   that appended an hours clock survived, because a check that looks at part
   of a string passes for every string containing that part.

   These go through a frozen clock, so the last minute before launch is tested
   at the second rather than waited for. */
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

const AT = [
  [43 * DAY + 20 * HOUR + 14 * MIN + 8 * SEC, '43:20:14:08', 'six weeks out, all four segments'],
  [100 * DAY,                                 '100:00:00:00', 'three digit days are three digits, not truncated'],
  [2 * DAY,                                   '02:00:00:00', 'exactly two days'],
  [2 * DAY - 1 * SEC,                         '01:23:59:59', 'a second under two days rolls every segment at once'],
  [1 * DAY,                                   '01:00:00:00', 'exactly one day'],
  [1 * DAY - 1 * SEC,                         '00:23:59:59', 'a second under a day: days fall to zero, hours do not'],
  [5 * HOUR + 12 * MIN,                       '00:05:12:00', 'the last day'],
  [1 * HOUR,                                  '00:01:00:00', 'exactly an hour'],
  [1 * HOUR - 1 * SEC,                        '00:00:59:59', 'a second under an hour'],
  [14 * MIN + 32 * SEC,                       '00:00:14:32', 'the last hour'],
  [60 * SEC,                                  '00:00:01:00', 'exactly a minute'],
  [59 * SEC,                                  '00:00:00:59', 'the last minute'],
  [1 * SEC,                                   '00:00:00:01', 'the last second'],
];
AT.forEach(t => {
  const got = reads(t[0]);
  check(got === t[1], t[2] + ' — expected ' + t[1] + ', got ' + got);
});

/* every segment is padded to two, so the row does not change width as the
   numbers shrink and the digits do not jump about */
check(/^\d\d:\d\d:\d\d:\d\d$/.test(reads(5 * DAY)), 'every segment is padded to at least two digits');

/* ---- revealing it ---- */
let r = standingAt(10 * DAY);
check(!r.hidden, 'once it has real numbers the clock is revealed');
check(!r.lineRemoved, 'the sentence stays in the page for anything reading it aloud');
check(r.lineHidden, 'the sentence is hidden visually, so it is not shown twice');

/* ---- THE MOMENT IT MATTERS ---- */
check(standingAt(0).removed, 'at zero the clock is gone, not sitting at 00:00:00:00');
check(standingAt(0).lineRemoved, 'and its sentence goes with it');
check(standingAt(-1 * SEC).removed, 'one second past, it is gone');

const day0 = run(day(0));
check(day0.removed, 'ON the launch day the clock removes itself');
check(run(day(-1)).removed, 'the day after, it is gone rather than counting backwards');
check(run(day(-400)).removed, 'a launch date left behind for a year does not resurface');

/* ---- the live path, on the real clock ----
   Worked out here the same way the code does rather than typed in. "44 days
   away" in calendar terms is 43 days and some hours in real ones, because
   every segment floors. Flooring is what keeps the four consistent with each
   other, and a countdown that rounds up overstates the time you have left. */
const liveAt = Date.parse(day(44) + 'T00:00:00Z');
const ms = liveAt - Date.now();
const p = { d: Math.floor(ms / DAY), h: Math.floor(ms % DAY / HOUR), m: Math.floor(ms % HOUR / MIN) };
const live = run(day(44));
check(!live.removed && !live.hidden, 'the live path fills and reveals the clock');
check(live.read.indexOf(String(p.d).padStart(2, '0') + ':' + String(p.h).padStart(2, '0') + ':' + String(p.m).padStart(2, '0')) === 0,
  'the live path on the real clock reads what the parts function would (' + live.read + ')');

/* ---- it has to keep ticking ----
   A clock that paints once and stops is a screenshot of a clock. */
check(schedules(44 * DAY) > 0, 'far out, it schedules itself to tick again');
check(schedules(30 * SEC) > 0, 'in the last minute, it schedules itself to tick again');
check(schedules(44 * DAY) <= 1000 && schedules(30 * SEC) <= 1000,
  'it ticks at least once a second, because seconds are on the screen ('
  + schedules(44 * DAY) + 'ms / ' + schedules(30 * SEC) + 'ms)');

/* ---- a wrong date must make it quiet, not wrong ----
   Whole-string assertions, because /in November\.$/ once passed happily on
   "in NaN days, in November." A dropped isNaN guard survived that check while
   printing NaN on the home page. */
['the first of never', '', 'November-ish', '2026-13-45'].forEach(bad => {
  const out = run(bad);
  check(out.hidden && !out.removed && out.lineText === STATIC,
    'an unusable date (' + JSON.stringify(bad) + ') leaves the clock hidden and the sentence untouched ('
    + out.lineText + ')');
  check(!/NaN|undefined|Invalid/.test(out.read + out.lineText),
    'an unusable date (' + JSON.stringify(bad) + ') never prints NaN at a visitor');
  check(out.delays.length === 0,
    'an unusable date (' + JSON.stringify(bad) + ') starts no timer');
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
