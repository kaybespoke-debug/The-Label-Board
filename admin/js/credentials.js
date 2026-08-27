/* ============================================================
   credentials.js — real password storage for the console.

   What this is, plainly: a lock on the front door. The console is on a
   public URL, and until today anyone who found it could type the
   prefilled email, any characters at all, and be signed in as the owner.
   That is what this fixes.

   What it is NOT: a safe. The console's data lives in this browser's
   localStorage in plain text, so anyone sitting at an unlocked device with
   developer tools can read it, and can forge a session by writing the
   session key directly. No amount of client-side code changes that. Real
   protection means the data lives on a server behind Supabase Auth, which
   is the next phase.

   So: this stops someone finding the URL and walking in. It does not stop
   someone with your unlocked laptop. Both statements are worth knowing.

   How it stores a password:
     PBKDF2-HMAC-SHA256, 210,000 iterations, a fresh 16-byte random salt
     per account, 256-bit output. The password itself is never stored and
     never leaves the device. Verification re-derives and compares.

   Why its own localStorage key: the staff records are rebuilt from seed on
   every load, so a password hung off a staff object would vanish on
   refresh. Credentials live in tlb_admin_credentials and deliberately
   survive Load example data and Clear all data, because your own login
   should not be destroyed by resetting the demo.
   ============================================================ */

const CRED_KEY = 'tlb_admin_credentials';
const PBKDF2_ITER = 210000;
const MAX_FAILURES = 8;
const LOCK_MINUTES = 15;

/* ---------------- store ---------------- */
function credStore() {
  try { return JSON.parse(localStorage.getItem(CRED_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveCredStore(o) {
  try { localStorage.setItem(CRED_KEY, JSON.stringify(o)); return true; }
  catch (e) { return false; }
}
function credKeyFor(email) { return String(email || '').trim().toLowerCase(); }
function credFor(email) { return credStore()[credKeyFor(email)] || null; }
function anyCredentials() { return Object.keys(credStore()).length > 0; }
function credCount() { return Object.keys(credStore()).length; }

/* ---------------- bytes ---------------- */
function randBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(str) {
  const s = atob(str);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

/* Compare without leaking where two hashes first differ. Timing attacks are
   not a realistic threat here, but comparing hashes properly costs nothing
   and stops this being copied somewhere it does matter. */
function constantTimeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------- derivation ---------------- */
async function derive(password, saltB64, iter) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: iter },
    key, 256);
  return toB64(new Uint8Array(bits));
}

/* Web Crypto needs a secure context. Over file:// or plain http on a LAN
   address it is absent, and we must say so rather than silently letting
   everyone in. */
function cryptoAvailable() {
  return !!(window.crypto && crypto.subtle && crypto.subtle.deriveBits);
}

/* ---------------- recovery codes ----------------
   No server means no reset email. A code generated once at setup is the
   only honest way back in, so it is offered rather than leaving someone
   locked out of their own console permanently. Stored as a hash, like the
   password, so the stored copy is not itself a way in. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no I L O U 0 1
function makeRecoveryCode() {
  const bytes = randBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    if (i % 4 === 3 && i < 11) out += '-';
  }
  return out;
}
function normaliseRecovery(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* ---------------- writing ---------------- */
/* Returns the recovery code, which is shown once and then unrecoverable. */
async function setPassword(email, password, opts) {
  const o = opts || {};
  const salt = toB64(randBytes(16));
  const hash = await derive(password, salt, PBKDF2_ITER);

  const store = credStore();
  const key = credKeyFor(email);
  const existing = store[key] || {};

  let recovery = null, recSalt = existing.recSalt, recHash = existing.recHash;
  if (o.newRecoveryCode || !recHash) {
    recovery = makeRecoveryCode();
    recSalt = toB64(randBytes(16));
    recHash = await derive(normaliseRecovery(recovery), recSalt, PBKDF2_ITER);
  }

  store[key] = {
    salt: salt, hash: hash, iter: PBKDF2_ITER,
    setOn: new Date().toISOString(),
    recSalt: recSalt, recHash: recHash,
    failures: 0, lockedUntil: null
  };
  saveCredStore(store);
  return recovery;
}

async function verifyPassword(email, password) {
  const c = credFor(email);
  if (!c) return false;
  const hash = await derive(password, c.salt, c.iter || PBKDF2_ITER);
  return constantTimeEq(hash, c.hash);
}

async function verifyRecovery(email, code) {
  const c = credFor(email);
  if (!c || !c.recHash || !c.recSalt) return false;
  const hash = await derive(normaliseRecovery(code), c.recSalt, c.iter || PBKDF2_ITER);
  return constantTimeEq(hash, c.recHash);
}

function removeCredential(email) {
  const store = credStore();
  delete store[credKeyFor(email)];
  saveCredStore(store);
}

/* ---------------- lockout ----------------
   Bypassable by clearing localStorage, and said so above. It still does the
   job it is here for: making guessing at the sign-in screen pointless. */
function credLockState(email) {
  const c = credFor(email);
  if (!c || !c.lockedUntil) return { locked: false, minsLeft: 0 };
  const left = new Date(c.lockedUntil).getTime() - Date.now();
  if (left <= 0) return { locked: false, minsLeft: 0 };
  return { locked: true, minsLeft: Math.max(1, Math.ceil(left / 60000)) };
}

function noteFailure(email) {
  const store = credStore();
  const key = credKeyFor(email);
  const c = store[key];
  if (!c) return { locked: false, left: MAX_FAILURES };
  c.failures = (c.failures || 0) + 1;
  if (c.failures >= MAX_FAILURES) {
    c.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    c.failures = 0;
    saveCredStore(store);
    return { locked: true, left: 0 };
  }
  saveCredStore(store);
  return { locked: false, left: MAX_FAILURES - c.failures };
}

function clearFailures(email) {
  const store = credStore();
  const key = credKeyFor(email);
  if (!store[key]) return;
  store[key].failures = 0;
  store[key].lockedUntil = null;
  saveCredStore(store);
}

/* ---------------- who can sign in ----------------
   An account is reachable if it exists in the staff list AND has a
   credential. Everyone else needs an owner to set one for them. */
function hasPassword(staff) {
  if (!staff) return false;
  return !!(credFor(staff.email) ||
            (staff.altEmails || []).some(e => credFor(e)));
}
function credEmailFor(staff) {
  if (!staff) return null;
  if (credFor(staff.email)) return credKeyFor(staff.email);
  const alt = (staff.altEmails || []).find(e => credFor(e));
  return alt ? credKeyFor(alt) : credKeyFor(staff.email);
}
