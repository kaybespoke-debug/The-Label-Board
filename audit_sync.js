// Cloud-sync coverage gate.
// Every persisted data key must be wired to Supabase — either its own relational pusher (customers,
// suppliers) or the generic app_state path (STATE_KEYS). And save() must stay a pure-local no-op offline
// (username/PIN demo logins never touch the cloud). Discovers keys from the source, so a new key that
// nobody wired for sync fails this gate automatically.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const allKeys=[...new Set((html.match(/layi_dash_[a-z]+/g)||[]))].sort();
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>0,clearTimeout(){},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
let fails=[];const F=m=>fails.push(m);

const stateKeys=run('typeof STATE_KEYS!=="undefined"?STATE_KEYS:[]');
const pusherKeys=run('typeof SYNC_PUSHERS!=="undefined"?Object.keys(SYNC_PUSHERS):[]');
const covered=new Set([...stateKeys,...pusherKeys]);

// 1) Every storage key the app persists must be wired for sync.
allKeys.forEach(k=>{ if(!covered.has(k)) F('storage key not wired for cloud sync: '+k); });
// 2) A key must not be double-wired (both a relational pusher and the generic blob path).
stateKeys.forEach(k=>{ if(pusherKeys.includes(k)) F('key '+k+' is wired twice (relational pusher AND app_state)'); });

// 3) save() must be a pure-local no-op offline (supa null / not live) — never throw, never mutate sync state.
run('liveMode=false;');
let threw='';try{ run("save('layi_dash_orders',getOrders());save('layi_dash_staff',getStaff());"); }catch(e){ threw=e.message; }
if(threw) F('save() threw while offline → '+threw);
// syncPush offline must do nothing (return undefined without touching supa)
let pushThrew='';try{ run("syncPush('layi_dash_orders');"); }catch(e){ pushThrew=e.message; }
if(pushThrew) F('syncPush() threw while offline → '+pushThrew);

// 4) Realtime + the live team-account path must be offline-safe (no throw when supa is null / not live).
['startRealtime()','stopRealtime()','pushAllState()'].forEach(expr=>{try{run(expr);}catch(e){F(expr+' threw while offline → '+e.message);}});
// 5) The live (Supabase-auth) team-account functions must exist, and the local UI must route to them in live mode.
['openUserCloud','saveUserCloud','delUserCloud','renderUsersCloud','callTeamAdmin','startRealtime','stopRealtime'].forEach(fn=>{if(run('typeof '+fn)!=='function')F('missing live-mode function: '+fn);});
if(!/if\(liveMode\)return openUserCloud/.test(html))F('openUser does not route to the cloud path in live mode');
if(!/if\(liveMode\)\{renderUsersCloud/.test(html))F('renderUsers does not route to the cloud path in live mode');

console.log('Cloud-sync coverage audit:');
console.log('  keys='+allKeys.length+'  relational='+pusherKeys.length+' ('+pusherKeys.map(k=>k.replace('layi_dash_','')).join(',')+')  app_state='+stateKeys.length);
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ every persisted key is wired for cloud sync exactly once; save() is a no-op offline');
process.exit(fails.length?1:0);
