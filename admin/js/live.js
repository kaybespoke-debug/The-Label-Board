/* ============================================================
   live.js — the console's connection to real studios.

   Everything the console shows comes out of DB. In the demo, data.js
   fills DB with a worked example. When CONFIG is filled in, this file
   fetches what studios have actually sent us and merges it into that
   same DB, in the same shape.

   Merging rather than replacing is the point. It means no page, no
   query in core.js and no detail view needs to know whether it is
   looking at a real ticket or an example one — they are the same shape,
   so everything that already works carries on working. It also means a
   connection that drops mid-shift degrades to what was already on
   screen instead of an empty console.

   Where the data comes from: the admin-api Edge Function, never a table.
   Tenant row-level security refuses to show one studio's message to
   anybody but that studio, and that is correct — we do not want a
   compromised console session to be able to read the whole platform
   from a browser. The function checks platform_admins server side, logs
   every read, and is the single audited door through that wall.

   What arrives here is written by studio owners. It is text, and it is
   rendered as text: esc() everywhere, no exceptions.
   ============================================================ */

const LIVE = {
  ready: false,          // a signed-in Label Board staff account
  client: null,
  me: null,              // { id, email, name, role }
  error: '',
  lastLoadedAt: null,
  loading: false,
  timer: null,

  on() { return !!(CONFIG.live && LIVE.ready); }
};

/* ---------------- connecting ---------------- */

function liveClient() {
  if (LIVE.client) return LIVE.client;
  if (!CONFIG.live) return null;
  if (!window.supabase || !window.supabase.createClient) return null;
  try { LIVE.client = window.supabase.createClient(CONFIG.SUPA_URL, CONFIG.SUPA_KEY); }
  catch (e) { LIVE.error = String(e.message || e); LIVE.client = null; }
  return LIVE.client;
}

/* Ask the function who we are. A tenant holding a valid Supabase session
   reaches this and is turned away by the function, not by us. */
async function liveCall(action, payload) {
  const c = liveClient();
  if (!c) throw new Error('Not configured');
  const { data: { session } } = await c.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch(CONFIG.FN_URL + '/admin-api', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + session.access_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(Object.assign({ action: action }, payload || {}))
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) throw new Error(out.error || ('Request failed (' + res.status + ')'));
  return out;
}

async function liveConnect() {
  if (!CONFIG.live) return false;
  try {
    const out = await liveCall('me');
    LIVE.me = out.me;
    LIVE.ready = true;
    LIVE.error = '';
    return true;
  } catch (e) {
    LIVE.ready = false;
    LIVE.error = String(e.message || e);
    return false;
  }
}

/* ---------------- shaping ----------------
   A studio picks from five kinds. The console has two queues, and which
   queue something belongs in is a judgement about what we do with it,
   not about what it is:

     complaint, support   →  the support queue. Somebody is stuck or
                             unhappy and is waiting on a person.
     suggestion, feature,
     review               →  the feedback queue. Nobody is blocked; this
                             is what we build next, or what we quote.

   Kinds are also mapped onto the ones the console already uses, so the
   existing filters and pills keep working rather than silently showing
   nothing for a value they have never seen. */

const LIVE_TICKET_KIND = { complaint: 'bug', support: 'question' };

function liveState(row) {
  // A studio that said it is blocked is urgent until somebody picks it up.
  if (row.urgency === 'blocking' && (row.state === 'new' || row.state === 'open')) return 'urgent';
  if (row.state === 'new') return 'open';
  if (row.state === 'declined') return 'resolved';
  if (row.state === 'planned') return 'in-progress';
  return row.state;
}

function liveToTicket(row) {
  return {
    id: 'live-' + row.id,
    liveId: row.id,
    live: true,
    ref: row.ref,
    title: row.title,
    body: row.body,
    priority: row.urgency === 'blocking' ? 'urgent' : 'normal',
    state: liveState(row),
    kind: LIVE_TICKET_KIND[row.kind] || 'question',
    subId: row.business_id,
    subscriber: row.business_name || 'Unknown studio',
    plan: row.business_plan || '',
    assignedTo: null,
    assignedName: 'Unassigned',
    openedAt: row.created_at,
    firstReplyMins: 0,
    resolvedAt: row.state === 'resolved' ? (row.last_reply_at || row.created_at) : null,
    satisfaction: null,
    contactName: row.contact_name || '',
    contactEmail: row.contact_email || '',
    contextPage: row.context_page || '',
    appVersion: row.app_version || '',
    replyCount: Number(row.reply_count || 0),
    thread: [{ who: row.contact_name || row.business_name || 'Studio', side: 'them', at: row.created_at, text: row.body }]
  };
}

function liveToFeedback(row) {
  return {
    id: 'live-' + row.id,
    liveId: row.id,
    live: true,
    ref: row.ref,
    title: row.title,
    body: row.body,
    kind: row.kind === 'review' ? 'review' : (row.kind === 'feature' ? 'feature' : 'suggestion'),
    votes: 0,
    state: row.state === 'new' ? 'under review' : row.state,
    subId: row.business_id,
    subscriber: row.business_name || 'Unknown studio',
    plan: row.business_plan || '',
    rating: row.rating || null,
    at: row.created_at
  };
}

/* ---------------- merging ----------------
   Real rows go in front of the example ones. */

function mergeLive(list, incoming) {
  // Live rows always arrive complete from the server, so the old ones are simply
  // dropped rather than reconciled. Only the example rows are carried over, and
  // that is what makes reloading twice produce one of everything rather than two.
  const demo = (list || []).filter(x => !x.live);
  return incoming.concat(demo);
}

async function liveLoadInbox() {
  if (!LIVE.on() || LIVE.loading) return false;
  LIVE.loading = true;
  try {
    const out = await liveCall('feedback');
    const rows = out.feedback || [];
    const tickets = rows.filter(r => r.kind === 'complaint' || r.kind === 'support').map(liveToTicket);
    const feedback = rows.filter(r => r.kind !== 'complaint' && r.kind !== 'support').map(liveToFeedback);
    DB.tickets = mergeLive(DB.tickets || [], tickets);
    DB.feedback = mergeLive(DB.feedback || [], feedback);
    LIVE.lastLoadedAt = new Date().toISOString();
    LIVE.error = '';
    return true;
  } catch (e) {
    LIVE.error = String(e.message || e);
    return false;
  } finally {
    LIVE.loading = false;
  }
}

/* ---------------- acting on one ---------------- */

async function liveSetState(liveId, value) {
  await liveCall('setFeedbackState', { id: liveId, value: value });
  await liveLoadInbox();
}

async function liveReply(liveId, text) {
  await liveCall('replyFeedback', { id: liveId, body: text });
  await liveLoadInbox();
}

async function liveThread(liveId) {
  const out = await liveCall('feedbackThread', { id: liveId });
  return { message: out.message, replies: out.replies || [] };
}

/* ---------------- keeping it fresh ---------------- */

function liveStartPolling() {
  if (!LIVE.on() || LIVE.timer) return;
  const secs = Math.max(30, +CONFIG.inboxRefreshSeconds || 90);
  LIVE.timer = setInterval(async () => {
    const changed = await liveLoadInbox();
    if (changed && typeof render === 'function') { try { render(); } catch (e) {} }
  }, secs * 1000);
}
function liveStopPolling() { if (LIVE.timer) { clearInterval(LIVE.timer); LIVE.timer = null; } }

/* Called once the console has finished signing somebody in. Safe to call
   when nothing is configured: it does nothing and the demo carries on. */
async function liveStart() {
  if (!CONFIG.live) return;
  const ok = await liveConnect();
  if (!ok) return;
  await liveLoadInbox();
  liveStartPolling();
  if (typeof render === 'function') { try { render(); } catch (e) {} }
}

/* What to tell the person looking at it. A console showing example data
   must say so, or somebody will act on a ticket that was never real. */
function liveStatusLine() {
  if (!CONFIG.live) return { mode: 'demo', text: 'Example data. Fill in js/config.js to read real studios.' };
  if (!LIVE.ready) return { mode: 'error', text: LIVE.error || 'Not connected.' };
  return {
    mode: 'live',
    text: 'Live' + (LIVE.me && LIVE.me.name ? ' as ' + LIVE.me.name : '') +
          (LIVE.lastLoadedAt ? ' · updated ' + new Date(LIVE.lastLoadedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')
  };
}

/* ============================================================
   SIGNING IN FOR REAL

   The console had no way to sign into Supabase at all. Its login is
   credentials.js — PBKDF2 in this browser — which is right for the demo
   and for a console nobody has connected yet, but it produces no Supabase
   session. liveCall() asks getSession() for a token, got null every time,
   and reported "Not signed in". So filling in config.js flipped the badge
   to Live while the data stayed the worked example: the most misleading
   state the console could be in.

   What follows adds the real path and leaves the local one alone. When
   config.js is blank nothing here runs and the demo behaves exactly as it
   did. When it is filled in, the password goes to Supabase Auth, and
   whether you are staff at all is decided by admin-api against
   platform_admins — server side, where it cannot be edited by a browser.
   ============================================================ */

/* Our four roles, as admin-api understands them, mapped onto the console's
   own. admin-api is the one that decides what an operator may DO — it
   refuses any action the role does not list — so this only decides which
   pages the console bothers to draw. A role we do not recognise gets the
   most limited one rather than the most generous. */
const LIVE_ROLE_TO_CONSOLE = {
  owner: 'owner',
  finance: 'finance',
  support: 'support',
  developer: 'product'
};

async function liveSignIn(email, password) {
  const c = liveClient();
  if (!c) return { ok: false, error: 'This console is not connected to a project.' };
  let session;
  try {
    const { data, error } = await c.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password: password
    });
    if (error) return { ok: false, error: error.message, credentials: true };
    session = data && data.session;
  } catch (e) {
    return { ok: false, error: 'Could not reach the sign-in server.' };
  }
  if (!session) return { ok: false, error: 'Signed in, but no session came back.' };

  /* A valid Supabase account is not the same as being one of us. Any studio
     owner on the platform holds one of these. admin-api checks
     platform_admins and turns everybody else away, so ask it before letting
     anyone past the login screen — and sign them back out if it says no,
     rather than leaving a session lying around in the browser. */
  try {
    const out = await liveCall('me');
    LIVE.me = out.me;
    LIVE.ready = true;
    LIVE.error = '';
    return { ok: true, me: out.me };
  } catch (e) {
    try { await c.auth.signOut(); } catch (e2) {}
    LIVE.ready = false;
    return { ok: false, error: String(e.message || e) };
  }
}

/* The console draws itself from DB.staff, so a real operator needs a record
   there to be. Adopt one that already matches the address, otherwise build
   it from what admin-api told us. Deliberately does not invent a password:
   this account signs in through Supabase, and a local credential for it
   would be a second, weaker way in. */
function liveAdoptStaff(me) {
  const email = String((me && me.email) || '').toLowerCase();
  const existing = (DB.staff || []).find(s =>
    String(s.email || '').toLowerCase() === email ||
    (s.altEmails || []).some(a => String(a).toLowerCase() === email));
  const roleId = LIVE_ROLE_TO_CONSOLE[String((me && me.role) || '').toLowerCase()] || 'support';

  if (existing) {
    existing.roleId = roleId;          // the server's answer wins
    existing.status = 'active';
    return existing;
  }
  const name = (me && me.name) || email.split('@')[0] || 'Operator';
  const s = {
    id: Math.max(0, ...(DB.staff || []).map(x => +x.id || 0)) + 1,
    staffId: 'TLB-' + String((DB.staff || []).length + 1).padStart(3, '0'),
    name: name, dept: 'Platform', title: 'Operator', roleId: roleId,
    username: '@' + String(name).split(' ')[0].toLowerCase(),
    email: email, altEmails: [], phone: '—', status: 'active',
    empType: 'Full time', startDate: iso(TODAY), workLocation: '—',
    reportsTo: null, lastActiveLabel: 'Now'
  };
  (DB.staff || (DB.staff = [])).push(s);
  return s;
}

async function liveSignOut() {
  const c = LIVE.client;
  LIVE.ready = false; LIVE.me = null;
  if (!c) return;
  try { await c.auth.signOut(); } catch (e) {}
}

/* Does this browser already hold a Supabase session? Called on boot so a
   refresh does not throw a signed-in operator back to the login screen. */
async function liveRestore() {
  if (!CONFIG.live) return null;
  const c = liveClient();
  if (!c) return null;
  try {
    const { data: { session } } = await c.auth.getSession();
    if (!session) return null;
    const out = await liveCall('me');
    LIVE.me = out.me; LIVE.ready = true; LIVE.error = '';
    return out.me;
  } catch (e) { return null; }
}
