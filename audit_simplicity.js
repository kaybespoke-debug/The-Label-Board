// Simplicity / progressive-disclosure gate.
// A one-person shop must NOT be shown the team & HR cluster (Team, Rota, Attendance, Leave,
// Company log, Payroll). It reveals automatically once there is a real team (2+ active staff)
// or a second studio, and an explicit Settings toggle (SETTINGS.teamTools) overrides either way.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);
const d=id=>run("(document.getElementById('"+id+"').style.display)");
const CLUSTER=['navTeam','navRota','navAttendance','navLeave','navCompanylog','navPayroll'];

// 0) Established business (demo has staff + 4 studios) must keep the tools — no regression.
if(run("teamToolsOn()")!==true) F('a business with staff/studios should show team tools');
run("applyTeamVisibility();");
CLUSTER.forEach(id=>{if(d(id)==='none')F(id+' is hidden for a business that HAS a team (regression)');});

// 1) Forced OFF hides the whole cluster and its sidebar heading.
run("SETTINGS.teamTools='off';applyTeamVisibility();");
CLUSTER.forEach(id=>{if(d(id)!=='none')F(id+' still visible when team tools are turned off');});
if(d('navGrpTeam')!=='none') F('the Team sidebar heading stays visible when the cluster is hidden');
// the Settings checkbox reflects the state
if(run("document.getElementById('set_teamtools').checked")!==false) F('the Settings toggle does not reflect the off state');

// 2) A hidden view, reached directly, is redirected to the dashboard.
run("activeView='orders';");
try{run("go('team');");}catch(e){F('go(team) threw with team tools off → '+e.message);}
if(run("activeView")!=='activity') F('navigating to a hidden team view was not redirected to the dashboard');

// 3) Forced ON reveals the cluster again.
run("SETTINGS.teamTools='on';applyTeamVisibility();");
CLUSTER.forEach(id=>{if(d(id)==='none')F(id+' still hidden when team tools are turned on');});
if(d('navGrpTeam')==='none') F('the Team heading stays hidden even though team tools are on');

// 4) AUTO default: one studio + a lone owner hides the cluster; hiring a 2nd teammate reveals it.
run("SETTINGS.__b=SETTINGS.branches;SETTINGS.__s=getStaff();delete SETTINGS.teamTools;SETTINGS.branches=[{id:'b1',name:'Solo studio',active:true}];setStaff([{id:'s1',name:'Owner',active:true,status:'Active'}]);");
if(run("teamToolsOn()")!==false) F('a one-studio, one-person shop should hide team tools by default (auto)');
run("setStaff(getStaff().concat([{id:'s2',name:'New hire',active:true,status:'Active'}]));");
if(run("teamToolsOn()")!==true) F('adding a second teammate should reveal team tools automatically (auto)');
run("SETTINGS.branches=SETTINGS.__b;setStaff(SETTINGS.__s);delete SETTINGS.__b;delete SETTINGS.__s;delete SETTINGS.teamTools;");

console.log('Simplicity / progressive-disclosure audit:');
console.log('  cluster gated: '+CLUSTER.join(' · '));
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ solo shops hide the team & HR cluster, hidden views redirect, and tools reveal on hire or via Settings');
process.exit(fails.length?1:0);
