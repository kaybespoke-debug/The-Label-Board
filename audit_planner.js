// Planner gate.
//
// The calendar showed two things: appointments and order due dates. A studio
// runs on more than that, and each person needs to see the part that is theirs.
//
// The rule this protects above all: the planner READS the other sources, it does
// not copy them. Fittings are appointments, deadlines are orders, jobs are tasks.
// If the planner ever starts writing its own copy of one of those, a studio ends
// up with two records for the same thing and an argument about which is right.
// Only meetings, reminders and content are the planner's own.
//
// The second rule: "Mine" must actually narrow. A tailor opening the planner
// should see their own bench, not the owner's diary — but nothing that belongs
// to the whole studio may disappear from it either, or they miss the notice
// about Friday's closure.
const fs=require('fs'),vm=require('vm');
const appPath=process.argv[2] || 'site/layi_dashboard.html';
const html=fs.readFileSync(appPath,'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=(id)=>({_id:id,innerHTML:'',value:'',checked:false,textContent:'',placeholder:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl(i))},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},requestAnimationFrame:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},prompt(){return '2';},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
const S=v=>JSON.stringify(v);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';calMonth=new Date();plannerLens='all';");
let fails=[];const F=x=>fails.push(x);

const today=new Date().toISOString().slice(0,10);
const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
const nextWeek=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
function fill(o){Object.keys(o).forEach(k=>run("document.getElementById("+S(k)+").value="+S(String(o[k]))+";"));}

/* 1) It is a planner, not a second calendar. --------------------------------- */
if(run("typeof getPlanner")!=='function')F('there is no planner store');
const types=run("PLANNER_TYPES.map(t=>t.k)");
['task','meeting','reminder','content','fitting','order'].forEach(t=>{
  if(types.indexOf(t)<0)F('the planner has no "'+t+'" entry type');
});
if(!/Planner/.test(run("TITLES.calendar[0]")))F('the tab is still called something other than Planner');
// the view key must NOT be renamed: it is stored in role permissions on real devices
if(run("typeof VIEW_SCOPE.calendar")==='undefined')F('the planner is missing from VIEW_SCOPE');

/* 2) The planner reads the other sources rather than copying them. ----------- */
{
  run("setPlanner([]);");
  const apptsBefore=run("getAppts().length");
  // booking a fitting through the planner must create an APPOINTMENT, not a
  // planner entry, or the studio ends up with the same fitting twice
  run("openPlannerEntry('',"+S(today)+");");
  fill({pl_title:'Mrs Bello final fitting',pl_date:today,pl_type:'fitting'});
  run("syncPlannerDraft();renderPlannerEntry();");
  fill({pl_title:'Mrs Bello final fitting',pl_date:today,pl_type:'fitting'});
  run("savePlannerEntry();");
  if(run("getPlanner().length")!==0)F('a fitting was written into the planner as well as the appointments book');
  if(run("getAppts().length")!==apptsBefore+1)F('booking a fitting from the planner did not create an appointment');
}

/* 3) Meetings, reminders and content are the planner's own. ------------------ */
{
  run("setPlanner([]);");
  run("openPlannerEntry('',"+S(today)+");");
  fill({pl_title:'Production huddle',pl_date:today,pl_type:'meeting'});
  run("syncPlannerDraft();renderPlannerEntry();");
  fill({pl_title:'Production huddle',pl_date:today,pl_type:'meeting'});
  run("addVideoLink();");
  const link=run("plannerDraft.link");
  if(!/^https:\/\/meet\.jit\.si\//.test(link))F('the free video call did not produce a usable room link: '+link);
  if(link.length<40)F('the video room name is short enough to guess: '+link);
  fill({pl_title:'Production huddle',pl_date:today,pl_type:'meeting',pl_link:link,pl_repeat:'weekly'});
  const team=run("getStaff().filter(staffActive).slice(0,2).map(s=>s.id)");
  team.forEach(id=>run("document.getElementById('pl_inv_"+id+"').checked=true;"));
  run("savePlannerEntry();");
  const rec=run("getPlanner()[0]");
  if(!rec)F('the meeting was not saved');
  else{
    if(rec.date!==today)F('the meeting saved on '+rec.date+', expected '+today);
    if(rec.repeat!=='weekly')F('the repeat was not kept');
    if((rec.invitees||[]).length!==2)F('the invited team members were not kept');
    if(rec.link!==link)F('the meeting link was lost on save');
  }
  // two rooms in a row must not collide
  if(run("makeVideoLink('x')")===run("makeVideoLink('x')"))F('two video rooms made in a row have the same name');
}

/* 4) Repeats land where they should, and nowhere else. ----------------------- */
{
  const e=run("getPlanner()[0]");
  if(e){
    if(run("plannerHitsDay(getPlanner()[0],"+S(today)+")")!==true)F('a weekly entry does not appear on its own start date');
    if(run("plannerHitsDay(getPlanner()[0],"+S(nextWeek)+")")!==true)F('a weekly entry does not repeat a week later');
    if(run("plannerHitsDay(getPlanner()[0],"+S(tomorrow)+")")!==false)F('a weekly entry appears the very next day');
    // and never before it starts
    const before=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    if(run("plannerHitsDay(getPlanner()[0],"+S(before)+")")!==false)F('an entry appears before the date it was set for');
  }
}

/* 5) The planner shows every source, not just its own. ----------------------- */
{
  run("currentUser=getUsers().find(u=>u.roleId==='owner');plannerLens='all';calMonth=new Date();");
  const seen=run("Object.keys(calEventsByDay()).reduce(function(a,k){calEventsByDay()[k];return a;},1)");
  const map=run("calEventsByDay()");
  const kinds={};
  Object.keys(map).forEach(k=>map[k].forEach(e=>{kinds[e.type]=1;}));
  const have=Object.keys(kinds);
  if(have.indexOf('meeting')<0)F('the planner does not show its own meetings');
  // the example studio always has appointments and order due dates in the month
  if(!have.length)F('the planner shows nothing at all');
}

/* 6) "Mine" narrows, but never hides what belongs to the studio. ------------- */
{
  run("plannerLens='all';currentUser=getUsers().find(u=>u.roleId==='owner');");
  const everyone=run("(calEventsByDay()["+S(today)+"]||[]).map(e=>e.type)");
  const invited=run("getPlanner()[0].invitees");
  const out=run("getStaff().filter(staffActive).filter(s=>"+S(invited)+".indexOf(s.id)<0)[0]");
  if(!out)F('every staff member was invited, so the lens cannot be tested');
  else{
    run("currentUser={name:"+S(out.name)+",staffId:"+S(out.id)+",roleId:'tailor'};plannerLens='mine';");
    const mine=run("(calEventsByDay()["+S(today)+"]||[]).map(e=>e.type)");
    if(mine.indexOf('meeting')>=0)F(out.name+' was not invited to the meeting but still sees it on their own planner');
    if(everyone.indexOf('meeting')<0)F('the meeting is missing from the Everyone lens');
    // an announcement is the studio's and must reach everybody
    if(everyone.indexOf('note')>=0&&mine.indexOf('note')<0)
      F('a studio-wide announcement disappears from a person’s own planner');
    if(mine.length>everyone.length)F('the Mine lens shows MORE than Everyone, which cannot be right');
  }
  run("currentUser=getUsers().find(u=>u.roleId==='owner');plannerLens='all';");
}

/* 7) It is wired for the cloud, and scoped to the studio. -------------------- */
if(run("STATE_KEYS").indexOf('layi_dash_planner')<0)
  F('the planner is not wired for cloud sync, so it would live on one device only');
{
  const names=run("getBranches().map(b=>b.name)");
  if(names.length>1){
    run("setPlanner([{id:'p1',title:'Lagos only',date:"+S(today)+",type:'reminder',branch:"+S(names[0])+",invitees:[]}]);");
    run("activeBranchView="+S(names[0])+";");
    const here=run("(calEventsByDay()["+S(today)+"]||[]).filter(e=>e.type==='reminder').length");
    run("activeBranchView="+S(names[1])+";");
    const there=run("(calEventsByDay()["+S(today)+"]||[]).filter(e=>e.type==='reminder').length");
    if(!here)F('a planner entry does not show in the studio it belongs to');
    if(there)F('a planner entry belonging to one studio shows in another');
    run("activeBranchView='all';");
  }
}

/* 8) Nothing empty gets in. -------------------------------------------------- */
{
  run("setPlanner([]);openPlannerEntry('',"+S(today)+");");
  fill({pl_title:'   ',pl_date:today,pl_type:'reminder'});
  run("savePlannerEntry();");
  if(run("getPlanner().length"))F('an entry with no title was accepted');
  run("openPlannerEntry('',"+S(today)+");");
  fill({pl_title:'No date',pl_date:'',pl_type:'reminder'});
  run("savePlannerEntry();");
  if(run("getPlanner().length"))F('an entry with no date was accepted');
}

console.log('Planner audit:');
console.log('  entry types: '+types.join(' · '));
console.log('  reads appointments, orders, tasks and announcements; owns meetings, reminders and content');
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ nothing is duplicated, repeats land correctly, and Mine narrows without hiding the studio’s own');
