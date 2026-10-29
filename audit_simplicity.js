// Simplicity / progressive-disclosure gate.
// A one-person shop must NOT be shown the team & HR cluster (Team, Rota, Attendance, Leave,
// Company log, Payroll). It reveals automatically once there is a real team (2+ active staff)
// or a second studio, and an explicit Settings toggle (SETTINGS.teamTools) overrides either way.
const fs=require('fs'),vm=require('vm');const html=fs.readFileSync((process.argv[2] || 'site/layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const mkEl=()=>({innerHTML:'',value:'',checked:false,style:{},dataset:{},options:[],classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){}});
const cache={};const _ls={};
const sb={console,document:{getElementById(i){return cache[i]||(cache[i]=mkEl())},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl()},localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},setTimeout:f=>{try{f&&f()}catch(e){}},navigator:{userAgent:'n'},location:{href:''},alert(){},confirm(){return true},Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,Intl};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'x'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);
const d=id=>run("(document.getElementById('"+id+"').style.display)");
const CLUSTER=['navTeam','navRota','navAttendance','navLeave','navCompanylog','navPayroll'];

// 0) Established business (demo has staff + 4 studios) must keep the tools — no regression.
if(run("teamToolsOn()")!==true) F('a business with staff/studios should show team tools');
run("applyTeamVisibility();");
CLUSTER.forEach(id=>{if(d(id)==='none')F(id+' is hidden for a business that HAS a team (regression)');});

// 1) Forced OFF hides the whole cluster and its sidebar heading.
run("SETTINGS.teamTools='off';applyTeamVisibility();");
CLUSTER.forEach(id=>{if(d(id)!=='none')F(id+' still visible when team tools are turned off');});
if(d('navGrpTeam')!=='none') F('the Team sidebar heading stays visible when the cluster is hidden');
// the Settings checkbox reflects the state
if(run("document.getElementById('set_teamtools').checked")!==false) F('the Settings toggle does not reflect the off state');

// 2) A hidden view, reached directly, is redirected to the dashboard.
run("activeView='orders';");
try{run("go('team');");}catch(e){F('go(team) threw with team tools off → '+e.message);}
if(run("activeView")!=='activity') F('navigating to a hidden team view was not redirected to the dashboard');

// 3) Forced ON reveals the cluster again.
run("SETTINGS.teamTools='on';applyTeamVisibility();");
CLUSTER.forEach(id=>{if(d(id)==='none')F(id+' still hidden when team tools are turned on');});
if(d('navGrpTeam')==='none') F('the Team heading stays hidden even though team tools are on');

// 4) AUTO default: one studio + a lone owner hides the cluster; hiring a 2nd teammate reveals it.
run("SETTINGS.__b=SETTINGS.branches;SETTINGS.__s=getStaff();delete SETTINGS.teamTools;SETTINGS.branches=[{id:'b1',name:'Solo studio',active:true}];setStaff([{id:'s1',name:'Owner',active:true,status:'Active'}]);");
if(run("teamToolsOn()")!==false) F('a one-studio, one-person shop should hide team tools by default (auto)');
run("setStaff(getStaff().concat([{id:'s2',name:'New hire',active:true,status:'Active'}]));");
if(run("teamToolsOn()")!==true) F('adding a second teammate should reveal team tools automatically (auto)');
run("SETTINGS.branches=SETTINGS.__b;setStaff(SETTINGS.__s);delete SETTINGS.__b;delete SETTINGS.__s;delete SETTINGS.teamTools;");

/* ===================================================================================
   5) NO NARRATION — 29 October.

   "we made some corrections yesterday only for me to see them in other places and it
   kind of broke my heart and i feel you might not have been too thorough."

   Three separate sessions cut explanation text off the screen Kayode photographed and
   left the same shape of line on the next one. So this is the whole pattern rather than
   the screen: an inventory was taken of all 130 prose lines in the app and the rule
   applied to every one of them was

     CUT   narration: how the app works, that it works, or a restatement of what is
           already on the screen. Nothing is lost by deleting it.
     KEEP  consequence — what a control does when you press it, above all a money or an
           irreversible one — and what a figure counts, on a screen where somebody
           decides something from the figure.
     KEEP  empty states. They only show when there is nothing to show.

   Two halves below. The first names the lines that were cut, so they cannot come back
   by somebody restoring an old block. The second is a RATCHET on the total, because the
   failure mode here is not one bad line, it is drift: nobody ever adds story on purpose,
   it arrives one helpful sentence at a time. If a new line is genuinely needed, raise
   the ceiling in the same commit and say why. =================================== */
{
  const CUT = [
    ['the order timeline footnote',      'no extra logging'],
    ['the empty timeline',               'story builds here automatically'],
    ['the correspondence list',          'typed twice'],
    ['the batch order form',             'Tracked wave by wave'],
    ['the per-item modal',               'not made the same way'],
    ['the per-item subtitle',            'each one tracked on its own'],
    ['the import screen',                'Moving from another app'],
    ['the branch form',                  'drives the whole app'],
    ['the feedback form',                'A person reads every one'],
    ['the payslip list',                 'Tap a month to open its payslip'],
    ['the measurement source field',     'fitting problem later has an answer'],
    ['the run modal',                    'making its own rail'],
    ['the campaign screen',              'comes with the backend'],
  ];
  /* Comments out first. The repo explains itself in block comments, and one of
     them says 'not made the same way' to record why that line went. Reading a
     comment as shipped text is the same miss that cost a cycle on the Duplicate
     gate yesterday. */
  const shipped = html.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  CUT.forEach(function (p) {
    if (shipped.indexOf(p[1]) >= 0) F(p[0] + ' is telling the story again: "' + p[1] + '"');
  });

  /* and the two that are NOT narration, both guarded by gates of their own
     (audit_runs, audit_pieces): a screen naming a concept the reader has never
     met. Checked here too so a future no-story sweep sees why they survived. */
  if (shipped.indexOf('Materials in, stock out') < 0) F('the run screen no longer says what a run is (audit_runs guards this too)');
  if (shipped.indexOf('own stages') < 0) F('the per-item screen no longer says why two pieces sit at different stages');

  /* THE RATCHET. Count every line of prose the app ships, the way the inventory
     did: strip inner tags first, or a hint carrying a <b> reads as four words
     and is missed — which is exactly how the first run of this sweep lost the
     QC modal. */
  const plain = s => s.replace(/<[^>]*>/g, ' ')
                      .replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' X ')
                      .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  let prose = 0;
  ['sd', 'ad', 'otl-foot', 'msub'].forEach(function (c) {
    const re = new RegExp('class="' + c + '"', 'g');
    let m;
    while ((m = re.exec(shipped))) {
      const after = shipped.slice(m.index);
      const gt = after.indexOf('>');
      if (gt < 0) continue;
      let win = after.slice(gt + 1, gt + 1 + 420);
      const end = win.indexOf('</div>');
      if (end >= 0) win = win.slice(0, end);
      if (plain(win).split(/\s+/).filter(w => w && w !== 'X').length >= 5) prose++;
    }
  });
  /* THE SECOND FAMILY. page-sub is a different class on a different element and
     the counter above never saw it, so three paragraphs survived the whole
     no-story sweep and were photographed the next morning. One with an id is
     filled at runtime with a count or a date and is data, not prose. */
  const PS = /<(p|span|div)([^>]*class="page-sub"[^>]*)>([\s\S]*?)<\/\1>/g;
  let psm;
  while ((psm = PS.exec(shipped))) {
    if (/\bid="/.test(psm[2])) continue;
    if (plain(psm[3]).split(/\s+/).filter(w => w && w !== 'X').length >= 5) prose++;
  }

  /* SETTINGS IS A LIST OF TITLES, not a scroll. 27 panels stacked was about
     twenty phone screens to reach one switch. The seven groups already existed;
     what was missing was that they came after Closing and About, that the first
     one opened by default, and that the four panels with no group never
     collapsed at all. */
  if (!/function makeSettingsCollapsible\(\)/.test(shipped)) F('Settings no longer collapses on a phone');
  if (!/capStatGrids\(\);makeSettingsCollapsible\(\)/.test(shipped)) F('makeSettingsCollapsible is defined but never called');
  if (!/grouped\.contains\(p\)/.test(shipped)) F('a panel inside a group can grow a second chevron again, which is two taps for one switch');
  if (!/function unwirePanel\(p\)/.test(shipped)) F('nothing undoes a chevron on a panel that is later moved into a group');
  if (!/insertBefore\(grouped,v\.firstChild\)/.test(shipped)) F('Settings opens on Closing and About again instead of the groups');

  /* MONEY AND PRODUCTION, 29 October. Measured at 375px before anything was
     changed, because guessing which page is long is how three passes went
     wrong: Money carried 2,868px of panels, Production 1,970, and Clients
     1,115 which IS the client list. So Clients is deliberately absent from
     collapsePhonePanels and that absence is checked — a later pass that
     "does every page" and pads the one that was already fine is the same
     dishonesty as one that skips the page that was not. */
  if (!/function collapseViewPanels\(viewId,keepOpen\)/.test(shipped)) F('the panel stacks on Money and Production no longer collapse on a phone');
  if (!/capStatGrids\(\);makeSettingsCollapsible\(\);collapsePhonePanels\(\)/.test(shipped)) F('collapsePhonePanels is defined but never called');
  {
    const fn = (shipped.match(/function collapsePhonePanels\(\)\{[\s\S]*?\n\}/) || [''])[0];
    if (!/collapseViewPanels\("view-finance",\[\]\)/.test(fn)) F('Money no longer collapses every panel; its four cards are the page and the rest are sections');
    if (!/collapseViewPanels\("view-production",\["prodFocusPanel"\]\)/.test(fn)) F('Production no longer keeps Workroom focus open, which is what that page is for');
    if (/view-customers/.test(fn)) F('Clients is being collapsed: its one panel IS the client list, so there is nothing to shut that is not the page');
  }
  /* and a shut row is a title, its button and a chevron — not a chart's
     reserved height, not a segmented control for content that is not shown. */
  if (!/\.panel\.collapsed\{min-height:0\}/.test(shipped)) F('a shut chart panel reserves 200px for a chart it is not drawing');
  if (!/\.panel\.collapsed > \.panel-head \.seg\{display:none!important\}/.test(shipped)) F('a shut panel still shows a period toggle for content that is not on screen (the seg carries an inline display:flex, so this needs !important)');

  /* NO SLACK. It had two, and two is exactly how many sentences can be added
     before anybody notices. 69 is what the app ships on 29 October 2026 with
     page-sub counted. Adding a line means raising this number in the same
     commit and saying which of the two it is. */
  const CEILING = 69;
  if (prose > CEILING) F('the app now ships ' + prose + ' lines of prose, over the ' + CEILING +
    ' agreed on 29 October. Either it is consequence and belongs somewhere tighter, or it is story. Raise this number in the same commit and say which.');
  console.log('  prose lines shipped: ' + prose + ' (ceiling ' + CEILING + ')');
}

console.log('Simplicity / progressive-disclosure audit:');
console.log('  cluster gated: '+CLUSTER.join(' · '));
console.log(fails.length? 'FAILURES ('+fails.length+'):\n'+fails.map(f=>'  ✗ '+f).join('\n') : '  ✓ solo shops hide the team & HR cluster, hidden views redirect, and tools reveal on hire or via Settings');
process.exit(fails.length?1:0);
