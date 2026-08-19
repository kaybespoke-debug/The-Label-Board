// Audits the dashboard across ALL studios. For each branch view it renders the
// dashboard, then inspects every clickable element's onclick to flag any that
// still jump to a tab (go('...')) rather than opening a breakdown/detail modal.
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
console.log('Branches: '+branches.join(', ')+'\n');

// dashboard element ids that hold clickable cards
const DASH_IDS=['ownerFinance','dashMini','dashHero','todayStrip','dashAppts','dashSalesTrio','attention','branchCard','branchRow','dueOrders','dashBars'];
// onclick targets we consider "tab jumps" (bad for a card that should drill)
const TABJUMP=/\bgo\('(finance|expenses|orders|production|supplies|customers|sales|team|calendar|logistics)'\)/;

function handlersIn(idOrHtml){
  let h = (cache[idOrHtml] && cache[idOrHtml].innerHTML) || idOrHtml || '';
  h = h.replace(/<span class="ph-act"[^>]*>[\s\S]*?<\/span>/g,''); // strip "see all" header nav links
  const out=[]; const rx=/onclick="([^"]*)"/g; let m2;
  while((m2=rx.exec(h))) out.push(m2[1]);
  return out;
}

let problems=[];
['all',...branches].forEach(bv=>{
  sb.activeBranchView=bv;
  try{ sb.renderActivity(); }catch(e){ problems.push(bv+': renderActivity threw → '+e.message); return; }
  DASH_IDS.forEach(id=>{
    handlersIn(id).forEach(h=>{ if(TABJUMP.test(h)) problems.push(`[${bv}] #${id} → ${h}`); });
  });
});

// branch report + preview handlers (rendered once, cover all branches)
sb.activeBranchView='all';
try{ sb.openBranchReport(); }catch(e){ problems.push('openBranchReport threw → '+e.message); }
handlersIn('modal').forEach(h=>{ if(TABJUMP.test(h)) problems.push(`[report] modal → ${h}`); });
// The branch-preview cards are .bpv-stat, built by a LOCAL stat() helper inside
// openBranchPreview() — not the global stat(). No other gate looks at them.
// Each figure must drill into its OWN list, and that list must total the same figure.
const BPV_EXPECT={'revenue':'revenue','active orders':'active','overdue':'overdue','outstanding':'outstanding'};
function bpvCards(html){
  const out=[];const rx=/<div class="bpv-stat"([^>]*)>([\s\S]*?)(?=<div class="bpv-stat"|$)/g;let mm;
  while((mm=rx.exec(html))){
    const attrs=mm[1]||'',seg=mm[2]||'';
    const lm=seg.match(/<div class="bpv-label">([\s\S]*?)<\/div>/);
    const vm2=seg.match(/<div class="bpv-val[^"]*">([\s\S]*?)<\/div>/);
    const om=attrs.match(/openBranchDrill\('[^']*','([^']+)'\)/);
    const strip=s=>(s||'').replace(/<[^>]*>/g,'').replace(/›/g,'').trim();
    out.push({label:strip(lm&&lm[1]).toLowerCase(),value:strip(vm2&&vm2[1]),type:om?om[1]:null});
  }
  return out;
}
branches.forEach(bn=>{
  try{ sb.openBranchPreview(bn); }catch(e){ problems.push('openBranchPreview('+bn+') threw → '+e.message); return; }
  const hs=handlersIn('modal');
  const drillable = hs.some(h=>/openBranchDrill/.test(h));
  const jumps = hs.filter(h=>TABJUMP.test(h)||/setBranchView\([^)]*\);?\s*go/.test(h));
  if(!drillable) problems.push(`[preview:${bn}] stats are NOT drillable (no openBranchDrill)`);
  jumps.forEach(h=>problems.push(`[preview:${bn}] jump → ${h}`));

  const cards=bpvCards((cache['modal']&&cache['modal'].innerHTML)||'');
  cards.forEach(c=>{
    const exp=BPV_EXPECT[c.label];
    if(!exp) return;
    const nonZero=/[1-9]/.test(c.value);
    if(nonZero && !c.type){ problems.push(`[preview:${bn}] "${c.label}" = ${c.value} has no drill-down`); return; }
    if(!c.type) return;
    if(c.type!==exp){ problems.push(`[preview:${bn}] "${c.label}" drills into '${c.type}' (expected '${exp}')`); }
    // figure == drill-down: only for plain counts (money cards carry a currency symbol)
    if(/^\d+$/.test(c.value)){
      try{ sb.openBranchDrill(bn,c.type); }catch(e){ problems.push(`[preview:${bn}] openBranchDrill('${c.type}') threw → ${e.message}`); return; }
      const rows=(((cache['modal']&&cache['modal'].innerHTML)||'').match(/class="bd-row"/g)||[]).length;
      if(rows!==+c.value) problems.push(`[preview:${bn}] "${c.label}" card says ${c.value} but its drill-down lists ${rows}`);
    }
  });
});

// per-branch: does the finance card actually carry the NEW drill handlers?
['all',...branches].forEach(bv=>{
  sb.activeBranchView=bv; try{sb.renderActivity();}catch(e){}
  const h=(cache['ownerFinance']&&cache['ownerFinance'].innerHTML)||'';
  // the owner finance strip must drill into money breakdowns (accrual P&L cards), not be inert
  if(h && !/openBreakdown/.test(h)) problems.push(`[${bv}] ownerFinance missing money breakdown drill`);
});

// per-branch: low-stock attention rows must reference ONLY that branch's supplies (sync)
const supplies=JSON.parse(_ls['layi_dash_supplies']||'[]');
const supBranch={}; supplies.forEach(s=>supBranch[s.id]=s.branch);
branches.forEach(bv=>{
  sb.activeBranchView=bv; try{sb.renderActivity();}catch(e){}
  const h=(cache['attention']&&cache['attention'].innerHTML)||'';
  const rx=/openAttnSupply\('([^']+)'\)/g; let mm;
  while((mm=rx.exec(h))){ const sid=mm[1]; if(supBranch[sid]!==bv) problems.push(`[${bv}] attention shows supply from wrong branch: ${sid} (belongs to ${supBranch[sid]})`);
    try{ sb.openAttnSupply(sid); }catch(e){ problems.push(`[${bv}] openAttnSupply threw → ${e.message}`); } }
});

console.log(problems.length? 'GAPS FOUND ('+problems.length+'):\n'+problems.map(p=>'  • '+p).join('\n') : 'No tab-jump gaps found across any studio.');
process.exit(problems.length?1:0);
