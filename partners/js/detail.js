/* ============================================================
   detail.js — full-page detail views. One renders at a time, so
   nothing can overlap and Back always works.

   No tabs inside a detail view. On a phone, scrolling one short
   page beats hunting through three.
   ============================================================ */

const DETAIL = {};

function backBtn() { return '<button class="back" onclick="goBack()">&larr; Back</button>'; }
function dstat(v, l, tone) { return '<div class="dstat ' + (tone || '') + '"><div class="dv">' + v + '</div><div class="dl">' + l + '</div></div>'; }

/* =================== A BUSINESS YOU REFERRED =================== */
DETAIL.ref = function (id) {
  const r = Q.ref(id);
  if (!r) return backBtn() + '<div class="pnl"><div class="empty">That referral is not here.</div></div>';
  const link = Q.linkFor(r);
  const rows = Q.ledgerFor(r.id);
  const sig = rows.find(x => x.type === 'signup');
  const earned = Q.earnedFor(r.id);

  /* What happened, in order, and what it did to your money. */
  const events = [];
  events.push(['Signed up', fmtD(r.signedUpOn),
    r.addedBy === 'partner' ? 'You set the account up with them' : 'Through your ' + esc(link.label)]);
  if (r.subscribedOn) {
    events.push(['Started paying', fmtD(r.subscribedOn),
      r.planName + ', ' + (r.cycle === 'annual' ? 'annual' : 'monthly') + ' · ' + money(r.firstPayment) + ' first payment']);
    if (sig) {
      events.push(['You earned ' + money(sig.amount), fmtD(sig.date),
        sig.rate + '% as a ' + sig.tier + ' partner']);
      events.push([
        sig.status === 'paid' ? 'Paid to you' : sig.status === 'cleared' ? 'Ready to pay out' : 'On hold',
        fmtD(sig.status === 'paid' ? sig.paidOn : sig.clearsOn),
        sig.status === 'paid' ? 'In payout ' + sig.payoutRef
          : sig.status === 'cleared' ? 'Goes out ' + fmtD(Q.nextPayoutDate())
            : 'Clears ' + fmtD(sig.clearsOn)]);
    }
  } else if (r.stage === 'trial') {
    events.push(['On trial now', fmtD(r.signedUpOn),
      r.trialEndsIn <= 0 ? 'The trial has run out' : plural(r.trialEndsIn, 'day') + ' left to decide']);
  } else {
    events.push(['Has not started', fmtD(r.signedUpOn), 'The account exists but nothing has happened in it']);
  }
  if (r.lapsedOn) events.push(['Stopped paying', fmtD(r.lapsedOn),
    'About ' + Math.round((parseD(r.lapsedOn) - parseD(r.subscribedOn)) / DAY / 30) +
    ' months with us. What you earned stays yours.']);

  const needsPush = r.stage === 'trial' || r.stage === 'signed-up';

  return backBtn() +
    '<div class="dhead"><div class="dav">' + initials(r.business) + '</div>' +
    '<div style="flex:1;min-width:160px"><h2>' + esc(r.business) + '</h2>' +
    '<div class="dmeta">' + esc(r.owner) + ' · ' + esc(r.city) + '</div></div>' +
    '<div>' + statusPill(r.stage) + '</div></div>' +

    '<div class="dstats">' +
    dstat(earned ? money(earned) : '—', 'Earned you', earned ? 'm' : '') +
    dstat(r.plan === 'trial' ? '—' : r.planName, 'Plan') +
    dstat(r.subscribedOn ? ago(r.subscribedOn).replace(' ago', '') : ago(r.signedUpOn).replace(' ago', ''),
      r.subscribedOn ? 'Paying for' : 'Signed up') +
    '</div>' +

    (needsPush
      ? '<div class="pnl"><div class="ph"><div><h3>Worth a nudge</h3></div></div>' +
        '<p class="note">' + (r.stage === 'trial'
          ? 'They are inside the trial. A short message asking how they are getting on is the one thing most likely to turn this into commission.'
          : 'The account exists but they never really started. Offer to sit with them for twenty minutes and set it up properly.') + '</p>' +
        '<button class="btn gold" style="margin-top:12px" onclick="nudge(' + r.id + ')">Message on WhatsApp</button></div>'
      : '') +

    '<div class="pnl"><div class="ph"><div><h3>What happened</h3></div></div>' +
    events.map(e => '<div class="row"><div><b>' + e[0] + '</b><small>' + e[2] + '</small></div>' +
      '<span class="note">' + e[1] + '</span></div>').join('') + '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>The business</h3></div></div>' +
    kv('Owner', esc(r.owner)) +
    kv('City', esc(r.city)) +
    (r.subscribedOn ? kv('Outlets', r.outlets) + kv('People on the board', r.staff) : '') +
    kv('Came in through', esc(link.label) + ' <span class="mono note">' + esc(link.code) + '</span>') +
    kv('Last active', ago(r.lastSeen)) +
    (rows.length > 1
      ? '<div class="sec-t">Also earned</div>' +
        rows.filter(x => x.type !== 'signup').map(x =>
          '<div class="row"><div><b>Milestone bonus</b><small>' + esc(x.note) + '</small></div>' +
          '<b>' + money(x.amount) + '</b></div>').join('')
      : '') +
    '<p class="note" style="margin-top:12px">Commission is a share of a first payment, once per business. This ' +
    'account will not earn you anything further, whatever they go on to spend.</p></div>';
};

/* =================== A PAYOUT =================== */
DETAIL.payout = function (ref) {
  const p = Q.payout(ref);
  if (!p) return backBtn() + '<div class="pnl"><div class="empty">That payout is not here.</div></div>';
  const items = Q.payoutItems(ref);
  const acct = Q.account(p.accountId);

  return backBtn() +
    '<div class="pnl">' +
    '<div class="ph"><div><h3>' + money(p.amount) + '</h3>' +
    '<div class="ph-sub">Sent ' + fmtD(p.paidOn) + ' · ' + p.ref + '</div></div>' +
    '<button class="btn sm" onclick="downloadStatement(\'' + p.ref + '\')">Statement</button></div>' +
    (acct
      ? kv('Into', esc(acct.bankName) + ' · <span class="mono">' + esc(acct.accountNumber) + '</span>')
      : kv('Into', '<span class="note">that account has since been removed</span>')) +
    kv('Bank reference', '<span class="mono">' + p.bankRef + '</span>') +
    '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>What it covered</h3>' +
    '<div class="ph-sub">' + plural(items.length, 'commission') + ' that had cleared</div></div></div>' +
    '<div class="tw"><table><thead><tr><th>What earned it</th><th class="hide-sm">Credited</th>' +
    '<th class="num">Amount</th><th></th></tr></thead><tbody>' +
    items.map(r => '<tr' + (r.refId ? ' class="klik" onclick="openDetail(\'ref\',' + r.refId + ')"' : '') + '>' +
      '<td><div class="t-main">' + (r.type === 'bonus' ? 'Milestone bonus' : esc(r.business)) + '</div>' +
      '<div class="t-sub">' + esc(r.note) + '</div></td>' +
      '<td class="hide-sm">' + fmtD(r.date) + '</td>' +
      '<td class="num"><b>' + money(r.amount) + '</b></td>' +
      '<td class="chev">' + (r.refId ? '&rsaquo;' : '') + '</td></tr>').join('') +
    '<tr><td colspan="2" style="text-align:right;font-weight:600">Total</td>' +
    '<td class="num"><b>' + money(p.amount) + '</b></td><td></td></tr>' +
    '</tbody></table></div></div>';
};

/* =================== AN UPDATE =================== */
DETAIL.update = function (id) {
  const u = Q.update(id);
  if (!u) return backBtn() + '<div class="pnl"><div class="empty">That update is not here.</div></div>';
  markRead(u.id);

  return backBtn() +
    '<div class="pnl">' +
    '<div class="news-m" style="margin-bottom:10px">' + statusPill(u.category) +
    '<span>' + (u.upcoming ? 'Coming up · ' + fmtD(u.date) : fmtD(u.date)) + '</span></div>' +
    '<h2 style="font-size:20px;margin-bottom:12px">' + esc(u.title) + '</h2>' +
    '<p style="font-size:14px;line-height:1.75;color:var(--dim);margin:0">' + esc(u.body) + '</p>' +
    (u.category === 'programme' || u.category === 'payouts'
      ? '<button class="btn gold" style="margin-top:16px" onclick="go(\'account\')">See how you get paid &rsaquo;</button>'
      : u.category === 'event'
        ? '<button class="btn gold" style="margin-top:16px" onclick="messageManager()">Ask your partner manager</button>'
        : '') +
    '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>More updates</h3></div>' +
    '<button class="lnk" onclick="go(\'updates\')">All &rsaquo;</button></div>' +
    DB.updates.filter(x => x.id !== u.id).slice(0, 3).map(o =>
      '<div class="news" onclick="openDetail(\'update\',' + o.id + ')">' +
      '<span class="news-dot' + (Q.isRead(o.id) ? ' read' : '') + '"></span>' +
      '<div style="min-width:0"><div class="news-t">' + esc(o.title) + '</div>' +
      '<div class="news-m">' + statusPill(o.category) + '<span>' + (o.upcoming ? fmtD(o.date) : ago(o.date)) + '</span></div>' +
      '</div></div>').join('') + '</div>';
};
