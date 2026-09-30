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

/* ===================================================================================
   HISTORY IS NOT WORK, 30 September

   Four bugs, found by audit and fixed before October's studios start importing. Three of
   them share a shape: the importer wrote a record that looked live, and every other part
   of the app believed it.

     - an order delivered in 2024 arrived at the first production stage, so it sat on the
       board as work, in the chase list, and overdue against a date long gone
     - its deposit was written onto the order and never became a transaction, and the
       headline money figures in this app are CASH basis, so a studio importing three
       years of history got correct balances and an empty revenue chart
     - "unpaid" contains "paid", and the test was not anchored, so a row the studio had
       explicitly marked unpaid came in paid in full

   The fourth was a lookup reading fields nothing wrote. All four are asserted here, at
   the level that matters: not that the code says the right words, but that a file with
   real statuses in it produces the right records, the right money and the right silence.
   =================================================================================== */
{
const HCSV=[
 'client,item,price,deposit,status,stage,date,ref',
 '"Hist A","Agbada",85000,85000,paid,delivered,2024-02-20,HA-1',
 '"Hist B","Kaftan",60000,20000,partial,cutting,2024-06-11,HA-2',
 '"Hist C","Gele",15000,0,unpaid,,2025-01-05,HA-3',
 '"Hist D","Two piece",120000,50000,partial,"wibble",2025-03-09,HA-4'
].join('\n');
const hres=run("(function(){var r=parseCSV("+JSON.stringify(HCSV)+");return impById('orders').apply(r,r[0]);})()");
const H=id=>run("JSON.stringify(getOrders().find(function(o){return o.id==='web-"+id+"';})||null)");
const ord=id=>{const j=H(id);return j==='null'?null:JSON.parse(j);};

// --- the flag is real, not a word in a notes field
['HA-1','HA-2','HA-3','HA-4'].forEach(function(id){
  const o=ord(id);
  if(!o)F('imported order '+id+' was not created');
  else if(o.historical!==true)F('imported order '+id+' carries no historical flag, so every screen treats it as live work');
});
if(run("typeof isHistorical")!=='function')F('there is no way to ask whether a record is history');

// --- status becomes a stage, and an unknown one says so instead of guessing quietly
{const a=ord('HA-1'),b=ord('HA-2'),c=ord('HA-3'),d=ord('HA-4');
 const at=i=>run("STAGES["+i+"]");
 if(a&&at(a.stageIndex)!=='Delivered')F('a delivered order was not filed as delivered (got '+at(a.stageIndex)+')');
 if(b&&at(b.stageIndex)!=='Cutting')F('an in-progress status did not map to its stage (got '+(b?at(b.stageIndex):'?')+')');
 if(c&&(+c.stageIndex||0)!==0)F('a blank status did not stay at the first stage');
 if(d&&(+d.stageIndex||0)!==0)F('an unrecognised status did not stay at the first stage');
 if(!(hres.unknownStatuses||[]).length)F('an unrecognised status was swallowed; the owner is never told which rows to fix');
 else if(hres.unknownStatuses.indexOf('wibble')<0)F('the unrecognised status reported is not the one in the file: '+JSON.stringify(hres.unknownStatuses));
 // a payment word in the status column is money, not a stage
 if(run("importStageFor('paid').known")!==false)F('\"paid\" is being read as a production stage');
 if(run("importStageFor('delivered').index")!==run("STAGES.indexOf('Delivered')"))F('delivered does not map to Delivered');
}

// --- "unpaid" is not "paid"
{const c=ord('HA-3');
 if(c&&(+c.paid||0)!==0)F('an order the studio marked unpaid was imported as paid '+c.paid+'; \"unpaid\" contains \"paid\" and the test was not anchored');
 const a=ord('HA-1');
 if(a&&(+a.paid||0)!==85000)F('an order marked paid did not come in paid');
 const b=ord('HA-2');
 if(b&&(+b.paid||0)!==20000)F('a part payment was not kept (got '+(b?b.paid:'?')+')');
}

// --- delivered and settled goes to finished orders, not the board
if((hres.toFinished||0)<1)F('a delivered, fully paid import did not reach finished orders');
if(run("prodOrders().filter(function(o){return isHistorical(o);}).length")!==0)
  F('history is on the production board, which is the bench being handed years of finished work');
if(run("chaseOrders().filter(function(o){return isHistorical(o);}).length")!==0)
  F('history is in the chase list, so a client will be rung about a job they collected in 2024');
if(run("getOrders().filter(function(o){return isHistorical(o)&&orderAttention(o)!==null;}).length")!==0)
  F('history is raising attention, so it reads as late or failed');
// and no message can leave about one, whatever calls it
if(!/function waOnEvent\(kind,o\)\{try\{[^}]*isHistorical\(o\)\)return;/.test(html))
  F('the WhatsApp seam does not refuse a historical record, so a client can be messaged about an old job');

// --- the money reaches the books, at its own date
{/* scoped to this file's own refs: an earlier case in this gate imports an order too */
 const tx=JSON.parse(run("JSON.stringify(getTxns().filter(function(t){return t.historical&&/^web-HA-/.test(t.importRef||'');}))"));
 if(tx.length!==3)F('expected 3 payments from 4 imported orders (one has no deposit), got '+tx.length);
 const a=tx.find(t=>t.importRef==='web-HA-1');
 if(!a)F('a paid imported order created no payment, so its money never reaches Revenue');
 else{
   if(String(a.at).slice(0,10)!=='2024-02-20')F('an imported payment is dated when the file was uploaded, not when the money arrived (got '+String(a.at).slice(0,10)+')');
   if(+a.amount!==85000)F('an imported payment has the wrong amount');
   if(a.dir!=='in')F('an imported payment is not money in');
   if(a.channel!=='Imported')F('an imported payment is not tagged as imported (got '+a.channel+')');
 }
 if(tx.some(t=>t.importRef==='web-HA-3'))F('an unpaid order created a payment out of nothing');
 if(run("IN_CHANNELS.indexOf('Imported')")<0)F('Imported is not a channel the Money In hub knows, so the money lands under Other');
 if(!(hres.revenueByYear&&hres.revenueByYear['2024']))F('the summary does not say how much money each year gained');
}

// --- re-running changes nothing at all
{const before=run("getTxns().length"),bo=run("getOrders().length");
 const again=run("(function(){var r=parseCSV("+JSON.stringify(HCSV)+");return impById('orders').apply(r,r[0]);})()");
 if(again.added!==0)F('re-importing the same orders added '+again.added+' again');
 if(again.txns!==0)F('re-importing created '+again.txns+' duplicate payment(s)');
 if(run("getTxns().length")!==before)F('re-importing changed the number of transactions');
 if(run("getOrders().length")!==bo)F('re-importing changed the number of orders');
}

// --- the finances file warns rather than silently doubling the same money
if(run("typeof importedMoneyOverlap")!=='function')F('nothing checks whether a finances file is re-adding money the orders file already brought in');
else{const ov=JSON.parse(run("JSON.stringify(importedMoneyOverlap('2024-01-01','2025-12-31'))"));
 if(!ov.count)F('the overlap check cannot see payments the orders file created');
 const fcsv='date,type,amount,note\n2024-02-20,income,85000,"Hist A deposit"\n';
 const fres=run("(function(){var r=parseCSV("+JSON.stringify('date,type,amount,note\n2024-02-20,income,85000,"Hist A deposit"\n')+");return impById('fin').apply(r,r[0]);})()");
 if(!fres.overlap||!fres.overlap.count)F('importing finances over the same period said nothing about the money already there');
}

// --- the summary tells the owner all of it
{const html2=run("importSummaryHTML("+JSON.stringify(hres)+")");
 [['Filed as history','how much was filed as history'],['finished orders','what went to finished orders'],
  ['Left on the board','what stayed on the board'],['Payments recorded','how many payments were created'],
  ['Money added, 2024','what each year gained'],['not recognised','which statuses it could not place']]
  .forEach(function(pair){if(html2.indexOf(pair[0])<0)F('the post-import summary does not say '+pair[1]);});}
}

/* --- A spreadsheet is a file a studio actually has ---------------------------------- */
if(!/accept="[^"]*\.xlsx/.test(html))F('the import picker still refuses an Excel file while the screen says it accepts one');
['loadSheetJS','sheetToRows','isSpreadsheetName','impRowsReady'].forEach(function(fn){
  if(run('typeof '+fn)!=='function')F('spreadsheet import is missing '+fn+'()');
});
if(run("isSpreadsheetName('books.xlsx')")!==true||run("isSpreadsheetName('books.csv')")!==false)
  F('a spreadsheet is not told apart from a CSV by its name');
// every importer offers a template to start from
imps.forEach(function(i){if(!i.hasTpl)F(i.key+' has no downloadable template');});

/* --- A code that matches, and a name when there is no code -------------------------- */
if(run("blankVariant().sku")!=='')F('a new size/colour cannot carry a code');
if(!/id="pp_sku"/.test(html))F('the product editor has no SKU field, while the website matcher reads one');
{run("setProducts([{id:'p-sku',name:'Linen Shirt',category:'Shirt',sku:'LIN-01',price:1000,cost:400,variants:[{id:'v1',size:'M',color:'Blue',qty:5,sku:'LIN-01-M'}],active:true}]);");
 run("clearWebUnmatched();");
 if(run("webDecrementStock('LIN-01-M',1,'all')")!==true)F('a variant SKU does not match, and that is the field the matcher was always reading');
 if(run("webDecrementStock('LIN-01',1,'all')")!==true)F('a product SKU does not match');
 // the fallback: no code on the line, only the name
 if(run("webDecrementStock('',1,'all',{name:'Linen Shirt'})")!==true)F('a line with no code does not fall back to matching on the product name');
 // and what it cannot place is recorded rather than dropped
 run("clearWebUnmatched();webDecrementStock('NOPE-99',1,'all',{name:'Not a product'});");
 if(run("webUnmatchedLines().length")!==1)F('a website line that matched nothing was dropped silently');
 else if(run("webUnmatchedLines()[0].reason")!=='no product matched')F('an unmatched line does not say why');
}

/* ===================================================================================
   WHAT TO DO WITH AN IMPORTED BALANCE, 30 September

   An imported balance is one of three things and only the owner knows which: still owed,
   settled in cash years ago and never written down, or never coming. The app guesses
   none of them. It shows the money, chases nobody, and offers the three answers.
   =================================================================================== */
{
const RCSV=[
 'client,item,price,deposit,status,stage,date,ref',
 '"Rev A","Agbada",100000,100000,paid,delivered,2024-01-10,RV-1',
 '"Rev B","Kaftan",150000,90000,partial,collected,2024-05-02,RV-2',
 '"Rev C","Gele",80000,10000,partial,cutting,2024-09-09,RV-3'
].join('\n');
run("(function(){var r=parseCSV("+JSON.stringify(RCSV)+");return impById('orders').apply(r,r[0]);})()");
const g=id=>{const j=run("JSON.stringify(getOrders().find(function(o){return o.id==='web-"+id+"';})||null)");return j==='null'?null:JSON.parse(j);};

/* --- delivered history is finished work, balance or no balance ------------------- */
{const b=g('RV-2');
 if(!b)F('the review fixture did not import');
 else{
   if(run("STAGES["+b.stageIndex+"]")!=='Delivered')F('a collected order did not map to Delivered');
   if(run("orderIsSettled(getOrders().find(function(o){return o.id==='web-RV-2';}))")!==true)
     F('a delivered imported order with a balance is still on the live side; delivered history is finished work');
 }
 // and the balance is still counted, because load() merges both halves back
 const owed=run("getOrders().filter(function(o){return o.id==='web-RV-2';}).reduce(function(n,o){return n+orderOutstanding(o);},0)");
 if(owed!==60000)F('the balance on a finished imported order stopped being owed (got '+owed+')');
 // a LIVE order that is delivered and still owed for must NOT be archived; that rule stands
 const deli=run("STAGES.indexOf('Delivered')");
 if(run("orderIsSettled({stageIndex:"+deli+",value:1000,paid:0,outfits:[{price:1000}]})")!==false)
   F('a live delivered order that is still owed for is being archived, which stops it syncing');
}

/* --- nothing is chased until somebody says so ------------------------------------- */
if(run("typeof historyToReview")!=='function')F('there is no group for imported balances waiting on a decision');
if(run("historyToReview().length")<2)F('imported balances are not reaching the review group');
if(run("chaseOrders().filter(function(o){return isHistorical(o);}).length")!==0)
  F('an imported balance is being chased before anybody chose to chase it');
['reviewChase','reviewSettled','reviewWriteOff','openHistoryReview'].forEach(function(fn){
  if(run('typeof '+fn)!=='function')F('the review group is missing '+fn+'()');
});

/* --- Chase: it joins the ordinary list, and only it ------------------------------- */
{const before=run("chaseOrders().length");
 run("reviewChase('web-RV-3');");
 if(run("chaseOrders().length")!==before+1)F('choosing to chase an imported balance did not add it to the chase list');
 if(run("chaseOrders().filter(function(o){return o.id==='web-RV-3';}).length")!==1)F('the wrong order joined the chase list');
 if(run("historyToReview().filter(function(o){return o.id==='web-RV-3';}).length")!==0)F('a balance that is now being chased is still waiting on a decision');
 if(!run("getOrders().find(function(o){return o.id==='web-RV-3';}).historical"))F('choosing to chase stopped it being history, so it is back on the production board');
 if(run("prodOrders().filter(function(o){return o.id==='web-RV-3';}).length")!==0)F('a chased imported balance went onto the production board');
}

/* --- Mark settled: a payment today, not one invented into a closed year ----------- */
{const owedBefore=run("orderOutstanding(getOrders().find(function(o){return o.id==='web-RV-2';}))");
 const nBefore=run("getTxns().length");
 run("reviewSettled('web-RV-2');");
 if(run("getTxns().length")!==nBefore+1)F('marking an imported balance settled recorded no payment');
 const t=JSON.parse(run("JSON.stringify(getTxns()[getTxns().length-1])"));
 if(t.dir!=='in')F('a settled balance was not recorded as money in');
 if(+t.amount!==owedBefore)F('the settling payment is not the amount that was owed');
 if(String(t.at).slice(0,10)!==new Date().toISOString().slice(0,10))
   F('the settling payment was backdated into a year the studio has already closed');
 if(!/settled/i.test(String(t.note||'')+String(t.label||'')))F('the settling payment does not say what it is');
 if(run("orderOutstanding(getOrders().find(function(o){return o.id==='web-RV-2';}))")!==0)
   F('a balance marked settled is still owed');
}

/* --- Write off: a loss in the expenses, and nowhere near revenue ------------------ */
{run("(function(){var r=parseCSV('client,item,price,deposit,status,date,ref\\n\"Rev D\",\"Suit\",200000,0,unpaid,2024-03-03,RV-4');return impById('orders').apply(r,r[0]);})()");
 const owed=run("orderOutstanding(getOrders().find(function(o){return o.id==='web-RV-4';}))");
 if(owed!==200000)F('the write-off fixture did not import with a balance (got '+owed+')');
 const inBefore=run("getTxns().filter(function(t){return t.dir==='in';}).reduce(function(n,t){return n+(+t.amount||0);},0)");
 run("reviewWriteOff('web-RV-4');");
 const t=JSON.parse(run("JSON.stringify(getTxns()[getTxns().length-1])"));
 if(t.dir!=='out')F('a write-off was not recorded as money out');
 if(+t.amount!==owed)F('the write-off is not the amount that was owed');
 if(!/bad debt/i.test(String(t.category||'')+String(t.cat||'')))F('a write-off is not categorised as a bad debt');
 const inAfter=run("getTxns().filter(function(t){return t.dir==='in';}).reduce(function(n,t){return n+(+t.amount||0);},0)");
 if(inAfter!==inBefore)F('writing off a debt changed revenue; it is a loss, not a negative sale');
 if(run("orderOutstanding(getOrders().find(function(o){return o.id==='web-RV-4';}))")!==0)
   F('a written-off balance is still being counted as owed');
 if(run("getOrders().find(function(o){return o.id==='web-RV-4';}).paid")>0)
   F('a write-off was recorded as though the client had paid');
}
}

/* --- The spreadsheet reader is pinned, checked, and says so when it cannot load --- */
if(!/xlsx@0\.18\.5\/dist\/xlsx\.full\.min\.js/.test(html))
  F('the spreadsheet reader is not pinned to an exact version, so the CDN decides what this app runs');
if(!/sc\.integrity='sha384-/.test(html))
  F('the spreadsheet reader is loaded without an integrity hash, so a changed file on the CDN would run unchallenged');
if(!/sc\.crossOrigin='anonymous'/.test(html))
  F('integrity cannot be checked without crossOrigin, so the hash is decoration');
if(!/st\.blocked/.test(html))
  F('a spreadsheet that cannot be read leaves the screen saying nothing');

console.log('Import / migrate audit:');
console.log('  importers: '+imps.map(i=>i.key).join(', '));
console.log('  customers: +'+c1.added+' new, re-run updated '+c2.updated+'; order deposit kept: '+(ord?ord.paid:'n/a'));
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ six tolerant importers, alias column-matching, idempotent upserts, orders keep the deposit, and the screen builds all six cards');
process.exit(fails.length?1:0);
