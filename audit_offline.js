// Offline-strength gate.
// Offline must read as a feature, not a failure: the connection pill stays hidden while online
// (non-intrusive), appears with a reassuring "saved" message when the network drops, clears when
// it returns, and the info modal explains that work is saved on the device.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2]||'layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');");
let fails=[];const F=x=>fails.push(x);
const disp=id=>run("(document.getElementById('"+id+"').style.display)");

// 1) Online → pill hidden (non-intrusive).
sb.navigator.onLine=true;run("updateConnPill();");
if(disp('connPill')!=='none') F('the offline pill is showing while online (should stay hidden)');

// 2) Offline → pill appears and reassures the work is saved.
sb.navigator.onLine=false;run("updateConnPill();");
if(disp('connPill')==='none') F('the offline pill does not appear when the network drops');
const txt=run("(document.getElementById('connPillText').textContent)");
if(!/saved/i.test(txt)) F('the offline pill does not reassure that work is saved (text: "'+txt+'")');

// 3) Back online → pill clears.
sb.navigator.onLine=true;run("updateConnPill();");
if(disp('connPill')!=='none') F('the offline pill does not clear when the connection returns');

// 4) The info modal explains offline behaviour (saved on the device).
run("showOfflineInfo();");
const modal=(cache['modal']&&cache['modal'].innerHTML)||'';
if(!/device/i.test(modal)||!/(saved|sync)/i.test(modal)) F('the offline info modal does not explain that data is saved on the device');

console.log('Offline-strength audit:');
console.log('  pill hidden online, shows "'+txt+'" offline, clears on reconnect; info modal explains local save');
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ offline reads as a feature: reassuring pill only when offline, and an explainer that nothing is lost');
process.exit(fails.length?1:0);
