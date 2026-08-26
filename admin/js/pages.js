/* ============================================================
   pages.js — list/dashboard renderers for every nav item
   ============================================================ */

const PAGES = {};

/* =================== OVERVIEW =================== */
PAGES.dashboard = function () {
  const subs = Q.subsAsOf(), act = Q.active(), nw = Q.newSubs();
  const mrr = Q.mrr(), rev = Q.revenue(), split = Q.planSplit();
  const openT = Q.openTickets(), urg = Q.urgentTickets();

  /* Four cards. Revenue and open support are not cards because both numbers
     already read on the panels below them. */
  const stats = [
    statCard({ label: 'Total subscribers', value: subs.length, tone: 'money', onclick: "drill('subs.total')",
      sub: (nw.length ? '<span class="up">↑ ' + nw.length + '</span> joined ' + PERIOD.label.toLowerCase()
        : '<span class="note">none joined ' + PERIOD.label.toLowerCase() + '</span>') }),
    statCard({ label: 'Active subscribers', value: act.length, tone: 'good', onclick: "drill('subs.active')",
      sub: pct(act.length, subs.length) + '% of all · ' + Q.trial().length + ' on trial' }),
    statCard({ label: 'MRR', value: moneyShort(mrr), tone: 'money', onclick: "drill('mrr')",
      sub: 'ARR ' + moneyShort(Q.arr()) + ' · ARPU ' + moneyShort(Q.arpu()) }),
    statCard({ label: 'Renewals due (7d)', value: Q.renewing().length, tone: Q.pastDue().length ? 'bad' : 'warn',
      onclick: "drill('subs.renewals')",
      sub: (Q.pastDue().length ? '<span class="down">' + Q.pastDue().length + ' past due</span> · ' : '') +
        moneyShort(Q.renewing().reduce((t, s) => t + s.mrr, 0)) + ' at stake' })
  ].join('');

  const revSeries = Q.revenueSeries();

  const donutSegs = split.filter(s => s.count).map(s => ({
    label: s.name, value: s.count,
    color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)', trial: 'var(--blue)' }[s.id],
    onclick: "UI.planFilter='" + s.id + "';UI.filters.subscribers='all';go('subscribers')"
  }));

  const recent = DB.subscribers.slice().sort((a, b) => b.joined.localeCompare(a.joined)).slice(0, 6);

  const alerts = []
    .concat(Q.pastDue().slice(0, 2).map(s => {
      const ovd = DB.payments.filter(p => p.subId === s.id && p.status === 'overdue').sort((a, b) => a.date.localeCompare(b.date))[0];
      return { t: 'Payment failed', d: s.name + ' · ' + money(s.mrr) + ' unpaid', when: ovd ? ago(ovd.date) : 'this cycle', go: "openDetail('sub'," + s.id + ")" };
    }))
    .concat(Q.trial().filter(s => s.renewIn <= 4).slice(0, 2).map(s =>
      ({ t: 'Trial ending', d: s.name, when: s.renewIn <= 0 ? 'today' : 'in ' + s.renewIn + ' days', go: "openDetail('sub'," + s.id + ")" })))
    .concat(recent.slice(0, 2).map(s => ({ t: 'New subscriber', d: s.name, when: ago(s.joined), go: "openDetail('sub'," + s.id + ")" })))
    .slice(0, 6);

  return periodBar() +
    '<div class="stats">' + stats + '</div>' +
    '<div class="cols"><div>' +

    '<div class="pnl"><div class="ph"><div><h3>Revenue overview</h3>' +
    '<div class="ph-sub"><b style="color:var(--gold)">' + money(rev) + '</b> collected · ' + PERIOD.label +
    ' · ' + trend(rev, Q.revenuePrev()) + '</div></div>' +
    '<button class="lnk" onclick="drill(\'revenue\')">See the payments &rsaquo;</button></div>' +
    areaChart(revSeries, { money: true, color: 'var(--gold)', height: 210 }) + '</div>' +

    '<div class="pnl"><div class="ph"><h3>Recent subscribers</h3>' +
    '<button class="lnk" onclick="go(\'subscribers\')">View all</button></div>' +
    '<div class="tw"><table><thead><tr><th>Business</th><th>Plan</th><th>Status</th><th>Joined</th><th class="num">MRR</th><th></th></tr></thead><tbody>' +
    recent.map(s => '<tr class="klik" onclick="openDetail(\'sub\',' + s.id + ')">' +
      '<td><div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + esc(s.owner) + '</div></td>' +
      '<td><span class="tier">' + s.planName + '</span></td>' +
      '<td>' + statusPill(s.status) + '</td>' +
      '<td>' + fmtD(s.joined) + '</td>' +
      '<td class="num">' + (s.mrr ? money(s.mrr) : '—') + '</td>' +
      '<td class="chev">&rsaquo;</td></tr>').join('') +
    '</tbody></table></div></div>' +

    '</div><div>' +

    '<div class="pnl"><div class="ph"><h3>Subscribers by plan</h3></div>' +
    donut(donutSegs, subs.length, 'Total') +
    '<button class="btn" style="width:100%;margin-top:14px" onclick="go(\'subscribers\')">View all subscribers &rarr;</button></div>' +

    '<div class="pnl"><div class="ph"><h3>Alerts</h3><button class="lnk" onclick="openAlerts()">View all</button></div>' +
    (alerts.length ? alerts.map(a => '<div class="row klik" onclick="' + a.go + '">' +
      '<div><b>' + a.t + '</b><small>' + esc(a.d) + '</small></div>' +
      '<span class="note">' + a.when + '</span></div>').join('') : '<div class="empty">Nothing needs you right now.</div>') +
    '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>Support</h3>' +
    '<div class="ph-sub">' + openT.length + ' open' + (urg.length ? ' · <span style="color:var(--red)">' + urg.length + ' urgent</span>' : '') + '</div></div>' +
    '<button class="lnk" onclick="drill(\'tickets.open\')">Breakdown &rsaquo;</button></div>' +
    Q.openTickets().slice(0, 4).map(t => '<div class="row klik" onclick="openDetail(\'ticket\',' + t.id + ')">' +
      '<div><b>' + esc(t.title) + '</b><small>' + esc(t.subscriber) + '</small></div>' +
      statusPill(t.state) + '</div>').join('') +
    '<button class="btn" style="width:100%;margin-top:12px" onclick="go(\'support\')">Go to support centre &rarr;</button></div>' +

    '<div class="pnl"><div class="ph"><h3>Recent activity</h3><button class="lnk" onclick="go(\'activity\')">View all</button></div>' +
    DB.activity.slice(0, 6).map(a => '<div class="row klik" onclick="openDetail(\'audit\',' + a.id + ')">' +
      '<div><b>' + a.action + '</b><small>' + esc(a.detail.slice(0, 46)) + '</small></div>' +
      '<span class="note">' + ago(a.at) + '</span></div>').join('') + '</div>' +

    '</div></div>';
};

/* =================== SUBSCRIBERS =================== */
PAGES.subscribers = function () {
  const f = UI.filters.subscribers;
  const all = Q.subsAsOf();
  const buckets = {
    all: all,
    active: all.filter(s => s.status === 'active'),
    trial: all.filter(s => s.status === 'trial'),
    expired: all.filter(s => s.status === 'expired'),
    renewing: all.filter(s => s.status === 'active' && s.renewIn >= 0 && s.renewIn <= 7),
    pastdue: all.filter(s => s.pastDue),
    premium: all.filter(s => s.plan === 'premium'),
    pro: all.filter(s => s.plan === 'pro'),
    starter: all.filter(s => s.plan === 'starter')
  };
  let list = (buckets[f] || all).slice();

  /* plan is a dropdown, not three more tabs */
  if (UI.planFilter && UI.planFilter !== 'any') list = list.filter(s => s.plan === UI.planFilter);

  const q = UI.q.subscribers || UI.search;
  if (q) list = list.filter(s => matches(q, [s.name, s.owner, s.email, s.city, s.phone, s.planName]));

  const sort = UI.sort.subscribers;
  const tierRank = { premium: 0, pro: 1, starter: 2, trial: 3 };
  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    'name-desc': (a, b) => b.name.localeCompare(a.name),
    tier: (a, b) => tierRank[a.plan] - tierRank[b.plan] || b.mrr - a.mrr,
    'tier-asc': (a, b) => tierRank[b.plan] - tierRank[a.plan],
    'mrr-desc': (a, b) => b.mrr - a.mrr,
    'mrr-asc': (a, b) => a.mrr - b.mrr,
    newest: (a, b) => b.joined.localeCompare(a.joined),
    oldest: (a, b) => a.joined.localeCompare(b.joined),
    renewal: (a, b) => a.renewIn - b.renewIn,
    users: (a, b) => b.users - a.users,
    referrals: (a, b) => b.referralEarned - a.referralEarned,
    active: (a, b) => b.lastSeen.localeCompare(a.lastSeen),
    health: (a, b) => ['at-risk', 'onboarding', 'steady', 'healthy', 'churned'].indexOf(a.health) - ['at-risk', 'onboarding', 'steady', 'healthy', 'churned'].indexOf(b.health)
  };
  list.sort(sorters[sort] || sorters.name);

  const planSel = UI.planFilter || 'any';

  return periodBar() +
    '<div class="stats">' +
    statCard({ label: 'All subscribers', value: all.length, tone: 'money', onclick: "drill('subs.total')", sub: Q.newSubs().length + ' joined ' + PERIOD.label.toLowerCase() }) +
    statCard({ label: 'Active', value: buckets.active.length, tone: 'good', onclick: "drill('subs.active')", sub: moneyShort(Q.mrr()) + ' MRR' }) +
    statCard({ label: 'On trial', value: buckets.trial.length, tone: 'info', onclick: "drill('subs.trial')", sub: buckets.trial.filter(s => s.renewIn <= 3).length + ' ending within 3 days' }) +
    statCard({ label: 'Needs attention', value: buckets.pastdue.length + buckets.renewing.length, tone: buckets.pastdue.length ? 'bad' : 'warn', onclick: "drill('subs.pastdue')", sub: buckets.pastdue.length + ' past due · ' + buckets.renewing.length + ' renewing' }) +
    '</div>' +

    '<div class="bar">' +
    tabBar('subscribers', [
      { k: 'all', t: 'All', n: buckets.all.length },
      { k: 'active', t: 'Active', n: buckets.active.length },
      { k: 'trial', t: 'Trial', n: buckets.trial.length },
      { k: 'renewing', t: 'Renewing soon', n: buckets.renewing.length },
      { k: 'pastdue', t: 'Past due', n: buckets.pastdue.length },
      { k: 'expired', t: 'Expired', n: buckets.expired.length }
    ]) +
    '<span class="spacer"></span>' +
    '<select class="sel" onchange="UI.planFilter=this.value;render()">' +
    [['any', 'Any plan'], ['premium', 'Premium'], ['pro', 'Pro'], ['starter', 'Starter'], ['trial', 'Trial']]
      .map(o => '<option value="' + o[0] + '"' + (planSel === o[0] ? ' selected' : '') + '>' +
        (o[0] === 'any' ? 'Plan: any' : 'Plan: ' + o[1]) + '</option>').join('') +
    '</select>' +
    '<select class="sel" onchange="UI.sort.subscribers=this.value;render()">' +
    [['name', 'Name A–Z'], ['name-desc', 'Name Z–A'], ['tier', 'Tier (Premium first)'], ['tier-asc', 'Tier (Starter first)'],
     ['mrr-desc', 'MRR high → low'], ['mrr-asc', 'MRR low → high'], ['newest', 'Newest first'], ['oldest', 'Longest standing'],
     ['renewal', 'Renewal date'], ['users', 'Most users'], ['referrals', 'Top referrers'], ['active', 'Recently active'],
     ['health', 'Health (at risk first)']]
      .map(o => '<option value="' + o[0] + '"' + (sort === o[0] ? ' selected' : '') + '>Sort: ' + o[1] + '</option>').join('') +
    '</select>' +
    '<button class="btn" onclick="exportSubscribers()">Export CSV</button>' +
    '<button class="btn gold" onclick="formAddSubscriber()">+ Add subscriber</button>' +
    '</div>' +
    '<div class="bar">' + searchBox('subscribers', 'Search business, owner, email, city…') + '</div>' +

    /* The directory collapses, so the panels under it are reachable without
       scrolling 128 rows on a phone. */
    section('subs-dir', 'Subscriber directory',
      list.length + ' of ' + all.length + ' shown' +
      (planSel !== 'any' ? ' · ' + planById(planSel).name + ' only' : '') +
      ' · health, seats and referrals are on each profile',
      (list.length ? '<div class="tw"><table><thead><tr>' +
        '<th>Business</th><th>Plan</th><th>Status</th><th>Joined</th><th>Renews</th><th class="num">MRR</th><th></th></tr></thead><tbody>' +
        list.map(s => '<tr class="klik" onclick="openDetail(\'sub\',' + s.id + ')">' +
          '<td><div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + esc(s.owner) + ' · ' + esc(s.city) + '</div></td>' +
          '<td><span class="tier">' + s.planName + '</span></td>' +
          '<td>' + statusPill(s.status) + (s.pastDue ? ' <span class="pill red">Past due</span>' : '') + '</td>' +
          '<td>' + fmtD(s.joined) + '</td>' +
          '<td>' + (s.status === 'expired' ? '<span class="note">—</span>' :
            (s.renewIn <= 7 ? '<span class="pill amber">' + (s.renewIn <= 0 ? 'due' : s.renewIn + 'd') + '</span>' : fmtDShort(s.renewsOn))) + '</td>' +
          '<td class="num">' + (s.mrr ? money(s.mrr) : '—') + '</td>' +
          '<td class="chev">&rsaquo;</td></tr>').join('') +
        '</tbody></table></div>'
        : '<div class="empty">No subscribers match this filter.</div>')) +

    /* Moved here from Revenue — it is a list of accounts, so it belongs with
       the accounts. */
    section('subs-top', 'Top accounts by MRR',
      'The ten accounts carrying the most recurring revenue',
      '<div class="tw"><table><thead><tr><th>Business</th><th>Plan</th><th>Since</th>' +
      '<th class="num">MRR</th><th class="num">Lifetime</th><th></th></tr></thead><tbody>' +
      Q.active().slice().sort((a, b) => b.mrr - a.mrr).slice(0, 10).map(s => {
        const lifetime = DB.payments.filter(p => p.subId === s.id && p.status === 'successful').reduce((t, p) => t + p.amount, 0);
        return '<tr class="klik" onclick="openDetail(\'sub\',' + s.id + ')">' +
          '<td class="t-main">' + esc(s.name) + '</td><td><span class="tier">' + s.planName + '</span></td>' +
          '<td>' + fmtD(s.joined) + '</td><td class="num">' + money(s.mrr) + '</td>' +
          '<td class="num">' + money(lifetime) + '</td><td class="chev">&rsaquo;</td></tr>';
      }).join('') + '</tbody></table></div>', true);
};

/* =================== ONBOARDING =================== */
PAGES.onboarding = function () {
  const f = UI.filters.onboarding;
  const all = DB.onboarding;
  const buckets = {
    all: all, new: all.filter(o => o.state === 'new'),
    setup: all.filter(o => o.state === 'setup'), ready: all.filter(o => o.state === 'ready'),
    ending: all.filter(o => o.trialEndsIn <= 3)
  };
  const list = buckets[f] || all;
  const activatedThisPeriod = DB.subscribers.filter(s => s.status === 'active' && inPeriod(s.joined)).length;
  const avgDays = 2.4;

  return periodBar() +
    '<div class="stats">' +
    statCard({ label: 'In pipeline', value: all.length, tone: 'info', onclick: "setFilter('onboarding','all')", sub: 'Trials not yet converted' }) +
    statCard({ label: 'Not started', value: buckets.new.length, tone: 'warn', onclick: "drill('onb.stage:new')", sub: 'Account created, nothing set up' }) +
    statCard({ label: 'Setting up', value: buckets.setup.length, tone: 'info', onclick: "drill('onb.stage:setup')", sub: 'Partway through the checklist' }) +
    statCard({ label: 'Ready to convert', value: buckets.ready.length, tone: 'good', onclick: "drill('onb.stage:ready')", sub: 'Checklist complete' }) +
    statCard({ label: 'Activated', value: activatedThisPeriod, tone: 'good', sub: PERIOD.label + ' · trial → paid' }) +
    statCard({ label: 'Avg time to live', value: avgDays + 'd', tone: 'money', sub: '<span class="up">↓ 0.7d</span> vs previous period' }) +
    '</div>' +

    '<div class="bar">' + tabBar('onboarding', [
      { k: 'all', t: 'All', n: all.length }, { k: 'new', t: 'Not started', n: buckets.new.length },
      { k: 'setup', t: 'Setting up', n: buckets.setup.length }, { k: 'ready', t: 'Ready', n: buckets.ready.length },
      { k: 'ending', t: 'Trial ending', n: buckets.ending.length }
    ]) + '<span class="spacer"></span><button class="btn" onclick="exportOnboarding()">Export CSV</button></div>' +

    (list.length ? '<div class="cards">' + list.map(o =>
      '<div class="card" onclick="openDetail(\'onb\',' + o.id + ')">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' + statusPill(o.state) +
      (o.trialEndsIn <= 3 ? '<span class="pill red">Trial ends ' + (o.trialEndsIn <= 0 ? 'today' : 'in ' + o.trialEndsIn + 'd') + '</span>' : '') + '</div>' +
      '<h4>' + esc(o.name) + '</h4>' +
      '<p>' + esc(o.owner) + ' · ' + esc(o.city) + ' · via ' + esc(o.channel) + '</p>' +
      '<div class="prog"><i style="width:' + o.progress + '%"></i></div>' +
      '<div class="meta"><span>' + o.step + ' of 6 steps · ' + o.progress + '%</span><span>' + ago(o.lastTouch) + '</span></div>' +
      '</div>').join('') + '</div>'
      : '<div class="pnl"><div class="empty">Nothing in this stage.</div></div>');
};

/* =================== PLANS & BILLING =================== */
PAGES.billing = function () {
  const split = Q.planSplit();
  const subs = Q.subsAsOf();
  const annual = subs.filter(s => s.cycle === 'annual').length;

  return periodBar() +
    '<div class="stats">' +
    split.map(p => statCard({
      label: p.name, value: p.count, tone: p.id === 'trial' ? 'info' : 'money',
      onclick: "UI.planFilter='" + p.id + "';UI.filters.subscribers='all';go('subscribers')",
      sub: p.share + '% of base · ' + (p.mrr ? moneyShort(p.mrr) + ' MRR' : 'no MRR')
    })).join('') +
    statCard({ label: 'Blended ARPU', value: moneyShort(Q.arpu()), tone: 'money', onclick: "drill('arpu')", sub: pct(annual, subs.length) + '% on annual billing' }) +
    '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>Plans &amp; pricing</h3>' +
    '<div class="ph-sub">Tap a plan to edit its price, seats or features</div></div>' +
    '<button class="btn gold" onclick="formPlan()">+ Create plan</button></div>' +
    '<div class="tw"><table><thead><tr><th>Plan</th><th class="num">Monthly</th><th class="num">Annual</th>' +
    '<th class="num">Seats</th><th class="num">Subscribers</th><th class="num">MRR</th><th>Status</th><th></th></tr></thead><tbody>' +
    DB.plans.map(p => {
      const s = split.find(x => x.id === p.id);
      return '<tr class="klik" onclick="formPlan(\'' + p.id + '\')">' +
        '<td><div class="t-main">' + p.name + '</div><div class="t-sub">' + p.features[0] + '</div></td>' +
        '<td class="num">' + (p.monthly ? money(p.monthly) : '—') + '</td>' +
        '<td class="num">' + (p.annual ? money(p.annual) : '—') + '</td>' +
        '<td class="num">' + p.seats + '</td>' +
        '<td class="num">' + s.count + '</td>' +
        '<td class="num">' + (s.mrr ? money(s.mrr) : '—') + '</td>' +
        '<td>' + statusPill(p.live ? 'active' : 'draft') + '</td>' +
        '<td class="chev">&rsaquo;</td></tr>';
    }).join('') + '</tbody></table></div></div>' +

    '<div class="pnl"><div class="ph"><div><h3>MRR by plan</h3>' +
    '<div class="ph-sub">Where the recurring revenue actually sits</div></div></div>' +
    hBars(split.filter(s => s.mrr).map(s => ({
      label: s.name, value: s.mrr,
      color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)' }[s.id] || 'var(--blue)',
      onclick: "UI.planFilter='" + s.id + "';UI.filters.subscribers='all';go('subscribers')"
    })), { money: true }) + '</div>' +

    /* Referral programme gets the full width, same as Plans & pricing above it. */
    referralPanel();
};

/* The referral programme, laid out properly rather than squeezed into a corner. */
function referralPanel() {
  const referrers = DB.subscribers.filter(s => s.referralConverted > 0)
    .sort((a, b) => b.referralEarned - a.referralEarned);
  const earned = Q.refCommissionTotal();
  const paid = DB.subscribers.reduce((t, s) => t + s.referralPaid, 0);
  const pending = DB.subscribers.reduce((t, s) => t + s.referralPending, 0);
  const converted = DB.subscribers.reduce((t, s) => t + s.referralConverted, 0);
  const invited = DB.subscribers.reduce((t, s) => t + s.referrals.length, 0);
  const mrrFromRef = DB.subscribers.filter(s => s.referredBy && s.status === 'active').reduce((t, s) => t + s.mrr, 0);

  return '<div class="pnl"><div class="ph"><div><h3>Referral programme</h3>' +
    '<div class="ph-sub">Subscribers earn ' + DB.settings.referralPct +
    '% of a referred account\'s first month, credited 31 days after that account converts</div></div>' +
    '<button class="btn" onclick="editSetting(\'referralPct\',\'Referral commission %\',\'number\')">Change rate</button></div>' +

    '<div class="stats" style="margin-bottom:16px">' +
    statCard({ label: 'Accounts referred', value: invited, tone: 'info',
      sub: converted + ' converted to paid · ' + pct(converted, invited) + '% conversion' }) +
    statCard({ label: 'MRR from referrals', value: moneyShort(mrrFromRef), tone: 'money',
      sub: pct(mrrFromRef, Q.mrr()) + '% of all MRR' }) +
    statCard({ label: 'Commission earned', value: moneyShort(earned), tone: 'money',
      sub: 'Across ' + referrers.length + ' referring subscribers' }) +
    statCard({ label: 'Paid out', value: moneyShort(paid), tone: 'good',
      sub: pct(paid, earned) + '% of what has been earned' }) +
    statCard({ label: 'Outstanding', value: moneyShort(pending), tone: pending ? 'warn' : 'good',
      sub: pending ? 'Still inside the 31-day hold' : 'Nothing owing' }) +
    '</div>' +

    '<div class="ph"><div><h3 style="font-size:13px">Top referrers</h3>' +
    '<div class="ph-sub">Tap anyone to open their referral ledger</div></div>' +
    '<button class="lnk" onclick="drill(\'referrers\')">Full breakdown &rsaquo;</button></div>' +
    (referrers.length
      ? '<div class="tw"><table><thead><tr><th>Subscriber</th><th>Plan</th><th class="num">Referred</th>' +
      '<th class="num">Converted</th><th class="num">Earned</th><th class="num">Paid</th>' +
      '<th class="num">Outstanding</th><th></th></tr></thead><tbody>' +
      referrers.slice(0, 10).map(s => '<tr class="klik" onclick="UI.vtab[\'sub' + s.id + '\']=\'referrals\';openDetail(\'sub\',' + s.id + ')">' +
        '<td><div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + esc(s.owner) + '</div></td>' +
        '<td><span class="tier">' + s.planName + '</span></td>' +
        '<td class="num">' + s.referrals.length + '</td>' +
        '<td class="num">' + s.referralConverted + '</td>' +
        '<td class="num">' + money(s.referralEarned) + '</td>' +
        '<td class="num">' + money(s.referralPaid) + '</td>' +
        '<td class="num"' + (s.referralPending ? ' style="color:var(--amber)"' : '') + '>' +
        (s.referralPending ? money(s.referralPending) : '—') + '</td>' +
        '<td class="chev">&rsaquo;</td></tr>').join('') +
      '<tr><td colspan="2" style="text-align:right;font-weight:600">All ' + referrers.length + ' referrers</td>' +
      '<td class="num"><b>' + invited + '</b></td><td class="num"><b>' + converted + '</b></td>' +
      '<td class="num"><b>' + money(earned) + '</b></td><td class="num"><b>' + money(paid) + '</b></td>' +
      '<td class="num"><b>' + money(pending) + '</b></td><td></td></tr>' +
      '</tbody></table></div>'
      : '<div class="empty">Nobody has referred anyone yet.</div>') + '</div>';
}

/* =================== PAYMENTS =================== */
PAGES.payments = function () {
  const f = UI.filters.payments;
  const inP = DB.payments.filter(p => inPeriod(p.date));

  /* Five groups instead of seven statuses. Failed and overdue are the same job
     (retry the card); pending and upcoming are the same job (nothing, yet).
     The exact status still shows as a pill on every row. */
  const GROUPS = {
    all: () => inP,
    collected: () => inP.filter(p => p.status === 'successful'),
    problems: () => inP.filter(p => p.status === 'failed' || p.status === 'overdue'),
    scheduled: () => inP.filter(p => p.status === 'pending' || p.status === 'upcoming'),
    refunded: () => inP.filter(p => p.status === 'refunded')
  };
  const g = k => GROUPS[k] ? GROUPS[k]() : inP;
  const sum = k => g(k).reduce((t, p) => t + p.amount, 0);

  let list = g(f).slice();
  const q = UI.q.payments || UI.search;
  if (q) list = list.filter(p => matches(q, [p.subscriber, p.ref, p.invoice, p.plan, p.method, p.status]));
  const sorters = {
    'date-desc': (a, b) => b.date.localeCompare(a.date),
    'date-asc': (a, b) => a.date.localeCompare(b.date),
    'amount-desc': (a, b) => b.amount - a.amount,
    'amount-asc': (a, b) => a.amount - b.amount,
    subscriber: (a, b) => a.subscriber.localeCompare(b.subscriber),
    status: (a, b) => a.status.localeCompare(b.status) || b.date.localeCompare(a.date)
  };
  list.sort(sorters[UI.sort.payments || 'date-desc'] || sorters['date-desc']);

  return periodBar() +
    '<div class="stats">' +
    statCard({ label: 'Collected', value: moneyShort(sum('collected')), tone: 'good', onclick: "drill('revenue')", sub: g('collected').length + ' payments · ' + trend(sum('collected'), Q.revenuePrev()) }) +
    statCard({ label: 'Problems', value: moneyShort(sum('problems')), tone: sum('problems') ? 'bad' : 'good', onclick: "drill('pay.problems')", sub: g('problems').length + ' to retry — declines and past due' }) +
    statCard({ label: 'Scheduled', value: moneyShort(sum('scheduled')), tone: 'info', onclick: "drill('pay.scheduled')", sub: g('scheduled').length + ' queued against a card on file' }) +
    statCard({ label: 'Refunded', value: moneyShort(sum('refunded')), tone: 'money', onclick: "drill('pay.refunded')", sub: g('refunded').length + ' sent back' }) +
    '</div>' +

    '<div class="bar">' + tabBar('payments', [
      { k: 'all', t: 'All', n: inP.length },
      { k: 'collected', t: 'Collected', n: g('collected').length },
      { k: 'problems', t: 'Problems', n: g('problems').length },
      { k: 'scheduled', t: 'Scheduled', n: g('scheduled').length },
      { k: 'refunded', t: 'Refunded', n: g('refunded').length }
    ]) + '</div>' +
    '<div class="bar">' + searchBox('payments', 'Search subscriber, reference, invoice…') +
    sortSelect('payments', [['date-desc', 'Newest first'], ['date-asc', 'Oldest first'],
      ['amount-desc', 'Amount high → low'], ['amount-asc', 'Amount low → high'],
      ['subscriber', 'Subscriber A–Z'], ['status', 'Status']]) +
    '<button class="btn" onclick="exportPayments()">Export CSV</button></div>' +

    '<div class="pnl"><div class="ph"><div><h3>Transactions</h3>' +
    '<div class="ph-sub">' + list.length + ' in ' + PERIOD.label.toLowerCase() + '</div></div></div>' +
    (list.length ? '<div class="tw"><table><thead><tr><th>Subscriber</th><th>Reference</th><th>Invoice</th>' +
      '<th class="num">Amount</th><th>Method</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>' +
      list.slice(0, 200).map(p => '<tr class="klik" onclick="openDetail(\'pay\',' + p.id + ')">' +
        '<td><div class="t-main">' + esc(p.subscriber) + '</div><div class="t-sub">' + p.plan + ' · ' + p.cycle + '</div></td>' +
        '<td>' + p.ref + '</td><td>' + p.invoice + '</td>' +
        '<td class="num">' + money(p.amount) + '</td>' +
        '<td>' + p.method + '</td>' +
        '<td>' + statusPill(p.status) + '</td>' +
        '<td>' + fmtD(p.date) + '</td><td class="chev">&rsaquo;</td></tr>').join('') +
      '</tbody></table></div>' + (list.length > 200 ? '<div class="pager"><span>Showing first 200 of ' + list.length + '</span></div>' : '')
      : '<div class="empty">No payments in this period with that status.<br><span class="note">Try widening the period from the picker above.</span></div>') +
    '</div>';
};

/* =================== PAYROLL =================== */
PAGES.payroll = function () {
  const run = Q.currentRun();
  const slips = Q.slipsFor(run.monthKey);
  const paid = slips.filter(s => s.status === 'paid');
  const pending = slips.filter(s => s.status === 'pending');

  return '<div class="bar"><select class="sel" onchange="UI.payMonth=this.value;render()">' +
    DB.payrollRuns.map(r => '<option value="' + r.monthKey + '"' + ((UI.payMonth || DB.payrollRuns[0].monthKey) === r.monthKey ? ' selected' : '') + '>' + r.month + '</option>').join('') +
    '</select>' +
    searchBox('payroll', 'Search staff or department…') +
    sortSelect('payroll', [['net-desc', 'Net pay high → low'], ['net-asc', 'Net pay low → high'],
      ['name', 'Name A–Z'], ['dept', 'Department'], ['status', 'Status (pending first)'],
      ['published', 'Published last']]) +
    '<span class="spacer"></span>' +
    '<button class="btn" onclick="exportPayroll()">Export CSV</button>' +
    '<button class="btn" onclick="formPublishSlips()">Publish payslips</button>' +
    '<button class="btn gold" onclick="formRunPayroll()">Run payroll</button></div>' +
    payrollBody(UI.payMonth || DB.payrollRuns[0].monthKey);
};
function payrollBody(key) {
  const run = Q.runByKey(key);
  const allSlips = Q.slipsFor(key);
  const paid = allSlips.filter(s => s.status === 'paid');
  const pending = allSlips.filter(s => s.status === 'pending');
  const published = allSlips.filter(s => s.uploaded).length;
  const byDept = {};
  allSlips.forEach(s => { byDept[s.dept] = (byDept[s.dept] || 0) + s.net; });

  /* search + sort apply to the rows, never to the run totals — the totals are
     the run, not the view of it. */
  let slips = allSlips.slice();
  const q = UI.q.payroll || '';
  if (q) slips = slips.filter(s => matches(q, [s.staffName, s.dept, s.bank]));
  const sorters = {
    'net-desc': (a, b) => b.net - a.net,
    'net-asc': (a, b) => a.net - b.net,
    name: (a, b) => a.staffName.localeCompare(b.staffName),
    dept: (a, b) => a.dept.localeCompare(b.dept) || b.net - a.net,
    status: (a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.net - a.net,
    published: (a, b) => (a.uploaded ? 1 : 0) - (b.uploaded ? 1 : 0) || a.staffName.localeCompare(b.staffName)
  };
  slips.sort(sorters[UI.sort.payroll || 'net-desc'] || sorters['net-desc']);

  return '<div class="stats">' +
    statCard({ label: 'Gross payroll', value: moneyShort(run.gross), tone: 'money', onclick: "drill('pay.gross')", sub: run.headcount + ' staff · ' + run.month }) +
    statCard({ label: 'Total deductions', value: moneyShort(run.deductions), tone: 'warn', onclick: "drill('pay.deductions')", sub: pct(run.deductions, run.gross) + '% of gross · PAYE, pension, NHF' }) +
    statCard({ label: 'Net to pay', value: moneyShort(run.net), tone: 'good', onclick: "drill('pay.net')", sub: 'Value date ' + fmtD(run.payDate) }) +
    statCard({ label: 'Pending', value: pending.length, tone: pending.length ? 'bad' : 'good', onclick: "drill('pay.pending')", sub: pending.length ? moneyShort(pending.reduce((t, s) => t + s.net, 0)) + ' still to run' : 'All ' + slips.length + ' staff paid' }) +
    statCard({ label: 'Payslips published', value: published + '/' + slips.length, tone: published === slips.length ? 'good' : 'warn', onclick: "drill('pay.slips')", sub: published === slips.length ? 'Visible to all staff' : 'Publish so staff can see them' }) +
    '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>' + run.month + ' payroll</h3>' +
    '<div class="ph-sub">Tap a row to open the payslip, download it, or publish it to the staff member</div></div>' +
    statusPill(run.status) + '</div>' +
    '<div class="tw"><table><thead><tr><th>Staff</th><th>Department</th><th class="num">Basic</th>' +
    '<th class="num">Allowances</th><th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net</th>' +
    '<th>Status</th><th>Payslip</th><th></th></tr></thead><tbody>' +
    slips.map(s => '<tr class="klik" onclick="openDetail(\'slip\',' + s.id + ')">' +
      '<td><div class="t-main">' + esc(s.staffName) + '</div><div class="t-sub">' + s.bank.split(' · ')[0] + '</div></td>' +
      '<td>' + s.dept + '</td>' +
      '<td class="num">' + money(s.basic) + '</td>' +
      '<td class="num">' + money(s.housing + s.transport + s.bonus + s.overtime) + '</td>' +
      '<td class="num">' + money(s.gross) + '</td>' +
      '<td class="num" style="color:var(--red)">−' + money(s.deductions) + '</td>' +
      '<td class="num"><b>' + money(s.net) + '</b></td>' +
      '<td>' + statusPill(s.status) + '</td>' +
      '<td>' + (s.uploaded ? '<span class="pill green">Published</span>' : '<span class="pill grey">Not published</span>') + '</td>' +
      '<td class="chev">&rsaquo;</td></tr>').join('') +
    '<tr><td colspan="4" style="text-align:right;font-weight:600">Run total</td>' +
    '<td class="num"><b>' + money(run.gross) + '</b></td>' +
    '<td class="num" style="color:var(--red)"><b>−' + money(run.deductions) + '</b></td>' +
    '<td class="num"><b>' + money(run.net) + '</b></td><td colspan="3"></td></tr>' +
    '</tbody></table></div></div>' +

    /* Payroll history is a full-width table, not a squeezed side list —
       it is the record you actually audit against. */
    '<div class="pnl"><div class="ph"><div><h3>Payroll history</h3>' +
    '<div class="ph-sub">Every run to date · tap a month to open it</div></div></div>' +
    '<div class="tw"><table><thead><tr><th>Month</th><th>Value date</th><th class="num">Staff</th>' +
    '<th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net</th>' +
    '<th class="num">Paid</th><th>Status</th><th></th></tr></thead><tbody>' +
    DB.payrollRuns.map(r => '<tr class="klik"' + (r.monthKey === key ? ' style="background:color-mix(in srgb,var(--gold) 10%,var(--panel))"' : '') +
      ' onclick="UI.payMonth=\'' + r.monthKey + '\';render()">' +
      '<td class="t-main">' + r.month + (r.monthKey === key ? ' <span class="note">· open</span>' : '') + '</td>' +
      '<td>' + fmtD(r.payDate) + '</td>' +
      '<td class="num">' + r.headcount + '</td>' +
      '<td class="num">' + money(r.gross) + '</td>' +
      '<td class="num" style="color:var(--red)">−' + money(r.deductions) + '</td>' +
      '<td class="num"><b>' + money(r.net) + '</b></td>' +
      '<td class="num">' + r.paid + '/' + r.headcount + '</td>' +
      '<td>' + statusPill(r.status) + '</td><td class="chev">&rsaquo;</td></tr>').join('') +
    '<tr><td colspan="3" style="text-align:right;font-weight:600">' + DB.payrollRuns.length + ' runs</td>' +
    '<td class="num"><b>' + money(DB.payrollRuns.reduce((t, r) => t + r.gross, 0)) + '</b></td>' +
    '<td class="num" style="color:var(--red)"><b>−' + money(DB.payrollRuns.reduce((t, r) => t + r.deductions, 0)) + '</b></td>' +
    '<td class="num"><b>' + money(DB.payrollRuns.reduce((t, r) => t + r.net, 0)) + '</b></td>' +
    '<td colspan="3"></td></tr>' +
    '</tbody></table></div></div>' +

    '<div class="pnl"><div class="ph"><div><h3>Net pay by department</h3>' +
    '<div class="ph-sub">' + run.month + '</div></div></div>' +
    hBars(Object.keys(byDept).map((d, i) => ({
      label: d, value: byDept[d],
      color: ['var(--gold)', 'var(--green)', 'var(--blue)', 'var(--purple)', 'var(--amber)'][i % 5]
    })), { money: true }) + '</div>';
}

/* =================== REVENUE ===================
   Charts carry their own time range so you can look at years of progression
   without changing the period that drives the cards.                       */
PAGES.revenue = function () {
  const mrr = Q.mrr(), split = Q.planSplit();
  const rev = Q.revenue(), churn = Q.churnedMrr();
  const netNew = Q.newSubs().filter(s => s.status === 'active').reduce((t, s) => t + s.mrr, 0);

  const revR = chartRange('rev', '12m');
  const growR = chartRange('grow', '12m');
  const mrrR = chartRange('mrrline', '12m');
  const revData = revenueSeriesFor(revR);
  const growData = growthSeriesFor(growR);
  const mrrData = mrrSeriesFor(mrrR);
  const rangeName = r => (CHART_RANGES.find(x => x[0] === r) || [])[1] || r;

  return periodBar() +
    '<div class="stats">' +
    statCard({ label: 'MRR', value: moneyShort(mrr), tone: 'money', onclick: "drill('mrr')", sub: trend(mrr, Q.mrrPrev()) }) +
    statCard({ label: 'Collected', value: moneyShort(rev), tone: 'good', onclick: "drill('revenue')",
      sub: Q.payments('successful').length + ' payments · ' + PERIOD.label }) +
    statCard({ label: 'ARR run rate', value: moneyShort(Q.arr()), tone: 'money', onclick: "drill('arr')", sub: 'MRR × 12' }) +
    statCard({ label: 'ARPU', value: moneyShort(Q.arpu()), tone: 'money', onclick: "drill('arpu')", sub: 'Per active account' }) +
    statCard({ label: 'New MRR', value: moneyShort(netNew), tone: 'good', onclick: "drill('newmrr')",
      sub: Q.newSubs().length + ' new accounts ' + PERIOD.label.toLowerCase() }) +
    statCard({ label: 'Churned MRR', value: moneyShort(churn), tone: 'bad', onclick: "drill('churn')",
      sub: pct(churn, mrr) + '% of MRR · ' + Q.expired().length + ' accounts' }) +
    '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>Revenue collected</h3>' +
    '<div class="ph-sub"><b style="color:var(--gold)">' + money(revData.reduce((t, d) => t + d.value, 0)) +
    '</b> over the last ' + rangeName(revR).toLowerCase() + '</div></div>' +
    chartRangeBar('rev', '12m') + '</div>' +
    areaChart(revData, { money: true, color: 'var(--gold)', height: 230 }) + '</div>' +

    '<div class="cols3">' +
    '<div class="pnl"><div class="ph"><div><h3>MRR over time</h3>' +
    '<div class="ph-sub">Recurring revenue as it stood each month</div></div></div>' +
    chartRangeBar('mrrline', '12m') +
    areaChart(mrrData, { money: true, color: 'var(--blue)', height: 190 }) + '</div>' +
    '<div class="pnl"><div class="ph"><div><h3>Subscriber growth</h3>' +
    '<div class="ph-sub">Total accounts, cumulative</div></div></div>' +
    chartRangeBar('grow', '12m') +
    areaChart(growData, { color: 'var(--green)', height: 190 }) + '</div>' +
    '</div>' +

    '<div class="cols3">' +
    '<div class="pnl"><div class="ph"><h3>Subscribers by plan</h3></div>' +
    donut(split.filter(s => s.count).map(s => ({
      label: s.name, value: s.count,
      color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)', trial: 'var(--blue)' }[s.id],
      onclick: "UI.planFilter='" + s.id + "';UI.filters.subscribers='all';go('subscribers')"
    })), Q.subsAsOf().length, 'Total') + '</div>' +

    '<div class="pnl"><div class="ph"><h3>Revenue by plan</h3><span class="note">MRR</span></div>' +
    hBars(split.filter(s => s.mrr).map(s => ({
      label: s.name, value: s.mrr,
      color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)' }[s.id] || 'var(--blue)',
      onclick: "UI.planFilter='" + s.id + "';UI.filters.subscribers='all';go('subscribers')"
    })), { money: true }) + '</div>' +

    '<div class="pnl"><div class="ph"><h3>Billing cycle mix</h3></div>' +
    donut([
      { label: 'Monthly', value: Q.active().filter(s => s.cycle === 'monthly').length, color: 'var(--gold)' },
      { label: 'Annual', value: Q.active().filter(s => s.cycle === 'annual').length, color: 'var(--green)' }
    ], Q.active().length, 'Paying') + '</div>' +

    '<div class="pnl"><div class="ph"><h3>Health of the base</h3></div>' +
    ['healthy', 'steady', 'at-risk', 'onboarding', 'churned'].map(h => {
      const n = Q.subsAsOf().filter(s => s.health === h).length;
      return '<div class="row klik" onclick="UI.sort.subscribers=\'health\';go(\'subscribers\')">' +
        '<div>' + statusPill(h) + '</div><b>' + n + '</b></div>';
    }).join('') + '</div>' +
    '</div>';
};

