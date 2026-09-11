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
//   3. Nothing posts on the studio's behalf, and nothing here pretends to.
//      There was a "Ready to post" panel that wrote a caption for finished work
//      and handed it over to be pasted. Kayode took it out on 11 Sep: a nice
//      addition, not worth the time, and posting properly means Meta app review
//      and tokens that expire. This gate now holds it out: no social API, and
//      no half of the old panel left behind to break something on a tap.
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

/* 4) Nothing posts on the studio's behalf. ----------------------------------- */
// If this ever changes, it is a decision with an app review and a token
// refresh behind it, not something that should arrive quietly in a diff.
[/graph\.facebook\.com/i,/api\.instagram\.com/i,/api\.twitter\.com/i,/\/v\d+\/me\/media/i]
  .forEach(rx=>{if(rx.test(html))F('the app is calling a social platform API directly: '+rx);});

/* 5) The panel that was taken out left nothing behind. -----------------------
   This is the check that matters when a feature is pulled. A leftover onclick
   is invisible: the button draws, the tab renders, every other gate passes,
   and it throws the first time a studio taps it. Half a feature is worse than
   either having it or not. */
['postIdeas','postCaption','renderPostIdeas','openPostDraft','copyPostCaption','planThisPost',
 'markPosted','postedAt','postSub','Ready to post','SHARE_URL_TTL','finishedPhotoOf',
 'sharePhotoLink','_msgPhotoLink','_msgPhotoPending','_msgOpenFor','renderMsgHelper','{photo}']
  .forEach(n=>{if(html.indexOf(n)!==-1)
    F('"'+n+'" is still in the app after the post panel was removed, so half of it is left');});
// and the tab it lived on still works
run("renderMarketing();");
if(!run("(document.getElementById('mktSegments')||{}).innerHTML"))
  F('the Marketing tab draws nothing now the post panel is gone');

/* 6) The client message still works, and carries no link. --------------------
   Both ways out are asserted separately. Asking whether there is "some" way to
   send passes with either one broken, which is half the feature gone and a gate
   that says nothing. */
{
  // its own order and its own client, so nothing above is rewritten underneath
  run("var l=rawOrders();l.push({id:'MK-MSG',client:'Reachable Rotimi',createdAt:new Date().toISOString(),"
    +"garment:'Agbada',stageIndex:0,branch:defaultBranchName(),outfits:[],value:1,paid:0});save('layi_dash_orders',l);"
    +"var c=getCustomers();c['reachable rotimi']={name:'Reachable Rotimi',whatsapp:'+234 800 000 0003',"
    +"email:'rotimi@example.com',meas:{},measHistory:[]};setCustomers(c);");
  const id='MK-MSG';
  run("openMsgHelper("+JSON.stringify(id)+");");
  const modal=run("(document.getElementById('modal')||{}).innerHTML")||'';
  if(!modal)F('the message helper draws nothing');
  if(/Getting the link/.test(modal))F('the message helper is still waiting on a photo link');
  if(/\{photo\}/.test(modal))F('a client would be sent the word {photo}');
  if(!/wa\.me/.test(modal))F('the message helper no longer offers WhatsApp');
  if(!/mailto:/.test(modal))F('the message helper no longer offers email');
  run("closeModal();");
}

/* 7) Segments are scoped like everything else. ------------------------------- */
{
  const names=run("getBranches().map(b=>b.name)");
  if(names.length>1){
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
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ segments made of what the studio already recorded, no empty lists, nothing posts on its behalf, and the panel that was pulled left nothing behind');
