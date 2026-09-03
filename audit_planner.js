// Planner gate.
//
// The calendar showed two things: appointments and order due dates. A studio
// runs on more than that, and each person needs to see the part that is theirs.
//
// The rule this protects above all others: the planner is a VIEW, not a second
// set of records. Fittings are appointments, deadlines are orders, jobs are
// tasks, and all three already exist. If the planner ever starts writing its
// own copy of one of those, the studio ends up with two records for one thing
// and an argument about which is right — so booking a fitting from the planner
// must create an appointment, and this gate checks that it does.
//
// The second rule: a tailor opening the planner sees their own bench, not the
// owner's diary.
const fs=require('fs'),vm=require('vm');
const appPath=process.argv[2] || 'site/layi_dashboard.html';
const html=fs.readFileSync(appPath,'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const cache={};const _ls={};
const mkEl=(id)=>({_id:id,innerHTML:'',value:'',checked:false,textContent:'',placeholder:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl(i))},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},requestAnimationFrame:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},prompt(){return '2';},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);
const today=new Date().toISOString().slice(0,10);

/* helper: fill the form the way a person would */
function compose(title,type,opts){
  opts=opts||{};
  run("openPlannerEntry('',"+JSON.stringify(opts.date||today)+");");
  run("document.getElementById('pl_title').value="+JSON.stringify(title)+";");
  run("document.getElementById('pl_date').value="+JSON.stringify(opts.date||today)+";");
  run("document.getElementById('pl_type').value="+JSON.stringify(type)+";syncPlannerDraft();renderPlannerEntry();");
  run("document.getElementById('pl_title').value="+JSON.stringify(title)+";");
  run("document.getElementById('pl_date').value="+JSON.stringify(opts.date||today)+";");
  if(opts.repeat)run("document.getElementById('pl_repeat').value="+JSON.stringify(opts.repeat)+";");
  if(opts.video)run("addVideoLink();");
  // The stubbed DOM caches elements, so tick boxes from an earlier compose are
  // still ticked. Clear them, or every later entry inherits the last one's guests.
  run("getStaff().forEach(function(st){var el=document.getElementById('pl_inv_'+st.id);if(el)el.checked=false;});");
  if(opts.invite)run("var t=getStaff().filter(staffActive);for(var i=0;i<"+opts.invite+"&&i<t.length;i++){var el=document.getElementById('pl_inv_'+t[i].id);if(el)el.checked=true;}");
  run("savePlannerEntry();");
}

/* 1) It is called a planner, and it plans more than fittings. ---------------- */
// Kayode asked for the visible name to stay Calendar. The machinery is still
// called the planner because that is what it does, but the tab a studio sees
// says Calendar, and the subtitle carries the rest.
if(run("TITLES.calendar[0]")!=='Calendar')F('the tab is no longer called Calendar');
if(!/meetings/.test(run("TITLES.calendar[1]")))F('the subtitle does not say the calendar carries meetings now');
const types=run("PLANNER_TYPES.map(t=>t.k)");
['task','meeting','reminder','content','fitting','order'].forEach(k=>{
  if(types.indexOf(k)<0)F('the planner has no "'+k+'" entries');
});
// the view key must NOT be renamed: it is stored in role permissions on real devices
if(!/data-view="calendar"/.test(html))F('the view key was renamed, which breaks saved role permissions');
if(run("VIEW_SCOPE.calendar")!=='branch')F('the planner does not declare how it answers the studio switcher');

/* 2) The planner is a view, not a second set of records. --------------------- */
run("setPlanner([]);");
const apptsBefore=run("getAppts().length");
const plannerBefore=run("getPlanner().length");
compose('Mrs Bello fitting','fitting');
if(run("getAppts().length")!==apptsBefore+1)
  F('booking a fitting from the planner did not create an appointment');
if(run("getPlanner().length")!==plannerBefore)
  F('booking a fitting ALSO wrote a planner entry, so the studio now has two records for one fitting');

// and the three that had nowhere to live do get their own record
['meeting','reminder','content'].forEach(k=>compose(k+' one',k));
if(run("getPlanner().length")!==3)F('meetings, reminders and content are not being saved, got '+run("getPlanner().length"));

/* 3) A free video room, with nothing to buy and nobody to sign up. ----------- */
run("setPlanner([]);");
compose('Monday huddle','meeting',{video:true,invite:2});
const e=run("getPlanner()[0]");
if(!e)F('the meeting was not saved');
else{
  if(!/^https:\/\/meet\.jit\.si\//.test(e.link||''))F('the meeting has no usable video link: '+e.link);
  if((e.link||'').length<40)F('the video room name is too short to be unguessable: '+e.link);
  if((e.invitees||[]).length!==2)F('the people invited to the meeting were not saved');
}
// two meetings must never share a room, or one studio walks into another's call
compose('Monday huddle','meeting',{video:true});
const links=run("getPlanner().map(x=>x.link).filter(Boolean)");
if(new Set(links).size!==links.length)
  F('two meetings were given the SAME video room — one studio could walk into another studio’s call');
// and it must be reachable from the day it happens
if(!/e\.link\?/.test(html))F('there is no way to join a meeting from the planner');

/* 4) Repeats land on the days they should. ----------------------------------- */
run("setPlanner([]);");
compose('Weekly production huddle','meeting',{repeat:'weekly'});
const wk=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const wk2=new Date(Date.now()+8*86400000).toISOString().slice(0,10);
run("calMonth=new Date("+JSON.stringify(wk)+"+'T00:00:00');calMonth.setDate(1);");
const onWk=run("(calEventsByDay()["+JSON.stringify(wk)+"]||[]).filter(e=>e.type==='meeting').length");
const onWk2=run("(calEventsByDay()["+JSON.stringify(wk2)+"]||[]).filter(e=>e.type==='meeting').length");
if(!onWk)F('a weekly meeting does not appear seven days later');
if(onWk2)F('a weekly meeting is appearing on days it does not fall on');
if(run("plannerHitsDay({date:"+JSON.stringify(today)+",repeat:''},"+JSON.stringify(wk)+")"))
  F('a one-off entry is repeating');

/* 5) Everything a studio runs on reaches the planner. ------------------------ */
run("setPlanner([]);calMonth=new Date();calMonth.setDate(1);activeBranchView='all';");
run("currentUser=getUsers().find(u=>u.roleId==='owner');");
compose('Post the agbada photos','content');
compose('Chase the courier','reminder');
{
  const seen={};
  const map=run("calEventsByDay()");
  Object.keys(map).forEach(k=>map[k].forEach(ev=>{seen[ev.type]=1;}));
  // fittings and order deadlines were always here; the rest are what was missing
  ['Fitting','content','reminder'].forEach(t=>{
    if(!seen[t])F('the planner never shows a "'+t+'"');
  });
  const any=Object.keys(map).reduce((a,k)=>a+map[k].length,0);
  if(!any)F('the planner is empty for the example studio, so it proves nothing');
}

/* 6) Each person sees their own. --------------------------------------------- */
{
  run("plannerLens='all';");
  const all=run("Object.keys(calEventsByDay()).reduce((a,k)=>a+calEventsByDay()[k].length,0)");
  const staff=run("getStaff().filter(staffActive)");
  if(staff.length<2)F('the example studio has too few staff to test the lens');
  else{
    // a meeting only the first person is invited to
    run("setPlanner([]);");
    compose('Owners only','meeting',{invite:1});
    const firstId=run("getStaff().filter(staffActive)[0].id");
    const otherId=run("getStaff().filter(staffActive)[1].id");
    run("currentUser={name:'Invited',roleId:'tailor',staffId:"+JSON.stringify(firstId)+"};plannerLens='mine';");
    const mineIn=run("Object.keys(calEventsByDay()).reduce((a,k)=>a+calEventsByDay()[k].filter(e=>e.type==='meeting').length,0)");
    run("currentUser={name:'Not invited',roleId:'tailor',staffId:"+JSON.stringify(otherId)+"};plannerLens='mine';");
    const mineOut=run("Object.keys(calEventsByDay()).reduce((a,k)=>a+calEventsByDay()[k].filter(e=>e.type==='meeting').length,0)");
    if(!mineIn)F('somebody invited to a meeting cannot see it in their own planner');
    if(mineOut)F('somebody NOT invited to a meeting still sees it in their own planner');
    // but the studio's own business stays visible to everybody
    run("plannerLens='mine';");
    const orders=run("Object.keys(calEventsByDay()).reduce((a,k)=>a+calEventsByDay()[k].filter(e=>e.type==='order').length,0)");
    run("plannerLens='all';");
    const ordersAll=run("Object.keys(calEventsByDay()).reduce((a,k)=>a+calEventsByDay()[k].filter(e=>e.type==='order').length,0)");
    if(orders!==ordersAll)F('order deadlines vanish in the "Mine" lens — they are the studio’s, and everybody needs them');
    run("currentUser=getUsers().find(u=>u.roleId==='owner');plannerLens='all';");
    if(all<1)F('the planner shows nothing at all');
  }
}

/* 7) It is scoped to the studio, and wired for sync, like everything else. ---- */
{
  const st=run("STATE_KEYS");
  if(st.indexOf('layi_dash_planner')<0)F('planner entries are never synced, so they live on one device only');
  run("setPlanner([]);activeBranchView='all';");
  const names=run("getBranches().map(b=>b.name)");
  if(names.length>1){
    run("var l=getPlanner();l.push({id:'pn-a',title:'A',date:"+JSON.stringify(today)+",type:'reminder',branch:"+JSON.stringify(names[0])+"});"
       +"l.push({id:'pn-b',title:'B',date:"+JSON.stringify(today)+",type:'reminder',branch:"+JSON.stringify(names[1])+"});setPlanner(l);");
    run("calMonth=new Date();calMonth.setDate(1);activeBranchView="+JSON.stringify(names[0])+";plannerLens='all';");
    const a=run("(calEventsByDay()["+JSON.stringify(today)+"]||[]).filter(e=>e.type==='reminder').length");
    if(a!==1)F('a reminder for one studio shows '+a+' times in that studio, expected 1');
    run("activeBranchView="+JSON.stringify(names[1])+";");
    const b=run("(calEventsByDay()["+JSON.stringify(today)+"]||[]).filter(e=>e.title==='A'||e.label==='A').length");
    if(b)F('a reminder for one studio is showing in another');
  }
}

console.log('Planner audit:');
console.log('  entry kinds: '+types.join(' · '));
console.log('  sources: appointments, order due dates, tasks, announcements, and the planner’s own');
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ a view not a second copy, free video rooms that are never shared, repeats land right, and each person sees their own');
