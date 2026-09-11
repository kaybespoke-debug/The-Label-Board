// How a piece was made: bespoke, made to measure, or off the shelf.
//
// The website has sold to "Made to measure" for months and the app had no word for it. So a
// studio could not say whether a job was cut from scratch or was a standard block adjusted,
// which is the difference between a fortnight and an afternoon, and between two quite
// different prices. It also meant nobody could answer what share of the work is which.
//
// The thing this gate mostly defends is WHERE the field lives. It is on the piece, never on
// the studio: a shoemaker cuts a bespoke last for one client, adjusts a standard last for
// the next, and sells ready-made off the shelf, in the same week at the same bench. And
// bespoke and made to measure behave identically in the app, which is why this is not a
// third mode on craft x mode.
'use strict';
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync((process.argv[2]||'site/layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';
while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const cache={},_ls={};
const mkEl=id=>({_id:id,innerHTML:'',value:'',checked:false,textContent:'',placeholder:'',style:{},dataset:{},options:[],
  classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},
  appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){},select(){},remove(){},closest(){return null}});
const sb={console:{log(){},warn(){},error(){},debug(){}},
  document:{getElementById(i){return cache[i]||(cache[i]=mkEl(i))},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl(),execCommand(){return true}},
  localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},
  setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},setInterval(){},clearInterval(){},
  requestAnimationFrame:f=>{try{f&&f()}catch(e){}},
  navigator:{userAgent:'node',onLine:true},location:{href:'',hash:'',search:''},
  alert(msg){sb.__alert=String(msg||'');},confirm(){return true},prompt(){return ''},
  matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}),
  Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,Promise,Error,Intl,
  parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,
  btoa:x=>Buffer.from(x,'binary').toString('base64'),atob:x=>Buffer.from(x,'base64').toString('binary')};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'app'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
const J=e=>JSON.parse(run('JSON.stringify('+e+')'));
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

/* 1) The three answers exist, and mean what the trade means by them. ----------------- */
const KEYS=run("MAKE_METHODS.map(m=>m.k)");
['bespoke','mtm','stock'].forEach(k=>{if(KEYS.indexOf(k)<0)F('a piece cannot be recorded as "'+k+'"');});
const labels=run("MAKE_METHODS.map(m=>m.label).join(' | ')");
if(!/made to measure/i.test(labels))F('the app still has no words for made to measure: '+labels);
if(!/bespoke/i.test(labels))F('the app has no word for bespoke: '+labels);
// bespoke and made to measure are both measured; a shelf piece is not
if(run("itemIsMeasured({method:'bespoke'})")!==true)F('a bespoke piece is not being measured for');
if(run("itemIsMeasured({method:'mtm'})")!==true)F('a made-to-measure piece is not being measured for');
if(run("itemIsMeasured({method:'stock'})")!==false)F('a piece taken off the shelf is being measured for');
// and a piece nobody has said anything about IS measured, because assuming otherwise skips one
if(run("itemIsMeasured({})")!==true)F('a piece with no method recorded is being treated as needing no measurements');

/* 2) It is a property of the piece, not of the studio. ------------------------------- */
// the same studio, one of each, on one order: all three have to be able to coexist
run("SETTINGS.branches=[{id:'b1',name:'Solo',active:true,does:['footwear:make','footwear:stock']}];");
const mixOrder="{outfits:[{price:100,method:'bespoke'},{price:100,method:'mtm'},{price:100,method:'stock'}]}";
['bespoke','mtm','stock'].forEach(k=>{
  if(run("("+mixOrder+").outfits.filter(function(x){return itemMethod(x)==='"+k+"';}).length")!==1)
    F('one order cannot carry a '+k+' piece alongside the others, which is a week at any bench');
});
// nothing anywhere makes it a studio setting
if(/SETTINGS\.method\b|SETTINGS\.makeMethod\b/.test(html))
  F('how a piece is made has been stored on the studio, and a shoemaker does all three in a week');

/* 3) The order form asks, and only where the answer means something. ----------------- */
run("loadExampleAs('bespoke');currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
run("openOrder();");
let form=run("document.getElementById('modal').innerHTML")||'';
if(!form)F('the order form rendered nothing');
if(form.indexOf('How is it being made')<0)F('a studio that makes to order is never asked how a piece is being made');
run("MAKE_METHODS.map(m=>m.label)").forEach(l=>{
  if(form.indexOf(l)<0)F('the order form does not offer "'+l+'"');
});
// every handler it wires up exists
const seen={};
(form.match(/onclick="[^"]*"/g)||[]).forEach(function(att){
  (att.match(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)||[]).forEach(function(hit){
    const fn=hit.replace(/[^\w$]/g,'');
    if(seen[fn])return;seen[fn]=1;
    if(run("typeof "+fn)!=='function')F('the order form wires up '+fn+'(), which does not exist');
  });
});
// the chip records it, and can be tapped off again
run("setOutfitMethod(0,'mtm');");
if(run("draft.outfits[0].method")!=='mtm')F('picking how a piece is made records nothing');
if(run("itemMethodChips(0)").indexOf('standard block')<0)F('picking made to measure does not say what it means');
run("setOutfitMethod(0,'mtm');");
if(run("draft.outfits[0].method")!=='')F('the answer cannot be tapped off again');
run("setOutfitMethod(0,'stock');");
if(run("itemMethodChips(0)").indexOf('No measurements needed')<0)
  F('a shelf piece does not say that nobody needs measuring');
run("closeModal();draft=null;");
// a studio that only sells off a shelf is never asked: it takes no made-to-order work
run("SETTINGS.branches=[{id:'b1',name:'Solo',active:true,does:['garments:stock']}];openOrder();");
if((run("document.getElementById('modal').innerHTML")||'').indexOf('How is it being made')>=0)
  F('a studio that only sells ready-made stock is being asked how it made a piece');
run("closeModal();draft=null;");

/* 4) The bench is told, because it decides what they do first. ----------------------- */
run("loadExampleAs('bespoke');currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
const jid=run("(getOrders().find(o=>isClientOrder(o))||{}).id");
if(jid){
  run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+jid+"');o.outfits[0].method='mtm';save('layi_dash_orders',l);})();");
  const sheet=run("jobSheetInner(getOrders().find(o=>o.id==='"+jid+"'))");
  if(sheet.indexOf('Made to measure')<0)
    F('the work order does not say whether to cut from scratch or adjust a block');
  // clear EVERY piece: this order carries more than one, and leaving a sibling set
  // would prove nothing about the one being tested
  run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+jid+"');(o.outfits||[]).forEach(function(x){x.method='';});save('layi_dash_orders',l);})();");
  if(run("jobSheetInner(getOrders().find(o=>o.id==='"+jid+"'))").indexOf('Made to measure')>=0)
    F('the work order claims a method nobody recorded');
}

/* 5) The split, which is the reason to record it at all. ----------------------------- */
run("demoLogin();currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
const mix=J("methodMix()");
['bespoke','mtm','stock',''].forEach(k=>{
  if(!mix.hasOwnProperty(k))F('the split has no line for '+(k||'pieces nobody recorded'));
});
if(!mix.bespoke.count)F('the demo records no bespoke work, so nobody ever sees the split working');
if(!mix.mtm.count)F('the demo records no made-to-measure work');
if(!mix['']||!mix[''].count)F('the demo has no unrecorded pieces, so nobody learns what an unfilled field looks like');
// the lines add up to the work booked, and nothing is invented
const total=run("methodMixTotal(methodMix())");
const booked=run("getOrders().filter(inBranch).filter(isClientOrder).reduce(function(s,o){var outs=(o.outfits&&o.outfits.length)?o.outfits:[{price:o.value}];return s+outs.reduce(function(a,x){return a+(+x.price||0)*ofx(o);},0);},0)");
if(Math.round(total)!==Math.round(booked))
  F('the split comes to '+Math.round(total)+' but the work booked is '+Math.round(booked)+', so a line is missing or double counted');
// unrecorded pieces are their OWN line, never spread across the others
const bespokeBefore=mix.bespoke.value;
run("(function(){var l=rawOrders();l.filter(isClientOrder).forEach(function(o){(o.outfits||[]).forEach(function(x){x.method='';});});save('layi_dash_orders',l);})();");
const none=J("methodMix()");
if(none.bespoke.value!==0||none.mtm.value!==0)
  F('with nothing recorded the split still claims bespoke and made-to-measure work');
if(Math.round(none[''].value)!==Math.round(booked))
  F('with nothing recorded the unrecorded line does not hold all of it');
if(run("methodMixWorthShowing(methodMix())")!==false)
  F('a studio that has recorded nothing is shown a panel of zeroes and one lump');
if(!bespokeBefore)F('the split found no bespoke value before it was cleared, so the previous check proved nothing');
// it follows the studio switcher, like everything else on that screen
run("demoLogin();currentUser=getUsers().find(u=>u.roleId==='owner');");
run("activeBranchView='all';");
const allV=run("methodMixTotal(methodMix())");
const names=run("getBranches().filter(b=>b.active!==false).map(b=>b.name)");
let sumBr=0;names.forEach(n=>{run("activeBranchView="+JSON.stringify(n)+";");sumBr+=run("methodMixTotal(methodMix())");});
run("activeBranchView='all';");
if(Math.round(sumBr)!==Math.round(allV))
  F('the studios add up to '+Math.round(sumBr)+' but All studios says '+Math.round(allV)+', so the split is not branch-scoped');

/* 6) The panel exists, is filled, and stays away when it would say nothing. ---------- */
if(html.indexOf('id="dashMethodPanel"')<0)F('there is nowhere on the dashboard for the split to show');
run("demoLogin();currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
// renderActivity() is the dashboard renderer. Calling it is the point: the panel is built
// there, so a check that only read methodMix() would pass with nothing on screen.
let threwDash='';
try{ run("renderActivity();"); }catch(e){ threwDash=e.message; }
if(threwDash)F('the dashboard failed to render: '+threwDash);
const panelHtml=run("document.getElementById('dashMethod').innerHTML")||'';
if(!panelHtml)F('the split panel renders nothing on a studio that has recorded it');
else{
  if(panelHtml.indexOf('Bespoke')<0)F('the split panel does not name bespoke work');
  if(panelHtml.indexOf('Made to measure')<0)F('the split panel does not name made-to-measure work');
  if(panelHtml.indexOf('%')<0)F('the split panel shows no share, which is the whole question');
}

console.log('Make-method audit:');
console.log('  '+run("MAKE_METHODS.map(function(m){return m.label;}).join(' \\u00b7 ')"));
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ on the piece not the studio, all three can sit on one order, the bench is told,');
console.log('  ✓ and the split adds up to the work booked with unrecorded pieces on their own line');
