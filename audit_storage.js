// Storage groundwork gate.
// Usage is metered from image bytes (text is ignored), tiers set the limit, the meter renders,
// and saveImageAsset() is the single go-live seam (pass-through today).
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);const N=e=>Number(run(e));const J=e=>JSON.parse(run('JSON.stringify('+e+')'));
run("currentUser=getUsers().find(u=>u.roleId==='owner');");
let fails=[];const F=x=>fails.push(x);

// 1) Tiers exist with a Free entry, and the limit tracks the chosen tier.
const tiers=J("STORAGE_TIERS");
if(!Array.isArray(tiers)||tiers.length<4) F('storage tiers are missing');
if(!tiers.some(t=>t.name==='Free')) F('there is no Free tier');
run("delete SETTINGS.storageTier;");
if(N("storageLimitBytes()")!==1e9) F('default (Free) limit should be 1 GB');
run("SETTINGS.storageTier='Studio';");
if(N("storageLimitBytes()")!==20e9) F('Studio tier limit should be 20 GB');
run("delete SETTINGS.storageTier;");

// 2) Usage counts image bytes only — adding a photo raises bytes AND the image count.
const before=J("storageUsage()");
run("var c=getCustomers();var k=Object.keys(c)[0];c[k].photos=(c[k].photos||[]).concat(['data:image/png;base64,'+new Array(4001).join('A')]);setCustomers(c);");
const after=J("storageUsage()");
if(!(after.bytes>before.bytes)) F('adding a photo did not increase measured storage');
if(after.photos!==before.photos+1) F('image count did not rise by one');
// text-only changes must NOT count as storage
const b2=J("storageUsage()");
run("var c=getCustomers();var k=Object.keys(c)[0];c[k].note='a much longer note that is pure text and should not count toward image storage at all';setCustomers(c);");
if(J("storageUsage()").bytes!==b2.bytes) F('a text change changed the storage figure — only photos should count');

// 3) The go-live seam is a pass-through today.
if(run("saveImageAsset('data:image/png;base64,ABC')")!=='data:image/png;base64,ABC') F('saveImageAsset should return the image unchanged until go-live');

// 4) The Settings meter renders a usage bar.
run("renderStorageMeter();");
const meter=(cache['storageMeter']&&cache['storageMeter'].innerHTML)||'';
if(!/used/.test(meter)||!/width:/.test(meter)) F('the storage meter does not render a usage bar');

console.log('Storage groundwork audit:');
console.log('  tiers: '+tiers.map(t=>t.name+' '+t.gb+'GB').join(' · '));
console.log('  usage after test photo: '+run("fmtBytes(storageUsage().bytes)")+' · '+after.photos+' images');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ image-only metering, tiered limits, a usage meter, and a single upload seam for go-live');
process.exit(fails.length?1:0);
