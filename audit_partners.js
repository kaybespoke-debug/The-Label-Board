/* audit_partners.js — the Partner Portal.
 *
 * Why this gate exists: the portal shows a partner what they are owed. A page
 * that throws is embarrassing; a page that quietly disagrees with the ledger
 * behind it is worse, because the partner has no way to tell which number is
 * the real one. So this gate does three things a static grep cannot:
 *
 *   1. it actually runs every page and every detail view against a stub DOM,
 *      so a typo in a template string fails here rather than on someone's phone
 *   2. it reconciles the money: paid + ready + on hold must equal what has been
 *      earned, the statements must add up to the payouts they belong to, and no
 *      commission may exist without a referral that earned it
 *   3. it keeps the portal small. The first build was overloaded: charts, a
 *      funnel, plan and city breakdowns, nine pages, six cards on the home
 *      screen. Section 8 holds the line so it cannot creep back.
 *
 * Run: node audit_partners.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.resolve(__dirname, 'partners');
const fail = [];
const ok = [];
const check = (cond, msg) => (cond ? ok : fail).push(msg);

/* ---------- a DOM thin enough to build in a minute, real enough to render ---------- */
function makeEl(id) {
  return {
    id,
    innerHTML: '', textContent: '', value: '', scrollTop: 0,
    style: {}, dataset: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { const has = this._s.has(c); (on === undefined ? !has : !!on) ? this._s.add(c) : this._s.delete(c); }
    },
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, removeChild() {}, addEventListener() {},
    select() {}, focus() {}, closest() { return null; },
    querySelector() { return makeEl('q'); }, querySelectorAll() { return []; }
  };
}
const els = {};
const document = {
  body: makeEl('body'),
  addEventListener() {},
  createElement(t) { return makeEl(t); },
  getElementById(id) { return (els[id] = els[id] || makeEl(id)); },
  querySelector() { return makeEl('main'); },
  querySelectorAll() { return []; }
};
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

const sandbox = {
  document, localStorage,
  navigator: {}, location: { reload() {}, href: '' },
  console, setTimeout, clearTimeout, Blob: function () {},
  URL: { createObjectURL: () => '', revokeObjectURL() {} },
  Math, Date, JSON, Set, Map, Array, Object, String, Number, RegExp, isNaN, parseInt, parseFloat, encodeURIComponent
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.open = () => {};
vm.createContext(sandbox);

/* ---------- 1. every file loads and parses ---------- */
const FILES = ['js/data.js', 'js/core.js', 'js/pages.js', 'js/pages2.js', 'js/detail.js', 'js/actions.js'];
let loaded = true;
for (const f of FILES) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { check(false, 'file exists: ' + f); loaded = false; continue; }
  try {
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
    check(true, 'loads: ' + f);
  } catch (e) {
    check(false, 'loads: ' + f + ' — ' + e.message);
    loaded = false;
  }
}
if (!loaded) { report(); process.exit(1); }

/* the shell defines render(); pages call it after a mutation */
sandbox.render = function () {};

/* A top-level const inside a vm script lands in the context's lexical scope,
   not on its global object, so DB and friends have to be read back by name. */
const G = expr => vm.runInContext(expr, sandbox);
const DB = G('DB'), Q = G('Q'), PAGES = G('PAGES'), DETAIL = G('DETAIL'), UI = G('UI');
const money = G('money'), parseD = G('parseD'), iso = G('iso');

/* ---------- 2. the dataset is actually populated ---------- */
check(DB.referrals.length > 0, 'referrals: ' + DB.referrals.length + ' generated');
check(DB.ledger.length > 0, 'ledger: ' + DB.ledger.length + ' rows generated');
check(DB.payouts.length > 0, 'payouts: ' + DB.payouts.length + ' generated');
check(DB.links.length > 0, 'links: ' + DB.links.length + ' generated');
check(DB.updates.length > 0, 'updates: ' + DB.updates.length + ' generated');
check(DB.accounts.filter(a => a.primary).length === 1, 'accounts: exactly one is marked primary');

/* ---------- 3. the money reconciles ---------- */
const lifetime = Q.lifetime(), paid = Q.paid(), ready = Q.available(), held = Q.pending();
check(paid + ready + held === lifetime,
  'earnings split: paid ' + paid + ' + ready ' + ready + ' + on hold ' + held + ' = earned ' + lifetime);

const payoutTotal = DB.payouts.reduce((t, p) => t + p.amount, 0);
check(payoutTotal === paid, 'payouts total ' + payoutTotal + ' equals what the ledger calls paid ' + paid);

const itemTotal = DB.payouts.reduce((t, p) => t + Q.payoutItems(p.ref).reduce((s, r) => s + r.amount, 0), 0);
check(itemTotal === payoutTotal, 'every payout statement adds up to the payout it belongs to');

const itemCount = DB.payouts.reduce((t, p) => t + Q.payoutItems(p.ref).length, 0);
check(itemCount === DB.ledger.filter(r => r.status === 'paid').length,
  'every paid ledger row appears on exactly one statement');

check(DB.ledger.filter(r => !Q.ref(r.refId)).length === 0,
  'no ledger row points at a referral that does not exist');
check(DB.ledger.filter(r => r.type === 'signup' && !(Q.ref(r.refId) || {}).subscribedOn).length === 0,
  'no signup commission on an account that never paid');

const seen = {};
check(DB.ledger.filter(r => r.type === 'signup' && (seen[r.refId] ? true : (seen[r.refId] = 1, false))).length === 0,
  'no business earns signup commission twice');

const perBiz = DB.referrals.reduce((t, r) => t + Q.earnedFor(r.id), 0);
const commissionTotal = DB.ledger.filter(r => r.type === 'signup').reduce((t, r) => t + r.amount, 0);
check(perBiz === commissionTotal, 'what each business earned sums to the commission total (' + perBiz + ')');
check(commissionTotal + Q.bonuses() === lifetime, 'commission plus bonuses equals everything earned');

/* ---------- 4. rate history is honest ---------- */
const ratesUsed = new Set(DB.ledger.filter(r => r.type === 'signup').map(r => r.rate));
const validRates = new Set(DB.tiers.map(t => t.pct));
check([...ratesUsed].every(r => validRates.has(r)),
  'every commission used a real tier rate (' + [...ratesUsed].sort((a, b) => a - b).join(', ') + '%)');
check(DB.ledger.filter(r => r.type === 'signup').every(r => r.amount === Math.round(r.basis * r.rate / 100)),
  'every commission equals its rate applied to the first payment it was based on');

/* Every run had to be worth making. The threshold came down from 25,000 to
   10,000, so a run is judged against whichever figure was in force that month,
   and anything short of it rolls forward rather than going out. */
const changedOn = G('THRESHOLD_CHANGED_ON');
const minOn = ref => (ref.slice(3) >= changedOn.slice(0, 7) ? 10000 : 25000);
const tooSmall = DB.payouts.filter(p => p.amount < minOn(p.ref));
check(tooSmall.length === 0, 'no payout went out below the minimum in force that month' +
  (tooSmall.length ? ' (' + tooSmall.map(p => p.ref + ' ' + p.amount).join(', ') + ')' : ''));

const lastRunOn = DB.payouts.length ? DB.payouts[0].paidOn : null;
check(DB.ledger.filter(r => r.status === 'cleared' && lastRunOn && r.clearsOn <= lastRunOn).length === 0,
  'nothing that had already cleared was left behind by a payout that did run');
check(DB.ledger.filter(r => r.status === 'paid' && parseD(r.paidOn) < parseD(r.clearsOn)).length === 0,
  'nothing was paid out before it cleared the hold');
check(DB.ledger.filter(r => r.status === 'pending' && parseD(r.clearsOn) <= DB.today).length === 0,
  'nothing is still on hold after its clearing date has passed');

/* ---------- 5. nothing is dated in the future, and events happen in order ----------
   Deriving a conversion date forward from a signup once pushed a few accounts
   past today, so the portal cheerfully announced that a business would stop
   paying next October. Dates only ever run backwards from a known day now. */
const today = iso(DB.today);
const futureLapse = DB.referrals.filter(r => r.lapsedOn && r.lapsedOn > today);
check(DB.referrals.filter(r => r.signedUpOn > today).length === 0, 'no referral signed up in the future');
check(DB.referrals.filter(r => r.subscribedOn && r.subscribedOn > today).length === 0,
  'no referral started paying in the future');
check(futureLapse.length === 0, 'no referral stopped paying in the future' +
  (futureLapse.length ? ' (' + futureLapse.map(r => r.business + ' ' + r.lapsedOn).join(', ') + ')' : ''));
check(DB.ledger.every(r => r.date <= today), 'nothing was credited in the future');
check(DB.payouts.every(p => p.paidOn <= today), 'no payout was sent in the future');
check(DB.referrals.every(r => !r.subscribedOn || r.subscribedOn >= r.signedUpOn), 'nobody paid before they signed up');
check(DB.referrals.every(r => !r.lapsedOn || r.lapsedOn > r.subscribedOn), 'nobody stopped paying before they started');
check(Q.trialing().every(r => r.trialEndsIn >= 0 && r.trialEndsIn <= 14),
  'every trial has a sensible number of days left on it');

/* ---------- 6. the counts cannot contradict each other ---------- */
check(Q.converted().length <= Q.signups(), 'nobody converted who never signed up');
check(Q.signups() <= Q.clicks(), 'no more signups than link opens');
check(Q.paying().length + Q.lapsed().length === Q.converted().length,
  'every converted account is either still paying or has stopped');
check(DB.links.reduce((t, l) => t + l.signups, 0) === DB.referrals.length,
  'every referral is attributed to exactly one link');
check(DB.links.reduce((t, l) => t + l.earned, 0) === commissionTotal,
  'what the links earned sums to the commission total');

const n = Q.converted().length;
check(Q.tier() === G('tierFor')(n), 'the tier shown is the tier the referral count earns');
check(!Q.next() || Q.next().min > n, 'the next tier is genuinely ahead of where you are');
check(Q.tierProgress() >= 0 && Q.tierProgress() <= 100, 'tier progress stays inside 0 to 100');

/* ---------- 7. every page and every tab renders ---------- */
const PAGE_IDS = ['home', 'earnings', 'referrals', 'share', 'updates', 'account'];
const rendered = {};
for (const p of PAGE_IDS) {
  if (!PAGES[p]) { check(false, 'page exists: ' + p); continue; }
  try {
    const html = PAGES[p]();
    rendered[p] = html;
    check(typeof html === 'string' && html.length > 200, 'renders: ' + p + ' (' + html.length + ' chars)');
    check(!/undefined|NaN|\[object Object\]/.test(html), 'clean output: ' + p);
  } catch (e) {
    check(false, 'renders: ' + p + ' — ' + e.message);
  }
}

const TABS = {
  earnings: ['all', 'pending', 'paid', 'payouts'],
  referrals: ['all', 'subscribed', 'push', 'lapsed']
};
for (const [page, tabs] of Object.entries(TABS)) {
  for (const t of tabs) {
    UI.filters[page] = t;
    try { check(PAGES[page]().length > 100, 'renders: ' + page + ' / ' + t); }
    catch (e) { check(false, 'renders: ' + page + ' / ' + t + ' — ' + e.message); }
  }
  UI.filters[page] = tabs[0];
}

/* ---------- 8. it stays small ----------
   The first build buried the two questions a partner actually has under charts,
   a funnel, plan and city breakdowns and nine pages. These are the limits that
   came out of that, held here so the next feature has to argue for itself. */
check(PAGE_IDS.length <= 6, 'the portal is ' + PAGE_IDS.length + ' pages, not more');

const count = (html, needle) => (html.split(needle).length - 1);
check(count(rendered.home, 'class="st ') <= 3,
  'the home screen shows at most 3 stat cards (' + count(rendered.home, 'class="st ') + ')');
for (const p of PAGE_IDS) {
  const cards = count(rendered[p] || '', 'class="st ');
  check(cards <= 3, p + ' shows at most 3 stat cards (' + cards + ')');
  const tabs = count(rendered[p] || '', '<button class="tab');   // not the .tabs wrapper
  check(tabs <= 4, p + ' offers at most 4 tabs (' + tabs + ')');
}

/* No charts anywhere. They ate the space a partner needed for the list. */
const allHtml = PAGE_IDS.map(p => rendered[p] || '').join('');
for (const marker of ['viewBox="0 0 760', 'donutwrap', 'class="funnel', 'class="hbar', 'chartbox']) {
  check(!allHtml.includes(marker), 'no chart markup on any page (' + marker + ')');
}
/* and no leftover CSS for things that no longer render */
const css = fs.readFileSync(path.join(dir, 'css/app.css'), 'utf8');
for (const dead of ['.chartbox', '.donutwrap', '.hbar', '.funnel', '.fstage', '.rangetab', '.periodbar', '.vtab']) {
  check(!css.includes(dead + '{') && !css.includes(dead + ' '), 'no dead stylesheet rules for ' + dead);
}

/* ---------- 9. every detail view renders, for every kind of record ---------- */
const samples = ['subscribed', 'trial', 'signed-up', 'lapsed']
  .map(s => DB.referrals.find(r => r.stage === s)).filter(Boolean);
check(samples.length === 4, 'every referral stage has at least one record to open');
for (const r of samples) {
  try {
    const html = DETAIL.ref(r.id);
    check(html.length > 200, 'renders: ' + r.stage + ' referral');
    check(!/undefined|NaN/.test(html), 'clean output: ' + r.stage + ' referral');
    /* a detail view is one scrolling page now, not a tab strip */
    check(!html.includes('class="vtab'), r.stage + ' referral has no tabs inside it');
  } catch (e) {
    check(false, 'renders: ' + r.stage + ' referral — ' + e.message);
  }
}
for (const p of DB.payouts.slice(0, 3)) {
  try {
    const html = DETAIL.payout(p.ref);
    check(html.length > 200, 'renders: payout ' + p.ref);
    check(html.includes(money(p.amount)), 'payout ' + p.ref + ' shows its own total');
  } catch (e) { check(false, 'renders: payout ' + p.ref + ' — ' + e.message); }
}
for (const u of DB.updates.slice(0, 3)) {
  try { check(DETAIL.update(u.id).length > 200, 'renders: update ' + u.id); }
  catch (e) { check(false, 'renders: update ' + u.id + ' — ' + e.message); }
}
try { check(DETAIL.ref(99999).includes('not here'), 'a missing referral says so instead of throwing'); }
catch (e) { check(false, 'a missing referral throws: ' + e.message); }
try { check(DETAIL.payout('PO-1900-01').includes('not here'), 'a missing payout says so instead of throwing'); }
catch (e) { check(false, 'a missing payout throws: ' + e.message); }

/* ---------- 10. the actions a partner can actually press ---------- */
const before = DB.links.length;
els.nlLabel = makeEl('nlLabel'); els.nlLabel.value = 'Test channel';
els.nlCode = makeEl('nlCode'); els.nlCode.value = 'TESTX';
try {
  sandbox.doNewLink();
  check(DB.links.length === before + 1, 'a new link is created');
  const made = DB.links[DB.links.length - 1];
  check(made.url.endsWith('TESTX'), 'a new link carries the code you chose');
  check(made.custom === true, 'a new link is marked as yours, so it can be deleted again');
  sandbox.doNewLink();
  check(DB.links.length === before + 1, 'the same code ending cannot be made twice');
  sandbox.removeLink(made.id);
  check(DB.links.length === before, 'a link with nothing attached can be deleted');
} catch (e) {
  check(false, 'link actions: ' + e.message);
}
const busy = DB.links.find(l => l.signups > 0);
if (busy) {
  const was = DB.links.length;
  busy.custom = true;                       // pretend it was made in the portal
  sandbox.removeLink(busy.id);
  check(DB.links.length === was, 'a link with signups attached is not deleted, it offers a pause instead');
  busy.custom = false;
}

const acctsBefore = DB.accounts.length;
els.acName = makeEl('acName'); els.acName.value = 'Amaka Okafor';
els.acBank = makeEl('acBank'); els.acBank.value = 'Access Bank';
els.acNum = makeEl('acNum'); els.acNum.value = '123';        // too short on purpose
sandbox.doAddAccount();
check(DB.accounts.length === acctsBefore, 'a short account number is refused');
els.acNum.value = '1234567890';
sandbox.doAddAccount();
check(DB.accounts.length === acctsBefore + 1, 'a valid account is added');
const added = DB.accounts[DB.accounts.length - 1];
check(added.verified === false, 'a newly added account starts unverified');
check(added.primary === false, 'adding an account does not silently redirect your payouts');
sandbox.makePrimary(added.id);
check(DB.accounts.filter(a => a.primary).length === 1, 'making one primary demotes the other');
sandbox.doRemoveAccount(added.id);
check(DB.accounts.length === acctsBefore, 'an account can be removed again');
check(DB.accounts.filter(a => a.primary).length === 1, 'removing the primary promotes another, never leaves none');

DB.settings.readUpdates = [];
sandbox.markRead(DB.updates[0].id);
check(Q.isRead(DB.updates[0].id), 'opening an update marks it read');
sandbox.markRead(DB.updates[0].id);
check(DB.settings.readUpdates.length === 1, 'reading it twice does not double count');
sandbox.markAllRead();
check(Q.unreadUpdates().length === 0, 'mark all read clears the bell');

let exported = null;
sandbox.download = (name, text) => { exported = { name, text }; };
sandbox.toast = () => {};
sandbox.exportEarnings();
check(exported && exported.text.split('\n').length === DB.ledger.length + 1,
  'the earnings export has a row per ledger entry plus a header');
sandbox.exportReferrals();
check(exported && exported.text.split('\n').length === DB.referrals.length + 1,
  'the referrals export has a row per referral plus a header');
sandbox.downloadStatement(DB.payouts[0].ref);
check(exported && exported.text.includes(money(DB.payouts[0].amount)),
  'a payout statement carries the amount that was paid');

/* ---------- 11. the shell wires what it lists ---------- */
const shell = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const navIds = [...shell.matchAll(/\['([a-z]+)', '[A-Z][^']*', 'i-[a-z-]+'/g)].map(m => m[1]);
check(navIds.length === 5, 'the bar holds 5 destinations, which is what a thumb can reach (' + navIds.length + ')');
for (const id of navIds) check(!!PAGES[id], 'nav entry "' + id + '" has a page behind it');
for (const id of PAGE_IDS) check(shell.includes(id + ':'), 'page "' + id + '" has a title in the shell');
check(!navIds.includes('updates') && shell.includes("go('updates')"),
  'updates hangs off the bell rather than taking a sixth slot');
for (const f of FILES) check(shell.includes(f), 'the shell loads ' + f);

/* the service worker must cache what the shell loads, or an offline partner
   gets a blank screen instead of last month's figures */
const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
for (const f of FILES) check(sw.includes(f), 'the service worker caches ' + f);
check(sw.includes('css/app.css'), 'the service worker caches the stylesheet');
check(/CACHE = 'tlb-partners-v\d+'/.test(sw), 'the service worker cache is versioned');
check(!sw.includes('tlb-admin'), 'the portal does not share a cache name with the admin console');

/* the deploy is its own thing, not a folder inside another site */
check(fs.existsSync(path.join(dir, 'netlify.toml')), 'the portal has its own netlify.toml');
check(fs.existsSync(path.join(dir, '_redirects')), 'the portal has its own redirects');
const toml = fs.readFileSync(path.join(dir, 'netlify.toml'), 'utf8');
check(toml.includes('noindex'), 'a signed-in area is kept out of search engines');
check(toml.includes('X-Frame-Options'), 'the portal cannot be framed');

/* ---------- report ---------- */
function report() {
  console.log('\nPartner Portal audit\n' + '='.repeat(60));
  ok.forEach(m => console.log('  pass  ' + m));
  if (fail.length) {
    console.log('\n' + '-'.repeat(60));
    fail.forEach(m => console.log('  FAIL  ' + m));
  }
  console.log('\n' + '='.repeat(60));
  console.log(ok.length + ' passed, ' + fail.length + ' failed\n');
}
report();
process.exit(fail.length ? 1 : 0);
