// Money In hub gate.
// The unified received-money lens must: tag every inflow by channel, let a payment be
// logged by hand as CASH RECEIVED without touching the accrual P&L (no double count),
// stay period + branch scoped, and reconcile the channel figure with its drill-down.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2] || 'site/layi_dashboard.html'),'utf8');
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

/* What the money arrived in. --------------------------------------------------------
   Every inflow is stored converted to the studio's own currency, which is right for the
   books: one P&L, one number, no arguing about a rate. What it lost was the question a
   studio taking pounds actually asks, which is how much of the business is in pounds. The
   naira figure has to stay the one every total reads, so this checks both at once. */
(function(){
  const base=run('SETTINGS.currency');
  // an order priced in pounds, paid in two goes
  run("(function(){var l=rawOrders(),o=l.filter(isClientOrder)[0];o.currency='GBP';o.fx=2000;o.paid=0;o.quoted=false;delete o.confirmedAt;save('layi_dash_orders',l);})();");
  const oid=run("rawOrders().filter(isClientOrder)[0].id");
  const txBefore=run('getTxns().length');
  run("openPayment('"+oid+"');document.getElementById('p_amt').value='100';savePayment('"+oid+"');");
  if(run('getTxns().length')-txBefore!==1)fails.push('the payment did not reach the ledger');
  const t=JSON.parse(run("JSON.stringify(getTxns().slice(-1)[0])"));
  if(t.ccy!=='GBP')fails.push('a payment made in pounds does not record that it was pounds, it says '+t.ccy);
  if(+t.amtCcy!==100)fails.push('the amount the client actually handed over was not kept: '+t.amtCcy);
  if(Math.round(+t.amount)!==200000)fails.push('the books did not convert the payment: '+t.amount+', expected 100 x 2000');

  const by=JSON.parse(run('JSON.stringify(moneyInByCurrency())'));
  if(!by.GBP)fails.push('the breakdown has no line for the pounds that came in');
  else{
    if(Math.round(by.GBP.amount)!==100)fails.push('the pounds line says '+by.GBP.amount+' rather than 100');
    if(Math.round(by.GBP.base)!==200000)fails.push('the pounds line converts to '+by.GBP.base+' rather than 200,000');
  }
  // the naira column still adds up to every naira received, which is what the rest of the
  // screen reads. If these two ever disagree the breakdown is inventing money.
  const sumBase=Object.keys(by).reduce((s,k)=>s+by[k].base,0);
  const allIn=run("getTxns().filter(inBranch).filter(t=>t.dir==='in').reduce(function(s,x){return s+(+x.amount||0);},0)");
  if(Math.round(sumBase)!==Math.round(allIn))
    fails.push('the currency breakdown comes to '+Math.round(sumBase)+' but the money received is '+Math.round(allIn));
  // an inflow with nothing recorded is the studio's own currency, not a missing one
  if(run("txnCurrency({dir:'in',amount:5000})")!==base)
    fails.push('a payment with no currency on it is not being read as '+base);
  if(run("txnInOriginal({dir:'in',amount:5000})")!==5000)
    fails.push('a payment with no original amount on it loses its value');
  // and one currency is not a breakdown
  if(run("manyCurrencies({NGN:{amount:1,base:1,count:1}})")!==false)
    fails.push('a studio paid only in its own currency is shown a breakdown of one row');
  if(run("manyCurrencies({NGN:{},GBP:{}})")!==true)
    fails.push('a studio paid in two currencies is not shown the breakdown');
})();

console.log('Money In hub audit:');
console.log('  channels: '+chans.join(' · '));
console.log('  logged ₦50,000 WhatsApp/Transfer → accrual P&L unchanged ('+accrualBefore+'), cash-in +50,000, channel reconciles with drill');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ inflows are channel-tagged, hand-logged money is cash-only (no double count), period + branch scoped, and reconciles');
process.exit(fails.length?1:0);
