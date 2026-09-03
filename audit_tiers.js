// Plan / tier gate.
//
// Four rules decide what a plan may gate, and every one of them is a way of
// getting this wrong that costs a customer:
//
//   1. Tier on SCALE, never on whether the product works. Studios, seats and
//      storage. Never the production board, never Finance, never recording a
//      payment. A solo tailor and a four-studio label get the same product.
//
//   2. Progressive disclosure is not a plan. teamToolsOn() hides Team and
//      Payroll from a one-person shop because they do not need them yet, and
//      reveals them on the second hire. Putting a paywall there would charge a
//      studio at the exact moment it grows.
//
//   3. Being over a limit never hides what is already there. A studio dropping
//      from Pro to Starter keeps its three studios and all its data. It simply
//      cannot add a fourth.
//
//   4. It is a nudge, not a control. This runs in the customer's browser.
//      Anybody determined can edit it. Plan limits are commercial; the boundary
//      that matters is tenant isolation, and the database enforces that.
//
// And one consistency rule: the app's numbers must match the operator
// console's PLANS, because the console is what actually bills.
const fs=require('fs'),vm=require('vm');
const appPath=process.argv[2] || 'site/layi_dashboard.html';
const html=fs.readFileSync(appPath,'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const cache={};const _ls={};
const mkEl=(id)=>({_id:id,innerHTML:'',value:'',checked:false,textContent:'',placeholder:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
let alerts=[];
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl(i))},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},requestAnimationFrame:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(m){alerts.push(String(m));},confirm(){return true},prompt(){return '2';},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

/* 1) The plans exist, and say what they include. ----------------------------- */
const plans=run("PLANS.map(p=>p.id)");
['trial','starter','pro','premium'].forEach(id=>{
  if(plans.indexOf(id)<0)F('there is no "'+id+'" plan');
});
run("PLANS").forEach(p=>{
  if(typeof p.studios!=='number')F(p.id+' does not say how many studios it includes');
  if(typeof p.seats!=='number')F(p.id+' does not say how many team seats it includes');
  if(typeof p.storageGb!=='number')F(p.id+' does not say how much storage it includes');
});
// they must climb: a more expensive plan that gives you less is a bug somebody
// will only find at the till
const asc=run("PLANS.filter(p=>p.id!=='trial')");
for(let i=1;i<asc.length;i++){
  if(asc[i].monthly<=asc[i-1].monthly)F(asc[i].id+' does not cost more than '+asc[i-1].id);
  if(asc[i].seats<=asc[i-1].seats)F(asc[i].id+' gives no more seats than '+asc[i-1].id);
}

/* 2) The app and the console agree on what a plan costs. --------------------- */
// The console is what actually bills, so if these ever drift, the customer is
// quoted one price in the product and charged another.
try{
  const consoleSrc=fs.readFileSync('admin/js/data.js','utf8');
  const block=(consoleSrc.match(/const PLANS = \[[\s\S]*?\n\]/)||[''])[0];
  run("PLANS").filter(p=>p.monthly>0).forEach(p=>{
    const re2=new RegExp("id: '"+p.id+"'[\\s\\S]{0,120}?monthly: (\\d+)");
    const mm=block.match(re2);
    if(!mm){F('the console has no "'+p.id+'" plan, so the app is quoting a plan nobody can be billed for');return;}
    if(Number(mm[1])!==p.monthly)
      F('the app quotes '+p.id+' at '+p.monthly+' but the console bills '+mm[1]);
    const seatRe=new RegExp("id: '"+p.id+"'[\\s\\S]{0,160}?seats: (\\d+)");
    const sm=block.match(seatRe);
    if(sm&&Number(sm[1])!==p.seats)
      F('the app says '+p.id+' includes '+p.seats+' seats but the console says '+sm[1]);
  });
}catch(e){F('could not read the console plans to compare: '+e.message);}

/* 3) A plan gates SCALE only. ------------------------------------------------ */
// Nothing that makes the product work may depend on the plan. If any of these
// ever start reading currentPlan(), somebody has put a paywall in front of a
// studio doing its job.
const GATED_BY_PLAN=/currentPlan\(\)|planStop\(|planHasRoom\(/g;
[['renderProduction','the production board'],['renderFinance','Finance'],
 ['savePayment','recording a payment'],['saveOrder','creating an order'],
 ['renderSales','Sales'],['renderSupplies','Inventory'],
 ['teamToolsOn','progressive disclosure']].forEach(pair=>{
  const at=html.indexOf('function '+pair[0]+'(');
  if(at<0)return;
  let i=at,depth=0,end=html.length;
  // walk to the next top-level function as a cheap body boundary
  const nxt=html.indexOf('\nfunction ',at+1);
  if(nxt>0)end=nxt;
  const body=html.slice(at,end);
  if(GATED_BY_PLAN.test(body))F(pair[1]+' is gated by the plan, which charges a studio for doing its job');
  GATED_BY_PLAN.lastIndex=0;
});

/* 4) Being over the limit hides nothing. ------------------------------------- */
{
  run("SETTINGS.plan='starter';");   // 1 studio, but the example has four
  const before=run("getBranches().length");
  run("applyBizVisibility();renderAll();");
  const after=run("getBranches().length");
  if(after!==before)F('dropping to a smaller plan removed studios the business already had');
  const names=run("branchNames().length");
  if(names!==before)F('a studio over its plan can no longer see all its studios in the switcher');
  const orders=run("getOrders().length");
  if(!orders)F('going over the plan hid the orders');
  // and every tab still renders
  ['renderFinance','renderProduction','renderSupplies'].forEach(f=>{
    let threw='';try{run(f+"();");}catch(e){threw=e.message;}
    if(threw)F(f+' threw when the studio was over its plan: '+threw);
  });
}

/* 5) But it does stop you adding more, and says what it would cost. ---------- */
{
  run("SETTINGS.plan='starter';");
  alerts=[];
  const stopped=run("planStop('studios','studios')");
  if(stopped!==true)F('a Starter studio with four outlets was allowed to add a fifth');
  const msg=alerts.join(' ');
  if(!/Starter/.test(msg))F('the limit message does not say which plan they are on');
  if(!/Pro/.test(msg))F('the limit message does not name the plan that would give them more');
  if(!/₦|month/.test(msg))F('the limit message does not say what more would cost');
  if(!/Nothing you already have/.test(msg))F('the limit message does not reassure them their data is safe');

  // on the biggest plan, studios are unlimited and nothing stops
  run("SETTINGS.plan='premium';");
  if(run("planStop('studios','studios')")!==false)F('an unlimited plan is still blocking new studios');
  if(run("planHasRoom('studios')")!==true)F('planHasRoom says an unlimited plan is full');
}

/* 6) Editing somebody who already exists is never blocked. ------------------- */
if(!/if\(!id&&planStop\('seats'/.test(html))
  F('editing an existing team account is blocked by the seat limit, which punishes a studio for being over rather than for adding');

/* 7) A studio already running four outlets is not put on Starter. ------------ */
{
  const fit=run("smallestPlanFitting(4,12).id");
  if(fit!=='premium')F('a four-studio, twelve-account business was inferred as '+fit);
  if(run("smallestPlanFitting(1,1).id")!=='trial')F('a brand new one-person studio was not put on trial');
  if(run("smallestPlanFitting(1,5).id")!=='pro')F('a one-studio business with five accounts was inferred as '+run("smallestPlanFitting(1,5).id"));
  // and the inference runs once, then leaves the plan alone
  run("SETTINGS.plan='starter';ensurePlan();");
  if(run("SETTINGS.plan")!=='starter')F('ensurePlan() overwrote a plan the studio is actually paying for');
}

/* 8) Storage follows the plan, so there is one number, not two. -------------- */
{
  run("delete SETTINGS.storageTier;SETTINGS.plan='trial';");
  const small=run("storageLimitBytes()");
  run("SETTINGS.plan='premium';");
  const big=run("storageLimitBytes()");
  if(!(big>small))F('storage does not grow with the plan');
  run("SETTINGS.storageTier='Free';");
  if(run("storageLimitBytes()")!==small)F('an explicitly chosen storage tier is overridden by the plan');
  run("delete SETTINGS.storageTier;");
}

/* 9) The owner can see where they stand. ------------------------------------- */
{
  run("SETTINGS.plan='pro';renderPlanPanel();");
  const box=run("(document.getElementById('planBox')||{}).innerHTML")||'';
  if(!box)F('there is nowhere for a studio to see what plan it is on');
  if(!/Pro/.test(box))F('the plan panel does not name the plan');
  if(!/Studios/.test(box)||!/Team accounts/.test(box))F('the plan panel does not show usage against the limits');
  if(!/never hides anything/.test(box))F('the plan panel does not tell them going over is safe');
}

console.log('Plan / tier audit:');
console.log('  plans: '+run("PLANS.map(p=>p.name+' '+(p.monthly?('\\u20a6'+p.monthly):'free')).join(' \\u00b7 ')"));
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ scale only, nothing hidden when over, the console agrees on the price, and the limit says what more costs');
