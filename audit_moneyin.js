// Money In hub gate.
// The unified received-money lens must: tag every inflow by channel, let a payment be
// logged by hand as CASH RECEIVED without touching the accrual P&L (no double count),
// stay period + branch scoped, and reconcile the channel figure with its drill-down.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
// keep renderAll/toast quiet so saveLogPayment is deterministic in the harness
run("renderAll=function(){};toast=function(){};");
let fails=[];const F=x=>fails.push(x);
const J=e=>JSON.parse(run('JSON.stringify('+e+')'));
const N=e=>Number(run(e));

// 1) Taxonomy present.
const chans=J("IN_CHANNELS"),meths=J("IN_METHODS");
['Studio','Website','WhatsApp','Instagram','Referral','Other'].forEach(c=>{if(chans.indexOf(c)<0)F('channel "'+c+'" missing from IN_CHANNELS');});
['Transfer','Cash','Card','POS'].forEach(x=>{if(meths.indexOf(x)<0)F('method "'+x+'" missing from IN_METHODS');});

// 2) Channel inference maps the messy stored values to clean labels.
const nc=v=>run("normChannel('"+v+"')");
if(nc('online')!=='Website') F('online should map to Website');
if(nc('showroom')!=='Studio') F('showroom should map to Studio');
if(nc('whatsapp')!=='WhatsApp') F('whatsapp should map to WhatsApp');
if(nc('ig')!=='Instagram') F('ig should map to Instagram');
if(nc('somethingelse')!=='Other') F('an unknown channel should fall back to Other');

// helper: log a payment by seeding the modal inputs and calling the real save path
const setEl=(id,v)=>{sb.document.getElementById(id).value=v;};
function log(amount,channel,method,who,note,dateISO,branch){
  setEl('lp_amount',String(amount));setEl('lp_channel',channel);setEl('lp_method',method);
  setEl('lp_who',who||'');setEl('lp_note',note||'');setEl('lp_date',dateISO);setEl('lp_branch',branch);
  run("saveLogPayment();");
}
const today=new Date().toISOString().slice(0,10);

// 3) Baselines BEFORE logging.
const accrualBefore=N("financeTotals().revenue");
const cashInBefore=N("getTxns().filter(inBranch).filter(t=>t.dir==='in').reduce((s,t)=>s+(+t.amount||0),0)");
const waAllBefore=J("moneyInByChannel('all','')").WhatsApp||0;
const nTxnBefore=N("getTxns().length");

// 4) Log a WhatsApp transfer today, at the Abuja outlet.
log(50000,'WhatsApp','Transfer','Test Buyer','balance on gown',today,'Abuja outlet');

const nTxnAfter=N("getTxns().length");
if(nTxnAfter!==nTxnBefore+1) F('logging a payment did not add exactly one transaction');
const last=J("(function(){var t=getTxns();var x=t.filter(function(y){return y.cat==='manual';});return x[x.length-1]||null;})()");
if(!last) F('logged payment is not stored as a manual cash entry (cat:"manual")');
else{
  if(last.dir!=='in') F('logged payment is not a money-in entry');
  if(Math.abs((+last.amount||0)-50000)>0.5) F('logged amount not stored');
  if(last.channel!=='WhatsApp') F('logged channel not stored');
  if(last.method!=='Transfer') F('logged method not stored');
  if(!last.who) F('who-from not stored');
  if(last.orderId) F('a hand-logged payment must NOT be tied to an order (would double count)');
  if(last.branch!=='Abuja outlet') F('logged payment landed in the wrong branch');
}

// 5) It is CASH received, but must NOT change the accrual P&L revenue.
const accrualAfter=N("financeTotals().revenue");
if(Math.abs(accrualAfter-accrualBefore)>0.5) F('a hand-logged payment changed the accrual P&L revenue — that double counts (before '+accrualBefore+', after '+accrualAfter+')');
const cashInAfter=N("getTxns().filter(inBranch).filter(t=>t.dir==='in').reduce((s,t)=>s+(+t.amount||0),0)");
if(Math.abs((cashInAfter-cashInBefore)-50000)>0.5) F('received-cash total did not rise by the logged amount');
const waAllAfter=J("moneyInByChannel('all','')").WhatsApp||0;
if(Math.abs((waAllAfter-waAllBefore)-50000)>0.5) F('the WhatsApp channel figure did not rise by the logged amount');

// 6) Period scoping: a payment dated in the far past must not appear in "today".
const studioTodayBefore=J("moneyInByChannel('today','')").Studio||0;
const studioAllBefore=J("moneyInByChannel('all','')").Studio||0;
log(12345,'Studio','Cash','','walk-in','2020-01-01','Abuja outlet');
const studioTodayAfter=J("moneyInByChannel('today','')").Studio||0;
const studioAllAfter=J("moneyInByChannel('all','')").Studio||0;
if(Math.abs(studioTodayAfter-studioTodayBefore)>0.5) F('a 2020 payment leaked into the "today" channel figure — not period scoped');
if(Math.abs((studioAllAfter-studioAllBefore)-12345)>0.5) F('the 2020 payment is missing from the all-time channel figure');

// 7) Branch scoping: the Abuja WhatsApp payment must be invisible from another branch.
run("activeBranchView='Lagos studio';");
const waLagos=J("moneyInByChannel('all','')").WhatsApp||0;
run("activeBranchView='Abuja outlet';");
const waAbuja=J("moneyInByChannel('all','')").WhatsApp||0;
run("activeBranchView='all';");
if(waLagos>=waAbuja) F('a payment logged at the Abuja outlet showed under the Lagos view (branch scope broken)');

// 8) The Finance panel renders the hub, is clickable, and shows a total.
run("finPeriod='all';finCustom='';");
if(cache['finMoneyIn'])cache['finMoneyIn'].innerHTML='';
try{run("renderFinance();");}catch(e){F('renderFinance threw after the Money In panel was added → '+e.message);}
const panel=(cache['finMoneyIn']&&cache['finMoneyIn'].innerHTML)||'';
if(!/openMoneyInChannel\('/.test(panel)) F('Money In panel is not clickable to a channel breakdown');
if(!/WhatsApp/.test(panel)) F('Money In panel does not show the WhatsApp channel that has money in it');

// 9) The channel figure reconciles with its drill-down.
run("openMoneyInChannel('WhatsApp','all','');");
const drillTot=(((cache['modal']&&cache['modal'].innerHTML)||'').match(/bd-total[\s\S]*?<b[^>]*>([^<]+)</)||[])[1]||'';
const dn=s=>Number(String(s).replace(/[^0-9]/g,''));
if(!drillTot) F('WhatsApp drill opened no total');
else if(Math.abs(dn(drillTot)-Math.round(waAllAfter))>1) F('WhatsApp channel figure ('+Math.round(waAllAfter)+') does not reconcile with its drill total ('+dn(drillTot)+')');

// 10) Dashboard reflection: the same received-by-channel lens must appear on the dashboard,
//     track its period + branch selector, be clickable, and reconcile with the channel sums.
run("currentUser=getUsers().find(u=>u.roleId==='owner');");
function dash(period,bv){run("activeBranchView='"+(bv||'all')+"';dashApptPeriod='"+period+"';dashApptCustom='';");if(cache['dashMoneyIn'])cache['dashMoneyIn'].innerHTML='';try{run("renderActivity();");}catch(e){return 'ERR:'+e.message;}return (cache['dashMoneyIn']&&cache['dashMoneyIn'].innerHTML)||'';}
const dAll=dash('all','all');
if(/^ERR:/.test(dAll)) F('renderActivity threw after the dashboard Money In panel was added → '+dAll);
if(!/openMoneyInChannel\('/.test(dAll)) F('dashboard Money In panel is not clickable to a channel');
if(!/WhatsApp/.test(dAll)) F('dashboard Money In panel does not show the WhatsApp channel');
if(run("(document.getElementById('dashMoneyInPanel').style.display)==='none'")) F('dashboard Money In panel is hidden for the owner');
const dToday=dash('today','all');
if(dAll===dToday) F('dashboard Money In panel does not respond to the period selector');
const dLagos=dash('all','Lagos studio');
if(dAll===dLagos) F('dashboard Money In panel does not respond to the branch switcher');
// overview modal reconciles with the channel sums
run("activeBranchView='all';dashApptPeriod='all';dashApptCustom='';");
const sumAll=N("(function(){var b=moneyInByChannel('all','');var t=0;for(var k in b)t+=b[k];return t;})()");
run("openMoneyInOverview('all','');");
const ovTot=(((cache['modal']&&cache['modal'].innerHTML)||'').match(/bd-total[\s\S]*?<b[^>]*>([^<]+)</)||[])[1]||'';
if(!ovTot) F('dashboard channel overview opened no total');
else if(Math.abs(dn(ovTot)-Math.round(sumAll))>1) F('dashboard overview total ('+dn(ovTot)+') does not reconcile with the channel sums ('+Math.round(sumAll)+')');

console.log('Money In hub audit:');
console.log('  channels: '+chans.join(' · '));
console.log('  logged ₦50,000 WhatsApp/Transfer → accrual P&L unchanged ('+accrualBefore+'), cash-in +50,000, channel reconciles with drill');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ inflows are channel-tagged, hand-logged money is cash-only (no double count), period + branch scoped, and reconciles');
process.exit(fails.length?1:0);
