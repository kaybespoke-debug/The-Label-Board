// Notifications gate (alerts only — no feed/bell; Company log + Audit trail hold the record).
// Local actions (sale/payment/status) alert now; other devices' actions alert via realtime once
// live. A Daylies-style Settings panel controls sound, chime voice, volume, per-event toggles and
// pop-ups. Web Push stays scaffolded/dormant with the SW handlers ready for go-live.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){},contains(){return false}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);const J=e=>JSON.parse(run('JSON.stringify('+e+')'));
run("currentUser=getUsers().find(u=>u.roleId==='owner');");
let fails=[];const F=x=>fails.push(x);

// 1) A local action fires an alert.
run("_lastActivity=null;pushActivity('sale','Test sale · 40,000');");
let la=J("_lastActivity");
if(!la||la.kind!=='sale'||!/Test sale/.test(la.text)||la.remote!==false) F('a local action did not fire a (non-remote) alert');

// 2) Turning an event off suppresses its alert.
run("setNotifEvent('sale',false);_lastActivity=null;pushActivity('sale','should be silent');");
if(run("_lastActivity")!==null) F('an event toggled OFF still fired an alert');
run("setNotifEvent('sale',true);");

// 3) Multiple chime voices, including silent.
const chimes=J("Object.keys(CHIMES)");
['chime','ping','marimba','soft','bell','silent'].forEach(c=>{if(chimes.indexOf(c)<0)F('chime voice "'+c+'" missing');});
if(J("CHIMES.silent").length!==0) F('the silent voice should make no sound');

// 4) Settings persist: sound, chime voice, volume, per-event, pop-ups.
run("setNotifChime('bell');");if(J("notifPrefs()").chime!=='bell') F('chime voice did not persist');
run("setNotifVolume(0.3);");if(J("notifPrefs()").volume!==0.3) F('volume did not persist');
run("setNotifSound(false);");if(J("notifPrefs()").sound!==false) F('sound toggle did not persist');run("setNotifSound(true);");
run("setNotifEvent('payment',false);");if(J("notifPrefs()").events.payment!==false) F('per-event toggle did not persist');run("setNotifEvent('payment',true);");

// 5) The Daylies-style Settings panel renders all controls.
run("renderNotifSettings();");
const st=(cache['notifSettings']&&cache['notifSettings'].innerHTML)||'';
['Sound on','Volume','Pop-up','BELL','A sale is recorded','An order status changes'].forEach(t=>{if(st.indexOf(t)<0)F('notification settings panel missing "'+t+'"');});

// 6) There is NO bell/feed left (it lived in the top bar / a panel; the record is the audit trail).
if(/id="notifBell"/.test(html)||/id="notifPanel"/.test(html)) F('the notification bell/feed is still in the markup (should be removed)');
if(/function renderNotifPanel|function toggleNotifPanel|function updateNotifBadge/.test(html)) F('leftover feed functions remain in the code');

// 7) Realtime: another device's change fires a REMOTE alert.
run("_lastActivity=null;_rtNotify('layi_dash_orders', JSON.stringify([]), [{id:'RT1',kind:'sale',client:'Remote Cust',stageIndex:0}]);");
la=J("_lastActivity");
if(!la||la.kind!=='sale'||!la.remote||!/Remote Cust/.test(la.text)) F('a remote new sale did not fire a remote alert');
run("_lastActivity=null;_rtNotify('layi_dash_orders', JSON.stringify([{id:'RT2',client:'Zed',stageIndex:0}]), [{id:'RT2',client:'Zed',stageIndex:2}]);");
if(J("_lastActivity").kind!=='status'||!J("_lastActivity").remote) F('a remote status change did not fire a remote alert');
run("_lastActivity=null;_rtNotify('layi_dash_txns', JSON.stringify([]), [{id:'t1',dir:'in',amount:5000}]);");
if(J("_lastActivity").kind!=='payment'||!J("_lastActivity").remote) F('a remote payment did not fire a remote alert');

// 8) Web Push scaffolding is dormant + safe.
if(run("PUSH_PUBLIC_KEY")!=='') F('a push key is hard-coded — should be blank until go-live');
try{run("subscribeToPush();");}catch(e){F('subscribeToPush threw → '+e.message);}

// 9) The service worker carries push + click handlers.
const sw=fs.readFileSync('sw.js','utf8');
if(!/addEventListener\(\s*['"]push['"]/.test(sw)) F('service worker has no push handler');
if(!/addEventListener\(\s*['"]notificationclick['"]/.test(sw)) F('service worker has no notificationclick handler');

console.log('Notifications audit (alerts only):');
console.log('  chime voices: '+chimes.join(' · ')+' · local + remote(realtime) alerts; no duplicate feed; push scaffolded');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ chimes on local & remote actions, Settings panel controls it, bell removed, push dormant until go-live');
process.exit(fails.length?1:0);
