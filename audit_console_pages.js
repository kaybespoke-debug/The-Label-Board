// Does the console actually SHOW a real studio?
//
// The last gate checked that the console calls admin-api's `tenants` action.
// It did call it. Six studios arrived, the sidebar badge counted six, and the
// Subscribers page said "No subscribers match this filter" with every figure
// on zero. Checking the wiring proved the request was made and nothing about
// whether the answer reached the screen — which is the only part anybody sees.
//
// So this loads the console the way the browser does, hands it the rows
// admin-api really returns, renders the pages, and reads the HTML back.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* The console's own script order, taken from admin/index.html rather than
   listed here, so a file added to the page is loaded by this too. */
const indexHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const files = [...indexHtml.matchAll(/src="(js\/[a-z0-9]+\.js)"/g)].map(m => m[1]);

function boot() {
  const mkEl = () => ({
    innerHTML: '', outerHTML: '', value: '', checked: false, textContent: '', style: {},
    dataset: {}, options: [], children: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    setAttribute() {}, getAttribute() { return null }, removeAttribute() {}, appendChild(c) { return c },
    addEventListener() {}, removeEventListener() {}, querySelector() { return null },
    querySelectorAll() { return [] }, closest() { return null }, focus() {}, select() {}, remove() {}, click() {}
  });
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
    navigator: { userAgent: 'node', onLine: true }, location: { href: '', hash: '', search: '' },
    alert() {}, confirm() { return true }, prompt() { return '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    crypto: { getRandomValues: a => a, subtle: {} },
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, Error, Intl,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary')
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, 'admin', f), 'utf8');
    try { vm.runInContext(src, sb, { filename: f }); }
    catch (e) { console.error('  could not load ' + f + ': ' + e.message); process.exit(2); }
  }
  return { sb, run: e => vm.runInContext(e, sb) };
}

/* Exactly what platform_tenant_summary() returns, as admin-api passes it on.
   Timestamps in the shape Postgres actually sends, which is not an ISO 'T'. */
const TENANT_ROWS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Okoro & Sons Shoes', slug: 'okoro-and-sons',
    plan: 'starter', status: 'active', created_at: '2026-09-04 15:10:47.456985+00',
    members: 1, branches: 1, orders: 0, last_active_at: null },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'LAYI', slug: 'layi-multi-studio',
    plan: 'trial', status: 'active', created_at: '2026-09-04 15:10:47.456985+00',
    members: 1, branches: 4, orders: 0, last_active_at: '2026-09-04 21:44:51.663+00' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Balogun Fabrics', slug: 'balogun-fabrics',
    plan: 'starter', status: 'closed', created_at: '2026-09-04 15:10:47.456985+00',
    members: 1, branches: 1, orders: 0, last_active_at: null },
];

const { sb, run } = boot();
run('clearAllData();');                       // a console with no worked example
sb.__rows = TENANT_ROWS;
run('DB.subscribers = mergeLive(DB.subscribers || [], __rows.map(liveToSubscriber));');

ok('the live studios are in the console\'s data', run('DB.subscribers.length') === 3,
   String(run('DB.subscribers.length')));

// ---------------------------------------------------------------------
section('They survive the page\'s own filtering');
// ---------------------------------------------------------------------
// This is the step the last gate skipped. The sidebar counts DB.subscribers
// directly; the page counts Q.subsAsOf(), which drops anything whose joined
// date does not parse. A row can be present and still be invisible.
for (const p of ['today', 'last30', 'year', 'all']) {
  run(`setPeriod(${JSON.stringify(p)});`);
  const n = run('Q.subsAsOf().length');
  ok('a real studio survives the "' + p + '" period filter', n === 3, n + ' of 3');
}

run("setPeriod('all');");
ok('and the sidebar count matches what the page shows',
   run('DB.subscribers.length') === run('Q.subsAsOf().length'),
   run('DB.subscribers.length') + ' in the badge vs ' + run('Q.subsAsOf().length') + ' on the page');

// ---------------------------------------------------------------------
section('And they reach the screen');
// ---------------------------------------------------------------------
{
  const html = run('PAGES.subscribers()');
  ok('the page renders at all', typeof html === 'string' && html.length > 0);
  ok('it does not say the list is empty', !/No subscribers match this filter/.test(html),
     'the page rendered its empty state with live studios present');
  /* Compared against the escaped form. A studio called "Okoro & Sons" reaches
     the page as "Okoro &amp; Sons", which is the app being correct — studio
     names are typed by studios and are rendered as text, never as markup. A
     check that looked for the raw ampersand would fail on the one behaviour
     here worth keeping. */
  const escd = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  TENANT_ROWS.forEach(r => {
    ok('"' + r.name + '" appears in the directory', html.indexOf(escd(r.name)) !== -1);
  });
  ok('a studio name with an ampersand is escaped rather than injected',
     html.indexOf('Okoro &amp; Sons') !== -1 && html.indexOf('<td>Okoro & Sons') === -1);
  ok('a studio on the trial plan is counted as on trial', /On trial/.test(html) && run("Q.trial().length") === 1,
     String(run('Q.trial().length')));
  ok('a closed studio is counted as expired', run("Q.expired().length") === 1,
     String(run('Q.expired().length')));
  ok('the joined date renders as a date rather than "Invalid"',
     !/Invalid/i.test(html), 'a date failed to parse');
}

// ---------------------------------------------------------------------
section('And they can be opened');
// ---------------------------------------------------------------------
// The console emitted its click handlers as onclick="openDetail('sub'," + id + ")"
// with the id unquoted, and looked rows up with `s.id === +id`. Both assume a
// number. A live row is namespaced — "live-<uuid>" — so the handler was a
// syntax error and the lookup was NaN: clicking a real studio did nothing, and
// reaching its panel any other way said "Subscriber not found."
//
// The same two lines open a support ticket, so a real studio's message could
// not be opened either. That is the console's whole purpose, and it had never
// worked for a live row.
{
  const html = run('PAGES.subscribers()');
  const ids = run('DB.subscribers.map(s=>s.id)');

  ok('a live subscriber id is passed to the click handler as a string',
     ids.every(id => html.indexOf("openDetail('sub','" + id + "')") !== -1),
     'the handler would be a syntax error and the click would do nothing');

  ok('looking one up by its own id finds it',
     ids.every(id => !!run('Q.sub(' + JSON.stringify(id) + ')')),
     'Q.sub coerces with +id, which is NaN for a namespaced id');

  ok('and an example subscriber is still found by its numeric id',
     (function () {
       run('DB.subscribers.push({id:4242,name:"Example Co",status:"active",plan:"pro",planName:"Pro",joined:"2026-01-01",renewIn:5,mrr:1,users:1,seats:3,health:"steady",businesses:[],referrals:[],notes:[],owner:"",email:"",city:"",lastSeen:"2026-01-01",renewsOn:"2026-02-01",pastDue:false,cycle:"monthly",channel:"Direct"});');
       const bothWays = !!run('Q.sub(4242)') && !!run('Q.sub("4242")');
       run('DB.subscribers = DB.subscribers.filter(s=>s.id!==4242);');
       return bothWays;
     })(), 'making live ids work must not break the example ones');

  const detail = run('DETAIL.sub(' + JSON.stringify(ids[0]) + ')');
  ok('the detail panel renders for a live studio',
     typeof detail === 'string' && !/Subscriber not found/.test(detail),
     'it rendered the not-found state');
  ok('and it names the studio it was opened for',
     detail.indexOf('Okoro &amp; Sons') !== -1 || detail.indexOf('Okoro & Sons') !== -1);
}

// ---------------------------------------------------------------------
section('A live support ticket opens too');
// ---------------------------------------------------------------------
{
  run(`DB.tickets = mergeLive(DB.tickets || [], [{
    id:'live-tkt-1', liveId:'tkt-1', live:true, ref:'TLB-2001',
    title:'Cannot print an invoice', body:'The button does nothing.',
    sub:'Okoro & Sons Shoes', subId:null, kind:'bug', status:'open',
    priority:'high', opened:'2026-09-04', updated:'2026-09-04', replies:[], assignee:null
  }]);`);
  ok('a live ticket is found by its id', !!run("Q.ticket('live-tkt-1')"),
     'Q.ticket coerced with +id, so a live ticket could never be opened');
  const sup = run('PAGES.support ? PAGES.support() : ""');
  ok('the support page passes the ticket id as a string',
     sup.indexOf("openDetail('ticket','live-tkt-1')") !== -1,
     'the click handler would be a syntax error');
}

// ---------------------------------------------------------------------
section('Money shown is money taken');
// ---------------------------------------------------------------------
// The subscriber list came from platform_tenant_summary(), which knows the
// plan and nothing about payment, so MRR was the plan's LIST price — what a
// studio would owe if it were paying, reported as though it were revenue.
// For a console whose job is to say how the business is doing, that is the
// worst default there is: always optimistic, and optimistic by exactly the
// amount you have failed to collect.
{
  const BILLING = [
    // on Pro at a negotiated price, has paid once
    { business_id: 'aaaaaaaa-0000-0000-0000-000000000001', business_name: 'Okoro & Sons Shoes',
      customer_id: 'c1', plan: 'pro', billing_cycle: 'monthly', monthly_price: 40000,
      is_trial: false, trial_ends_on: null, renews_on: '2099-01-01', started_on: '2026-09-01',
      paid_to_date: 40000, last_paid_on: '2026-09-04 10:00:00+00', payments_count: 1 },
    // still on trial, worth nothing yet
    { business_id: 'aaaaaaaa-0000-0000-0000-000000000002', business_name: 'LAYI',
      customer_id: 'c2', plan: 'trial', billing_cycle: 'trial', monthly_price: 0,
      is_trial: true, trial_ends_on: '2099-01-01', renews_on: '2099-01-01', started_on: '2026-09-01',
      paid_to_date: 0, last_paid_on: null, payments_count: 0 },
    // trial ran out weeks ago and nothing expired it
    { business_id: 'aaaaaaaa-0000-0000-0000-000000000003', business_name: 'Balogun Fabrics',
      customer_id: 'c3', plan: 'trial', billing_cycle: 'trial', monthly_price: 0,
      is_trial: true, trial_ends_on: '2026-01-01', renews_on: '2026-01-01', started_on: '2025-12-01',
      paid_to_date: 0, last_paid_on: null, payments_count: 0 },
  ];
  sb.__billing = BILLING;
  run(`(function(){
    var by={}; __billing.forEach(function(r){by[r.business_id]=r;});
    DB.subscribers.forEach(function(s){
      if(!s.live)return; var b=by[s.liveId]; if(!b)return;
      s.plan=b.plan; s.cycle=b.billing_cycle;
      s.mrr=b.is_trial?0:(Number(b.monthly_price)||0);
      s.status=b.is_trial?'trial':s.status;
      s.paidToDate=Number(b.paid_to_date)||0;
      s.trialEndsOn=b.trial_ends_on;
      if(b.is_trial&&b.trial_ends_on&&parseD(b.trial_ends_on)<startOfDay(TODAY)){s.trialExpired=true;s.health='at-risk';}
    });
  })();`);

  const pro = run("Q.sub('live-aaaaaaaa-0000-0000-0000-000000000001')");
  ok('a studio on a negotiated price is worth what it pays, not the list price',
     pro.mrr === 40000, String(pro.mrr) + ' (list price for Pro is 49000)');
  ok('and what it has actually paid is recorded', pro.paidToDate === 40000, String(pro.paidToDate));

  const trial = run("Q.sub('live-aaaaaaaa-0000-0000-0000-000000000002')");
  ok('a studio on trial contributes nothing to MRR', trial.mrr === 0, String(trial.mrr));

  ok('platform MRR is the sum of what studios pay', run('Q.mrr()') === 40000,
     String(run('Q.mrr()')) + ' — three studios, one paying');

  const lapsed = run("Q.sub('live-aaaaaaaa-0000-0000-0000-000000000003')");
  ok('a trial that ran out is flagged rather than shown as still trialling',
     lapsed.trialExpired === true && lapsed.health === 'at-risk',
     'nothing expires a trial automatically, so the console has to say so');
}

// ---------------------------------------------------------------------
section('And a real payment reaches the Payments page');
// ---------------------------------------------------------------------
{
  run(`DB.payments = mergeLive(DB.payments || [], [{
    id:'live-pay-1', liveId:'pay-1', live:true,
    subId:'live-aaaaaaaa-0000-0000-0000-000000000001',
    subscriber:'Okoro & Sons Shoes', plan:'', cycle:'', ref:'TRF-991',
    amount:40000, provider:'Recorded by hand', method:'bank transfer',
    status:'successful', date:'2026-09-04', invoice:'TRF-991', note:''
  }]);`);
  const html = run('PAGES.payments ? PAGES.payments() : ""');
  ok('the payments page renders', typeof html === 'string' && html.length > 0);
  ok('and a hand-recorded payment appears on it',
     html.indexOf('TRF-991') !== -1 || html.indexOf('Okoro &amp; Sons') !== -1,
     'a payment that was taken is not shown');
}

// ---------------------------------------------------------------------
section('The dashboard counts them too');
// ---------------------------------------------------------------------
{
  const html = run('PAGES.dashboard ? PAGES.dashboard() : ""');
  ok('the dashboard renders with live studios', typeof html === 'string' && html.length > 0);
  ok('and its subscriber figure is not zero while three exist',
     run('Q.subsAsOf().length') === 3, String(run('Q.subsAsOf().length')));
}

// ---------------------------------------------------------------------
section('A plan with no seat limit reads as one');
// ---------------------------------------------------------------------
/* Pro sells unlimited staff, and unlimited is stored as 0. Every place that
   printed "3 of 10 seats" now prints "3 of 0 seats" unless it was told, which
   reads as a studio that has overrun a limit of nothing. Same for Bespoke,
   which carries no monthly price and would otherwise be listed as Free — the
   one wrong number on that row is the one an operator would quote. */
{
  /* Put a subscriber onto the unlimited plan explicitly rather than hunting
     for one, because the fixtures carry their own seat counts and the first
     Pro row found happened to have a number on it — which passed while the
     unlimited case, the one that actually breaks, was never rendered. */
  const sub = run('DB.subscribers[0]');
  if (!sub) ok('there is a subscriber to render', false);
  else {
    run('(function(){var s=DB.subscribers[0];var p=PLANS.find(p=>p.seats===0);s.plan=p.id;s.planName=p.name;s.seats=p.seats;s.users=3;})()');
    const html = run('(function(){try{return DETAIL.sub(' + JSON.stringify(sub.id) + ');}catch(e){return "ERR:"+e.message;}})()');
    ok('a subscriber on an unlimited-seat plan renders', typeof html === 'string' && html.length > 0 && String(html).indexOf('ERR:') !== 0, String(html).slice(0, 120));
    ok('and never says "of 0 seats"', String(html).indexOf('of 0 seats') < 0);
    ok('and never shows a seat count of 0', !/[\/ ]0 seats|3\/0/.test(String(html)));
    ok('it shows the seats as unlimited instead', /unlimited|∞/i.test(String(html)));
    /* The Subscription tab quotes the list price and the seats included, and
       it is a vertical tab chosen from UI.vtab rather than an argument — so
       asking DETAIL.sub for it by parameter renders the Profile tab instead
       and the check reads a panel that never contained the number it was
       looking for. Set the tab the way the console does. */
    const subTab = run('(function(){try{UI.vtab["sub"+' + JSON.stringify(sub.id) + ']="subscription";return DETAIL.sub(' + JSON.stringify(sub.id) + ');}catch(e){return "ERR:"+e.message;}})()');
    ok('the subscription tab renders for an unlimited plan', String(subTab).indexOf('ERR:') !== 0, String(subTab).slice(0, 120));
    ok('and reaches the seats line at all', /Seats included/.test(String(subTab)), 'the tab rendered but has no seats row to check');
    ok('and does not quote 0 seats included', String(subTab).indexOf('>0 (using') < 0);
    run('(function(){UI.vtab["sub"+' + JSON.stringify(sub.id) + ']="profile";})()');
  }
  const bespoke = run('PLANS.find(p => p.invoiceOnly)');
  ok('the invoice-only plan is not listed at a price of zero',
     !bespoke || bespoke.monthly === 0 && bespoke.invoiceOnly === true);
  // the plan filter is built from PLANS, not typed out again beside it
  const subsHtml = run('(function(){try{return PAGES.subscribers();}catch(e){return "";}})()');
  run('PLANS').forEach(p => ok('the plan filter offers ' + p.name,
     String(subsHtml).indexOf('>Plan: ' + p.name + '<') >= 0 || String(subsHtml).indexOf(p.name) >= 0));
}

// ---------------------------------------------------------------------
section('Website enquiries reach the screen');
// ---------------------------------------------------------------------
/* The four public forms post to Netlify AND to the database. This is the
   half that makes that worth doing: if the rows arrive and no page renders
   them, an enquiry is just as invisible as it was in Netlify's dashboard —
   which is the exact failure the subscriber list had, present in the data
   and on no screen. */
{
  sb.__enq = [
    { id: 'e1', at: new Date().toISOString(), kind: 'demo', name: 'Ada Obi',
      email: 'ada@example.com', phone: '', business: 'Ada Couture',
      message: 'We are 4 tailors in Surulere and would like to see it.',
      source_page: 'book.html', extra: { city: 'Lagos' }, state: 'new',
      handled_by: '', handled_at: '', notes: '' },
    { id: 'e2', at: new Date().toISOString(), kind: 'partner', name: 'Musa & Sons',
      email: 'musa@example.com', phone: '+234 800 000 0000', business: 'Musa Fabrics',
      message: 'Interested in referring our customers.', source_page: 'partners.html',
      extra: {}, state: 'converted', handled_by: 'Kayode', handled_at: new Date().toISOString(), notes: '' }
  ];
  run('DB.enquiries = __enq.map(function(r){ return Object.assign({live:true, liveId:r.id}, r); });');

  const html = run('(function(){try{ return PAGES.enquiries(); }catch(e){ return "ERR:"+e.message; }})()');
  ok('the enquiries page renders', typeof html === 'string' && html.indexOf('ERR:') !== 0, String(html).slice(0, 140));
  ok('a real demo request appears on it', String(html).indexOf('Ada Obi') >= 0,
     'an enquiry arrived and no page shows it');
  ok('and what they actually wrote', /Surulere/.test(String(html)));
  ok('and how to reach them', String(html).indexOf('ada@example.com') >= 0);
  ok('a converted one is shown as converted', /converted/.test(String(html)));
  ok('the count of what is waiting on us is right',
     run("(DB.enquiries||[]).filter(function(e){return e.state==='new';}).length") === 1);

  const det = run('(function(){try{ return DETAIL.enquiry("e1"); }catch(e){ return "ERR:"+e.message; }})()');
  ok('an enquiry opens', String(det).indexOf('ERR:') !== 0, String(det).slice(0, 140));
  ok('with a way to reply', /mailto:ada@example\.com/.test(String(det)));
  ok('and the extra fields the form carried', /Lagos/.test(String(det)),
     'a question added to a form is answered and then dropped');
  ok('and a way to move it along', /enquiryState\(/.test(String(det)));

  /* A studio name is typed by a stranger on the public internet. It is
     rendered as text, always. */
  run("DB.enquiries.push({id:'e3',at:new Date().toISOString(),kind:'contact',name:'<img src=x onerror=alert(1)>',email:'x@y.com',message:'<script>bad()<\\/script>',state:'new',extra:{},business:'',phone:'',source_page:'',handled_by:'',handled_at:'',notes:''});");
  const xss = String(run('PAGES.enquiries()'));
  ok('a name typed by a stranger is escaped, never injected',
     xss.indexOf('<img src=x') < 0 && xss.indexOf('&lt;img') >= 0);
  const xssDet = String(run('DETAIL.enquiry("e3")'));
  ok('and so is the message they sent',
     xssDet.indexOf('<script>bad()') < 0);
}

/* Two gateway actions had no button for weeks: the only way to record a payment or grant a
   studio extra storage was to open the console and call the function by hand. A door with
   no handle is the same as no door. */
{
  const det = fs.readFileSync(path.join(root, "admin/js/detail.js"), "utf8");
  const act = fs.readFileSync(path.join(root, "admin/js/actions.js"), "utf8");
  [["formRecordPayment", "liveRecordPayment", "recording a payment"],
   ["formStorageCap", "liveSetStorageCap", "granting extra storage"]].forEach(function (t) {
    ok(t[2] + " has a button somewhere", det.indexOf(t[0] + "(") !== -1,
       "the gateway serves it and nothing on screen reaches it");
    ok(t[2] + " opens a form", act.indexOf("function " + t[0] + "(") !== -1);
    ok(t[2] + " reaches the gateway", act.indexOf(t[1] + "(") !== -1);
  });
  // plain string search: the shell mangles a regex on its way into a file, every time
  const liveGuard = det.indexOf("s.live ?");
  const payBtn = det.indexOf("formRecordPayment");
  ok("both are offered only on a real studio",
     liveGuard !== -1 && payBtn > liveGuard && payBtn - liveGuard < 240,
     "an example subscriber would be sent to the Edge Function and fail there");
}
/* Read a console source file. The one inside boot() is scoped to that loop. */
const srcOf = f => fs.readFileSync(path.join(root, "admin", f), "utf8");
/* Our own books. -------------------------------------------------------------------
   Bespoke is invoice-only, so it has no list price to read, and five places used to read
   p.monthly straight. A Bespoke subscriber then contributed nothing to MRR, ARR, ARPU and
   the forecast: the operator's own revenue quietly understated by the size of their largest
   customer, with no symptom anywhere. */
{
  const bespoke = run("planById('premium')");
  ok('Bespoke is still the invoice-only plan', !!(bespoke && bespoke.invoiceOnly));
  ok('and still has no list price to read', !bespoke.monthly && !bespoke.annual);

  // the one function every one of those five places now goes through
  ok('a plan with a list price is worth its list price',
     run("planMrr(planById('starter'),'monthly',0)") === run("planById('starter').monthly"));
  ok('an annual cycle is a twelfth of the annual price',
     run("planMrr(planById('pro'),'annual',0)") === Math.round(run("planById('pro').annual") / 12));
  ok('a trial is worth nothing, whatever is typed',
     run("planMrr(planById('trial'),'monthly',999999)") === 0);
  ok('Bespoke is worth what was agreed, not zero',
     run("planMrr(planById('premium'),'monthly',250000)") === 250000,
     'a Bespoke subscriber still books nothing, so the books understate by their whole fee');
  ok('and a Bespoke subscriber with nothing agreed books nothing rather than a made-up figure',
     run("planMrr(planById('premium'),'monthly','')") === 0);
  ok('a negative agreed price cannot be typed in',
     run("planMrr(planById('premium'),'monthly',-5000)") === 0);

  /* Nothing may read p.monthly to work out what a subscriber is worth any more. This is the
     check that stops the bug coming back somewhere new. */
  const actions = srcOf('js/actions.js');
  ok('no action computes what a subscriber is worth from the plan price',
     !/mrr\s*[:=][^,;\n]*p\.monthly/.test(actions),
     'an action is reading the list price straight, which books zero for Bespoke');
  ['doAddSubscriber', 'doChangePlan', 'doConvert'].forEach(fn =>
    ok(fn + '() goes through planMrr()',
       new RegExp(fn + '[\\s\\S]{0,2400}planMrr\\(').test(actions)));
  ok('churn counts what they were paying, not what the plan lists now',
     !/churnedMrr[\s\S]{0,200}planById\(s\.plan\)\.monthly/.test(srcOf('js/core.js')),
     'every churned Bespoke subscriber counts as zero churn');

  /* A trial that has already ended is a different thing from one about to end: it is a
     business using the software that was never asked for the money. */
  ok('an ended trial is its own list', run('typeof Q.trialEnded') === 'function');
  ok('and one still running is another', run('typeof Q.trialEnding') === 'function');
  ok('the two do not overlap',
     run('Q.trialEnded().filter(function(s){return Q.trialEnding().some(function(x){return x.id===s.id;});}).length') === 0);
  ok('nothing in the ended list is still in date',
     run('Q.trialEnded().every(function(s){return s.renewIn < 0;})'));
  ok('the dashboard says an ended trial ended, rather than that it ends today',
     /Trial ended, not converted/.test(srcOf('js/pages.js')),
     'a trial that ended a week ago reads as ending today');
}

console.log('\n' + '='.repeat(62));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('\nA studio that exists in the database reaches the screen, which is');
console.log('the only part of the gateway anybody actually sees.');
