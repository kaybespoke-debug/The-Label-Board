// Renders every tab (as owner) and lists any KPI stat card that has no click/drill.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
// add a synthetic office-assistant role (CRE-style layout)
vm.runInContext(`(function(){var r=getRoles();if(!r.find(x=>x.id==='assistant')){r.push({id:'assistant',name:'Office Assistant',perms:{appts:1,customers:1,supplies:1,receivables:1,products:1,sales:1,logistics:1,attendance:1,update:0,finance:0,seeProfit:0,allOrders:1}});setRoles(r);}})()`, sb);
const branches=JSON.parse(_ls['layi_dash_settings']||'{}').branches.map(b=>b.name);
const staff=JSON.parse(_ls['layi_dash_staff']||'[]');
const tailorSid=(staff.find(s=>/tailor|maker/i.test((s.role||'')))||staff[0]||{}).id||'';
function setUser(roleId,staffId){vm.runInContext(`currentUser={id:'u-${roleId}',roleId:'${roleId}',staffId:'${staffId||''}',active:true};`,sb);}

function deadCards(id){
  const h=(cache[id]&&cache[id].innerHTML)||'';if(!h)return null;
  const parts=h.split('<div class="stat ');const dead=[];let total=0;
  for(let i=1;i<parts.length;i++){const seg='<div class="stat '+parts[i];const cardEnd=seg.indexOf('<div class="stat ',5);const card=cardEnd>0?seg.slice(0,cardEnd):seg;total++;
    const hasClick=/class="stat [^"]*clickable/.test(card)||/onclick="/.test(card.split('</div>').slice(0,2).join('</div>'));
    if(!hasClick){const lm=card.match(/class="sl">([^<]*)</);dead.push(lm?lm[1].trim():'(?)');}}
  return {total,dead};
}
let problems=[];
// Discover EVERY role from getRoles() at runtime — any role added later (built-in or custom) is swept automatically.
// The synthetic 'assistant' above guarantees the CRE layout (update:0) is represented even if no seeded role uses it.
const roleInfo=vm.runInContext('getRoles().map(function(r){return {id:r.id,maker:!!(r.perms&&r.perms.allOrders===0)};})',sb);
const roles=roleInfo.map(r=>r.id);
const makerRoles=new Set(roleInfo.filter(r=>r.maker).map(r=>r.id)); // maker layout needs a linked staff id
roles.forEach(role=>{ setUser(role, makerRoles.has(role)?tailorSid:'');
  ['all',...branches].forEach(bv=>{ sb.activeBranchView=bv; sb.ordersPeriod='all';
    Object.keys(cache).forEach(id=>{if(cache[id])cache[id].innerHTML='';});
    try{ sb.renderAll(); }catch(e){ problems.push(`[${role}/${bv}] renderAll threw → ${e.message}`); return; }
    // renderAll() does NOT render Marketing — it is only rendered from go('marketing').
    // Drive it explicitly, or #mktStats stays empty and its cards are never swept.
    try{ if(sb.can('marketing')) sb.renderMarketing(); }catch(e){ problems.push(`[${role}/${bv}] renderMarketing threw → ${e.message}`); }
    // Scan EVERY container the app rendered into — no hardcoded list, so a new tab's stat cards are covered automatically.
    Object.keys(cache).forEach(id=>{const r=deadCards(id);if(r&&r.dead.length)problems.push(`[${role}/${bv}] #${id}: ${r.dead.join(', ')}`);});
  });
});
console.log('Roles: '+roles.join(', '));
console.log(problems.length? 'DEAD CARDS ('+problems.length+'):\n'+[...new Set(problems)].map(p=>'  • '+p).join('\n') : 'No dead KPI cards on any tab, for any role, on any studio.');
process.exit(problems.length?1:0);

