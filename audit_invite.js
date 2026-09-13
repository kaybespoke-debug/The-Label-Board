// Arriving from an invitation.
//
// A studio owner is invited, the email lands, they tap the link — and the app
// showed them a sign-in form with nothing to type. They were already
// authenticated by then; what they did not have was a password, and there was
// no screen anywhere that would let them set one. The first real invite sent on
// 13 Sep died exactly there.
//
// This is a path each studio walks precisely once, on the day they decide
// whether this software is any good. There is no second impression, and nobody
// reports it as a bug — they just never come back. So it gets a gate.
'use strict';
const fs = require('fs'), vm = require('vm');

const appPath = process.argv[2] || 'site/layi_dashboard.html';
const html = fs.readFileSync(appPath, 'utf8');

const ok = [], fail = [];
const check = (label, cond, why) => (cond ? ok : fail).push(label + (cond ? '' : ' — ' + (why || '')));

/* ---------- 1. the arrival is read before the client eats it ---------------
   supabase-js consumes the token in the url when the client is created. Read it
   afterwards and it is gone, and the app cannot tell an invitation from somebody
   opening the page. Order is the whole thing here, so it is checked by position
   and not by presence. */
{
  const capture = html.indexOf('const AUTH_ARRIVAL=');
  const client = html.indexOf('window.supabase.createClient(SUPA_URL');
  check('the arrival is captured before the Supabase client is created',
    capture > 0 && client > 0 && capture < client,
    'creating the client clears the token out of the url, so reading it afterwards finds nothing');
}

/* ---------- 2. it runs at boot ------------------------------------------- */
check('and something actually calls it at boot',
  /startAuthArrival\(\)/.test(html.replace('async function startAuthArrival', '')),
  'the capture is useless if nothing acts on it');

/* ---------- 3. the three kinds that need a password ----------------------- */
{
  const fn = (html.match(/function authArrivalNeedsPassword[\s\S]*?\n\}/) || [''])[0];
  ['invite', 'recovery', 'signup'].forEach(kind =>
    check('a "' + kind + '" link is treated as needing a password', fn.indexOf("'" + kind + "'") !== -1,
      'all three arrive the same way and all three land on somebody with no usable password'));
}

/* ---------- 4. behaviour, run for real ------------------------------------
   The sandbox runs the app's own code rather than reading it, because the checks
   that matter here are what the screen ends up saying. */
{
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
  const mk = id => (els[id] = els[id] || {
    _id: id, value: '', textContent: '', innerHTML: '', placeholder: '', className: '',
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    parentElement: { style: {}, insertAdjacentElement() {} },
    setAttribute(k, v) { this['_' + k] = v }, getAttribute() { return null },
    querySelector() { return null }, querySelectorAll() { return [] },
    appendChild(c) { return c }, addEventListener() {}, focus() {}, select() {},
  });

  const sb = {
    console: { log() {}, warn() {}, error() {} },
    document: {
      getElementById: mk,
      querySelector(sel) { return mk('sel:' + sel) },
      querySelectorAll() { return [] },
      createElement() { return mk('new') },
      addEventListener() {}, removeEventListener() {},
      body: mk('body'), documentElement: mk('html'), head: mk('head'),
    },
    localStorage: { getItem() { return null }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null }, setItem() {} },
    location: { hash: '', search: '', pathname: '/', href: 'https://app.thelabelboard.com/' },
    history: { replaceState() {} },
    navigator: { userAgent: 'n' },
    setTimeout: (f) => { try { f && f() } catch (e) {} }, clearTimeout() {},
    requestAnimationFrame: (f) => { try { f && f() } catch (e) {} },
    alert() {}, confirm() { return true }, prompt() { return '' },
    URLSearchParams, Math, Date, JSON, Object, Array, String, Number, Boolean,
    RegExp, Map, Set, Promise, parseInt, parseFloat, isNaN, isFinite, Intl,
    encodeURIComponent, decodeURIComponent, fetch: () => Promise.reject(new Error('offline')),
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  try { vm.runInContext(code, sb, { filename: 'app' }); } catch (e) { /* boot does plenty we do not need */ }
  const G = e => vm.runInContext(e, sb);

  check('the app defines a screen for setting a first password',
    G('typeof showSetPassword') === 'function',
    'without it an invited studio meets the sign-in form and stops');
  check('and a handler that saves it',
    G('typeof setMyPassword') === 'function');

  /* the two refusals. A password nobody can see is one somebody mistypes, and
     finding that out at the second sign-in means they are locked out of a studio
     they have not used yet. */
  G("supa=null;document.getElementById('loginPass').value='short';" +
    "document.getElementById('loginPass2').value='short';");
  G('setMyPassword()');
  check('a password under 8 characters is refused',
    /8 characters/.test(G("document.getElementById('loginErr').textContent")),
    'got: ' + G("document.getElementById('loginErr').textContent"));

  G("document.getElementById('loginPass').value='longenough123';" +
    "document.getElementById('loginPass2').value='somethingelse';");
  G('setMyPassword()');
  check('two that do not match are refused',
    /do not match/.test(G("document.getElementById('loginErr').textContent")),
    'got: ' + G("document.getElementById('loginErr').textContent"));

  /* Asked of the function that BUILDS the box, not of the file. Grepping the
     whole file passes on any leftover mention of the id — including the
     getElementById that reads it — so the box could be gone and the check green.
     Caught by a mutant that deleted the box and sailed through. */
  {
    const builder = (html.match(/function showSetPassword[\s\S]*?\n\}/) || [''])[0];
    check('the screen builds a second password box, not just refers to one',
      /id="loginPass2"/.test(builder),
      'one box means a typo becomes a lockout on the second sign-in, discovered by somebody who has never used their studio');
  }
}

/* ---------- 5. the token does not stay in the address bar ----------------- */
{
  const fn = (html.match(/async function setMyPassword[\s\S]*?\n\}/) || [''])[0];
  check('the token is cleared out of the url once it has been used',
    /history\.replaceState/.test(fn),
    'a screenshot of the studio would otherwise carry a live session in its address bar');
}

/* ---------- 6. one road into the studio, not two -------------------------- */
{
  check('signing in and arriving by invitation share one route into the studio',
    /async function enterLiveStudio/.test(html) &&
    (html.match(/enterLiveStudio\(/g) || []).length >= 3,
    'two copies of "load the studio" drift, and the copy nobody signs in through is the one that rots');
}

console.log('Invitation arrival audit:');
ok.forEach(l => console.log('  PASS  ' + l));
if (fail.length) {
  console.log('\n✗ ' + fail.length + ' problem(s):');
  fail.forEach(l => console.log('   - ' + l));
  console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed\n');
  process.exit(1);
}
console.log('\n' + ok.length + ' passed, 0 failed');
console.log('  ✓ an invited studio can set a password and reach their studio');
