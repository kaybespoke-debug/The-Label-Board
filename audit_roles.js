// Audits the dashboard for EVERY role AND every studio. For each role it sets the
// current user, renders that role's dashboard (owner / team / maker / cre layouts),
// then flags any clickable card that (a) jumps to a tab or (b) opens the OLD
// appointment form instead of the new detail view.
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(process.argv[2]||'layi_dashboard.html','utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';
while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const el=()=>({innerHTML:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){},scrollTop:0,value:''});
const cache={};const _ls={};
const doc={getElementById(i){return cache[i]||(cache[i]=el())},querySelector(){return el()},querySelectorAll(){return[]},createElement(){return el()},addEventListener(){},removeEventListener(){},body:el(),documentElement:el(),head:el()};
const sb={console,document:doc,localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]},clear(){}},setTimeout:f=>{try{f&&f()}catch(e){}return 0},clearTimeout(){},navigator:{userAgent:'node'},location:{href:'',hash:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);
vm.runInContext(code,sb,{filename:'x.js'});
sb.demoLogin();

const branches = JSON.parse(_ls['layi_dash_settings']||'{}').branches.map(b=>b.name);
// add a synthetic "assistant" role (appts+customers, no update/finance) → triggers the CRE layout
vm.runInContext(`(function(){var r=getRoles();if(!r.find(x=>x.id==='assistant')){r.push({id:'assistant',name:'Office Assistant',perms:{appts:1,customers:1,supplies:1,receivables:1,update:0,finance:0,seeProfit:0,allOrders:1,tasks:1,attendance:1}});setRoles(r);}})()`, sb);

// staff id linked for the tailor (maker) view
const staff = JSON.parse(_ls['layi_dash_staff']||'[]');
const tailorSid = (staff.find(s=>/tailor|maker|workroom/i.test((s.role||'')+(s.specialty||'')))||staff[0]||{}).id||'';

function setUser(roleId, staffId){
  vm.runInContext(`currentUser={id:'u-${roleId}',name:'${roleId}',roleId:'${roleId}',staffId:'${staffId||''}',active:true};`, sb);
}
function modeOf(){ return sb.dashboardMode(); }

const DASH_IDS=['ownerFinance','dashMini','dashHero','todayStrip','dashAppts','dashSalesTrio','attention','branchCard','branchRow','dueOrders','dashBars','altDash'];
const TABJUMP=/\bgo\('(finance|expenses|orders|production|supplies|customers|sales|team|calendar|logistics|mywork)'\)/;
const OLDFORM=/openAppt\('[^')]+'\)/; // openAppt with an id = old edit-form as detail (should be openApptDetail)

function handlers(id){
  let h=(cache[id]&&cache[id].innerHTML)||'';
  h=h.replace(/<span class="ph-act"[^>]*>[\s\S]*?<\/span>/g,''); // strip "see all" header links
  const out=[];const rx=/onclick="([^"]*)"/g;let mm;while((mm=rx.exec(h)))out.push(mm[1]);return out;
}

// Discover EVERY role from getRoles() at runtime — built-in or custom, present or added later — so coverage
// never needs editing here. The synthetic 'assistant' above guarantees the CRE layout stays represented.
const roleInfo=vm.runInContext('getRoles().map(function(r){return {id:r.id,maker:!!(r.perms&&r.perms.allOrders===0)};})',sb);
const roles=roleInfo.map(r=>r.id);
const makerRoles=new Set(roleInfo.filter(r=>r.maker).map(r=>r.id)); // maker layout needs a linked staff id
const staffFor=role=>makerRoles.has(role)?tailorSid:'';
let problems=[];
roles.forEach(role=>{
  setUser(role, staffFor(role));
  const mode=modeOf();
  ['all',...branches].forEach(bv=>{
    sb.activeBranchView=bv;
    try{ sb.renderActivity(); }catch(e){ problems.push(`[${role}/${mode}/${bv}] renderActivity threw → ${e.message}`); return; }
    DASH_IDS.forEach(id=>{
      handlers(id).forEach(h=>{
        if(TABJUMP.test(h)) problems.push(`[${role}/${mode}/${bv}] #${id} tab-jump → ${h}`);
        if(OLDFORM.test(h)) problems.push(`[${role}/${mode}/${bv}] #${id} old appt form → ${h}`);
      });
    });
  });
});

// Direct render of the two role-specific layouts (belt and braces), checking their output.
// The roles are discovered by layout mode, not named — a maker-mode role and a cre-mode role.
const makerRoleId=[...makerRoles][0]||roles.find(r=>{setUser(r,staffFor(r));return modeOf()==='maker';});
if(makerRoleId){ setUser(makerRoleId, tailorSid); sb.activeBranchView='all';
  try{ sb.renderMakerDash(); handlers('altDash').forEach(h=>{ if(TABJUMP.test(h))problems.push('[maker direct] tab-jump → '+h); }); }catch(e){ problems.push('renderMakerDash threw → '+e.message); } }
const creRoleId=roles.find(r=>{setUser(r,staffFor(r));return modeOf()==='cre';});
if(creRoleId){ setUser(creRoleId,'');
  try{ sb.renderCreDash(); handlers('altDash').forEach(h=>{ if(TABJUMP.test(h))problems.push('[cre direct] tab-jump → '+h); if(OLDFORM.test(h))problems.push('[cre direct] old appt form → '+h); }); }catch(e){ problems.push('renderCreDash threw → '+e.message); } }

// Receivables visibility & finance-exposure guards per role
// kind: 'full' = sees full finance (incl. Outstanding), 'recv' = receivables-only cards, 'none' = no finance
function dashHtml(){ return ((cache['ownerFinance']&&cache['ownerFinance'].innerHTML)||'')+((cache['altDash']&&cache['altDash'].innerHTML)||''); }
// Expected finance exposure is DERIVED from the role's own permissions, not a hardcoded role-name table.
// This is a consistency check: what the dashboard renders must match what the permission model grants.
//   full = sees profit/outstanding · recv = receivables-only · none = no finance at all
function financeKind(){ if(sb.can('finance')||sb.canSeeProfit())return 'full'; if(sb.canReceivables())return 'recv'; return 'none'; }
roles.forEach(function(role){
  setUser(role, staffFor(role)); sb.activeBranchView='all';
  var kind=financeKind();
  if(cache['ownerFinance'])cache['ownerFinance'].innerHTML=''; if(cache['altDash'])cache['altDash'].innerHTML='';
  try{ sb.renderActivity(); }catch(e){ problems.push('[recv:'+role+'] renderActivity threw → '+e.message); return; }
  var h=dashHtml();
  var hasChase=/openChaseList|Owed to us|To follow up/.test(h);
  var hasOutstanding=/openDashOutstanding/.test(h);
  var hasProfit=/openDashProfit/.test(h);
  var hasExpenses=/openDashFlow\('out'\)/.test(h);
  if(kind==='full'){ if(!hasOutstanding) problems.push('[recv:'+role+'] full-finance role missing Outstanding'); }
  else if(kind==='recv'){ if(!hasChase) problems.push('[recv:'+role+'] receivables role missing chase/Owed cards'); if(hasProfit) problems.push('[recv:'+role+'] should NOT see profit'); if(hasExpenses) problems.push('[recv:'+role+'] should NOT see expenses'); }
  else { if(hasChase||hasOutstanding||hasProfit||hasExpenses) problems.push('[recv:'+role+'] should see NO finance but some is present'); }
  if(sb.canReceivables()){ try{ sb.openChaseList(); }catch(e){ problems.push('[recv:'+role+'] openChaseList threw → '+e.message); } }
});

// Orders page: every KPI card must be clickable (no dead cards) for every discovered role
roles.forEach(function(role){
  setUser(role, staffFor(role)); sb.activeBranchView='all'; sb.ordersPeriod='all';
  if(cache['ordersStats'])cache['ordersStats'].innerHTML='';
  try{ sb.renderOrders(); }catch(e){ problems.push('[orders:'+role+'] renderOrders threw → '+e.message); return; }
  const oh=(cache['ordersStats']&&cache['ordersStats'].innerHTML)||'';
  const cards=(oh.match(/class="stat /g)||[]).length;
  const clicks=(oh.match(/onclick="ordersDrill/g)||[]).length;
  if(cards>0 && clicks!==cards) problems.push('[orders:'+role+'] '+(cards-clicks)+' of '+cards+' KPI cards have no drill');
});

// A KPI stat card must open a breakdown, never navigate to another tab — and this holds WHEREVER a card
// renders, not just on the dashboard. So render every page and scan EVERY container the app wrote to for a
// stat card whose onclick is a tab-jump. No hardcoded container list → finStats, potStats, mktStats and any
// future tab's cards are all covered automatically, for every discovered role.
roles.forEach(function(role){
  setUser(role, staffFor(role)); sb.activeBranchView='all';
  Object.keys(cache).forEach(function(id){ if(cache[id]) cache[id].innerHTML=''; });
  try{ sb.renderAll(); }catch(e){ problems.push('[pages:'+role+'] renderAll threw → '+e.message); }
  try{ if(sb.can('marketing')) sb.renderMarketing(); }catch(e){ problems.push('[pages:'+role+'] renderMarketing threw → '+e.message); }
  Object.keys(cache).forEach(function(id){
    const h=(cache[id]&&cache[id].innerHTML)||'';
    h.split('<div class="stat ').slice(1).forEach(function(seg){                 // each stat card in this container
      const card='<div class="stat '+seg.split('<div class="stat ')[0];
      const oc=(card.match(/onclick="([^"]*)"/)||[])[1]||'';
      if(TABJUMP.test(oc)) problems.push('[card-jump:'+role+'] #'+id+' → '+oc);
    });
  });
});

// Reporting-line features must work for EVERY discovered role — driven by whether the linked
// staff has direct reports, NOT by role name. Link each role to a supervisor (sees the panel) and
// to a no-reports person (sees nothing, silently).
(function(){
  const st=JSON.parse(_ls['layi_dash_staff']||'[]');
  const supervisor=st.find(s=>st.some(x=>x.manager===s.id));
  const loner=st.find(s=>!st.some(x=>x.manager===s.id)&&(s.status||'Active')!=='Left Company');
  if(!supervisor){problems.push('[reporting] demo seed has no supervisor to exercise');return;}
  roles.forEach(function(role){
    sb.activeBranchView='all';
    setUser(role, supervisor.id);
    if(cache['myTeamPanel'])cache['myTeamPanel'].innerHTML='';
    try{ sb.renderMyTeamPanel(); }catch(e){ problems.push('[reporting:'+role+'] renderMyTeamPanel threw (supervisor) → '+e.message); return; }
    const h=(cache['myTeamPanel']&&cache['myTeamPanel'].innerHTML)||'';
    if(!/My team/.test(h)) problems.push('[reporting:'+role+'] supervisor with reports sees NO team panel');
    const repCount=sb.directReports(supervisor.id,{scoped:true}).length;
    const rowCount=(h.match(/class="srow"/g)||[]).length;
    if(rowCount!==repCount) problems.push('[reporting:'+role+'] team panel shows '+rowCount+' report rows, expected '+repCount);
    if(loner){ setUser(role, loner.id);
      if(cache['myTeamPanel'])cache['myTeamPanel'].innerHTML='NON-EMPTY';
      try{ sb.renderMyTeamPanel(); }catch(e){ problems.push('[reporting:'+role+'] renderMyTeamPanel threw (no reports) → '+e.message); return; }
      const h2=(cache['myTeamPanel']&&cache['myTeamPanel'].innerHTML)||'';
      if(h2!=='') problems.push('[reporting:'+role+'] a user with no reports still shows a team panel');
    }
  });
})();

console.log('Roles tested: '+roles.join(', '));
console.log('Modes: '+roles.map(r=>{setUser(r,staffFor(r));return r+'='+modeOf();}).join(', '));
console.log('Branches: '+branches.join(', ')+'\n');
console.log(problems.length? 'GAPS ('+problems.length+'):\n'+problems.map(p=>'  • '+p).join('\n') : 'No tab-jump / old-form gaps found for ANY role on ANY studio.');
process.exit(problems.length?1:0);
