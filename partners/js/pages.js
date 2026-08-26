/* ============================================================
   pages.js — Home, Earnings, Referrals
   ============================================================ */

const PAGES = {};

/* =================== HOME =================== */
/* Three numbers, the thing to share, and anyone who needs chasing. Nothing
   else earns a place above the fold on a phone. */
PAGES.home = function () {
  const alerts = Q.alerts();
  const main = DB.links.find(l => l.isDefault) || DB.links[0];
  const avail = Q.available(), min = DB.settings.minPayout;

  const nudges = alerts.length
    ? '<div class="pnl"><div class="ph"><div><h3>Worth a message</h3>' +
      '<div class="ph-sub">' + plural(alerts.length, 'person') + ' where a nudge from you still changes it</div></div></div>' +
      alerts.slice(0, 4).map(a => '<div class="row klik" onclick="' + a.go + '">' +
        '<div><b>' + esc(a.title) + '</b><small>' + esc(a.detail) + '</small></div>' +
        '<span class="pill ' + a.tone + '">' + (a.tone === 'red' ? 'Now' : 'Soon') + '</span></div>').join('') +
      (alerts.length > 4
        ? '<button class="lnk" style="margin-top:10px" onclick="setFilter(\'referrals\',\'push\');go(\'referrals\')">' +
          plural(alerts.length - 4, 'more') + ' &rsaquo;</button>'
        : '') +
      '</div>'
    : '';

  return shareHero(main) +

    '<div class="stats lead">' +
    statCard({ label: 'Ready to pay out', value: money(avail), tone: 'money',
      sub: avail >= min ? fmtD(Q.nextPayoutDate()) : 'Under the ' + moneyShort(min) + ' minimum',
      onclick: "setFilter('earnings','payouts');go('earnings')" }) +
    statCard({ label: 'On hold', value: money(Q.pending()), tone: Q.pending() ? 'warn' : '',
      sub: Q.pending() ? 'Clears within ' + DB.settings.holdDays + ' days' : 'Nothing waiting',
      onclick: "setFilter('earnings','pending');go('earnings')" }) +
    statCard({ label: 'Earned all time', value: moneyShort(Q.lifetime()),
      sub: money(Q.paid()) + ' paid to you', onclick: "setFilter('earnings','all');go('earnings')" }) +
    '</div>' +

    nudges +

    '<div class="pnl"><div class="ph"><div><h3>Who you have brought in</h3>' +
    '<div class="ph-sub">' + Q.paying().length + ' of ' + Q.signups() + ' are paying</div></div>' +
    '<button class="lnk" onclick="go(\'referrals\')">See all &rsaquo;</button></div>' +
    refTable(DB.referrals.slice(0, 5)) + '</div>';
};

/* The share card. It sits at the top because handing the link to one more
   person is the only action that moves any of the numbers under it. */
function shareHero(link) {
  return '<div class="hero">' +
    '<div class="hero-t">Your code</div>' +
    '<div class="hero-c">' + esc(link.code) + '</div>' +
    '<div class="hero-a">' +
    '<button class="btn gold" onclick="shareWhatsApp(' + link.id + ')">Send on WhatsApp</button>' +
    '<button class="btn" onclick="copyText(\'' + esc(link.url) + '\',this)">Copy link</button>' +
    '</div></div>';
}

/* One table shape for referrals, reused by Home and the Referrals page so the
   two can never drift apart. Secondary columns fall away under 680px rather
   than the row restacking into a card. */
function refTable(list) {
  if (!list.length) return '<div class="empty">Nobody here yet.</div>';
  return '<div class="tw"><table><thead><tr>' +
    '<th>Business</th><th>Stage</th><th class="hide-sm">Signed up</th>' +
    '<th class="num">Earned you</th><th></th></tr></thead><tbody>' +
    list.map(r => '<tr class="klik" onclick="openDetail(\'ref\',' + r.id + ')">' +
      '<td><div class="t-main">' + esc(r.business) + '</div>' +
      '<div class="t-sub">' + esc(r.owner) + ' · ' + esc(r.city) + '</div></td>' +
      '<td>' + statusPill(r.stage) + '</td>' +
      '<td class="hide-sm">' + ago(r.signedUpOn) + '</td>' +
      '<td class="num">' + (Q.earnedFor(r.id) ? '<b>' + money(Q.earnedFor(r.id)) + '</b>' : '<span class="note">—</span>') + '</td>' +
      '<td class="chev">&rsaquo;</td></tr>').join('') +
    '</tbody></table></div>';
}

/* =================== EARNINGS =================== */
/* Two things live here: what you have been credited, and what has actually
   been sent. They are the same money at two stages of its life, so they are
   two tabs rather than two pages. */
PAGES.earnings = function () {
  const f = UI.filters.earnings;
  if (f === 'payouts') return earningsHead() + payoutsTab();

  const GROUPS = {
    all: () => DB.ledger,
    pending: () => DB.ledger.filter(r => r.status === 'pending'),
    paid: () => DB.ledger.filter(r => r.status === 'paid')
  };
  let list = (GROUPS[f] || GROUPS.all)().slice();
  const q = UI.q.earnings || '';
  if (q) list = list.filter(r => matches(q, [r.business, r.note, r.payoutRef]));

  return earningsHead() +
    '<div class="pnl">' +
    (DB.ledger.length > 12 ? '<div class="bar">' + searchBox('earnings', 'Search a business') + '</div>' : '') +
    (list.length
      ? '<div class="tw"><table><thead><tr><th>What earned it</th><th class="hide-sm">Credited</th>' +
        '<th>Status</th><th class="num">Amount</th></tr></thead><tbody>' +
        list.map(r => '<tr' + (r.refId ? ' class="klik" onclick="openDetail(\'ref\',' + r.refId + ')"' : '') + '>' +
          '<td><div class="t-main">' + (r.type === 'bonus' ? 'Milestone bonus' : esc(r.business)) + '</div>' +
          '<div class="t-sub">' + esc(r.note) + '</div></td>' +
          '<td class="hide-sm">' + fmtD(r.date) + '</td>' +
          '<td>' + statusPill(r.status) +
          (r.status === 'pending' ? '<div class="t-sub">clears ' + fmtDShort(r.clearsOn) + '</div>' : '') + '</td>' +
          '<td class="num"><b>' + money(r.amount) + '</b></td></tr>').join('') +
        '<tr><td colspan="3" style="text-align:right;font-weight:600">Total</td>' +
        '<td class="num"><b>' + money(list.reduce((t, r) => t + r.amount, 0)) + '</b></td></tr>' +
        '</tbody></table></div>'
      : '<div class="empty">Nothing here.<br><span class="note">Commission appears the day a business you referred makes its first payment.</span></div>') +
    '<div class="bar" style="margin:14px 0 0"><span class="spacer"></span>' +
    '<button class="btn sm" onclick="exportEarnings()">Export</button></div>' +
    '</div>';
};

function earningsHead() {
  const f = UI.filters.earnings;
  return '<div class="stats two">' +
    statCard({ label: 'Ready to pay out', value: money(Q.available()), tone: 'money',
      sub: fmtD(Q.nextPayoutDate()) }) +
    statCard({ label: 'Earned all time', value: moneyShort(Q.lifetime()),
      sub: money(Q.paid()) + ' paid to you' }) +
    '</div>' +
    '<div class="tabs">' +
    [['all', 'Everything', DB.ledger.length],
      ['pending', 'On hold', DB.ledger.filter(r => r.status === 'pending').length],
      ['paid', 'Paid', DB.ledger.filter(r => r.status === 'paid').length],
      ['payouts', 'Payouts', DB.payouts.length]]
      .map(t => '<button class="tab' + (f === t[0] ? ' on' : '') + '" onclick="setFilter(\'earnings\',\'' + t[0] + '\')">' +
        t[1] + '<span class="n">' + t[2] + '</span></button>').join('') +
    '</div>';
}

function payoutsTab() {
  const acct = Q.primaryAccount();
  return '<div class="pnl">' +
    '<div class="row"><div><b>Next payout</b><small>' + fmtD(Q.nextPayoutDate()) + ' · in ' +
    plural(Q.daysToPayout(), 'day') + '</small></div><b>' + money(Q.available()) + '</b></div>' +
    '<div class="row"><div><b>Going to</b><small>' +
    (acct ? esc(acct.bankName) + ' · ' + esc(acct.accountNumber) : 'No account yet') + '</small></div>' +
    '<button class="btn sm" onclick="go(\'account\')">Change</button></div>' +

    (DB.payouts.length
      ? '<div class="tw" style="margin-top:6px"><table><thead><tr><th>Payout</th><th class="hide-sm">Items</th>' +
        '<th class="num">Amount</th><th></th></tr></thead><tbody>' +
        DB.payouts.map(p => '<tr class="klik" onclick="openDetail(\'payout\',\'' + p.ref + '\')">' +
          '<td><div class="t-main">' + fmtD(p.paidOn) + '</div><div class="t-sub">' + p.ref + '</div></td>' +
          '<td class="hide-sm">' + p.count + '</td>' +
          '<td class="num"><b>' + money(p.amount) + '</b></td>' +
          '<td class="chev">&rsaquo;</td></tr>').join('') +
        '<tr><td colspan="2" style="text-align:right;font-weight:600">Paid to you</td>' +
        '<td class="num"><b>' + money(Q.paid()) + '</b></td><td></td></tr>' +
        '</tbody></table></div>'
      : '<div class="empty">No payouts yet.<br><span class="note">The first runs on the ' +
        DB.settings.payoutDay + 'th after a commission clears.</span></div>') +
    '</div>';
}

/* =================== REFERRALS =================== */
/* One list. A referral and a business are the same thing at different points
   in its life, so splitting them across two pages only made a partner check
   both to answer one question. */
PAGES.referrals = function () {
  const f = UI.filters.referrals;
  const GROUPS = {
    all: () => DB.referrals,
    subscribed: () => Q.paying(),
    push: () => DB.referrals.filter(r => r.stage === 'trial' || r.stage === 'signed-up'),
    lapsed: () => Q.lapsed()
  };
  let list = (GROUPS[f] || GROUPS.all)().slice();

  const q = UI.q.referrals || '';
  if (q) list = list.filter(r => matches(q, [r.business, r.owner, r.city, r.planName]));

  const earned = list.reduce((t, r) => t + Q.earnedFor(r.id), 0);

  return '<div class="stats two">' +
    statCard({ label: 'Paying you', value: Q.paying().length, tone: 'good',
      sub: 'of ' + plural(Q.signups(), 'signup') }) +
    statCard({ label: 'Earned from them', value: moneyShort(Q.lifetime()), tone: 'money',
      sub: plural(Q.converted().length, 'business', 'businesses') + ' have paid' }) +
    '</div>' +

    tabBar('referrals', [
      { k: 'all', t: 'All', n: DB.referrals.length },
      { k: 'subscribed', t: 'Paying', n: Q.paying().length },
      { k: 'push', t: 'Needs a push', n: GROUPS.push().length },
      { k: 'lapsed', t: 'Stopped', n: Q.lapsed().length }
    ]) +

    '<div class="pnl">' +
    (DB.referrals.length > 12 ? '<div class="bar">' + searchBox('referrals', 'Search a business or owner') + '</div>' : '') +
    refTable(list) +
    (list.length
      ? '<div class="bar" style="margin:14px 0 0"><span class="note">' +
        plural(list.length, 'business', 'businesses') + (earned ? ' · ' + money(earned) + ' earned' : '') + '</span>' +
        '<span class="spacer"></span><button class="btn sm" onclick="exportReferrals()">Export</button></div>'
      : '') +
    '</div>';
};
