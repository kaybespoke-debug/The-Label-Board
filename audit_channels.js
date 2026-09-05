// How a studio sells, and whether saying so changes anything.
//
// Not every studio is one shape. Some cut and sew to order, some only stock
// and sell, some do both. Some sell over a counter, some only online, some
// both — and an outlet that sells online is where a website order has to land.
//
// The app carries that as `channels` on each branch, and Settings has had the
// checkboxes for it all along. What nothing checked was whether ticking them
// survives a save, or whether anything downstream reads the answer. Markup
// existing is not the same as a feature working — twice this week a control
// was present and inert — so this drives the real save path and then asks the
// routing what it thinks.
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

const els = {};
const _ls = {};
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
const run = e => vm.runInContext(e, sb);
run('demoLogin();');
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");

/* The modal is rendered by writing HTML into the overlay, which a stubbed DOM
   does not turn into elements. So after opening the editor, fill the stub
   fields the way the browser would have from the markup's own value="…" — the
   name and location come back populated, and the checkboxes reflect the
   branch's current channels. Without this the first thing saveBranchEdit sees
   is an empty name, and it refuses before reaching anything worth testing. */
function openEditor(id) {
  run(`openBranchEdit(${JSON.stringify(id)});`);
  const d = run('beDraft');
  els['be_name'] = els['be_name'] || mkEl('be_name');
  els['be_loc'] = els['be_loc'] || mkEl('be_loc');
  els['be_show'] = els['be_show'] || mkEl('be_show');
  els['be_onl'] = els['be_onl'] || mkEl('be_onl');
  els['be_name'].value = d.name || '';
  els['be_loc'].value = d.location || '';
  els['be_show'].checked = (d.channels || []).indexOf('showroom') >= 0;
  els['be_onl'].checked = (d.channels || []).indexOf('online') >= 0;
  return d;
}

// ---------------------------------------------------------------------
section('A studio can say how each outlet sells');
// ---------------------------------------------------------------------
// Driven through the real editor rather than by writing SETTINGS directly:
// the point is that the control a studio actually uses does something.
{
  const first = run('getBranches()[0].id');
  openEditor(first);
  ok('the editor opens with the branch loaded', run('!!beDraft'), 'no draft');

  // tick Online as well as Showroom, the way the form does
  run("document.getElementById('be_show').checked=true;document.getElementById('be_onl').checked=true;");
  run('saveBranchEdit();');

  const chans = run(`(getBranches().find(b=>b.id===${JSON.stringify(first)})||{}).channels`);
  ok('ticking Online is saved on the branch', Array.isArray(chans) && chans.indexOf('online') >= 0,
     JSON.stringify(chans));
  ok('and Showroom stays ticked alongside it', Array.isArray(chans) && chans.indexOf('showroom') >= 0,
     JSON.stringify(chans));

  // survives a reload: settings are what the app reads back on boot
  const stored = JSON.parse(sb.localStorage.getItem('layi_dash_settings') || '{}');
  const savedBranch = (stored.branches || []).find(b => b.id === first) || {};
  ok('it is written to storage, so it survives a reload',
     (savedBranch.channels || []).indexOf('online') >= 0, JSON.stringify(savedBranch.channels));
}

// ---------------------------------------------------------------------
section('Saying it changes where a website order lands');
// ---------------------------------------------------------------------
// This is the whole point of the setting. An order taken on the website has to
// arrive at an outlet that sells online, not simply the first one in the list.
{
  const names = run('getBranches().map(b=>b.name)');
  if (names.length > 1) {
    // only the SECOND outlet sells online
    run(`(function(){var bs=getBranches().slice();
         bs.forEach(function(b,i){b.channels=(i===1)?['showroom','online']:['showroom'];});
         SETTINGS.branches=bs;save('layi_dash_settings',SETTINGS);})();`);
    ok('a website order lands at the outlet that sells online',
       run('webOnlineBranch()') === names[1], run('webOnlineBranch()') + ' (expected ' + names[1] + ')');

    // and when nobody sells online it must still land somewhere real
    run(`(function(){var bs=getBranches().slice();
         bs.forEach(function(b){b.channels=['showroom'];});
         SETTINGS.branches=bs;save('layi_dash_settings',SETTINGS);})();`);
    const fallback = run('webOnlineBranch()');
    ok('with no online outlet it still names a real studio rather than nothing',
       names.indexOf(fallback) >= 0, String(fallback));
  } else {
    ok('a website order lands at the only studio there is',
       run('webOnlineBranch()') === names[0], String(run('webOnlineBranch()')));
  }
}

// ---------------------------------------------------------------------
section('An outlet always sells somehow');
// ---------------------------------------------------------------------
// Unticking both is not a state a studio can be in: an outlet that sells
// through no channel at all cannot take an order, and the branch would drop
// out of routing entirely rather than reporting itself as misconfigured.
{
  const first = run('getBranches()[0].id');
  openEditor(first);
  run("document.getElementById('be_show').checked=false;document.getElementById('be_onl').checked=false;");
  run('saveBranchEdit();');
  const chans = run(`(getBranches().find(b=>b.id===${JSON.stringify(first)})||{}).channels||[]`);
  ok('unticking everything falls back to a showroom rather than nothing',
     chans.length > 0, JSON.stringify(chans));
}

// ---------------------------------------------------------------------
section('And the studio is asked what it does, not assumed');
// ---------------------------------------------------------------------
// A branch with no trade cannot be saved. Production stages, measurements and
// the word for an item all hang off it, so an unanswered branch would silently
// take the defaults of whoever wrote them.
{
  const first = run('getBranches()[0].id');
  openEditor(first);
  run('beDraft.does=[];');
  sb.__alert = '';
  run('saveBranchEdit();');
  ok('a branch cannot be saved without saying what it does',
     /at least one/i.test(sb.__alert || ''), sb.__alert || 'it saved silently');
}

console.log('\nChannels audit:');
console.log('  channels a branch can sell through: showroom · online');
if (failures.length) {
  console.log('\n✗ ' + failures.length + ' problem(s):');
  failures.forEach(f => console.log('   - ' + f));
  process.exit(1);
}
console.log('  ✓ ' + pass + ' checks: a studio sets how each outlet sells, it survives a reload,');
console.log('    it decides where a website order lands, and an outlet is never sell-nowhere');
