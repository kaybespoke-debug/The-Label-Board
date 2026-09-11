// Multi-trade gate.
// The Label Board is sold to bespoke tailors, ready-to-wear makers, shoe makers, bag and
// leather workers and fabric sellers. The website says so. This gate makes sure the app
// agrees: every one of those businesses can be set up, gets production stages written in
// its own words, gets the right measurements, and is called the right thing.
//
// What a studio does is now two answers, not one. CRAFT is what it works in and decides
// wording, measurements, stages and quality control. MODE is how the piece reaches the
// customer and decides which tabs open. They used to be one tick, and the edges were
// wrong: 'bespoke' was a craft named after a mode, 'rtw' was a mode named as a craft, and
// footwear and leather had their mode hardcoded. So this gate checks both halves, checks
// that neither decides the other, and checks that every studio already on a device comes
// through the change with the tabs it had yesterday.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2] || 'site/layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,placeholder:'',textContent:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},requestAnimationFrame:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

const CRAFT_KEYS=run("CRAFTS.map(c=>c.key)");
const MODE_KEYS=run("MODES.map(m=>m.key)");

/* 1) The two halves exist, and are two. ----------------------------------------------- */
['garments','footwear','leather','fabrics'].forEach(k=>{
  if(CRAFT_KEYS.indexOf(k)<0)F('a studio cannot say it works in "'+k+'"');
});
['make','stock'].forEach(k=>{if(MODE_KEYS.indexOf(k)<0)F('a studio cannot say it "'+k+'"');});
// The old conflation must be gone: neither half may be named after the other.
['bespoke','rtw'].forEach(k=>{
  if(CRAFT_KEYS.indexOf(k)>=0)F('"'+k+'" is still offered as a craft, but it is a mode');
});

/* 2) Every business the website sells to is a craft x mode a studio can actually pick. - */
const AUDIENCES=[
  {who:'a bespoke tailor',       does:['garments:make'],                      board:true,  shop:false},
  {who:'a ready-to-wear label',  does:['garments:make','garments:stock'],     board:true,  shop:true},
  {who:'a boutique buying in',   does:['garments:stock'],                     board:false, shop:true},
  {who:'a bench shoemaker',      does:['footwear:make'],                      board:true,  shop:false},
  {who:'a shoemaker with a rail',does:['footwear:make','footwear:stock'],     board:true,  shop:true},
  {who:'a bag & leather maker',  does:['leather:make'],                       board:true,  shop:false},
  {who:'a fabric shop',          does:['fabrics:stock'],                      board:false, shop:true}
];
const setDoes=list=>run("SETTINGS.branches=[{id:'b1',name:'Solo',active:true,does:"+JSON.stringify(list)+"}];SETTINGS.itemWord='';");
AUDIENCES.forEach(a=>{
  setDoes(a.does);
  if(run("showsBespoke()")!==a.board)
    F(a.who+' '+(a.board?'gets no production board':'is shown a production board it has no use for'));
  if(run("showsRTW()")!==a.shop)
    F(a.who+' '+(a.shop?'gets no Shop to hold its stock':'is shown a Shop it does not stock'));
  // Anything that keeps stock takes money over the counter and must SEE its takings.
  // Footwear and leather used to be handed a Shop and a "Record a sale" button with the
  // Sales tab hidden, because visibility asked for kind:'retail' and their kind was
  // 'bespoke'. They recorded sales they could never look at again.
  if(run("salesVisible()")!==a.shop)
    F(a.who+' '+(a.shop?'keeps stock and cannot reach its Sales tab':'holds no stock but is shown a Sales tab'));
});

/* 3) Neither half decides the other. -------------------------------------------------- */
// Same craft, different mode -> different tabs, same words and measurements.
setDoes(['footwear:make']);
const footWordMake=run("tradeWord()"), footMeasMake=run("measFields()").length;
setDoes(['footwear:stock']);
if(run("tradeWord()")!==footWordMake)F('changing only the MODE changed what one piece of work is called');
setDoes(['footwear:make','footwear:stock']);
if(run("measFields()").length!==footMeasMake)F('adding a shelf changed which measurements a shoemaker is offered');
// Different craft, same mode -> same tabs, different words and measurements.
setDoes(['garments:make']);
const garmentWord=run("tradeWord()"), garmentMeas=run("measFields()");
setDoes(['leather:make']);
if(run("tradeWord()")===garmentWord)F('two different crafts making to order are called the same thing');
if(JSON.stringify(run("measFields()"))===JSON.stringify(garmentMeas))F('a bag maker is offered a tailor’s measurements');
if(run("showsBespoke()")!==true||run("showsRTW()")!==false)F('the craft half moved a tab, which is the mode half’s job');

/* 4) Every studio already on a device comes through unchanged. ------------------------ */
// Bare keys are what every real device has stored. They expand on read, and the tabs a
// studio had yesterday are the tabs it has today.
const MIGRATE=[
  ['bespoke',  ['garments:make'],                   {board:true, shop:false}],
  ['rtw',      ['garments:stock'],                  {board:false,shop:true}],
  ['footwear', ['footwear:make','footwear:stock'],  {board:true, shop:true}],
  ['leather',  ['leather:make','leather:stock'],    {board:true, shop:true}],
  ['fabrics',  ['fabrics:stock'],                   {board:false,shop:true}]
];
MIGRATE.forEach(row=>{
  const got=run("normaliseDoes("+JSON.stringify([row[0]])+")");
  if(JSON.stringify(got)!==JSON.stringify(row[1]))
    F('a studio storing "'+row[0]+'" migrates to '+JSON.stringify(got)+', expected '+JSON.stringify(row[1]));
  setDoes([row[0]]);
  if(run("showsBespoke()")!==row[2].board)F('a studio storing "'+row[0]+'" lost or gained a production board');
  if(run("salesVisible()")!==row[2].shop)F('a studio storing "'+row[0]+'" lost or gained its Sales tab');
});
// A branch that never even had does[] falls back on its type string, as it always did.
run("SETTINGS.branches=[{id:'b1',name:'Old',active:true,type:'both'}];");
if(run("showsBespoke()")!==true||run("showsRTW()")!==true)F('a branch with only the old type:both string lost half its app');
run("SETTINGS.branches=[{id:'b1',name:'Old',active:true,type:'bespoke'}];");
if(run("showsBespoke()")!==true||run("showsRTW()")!==false)F('a branch with only type:bespoke no longer reads as one');
// Expansion is idempotent: normalising twice must not double anything up.
const once=run("normaliseDoes(['footwear'])"), twice=run("normaliseDoes(normaliseDoes(['footwear']))");
if(JSON.stringify(once)!==JSON.stringify(twice))F('migrating an already-migrated studio changed it again');
/* The option LIST migrates too, not just the ticks. A studio that ever saved its own
   list of types has the old five entries stored, and 'bespoke' and 'rtw' were always the
   same craft. If they do not fold into garments, that studio opens Settings and finds it
   cannot say it works in garments at all. */
run("SETTINGS.branchActivities=[{key:'bespoke',label:'Bespoke tailoring',kind:'bespoke'},{key:'footwear',label:'Footwear',kind:'bespoke',catalog:true},{key:'leather',label:'Bags & leather',kind:'bespoke',catalog:true},{key:'rtw',label:'Ready-to-wear',kind:'retail',catalog:true},{key:'fabrics',label:'Fabrics',kind:'retail'}];");
const oldList=run("branchActivities().map(a=>a.key)");
if(oldList.indexOf('garments')<0)
  F('a studio with the old option list saved can no longer say it works in garments, got '+JSON.stringify(oldList));
if(oldList.filter(k=>k==='garments').length>1)
  F('the two legacy garment keys became two garment options instead of one, got '+JSON.stringify(oldList));
['footwear','leather','fabrics'].forEach(k=>{
  if(oldList.indexOf(k)<0)F('a studio with the old option list saved lost '+k);
});
if(oldList.some(k=>k==='bespoke'||k==='rtw'))
  F('the old mode-named keys survive in the option list as if they were crafts: '+JSON.stringify(oldList));
run("delete SETTINGS.branchActivities;");
// And a studio that deliberately REMOVED an option still has it removed.
run("SETTINGS.branchActivities=[{key:'garments',label:'Garments'},{key:'footwear',label:'Footwear'}];");
if(run("branchActivities().map(a=>a.key).indexOf('fabrics')>=0")===true)
  F('a studio that removed an option it will never be had it handed back');
run("delete SETTINGS.branchActivities;");

// A studio that added its own type kept the answer it gave to "making or selling?".
run("SETTINGS.branchActivities=[{key:'garments',label:'Garments'},{key:'rentals',label:'Rentals',kind:'retail',custom:true},{key:'alterations',label:'Alterations',kind:'bespoke',custom:true}];");
if(JSON.stringify(run("normaliseDoes(['rentals'])"))!=='["rentals:stock"]')F('a custom type added as Selling no longer sells');
if(JSON.stringify(run("normaliseDoes(['alterations'])"))!=='["alterations:make"]')F('a custom type added as Making no longer makes');
run("delete SETTINGS.branchActivities;");

/* 5) Editing what a studio does. ------------------------------------------------------ */
// Pure functions, so this is the behaviour of all three screens at once.
const tc=(list,c)=>run("doesToggleCraft("+JSON.stringify(list)+",'"+c+"')");
const tm=(list,c,mo)=>run("doesToggleMode("+JSON.stringify(list)+",'"+c+"','"+mo+"')");
if(JSON.stringify(tc([],'garments'))!=='["garments:make"]')
  F('ticking a craft should turn on the mode it is usually reached by');
if(JSON.stringify(tc(['garments:make','footwear:make'],'garments'))!=='["footwear:make"]')
  F('unticking a craft should take every one of its modes with it');
if(JSON.stringify(tm(['garments:make'],'garments','stock'))!=='["garments:make","garments:stock"]')
  F('a studio cannot say it both makes and stocks the same craft');
if(JSON.stringify(tm(['garments:make'],'garments','make'))!=='[]')
  F('turning off a craft’s last mode should untick the craft, not leave it doing nothing');
if(JSON.stringify(tc(['garments:make','garments:stock'],'garments'))!=='[]')
  F('unticking a craft in two modes left one of them behind');

/* 6) Production stages must be written in each craft's own words. --------------------- */
// A shoemaker must never be handed "Fabric Received" as their starting workflow.
const WORDS={footwear:/last|clicking|closing|soling/i,leather:/skiv|edge|hardware|gusset|assembly/i,bespoke:/fabric|stitch|fitting/i,rtw:/sampl|sew|press/i};
Object.keys(WORDS).forEach(k=>{
  const preset=run("(STAGE_PRESETS['"+k+"']||[]).join(' | ')");
  if(!preset)return F('no production preset exists for '+k);
  if(!WORDS[k].test(preset))F(k+' has a preset but it is not written in that trade’s language: '+preset);
});
// and each preset must be offered to the craft it belongs to
CRAFT_KEYS.forEach(k=>{
  const owned=run("Object.keys(STAGE_PRESET_META).filter(p=>(STAGE_PRESET_META[p].for||[]).indexOf('"+k+"')>=0).length");
  if(!owned)F('no stage preset is offered to a studio that works in '+k);
});
// 'for' holds craft keys, never craft:mode keys, or the chips match nothing
run("Object.keys(STAGE_PRESET_META)").forEach(pk=>{
  (run("(STAGE_PRESET_META['"+pk+"'].for||[])")).forEach(f=>{
    if(String(f).indexOf(':')>=0)F('stage preset '+pk+' is offered to "'+f+'", which is a craft:mode key not a craft');
    if(CRAFT_KEYS.indexOf(f)<0)F('stage preset '+pk+' is offered to "'+f+'", which is not a craft');
  });
});
// the full pipeline still opens and closes the same way for every trade
Object.keys(WORDS).forEach(k=>{
  const full=run("buildStages(STAGE_PRESETS['"+k+"'])");
  if(full[0]!=='Order Received')F(k+' pipeline does not start at Order Received');
  if(full[full.length-1]!=='Delivered')F(k+' pipeline does not end at Delivered');
});

/* 7) The word for one piece follows the craft, and the studio can override. ----------- */
setDoes(['garments:make']);if(run("tradeWord()")!=='garment')F('a tailor should make a garment, got '+run("tradeWord()"));
setDoes(['footwear:make']);if(run("tradeWord()")!=='pair')F('a shoemaker should make a pair, got '+run("tradeWord()"));
setDoes(['leather:make']);if(run("tradeWord()")!=='piece')F('a bag maker should make a piece, got '+run("tradeWord()"));
setDoes(['garments:make','footwear:make']);if(run("tradeWord()")!=='piece')F('a studio in two crafts should use the neutral word, got '+run("tradeWord()"));
// an explicit choice always wins
run("SETTINGS.itemWord='creation';");
if(run("tradeWord()")!=='creation')F('the studio set its own word and the app ignored it');
if(run("tradeWordCap()")!=='Creation')F('the capitalised word is wrong');
if(run("tradeWordPlural()")!=='creations')F('the plural word is wrong');
run("SETTINGS.itemWord='';");
// saving strips anything that would break markup
run("document.getElementById('set_itemword').value='<b>pair</b>';saveItemWord();");
if(/[<>]/.test(run("SETTINGS.itemWord")))F('the custom word was saved with markup in it: '+run("SETTINGS.itemWord"));
run("SETTINGS.itemWord='';");

/* 8) Measurements match the craft, and nothing already recorded can disappear. -------- */
setDoes(['garments:make']);
let f=run("measFields()");
if(f.indexOf('Chest / Bust')<0)F('a tailor cannot record a chest measurement');
if(f.indexOf('Shoe size')>=0)F('a tailor is being asked for a shoe size');
setDoes(['footwear:make']);
f=run("measFields()");
if(f.indexOf('Shoe size')<0||f.indexOf('Instep / girth')<0)F('a shoemaker cannot record a foot');
if(f.indexOf('Agbada width (arm-span)')>=0)F('a shoemaker is being asked for an Agbada arm-span');
setDoes(['leather:make']);
f=run("measFields()");
if(f.indexOf('Strap drop')<0||f.indexOf('Gusset')<0)F('a bag maker cannot record a bag');
// Nobody is measured for something bought off a shelf.
setDoes(['garments:stock']);
if(run("measFields()").indexOf('Shoe size')>=0)F('a boutique that only stocks is being asked for foot measurements');
setDoes(['footwear:stock']);
if(run("measFields()").indexOf('Shoe size')>=0)F('a shop selling ready pairs is asked to measure a foot it will never make for');
// a studio that changes craft must still SEE what it recorded before
setDoes(['footwear:make']);
const kept=run("measFieldsFor({'Chest / Bust':'42'})");
if(kept.indexOf('Chest / Bust')<0)F('a measurement on file vanished when the studio changed craft');
// the read-back grid reads against the list that was rendered, not today's list
setDoes(['garments:make']);
run("measGrid('t1',{});");
setDoes(['footwear:make']);
if(run("_measRendered['t1'].indexOf('Chest / Bust')>=0")!==true)F('a measurement form would read back against the wrong field list');

/* 9) Products file themselves under the right category. ------------------------------- */
[['Oxford shoes','Footwear'],['Leather tote','Bag'],['Aso-oke wrapper','Fabric'],['Agbada','Garment'],['Zip','Other']]
  .forEach(pair=>{const got=run("guessCategory("+JSON.stringify(pair[0])+")");if(got!==pair[1])F('"'+pair[0]+'" filed as '+got+', expected '+pair[1]);});

/* 10) A shoemaker-only studio gets a working app, not an empty one. ------------------- */
setDoes(['footwear:make','footwear:stock']);
if(run("showsBespoke()")!==true)F('a shoemaker gets no Production board');
if(run("showsRTW()")!==true)F('a shoemaker with a rail gets no Shop, so cannot stock ready pairs');
setDoes(['fabrics:stock']);
if(run("showsRetail()")!==true)F('a fabric seller gets no Sales');
if(run("showsBespoke()")!==false)F('a fabric seller is shown a Production board they do not need');

/* 11) Every example studio loads, and reads as its own trade. -------------------
   These are what a prospect opens first and what Kayode tests each tab
   against. An example that still says "Fabric Received" to a shoemaker is
   worse than no example, because it tells them the app is not for them. */
const EX=run("EXAMPLE_STUDIOS.map(x=>x.key)");
['multi','bespoke','footwear','leather','rtw','fabrics'].forEach(k=>{
  if(EX.indexOf(k)<0)F('there is no example studio for '+k);
});
const EXPECT={
  bespoke: {word:'garment',stage:/fabric|cutting|stitch/i, prod:true,  retail:false, sells:false},
  footwear:{word:'pair',   stage:/last|clicking|closing/i, prod:true,  retail:true,  sells:true},
  leather: {word:'piece',  stage:/pattern|cutting|skiv/i,  prod:true,  retail:true,  sells:true},
  rtw:     {word:'garment',stage:/sampl|cutting|sew/i,     prod:false, retail:true,  sells:true},
  fabrics: {word:'piece',  stage:/cloth|measured|packed/i, prod:false, retail:true,  sells:true}
};
Object.keys(EXPECT).forEach(k=>{
  const want=EXPECT[k];
  let threw='';
  try{ run("loadExampleAs("+JSON.stringify(k)+");"); }catch(e){ threw=e.message; }
  if(threw){F('the '+k+' example studio failed to load: '+threw);return;}
  run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
  const word=run("tradeWord()");
  if(word!==want.word)F(k+' example calls one piece of work a "'+word+'", expected "'+want.word+'"');
  const stages=run("STAGES.join(' | ')");
  if(!want.stage.test(stages))F(k+' example has the wrong production stages: '+stages);
  if(run("showsBespoke()")!==want.prod)F(k+' example '+(want.prod?'should':'should not')+' show a Production board');
  if(run("showsRetail()")!==want.retail)F(k+' example '+(want.retail?'should':'should not')+' show a Shop');
  if(run("salesVisible()")!==want.sells)F(k+' example '+(want.sells?'should':'should not')+' reach the Sales tab');
  // every example states both halves of what it does, rather than leaning on the migration
  const does=run("getBranches()[0].does")||[];
  const bare=does.filter(x=>String(x).indexOf(':')<0);
  if(bare.length)F(k+' example still stores the old single-answer key(s) '+JSON.stringify(bare));
  // and it must have data, or there is nothing to look at
  if(!run("getOrders().length"))F(k+' example has no orders, so every tab is empty');
  if(!run("getTxns().length"))F(k+' example has no money recorded');
  // one studio, and everything in it
  const brs=run("getBranches().length");
  if(brs!==1)F(k+' example should be a single studio, got '+brs);
  const stray=run("getOrders().filter(o=>o.branch!==getBranches()[0].name).length");
  if(stray)F(k+' example leaves '+stray+' order(s) pointing at a studio that no longer exists');
  // money, stock and people too: a record pointing at a studio that is gone is
  // invisible in every studio view, which is how an example looks half-empty
  [['payment','getTxns','branch'],['stock item','getSupplies','branch'],['staff member','getStaff','location']].forEach(function(e){
    const n2=run(e[1]+"().filter(r=>r."+e[2]+"!==getBranches()[0].name).length");
    if(n2)F(k+' example leaves '+n2+' '+e[0]+'(s) pointing at a studio that no longer exists');
  });
  // the orders must be things this trade actually makes
  const items=run("EXAMPLE_STUDIOS.find(x=>x.key==="+JSON.stringify(k)+").items");
  const first=run("getOrders()[0].garment");
  if(items.indexOf(first)<0)F(k+' example order is a "'+first+'", which is not something that trade makes');
});
// haberdashery is gone as a trade, but must survive as an inventory category:
// every tailor stocks threads, buttons and zips
if(run("typeof invCatMatch")==='function'){
  if(run("invCatMatch('Threads','haberdashery')")!==true||run("invCatMatch('Needles & notions','haberdashery')")!==true)
    F('haberdashery was removed as an inventory category too, which breaks stock for every tailor');
}
if(run("CRAFTS.some(a=>a.key==='haberdashery')"))
  F('haberdashery is still offered as a craft a studio can work in');

/* 12) All three screens that ask the question actually render, and every handler they
   wire up exists. -----------------------------------------------------------------
   This section exists because of a real near-miss: a batch of edits to the branch editor
   was rolled back halfway, leaving markup calling four functions that had been renamed,
   and every other gate stayed green because nothing ever rendered that screen. A picker
   whose buttons call nothing looks perfectly fine until somebody taps one. */
function modalHtml(){return run("document.getElementById('modal').innerHTML")||'';}
function handlersExist(markup,where){
  const seen={};
  (markup.match(/onclick="[^"]*"/g)||[]).forEach(function(att){
    // bare calls only: event.stopPropagation() is a method on the event, not a handler
    (att.match(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)||[]).forEach(function(hit){
      const fn=hit.replace(/[^\w$]/g,'');
      if(seen[fn])return;seen[fn]=1;
      if(run("typeof "+fn)!=='function')F(where+' wires up '+fn+'(), which does not exist');
    });
  });
  return Object.keys(seen).length;
}
const MODE_LABELS=run("MODES.map(m=>m.label)");
[
  ['the first-run screen', "openStudioSetup();setupToggleCraft('footwear');", 'setupToggleCraft'],
  ['the branch editor',    "openBranchEdit('');beToggleCraft('footwear');",   'beToggleCraft']
].forEach(function(scr){
  run("SETTINGS.branches=[{id:'b1',name:'Solo',active:true,does:['footwear:make']}];");
  let threw='';
  try{ run(scr[1]); }catch(e){ threw=e.message; }
  if(threw){F(scr[0]+' fails to render: '+threw);return;}
  const mk=modalHtml();
  if(!mk)return F(scr[0]+' rendered nothing');
  MODE_LABELS.forEach(function(l){
    if(mk.indexOf(l)<0)F(scr[0]+' never offers the mode "'+l+'", so the second question is not asked');
  });
  if(mk.indexOf(scr[2])<0)F(scr[0]+' does not wire the craft toggle it needs');
  const n=handlersExist(mk,scr[0]);
  if(n<4)F(scr[0]+' wired only '+n+' handlers, which suggests it rendered almost nothing');
});
// Settings -> Studios writes into a panel rather than a modal, so read that instead.
run("branchDraft=null;SETTINGS.branches=[{id:'b1',name:'Solo',active:true,does:['footwear:make']}];renderBranchesSettings();");
const panel=run("document.getElementById('branchBox').innerHTML")||'';
if(!panel)F('Settings -> Studios rendered nothing');
MODE_LABELS.forEach(function(l){
  if(panel.indexOf(l)<0)F('Settings -> Studios never offers the mode "'+l+'"');
});
handlersExist(panel,'Settings -> Studios');

/* And the shortcut a one-studio business finds first must actually DO something. It used
   to write SETTINGS.businessType, a field read only when a business has no branches at
   all, which never happens. Tapping Selling opened no Shop, no Sales, and said nothing. */
run("SETTINGS.branches=[{id:'b1',name:'Solo',active:true,does:['garments:make']}];renderBizDoes();");
const bizBox=run("document.getElementById('bizDoesBox').innerHTML")||'';
if(!bizBox)F('the What-your-studio-does panel renders nothing');
MODE_LABELS.forEach(function(l){
  if(bizBox.indexOf(l)<0)F('the What-your-studio-does panel never offers the mode "'+l+'"');
});
handlersExist(bizBox,'the What-your-studio-does panel');
run("bizToggleMode('garments','stock');");
if(run("showsRTW()")!==true||run("salesVisible()")!==true)
  F('tapping "sell them ready made" on the studio panel opened no Shop and no Sales');
if(JSON.stringify(run("branchDoes(getBranches()[0])"))!==JSON.stringify(['garments:make','garments:stock']))
  F('the studio panel did not write what it was told to the studio record');
/* Unticking the only craft left has to be refused. Read the STORED does[], not
   branchDoes(), because an empty does[] falls through to the branch's old type string and
   would read back as a full app while the record says the studio does nothing. */
run("bizToggleCraft('garments');");
if(!((run("getBranches()[0].does")||[]).length))
  F('the studio panel let a studio save itself as doing nothing at all');
if(run("getBranches()[0].does").join(',')!=='garments:make,garments:stock')
  F('unticking the last craft was not refused cleanly, left '+JSON.stringify(run("getBranches()[0].does")));
run("branchDraft=null;beDraft=null;setupDraft=null;");

/* 13) Quality control follows the craft. -------------------------------------------
   It was one flat list for every studio: a shoemaker was asked whether the garment had
   been pressed, and nobody was asked about construction or symmetry, which are two of
   the five things Kayode's own supervisors check on the floor. Nothing covered QC at
   all before this, so the pass/fail machinery is checked here too. */
const OLD_FLAT=['Measurements match the spec','Stitching & seams clean','Fit confirmed / tried on',
  'Finishing & detailing correct','Embellishment / monogram correct','Pressed & packaged neatly'];
const qcOf=c=>run("qcFromCrafts(['"+c+"'])");

// The two checks the training document has and the app did not.
const qcGarments=qcOf('garments');
[[/construction/i,'construction'],[/symmetr/i,'symmetry']].forEach(pair=>{
  if(!qcGarments.some(x=>pair[0].test(x)))F('the garment checklist still does not ask about '+pair[1]);
});
// and not one of the checks a studio already relied on was dropped to make room
OLD_FLAT.forEach(x=>{
  if(qcGarments.indexOf(x)<0)F('the garment checklist lost a check studios were already using: "'+x+'"');
});
// every craft has one, and it is written in that craft's own language
const QC_LANG={
  garments:{wants:/fit|drape|press/i, banned:/sole|last|hardware|dye shading/i},
  footwear:{wants:/sole|last|insole|burnish/i, banned:/pressed|drape|dye shading/i},
  leather: {wants:/hardware|edge|lining|panel/i, banned:/sole|pressed|tried on/i},
  fabrics: {wants:/length|cut edge|shading|folded/i, banned:/sole|hardware|tried on/i}
};
CRAFT_KEYS.forEach(c=>{
  const list=qcOf(c);
  if(!list.length)return F('a '+c+' studio starts with no quality checks at all');
  const rule=QC_LANG[c];
  if(!rule)return;
  if(!list.some(x=>rule.wants.test(x)))F('the '+c+' checklist is not written in that craft’s language: '+list.join(' | '));
  const borrowed=list.filter(x=>rule.banned.test(x));
  if(borrowed.length)F('the '+c+' checklist borrows a check that belongs to another craft: '+borrowed.join(', '));
});
// a studio in two crafts gets both lists, once each
const both=run("qcFromCrafts(['footwear','leather'])");
if(both.length!==new Set(both).size)F('a studio in two crafts gets the same check listed twice');
['sole','hardware'].forEach(w=>{
  if(!both.some(x=>new RegExp(w,'i').test(x)))F('a studio doing shoes and bags lost the '+w+' check');
});

// The checks on one order follow the studio that made it, not an average of the business.
run("SETTINGS.branches=[{id:'b1',name:'The bench',active:true,does:['footwear:make']},{id:'b2',name:'The workroom',active:true,does:['garments:make']}];delete SETTINGS.qcChecklist;");
const qcBench=run("qcChecklistFor({branch:'The bench'})");
const qcRoom=run("qcChecklistFor({branch:'The workroom'})");
if(!qcBench.some(x=>/sole/i.test(x)))F('an order made at the shoe bench is not checked for its sole');
if(qcRoom.some(x=>/sole/i.test(x)))F('an order made in the tailoring workroom is being checked for a sole');
if(!qcRoom.some(x=>/tried on/i.test(x)))F('an order made in the tailoring workroom is not tried on');
// an order that names no studio falls back to everything the business does, not to nothing
const qcAny=run("qcChecklistFor({})");
if(!qcAny.length)F('an order with no studio on it gets no quality checks at all');

// An edited list is the studio's own answer and wins everywhere.
run("SETTINGS.qcChecklist=['Only this one'];");
if(JSON.stringify(run("qcChecklistFor({branch:'The bench'})"))!=='["Only this one"]')
  F('a studio edited its checklist and the app went on using the craft’s');
// Emptying the box asks for the craft's checks back, and must never leave zero checks.
run("document.getElementById('set_qc').value='';saveQCChecklist();");
if(run("SETTINGS.qcChecklist!==undefined&&SETTINGS.qcChecklist!==null&&SETTINGS.qcChecklist.length>0"))
  F('clearing the checklist saved an empty one instead of restoring the craft’s');
if(!run("qcChecklist().length"))F('clearing the checklist left a studio with no quality control');

/* The pass/fail machinery: who ticked it, when, and where a failed piece goes. */
run("delete SETTINGS.qcChecklist;loadExampleAs('bespoke');currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
const qcId=run("(getOrders().find(o=>o.kind!=='sale')||{}).id");
if(!qcId){F('no order to run quality control against');}
else{
  run("openQC('"+qcId+"');");
  const items=run("qcDraft.items.length");
  if(!items)F('the QC modal opened with no checks to tick');
  if(!run("renderQCModal()||true"))F('the QC modal failed to render');
  const mk=run("document.getElementById('modal').innerHTML")||'';
  if(mk.indexOf(run("qcDraft.items[0].label"))<0)F('the QC modal does not show the checks it is asking about');
  handlersExist(mk,'the QC modal');
  /* Tick the boxes rather than the draft: passQC calls syncQC first, which reads the
     form. Setting qcDraft directly would test a path no person can take. */
  // a pass is signed and dated, and moves the piece on
  run("qcDraft.items.forEach((it,i)=>{document.getElementById('qc_'+i).checked=true;});document.getElementById('qc_note').value='';passQC();");
  const o=run("getOrders().find(o=>o.id==='"+qcId+"')");
  if(!o.qc||o.qc.status!=='passed')F('a passed order does not record that it passed');
  if(!o.qc||!o.qc.by)F('a passed order does not record who passed it');
  if(!o.qc||!o.qc.at)F('a passed order does not record when it was passed');
  if(!(o.qc.items||[]).length||!(o.qc.items||[]).every(i=>i.ok))
    F('the ticks the person actually made were not the ones recorded');
  if(o.stageIndex<run("STAGES.indexOf('Ready for Delivery')"))F('a passed order was not moved on to Ready for Delivery');
  if(!(o.updates||[]).some(u=>/QC passed/.test(u.note||'')))F('passing QC leaves nothing in the order’s history');
  // a fail goes back for rework, before the check it failed
  run("openQC('"+qcId+"');document.getElementById('qc_0').checked=false;document.getElementById('qc_note').value='Left sleeve short';failQC();");
  const f2=run("getOrders().find(o=>o.id==='"+qcId+"')");
  if(!f2.qc||f2.qc.status!=='failed')F('a failed order does not record that it failed');
  if(f2.stageIndex>=run("STAGES.indexOf('Quality Check')"))F('a failed order was not sent back for rework');
  if(!(f2.updates||[]).some(u=>/rework/i.test(u.note||'')))F('a failed order does not say why in its history');
  if(!(f2.updates||[]).some(u=>/Left sleeve short/.test(u.note||'')))F('the note explaining the failure was thrown away');
}

console.log('Multi-trade audit:');
console.log('  crafts: '+CRAFT_KEYS.join(' · ')+'   modes: '+MODE_KEYS.join(' · '));
console.log('  presets: '+run("Object.keys(STAGE_PRESETS).join(' · ')"));
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ craft drives wording, measurements and stages; mode drives the tabs; neither decides the other');
console.log('  ✓ every studio already on a device migrates to the same app it had yesterday');
