/* ============================================================
   signin.js — the sign-in screen.

   You sign in with your own email address and password. There is no list of
   accounts to pick from: a roster of everyone on the team, one tap from
   being signed into, is not a login screen. You have to know the address.

   Being straight about the limit: there is no server yet, so the password
   cannot be checked against anything. The email is checked — an address that
   is not on the team is refused — and whoever that email belongs to is who
   you become, which is what drives the whole permission system. Real
   verification arrives with Supabase Auth, and this is deliberately shaped
   like what it will replace: an address, a secret, a session.
   ============================================================ */

const SESSION_KEY = 'tlb_admin_session';
const LAST_EMAIL_KEY = 'tlb_admin_last_email';

function signedIn() {
  try { return !!localStorage.getItem(SESSION_KEY); } catch (e) { return false; }
}

function staffByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  return DB.staff.find(s =>
    String(s.email || '').toLowerCase() === e ||
    String(s.username || '').toLowerCase() === e) || null;
}

function lastEmail() {
  let v = '';
  try { v = localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch (e) {}
  /* On a brand new console the owner is the only account that exists, so there
     is nothing to give away by filling their address in — and otherwise there
     would be no way in. Once anyone has signed in, only their own address is
     remembered. */
  if (!v && DB.staff.length === 1) v = String(DB.staff[0].email || '');
  return v;
}

function buildLogin() {
  const dark = !document.body.classList.contains('light');

  document.getElementById('login').innerHTML =
    '<button class="login-theme" onclick="toggleTheme()" aria-label="Switch theme">' +
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

    '<div class="pw-wrap on">' +
    '<input class="fld" type="email" id="loginEmail" placeholder="Work email" ' +
    'autocomplete="username" spellcheck="false" value="' + esc(lastEmail()) + '" ' +
    'onkeydown="if(event.key===\'Enter\')document.getElementById(\'loginPw\').focus()">' +
    '<div class="pw-row">' +
    '<input class="fld" type="password" id="loginPw" placeholder="Password" ' +
    'autocomplete="current-password" style="padding-right:60px" ' +
    'onkeydown="if(event.key===\'Enter\')doSignIn()">' +
    '<span class="pw-show" id="pwShow" onclick="toggleLoginPw()">Show</span>' +
    '</div>' +
    '<div class="login-err" id="loginErr"></div>' +
    '<button class="btn gold" style="width:100%;padding:13px" onclick="doSignIn()">Sign in</button>' +
    '<button class="login-back" onclick="forgotPassword()">Forgot your password?</button>' +
    '</div>' +
    '</div>';

  const f = document.getElementById(lastEmail() ? 'loginPw' : 'loginEmail');
  if (f) f.focus();
}

function toggleLoginPw() {
  const f = document.getElementById('loginPw'), b = document.getElementById('pwShow');
  if (!f) return;
  const hidden = f.type === 'password';
  f.type = hidden ? 'text' : 'password';
  b.textContent = hidden ? 'Hide' : 'Show';
}

function loginError(msg) {
  const e = document.getElementById('loginErr');
  if (e) e.textContent = msg;
}

function doSignIn() {
  const em = document.getElementById('loginEmail');
  const pw = document.getElementById('loginPw');
  if (!em || !pw) return;

  if (!em.value.trim()) { loginError('Enter your work email.'); em.focus(); return; }
  if (!pw.value) { loginError('Enter your password.'); pw.focus(); return; }

  const s = staffByEmail(em.value);
  if (!s) {
    /* Deliberately does not say which half was wrong. */
    loginError('Those details do not match an account.');
    pw.value = '';
    pw.focus();
    return;
  }
  const a = authOf(s);
  if (a.locked) {
    loginError('This account is locked. An owner can unlock it in Settings.');
    pw.value = '';
    return;
  }

  /* Nothing typed is kept — there is nothing yet to check it against. */
  pw.value = '';
  ME.staffId = s.id;
  try {
    localStorage.setItem(SESSION_KEY, String(s.id));
    localStorage.setItem(LAST_EMAIL_KEY, String(s.email || '').toLowerCase());
  } catch (e) {}
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
}

function forgotPassword() {
  modal('Forgot your password?', '',
    '<p class="note">Password resets are sent by email, which needs the server behind this console. ' +
    'That arrives with Supabase Auth.</p>' +
    '<p class="hint">Until then, whoever holds the Owner role can set a new password for you in ' +
    'Settings &rarr; Login &amp; passwords.</p>',
    '<button class="btn" onclick="closeModal()">Close</button>');
}

function signOut() {
  modal('Sign out', (Q.staffM(ME.staffId) || {}).name || '',
    '<p class="note">You will be returned to the sign-in screen. Nothing is lost — the data lives in ' +
    'this browser, not in the session.</p>',
    '<button class="btn" onclick="closeModal()">Stay signed in</button>' +
    '<button class="btn gold" onclick="doSignOut()">Sign out</button>');
}
function doSignOut() {
  const s = Q.staffM(ME.staffId);
  if (s) logAction('login', 'Signed out', s.name + ' signed out');
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  closeModal();
  document.body.classList.add('signed-out');
  document.getElementById('login').classList.add('on');
  buildLogin();
}

/* called once at boot */
function initSignIn() {
  let id = null;
  try { id = localStorage.getItem(SESSION_KEY); } catch (e) {}
  const s = id ? Q.staffM(+id) : null;
  if (s) {
    ME.staffId = s.id;
    document.body.classList.remove('signed-out');
    document.getElementById('login').classList.remove('on');
    return true;
  }
  document.body.classList.add('signed-out');
  document.getElementById('login').classList.add('on');
  buildLogin();
  return false;
}
