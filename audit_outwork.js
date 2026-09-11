// Work sent out.
//
// Beading, monogramming, embroidery, soling, printing. The piece leaves the workroom, sits
// with somebody else for a week, and comes back. Nothing in the app could say that, so a job
// out at an embroiderer looked exactly like a job nobody had touched: stuck at a stage,
// going quietly late, with the workroom apparently idle and nobody to ask.
//
// The decision this gate protects is that it is NOT a new record. Sending work out is
// already a cost with a supplier's name on it, which is how the money reaches profit per
// order. Making that same line a job costs nothing in the books and cannot disagree with
// them, because it IS them. So the first thing checked is that the money did not move.
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
const day=n=>run("(function(){var d=new Date();d.setDate(d.getDate()+("+n+"));return d.toISOString().slice(0,10);})()");

/* 0) It is a cost line, not a new store. --------------------------------------------- */
if(/layi_dash_outwork|layi_dash_vendorjobs/.test(html))
  F('a separate store for outsourced work has appeared, which is a second set of books to reconcile');
[['a plain cost',"{label:'Lace',amount:5000}",false],
 ['work sent out',"{label:'Beading',amount:30000,supplier:'Musa',out:true}",true]].forEach(c=>{
  if(run("isOutwork("+c[1]+")")!==c[2])F(c[0]+' '+(c[2]?'is not':'is')+' being treated as work sent out');
});

/* 1) The money does not move. -------------------------------------------------------- */
// This is the whole reason for putting it on the cost line, so it is checked first and hard.
const plain="{costs:[{label:'Beading',amount:30000,supplier:'Musa'}]}";
const sent ="{costs:[{label:'Beading',amount:30000,supplier:'Musa',out:true,sentAt:'2026-09-01',dueAt:'2026-09-08'}]}";
if(run("orderCost("+plain+")")!==run("orderCost("+sent+")"))
  F('marking a cost as sent out changed what the order cost, so the books and the bench now disagree');
if(run("orderCost("+sent+")")!==30000)
  F('work sent out is not counted in the order cost at all, so the job looks more profitable than it is');
const back="{costs:[{label:'Beading',amount:30000,supplier:'Musa',out:true,sentAt:'2026-09-01',backAt:'2026-09-09'}]}";
if(run("orderCost("+back+")")!==30000)
  F('work that came back stopped costing anything');

/* 2) Out, late, and back. ------------------------------------------------------------ */
const mk=(extra)=>"{costs:[Object.assign({label:'Beading',amount:30000,supplier:'Musa Beads',out:true},"+extra+")]}";
if(run("outworkPending("+mk("{sentAt:'"+day(-5)+"'}")+").length")!==1)F('a piece that is out is not counted as out');
if(run("outworkPending("+mk("{sentAt:'"+day(-5)+"',backAt:'2026-09-09'}")+").length")!==0)F('a piece that came back is still counted as out');
if(run("outworkLate(Object.assign({out:true},{dueAt:'"+day(-3)+"'}))")!==true)F('a piece three days past its due-back date is not late');
if(run("outworkLate(Object.assign({out:true},{dueAt:'"+day(3)+"'}))")!==false)F('a piece due back in three days is being called late');
if(run("outworkLate(Object.assign({out:true},{dueAt:'"+day(-3)+"',backAt:'2026-09-09'}))")!==false)F('a piece that came back is still being called late');
// no date agreed is not the same as late: a vendor who never gave a date cannot have missed it
if(run("outworkLate({out:true,sentAt:'"+day(-30)+"'})")!==false)F('a piece with no agreed date back is being called late anyway');
if(run("outworkDaysOut({sentAt:'"+day(-6)+"'})")!==6)F('how long a piece has been out is wrong');

/* 3) The workroom does not look idle. ------------------------------------------------ */
run("loadExampleAs('bespoke');currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
const oid=run("(getOrders().find(o=>isClientOrder(o))||{}).id");
if(!oid){F('no order to send work out from');}
else{
  const setOut=(extra)=>run("(function(){var l=rawOrders(),o=l.find(x=>x.id==='"+oid+"');"
    +"o.qc=null;o.stageIndex=2;o.quoted=false;delete o.confirmedAt;o.due='"+day(20)+"';"
    +"o.fabricCheck={ok:true,by:'gate',at:new Date().toISOString()};"
    +"o.costs=[Object.assign({label:'Beading',amount:30000,supplier:'Musa Beads',out:true},"+extra+")];"
    +"save('layi_dash_orders',l);})();");

  // out, not yet due
  setOut("{sentAt:'"+day(-3)+"',dueAt:'"+day(4)+"'}");
  let st=J("ledgerStatus(getOrders().find(o=>o.id==='"+oid+"'))");
  if(!/musa/i.test(st.txt||''))F('an order out at a vendor does not say who has it, it says "'+st.txt+'"');
  if(html.indexOf('.opill.'+st.cls)<0)F('the sent-out status uses a pill style that does not exist: '+st.cls);
  let att=J("orderAttention(getOrders().find(o=>o.id==='"+oid+"'))");
  if(!att)F('an order sitting at a vendor says nothing, so it reads as work nobody has touched');
  else{
    if(!/musa beads/i.test(att.text||''))F('the nudge does not name who has the piece: '+att.text);
    if(!/3 days/i.test(att.text||''))F('the nudge does not say how long they have had it: '+att.text);
    if(!att.act||!/markOutworkBack/.test(att.act.fn||''))F('there is no way to say the piece came back');
  }

  // out and late: now it is somebody else's delay and the action is to chase them
  setOut("{sentAt:'"+day(-12)+"',dueAt:'"+day(-4)+"'}");
  att=J("orderAttention(getOrders().find(o=>o.id==='"+oid+"'))");
  if(!att||!/late back/i.test(att.text||''))F('a piece late back from a vendor is not flagged as late back: '+(att&&att.text));
  if(!att||(att.sev||'')!=='var(--red)')F('a piece four days late back from a vendor is not treated as serious');
  if(!/chase them/i.test((att&&att.text)||''))F('the nudge does not say whose job it is to chase: '+(att&&att.text));
  st=J("ledgerStatus(getOrders().find(o=>o.id==='"+oid+"'))");
  if(st.cls!=='amber')F('a late piece at a vendor looks the same as one that is on time');

  /* 4) It came back. ---------------------------------------------------------------- */
  run("markOutworkBack('"+oid+"',0);");
  let o2=J("getOrders().find(o=>o.id==='"+oid+"')");
  if(!o2.costs[0].backAt)F('saying a piece came back records nothing');
  if(run("outworkPending(getOrders().find(o=>o.id==='"+oid+"')).length")!==0)F('the piece is still counted as out after it came back');
  if(!(o2.updates||[]).some(u=>/back from musa beads/i.test(u.note||'')))
    F('the order history does not say the work came back, and somebody will ask in a week');
  if(!(o2.updates||[]).some(u=>/12 days/i.test(u.note||'')))
    F('the history does not say how long it was out, which is the only way to learn a vendor is slow');
  if(run("orderCost(getOrders().find(o=>o.id==='"+oid+"'))")!==30000)F('the cost changed when the piece came back');
  // and it cannot come back twice
  const at1=o2.costs[0].backAt;
  run("markOutworkBack('"+oid+"',0);");
  if(run("getOrders().find(o=>o.id==='"+oid+"').costs[0].backAt")!==at1)F('a piece can come back twice, rewriting when it did');
  // once everything is back the order goes on being an ordinary order
  att=J("orderAttention(getOrders().find(o=>o.id==='"+oid+"'))");
  if(att&&/musa|late back/i.test(att.text||''))F('the order is still being nagged about work that has come back');

  /* 5) The order says what is out, to everybody, not only to whoever can see money. --- */
  setOut("{sentAt:'"+day(-3)+"',dueAt:'"+day(4)+"'}");
  const blk=run("outworkBlock(getOrders().find(o=>o.id==='"+oid+"'))");
  if(!blk)F('the order shows nothing about the work that is out');
  if(blk.indexOf('Musa Beads')<0)F('the block does not name who has it');
  if(blk.indexOf('Beading')<0)F('the block does not say what went out');
  if(!/markOutworkBack/.test(blk))F('the block offers no way to say it came back');
  if(/30,000|30000/.test(blk))F('what the work cost is being shown to everybody who can see the order');
  // a machinist who cannot see money still sees where the piece is
  run("currentUser=getUsers().find(u=>u.roleId!=='owner')||currentUser;");
  const blkStaff=run("outworkBlock(getOrders().find(o=>o.id==='"+oid+"'))");
  if(!blkStaff||blkStaff.indexOf('Musa Beads')<0)
    F('somebody who cannot see the money cannot see where the piece is either');
  run("currentUser=getUsers().find(u=>u.roleId==='owner');");
  // an order with nothing out shows no block at all
  if(run("outworkBlock({costs:[{label:'Lace',amount:5000}]})")!=='')
    F('an order that has sent nothing out is being shown an empty Sent out section');

  /* 6) The order form can send a line out, and take it back. ------------------------- */
  run("openOrder('"+oid+"');");
  const form=run("document.getElementById('modal').innerHTML")||'';
  if(form.indexOf('Sent out to be done')<0)F('there is no way to say a cost was work sent out');
  if(form.indexOf('Due back')<0)F('the form does not ask when it is due back');
  // every handler the form wires up exists
  // an inline handler can contain real JavaScript, so skip the keywords that look like calls
  const KEYWORDS={'if':1,'for':1,'while':1,'switch':1,'catch':1,'return':1,'typeof':1,'function':1,'new':1,'delete':1,'void':1};
  const seen={};
  (form.match(/onclick="[^"]*"|onchange="[^"]*"|oninput="[^"]*"/g)||[]).forEach(function(att2){
    (att2.match(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)||[]).forEach(function(hit){
      const fn=hit.replace(/[^\w$]/g,'');
      if(seen[fn]||KEYWORDS[fn])return;seen[fn]=1;
      if(run("typeof "+fn)!=='function')F('the order form wires up '+fn+'(), which does not exist');
    });
  });
  // turning it on stamps the day it went, so nobody has to type today's date
  run("draft.costs=[{label:'Soling',amount:9000,supplier:'',out:false}];toggleCostOut(0,true);");
  if(!run("draft.costs[0].out"))F('marking a cost as sent out does not stick');
  if(!run("draft.costs[0].sentAt"))F('sending work out does not record the day it went');
  // turning it off clears the dates rather than leaving them on something that never left
  /* Through the FIELDS: toggleCostOut() calls syncOrderDraft() first, which reads the date
     inputs. Setting the draft directly would be wiped by that read and the check would pass
     whatever the code did. */
  run("document.getElementById('c_sent_0').value='"+day(-1)+"';document.getElementById('c_dueb_0').value='"+day(5)+"';");
  run("toggleCostOut(0,false);");
  if(run("draft.costs[0].out"))F('a cost cannot be turned back into a plain purchase');
  if(run("draft.costs[0].sentAt||draft.costs[0].dueAt||''")!=='')
    F('a cost that never left still carries the day it was sent and the day it is due back');
  run("closeModal();draft=null;");
}

/* 7) The demo shows both states. ----------------------------------------------------- */
run("demoLogin();currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
const allOut=run("getOrders().reduce(function(n,o){return n+orderOutwork(o).length;},0)");
const stillOut=run("getOrders().reduce(function(n,o){return n+outworkPending(o).length;},0)");
if(!allOut)F('the demo sends nothing out, so nobody ever sees the feature working');
if(!stillOut)F('the demo has nothing still out at a vendor, so the waiting state is never seen');
if(stillOut>=allOut)F('the demo has nothing that came back, so the finished state is never seen');

console.log('Sent-out work audit:');
console.log('  it is a cost line with dates on it '+String.fromCharCode(8212)+' no second record, no second set of books');
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ the money does not move, the order says who has the piece and for how long,');
console.log('  ✓ late back is chased as the vendor’s delay, and coming back is recorded once');
