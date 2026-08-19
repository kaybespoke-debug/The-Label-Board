// Account ↔ staff gate.
// Creating an account for a real employee must not silently leave them with no staff record (pay,
// attendance and commissions would have nowhere to attach). Drives the REAL openUser/saveUser/renderUsers:
//   - the New Account form offers to create a matching staff record when none is linked (and edit does not);
//   - accepting creates exactly one staff record, linked one-to-one, name pre-filled;
//   - declining creates the account alone and its row shows a permanent "no linked staff" hint;
//   - a staff record can be linked to at most one account.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');"); // account admin
let fails=[];const F=m=>fails.push(m);
const set=(id,prop,val)=>{cache[id]=cache[id]||mkEl();cache[id][prop]=val;};
const clearForm=()=>['us_name','us_username','us_pin','us_staff','us_makeStaff','us_makeStaffBranch','us_active','modal','usersList'].forEach(id=>{cache[id]=mkEl();});
const H=id=>(cache[id]&&cache[id].innerHTML)||'';

// A) The New Account form offers to create staff when unlinked; editing an existing account does not.
run("openUser();");
if(!/Also add/.test(H('modal'))||!/us_makeStaff/.test(H('modal'))) F('New Account form does not offer to create a matching staff record');
const anyUser=run("getUsers()[0].id");
run(`openUser('${anyUser}');`);
if(/id="us_makeStaff"/.test(H('modal'))) F('Editing an existing account wrongly shows the create-staff offer');

// B) Accepting the offer creates exactly one staff record, linked one-to-one, with the pre-filled name.
const staffBefore=run("getStaff().length");
clearForm();
set('us_name','value','Bola Test');set('us_username','value','bolatest');set('us_pin','value','pass1234');
set('us_staff','value','');set('us_makeStaff','checked',true);set('us_active','checked',true);
try{ run("saveUser('');"); }catch(e){ F('saveUser threw on accept → '+e.message); }
if(run("getStaff().length")!==staffBefore+1) F('Accepting the offer did not create a staff record');
const b=run("(function(){var u=getUsers().find(x=>x.username==='bolatest');if(!u)return null;var s=getStaff().find(y=>y.id===u.staffId);return{link:!!u.staffId,name:s?s.name:'',oneToOne:getUsers().filter(x=>x.staffId&&x.staffId===u.staffId).length};})()");
if(!b||!b.link) F('Created account was not linked to the new staff record');
if(b&&b.name!=='Bola Test') F('Created staff record name not pre-filled from the account (got "'+(b&&b.name)+'")');
if(b&&b.oneToOne!==1) F('Created account↔staff link is not one-to-one');

// C) Declining creates the account alone; its row shows a permanent "no linked staff" hint.
const staffBefore2=run("getStaff().length");
clearForm();
set('us_name','value','External Auditor');set('us_username','value','extaudit');set('us_pin','value','pass');
set('us_staff','value','');set('us_makeStaff','checked',false);set('us_active','checked',true);
try{ run("saveUser('');"); }catch(e){ F('saveUser threw on decline → '+e.message); }
if(run("getStaff().length")!==staffBefore2) F('Declining the offer still created a staff record');
if(run("(getUsers().find(x=>x.username==='extaudit')||{}).staffId||''")) F('Declined account was linked to a staff record anyway');
run("renderUsers();");
if(!/no linked staff/.test(H('usersList'))) F('Account row does not show the permanent "no linked staff" hint');

// D) One-to-one: a second account cannot link a staff record that is already linked.
const takenStaff=run("(getUsers().find(x=>x.username==='bolatest')||{}).staffId||''");
const usersBefore=run("getUsers().length");
clearForm();
set('us_name','value','Dupe');set('us_username','value','dupe');set('us_pin','value','pass');
set('us_staff','value',takenStaff);set('us_makeStaff','checked',false);set('us_active','checked',true);
try{ run("saveUser('');"); }catch(e){}
if(run("getUsers().length")!==usersBefore) F('One-to-one violated: a second account was allowed to link an already-linked staff record');

console.log('Account ↔ staff audit:');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ offer shown when unlinked, accept creates one-to-one staff, decline shows the hint, link stays 1:1');
process.exit(fails.length?1:0);
