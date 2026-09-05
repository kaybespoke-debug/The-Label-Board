// Plan / tier gate.
//
// Four rules decide what a plan may gate, and every one of them is a way of
// getting this wrong that costs a customer:
//
//   1. Tier on SCALE first: studios, seats, storage. Never the production
//      board, never Finance, never recording a payment. A solo tailor and a
//      four-studio label get the same product.
//
//      There is exactly ONE capability axis, PLAN_FEATURES, and today it holds
//      exactly one key. Basic and Pro are sold on a real difference — "Basic
//      shows you who owes you and lets you invoice them; Pro chases them down"
//      — and pretending otherwise would make Pro a size upgrade nobody needs.
//      So the split is drawn at the narrowest place that is honest: Basic sees
//      the entire receivables picture, the chase list included, and can invoice
//      any of it. It cannot SEND the reminder. One verb.
//
//      Every key added to PLAN_FEATURES is something the product no longer
//      simply does. This gate holds the line at what is declared, and section
//      10 checks the read-only half genuinely stays readable — a "read-only"
//      tier that quietly hides the numbers is just a hidden tier.
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
// will only find at the till. Unlimited is 0 and beats any number; an
// invoice-only plan quotes no price, so it is exempt from the price ladder and
// must instead be the last plan, where "priced for your business" belongs.
const UNL=run("PLAN_UNLIMITED");
const asc=run("PLANS.filter(p=>p.id!=='trial')");
const atLeast=(a,b)=>a===UNL||(b!==UNL&&a>=b);
const more=(a,b)=>a===UNL?b!==UNL:(b!==UNL&&a>b);
for(let i=1;i<asc.length;i++){
  const p=asc[i],q=asc[i-1];
  if(!p.invoiceOnly&&!q.invoiceOnly&&p.monthly<=q.monthly)F(p.id+' does not cost more than '+q.id);
  if(q.invoiceOnly)F(q.id+' is invoice-only but is not the last plan, so a priced plan sits above one with no price');
  if(!atLeast(p.seats,q.seats))F(p.id+' gives fewer seats than '+q.id);
  if(!atLeast(p.storageGb,q.storageGb))F(p.id+' gives less storage than '+q.id);
}
// Pro is the full product, so it must hold every capability, and Basic must be
// genuinely cheaper than it — the whole reason the feature split exists.
{
  const P=run("PLANS"),by={};P.forEach(p=>by[p.id]=p);
  const keys=Object.keys(run("PLAN_FEATURES"));
  keys.forEach(k=>{
    if((by.pro.features||[]).indexOf(k)<0)F('Pro is sold as the full product but does not include '+k);
    if((by.premium.features||[]).indexOf(k)<0)F('Bespoke is sold as everything in Pro but does not include '+k);
    if((by.trial.features||[]).indexOf(k)<0)F('the trial is sold as everything in Pro but does not include '+k);
  });
  if(!keys.some(k=>(by.starter.features||[]).indexOf(k)<0))
    F('Basic includes every capability, so the plans differ only in size and the sell line is untrue');
  // Unlimited seats mean storage is the only thing left protecting margin.
  if(by.pro.seats!==UNL)F('Pro is sold with unlimited staff but still counts seats');
  if(!(by.pro.storageGb>0)||by.pro.storageGb>=by.premium.storageGb)
    F('Pro has no meaningful storage ceiling, and with seats unlimited it is the only limit left');
}

/* 2) The app and the console agree on what a plan costs. --------------------- */
// The console is what actually bills, so if these ever drift, the customer is
// quoted one price in the product and charged another.
try{
  const consoleSrc=fs.readFileSync('admin/js/data.js','utf8');
  const block=(consoleSrc.match(/const PLANS = \[[\s\S]*?\n\]/)||[''])[0];
  run("PLANS").filter(p=>p.id!=='trial').forEach(p=>{
    const re2=new RegExp("id: '"+p.id+"'[\\s\\S]{0,200}?monthly: (\\d+)");
    const mm=block.match(re2);
    if(!mm){F('the console has no "'+p.id+'" plan, so the app is quoting a plan nobody can be billed for');return;}
    // An invoice-only plan quotes no price in either place; what it is worth is
    // typed by an operator per business when they move a studio onto it.
    if(!p.invoiceOnly&&Number(mm[1])!==p.monthly)
      F('the app quotes '+p.id+' at '+p.monthly+' but the console bills '+mm[1]);
    const invRe=new RegExp("id: '"+p.id+"'[\\s\\S]{0,260}?invoiceOnly: true");
    const consoleInvoiceOnly=invRe.test(block);
    if(!!p.invoiceOnly!==consoleInvoiceOnly)
      F(p.id+' is invoice-only in one place and priced in the other, so a studio is quoted a number nobody meant to charge');
    const seatRe=new RegExp("id: '"+p.id+"'[\\s\\S]{0,240}?seats: (\\d+)");
    const sm=block.match(seatRe);
    if(sm&&Number(sm[1])!==p.seats)
      F('the app says '+p.id+' includes '+p.seats+' seats but the console says '+sm[1]);
    // The name is what the customer is sold; the id is what the database stores.
    const nameRe=new RegExp("id: '"+p.id+"', name: '([^']+)'");
    const nm=block.match(nameRe);
    if(nm&&nm[1]!==p.name)
      F('the app calls '+p.id+' "'+p.name+'" and the console calls it "'+nm[1]+'"');
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
  if(stopped!==true)F('a Basic studio with four outlets was allowed to add a fifth');
  const msg=alerts.join(' ');
  if(!/Basic/.test(msg))F('the limit message does not say which plan they are on');
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

/* 10) The one capability split, drawn where it was promised. ------------------
   "Basic shows you who owes you and lets you invoice them. Pro chases them
   down." Which makes the read-only half the part worth testing hardest: a
   tier that says read-only and then shows a blank page is a hidden tier
   wearing a nicer word. */
{
  run("SETTINGS.plan='pro';currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
  // the fixture has to contain somebody who owes, or none of this proves anything
  const owed=run("getOrders().filter(o=>o.kind!=='sale'&&inBranch(o)&&orderOutstanding(o)>0).length");
  if(!owed)F('no order in the example data has a balance outstanding, so the chase list cannot be tested at all');

  const readChase=()=>{run("closeModal();openChaseList();");return run("(document.getElementById('modal')||{}).innerHTML")||'';};

  const proHtml=readChase();
  if(!/wa\.me\//.test(proHtml))F('Pro cannot send a reminder from the chase list, which is the thing Pro is sold on');

  run("SETTINGS.plan='starter';");
  if(run("canReceivables()")!==true)F('a Basic owner cannot see receivables at all, so "read-only" is really "hidden"');
  if(run("planIncludes('chase')")!==false)F('Basic includes chasing, so there is no difference to sell');
  if(run("canChase()")!==false)F('canChase() is true on Basic');

  const basicHtml=readChase();
  if(!basicHtml)F('the chase list does not open on Basic');
  if(/wa\.me\//.test(basicHtml))F('Basic can still send a WhatsApp reminder straight from the chase list');
  if(!/featureStop\('chase'\)/.test(basicHtml))F('the Chase button on Basic does nothing and says nothing, instead of naming what it costs');
  // the read-only half must genuinely be readable: the same names, the same
  // money, the same overdue counts Pro sees
  if(!/outstanding/.test(basicHtml))F('Basic is not shown the total it is owed');
  if(!/Record payment/.test(basicHtml))F('Basic cannot record a payment against a balance, which is not a chase and must never be gated');
  {
    const strip=s=>s.replace(/wa\.me\/[^"]*/g,'').replace(/featureStop\('chase'\)/g,'').replace(/href="[^"]*"/g,'');
    if(strip(basicHtml).replace(/<button[^>]*>Chase<\/button>/g,'')!==strip(proHtml).replace(/<a[^>]*>Chase<\/a>/g,''))
      F('the chase list shows Basic different figures from Pro; only the send button may differ');
  }

  // the reminder template, and the automatic seam that will send it at go-live
  const readMsg=()=>{const id=run("getOrders().filter(o=>o.kind!=='sale'&&orderOutstanding(o)>0)[0].id");
    run("closeModal();openMsgHelper('"+id+"');");return run("(document.getElementById('modal')||{}).innerHTML")||'';};
  const basicMsg=readMsg();
  if(!/Order confirmed/.test(basicMsg)||!/Ready for collection/.test(basicMsg))
    F('Basic lost the order-confirmed and ready messages, which are how a studio runs and are on every plan');
  if(/reminder that a balance/i.test(basicMsg))F('Basic is still handed a ready-to-send payment reminder');
  run("SETTINGS.plan='pro';");
  if(!/reminder that a balance/i.test(readMsg()))F('Pro is not given the payment reminder template');
  if(!/waOnEvent\(kind,o\)\{try\{if\(kind==='reminder'&&!planIncludes\('chase'\)\)return;/.test(html))
    F('the automatic WhatsApp seam does not check the plan, so switching the sender on at go-live hands every Basic studio automated chasing');

  // and the nudge has to be worth reading
  run("SETTINGS.plan='starter';");alerts=[];
  if(run("featureStop('chase')")!==true)F('featureStop did not stop a Basic studio');
  const fmsg=alerts.join(' ');
  if(!/Basic/.test(fmsg))F('the feature nudge does not say which plan they are on');
  if(!/Pro/.test(fmsg))F('the feature nudge does not name the plan that includes it');
  if(!/₦/.test(fmsg))F('the feature nudge does not say what it costs');
  if(!/Nothing you already have/.test(fmsg))F('the feature nudge does not reassure them their data is safe');
  if(run("featureStop('chase')")===true&&run("SETTINGS.plan='pro';featureStop('chase')")!==false)
    F('featureStop still stops a plan that includes the feature');
  run("closeModal();SETTINGS.plan='pro';");
}

console.log('Plan / tier audit:');
console.log('  plans: '+run("PLANS.map(p=>p.name+' '+(p.invoiceOnly?'(invoiced per business)':(p.monthly?('\\u20a6'+p.monthly):'free'))+' \\u00b7 '+(p.seats===PLAN_UNLIMITED?'unlimited seats':p.seats+' seats')+' \\u00b7 '+p.storageGb+'GB').join('\\n         ')"));
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ scale only, nothing hidden when over, the console agrees on the price, and the limit says what more costs');
