// Period-responsiveness gate.
// The dashboard finance KPI cards MUST track the period/calendar selector (dashApptPeriod), a card's
// drill-down must total the SAME period, and Outstanding must stay a snapshot (never period-filtered).
// This is the regression class "the calendar switch stopped moving the dashboard KPI cards".
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2] || 'site/layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=m=>fails.push(m);

// Render the dashboard finance strip for a period; return each card's numeric value.
function strip(period){
  sb.dashApptPeriod=period;sb.dashApptCustom='';
  if(cache['ownerFinance'])cache['ownerFinance'].innerHTML='';
  try{ sb.renderOwnerFinance(); }catch(e){ F('renderOwnerFinance threw ('+period+') → '+e.message); return {}; }
  const h=(cache['ownerFinance']&&cache['ownerFinance'].innerHTML)||'';const out={};
  h.split('<div class="stat ').slice(1).forEach(seg=>{const l=(seg.match(/class="sl">([^<]*)</)||[])[1];const v=(seg.match(/class="sv">([\s\S]*?)<\/div>/)||[])[1];if(l)out[l.trim()]=Number((v||'').replace(/<[^>]*>/g,'').replace(/[^0-9.]/g,''));});
  return out;
}
const drillTotal=()=>{const h=(cache['modal']&&cache['modal'].innerHTML)||'';const m=h.match(/bd-total[\s\S]*?<b[^>]*>[^0-9]*([0-9,]+)/);return m?Number(m[1].replace(/,/g,'')):null;};

const today=strip('today'),all=strip('all');

// 1) The strip must MOVE with the period (demo has orders not all placed today).
if(!(today.Revenue<all.Revenue)) F('Revenue card does not respond to the period (today='+today.Revenue+', all='+all.Revenue+')');
if(today.Profit===all.Profit)     F('Profit card does not respond to the period (frozen at '+all.Profit+')');
if(today.Expenses===all.Expenses) F('Expenses card does not respond to the period');

// 2) Outstanding must be a SNAPSHOT — identical across periods.
if(today.Outstanding!==all.Outstanding) F('Outstanding changed with the period — it must be an all-orders snapshot');

// 3) Each card must equal its drill-down for the SAME period.
const near=(a,b)=>a!=null&&b!=null&&Math.abs(a-b)<=1;
['today','all'].forEach(p=>{
  const T=sb.financeTotals(p==='all'?undefined:p,'');
  run("closeModal&&closeModal&&0;");
  sb.openBreakdown('profit',p,'');const prof=drillTotal();
  sb.openBreakdown('revenue',p,'');const rev=drillTotal();
  sb.openBreakdown('allcosts',p,'');const cost=drillTotal();
  if(!near(prof,Math.round(Math.abs(T.retained)))) F('['+p+'] Profit card ≠ its retained-profit drill (card '+Math.round(Math.abs(T.retained))+' vs drill '+prof+')');
  if(!near(rev,Math.round(T.revenue))) F('['+p+'] Revenue card ≠ its billed-revenue drill');
  if(!near(cost,Math.round(T.costs))) F('['+p+'] Expenses card ≠ its total-costs drill');
});

// 4) EVERY period-driven tab's KPI cards must respond to its own period selector, and be branch-scoped.
//    [label, periodVar, renderFn, statContainer, branchAware]
const PTABS=[
  ['orders','ordersPeriod','renderOrders','ordersStats',true],
  ['production','prodPeriod','renderProduction','prodKpis',true],
  ['sales','salesPeriod','renderSales','salesStats',true],
  ['finance','finPeriod','renderFinance','finStats',true],
  ['logistics','logPeriod','renderLogistics','logStats',true],
  ['pots','potPeriod','renderPotsView','potStats',false],   // funds are company-wide balances, not branch-scoped
];
const branches=JSON.parse(_ls['layi_dash_settings']).branches.map(b=>b.name);
function renderTab(pv,fn,cont,period,bv){run("activeBranchView='"+(bv||'all')+"';"+pv+"='"+period+"';"+pv.replace('Period','Custom')+"='';");
  if(cache[cont])cache[cont].innerHTML='';try{run(fn+"();");}catch(e){return 'ERR:'+e.message;}return (cache[cont]&&cache[cont].innerHTML)||'';}
const tabResults={};
PTABS.forEach(([name,pv,fn,cont,ba])=>{
  const tToday=renderTab(pv,fn,cont,'today','all'),tAll=renderTab(pv,fn,cont,'all','all');
  if(/^ERR:/.test(tToday)||/^ERR:/.test(tAll)){F('['+name+'] render threw → '+(tToday.startsWith('ERR')?tToday:tAll));return;}
  const respondsPeriod=tToday!==tAll;
  if(!respondsPeriod) F('['+name+'] KPI cards do not respond to the period selector');
  let respondsBranch='n/a';
  if(ba){ const allB=renderTab(pv,fn,cont,'all','all'); respondsBranch=branches.some(bn=>renderTab(pv,fn,cont,'all',bn)!==allB);
    if(!respondsBranch) F('['+name+'] KPI cards do not respond to the branch switcher'); }
  tabResults[name]=(respondsPeriod?'period✓':'period✗')+' '+(ba?(respondsBranch?'branch✓':'branch✗'):'branch—');
});

// 5) The dashboard "Sales by category" donut must be period-aware, branch-aware, and show a labelled total.
function donutHtml(period,bv){run("activeBranchView='"+(bv||'all')+"';dashApptPeriod='"+period+"';dashApptCustom='';");if(cache['dashDonut'])cache['dashDonut'].innerHTML='';try{run("renderActivity();");}catch(e){F('renderActivity threw → '+e.message);return '';}return (cache['dashDonut']&&cache['dashDonut'].innerHTML)||'';}
const dToday=donutHtml('today','all'),dAll=donutHtml('all','all'),dLagos=donutHtml('all',branches[0]);
if(dToday===dAll) F('Sales-by-category donut does not respond to the period selector');
if(dLagos===dAll) F('Sales-by-category donut does not respond to the branch switcher');
if(!/total sales|No sales/.test(dAll)) F('donut centre is not a labelled sales total');
// The donut must be clickable to a category breakdown whose total reconciles with the donut centre.
donutHtml('all','all');
const donutTot=((cache['dashDonut']&&cache['dashDonut'].innerHTML||'').match(/font-weight="700"[^>]*>([^<]+)</)||[])[1]||'';
if(!/salesCategoryDrill/.test(dAll)) F('Sales-by-category donut is not clickable (no salesCategoryDrill handler)');
try{run("salesCategoryDrill();");}catch(e){F('salesCategoryDrill threw → '+e.message);}
const drillTot=(((cache['modal']&&cache['modal'].innerHTML)||'').match(/bd-total[\s\S]*?<b[^>]*>([^<]+)</)||[])[1]||'';
const dnum=s=>String(s).replace(/[^0-9]/g,'');
if(!drillTot) F('Sales-by-category breakdown has no total (drill did not open)');
else if(donutTot&&dnum(donutTot)!==dnum(drillTot)) F('donut total ('+donutTot+') ≠ its category breakdown total ('+drillTot+')');
// Each category row must drill to the order lines that make it up, reconciling to the category figure.
run("salesCategoryDrill();");
const catModal=(cache['modal']&&cache['modal'].innerHTML)||'';
if(!/onclick="salesCategoryItems\('/.test(catModal)) F('category rows are not clickable to their order-line breakdown');
const catName=(catModal.match(/salesCategoryItems\('([^']+)'\)/)||[])[1];
const catFig=(catModal.match(/salesCategoryItems\('[^']+'\)[\s\S]*?class="bv">([^<]+)</)||[])[1]||'';
if(catName){run("salesCategoryItems('"+catName.replace(/'/g,'')+"');");
  const itemTot=(((cache['modal']&&cache['modal'].innerHTML)||'').match(/bd-total[\s\S]*?<b[^>]*>([^<]+)</)||[])[1]||'';
  const itemImgs=(((cache['modal']&&cache['modal'].innerHTML)||'').match(/<img /g)||[]).length; // pictures present
  if(!itemTot) F('category "'+catName+'" opened no order-line breakdown');
  else if(Math.abs(Number(dnum(catFig))-Number(dnum(itemTot)))>2) F('category "'+catName+'" figure ('+catFig+') ≠ its order-line total ('+itemTot+')');
  if(!/openDetail|openSaleDetail/.test((cache['modal']&&cache['modal'].innerHTML)||'')) F('order lines in "'+catName+'" do not link to their order');
}

/* Recurring bills come round on their own period. -----------------------------------
   Everything used to be monthly, so an annual business permit was either logged twelve
   times or never. A bill is due when the period it is in is not the period it was last
   logged in, which is why the marker is a period KEY and not a date. */
(function(){
  const D=(y,m,d)=>'new Date('+y+','+(m-1)+','+d+')';
  // the key each cadence stamps
  [['month','month','2026-08'],['quarter','quarter','2026-Q3'],['year','year','2026']].forEach(function(c){
    const got=run("billPeriodKey('"+c[1]+"',"+D(2026,8,14)+")");
    if(got!==c[2])fails.push('a '+c[0]+'ly bill on 14 August 2026 is stamped '+got+', expected '+c[2]);
  });
  // a bill with no cadence at all is monthly, which is every bill saved before this existed
  if(run("billPeriodKey(undefined,"+D(2026,8,14)+")")!=='2026-08')
    fails.push('a bill saved before cadences existed is no longer treated as monthly');

  const due=(every,last,y,m,d)=>run("billIsDue({amount:1000,every:'"+every+"',lastLogged:'"+last+"'},"+D(y,m,d)+")");
  // monthly: logged in August, due again in September
  if(due('month','2026-08',2026,8,30)!==false)fails.push('a monthly bill logged this month is being asked for again');
  if(due('month','2026-08',2026,9,1)!==true)fails.push('a monthly bill is not due the following month');
  // quarterly: logged in Q3, NOT due again in September, due in October
  if(due('quarter','2026-Q3',2026,9,30)!==false)
    fails.push('a quarterly bill logged in July is being asked for again in September, which is the bug this fixes');
  if(due('quarter','2026-Q3',2026,10,1)!==true)fails.push('a quarterly bill is not due at the start of the next quarter');
  // annual: logged this year, not due again until next
  if(due('year','2026',2026,12,31)!==false)fails.push('an annual bill is being asked for twice in the same year');
  if(due('year','2026',2027,1,1)!==true)fails.push('an annual bill is not due the following year');
  // a bill with no amount is not a bill yet, whatever its cadence
  if(run("billIsDue({amount:0,every:'month',lastLogged:''})")!==false)
    fails.push('a bill with no amount on it is being logged as an expense of nothing');

  /* And the thing that actually posts them stamps each bill with ITS period, not with the
     month. Stamping the month would make a quarterly bill due again four weeks later. */
  run("setBills([{id:'b-m',label:'Rent',amount:1000,every:'month',lastLogged:''},"
     +"{id:'b-q',label:'Accountant',amount:5000,every:'quarter',lastLogged:''},"
     +"{id:'b-y',label:'Permit',amount:20000,every:'year',lastLogged:''}]);");
  const before=run('getTxns().length');
  run('logBillsThisMonth();');
  if(run('getTxns().length')-before!==3)fails.push('logging what is due did not post all three bills');
  const stamps=JSON.parse(run("JSON.stringify(getBills().map(b=>b.lastLogged))"));
  if(!/^\d{4}-\d{2}$/.test(stamps[0]))fails.push('the monthly bill was not stamped with a month: '+stamps[0]);
  if(!/^\d{4}-Q[1-4]$/.test(stamps[1]))fails.push('the quarterly bill was stamped '+stamps[1]+' instead of a quarter, so it is due again next month');
  if(!/^\d{4}$/.test(stamps[2]))fails.push('the annual bill was stamped '+stamps[2]+' instead of a year, so it is due again next month');
  // and nothing is due immediately afterwards
  const after=run('getTxns().length');
  run('logBillsThisMonth();');
  if(run('getTxns().length')!==after)fails.push('logging twice in a row posted the same bills again');
})();

console.log('Period & branch responsiveness audit:');
console.log('  dashboard  period✓ branch✓ · Profit today '+today.Profit+' / all '+all.Profit+' · Outstanding snapshot '+all.Outstanding);
Object.keys(tabResults).forEach(k=>console.log('  '+k.padEnd(11)+tabResults[k]));
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ every period-driven tab tracks its period selector and is branch-scoped; dashboard drills reconcile; Outstanding is a snapshot');
process.exit(fails.length?1:0);
