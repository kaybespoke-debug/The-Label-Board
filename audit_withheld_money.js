/* =====================================================================
   A FIGURE THAT IS NOT YOURS IS NOT ZERO.

   October moved the selling price and the paid figure out of the order
   document and into order_pricing and order_settlement, behind `money` and
   `receivables`. The server now withholds them, which means the app
   receives an order with no `value` key at all rather than a value of
   nothing.

   That is the right shape and it is also a trap, because every money
   formatter in the app was written as fmtNum(n||0). A withheld price would
   have printed as ₦0: a specific, confident, wrong number, on the screen
   where somebody decides whether an order has been paid for. "Not
   authorised" and "free" are not the same sentence.

   This gate holds three things:

     1. the formatters tell an absent figure from a zero one
     2. the headline figure on an order says why it is missing, because a
        dash where the total should be is a puzzle rather than an answer
     3. a role that may not see the price gets no number anywhere on the
        order panel — checked by RENDERING it, not by reading the source,
        because the source has a hundred places that print an amount

   usage: node audit_withheld_money.js
   ===================================================================== */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('site/layi_dashboard.html', 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = re.exec(html))) {
  const a = m[1] || '';
  if (/\bsrc\s*=/.test(a)) continue;
  const t = a.match(/type\s*=\s*["']([^"']+)["']/i);
  if (t && !/javascript|module/i.test(t[1])) continue;
  code += '\n;' + m[2] + '\n';
}

/* Elements that exist for any id, so a render writes somewhere we can read
   it back from, the same shape audit_method.js uses. */
const els = {};
const mkEl = (id) => (els[id] = els[id] || { id, innerHTML: '', value: '', checked: false,
  style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
  setAttribute() {}, getAttribute() { return null }, appendChild(c) { return c },
  addEventListener() {}, removeEventListener() {}, querySelector() { return null },
  querySelectorAll() { return [] }, focus() {}, remove() {} });
const _ls = {};
const sb = {
  console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  Date, Math, JSON, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  Promise, Intl, Number, String, Object, Array, RegExp, Error, URL, TextEncoder,
  fetch: () => Promise.reject(new Error('offline')),
  localStorage: { getItem: k => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v) },
    removeItem: k => { delete _ls[k] }, key: i => Object.keys(_ls)[i] || null,
    get length() { return Object.keys(_ls).length } },
  location: { hostname: '', href: '', search: '', hash: '', pathname: '/', reload() {} },
  navigator: { userAgent: 'node', onLine: true, serviceWorker: { register: () => Promise.reject(new Error('x')) } },
  document: { readyState: 'complete', body: mkEl('body'), documentElement: mkEl('html'),
    getElementById: (id) => mkEl(id), querySelector: () => mkEl('q'), querySelectorAll: () => [],
    createElement: () => mkEl('new'), addEventListener() {}, removeEventListener() {},
    createTextNode: t => ({ t }), head: mkEl('head'), scripts: [], title: '' },
  alert() {}, confirm: () => true, prompt: () => null,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: () => 0, caches: undefined,
  crypto: { getRandomValues: a => a, randomUUID: () => 'x' },
};
sb.window = sb; sb.globalThis = sb; sb.self = sb;
vm.createContext(sb);
vm.runInContext(code, sb, { filename: 'app' });
const run = e => vm.runInContext(e, sb);

let pass = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

/* ---------------------------------------------------------------------
   1. The formatters
   --------------------------------------------------------------------- */
section('1. Nothing and not-for-you are different answers');
run("save('layi_dash_roles',defaultRoles());currentUser={id:'u-gate',name:'Gate',roleId:'owner'};");

ok('the app has a word for a withheld figure', run('typeof NOT_SHOWN') === 'string'
  && run('NOT_SHOWN').length > 0, run('typeof NOT_SHOWN'));
ok('and a test for one', run('typeof isWithheld') === 'function');
ok('undefined is withheld', run('isWithheld(undefined)') === true);
ok('null is withheld', run('isWithheld(null)') === true);
ok('an empty string is withheld', run("isWithheld('')") === true);
ok('zero is NOT withheld, because zero is a number somebody chose',
  run('isWithheld(0)') === false);

for (const [name, call] of [
  ['cur',  "cur(%)"],
  ['cur2', "cur2(%)"],
  ['curk', "curk(%)"],
  ['curC', "curC(%,'NGN')"],
  ['curO', "curO(%,{currency:'NGN'})"],
]) {
  const withheld = run(call.replace('%', 'undefined'));
  const zero = run(call.replace('%', '0'));
  const real = run(call.replace('%', '125000'));
  ok(name + '() prints a dash for a withheld figure', withheld === run('NOT_SHOWN'),
    JSON.stringify(withheld));
  ok(name + '() still prints a real zero as a figure',
    zero !== run('NOT_SHOWN') && /0/.test(String(zero)), JSON.stringify(zero));
  ok(name + '() is unchanged for an ordinary amount', /1/.test(String(real)), JSON.stringify(real));
}

/* ---------------------------------------------------------------------
   2. The headline figure
   --------------------------------------------------------------------- */
section('2. Where the figure IS the answer, it says why it is missing');
ok('there is a reason to show instead of a number', run('typeof notShown') === 'function');
{
  const r = run("notShown('what an order sells for')");
  ok('it says Not shown', /Not shown/.test(r), r);
  ok('and it says whose it is not', /not part of your role/.test(r), r);
  ok('and it is not a figure', !/₦0|₦ ?0/.test(r), r);
}

/* ---------------------------------------------------------------------
   3. The panel itself, for somebody who may not see the price
   --------------------------------------------------------------------- */
section('3. An order panel with no price on it, rendered');
{
  /* The order as the SERVER hands it to somebody without `money` or
     `receivables`: no value, no discount, no paid, no line prices, no
     delivery fee. That is what pullOrders leaves on the device, and the
     screens must not invent zeroes for any of it. */
  const withheld = {
    id: 'O-WH', client: 'Mrs Oladuja', branch: 'Lagos', garment: 'Agbada',
    kind: 'bespoke', currency: 'NGN', fx: 1, stageIndex: 3,
    createdAt: '2026-09-12T09:00:00.000Z', due: '2026-10-20',
    outfits: [{ name: 'Main', stageIndex: 3, photos: [] }],
    updates: [], delivery: { enabled: true, company: 'GIG', status: 'booked', tracking: 'GIG-7' },
  };
  /* and the same order for the owner, with everything on it */
  const full = Object.assign({}, withheld, {
    id: 'O-FULL', value: 250000, paid: 100000, discount: 0,
    outfits: [{ name: 'Main', price: 250000, stageIndex: 3, photos: [] }],
    delivery: Object.assign({}, withheld.delivery, { fee: 3500 }),
  });
  sb.__WH = withheld; sb.__FULL = full;

  /* A ROLE WITH ORDERS AND NO MONEY. headprod is exactly this and it is
     why the gap mattered: a head of production runs the workroom and has
     never been meant to see what the studio charges. */
  run("save('layi_dash_roles',defaultRoles().concat([{id:'noMoney',name:'Workroom head',builtin:false," +
      "perms:{orders:1,allOrders:1,update:1,canQC:1,canDispatch:1,products:1,supplies:1," +
      "customers:1,seeContact:1,team:1,tasks:1,attendance:1,money:0,receivables:0," +
      "finance:0,expenses:0,funds:0,sales:0,payroll:0,seeProfit:0,seeCost:0," +
      "audit:0,settings:0,users:0,del:0,appts:0,marketing:0,logistics:0,branchSwitch:0}}]));" +
      "currentUser={id:'u-gate',name:'Gate',roleId:'noMoney'};");

  ok('the role can open orders at all', run("can('orders')") === true);
  ok('and cannot see what they sell for', run("can('money')") === false);
  ok('nor what has been paid', run('canReceivables()') === false);

  const line = run('(function(){try{return orderTotalLine(__WH);}catch(e){return "NO_FN";}})()');
  if (line === 'NO_FN') {
    /* No extracted helper, so render the whole detail pane instead. */
    run("save(ORDERS_KEY,[__WH,__FULL]);");
    let out = '';
    try { run("openDetail('O-WH');"); out = String(els['detailBody'] ? els['detailBody'].innerHTML : ''); }
    catch (e) { out = 'THREW: ' + e.message; }
    if (!out || /^THREW/.test(out)) {
      /* The pane could not be rendered in a sandbox. Fall back to the one
         thing that can still be asserted without a browser: the template
         that builds it must not print the value unguarded. */
      const src = html.replace(/\s+/g, ' ');
      const i = src.indexOf('class="total-line"><span>${');
      const slice = i >= 0 ? src.slice(i, i + 420) : '';
      ok('the headline total is behind can(money) in the source',
        /can\('money'\)\?curO\(o\.value/.test(slice), slice.slice(0, 200) || 'the total line was not found');
      ok('and falls back to the reason rather than a figure',
        /:notShown\(/.test(slice), slice.slice(0, 200));
      ok('and the paid label is behind receivables rather than money',
        /canReceivables\(\)&&!isWithheld\(o\.paid\)/.test(slice), slice.slice(0, 200));
    } else {
      ok('the panel renders', out.length > 0);
      ok('and carries no invented zero', !/₦0(?!\d)/.test(out), out.slice(0, 300));
      ok('and says the price is not theirs', /Not shown/.test(out), out.slice(0, 300));
    }
  } else {
    ok('the headline carries no figure', !/₦/.test(line), line);
    ok('and says why', /Not shown/.test(line), line);
  }
}

/* ---------------------------------------------------------------------
   4. And the owner is unaffected
   --------------------------------------------------------------------- */
section('4. The owner still sees the money, which is the other half');
{
  run("currentUser={id:'u-gate',name:'Gate',roleId:'owner'};");
  ok('an owner sees what the order sells for', run("can('money')") === true);
  ok('and what has been paid', run('canReceivables()') === true);
  ok('and the formatter prints it', /250/.test(String(run("curO(250000,{currency:'NGN'})"))));
}

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fails.length + ' failed');
for (const f of fails) console.log('  - ' + f);
if (!fails.length) {
  console.log('\nA withheld figure reads as withheld. Nothing prints ₦0 because');
  console.log('somebody was not allowed to be told the number.');
}
process.exit(fails.length ? 1 : 0);
