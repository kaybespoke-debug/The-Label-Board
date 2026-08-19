// Owner-pay (director allocation) gate.
// The owner can be paid five ways, set once globally and inherited by new orders:
//   pctProfit · pctValue · perOrder · perOutfit · salary (monthly cost, no per-order cut).
// Each basis must compute correctly, stay capped to the order's profit, and salary must post
// exactly one monthly cost (idempotent).
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);const N=e=>Number(run(e));const J=e=>JSON.parse(run('JSON.stringify('+e+')'));
run("currentUser=getUsers().find(u=>u.roleId==='owner');");
run("renderAll=function(){};"); // isolate save side-effects
let fails=[];const F=x=>fails.push(x);

// A test order with a healthy margin so no basis hits the profit cap.
run("__O={outfits:[{type:'Kaftan',name:'Kaftan',price:100000},{type:'Agbada',name:'Agbada',price:200000}],value:300000,discount:0,costs:[{label:'Fabric',amount:60000}],commissions:[],currency:'NGN',fx:1,directorOn:true};");
const op=N("orderOperatingProfit(__O)");
const netbase=N("orderNetBase(__O)");
if(!(op>0)) F('test order has no operating profit to allocate from');

// pctProfit
run("__O.directorBasis='pctProfit';__O.directorPct=25;__O.directorAmount=null;");
const daProfit=N("directorAllocation(__O)");
if(Math.abs(daProfit-Math.min(Math.round(op*0.25),Math.max(0,op)))>1) F('% of profit basis is wrong (got '+daProfit+')');

// pctValue
run("__O.directorBasis='pctValue';__O.directorPct=15;__O.directorAmount=null;");
const daValue=N("directorAllocation(__O)");
if(Math.abs(daValue-Math.min(Math.round(netbase*0.15),Math.max(0,op)))>1) F('% of order value basis is wrong (got '+daValue+')');

// perOrder
run("__O.directorBasis='perOrder';__O.directorAmount=50000;");
const daOrder=N("directorAllocation(__O)");
if(Math.abs(daOrder-Math.min(50000,Math.max(0,op)))>1) F('fixed per order basis is wrong (got '+daOrder+')');

// perOutfit
run("__O.directorBasis='perOutfit';__O.directorOutfitAmt=20000;__O.directorAmount=null;");
const daOutfit=N("directorAllocation(__O)");
if(Math.abs(daOutfit-Math.min(40000,Math.max(0,op)))>1) F('fixed per outfit basis is wrong (2 outfits × 20k, got '+daOutfit+')');

// salary → no per-order cut
run("__O.directorBasis='salary';");
if(N("directorAllocation(__O)")!==0) F('salary basis must take no per-order cut');

// the bases genuinely differ
if(daProfit===daValue||daValue===daOrder||daOrder===daOutfit) F('two owner-pay bases produced identical results — they are not really distinct');

// New orders inherit the global basis.
run("SETTINGS.ownerPay={basis:'pctValue',pct:12,amount:0};");
const seeded=J("seedOwnerPay({outfits:[{price:1}],directorOn:true})");
if(seeded.directorBasis!=='pctValue'||+seeded.directorPct!==12) F('a new order did not inherit the global % of value basis');
run("SETTINGS.ownerPay={basis:'salary',amount:100000};");
const seededSal=J("seedOwnerPay({directorOn:true})");
if(seededSal.directorBasis!=='salary'||seededSal.directorOn!==false) F('a new order on salary basis should carry no per-order director cut');

// Salary posts exactly one monthly cost, idempotently.
run("SETTINGS.ownerPay={basis:'salary',amount:100000};");
const before=N("getTxns().filter(t=>t.cat==='ownerSalary').length");
run("ensureOwnerSalary();ensureOwnerSalary();");
const after=N("getTxns().filter(t=>t.cat==='ownerSalary').length");
if(after!==before+1) F('owner salary did not post exactly one monthly cost (idempotency broken): '+before+' -> '+after);
if(N("getTxns().filter(t=>t.cat==='ownerSalary').filter(t=>t.dir==='out').length")<1) F('owner salary is not recorded as a cost (dir:out)');
// no salary when a different basis is chosen
run("SETTINGS.ownerPay={basis:'pctProfit',pct:25,amount:0};");
const c1=N("getTxns().filter(t=>t.cat==='ownerSalary').length");run("ensureOwnerSalary();");
if(N("getTxns().filter(t=>t.cat==='ownerSalary').length")!==c1) F('owner salary posted while the basis was not salary');

// The Settings control saves the basis + value.
sb.document.getElementById('op_basis').value='perOrder';sb.document.getElementById('op_val').value='75000';
run("saveOwnerPay();");
let opv=J("SETTINGS.ownerPay");
if(opv.basis!=='perOrder'||+opv.amount!==75000) F('Settings did not save the fixed-per-order owner pay');
sb.document.getElementById('op_basis').value='pctValue';sb.document.getElementById('op_val').value='20';
run("saveOwnerPay();");
opv=J("SETTINGS.ownerPay");
if(opv.basis!=='pctValue'||+opv.pct!==20) F('Settings did not save the % of value owner pay');

console.log('Owner-pay audit:');
console.log('  op='+op+' · profit25='+daProfit+' value15='+daValue+' perOrder='+daOrder+' perOutfit='+daOutfit+' salary=0');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ all five owner-pay bases compute correctly, new orders inherit the default, and salary posts one monthly cost');
process.exit(fails.length?1:0);
