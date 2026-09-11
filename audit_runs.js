// Production run gate.
//
// A run turns materials into stock. It is neither an order nor a purchase: there is no
// client, and you did not buy the finished thing. Before this it could only be faked as one
// or the other, and both lie. Without it an RTW brand cannot know what a garment cost to
// make, so cannot know its margin, which is the central question this software exists to
// answer.
//
// The whole point is that the money is counted ONCE. Kayode's words: "i dont want 2
// conflicting costing, i dont want interference but clean account". So this gate is mostly
// about the books:
//
//   * a run posts no revenue, ever
//   * the cost of a run is booked where a client order's costs are booked, and nowhere else
//   * the till does not charge a stock cost for a piece the studio already paid to make
//   * bought-in stock is still charged at the till, because nothing else ever booked it
//   * putting a run on the shelf twice is impossible
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

/* 0) The three kinds of record are three, and they do not overlap. ------------------- */
[['a client order',"{}",         true, false],
 ['a counter sale',"{kind:'sale'}",false,false],
 ['a production run',"{kind:'run'}",false,true]].forEach(c=>{
  if(run("isClientOrder("+c[1]+")")!==c[2])F(c[0]+' '+(c[2]?'is not':'is')+' being counted as something a client pays for');
  if(run("isRun("+c[1]+")")!==c[3])F(c[0]+' '+(c[3]?'is not':'is')+' being counted as a production run');
});

/* Set up a studio that makes its own rail. ------------------------------------------- */
run("loadExampleAs('rtw');currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
run("SETTINGS.branches=[{id:'b1',name:getBranches()[0].name,active:true,does:['garments:make','garments:stock']}];");
const home=run("getBranches()[0].name");
// a clean product with nothing on the shelf and nothing already costed
run("(function(){var ps=getProducts();var p=ps[0];p.cost=0;p.price=25000;delete p.costBookedUnits;"
  +"p.variants=[{id:'v-s',size:'S',color:'Navy',stock:{}},{id:'v-m',size:'M',color:'Navy',stock:{}}];setProducts(ps);})();");
const prodId=run("getProducts()[0].id");

function moneyNow(){
  // revenue and booked cost across the whole business, all time
  return J("(function(){var os=getOrders();return {"
    +"revenue:os.reduce(function(s,o){return s+orderNetBase(o);},0),"
    +"cost:os.reduce(function(s,o){return s+orderCost(o);},0)+os.reduce(function(s,o){return s+orderTeamTotal(o);},0)};})()");
}
const before=moneyNow();

/* 1) Starting a run: no client, no revenue, and it lands on the board. --------------- */
run("openRun();");
const form=run("document.getElementById('modal').innerHTML")||'';
if(!form)F('the production run screen rendered nothing');
if(!/Materials in, stock out/i.test(form))F('the run screen does not say what a run is');
if(!/no client/i.test(form))F('the run screen does not make clear there is no client');
/* Fill the FORM, not the draft. saveRun() calls syncRun() first, which reads the fields,
   so setting runDraft directly would test a path nobody can take and would be wiped. */
run("document.getElementById('r_q_0').value='8';document.getElementById('r_q_1').value='12';"
  +"document.getElementById('r_cl_0').value='Ankara 40 yards';"
  +"document.getElementById('r_ca_0').value='150000';"
  +"document.getElementById('r_cs_0').value='Balogun';"
  +"document.getElementById('r_ma_0').value='30000';"
  +"saveRun();");
const runId=run("(getOrders().filter(isRun)[0]||{}).id");
if(!runId){F('the run was not saved');}
else{
  let r=J("getOrders().find(o=>o.id==='"+runId+"')");
  if(r.client)F('a production run was given a client, and there is nobody to bill');
  if(+r.value!==0)F('a production run carries a value of '+r.value+', which would show as a sale nobody made');
  if(+r.paid!==0)F('a production run says somebody paid for it');
  if(run("isClientOrder(getOrders().find(o=>o.id==='"+runId+"'))"))F('a run is being counted among the orders a client pays for');
  if(run("runUnits(getOrders().find(o=>o.id==='"+runId+"'))")!==20)F('the run does not know it is making 20 pieces');
  // 150,000 + 30,000 over 20 = 9,000 a piece
  if(run("runUnitCost(getOrders().find(o=>o.id==='"+runId+"'))")!==9000)
    F('the cost per piece is wrong: '+run("runUnitCost(getOrders().find(o=>o.id==='"+runId+"'))")+', expected 9000');
  // it sits on the production board, because it occupies the same bench
  if(run("prodOrders().some(function(o){return o.id==='"+runId+"';})")!==true)
    F('the run is not on the production board, so the workroom looks empty the week it is making the rail');

  /* 2) The books: cost in, no revenue. ---------------------------------------------- */
  const after=moneyNow();
  if(Math.round(after.revenue-before.revenue)!==0)
    F('starting a production run added '+Math.round(after.revenue-before.revenue)+' of revenue out of nowhere');
  if(Math.round(after.cost-before.cost)!==180000)
    F('the run booked '+Math.round(after.cost-before.cost)+' of cost, expected 180000 exactly once');

  /* 3) Nothing is on the shelf until somebody says so. ------------------------------ */
  if(run("productUnitsTotal(getProducts().find(p=>p.id==='"+prodId+"'))")!==0)
    F('the pieces went on the shelf before the run was finished');
  if(run("runReadyToStock(getOrders().find(o=>o.id==='"+runId+"'))")!==false)
    F('a run that has not been made yet is offering to go on the shelf');
  // finish it
  run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+runId+"');o.stageIndex=STAGES.indexOf('Ready for Delivery');save('layi_dash_orders',l);})();");
  if(run("runReadyToStock(getOrders().find(o=>o.id==='"+runId+"'))")!==true)
    F('a finished run is not offering to go on the shelf');
  const att=J("orderAttention(getOrders().find(o=>o.id==='"+runId+"'))");
  if(!att||!/shelf/i.test(att.text||''))F('a finished run does not tell anybody to put it on the shelf');
  if(!att||!att.act||!/runToStock/.test(att.act.fn||''))F('a finished run offers no way to put it on the shelf');

  /* 4) On the shelf: the units exist and carry what they cost. ---------------------- */
  run("runToStock('"+runId+"');");
  const prod=J("getProducts().find(p=>p.id==='"+prodId+"')");
  if(run("productUnitsTotal(getProducts().find(p=>p.id==='"+prodId+"'))")!==20)
    F('20 pieces were made and the shelf does not hold 20');
  if(+prod.cost!==9000)F('the shelf says each piece cost '+prod.cost+', not the 9000 the run worked out');
  if(+prod.costBookedUnits!==20)F('the shelf does not know these 20 are already paid for');
  if(run("productStockValue(getProducts().find(p=>p.id==='"+prodId+"'))")!==180000)
    F('the stock is not worth what it cost to make');
  // and the run says who put it there and when
  r=J("getOrders().find(o=>o.id==='"+runId+"')");
  if(!r.stockedAt)F('the run does not record when it went on the shelf');
  if(!r.stockedBy)F('the run does not record who put it on the shelf');
  if(!(r.updates||[]).some(u=>/shelf/i.test(u.note||'')))F('putting a run on the shelf leaves nothing in its history');

  /* 5) Twice is impossible. --------------------------------------------------------- */
  const costBefore2=moneyNow().cost;
  run("runToStock('"+runId+"');run"+"ToStock('"+runId+"');");
  if(run("productUnitsTotal(getProducts().find(p=>p.id==='"+prodId+"'))")!==20)
    F('the same run went on the shelf more than once, so the studio thinks it has stock it never made');
  if(Math.round(moneyNow().cost-costBefore2)!==0)F('stocking a run again booked its cost a second time');

  /* 6) The till. The whole reason for the exercise. --------------------------------- */
  // selling a piece the studio MADE: revenue, and no stock cost, because it is already paid for
  const b4=moneyNow();
  /* Through the form again: recordSale() calls syncSaleDraft() before anything else. */
run("openSale('"+prodId+"');saleDraft.variantId='v-s';"
  +"document.getElementById('sale_qty').value='2';document.getElementById('sale_price').value='25000';"
  +"document.getElementById('sale_paid').value='50000';document.getElementById('sale_client').value='Walk-in';recordSale();");
  const sale1=J("getOrders().filter(function(o){return o.kind==='sale';}).slice(-1)[0]");
  const a4=moneyNow();
  if(Math.round(a4.revenue-b4.revenue)!==50000)F('selling two pieces at 25,000 did not put 50,000 of revenue in the books');
  if(Math.round(a4.cost-b4.cost)!==0)
    F('the till charged '+Math.round(a4.cost-b4.cost)+' of stock cost for pieces the studio had already paid to make, so that money is counted twice');
  if((sale1.costs||[]).length&&(sale1.costs[0].amount||0)>0)
    F('the sale carries a stock cost line for in-house pieces: '+JSON.stringify(sale1.costs));
  if(run("(getProducts().find(p=>p.id==='"+prodId+"').costBookedUnits||0)")!==18)
    F('selling two already-paid-for pieces did not draw the pool down to 18');

  // selling a piece that was BOUGHT IN: charged at the till, because nothing else booked it
  run("(function(){var ps=getProducts();var p=ps.find(x=>x.id==='"+prodId+"');p.costBookedUnits=0;"
    +"var v=p.variants.find(x=>x.id==='v-m');setVariantQty(v,'"+home+"',20);setProducts(ps);})();");
  const b5=moneyNow();
  run("openSale('"+prodId+"');saleDraft.variantId='v-m';"
  +"document.getElementById('sale_qty').value='3';document.getElementById('sale_price').value='25000';"
  +"document.getElementById('sale_paid').value='75000';document.getElementById('sale_client').value='Walk-in';recordSale();");
  const a5=moneyNow();
  if(Math.round(a5.cost-b5.cost)!==27000)
    F('bought-in stock was not charged at the till: '+Math.round(a5.cost-b5.cost)+', expected 3 × 9000');

  // a mixed sale: some already paid for, some not
  run("(function(){var ps=getProducts();var p=ps.find(x=>x.id==='"+prodId+"');p.costBookedUnits=2;"
    +"var v=p.variants.find(x=>x.id==='v-m');setVariantQty(v,'"+home+"',20);setProducts(ps);})();");
  const b6=moneyNow();
  run("openSale('"+prodId+"');saleDraft.variantId='v-m';"
  +"document.getElementById('sale_qty').value='5';document.getElementById('sale_price').value='25000';"
  +"document.getElementById('sale_paid').value='125000';document.getElementById('sale_client').value='Walk-in';recordSale();");
  if(Math.round(moneyNow().cost-b6.cost)!==27000)
    F('a sale of 5 with 2 already paid for should charge for 3, charged '+Math.round(moneyNow().cost-b6.cost));
  if(run("(getProducts().find(p=>p.id==='"+prodId+"').costBookedUnits||0)")!==0)
    F('the already-paid-for pool did not empty when those pieces sold');

  /* 7) A run never reaches the places that are about clients and money owed. -------- */
  ['getOrders().filter(isClientOrder)'].forEach(expr=>{
    if(run(expr+".some(function(o){return o.id==='"+runId+"';})"))F('a run turns up in '+expr);
  });
  if(run("orderOutstandingBase(getOrders().find(o=>o.id==='"+runId+"'))")!==0)
    F('a production run is showing as money somebody owes');
  const custs=J("Object.keys(getCustomers())");
  if(custs.some(k=>!k||k==='undefined'))F('a production run created a customer with no name: '+JSON.stringify(custs.filter(k=>!k)));
}

console.log('Production run audit:');
console.log('  a run of 20 at 180,000 of materials and labour = '+run("cur(9000)")+' a piece');
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ cost booked once when the run is made, revenue only when a piece sells,');
console.log('  ✓ the till never charges for what the studio already paid to make, and bought-in stock still is');
