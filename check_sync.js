// Proves the reported bug is fixed: a dashboard card's drill-down totals the SAME
// period as the card, independent of the Finance tab's own period state.
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(process.argv[2]||'layi_dashboard.html','utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';
while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const el=()=>({innerHTML:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){},scrollTop:0,value:''});
const cache={};const _ls={};
const doc={getElementById(i){return cache[i]||(cache[i]=el())},querySelector(){return el()},querySelectorAll(){return[]},createElement(){return el()},addEventListener(){},removeEventListener(){},body:el(),documentElement:el(),head:el()};
const sb={console,document:doc,localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]},clear(){}},setTimeout:f=>{try{f&&f()}catch(e){}return 0},clearTimeout(){},navigator:{userAgent:'node'},location:{href:'',hash:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);
vm.runInContext(code,sb,{filename:'x.js'});
sb.demoLogin();
sb.activeBranchView='all';

function totalOf(){ // parse the ₦ number from the modal's bd-total
  const h=(cache['modal']&&cache['modal'].innerHTML)||'';
  const m=h.match(/bd-total[\s\S]*?<b[^>]*>[^0-9]*([0-9,]+)/);
  return m?Number(m[1].replace(/,/g,'')):null;
}
function revFor(period){ // independent recomputation using the same primitives
  const txns=JSON.parse(_ls['layi_dash_txns']||'[]');
  return txns.filter(t=>t.dir==='in'&&sb.inPeriod(t.at,period,'')).reduce((s,t)=>s+(+t.amount||0),0);
}

let pass=true;const log=[];
// Dashboard period = year, Finance period = today (deliberately different)
sb.dashApptPeriod='year';sb.dashApptCustom='';
sb.finPeriod='today';sb.finCustom='';
sb.openDashFlow('in');
const drillYear=totalOf();
const wantYear=revFor('year');
log.push(`dashApptPeriod=year, finPeriod=today → drill total=${drillYear}  expected(year)=${wantYear}`);
if(drillYear!==wantYear){pass=false;log.push('  ✗ drill did NOT match the dashboard (year) period');}
else log.push('  ✓ drill matches the dashboard period, ignoring finance period');

// Change dashboard period to month; drill must follow it
sb.dashApptPeriod='month';
sb.openDashFlow('in');
const drillMonth=totalOf();
const wantMonth=revFor('month');
log.push(`dashApptPeriod=month → drill total=${drillMonth}  expected(month)=${wantMonth}`);
if(drillMonth!==wantMonth){pass=false;log.push('  ✗ drill did not track the changed dashboard period');}
else log.push('  ✓ drill tracked the dashboard period change');

// Expenses drill must exclude pending/rejected (expenseCounts) like the card
sb.dashApptPeriod='all';
sb.openDashFlow('out');
const drillOut=totalOf();
const txns=JSON.parse(_ls['layi_dash_txns']||'[]');
const wantOut=txns.filter(t=>t.dir==='out'&&sb.expenseCounts(t)).reduce((s,t)=>s+(+t.amount||0),0);
log.push(`expenses drill (all) total=${drillOut}  expected(counted)=${wantOut}`);
if(drillOut!==wantOut){pass=false;log.push('  ✗ expenses drill total mismatch');}
else log.push('  ✓ expenses drill counts approved-only, matching the card');

// Dashboard accrual P&L cards must equal their drill-down totals, and the P&L must reconcile.
sb.activeBranchView='all';
const T=sb.financeTotals();
const near=(a,b)=>Math.abs(a-b)<=1;
sb.openBreakdown('revenue');const revDrill=totalOf();
sb.openBreakdown('allcosts');const costDrill=totalOf();
sb.openBreakdown('profit');const retDrill=totalOf();
log.push(`\nAccrual P&L cards vs drills → revenue card=${Math.round(T.revenue)} drill=${revDrill} · costs card=${Math.round(T.costs)} drill=${costDrill} · retained card=${Math.round(Math.abs(T.retained))} drill=${retDrill}`);
if(!near(revDrill,Math.round(T.revenue))){pass=false;log.push('  ✗ Revenue card ≠ its billed-revenue drill');}else log.push('  ✓ Revenue = order value billed drill');
if(!near(costDrill,Math.round(T.costs))){pass=false;log.push('  ✗ Expenses card ≠ its total-costs drill');}else log.push('  ✓ Expenses = total-costs drill');
if(!near(retDrill,Math.round(Math.abs(T.retained)))){pass=false;log.push('  ✗ Profit card ≠ retained-profit waterfall total');}else log.push('  ✓ Profit = retained business profit (waterfall)');
// the P&L must balance: billed revenue − total costs − director − reserves = retained
if(!near(T.revenue-T.costs-T.director-T.pots,T.retained)){pass=false;log.push('  ✗ P&L does not reconcile to retained profit');}else log.push('  ✓ revenue − costs − director − reserves = retained (balances)');

console.log(log.join('\n'));
console.log('\n'+(pass?'SYNC OK':'SYNC FAILED'));
process.exit(pass?0:1);
