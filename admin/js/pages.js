/* ============================================================
   pages.js — list/dashboard renderers for every nav item
   ============================================================ */

const PAGES = {};

/* =================== OVERVIEW =================== */
PAGES.overview = function () {
  const subs = Q.subsAsOf(), act = Q.active(), nw = Q.newSubs(), nwPrev = Q.newSubsPrev();
  const mrr = Q.mrr(), rev = Q.revenue(), split = Q.planSplit();
  const openT = Q.openTickets(), urg = Q.urgentTickets();

  const stats = [
    statCard({ label: 'Total subscribers', value: subs.length, tone: 'money', onclick: "go('subscribers')",
      sub: (nw.length ? '<span class="up">↑ ' + nw.length + '</span> joined ' + PERIOD.label.toLowerCase()
        : '<span class="note">none joined ' + PERIOD.label.toLowerCase() + '</span>') +
        ' · ' + Q.active().length + ' paying' }),
    statCard({ label: 'Active subscribers', value: act.length, tone: 'good', onclick: "UI.filters.subscribers='active';go('subscribers')",
      sub: pct(act.length, subs.length) + '% of all · ' + Q.trial().length + ' on trial' }),
    statCard({ label: 'Revenue (' + PERIOD.label.toLowerCase() + ')', value: moneyShort(rev), tone: 'money', onclick: "go('revenue')",
      sub: trend(rev, Q.revenuePrev()) }),
    statCard({ label: 'MRR', value: moneyShort(mrr), tone: 'money', onclick: "go('revenue')",
      sub: 'ARR ' + moneyShort(Q.arr()) + ' · ARPU ' + moneyShort(Q.arpu()) }),
    statCard({ label: 'Open support', value: openT.length, tone: urg.length ? 'bad' : 'good', onclick: "go('support')",
      sub: '<span class="down">' + urg.length + ' urgent</span> · ' + (openT.length - urg.length) + ' normal' }),
    statCard({ label: 'Renewals due (7d)', value: Q.renewing().length, tone: 'warn', onclick: "UI.filters.subscribers='renewing';go('subscribers')",
      sub: '<span class="down">' + Q.pastDue().length + ' past due</span> · ' + moneyShort(Q.renewing().reduce((t, s) => t + s.mrr, 0)) + ' at stake' })
  ].join('');

  const revSeries = Q.revenueSeries();
  const growth = Q.growthSeries(6);

  const donutSegs = split.filter(s => s.count).map(s => ({
    label: s.name, value: s.count,
    color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)', trial: 'var(--blue)' }[s.id],
    onclick: "UI.filters.subscribers='" + s.id + "';go('subscribers')"
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
    '<div class="ph-sub">' + money(rev) + ' collected · ' + PERIOD.label + '</div></div>' +
    '<button class="lnk" onclick="go(\'revenue\')">Full revenue &rsaquo;</button></div>' +
    areaChart(revSeries, { money: true, color: 'var(--gold)', height: 210 }) + '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>Growth overview</h3>' +
    '<div class="ph-sub">Total subscribers · last 6 months</div></div>' +
    '<span class="note">' + subs.length + ' &nbsp;<span class="up">↑ ' +
    pct(growth[5].value - growth[0].value, growth[0].value) + '%</span></span></div>' +
    areaChart(growth, { color: 'var(--green)', height: 190 }) + '</div>' +

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

    '<div class="pnl"><div class="ph"><h3>Revenue by plan</h3><span class="note">MRR</span></div>' +
    hBars(split.filter(s => s.mrr).map(s => ({
      label: s.name, value: s.mrr,
      color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)', trial: 'var(--blue)' }[s.id],
      onclick: "UI.filters.subscribers='" + s.id + "';go('subscribers')"
    })), { money: true }) + '</div>' +

    '<div class="pnl"><div class="ph"><h3>Alerts</h3><button class="lnk" onclick="go(\'activity\')">View all</button></div>' +
    (alerts.length ? alerts.map(a => '<div class="row klik" onclick="' + a.go + '">' +
      '<div><b>' + a.t + '</b><small>' + esc(a.d) + '</small></div>' +
      '<span class="note">' + a.when + '</span></div>').join('') : '<div class="empty">Nothing needs you right now.</div>') +
    '</div>' +

    '<div class="pnl"><div class="ph"><h3>Support &amp; reviews</h3><button class="lnk" onclick="go(\'support\')">View all</button></div>' +
    DB.tickets.slice(0, 5).map(t => '<div class="row klik" onclick="openDetail(\'ticket\',' + t.id + ')">' +
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

  if (UI.search) {
    const q = UI.search.toLowerCase();
    list = list.filter(s => s.name.toLowerCase().includes(q) || s.owner.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }

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

  return periodBar() +
    '<div class="stats">' +
    statCard({ label: 'All subscribers', value: all.length, tone: 'money', onclick: "setFilter('subscribers','all')", sub: Q.newSubs().length + ' joined ' + PERIOD.label.toLowerCase() }) +
    statCard({ label: 'Active', value: buckets.active.length, tone: 'good', onclick: "setFilter('subscribers','active')", sub: moneyShort(Q.mrr()) + ' MRR' }) +
    statCard({ label: 'On trial', value: buckets.trial.length, tone: 'info', onclick: "setFilter('subscribers','trial')", sub: buckets.trial.filter(s => s.renewIn <= 3).length + ' ending within 3 days' }) +
    statCard({ label: 'Renewing in 7d', value: buckets.renewing.length, tone: 'warn', onclick: "setFilter('subscribers','renewing')", sub: moneyShort(buckets.renewing.reduce((t, s) => t + s.mrr, 0)) + ' up for renewal' }) +
    statCard({ label: 'Past due', value: buckets.pastdue.length, tone: 'bad', onclick: "setFilter('subscribers','pastdue')", sub: moneyShort(buckets.pastdue.reduce((t, s) => t + s.mrr, 0)) + ' unpaid' }) +
    statCard({ label: 'Expired', value: buckets.expired.length, tone: 'bad', onclick: "setFilter('subscribers','expired')", sub: 'Churn ' + pct(buckets.expired.length, all.length) + '%' }) +
    '</div>' +

    '<div class="bar">' +
    tabBar('subscribers', [
      { k: 'all', t: 'All', n: buckets.all.length },
      { k: 'active', t: 'Active', n: buckets.active.length },
      { k: 'trial', t: 'Trial', n: buckets.trial.length },
      { k: 'renewing', t: 'Renewing soon', n: buckets.renewing.length },
      { k: 'pastdue', t: 'Past due', n: buckets.pastdue.length },
      { k: 'expired', t: 'Expired', n: buckets.expired.length },
      { k: 'premium', t: 'Premium', n: buckets.premium.length },
      { k: 'pro', t: 'Pro', n: buckets.pro.length },
      { k: 'starter', t: 'Starter', n: buckets.starter.length }
    ]) +
    '<span class="spacer"></span>' +
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

    '<div class="pnl"><div class="ph"><div><h3>Subscriber directory</h3>' +
    '<div class="ph-sub">' + list.length + ' of ' + all.length + ' shown</div></div></div>' +
    (list.length ? '<div class="tw"><table><thead><tr>' +
      '<th>Business</th><th>Plan</th><th>Status</th><th>Health</th><th class="num">Users</th>' +
      '<th>Joined</th><th>Renews</th><th class="num">Referrals</th><th class="num">MRR</th><th></th></tr></thead><tbody>' +
      list.map(s => '<tr class="klik" onclick="openDetail(\'sub\',' + s.id + ')">' +
        '<td><div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + esc(s.owner) + ' · ' + esc(s.city) + '</div></td>' +
        '<td><span class="tier">' + s.planName + '</span><div class="t-sub">' + s.cycle + '</div></td>' +
        '<td>' + statusPill(s.status) + (s.pastDue ? ' <span class="pill red">Past due</span>' : '') + '</td>' +
        '<td>' + statusPill(s.health) + '</td>' +
        '<td class="num">' + s.users + '<span class="t-sub">/' + s.seats + '</span></td>' +
        '<td>' + fmtD(s.joined) + '</td>' +
        '<td>' + (s.status === 'expired' ? '<span class="note">—</span>' :
          (s.renewIn <= 7 ? '<span class="pill amber">' + (s.renewIn <= 0 ? 'due' : s.renewIn + 'd') + '</span>' : fmtDShort(s.renewsOn))) + '</td>' +
        '<td class="num">' + (s.referralConverted || 0) + (s.referralEarned ? '<div class="t-sub">' + moneyShort(s.referralEarned) + '</div>' : '') + '</td>' +
        '<td class="num">' + (s.mrr ? money(s.mrr) : '—') + '</td>' +
        '<td class="chev">&rsaquo;</td></tr>').join('') +
      '</tbody></table></div>'
      : '<div class="empty">No subscribers match this filter.</div>') +
    '</div>';
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
    statCard({ label: 'Not started', value: buckets.new.length, tone: 'warn', onclick: "setFilter('onboarding','new')", sub: 'Account created, nothing set up' }) +
    statCard({ label: 'Setting up', value: buckets.setup.length, tone: 'info', onclick: "setFilter('onboarding','setup')", sub: 'Partway through the checklist' }) +
    statCard({ label: 'Ready to convert', value: buckets.ready.length, tone: 'good', onclick: "setFilter('onboarding','ready')", sub: 'Checklist complete' }) +
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
      onclick: "UI.filters.subscribers='" + p.id + "';go('subscribers')",
      sub: p.share + '% of base · ' + (p.mrr ? moneyShort(p.mrr) + ' MRR' : 'no MRR')
    })).join('') +
    statCard({ label: 'Annual billing', value: annual, tone: 'good', sub: pct(annual, subs.length) + '% of subscribers' }) +
    statCard({ label: 'Blended ARPU', value: moneyShort(Q.arpu()), tone: 'money', sub: 'Across ' + Q.active().length + ' paying accounts' }) +
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

    '<div class="cols"><div class="pnl"><div class="ph"><h3>MRR by plan</h3></div>' +
    hBars(split.filter(s => s.mrr).map(s => ({
      label: s.name, value: s.mrr,
      color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)' }[s.id] || 'var(--blue)',
      onclick: "UI.filters.subscribers='" + s.id + "';go('subscribers')"
    })), { money: true }) + '</div>' +
    '<div class="pnl"><div class="ph"><h3>Referral programme</h3></div>' +
    '<div class="kv"><span class="k">Commission rate</span><span class="v">' + DB.settings.referralPct + '% of first month</span></div>' +
    '<div class="kv"><span class="k">Referring subscribers</span><span class="v">' + DB.subscribers.filter(s => s.referralConverted > 0).length + '</span></div>' +
    '<div class="kv"><span class="k">Referrals converted</span><span class="v">' + DB.subscribers.reduce((t, s) => t + s.referralConverted, 0) + '</span></div>' +
    '<div class="kv"><span class="k">Commission earned</span><span class="v">' + money(Q.refCommissionTotal()) + '</span></div>' +
    '<div class="kv"><span class="k">Commission paid out</span><span class="v">' + money(DB.subscribers.reduce((t, s) => t + s.referralPaid, 0)) + '</span></div>' +
    '<div class="kv"><span class="k">Outstanding</span><span class="v" style="color:var(--amber)">' + money(DB.subscribers.reduce((t, s) => t + s.referralPending, 0)) + '</span></div>' +
    '<button class="btn" style="width:100%;margin-top:12px" onclick="UI.sort.subscribers=\'referrals\';go(\'subscribers\')">See top referrers &rarr;</button>' +
    '</div></div>';
};

/* =================== PAYMENTS =================== */
PAGES.payments = function () {
  const f = UI.filters.payments;
  const inP = DB.payments.filter(p => inPeriod(p.date));
  const count = s => inP.filter(p => p.status === s).length;
  let list = f === 'all' ? inP : inP.filter(p => p.status === f);
  if (UI.search) { const q = UI.search.toLowerCase(); list = list.filter(p => p.subscriber.toLowerCase().includes(q) || p.ref.toLowerCase().includes(q)); }
  list = list.slice().sort((a, b) => b.date.localeCompare(a.date));

  const sum = s => inP.filter(p => p.status === s).reduce((t, p) => t + p.amount, 0);

  return periodBar() +
    '<div class="stats">' +
    statCard({ label: 'Collected', value: moneyShort(sum('successful')), tone: 'good', onclick: "setFilter('payments','successful')", sub: count('successful') + ' payments · ' + trend(sum('successful'), Q.revenuePrev()) }) +
    statCard({ label: 'Failed', value: moneyShort(sum('failed')), tone: 'bad', onclick: "setFilter('payments','failed')", sub: count('failed') + ' need a retry' }) +
    statCard({ label: 'Overdue', value: moneyShort(sum('overdue')), tone: 'bad', onclick: "setFilter('payments','overdue')", sub: count('overdue') + ' accounts past due' }) +
    statCard({ label: 'Pending', value: moneyShort(sum('pending')), tone: 'warn', onclick: "setFilter('payments','pending')", sub: count('pending') + ' clearing today' }) +
    statCard({ label: 'Upcoming', value: moneyShort(sum('upcoming')), tone: 'info', onclick: "setFilter('payments','upcoming')", sub: count('upcoming') + ' scheduled renewals' }) +
    statCard({ label: 'Refunded', value: moneyShort(sum('refunded')), tone: 'money', onclick: "setFilter('payments','refunded')", sub: count('refunded') + ' refunds issued' }) +
    '</div>' +

    '<div class="bar">' + tabBar('payments', [
      { k: 'all', t: 'All', n: inP.length }, { k: 'successful', t: 'Successful', n: count('successful') },
      { k: 'failed', t: 'Failed', n: count('failed') }, { k: 'pending', t: 'Pending', n: count('pending') },
      { k: 'overdue', t: 'Overdue', n: count('overdue') }, { k: 'upcoming', t: 'Upcoming', n: count('upcoming') },
      { k: 'refunded', t: 'Refunded', n: count('refunded') }
    ]) + '<span class="spacer"></span><button class="btn" onclick="exportPayments()">Export CSV</button></div>' +

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
    '</select><span class="spacer"></span>' +
    '<button class="btn" onclick="exportPayroll()">Export CSV</button>' +
    '<button class="btn" onclick="formPublishSlips()">Publish payslips</button>' +
    '<button class="btn gold" onclick="formRunPayroll()">Run payroll</button></div>' +
    payrollBody(UI.payMonth || DB.payrollRuns[0].monthKey);
};
function payrollBody(key) {
  const run = Q.runByKey(key);
  const slips = Q.slipsFor(key);
  const paid = slips.filter(s => s.status === 'paid');
  const pending = slips.filter(s => s.status === 'pending');
  const published = slips.filter(s => s.uploaded).length;
  const byDept = {};
  slips.forEach(s => { byDept[s.dept] = (byDept[s.dept] || 0) + s.net; });

  return '<div class="stats">' +
    statCard({ label: 'Gross payroll', value: moneyShort(run.gross), tone: 'money', sub: run.headcount + ' staff · ' + run.month }) +
    statCard({ label: 'Total deductions', value: moneyShort(run.deductions), tone: 'warn', sub: pct(run.deductions, run.gross) + '% of gross · PAYE, pension, NHF' }) +
    statCard({ label: 'Net to pay', value: moneyShort(run.net), tone: 'good', sub: 'Value date ' + fmtD(run.payDate) }) +
    statCard({ label: 'Paid', value: paid.length + '/' + slips.length, tone: 'good', sub: moneyShort(paid.reduce((t, s) => t + s.net, 0)) + ' released' }) +
    statCard({ label: 'Pending', value: pending.length, tone: pending.length ? 'bad' : 'good', sub: pending.length ? moneyShort(pending.reduce((t, s) => t + s.net, 0)) + ' still to run' : 'All staff paid' }) +
    statCard({ label: 'Payslips published', value: published + '/' + slips.length, tone: published === slips.length ? 'good' : 'warn', sub: published === slips.length ? 'Visible to all staff' : 'Publish so staff can see them' }) +
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

    '<div class="cols"><div class="pnl"><div class="ph"><h3>Net pay by department</h3></div>' +
    hBars(Object.keys(byDept).map((d, i) => ({
      label: d, value: byDept[d],
      color: ['var(--gold)', 'var(--green)', 'var(--blue)', 'var(--purple)', 'var(--amber)'][i % 5]
    })), { money: true }) + '</div>' +
    '<div class="pnl"><div class="ph"><h3>Payroll history</h3></div>' +
    DB.payrollRuns.map(r => '<div class="row klik" onclick="UI.payMonth=\'' + r.monthKey + '\';render()">' +
      '<div><b>' + r.month + '</b><small>' + r.headcount + ' staff · ' + r.paid + ' paid</small></div>' +
      '<div style="text-align:right"><b>' + money(r.net) + '</b><small>' + statusPill(r.status) + '</small></div></div>').join('') +
    '</div></div>';
}

/* =================== REVENUE =================== */
PAGES.revenue = function () {
  const mrr = Q.mrr(), split = Q.planSplit();
  const rev = Q.revenue(), churn = Q.churnedMrr();
  const netNew = Q.newSubs().filter(s => s.status === 'active').reduce((t, s) => t + s.mrr, 0);

  return periodBar() +
    '<div class="stats">' +
    statCard({ label: 'MRR', value: moneyShort(mrr), tone: 'money', sub: trend(mrr, Q.mrrPrev()) }) +
    statCard({ label: 'ARR run rate', value: moneyShort(Q.arr()), tone: 'money', sub: 'MRR × 12' }) +
    statCard({ label: 'Collected', value: moneyShort(rev), tone: 'good', onclick: "go('payments')", sub: Q.payments('successful').length + ' payments · ' + PERIOD.label }) +
    statCard({ label: 'ARPU', value: moneyShort(Q.arpu()), tone: 'money', sub: 'Per active account' }) +
    statCard({ label: 'New MRR', value: moneyShort(netNew), tone: 'good', sub: Q.newSubs().length + ' new accounts ' + PERIOD.label.toLowerCase() }) +
    statCard({ label: 'Churned MRR', value: moneyShort(churn), tone: 'bad', onclick: "UI.filters.subscribers='expired';go('subscribers')", sub: pct(churn, mrr) + '% of MRR · ' + Q.expired().length + ' accounts' }) +
    '</div>' +

    '<div class="cols"><div>' +
    '<div class="pnl"><div class="ph"><div><h3>Revenue overview</h3>' +
    '<div class="ph-sub">Successful payments · ' + PERIOD.label + '</div></div>' +
    '<span class="note">' + money(rev) + '</span></div>' +
    areaChart(Q.revenueSeries(), { money: true, color: 'var(--gold)', height: 220 }) + '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>Revenue progression</h3>' +
    '<div class="ph-sub">Monthly collected, last 12 months</div></div></div>' +
    areaChart((function () {
      const out = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(DB.today.getFullYear(), DB.today.getMonth() - i, 1);
        const n = new Date(DB.today.getFullYear(), DB.today.getMonth() - i + 1, 1);
        out.push({
          label: d.toLocaleDateString('en-GB', { month: 'short' }),
          value: DB.payments.filter(p => p.status === 'successful' && new Date(p.date) >= d && new Date(p.date) < n).reduce((t, p) => t + p.amount, 0)
        });
      }
      return out;
    })(), { money: true, color: 'var(--green)', height: 200 }) + '</div>' +

    '<div class="pnl"><div class="ph"><h3>Top accounts by MRR</h3>' +
    '<button class="lnk" onclick="UI.sort.subscribers=\'mrr-desc\';go(\'subscribers\')">View all</button></div>' +
    '<div class="tw"><table><thead><tr><th>Business</th><th>Plan</th><th>Since</th><th class="num">MRR</th><th class="num">Lifetime</th><th></th></tr></thead><tbody>' +
    Q.active().slice().sort((a, b) => b.mrr - a.mrr).slice(0, 8).map(s => {
      const lifetime = DB.payments.filter(p => p.subId === s.id && p.status === 'successful').reduce((t, p) => t + p.amount, 0);
      return '<tr class="klik" onclick="openDetail(\'sub\',' + s.id + ')">' +
        '<td class="t-main">' + esc(s.name) + '</td><td><span class="tier">' + s.planName + '</span></td>' +
        '<td>' + fmtD(s.joined) + '</td><td class="num">' + money(s.mrr) + '</td>' +
        '<td class="num">' + money(lifetime) + '</td><td class="chev">&rsaquo;</td></tr>';
    }).join('') + '</tbody></table></div></div>' +

    '</div><div>' +
    '<div class="pnl"><div class="ph"><h3>Subscribers by plan</h3></div>' +
    donut(split.filter(s => s.count).map(s => ({
      label: s.name, value: s.count,
      color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)', trial: 'var(--blue)' }[s.id],
      onclick: "UI.filters.subscribers='" + s.id + "';go('subscribers')"
    })), Q.subsAsOf().length, 'Total') + '</div>' +
    '<div class="pnl"><div class="ph"><h3>Revenue by plan</h3><span class="note">MRR</span></div>' +
    hBars(split.filter(s => s.mrr).map(s => ({
      label: s.name, value: s.mrr,
      color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)' }[s.id] || 'var(--blue)',
      onclick: "UI.filters.subscribers='" + s.id + "';go('subscribers')"
    })), { money: true }) + '</div>' +
    '<div class="pnl"><div class="ph"><h3>Billing cycle mix</h3></div>' +
    donut([
      { label: 'Monthly', value: Q.active().filter(s => s.cycle === 'monthly').length, color: 'var(--gold)' },
      { label: 'Annual', value: Q.active().filter(s => s.cycle === 'annual').length, color: 'var(--green)' }
    ], Q.active().length, 'Paying') + '</div>' +
    '<div class="pnl"><div class="ph"><h3>Health of the base</h3></div>' +
    ['healthy', 'steady', 'at-risk', 'onboarding', 'churned'].map(h => {
      const n = Q.subsAsOf().filter(s => s.health === h).length;
      return '<div class="row klik" onclick="UI.sort.subscribers=\'health\';go(\'subscribers\')"><div>' + statusPill(h) + '</div><b>' + n + '</b></div>';
    }).join('') + '</div>' +
    '</div></div>';
};
