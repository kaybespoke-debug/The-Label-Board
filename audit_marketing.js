// Marketing gate — "market with what you already know".
//
// Subscribers told Kayode the app does not help them get customers. The
// Marketing tab counted contacts and nothing else: reachable customers, email
// contacts, WhatsApp contacts, campaigns sent. All outbound, all to people the
// studio already knew, and none of it using anything the studio had recorded.
//
// The cheapest useful answer is not a storefront or a directory. It is that
// the studio's best marketing asset is already in the app: who bought what,
// when they last ordered, and photographs of finished work. This gate holds
// that answer to three rules:
//
//   1. Every segment is made of data the studio already has. No new form to
//      fill in, no list to maintain by hand.
//   2. A segment nobody can be reached in is not offered. A row that goes
//      nowhere costs a tap and teaches somebody the tab is useless.
//   3. Nothing posts on the studio's behalf. Auto-posting means Meta app
//      review, tokens that expire, and a breakage every few months for a
//      feature nobody asked to be automatic. We write the caption and hand it
//      over — the same shape as the WhatsApp hand-off that already works.
const fs=require('fs'),vm=require('vm');
const appPath=process.argv[2] || 'site/layi_dashboard.html';
const html=fs.readFileSync(appPath,'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const cache={};const _ls={};
const mkEl=(id)=>({_id:id,innerHTML:'',value:'',checked:false,textContent:'',placeholder:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){},select(){}});
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl(i))},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl(),execCommand(){return true;}},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},requestAnimationFrame:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},prompt(){return '2';},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

/* Fixtures first. Empty segments are deliberately not offered, so a check that
   asks whether the seasonal segment EXISTS has to run against data that would
   put somebody in it. Seeding after that check is how a gate ends up testing
   the filter instead of the feature. */
{
  const yr=new Date(Date.now()-365*864e5).toISOString();
  const wk=new Date(Date.now()-7*864e5).toISOString();
  run("var l=rawOrders();"
    +"l.push({id:'MK-SEASON',client:'Seasonal Sade',createdAt:"+JSON.stringify(yr)+",garment:'Aso-oke gown',stageIndex:0,branch:defaultBranchName(),outfits:[],value:100000,paid:0});"
    +"l.push({id:'MK-FRESH',client:'Fresh Femi',createdAt:"+JSON.stringify(wk)+",garment:'Aso-oke gown',stageIndex:0,branch:defaultBranchName(),outfits:[],value:100000,paid:0});"
    +"save('layi_dash_orders',l);"
    +"var c=getCustomers();c['seasonal sade']={name:'Seasonal Sade',whatsapp:'+234 800 000 0001',email:'',meas:{},measHistory:[]};"
    +"c['fresh femi']={name:'Fresh Femi',whatsapp:'+234 800 000 0002',email:'',meas:{},measHistory:[]};setCustomers(c);");
}


/* 1) The segments that use what the studio recorded. -------------------------
   The generic ones (all / email / whatsapp) were always here. These three are
   the ones made of order history, and they are the reason to open the tab. */
const segs=run("marketingSegments().map(s=>s.key)");
['season','quiet6'].forEach(k=>{
  if(segs.indexOf(k)<0)F('there is no "'+k+'" segment, so the tab still ignores when people last ordered');
});
if(!segs.some(k=>String(k).indexOf('item:')===0))
  F('no segment is built from WHAT people bought, which is the studio’s best list');

/* 2) No segment is offered that nobody can be reached in. -------------------- */
run("marketingSegments()").forEach(s=>{
  // 'All reachable' is the baseline the campaign screen starts from and is kept
  // whatever; every other segment must have somebody in it.
  if(s.key!=='all'&&(!s.list||!s.list.length))F('the "'+s.name+'" segment is empty and still being offered');
  (s.list||[]).forEach(c=>{
    if(!c.email&&!c.whatsapp)
      F('the "'+s.name+'" segment contains somebody with no email and no WhatsApp, so they cannot be reached');
  });
});

/* 3) "This time last year" means what it says. ------------------------------- */
{
  // an order placed twelve months ago should put its client in the seasonal
  // list; one placed last week should not
  const season=run("(marketingSegments().find(s=>s.key==='season')||{list:[]}).list.map(c=>c.name)");
  if(season.indexOf('Seasonal Sade')<0)
    F('somebody who ordered twelve months ago is not in the "this time last year" list');
  if(season.indexOf('Fresh Femi')>=0)
    F('somebody who ordered last week is in the "this time last year" list');

  const quiet=run("(marketingSegments().find(s=>s.key==='quiet6')||{list:[]}).list.map(c=>c.name)");
  if(quiet.indexOf('Seasonal Sade')<0)
    F('somebody last seen a year ago is not in the six-month list');
  if(quiet.indexOf('Fresh Femi')>=0)
    F('somebody who ordered last week is in the six-month list');
}

/* 4) Finished work with photos becomes something to post. -------------------- */
const ideas=run("postIdeas()");
if(!ideas.length)F('no finished work is offered to post, so the panel is dead on arrival');
ideas.forEach(x=>{
  if(!x.photos||!x.photos.length)F('an order with no photos is being offered as a post');
});
// unfinished work must not be offered: posting a garment that is still on the
// bench is how a studio promises something it has not delivered
{
  run("var l=rawOrders();l.push({id:'MK-WIP',client:'Work In Progress',createdAt:new Date().toISOString(),"
    +"garment:'Half-made kaftan',stageIndex:1,branch:defaultBranchName(),outfits:[],value:1,paid:0,"
    +"clientPhotos:['data:image/png;base64,AAAA']});save('layi_dash_orders',l);");
  if(run("postIdeas().some(x=>x.id==='MK-WIP')"))
    F('an order still in production is being offered as finished work to post');
}

/* 5) The caption is usable, and does not name the client. -------------------- */
{
  const cap=run("postCaption(postIdeas()[0])");
  if(!cap||cap.length<30)F('the generated caption is too thin to be worth copying');
  const client=run("postIdeas()[0].client");
  if(client&&cap.indexOf(client)>=0)
    F('the caption names the client, which posts a customer’s name without asking them');
  if(cap.indexOf(run("(SETTINGS.company&&SETTINGS.company.name)||tenantName()"))<0)
    F('the caption does not name the studio, so it markets nobody');
}

/* 6) Nothing posts on the studio's behalf. ----------------------------------- */
// If this ever changes, it is a decision with an app review and a token
// refresh behind it, not something that should arrive quietly in a diff.
[/graph\.facebook\.com/i,/api\.instagram\.com/i,/api\.twitter\.com/i,/\/v\d+\/me\/media/i]
  .forEach(rx=>{if(rx.test(html))F('the app is calling a social platform API directly: '+rx);});
if(!/Nothing here posts on your behalf/.test(html))
  F('the post screen does not tell the studio it has to post it themselves');

/* 7) A planned post lands in the calendar as content, with the caption. ------ */
{
  run("setPlanner([]);");
  const id=run("postIdeas()[0].id");
  run("openPostDraft("+JSON.stringify(id)+");planThisPost("+JSON.stringify(id)+");");
  const list=run("getPlanner()");
  if(list.length!==1)F('planning a post did not create a calendar entry');
  else{
    const e=list[0];
    if(e.type!=='content')F('a planned post went into the calendar as "'+e.type+'" rather than content');
    if(!e.notes||e.notes.length<20)F('the planned post did not carry the caption, so it has to be written again');
    if(!e.date)F('the planned post has no date');
    if(e.branch!==run("defaultBranchName()")&&run("activeBranchView")==='all')
      F('the planned post was not attributed to a studio');
  }
}

/* 8) It is scoped like everything else. -------------------------------------- */
{
  const names=run("getBranches().map(b=>b.name)");
  if(names.length>1){
    run("activeBranchView='all';");
    const all=run("postIdeas().length");
    run("activeBranchView="+JSON.stringify(names[1])+";");
    const one=run("postIdeas().length");
    if(one>all)F('a single studio is offered more work to post than the whole business has');
    run("activeBranchView='all';");
    const segAll=run("marketingSegments().find(s=>s.key==='all').list.length");
    run("activeBranchView="+JSON.stringify(names[1])+";");
    const segOne=run("marketingSegments().find(s=>s.key==='all').list.length");
    if(segOne>segAll)F('a single studio has more marketable customers than the whole business');
    run("activeBranchView='all';");
  }
}

console.log('Marketing audit:');
console.log('  segments: '+run("marketingSegments().map(s=>s.name).join(' \\u00b7 ')"));
console.log('  ready to post: '+ideas.length);
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ segments made of what the studio already recorded, no empty lists, and nothing posts on its behalf');
