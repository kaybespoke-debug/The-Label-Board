/* ============================================================
   auth.js — the front door.

   One flow: type your email, we send a six digit code, you type it back.
   No password. That is not a shortcut, it is the right shape for this
   audience: partners open the portal every few weeks on a phone, and a
   password they set in November is a password they have forgotten by
   February. A code that expires in ten minutes cannot be reused, cannot
   be shared by accident, and cannot be the same one they use elsewhere.

   Two providers behind the same four functions:

     demo      the codes are generated and shown on screen, and the three
               example partners in data.js stand in for real logins
     supabase  signInWithOtp / verifyOtp against Supabase Auth, then
               app.partner_me() to find out who signed in

   config.js decides which, by whether SUPA_URL and SUPA_KEY are filled
   in. Nothing else in the portal knows the difference.

   What this file does NOT do is enforce anything. A signed-out browser
   being unable to see another partner's earnings is the database's job,
   and it is done by row level security in
   supabase/migrations/20260827090400_partner_portal.sql. This is the
   front door; the walls are elsewhere. Treat every check here as a
   convenience for the honest, never as a control.
   ============================================================ */

const SESSION_KEY = 'tlb_partner_session';

const AUTH = {
  session: null,          // { partnerKey, email, name, expiresAt, provider }
  stage: 'signin',        // signin | reset | sent | setpw | suspended
  pending: null,          // { email, name }
  busy: false,
  error: '',
  /* Held only between arriving on a link and setting a password on it. Never
     written to storage: it is a live session in a variable, and the moment it
     has been used it goes. */
  arrivalToken: '',
  arrivalKind: '',

  live() { return CONFIG.live; },
  signedIn() { return !!AUTH.session; },
  provider() { return CONFIG.live ? SUPA_PROVIDER : DEMO_PROVIDER; }
};

/* ---------------- session storage ----------------
   A session is a claim about who you are, kept so you are not asked every
   time you open the app. It is not a permission: the token the database
   trusts is Supabase's own, and it expires on its own schedule. */
function saveSession(s) {
  AUTH.session = s;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
}
function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!s || !s.expiresAt) return null;
    if (new Date(s.expiresAt) <= new Date()) { clearSession(); return null; }
    return s;
  } catch (e) { return null; }
}
function clearSession() {
  AUTH.session = null;
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}
function sessionExpiry() {
  return new Date(Date.now() + CONFIG.sessionDays * 86400000).toISOString();
}

/* ---------------- the demo provider ----------------
   The code is derived from the email and the day, so it is stable across a
   reload and different for each person, and it is shown on screen because
   there is no email to send it to. Obviously not a secret. That is the
   point of saying so on the screen. */
const DEMO_PROVIDER = {
  name: 'demo',

  /* There is no real account behind a demo partner, so any password opens one
     of the three example logins and the screen says so. Refusing a password
     here would only be theatre: the data it guards is invented. */
  async signIn(email, password) {
    await pause(400);
    const p = profileByEmail(email);
    if (!p) return { ok: false, error: 'That is not one of the demo logins. Pick one below.' };
    if (!password) return { ok: false, error: 'Type anything as the password. This is the demo.' };
    return {
      ok: true,
      session: {
        partnerKey: p.key, email: p.email, name: p.name,
        expiresAt: sessionExpiry(), provider: 'demo'
      }
    };
  },

  async requestReset() {
    await pause(300);
    return { ok: true };
  },

  async setPassword() {
    await pause(300);
    return { ok: false, error: 'There is no account to set a password on in the demo.' };
  },

  async restore(session) {
    return profileByKey(session.partnerKey) ? { ok: true, session } : { ok: false };
  },

  async signOut() { /* nothing to tell anyone about */ }
};

function pause(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------------- the Supabase provider ----------------
   Written against the REST endpoints rather than the JS SDK, so the portal
   stays a folder of files with no build step, which is what lets it deploy
   the same way as the admin console.

   Wiring checklist lives in PARTNERS.md. In short: fill in config.js, run
   the partner migration, and create a partners row per login. */
const SUPA_PROVIDER = {
  name: 'supabase',

  async signIn(email, password) {
    const r = await supaFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: String(email).trim().toLowerCase(), password: password })
    });
    if (r.error === 'offline') return { ok: false, error: 'Could not reach the sign-in server. Check your connection.' };
    if (!r.ok || !r.body || !r.body.access_token) {
      /* One answer for a wrong password and for an address with no account.
         Spelling out which one is wrong turns this box into a way to find out
         who our partners are. */
      return { ok: false, error: 'That email and password do not match a partner account.' };
    }
    return await sessionFromToken(r.body.access_token, r.body.refresh_token);
  },

  /* redirect_to goes on the query string, which is where GoTrue reads it for
     this endpoint. It is still subject to the project's allow list, and the
     portal handles the arrival either way. */
  async requestReset(email) {
    await supaFetch('/auth/v1/recover?redirect_to=' + encodeURIComponent(portalUrl()), {
      method: 'POST',
      body: JSON.stringify({ email: String(email).trim().toLowerCase() })
    });
    /* Always the same answer. Whether an address has an account is not
       something this screen tells anybody. */
    return { ok: true };
  },

  async setPassword(token, password) {
    const r = await supaFetch('/auth/v1/user', {
      method: 'PUT', token: token,
      body: JSON.stringify({ password: password })
    });
    if (!r.ok) return { ok: false, error: (r.error || 'That password was not accepted.') };
    return await sessionFromToken(token, '');
  },

  /* Same three questions as a fresh sign-in, asked of the stored token: is the
     account real, is it a partner, is that partner still active. Suspending
     somebody has to end the session they already had, not just stop new ones,
     or it is a label in the console and nothing more. */
  async restore(session) {
    const r = await sessionFromToken(session.token, session.refresh || '');
    if (!r.ok) return r;
    /* Keep the stored session object, which carries the expiry this browser
       agreed to, rather than starting a fresh clock on every reopen. */
    return { ok: true, session: session };
  },

  async signOut() {
    if (AUTH.session && AUTH.session.token) {
      await supaFetch('/auth/v1/logout', { method: 'POST', token: AUTH.session.token });
    }
  }
};

/* Where this portal lives, for the link in a reset email. Taken from the page
   rather than written down, so a preview build sends people back to the
   preview and not to production. */
function portalUrl() {
  try { return location.origin + location.pathname.replace(/[^/]*$/, ''); } catch (e) { return ''; }
}

/* A live token is not the same as being a partner. Every way into this portal
   ends here, so the check happens once: the account exists, it has a partner
   row, and that row is active. A suspended partner is told so rather than
   shown an empty portal, which would read as their earnings having vanished. */
async function sessionFromToken(token, refresh) {
  const me = await partnerMe(token);
  if (!me) {
    return { ok: false, error: 'That login is not set up as a partner yet. Talk to your partner manager.' };
  }
  if (me.status !== 'active') return { ok: false, suspended: true, name: me.name };
  return {
    ok: true,
    session: {
      partnerKey: me.id, email: me.email, name: me.name,
      token: token, refresh: refresh || '',
      expiresAt: sessionExpiry(), provider: 'supabase'
    }
  };
}

async function partnerMe(token) {
  const r = await supaFetch('/rest/v1/rpc/partner_me', {
    method: 'POST', token, body: JSON.stringify({})
  });
  if (!r.ok || !Array.isArray(r.body) || !r.body.length) return null;
  return r.body[0];
}

async function supaFetch(path, opts) {
  opts = opts || {};
  try {
    const res = await fetch(CONFIG.SUPA_URL + path, {
      method: opts.method || 'GET',
      headers: {
        'apikey': CONFIG.SUPA_KEY,
        'Authorization': 'Bearer ' + (opts.token || CONFIG.SUPA_KEY),
        'Content-Type': 'application/json'
      },
      body: opts.body
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    return { ok: res.ok, status: res.status, body, error: body && (body.msg || body.message) };
  } catch (e) {
    /* Offline. Say so plainly rather than blaming the code they just typed. */
    return { ok: false, status: 0, body: null, error: 'offline' };
  }
}

/* ---------------- the flow ----------------
   A password, not a code emailed every time. The code was chosen because a
   partner opens this every few weeks and forgets passwords; in practice it
   meant every single sign-in waited on an email arriving, and a screen that
   asks only for an email address and sends something reads as though anybody
   can let themselves in. Kayode's call, 15 Sep. Forgetting is handled by the
   reset link, which is the same thing the code was, only asked for on the rare
   day it is needed instead of every time. */
const PW_MIN = 8;

/* Every outcome of a sign-in attempt lands here, so the four screens that can
   start one do not each need their own copy of what to do next. */
async function finishSignIn(r, fresh) {
  if (r.suspended) {
    AUTH.stage = 'suspended';
    AUTH.pending = { email: (AUTH.pending && AUTH.pending.email) || '', name: r.name };
    renderAuth();
    return false;
  }
  if (!r.ok) {
    AUTH.error = r.error || 'That did not work.';
    renderAuth();
    return false;
  }
  saveSession(r.session);
  if (!await enterPortal(fresh)) {
    clearSession();
    AUTH.error = 'We could not load your account. Try again in a moment.';
    renderAuth();
    return false;
  }
  return true;
}

async function doSignIn() {
  const em = document.getElementById('authEmail');
  const pw = document.getElementById('authPw');
  const email = (em ? em.value : '').trim();
  const password = pw ? pw.value : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    AUTH.error = 'That does not look like an email address.';
    renderAuth();
    return;
  }
  if (!password) { AUTH.error = 'Type your password.'; renderAuth(); return; }

  AUTH.busy = true; AUTH.error = ''; AUTH.pending = { email: email };
  renderAuth();
  const r = await AUTH.provider().signIn(email, password);
  AUTH.busy = false;
  await finishSignIn(r, true);
}

function forgotPassword() {
  AUTH.stage = 'reset';
  AUTH.error = '';
  renderAuth();
  setTimeout(() => { const e = document.getElementById('authEmail'); if (e) e.focus(); }, 60);
}

async function doRequestReset() {
  const em = document.getElementById('authEmail');
  const email = (em ? em.value : '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    AUTH.error = 'That does not look like an email address.';
    renderAuth();
    return;
  }
  AUTH.busy = true; AUTH.error = ''; renderAuth();
  await AUTH.provider().requestReset(email);
  AUTH.busy = false;
  AUTH.pending = { email: email };
  AUTH.stage = 'sent';
  renderAuth();
}

/* Setting a password on arrival. The token came from the link, so there is a
   live session already; what is being added is the way back in next time. */
async function doSetPassword() {
  const a = document.getElementById('authPw');
  const b = document.getElementById('authPw2');
  const p1 = a ? a.value : '', p2 = b ? b.value : '';
  if (p1.length < PW_MIN) {
    AUTH.error = 'Use at least ' + PW_MIN + ' characters.';
    renderAuth();
    return;
  }
  if (p1 !== p2) { AUTH.error = 'The two passwords do not match.'; renderAuth(); return; }

  AUTH.busy = true; AUTH.error = ''; renderAuth();
  const r = await AUTH.provider().setPassword(AUTH.arrivalToken || '', p1);
  AUTH.busy = false;
  if (await finishSignIn(r, true)) AUTH.arrivalToken = '';
}

function backToSignIn() {
  AUTH.stage = 'signin';
  AUTH.error = '';
  renderAuth();
  setTimeout(() => { const e = document.getElementById('authEmail'); if (e) e.focus(); }, 60);
}

/* Load the signed-in partner's data and hand over to the portal.

   `fresh` is true only when somebody has just typed a code, false when a saved
   session is being restored on open. That distinction is the whole point of the
   welcome page: it greets a sign-in, it does not greet somebody who simply
   reopened the app on the bus. */
async function enterPortal(fresh) {
  if (!AUTH.session) return false;
  if (CONFIG.live) {
    /* Live mode fetches the partner's rows here. Until config.js is filled
       in this branch is never reached, and the demo path below runs. */
    return await loadLivePartnerData(AUTH.session, fresh);
  }
  if (!loadPartnerData(AUTH.session.partnerKey)) return false;
  /* Welcome first, then the portal. Signing in is rare here — sessions run for
     days — so this is not a screen anybody has to keep dismissing, and it is the
     one moment a partner is paying attention to what this thing is for. Restoring
     an existing session goes straight to home; only an actual sign-in lands here. */
  UI.page = fresh ? 'welcome' : 'home'; UI.detail = null;
  render();
  return true;
}

/* Placeholder for the live hydrate. Kept as a named seam so the wiring is
   one function rather than a hunt through the portal. */
async function loadLivePartnerData(session, fresh) {
  const me = await partnerMe(session.token);
  if (!me) return false;
  const db = await buildLiveDB(Object.assign({}, session, { me: me }));
  if (!db) return false;
  DB = db;
  UI.page = fresh ? 'welcome' : 'home'; UI.detail = null;
  render();
  return true;
}

async function signOut() {
  modal('Sign out', AUTH.session ? esc(AUTH.session.email) : '',
    '<p class="note">You will need a new code to get back in. Anything you changed on this device stays where it is.</p>',
    '<button class="btn" onclick="closeModal()">Stay signed in</button>' +
    '<button class="btn danger" onclick="doSignOut()">Sign out</button>');
}
async function doSignOut() {
  closeModal();
  try { await AUTH.provider().signOut(); } catch (e) {}
  clearSession();
  DB = null;
  AUTH.stage = 'email';
  AUTH.pending = null;
  AUTH.error = '';
  renderAuth();
}

/* ---------------- the sign-in screen ---------------- */
function renderAuth() {
  const shell = document.getElementById('authShell');
  const app = document.getElementById('appShell');
  shell.style.display = 'flex';
  app.style.display = 'none';

  let body;
  if (AUTH.stage === 'suspended') body = suspendedCard();
  else if (AUTH.stage === 'setpw') body = setpwCard();
  else if (AUTH.stage === 'reset') body = resetCard();
  else if (AUTH.stage === 'sent') body = sentCard();
  else body = signinCard();

  shell.innerHTML =
    '<div class="authbox">' +
    '<div class="authbrand">' +
    '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<rect width="100" height="100" rx="24" fill="#0b1023"/>' +
    '<path d="M33 27v33a10 10 0 0 0 10 10h16" stroke="#fff" stroke-width="5.5" fill="none" stroke-linecap="round"/>' +
    '<path d="M43 35h13a8.5 8.5 0 0 1 0 17H43z" stroke="#fff" stroke-width="5.5" fill="none" stroke-linejoin="round"/>' +
    '<path d="M43 52h15a9 9 0 0 1 0 18H43" stroke="#fff" stroke-width="5.5" fill="none" stroke-linejoin="round"/>' +
    '<circle cx="74" cy="62" r="6" fill="#e0a94a"/>' +
    '</svg>' +
    '<div><div class="authname">THE LABEL BOARD</div><div class="authsub">Partner Portal</div></div>' +
    '</div>' + body + '</div>';
}

function signinCard() {
  return '<h1 class="autht">Sign in</h1>' +
    '<p class="authp">Your email and the password you set when you joined.</p>' +
    (AUTH.error ? '<div class="autherr">' + esc(AUTH.error) + '</div>' : '') +
    '<div class="fg"><label for="authEmail">Email</label>' +
    '<input id="authEmail" type="email" inputmode="email" autocomplete="username" ' +
    'placeholder="you@yourbusiness.com" value="' + esc(AUTH.pending ? AUTH.pending.email : '') + '" ' +
    'onkeydown="if(event.key===\'Enter\')document.getElementById(\'authPw\').focus()"></div>' +
    '<div class="fg"><label for="authPw">Password</label>' +
    '<input id="authPw" type="password" autocomplete="current-password" ' +
    'onkeydown="if(event.key===\'Enter\')doSignIn()"></div>' +
    '<button class="btn gold authgo" onclick="doSignIn()"' + (AUTH.busy ? ' disabled' : '') + '>' +
    (AUTH.busy ? 'Checking…' : 'Sign in') + '</button>' +
    '<div class="authalt"><button class="lnk" onclick="forgotPassword()">Forgot your password?</button></div>' +
    demoHint() +
    '<p class="authfoot">Not a partner yet? Ask whoever signed you up, or email ' +
    '<a href="mailto:hello@thelabelboard.com">hello@thelabelboard.com</a>.</p>';
}

function resetCard() {
  return '<h1 class="autht">Reset your password</h1>' +
    '<p class="authp">We will email you a link to set a new one.</p>' +
    (AUTH.error ? '<div class="autherr">' + esc(AUTH.error) + '</div>' : '') +
    '<div class="fg"><label for="authEmail">Email</label>' +
    '<input id="authEmail" type="email" inputmode="email" autocomplete="username" ' +
    'placeholder="you@yourbusiness.com" value="' + esc(AUTH.pending ? AUTH.pending.email : '') + '" ' +
    'onkeydown="if(event.key===\'Enter\')doRequestReset()"></div>' +
    '<button class="btn gold authgo" onclick="doRequestReset()"' + (AUTH.busy ? ' disabled' : '') + '>' +
    (AUTH.busy ? 'Sending…' : 'Email me a link') + '</button>' +
    '<div class="authalt"><button class="lnk" onclick="backToSignIn()">Back to sign in</button></div>';
}

/* Deliberately says "if that address has an account". Confirming that it does
   is the same leak as naming it on the sign-in screen. */
function sentCard() {
  return '<h1 class="autht">Check your email</h1>' +
    '<p class="authp">If <b>' + esc(AUTH.pending.email) + '</b> has a partner account, ' +
    'a link to set a new password is on its way. It works for one hour.</p>' +
    '<p class="authp">Nothing arrived? Look in spam, and check the address above.</p>' +
    '<div class="authalt"><button class="lnk" onclick="backToSignIn()">Back to sign in</button></div>';
}

function setpwCard() {
  const recovering = AUTH.arrivalKind === 'recovery';
  return '<h1 class="autht">' + (recovering ? 'Set a new password' : 'Welcome') + '</h1>' +
    '<p class="authp">' + (recovering
      ? 'Choose a new password for the partner portal.'
      : 'Choose a password to finish setting up your partner account. You will use it every time from now on.') +
    '</p>' +
    (AUTH.error ? '<div class="autherr">' + esc(AUTH.error) + '</div>' : '') +
    '<div class="fg"><label for="authPw">Password</label>' +
    '<input id="authPw" type="password" autocomplete="new-password" ' +
    'placeholder="At least ' + PW_MIN + ' characters"></div>' +
    '<div class="fg"><label for="authPw2">Repeat it</label>' +
    '<input id="authPw2" type="password" autocomplete="new-password" ' +
    'onkeydown="if(event.key===\'Enter\')doSetPassword()"></div>' +
    '<button class="btn gold authgo" onclick="doSetPassword()"' + (AUTH.busy ? ' disabled' : '') + '>' +
    (AUTH.busy ? 'Saving…' : 'Set my password') + '</button>';
}

function suspendedCard() {
  return '<h1 class="autht">Your account is on hold</h1>' +
    '<p class="authp">Your partner account is suspended, so there is nothing to show you here. ' +
    'Nothing you have already earned is affected.</p>' +
    '<p class="authp">Your partner manager can tell you why and what happens next.</p>' +
    '<a class="btn gold authgo" href="mailto:hello@thelabelboard.com?subject=' +
    encodeURIComponent('Suspended partner account: ' + (AUTH.pending.email || '')) + '">Email your manager</a>' +
    '<div class="authalt"><button class="lnk" onclick="backToSignIn()">Back to sign in</button></div>';
}

/* Only shown in demo mode, and it says so. Three example partners with
   deliberately different histories: one with years of referrals, one with a
   handful, and one who joined eleven days ago and has earned nothing yet. */
function demoHint() {
  if (CONFIG.live) return '';
  return '<div class="authpick"><div class="authpick-t">Demo logins</div>' +
    PARTNER_PROFILES.map(p =>
      '<button class="authpick-b" onclick="useDemo(\'' + p.email + '\')">' +
      '<span>' + esc(p.name) + '</span><small>' + esc(p.email) + '</small></button>').join('') +
    '</div>';
}
function useDemo(email) {
  const el = document.getElementById('authEmail');
  if (el) el.value = email;
  const pw = document.getElementById('authPw');
  if (pw) pw.value = 'demo';          // the demo takes any password, and says so
  doSignIn();
}

/* ---------------- arriving from an invitation ----------------
   The invitation email carries one link, and Supabase answers it by handing the
   browser a live session in the fragment of whatever address the link points
   at. Until now that address was the customer app for everybody, so a partner
   following their invitation landed on a studio sign-in form and was correctly
   told they had no studio. The account was right; the link was wrong.

   A partner who arrives here is already signed in. What they do not have — and
   by design never will — is a password: this portal signs people in with a code
   emailed on the day, because a partner opens it every few weeks and a password
   set in November is forgotten by February. So the honest thing to do with that
   session is use it. One tap from the email into the portal, and every visit
   after that is a code.

   The fragment is cleared before anything renders. A URL with a live token in
   it is the kind of thing that gets pasted into a chat to ask "is this right?" */
function readAuthArrival() {
  try {
    const raw = String(location.hash || '').replace(/^#/, '');
    if (!raw) return null;
    const h = new URLSearchParams(raw);
    const bad = h.get('error_description') || h.get('error');
    if (bad) return { error: String(bad).replace(/\+/g, ' ') };
    const token = h.get('access_token');
    if (!token) return null;
    return { token: token, refresh: h.get('refresh_token') || '', kind: h.get('type') || '' };
  } catch (e) { return null; }
}
function clearAuthArrival() {
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
}
/* Returns true when it has dealt with the page, false to carry on booting. */
async function handleAuthArrival() {
  if (!CONFIG.live) return false;                 // the demo has no real tokens
  const arrival = readAuthArrival();
  if (!arrival) return false;
  clearAuthArrival();

  if (arrival.error) {
    /* Almost always an expired link. Say so, and leave them on the sign-in
       screen, where the reset link is the fix and it is one tap away. */
    AUTH.error = arrival.error + '. Ask for a new link below, or your partner manager for a new invitation.';
    AUTH.stage = 'signin';
    renderAuth();
    return true;
  }

  const me = await partnerMe(arrival.token);
  if (!me) {
    AUTH.error = 'That link signed you in, but this account is not set up as a partner. Talk to your partner manager.';
    AUTH.stage = 'signin';
    renderAuth();
    return true;
  }
  if (me.status !== 'active') {
    clearSession();
    AUTH.stage = 'suspended';
    AUTH.pending = { email: me.email, name: me.name };
    renderAuth();
    return true;
  }

  /* The link proves who they are, and it works exactly once. Signing them
     straight in on it would leave them with no way back tomorrow — in once,
     locked out after, which reads as the portal being broken rather than a
     step having been skipped. So the arrival asks for a password first, and
     the sign-in happens on the far side of that.
     The token is held only for the moment it takes to set one, and is not
     written to storage. */
  AUTH.arrivalToken = arrival.token;
  AUTH.arrivalKind = arrival.kind || 'invite';
  AUTH.pending = { email: me.email, name: me.name };
  AUTH.stage = 'setpw';
  AUTH.error = '';
  renderAuth();
  return true;
}

/* ---------------- boot ---------------- */
async function bootAuth() {
  if (await handleAuthArrival()) return;

  const s = readSession();
  if (!s) { renderAuth(); return; }

  const r = await AUTH.provider().restore(s);
  if (r.suspended) {
    clearSession();
    AUTH.stage = 'suspended';
    AUTH.pending = { email: s.email, name: r.name };
    renderAuth();
    return;
  }
  if (!r.ok) { clearSession(); renderAuth(); return; }

  AUTH.session = r.session;
  if (!await enterPortal(false)) { clearSession(); renderAuth(); }
}
