// Reporting-line integrity gate.
// FAILS if the live staff data contains a self-report, a cycle, or a manager pointing at a
// deleted staff member — and proves (non-vacuously) that the app's own guard functions catch each.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=expr=>vm.runInContext(expr,sb);
let fails=[];const F=m=>fails.push(m);

const PRISTINE=_ls['layi_dash_staff']; // snapshot to restore after mutation probes

// ---- 1) LIVE DATA must be clean: no self-report, no dangling, no cycle ----
const liveBad=run(`(function(){var st=getStaff(),ids={},bad=[];st.forEach(function(s){ids[s.id]=1;});
  st.forEach(function(s){if(s.manager){if(s.manager===s.id)bad.push('self-report: '+s.name);else if(!ids[s.manager])bad.push('dangling manager (deleted staff): '+s.name+' -> '+s.manager);}});
  st.forEach(function(s){var seen={},c=s.id,g=0;while(c&&g++<9999){var p=st.find(function(x){return x.id===c;});c=p?p.manager:'';if(!c)break;if(c===s.id){bad.push('reporting loop through: '+s.name);break;}if(seen[c])break;seen[c]=1;}});
  return bad;})()`);
liveBad.forEach(b=>F('LIVE '+b));

// ---- 2) The guard functions must CATCH each fault (so this gate has teeth even when data is clean) ----
// self-report
const r1=run(`(function(){var st=JSON.parse(JSON.stringify(getStaff()));st[0].manager=st[0].id;setStaff(st);
  return {flagged:sanitizeReporting(JSON.parse(JSON.stringify(st))).some(function(f){return f.reason==='self';}),ignored:reportsToId(st[0].id)===''};})()`);
if(!r1.flagged)F('sanitizeReporting did not flag a self-report');
if(!r1.ignored)F('reportsToId surfaced a self-report instead of ignoring it');
// cycle A<->B
const r2=run(`(function(){var st=JSON.parse(JSON.stringify(getStaff()));var a=st[0].id,b=st[1].id;st[0].manager=b;st[1].manager=a;setStaff(st);
  return {loop:sanitizeReporting(JSON.parse(JSON.stringify(st))).some(function(f){return f.reason==='loop';}),blocked:reportingWouldLoop(a,b)};})()`);
if(!r2.loop)F('sanitizeReporting did not flag a cycle');
if(!r2.blocked)F('reportingWouldLoop did not block a cycle-creating pick');
// dangling (points at a deleted staff id)
const r3=run(`(function(){var st=JSON.parse(JSON.stringify(getStaff()));st[0].manager='st-DELETED-GONE';setStaff(st);
  return {flagged:sanitizeReporting(JSON.parse(JSON.stringify(st))).some(function(f){return f.reason==='dangling';}),ignored:reportsToId(st[0].id)===''};})()`);
if(!r3.flagged)F('sanitizeReporting did not flag a dangling manager');
if(!r3.ignored)F('reportsToId surfaced a dangling manager instead of ignoring it');

// ---- 3) Leaving reassigns reports UP the chain (never orphans) ----
const r4=run(`(function(){var st=JSON.parse(JSON.stringify(getStaff()));var A=st[0].id,B=st[1].id,C=st[2].id;st[1].manager=A;st[2].manager=B;
  var moved=reassignReportsFrom(st,B);var c=st.find(function(x){return x.id===C;});return {moved:moved,now:c.manager,expect:A};})()`);
if(r4.now!==r4.expect)F('reassignReportsFrom did not move a report up to the grandparent on leave (got '+r4.now+', expected '+r4.expect+')');
if(r4.moved<1)F('reassignReportsFrom reported moving 0 reports when it should have moved 1');

// ---- 4) Direct reports are branch-scoped ----
run(`setStaff(${PRISTINE})`); // restore clean seed for the live-data-dependent check
const r5=run(`(function(){var sup=getStaff().find(function(s){return getStaff().some(function(x){return x.manager===s.id;});});
  if(!sup)return {skip:true};activeBranchView='all';var all=directReports(sup.id).length;
  var byBranch={};getStaff().forEach(function(s){if(s.manager===sup.id){var b=staffBranch(s);byBranch[b]=(byBranch[b]||0)+1;}});
  var oneBranch=Object.keys(byBranch)[0];activeBranchView=oneBranch;var scoped=directReports(sup.id,{scoped:true}).length;activeBranchView='all';
  return {sup:sup.name,all:all,branch:oneBranch,scoped:scoped,branches:Object.keys(byBranch).length};})()`);
if(!r5.skip){
  if(r5.scoped>r5.all)F('scoped direct reports exceeded unscoped');
  if(r5.branches>1&&r5.scoped>=r5.all)F('directReports ignored branch scope (all='+r5.all+', '+r5.branch+'='+r5.scoped+')');
}
run(`setStaff(${PRISTINE})`);

console.log('Reporting-line audit:');
if(!r5.skip)console.log('  supervisor sampled: '+r5.sup+' — '+r5.all+' report(s) across '+r5.branches+' studio(s)');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ no self-report, loop, or dangling manager — guards verified against injected faults');
process.exit(fails.length?1:0);
