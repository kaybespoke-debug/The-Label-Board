// Branch-scoped staff views gate.
// FAILS if a single-branch view lists a staff member who belongs to another studio, or if the
// branch switcher lacks an "All studios" option. This is the bug class "the Team tab ignored the
// branch switcher and showed everyone in every studio".
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');"); // full access + can switch branches
let fails=[];const F=m=>fails.push(m);
const staff=JSON.parse(_ls['layi_dash_staff']);
const branchOf=s=>s.branch||s.location||'';
const branches=JSON.parse(_ls['layi_dash_settings']).branches.map(b=>b.name);

// 1) The switcher must offer an "All studios" option (else there is no way to view all staff).
run("activeBranchView='"+branches[0]+"';renderBranchSwitch();");
const swHtml=(cache['branchSwitch']&&cache['branchSwitch'].innerHTML)||'';
if(!/value="all"/.test(swHtml)) F('branch switcher has no "All studios" option');

// Which known staff ids are referenced (in quotes, via onclick handlers) in a container's HTML?
const shown=htmlStr=>staff.filter(s=>htmlStr.indexOf("'"+s.id+"'")>=0).map(s=>s.id);
const VIEWS=[
  {name:'Team',      fn:'renderTeam',        ids:['teamList','teamStats']},
  {name:'Payroll',   fn:'renderPayrollView', ids:['payroll','payStats']},
  {name:'Workforce', fn:'renderWorkforce',   ids:['teamCapacity','teamPerf']},
  {name:'Rota',      fn:'renderRota',        ids:['rotaList','rotaCapacity']},
];
const ALLIDS=['teamList','teamStats','payroll','payStats','teamCapacity','teamPerf','rotaList','rotaCapacity'];
function renderIn(bv,fn){run("activeBranchView='"+bv+"';rotaMode='roster';");ALLIDS.forEach(id=>{if(cache[id])cache[id].innerHTML='';});try{run(fn+"();");}catch(e){F('['+fn+'@'+bv+'] threw → '+e.message);}}

// 2) Per branch: no staff from another studio may appear.
branches.forEach(bv=>{
  VIEWS.forEach(v=>{
    renderIn(bv,v.fn);
    const h=v.ids.map(id=>(cache[id]&&cache[id].innerHTML)||'').join('');
    shown(h).forEach(id=>{const s=staff.find(x=>x.id===id);if(branchOf(s)!==bv)F('['+v.name+' @ '+bv+'] shows out-of-branch staff: '+s.name+' (belongs to '+(branchOf(s)||'—')+')');});
  });
});

// 3) Non-vacuity: "All studios" must surface staff from more than one branch (proves the check can see leaks).
renderIn('all','renderTeam');
const allShown=shown(((cache['teamList']&&cache['teamList'].innerHTML)||'')+((cache['teamStats']&&cache['teamStats'].innerHTML)||''));
const branchesShown=new Set(allShown.map(id=>branchOf(staff.find(s=>s.id===id))));
if(branchesShown.size<2)F('weak check: "All studios" Team surfaced staff from '+branchesShown.size+' branch(es) — expected ≥2 (extraction may be broken)');

console.log('Branch-scoped staff audit:');
console.log('  branches: '+branches.join(', ')+' — "All studios" surfaces '+branchesShown.size+' branch(es) of staff');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ every staff view is scoped to the studio in view; switcher offers All studios');
process.exit(fails.length?1:0);
