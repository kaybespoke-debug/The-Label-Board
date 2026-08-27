// Multi-trade gate.
// The Label Board is sold to bespoke tailors, ready-to-wear makers, shoe makers, bag and
// leather workers, fabric sellers and haberdashers. The website says so. This gate makes
// sure the app agrees: every one of those trades can be selected, gets production stages
// written in its own words, gets the right measurements, and is called the right thing.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2] || 'site/layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,placeholder:'',textContent:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

/* 1) Every trade we advertise can actually be chosen. --------------------------------- */
const SOLD=['bespoke','rtw','footwear','leather','fabrics','haberdashery'];
const keys=run("DEFAULT_ACTIVITIES.map(a=>a.key)");
SOLD.forEach(k=>{if(keys.indexOf(k)<0)F('the website sells to "'+k+'" but a studio cannot select it');});

/* 2) A trade that MAKES things must open Production; one that SELLS must open Sales. --- */
['bespoke','footwear','leather'].forEach(k=>{if(run("activityKind('"+k+"')")!=='bespoke')F(k+' makes things to order but does not open the Production board');});
['rtw','fabrics','haberdashery'].forEach(k=>{if(run("activityKind('"+k+"')")!=='retail')F(k+' sells stock but does not open Sales');});
// shoes and bags are also stocked and sold, so they need a catalogue
['footwear','leather','rtw'].forEach(k=>{if(run("activityHasCatalog('"+k+"')")!==true)F(k+' has no product catalogue, so nothing can be stocked or priced');});

/* 3) Production stages must be written in each trade's own words. --------------------- */
// A shoemaker must never be handed "Fabric Received" as their starting workflow.
const WORDS={footwear:/last|clicking|closing|soling/i,leather:/skiv|edge|hardware|gusset|assembly/i,bespoke:/fabric|stitch|fitting/i,rtw:/sampl|sew|press/i};
Object.keys(WORDS).forEach(k=>{
  const preset=run("(STAGE_PRESETS['"+k+"']||[]).join(' | ')");
  if(!preset)return F('no production preset exists for '+k);
  if(!WORDS[k].test(preset))F(k+' has a preset but it is not written in that trade’s language: '+preset);
});
// and each preset must be offered to the trade it belongs to
SOLD.forEach(k=>{
  const owned=run("Object.keys(STAGE_PRESET_META).filter(p=>(STAGE_PRESET_META[p].for||[]).indexOf('"+k+"')>=0).length");
  if(!owned)F('no stage preset is offered to a studio that does '+k);
});
// the full pipeline still opens and closes the same way for every trade
Object.keys(WORDS).forEach(k=>{
  const full=run("buildStages(STAGE_PRESETS['"+k+"'])");
  if(full[0]!=='Order Received')F(k+' pipeline does not start at Order Received');
  if(full[full.length-1]!=='Delivered')F(k+' pipeline does not end at Delivered');
});

/* 4) The word for one piece of work follows the trade, and the studio can override. ---- */
const setDoes=list=>run("SETTINGS.branches=[{id:'b1',name:'Solo',active:true,does:"+JSON.stringify(list)+"}];SETTINGS.itemWord='';");
setDoes(['bespoke']);if(run("tradeWord()")!=='garment')F('a tailor should make a garment, got '+run("tradeWord()"));
setDoes(['footwear']);if(run("tradeWord()")!=='pair')F('a shoemaker should make a pair, got '+run("tradeWord()"));
setDoes(['leather']);if(run("tradeWord()")!=='piece')F('a bag maker should make a piece, got '+run("tradeWord()"));
setDoes(['bespoke','footwear']);if(run("tradeWord()")!=='piece')F('a studio doing two trades should use the neutral word, got '+run("tradeWord()"));
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

/* 5) Measurements match the trade, and nothing already recorded can disappear. -------- */
setDoes(['bespoke']);
let f=run("measFields()");
if(f.indexOf('Chest / Bust')<0)F('a tailor cannot record a chest measurement');
if(f.indexOf('Shoe size')>=0)F('a tailor is being asked for a shoe size');
setDoes(['footwear']);
f=run("measFields()");
if(f.indexOf('Shoe size')<0||f.indexOf('Instep / girth')<0)F('a shoemaker cannot record a foot');
if(f.indexOf('Agbada width (arm-span)')>=0)F('a shoemaker is being asked for an Agbada arm-span');
setDoes(['leather']);
f=run("measFields()");
if(f.indexOf('Strap drop')<0||f.indexOf('Gusset')<0)F('a bag maker cannot record a bag');
// a studio that changes trade must still SEE what it recorded before
setDoes(['footwear']);
const kept=run("measFieldsFor({'Chest / Bust':'42'})");
if(kept.indexOf('Chest / Bust')<0)F('a measurement on file vanished when the studio changed trade');
// the read-back grid reads against the list that was rendered, not today's list
setDoes(['bespoke']);
run("measGrid('t1',{});");
setDoes(['footwear']);
if(run("_measRendered['t1'].indexOf('Chest / Bust')>=0")!==true)F('a measurement form would read back against the wrong field list');

/* 6) Products file themselves under the right category. ------------------------------- */
[['Oxford shoes','Footwear'],['Leather tote','Bag'],['Aso-oke wrapper','Fabric'],['Agbada','Garment'],['Zip','Other']]
  .forEach(pair=>{const got=run("guessCategory("+JSON.stringify(pair[0])+")");if(got!==pair[1])F('"'+pair[0]+'" filed as '+got+', expected '+pair[1]);});

/* 7) A shoemaker-only studio gets a working app, not an empty one. -------------------- */
setDoes(['footwear']);
if(run("showsBespoke()")!==true)F('a shoemaker gets no Production board');
if(run("showsRTW()")!==true)F('a shoemaker gets no Shop, so cannot stock ready pairs');
setDoes(['fabrics']);
if(run("showsRetail()")!==true)F('a fabric seller gets no Sales');
if(run("showsBespoke()")!==false)F('a fabric seller is shown a Production board they do not need');

console.log('Multi-trade audit:');
console.log('  trades: '+keys.join(' · '));
console.log('  presets: '+run("Object.keys(STAGE_PRESETS).join(' · ')"));
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ every advertised trade is selectable, has its own stages, measurements and wording');
