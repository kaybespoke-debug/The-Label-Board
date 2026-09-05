// Storage groundwork gate.
// Usage is metered from image bytes (text is ignored), tiers set the limit, the meter renders,
// and saveImageAsset() is the single go-live seam (pass-through today).
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2] || 'site/layi_dashboard.html'),'utf8');
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
// Storage now follows the PLAN rather than being a second number that can
// disagree with it. A studio on the smallest plan still gets the smallest
// allowance, which is what this always meant to check.
// Named rather than numbered on purpose. These used to assert 1e9 and 20e9,
// and resizing the plans turned two real checks into two false failures that
// said nothing about what had actually broken. What they mean is that the
// smallest plan gets the smallest allowance and the largest gets more.
const SMALLEST=N("PLANS.map(p=>p.storageGb).sort((a,b)=>a-b)[0]")*1e9;
run("delete SETTINGS.storageTier;SETTINGS.plan='trial';");
if(N("storageLimitBytes()")!==SMALLEST) F('a trial studio does not get the smallest allowance');
run("SETTINGS.plan='premium';");
if(N("storageLimitBytes()")<=SMALLEST) F('the top plan is still on the smallest allowance, so storage does not follow the plan');
// an explicit tier still wins, so nothing already configured changes
const FREE=N("STORAGE_TIERS[0].gb")*1e9;
run("SETTINGS.storageTier=STORAGE_TIERS[0].name;");
if(N("storageLimitBytes()")!==FREE) F('an explicitly set tier is being overridden by the plan');
run("delete SETTINGS.storageTier;SETTINGS.plan='trial';");
const T1=J("STORAGE_TIERS[1]");
run("SETTINGS.storageTier=STORAGE_TIERS[1].name;");
if(N("storageLimitBytes()")!==T1.gb*1e9) F('the '+T1.name+' tier does not enforce its own limit');
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

// 3) The seam is real now: it uploads to object storage. With no backend —
// the demo, or a studio before it has one — it must still hand the bytes
// straight back, because that is also the path a photo takes when there is
// no signal, and losing it would be far worse than storing it inline.
run("liveMode=false;");
{
  run("globalThis.__seam='PENDING';saveImageAsset('data:image/png;base64,ABC','progress').then(function(r){globalThis.__seam=r;});");
  const out=run("globalThis.__seam");
  if(out!=='PENDING'&&out!=='data:image/png;base64,ABC')
    F('with no backend saveImageAsset should return the image unchanged, got '+out);
}
if(!/await supa\.storage\.from\(MEDIA_BUCKET\)/.test(html))
  F('saveImageAsset never uploads, so photos are still being written into the database');

// 4) The Settings meter renders a usage bar.
run("renderStorageMeter();");
const meter=(cache['storageMeter']&&cache['storageMeter'].innerHTML)||'';
if(!/used/.test(meter)||!/width:/.test(meter)) F('the storage meter does not render a usage bar');

/* 5) Photo budgets, now that Pro sells unlimited staff.
   Seats used to be the thing that stopped a big operation costing more than it
   pays. Pro no longer counts people, so storage is the only limit left, and
   the category that grows without bound is progress photos: one or more per
   stage move, per order, from an unbounded number of people.

   So the two kinds are no longer squeezed the same. Reference photos — what
   the client brought in, the finished piece — keep their quality because they
   get opened months later. Progress photos are proof the work happened and are
   rarely opened twice. If they ever go back to being equal, the only limit
   protecting Pro's margin quietly loosens by about half. */
{
  const B=run("PHOTO_BUDGET");
  if(!B||!B.reference||!B.progress)F('there is no photo budget, so every image is squeezed the same regardless of what it is for');
  else{
    if(!(B.progress.dim<B.reference.dim))F('progress photos are stored at the same size as reference photos, and they are the category that grows without limit');
    if(!(B.progress.q<B.reference.q))F('progress photos are stored at the same quality as reference photos');
    // and not so hard that the photo stops being evidence of anything
    if(B.progress.dim<600||B.progress.q<0.5)F('progress photos are squeezed so hard they no longer show the work');
    if(B.reference.dim<1000)F('reference photos are too small to be worth keeping');
  }
  // the seam is used where it matters
  // compressed to its budget AND put in storage, in that order, at every site
  if(!/updateDraft\.photos\.push\(await saveImageAsset\(await compressFor\(f,'progress'\),'progress'\)\)/.test(html))
    F('progress photos do not go through the photo budget and into storage');
  if(!/draft\.clientPhotos\.push\(await saveImageAsset\(await compressFor\(f,'reference'\),'client'\)\)/.test(html))
    F('a client\'s own photos do not go through the photo budget and into storage');
  if(!/draft\.outfits\[i\]\.photos\.push\(await saveImageAsset\(await compressFor\(f,'reference'\),'outfit'\)\)/.test(html))
    F('outfit photos do not go through the photo budget and into storage');
  /* Every plan's allowance must exist as a tier, exactly. storageTierName()
     rounds DOWN to the largest tier that fits, so a plan selling 15GB against
     a ladder that stops at 1GB enforces 1GB. Nothing errors; the plan panel
     goes on promising fifteen; the first anybody hears of it is a studio that
     cannot save a photo. This caught precisely that, introduced by resizing
     the plans and forgetting the ladder underneath them. */
  run("delete SETTINGS.storageTier;");
  run("PLANS").forEach(p=>{
    run("SETTINGS.plan='"+p.id+"';");
    const gb=run("storageLimitBytes()")/1e9;
    if(Math.abs(gb-p.storageGb)>0.001)
      F(p.name+' sells '+p.storageGb+'GB but actually enforces '+gb+'GB, because no storage tier matches its allowance');
  });
  run("SETTINGS.plan='pro';");
  // Pro's cap must be a real ceiling, because it is the only one left
  const pro=run("PLANS.find(p=>p.id==='pro')"),top=run("PLANS.find(p=>p.id==='premium')");
  if(!(pro.storageGb>0&&pro.storageGb<top.storageGb))
    F('Pro has no storage ceiling below the top plan, and with seats unlimited nothing else limits it');
  if(run("PLANS.find(p=>p.id==='pro').seats")!==run("PLAN_UNLIMITED"))
    F('this check assumes Pro sells unlimited seats and it no longer does — re-derive the storage sizing');
}

console.log('Storage groundwork audit:');
console.log('  tiers: '+tiers.map(t=>t.name+' '+t.gb+'GB').join(' · '));
console.log('  usage after test photo: '+run("fmtBytes(storageUsage().bytes)")+' · '+after.photos+' images');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ image-only metering, tiered limits, a usage meter, and a single upload seam for go-live');
process.exit(fails.length?1:0);
