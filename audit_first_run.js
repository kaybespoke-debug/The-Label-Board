// What does a real studio see the first time it signs in?
//
// Nothing ever asked a new tenant anything. They inherited DEFAULTS: a company
// called LAYI, which is the demo tenant's name; one branch called "Main"; and
// branchDoes() falling through to ['bespoke','rtw'] because the branch named no
// trade. A shoemaker's first sight of the app was somebody else's label doing
// two trades they are not in, with a production board of somebody else's stages
// — and the only way to correct it was to find Settings and know what to change.
//
// The answers matter more than the screen. Production stages, measurements, the
// word for an item, which tabs appear and where a website order lands are all
// derived from what a studio does and how it sells. This checks the asking, the
// deriving, and the not-asking-twice.
'use strict';
const fs = require('fs');
const vm = require('vm');

const appPath = process.argv[2] || 'site/layi_dashboard.html';
const html = fs.readFileSync(appPath, 'utf8');

let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = re.exec(html))) {
  const a = m[1] || '';
  if (/\bsrc\s*=/.test(a)) continue;
  const t = a.match(/type\s*=\s*["']([^"']+)["']/i);
  if (t && !/javascript|module/i.test(t[1])) continue;
  code += '\n;' + m[2] + '\n';
}

function boot() {
  const els = {}, _ls = {};
  const mkEl = id => ({ _id: id, innerHTML: '', value: '', checked: false, textContent: '', placeholder: '',
    style: {}, dataset: {}, options: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    setAttribute() {}, getAttribute() { return null }, appendChild(c) { return c }, addEventListener() {},
    removeEventListener() {}, querySelector() { return null }, querySelectorAll() { return [] },
    focus() {}, select() {}, remove() {}, closest() { return null } });
  const sb = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    document: { getElementById(i) { return els[i] || (els[i] = mkEl(i)) }, querySelector() { return mkEl() },
      querySelectorAll() { return [] }, createElement() { return mkEl() }, addEventListener() {},
      removeEventListener() {}, body: mkEl(), documentElement: mkEl(), head: mkEl(), execCommand() { return true } },
    localStorage: { getItem(k) { return k in _ls ? _ls[k] : null }, setItem(k, v) { _ls[k] = String(v) }, removeItem(k) { delete _ls[k] } },
    setTimeout: f => { try { f && f() } catch (e) {} }, clearTimeout() {}, setInterval() {}, clearInterval() {},
    requestAnimationFrame: f => { try { f && f() } catch (e) {} },
    navigator: { userAgent: 'node', onLine: true }, location: { href: '', hash: '', search: '' },
    alert(msg) { sb.__alert = String(msg || ''); }, confirm() { return true }, prompt() { return '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise, Error, Intl,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary')
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'app' });
  return { sb, els, run: e => vm.runInContext(e, sb) };
}

/* A studio as it arrives: signed in, nothing of its own yet. */
function freshStudio() {
  const b = boot();
  b.run('liveMode=true; myBusinessId="22222222-2222-2222-2222-222222222222";');
  b.run('SETTINGS=Object.assign({},DEFAULTS);');
  b.run('save("layi_dash_orders",[]);');
  return b;
}
/* Fill the modal's fields the way the browser would from the markup. */
function fillSetup(b, { name, location, online }) {
  const d = b.run('setupDraft');
  ['su_name', 'su_loc', 'su_show', 'su_onl'].forEach(id => { b.els[id] = b.els[id] || { value: '', checked: false }; });
  b.els.su_name.value = name != null ? name : (d.name || '');
  b.els.su_loc.value = location != null ? location : (d.location || '');
  b.els.su_show.checked = true;
  b.els.su_onl.checked = !!online;
}

// ---------------------------------------------------------------------
section('A new studio is asked, an existing one is not');
// ---------------------------------------------------------------------
{
  const b = freshStudio();
  ok('a studio signing in for the first time is asked', b.run('needsStudioSetup()') === true);

  const b2 = freshStudio();
  b2.run('SETTINGS.setupDone=true;');
  ok('a studio that has answered is never asked again', b2.run('needsStudioSetup()') === false);

  const b3 = freshStudio();
  b3.run('loadExample(true);');
  ok('a studio with work already in it is not asked', b3.run('needsStudioSetup()') === false,
     'it would interrupt somebody mid-flight');

  const b4 = boot();
  b4.run('demoLogin();');
  ok('somebody exploring the demo is never asked', b4.run('needsStudioSetup()') === false,
     'liveMode is false, so there is no tenant to set up');
}

// ---------------------------------------------------------------------
section('The answers become the studio');
// ---------------------------------------------------------------------
{
  const b = freshStudio();
  b.run('openStudioSetup();');
  ok('the name does not arrive pre-filled with the demo tenant\'s',
     b.run('setupDraft.name') === '', b.run('setupDraft.name'));

  // Two answers now, not one: what they work in, then how it reaches the customer.
  // Okoro & Sons bench-make shoes AND keep a stocked rail, so both modes.
  b.run("setupToggleCraft('footwear');");
  b.run("setupToggleMode('footwear','stock');");
  fillSetup(b, { name: 'Okoro & Sons Shoes', location: 'Aba, Abia', online: true });
  b.run('saveStudioSetup();');

  ok('the studio is called what they said',
     b.run('(SETTINGS.company&&SETTINGS.company.name)') === 'Okoro & Sons Shoes',
     b.run('(SETTINGS.company&&SETTINGS.company.name)'));
  ok('it does what they said, both halves of it',
     JSON.stringify(b.run('getBranches()[0].does')) === '["footwear:make","footwear:stock"]',
     JSON.stringify(b.run('getBranches()[0].does')));
  ok('making opens the production board', b.run('showsBespoke()') === true);
  ok('and the stocked rail opens the Shop and its Sales',
     b.run('showsRTW()') === true && b.run('salesVisible()') === true);
  ok('it sells how they said',
     b.run('getBranches()[0].channels').indexOf('online') >= 0,
     JSON.stringify(b.run('getBranches()[0].channels')));
  ok('there is one studio, not the demo\'s four', b.run('getBranches().length') === 1,
     String(b.run('getBranches().length')));

  /* The point of asking. A shoemaker's board should say Clicking and Lasting
     the first time it is opened, not Fabric Received. */
  ok('the production board is their trade\'s board',
     b.run('STAGES.indexOf("Clicking")') > 0, b.run('JSON.stringify(STAGES)'));
  ok('and not the bespoke default they never chose',
     b.run('STAGES.indexOf("Fabric Received")') < 0, b.run('JSON.stringify(STAGES)'));

  ok('it is not asked again after answering', b.run('needsStudioSetup()') === false);
  ok('and the answers survive a reload',
     JSON.parse(b.sb.localStorage.getItem('layi_dash_settings')).company.name === 'Okoro & Sons Shoes');
}

// ---------------------------------------------------------------------
section('It refuses the answers it cannot work without');
// ---------------------------------------------------------------------
{
  const b = freshStudio();
  b.run('openStudioSetup();');
  fillSetup(b, { name: '', location: '' });
  b.sb.__alert = '';
  b.run('saveStudioSetup();');
  ok('a studio cannot be set up with no name', /called/i.test(b.sb.__alert || ''), b.sb.__alert);
  ok('and is still asked afterwards', b.run('needsStudioSetup()') === true);

  fillSetup(b, { name: 'Somebody' });
  b.sb.__alert = '';
  b.run('saveStudioSetup();');
  ok('nor with nothing ticked for what it does',
     /at least one/i.test(b.sb.__alert || ''), b.sb.__alert);

  /* A craft with no mode opens no tab. Storing it would leave a studio looking
     set up and finding an app with nothing in it, so the screen asks again. */
  b.run("setupDraft.does=['garments'];");
  b.sb.__alert = '';
  b.run('saveStudioSetup();');
  ok('nor with a craft but no answer to how it reaches the customer',
     /make it here|ready made/i.test(b.sb.__alert || ''), b.sb.__alert);
  ok('and is still asked afterwards', b.run('needsStudioSetup()') === true);
}

// ---------------------------------------------------------------------
section('Skipping is an answer, not a deferral');
// ---------------------------------------------------------------------
// A setup screen that comes back every morning is worse than none: people
// learn to dismiss it, and then dismiss the one that mattered.
{
  const b = freshStudio();
  b.run('openStudioSetup();');
  b.run('skipStudioSetup();');
  ok('skipping is remembered', b.run('needsStudioSetup()') === false);
  ok('and it did not quietly name them after the demo tenant',
     b.run('(SETTINGS.company&&SETTINGS.company.name)') !== 'Okoro & Sons Shoes');
}

// ---------------------------------------------------------------------
section('Two trades, and the tabs that follow');
// ---------------------------------------------------------------------
{
  const b = freshStudio();
  b.run('openStudioSetup();');
  // A boutique that buys its rail in: garments, sold ready made, nothing made here.
  b.run("setupToggleCraft('garments');");
  b.run("setupToggleMode('garments','stock');");
  b.run("setupToggleMode('garments','make');");
  fillSetup(b, { name: 'House of Nneka', online: false });
  b.run('saveStudioSetup();');
  ok('a studio that only stocks and sells is retail', b.run('showsRetail()') === true);
  ok('and is not given a production board it has no use for',
     b.run('showsBespoke()') === false, 'ready-to-wear only should not show Production');
  ok('turning off the last mode of a craft unticks the craft rather than leaving it idle',
     JSON.stringify(b.run('getBranches()[0].does')) === '["garments:stock"]',
     JSON.stringify(b.run('getBranches()[0].does')));

  /* One craft, both modes: a label that sews its own rail. This is the studio the
     old single-answer list could not describe at all. */
  const c = freshStudio();
  c.run('openStudioSetup();');
  c.run("setupToggleCraft('garments');");
  c.run("setupToggleMode('garments','stock');");
  fillSetup(c, { name: 'Both Ways' });
  c.run('saveStudioSetup();');
  ok('a studio that makes what it sells gets both', c.run('showsRetail()') && c.run('showsBespoke()'));
  ok('and that is one craft in two modes, not two crafts',
     JSON.stringify(c.run('getBranches()[0].does')) === '["garments:make","garments:stock"]',
     JSON.stringify(c.run('getBranches()[0].does')));
}

// ---------------------------------------------------------------------
section('How many of you, and how many outlets');
// ---------------------------------------------------------------------
/* Both are optional bands rather than a number, because a studio setting
   itself up on a phone knows "two or three of us" and does not know its
   headcount to the person.

   The rule worth guarding is that neither answer CREATES anything. Somebody
   who says "six or more" must not find six blank staff records waiting to be
   deleted — the answer is worth a visible Team tab and a plan that fits, and
   nothing else. Handing a new customer a tidying job as the first thing they
   ever do in the app is a worse first impression than asking nothing. */
{
  const a = freshStudio();
  a.run('openStudioSetup();');
  const form = a.run('renderStudioSetup(),(document.getElementById("modal")||{}).innerHTML') || '';
  ok('the setup screen asks how many people work with them', /How many people work with you/.test(form));
  ok('and how many studios or outlets they run', /How many studios or outlets/.test(form));
  /* The heading and the answers are two different things. Checking only the
     heading passed against a version where the question was there and every
     option had gone, which is a question nobody can answer. */
  a.run('SETUP_TEAM').forEach(o =>
    ok('the "' + o.label + '" answer is offered', form.indexOf('>' + o.label + '<') >= 0));
  a.run('SETUP_OUTLETS').forEach(o =>
    ok('the "' + o.label + '" outlet answer is offered', form.indexOf('>' + o.label + '<') >= 0));
  ok('and every option is tappable', (form.match(/setupPick\('(team|outlets)'/g) || []).length >=
    a.run('SETUP_TEAM').length + a.run('SETUP_OUTLETS').length);
  ok('both are marked optional, so nobody is blocked by a number they do not know',
    (form.match(/\(optional\)/g) || []).length >= 3);
  ok('"tick all that applies" is the wording on both multi-answer questions',
    (form.match(/tick all that applies/gi) || []).length >= 2);

  // saying nothing must still work, and must change nothing
  const q = freshStudio();
  q.run('openStudioSetup();');
  q.run("setupToggleCraft('garments');");
  fillSetup(q, { name: 'Quiet Studio' });
  q.run('saveStudioSetup();');
  ok('a studio that answers neither count is still set up', q.run("SETTINGS.setupDone") === true);
  ok('and is not given team tools it did not ask for', q.run("SETTINGS.teamTools") !== 'on');

  const b = freshStudio();
  b.run('openStudioSetup();');
  b.run("setupToggleCraft('garments');");
  b.run("setupPick('team','many');setupPick('outlets','two');");
  fillSetup(b, { name: 'Six Of Us' });
  const staffBefore = b.run('getStaff().length');
  b.run('saveStudioSetup();');

  ok('the answers are kept, so nobody is asked twice',
    b.run("SETTINGS.setupTeamBand") === 'many' && b.run("SETTINGS.setupOutletsBand") === 'two');
  ok('saying there are six of you reveals the team tabs at once',
    b.run("teamToolsOn()") === true, 'teamTools=' + b.run('SETTINGS.teamTools'));
  ok('and invents nobody: no staff records are created from a rough count',
    b.run('getStaff().length') === staffBefore);
  ok('and invents no outlets either: one branch is set up, the rest are theirs to name',
    b.run('getBranches().length') === 1);
  ok('the plan starts as one that fits what they described',
    b.run("SETTINGS.plan") === b.run("smallestPlanFitting(3,8).id"),
    'got ' + b.run('SETTINGS.plan'));
  ok('which for six people is not the three-seat plan',
    b.run("SETTINGS.plan") !== 'starter' && b.run("SETTINGS.plan") !== 'trial');

  // a solo studio is left exactly as it was
  const s = freshStudio();
  s.run('openStudioSetup();');
  s.run("setupToggleCraft('garments');");
  s.run("setupPick('team','solo');setupPick('outlets','one');");
  fillSetup(s, { name: 'Just Me' });
  s.run('saveStudioSetup();');
  ok('a solo studio is not forced into the team tabs it does not need yet',
    s.run("SETTINGS.teamTools") !== 'on');
  ok('and the automatic reveal still works for them on the day they hire',
    s.run("(function(){var l=getStaff();l.push({id:'x1',name:'A',active:true});l.push({id:'x2',name:'B',active:true});setStaff(l);return teamToolsOn();})()") === true);
  // and a band can be unpicked
  const u = freshStudio();
  u.run('openStudioSetup();');
  u.run("setupPick('team','many');setupPick('team','many');");
  ok('a band can be tapped again to unset it', u.run("setupDraft.team") === '');
}

console.log('\nFirst run audit:');
console.log('  asked once, on the first live sign-in, and never again');
if (failures.length) {
  console.log('\n✗ ' + failures.length + ' problem(s):');
  failures.forEach(f => console.log('   - ' + f));
  process.exit(1);
}
console.log('  ✓ ' + pass + ' checks: a new studio is asked what it is, the answers drive');
console.log('    its stages, tabs and channels, and nobody inherits the demo tenant');
