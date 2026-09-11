// Import / migrate gate.
// Six tolerant CSV importers bring data across from other software. Columns are matched by
// aliases; every importer is idempotent (matched records update, never duplicate); orders reuse
// the gate-tested importWebOrders() path and keep the deposit as money paid.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2] || 'site/layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},click(){},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Blob:function(){return {}},URL:{createObjectURL(){return 'blob:x'}},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);const J=e=>JSON.parse(run('JSON.stringify('+e+')'));
run("currentUser=getUsers().find(u=>u.roleId==='owner');");
let fails=[];const F=x=>fails.push(x);
// helper to apply a CSV string through an importer key, in-sandbox
function applyCsv(key,csv){run("_tImp=(function(){var rows=parseCSV("+JSON.stringify(csv)+");var head=rows[0].map(function(h){return String(h).trim().toLowerCase();});return impById('"+key+"').apply(rows,head);})();");return J("_tImp");}

// 0) Registry shape.
const imps=J("IMPORTERS.map(function(x){return {key:x.key,hue:x.hue,hasApply:typeof x.apply==='function',hasTpl:!!x.template,ico:!!IMP_ICO[x.key]};})");
if(imps.length!==6) F('expected 6 importers, found '+imps.length);
if(new Set(imps.map(i=>i.hue)).size!==6) F('importer accent hues are not all distinct');
imps.forEach(i=>{if(!i.hasApply)F(i.key+' has no apply()');if(!i.hasTpl)F(i.key+' has no template');if(!i.ico)F(i.key+' has no icon');});

// 1) Customers — add, then idempotent update, with measurements + phone mapped.
const cCsv='name,phone,email,chest,waist,note\n"Imp One",+234 111,one@x.com,38,31,VIP\n"Imp Two",+234 222,two@x.com,40,34,\n';
const c1=applyCsv('cust',cCsv);if(c1.added!==2)F('customer import should add 2 (got '+c1.added+')');
const c2=applyCsv('cust',cCsv);if(c2.added!==0||c2.updated!==2)F('re-importing customers must update not duplicate (got '+JSON.stringify(c2)+')');
const measOne=J("(function(){var c=getCustomers();return c[nameKey('Imp One')].meas;})()");
if(measOne['Chest / Bust']!=='38'||measOne['Waist']!=='31')F('customer measurement columns were not mapped (got '+JSON.stringify(measOne)+')');
const phoneOne=run("getCustomers()[nameKey('Imp One')].whatsapp");
if(phoneOne!=='+234 111')F('customer phone/whatsapp was not mapped');
if(!run("(function(){var c=getCustomers()[nameKey('Imp One')];return (c.measHistory||[]).length>0;})()"))F('a measurement history record was not saved on import');

// 2) Missing name column is rejected, not silently mis-imported.
const badName=applyCsv('cust','phone,email\n0803,x@y.com\n');
if(!badName.error)F('a customer file with no name column should return an error');

// 3) Suppliers — add + idempotent.
const s1=applyCsv('suppliers','name,type,phone,note\n"ABC Fabrics","Fabric Supplier",0803,lace\n');
if(s1.added!==1)F('supplier import should add 1');
if(!run("getSuppliers().some(function(s){return s.business==='ABC Fabrics'&&s.type==='Fabric Supplier';})"))F('supplier was not stored with mapped name & type');
const s2=applyCsv('suppliers','name,type,phone,note\n"ABC Fabrics","Fabric Supplier",0803,lace\n');
if(s2.added!==0||s2.updated!==1)F('re-importing suppliers must update not duplicate');

// 4) Stock — add with qty; re-import updates same row.
const k1=applyCsv('stock','item,category,quantity,unit,cost\n"Blue Ankara","Fabric",10,yards,2500\n');
if(k1.added!==1)F('stock import should add 1');
if(!run("getSupplies().some(function(s){return s.name==='Blue Ankara'&&Number(s.qty)===10&&Number(s.cost)===2500;})"))F('stock item not stored with mapped qty & cost');
const k2=applyCsv('stock','item,category,quantity,unit,cost\n"Blue Ankara","Fabric",25,yards,2500\n');
if(k2.updated!==1||k2.added!==0)F('re-importing the same stock item must update not duplicate');

// 5) Staff — owner can import; record is well-formed.
const st1=applyCsv('staff','name,role,phone,salary,start date\n"F. Adeyemi","Senior Tailor",0802,120000,2024-03-01\n');
if(st1.added!==1)F('staff import should add 1 (got '+JSON.stringify(st1)+')');
if(!run("getStaff().some(function(s){return s.name==='F. Adeyemi'&&Number(s.basic)===120000&&s.salaryType==='Monthly Salary'&&s.active===true;})"))F('staff record not well-formed after import');

// 6) Finances — identical rows dedupe.
const f1=applyCsv('fin','date,type,amount,category,note\n2025-01-15,income,50000,sales,Deposit\n2025-01-15,income,50000,sales,Deposit\n');
if(f1.added!==1||f1.dup!==1)F('finance import must skip duplicate rows (got '+JSON.stringify(f1)+')');
if(!run("getTxns().some(function(t){return t.dir==='in'&&Number(t.amount)===50000&&t.label==='Deposit';})"))F('finance row not stored with mapped direction & amount');

// 7) Orders — safe path, deposit kept as paid, idempotent.
const oCsv='client,item,price,deposit,due date,status,date\n"Imp One","Agbada set",85000,40000,2025-02-20,partial,2025-01-30\n';
const o1=applyCsv('orders',oCsv);if(o1.added!==1)F('order import should add 1 (got '+JSON.stringify(o1)+')');
const ord=J("getOrders().filter(function(o){return String(o.id).indexOf('web-csv-')===0;})[0]");
if(!ord)F('imported order not created via the safe web path');
else{if(Number(ord.value)!==85000)F('imported order value wrong');if(Number(ord.paid)!==40000)F('imported order deposit not kept as money paid (got '+ord.paid+')');}
const o2=applyCsv('orders',oCsv);if(o2.added!==0)F('re-importing an order must not duplicate (got '+JSON.stringify(o2)+')');

// 8) The migrate screen builds all six cards.
run("_impState={};renderImpCards();");
const cardsHtml=(cache['impCards']&&cache['impCards'].innerHTML)||'';
const cardCount=(cardsHtml.match(/imp-card/g)||[]).length;
if(cardCount<6)F('the import screen did not render 6 cards (got '+cardCount+')');
if(cardsHtml.indexOf('Customers &amp; measurements')<0&&cardsHtml.indexOf('Customers & measurements')<0)F('import cards missing the customers title');

/* Every record an importer makes has to be able to tell itself apart from the others.
   uid() used to be Date.now() plus three random base-36 characters: 46,656 values inside
   one millisecond, which is a birthday problem, not a margin. A 200-row import collided
   32% of the time. It matters because every edit, delete and lookup in this app is
   list.find(x => x.id === id), which returns the FIRST match, so a shared id means editing
   one record edits the other and deleting one deletes the other. It is also how the same
   payment could appear in two studios at once, which the branch-scope gate caught about
   once in twenty-five runs and nobody could reproduce.

   A burst here is deliberately larger than any real import, run several times, because the
   failure was probabilistic and a single small sample is how it hid for so long. */
[[200,'a 200-row CSV import'],[1200,'the biggest burst the counter is meant to cover']].forEach(function(cse){
  const n=cse[0];
  for(let attempt=0;attempt<25;attempt++){
    const ids=run("(function(){var a=[];for(var i=0;i<"+n+";i++)a.push(uid('t'));return a;})()");
    const dup=ids.length-new Set(ids).size;
    if(dup){F(cse[1]+' produced '+dup+' duplicate id(s); every edit and delete finds the wrong record');break;}
  }
});
// ids from different record types must never be confused for one another either
const mixed=run("(function(){var a=[];for(var i=0;i<300;i++){a.push(uid('t'));a.push(uid('o'));}return a;})()");
if(mixed.length!==new Set(mixed).size)F('two different kinds of record were given the same id');
if(!run("uid('t')").indexOf('t-')===0)F('an id no longer says what kind of record it is');

console.log('Import / migrate audit:');
console.log('  importers: '+imps.map(i=>i.key).join(', '));
console.log('  customers: +'+c1.added+' new, re-run updated '+c2.updated+'; order deposit kept: '+(ord?ord.paid:'n/a'));
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ six tolerant importers, alias column-matching, idempotent upserts, orders keep the deposit, and the screen builds all six cards');
process.exit(fails.length?1:0);
