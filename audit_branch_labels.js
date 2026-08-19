// Branch-label gate.
// In the "All studios" view, list rows must show which studio each record belongs to (a .branch-tag);
// in a single-branch view they must NOT (it would be redundant noise). Verifies the shared helper and
// a representative set of tables (staff, payroll, and the shared order drill-down).
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');");
let fails=[];const F=m=>fails.push(m);
const branches=JSON.parse(_ls['layi_dash_settings']).branches.map(b=>b.name);
const H=id=>(cache[id]&&cache[id].innerHTML)||'';
const clr=()=>['teamList','payroll','modal','leaveList'].forEach(id=>{if(cache[id])cache[id].innerHTML='';});
const renderKey=()=>{['renderTeam()','renderPayrollView()',"dashDrill('active')"].forEach(fn=>{try{run(fn);}catch(e){F('render '+fn+' threw → '+e.message);}});};

// 1) Helper: tag in all-view, nothing in single-branch view.
run("activeBranchView='all';");const tagAll=run("branchTag('Lagos studio')");
run("activeBranchView='"+branches[0]+"';");const tagBranch=run("branchTag('Lagos studio')");
if(!/branch-tag/.test(tagAll))F('branchTag() returns no tag in the All-studios view');
if(tagBranch!=='')F('branchTag() leaks a tag when a single branch is in view');

// 2) All-studios view: representative tables must carry a branch tag.
run("activeBranchView='all';");clr();renderKey();
const allTeam=/branch-tag/.test(H('teamList')),allPay=/branch-tag/.test(H('payroll')),allDrill=/branch-tag/.test(H('modal'));
if(!allTeam)F('Team list shows no studio label in the All-studios view');
if(!allPay)F('Payroll shows no studio label in the All-studios view');
if(!allDrill)F('Order drill-down shows no studio label in the All-studios view');

// 3) Single-branch view: the same tables must NOT show the tag.
run("activeBranchView='"+branches[0]+"';");clr();renderKey();
if(/branch-tag/.test(H('teamList')))F('Team list leaks a studio label in a single-branch view');
if(/branch-tag/.test(H('payroll')))F('Payroll leaks a studio label in a single-branch view');
if(/branch-tag/.test(H('modal')))F('Order drill-down leaks a studio label in a single-branch view');
run("activeBranchView='all';");

console.log('Branch-label audit:');
console.log('  All-studios tags — Team:'+allTeam+' Payroll:'+allPay+' OrderDrill:'+allDrill);
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ rows are studio-labelled in All-studios view and clean in single-branch view');
process.exit(fails.length?1:0);
