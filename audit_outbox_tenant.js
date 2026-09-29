/* =====================================================================
   A QUEUED WRITE BELONGS TO THE STUDIO IT WAS MADE IN.

   THE FINDING THIS REPRODUCES, from the independent audit:

     a write is queued while Studio A is open
     the person switches to Studio B
     the queue drains
     the code resolves the CURRENT studio and posts A's payload into B

   The sequence below is that sequence. It runs the real app in a sandbox
   with a recording Supabase client, so what is asserted is where each
   request actually went, not what the code appears to intend.

   It is a gate rather than a demonstration: REMOVE_BINDING=1 strips the
   business_id off queued entries at run time and every tenancy assertion
   here must fail. That is the check on the check — a suite that cannot
   fail is not evidence of anything.

   usage: node audit_outbox_tenant.js
          REMOVE_BINDING=1 node audit_outbox_tenant.js   (must fail)
   ===================================================================== */
const fs = require('fs');
const vm = require('vm');

const BREAK = process.env.REMOVE_BINDING === '1';
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

const A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const B = 'bbbbbbbb-0000-0000-0000-00000000000b';

/* ---------------------------------------------------------------------
   A Supabase stand-in that records every write and where it went.
   --------------------------------------------------------------------- */
const SENT = [];
let OFFLINE = false;
let FAIL_AFTER_COMMIT = false;
function makeSupa() {
  const mk = (table) => {
    const ctx = { table, filters: {} };
    const result = (payload, op) => {
      if (OFFLINE) return Promise.resolve({ data: null, error: { code: '', message: 'Failed to fetch' } });
      SENT.push({ table, op, business_id: payload && payload.business_id, payload, filters: { ...ctx.filters } });
      if (FAIL_AFTER_COMMIT) return Promise.resolve({ data: null, error: { code: '', message: 'Failed to fetch' } });
      return Promise.resolve({ data: null, error: null });
    };
    const chain = {
      upsert: (p) => ({ ...chain, ...thenable(() => result(p, 'upsert')) }),
      insert: (p) => ({ ...chain, ...thenable(() => result(p, 'insert')) }),
      update: (p) => ({ ...chain, ...thenable(() => result(p, 'update')) }),
      delete: () => ({ ...chain, ...thenable(() => result({ business_id: ctx.filters.business_id }, 'delete')) }),
      select: () => ({ ...chain, ...thenable(() => Promise.resolve({ data: [], error: null })) }),
      eq: (k, v) => { ctx.filters[k] = v; return chain; },
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
    };
    function thenable(run) {
      return { then: (res, rej) => run().then(res, rej),
               select: () => ({ maybeSingle: () => run().then(r => ({ data: null, error: r.error })),
                                then: (res, rej) => run().then(res, rej) }) };
    }
    return chain;
  };
  return { from: mk, auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } };
}

const mkEl = () => ({ innerHTML: '', value: '', checked: false, style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
  setAttribute() {}, getAttribute() { return null }, appendChild(c) { return c },
  addEventListener() {}, removeEventListener() {}, querySelector() { return null },
  querySelectorAll() { return [] }, focus() {}, remove() {} });
const _ls = {};
const sb = {
  console, setTimeout: (f) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  Date, Math, JSON, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  Promise, Intl, Number, String, Object, Array, RegExp, Error, URL, TextEncoder,
  fetch: () => Promise.reject(new Error('offline')),
  localStorage: { getItem: k => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v) },
    removeItem: k => { delete _ls[k] }, key: i => Object.keys(_ls)[i] || null,
    get length() { return Object.keys(_ls).length } },
  location: { hostname: 'app.thelabelboard.com', href: '', search: '', hash: '', pathname: '/', reload() {} },
  navigator: { userAgent: 'node', onLine: true, serviceWorker: { register: () => Promise.reject(new Error('x')) } },
  document: { readyState: 'complete', body: mkEl(), documentElement: mkEl(),
    /* a real element rather than null: switchStudio calls enterApp, which
       shows and hides panels, and a null here stops the function under test
       before it reaches the part being tested */
    getElementById: () => mkEl(), querySelector: () => mkEl(), querySelectorAll: () => [],
    createElement: () => mkEl(), addEventListener() {}, removeEventListener() {},
    createTextNode: t => ({ t }), head: mkEl(), scripts: [], title: '' },
  alert() {}, confirm: () => true, prompt: () => null,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: f => 0, caches: undefined,
  crypto: { getRandomValues: a => a, randomUUID: () => 'x' },
};
sb.window = sb; sb.globalThis = sb; sb.self = sb;
vm.createContext(sb);
try { vm.runInContext(code, sb, { filename: 'app' }); }
catch (e) { console.error('the app would not run: ' + e.message); process.exit(1); }

const run = e => vm.runInContext(e, sb);
const runA = e => vm.runInContext('(async()=>{' + e + '})()', sb);

let pass = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  PASS  ' + n); } else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

/* ---------------------------------------------------------------------
   Put the app into "signed in, two studios" without a network.
   --------------------------------------------------------------------- */
sb.__supa = makeSupa();
sb.__A = A; sb.__B = B;
run(`
  supa = __supa;
  liveMode = true;
  myBusinessId = __A;
  myMemberships = [{business_id:__A, role:'owner', status:'active'},
                   {business_id:__B, role:'owner', status:'active'}];
  myMembershipRole = 'owner';
  CLOUD_BRANCHES = [];
  /* the switch does a lot that needs a server; those parts are stubbed so
     the parts under test — the snapshot and the clear — run for real */
  loadCloudRoles = async function(){ return true; };
  hydrateFromCloud = async function(){ return true; };
  loadCloudBranches = async function(){ return true; };
  refreshPlanUsage = async function(){ return true; };
  refreshBilling = async function(){ return true; };
  renderAll = function(){};
  renderBillingPanel = function(){};
  refreshUnpaidPill = function(){};
  updateSyncPill = function(){};
  toast = function(){};
  closeModal = function(){};
  rememberBusiness = function(){};
  studioNameById = function(){ return 'Studio'; };
  startRealtime = function(){}; stopRealtime = function(){};
`);

if (BREAK) {
  /* THE MUTATION. Strip the tenant off every entry as it is queued, which
     is exactly what the code did before this was fixed. */
  run(`
    const _origQueue = outboxQueue;
    outboxQueue = function(entry){
      _origQueue(entry);
      const q = outbox();
      q.forEach(function(x){ delete x.business_id; });
      setOutbox(q);
    };
    /* and make the sender fall back to the studio on screen, as it used to */
    const _origSend = sendOutboxEntry;
    sendOutboxEntry = async function(e){
      if(!e.business_id) e = Object.assign({}, e, {business_id: myBusinessId});
      return await _origSend(e);
    };
  `);
  console.log('*** REMOVE_BINDING=1 — the tenancy assertions below MUST fail ***');
}

const sentTo = (biz) => SENT.filter(x => x.business_id === biz);
const reset = () => { SENT.length = 0; };

(async () => {
  // -------------------------------------------------------------------
  section('THE AUDIT SEQUENCE: queue for A, switch to B, drain');
  // -------------------------------------------------------------------
  {
    reset();
    OFFLINE = true;                                   // 4. prevent delivery
    run(`save('layi_dash_settings', Object.assign({}, SETTINGS, {currency:'NGN', marker:'FOR-STUDIO-A'}));`);
    run(`outboxQueue({kind:'state', key:'layi_dash_settings', payload:{marker:'FOR-STUDIO-A'}});`);
    await runA(`await drainOutbox();`);
    ok('the write is queued and undelivered', run('outbox().length') >= 1 && SENT.length === 0,
       run('outbox().length') + ' queued, ' + SENT.length + ' sent');
    const stamped = run(`outbox().filter(function(x){return x.kind==='state';})[0].business_id || null`);
    ok('and it carries Studio A', stamped === A, String(stamped));

    await runA(`await switchStudio(__B);`);           // 5. switch
    ok('the studio on screen is now B', run('myBusinessId') === B, run('myBusinessId'));
    const still = run(`outbox().filter(function(x){return x.kind==='state';})[0].business_id || null`);
    ok('the queued entry still says A after the switch', still === A, String(still));

    OFFLINE = false;                                   // 6. restore network
    await runA(`await drainOutbox();`);                // 7. flush

    const toA = sentTo(A), toB = sentTo(B);
    ok('A received the change', toA.length === 1, toA.length + ' writes to A');
    ok('B received NOTHING', toB.length === 0,
       toB.length + ' writes to B: ' + JSON.stringify(toB.map(x => x.table)));
    ok('  and the payload that reached A is A’s',
       toA.length === 1 && JSON.stringify(toA[0].payload).includes('FOR-STUDIO-A'),
       String(JSON.stringify((toA[0] || {}).payload)).slice(0, 120));
  }

  // -------------------------------------------------------------------
  section('CASE 8: four writes, two studios, flushed together');
  // -------------------------------------------------------------------
  {
    reset(); OFFLINE = true;
    run(`myBusinessId = __A;`);
    run(`outboxQueue({kind:'state', key:'layi_dash_txns',     payload:{who:'A-txns'}});`);
    run(`outboxQueue({kind:'state', key:'layi_dash_settings', payload:{who:'A-settings'}});`);
    run(`myBusinessId = __B;`);
    run(`outboxQueue({kind:'state', key:'layi_dash_customers',payload:{who:'B-customers'}});`);
    run(`outboxQueue({kind:'state', key:'layi_dash_txns',     payload:{who:'B-txns'}});`);
    run(`myBusinessId = __A;`);
    OFFLINE = false;
    await runA(`await drainOutbox();`);

    const bad = SENT.filter(x => JSON.stringify(x.payload).includes('A-') && x.business_id === B)
              .concat(SENT.filter(x => JSON.stringify(x.payload).includes('B-') && x.business_id === A));
    ok('every write landed in the studio it was made in', bad.length === 0,
       JSON.stringify(bad.map(x => ({ to: x.business_id === A ? 'A' : 'B', p: x.payload }))));
    ok('  and A’s queued settings was not destroyed by B’s',
       SENT.some(x => x.business_id === A && JSON.stringify(x.payload).includes('A-settings')),
       'the (kind,key) collapse used to overwrite it');
    ok('  four writes, not two', SENT.length === 4, SENT.length + ' sent');
  }

  // -------------------------------------------------------------------
  section('CASE 2 and 3: the app is closed and reopened into B');
  // -------------------------------------------------------------------
  {
    reset(); OFFLINE = true;
    run(`myBusinessId = __A;`);
    run(`outboxQueue({kind:'state', key:'layi_dash_bills', payload:{who:'A-bills'}});`);
    const saved = _ls['layi_dash_outbox'];
    ok('the queue survives in storage', !!saved && saved.includes('A-bills'));
    /* a cold start: the queue is read back from localStorage, and the app
       opens on B because that is what the device last had selected */
    run(`myBusinessId = __B;`);
    OFFLINE = false;
    await runA(`await drainOutbox();`);
    ok('the entry still goes to A after a restart into B',
       sentTo(A).length === 1 && sentTo(B).length === 0,
       'A:' + sentTo(A).length + ' B:' + sentTo(B).length);
  }

  // -------------------------------------------------------------------
  section('CASE 4 and 6: membership gone, studio closed');
  // -------------------------------------------------------------------
  {
    reset(); OFFLINE = true;
    run(`myBusinessId = __A;`);
    run(`outboxQueue({kind:'state', key:'layi_dash_pots', payload:{who:'A-pots'}});`);
    /* the membership for A is removed before the retry */
    run(`myMemberships = [{business_id:__B, role:'owner', status:'active'}]; myBusinessId = __B;`);
    OFFLINE = false;
    await runA(`await drainOutbox();`);
    ok('nothing is sent for a studio you are no longer in', SENT.length === 0,
       JSON.stringify(SENT.map(x => x.business_id)));
    const e = run(`JSON.stringify(outbox().filter(function(x){return x.key==='layi_dash_pots';})[0]||null)`);
    const entry = JSON.parse(e || 'null');
    ok('  the entry is terminal, not retried for ever',
       !!entry && entry.tries >= run('OUTBOX_MAX_TRIES'), JSON.stringify(entry && entry.tries));
    ok('  it is not moved to another studio', !!entry && entry.business_id === A,
       String(entry && entry.business_id));
    ok('  and the person is told why', !!entry && /no longer a member/i.test(entry.lastError || ''),
       String(entry && entry.lastError));
    run(`myMemberships = [{business_id:__A, role:'owner', status:'active'},
                          {business_id:__B, role:'owner', status:'active'}];`);
    run(`setOutbox([]);`);
  }

  // -------------------------------------------------------------------
  section('CASE 11: a legacy entry with no studio on it');
  // -------------------------------------------------------------------
  {
    reset(); OFFLINE = false;
    run(`myBusinessId = __B;`);
    /* exactly what an installed app from before this release carries */
    run(`setOutbox([{id:'ob-old', kind:'state', key:'layi_dash_tasks',
                     payload:{who:'from-an-older-build'}, tries:0, lastError:'',
                     at:'2026-09-01T00:00:00.000Z'}]);`);
    await runA(`await drainOutbox();`);
    ok('it is NOT sent', SENT.length === 0, JSON.stringify(SENT.map(x => x.business_id)));
    const old = JSON.parse(run(`JSON.stringify(outbox()[0]||null)`) || 'null');
    ok('  it is not deleted', !!old, 'the entry is gone');
    ok('  it is marked unresolved_tenant', !!old && old.state === 'unresolved_tenant', String(old && old.state));
    ok('  it keeps its payload', !!old && JSON.stringify(old.payload).includes('older-build'));
    ok('  and it says so in words a person can act on',
       !!old && /older version of The Label Board/i.test(old.lastError || ''), String(old && old.lastError));
    ok('  and it is listed as unresolved', run('outboxUnresolved().length') === 1);
    run(`setOutbox([]);`);
  }

  // -------------------------------------------------------------------
  section('CASE 10: a malformed record does not stop the queue');
  // -------------------------------------------------------------------
  {
    reset(); OFFLINE = false;
    run(`myBusinessId = __A;`);
    run(`setOutbox([{id:'ob-bad'}, {id:'ob-good', kind:'state', key:'layi_dash_anns',
                    business_id:__A, payload:{who:'A-anns'}, tries:0, lastError:'', at:''}]);`);
    let threw = '';
    try { await runA(`await drainOutbox();`); } catch (e) { threw = String(e.message); }
    ok('the drain does not throw', !threw, threw);
    ok('  and the good entry still went, to A',
       sentTo(A).length === 1 && sentTo(B).length === 0, 'A:' + sentTo(A).length + ' B:' + sentTo(B).length);
    run(`setOutbox([]);`);
  }

  // -------------------------------------------------------------------
  section('CASE 12: the server accepted it but the answer never arrived');
  // -------------------------------------------------------------------
  {
    reset(); OFFLINE = false;
    run(`myBusinessId = __A;`);
    run(`outboxQueue({kind:'state', key:'layi_dash_leave', payload:{who:'A-leave'}});`);
    FAIL_AFTER_COMMIT = true;                 // recorded, then the reply is lost
    await runA(`await drainOutbox();`);
    FAIL_AFTER_COMMIT = false;
    await runA(`await drainOutbox();`);       // the retry
    const writes = SENT.filter(x => JSON.stringify(x.payload).includes('A-leave'));
    ok('the retry goes to the same studio', writes.every(w => w.business_id === A),
       JSON.stringify(writes.map(w => w.business_id)));
    ok('  and it is an upsert, so a repeat is the same row rather than a second one',
       writes.every(w => w.op === 'upsert'), JSON.stringify(writes.map(w => w.op)));
    run(`setOutbox([]);`);
  }

  // -------------------------------------------------------------------
  section('Orders: the payload that is not in the entry');
  // -------------------------------------------------------------------
  {
    reset(); OFFLINE = true;
    run(`myBusinessId = __A;`);
    run(`saveLocal('layi_dash_orders', [{id:'A-ORDER-1', value:1000, client:'A client', branch:''}]);`);
    run(`outboxQueue({kind:'orders', key:'layi_dash_orders', payload:1});`);
    await runA(`await switchStudio(__B);`);
    const snap = JSON.parse(run(`JSON.stringify((outbox().filter(function(x){return x.kind==='orders';})[0]||{}).payload||null)`) || 'null');
    ok('switching takes a copy before the local orders are cleared',
       !!snap && Array.isArray(snap.orders) && snap.orders.length === 1 && snap.orders[0].id === 'A-ORDER-1',
       JSON.stringify(snap));
    ok('  and the device no longer holds A’s orders', run(`rawOrders().length`) === 0);
    OFFLINE = false;
    await runA(`await drainOutbox();`);
    const bad = SENT.filter(x => x.business_id === B && JSON.stringify(x.payload).includes('A-ORDER-1'));
    ok('A’s order is never written into B', bad.length === 0, JSON.stringify(bad));
    ok('  it is written to A', SENT.some(x => x.business_id === A && JSON.stringify(x.payload).includes('A-ORDER-1')),
       JSON.stringify(SENT.map(x => ({ to: x.business_id === A ? 'A' : 'B', t: x.table }))));
  }

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fails.length + ' failed');
  for (const f of fails) console.log('  - ' + f);
  if (BREAK) {
    if (fails.length) { console.log('\nGood: with the binding removed the suite fails, so it is load-bearing.'); process.exit(0); }
    console.log('\nBAD: the binding was removed and every check still passed.'); process.exit(1);
  }
  if (!fails.length) console.log('\nA queued write goes to the studio it was made in, whatever is on screen.');
  process.exit(fails.length ? 1 : 0);
})();
