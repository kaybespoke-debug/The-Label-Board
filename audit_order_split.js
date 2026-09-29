/* =====================================================================
   AN ORDER SPLITS INTO FOUR ON THE WAY OUT AND COMES BACK AS ONE.

   P2 moved the order out of one blob and into a row plus three satellites
   that each ask a permission first. This checks the DEVICE half of that:
   that the split is complete, that it is lossless, and above all that the
   part which travels unprotected — orders.doc, which every member of the
   studio can read — carries none of the seven things the split exists to
   protect.

   WHY THIS GATE EXISTS. The list of protected fields was wrong twice, in
   two different files, in the same way: written against a field shape no
   order has ever had. The app stripped "cost", "email", "phone" and
   "whatsapp"; the live orders carry `costs`, and have never had a `cost`
   or a `phone` at all. So the strip removed two empty strings and left
   everything that mattered. A gate that only asked "does orderDoc run"
   would have passed throughout.

   So this one works from the SHAPE OF THE REAL DATA: an order built the
   way the 68 production orders are built, including the three places a
   secret hides one level down.

   usage: node audit_order_split.js
   ===================================================================== */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('site/layi_dashboard.html', 'utf8');

/* Same sandbox shape as audit_sync.js: run the page's own script, then ask
   the real functions rather than a copy of them. */
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = re.exec(html))) {
  const a = m[1] || '';
  if (/\bsrc\s*=/.test(a)) continue;
  const t = a.match(/type\s*=\s*["']([^"']+)["']/i);
  if (t && !/javascript|module/i.test(t[1])) continue;
  code += '\n;' + m[2] + '\n';
}
const mkEl = () => ({ innerHTML: '', value: '', checked: false, style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
  setAttribute() {}, getAttribute() { return null }, appendChild(c) { return c },
  addEventListener() {}, removeEventListener() {}, querySelector() { return null },
  querySelectorAll() { return [] }, focus() {} });
const _ls = {};
const sb = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, isNaN,
  parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Promise, Intl, Number, String,
  Object, Array, RegExp, Error, URL, TextEncoder, fetch: () => Promise.reject(new Error('offline')),
  localStorage: { getItem: k => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v) },
    removeItem: k => { delete _ls[k] }, key: i => Object.keys(_ls)[i] || null,
    get length() { return Object.keys(_ls).length } },
  location: { hostname: '', href: '', search: '', hash: '', pathname: '/', reload() {} },
  navigator: { userAgent: 'node', onLine: true, serviceWorker: { register: () => Promise.reject(new Error('no sw')) } },
  document: { readyState: 'complete', body: mkEl(), documentElement: mkEl(),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => mkEl(), addEventListener() {}, removeEventListener() {},
    createTextNode: t => ({ t }), head: mkEl(), scripts: [], title: '' },
  alert() {}, confirm: () => true, prompt: () => null, matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: f => f(), caches: undefined, crypto: { getRandomValues: a => a, randomUUID: () => 'x' },
};
sb.window = sb; sb.globalThis = sb; sb.self = sb;
vm.createContext(sb);
try { vm.runInContext(code, sb, { filename: 'app' }); }
catch (e) { console.error('the app would not run: ' + e.message); process.exit(1); }
try { sb.demoLogin(); } catch (e) {}

const run = e => vm.runInContext(e, sb);
let pass = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  PASS  ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

/* ---------------------------------------------------------------------
   An order in the production shape, secrets and all.
   --------------------------------------------------------------------- */
const ORDER = {
  id: 'O-2001', client: 'Mrs Oladuja', branch: 'Lagos', value: 250000, paid: 100000,
  discount: 5000, createdAt: '2026-09-12T09:00:00.000Z', garment: 'Agbada', kind: 'bespoke',
  currency: 'NGN', fx: 1, stageIndex: 4, due: '2026-10-20', makerId: 'st-3',
  satisfaction: 5, invoiceNo: null, channel: 'walk-in',
  email: 'client@example.test', whatsapp: '+234 800 000 0000', address: '9 Awolowo Road',
  costs: [{ label: 'Aso-oke', amount: 60000, supplier: 'Aso-oke House' }, { label: 'Lining', amount: 15000 }],
  commissions: [{ staffId: 'st-3', kind: 'maker', work: 'sewing', amount: 30000, paid: false }],
  directorOn: true, directorPct: 10, directorAmount: 12000,
  referrerId: 'ref-9', referralAmount: 4000,
  saleItems: [{ productId: 'p-1', label: 'Cap', qty: 2, unitPrice: 15000, unitCost: 6000 }],
  outfits: [{ name: 'Main', price: 250000, stageIndex: 4, person: 'Wearer', meas: { Chest: '40' }, photos: [] }],
  delivery: { enabled: true, company: 'GIG', fee: 3500, status: 'booked', tracking: 'GIG-7', location: '14 Bode Thomas, Surulere' },
  updates: [{ at: '2026-09-15T10:00:00.000Z', by: 'Ada', stage: 3, note: 'cut', workerId: 'st-3', photos: [] }],
  qc: { status: 'passed', at: '2026-09-18T10:00:00.000Z', by: 'Ada', note: '', items: [] },
  batch: { on: false, qty: 1, reached: 0 }, group: { on: false },
  potContribs: [{ potId: 'pot-1', amount: 1000 }], stockUsed: [{ supplyId: 'sup-1', qty: 2 }],
  clientPhotos: ['https://example.test/a.jpg'],
};
sb.__O = ORDER;

/* the four functions exist at all */
section('The split exists');
for (const fn of ['orderDoc', 'orderCostRow', 'orderCommissionRow', 'orderContactRow', 'customerIdForName']) {
  ok(fn + '() is defined', run('typeof ' + fn) === 'function');
}
if (fails.length) { console.log('\n' + pass + ' passed, ' + fails.length + ' failed'); process.exit(1); }

const doc = run('orderDoc(__O)');
const cost = run('orderCostRow(__O)');
const comm = run('orderCommissionRow(__O)');
const contact = run('orderContactRow(__O)');

/* ---------------------------------------------------------------------
   1. What travels unprotected must carry nothing protected
   --------------------------------------------------------------------- */
section('1. The document every member can read');
const docJson = JSON.stringify(doc);
for (const [what, probe] of [
  ['the cost lines', /"costs"/], ['a singular cost', /"cost"\s*:/],
  ['the commissions', /"commissions"/],
  ["the owner's cut", /directorAmount|directorPct|directorOn/],
  ['the referral', /referralAmount|referrerId/],
  ['an email address', /client@example/], ['a WhatsApp number', /\+234 800/],
  ['a postal address', /Awolowo/],
  ['a unit cost inside a sold item', /unitCost/],
  ['a delivery address inside the delivery block', /Bode Thomas/],
]) {
  ok('carries no ' + what, !probe.test(docJson), 'found it in doc');
}

section('2. And everything else survived');
ok('the stage', doc.stageIndex === 4);
ok('the money the client is charged', doc.value === 250000 && doc.discount === 5000);
ok('what they have paid', doc.paid === 100000);
ok('the production history', Array.isArray(doc.updates) && doc.updates.length === 1);
ok('the QC record', doc.qc && doc.qc.status === 'passed');
ok('the item line, with its selling price', Array.isArray(doc.saleItems)
  && doc.saleItems.length === 1 && doc.saleItems[0].unitPrice === 15000 && doc.saleItems[0].qty === 2);
ok('the courier, the fee and the tracking number', doc.delivery
  && doc.delivery.company === 'GIG' && doc.delivery.fee === 3500 && doc.delivery.tracking === 'GIG-7');
ok('the outfits, their prices and their measurements', Array.isArray(doc.outfits)
  && doc.outfits[0].price === 250000 && doc.outfits[0].meas && doc.outfits[0].meas.Chest === '40');
ok('the stock used, the fund contributions and the photos',
  Array.isArray(doc.stockUsed) && Array.isArray(doc.potContribs) && Array.isArray(doc.clientPhotos));
ok('and the original order object was not mutated',
  ORDER.costs.length === 2 && ORDER.delivery.location === '14 Bode Thomas, Surulere'
  && ORDER.saleItems[0].unitCost === 6000,
  'orderDoc() edited the caller’s order, which would delete it from the device');

/* ---------------------------------------------------------------------
   3. The three satellites carry it instead
   --------------------------------------------------------------------- */
section('3. What goes behind seeCost');
ok('a cost row is produced', !!cost);
ok('  totalling the cost lines', cost && Number(cost.cost) === 75000, cost && String(cost.cost));
ok('  keeping every line', cost && cost.detail.lines.length === 2);
ok('  and the unit costs hiding in the items', cost
  && cost.detail.item_costs.length === 1 && Number(cost.detail.item_cost_total) === 12000,
  cost && JSON.stringify(cost.detail.item_cost_total));

ok('a commission row is produced', !!comm);
ok('  totalling the lines, the owner’s cut and the referral',
  comm && Number(comm.total) === 30000 + 12000 + 4000, comm && String(comm.total));
ok('  keeping who earned what', comm && comm.detail.lines.length === 1
  && comm.detail.lines[0].staffId === 'st-3');
ok('  the owner’s cut', comm && comm.detail.director.amount === 12000 && comm.detail.director.pct === 10);
ok('  and the referral', comm && comm.detail.referral.referrerId === 'ref-9');

section('4. What goes behind seeContact');
ok('a contact row is produced', !!contact);
ok('  with the delivery address', contact && contact.detail.delivery_location === '14 Bode Thomas, Surulere');
ok('  the email', contact && contact.detail.email === 'client@example.test');
ok('  the WhatsApp number', contact && contact.detail.whatsapp === '+234 800 000 0000');
ok('  and the postal address', contact && contact.detail.address === '9 Awolowo Road');

/* ---------------------------------------------------------------------
   5. Nothing is silently dropped
   --------------------------------------------------------------------- */
section('5. Every field of the order reached one of the four');
{
  const inDoc = new Set(Object.keys(doc));
  const inCost = new Set(['costs', 'cost']);
  const inItems = new Set();
  const inComm = new Set(['commissions', 'directorOn', 'directorPct', 'directorAmount', 'referrerId', 'referralAmount']);
  const inContact = new Set(['email', 'whatsapp', 'address']);
  const lost = Object.keys(ORDER).filter(k =>
    !inDoc.has(k) && !inCost.has(k) && !inComm.has(k) && !inContact.has(k) && !inItems.has(k));
  ok('no field of the order went nowhere', lost.length === 0, 'lost: ' + lost.join(', '));
}

section('6. A device that holds none of it cannot blank the studio’s');
{
  /* Somebody without seeCost pulls an order and gets no costs key at all.
     When they save it, the satellite builders must return null rather than
     a zero, or an ordinary save by a tailor wipes the studio's figures. */
  const bare = JSON.parse(JSON.stringify(ORDER));
  delete bare.costs; delete bare.cost; delete bare.commissions;
  delete bare.directorOn; delete bare.directorPct; delete bare.directorAmount;
  delete bare.referrerId; delete bare.referralAmount;
  delete bare.email; delete bare.whatsapp; delete bare.address;
  if (bare.saleItems) bare.saleItems = bare.saleItems.map(i => { const c = { ...i }; delete c.unitCost; return c; });
  if (bare.delivery) { bare.delivery = { ...bare.delivery }; delete bare.delivery.location; }
  sb.__B = bare;
  ok('no cost row is sent', run('orderCostRow(__B)') === null);
  ok('no commission row is sent', run('orderCommissionRow(__B)') === null);
  ok('no contact row is sent', run('orderContactRow(__B)') === null);
}

section('7. The list the app strips by matches the list the database strips by');
{
  const appList = run('ORDER_PROTECTED.slice().sort().join(",")');
  const sql = fs.readFileSync('supabase/migrations/20260929231000_orders_migration_and_reconciliation.sql', 'utf8');
  const body = (sql.match(/v_doc := p_order([\s\S]*?);/) || [])[1] || '';
  const sqlList = (body.match(/'([a-zA-Z]+)'/g) || []).map(x => x.replace(/'/g, '')).sort().join(',');
  ok('the two lists are the same, so nothing is stripped in one place and kept in the other',
    appList === sqlList, 'app: ' + appList + '\n            sql: ' + sqlList);
}

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fails.length + ' failed');
for (const f of fails) console.log('  - ' + f);
if (!fails.length) console.log('\nAn order leaves the device in four pieces, the unprotected piece\ncarries nothing worth protecting, and no piece is lost.');
process.exit(fails.length ? 1 : 0);
