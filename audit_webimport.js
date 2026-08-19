// Website → Studio order bridge gate.
// The shop (separate Supabase project) hands over rows shaped like its `orders` + `order_items`
// tables. This proves the mapping is correct and, critically, IDEMPOTENT — re-running an import
// must never duplicate an order. Pure mapping, so it runs with no backend on either side.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
sb.activeBranchView='all';
let fails=[];const F=m=>fails.push(m);

// Fixtures mirroring the shop's real columns (orders + order_items).
const RETAIL={order:{ref:'LW-1001',customer_name:'Ada Nwosu',email:'ada@example.com',phone:'+2348010000001',total_ngn:180000,payment_status:'paid',status:'pending',is_consultation:false,measurements:{},created_at:'2026-07-10T10:00:00Z'},
  items:[{product_id:'p-shirt',name:'Linen shirt',colour:'White',qty:2,price_ngn:60000},{product_id:'p-cap',name:'Kufi cap',colour:'Navy',qty:1,price_ngn:60000}]};
const BESPOKE={order:{ref:'LW-1002',customer_name:'Tunde Bakare',phone:'+2348010000002',total_ngn:650000,payment_status:'awaiting_confirmation',is_consultation:false,deadline:'2026-08-20',measurements:{Chest:'42',Waist:'36'},notes:'Wedding',created_at:'2026-07-11T09:00:00Z'},
  items:[{product_id:null,name:'Ceremonial agbada',colour:'Wine',qty:1,price_ngn:650000}]};
const CONSULT={order:{ref:'LW-1003',customer_name:'Zainab A',total_ngn:0,payment_status:'unpaid',is_consultation:true,deadline:'2026-07-25',notes:'Wants a suit',created_at:'2026-07-12T09:00:00Z'},items:[]};

const map=r=>sb.webOrderToStudio(r.order,r.items);
const R=map(RETAIL),B=map(BESPOKE),C=map(CONSULT);

// 1) Routing: retail sale vs made-to-measure vs consultation.
if(R.type!=='sale') F('a website order with no measurements should become a retail sale (got '+R.type+')');
if(B.type!=='order') F('a website order WITH measurements should become a bespoke order (got '+B.type+')');
if(C.type!=='appointment') F('a consultation booking should become an appointment (got '+C.type+')');

// 2) Money: card-paid records cash in; an unconfirmed bank transfer must NOT.
if(R.record.value!==180000) F('retail value not carried across');
if(R.record.paid!==180000) F('a paid card order should record its money as received');
if(B.record.paid!==0) F('an unconfirmed bank transfer must not be recorded as paid (claim, not payment)');
if(B.record.value!==650000) F('bespoke value not carried across');
// line items must reconcile with the order total
const lineSum=RETAIL.items.reduce((s,i)=>s+i.price_ngn*i.qty,0);
if(lineSum!==R.record.value) F('retail line items ('+lineSum+') do not reconcile with the order total ('+R.record.value+')');

// 3) Shape: retail carries saleItems, bespoke carries outfits + measurements.
if(!Array.isArray(R.record.saleItems)||R.record.saleItems.length!==2) F('retail sale did not carry its line items');
if(R.record.kind!=='sale') F("retail record must be kind:'sale'");
if(!Array.isArray(B.record.outfits)||B.record.outfits.length!==1) F('bespoke order did not carry its pieces');
if(!B.record.meas||!B.record.meas.Chest) F('bespoke order lost the measurements captured on the website');
if(B.record.stageIndex!==0) F('a new bespoke order should start at the first production stage');

// 4) Branch: website orders land in the studio that sells online.
const onlineBranch=sb.webOnlineBranch();
[['retail',R],['bespoke',B],['consultation',C]].forEach(([n,x])=>{if(x.record.branch!==onlineBranch)F(n+' did not land in the online-selling studio ('+x.record.branch+' vs '+onlineBranch+')');});

// 5) Traceability back to the shop.
if(R.record.webRef!=='LW-1001'||R.record.source!=='website') F('imported order is not traceable back to its website ref');

// 6) IDEMPOTENCY — importing the same batch twice must not duplicate.
const run=e=>vm.runInContext(e,sb);                    // getOrders/getAppts are const arrows, not globals
const before=run('getOrders().length'), beforeA=run('getAppts().length');
const first=sb.importWebOrders([RETAIL,BESPOKE,CONSULT]);
const second=sb.importWebOrders([RETAIL,BESPOKE,CONSULT]);
const afterO=run('getOrders().length'), afterA=run('getAppts().length');
if(first.added!==3) F('first import should have added 3 records (got '+first.added+')');
if(second.added!==0) F('re-importing the same website orders DUPLICATED them (added '+second.added+' again)');
if(second.skipped!==3) F('re-import should skip all 3 as already imported (skipped '+second.skipped+')');
if(afterO!==before+2) F('expected 2 new orders, got '+(afterO-before));
if(afterA!==beforeA+1) F('expected 1 new appointment, got '+(afterA-beforeA));

// 7) Imported orders must behave like native ones (branch + period filters see them).
sb.activeBranchView=onlineBranch;
const seen=run("getOrders().filter(inBranch).some(function(o){return o.webRef==='LW-1001';})");
sb.activeBranchView='all';
if(!seen) F('an imported website order is invisible to the branch filter');

// 8) ANY website: the normalizer maps common platform aliases (Shopify-style) onto our shape.
const shop={order_number:'#1050',financial_status:'paid',total_price:'75000',customer:{first_name:'Ada',last_name:'N',email:'ada@x.com',phone:'+2348010000009'},line_items:[{title:'Linen shirt',sku:'p-shirt',quantity:2,price:'30000',variant_title:'White'}]};
const nz=JSON.parse(run('JSON.stringify(normalizeWebOrder('+JSON.stringify(shop)+'))'));
if(nz.order.ref!=='1050') F('normalizer did not map the order number (#1050 → 1050): got '+nz.order.ref);
if(nz.order.payment_status!=='paid') F('normalizer did not map financial_status=paid');
if(nz.order.total_ngn!==75000) F('normalizer did not map total_price → total_ngn');
if(nz.order.customer_name!=='Ada N') F('normalizer did not assemble the customer name from first/last');
if(!nz.items[0]||nz.items[0].product_id!=='p-shirt'||nz.items[0].qty!==2||nz.items[0].price_ngn!==30000) F('normalizer did not map line_items (sku/quantity/price)');

// 9) A website retail sale takes the sold pieces out of studio stock.
const pid=run("(getProducts().find(function(p){return (p.variants||[]).some(function(v){return (+v.qty||0)>0;});})||{}).id");
if(pid){const before=Number(run("productUnits(getProducts().find(function(p){return p.id==='"+pid+"';}))"));
  run("webDecrementStock('"+pid+"',2);");
  const after=Number(run("productUnits(getProducts().find(function(p){return p.id==='"+pid+"';}))"));
  if(after!==before-2) F('a website sale did not decrement studio stock ('+before+' → '+after+', expected −2)');
} else F('no stocked demo product to test stock decrement');

console.log('Website → Studio import audit:');
console.log('  routing: retail='+R.type+' bespoke='+B.type+' consultation='+C.type+' · online studio: '+onlineBranch);
console.log('  import: +'+first.added+' first run, +'+second.added+' on re-run (idempotent)');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ website orders map correctly, money is only counted when actually paid, and re-import never duplicates');
process.exit(fails.length?1:0);
