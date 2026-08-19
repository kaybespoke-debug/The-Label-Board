// Offline smoke test for this session's dashboard fixes.
// Stubs a minimal DOM + localStorage, loads the real inline script, seeds demo data,
// then invokes each new/changed function to catch runtime reference errors.
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync(process.argv[2]||'layi_dashboard.html', 'utf8');

// --- extract inline JS script blocks (same rule as parsecheck) ---
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;
  const tm = attrs.match(/type\s*=\s*["']([^"']+)["']/i);
  if (tm && !/javascript|module/i.test(tm[1])) continue;
  code += '\n;' + m[2] + '\n';
}

// --- minimal DOM stub ---
function makeEl() {
  const style = {};
  const el = {
    innerHTML: '', textContent: '', value: '', checked: false,
    style, dataset: {}, options: [], children: [],
    classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    setAttribute(){}, getAttribute(){return null;}, removeAttribute(){},
    appendChild(c){this.children.push(c);return c;}, removeChild(){},
    addEventListener(){}, removeEventListener(){}, click(){}, focus(){}, blur(){},
    querySelector(){return null;}, querySelectorAll(){return [];},
    getContext(){return {}; }, scrollTop: 0
  };
  return el;
}
const elCache = {};
const document = {
  getElementById(id){ return elCache[id] || (elCache[id] = makeEl()); },
  querySelector(){ return makeEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return makeEl(); },
  createTextNode(t){ return { textContent: t }; },
  addEventListener(){}, removeEventListener(){}, body: makeEl(), documentElement: makeEl(),
  head: makeEl(), cookie: ''
};
// localStorage
const _ls = {};
const localStorage = {
  getItem(k){ return k in _ls ? _ls[k] : null; },
  setItem(k,v){ _ls[k] = String(v); },
  removeItem(k){ delete _ls[k]; },
  clear(){ for (const k in _ls) delete _ls[k]; }
};

const sandbox = {
  document, localStorage, console,
  navigator: { userAgent: 'node', language: 'en-GB', clipboard: { writeText(){return Promise.resolve();} } },
  location: { href: '', hash: '', reload(){}, search: '' },
  history: { pushState(){}, replaceState(){} },
  setTimeout: (f)=>{ try{ typeof f==='function'&&f(); }catch(e){} return 0; },
  clearTimeout(){}, setInterval(){return 0;}, clearInterval(){},
  requestAnimationFrame(f){ try{f&&f();}catch(e){} return 0; },
  alert(){}, confirm(){return true;}, prompt(){return null;},
  fetch(){ return Promise.resolve({ json(){return Promise.resolve({});}, text(){return Promise.resolve('');} }); },
  URL: { createObjectURL(){return '';}, revokeObjectURL(){} },
  Blob: function(){}, FileReader: function(){ this.readAsDataURL=()=>{}; },
  matchMedia(){ return { matches:false, addListener(){}, addEventListener(){} }; },
  Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Intl
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

// Fix stray token in makeEl (defensive): none — but guard vm compile below.
vm.createContext(sandbox);

let loaded = false, loadErr = null;
try {
  vm.runInContext(code, sandbox, { filename: 'layi-inline.js' });
  loaded = true;
} catch (e) {
  loadErr = e;
}

const results = [];
function call(name, fn) {
  try { fn(); results.push('  ok   ' + name); }
  catch (e) { results.push('  FAIL ' + name + '  →  ' + (e && e.message)); }
}

if (!loaded) {
  console.error('SCRIPT LOAD FAILED:\n' + (loadErr && loadErr.stack || loadErr));
  process.exit(1);
}

// seed demo data AND log in as owner (sets currentUser internally) so gated drills run for real
call('demoLogin()', () => sandbox.demoLogin());

const rd = (k)=>{ try { return JSON.parse(_ls[k]||'null') || []; } catch(e){ return []; } };
const bn = (sandbox.branchNames && sandbox.branchNames()[0]) || 'Main';

// Ensure at least one real order + appt exist so order/appt paths run against data.
if (!rd('layi_dash_orders').length && sandbox.save) {
  const past = new Date(Date.now()-5*864e5).toISOString().slice(0,10);
  sandbox.save('layi_dash_orders', [{
    id:'ord-test1', client:'Test Client', garment:'Agbada', kind:'order',
    outfits:[{type:'Agbada',name:'Royal agbada',price:250000,photos:[]}],
    value:250000, paid:100000, discount:0, costs:[], commissions:[{staffId:'st-demo1',kind:'maker',work:'Tailoring',amount:60000}],
    directorPct:25, directorOn:true, stageIndex:3, due:past, createdAt:new Date().toISOString(),
    branch:bn, updates:[{at:new Date(Date.now()-2*864e5).toISOString(),stage:'Cutting',note:'Fabric cut',by:'Franklin',worker:'Franklin'}]
  }]);
}
if (!rd('layi_dash_appts').length && sandbox.save) {
  sandbox.save('layi_dash_appts', [{ id:'a-test1', type:'Fitting', status:'Scheduled', date:new Date().toISOString().slice(0,10),
    time:'11:00', client:'Test Client', phone:'08030001111', location:'Studio', note:'Second fitting',
    outcome:'', adjust:'', feedback:'', branch:bn }]);
}
const orders2 = rd('layi_dash_orders');
const appts2 = rd('layi_dash_appts');
// pick an overdue/active order to exercise openAttn meaningfully
const attnOrder = orders2.find(o=>o.kind!=='sale' && (o.stageIndex||0) < 7) || orders2[0] || {};
const anOrder = attnOrder.id || 'nope';
const anAppt = (appts2[0] && appts2[0].id) || null;

// dashboard finance drills
call("openDashFlow('in')", ()=>sandbox.openDashFlow('in'));
call("openDashFlow('out')", ()=>sandbox.openDashFlow('out'));
call('openDashProfit()', ()=>sandbox.openDashProfit());
call('openDashOutstanding()', ()=>sandbox.openDashOutstanding());
call("openProfitBreakdown('month','')", ()=>sandbox.openProfitBreakdown('month',''));
call("openFlowBreakdown('in','year','')", ()=>sandbox.openFlowBreakdown('in','year',''));
call("openBreakdown('outstanding')", ()=>sandbox.openBreakdown('outstanding'));
call("openBreakdown('profit')", ()=>sandbox.openBreakdown('profit'));
// today cards
['delivered','due','new','dispatched'].forEach(k=>call("todayDrill('"+k+"')", ()=>sandbox.todayDrill(k)));
// branch report + drills
call('openBranchReport()', ()=>sandbox.openBranchReport());
['summary','revenue','expenses','outstanding','active','inventory','team','customer'].forEach(t=>call("openBranchDrill('"+bn+"','"+t+"')", ()=>sandbox.openBranchDrill(bn,t)));
// trio drills
call('renderDashSalesTrio()', ()=>sandbox.renderDashSalesTrio());
const g = orders2.find(o=>o.kind!=='sale');
call('garmentDrill(...)', ()=>sandbox.garmentDrill(((g&&(g.garment||''))+'').split(',')[0].trim()||'Order'));
call('custNameDrill(...)', ()=>sandbox.custNameDrill((g&&g.client)||'Walk-in'));
// appointments
call('openApptList()', ()=>sandbox.openApptList());
if (anAppt) { call('openApptDetail(appt)', ()=>sandbox.openApptDetail(anAppt)); }
else { results.push('  --   openApptDetail (no seeded appt)'); }
call('renderDashAppts()', ()=>sandbox.renderDashAppts());
// attention
call('openAttn(order)', ()=>sandbox.openAttn(anOrder));
call('renderActivity()', ()=>sandbox.renderActivity());
// expenses view
call('renderExpensesView()', ()=>sandbox.renderExpensesView && sandbox.renderExpensesView());

// appointment status transition
if (anAppt) { call("setApptStatus(appt,'Completed')", ()=>sandbox.setApptStatus(anAppt,'Completed')); }
console.log('Seeded: '+orders2.length+' orders, '+appts2.length+' appts, branch="'+bn+'"');
console.log(results.join('\n'));
const fails = results.filter(r=>r.includes('FAIL'));
console.log('\n'+(fails.length?fails.length+' FAILED':'ALL PASSED'));
process.exit(fails.length?1:0);
