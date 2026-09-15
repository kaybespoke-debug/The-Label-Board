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

/* ---------- 7. the link goes to the app the invitation is for -------------
   Three kinds of account, three apps, one link in the email. Supabase falls
   back to the project's Site URL when no redirect is given, and that is the
   customer app — so every partner and every operator we invited was sent to a
   studio sign-in screen that correctly told them they had no studio. The
   account was fine. The link was wrong, and nothing in the code said where a
   link was supposed to go, so nothing could be wrong about it. */
{
  const gw = fs.readFileSync('supabase/functions/admin-api/index.ts', 'utf8');

  check('the gateway says where each kind of invitation lands',
    /const APP_URLS\s*:/.test(gw),
    'a redirect that is not written down anywhere cannot be reviewed or corrected');

  const table = (gw.match(/const APP_URLS[\s\S]*?\n\}/) || [''])[0];
  [['inviteStudio', 'app.'], ['invitePartner', 'partners.'], ['inviteOperator', 'admin.']]
    .forEach(([action, host]) => {
      check('an invitation to ' + action.replace('invite', '').toLowerCase() + ' goes to ' + host + 'thelabelboard.com',
        new RegExp(action + '\\s*:[^\\n]*' + host.replace('.', '\\.') + 'thelabelboard\\.com').test(table),
        'it went to the customer app, where a partner is told they have no studio');
    });

  check('every one of the three is accounted for, so a new kind cannot inherit the wrong app',
    (table.match(/thelabelboard\.com/g) || []).length === 3);

  check('the invitation uses that table and not something the caller sent',
    /const wantUrl = APP_URLS\[action\]/.test(gw) &&
    /redirectTo:\s*wantUrl/.test(gw) &&
    !/redirectTo:\s*String\(body\./.test(gw),
    'a redirect the browser can name is a redirect an attacker can name, and this one goes out in an email we send');

  check('the addresses can be overridden for a staging project without a code change',
    /Deno\.env\.get\('(STUDIO|PARTNER|CONSOLE)_APP_URL'\)/.test(gw));

  /* THE SLASH. Measured against the live project on 15 Sep:
       asked https://partners.thelabelboard.com   landed on app.thelabelboard.com
       asked https://partners.thelabelboard.com/  landed on partners.thelabelboard.com
     The allow list holds `https://partners.thelabelboard.com/**`, and the bare
     origin does not match that pattern. A redirect that does not match is not
     refused; it is silently replaced with the Site URL. Studio invitations
     looked fine throughout, because their fallback and their destination are
     the same address — so the only people who could see this were partners and
     operators, which is exactly who it broke. */
  const urls = table.match(/'https:\/\/[^']+'/g) || [];
  check('every invitation address ends in a slash',
    urls.length === 3 && urls.every(u => u.endsWith("/'")),
    'a bare origin does not match the /** in the allow list, and the mismatch is silent: ' + urls.join(' '));
  check('and a slash is put back on anything the environment supplies',
    /const withSlash\s*=/.test(gw) &&
    (table.match(/withSlash\(Deno\.env\.get/g) || []).length === 3,
    'all three, not two: an override set without one would reintroduce the bug on whichever was missed');
}

/* ---------- 9. it finds out where the link goes BEFORE creating anything ----
   Reading back the redirect we asked for proves nothing: GoTrue echoes it into
   the link and only decides whether to honour it when somebody follows it. The
   only honest way to know is to ask the thing that decides, which a deliberately
   invalid token does for free — the answer is a 302 to wherever a real link
   would have gone, and nothing is created or consumed. */
{
  const gw = fs.readFileSync('supabase/functions/admin-api/index.ts', 'utf8');
  check('the gateway asks where an invitation would actually land',
    /async function wouldLandOn/.test(gw));
  check('by probing the verify endpoint rather than trusting the link it was handed',
    /\/auth\/v1\/verify\?token=preflight/.test(gw) && /redirect:\s*'manual'/.test(gw));

  const block = (gw.match(/if \(action === 'inviteOperator'[\s\S]*?return json\(\{ ok: true, email/) || [''])[0];
  check('it asks before the record is prepared and before the account exists',
    block.indexOf('wouldLandOn') > 0 &&
    block.indexOf('wouldLandOn') < block.indexOf('let prepared'),
    'a half-created account plus a wrong email is worse than a refusal');
  check('a wrong destination refuses the whole thing rather than sending it anyway',
    /if \(landsOn && landsOn !== wantOrigin\)/.test(block) &&
    /has not been sent and no account was created/.test(block),
    'the message existing is not the same as the test that reaches it');
  check('and the refusal names the exact setting that fixes it',
    /URL Configuration/.test(block) && /trailing \/\*\* matters/.test(block),
    'an error nobody can act on is a thing to ignore');
  check('a probe that cannot answer does not block the invitation',
    /return ''\s*\/\/ could not tell/.test(gw) || /could not tell; do not block/.test(gw),
    'our own network trouble must not stop somebody being invited');
}

/* ---------- 10. our own email, when there is a key for it ---------------- */
{
  const gw = fs.readFileSync('supabase/functions/admin-api/index.ts', 'utf8');
  check('the invitation can be sent as our own email',
    /api\.resend\.com\/emails/.test(gw) && /RESEND_API_KEY/.test(gw));
  check('with wording of its own for a studio, a partner and an operator',
    /partner account is ready/.test(gw) && /control centre/.test(gw) && /studio is set up/.test(gw));
  check('and Supabase still sends when there is no key, rather than nothing going out',
    /if \(RESEND_KEY\) \{[\s\S]*?\} else \{[\s\S]*?inviteUserByEmail/.test(gw),
    'a hard dependency on a secret means invitations stop the day it is missing');
  check('an account made but not emailed is reported as a failure, not a success',
    /The account was created, but the invitation email did not send/.test(gw));
  check('the address in the email is escaped, because a name goes into it',
    /const esc = \(s: string\)/.test(gw));
}

/* ---------- 8. a partner who lands here anyway is handed over ------------
   The redirect table above is the fix. This is the net under it. Supabase only
   honours a redirect that matches its own allowlist and falls back to the Site
   URL silently when it does not, so a partner can still arrive at the customer
   app through no fault of the code — and "this account has no studio" is a
   true sentence that leaves them nowhere to go. */
{
  const fn = (html.match(/async function enterLiveStudio[\s\S]*?\n\}/) || [''])[0];
  check('a partner who lands on the customer app is recognised as one',
    /partner_me/.test(fn),
    'the app can ask who this is; not asking means the dead end stays a dead end');
  check('and is pointed at the partner portal rather than turned away',
    /PARTNER_PORTAL_URL/.test(fn));
  check('the portal address is written down once, not typed into a message',
    /const PARTNER_PORTAL_URL\s*=/.test(html));
  check('it asks who they are before signing them out',
    fn.indexOf('partner_me') > 0 && fn.indexOf('partner_me') < fn.indexOf('signOut'),
    'signing out first would make the question unanswerable');
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
