// Build a page per app that a browser can measure at phone width.
//
// A page that scrolls sideways cannot be found by grepping and cannot be
// found in node: it needs a layout engine. The console and the portal both
// need a sign-in, so neither can simply be opened and driven. This renders
// every one of their pages the way they render themselves, drops the markup
// into the real shell with the real stylesheet, and leaves a file a browser
// can open.
//
// Written after the Partners page shipped 606px wide inside a 375px screen,
// which put every heading and every card off the left edge of the phone.
//
// Usage:
//   node build_overflow_harness.js
//   npx http-server . -p 3005 -c-1
//   open http://localhost:3005/_overflow_tmp/console.html at 320, 414, 768
//
// Then, in the console:
//   const pages = JSON.parse(document.getElementById("pages").textContent);
//   for (const p of pages) { slot.innerHTML = p.html;
//     if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
//       console.log(p.name); }
//
// TWO TRAPS, both of which reported confident nonsense before being found:
//   - one harness carrying both stylesheets and toggling link.disabled measures
//     pages against whichever sheet was live a tick ago. One file per app.
//   - measuring in the same call that resizes the viewport reads the old
//     layout. Resize, then measure in a separate call, and check that
//     clientWidth and innerWidth agree before believing anything.

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const out = path.join(root, '_overflow_tmp');
fs.mkdirSync(out, { recursive: true });

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

function boot(files, dir) {
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
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(root, dir, f), 'utf8'), sb, { filename: f });
  }
  sb.render = function () {}; sb.renderAuth = function () {};
  return { sb, run: e => vm.runInContext(e, sb) };
}

const pages = [];

/* ---- the console ---- */
{
  const indexHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  const files = [...indexHtml.matchAll(/src="(js\/[a-z0-9]+\.js)"/g)].map(m => m[1]);
  const b = boot(files, 'admin');
  b.run('UI.page="dashboard";');
  /* The Partners page reads live rows, so demo data leaves it empty and the
     table that actually overflowed never renders. These are the shapes from
     Kayode's own console, long unbreakable addresses included, because the
     address is what refuses to wrap. */
  b.sb.__partners = [
    { id: 'p1', name: 'R2W Apparels', business: '', code: 'R2WAPPARELS', tier: 'bronze',
      email: 'r2wapparels@gmail.com', status: 'active', pending: false, joined: '2026-09-15' },
    { id: 'p2', name: 'Layiwola Ojomo', business: '', code: 'KUNLE', tier: 'bronze',
      email: 'layiojomo@gmail.com', status: 'active', pending: true, joined: '2026-09-14' },
    { id: 'p3', name: 'S Xtraordinaire', business: 'Xtraordinaire Studio', code: 'SXTRA', tier: 'bronze',
      email: 's.xtraordinaire@gmail.com', status: 'active', pending: false, joined: '2026-09-14' },
    { id: 'p4', name: 'Test Partner', business: '', code: 'TEST-PARTNER', tier: 'silver',
      email: 'test.partner@thelabelboard.com', status: 'active', pending: false, joined: '2026-05-07' },
  ];
  b.run('DB.partners = __partners;');
  for (const p of b.run('Object.keys(PAGES)')) {
    let html = '';
    try { html = b.run('PAGES[' + JSON.stringify(p) + ']()'); } catch (e) { html = '<div>threw: ' + e.message + '</div>'; }
    pages.push({ app: 'console', css: '../../../../../../Downloads/Claude Code/admin/css/app.css', name: p, html: String(html) });
  }
  // and the one detail view that carries the widest tables
  try {
    const id = b.run('DB.subscribers[0] && DB.subscribers[0].id');
    if (id) {
      for (const t of ['profile', 'subscription', 'referrals', 'businesses', 'payments', 'support', 'activity']) {
        b.run('UI.vtab[' + JSON.stringify('sub' + id) + ']=' + JSON.stringify(t) + ';');
        const html = b.run('DETAIL.sub(' + JSON.stringify(id) + ')');
        pages.push({ app: 'console', css: '../../../../../../Downloads/Claude Code/admin/css/app.css', name: 'subscriber:' + t, html: String(html) });
      }
    }
  } catch (e) { /* the detail view is covered by its own gate */ }
}

/* ---- the partner portal ---- */
{
  const files = ['js/config.js', 'js/data.js', 'js/core.js', 'js/pages.js', 'js/pages2.js',
    'js/detail.js', 'js/actions.js', 'js/live.js', 'js/auth.js'];
  const b = boot(files, 'partners');
  b.run('CONFIG.live=false;');
  b.run('loadPartnerData(PARTNER_PROFILES[0].key);');
  for (const p of b.run('Object.keys(PAGES)')) {
    let html = '';
    try { html = b.run('PAGES[' + JSON.stringify(p) + ']()'); } catch (e) { html = '<div>threw: ' + e.message + '</div>'; }
    pages.push({ app: 'portal', css: '../../../../../../Downloads/Claude Code/partners/css/app.css', name: p, html: String(html) });
  }
}

/* ONE HARNESS PER APP, each with only its own stylesheet.
   The first version carried both and disabled one — and toggling `disabled` on
   a <link> re-applies asynchronously, so every page got measured against
   whichever sheet happened to be live a tick earlier. It reported four
   overflowing pages at one width and none at another, with identical pixel
   numbers at both, which is the shape of a measurement lying rather than a
   layout changing. No toggling, no race. */
const shell = (css, list) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${css}">
</head><body>
<div class="shell"><main class="main"><div id="slot"></div></main></div>
<script id="pages" type="application/json">${JSON.stringify(list).replace(/</g, '\\u003c')}</script>
</body></html>`;

const byApp = { console: [], portal: [] };
pages.forEach(p => byApp[p.app].push(p));

fs.writeFileSync(path.join(out, 'console.html'), shell('../admin/css/app.css', byApp.console));
fs.writeFileSync(path.join(out, 'portal.html'), shell('../partners/css/app.css', byApp.portal));

console.log('console.html: ' + byApp.console.length + ' pages');
console.log('portal.html:  ' + byApp.portal.length + ' pages');
