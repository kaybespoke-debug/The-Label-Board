// Per-piece production gate.
//
// One order can carry two things that are not made the same way: a bag and a belt, a gown
// and the gele that goes with it. They share a client, a price and a due date, and nothing
// else about how they are made. A belt has no fittings; a gele has no lasting.
//
// outfits[].stageIndex has always existed per item. What did not was a per-item stage SET,
// so every piece on an order was walked through the same list, and quality control gave one
// verdict between them: passing the belt passed the bag.
//
// Two things have to hold and they pull against each other. Each piece has to be able to
// walk its own stages and be checked as its own craft. And the ORDER still has to have one
// honest position on the board, which is where its least advanced piece is, because an
// order is done when the last thing on it is done.
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
const J=e=>JSON.parse(run('JSON.stringify('+e+')'));

/* 1) A piece walks its own stages, or the studio's when it names no craft. ------------ */
run("SETTINGS.branches=[{id:'b1',name:'Solo',active:true,does:['leather:make','garments:make']}];SETTINGS.productionStages=STAGE_PRESETS.bespoke.slice();applyStages();");
const studioStages=run("STAGES");
if(JSON.stringify(run("itemStages({})"))!==JSON.stringify(studioStages))
  F('a piece that names no craft is not walking the studio’s own stages, which is what every order in existence does');
const bagStages=run("itemStages({craft:'leather'})");
if(JSON.stringify(bagStages)===JSON.stringify(studioStages))
  F('a bag walks the same stages as the studio’s default, so naming its craft did nothing');
if(!bagStages.some(x=>/skiv|edge|hardware/i.test(x)))
  F('a bag is not walking a bag maker’s stages: '+bagStages.join(' | '));
if(run("itemStages({craft:'footwear'}).some(x=>/last|clicking/i.test(x))")!==true)
  F('a pair is not walking a shoemaker’s stages');

/* 2) Every pipeline shares its first and last stage, or fractions cannot be compared. - */
run("CRAFTS.map(c=>c.key)").forEach(k=>{
  const S=run("itemStages({craft:'"+k+"'})");
  if(S[0]!=='Order Received')F('a '+k+' piece does not start at Order Received, so 0% means something different on it');
  if(S[S.length-1]!=='Delivered')F('a '+k+' piece does not end at Delivered, so 100% means something different on it');
  if(S.length<3)F('a '+k+' piece has no stages between receiving and delivering');
});
// and the fraction is exact at both ends whatever the length
run("CRAFTS.map(c=>c.key)").forEach(k=>{
  const S=run("itemStages({craft:'"+k+"'})");
  if(run("itemProgress({craft:'"+k+"',stageIndex:0})")!==0)F('a '+k+' piece at the first stage is not at 0%');
  if(run("itemProgress({craft:'"+k+"',stageIndex:"+(S.length-1)+"})")!==1)F('a '+k+' piece at the last stage is not at 100%');
});

/* 3) The order sits where its least advanced piece sits. ----------------------------- */
// With every piece on the studio's own stages this must be EXACTLY the old answer, or
// every order that exists today would jump on the board the moment this shipped.
for(let a=0;a<studioStages.length;a++){
  for(let b=0;b<studioStages.length;b++){
    const got=run("orderStageFromItems({outfits:[{stageIndex:"+a+"},{stageIndex:"+b+"}]})");
    if(got!==Math.min(a,b)){F('two pieces on the studio’s own stages at '+a+' and '+b+' put the order at '+got+', not '+Math.min(a,b));a=b=99;}
  }
}
// a long pipeline and a short one: the order follows whichever is least far through
const longC=run("CRAFTS.map(c=>c.key).map(function(k){return [k,itemStages({craft:k}).length];}).sort(function(x,y){return y[1]-x[1];})[0][0]");
const near=run("orderStageFromItems({outfits:[{craft:'"+longC+"',stageIndex:1},{stageIndex:"+(studioStages.length-1)+"}]})");
if(near>1)F('one finished piece dragged the whole order forward past the piece still at the bench (order sat at '+near+')');
const bothDone=run("orderStageFromItems({outfits:[{craft:'"+longC+"',stageIndex:itemStages({craft:'"+longC+"'}).length-1},{stageIndex:"+(studioStages.length-1)+"}]})");
if(bothDone!==studioStages.length-1)F('every piece delivered and the order is not: '+bothDone);
// an order with no pieces at all keeps whatever it had, rather than resetting to the start
if(run("orderStageFromItems({stageIndex:4,outfits:[]})")!==4)F('an order with no pieces on it was reset to the beginning');

/* 4) Which orders are worth tracking piece by piece. --------------------------------- */
const HP=[
  ['one piece',                "{outfits:[{}]}",                                              false],
  ['two of the same kind',     "{outfits:[{},{}]}",                                           false],
  ['a bag and a belt',         "{outfits:[{craft:'leather'},{craft:'garments'}]}",             true ],
  ['a group order',            "{group:{on:true},outfits:[{person:'A'},{person:'B'}]}",        true ],
  // a group of one is one piece, and 'track each person' for a single person is noise
  ['a group of one',           "{group:{on:true},outfits:[{person:'A'}]}",                      false],
  ['a batch of identical work',"{batch:{on:true,qty:20},outfits:[{craft:'leather'},{craft:'garments'}]}",false]
];
HP.forEach(c=>{
  const got=run("hasOwnPieces("+c[1]+")");
  if(got!==c[2])F(c[0]+' '+(c[2]?'should':'should not')+' be tracked piece by piece');
});

/* 5) Stepping a piece walks ITS list and stops where its own dispatch is. ------------- */
run("loadExampleAs('bespoke');currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
run("SETTINGS.branches=[{id:'b1',name:getBranches()[0].name,active:true,does:['garments:make','leather:make']}];");
const pid=run("(getOrders().find(o=>o.kind!=='sale')||{}).id");
if(!pid){F('no order to track pieces on');}
else{
  const reset=()=>run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+pid+"');"
    +"o.qc=null;o.stageIndex=0;o.group={on:false};o.batch={on:false};"
    +"o.outfits=[{name:'Tote bag',craft:'leather',stageIndex:0,materials:['Leather'],fabricFrom:'studio'},"
    +"{name:'Agbada',craft:'garments',stageIndex:0,materials:['Aso-oke'],fabricFrom:'studio'}];"
    +"o.fabricCheck={ok:true,by:'gate',at:new Date().toISOString()};save('layi_dash_orders',l);})();");
  reset();
  if(run("hasOwnPieces(getOrders().find(o=>o.id==='"+pid+"'))")!==true)F('an order carrying a bag and an agbada is not tracked piece by piece');
  run("openGroup('"+pid+"');");
  let mk=run("document.getElementById('modal').innerHTML")||'';
  if(!mk)F('the pieces screen rendered nothing');
  if(mk.indexOf('Tote bag')<0||mk.indexOf('Agbada')<0)F('the pieces screen does not list both pieces');
  if(!/own stages/i.test(mk))F('the pieces screen does not say the pieces are made differently');
  // every handler it wires up has to exist
  const seen={};
  (mk.match(/onclick="[^"]*"/g)||[]).forEach(function(att){
    (att.match(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)||[]).forEach(function(hit){
      const fn=hit.replace(/[^\w$]/g,'');
      if(seen[fn])return;seen[fn]=1;
      if(run("typeof "+fn)!=='function')F('the pieces screen wires up '+fn+'(), which does not exist');
    });
  });
  // step the bag on by one and it moves through the BAG's stages
  run("groupStep(0,1);");
  const bagNow=run("itemStageName(getOrders().find(o=>o.id==='"+pid+"').outfits[0])");
  if(!/pattern|cutting/i.test(bagNow))F('stepping the bag did not move it through a bag maker’s stages, it reached "'+bagNow+'"');
  // and the order has not moved, because the agbada has not
  if(run("getOrders().find(o=>o.id==='"+pid+"').stageIndex")!==0)
    F('moving one piece moved the whole order, though the other piece has not started');
  // a piece cannot be pushed past its own dispatch
  for(let i=0;i<40;i++)run("groupStep(0,1);");
  const capped=run("itemStageIndex(getOrders().find(o=>o.id==='"+pid+"').outfits[0])");
  const bagDisp=run("itemDispatchIndex(getOrders().find(o=>o.id==='"+pid+"').outfits[0])");
  if(capped!==bagDisp)F('a piece was pushed past its own dispatch stage ('+capped+' vs '+bagDisp+')');
  // and cannot be pushed back before the beginning
  for(let i=0;i<60;i++)run("groupStep(1,-1);");
  if(run("itemStageIndex(getOrders().find(o=>o.id==='"+pid+"').outfits[1])")!==0)F('a piece was pushed back before Order Received');

  /* 6) Quality control, per piece. --------------------------------------------------- */
  reset();
  run("delete SETTINGS.qcChecklist;");
  const bagList=run("qcChecklistFor(getOrders().find(o=>o.id==='"+pid+"'),{craft:'leather'})");
  const garList=run("qcChecklistFor(getOrders().find(o=>o.id==='"+pid+"'),{craft:'garments'})");
  if(!bagList.some(x=>/hardware/i.test(x)))F('the bag on this order is not checked for its hardware');
  if(garList.some(x=>/hardware/i.test(x)))F('the agbada on this order is being checked for hardware it does not have');
  if(!garList.some(x=>/tried on/i.test(x)))F('the agbada is not tried on');
  if(bagList.some(x=>/tried on/i.test(x)))F('the bag is being tried on');

  run("openQC('"+pid+"');");
  let qk=run("document.getElementById('modal').innerHTML")||'';
  if(qk.indexOf('Which piece')<0)F('quality control does not offer the pieces separately');
  if(qk.indexOf('Tote bag')<0||qk.indexOf('Agbada')<0)F('the QC screen does not name both pieces');
  if(run("qcDraft.idx")!==0)F('quality control did not start on the first piece');
  // ticks made on one piece survive moving to the other and back
  run("qcDraft.items.forEach(function(it,i){document.getElementById('qc_'+i).checked=(i===0);});qcPick(1);");
  if(run("qcDraft.idx")!==1)F('picking the second piece did not switch to it');
  run("qcPick(0);");
  if(run("qcDraft.items[0].ok")!==true)F('a tick made on one piece was lost by looking at the other');

  // pass the first piece only
  run("openQC('"+pid+"',0);qcDraft.items.forEach(function(it,i){document.getElementById('qc_'+i).checked=true;});document.getElementById('qc_note').value='';passQC();");
  let o2=J("getOrders().find(o=>o.id==='"+pid+"')");
  if(!(o2.outfits[0].qc&&o2.outfits[0].qc.status==='passed'))F('passing a piece did not record a pass on that piece');
  if(o2.qc&&o2.qc.status==='passed')F('passing ONE piece passed the whole order, so the other was never checked');
  if(o2.stageIndex>=run("STAGES.indexOf('Ready for Delivery')"))F('the order reached Ready for Delivery with a piece still unchecked');
  if(!(o2.updates||[]).some(u=>/Tote bag/.test(u.note||'')))F('the order’s history does not say which piece passed');

  // now the second: the order passes and moves on
  run("openQC('"+pid+"',1);qcDraft.items.forEach(function(it,i){document.getElementById('qc_'+i).checked=true;});document.getElementById('qc_note').value='';passQC();");
  o2=J("getOrders().find(o=>o.id==='"+pid+"')");
  if(!(o2.qc&&o2.qc.status==='passed'))F('every piece passed and the order did not');
  if(o2.stageIndex<run("STAGES.indexOf('Ready for Delivery')"))F('every piece passed and the order did not reach Ready for Delivery');

  // failing one piece sends that piece back and leaves the other’s pass alone
  run("openQC('"+pid+"',0);document.getElementById('qc_0').checked=false;document.getElementById('qc_note').value='Strap uneven';failQC();");
  o2=J("getOrders().find(o=>o.id==='"+pid+"')");
  if(!(o2.outfits[0].qc&&o2.outfits[0].qc.status==='failed'))F('failing a piece did not record a fail on that piece');
  if(!(o2.outfits[1].qc&&o2.outfits[1].qc.status==='passed'))F('failing one piece threw away the pass on another, so a finished piece would be remade');
  if(!(o2.qc&&o2.qc.status==='failed'))F('a piece failed and the order does not say so');
  if(!/Strap uneven/.test((o2.qc&&o2.qc.note)||''))F('the reason the piece failed was not kept');
  const bagIdx=run("itemStageIndex(getOrders().find(o=>o.id==='"+pid+"').outfits[0])");
  const bagQC=run("itemStages(getOrders().find(o=>o.id==='"+pid+"').outfits[0]).indexOf('Quality Check')");
  if(bagQC>=0&&bagIdx>=bagQC)F('the failed piece was not sent back for rework on its own stages');
  if(run("itemStageIndex(getOrders().find(o=>o.id==='"+pid+"').outfits[1])")<run("itemStages(getOrders().find(o=>o.id==='"+pid+"').outfits[1]).indexOf('Ready for Delivery')"))
    F('the piece that passed was dragged back with the one that failed');

  /* 7) A single-piece order behaves exactly as it always did. ------------------------ */
  run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+pid+"');o.qc=null;o.stageIndex=0;"
    +"o.outfits=[{name:'Agbada',stageIndex:0,materials:['Aso-oke'],fabricFrom:'studio'}];"
    +"o.fabricCheck={ok:true,by:'gate',at:new Date().toISOString()};save('layi_dash_orders',l);})();");
  if(run("hasOwnPieces(getOrders().find(o=>o.id==='"+pid+"'))")!==false)F('a one-piece order is being offered a piece-by-piece screen it does not need');
  run("openQC('"+pid+"');");
  if(run("qcDraft.idx")!==-1)F('a one-piece order runs quality control on a piece rather than on itself');
  if((run("document.getElementById('modal').innerHTML")||'').indexOf('Which piece')>=0)
    F('a one-piece order is asked which piece to check');
  run("qcDraft.items.forEach(function(it,i){document.getElementById('qc_'+i).checked=true;});document.getElementById('qc_note').value='';passQC();");
  const single=J("getOrders().find(o=>o.id==='"+pid+"')");
  if(!(single.qc&&single.qc.status==='passed'))F('a one-piece order no longer passes quality control');
  if(single.stageIndex<run("STAGES.indexOf('Ready for Delivery')"))F('a one-piece order no longer moves to Ready for Delivery on a pass');
}

console.log('Per-piece production audit:');
console.log('  pipelines: '+run("CRAFTS.map(function(c){return c.key+' '+itemStages({craft:c.key}).length;}).join('  ')"));
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ each piece walks its own stages and is checked as its own craft,');
console.log('  ✓ the order sits where its least advanced piece sits, and a single-piece order is untouched');
