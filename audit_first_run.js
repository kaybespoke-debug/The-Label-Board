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

  b.run("setupToggleDoes('footwear');");
  fillSetup(b, { name: 'Okoro & Sons Shoes', location: 'Aba, Abia', online: true });
  b.run('saveStudioSetup();');

  ok('the studio is called what they said',
     b.run('(SETTINGS.company&&SETTINGS.company.name)') === 'Okoro & Sons Shoes',
     b.run('(SETTINGS.company&&SETTINGS.company.name)'));
  ok('it does what they said', JSON.stringify(b.run('getBranches()[0].does')) === '["footwear"]',
     JSON.stringify(b.run('getBranches()[0].does')));
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
  b.run("setupToggleDoes('rtw');");
  fillSetup(b, { name: 'House of Nneka', online: false });
  b.run('saveStudioSetup();');
  ok('a studio that only stocks and sells is retail', b.run('showsRetail()') === true);
  ok('and is not given a production board it has no use for',
     b.run('showsBespoke()') === false, 'ready-to-wear only should not show Production');

  const c = freshStudio();
  c.run('openStudioSetup();');
  c.run("setupToggleDoes('rtw');");
  c.run("setupToggleDoes('bespoke');");
  fillSetup(c, { name: 'Both Ways' });
  c.run('saveStudioSetup();');
  ok('a studio that does both gets both', c.run('showsRetail()') && c.run('showsBespoke()'));
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
