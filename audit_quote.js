// Quoted, then confirmed.
//
// The invoice-first flow: price the job, send it, and their payment is the yes. Until that
// yes there is a job on paper and nothing in the workroom.
//
// The decision this gate protects is that an invoice is NOT a second kind of record. A
// separate invoice store would leave two sets of books to reconcile against each other,
// which is the mistake production runs were built to avoid. A quote is an ORDER that has not
// been confirmed, so it already carries the client, the items, the prices, the discount, the
// deposit, the logistics and the invoice document.
//
// What has to hold: a quote is invisible to everything that assumes the work is real, and
// confirming it makes it an ordinary order with nothing lost.
'use strict';
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync((process.argv[2]||'site/layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';
while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const cache={},_ls={};
const mkEl=id=>({_id:id,innerHTML:'',value:'',checked:false,textContent:'',placeholder:'',style:{},dataset:{},options:[],
  classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},
  appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){},select(){},remove(){},closest(){return null}});
const sb={console:{log(){},warn(){},error(){},debug(){}},
  document:{getElementById(i){return cache[i]||(cache[i]=mkEl(i))},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl(),execCommand(){return true}},
  localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},
  setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},setInterval(){},clearInterval(){},
  requestAnimationFrame:f=>{try{f&&f()}catch(e){}},
  navigator:{userAgent:'node',onLine:true},location:{href:'',hash:'',search:''},
  alert(msg){sb.__alert=String(msg||'');},confirm(){return true},prompt(){return ''},
  matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}),
  Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,Promise,Error,Intl,
  parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,
  btoa:x=>Buffer.from(x,'binary').toString('base64'),atob:x=>Buffer.from(x,'base64').toString('binary')};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'app'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
const J=e=>JSON.parse(run('JSON.stringify('+e+')'));
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

/* 0) An invoice is not a second record type. ----------------------------------------- */
if(/layi_dash_invoices|layi_dash_quotes/.test(html))
  F('a separate store for invoices or quotes has appeared, which is a second set of books to reconcile');
[['a quote',"{quoted:true}",true],
 ['a confirmed order',"{quoted:true,confirmedAt:'2026-09-11'}",false],
 ['an ordinary order',"{}",false]].forEach(c=>{
  if(run("isQuote("+c[1]+")")!==c[2])F(c[0]+' '+(c[2]?'is not':'is')+' being treated as a quote');
  if(run("isConfirmed("+c[1]+")")!==!c[2])F(c[0]+' '+(!c[2]?'is not':'is')+' being treated as confirmed');
});

/* Take a real demo order and turn it into a quote. ----------------------------------- */
run("loadExampleAs('bespoke');currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
const qid=run("(getOrders().find(o=>isClientOrder(o))||{}).id");
if(!qid){F('no order to quote');}
else{
  const asQuote=()=>run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+qid+"');"
    +"o.quoted=true;delete o.confirmedAt;delete o.confirmedBy;o.paid=0;o.stageIndex=0;o.qc=null;"
    +"o.due=new Date(Date.now()-5*864e5).toISOString().slice(0,10);"   // deliberately in the past
    +"save('layi_dash_orders',l);})();");
  asQuote();
  const net=run("orderNet(getOrders().find(o=>o.id==='"+qid+"'))");
  if(!net)F('the order being quoted is worth nothing, so the money checks below prove nothing');

  /* 1) Nobody owes you for a job they have not agreed to. --------------------------- */
  if(run("orderOutstanding(getOrders().find(o=>o.id==='"+qid+"'))")!==0)
    F('a quote is showing as money somebody owes, and it will be chased');
  if(run("orderOutstandingBase(getOrders().find(o=>o.id==='"+qid+"'))")!==0)
    F('a quote is adding to the total outstanding in the books');
  // but the document still knows what the job is worth, or the invoice would say nothing
  if(run("orderNet(getOrders().find(o=>o.id==='"+qid+"'))")!==net)
    F('a quote forgot what the job is priced at, so there is nothing to invoice');

  /* 2) It is not in the workroom, and not work booked. ------------------------------ */
  if(run("prodOrders().some(function(o){return o.id==='"+qid+"';})"))
    F('a quote is sitting on the production board as though it had been started');
  const mixQ=run("methodMixTotal(methodMix())");
  run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+qid+"');delete o.quoted;save('layi_dash_orders',l);})();");
  const mixC=run("methodMixTotal(methodMix())");
  if(!(mixC>mixQ))F('a quote is being counted in the work booked, so the studio thinks it has work it has not won');
  asQuote();

  /* 3) It is not late, not failing QC, and owes no fabric check. -------------------- */
  const st=J("ledgerStatus(getOrders().find(o=>o.id==='"+qid+"'))");
  if(!/quote/i.test(st.txt||''))F('a quote does not say it is a quote, it says "'+st.txt+'"');
  if(/late/i.test(st.txt||''))F('a quote is being called late against a date nobody agreed to');
  if(html.indexOf('.opill.'+st.cls)<0)F('the quote status uses a pill style that does not exist: '+st.cls);
  const att=J("orderAttention(getOrders().find(o=>o.id==='"+qid+"'))");
  if(!att)F('a quote says nothing at all, so it can be sent and forgotten');
  else{
    if(!/waiting on them/i.test(att.text||''))F('the quote does not say what it is waiting for: '+att.text);
    if(/late|overdue|fabric|quality/i.test(att.text||''))F('a quote is being nagged about work that has not started: '+att.text);
    if(!att.act||!/confirmOrder/.test(att.act.fn||''))F('there is no way to confirm a quote from the order');
  }

  /* 4) The invoice tells the client what makes it an order. ------------------------- */
  const inv=run("invoiceInner(getOrders().find(o=>o.id==='"+qid+"'),'invoice')");
  if(!/once payment is received/i.test(inv))
    F('the invoice for an unconfirmed order does not say that paying it confirms the order');
  if(!/INVOICE/.test(inv))F('the document a client is asked to pay is no longer headed as an invoice');
  const rec=run("invoiceInner(getOrders().find(o=>o.id==='"+qid+"'),'receipt')");
  if(/once payment is received/i.test(rec))F('a receipt is telling somebody their payment will confirm the order');

  /* 5) Confirming, by hand. --------------------------------------------------------- */
  if(run("confirmOrder('"+qid+"','said yes')")!==true)F('a quote cannot be confirmed');
  let o2=J("getOrders().find(o=>o.id==='"+qid+"')");
  if(!o2.confirmedAt)F('confirming records no date');
  if(!o2.confirmedBy)F('confirming records nobody');
  if(run("isQuote(getOrders().find(o=>o.id==='"+qid+"'))"))F('it is still a quote after being confirmed');
  if(!(o2.updates||[]).some(u=>/confirmed/i.test(u.note||'')))F('confirming leaves nothing in the order history');
  if(run("prodOrders().some(function(o){return o.id==='"+qid+"';})")!==true)
    F('a confirmed order did not reach the production board');
  if(run("orderOutstanding(getOrders().find(o=>o.id==='"+qid+"'))")!==net)
    F('a confirmed order does not show the money owed on it');
  // confirming twice does nothing and cannot move the date
  const firstAt=o2.confirmedAt;
  if(run("confirmOrder('"+qid+"','again')")!==false)F('an order that is already confirmed can be confirmed again');
  if(run("getOrders().find(o=>o.id==='"+qid+"').confirmedAt")!==firstAt)F('confirming again rewrote when it was confirmed');

  /* 6) Confirming, by being paid, which is the whole point of the flow. ------------- */
  asQuote();
  run("openPayment('"+qid+"');document.getElementById('p_amt').value='5000';savePayment('"+qid+"');");
  o2=J("getOrders().find(o=>o.id==='"+qid+"')");
  if(run("isQuote(getOrders().find(o=>o.id==='"+qid+"'))"))
    F('a client paid against a quote and it is still a quote, so the work never reached the board');
  if(+o2.paid!==5000)F('the payment that confirmed the order was not recorded: paid is '+o2.paid);
  if(!(o2.updates||[]).some(u=>/confirmed/i.test(u.note||'')))F('being paid confirmed the order silently');
  if(!(o2.updates||[]).some(u=>/paid/i.test(u.note||'')))F('the history does not say the payment is what confirmed it');
  // and the money landed in the books, tied to the order
  const t=J("getTxns().filter(function(x){return x.orderId==='"+qid+"'&&x.dir==='in';})");
  if(!t.length)F('the payment that confirmed the order never reached the books');
  // the order is now ordinary: owed is the balance, not zero
  if(run("orderOutstanding(getOrders().find(o=>o.id==='"+qid+"'))")!==net-5000)
    F('after confirming by payment the balance owed is wrong');

  /* 7) The order form can say it, and cannot silently un-say it. -------------------- */
  run("openOrder('"+qid+"');");
  let form=run("document.getElementById('modal').innerHTML")||'';
  if(form.indexOf('this is a quote')<0)F('the order form never offers to mark an order a quote');
  if(!/Confirmed /.test(form))F('the order form does not show that a confirmed order was confirmed');
  // ticking the box on an order that has already been confirmed must not undo it
  run("document.getElementById('f_quoted').checked=true;syncOrderDraft();");
  if(run("isQuote(draft)"))
    F('an order that was confirmed, and may have money and work against it, was quietly turned back into a quote');
  run("closeModal();draft=null;");
  // on a fresh order the box does what it says
  run("openOrder();document.getElementById('f_quoted').checked=true;syncOrderDraft();");
  if(!run("isQuote(draft)"))F('ticking the box on a new order does not make it a quote');
  run("document.getElementById('f_quoted').checked=false;syncOrderDraft();");
  if(run("isQuote(draft)"))F('unticking the box does not confirm the order');
  if(!run("draft.confirmedAt"))F('unticking the box confirms without recording when');
  run("closeModal();draft=null;");

  /* 8) The dashboard counts them apart, and only when there are any. --------------- */
  asQuote();
  run("renderActivity();");
  const mini=run("document.getElementById('dashMini').innerHTML")||'';
  if(mini.indexOf('Quotes Out')<0)F('a studio with a quote out is not told about it on the dashboard');
  const hero=run("document.getElementById('dashHero').innerHTML")||'';
  const activeWithQuote=+(hero.match(/hero-num">(\d+)/)||[0,0])[1];
  run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+qid+"');delete o.quoted;o.confirmedAt=new Date().toISOString();save('layi_dash_orders',l);})();");
  run("renderActivity();");
  const activeConfirmed=+((run("document.getElementById('dashHero').innerHTML")||'').match(/hero-num">(\d+)/)||[0,0])[1];
  if(!(activeConfirmed>activeWithQuote))
    F('Active Orders counted the quote as work in hand, so the number is a wish list');
  if((run("document.getElementById('dashMini').innerHTML")||'').indexOf('Quotes Out')>=0)
    F('a studio with no quotes out is carrying an empty tile for a feature it is not using');
}

console.log('Quote audit:');
console.log('  a quote is an order with quoted:true and no confirmedAt — one field, no second store');
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ off the board, out of receivables and out of the work booked until somebody says yes,');
console.log('  ✓ and a payment says it without anybody having to remember');
