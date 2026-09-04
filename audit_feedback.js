// Feedback channel gate — the studio app end, and the console end.
//
// The operator console has queues for suggestions, feature requests, complaints
// and support, and for a long time nothing could put anything into them. This
// gate makes sure the whole path exists and holds together:
//
//   the app        a studio can write, on any screen, whatever their role
//   the device     it is saved before it is sent, so bad signal loses nothing
//   the queue      what has not been delivered stays queued and goes later
//   the wire       it pushes to the feedback table, once, with its own pusher
//   the console    live rows merge into the same DB the demo uses, so every
//                  page keeps working, and the console says which is which
//
// The rule worth protecting above all: a message is written down before any
// attempt to send it. A workroom with no signal is the normal case, and
// "could not send" would mean the complaint simply never gets made.
const fs=require('fs'),vm=require('vm');
const appPath=process.argv[2] || 'site/layi_dashboard.html';
const html=fs.readFileSync(appPath,'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,placeholder:'',textContent:'',style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},requestAnimationFrame:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);

/* 1) There is a way in, and it is not hidden behind a permission. -------------------- */
if(run("typeof openFeedback")!=='function')F('there is no way for a studio to tell us anything');
if(!/id="navFeedback"/.test(html))F('Help & feedback is not in the sidebar');
if(!/openFeedback\(\);toggleMore\(\)/.test(html))F('Help & feedback cannot be reached on a phone');
// a tailor with almost no permissions must still be able to report a bug
run("currentUser=getUsers().find(u=>u.roleId==='tailor')||currentUser;");
let threw='';try{run("openFeedback();");}catch(e){threw=e.message;}
if(threw)F('a tailor cannot open the feedback form: '+threw);
run("currentUser=getUsers().find(u=>u.roleId==='owner');");

/* 2) The four things the console sorts into queues can all be sent. ----------------- */
const kinds=run("FEEDBACK_KINDS.map(k=>k.k)");
['suggestion','feature','complaint','support'].forEach(k=>{
  if(kinds.indexOf(k)<0)F('the console has a queue for "'+k+'" but a studio cannot send one');
});

/* 3) It is written down BEFORE it is sent. ------------------------------------------ */
run("setFeedback([]);openFeedback('complaint');");
run("document.getElementById('fb_title').value='Orders vanished';document.getElementById('fb_body').value='Two orders disappeared after the update.';document.getElementById('fb_kind').value='complaint';");
run("liveMode=false;sendFeedback();");
let saved=run("getFeedback()");
if(saved.length!==1)F('a message was not saved to the device, got '+saved.length+' records');
if(saved[0]&&saved[0].sentAt)F('a message was marked sent while offline');
if(saved[0]&&saved[0].title!=='Orders vanished')F('the message saved was not the one written');
if(saved[0]&&saved[0].kind!=='complaint')F('the kind was not kept');
// and the studio can see it is still waiting
run("feedbackTab='sent';renderFeedbackModal();");
if(!/waiting to send/.test(run("document.getElementById('modal').innerHTML")||''))F('a queued message does not tell the studio it has not gone yet');

/* 4) Nothing empty gets through. ---------------------------------------------------- */
run("setFeedback([]);openFeedback('suggestion');");
run("document.getElementById('fb_title').value='   ';document.getElementById('fb_body').value='something';");
run("sendFeedback();");
if(run("getFeedback().length")!==0)F('a message with no title was accepted');
run("openFeedback('suggestion');document.getElementById('fb_title').value='Title';document.getElementById('fb_body').value='  ';");
run("sendFeedback();");
if(run("getFeedback().length")!==0)F('a message with no body was accepted');

/* 5) It carries the context support would otherwise have to ask for. ---------------- */
run("setFeedback([]);activeView='production';openFeedback('support');");
run("document.getElementById('fb_title').value='Cannot mark ready';document.getElementById('fb_body').value='The button does nothing.';document.getElementById('fb_blocking').checked=true;");
run("sendFeedback();");
const one=run("getFeedback()[0]");
if(!one||one.page!=='production')F('the message does not say which screen they were on');
if(!one||one.urgency!=='blocking')F('a studio saying they are blocked is not recorded as blocking');
if(!one||!one.at)F('the message has no timestamp');

/* 6) It has its own way to the wire, and only one. ---------------------------------- */
const pushers=run("Object.keys(SYNC_PUSHERS)");
if(pushers.indexOf('layi_dash_feedback')<0)F('feedback has no pusher, so it would never reach us');
const stateKeys=run("STATE_KEYS");
if(stateKeys.indexOf('layi_dash_feedback')>=0)F('feedback is ALSO in the generic blob sync, which would send it back to the studio instead of to us');
if(run("typeof pushFeedback")!=='function')F('pushFeedback is missing');
// pushing while offline must be silent, never an error the owner sees
run("liveMode=false;supa=null;");
threw='';try{run("pushFeedback(getFeedback());");}catch(e){threw=e.message;}
if(threw)F('sending while offline threw instead of staying quiet: '+threw);

/* 7) Sending twice does not send twice. --------------------------------------------- */
// The pusher only ever picks up what has no sentAt, so a delivered message is
// never re-delivered on the next sync.
if(!/queued=\(arr\|\|\[\]\)\.filter\(f=>!f\.sentAt\)/.test(html))
  F('the pusher does not skip messages it has already delivered, so every sync would duplicate them');

/* ---------------------------------------------------------------------------------- */
/* The console end.                                                                    */
/* ---------------------------------------------------------------------------------- */
const live=fs.readFileSync('admin/js/live.js','utf8');
const cfg=fs.readFileSync('admin/js/config.js','utf8');
const api=fs.readFileSync('supabase/functions/admin-api/index.ts','utf8');
const idx=fs.readFileSync('admin/index.html','utf8');
const mig=fs.readFileSync('supabase/migrations/20260827090500_feedback.sql','utf8');

/* 8) The console is wired, and whatever it ships with is safe to ship. -------------- */
// This used to require the config to be blank, so that a demo stayed a demo.
// The console is now pointed at a real project on purpose, which is a real
// trade-off and worth naming: with it filled in, the deployed console cannot
// be explored without a Label Board staff account, because Supabase Auth
// decides who gets in rather than a password set in the browser. Blanking
// these two lines restores the self-contained demo and nothing else changes.
//
// What must hold either way is that admin/ is served over the public web, so
// the key in it is readable by anyone. An anon key is built for that and every
// table in the project refuses it. A service_role key bypasses row level
// security entirely and would hand over every studio on the platform to
// anybody who viewed source.
{
  const key=(cfg.match(/SUPA_KEY:\s*'([^']*)'/)||[])[1]||'';
  const url=(cfg.match(/SUPA_URL:\s*'([^']*)'/)||[])[1]||'';
  let role='';
  if(key.split('.').length===3){
    try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64').toString()).role||'';}
    catch(e){role='unreadable';}
  }
  if(role==='service_role')
    F('admin/js/config.js ships a service_role key, which bypasses every policy in the database');
  if(key&&role!=='anon'&&!/^sb_publishable_/.test(key))
    F('admin/js/config.js ships a key that is neither anon nor publishable (role='+(role||'unknown')+')');
  if(url&&!/^https:\/\//.test(url))
    F('admin/js/config.js points at a plain http url');
  console.log('  console ships: '+(url?'LIVE ('+role+' key)':'blank, running its worked example'));
}
if(/service_role|SERVICE_ROLE/i.test(cfg)||/service_role/i.test(live))
  F('the service role key appears in the console, which would hand every studio to any browser');
if(!/js\/live\.js/.test(idx)||!/js\/config\.js/.test(idx))
  F('the console does not load its live wiring');
if(!/liveStart\(\)/.test(fs.readFileSync('admin/js/signin.js','utf8')))
  F('nothing fetches real feedback after somebody signs in');

/* 9) The console reads through the audited door, never a table. --------------------- */
if(/from\('feedback'\)|from\("feedback"\)/.test(live))
  F('the console queries the feedback table directly, bypassing the admin-api gateway');
if(!/liveCall\('feedback'\)/.test(live))
  F('the console does not ask the gateway for the inbox');
['feedback','feedbackThread','setFeedbackState','replyFeedback'].forEach(a=>{
  if(!api.includes("action === '"+a+"'"))F('admin-api cannot handle "'+a+'"');
});
// finance has no business reading a studio's complaints
const allowed=(api.match(/const ALLOWED[\s\S]*?\n\}/)||[''])[0];
if(/finance:[^\n]*'feedback'/.test(allowed))F('the finance role can read studios’ complaints');
if(!/support:[\s\S]{0,200}'feedback'/.test(allowed))F('the support role cannot read the support queue');
// a reply can only be written server side, as us
if(!/side:\s*'us'/.test(api))F('admin-api does not mark our replies as coming from us');
if(!/side = 'them'/.test(mig))F('the database does not stop a studio forging a reply from support');

/* 10) Real and example rows are told apart, and merging is idempotent. -------------- */
if(!/live:\s*true/.test(live))F('real rows are not marked, so nobody can tell them from the worked example');
if(!/filter\(x => !x\.live\)/.test(live))F('merging does not drop the previous live rows, so refreshing would duplicate every ticket');
if(!/supportSourceLine/.test(fs.readFileSync('admin/js/pages2.js','utf8')))
  F('the support page does not say whether it is showing real studios or the example');

console.log('Feedback channel audit:');
console.log('  kinds a studio can send: '+kinds.join(' · '));
console.log('  app → device → queue → feedback table → admin-api → console');
if(fails.length){console.log('\n✗ '+fails.length+' problem(s):');fails.forEach(x=>console.log('   - '+x));process.exit(1);}
console.log('  ✓ saved before sent, queued when offline, delivered once, and read only through the audited gateway');
