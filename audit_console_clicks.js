/* audit_console_clicks.js — every button on the console points at something.
 *
 * Kayode, 20 September 2026: "edit button doesnt work, lot of buttons doesnt
 * work on the admin console, could you do do a proper test, check every button,
 * every command, every tab works".
 *
 * WHY THE OTHER GATES MISS THIS
 *
 * audit_console_pages.js renders pages and reads the HTML that comes out. That
 * catches a page that throws. It cannot catch a page that renders perfectly and
 * whose buttons call a function nobody defined, because the string
 * onclick="formEditSubscriber(4)" is just text until somebody clicks it. The
 * page looks right, the gate goes green, and the button does nothing at all.
 *
 * That is not hypothetical. On 19 September a footer row in referralBody kept
 * summing three variables a change had removed: the page threw for a real
 * operator while 105 checks reported green. This is the same failure one layer
 * out, and it is the one Kayode is actually hitting.
 *
 * WHAT THIS DOES
 *
 * Renders every page, every detail screen and every tab inside them, pulls out
 * every onclick in the HTML, works out which function each one calls, and
 * checks that function exists. Then it calls the safe ones and reports any that
 * throw.
 *
 * WHAT "SAFE" MEANS
 *
 * A handler that only builds a modal or switches a tab is called. One that
 * writes through the gateway is NOT: this runs against demo data, but a bug in
 * this harness calling liveDeleteStudio would be a bad way to find out. Those
 * are checked for existence and arity only, and the list of them is here in the
 * open rather than buried in a regex.
 *
 * Run: node audit_console_clicks.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
let pass = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { failures.push(name + (detail ? '  ' + detail : '')); }
  console.log((cond ? '  pass  ' : '  FAIL  ') + name + (detail ? '  ' + detail : ''));
}
function section(t) { console.log('\n' + t); }

/* ---------- boot the console exactly as audit_console_pages does ---------- */
const gate = fs.readFileSync(path.join(root, 'audit_console_pages.js'), 'utf8');
const bootSrc = gate.slice(gate.indexOf('const indexHtml ='),
                           gate.indexOf('/* Exactly what platform_tenant_summary'));
const mod = { exports: {} };
vm.runInNewContext(bootSrc + '\nmodule.exports = { boot, files };',
  { module: mod, exports: mod.exports, require, fs, path, vm, root, URLSearchParams, Buffer, console });
const { boot, files } = mod.exports;

const { sb, run } = boot({});

/* index.html carries a 15k inline script at the bottom, and the boot above only
   loads the files it pulls in with src=. Without it isInstalled(), which the
   settings page calls, does not exist, and this gate reports the settings page
   as broken when it is fine in a browser. The first run of this harness did
   exactly that. A gate that invents a bug is worse than no gate: it spends the
   afternoon somebody would have used on the real one. */
{
  /* the inline block wires up listeners on window, which boot() does not give
     it. Without these the block throws partway; function declarations hoist so
     the handlers still exist, but anything set up by a statement after the
     throw does not, and that is the kind of gap that makes a gate quietly
     partial rather than loudly broken. */
  if (typeof sb.addEventListener !== 'function') sb.addEventListener = function () {};
  if (typeof sb.removeEventListener !== 'function') sb.removeEventListener = function () {};
  if (!sb.screen) sb.screen = { width: 1440, height: 900 };
  /* Every route now calls window.scrollTo, because under 680px the document is
     what scrolls. A browser has it and this sandbox did not, so five perfectly
     good handlers were reported as throwing. audit_partners.js has stubbed it
     for the same reason since the portal learned this first. */
  if (typeof sb.scrollTo !== 'function') sb.scrollTo = function () {};
  const html = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
  let n = 0;
  html.split('<script').slice(1).forEach(part => {
    const tagEnd = part.indexOf('>');
    const tag = part.slice(0, tagEnd + 1);
    if (tag.includes('src=')) return;                 // already loaded by boot
    const body = part.slice(tagEnd + 1, part.indexOf('</script>'));
    if (!body.trim()) return;
    try { vm.runInContext(body, sb, { filename: 'index.html inline' }); n++; }
    catch (e) { console.log('  ..    inline script did not load: ' + e.message); }
  });
  console.log('  ..    loaded ' + n + ' inline script block(s) from index.html');
}

/* Demo data, so the pages have rows to draw. A page with nothing in it renders
   no buttons, and this whole gate would then pass by having nothing to check,
   which is the most comfortable way for a test to be useless. */
try { run('loadExampleData()'); } catch (e) { console.log('  ..    loadExampleData: ' + e.message); }
const subs = run('(DB.subscribers || []).length');
const staff = run('(DB.staff || []).length');
section('There is something on the screen to click');
ok('the console has demo subscribers to draw (' + subs + ')', subs > 0);
ok('and staff (' + staff + ')', staff > 0);

/* ---------- render everything ---------- */
const screens = {};   // name -> html

function render(label, expr) {
  try {
    const html = run(expr);
    if (typeof html !== 'string') { ok(label + ' renders', false, 'returned ' + typeof html); return; }
    screens[label] = html;
    ok(label + ' renders', html.length > 0, '(' + html.length + ' chars)');
  } catch (e) {
    ok(label + ' renders', false, 'threw: ' + e.message);
  }
}

section('Every page renders');
const pageNames = run('Object.keys(PAGES)');
pageNames.forEach(p => render('page ' + p, 'PAGES.' + p + '()'));

section('Every detail screen renders, on every one of its tabs');
/* The detail screens take an id and read UI.vtab for which tab to draw, so the
   tabs are found by rendering once and reading the tab strip back out. */
const DETAIL_SOURCE = {
  sub:     'DB.subscribers[0] && DB.subscribers[0].id',
  staff:   'DB.staff[0] && DB.staff[0].id',
  slip:    '(DB.payslips && DB.payslips[0]) && DB.payslips[0].id',
  ticket:  '(DB.tickets && DB.tickets[0]) && DB.tickets[0].id',
  partner: '(DB.partners && DB.partners[0]) && DB.partners[0].id',
  pay:     '(DB.payments && DB.payments[0]) && DB.payments[0].id',
  onb:     '(DB.onboarding && DB.onboarding[0]) && DB.onboarding[0].id',
  fb:      '(DB.feedback && DB.feedback[0]) && DB.feedback[0].id',
  ann:     '(DB.announcements && DB.announcements[0]) && DB.announcements[0].id',
};
const detailNames = run('Object.keys(DETAIL)');
detailNames.forEach(d => {
  const idExpr = DETAIL_SOURCE[d];
  if (!idExpr) { console.log('  ..    no demo row wired for DETAIL.' + d + ', skipped'); return; }
  let id;
  try { id = run(idExpr); } catch (e) { id = null; }
  if (id === null || id === undefined) { console.log('  ..    no demo row for DETAIL.' + d + ', skipped'); return; }

  /* first pass on the default tab, to find the tab strip */
  render('detail ' + d, 'DETAIL.' + d + '(' + JSON.stringify(id) + ')');
  const first = screens['detail ' + d] || '';
  const tabs = [...first.matchAll(/setVTab\((?:'|&#39;)([a-z0-9]+)(?:'|&#39;)\s*,\s*(?:'|&#39;)([a-z0-9-]+)/gi)]
    .map(m => m[2]);
  [...new Set(tabs)].forEach(tab => {
    run('UI.vtab[' + JSON.stringify('' + d + id) + '] = ' + JSON.stringify(tab) + ';');
    render('detail ' + d + ' tab ' + tab, 'DETAIL.' + d + '(' + JSON.stringify(id) + ')');
  });
});

/* ---------- every onclick names a function that exists ---------- */
section('Every button calls something that exists');

/* Handlers that reach the live gateway. Checked for existence, never called. */
const DO_NOT_CALL = [
  'live', 'delete', 'remove', 'save', 'send', 'invite', 'suspend', 'reactivate',
  'record', 'issue', 'refund', 'reset', 'unlock', 'signOut', 'clearAllData',
  'loadExample', 'wipe', 'purge', 'approve', 'decline', 'freeze', 'export',
  'download', 'copy', 'print', 'confirm', 'apply', 'run',
];
const risky = n => DO_NOT_CALL.some(w => n.toLowerCase().startsWith(w.toLowerCase()));

const calls = new Map();   // fnName -> Set of screens it appears on
Object.keys(screens).forEach(scr => {
  const html = screens[scr];
  /* onclick="name(args)" and onclick='name(args)', plus onchange and onsubmit */
  const re = /on(?:click|change|submit|input)\s*=\s*(["'])(.*?)\1/gis;
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = m[2];
    /* the first identifier followed by an open bracket is the handler */
    const call = body.match(/([A-Za-z_$][\w$.]*)\s*\(/);
    if (!call) continue;
    const name = call[1];
    if (/^(this|window|document|event)\b/.test(name)) continue;
    if (!calls.has(name)) calls.set(name, new Set());
    calls.get(name).add(scr);
  }
});

const missing = [];
[...calls.keys()].sort().forEach(name => {
  const root0 = name.split('.')[0];
  let exists = false;
  try { exists = run('typeof ' + root0) === 'function' || run('typeof ' + name) === 'function'; }
  catch (e) { exists = false; }
  const where = [...calls.get(name)].slice(0, 3).join(', ');
  if (!exists) missing.push(name + '  (on ' + where + ')');
  ok('button handler exists: ' + name, exists, exists ? '' : 'on ' + where);
});

section('Summary of handlers found');
console.log('  ' + calls.size + ' distinct handlers across ' + Object.keys(screens).length + ' screens');
console.log('  ' + [...calls.keys()].filter(risky).length + ' of them reach the gateway and were not called');

/* ---------- call the safe ones ---------- */
section('The safe handlers run without throwing');
[...calls.keys()].sort().forEach(name => {
  if (risky(name)) return;
  const root0 = name.split('.')[0];
  let isFn = false;
  try { isFn = run('typeof ' + root0) === 'function'; } catch (e) { isFn = false; }
  if (!isFn) return;                      // already reported as missing above

  /* Work out how many arguments it wants and feed it plausible ones.
     Most take an id. The few that do not are named here rather than guessed
     at, because feeding a subscriber id to something expecting a label makes
     this gate report a bug that is entirely its own invention. Three of them
     did exactly that on the first run. */
  let arity = 0;
  try { arity = run(root0 + '.length') || 0; } catch (e) { arity = 0; }
  const id = run('DB.subscribers[0] && DB.subscribers[0].id');
  const SHAPES = {
    editSetting: ['"currency"', '"Default currency"', '"text"'],
    setCalDay:   ['"2026-09-20"'],
    setVTab:     [JSON.stringify('sub' + id), '"profile"'],
    drill:       ['"referrers"'],
    setDashPanel: ['0'],
  };
  /* anything taking a DOM event cannot be called from here at all */
  const WANTS_AN_EVENT = ['togglePop', 'stopPropagation'];
  if (WANTS_AN_EVENT.indexOf(root0) !== -1) {
    console.log('  ..    ' + name + ' takes a DOM event, not callable from here');
    return;
  }

  const args = SHAPES[root0] || [];
  for (let i = args.length; i < arity; i++) args.push(JSON.stringify(id));

  try {
    run(root0 + '(' + args.slice(0, arity).join(',') + ')');
    ok('runs: ' + name + '(' + arity + ' arg' + (arity === 1 ? '' : 's') + ')', true);
  } catch (e) {
    ok('runs: ' + name, false, 'threw: ' + String(e.message).split('\n')[0]);
  }
});

/* =====================================================================
   THE ONE THAT MATTERS: a live id is a uuid, not a number
   =====================================================================
   This is the bug Kayode hit. Every handler was written as

       onclick="doEditSubscriber(' + id + ')"

   which is valid JavaScript while ids are numbers, and a syntax error the
   moment one is a uuid. Demo data has numeric ids, so every gate was green
   and every button on a REAL studio silently did nothing: the click threw
   before it reached the function.

   It had been found once, for the row-opening handler, and fixed there
   alone. Seventy-three others were left. So this renders everything again
   with a uuid in place and asserts that the uuid never appears inside a
   handler without quotes around it. */
section('Every screen survives an id that is a uuid, not a number');
{
  const UUID = 'a3b0c40c-f25c-4e64-8cf4-94f70f6d1aa3';
  run('DB.subscribers.unshift(Object.assign({}, DB.subscribers[0], { id: ' + JSON.stringify(UUID) + ', live: true, name: "Live Studio" }));');
  run('if (DB.staff[0]) DB.staff.unshift(Object.assign({}, DB.staff[0], { id: ' + JSON.stringify(UUID) + ' }));');

  const liveScreens = {};
  pageNames.forEach(p => {
    try { liveScreens['page ' + p] = run('PAGES.' + p + '()'); }
    catch (e) { ok('page ' + p + ' renders with a uuid id', false, 'threw: ' + e.message); }
  });
  try { liveScreens['detail sub'] = run('DETAIL.sub(' + JSON.stringify(UUID) + ')'); }
  catch (e) { ok('the detail panel opens for a uuid studio', false, 'threw: ' + e.message); }

  ok('the detail panel opens for a uuid studio',
     typeof liveScreens['detail sub'] === 'string'
     && !/not found/i.test(liveScreens['detail sub']));

  let naked = 0;
  const examples = [];
  Object.keys(liveScreens).forEach(scr => {
    const html = liveScreens[scr] || '';
    const re = /on(?:click|change|submit|input)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const body = m[1];
      if (body.indexOf(UUID) === -1) continue;
      /* Look at what comes immediately BEFORE the id rather than matching a
         whole quoted token, because a perfectly good handler may glue a prefix
         on: setVTab('sub<uuid>','profile') is quoted and correct, and a check
         for '<uuid>' calls it naked. Seven of those were reported on the first
         run of this block.

         What actually makes it a syntax error is the id arriving straight
         after an opening bracket or a comma with no quote in between. */
      let at = body.indexOf(UUID);
      while (at !== -1) {
        let k = at - 1;
        while (k >= 0 && body[k] === ' ') k--;
        const before = k >= 0 ? body[k] : '(';
        if (before === '(' || before === ',') {
          naked++;
          if (examples.length < 5) examples.push(scr + ': ' + body.slice(0, 90));
        }
        at = body.indexOf(UUID, at + 1);
      }
    }
  });
  ok('no handler drops a uuid into the call unquoted', naked === 0,
     naked ? naked + ' found, e.g. ' + examples[0] : '');
  examples.slice(1).forEach(e => console.log('        also: ' + e));

  run('DB.subscribers = DB.subscribers.filter(function (s) { return s.id !== ' + JSON.stringify(UUID) + '; });');
  run('DB.staff = DB.staff.filter(function (s) { return s.id !== ' + JSON.stringify(UUID) + '; });');
}

/* ---------- the result ---------- */
console.log('\n' + '='.repeat(62));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED:');
  failures.forEach(f => console.log('  - ' + f));
  if (missing.length) {
    console.log('\nButtons pointing at nothing:');
    missing.forEach(m => console.log('  ' + m));
  }
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
console.log('\nEvery button on every screen names a handler that exists, and');
console.log('every handler that does not touch the gateway runs without throwing.');
