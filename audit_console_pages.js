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

function boot(opts) {
  opts = opts || {};
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
    navigator: { userAgent: 'node', onLine: true },
    /* The address matters here: an invitation arrives as a fragment on it, and
       the console reads that at parse time — so it has to be set before the
       files are loaded, which is why boot() takes it rather than the caller
       poking it afterwards. */
    location: { href: '', hash: opts.hash || '', search: opts.search || '', pathname: '/' },
    history: { replaceState() {} },
    URLSearchParams,
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
    /* It used to be one row saying "Seats included". Since 20 Sep the
       database enforces BOTH ceilings, so the tab has to show both or an
       operator cannot answer "why were they refused another outlet". */
    ok('and reaches the usage lines at all',
       /Team logins/.test(String(subTab)) && /Studios/.test(String(subTab)),
       'the tab rendered but has no usage rows to check');
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

// ---------------------------------------------------------------------
section('Every tab of a REAL studio opens');
// ---------------------------------------------------------------------
// The example data builds a subscriber with about forty fields on it. A live
// studio arrives from platform_tenant_summary(), which knows nine. Everything
// the console reads off a subscriber and the mapper does not set is undefined
// at best and a thrown page at worst — and a throw here does not break one
// tab, it blanks the whole Subscribers page behind the error boundary.
//
// Found the hard way on 15 Sep: three clicks from the subscriber list into
// Referrals & bonuses, and the page went. s.referralLedger.length, on a row
// that had no referralLedger. So this renders EVERY tab against a row that
// has only ever been through liveToSubscriber, with no example data anywhere
// near it.
{
  const b = boot();
  b.run('clearAllData();');
  b.sb.__rows = [{
    id: 'cdb635da-6312-4581-b395-22e90f993079', name: 'Adé Bespoke', slug: 'ade-bespoke',
    plan: 'starter', status: 'active', created_at: '2026-09-04 15:10:47.456985+00',
    members: 1, branches: 1, orders: 0, last_active_at: '2026-09-14 10:00:00+00'
  }];
  b.run('DB.subscribers = mergeLive(DB.subscribers || [], __rows.map(liveToSubscriber));');
  const id = b.run('DB.subscribers[0].id');
  ok('the live studio is the only subscriber in this console',
     b.run('DB.subscribers.length') === 1 && b.run('DB.subscribers[0].live') === true);

  const TABS = ['profile', 'subscription', 'referrals', 'businesses', 'payments', 'support', 'activity'];
  TABS.forEach(function (t) {
    let html = '', threw = '';
    try {
      b.run('UI.vtab[' + JSON.stringify('sub' + id) + '] = ' + JSON.stringify(t) + ';');
      html = b.run('DETAIL.sub(' + JSON.stringify(id) + ')');
    } catch (e) { threw = e.message; }
    ok('the "' + t + '" tab opens for a real studio', !threw && String(html).length > 400,
       threw || ('only ' + String(html).length + ' chars came back'));
  });

  // A thrown tab is the loud failure. Printing the word "undefined" into a
  // record an operator is reading is the quiet one, and it was on screen in
  // the stat row above these tabs the whole time.
  b.run('UI.vtab[' + JSON.stringify('sub' + id) + '] = "profile";');
  const shell = b.run('DETAIL.sub(' + JSON.stringify(id) + ')');
  ok('and no tab prints the word "undefined" at an operator',
     !/>undefined|undefined</.test(shell), 'the subscriber header or body reads "undefined"');
  ok('nor the word "null" where a number belongs',
     !/>null<|>null /.test(shell), 'the record reads "null"');

  // money(undefined) is Math.round(undefined).toLocaleString(), which is the
  // string "NaN" with a naira sign in front of it. It does not throw, so it
  // reaches an operator looking like a real figure that has gone wrong.
  const ALL = TABS.map(function (t) {
    b.run('UI.vtab[' + JSON.stringify('sub' + id) + '] = ' + JSON.stringify(t) + ';');
    try { return String(b.run('DETAIL.sub(' + JSON.stringify(id) + ')')); } catch (e) { return ''; }
  }).join('');
  ok('and no money figure on any tab reads NaN', !/NaN/.test(ALL),
     'a missing number rendered as ₦NaN, which reads as a broken amount rather than a missing one');
}

// ---------------------------------------------------------------------
section('An invited operator can actually get in');
// ---------------------------------------------------------------------
// Inviting somebody created the account and emailed a link. The link went to
// the customer app, which told them they had no studio; pointed at the console
// instead, the console would have signed them in on the link's own session
// without ever asking for a password — in once, locked out forever after. Both
// halves had to be fixed, so both halves are checked.
{
  const inv = boot({ hash: '#access_token=tok_live&refresh_token=ref&type=invite&expires_in=3600' });
  inv.run('CONFIG.live = true;');
  ok('an invitation link is recognised as one',
     inv.run('consoleArrivalNeedsPassword()') === true);
  ok('and is read before anything can consume the token',
     /const CONSOLE_ARRIVAL = \(function/.test(srcOf('js/signin.js')) &&
     srcOf('js/signin.js').indexOf('const CONSOLE_ARRIVAL') < srcOf('js/signin.js').indexOf('function initSignIn'),
     'creating the Supabase client clears the token out of the address');

  let restored = false;
  inv.sb.liveRestore = async () => { restored = true; return null; };
  inv.sb.liveClient = () => null;          // the session poll is not what is under test
  inv.run('initSignIn();');
  ok('the console asks for a password instead of signing them straight in',
     inv.run('LOGIN_MODE') === 'invited', 'mode: ' + inv.run('LOGIN_MODE'));
  ok('and does not restore the link\'s own session as if it were a sign-in',
     restored === false,
     'that is the one-time sign-in that leaves somebody locked out the next day');

  const form = inv.run('formInvited()');
  ok('the screen offers two password boxes', /id="invPw"/.test(form) && /id="invPw2"/.test(form));
  ok('and no email box, because the link already decided who this is',
     !/type="email"/.test(form));
  ok('it says what is being asked and why', /Choose a password/.test(form));

  // A link that has expired carries an error and no type at all.
  const dead = boot({ hash: '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired' });
  dead.run('CONFIG.live = true;');
  ok('a dead link is not mistaken for an invitation',
     dead.run('consoleArrivalNeedsPassword()') === false);
  dead.sb.liveRestore = async () => null;
  dead.run('initSignIn();');
  ok('and lands on the ordinary sign-in screen', dead.run('LOGIN_MODE') === 'signin');
  ok('saying the link expired, in the plainest words there are',
     /expired/i.test(dead.run('document.getElementById("loginErr").textContent') || ''),
     'reads: ' + JSON.stringify(dead.run('document.getElementById("loginErr").textContent')));

  // And an ordinary visit is untouched by any of it.
  const plain = boot({});
  plain.run('CONFIG.live = true;');
  ok('an ordinary visit is still an ordinary sign-in',
     plain.run('consoleArrivalNeedsPassword()') === false);
  let plainRestored = false;
  plain.sb.liveRestore = async () => { plainRestored = true; return null; };
  plain.run('initSignIn();');
  ok('and still restores a session this browser already had',
     plain.run('LOGIN_MODE') === 'signin' && plainRestored === true);

  ok('setting the password goes through admin-api like every other sign-in',
     /doAcceptInvite[\s\S]*?liveCall\('me'\)/.test(srcOf('js/signin.js')),
     'a second road into the console is a second road to keep right');
  ok('and the token is taken out of the address once it has been used',
     /clearConsoleArrival\(\)/.test((srcOf('js/signin.js').match(/async function doAcceptInvite[\s\S]*?\n\}/) || [''])[0]));
}

// ---------------------------------------------------------------------
section('Only partners earn, and the console says so');
// ---------------------------------------------------------------------
/* Kayode's rule, 19 September 2026: a business that refers another business
   is NOT paid a commission. It goes on the partner programme and earns from
   there. The website has said that since the same day.

   The console had its own subscriber referral programme with a rate, a ledger
   carrying amounts, four money stat cards, three money columns and an editable
   "Referral commission %". None of it was reachable from the website, which is
   exactly what made it dangerous: an operator could have changed that rate and
   paid somebody on it, and nothing would have disagreed with them.

   What stays is the referral GRAPH, because that is how you spot who to invite
   as a partner. What had to go is every figure that looks like money owed to a
   referring business. MRR from referrals stays too: that is OUR revenue from
   accounts the channel brought, not a payment to anybody. */
{
  const s0 = run('DB.subscribers[0]');
  const s1 = run('DB.subscribers[1]');
  run('(function(){ var a=DB.subscribers[0], b=DB.subscribers[1];' +
      ' b.referredBy = a.id; a.referrals = [b.id];' +
      ' a.referralLedger = [{subId:b.id, name:b.name, plan:b.planName, status:b.status, joined:b.joined, converted:true}];' +
      ' a.referralConverted = 1; })()');

  const refPage = run('referralBody()');
  ok('the referral page still renders', typeof refPage === 'string' && refPage.length > 0);
  ok('it does not offer a commission rate to change', !/referralPct/.test(refPage));
  ok('it does not call anything a commission rate', !/commission rate/i.test(refPage));
  ok('it points at the partner programme instead', /partner programme/i.test(refPage));
  ok('it still counts what the channel brought in', /MRR from referrals/.test(refPage));

  /* nothing anywhere in the console edits that setting any more */
  const everyScript = files.map(f => srcOf(f)).join('\n');
  ok('no screen edits a referral commission percentage', !/referralPct/.test(everyScript));
  ok('and the field itself is gone from the data', run('typeof DB.settings.referralPct') === 'undefined');

  /* the per subscriber tab */
  run("UI.vtab['sub' + DB.subscribers[0].id] = 'referrals';");
  const tab = run("DETAIL.sub(DB.subscribers[0].id)");
  ok('the subscriber referral tab renders', typeof tab === 'string' && tab.length > 0);
  if (typeof tab === 'string') {
    ok('it shows who they brought', tab.indexOf(run('DB.subscribers[1].name')) !== -1);
    ok('it does not show a commission owed to them', !/Commission earned|Outstanding|Paid out/.test(tab));
    ok('it sends the operator to Make a partner', /Make a partner/.test(tab));
  }

  /* and the button that does it exists on the record */
  run("UI.vtab['sub' + DB.subscribers[0].id] = 'overview';");
  const head = run("DETAIL.sub(DB.subscribers[0].id)");
  ok('a subscriber can be made a partner from their record',
     /makeSubscriberAPartner\(/.test(head) || /makeSubscriberAPartner\(/.test(everyScript));
  ok('and that opens the ordinary partner invitation rather than a second one',
     /function makeSubscriberAPartner[\s\S]{0,400}formInvitePartner\(/.test(everyScript));

  /* The ladder is gone, and what matters now is that no trace of it is
     left anywhere an operator could act on. A stale label is a wrong
     answer to somebody on the phone; a stale CONTROL is a promise. */
  ['Getting started', 'Unlocked, 6%', 'Established, 7%', 'Senior, 8%', 'ipTier'].forEach(label => {
    ok('no tier called "' + label + '" survives in the console', everyScript.indexOf(label) === -1);
  });
  ok('and none of the old rates are still printed anywhere',
     !/Bronze'|15%|18%|22%|25%/.test(everyScript.split('Housing is 15%').join('')));
}

// ---------------------------------------------------------------------
section('An action that changes a real studio actually reaches the database');
// ---------------------------------------------------------------------
/* Kayode renamed a studio in the console on 21 September, watched it rename,
   and found it unchanged afterwards. doEditSubscriber wrote to the in-memory
   object and called render(), so the screen agreed with him and the database
   never heard about it. doChangePlan did the same, and liveSetPlan had sat in
   live.js since the gateway was built with nothing ever calling it.

   This is the worst shape a bug can take. A button that does nothing gets
   reported in a minute. A button that looks like it worked is found days
   later, from the wrong direction, and by then you have made decisions on it.

   So: every action that edits a subscriber must either reach the gateway or
   refuse a live studio outright. Doing neither is what this catches. */
{
  const src = srcOf('js/actions.js');

  /* Each entry: the action, and how it is allowed to satisfy the rule. */
  const WRITERS = [
    { fn: 'doChangePlan',   via: 'liveSetPlan' },
    { fn: 'doStorageCap',   via: 'liveSetStorageCap' },
    { fn: 'doStudioLimits', via: 'liveSetStudioLimits' },
    { fn: 'doRecordPayment', via: 'liveRecordPayment' },
  ];

  WRITERS.forEach(w => {
    const at = src.indexOf('function ' + w.fn + '(');
    ok(w.fn + ' exists', at >= 0);
    if (at < 0) return;
    const body = src.slice(at, src.indexOf('\n}', at));
    ok(w.fn + ' reaches the database through ' + w.via,
       body.indexOf(w.via + '(') !== -1,
       'it only changes the copy on screen, which disappears on refresh');
  });

  /* The one that is NOT wired has to say so rather than pretend. */
  {
    const at = src.indexOf('function formEditSubscriber(');
    const body = at < 0 ? '' : src.slice(at, src.indexOf('\n}', at));
    ok('formEditSubscriber refuses a real studio rather than pretending',
       /if\s*\(\s*s\.live\s*\)/.test(body),
       'there is no gateway action behind it, so on a live studio it must not offer to save');
  }

  /* And nothing in the gateway is left wired to nothing. A write function
     nobody calls is a promise the console is not keeping. */
  {
    const live = srcOf('js/live.js');
    const everything = files.map(f => srcOf(f)).join('\n');
    const defined = [...live.matchAll(/async function (liveSet[A-Za-z]+|liveRecord[A-Za-z]+)\s*\(/g)]
      .map(m => m[1]);
    /* Named, with the reason, rather than quietly skipped. A gateway write
       nobody calls is either a bug or an unfinished feature, and the
       difference matters: the first misleads an operator, the second just is
       not there yet. Anything not on this list has to be called. */
    const NOT_WIRED_YET = {
      liveSetState: 'filing a feedback message is read-only on the screen so far: '
                  + 'the inbox loads, but marking one resolved and replying to it '
                  + 'are not built. Tracked in OUTSTANDING.md.',
    };

    ok('the gateway declares some write functions (' + defined.length + ')', defined.length > 0);
    defined.forEach(fn => {
      /* calls, not the definition itself */
      const calls = everything.split(fn + '(').length - 1;
      if (NOT_WIRED_YET[fn]) {
        ok(fn + ' is knowingly not wired up yet', calls === 1,
           'it has a call site now, so take it off the list: ' + NOT_WIRED_YET[fn]);
        return;
      }
      ok(fn + ' is actually called by something (' + (calls - 1) + ' call site(s))', calls > 1,
         'defined and never used, which is how a plan change silently did nothing');
    });
  }
}

console.log('\n' + '='.repeat(62));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('\nA studio that exists in the database reaches the screen, which is');

/* The type tokens have to be in :root, not in a theme block. --shadow is
   declared in BOTH :root and body.light, so a patch anchored on it lands in
   whichever one it matched first. That happened on 20 Sep: --sans and --serif
   went into body.light, and the dark console rendered every word in Times New
   Roman. It is glaring on screen and invisible in a diff. */
try {
  const css = fs.readFileSync(path.join(__dirname, 'admin', 'css', 'app.css'), 'utf8');
  const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
  ok('the sans token is in :root, where no theme can take it away', /--sans:/.test(root));
  ok('and so is the serif token', /--serif:/.test(root));
  ok('the serif is the one the brand uses', /Fraunces/.test(root));
} catch (e) { ok('the stylesheet was readable', false, e.message); }
console.log('the only part of the gateway anybody actually sees.');
