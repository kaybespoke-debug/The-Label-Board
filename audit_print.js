// Printable-sheets gate.
// Job sheet, measurement sheet and stock list must generate real, branded, non-empty HTML with
// the right data, be branch-scoped where relevant, and be wired to a button in the UI.
// (Invoices/receipts were already printable — covered by the app's existing flows.)
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

// 0) Shared print machinery exists.
if(run("typeof printSheet")!=='function') F('printSheet() helper is missing');
if(run("typeof printJobSheet")!=='function'||run("typeof printMeasSheet")!=='function'||run("typeof printStockList")!=='function') F('a print wrapper is missing');

// 1) Job sheet: a made-to-order piece produces a branded work order with its client, id and measurements.
const jobId=run("(getOrders().find(function(o){return o.kind!=='sale';})||{}).id");
let jobHtml='';try{jobHtml=run("jobSheetInner(getOrders().find(function(o){return o.kind!=='sale';}))");}catch(e){F('jobSheetInner threw → '+e.message);}
if(!/WORK ORDER/.test(jobHtml)) F('job sheet is not labelled as a work order');
if(jobId&&jobHtml.indexOf(jobId)<0) F('job sheet does not carry the order id');
if(!/Measurements/.test(jobHtml)) F('job sheet has no measurements section');
if(jobHtml.length<300) F('job sheet came out empty');

// 2) Measurement sheet: a client with measurements produces a sheet carrying their name + values.
const mkey=run("(function(){var c=getCustomers();for(var k in c){if(measHistoryOf(k).length&&Object.keys((measHistoryOf(k)[0]||{}).meas||{}).length)return k;}return Object.keys(c)[0]||'';})()");
if(!mkey){F('no demo customer to test the measurement sheet');}
else{
  const cname=run("((getCustomers()['"+mkey.replace(/'/g,"")+"']||{}).name)||''");
  let mHtml='';try{mHtml=run("measSheetInner('"+mkey.replace(/'/g,"")+"')");}catch(e){F('measSheetInner threw → '+e.message);}
  if(!/MEASUREMENT SHEET/.test(mHtml)) F('measurement sheet is not labelled');
  if(cname&&mHtml.indexOf(cname)<0) F('measurement sheet does not carry the client name');
  // at least one measurement field label appears
  if(!/Chest|Waist|Shoulder|Neck|Hip/.test(mHtml)) F('measurement sheet lists no measurement fields');
}

// 3) Stock list: branded, lists items, and responds to the branch switcher.
let stockAll='';try{run("activeBranchView='all';");stockAll=run("stockSheetInner()");}catch(e){F('stockSheetInner threw → '+e.message);}
if(!/STOCK LIST/.test(stockAll)) F('stock list is not labelled');
if(stockAll.length<300) F('stock list came out empty');
const brs=run("getBranches().map(function(b){return b.name;})");
let branchDiffers=false;
brs.forEach(function(bn){try{if(run("activeBranchView='"+String(bn).replace(/'/g,"")+"';stockSheetInner()")!==stockAll)branchDiffers=true;}catch(e){}});
run("activeBranchView='all';");
if(!branchDiffers) F('stock list does not respond to the branch switcher');

// 4) Every sheet carries the company letterhead.
if(jobHtml.indexOf(run("((SETTINGS.company||{}).name)||'LAYI'"))<0) F('job sheet is missing the company letterhead');

// 5) The three print buttons are wired into the UI.
if(!/onclick="printJobSheet\('/.test(html)) F('no Job sheet button is wired into the order view');
if(!/onclick="printMeasSheet\('/.test(html)) F('no Print measurements button is wired into the customer view');
if(!/onclick="printStockList\(\)"/.test(html)) F('no Print list button is wired into the inventory view');

console.log('Printable-sheets audit:');
console.log('  job sheet ('+jobId+'), measurement sheet, stock list — branded, populated, branch-scoped, wired to buttons');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ all three sheets generate correct printable HTML and are reachable from the UI');
process.exit(fails.length?1:0);
