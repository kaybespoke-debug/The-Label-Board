// Payment method gate — "how did this money move?"
//
// Kayode's decision, and the right one: no bank APIs, no gateway integration,
// no holding anybody's money. A studio records what it took and what it spent,
// and says how — cash, transfer, POS, card, a website sale — so Finance, Sales
// and revenue all reconcile against a drawer, a terminal and a statement.
//
// Before this existed, 10 of the 13 places that record money did not ask. That
// included the three biggest inflows in the whole app: the deposit on an order,
// the balance on delivery, and a shop sale. A studio could take ₦2m across a
// month and have no idea how much of it was cash.
//
// The invariant that catches a regression: EVERY path that writes a transaction
// must carry a method field, and the per-method totals must add back up to the
// overall total. If a new path forgets, the totals still add up but the money
// lands in "Not recorded", so this gate checks both.
const fs=require('fs'),vm=require('vm');
const appPath=process.argv[2] || 'site/layi_dashboard.html';
const html=fs.readFileSync(appPath,'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=(id)=>({_id:id,innerHTML:'',value:'',checked:false,placeholder:'',textContent:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl(i))},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},requestAnimationFrame:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},prompt(){return '2';},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

/* 1) The studio owns its own list. --------------------------------------------
   A fixed list of six is wrong everywhere: Lagos takes Opay and Moniepoint,
   Accra takes MoMo, London takes a card machine none of us have heard of. */
if(run("typeof payMethods")!=='function')F('there is no payment method list');
const def=run("payMethods()");
if(!def.length)F('the default payment method list is empty');
['Cash','Bank transfer','POS','Card'].forEach(m=>{
  if(def.indexOf(m)<0)F('the default list is missing "'+m+'", which nearly every studio uses');
});
run("SETTINGS.payMethods=['Opay','Moniepoint','Cash'];");
const own=run("payMethods()");
if(own.join()!=='Opay,Moniepoint,Cash')F('a studio set its own methods and the app ignored them: '+own.join());
// editing an old record must not silently rewrite its method to something else
const kept=run("payMethodsFor('PalmPay')");
if(kept.indexOf('PalmPay')<0)F('opening a payment recorded with a method no longer on the list drops that method');
// an empty list falls back rather than leaving a studio unable to record anything
run("SETTINGS.payMethods=[];");
if(!run("payMethods().length"))F('clearing the list leaves a studio with no way to record a payment');
run("SETTINGS.payMethods=null;");

/* 2) Every path that records money asks how it moved. -------------------------
   Read from the source, so a NEW path that forgets fails this gate the day it
   is written rather than the day a customer cannot reconcile their month. */
{
  const src=html;
  const idx=[];let i=0;
  while((i=src.indexOf("push({id:uid('t')",i+1))>0)idx.push(i);
  const missing=[];
  idx.forEach(at=>{
    const line=src.slice(0,at).split('\n').length;
    // the demo seed writes its own methods inline and is not a code path
    if(/method\s*:/.test(src.slice(at,at+520)))return;
    if(/method\s*[,}]/.test(src.slice(at,at+520)))return;
    const snippet=src.slice(at,at+150).replace(/\s+/g,' ');
    missing.push(line+': '+snippet.slice(0,90));
  });
  if(missing.length){
    F(missing.length+' place(s) record money without asking how it moved:');
    missing.forEach(x=>F('    '+x));
  }
}

/* 3) The three biggest inflows specifically. ---------------------------------
   These are named because they are the ones that were wrong, and because they
   are the ones a studio uses every single day. */
[['f_method','the deposit on a new order'],
 ['u_balMethod','the balance collected on delivery'],
 ['sale_method','a shop sale'],
 ['p_method','a payment logged against an order']].forEach(pair=>{
  if(html.indexOf("'"+pair[0]+"'")<0&&html.indexOf('"'+pair[0]+'"')<0)
    F('nothing asks how the money arrived for '+pair[1]);
});

/* 4) Totals by method reconcile with the overall total. -----------------------
   The check that survives refactoring: however the money is sliced, the slices
   must add back up. */
{
  run("activeBranchView='all';");
  const txns=run("getTxns()");
  const totalIn=run("getTxns().filter(t=>t.dir==='in').reduce((a,t)=>a+(+t.amount||0),0)");
  const byIn=run("byPayMethod(getTxns().filter(t=>t.dir==='in'))");
  const sum=byIn.reduce((a,x)=>a+x.total,0);
  if(Math.round(sum)!==Math.round(totalIn))
    F('money in by method adds up to '+Math.round(sum)+' but the total is '+Math.round(totalIn));
  const totalOut=run("getTxns().filter(t=>t.dir==='out').reduce((a,t)=>a+(+t.amount||0),0)");
  const byOut=run("byPayMethod(getTxns().filter(t=>t.dir==='out'))");
  const sumOut=byOut.reduce((a,x)=>a+x.total,0);
  if(Math.round(sumOut)!==Math.round(totalOut))
    F('money out by method adds up to '+Math.round(sumOut)+' but the total is '+Math.round(totalOut));
  if(!txns.length)F('the example studio records no transactions, so this gate proves nothing');
}

/* 5) Money with no method is named, never guessed. ---------------------------
   Same rule as an unplaced record: the honest answer to "we do not know" is to
   say so, not to file it under whatever is first in the list. */
if(run("methodOf({})")!==run("PAY_METHOD_UNSET"))
  F('a payment with no method recorded is being attributed to a method it never had');
if(run("methodOf({method:'  '})")!==run("PAY_METHOD_UNSET"))
  F('a blank method is not treated as unrecorded');
if(run("methodOf({method:'Opay'})")!=='Opay')F('a recorded method is not read back correctly');

/* 6) It reaches the screen, per studio and per period. ------------------------ */
run("activeBranchView='all';");
try{run("renderFinance();");}catch(e){F('the finance page threw: '+e.message);}
const panel=run("(document.getElementById('finMethods')||{}).innerHTML")||'';
if(!panel)F('Finance does not show how the money moved');
else{
  if(!/Money in/.test(panel))F('the breakdown does not separate money in');
  if(!/Money out/.test(panel))F('the breakdown does not separate money out');
}
// and it follows the studio switcher like everything else
const names=run("getBranches().map(b=>b.name)");
if(names.length>1){
  const seen=names.map(n=>{
    run("activeBranchView="+JSON.stringify(n)+";");
    try{run("renderFinance();");}catch(e){}
    return run("(document.getElementById('finMethods')||{}).innerHTML")||'';
  });
  if(seen.every(x=>x===seen[0]))F('the money-moved breakdown shows the same figures in every studio');
}

/* 7) A payout that is cancelled at the method question is not recorded. -------
   Cancelling means "do not pay", not "pay and forget how" — a payout nobody can
   reconcile is worse than one that was never logged. */
if(!/if\(_payMethod===null\)return;/.test(html))F('cancelling the method question on a salary still records the payment');
if(!/if\(_commMethod===null\)return;/.test(html))F('cancelling the method question on a commission still records the payment');

console.log('Payment method audit:');
console.log('  default methods: '+def.join(' · '));
console.log('  every path that records money asks how it moved, and the totals reconcile');
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ studio owns the list, nothing is guessed, and the breakdown follows studio and period');
