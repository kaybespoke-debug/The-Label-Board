/* ============================================================
   signin.js — the sign-in screen.

   You sign in with your own email address and password. There is no list
   of accounts to pick from: a roster of everyone on the team, one tap from
   being signed into, is not a login screen.

   The password is now genuinely checked. See credentials.js for how it is
   stored, and for an honest account of what that does and does not
   protect.

   Three states:
     setup   nobody has a password yet, so create one (first run)
     signin  normal
     recover forgotten password, using the code issued at setup
   ============================================================ */

const SESSION_KEY = 'tlb_admin_session';
const LAST_EMAIL_KEY = 'tlb_admin_last_email';
let LOGIN_MODE = 'signin';

/* ===== ARRIVING FROM AN INVITATION =====================================
   An operator we invite has an account and no password. The invitation link
   hands the browser a live session, and that is enough to get in exactly once
   — which is worse than being locked out, because it looks like it worked and
   then never does again. So an arrival is not a sign-in here: it is a screen
   that asks for a password first, and only then goes through the same door
   everybody else uses.

   Read at parse time, before anything calls liveClient(). supabase-js consumes
   the token out of the address the moment the client is created, so a capture
   that runs afterwards finds an empty hash and cannot tell an invitation from
   somebody opening the page. This is the same ordering trap the customer app
   hit on 13 Sep; it is written down in both places on purpose. */
const CONSOLE_ARRIVAL = (function () {
  try {
    const h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    const bad = h.get('error_description') || h.get('error');
    if (bad) return { kind: 'error', message: String(bad).replace(/\+/g, ' ') };
    const t = h.get('type') || '';
    if (h.get('access_token') && t) return { kind: t };
    const q = new URLSearchParams(String(location.search || ''));
    const qt = q.get('type') || '';
    if (q.get('code') && qt) return { kind: qt };
  } catch (e) {}
  return null;
})();
function consoleArrivalNeedsPassword() {
  return !!(CONSOLE_ARRIVAL && ['invite', 'recovery', 'signup'].indexOf(CONSOLE_ARRIVAL.kind) >= 0);
}
function clearConsoleArrival() {
  /* A console screenshot must not carry a live session in its address bar. */
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
}

function signedIn() {
  try { return !!localStorage.getItem(SESSION_KEY); } catch (e) { return false; }
}

function staffByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  return DB.staff.find(s =>
    String(s.email || '').toLowerCase() === e ||
    String(s.username || '').toLowerCase() === e ||
    (s.altEmails || []).some(a => String(a).toLowerCase() === e)) || null;
}

/* Only ever what THIS browser last signed in with. Nothing else.

   There used to be a fallback that filled the field from the seeded owner
   record whenever the console had a single staff account, on the reasoning
   that a brand new console has nobody to give away. That reasoning was wrong
   twice over: it fired on a fresh console before anybody had signed in, so a
   stranger opening the operator console was handed half of a credential; and
   the address it offered was invented demo data rather than a real login, so
   it was also useless. Removed 13 Sep at Kayode's ask. */
function lastEmail() {
  try { return localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch (e) { return ''; }
}

function loginShell(inner) {
  const dark = !document.body.classList.contains('light');
  return '<button class="login-theme" onclick="toggleTheme()" aria-label="Switch theme">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    'stroke-linejoin="round"><use href="#' + (dark ? 'i-moon' : 'i-sun') + '"/></svg></button>' +
    '<div class="login-card">' +
    '<svg class="login-logo" viewBox="0 0 100 100" aria-hidden="true">' +
    '<rect width="100" height="100" rx="24" fill="#0b1023"/>' +
    '<path d="M33 27v33a10 10 0 0 0 10 10h16" stroke="#fff" stroke-width="5.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M43 35h13a8.5 8.5 0 0 1 0 17H43z" stroke="#fff" stroke-width="5.5" fill="none" stroke-linejoin="round"/>' +
    '<path d="M43 52h15a9 9 0 0 1 0 18H43" stroke="#fff" stroke-width="5.5" fill="none" stroke-linejoin="round"/>' +
    '<circle cx="74" cy="62" r="6" fill="#e0a94a"/></svg>' +
    '<div class="login-the">THE</div>' +
    '<div class="login-brand">LABEL BOARD<span class="dot">.</span></div>' +
    '<div class="login-sub">Admin Control Centre</div>' +
    inner + '</div>';
}

function buildLogin() {
  const el = document.getElementById('login');
  if (!cryptoAvailable()) {
    el.innerHTML = loginShell(
      '<div class="pw-wrap on"><div class="login-err" style="min-height:auto">' +
      'This page needs a secure connection (https) before it can check a password. ' +
      'Open it over https rather than a file or plain http.</div></div>');
    return;
  }
  el.innerHTML = loginShell(
    LOGIN_MODE === 'setup'   ? formSetup()
    : LOGIN_MODE === 'invited' ? formInvited()
    : LOGIN_MODE === 'recover' ? formRecover()
    : formSignIn());

  const first = el.querySelector('input:not([value]), input[value=""]') || el.querySelector('input');
  if (first) first.focus();
}

/* ---------------- normal sign in ---------------- */
function formSignIn() {
  return '<div class="pw-wrap on">' +
    '<input class="fld" type="email" id="loginEmail" placeholder="Work email" autocomplete="username" ' +
    'spellcheck="false" value="' + esc(lastEmail()) + '" ' +
    'onkeydown="if(event.key===\'Enter\')document.getElementById(\'loginPw\').focus()">' +
    '<div class="pw-row">' +
    '<input class="fld" type="password" id="loginPw" placeholder="Password" autocomplete="current-password" ' +
    'style="padding-right:60px" onkeydown="if(event.key===\'Enter\')doSignIn()">' +
    '<span class="pw-show" id="pwShow" onclick="toggleLoginPw()">Show</span>' +
    '</div>' +
    '<div class="login-err" id="loginErr"></div>' +
    '<button class="btn gold" id="signinBtn" style="width:100%;padding:13px" onclick="doSignIn()">Sign in</button>' +
    '<button class="login-back" onclick="LOGIN_MODE=\'recover\';buildLogin()">Forgot your password?</button>' +
    '</div>';
}

/* ---------------- first run ---------------- */
function formSetup() {
  const me = DB.staff[0] || { name: 'the owner', email: '' };
  return '<div class="pw-wrap on">' +
    '<p class="login-lead" style="margin-top:22px">Set a password for <b style="color:var(--text)">' +
    esc(me.name) + '</b></p>' +
    '<input class="fld" type="email" id="setupEmail" value="' + esc(me.email) + '" ' +
    'autocomplete="username" spellcheck="false" readonly style="opacity:.75">' +
    '<div class="pw-row">' +
    '<input class="fld" type="password" id="setupPw" placeholder="New password" autocomplete="new-password" ' +
    'style="padding-right:60px" oninput="onSetupType()">' +
    '<span class="pw-show" id="pwShow" onclick="toggleLoginPw(\'setupPw\')">Show</span>' +
    '</div>' +
    '<div id="setupMeter" style="margin:8px 0 4px">' + strengthMeter('', me) + '</div>' +
    '<input class="fld" type="password" id="setupPw2" placeholder="Repeat it" autocomplete="new-password" ' +
    'oninput="onSetupType()" onkeydown="if(event.key===\'Enter\')doSetup()">' +
    '<div class="login-err" id="loginErr"></div>' +
    '<button class="btn gold" id="setupBtn" style="width:100%;padding:13px" onclick="doSetup()">' +
    'Set password</button>' +
    '</div>';
}

/* ---------------- arriving on an invitation ----------------
   Two boxes and the same strength rules as every other password in the
   console. No email field: the link decided who this is, and an editable
   address here would only invite somebody to type the wrong one and wonder
   why nothing happened. */
function formInvited() {
  const recovering = CONSOLE_ARRIVAL && CONSOLE_ARRIVAL.kind === 'recovery';
  return '<div class="pw-wrap on">' +
    '<p class="login-lead" style="margin-top:22px">' +
    (recovering ? 'Choose a new password for the control centre.'
                : 'Welcome. Choose a password to finish setting up your account.') + '</p>' +
    '<div class="pw-row">' +
    '<input class="fld" type="password" id="invPw" placeholder="New password" autocomplete="new-password" ' +
    'style="padding-right:60px" oninput="onInvitedType()">' +
    '<span class="pw-show" id="pwShow" onclick="toggleLoginPw(\'invPw\')">Show</span>' +
    '</div>' +
    '<div id="invMeter" style="margin:8px 0 4px">' + strengthMeter('', null) + '</div>' +
    '<input class="fld" type="password" id="invPw2" placeholder="Repeat it" autocomplete="new-password" ' +
    'oninput="onInvitedType()" onkeydown="if(event.key===\'Enter\')doAcceptInvite()">' +
    '<div class="login-err" id="loginErr"></div>' +
    '<button class="btn gold" id="invBtn" style="width:100%;padding:13px" onclick="doAcceptInvite()">' +
    'Set my password</button>' +
    '</div>';
}

function onInvitedType() {
  const pw = (document.getElementById('invPw') || {}).value || '';
  const pw2 = (document.getElementById('invPw2') || {}).value || '';
  const m = document.getElementById('invMeter');
  if (m) m.innerHTML = strengthMeter(pw, null);
  const err = document.getElementById('loginErr');
  if (err) err.textContent = (pw2 && pw !== pw2) ? 'The two entries do not match yet.' : '';
}

/* The session is not in the address any more by the time this runs — creating
   the client took it — so wait for the client to have stored it rather than
   reading the url again. Twenty tries at 150ms is three seconds, which is far
   longer than it takes and still short enough that a dead link says so while
   somebody is still looking at the screen. */
async function startConsoleArrival() {
  /* A dead link never reaches here: it has no type, so it is not an arrival
     that needs a password, and initSignIn shows it on the sign-in screen where
     the fix — asking for a new invitation — is one message away. */
  const err = () => document.getElementById('loginErr');
  const c = (typeof liveClient === 'function') ? liveClient() : null;
  if (!c) { const e = err(); if (e) e.textContent = 'This console is not connected to a project.'; return false; }
  for (let i = 0; i < 20; i++) {
    let s = null;
    try { s = (await c.auth.getSession()).data.session; } catch (e) {}
    if (s) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  const e = err();
  if (e) e.textContent = 'That link has expired. Ask for a new invitation, or sign in below.';
  return false;
}

async function doAcceptInvite() {
  const btn = document.getElementById('invBtn');
  const err = document.getElementById('loginErr');
  const pw = (document.getElementById('invPw') || {}).value || '';
  const pw2 = (document.getElementById('invPw2') || {}).value || '';

  if (!pw) { err.textContent = 'Choose a password.'; return; }
  if (pw !== pw2) { err.textContent = 'The two entries do not match.'; return; }
  const r = checkPassword(pw, null);
  if (!r.allOk) {
    err.textContent = 'Not accepted yet: ' + r.rules.filter(x => !x.ok)[0].label.toLowerCase() + '.';
    return;
  }

  const c = (typeof liveClient === 'function') ? liveClient() : null;
  if (!c) { err.textContent = 'This console is not connected to a project.'; return; }

  btn.disabled = true; btn.textContent = 'Setting…';
  let session = null;
  try { session = (await c.auth.getSession()).data.session; } catch (e) {}
  if (!session) {
    btn.disabled = false; btn.textContent = 'Set my password';
    err.textContent = 'That link has expired. Ask for a new invitation.';
    return;
  }

  const { error: upErr } = await c.auth.updateUser({ password: pw });
  document.getElementById('invPw').value = '';
  document.getElementById('invPw2').value = '';
  if (upErr) {
    btn.disabled = false; btn.textContent = 'Set my password';
    err.textContent = 'Could not set that password: ' + upErr.message;
    return;
  }
  clearConsoleArrival();

  /* Same door as everybody else from here: admin-api decides whether a valid
     Supabase account is one of ours. A studio owner who somehow followed an
     operator link has a perfectly good session and still does not get in. */
  try {
    const out = await liveCall('me');
    LIVE.me = out.me; LIVE.ready = true; LIVE.error = '';
    try { localStorage.setItem(LAST_EMAIL_KEY, credKeyFor(out.me.email)); } catch (e) {}
    signInAs(liveAdoptStaff(out.me));
  } catch (e) {
    try { await c.auth.signOut(); } catch (e2) {}
    LIVE.ready = false;
    btn.disabled = false; btn.textContent = 'Set my password';
    err.textContent = 'Your password is set, but this account is not an operator account. ' +
      'Studios sign in at app.thelabelboard.com and partners at partners.thelabelboard.com.';
  }
}

function onSetupType() {
  const me = DB.staff[0];
  const pw = (document.getElementById('setupPw') || {}).value || '';
  const m = document.getElementById('setupMeter');
  if (m) m.innerHTML = strengthMeter(pw, me);
  const err = document.getElementById('loginErr');
  const pw2 = (document.getElementById('setupPw2') || {}).value || '';
  if (err && pw2 && pw !== pw2) err.textContent = 'The two entries do not match yet.';
  else if (err) err.textContent = '';
}

async function doSetup() {
  const me = DB.staff[0];
  const btn = document.getElementById('setupBtn');
  const err = document.getElementById('loginErr');
  const pw = (document.getElementById('setupPw') || {}).value || '';
  const pw2 = (document.getElementById('setupPw2') || {}).value || '';

  if (!pw) { err.textContent = 'Choose a password.'; return; }
  if (pw !== pw2) { err.textContent = 'The two entries do not match.'; return; }
  const r = checkPassword(pw, me);
  if (!r.allOk) {
    err.textContent = 'Not accepted yet: ' + r.rules.filter(x => !x.ok)[0].label.toLowerCase() + '.';
    return;
  }

  btn.disabled = true; btn.textContent = 'Setting…';
  const code = await setPassword(me.email, pw, { newRecoveryCode: true });
  document.getElementById('setupPw').value = '';
  document.getElementById('setupPw2').value = '';

  showRecoveryCode(code, () => {
    LOGIN_MODE = 'signin';
    try { localStorage.setItem(LAST_EMAIL_KEY, credKeyFor(me.email)); } catch (e) {}
    signInAs(me);
  });
}

let RECOVERY_THEN = null;
function recoveryDone() {
  closeModal();
  const f = RECOVERY_THEN; RECOVERY_THEN = null;
  if (f) f();
}
function showRecoveryCode(code, then) {
  RECOVERY_THEN = then || null;
  modal('Save your recovery code', 'Shown once, and never again',
    '<p class="note">There is no server yet, so there is no reset email. This code is the only way back ' +
    'into the console if you forget your password. Write it down somewhere that is not this device.</p>' +
    '<div style="margin:18px 0;padding:18px;border-radius:12px;background:var(--panel-2);' +
    'border:1px solid var(--gold);text-align:center;font-family:\'Jost\',monospace;font-size:21px;' +
    'letter-spacing:3px;user-select:all">' + esc(code) + '</div>' +
    '<p class="hint">It is stored only as a one-way hash, exactly like your password, so nobody can read ' +
    'it back to you later. Not even this console.</p>',
    '<button class="btn gold" onclick="recoveryDone()">I have saved it</button>');
}

/* ---------------- forgotten password ---------------- */
function formRecover() {
  return '<div class="pw-wrap on">' +
    '<p class="login-lead" style="margin-top:22px">Use your recovery code</p>' +
    '<input class="fld" type="email" id="recEmail" placeholder="Work email" autocomplete="username" ' +
    'spellcheck="false" value="' + esc(lastEmail()) + '">' +
    '<input class="fld" type="text" id="recCode" placeholder="XXXX-XXXX-XXXX" spellcheck="false" ' +
    'autocapitalize="characters" style="letter-spacing:2px">' +
    '<div class="pw-row">' +
    '<input class="fld" type="password" id="recPw" placeholder="New password" autocomplete="new-password" ' +
    'style="padding-right:60px" onkeydown="if(event.key===\'Enter\')doRecover()">' +
    '<span class="pw-show" id="pwShow" onclick="toggleLoginPw(\'recPw\')">Show</span>' +
    '</div>' +
    '<div class="login-err" id="loginErr"></div>' +
    '<button class="btn gold" id="recBtn" style="width:100%;padding:13px" onclick="doRecover()">' +
    'Set a new password</button>' +
    '<button class="login-back" onclick="LOGIN_MODE=\'signin\';buildLogin()">&larr; Back to sign in</button>' +
    '</div>';
}

async function doRecover() {
  const err = document.getElementById('loginErr');
  const btn = document.getElementById('recBtn');
  const email = (document.getElementById('recEmail') || {}).value || '';
  const code = (document.getElementById('recCode') || {}).value || '';
  const pw = (document.getElementById('recPw') || {}).value || '';

  const s = staffByEmail(email);
  if (!s || !code || !pw) { err.textContent = 'Fill in all three.'; return; }
  const r = checkPassword(pw, s);
  if (!r.allOk) {
    err.textContent = 'New password not accepted: ' + r.rules.filter(x => !x.ok)[0].label.toLowerCase() + '.';
    return;
  }

  btn.disabled = true; btn.textContent = 'Checking…';
  const target = credEmailFor(s);
  const good = await verifyRecovery(target, code);
  if (!good) {
    btn.disabled = false; btn.textContent = 'Set a new password';
    err.textContent = 'That code is not right.';
    return;
  }
  const fresh = await setPassword(target, pw, { newRecoveryCode: true });
  clearFailures(target);
  logAction('login', 'Password recovered', s.name + ' set a new password with their recovery code');
  document.getElementById('recPw').value = '';
  showRecoveryCode(fresh, () => { LOGIN_MODE = 'signin'; signInAs(s); });
}

/* ---------------- shared ---------------- */
function toggleLoginPw(id) {
  const f = document.getElementById(id || 'loginPw'), b = document.getElementById('pwShow');
  if (!f) return;
  const hidden = f.type === 'password';
  f.type = hidden ? 'text' : 'password';
  if (b) b.textContent = hidden ? 'Hide' : 'Show';
}

async function doSignIn() {
  const em = document.getElementById('loginEmail');
  const pw = document.getElementById('loginPw');
  const err = document.getElementById('loginErr');
  const btn = document.getElementById('signinBtn');
  if (!em || !pw) return;

  if (!em.value.trim()) { err.textContent = 'Enter your work email.'; em.focus(); return; }
  if (!pw.value) { err.textContent = 'Enter your password.'; pw.focus(); return; }

  /* Connected to a project? Then Supabase Auth is the authority on who this
     is, and admin-api on whether they are one of us. The local credential
     store below stays for the demo and for a console nobody has connected,
     but it must not be a second way into a live console: a password set
     here months ago should not still open a real inbox. */
  if (CONFIG.live && typeof liveSignIn === 'function') {
    btn.disabled = true; btn.textContent = 'Checking…';
    const r = await liveSignIn(em.value, pw.value);
    btn.disabled = false; btn.textContent = 'Sign in';
    pw.value = '';
    if (r.ok) {
      try { localStorage.setItem(LAST_EMAIL_KEY, credKeyFor(em.value)); } catch (e) {}
      signInAs(liveAdoptStaff(r.me));
      return;
    }
    /* Same answer for a wrong password and an address that is not staff.
       Either one, spelled out, tells somebody which of the two they got
       right. The exception is a connection that never happened, which is
       worth saying because it is ours to fix and not theirs. */
    err.textContent = /reach|network|fetch/i.test(r.error || '')
      ? 'Could not reach the sign-in server. Check your connection.'
      : 'Those details do not match a Label Board staff account.';
    pw.focus();
    return;
  }

  const s = staffByEmail(em.value);
  const target = s ? credEmailFor(s) : credKeyFor(em.value);

  const lock = credLockState(target);
  if (lock.locked) {
    err.textContent = 'Too many attempts. Try again in ' + lock.minsLeft + ' minute' +
      (lock.minsLeft === 1 ? '' : 's') + '.';
    pw.value = '';
    return;
  }

  btn.disabled = true; btn.textContent = 'Checking…';
  /* Deliberately does not distinguish an unknown address from a wrong
     password: either answer tells someone whether an account exists. */
  const good = s && credFor(target) && await verifyPassword(target, pw.value);
  btn.disabled = false; btn.textContent = 'Sign in';

  if (!good) {
    pw.value = '';
    if (s && credFor(target)) {
      const f = noteFailure(target);
      err.textContent = f.locked
        ? 'Too many attempts. Locked for ' + LOCK_MINUTES + ' minutes.'
        : 'Those details do not match an account.' +
          (f.left <= 3 ? ' ' + f.left + ' attempt' + (f.left === 1 ? '' : 's') + ' left.' : '');
    } else if (s && !credFor(target)) {
      err.textContent = 'No password has been set for this account yet.';
    } else {
      err.textContent = 'Those details do not match an account.';
    }
    pw.focus();
    return;
  }

  pw.value = '';
  clearFailures(target);
  try { localStorage.setItem(LAST_EMAIL_KEY, target); } catch (e) {}
  signInAs(s);
}

function signInAs(s) {
  ME.staffId = s.id;
  try { localStorage.setItem(SESSION_KEY, String(s.id)); } catch (e) {}
  const a = authOf(s);
  a.neverSignedIn = false;
  a.failedAttempts = 0;
  s.lastActiveLabel = 'Now';
  logAction('login', 'Signed in', s.name + ' signed in as ' + (Q.role(s.roleId) || {}).name);

  document.body.classList.remove('signed-out');
  document.getElementById('login').classList.remove('on');
  UI.detail = null;
  UI.page = (typeof firstAllowedPage === 'function') ? firstAllowedPage() : 'dashboard';
  render();
  toast('Signed in as ' + s.name.split(' ')[0]);
  // If a Supabase project is configured, go and fetch what real studios have
  // sent us. Does nothing at all when it is not, so the demo is untouched.
  if (typeof liveStart === 'function') liveStart();
}

function signOut() {
  if (typeof liveStopPolling === 'function') liveStopPolling();
  modal('Sign out', (Q.staffM(ME.staffId) || {}).name || '',
    '<p class="note">You will be returned to the sign-in screen. Nothing is lost: the data lives in this ' +
    'browser, not in the session.</p>',
    '<button class="btn" onclick="closeModal()">Stay signed in</button>' +
    '<button class="btn gold" onclick="doSignOut()">Sign out</button>');
}
function doSignOut() {
  const s = Q.staffM(ME.staffId);
  if (s) logAction('login', 'Signed out', s.name + ' signed out');
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  /* End the Supabase session too. Clearing our own key and leaving theirs
     would put the next person at this machine straight back in, because
     liveRestore would find a session and sign them in without asking. */
  if (typeof liveStopPolling === 'function') liveStopPolling();
  if (typeof liveSignOut === 'function') liveSignOut();
  closeModal();
  LOGIN_MODE = 'signin';
  document.body.classList.add('signed-out');
  document.getElementById('login').classList.add('on');
  buildLogin();
}

/* called once at boot */
function initSignIn() {
  /* Connected to a project? Then the password lives in Supabase Auth and
     this browser holds no credential of its own — which is the point, not a
     first run. Without this the setup screen below would appear on every
     fresh browser and walk a real operator through choosing a LOCAL
     password that opens nothing, while the account that would actually
     work was never asked for.

     Restoring is asynchronous, so show the sign-in screen and let it come
     back and dismiss itself if this browser already holds a session. */
  if (CONFIG.live) {
    /* An invitation is not a session to restore. Restoring it would let an
       invited operator straight in on the link's own session, having set no
       password — in once, and locked out forever after, which reads as the
       console being broken rather than as a step that was skipped. */
    if (consoleArrivalNeedsPassword()) {
      LOGIN_MODE = 'invited';
      document.body.classList.add('signed-out');
      document.getElementById('login').classList.add('on');
      buildLogin();
      startConsoleArrival();
      return false;
    }
    LOGIN_MODE = 'signin';
    document.body.classList.add('signed-out');
    document.getElementById('login').classList.add('on');
    buildLogin();
    if (CONSOLE_ARRIVAL && CONSOLE_ARRIVAL.kind === 'error') {
      const e = document.getElementById('loginErr');
      if (e) e.textContent = CONSOLE_ARRIVAL.message + '. Ask for a new invitation.';
      clearConsoleArrival();
      return false;
    }
    if (typeof liveRestore === 'function') {
      liveRestore().then(me => { if (me) signInAs(liveAdoptStaff(me)); })
                   .catch(() => {});
    }
    return false;
  }

  /* No password anywhere means first run. Force setup even if a session is
     open, because a console left with no password is the thing this is
     here to prevent. */
  if (!anyCredentials()) {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    LOGIN_MODE = 'setup';
    document.body.classList.add('signed-out');
    document.getElementById('login').classList.add('on');
    buildLogin();
    return false;
  }

  let id = null;
  try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
  const s = id ? Q.staffM(+id) : null;
  if (s) {
    ME.staffId = s.id;
    document.body.classList.remove('signed-out');
    document.getElementById('login').classList.remove('on');
    return true;
  }
  LOGIN_MODE = 'signin';
  document.body.classList.add('signed-out');
  document.getElementById('login').classList.add('on');
  buildLogin();
  return false;
}
