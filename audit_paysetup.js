// Pay setup gate — allowances, pension and the studio's own pay lines.
//
// The rule this protects: a business that has not switched anything on must be
// completely unaffected. Its payslip is basic + commission = gross, with no
// deductions section and no net line, exactly as it was before any of this existed.
// Everything below that line only happens because an owner asked for it.
//
// The second rule: nothing is ever deducted from a person's pay by default. A pension
// needs the studio to run a scheme AND that person to be enrolled. An opt-in line
// needs that person ticked. Silence means no.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2] || 'site/layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,placeholder:'',textContent:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

// A salaried person with no commission this month, so every figure below is arithmetic
// we can check by hand rather than something that drifts with the demo data.
run("var _st=getStaff();_st[0]={id:'pa1',name:'Test Person',role:'Tailor',active:true,status:'Active',salaryType:'Monthly Salary',basic:100000,rate:0,rates:[],location:defaultBranchName()};setStaff(_st);");
run("SETTINGS.payroll=null;");
const K='2099-01';                                  // a month with no commission in it
const fig=k=>run("payFigures('pa1','"+(k||K)+"')");

/* 1) Untouched studio: nothing added, nothing taken off. --------------------------- */
let f=fig();
if(f.gross!==100000)F('a studio with no pay setup should gross the basic, got '+f.gross);
if(f.deductions.length)F('a studio with no pay setup has deductions it never asked for');
if(f.net!==f.gross)F('net should equal gross when nothing is switched on');
if(run("payrollInUse()")!==false)F('payrollInUse() is true before anything is switched on');
// and the payslip prints without a deductions section
let slip=run("payslipInner('pa1','"+K+"')");
if(/Net pay/.test(slip))F('a payslip shows a Net pay line for a studio with no deductions');
if(/Total deductions/.test(slip))F('a payslip shows deductions for a studio that runs none');
if(!/Gross pay/.test(slip))F('a payslip lost its Gross pay line');

/* 2) Allowances: a share of basic, paid on top, off until asked for. --------------- */
run("SETTINGS.payroll={allowances:{enabled:true,housingPct:15,transportPct:10},pension:{enabled:false,defaultRate:8},lines:[]};");
f=fig();
if(f.allowanceTotal!==25000)F('15% + 10% of 100,000 should be 25,000, got '+f.allowanceTotal);
if(f.gross!==125000)F('allowances should lift gross to 125,000, got '+f.gross);
if(f.deductions.length)F('turning on allowances should not create a deduction');
if(!f.earnings.some(e=>e.label==='Housing allowance'&&e.amount===15000))F('housing allowance is missing or wrong');
if(!f.earnings.some(e=>e.label==='Transport allowance'&&e.amount===10000))F('transport allowance is missing or wrong');
// the business pays what it costs, not what the employee receives
if(run("salaryCost(staffById('pa1'))")!==125000)F('a salary payment should cost the business basic + allowances, got '+run("salaryCost(staffById('pa1'))"));

/* 3) Pension needs BOTH the studio scheme and this person's enrolment. ------------- */
run("SETTINGS.payroll={allowances:{enabled:false,housingPct:15,transportPct:10},pension:{enabled:true,defaultRate:8},lines:[]};");
f=fig();
if(f.deductions.length)F('pension was deducted from someone who never enrolled');
// enrol them
run("var l=getStaff();l.find(x=>x.id==='pa1').pension={optedIn:true,rate:8,agreedOn:'2026-01-01'};setStaff(l);");
f=fig();
if(!f.deductions.some(d=>d.label==='Pension'&&d.amount===8000))F('8% of 100,000 should deduct 8,000, got '+JSON.stringify(f.deductions));
if(f.net!==92000)F('net should be 92,000 after pension, got '+f.net);
// a personal rate overrides the studio default
run("var l=getStaff();l.find(x=>x.id==='pa1').pension.rate=5;setStaff(l);");
if(fig().deductions[0].amount!==5000)F("a person's own pension rate was ignored");
// switching the scheme off at studio level stops every deduction, enrolment or not
run("SETTINGS.payroll.pension.enabled=false;");
if(fig().deductions.length)F('pension is still being deducted after the studio switched the scheme off');
run("SETTINGS.payroll.pension.enabled=true;var l2=getStaff();l2.find(x=>x.id==='pa1').pension.rate=8;setStaff(l2);");
// the payslip now carries the take-home
slip=run("payslipInner('pa1','"+K+"')");
if(!/Net pay/.test(slip))F('a payslip with deductions does not show what the person actually receives');
if(!/Pension/.test(slip))F('the payslip does not name the pension deduction');

/* 4) The studio's own lines: earnings, deductions, percentages, fixed amounts. ----- */
run("SETTINGS.payroll={allowances:{enabled:false,housingPct:0,transportPct:0},pension:{enabled:false,defaultRate:8},lines:["+
  "{id:'l1',name:'Meal allowance',kind:'earning',basis:'fixed',value:12000,of:'basic',optIn:false},"+
  "{id:'l2',name:'Union dues',kind:'deduction',basis:'pct',value:2,of:'basic',optIn:false},"+
  "{id:'l3',name:'Staff loan',kind:'deduction',basis:'fixed',value:25000,of:'basic',optIn:true}]};");
f=fig();
if(!f.earnings.some(e=>e.label==='Meal allowance'&&e.amount===12000))F('a fixed earning line did not appear');
if(f.gross!==112000)F('gross should be basic + meal allowance = 112,000, got '+f.gross);
if(!f.deductions.some(d=>d.label==='Union dues'&&d.amount===2000))F('a percentage deduction for everyone did not apply');
if(f.deductions.some(d=>d.label==='Staff loan'))F('an opt-in deduction was applied to someone who never opted in');
if(f.net!==110000)F('net should be 112,000 − 2,000 = 110,000, got '+f.net);
// opting that person in turns it on, and only for them
run("var l=getStaff();l.find(x=>x.id==='pa1').payLines={l3:true};setStaff(l);");
f=fig();
if(!f.deductions.some(d=>d.label==='Staff loan'&&d.amount===25000))F('an opt-in deduction did not apply after opting in');
if(f.net!==85000)F('net should be 112,000 − 2,000 − 25,000 = 85,000, got '+f.net);
// a percentage of gross is a different number from a percentage of basic
run("SETTINGS.payroll.lines[1].of='gross';");
if(fig().deductions.find(d=>d.label==='Union dues').amount!==2240)F('2% of a 112,000 gross should be 2,240, got '+fig().deductions.find(d=>d.label==='Union dues').amount);

/* 5) A deduction can never take more than was earned. ------------------------------ */
run("SETTINGS.payroll={allowances:{enabled:false,housingPct:0,transportPct:0},pension:{enabled:false,defaultRate:8},lines:[{id:'l9',name:'Runaway',kind:'deduction',basis:'fixed',value:500000,of:'basic',optIn:false}]};");
f=fig();
if(f.net<0)F('a deduction pushed take-home below zero: '+f.net);
if(f.clipped!==true)F('take-home was capped but the figures do not say so');

/* 6) Saving from the Settings panel keeps what matters and drops what does not. ---- */
run("SETTINGS.payroll=null;payLineDraft=null;renderPayrollSetup();");
run("document.getElementById('pay_allow_on').checked=true;document.getElementById('pay_housing').value='12';document.getElementById('pay_transport').value='8';");
run("document.getElementById('pay_pension_on').checked=true;document.getElementById('pay_pension_rate').value='7.5';");
run("addPayLine();document.getElementById('pl_name_0').value='Tools levy';document.getElementById('pl_kind_0').value='deduction';document.getElementById('pl_basis_0').value='fixed';document.getElementById('pl_value_0').value='3000';");
run("addPayLine();"); // a second line, left unnamed, must not be saved
run("savePayrollPanel();");
const saved=run("payrollSetup()");
if(saved.allowances.enabled!==true||saved.allowances.housingPct!==12||saved.allowances.transportPct!==8)F('allowance settings did not save: '+JSON.stringify(saved.allowances));
if(saved.pension.enabled!==true||saved.pension.defaultRate!==7.5)F('pension settings did not save: '+JSON.stringify(saved.pension));
if(saved.lines.length!==1)F('an unnamed pay line was saved, expected 1 line, got '+saved.lines.length);
if(saved.lines[0].name!=='Tools levy'||saved.lines[0].value!==3000)F('the pay line did not save correctly: '+JSON.stringify(saved.lines[0]));
if(run("payrollInUse()")!==true)F('payrollInUse() is false after the owner switched things on');

/* 7) A brand-new enrolment records the date it was agreed, so a payslip can say when. */
run("SETTINGS.payroll={allowances:{enabled:false,housingPct:0,transportPct:0},pension:{enabled:true,defaultRate:8},lines:[]};");
run("staffDraft={id:'pa1',name:'Test Person',rates:[],docs:[]};");
run("document.getElementById('st_pension_on').checked=true;document.getElementById('st_pension_rate').value='8';document.getElementById('st_pension_date').value='';");
run("syncStaffDraft();");
if(!run("staffDraft.pension.agreedOn"))F('an enrolment was recorded with no date, so a payslip cannot say since when');

console.log('Pay setup audit:');
console.log('  a studio with nothing switched on grosses basic + commission and shows no deductions');
console.log('  allowances, pension and custom lines each verified on and off');
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ optional by default, nothing deducted without consent, take-home never negative');
