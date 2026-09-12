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
  stage: 'email',         // email | code | suspended
  pending: null,          // { email, sentAt, demoCode }
  busy: false,
  error: '',

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

  async sendCode(email) {
    const p = profileByEmail(email);
    /* The same answer whether or not the address is one we know. An error
       that says "no such partner" turns this box into a way to find out
       who our partners are. */
    await pause(400);
    return { ok: true, demoCode: p ? demoCodeFor(p.email) : null };
  },

  async verify(email, code) {
    await pause(400);
    const p = profileByEmail(email);
    if (!p || code !== demoCodeFor(p.email)) return { ok: false, error: 'That code is not right. Check it and try again.' };
    return {
      ok: true,
      session: {
        partnerKey: p.key, email: p.email, name: p.name,
        expiresAt: sessionExpiry(), provider: 'demo'
      }
    };
  },

  async restore(session) {
    return profileByKey(session.partnerKey) ? { ok: true, session } : { ok: false };
  },

  async signOut() { /* nothing to tell anyone about */ }
};

/* A six digit code, stable for the day, derived from the address. */
function demoCodeFor(email) {
  const day = iso(new Date());
  let h = 2166136261;
  for (const ch of (email + '|' + day)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return String(h % 1000000).padStart(6, '0');
}
function pause(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------------- the Supabase provider ----------------
   Written against the REST endpoints rather than the JS SDK, so the portal
   stays a folder of files with no build step, which is what lets it deploy
   the same way as the admin console.

   Wiring checklist lives in PARTNERS.md. In short: fill in config.js, run
   the partner migration, and create a partners row per login. */
const SUPA_PROVIDER = {
  name: 'supabase',

  async sendCode(email) {
    const r = await supaFetch('/auth/v1/otp', {
      method: 'POST',
      body: JSON.stringify({ email: String(email).trim(), create_user: false })
    });
    /* Same answer either way, for the same reason as the demo provider. */
    return { ok: true, demoCode: null, softError: r.ok ? null : r.error };
  },

  async verify(email, code) {
    const r = await supaFetch('/auth/v1/verify', {
      method: 'POST',
      body: JSON.stringify({ email: String(email).trim(), token: code, type: 'email' })
    });
    if (!r.ok || !r.body || !r.body.access_token) {
      return { ok: false, error: 'That code is not right, or it has expired. Ask for a new one.' };
    }
    const token = r.body.access_token;
    const me = await partnerMe(token);
    if (!me) {
      return { ok: false, error: 'That login is not set up as a partner yet. Talk to your partner manager.' };
    }
    if (me.status !== 'active') {
      return { ok: false, suspended: true, name: me.name };
    }
    return {
      ok: true,
      session: {
        partnerKey: me.id, email: me.email, name: me.name,
        token, refresh: r.body.refresh_token,
        expiresAt: sessionExpiry(), provider: 'supabase'
      }
    };
  },

  async restore(session) {
    const me = await partnerMe(session.token);
    if (!me) return { ok: false };
    if (me.status !== 'active') return { ok: false, suspended: true, name: me.name };
    return { ok: true, session };
  },

  async signOut() {
    if (AUTH.session && AUTH.session.token) {
      await supaFetch('/auth/v1/logout', { method: 'POST', token: AUTH.session.token });
    }
  }
};

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

/* ---------------- the flow ---------------- */
async function requestCode() {
  const input = document.getElementById('authEmail');
  const email = (input ? input.value : '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    AUTH.error = 'That does not look like an email address.';
    renderAuth();
    return;
  }
  AUTH.busy = true; AUTH.error = ''; renderAuth();

  const r = await AUTH.provider().sendCode(email);
  AUTH.busy = false;
  AUTH.pending = { email, sentAt: Date.now(), demoCode: r.demoCode };
  AUTH.stage = 'code';
  renderAuth();
  setTimeout(() => { const c = document.getElementById('authCode'); if (c) c.focus(); }, 60);
}

async function submitCode() {
  const input = document.getElementById('authCode');
  const code = (input ? input.value : '').replace(/[^0-9]/g, '');
  if (code.length !== 6) {
    AUTH.error = 'The code is six digits.';
    renderAuth();
    return;
  }
  AUTH.busy = true; AUTH.error = ''; renderAuth();

  const r = await AUTH.provider().verify(AUTH.pending.email, code);
  AUTH.busy = false;

  if (r.suspended) {
    AUTH.stage = 'suspended';
    AUTH.pending = { email: AUTH.pending.email, name: r.name };
    renderAuth();
    return;
  }
  if (!r.ok) {
    AUTH.error = r.error || 'That did not work.';
    renderAuth();
    return;
  }

  saveSession(r.session);
  if (!enterPortal(true)) {
    clearSession();
    AUTH.error = 'We could not load your account. Try again in a moment.';
    renderAuth();
  }
}

function backToEmail() {
  AUTH.stage = 'email';
  AUTH.error = '';
  renderAuth();
  setTimeout(() => { const e = document.getElementById('authEmail'); if (e) e.focus(); }, 60);
}

/* Load the signed-in partner's data and hand over to the portal.

   `fresh` is true only when somebody has just typed a code, false when a saved
   session is being restored on open. That distinction is the whole point of the
   welcome page: it greets a sign-in, it does not greet somebody who simply
   reopened the app on the bus. */
function enterPortal(fresh) {
  if (!AUTH.session) return false;
  if (CONFIG.live) {
    /* Live mode fetches the partner's rows here. Until config.js is filled
       in this branch is never reached, and the demo path below runs. */
    return loadLivePartnerData(AUTH.session);
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
function loadLivePartnerData() {
  console.warn('Live mode is configured but the hydrate is not wired yet. See PARTNERS.md.');
  return false;
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
  else if (AUTH.stage === 'code') body = codeCard();
  else body = emailCard();

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

function emailCard() {
  return '<h1 class="autht">Sign in</h1>' +
    '<p class="authp">We will send a six digit code to your email. No password to remember.</p>' +
    (AUTH.error ? '<div class="autherr">' + esc(AUTH.error) + '</div>' : '') +
    '<div class="fg"><label for="authEmail">Email</label>' +
    '<input id="authEmail" type="email" inputmode="email" autocomplete="email" ' +
    'placeholder="you@yourbusiness.com" value="' + esc(AUTH.pending ? AUTH.pending.email : '') + '" ' +
    'onkeydown="if(event.key===\'Enter\')requestCode()"></div>' +
    '<button class="btn gold authgo" onclick="requestCode()"' + (AUTH.busy ? ' disabled' : '') + '>' +
    (AUTH.busy ? 'Sending…' : 'Send my code') + '</button>' +
    demoHint() +
    '<p class="authfoot">Not a partner yet? Ask whoever signed you up, or email ' +
    '<a href="mailto:hello@thelabelboard.com">hello@thelabelboard.com</a>.</p>';
}

function codeCard() {
  return '<h1 class="autht">Check your email</h1>' +
    '<p class="authp">We sent a six digit code to <b>' + esc(AUTH.pending.email) + '</b>. ' +
    'It works for ten minutes.</p>' +
    (AUTH.error ? '<div class="autherr">' + esc(AUTH.error) + '</div>' : '') +
    (AUTH.pending.demoCode
      ? '<div class="authdemo"><span>Demo mode, so here is the code instead of an email</span>' +
        '<b>' + AUTH.pending.demoCode + '</b></div>'
      : '') +
    '<div class="fg"><label for="authCode">Your code</label>' +
    '<input id="authCode" class="authcode" inputmode="numeric" autocomplete="one-time-code" ' +
    'maxlength="6" placeholder="000000" onkeydown="if(event.key===\'Enter\')submitCode()"></div>' +
    '<button class="btn gold authgo" onclick="submitCode()"' + (AUTH.busy ? ' disabled' : '') + '>' +
    (AUTH.busy ? 'Checking…' : 'Sign in') + '</button>' +
    '<div class="authalt">' +
    '<button class="lnk" onclick="backToEmail()">Use a different email</button>' +
    '<button class="lnk" onclick="requestCode()">Send it again</button>' +
    '</div>';
}

function suspendedCard() {
  return '<h1 class="autht">Your account is on hold</h1>' +
    '<p class="authp">Your partner account is suspended, so there is nothing to show you here. ' +
    'Nothing you have already earned is affected.</p>' +
    '<p class="authp">Your partner manager can tell you why and what happens next.</p>' +
    '<a class="btn gold authgo" href="mailto:hello@thelabelboard.com?subject=' +
    encodeURIComponent('Suspended partner account: ' + (AUTH.pending.email || '')) + '">Email your manager</a>' +
    '<div class="authalt"><button class="lnk" onclick="backToEmail()">Back to sign in</button></div>';
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
  requestCode();
}

/* ---------------- boot ---------------- */
async function bootAuth() {
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
  if (!enterPortal(false)) { clearSession(); renderAuth(); }
}
