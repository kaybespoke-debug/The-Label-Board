// WhatsApp automation groundwork gate.
// The seam exists, is DORMANT until an endpoint is set AND the app is live (so today's manual
// hand-off is unchanged), the milestone hooks are wired in saveOrder/saveUpdate, and the Settings
// panel renders with a go-live explainer. The API token never appears in the client.
const fs=require('fs'),vm=require('vm');const file=(process.argv[2]||'layi_dashboard.html');const html=fs.readFileSync(file,'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},click(){},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');");
let fails=[];const F=x=>fails.push(x);

// 1) Config seam with the three events, default OFF.
const c=JSON.parse(run("JSON.stringify(waCfg())"));
if(!c||!c.events) F('waCfg() has no events map');
['confirm','ready','reminder'].forEach(k=>{if(!(k in (c.events||{})))F('missing event: '+k);});
if(c.auto!==false) F('auto-send should default OFF');

// 2) Dormant: not ready without endpoint+live, even with auto on.
if(run("waAutoReady()")!==false) F('waAutoReady() should be false with no endpoint / not live');
run("SETTINGS.wa.auto=true;SETTINGS.wa.endpoint='send-whatsapp';");
if(run("waAutoReady()")!==false) F('waAutoReady() must stay false while offline (no live backend), even configured');

// 3) waOnEvent is a safe no-op while dormant (does not throw, sends nothing).
let threw=false;try{run("waOnEvent('confirm',{id:'L-1',client:'Test'})");}catch(e){threw=true;}
if(threw) F('waOnEvent threw while dormant — it must be a no-op');

// 4) Milestone hooks are wired in the source.
if(!/waOnEvent\('confirm'/.test(html)) F('no confirm hook wired (expected in saveOrder)');
if(!/waOnEvent\('ready'/.test(html)) F('no ready hook wired (expected in saveUpdate)');

// 5) Settings panel renders with a go-live explainer and the event rows.
run("SETTINGS.wa.auto=true;renderWASettings();");
const hint=(cache['wa_hint']&&cache['wa_hint'].innerHTML)||'';
if(!/go-live|WhatsApp Business API/i.test(hint)) F('the settings hint does not explain the go-live requirement');
const evs=(cache['wa_events']&&cache['wa_events'].innerHTML)||'';
if(!/onWAEvent/.test(evs)) F('the per-event toggles did not render');

// 6) The client NEVER carries a WhatsApp API token/secret.
if(/WHATSAPP_TOKEN|whatsapp[_-]?(api[_-]?)?(token|secret|key)\s*[:=]\s*['"][A-Za-z0-9]/i.test(html)) F('a WhatsApp API token appears in the client — it must live only in the Edge Function');

console.log('WhatsApp automation groundwork audit:');
console.log('  events: '+Object.keys(c.events||{}).join(', ')+' · default auto='+c.auto);
console.log('  dormant until endpoint+live; hooks wired at order-created and ready');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ seam present + dormant, milestone hooks wired, settings explain go-live, and no API token ships in the client');
process.exit(fails.length?1:0);
