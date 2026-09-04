// One device, two studios.
//
// Kayode created the six test accounts, signed into each, and every one showed
// his own studio: the same orders, the same four branches. Row level security
// was not bypassed and the database was not wrong. The leak was entirely on the
// device.
//
// The app is local-first, so localStorage holds a whole studio. hydrateFromCloud
// overwrote only the keys the cloud actually returned, and each seeded studio had
// exactly one row — its settings. Orders, products, staff, customers, branches:
// all left exactly as the previous studio had them, now displayed under the new
// studio's name.
//
// And in the other direction, worse. Both hydrate and pullCustomers/pullSuppliers
// read an empty cloud as "a new studio's first device" and pushed whatever was
// local up as theirs. Sign into a client's account on your own laptop and their
// empty business fills with your orders — written by you, with your credentials,
// and stored by a database doing exactly as instructed. Nothing in the schema
// could have caught it, which is why this suite is here and not in supabase/.
//
// The rule this holds: a device knows whose studio its data belongs to, and data
// only ever moves between a device and the studio that device is claimed by.
'use strict';
const fs = require('fs');
const vm = require('vm');

const appPath = process.argv[2] || 'site/layi_dashboard.html';
const html = fs.readFileSync(appPath, 'utf8');

let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const A = '11111111-1111-1111-1111-111111111111';   // the studio already on the device
const B = '22222222-2222-2222-2222-222222222222';   // the studio signing in now

/* A Supabase stub that records every write. Chainable like the real client, and
   thenable so `await supa.from(x).select(y).eq(z)` resolves. */
function makeSupa(cloud) {
  const writes = [];
  function q(table) {
    const st = { table, _op: 'select', _rows: null };
    const self = {
      select() { return self; },
      order() { return self; },
      eq() { return self; },
      single() { st._single = true; return self; },
      maybeSingle() { st._single = true; return self; },
      insert(r) { st._op = 'insert'; writes.push({ table, op: 'insert', rows: [].concat(r) }); return self; },
      update(r) { st._op = 'update'; writes.push({ table, op: 'update', rows: [].concat(r) }); return self; },
      upsert(r) { st._op = 'upsert'; writes.push({ table, op: 'upsert', rows: [].concat(r) }); return self; },
      delete() { st._op = 'delete'; writes.push({ table, op: 'delete', rows: [] }); return self; },
      not() { return self; },
      then(res) {
        if (st._op !== 'select') return res({ data: st._single ? { id: 'new-id' } : [], error: null });
        const rows = (cloud[table] || []);
        return res({ data: st._single ? (rows[0] || null) : rows, error: null });
      }
    };
    return self;
  }
  return { client: { from: q, auth: { signOut() {}, getUser: async () => ({ data: { user: null } }) } }, writes };
}

function boot() {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, code = '';
  while ((m = re.exec(html))) {
    const a = m[1] || '';
    if (/\bsrc\s*=/.test(a)) continue;
    const t = a.match(/type\s*=\s*["']([^"']+)["']/i);
    if (t && !/javascript|module/i.test(t[1])) continue;
    code += '\n;' + m[2] + '\n';
  }
  const cache = {}, _ls = {};
  const mkEl = id => ({ _id: id, innerHTML: '', value: '', checked: false, textContent: '', placeholder: '',
    style: {}, dataset: {}, options: [], classList: { add(){}, remove(){}, toggle(){}, contains(){ return false } },
    setAttribute(){}, getAttribute(){ return null }, appendChild(c){ return c }, addEventListener(){},
    removeEventListener(){}, querySelector(){ return null }, querySelectorAll(){ return [] }, focus(){}, select(){}, remove(){} });
  const sb = {
    console: { log(){}, warn(){}, error(){}, debug(){} },
    document: { getElementById(i){ return cache[i] || (cache[i] = mkEl(i)) }, querySelector(){ return mkEl() },
      querySelectorAll(){ return [] }, createElement(){ return mkEl() }, addEventListener(){}, removeEventListener(){},
      body: mkEl(), documentElement: mkEl(), head: mkEl(), execCommand(){ return true } },
    localStorage: { getItem(k){ return k in _ls ? _ls[k] : null }, setItem(k, v){ _ls[k] = String(v) },
      removeItem(k){ delete _ls[k] } },
    setTimeout: f => { try { f && f() } catch (e) {} }, clearTimeout(){}, setInterval(){}, clearInterval(){},
    requestAnimationFrame: f => { try { f && f() } catch (e) {} },
    navigator: { userAgent: 'node', onLine: true }, location: { href: '', hash: '', search: '' },
    alert(){}, confirm(){ return true }, prompt(){ return '' },
    matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, Error,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Intl,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary')
  };
  sb.window = sb; sb.globalThis = sb; sb._ls = _ls;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'app' });
  return { sb, run: e => vm.runInContext(e, sb), ls: _ls };
}

(async () => {

// ---------------------------------------------------------------------
section('Signing in as another studio does not show them the last one');
// ---------------------------------------------------------------------
{
  const { sb, run, ls } = boot();
  run('loadExample(true);');                       // studio A is on this device
  run(`store.set('${'layi_dash_biz_owner'}', ${JSON.stringify(A)});`);
  const beforeOrders = run('rawOrders().length');
  const beforeBranches = run('getBranches().length');
  ok('the device starts with the other studio on it', beforeOrders > 0 && beforeBranches > 1,
     beforeOrders + ' orders, ' + beforeBranches + ' branches');

  // studio B's cloud: settings only, exactly as the seed migration leaves it
  const bSettings = { company: { name: 'Okoro & Sons Shoes', banks: [] }, plan: 'starter',
    branches: [{ id: 'br-solo', name: 'The bench', location: 'Aba, Abia', active: true, does: ['footwear'] }],
    productionStages: ['Last & Pattern', 'Clicking', 'Closing', 'Lasting', 'Soling', 'Finishing'] };
  const { client, writes } = makeSupa({ app_state: [{ key: 'layi_dash_settings', data: bSettings }],
                                        customers: [], suppliers: [] });
  sb.__stub = client; run('supa=__stub;');
  run("liveMode=true; myBusinessId=" + JSON.stringify(B) + ";");
  await sb.hydrateFromCloud();

  ok('the previous studio\'s orders are gone', run('rawOrders().length') === 0,
     run('rawOrders().length') + ' left');
  ok('and its products', run('getProducts().length') === 0, String(run('getProducts().length')));
  ok('and its staff', run('getStaff().length') === 0, String(run('getStaff().length')));
  ok('and its customers', Object.keys(run('getCustomers()')).length === 0,
     String(Object.keys(run('getCustomers()')).length));
  ok('and its suppliers', run('getSuppliers().length') === 0, String(run('getSuppliers().length')));

  ok('the studio on screen is the one that signed in',
     run('(SETTINGS.company&&SETTINGS.company.name)') === 'Okoro & Sons Shoes',
     String(run('(SETTINGS.company&&SETTINGS.company.name)')));
  ok('with its own single branch, not the other studio\'s four',
     run('getBranches().length') === 1, String(run('getBranches().length')));
  ok('and its own trade\'s production stages',
     run('STAGES.indexOf("Clicking")') > 0, run('JSON.stringify(STAGES)'));

  // the part a database can never catch
  const leaked = writes.filter(w => w.op !== 'select' &&
    (w.rows || []).some(r => r && (r.business_id === B) && w.table === 'app_state'));
  ok('nothing from the previous studio was written into this one',
     writes.length === 0, JSON.stringify(writes.map(w => w.table + ':' + w.op)));
  ok('and specifically no app_state was pushed', leaked.length === 0, String(leaked.length));
}

// ---------------------------------------------------------------------
section('Signing back into the same studio keeps its data');
// ---------------------------------------------------------------------
// The wipe must be about a change of studio, not about signing in. Losing
// everything on every login would be a different bug wearing the same fix.
{
  const { sb, run } = boot();
  run('loadExample(true);');
  run(`store.set('layi_dash_biz_owner', ${JSON.stringify(A)});`);
  const before = run('rawOrders().length');
  const { client, writes } = makeSupa({ app_state: [], customers: [], suppliers: [] });
  sb.__stub = client; run('supa=__stub; liveMode=true; myBusinessId=' + JSON.stringify(A) + ';');
  await sb.hydrateFromCloud();
  ok('the studio\'s own orders survive its own login', run('rawOrders().length') === before,
     before + ' -> ' + run('rawOrders().length'));
  ok('and an empty cloud is seeded from the device it belongs to',
     writes.some(w => w.table === 'app_state' && w.op === 'upsert'),
     JSON.stringify(writes.map(w => w.table + ':' + w.op)));
}

// ---------------------------------------------------------------------
section('A device that has only ever run offline');
// ---------------------------------------------------------------------
// Somebody who used the app locally and has just signed up must not lose
// their work. No marker plus an empty cloud is a genuine first sync.
{
  const { sb, run } = boot();
  run('loadExample(true);');
  const before = run('rawOrders().length');
  const { client, writes } = makeSupa({ app_state: [], customers: [], suppliers: [] });
  sb.__stub = client; run('supa=__stub; liveMode=true; myBusinessId=' + JSON.stringify(B) + ';');
  await sb.hydrateFromCloud();
  ok('their local work is kept', run('rawOrders().length') === before,
     before + ' -> ' + run('rawOrders().length'));
  ok('and pushed up as theirs', writes.some(w => w.table === 'app_state' && w.op === 'upsert'));
  ok('and the device is now marked as theirs',
     run("store.get('layi_dash_biz_owner')") === B, String(run("store.get('layi_dash_biz_owner')")));
}

// ---------------------------------------------------------------------
section('An unmarked device whose cloud already has a studio on it');
// ---------------------------------------------------------------------
// Here the cloud is the authority: whatever is local was never synced and
// cannot be assumed to belong to the account now signing in.
{
  const { sb, run } = boot();
  run('loadExample(true);');
  const { client, writes } = makeSupa({
    app_state: [{ key: 'layi_dash_settings', data: { company: { name: 'Balogun Fabrics' }, branches: [] } }],
    customers: [], suppliers: [] });
  sb.__stub = client; run('supa=__stub; liveMode=true; myBusinessId=' + JSON.stringify(B) + ';');
  await sb.hydrateFromCloud();
  ok('the local data is cleared rather than adopted', run('rawOrders().length') === 0,
     String(run('rawOrders().length')));
  ok('the cloud\'s studio is what shows',
     run('(SETTINGS.company&&SETTINGS.company.name)') === 'Balogun Fabrics',
     String(run('(SETTINGS.company&&SETTINGS.company.name)')));
  ok('and nothing local was pushed into it', writes.length === 0,
     JSON.stringify(writes.map(w => w.table + ':' + w.op)));
}

// ---------------------------------------------------------------------
section('A signed-in studio can fill itself from its trade example');
// ---------------------------------------------------------------------
// Settings offers "Load example studio…". Signed in, on a device that studio
// is claimed by, that is not demo data being borrowed — it is that studio
// creating records, which must sync like any other records it creates. This
// is how a test studio gets a full set without any of it living in a
// migration, and it is the same path a real studio uses to try the app out.
{
  const { sb, run } = boot();
  const { client, writes } = makeSupa({ app_state: [], customers: [], suppliers: [] });
  // signed in, device already claimed by this studio
  run(`store.set('layi_dash_biz_owner', ${JSON.stringify(B)});`);
  sb.__stub = client; run('supa=__stub; liveMode=true; myBusinessId=' + JSON.stringify(B) + ';');
  run("loadExampleAs('footwear');");

  ok('the studio now has its trade\'s orders', run('rawOrders().length') > 0,
     String(run('rawOrders().length')));
  ok('and they are that trade\'s work, not another\'s',
     /brogue|boot|loafer|sandal|mule/i.test(String(run('rawOrders()[0].garment'))),
     String(run('rawOrders()[0].garment')));
  ok('the studio keeps the one branch its trade uses',
     run('getBranches().length') === 1, String(run('getBranches().length')));

  const pushed = new Set(writes.filter(w => w.table === 'app_state').flatMap(w => (w.rows || []).map(r => r.key)));
  ok('the orders were pushed to the cloud, not just written locally',
     pushed.has('layi_dash_orders'), [...pushed].join(', ') || 'nothing pushed');
  ok('and so were the products', pushed.has('layi_dash_products'), [...pushed].join(', '));
  ok('every push carries this studio\'s business id and no other',
     writes.filter(w => w.table === 'app_state')
           .every(w => (w.rows || []).every(r => r.business_id === B)),
     'a push named the wrong studio');
}

// ---------------------------------------------------------------------
section('A signed-in studio with no business id writes nowhere');
// ---------------------------------------------------------------------
// myBusinessId||LAYI_BIZ used to be the fallback in eight places. LAYI_BIZ is
// the demo tenant's id, so every account that ever hit that fallback would
// have shared one business with every other account that hit it.
{
  const { sb, run } = boot();
  run('loadExample(true);');
  const { client, writes } = makeSupa({ app_state: [], customers: [], suppliers: [] });
  sb.__stub = client; run('supa=__stub; liveMode=true; myBusinessId=null;');
  const r = await sb.hydrateFromCloud();
  ok('hydrate refuses rather than falling back to the demo tenant', r === false, String(r));
  ok('and writes nothing anywhere', writes.length === 0,
     JSON.stringify(writes.map(w => w.table + ':' + w.op)));
}

console.log('\n' + '='.repeat(64));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('\nA device knows whose studio it holds. Data moves between a device');
console.log('and that studio, and nowhere else.');
})();
