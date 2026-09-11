// Fabric check gate.
//
// The failure this exists to prevent is cutting into the wrong piece of cloth. Studio
// stock can be replaced by walking to the shelf. A client's own fabric cannot be replaced
// at any price — it was bought on a trip, it was a gift, it is the last of that dye lot —
// and it is the piece that gets mixed up, because it arrives loose, in a bag, looking like
// everybody else's.
//
// Three things have to hold. The order has to record WHOSE the cloth is. The work order,
// which is the sheet the person cutting actually holds, has to say so where they cannot
// miss it. And somebody has to be asked to check the cloth against the photo while it
// still matters — which is before cutting, not at quality control, because QC finds the
// wrong cloth after it has already been cut.
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
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

/* 1) The order can say whose cloth it is, and knows which answers are irreplaceable. -- */
const SRC=run("FABRIC_SOURCES.map(f=>f.k)");
['studio','vendor','brought','sent'].forEach(k=>{
  if(SRC.indexOf(k)<0)F('an order cannot record that the fabric is "'+k+'"');
});
// exactly the two client-owned answers are marked irreplaceable; the studio's own are not
const theirs=run("FABRIC_SOURCES.filter(f=>f.theirs).map(f=>f.k)").sort().join(',');
if(theirs!=='brought,sent')
  F('the wrong answers are treated as the client’s own cloth: '+theirs);
if(run("itemIsTheirs({fabricFrom:'studio'})")!==false)F('studio stock is being treated as irreplaceable');
if(run("itemIsTheirs({fabricFrom:'brought'})")!==true)F('cloth the client brought in is not being treated as theirs');
if(run("itemIsTheirs({})")!==false)F('an item with no answer is being treated as the client’s own');
// one item on a group or party order is enough to make the whole order careful
if(run("orderHasTheirFabric({outfits:[{fabricFrom:'studio'},{fabricFrom:'sent'}]})")!==true)
  F('an order carrying one piece of the client’s cloth among several is not flagged');
if(run("orderHasTheirFabric({outfits:[{fabricFrom:'studio'}]})")!==false)
  F('an order entirely of studio stock is being flagged as the client’s');
// a new item starts with the question unanswered rather than guessing
if(run("blankOutfit().fabricFrom")!=='')F('a new item arrives with an answer nobody gave');

/* 2) The question is asked where the materials are answered. ------------------------- */
run("openOrder();");
let form=run("document.getElementById('modal').innerHTML")||'';
if(!form)F('the order form rendered nothing');
if(form.indexOf('Whose material is it')<0)F('the order form never asks whose material it is');
run("FABRIC_SOURCES.map(f=>f.label)").forEach(l=>{
  if(form.indexOf(l)<0)F('the order form does not offer "'+l+'"');
});
// and the chip actually sets it, and can be tapped again to unset
run("setOutfitFabricFrom(0,'brought');");
if(run("draft.outfits[0].fabricFrom")!=='brought')F('tapping whose-material-is-it does not record the answer');
run("setOutfitFabricFrom(0,'brought');");
if(run("draft.outfits[0].fabricFrom")!=='')F('the answer cannot be tapped off again');
// the warning about their cloth shows only when it IS their cloth
run("setOutfitFabricFrom(0,'brought');");
if(run("fabricSourceChips(0)").indexOf('no second piece')<0)
  F('picking the client’s own cloth says nothing about why it matters');
run("setOutfitFabricFrom(0,'studio');");
if(run("fabricSourceChips(0)").indexOf('no second piece')>=0)
  F('studio stock is being warned about as if it were irreplaceable');
run("closeModal();draft=null;");

/* 3) When the check is asked for, and when it would be noise. ------------------------ */
const QC=run("STAGES.indexOf('Quality Check')");
const mk=(stage,extra)=>run("fabricCheckNeeded("+JSON.stringify(Object.assign({stageIndex:stage,outfits:[{materials:['Aso-oke']}]},extra||{}))+")");
if(mk(0)!==false)F('the check is demanded before any work has started');
if(mk(1)!==true)F('work has started and nobody is asked to check the fabric');
if(mk(QC)!==false)F('the check is still being demanded at quality control, which is far too late to help');
if(mk(1,{fabricCheck:{ok:true}})!==false)F('the check is demanded again after somebody has already done it');
// nothing to check against means no prompt: a nag with no answer teaches people to ignore it
if(run("fabricCheckNeeded({stageIndex:1,outfits:[{}]})")!==false)
  F('an order that records no material, no photo and no source is still nagging about fabric');
// any one of the three is enough to have something to check
[['materials',"{materials:['Lace']}"],['a photo',"{photos:['sb:x']}"],['a source',"{fabricFrom:'brought'}"]].forEach(pair=>{
  if(run("fabricCheckNeeded({stageIndex:1,outfits:["+pair[1]+"]})")!==true)
    F('an order carrying '+pair[0]+' is not asked to check the fabric');
});

/* 4) The order says so, above quality control. --------------------------------------- */
run("loadExampleAs('bespoke');currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
const oid=run("(getOrders().find(o=>o.kind!=='sale')||{}).id");
if(!oid){F('no order to test the fabric check against');}
else{
  const setUp=extra=>run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+oid+"');"
    +"o.stageIndex=2;o.due=new Date(Date.now()+14*864e5).toISOString().slice(0,10);o.qc=null;delete o.fabricCheck;"
    +"o.outfits=[{name:'Agbada',materials:['Aso-oke · Royal blue'],fabricFrom:'"+extra+"',photos:[]}];"
    +"save('layi_dash_orders',l);})();");

  setUp('brought');
  let att=run("orderAttention(getOrders().find(o=>o.id==='"+oid+"'))");
  if(!att)F('an order being worked on with unchecked client fabric says nothing at all');
  else{
    if(!/checked it against the photo/i.test(att.text||''))F('the warning does not say what needs doing: '+att.text);
    if((att.sev||'')!=='var(--red)')F('the client’s own unchecked fabric is not the most serious thing on the order');
    if(!att.act)F('the warning offers no way to act on it');
  }
  setUp('studio');
  att=run("orderAttention(getOrders().find(o=>o.id==='"+oid+"'))");
  if(!att||!/checked/i.test(att.text||''))F('studio fabric is never checked at all');
  else if((att.sev||'')==='var(--red)')F('replaceable studio stock is being raised as loudly as the client’s own');

  /* 5) Ticking it in the update everyone already posts, signed and dated. ------------ */
  setUp('brought');
  run("openUpdate('"+oid+"');");
  const um=run("document.getElementById('modal').innerHTML")||'';
  if(um.indexOf('Fabric checked against the photo')<0)F('the progress update never offers the fabric check');
  if(um.indexOf('Aso-oke')<0)F('the update does not say what the fabric is supposed to be, so there is nothing to check against');
  if(!/no second piece/i.test(um))F('the update does not say that the client’s cloth cannot be replaced');
  run("document.getElementById('u_fabricOk').checked=true;document.getElementById('u_note').value='Cut today';saveUpdate();");
  const done=run("getOrders().find(o=>o.id==='"+oid+"')");
  if(!done.fabricCheck||!done.fabricCheck.ok)F('ticking the fabric check records nothing');
  else{
    if(!done.fabricCheck.by)F('the fabric check does not record who did it');
    if(!done.fabricCheck.at)F('the fabric check does not record when');
    if(done.fabricCheck.theirs!==true)F('the fabric check does not record that it was the client’s own cloth');
  }
  if(!(done.updates||[]).some(u=>/Fabric checked/i.test(u.note||'')))
    F('the fabric check leaves nothing in the order’s history');
  if(!(done.updates||[]).some(u=>/Cut today/.test(u.note||'')))
    F('recording the fabric check threw away the note that was typed with it');
  if(run("orderAttention(getOrders().find(o=>o.id==='"+oid+"'))&&/checked it against/i.test(orderAttention(getOrders().find(o=>o.id==='"+oid+"')).text||'')"))
    F('the order still says the fabric is unchecked after somebody checked it');
  // and it is not asked a second time
  run("openUpdate('"+oid+"');");
  if((run("document.getElementById('modal').innerHTML")||'').indexOf('Fabric checked against the photo')>=0)
    F('the fabric check is asked again on the next update');

  /* 6) The work order, which is the sheet the person cutting holds. ------------------ */
  let sheet=run("jobSheetInner(getOrders().find(o=>o.id==='"+oid+"'))");
  if(sheet.indexOf('OWN FABRIC')<0)F('the work order does not say the cloth is the client’s own');
  if(sheet.indexOf('Aso-oke')<0)F('the work order does not name the fabric');
  if(sheet.indexOf(run("fabricSourceLabel('brought')"))<0)F('the work order does not say where the fabric came from');
  if(!/Fabric checked by/.test(sheet))F('the work order does not carry the fabric check');
  if(!/Fabric checked by: _/.test(sheet))F('a printed work order has nowhere to sign the fabric check');
  // a studio-stock order gets no banner, or the banner stops meaning anything
  setUp('studio');
  sheet=run("jobSheetInner(getOrders().find(o=>o.id==='"+oid+"'))");
  if(sheet.indexOf('OWN FABRIC')>=0)F('every work order shouts about the client’s fabric, including the ones made from studio stock');
  if(sheet.indexOf(run("fabricSourceLabel('studio')"))<0)F('the work order does not say the fabric is the studio’s own either');
}

console.log('Fabric check audit:');
console.log('  sources: '+SRC.join(' · ')+'   irreplaceable: '+theirs);
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ the order records whose cloth it is, the work order says so where it cannot be missed,');
console.log('  ✓ and the check is asked once, after work starts and before QC, signed and dated');
