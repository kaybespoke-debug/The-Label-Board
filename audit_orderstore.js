// The orders store, in two halves.
//
// Orders is the only store that grows forever AND is rewritten in full on every stage move.
// Measured on this codebase: an order is about 1.7KB of JSON. A busy label after three years
// carries a 9MB orders blob; six stage moves an order across fifty signed-in devices is
// ~427GB a month of rebroadcast, about ₦51,800 of egress against a ₦65,000 subscription. A
// factory comes out at ₦368,000, five times what it pays.
//
// Almost all of that is finished work that will never change again. So the store is split:
// open work in one key, settled work in another. A stage move rewrites only the first.
//
// This gate exists because the failure mode is losing somebody's orders. Nothing above
// load() and save() knows about the split, so every check here is about the seam: that the
// same records come back, that the halves cannot disagree, and that "unsure" always lands on
// the safe side, which is live.
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
const LIVE='layi_dash_orders', DONE='layi_dash_orders_done';

/* 1) Nothing is lost. The one that matters. ------------------------------------------ */
const before=J('rawOrders()');
run('save("'+LIVE+'",rawOrders());');
const after=J('rawOrders()');
if(after.length!==before.length)
  F('a save lost orders: '+before.length+' went in, '+after.length+' came back');
{
  const b={},a={};
  before.forEach(o=>b[o.id]=JSON.stringify(o));
  after.forEach(o=>a[o.id]=JSON.stringify(o));
  const missing=Object.keys(b).filter(id=>!a[id]);
  const changed=Object.keys(b).filter(id=>a[id]&&a[id]!==b[id]);
  const extra=Object.keys(a).filter(id=>!b[id]);
  if(missing.length)F('these orders did not survive the split: '+missing.join(', '));
  if(changed.length)F('these orders came back different: '+changed.join(', '));
  if(extra.length)F('the split invented orders: '+extra.join(', '));
  if(after.length!==Object.keys(a).length)F('an order appears twice after the split');
}
// and it really did split, rather than quietly writing everything to one key
if(!_ls[DONE]||JSON.parse(_ls[DONE]).length===0)
  F('nothing was moved to the finished half, so the whole point of this is not happening');
if(JSON.parse(_ls[LIVE]).length+JSON.parse(_ls[DONE]).length!==before.length)
  F('the two halves do not add up to the orders that went in');

/* 2) What counts as finished, and what deliberately does not. ------------------------ */
const deli=run("STAGES.indexOf('Delivered')");
const settled=(extra)=>run("orderIsSettled(Object.assign({stageIndex:"+deli+",value:1000,paid:1000,outfits:[{price:1000}]},"+extra+"))");
if(settled('{}')!==true)F('a delivered order that is fully paid is not being treated as finished');
if(settled('{stageIndex:'+(deli-1)+'}')!==false)F('an order still on the board is being archived');
if(settled('{paid:0}')!==false)
  F('an order that is delivered but still OWED for is being archived, and it is the one that needs chasing');
if(settled('{quoted:true}')!==false)F('a quote is being archived as finished work');
if(settled('{quoted:true,confirmedAt:"2026-09-01"}')!==true)F('a confirmed order is not finished when it is delivered and paid');
if(run('orderIsSettled(null)')!==false)F('nothing at all is being treated as a finished order');
/* Unsure means live. If the test throws for any reason, the order must stay where it can
   still sync, because archiving something that is not finished stops it syncing on its next
   change and that is how an order silently stops moving. */
{
  /* An order whose own fields blow up when read. Built inside the sandbox and compared by
     id, because stringifying it out here would throw for the same reason. A plain {id:'X'}
     does NOT exercise this: orderIsSettled returns false on the stage check long before it
     touches anything that could fail, so the catch never runs and the check proves nothing. */
  const where=run("(function(){"
    +"var bad={id:'BAD',stageIndex:"+deli+",get value(){throw new Error('unreadable');}};"
    +"var out=splitOrders([bad]);"
    +"return out.live.length===1?'live':(out.done.length===1?'done':'lost');})()");
  if(where==='done')F('an order the test could not judge was archived, and it will stop syncing on its next change');
  if(where==='lost')F('an order the test could not judge was dropped entirely');
}

/* 3) A stage move sends the open work and nothing else. ------------------------------ */
run('save("'+LIVE+'",rawOrders());');
const doneBefore=_ls[DONE];
const liveBefore=_ls[LIVE];
{
  const id=run("(rawOrders().find(function(o){return (+o.stageIndex||0)<"+deli+"&&isClientOrder(o);})||{}).id");
  if(!id)F('no order still in production to move');
  else{
    /* Watch syncPush, not the stored bytes. The bytes of the finished half do not change
       either way; what costs money is whether it is SENT. Comparing the stored value looked
       like a check and was not: it passed with the push left in. */
    run('window.__pushed=[];window.__origPush=syncPush;syncPush=function(k){window.__pushed.push(k);window.__origPush(k);};');
    run("(function(){var l=rawOrders(),o=l.find(function(x){return x.id==='"+id+"';});o.stageIndex=(+o.stageIndex||0)+1;save('"+LIVE+"',l);})();");
    const pushed=J('window.__pushed');
    run('syncPush=window.__origPush;');
    if(pushed.indexOf(DONE)!==-1)
      F('moving one order along sent the finished half to every other device, which is the cost this was built to remove');
    if(pushed.indexOf(LIVE)===-1)F('the stage move sent nothing at all, so no other device sees it');
    if(_ls[LIVE]===liveBefore)F('the stage move did not reach the open half at all');
  }
}
// and the open half really is the smaller one
{
  const whole=run('JSON.stringify(rawOrders()).length');
  const live=(_ls[LIVE]||'').length;
  if(!(live<whole))F('the open half is not smaller than the whole store, so nothing was saved');
}

/* 4) An order settling crosses over, once. ------------------------------------------- */
{
  const id=run("(rawOrders().find(function(o){return (+o.stageIndex||0)<"+deli+"&&isClientOrder(o);})||{}).id");
  if(id){
    run("(function(){var l=rawOrders(),o=l.find(function(x){return x.id==='"+id+"';});"
       +"o.stageIndex="+deli+";o.paid=orderNet(o);save('"+LIVE+"',l);})();");
    const liveIds=JSON.parse(_ls[LIVE]).map(o=>o.id);
    const doneIds=JSON.parse(_ls[DONE]).map(o=>o.id);
    if(liveIds.indexOf(id)!==-1)F('a finished order is still in the open half');
    if(doneIds.indexOf(id)===-1)F('a finished order never reached the finished half');
    if(doneIds.filter(x=>x===id).length>1)F('a finished order is in the finished half twice');
    if(run("rawOrders().filter(function(o){return o.id==='"+id+"';}).length")!==1)
      F('the order appears twice once it has settled');
  }
}

/* 5) It can come back. An order re-opened, or a payment reversed, must return to live. - */
{
  const id=JSON.parse(_ls[DONE]).map(o=>o.id)[0];
  if(!id)F('nothing in the finished half to re-open');
  else{
    run("(function(){var l=rawOrders(),o=l.find(function(x){return x.id==='"+id+"';});o.paid=0;save('"+LIVE+"',l);})();");
    if(JSON.parse(_ls[LIVE]).map(o=>o.id).indexOf(id)===-1)
      F('an order that is owed for again did not come back to the half that still syncs');
    if(JSON.parse(_ls[DONE]).map(o=>o.id).indexOf(id)!==-1)
      F('the order is in both halves at once');
    if(run("rawOrders().filter(function(o){return o.id==='"+id+"';}).length")!==1)
      F('re-opening an order duplicated it');
  }
}

/* 6) Hydration. The cloud sends the two keys separately, as two rows of app_state. ---- */
{
  const whole=J('rawOrders()');
  const live=JSON.parse(_ls[LIVE]), done=JSON.parse(_ls[DONE]);
  run('store.set("'+LIVE+'","[]");store.set("'+DONE+'","[]");');
  if(run('rawOrders().length')!==0)F('clearing both halves did not empty the store');
  // exactly what _rtApplyState and the hydrate do: write each key raw, no splitting
  run('saveLocal("'+LIVE+'",'+JSON.stringify(live)+');');
  run('saveLocal("'+DONE+'",'+JSON.stringify(done)+');');
  const back=J('rawOrders()');
  if(back.length!==whole.length)
    F('hydrating from the two halves gave '+back.length+' orders, not '+whole.length);
  const ids=whole.map(o=>o.id).sort().join(',');
  if(back.map(o=>o.id).sort().join(',')!==ids)F('hydrating from the two halves lost or changed an order');
  // a device that has only ever seen the old single key still reads everything
  run('store.set("'+DONE+'",null);');
  run('saveLocal("'+LIVE+'",'+JSON.stringify(whole)+');');
  if(run('rawOrders().length')!==whole.length)
    F('a device upgrading from the single-blob version cannot read its own orders');
}

/* 7) The finished half has to actually sync, or it is a local-only archive. ----------- */
if(run("STATE_KEYS.indexOf('"+DONE+"')")<0)
  F('the finished half is not in STATE_KEYS, so it never leaves the device and a new phone sees half the history');
if(run("STATE_KEYS.indexOf('"+LIVE+"')")<0)F('the open half is not in STATE_KEYS');

console.log('Order store audit:');
{
  run('demoLogin();currentUser=getUsers().find(u=>u.roleId==="owner");save("'+LIVE+'",rawOrders());');
  const whole=run('JSON.stringify(rawOrders()).length'), live=(_ls[LIVE]||'').length;
  console.log('  a stage move sends '+Math.round(live/whole*100)+'% of the store on this demo ('
    +JSON.parse(_ls[LIVE]).length+' open, '+JSON.parse(_ls[DONE]).length+' finished)');
  console.log('  the share falls as a studio ages: the open half is the work in hand, not the history');
}
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ every order survives the split, the halves cannot disagree, and unsure stays live');
console.log('  ✓ a stage move leaves the finished half untouched, and both halves sync');
