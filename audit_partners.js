/* audit_partners.js — the Partner Portal.
 *
 * Why this gate exists: the portal shows a partner what they are owed. A page
 * that throws is embarrassing; a page that quietly disagrees with the ledger
 * behind it is worse, because the partner has no way to tell which number is
 * the real one. So this gate does four things a static grep cannot:
 *
 *   1. it drives the sign-in flow, because the front door is now the first
 *      thing between a partner and their money
 *   2. it runs every page and every detail view against a stub DOM, for all
 *      three demo partners, so a typo in a template string fails here rather
 *      than on someone's phone. The third partner has earned nothing, which
 *      is the only way to find out whether the empty states read properly
 *   3. it reconciles the money for each of them: paid + ready + on hold must
 *      equal what has been earned, the statements must add up to the payouts
 *      they belong to, and no commission may exist without a referral
 *   4. it keeps the portal small. The first build was overloaded: charts, a
 *      funnel, plan and city breakdowns, nine pages, six cards on the home
 *      screen. Section 6 holds the line so it cannot creep back.
 *
 * What it deliberately does NOT test is whether one partner can read
 * another's rows. That is a database question, not a JavaScript one, and it
 * is answered by supabase/tests/partner_rls_harness.mjs. A test that proved
 * the client filters correctly would prove nothing at all, because anyone
 * holding the anon key can skip the client.
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
  Math, Date, JSON, Set, Map, Array, Object, String, Number, RegExp,
  isNaN, parseInt, parseFloat, encodeURIComponent, Promise,
  /* Live mode is never reached in demo config, but auth.js closes over fetch
     and a missing global would be a load error rather than a test failure. */
  fetch: async () => ({ ok: false, text: async () => '' })
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.window.open = () => {};
vm.createContext(sandbox);

/* ---------- 1. every file loads and parses ---------- */
const FILES = ['js/config.js', 'js/data.js', 'js/core.js', 'js/pages.js', 'js/pages2.js',
  'js/detail.js', 'js/actions.js', 'js/live.js', 'js/auth.js'];
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

/* the shell defines render(); pages and auth call it after a mutation */
sandbox.render = function () {};
sandbox.renderAuth = function () {};

/* A top-level const inside a vm script lands in the context's lexical scope,
   not on its global object, so DB and friends have to be read back by name. */
const G = expr => vm.runInContext(expr, sandbox);
const Q = G('Q'), PAGES = G('PAGES'), DETAIL = G('DETAIL'), UI = G('UI'), AUTH = G('AUTH');
const CONFIG = G('CONFIG'), PROFILES = G('PARTNER_PROFILES');
const money = G('money'), parseD = G('parseD'), iso = G('iso');
const db = () => G('DB');

main();

async function main() {

/* ---------- 2. the front door ---------- */
const DEMO = G('DEMO_PROVIDER');
const demoCodeFor = G('demoCodeFor');

/* This suite tests the demo provider, and the portal only selects it when
   CONFIG.live is false. That used to be guaranteed by asserting the shipped
   config was blank — which worked right up until the portal was pointed at a
   real project, at which point every check below would have exercised the
   Supabase provider instead, failed to reach it from a sandbox, and told us
   nothing. Force it here instead, so the suite tests what it says it tests
   whatever the shipped config happens to say. */
const shippedLive = CONFIG.live;
G('CONFIG.live = false');
check(G('AUTH.provider()') === G('DEMO_PROVIDER'),
  'the demo front door is what gets tested, whatever config.js says');

/* What actually matters about the shipped config: this folder is published
   to the public web, so the key in it is readable by anyone. An anon key is
   designed for that and every table refuses it. A service_role key bypasses
   row level security entirely, and pasting one here would hand the whole
   platform to anybody who viewed source. */
{
  const cfg = fs.readFileSync(path.join(__dirname, 'partners', 'js', 'config.js'), 'utf8');
  const key = (cfg.match(/SUPA_KEY:\s*'([^']*)'/) || [])[1] || '';
  let role = '';
  if (key.split('.').length === 3) {
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString()).role || ''; }
    catch (e) { role = 'unreadable'; }
  }
  check(role !== 'service_role', 'the shipped key is not a service_role key');
  check(!key || role === 'anon' || /^sb_publishable_/.test(key),
    'the shipped key is an anon or publishable key, or there is none', 'role=' + (role || 'none'));
  const url = (cfg.match(/SUPA_URL:\s*'([^']*)'/) || [])[1] || '';
  check(!url || /^https:\/\//.test(url), 'and the project URL is https, not plain http');
  console.log('  note  the portal ships ' + (shippedLive ? 'LIVE, pointed at a project' : 'blank, running its own demo'));
}
check(db() === null, 'nothing is loaded before anyone signs in');
check(AUTH.signedIn() === false, 'and nobody is signed in');
check(PROFILES.length === 3, 'three demo partners, not one — a door with one person behind it proves nothing');

{
  const p = PROFILES[0];

  const wrong = await DEMO.verify(p.email, '000000');
  check(wrong.ok === false, 'a wrong code does not sign you in');
  check(!!wrong.error, 'and says so');

  const right = await DEMO.verify(p.email, demoCodeFor(p.email));
  check(right.ok === true && right.session.partnerKey === p.key,
    'the right code signs you in as the right partner');
  check(!!right.session.expiresAt, 'the session carries an expiry');

  /* An address we do not know must behave exactly like one we do, or the box
     becomes a way to find out who our partners are. */
  const unknownSend = await DEMO.sendCode('stranger@nowhere.example');
  const knownSend = await DEMO.sendCode(p.email);
  check(unknownSend.ok === knownSend.ok,
    'an unknown address gets the same answer as a known one');
  check(unknownSend.demoCode === null, 'and no code is issued for it');
  const unknownVerify = await DEMO.verify('stranger@nowhere.example', demoCodeFor('stranger@nowhere.example'));
  check(unknownVerify.ok === false, 'and a code guessed for it still does not work');

  /* One partner's code must not open another partner's account. */
  const crossed = await DEMO.verify(PROFILES[1].email, demoCodeFor(p.email));
  check(crossed.ok === false, 'one partner\'s code does not open another partner\'s account');

  const restored = await DEMO.restore({ partnerKey: p.key });
  check(restored.ok === true, 'a stored session for a real partner is restored');
  const bogus = await DEMO.restore({ partnerKey: 'nobody' });
  check(bogus.ok === false, 'a stored session naming nobody is not');
}

/* An expired session is not a session. */
{
  const saveSession = G('saveSession'), readSession = G('readSession'), clearSession = G('clearSession');
  saveSession({ partnerKey: 'amaka', email: 'a@b.c', expiresAt: new Date(Date.now() - 1000).toISOString() });
  check(readSession() === null, 'an expired session is refused on load');
  check(localStorage.getItem('tlb_partner_session') === null, 'and cleared out rather than left to rot');

  saveSession({ partnerKey: 'amaka', email: 'a@b.c', expiresAt: new Date(Date.now() + 86400000).toISOString() });
  check(readSession() !== null, 'a live session is kept');
  clearSession();
  check(readSession() === null, 'signing out clears it');
}

/* ---------- 3. every partner's money reconciles ----------
   Run against all three, not just the busy one. The partner with nothing is
   where division by zero and empty-array reduces go wrong. */
const loadPartnerData = G('loadPartnerData');

for (const profile of PROFILES) {
  const okLoad = loadPartnerData(profile.key);
  check(okLoad === true, profile.key + ': data loads');
  const DB = db();
  const who = profile.key + ': ';

  check(DB.me.name === profile.name, who + 'the portal is showing ' + profile.name);
  check(DB.referrals.length === profile.mix.reduce((t, m) => t + m.n, 0),
    who + DB.referrals.length + ' referrals, as configured');

  const lifetime = Q.lifetime(), paid = Q.paid(), ready = Q.available(), held = Q.pending();
  check(paid + ready + held === lifetime,
    who + 'paid ' + paid + ' + ready ' + ready + ' + on hold ' + held + ' = earned ' + lifetime);

  const payoutTotal = DB.payouts.reduce((t, p) => t + p.amount, 0);
  check(payoutTotal === paid, who + 'payouts total equals what the ledger calls paid');

  const itemTotal = DB.payouts.reduce((t, p) => t + Q.payoutItems(p.ref).reduce((s, r) => s + r.amount, 0), 0);
  check(itemTotal === payoutTotal, who + 'every statement adds up to its payout');
  check(DB.payouts.reduce((t, p) => t + Q.payoutItems(p.ref).length, 0) ===
    DB.ledger.filter(r => r.status === 'paid').length,
    who + 'every paid row appears on exactly one statement');

  check(DB.ledger.filter(r => !Q.ref(r.refId)).length === 0,
    who + 'no ledger row points at a referral that does not exist');
  check(DB.ledger.filter(r => r.type === 'signup' && !(Q.ref(r.refId) || {}).subscribedOn).length === 0,
    who + 'no commission on an account that never paid');

  const seen = {};
  check(DB.ledger.filter(r => r.type === 'signup' &&
    (seen[r.refId] ? true : (seen[r.refId] = 1, false))).length === 0,
    who + 'no business earns commission twice');

  const commissionTotal = DB.ledger.filter(r => r.type === 'signup').reduce((t, r) => t + r.amount, 0);
  check(DB.referrals.reduce((t, r) => t + Q.earnedFor(r.id), 0) === commissionTotal,
    who + 'per-business figures sum to the commission total');
  check(commissionTotal + Q.bonuses() === lifetime, who + 'commission plus bonuses is everything earned');
  check(DB.ledger.filter(r => r.type === 'signup')
    .every(r => r.amount === Math.round(r.basis * r.rate / 100)),
    who + 'every commission is its rate applied to the payment it was based on');

  const validRates = new Set(DB.tiers.map(t => t.pct));
  check(DB.ledger.filter(r => r.type === 'signup').every(r => validRates.has(r.rate)),
    who + 'every commission used a real tier rate');

  /* payout runs respect the minimum in force that month */
  const changedOn = G('THRESHOLD_CHANGED_ON');
  const minOn = ref => (ref.slice(3) >= changedOn.slice(0, 7) ? 10000 : 25000);
  check(DB.payouts.filter(p => p.amount < minOn(p.ref)).length === 0,
    who + 'no payout went out below the minimum in force that month');
  const lastRunOn = DB.payouts.length ? DB.payouts[0].paidOn : null;
  check(DB.ledger.filter(r => r.status === 'cleared' && lastRunOn && r.clearsOn <= lastRunOn).length === 0,
    who + 'nothing already cleared was left behind by a run that happened');
  check(DB.ledger.filter(r => r.status === 'paid' && parseD(r.paidOn) < parseD(r.clearsOn)).length === 0,
    who + 'nothing was paid before it cleared the hold');

  /* dates run backwards from today, never forwards */
  const today = iso(DB.today);
  check(DB.referrals.every(r => r.signedUpOn <= today), who + 'nobody signed up in the future');
  check(DB.referrals.every(r => !r.subscribedOn || r.subscribedOn <= today),
    who + 'nobody started paying in the future');
  check(DB.referrals.every(r => !r.lapsedOn || r.lapsedOn <= today),
    who + 'nobody stopped paying in the future');
  check(DB.referrals.every(r => r.signedUpOn >= profile.joined),
    who + 'no referral predates the day they became a partner');
  check(DB.ledger.every(r => r.date <= today), who + 'nothing was credited in the future');
  check(DB.referrals.every(r => !r.subscribedOn || r.subscribedOn >= r.signedUpOn),
    who + 'nobody paid before they signed up');
  check(DB.referrals.every(r => !r.lapsedOn || r.lapsedOn > r.subscribedOn),
    who + 'nobody stopped before they started');
  check(Q.trialing().every(r => r.trialEndsIn >= 0 && r.trialEndsIn <= 14),
    who + 'every trial has a sensible number of days left');

  /* counts cannot contradict each other */
  check(Q.converted().length <= Q.signups(), who + 'nobody converted who never signed up');
  check(Q.signups() <= Q.clicks(), who + 'no more signups than link opens');
  check(Q.paying().length + Q.lapsed().length === Q.converted().length,
    who + 'every converted account is either paying or stopped');
  check(DB.links.reduce((t, l) => t + l.signups, 0) === DB.referrals.length,
    who + 'every referral is attributed to exactly one link');
  check(DB.links.filter(l => l.isDefault).length === 1, who + 'exactly one default link');

  const n = Q.converted().length;
  check(Q.tier() === G('tierFor')(n), who + 'the tier shown is the one the count earns');
  check(Q.tierProgress() >= 0 && Q.tierProgress() <= 100, who + 'tier progress stays inside 0 to 100');
}

/* ---------- 4. every page renders, for every partner ---------- */
const PAGE_IDS = ['home', 'earnings', 'referrals', 'share', 'updates', 'account'];
const TABS = {
  earnings: ['all', 'pending', 'paid', 'payouts'],
  referrals: ['all', 'subscribed', 'push', 'lapsed']
};

for (const profile of PROFILES) {
  loadPartnerData(profile.key);
  const who = profile.key + ': ';
  for (const p of PAGE_IDS) {
    try {
      const html = PAGES[p]();
      check(typeof html === 'string' && html.length > 150, who + 'renders ' + p);
      check(!/undefined|NaN|\[object Object\]/.test(html), who + p + ' has no broken values in it');
    } catch (e) {
      check(false, who + 'renders ' + p + ' — ' + e.message);
    }
  }
  for (const [page, tabs] of Object.entries(TABS)) {
    for (const t of tabs) {
      UI.filters[page] = t;
      try { check(PAGES[page]().length > 80, who + 'renders ' + page + ' / ' + t); }
      catch (e) { check(false, who + 'renders ' + page + ' / ' + t + ' — ' + e.message); }
    }
    UI.filters[page] = tabs[0];
  }
}

/* The newest partner is the one that proves the empty states work. */
{
  const newest = PROFILES[PROFILES.length - 1];
  loadPartnerData(newest.key);
  const DB = db();
  check(DB.ledger.length === 0 && DB.payouts.length === 0 && DB.accounts.length === 0,
    'the newest partner really has earned nothing yet, so the empty states are under test');
  UI.filters.earnings = 'all';
  check(PAGES.earnings().includes('Nothing here'), 'earnings says so plainly rather than showing a blank table');
  UI.filters.earnings = 'payouts';
  check(PAGES.earnings().includes('No payouts yet'), 'payouts says so too');
  UI.filters.earnings = 'all';
  check(Q.alerts().some(a => a.title === 'No payout account'),
    'and the missing payout account is raised on the home screen');
}

/* ---------- 5. one partner's local changes never follow them to another ----------
   The same phone, two accounts. Storage has to be keyed per partner or the
   second partner sees the first one's extra links and bank details. */
{
  const doNewLink = G('doNewLink');
  loadPartnerData('femi');
  els.nlLabel = makeEl('nlLabel'); els.nlLabel.value = 'Femi TikTok';
  els.nlCode = makeEl('nlCode'); els.nlCode.value = 'TIKTOK';
  doNewLink();
  check(db().links.some(l => l.code === 'FEMI-TIKTOK'), 'a partner can add their own link');

  loadPartnerData('amaka');
  check(!db().links.some(l => l.code.includes('TIKTOK')),
    'and it does not appear in the next partner to sign in on this device');
  check(Object.keys(store).some(k => k.startsWith('tlb_partner_femi_')),
    'because storage is keyed per partner');
  check(!Object.keys(store).some(k => k === 'tlb_partner_links'),
    'and nothing is stored under a shared key any more');
}

/* ---------- 6. it stays small ----------
   The first build buried the two questions a partner actually has under
   charts, a funnel, plan and city breakdowns and nine pages. These are the
   limits that came out of that, held here so the next feature has to argue
   for itself. Measured on the busiest partner, where creep would show first. */
loadPartnerData('amaka');
const rendered = {};
for (const p of PAGE_IDS) rendered[p] = PAGES[p]();

check(PAGE_IDS.length <= 6, 'the portal is ' + PAGE_IDS.length + ' pages, not more');
const count = (html, needle) => (html.split(needle).length - 1);
for (const p of PAGE_IDS) {
  const cards = count(rendered[p], 'class="st ');
  check(cards <= 3, p + ' shows at most 3 stat cards (' + cards + ')');
  const tabs = count(rendered[p], '<button class="tab');   // not the .tabs wrapper
  check(tabs <= 4, p + ' offers at most 4 tabs (' + tabs + ')');
}
const allHtml = PAGE_IDS.map(p => rendered[p]).join('');
for (const marker of ['viewBox="0 0 760', 'donutwrap', 'class="funnel', 'class="hbar', 'chartbox']) {
  check(!allHtml.includes(marker), 'no chart markup on any page (' + marker + ')');
}
const css = fs.readFileSync(path.join(dir, 'css/app.css'), 'utf8');
for (const dead of ['.chartbox', '.donutwrap', '.hbar', '.funnel', '.fstage', '.rangetab', '.periodbar', '.vtab']) {
  check(!css.includes(dead + '{') && !css.includes(dead + ' '), 'no dead stylesheet rules for ' + dead);
}

/* ---------- 7. every detail view renders ---------- */
{
  const DB = db();
  const samples = ['subscribed', 'trial', 'signed-up', 'lapsed']
    .map(s => DB.referrals.find(r => r.stage === s)).filter(Boolean);
  check(samples.length === 4, 'every referral stage has at least one record to open');
  for (const r of samples) {
    try {
      const html = DETAIL.ref(r.id);
      check(html.length > 200, 'renders: ' + r.stage + ' referral');
      check(!/undefined|NaN/.test(html), 'clean output: ' + r.stage + ' referral');
      check(!html.includes('class="vtab'), r.stage + ' referral is one page, not a tab strip');
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
}

/* ---------- 8. the actions a partner can actually press ---------- */
{
  loadPartnerData('amaka');
  const DB = db();
  const before = DB.links.length;
  els.nlLabel = makeEl('nlLabel'); els.nlLabel.value = 'Test channel';
  els.nlCode = makeEl('nlCode'); els.nlCode.value = 'TESTX';
  sandbox.doNewLink();
  check(DB.links.length === before + 1, 'a new link is created');
  const made = DB.links[DB.links.length - 1];
  check(made.url.endsWith('TESTX'), 'a new link carries the code you chose');
  check(made.url.startsWith(CONFIG.joinUrl), 'and points where config says links point');
  check(made.custom === true, 'a new link is marked as yours, so it can be deleted again');
  sandbox.doNewLink();
  check(DB.links.length === before + 1, 'the same code ending cannot be made twice');
  sandbox.removeLink(made.id);
  check(DB.links.length === before, 'a link with nothing attached can be deleted');

  const busy = DB.links.find(l => l.signups > 0);
  if (busy) {
    const was = DB.links.length;
    busy.custom = true;
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
  check(DB.accounts.filter(a => a.primary).length === 1, 'removing the primary promotes another');

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
}

/* ---------- 9. the shell wires what it lists ---------- */
{
  const shell = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const navIds = [...shell.matchAll(/\['([a-z]+)', '[A-Z][^']*', 'i-[a-z-]+'/g)].map(m => m[1]);
  check(navIds.length === 5, 'the bar holds 5 destinations, which is what a thumb can reach');
  for (const id of navIds) check(!!PAGES[id], 'nav entry "' + id + '" has a page behind it');
  for (const id of PAGE_IDS) check(shell.includes(id + ':'), 'page "' + id + '" has a title in the shell');
  check(!navIds.includes('updates') && shell.includes("go('updates')"),
    'updates hangs off the bell rather than taking a sixth slot');
  for (const f of FILES) check(shell.includes(f), 'the shell loads ' + f);

  /* The guard: nothing renders before someone is signed in. */
  check(/if \(!AUTH\.signedIn\(\) \|\| !DB\)/.test(shell),
    'the render loop refuses to draw the portal until somebody is signed in');
  check(shell.includes('bootAuth()'), 'and boot goes through the front door');
  check(shell.includes('id="authShell"') && shell.includes('id="appShell"'),
    'the sign-in screen and the portal are separate shells');

  const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
  for (const f of FILES) check(sw.includes(f), 'the service worker caches ' + f);
  check(sw.includes('css/app.css'), 'the service worker caches the stylesheet');
  check(/CACHE = 'tlb-partners-v\d+'/.test(sw), 'the service worker cache is versioned');
  check(!sw.includes('tlb-admin'), 'the portal does not share a cache name with the admin console');

  check(fs.existsSync(path.join(dir, 'netlify.toml')), 'the portal has its own netlify.toml');
  check(fs.existsSync(path.join(dir, '_redirects')), 'the portal has its own redirects');
  const toml = fs.readFileSync(path.join(dir, 'netlify.toml'), 'utf8');
  check(toml.includes('noindex'), 'a signed-in area is kept out of search engines');
  check(toml.includes('X-Frame-Options'), 'the portal cannot be framed');

  /* The database is where isolation actually lives. Fail loudly if the
     migration or its adversarial suite goes missing, because the portal
     would still look fine without them. */
  const mig = path.resolve(__dirname, 'supabase/migrations/20260827090400_partner_portal.sql');
  check(fs.existsSync(mig), 'the partner migration exists');
  if (fs.existsSync(mig)) {
    const sql = fs.readFileSync(mig, 'utf8');
    check(/force\s+row level security/.test(sql), 'RLS is forced, not merely enabled');
    for (const t of ['partner_referrals', 'partner_ledger', 'partner_payouts']) {
      check(!new RegExp('create policy ' + t + '_(insert|update|delete)').test(sql),
        t + ' has no write policy: money is read-only from a browser');
    }
    check(/grant update \(name, business_name, email, phone, city\) on public\.partners/.test(sql),
      'a partner may edit their contact details and not their tier');
    check(/grant update \(label, active, is_default\) on public\.partner_links/.test(sql),
      'a partner may rename a link and not rewrite its click count');
    check(/grant update \(account_name, bank_name, account_number, is_primary\)/.test(sql),
      'a partner may edit a payout account and not tick it as verified');
  }
  check(fs.existsSync(path.resolve(__dirname, 'supabase/tests/partner_rls_harness.mjs')),
    'and the adversarial suite that proves all of that still exists');
}

/* ---------------- the live hydrate ----------------
   Live mode builds DB out of the partner's own rows instead of inventing them.
   Every page already reads DB and none of them knows the difference, so the
   thing that can actually break is the mapping: PostgREST answers snake_case
   and the portal speaks camelCase, and a silent rename turns a total into zero
   rather than into an error.

   So this feeds buildLiveDB a row of every shape the database can produce and
   checks what comes out, with the network stubbed. No Supabase needed, which
   is the point: this has to be checkable before there is a partner to check it
   with. */
{
  const ROWS = {
    'partner_links': [
      { id: 'L1', label: 'Instagram bio', code: 'AMAKA', clicks: 240, active: true,
        is_default: true, created_at: '2026-01-04T09:00:00Z' },
      { id: 'L2', label: 'WhatsApp status', code: 'AMAKA-WA', clicks: 31, active: true,
        is_default: false, created_at: '2026-05-19T09:00:00Z' }
    ],
    'partner_referrals': [
      { id: 'R1', link_id: 'L1', business_name: 'Lux Couture', owner_name: 'Amaka O',
        city: 'Lagos', stage: 'subscribed', plan: 'pro', cycle: 'annual', mrr: '5416.67',
        first_payment: '65000.00', signed_up_on: '2026-02-01', subscribed_on: '2026-02-15',
        lapsed_on: null, outlets: 2, staff_count: 9, added_by: 'self', last_seen: '2026-09-10' },
      { id: 'R2', link_id: 'L2', business_name: 'Thread & Needle', owner_name: null,
        city: null, stage: 'trial', plan: 'basic', cycle: 'trial', mrr: '0',
        first_payment: '0', signed_up_on: '2026-09-06', subscribed_on: null,
        lapsed_on: null, outlets: 1, staff_count: 2, added_by: 'partner', last_seen: '2026-09-11' }
    ],
    'partner_ledger': [
      { id: 'X1', referral_id: 'R1', payout_id: 'PO1', kind: 'signup', amount: '9750.00',
        rate_pct: '15.00', tier: 'bronze', basis: '65000.00', note: 'Pro · 15% of 65,000',
        credited_on: '2026-02-15', clears_on: '2026-03-17', status: 'paid' },
      { id: 'X2', referral_id: null, payout_id: null, kind: 'bonus', amount: '5000.00',
        rate_pct: '0', tier: 'bronze', basis: '0', note: 'milestone bonus',
        credited_on: '2026-02-15', clears_on: '2026-03-17', status: 'cleared' }
    ],
    'partner_accounts': [
      { id: 'A1', account_name: 'Amaka O', bank_name: 'GTBank', account_number: '0123456789',
        currency: 'NGN', is_primary: true, verified: true, verified_on: '2026-01-10',
        added_on: '2026-01-08' }
    ],
    'partner_payouts': [
      { id: 'PO1', ref: '2026-03', paid_on: '2026-03-25', amount: '9750.00',
        method: 'bank transfer', bank_ref: 'TLB202603/01' }
    ]
  };

  const ME = { id: 'P1', code: 'AMAKA', name: 'Amaka Obi', business_name: 'Lux Couture',
    email: 'amaka@luxcouture.com', phone: '+234 800 000 0000', city: 'Lagos',
    tax_id: 'TIN-1', tier: 'silver', status: 'active', joined_on: '2026-01-02' };

  /* stub the network: every select answers from ROWS, partner_me answers ME */
  G('window.__calls = [];');
  sandbox.supaFetch = async (path) => {
    sandbox.window.__calls.push(path);
    if (path.indexOf('/rest/v1/rpc/partner_me') === 0) return { ok: true, body: [ME] };
    const table = (path.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    return ROWS[table] ? { ok: true, body: ROWS[table] } : { ok: false, body: null };
  };

  const db = await G('buildLiveDB({ partnerKey: "P1", token: "t", name: "Amaka Obi", ' +
    'email: "amaka@luxcouture.com", me: ' + JSON.stringify(ME) + ' })');

  check(!!db, 'the live hydrate returns a database rather than nothing');
  if (db) {
    /* the money, which is the half that matters */
    check(db.ledger[0].amount === 9750, 'a ledger amount arrives as a number, not the string PostgREST sends');
    check(db.referrals[0].firstPayment === 65000, 'first payment is mapped from first_payment');
    check(db.referrals[0].mrr > 5416 && db.referrals[0].mrr < 5417, 'mrr survives as a number');
    check(db.ledger[0].type === 'signup', 'ledger kind is mapped to the type the pages read');
    check(db.ledger[0].status === 'paid', 'the database decides what is paid, not the device');
    check(db.ledger[0].payoutRef === '2026-03', 'a paid ledger row carries its payout reference');
    check(db.ledger[0].paidOn === '2026-03-25', 'and the date it was paid');

    /* names and dates */
    check(db.referrals[0].business === 'Lux Couture', 'business_name is mapped to business');
    check(db.referrals[0].signedUpOn === '2026-02-01', 'signed_up_on is mapped to signedUpOn');
    check(db.referrals[0].subscribedOn === '2026-02-15', 'subscribed_on is mapped');
    check(db.referrals[1].subscribedOn === null, 'an unconverted referral has no subscribed date');
    check(db.accounts[0].accountNumber === '0123456789', 'account_number is mapped');
    check(db.accounts[0].primary === true, 'is_primary is mapped to primary, which is what the pages read');

    /* derived, not stored */
    const def = db.links.find(l => l.isDefault);
    check(!!def, 'the default link is marked');
    check(def.signups === 1 && def.converted === 1,
      'per-link counts are counted from referrals rather than trusted from a column');
    check(def.earned === 9750, 'and what a link earned is summed from the ledger');
    check(db.links[1].signups === 1 && db.links[1].converted === 0,
      'a link with a signup that never converted counts the signup and not the conversion');

    /* a trial countdown has to come from the dates, not be invented */
    check(db.referrals[1].trialEndsIn !== null, 'a referral on trial shows how long is left');
    check(db.referrals[0].trialEndsIn === null, 'one that has already subscribed does not');

    /* the tier drives the rate a partner is told about */
    check(db.settings.baseRatePct === 18, 'a silver partner is shown the silver rate, not the bronze default');

    /* the thing that must never happen: a failed request drawn as a confident zero */
    sandbox.supaFetch = async (path) =>
      path.indexOf('/rest/v1/rpc/partner_me') === 0 ? { ok: true, body: [ME] } : { ok: false, body: null };
    const broken = await G('buildLiveDB({ partnerKey: "P1", token: "t", me: ' + JSON.stringify(ME) + ' })');
    check(broken === null,
      'a failed request returns nothing rather than an empty portal — a partner must never be shown zero earnings because the network dropped');

    /* the queries carry no partner filter, on purpose: RLS is the wall */
    const calls = G('window.__calls');
    check(!calls.some(c => /partner_id=eq/.test(c)),
      'the hydrate does not filter by partner_id — row level security is the control, and a filter here would look like the protection');
  }
}

report();
process.exit(fail.length ? 1 : 0);
}

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
