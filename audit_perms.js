// Proves the permission model is role-aware and regression-safe:
//  1) each built-in role resolves to the expected access matrix
//  2) NEW permissions fall back to their old coupling for legacy roles (no regression)
//  3) toggling one permission is isolated (doesn't flip others)
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(process.argv[2]||'layi_dashboard.html','utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';
while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const el=()=>({innerHTML:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=el())},querySelector(){return el()},querySelectorAll(){return[]},createElement(){return el()},addEventListener(){},removeEventListener(){},body:el(),documentElement:el(),head:el()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();

function asRole(perms){ vm.runInContext('currentUser={id:"u-test",roleId:"__test",staffId:"",active:true};',sb);
  vm.runInContext('(function(p){var r=getRoles().filter(x=>x.id!=="__test");r.push({id:"__test",name:"Test",perms:p});setRoles(r);})('+JSON.stringify(perms)+')',sb); }
function asBuiltin(id){ vm.runInContext('currentUser={id:"u-'+id+'",roleId:"'+id+'",staffId:"",active:true};',sb); }
function C(k){ return sb.can(k); }

let fails=[];
function expect(label,got,want){ if(got!==want) fails.push(`${label}: got ${got}, want ${want}`); }

// 1) Built-in role matrix — [role, {perm:expected}]
const matrix={
  owner:      {finance:1,expenses:1,funds:1,sales:1,receivables:1,money:1,payroll:1},
  manager:    {finance:1,expenses:1,funds:1,sales:1,receivables:1,money:1,payroll:1},
  accountant: {finance:1,expenses:1,funds:1,sales:1,receivables:1,money:1,payroll:1},
  cre:        {finance:0,expenses:0,funds:0,sales:1,receivables:1,money:1,payroll:0},
  tailor:     {finance:0,expenses:0,funds:0,sales:0,receivables:0,money:0,payroll:0},
};
Object.keys(matrix).forEach(role=>{ asBuiltin(role); Object.keys(matrix[role]).forEach(k=>{ expect(`${role}.${k}`, C(k)?1:0, matrix[role][k]); }); });

// 2) Fallback / no-regression: a LEGACY role with only money:1 (no new keys) must keep old access
asRole({money:1,products:0,finance:0});
expect('legacy(money).expenses', C('expenses')?1:0, 1); // Expenses used to ride on money
expect('legacy(money).sales',    C('sales')?1:0,    1); // Sales used to ride on products||money
expect('legacy(money).funds',    C('funds')?1:0,    1); // Funds rode on finance||seeProfit(→money)
// a legacy FINANCE role keeps funds/expenses
asRole({finance:1});
expect('legacy(finance).funds',    C('funds')?1:0,    1);
expect('legacy(finance).expenses', C('expenses')?1:0, 0); // finance alone never implied "see amounts"; expenses rode on money
// 3) Isolation: explicitly turning OFF expenses must not affect sales/funds
asRole({money:1,products:1,finance:1,expenses:0});
expect('isolate.expenses(off)', C('expenses')?1:0, 0);
expect('isolate.sales(still on)', C('sales')?1:0, 1);
expect('isolate.funds(still on)', C('funds')?1:0, 1);
expect('isolate.money(still on)', C('money')?1:0, 1);

// 4) Editor round-trip must not regress: opening a legacy role and saving unchanged keeps effective access
asRole({money:1});               // legacy role, no expenses key
asBuiltin('owner');              // must be an admin to open the roles editor
sb.openRole && (function(){ try{ sb.openRole('__test'); }catch(e){} })();
// after openRole, rolePermDraft should mark expenses as 1 (effective), so a save wouldn't flip it off
const draftExpenses = vm.runInContext('(typeof rolePermDraft!=="undefined"&&rolePermDraft)?rolePermDraft.expenses:null', sb);
expect('editor.draft.expenses reflects effective', draftExpenses, 1);

// 5) Dynamic coverage — discover EVERY role from getRoles() at runtime, so any role added later
//    (built-in or custom, like "Head of Production") is checked automatically. Role-agnostic invariants:
//      (a) every permission key resolves to a boolean without throwing
//      (b) an explicitly-denied key (perms[k]===0) is NEVER resurrected by a PERM_FALLBACK
const allRoles=vm.runInContext('getRoles().map(function(r){return {id:r.id,perms:r.perms||{}};})',sb).filter(r=>r.id!=='__test');
const permKeys=vm.runInContext('PERM_KEYS',sb);
allRoles.forEach(function(r){
  asBuiltin(r.id);
  permKeys.forEach(function(k){
    var v; try{ v=C(k); }catch(e){ fails.push('dyn('+r.id+').'+k+' threw → '+e.message); return; }
    if(typeof v!=='boolean') fails.push('dyn('+r.id+').'+k+' not boolean: '+v);
    if(r.perms[k]===0 && v!==false) fails.push('dyn('+r.id+').'+k+': explicit deny overridden by fallback (got '+v+')');
  });
});

console.log('Permission audit:');
console.log('Roles discovered at runtime: '+allRoles.map(r=>r.id).join(', '));
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ all role/fallback/isolation checks passed');
process.exit(fails.length?1:0);
