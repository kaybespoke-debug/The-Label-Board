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
    await liveLoadTenants();   // a studio that signed up since the console opened
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
  await liveLoadTenants();
  await liveLoadBilling();
  await liveLoadPayments();
  await liveLoadInbox();
  await liveLoadEnquiries();
  await liveLoadPartners();
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

/* ============================================================
   REAL STUDIOS IN THE SUBSCRIBER LIST

   admin-api has served `tenants` since it was written, and
   platform_tenant_summary() exists to answer it. Nothing ever called
   either. So a studio could sign up, use the app, and never appear
   anywhere in the console — the subscriber list was the worked example
   and only the worked example, which is a convincing way to believe you
   have no customers.

   Merged into DB.subscribers in the same shape as the example ones and
   marked live, exactly as the inbox does, so every page, filter, count
   and detail view that already works carries on working.
   ============================================================ */

/* What we actually know about a real studio, and nothing we do not.
   The console's own example subscribers carry a sales CRM's worth of
   detail — channel, health score, referral graph, orders in the last
   thirty days. None of that exists for a real tenant yet, so it is left
   empty rather than invented: a fabricated health score on a real
   customer is worse than a blank one, because somebody will act on it. */
function liveToSubscriber(row) {
  const planId = String(row.plan || 'trial');
  const plan = (typeof planById === 'function' ? planById(planId) : null) || { name: planId, seats: 0, monthly: 0 };
  // businesses.status is active/suspended/closed; the console thinks in
  // active/trial/expired. A studio on the trial plan is on trial whatever
  // its row says, because that is what the app will be showing them.
  const status = String(row.status) === 'closed' ? 'expired'
    : planId === 'trial' ? 'trial' : 'active';
  const outlets = Math.max(1, Number(row.branches) || 1);

  return {
    id: 'live-' + row.id,
    liveId: row.id,
    live: true,
    name: row.name || '(unnamed studio)',
    owner: '',
    email: row.contact_email || '',
    phone: '',
    city: '',
    plan: planId,
    planName: plan.name,
    cycle: planId === 'trial' ? 'trial' : 'monthly',
    status,
    pastDue: false,
    /* No health signal exists for a real studio yet. 'onboarding' for a trial
       is a statement of fact; everything else stays neutral rather than
       claiming to have measured something. */
    health: status === 'expired' ? 'churned' : status === 'trial' ? 'onboarding' : 'steady',
    users: Number(row.members) || 0,
    seats: plan.seats || 0,
    joined: String(row.created_at || '').slice(0, 10),
    renewsOn: '',
    renewIn: null,
    /* The plan's list price, which is what they would owe — not money we have
       taken. Nothing bills these studios yet, so treating this as collected
       revenue would overstate it. */
    mrr: status === 'active' ? (plan.monthly || 0) : 0,
    channel: 'Direct',
    channelSource: 'signup',
    businesses: Array.from({ length: outlets }, function (_, i) {
      return { name: i === 0 ? 'Main studio' : 'Studio ' + (i + 1), city: '', staff: 0, openedOn: '' };
    }),
    referredBy: null,
    referrals: [],
    /* The Referrals & bonuses tab reads all five of these, and one of them is
       read as `.length`. A live studio arrived without any of them, so opening
       that tab threw and the error boundary blanked the whole Subscribers page
       — three clicks from the subscriber list. Nothing tracks studio-to-studio
       referrals in the database yet, so zero and empty is the truthful answer
       rather than a placeholder: when it is tracked, this is where it lands. */
    referralLedger: [],
    referralConverted: 0,
    /* Filled in by liveLoadBilling a moment later. Present here so the detail
       view never reads undefined in the window before that call returns. */
    paidToDate: 0,
    paymentsCount: 0,
    trialEndsOn: null,
    lastSeen: String(row.last_active_at || '').slice(0, 10),
    /* A lifetime order count only ever goes up, so it cannot tell you that a
       tester stopped on day nine. platform_tenant_summary counts the last
       thirty days as well, which is the number that can fall. */
    ordersLast30: row.orders_30d === undefined || row.orders_30d === null
      ? null : Number(row.orders_30d),
    /* Which intake they came in with, or empty for a normal signup. */
    cohort: row.cohort || '',
    notes: []
  };
}

async function liveLoadTenants() {
  if (!LIVE.on()) return false;
  try {
    const out = await liveCall('tenants');
    DB.subscribers = mergeLive(DB.subscribers || [], (out.tenants || []).map(liveToSubscriber));
    return true;
  } catch (e) {
    // A role that may not list tenants is not an error worth shouting about;
    // admin-api refuses per role and the console simply shows what it can.
    LIVE.error = LIVE.error || String(e.message || e);
    return false;
  }
}

/* ============================================================
   WHAT A STUDIO IS ON, AND WHAT IT HAS PAID

   The subscriber list arrived from platform_tenant_summary(), which knows
   what plan a studio is on and nothing about money. So MRR was the plan's
   list price — what a studio would owe if it were paying, reported as
   though it were revenue. For a console whose whole job is to tell you how
   the business is doing, that is the worst possible default: it is always
   optimistic, and it is optimistic by exactly the amount you have failed
   to collect.

   platform_billing_summary() answers both halves: the active subscription
   (plan, cycle, price, trial end, renewal) and the sum of payments that
   actually completed. Pending and failed ones are counted but not banked.
   ============================================================ */

async function liveLoadBilling() {
  if (!LIVE.on()) return false;
  try {
    const out = await liveCall('billing');
    const by = {};
    (out.billing || []).forEach(function (r) { by[r.business_id] = r; });

    (DB.subscribers || []).forEach(function (s) {
      if (!s.live) return;                       // example rows keep their own figures
      const b = by[s.liveId];
      if (!b) return;
      s.plan = b.plan || s.plan;
      s.planName = (typeof planById === 'function' && planById(s.plan) ? planById(s.plan).name : s.plan);
      s.cycle = b.billing_cycle || s.cycle;
      /* The real price on the real subscription, not the plan's list price.
         A studio moved onto Pro at a discount is worth what it pays. */
      s.mrr = b.is_trial ? 0 : (Number(b.monthly_price) || 0);
      s.status = b.is_trial ? 'trial' : s.status;
      s.trialEndsOn = b.trial_ends_on || null;
      s.renewsOn = b.renews_on || s.renewsOn;
      s.renewIn = b.renews_on ? Math.round((parseD(b.renews_on) - startOfDay(TODAY)) / DAY) : s.renewIn;
      s.paidToDate = Number(b.paid_to_date) || 0;
      s.paymentsCount = Number(b.payments_count) || 0;
      s.lastPaidOn = b.last_paid_on ? String(b.last_paid_on).slice(0, 10) : null;
      /* A trial that has run out is not still a trial. Nothing expires it
         automatically — there is no billing run — so the console says so
         rather than showing a studio as trialling three weeks after it
         stopped. */
      if (b.is_trial && b.trial_ends_on && parseD(b.trial_ends_on) < startOfDay(TODAY)) {
        s.health = 'at-risk';
        s.trialExpired = true;
      }
    });
    return true;
  } catch (e) {
    LIVE.error = LIVE.error || String(e.message || e);
    return false;
  }
}

/* Real payments alongside the example ones, in the shape the Payments page
   already reads. */
function liveToPayment(row) {
  return {
    id: 'live-' + row.id,
    liveId: row.id,
    live: true,
    subId: row.business_id ? 'live-' + row.business_id : null,
    subscriber: row.business_name || '(unknown studio)',
    plan: '', cycle: '',
    ref: row.reference || '—',
    amount: Number(row.amount) || 0,
    provider: 'Recorded by hand',
    method: row.payment_method || '—',
    /* tlb_payments says completed/pending/failed/refunded; the console reads
       successful/pending/failed/refunded. Mapped rather than renamed on
       either side, because both names are already in use elsewhere. */
    status: row.status === 'completed' ? 'successful' : (row.status || 'pending'),
    date: String(row.paid_on || '').slice(0, 10),
    invoice: row.reference || '—',
    note: row.notes || ''
  };
}

async function liveLoadPayments() {
  if (!LIVE.on()) return false;
  try {
    const out = await liveCall('payments');
    DB.payments = mergeLive(DB.payments || [], (out.payments || []).map(liveToPayment));
    return true;
  } catch (e) {
    LIVE.error = LIVE.error || String(e.message || e);
    return false;
  }
}

/* ---------------- acting on it ---------------- */

/* Moving a studio onto a plan. Both books or neither: businesses.plan is
   what the app reads to decide what the studio may do, the subscription is
   what we invoice against, and set_studio_plan writes them together. */
async function liveSetPlan(subId, plan, cycle, price) {
  const s = Q.sub(subId);
  if (!s || !s.live) throw new Error('That is an example subscriber, not a real studio.');
  await liveCall('setPlan', { id: s.liveId, value: plan, cycle: cycle, price: Number(price) || 0 });
  await liveLoadTenants();
  await liveLoadBilling();
}

/* Granting one studio more space than its plan includes.
   This is how we say yes to a big brand without raising the cap for
   everybody: an override on that studio's row, set after a price is agreed.
   Extra storage costs us about N28/GB/month, so whatever is charged for it
   wants to be comfortably above that.
   Passing null clears the override and returns them to their plan. */
async function liveSetStorageCap(subId, gb, note) {
  const s = Q.sub(subId);
  if (!s || !s.live) throw new Error('That is an example subscriber, not a real studio.');
  const value = (gb === null || gb === undefined || gb === '') ? null : Number(gb);
  await liveCall('setStorageCap', { id: s.liveId, gb: value, note: note || '' });
  await liveLoadTenants();
}

/* An agreed ceiling on ONE studio, which is how a Bespoke contract gets
   recorded and how a promise made on a call stops being only a promise.
   null on either side puts that one back on the plan's own limit.

   A ceiling below what they already have is allowed, and is not a way to
   take anything away: the limit is only read when something is ADDED, so
   the studio keeps every outlet and every login it has. */
/* The patterns worth a second look. Cached on DB rather than fetched per
   render, for the same reason the commission summary is: a detail view
   re-renders on every keystroke in the search box above it. */
async function liveLoadReferralRisk() {
  const out = await liveCall('referralRisk');
  DB.referralRisk = (out.risk || []).map(function (r) {
    return {
      partnerId: r.partner_id, partner: r.partner_name || '', code: r.partner_code || '',
      businessId: r.business_id, business: r.business_name || '',
      kind: r.kind, detail: r.detail || '', at: r.at || ''
    };
  });
  return DB.referralRisk;
}

/* Freezing needs a reason in the database as well as here, so a freeze can
   never be a thing somebody did that nobody can explain later. */
async function liveSetPayoutFrozen(partnerId, frozen, reason) {
  await liveCall('setPayoutFrozen', { id: partnerId, frozen: !!frozen, reason: reason || '' });
  await liveLoadPartners();
}

async function liveSetStudioLimits(subId, studios, seats) {
  const s = Q.sub(subId);
  if (!s || !s.live) throw new Error('That is an example subscriber, not a real studio.');
  const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
  await liveCall('setStudioLimits', { id: s.liveId, studios: num(studios), seats: num(seats) });
  await liveLoadTenants();
}

/* One partner's businesses, month by month. The SAME function the portal
   reads through my_commission_summary, so an operator and a partner
   looking at the same account see the same figures. Cached on DB rather
   than fetched on every render, because a detail view re-renders on every
   keystroke in a search box above it. */
async function liveLoadPartnerCommission(partnerId) {
  const out = await liveCall('partnerCommission', { id: partnerId });
  DB.partnerCommission = DB.partnerCommission || {};
  DB.partnerCommission[partnerId] = (out.referrals || []).map(function (r) {
    return {
      id: r.referral_id, business: r.business_name || '', plan: r.plan || '',
      cycle: r.cycle || '', subscribedOn: r.subscribed_on || '', lapsedOn: r.lapsed_on || '',
      active: !!r.is_active, ratePct: Number(r.rate_pct) || 0,
      monthsCredited: Number(r.months_credited) || 0,
      termEndsOn: r.term_ends_on || '',
      earned: Number(r.earned_total) || 0,
      cleared: Number(r.earned_cleared) || 0,
      paid: Number(r.earned_paid) || 0
    };
  });
  return DB.partnerCommission[partnerId];
}

async function liveRecordPayment(subId, amount, method, reference, note) {
  const s = Q.sub(subId);
  if (!s || !s.live) throw new Error('That is an example subscriber, not a real studio.');
  await liveCall('recordPayment', {
    id: s.liveId, amount: Number(amount), method: method, reference: reference, note: note
  });
  await liveLoadPayments();
  await liveLoadBilling();
}

/* =================== WEBSITE ENQUIRIES ===================
   The four public forms post to Netlify (unchanged) and to the database.
   This reads the database copy, so the console can see and work every
   enquiry instead of somebody remembering to open Netlify's dashboard. */
async function liveLoadEnquiries() {
  if (!LIVE.on()) return false;
  try {
    const out = await liveCall('enquiries');
    /* Not merged with example rows the way subscribers are. An enquiry is a
       real person who really wrote to us; a made-up one sitting beside them
       is somebody a support agent might genuinely try to ring. When we are
       connected, this list is exactly what arrived and nothing else. */
    DB.enquiries = (out.enquiries || []).map(function (r) {
      return {
        id: r.id, live: true, liveId: r.id,
        at: r.at, kind: r.kind, name: r.name || '', email: r.email || '',
        phone: r.phone || '', business: r.business || '', message: r.message || '',
        source_page: r.source_page || '', extra: r.extra || {},
        state: r.state || 'new', handled_by: r.handled_by || '',
        handled_at: r.handled_at || '', notes: r.notes || ''
      };
    });
    return true;
  } catch (e) {
    LIVE.error = LIVE.error || String(e.message || e);
    return false;
  }
}

async function liveSetEnquiryState(id, state, notes) {
  await liveCall('setEnquiryState', { id: id, value: state, notes: notes });
  await liveLoadEnquiries();
}

/* Called from the detail panel. Reloads and re-renders so the row and the
   sidebar count move together. */
async function enquiryState(id, state) {
  if (!LIVE.on()) { toast('Not connected to the live site.'); return; }
  try {
    await liveSetEnquiryState(id, state);
    toast('Marked ' + state);
    render();
  } catch (e) {
    toast(String(e.message || e));
  }
}

/* ---------------- invitations -----------------------------------------
   The only way an account is created anywhere. Before this, every studio,
   partner and colleague was made by hand in the Supabase dashboard with a
   password somebody invented and then sent them in a message.

   Nobody is ever sent a password. The gateway asks Supabase to email an
   invitation and they set their own, so a credential never passes through an
   operator, a chat, or a screenshot.

   Each of these is a thin wrapper on purpose. Everything that decides whether
   the caller is allowed to do it, and the order the records have to be written
   in, lives server side in admin-api where a browser cannot reach it. */

async function liveInviteOperator(email, name, role) {
  return await liveCall('inviteOperator', { email: email, name: name, role: role });
}

/* `cohort` is which intake the studio is coming in with, e.g. october-2026 for
   an early access tester. Empty for a normal invitation. It is set at the
   gateway and nowhere else, so a studio invited straight from here and one
   accepted from a website enquiry both land in the same column and the count
   of places taken is one query rather than two lists kept in step by hand. */
async function liveInviteStudio(email, businessName, enquiryId, cohort) {
  return await liveCall('inviteStudio', {
    email: email, businessName: businessName, enquiryId: enquiryId || '',
    cohort: cohort || ''
  });
}

/* The cohort is a date, so it cannot be a constant that goes stale: October
   2026 is the first one and there will be others. Kept here rather than in
   each caller so the console never has two spellings of the same intake. */
var COHORT = { key: 'october-2026', label: 'October early access', places: 8 };

/* How many places are gone. Counted from the studios themselves rather than
   from the enquiry list, because most of the first group are invited directly
   and never fill in a form. Everything the console shows about this number
   reads it from here. */
function cohortTaken(key) {
  return (DB.subscribers || []).filter(function (s) { return s.cohort === (key || COHORT.key); }).length;
}
function cohortLeft(key) {
  return Math.max(0, COHORT.places - cohortTaken(key));
}

/* Invite a studio Kayode already knows straight into the cohort, with no
   enquiry behind it. This is the primary path for October: recruiting takes
   longer than building a form, and the studios worth having are ones he can
   name today. */
async function inviteIntoCohort() {
  if (!LIVE.on()) { toast('Not connected to the live site.'); return; }
  if (cohortLeft() <= 0) {
    toast('All ' + COHORT.places + ' places are taken. Raise the number in COHORT first if that is deliberate.');
    return;
  }
  var named = (prompt('Studio name\n\nWhat the business is called.') || '').trim();
  if (!named) return;
  var email = (prompt('Owner email for ' + named + '\n\nThe invitation goes here. They set their own password.') || '')
    .trim().toLowerCase();
  if (!email) return;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('That does not look like an email address.'); return; }
  if (!confirm('Invite ' + named + ' into ' + COHORT.label + '?\n\n'
    + 'This takes place ' + (cohortTaken() + 1) + ' of ' + COHORT.places + ' and emails '
    + email + ' an invitation.')) return;
  try {
    await liveInviteStudio(email, named, '', COHORT.key);
    await liveLoadTenants();
    toast('Invitation sent to ' + email);
    render();
  } catch (err) {
    toast(String(err.message || err));
  }
}

/* No tier. Every partner earns the same 8% of what each business they
   bring actually pays, so there was nothing for the argument to carry
   and a caller passing one would have been passing a preference the
   programme does not have. */
async function liveInvitePartner(email, name, code, enquiryId) {
  return await liveCall('invitePartner', {
    email: email, name: name, code: code,
    enquiryId: enquiryId || ''
  });
}

/* Approving an enquiry is one act: the account is created and the enquiry is
   marked converted in the same server call, so a half-failure cannot leave a
   studio with a login and an enquiry still sitting in the new pile. */
async function approveEnquiry(id) {
  if (!LIVE.on()) { toast('Not connected to the live site.'); return; }
  const e = (DB.enquiries || []).find(x => String(x.id) === String(id));
  if (!e) { toast('That enquiry is no longer here.'); return; }
  if (!e.email) { toast('That enquiry left no email address, so there is nobody to invite.'); return; }

  const isPartner = e.kind === 'partner' || e.kind === 'referral';
  const what = isPartner ? 'partner' : 'studio';
  const named = (e.business || e.name || '').trim();
  if (!named) { toast('That enquiry left no name, so there is nothing to call the ' + what + '.'); return; }

  /* A referral code has to be unique and is a decision, not a default, so it is
     asked for rather than invented from a name that two partners might share. */
  let code = '';
  if (isPartner) {
    code = (prompt('Referral code for ' + named + '\n\nLetters, numbers and hyphens. This is what they share.',
      named.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20)) || '').trim();
    if (!code) return;
  }

  /* An early access enquiry accepted from here takes one of the places, so it
     is the same act as inviting somebody directly and goes in with the same
     cohort. The cap is checked before the confirm rather than after it, so
     nobody is asked to agree to something that is about to be refused. */
  var intoCohort = e.kind === 'earlyaccess';
  if (intoCohort && cohortLeft() <= 0) {
    toast('All ' + COHORT.places + ' places are taken. Move them to the November list instead.');
    return;
  }

  if (!confirm('Create a ' + what + ' account for ' + named + ' and email an invitation to '
    + e.email + '?'
    + (intoCohort ? '\n\nThis takes place ' + (cohortTaken() + 1) + ' of ' + COHORT.places
        + ' in ' + COHORT.label + '.' : '')
    + '\n\nThey set their own password. Nothing is sent to you.')) return;

  try {
    if (isPartner) await liveInvitePartner(e.email, named, code, e.id);
    else await liveInviteStudio(e.email, named, e.id, intoCohort ? COHORT.key : '');
    await liveLoadEnquiries();
    /* The places-left figure is counted from the studios, so it does not move
       until the tenant list is read again. Without this the operator accepts
       somebody and the counter beside them still says the old number. */
    if (intoCohort) await liveLoadTenants();
    toast('Invitation sent to ' + e.email);
    render();
  } catch (err) {
    /* The gateway says plainly when an address already has an account, because
       that is a decision for a person rather than something to retry. */
    toast(String(err.message || err));
  }
}

/* ---------------- partners --------------------------------------------
   Read through the gateway like everything else, because a partner row is
   readable by that partner and nobody else. An operator is not a partner, so
   row level security correctly refuses them, and admin-api is the one audited
   place that goes around it.

   An invited partner who has not claimed their account yet has no user_id and
   is carried on pending_email instead. They are shown, because "did that
   invitation ever go out" is the first thing anybody asks and a list that hides
   them cannot answer it. */
async function liveLoadPartners() {
  try {
    /* platform_partner_summary now, not a select on the table, so the
       money arrives with the name rather than in a second call that could
       be a render behind it. The figures are the ledger's, not worked out
       here: the same function the portal reads through
       my_commission_summary is what the console opens for one partner. */
    const out = await liveCall('partners');
    DB.partners = (out.partners || []).map(function (p) {
      return {
        id: p.id, code: p.code || '', name: p.name || '',
        business: p.business_name || '', email: p.email || p.pending_email || '',
        phone: p.phone || '', city: p.city || '',
        status: p.status || 'active',
        joined: p.joined_on || '',
        claimed: !!p.user_id,
        pending: !p.user_id && !!p.pending_email,
        ratePct: Number(p.rate_pct) || 0,
        referrals: Number(p.referrals) || 0,
        referralsPaying: Number(p.referrals_paying) || 0,
        referralsLapsed: Number(p.referrals_lapsed) || 0,
        earned: Number(p.earned_total) || 0,
        pendingAmount: Number(p.pending_amount) || 0,
        owed: Number(p.owed_amount) || 0,
        paid: Number(p.paid_amount) || 0,
        lastPayoutOn: p.last_payout_on || '',
        lastPayoutRef: p.last_payout_ref || '',
        kind: p.kind || 'partner',
        frozen: !!p.payout_frozen,
        frozenReason: p.frozen_reason || ''
      };
    });
    return true;
  } catch (e) {
    LIVE.error = LIVE.error || String(e.message || e);
    return false;
  }
}
