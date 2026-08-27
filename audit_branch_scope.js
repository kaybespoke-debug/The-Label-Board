// Branch scope gate — "no data is missed, and none is shown twice".
//
// A branch is an operational dimension, not a data silo. Three tiers:
// branch-owned records belong to one studio, company records belong to the
// label, and the catalogue is the label's while the stock on its shelves is
// each studio's. This gate holds all three to their word.
//
// It exists because the dashboard gates passed for months while the Shop, the
// Vendors list and the recurring bills showed every studio the same rows. The
// dashboard was scoped; nobody had ever checked a list screen. So the checks
// below are deliberately about the DATA, not about the pixels: a rendered row
// count can be fooled by an empty search box, but a partition cannot.
//
// The two invariants everything else hangs off:
//
//   partition   every branch-owned record appears in exactly ONE studio view.
//               Not zero (it would be invisible to its owner) and not two
//               (that is the leak Kayode reported).
//   completeness  every tab declares its scope in VIEW_SCOPE. A tab that does
//               not is a build failure, so a new screen cannot ship without
//               somebody deciding what it shows when studios are switched.
const fs=require('fs'),vm=require('vm');
const appPath=process.argv[2] || 'site/layi_dashboard.html';
const html=fs.readFileSync(appPath,'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,placeholder:'',textContent:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},requestAnimationFrame:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);
const names=run("getBranches().map(b=>b.name)");

/* 1) Nothing guesses. ---------------------------------------------------------
   branchOf() used to answer "no branch recorded" with the first branch in the
   list. That single fallback is what made one studio appear to hold everybody's
   data while a newly added studio showed nothing. */
if(run("branchOf({})")!=='')F('branchOf() still invents a branch for a record that has none: '+JSON.stringify(run("branchOf({})")));
if(run("branchOf({branch:'Abuja outlet'})")!=='Abuja outlet')F('branchOf() does not return the branch a record actually has');
if(run("staffBranch({})")!=='')F('staffBranch() still invents a studio for an unplaced person');
if(run("typeof branchOfOr")!=='function')F('branchOfOr() is missing, so stamping has nowhere to get a concrete name');
if(run("branchOfOr({},'Kano store')")!=='Kano store')F('branchOfOr() ignores the fallback it was given');

/* 2) Every tab has decided what it shows. ------------------------------------ */
const titles=run("Object.keys(TITLES)");
const scoped=run("VIEW_SCOPE");
const VALID=['branch','company','stock','person'];
titles.forEach(v=>{
  if(!scoped[v])F('the "'+v+'" tab does not say how it answers the studio switcher (add it to VIEW_SCOPE)');
  else if(VALID.indexOf(scoped[v])<0)F('the "'+v+'" tab declares an unknown scope: '+scoped[v]);
});
Object.keys(scoped).forEach(v=>{if(titles.indexOf(v)<0)F('VIEW_SCOPE names "'+v+'", which is not a tab');});

/* 3) Branch-owned records partition. ------------------------------------------
   Each record must appear in exactly one studio: never nowhere, never twice. */
const stores=run("BRANCH_OWNED_STORES");
stores.forEach(entry=>{
  const label=entry[0],getter=entry[1],key=entry[2];
  if(run("typeof "+getter)!=='function'){F('BRANCH_OWNED_STORES names '+getter+', which does not exist');return;}
  const total=run(getter+"().length");
  if(!total)return;
  const counts={};let seenTwice=0,seenNever=0;
  const ids=run(getter+"().map((r,i)=>r.id||('#'+i))");
  const seen={};
  names.forEach(n=>{
    run("activeBranchView="+JSON.stringify(n)+";");
    const pred=(key==='location')?'staffInView':'inBranch';
    const visible=run(getter+"().filter("+pred+").map((r,i)=>r.id||('#'+i))");
    counts[n]=visible.length;
    visible.forEach(id=>{seen[id]=(seen[id]||0)+1;});
  });
  ids.forEach(id=>{const c=seen[id]||0;if(c===0)seenNever++;else if(c>1)seenTwice++;});
  const sum=Object.keys(counts).reduce((a,k)=>a+counts[k],0);
  if(seenTwice)F(label+': '+seenTwice+' record(s) show in more than one studio — that is the leak');
  // A record can legitimately fail to land in any studio: it names one that was
  // closed, renamed by hand, or typed wrong on an import. Hiding it is how it
  // disappears, so the rule is not "never" but "never SILENTLY" — anything the
  // studio views cannot place must be named by recordsNeedingAStudio(), which
  // is what the Branches page reports to the owner.
  if(seenNever){
    const reported=run("recordsNeedingAStudio().length");
    if(!reported)F(label+': '+seenNever+' record(s) show in NO studio and nothing tells the owner they exist');
    else if(reported<seenNever)F(label+': '+seenNever+' record(s) show in no studio but only '+reported+' are reported as unplaced');
  }
  if(sum+seenNever!==total)F(label+': the studios add up to '+sum+' plus '+seenNever+' unplaced, but there are '+total+' records');
  // and a studio must not simply be shown everything
  if(names.length>1&&Object.keys(counts).every(k=>counts[k]===total))
    F(label+': every studio shows all '+total+' records — the screen is ignoring the studio switcher');
});

/* 4) Company records reach every studio. --------------------------------------
   The opposite failure: a supplier fenced into one outlet is a supplier the
   other outlets cannot use. */
const cstores=run("COMPANY_STORES");
cstores.forEach(entry=>{
  const label=entry[0],getter=entry[1];
  if(run("typeof "+getter)!=='function')return;
  const total=run(getter+"().length");
  if(!total)return;
  names.forEach(n=>{
    run("activeBranchView="+JSON.stringify(n)+";");
    const vis=run(getter+"().filter(inCompanyScope).length");
    if(vis!==total)F(label+': '+n+' sees '+vis+' of '+total+' — a company record is fenced off from a studio that has not been excluded');
  });
});
// but a company record MAY name the studios it applies to, and then it filters
run("activeBranchView='all';");
const one=names[0],two=names[1];
if(two){
  run("var _sp=getSuppliers();_sp[0].branches=["+JSON.stringify(two)+"];setSuppliers(_sp);");
  run("activeBranchView="+JSON.stringify(one)+";");
  const a=run("getSuppliers().filter(inCompanyScope).length");
  run("activeBranchView="+JSON.stringify(two)+";");
  const b=run("getSuppliers().filter(inCompanyScope).length");
  if(!(a<b))F('a company record that names one studio still shows in the others ('+a+' vs '+b+')');
  run("var _sp2=getSuppliers();delete _sp2[0].branches;setSuppliers(_sp2);activeBranchView='all';");
}

/* 5) The catalogue is the label's; the stock on the shelves is the studio's. -- */
if(run("typeof variantQty")!=='function')F('variantQty() is missing, so stock cannot be per studio');
else{
  run("activeBranchView='all';");
  const prods=run("getProducts().length");
  if(prods){
    // every studio sees the whole catalogue
    names.forEach(n=>{
      run("activeBranchView="+JSON.stringify(n)+";");
      const seen=run("getProducts().filter(inCompanyScope).length");
      if(seen!==prods)F('the catalogue is fenced off: '+n+' sees '+seen+' of '+prods+' styles');
    });
    // but the quantities differ, and add up
    run("activeBranchView='all';");
    const totalUnits=run("getProducts().reduce((s,p)=>s+productUnits(p,'all'),0)");
    let sum=0;
    names.forEach(n=>{sum+=run("getProducts().reduce((s,p)=>s+productUnits(p,"+JSON.stringify(n)+"),0)");});
    if(sum!==totalUnits)F('stock does not add up: the studios hold '+sum+' units but the label counts '+totalUnits);
    if(names.length>1){
      const perBranch=names.map(n=>run("getProducts().reduce((s,p)=>s+productUnits(p,"+JSON.stringify(n)+"),0)"));
      if(perBranch.every(x=>x===perBranch[0])&&perBranch[0]===totalUnits)
        F('every studio reports the label’s entire stock — the Shop is ignoring the studio switcher');
    }
    // A sale takes stock out of the studio that made it, and nowhere else.
    // The test piece is deliberately stocked in TWO studios: with stock in only
    // one, drawing from a shared pool and drawing from that studio look
    // identical, and the check passes while the bug is present.
    const bA=names[0],bB=names[1]||names[0];
    run("activeBranchView="+JSON.stringify(bA)+";");
    const pid=run("(getProducts().find(p=>p.variants&&p.variants.length)||{}).id");
    if(pid&&bB!==bA){
      run("var _pp=getProducts();var _p=_pp.find(x=>x.id==="+JSON.stringify(pid)+");var _v=_p.variants[0];setVariantQty(_v,"+JSON.stringify(bA)+",5);setVariantQty(_v,"+JSON.stringify(bB)+",7);_p.variants.slice(1).forEach(function(v){setVariantQty(v,"+JSON.stringify(bA)+",0);setVariantQty(v,"+JSON.stringify(bB)+",0);});setProducts(_pp);");
    }
    if(pid){
      const beforeA=run("productUnits(getProducts().find(p=>p.id==="+JSON.stringify(pid)+"),"+JSON.stringify(bA)+")");
      const beforeB=run("productUnits(getProducts().find(p=>p.id==="+JSON.stringify(pid)+"),"+JSON.stringify(bB)+")");
      run("webDecrementStock("+JSON.stringify(pid)+",1,"+JSON.stringify(bA)+");");
      const afterA=run("productUnits(getProducts().find(p=>p.id==="+JSON.stringify(pid)+"),"+JSON.stringify(bA)+")");
      const afterB=run("productUnits(getProducts().find(p=>p.id==="+JSON.stringify(pid)+"),"+JSON.stringify(bB)+")");
      if(afterA!==beforeA-1)F('a sale in '+bA+' did not come out of that studio’s stock ('+beforeA+' -> '+afterA+')');
      if(bB!==bA&&afterB!==beforeB)F('a sale in '+bA+' changed '+bB+'’s stock ('+beforeB+' -> '+afterB+')');
    }
  }
}

/* 6) Renaming a studio takes its records and its stock with it. ---------------
   A rename that leaves records behind is the same bug wearing a different hat:
   the records become invisible to everyone. */
if(names.length){
  const from=names[0],to='Renamed studio';
  const before=run("getOrders().filter(o=>o.branch==="+JSON.stringify(from)+").length");
  const stockBefore=run("getProducts().reduce((s,p)=>s+productUnits(p,"+JSON.stringify(from)+"),0)");
  run("var _b=getBranches();_b[0]={...(_b[0]),name:"+JSON.stringify(to)+"};SETTINGS.branches=_b;renameBranchRefs("+JSON.stringify(from)+","+JSON.stringify(to)+");");
  const after=run("getOrders().filter(o=>o.branch==="+JSON.stringify(to)+").length");
  const stockAfter=run("getProducts().reduce((s,p)=>s+productUnits(p,"+JSON.stringify(to)+"),0)");
  if(after!==before)F('renaming a studio orphaned its orders ('+before+' before, '+after+' after)');
  if(stockAfter!==stockBefore)F('renaming a studio emptied its shelves ('+stockBefore+' units before, '+stockAfter+' after)');
  const orphan=run("getOrders().filter(o=>o.branch==="+JSON.stringify(from)+").length");
  if(orphan)F(orphan+' order(s) still point at the old studio name after a rename');
}

/* 7) A studio added today starts empty, and stays empty until it trades. ------
   This is the check that would have caught what Kayode saw. */
run("activeBranchView='all';");
run("var _bn=getBranches().slice();_bn.push({id:'br-gate',name:'Brand new outlet',location:'',active:true,does:['bespoke'],channels:['showroom']});SETTINGS.branches=_bn;");
run("activeBranchView='Brand new outlet';");
[['orders','getOrders'],['txns','getTxns'],['supplies','getSupplies'],['bills','getBills']].forEach(entry=>{
  const n=run(entry[1]+"().filter(inBranch).length");
  if(n)F('a studio added a moment ago already shows '+n+' '+entry[0]+' it never traded');
});
const newUnits=run("getProducts().reduce((s,p)=>s+productUnits(p,'Brand new outlet'),0)");
if(newUnits)F('a studio added a moment ago already holds '+newUnits+' units of stock');
// ...but it can still see the label's catalogue and suppliers, or it cannot trade at all
const cat=run("getProducts().filter(inCompanyScope).length");
if(!cat)F('a new studio cannot see the catalogue, so it cannot sell anything');
const vend=run("getSuppliers().filter(inCompanyScope).length");
if(!vend)F('a new studio cannot see any vendors, so it cannot order anything');

/* 8) Nothing goes missing quietly. --------------------------------------------
   A record pointing at a studio that no longer exists is invisible in every
   studio view. That is allowed, because the alternative — showing a Lagos
   tailor on Kano's rota — is worse. What is not allowed is nobody being told. */
run("activeBranchView='all';");
{
  const before=run("recordsNeedingAStudio().length");
  run("var _s=getStaff();_s[0].location='Somewhere that closed';setStaff(_s);");
  const after=run("recordsNeedingAStudio().length");
  if(after<=before)F('a staff member was moved to a studio that does not exist and nothing noticed');
  // and the owner is actually shown it
  run("SETTINGS.branches=SETTINGS.branches;renderUnplacedNotice();");
  const shown=run("(document.getElementById('unplacedNotice')||{}).innerHTML")||'';
  if(!/not assigned to a studio/.test(shown))F('the Branches page does not tell the owner about unplaced records');
  if(!/Somewhere that closed/.test(shown))F('the notice does not say which studio the record is pointing at');
}

console.log('Branch scope audit:');
console.log('  studios: '+names.join(' · '));
console.log('  tabs declared: '+Object.keys(scoped).length+' of '+titles.length);
console.log('  branch-owned stores partitioned: '+stores.map(e=>e[0]).join(', '));
console.log('  company stores shared: '+cstores.map(e=>e[0]).join(', '));
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ every record in exactly one studio, the label’s records in all of them, stock per shelf');
