/* ============================================================
   core.js — derived stats, router, modal, toast, CSV download

   Deliberately small. A partner opens this on a phone between
   fittings to answer two questions: what am I owed, and who have
   I brought in. Everything that did not serve one of those two
   questions has been taken out.
   ============================================================ */

const UI = {
  page: 'home',
  detail: null,               // {type,id} — when set, the detail view renders
  back: 'home',
  filters: { referrals: 'all', earnings: 'all' },
  q: {},                      // per-page search boxes
  collapsed: {}
};

/* ---------------- month helpers ----------------
   The only time window the portal uses. A date range picker is a desktop
   habit, and nobody standing in a workshop wants one. */
function monthWindow(offset) {
  const t = DB.today;
  const from = new Date(t.getFullYear(), t.getMonth() - (offset || 0), 1);
  const to = new Date(t.getFullYear(), t.getMonth() - (offset || 0) + 1, 0, 23, 59, 59);
  return { from, to };
}
function inMonth(dateLike, offset) {
  if (!dateLike) return false;
  const w = monthWindow(offset); const d = parseD(dateLike);
  return d >= w.from && d <= w.to;
}

/* ---------------- derived stats (single source of truth) ---------------- */
const Q = {
  /* ---- the people you brought in ---- */
  byStage(stage) { return stage && stage !== 'all' ? DB.referrals.filter(r => r.stage === stage) : DB.referrals; },
  converted() { return DB.referrals.filter(r => r.subscribedOn); },
  paying() { return DB.referrals.filter(r => r.stage === 'subscribed'); },
  lapsed() { return DB.referrals.filter(r => r.stage === 'lapsed'); },
  trialing() { return DB.referrals.filter(r => r.stage === 'trial'); },
  stalled() { return DB.referrals.filter(r => r.stage === 'signed-up'); },
  ref(id) { return DB.referrals.find(r => r.id === +id); },
  signups() { return DB.referrals.length; },
  clicks() { return DB.links.reduce((t, l) => t + l.clicks, 0); },

  /* ---- tier ---- */
  tier() { return tierFor(Q.converted().length); },
  next() { return nextTier(Q.converted().length); },
  tierProgress() {
    const cur = Q.tier(), nxt = Q.next(), n = Q.converted().length;
    if (!nxt) return 100;
    return Math.max(4, Math.round((n - cur.min) / (nxt.min - cur.min) * 100));
  },

  /* ---- money ---- */
  ledger(status) { return status && status !== 'all' ? DB.ledger.filter(r => r.status === status) : DB.ledger; },
  lifetime() { return DB.ledger.reduce((t, r) => t + r.amount, 0); },
  paid() { return DB.ledger.filter(r => r.status === 'paid').reduce((t, r) => t + r.amount, 0); },
  available() { return DB.ledger.filter(r => r.status === 'cleared').reduce((t, r) => t + r.amount, 0); },
  pending() { return DB.ledger.filter(r => r.status === 'pending').reduce((t, r) => t + r.amount, 0); },
  bonuses() { return DB.ledger.filter(r => r.type === 'bonus').reduce((t, r) => t + r.amount, 0); },
  earnedIn(offset) { return DB.ledger.filter(r => inMonth(r.date, offset)).reduce((t, r) => t + r.amount, 0); },

  /* what one referred business has earned you. Commission only: a milestone
     bonus happens to land on a referral's date but it was not earned by that
     business, and crediting it there would double-count it in every total. */
  earnedFor(refId) {
    return DB.ledger.filter(r => r.type === 'signup' && r.refId === +refId).reduce((t, r) => t + r.amount, 0);
  },
  ledgerFor(refId) { return DB.ledger.filter(r => r.refId === +refId); },

  /* ---- payouts ---- */
  payout(ref) { return DB.payouts.find(p => p.ref === ref); },
  payoutItems(ref) { return DB.ledger.filter(r => r.payoutRef === ref); },
  lastPayout() { return DB.payouts[0] || null; },
  nextPayoutDate() {
    const t = DB.today;
    let d = new Date(t.getFullYear(), t.getMonth(), DB.settings.payoutDay);
    if (d <= t) d = new Date(t.getFullYear(), t.getMonth() + 1, DB.settings.payoutDay);
    return d;
  },
  daysToPayout() { return Math.max(0, Math.round((Q.nextPayoutDate() - DB.today) / DAY)); },

  /* ---- links, updates, accounts ---- */
  link(id) { return DB.links.find(l => l.id === +id); },
  linkFor(ref) { return Q.link(ref.linkId) || { label: 'Unknown link', code: '' }; },
  update(id) { return DB.updates.find(u => u.id === +id); },
  unreadUpdates() { return DB.updates.filter(u => DB.settings.readUpdates.indexOf(u.id) < 0); },
  isRead(id) { return DB.settings.readUpdates.indexOf(+id) >= 0; },
  account(id) { return DB.accounts.find(a => a.id === +id); },
  primaryAccount() { return DB.accounts.find(a => a.primary) || DB.accounts[0] || null; },

  /* The only list on the home page that asks anything of the partner. A trial
     running out is worth more to them than a figure they already know. */
  alerts() {
    const out = [];
    Q.trialing().filter(r => r.trialEndsIn !== null && r.trialEndsIn <= 4).forEach(r => out.push({
      tone: r.trialEndsIn <= 1 ? 'red' : 'amber',
      title: r.business,
      detail: r.trialEndsIn <= 0 ? 'Trial has run out' : plural(r.trialEndsIn, 'day') + ' left on the trial',
      go: "openDetail('ref'," + r.id + ")"
    }));
    Q.stalled().filter(r => (DB.today - parseD(r.signedUpOn)) / DAY < 21).forEach(r => out.push({
      tone: 'amber',
      title: r.business,
      detail: 'Signed up ' + ago(r.signedUpOn) + ' and has not started',
      go: "openDetail('ref'," + r.id + ")"
    }));
    if (!Q.primaryAccount()) out.push({
      tone: 'red', title: 'No payout account',
      detail: 'Add one or your commission cannot be sent',
      go: "go('account')"
    });
    return out;
  }
};

/* ---------------- router ---------------- */
function go(page) {
  UI.detail = null;
  UI.page = page;
  render();
  scrollTop();
}
function openDetail(type, id) {
  UI.back = UI.page;
  UI.detail = { type: type, id: id };
  render();
  scrollTop();
}
function goBack() {
  UI.detail = null;
  UI.page = UI.back || 'home';
  render();
  scrollTop();
}
/* On a phone the main column is the document itself, so resetting .main alone
   leaves you halfway down the page. */
function scrollTop() {
  const m = document.querySelector('.main');
  if (m) m.scrollTop = 0;
  window.scrollTo(0, 0);
}
function setFilter(page, val) { UI.filters[page] = val; render(); }

/* ---------------- modal ---------------- */
function modal(title, sub, bodyHtml, footHtml) {
  document.getElementById('mask').innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
    '<div class="mh"><div><h3>' + title + '</h3>' + (sub ? '<div class="msub">' + sub + '</div>' : '') + '</div>' +
    '<button class="mx" onclick="closeModal()" aria-label="Close">&times;</button></div>' +
    '<div class="mb">' + bodyHtml + '</div>' +
    (footHtml ? '<div class="mf">' + footHtml + '</div>' : '') +
    '</div>';
  document.getElementById('mask').classList.add('on');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  document.getElementById('mask').classList.remove('on');
  document.getElementById('mask').innerHTML = '';
  document.body.style.overflow = '';
}

/* ---------------- toast ---------------- */
let toastT;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 2600);
}

/* ---------------- download helpers ---------------- */
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
}
function toCsv(rows) {
  return rows.map(r => r.map(c => {
    const s = c === null || c === undefined ? '' : String(c);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
}
function exportCsv(name, header, rows) {
  download(name + '.csv', toCsv([header].concat(rows)), 'text/csv;charset=utf-8');
  toast('Exported ' + name + '.csv');
}

/* ---------------- small render helpers ---------------- */
function statCard(o) {
  return '<div class="st ' + (o.tone || '') + (o.onclick ? ' klik' : '') + '"' +
    (o.onclick ? ' onclick="' + o.onclick + '" role="button" tabindex="0"' : '') + '>' +
    '<div class="sl">' + o.label + '</div>' +
    '<div class="sv">' + o.value + '</div>' +
    (o.sub ? '<div class="sd">' + o.sub + '</div>' : '') + '</div>';
}
function tabBar(page, items) {
  return '<div class="tabs">' + items.map(i =>
    '<button class="tab' + (UI.filters[page] === i.k ? ' on' : '') + '" onclick="setFilter(\'' + page + '\',\'' + i.k + '\')">' +
    i.t + (i.n !== undefined ? '<span class="n">' + i.n + '</span>' : '') + '</button>').join('') + '</div>';
}
function kv(k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }

function statusPill(s) {
  const map = {
    /* earnings */
    pending: ['amber', 'On hold'], cleared: ['blue', 'Ready'], paid: ['green', 'Paid'],
    /* referrals */
    subscribed: ['green', 'Paying'], trial: ['amber', 'On trial'],
    'signed-up': ['grey', 'Not started'], lapsed: ['red', 'Stopped'],
    /* links and accounts */
    active: ['green', 'Active'], paused: ['grey', 'Paused'],
    verified: ['green', 'Verified'], unverified: ['amber', 'Checking'],
    /* updates */
    programme: ['purple', 'Programme'], product: ['blue', 'Product'],
    payouts: ['green', 'Payouts'], event: ['amber', 'Event']
  };
  const m = map[s] || ['grey', s];
  return '<span class="pill ' + m[0] + '">' + m[1] + '</span>';
}
function trend(now, prev) {
  if (!prev && !now) return 'nothing last month either';
  if (!prev) return '<span class="up">new</span>, nothing last month';
  if (!now) return '<span class="down">nothing yet</span> this month';
  const d = pct(now - prev, prev);
  if (d === 0) return 'level with last month';
  return '<span class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '↑' : '↓') + ' ' + Math.abs(d) + '%</span> on last month';
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
