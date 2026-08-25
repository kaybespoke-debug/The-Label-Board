/* ============================================================
   pages2.js — Support & Usage, Feedback, Announcements,
   Platform Health, Tasks, Staff & Roles, Activity, Settings
   ============================================================ */

/* =================== SUPPORT & USAGE =================== */
PAGES.support = function () {
  const tab = UI.filters.support;
  const open = Q.openTickets(), urg = Q.urgentTickets();
  const prog = DB.tickets.filter(t => t.state === 'in-progress');
  const res = DB.tickets.filter(t => t.state === 'resolved');
  const u = DB.usage.series;
  const last = u[u.length - 1];

  const head = '<div class="utabs">' +
    [['tickets', 'Support tickets'], ['usage', 'Product usage'], ['risk', 'At-risk accounts']]
      .map(t => '<button class="utab' + (tab === t[0] ? ' on' : '') + '" onclick="setFilter(\'support\',\'' + t[0] + '\')">' + t[1] + '</button>').join('') +
    '</div>';

  if (tab === 'usage') {
    return head + periodBar() +
      '<div class="stats">' +
      statCard({ label: 'Daily active businesses', value: last.dab, tone: 'good', sub: trend(last.dab, u[u.length - 8].dab, { unit: 'week' }) }) +
      statCard({ label: 'Monthly active users', value: last.mau.toLocaleString(), tone: 'good', sub: trend(last.mau, u[0].mau, { unit: '30 days' }) }) +
      statCard({ label: 'Orders created', value: u.reduce((t, d) => t + d.orders, 0).toLocaleString(), tone: 'money', sub: 'Last 30 days across all subscribers' }) +
      statCard({ label: 'Avg orders / business', value: Math.round(u.reduce((t, d) => t + d.orders, 0) / Math.max(1, Q.active().length)), tone: 'info', sub: 'Per active account, 30 days' }) +
      statCard({ label: 'At-risk accounts', value: Q.atRisk().length, tone: 'bad', onclick: "drill('subs.atrisk')", sub: 'Low activity or failed payment' }) +
      statCard({ label: 'Seat utilisation', value: pct(Q.active().reduce((t, s) => t + s.users, 0), Q.active().reduce((t, s) => t + s.seats, 0)) + '%', tone: 'info', sub: Q.active().reduce((t, s) => t + s.users, 0) + ' of ' + Q.active().reduce((t, s) => t + s.seats, 0) + ' seats used' }) +
      '</div>' +
      '<div class="pnl"><div class="ph"><div><h3>Daily active businesses</h3><div class="ph-sub">Last 30 days</div></div></div>' +
      areaChart(Q.usageSeries('dab'), { color: 'var(--green)', height: 200 }) + '</div>' +
      '<div class="pnl"><div class="ph"><div><h3>Orders created</h3><div class="ph-sub">Last 30 days, all subscribers</div></div></div>' +
      areaChart(Q.usageSeries('orders'), { color: 'var(--gold)', height: 200 }) + '</div>' +
      '<div class="pnl"><div class="ph"><h3>Most active subscribers</h3></div>' +
      '<div class="tw"><table><thead><tr><th>Business</th><th>Plan</th><th class="num">Orders (30d)</th><th class="num">Users</th><th>Last seen</th><th></th></tr></thead><tbody>' +
      Q.active().slice().sort((a, b) => b.ordersLast30 - a.ordersLast30).slice(0, 10).map(s =>
        '<tr class="klik" onclick="openDetail(\'sub\',' + s.id + ')"><td class="t-main">' + esc(s.name) + '</td>' +
        '<td><span class="tier">' + s.planName + '</span></td><td class="num">' + s.ordersLast30 + '</td>' +
        '<td class="num">' + s.users + '</td><td>' + ago(s.lastSeen) + '</td><td class="chev">&rsaquo;</td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  if (tab === 'risk') {
    const risk = Q.atRisk();
    return head +
      '<div class="pnl"><div class="ph"><div><h3>At-risk accounts</h3>' +
      '<div class="ph-sub">Failed payment, low activity, or a trial running out. ' + moneyShort(risk.reduce((t, s) => t + s.mrr, 0)) + ' of MRR exposed.</div></div>' +
      '<button class="btn" onclick="exportRisk()">Export CSV</button></div>' +
      (risk.length ? '<div class="tw"><table><thead><tr><th>Business</th><th>Plan</th><th>Why</th><th class="num">Orders 30d</th><th>Last seen</th><th class="num">MRR</th><th></th></tr></thead><tbody>' +
        risk.map(s => '<tr class="klik" onclick="openDetail(\'sub\',' + s.id + ')">' +
          '<td><div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + esc(s.owner) + '</div></td>' +
          '<td><span class="tier">' + s.planName + '</span></td>' +
          '<td>' + (s.pastDue ? '<span class="pill red">Payment failed</span>' : s.ordersLast30 < 12 ? '<span class="pill amber">Low activity</span>' : '<span class="pill amber">Engagement drop</span>') + '</td>' +
          '<td class="num">' + s.ordersLast30 + '</td><td>' + ago(s.lastSeen) + '</td>' +
          '<td class="num">' + money(s.mrr) + '</td><td class="chev">&rsaquo;</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty">No accounts flagged at risk.</div>') + '</div>';
  }

  /* tickets */
  const f2 = UI.ticketFilter || 'all';
  let list = DB.tickets.slice();
  if (f2 === 'open') list = list.filter(t => t.state === 'open');
  else if (f2 === 'urgent') list = list.filter(t => t.state === 'urgent');
  else if (f2 === 'progress') list = list.filter(t => t.state === 'in-progress');
  else if (f2 === 'resolved') list = list.filter(t => t.state === 'resolved');
  else if (f2 === 'unassigned') list = list.filter(t => !t.assignedTo);

  return head +
    '<div class="stats">' +
    statCard({ label: 'Open tickets', value: open.length, tone: 'bad', onclick: "drill('tickets.open')", sub: '<span class="down">' + urg.length + ' urgent</span> · SLA ' + DB.settings.slaHours + 'h' }) +
    statCard({ label: 'In progress', value: prog.length, tone: 'info', onclick: "UI.ticketFilter='progress';render()", sub: 'Assigned to an agent' }) +
    statCard({ label: 'Unassigned', value: DB.tickets.filter(t => !t.assignedTo).length, tone: 'warn', onclick: "UI.ticketFilter='unassigned';render()", sub: 'Waiting to be picked up' }) +
    statCard({ label: 'Avg first reply', value: Q.avgFirstReply() + 'm', tone: 'good', sub: 'Target under ' + (DB.settings.slaHours * 60) + 'm' }) +
    statCard({ label: 'Resolved', value: res.length, tone: 'good', onclick: "UI.ticketFilter='resolved';render()", sub: 'Satisfaction ' + Q.satisfaction() + '%' }) +
    statCard({ label: 'Support agents', value: DB.staff.filter(s => s.dept === 'Support').length, tone: 'info', onclick: "UI.filters.staff='support';go('staff')", sub: Math.round(open.length / Math.max(1, DB.staff.filter(s => s.dept === 'Support').length) * 10) / 10 + ' open each' }) +
    '</div>' +
    '<div class="bar">' +
    [['all', 'All', DB.tickets.length], ['urgent', 'Urgent', urg.length], ['open', 'Open', DB.tickets.filter(t => t.state === 'open').length],
     ['progress', 'In progress', prog.length], ['unassigned', 'Unassigned', DB.tickets.filter(t => !t.assignedTo).length], ['resolved', 'Resolved', res.length]]
      .map(t => '<button class="tab' + (f2 === t[0] ? ' on' : '') + '" onclick="UI.ticketFilter=\'' + t[0] + '\';render()">' + t[1] + '<span class="n">' + t[2] + '</span></button>').join('') +
    '<span class="spacer"></span><button class="btn gold" onclick="formNewTicket()">+ Log a ticket</button></div>' +
    (list.length ? '<div class="cards">' + list.map(t =>
      '<div class="card" onclick="openDetail(\'ticket\',' + t.id + ')">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' + statusPill(t.state) +
      '<span class="note">#' + t.ref + '</span></div>' +
      '<h4>' + esc(t.title) + '</h4><p>' + esc(t.body) + '</p>' +
      '<div class="meta"><span>' + esc(t.subscriber) + '</span><span>' + ago(t.openedAt) + '</span></div>' +
      '<div class="meta" style="margin-top:5px"><span>' + (t.assignedTo ? '→ ' + esc(t.assignedName) : '<span style="color:var(--amber)">Unassigned</span>') + '</span>' +
      '<span>' + t.kind + '</span></div></div>').join('') + '</div>'
      : '<div class="pnl"><div class="empty">No tickets here.</div></div>');
};

/* =================== FEEDBACK =================== */
PAGES.feedback = function () {
  const f = UI.filters.feedback;
  const all = DB.feedback;
  const feats = all.filter(x => x.kind === 'feature');
  const sugg = all.filter(x => x.kind === 'suggestion');
  const revs = all.filter(x => x.kind === 'review');
  const list = f === 'all' ? all : f === 'feature' ? feats : f === 'suggestion' ? sugg : f === 'review' ? revs
    : all.filter(x => x.state === f);
  const avg = revs.length ? Math.round(revs.reduce((t, r) => t + r.rating, 0) / revs.length * 10) / 10 : 0;

  return '<div class="stats">' +
    statCard({ label: 'Feature requests', value: feats.length, tone: 'info', onclick: "setFilter('feedback','feature')", sub: feats.filter(x => x.state === 'under review').length + ' under review · ' + feats.filter(x => x.state === 'planned').length + ' planned' }) +
    statCard({ label: 'Suggestions', value: sugg.length, tone: 'info', onclick: "setFilter('feedback','suggestion')", sub: 'Smaller changes and polish' }) +
    statCard({ label: 'Reviews', value: revs.length, tone: 'good', onclick: "setFilter('feedback','review')", sub: revs.filter(x => x.state === 'published').length + ' approved for testimonial' }) +
    statCard({ label: 'Average rating', value: avg, tone: 'good', sub: '★'.repeat(Math.round(avg)) }) +
    statCard({ label: 'Total votes', value: all.reduce((t, x) => t + x.votes, 0), tone: 'money', sub: 'Across all open requests' }) +
    statCard({ label: 'Top request', value: Math.max.apply(null, all.map(x => x.votes)) + ' votes', tone: 'money', sub: esc(all.slice().sort((a, b) => b.votes - a.votes)[0].title) }) +
    '</div>' +
    '<div class="bar">' + tabBar('feedback', [
      { k: 'all', t: 'All', n: all.length }, { k: 'feature', t: 'Feature requests', n: feats.length },
      { k: 'suggestion', t: 'Suggestions', n: sugg.length }, { k: 'review', t: 'Reviews', n: revs.length },
      { k: 'planned', t: 'Planned', n: all.filter(x => x.state === 'planned').length },
      { k: 'under review', t: 'Under review', n: all.filter(x => x.state === 'under review').length }
    ]) + '<span class="spacer"></span><button class="btn" onclick="exportFeedback()">Export CSV</button></div>' +
    (list.length ? '<div class="cards">' + list.slice().sort((a, b) => b.votes - a.votes).map(x =>
      '<div class="card" onclick="openDetail(\'fb\',' + x.id + ')">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<span class="pill ' + (x.kind === 'feature' ? 'amber' : x.kind === 'suggestion' ? 'purple' : 'green') + '">' + x.kind.toUpperCase() + '</span>' +
      (x.rating ? '<span class="note">' + '★'.repeat(x.rating) + '</span>' : '<span class="note">' + x.votes + ' votes</span>') + '</div>' +
      '<h4>' + esc(x.title) + '</h4><p>' + esc(x.body) + '</p>' +
      '<div class="meta"><span>' + esc(x.subscriber) + '</span><span>' + statusPill(x.state === 'published' ? 'published' : x.state === 'planned' ? 'approved' : 'open') + '</span></div>' +
      '</div>').join('') + '</div>' : '<div class="pnl"><div class="empty">Nothing here yet.</div></div>');
};

/* =================== ANNOUNCEMENTS =================== */
PAGES.announcements = function () {
  const f = UI.filters.announcements;
  const all = DB.announcements;
  const pub = all.filter(a => a.state === 'published');
  const sch = all.filter(a => a.state === 'scheduled');
  const dr = all.filter(a => a.state === 'draft');
  const list = f === 'all' ? all : all.filter(a => a.state === f);

  return '<div class="stats">' +
    statCard({ label: 'Published', value: pub.length, tone: 'good', onclick: "setFilter('announcements','published')", sub: 'Reached ' + (pub[0] ? pub[0].reach : 0) + ' on the last send' }) +
    statCard({ label: 'Scheduled', value: sch.length, tone: 'warn', onclick: "setFilter('announcements','scheduled')", sub: sch.length ? 'Next ' + fmtD(sch[0].date) : 'Nothing queued' }) +
    statCard({ label: 'Drafts', value: dr.length, tone: 'info', onclick: "setFilter('announcements','draft')", sub: 'Not sent to anyone yet' }) +
    statCard({ label: 'Avg open rate', value: (pub.length ? pct(pub.reduce((t, a) => t + a.opened, 0), pub.reduce((t, a) => t + a.reach, 0)) : 0) + '%', tone: 'money', sub: 'Across published announcements' }) +
    '</div>' +
    '<div class="bar">' + tabBar('announcements', [
      { k: 'published', t: 'Published', n: pub.length }, { k: 'scheduled', t: 'Scheduled', n: sch.length },
      { k: 'draft', t: 'Drafts', n: dr.length }, { k: 'all', t: 'All', n: all.length }
    ]) + '<span class="spacer"></span><button class="btn gold" onclick="formAnnouncement()">+ New announcement</button></div>' +
    '<div class="pnl">' +
    (list.length ? '<div class="tw"><table><thead><tr><th>Announcement</th><th>Audience</th><th>Channel</th>' +
      '<th>Status</th><th>Date</th><th class="num">Reach</th><th class="num">Opened</th><th></th></tr></thead><tbody>' +
      list.map(a => '<tr class="klik" onclick="openDetail(\'ann\',' + a.id + ')">' +
        '<td><div class="t-main">' + esc(a.title) + '</div><div class="t-sub">' + esc(a.body.slice(0, 58)) + '…</div></td>' +
        '<td>' + a.audience + '</td><td>' + a.channel + '</td><td>' + statusPill(a.state) + '</td>' +
        '<td>' + fmtD(a.date) + '</td>' +
        '<td class="num">' + (a.reach || '—') + '</td>' +
        '<td class="num">' + (a.reach ? pct(a.opened, a.reach) + '%' : '—') + '</td>' +
        '<td class="chev">&rsaquo;</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="empty">Nothing in this state.</div>') + '</div>';
};

/* =================== PLATFORM HEALTH =================== */
PAGES.health = function () {
  const h = DB.health;
  const down = h.services.filter(s => s.state !== 'operational');
  const errs = h.errors.reduce((t, e) => t + e.count, 0);
  const avgUp = Math.round(h.services.reduce((t, s) => t + s.uptime, 0) / h.services.length * 100) / 100;

  return '<div class="pnl" style="border-left:3px solid var(--gold)">' +
    '<div class="ph"><h3>What this page is for</h3></div>' +
    '<p class="note">Platform Health watches the machinery your subscribers depend on: the API, the database, the payment ' +
    'gateway, email delivery, file storage and the subscriber app itself. When something here goes amber or red, ' +
    'subscribers are likely already feeling it, so it tells you what broke, since when, and who it affects, before the ' +
    'support tickets arrive. The error list underneath is the raw fault log with counts, so a fault that fires six times ' +
    'reads differently from one that fired once.</p></div>' +

    '<div class="stats">' +
    statCard({ label: 'Overall', value: down.length ? 'Degraded' : 'Operational', tone: down.length ? 'warn' : 'good', sub: avgUp + '% average uptime, 30 days' }) +
    statCard({ label: 'Services up', value: (h.services.length - down.length) + '/' + h.services.length, tone: down.length ? 'warn' : 'good', sub: down.length ? down.map(d => d.name).join(', ') + ' affected' : 'Everything responding' }) +
    statCard({ label: 'Open incidents', value: h.incidents.filter(i => i.state !== 'resolved').length, tone: h.incidents.filter(i => i.state !== 'resolved').length ? 'bad' : 'good', sub: h.incidents.filter(i => i.state !== 'resolved').length ? 'Being investigated now' : 'None open' }) +
    statCard({ label: 'Errors, 24h', value: errs, tone: errs > 10 ? 'bad' : 'warn', sub: h.errors.filter(e => e.severity === 'high').length + ' need a look' }) +
    '</div>' +

    '<div class="cols"><div>' +
    '<div class="pnl"><div class="ph"><div><h3>Services</h3><div class="ph-sub">Tap a service for its recent history</div></div></div>' +
    '<div class="tw"><table><thead><tr><th>Service</th><th>Status</th><th class="num">Uptime 30d</th><th class="num">Latency</th><th></th></tr></thead><tbody>' +
    h.services.map((s, i) => '<tr class="klik" onclick="openDetail(\'svc\',' + i + ')">' +
      '<td><div class="t-main">' + s.name + '</div><div class="t-sub">' + s.detail + '</div></td>' +
      '<td>' + statusPill(s.state) + '</td>' +
      '<td class="num">' + s.uptime + '%</td>' +
      '<td class="num"' + (s.latency > 500 ? ' style="color:var(--amber)"' : '') + '>' + s.latency + 'ms</td>' +
      '<td class="chev">&rsaquo;</td></tr>').join('') + '</tbody></table></div></div>' +

    '<div class="pnl"><div class="ph"><h3>Error log, last 24 hours</h3>' +
    '<button class="lnk" onclick="exportErrors()">Export</button></div>' +
    '<div class="tw"><table><thead><tr><th>Code</th><th class="num">Count</th><th>Severity</th><th>Last seen</th><th>Note</th></tr></thead><tbody>' +
    h.errors.map(e => '<tr><td class="t-main" style="font-family:monospace;font-size:11.5px">' + e.code + '</td>' +
      '<td class="num">' + e.count + '</td>' +
      '<td>' + (e.severity === 'high' ? '<span class="pill red">High</span>' : '<span class="pill grey">Low</span>') + '</td>' +
      '<td>' + ago(e.last) + '</td><td class="note">' + e.note + '</td></tr>').join('') +
    '</tbody></table></div></div>' +
    '</div><div>' +
    '<div class="pnl"><div class="ph"><h3>Incidents</h3></div>' +
    h.incidents.map(i => '<div class="row klik" onclick="openDetail(\'inc\',' + i.id + ')">' +
      '<div><b>' + i.title + '</b><small>' + i.service + ' · ' + ago(i.started) + '</small></div>' +
      statusPill(i.state) + '</div>').join('') + '</div>' +
    '<div class="pnl"><div class="ph"><h3>Integrations</h3></div>' +
    DB.settings.integrations.map(i => '<div class="row"><div><b>' + i.name + '</b><small>' + i.detail + '</small></div>' +
      statusPill(i.state) + '</div>').join('') + '</div>' +
    '</div></div>';
};

/* =================== TASKS =================== */
PAGES.tasks = function () {
  const f = UI.filters.tasks;
  const all = DB.tasks;
  const mine = all.filter(t => t.assignedTo === 1);
  const overdue = all.filter(t => !t.done && t.dueIn < 0);
  const todayT = all.filter(t => !t.done && t.dueIn === 0);
  const done = all.filter(t => t.done);
  const list = f === 'mine' ? mine : f === 'overdue' ? overdue : f === 'today' ? todayT : f === 'done' ? done : all.filter(t => !t.done);

  return '<div class="stats">' +
    statCard({ label: 'My tasks', value: mine.filter(t => !t.done).length, tone: 'money', onclick: "setFilter('tasks','mine')", sub: 'Assigned to you' }) +
    statCard({ label: 'All open', value: all.filter(t => !t.done).length, tone: 'info', onclick: "setFilter('tasks','all')", sub: 'Across every team' }) +
    statCard({ label: 'Due today', value: todayT.length, tone: 'warn', onclick: "setFilter('tasks','today')", sub: 'Needs closing out today' }) +
    statCard({ label: 'Overdue', value: overdue.length, tone: overdue.length ? 'bad' : 'good', onclick: "drill('tasks.overdue')", sub: overdue.length ? 'Oldest ' + Math.abs(Math.min.apply(null, overdue.map(t => t.dueIn))) + ' days late' : 'Nothing late' }) +
    statCard({ label: 'Completed', value: done.length, tone: 'good', onclick: "setFilter('tasks','done')", sub: 'Closed out' }) +
    '</div>' +
    '<div class="bar">' + tabBar('tasks', [
      { k: 'mine', t: 'My tasks', n: mine.filter(t => !t.done).length },
      { k: 'all', t: 'All staff', n: all.filter(t => !t.done).length },
      { k: 'today', t: 'Due today', n: todayT.length },
      { k: 'overdue', t: 'Overdue', n: overdue.length },
      { k: 'done', t: 'Completed', n: done.length }
    ]) + '<span class="spacer"></span><button class="btn gold" onclick="formTask()">+ Create task</button></div>' +
    (list.length ? '<div class="cards">' + list.map(t =>
      '<div class="card" onclick="openDetail(\'task\',' + t.id + ')">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<span class="pill ' + (t.done ? 'grey' : t.dueIn < 0 ? 'red' : t.dueIn === 0 ? 'amber' : t.priority === 'high' ? 'red' : t.priority === 'medium' ? 'amber' : 'blue') + '">' +
      (t.done ? 'DONE' : t.dueIn < 0 ? Math.abs(t.dueIn) + 'D LATE' : t.dueIn === 0 ? 'DUE TODAY' : 'IN ' + t.dueIn + 'D') + '</span>' +
      '<span class="note">' + t.priority + '</span></div>' +
      '<h4' + (t.done ? ' style="text-decoration:line-through;opacity:.6"' : '') + '>' + esc(t.title) + '</h4>' +
      '<p>' + esc(t.body) + '</p>' +
      '<div class="meta"><span>→ ' + esc(t.assignedName) + '</span><span>' + fmtDShort(t.due) + '</span></div></div>').join('') + '</div>'
      : '<div class="pnl"><div class="empty">Nothing in this list.</div></div>');
};

/* =================== STAFF & ROLES =================== */
PAGES.staff = function () {
  const f = UI.filters.staff;
  const all = DB.staff;
  const byDept = d => all.filter(s => s.dept.toLowerCase() === d);
  const list = f === 'all' ? all : byDept(f);
  const totalPay = all.reduce((t, s) => t + s.basic + s.housing + s.transport, 0);

  return '<div class="stats">' +
    statCard({ label: 'Total staff', value: all.length, tone: 'money', onclick: "drill('staff.total')", sub: all.filter(s => s.empType === 'Full time').length + ' full time · ' + DB.roles.length + ' roles' }) +
    statCard({ label: 'On the floor now', value: Q.onFloorNow(), tone: 'good', onclick: "drill('staff.onfloor')", sub: 'Clocked in and not out yet' }) +
    statCard({ label: 'Late today', value: Q.lateToday(), tone: Q.lateToday() ? 'warn' : 'good', onclick: "drill('staff.late')", sub: 'Clocked in after 09:00' }) +
    statCard({ label: 'On leave today', value: Q.onLeaveToday(), tone: 'info', onclick: "drill('staff.leave')", sub: DB.leave.filter(l => l.status === 'pending').length + ' requests pending' }) +
    statCard({ label: 'Monthly payroll', value: moneyShort(totalPay), tone: 'money', onclick: "drill('pay.gross')", sub: 'Gross before bonuses' }) +
    '</div>' +
    '<div class="bar">' + tabBar('staff', [
      { k: 'all', t: 'All staff', n: all.length },
      { k: 'management', t: 'Management', n: byDept('management').length },
      { k: 'support', t: 'Support', n: byDept('support').length },
      { k: 'finance', t: 'Finance', n: byDept('finance').length },
      { k: 'product', t: 'Product', n: byDept('product').length },
      { k: 'operations', t: 'Operations', n: byDept('operations').length }
    ]) + '<span class="spacer"></span>' +
    '<button class="btn" onclick="exportStaff()">Export CSV</button>' +
    '<button class="btn gold" onclick="formInviteStaff()">+ Invite staff</button></div>' +

    '<div class="pnl"><div class="ph"><div><h3>Team</h3>' +
    '<div class="ph-sub">Tap anyone to open their full record: profile, pay, payslips, attendance, leave and documents</div></div></div>' +
    '<div class="tw"><table><thead><tr><th>Name</th><th>Department</th><th>Role</th><th>Today</th>' +
    '<th class="num">Attendance 30d</th><th class="num">Monthly gross</th><th>Status</th><th></th></tr></thead><tbody>' +
    list.map(s => {
      const a = Q.attToday(s.id);
      const todayCell = !a ? '<span class="note">—</span>'
        : a.state === 'leave' ? statusPill('leave')
          : a.state === 'absent' ? statusPill('absent')
            : a.in && !a.out ? '<span class="pill green">In since ' + a.in + '</span>'
              : a.in ? '<span class="note">' + a.in + '–' + a.out + '</span>' : '<span class="note">—</span>';
      return '<tr class="klik" onclick="openDetail(\'staff\',' + s.id + ')">' +
        '<td><div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + s.staffId + ' · ' + s.username + '</div></td>' +
        '<td>' + s.dept + '</td><td>' + s.title + '</td>' +
        '<td>' + todayCell + '</td>' +
        '<td class="num">' + Q.attRate(s.id) + '%</td>' +
        '<td class="num">' + money(s.basic + s.housing + s.transport) + '</td>' +
        '<td>' + statusPill(s.status) + '</td><td class="chev">&rsaquo;</td></tr>';
    }).join('') + '</tbody></table></div></div>' +

    '<div class="cols"><div class="pnl"><div class="ph"><div><h3>Attendance today</h3>' +
    '<div class="ph-sub">Clock people in and out from their profile, or right here</div></div>' +
    '<span class="note">' + fmtD(DB.today) + '</span></div>' +
    '<div class="tw"><table><thead><tr><th>Staff</th><th>In</th><th>Out</th><th class="num">Hours</th><th>State</th><th></th></tr></thead><tbody>' +
    all.map(s => {
      const a = Q.attToday(s.id);
      return '<tr><td class="t-main">' + esc(s.name) + '</td>' +
        '<td>' + (a && a.in ? a.in : '<span class="note">—</span>') + '</td>' +
        '<td>' + (a && a.out ? a.out : (a && a.in ? '<span class="pill green">on floor</span>' : '<span class="note">—</span>')) + '</td>' +
        '<td class="num">' + (a && a.hours ? a.hours : '—') + '</td>' +
        '<td>' + (a ? statusPill(a.state) : '<span class="note">not recorded</span>') + '</td>' +
        '<td>' + (!a || !a.in
          ? '<button class="btn sm" onclick="clockIn(' + s.id + ')">Clock in</button>'
          : (!a.out ? '<button class="btn sm" onclick="clockOut(' + s.id + ')">Clock out</button>'
            : '<span class="note">done</span>')) + '</td></tr>';
    }).join('') + '</tbody></table></div></div>' +
    '<div class="pnl"><div class="ph"><h3>Headcount by department</h3></div>' +
    hBars(['Management', 'Finance', 'Support', 'Product', 'Operations'].map((d, i) => ({
      label: d, value: all.filter(s => s.dept === d).length,
      color: ['var(--gold)', 'var(--green)', 'var(--blue)', 'var(--purple)', 'var(--amber)'][i],
      onclick: "setFilter('staff','" + d.toLowerCase() + "')"
    }))) +
    '<div class="sec-t">Leave requests</div>' +
    (DB.leave.filter(l => l.status === 'pending').length
      ? DB.leave.filter(l => l.status === 'pending').slice(0, 5).map(l => '<div class="row klik" onclick="openDetail(\'staff\',' + l.staffId + ')">' +
        '<div><b>' + esc((Q.staffM(l.staffId) || {}).name) + '</b><small>' + l.type + ' · ' + l.days + ' days · ' + fmtDShort(l.from) + '</small></div>' +
        '<span class="pill amber">Pending</span></div>').join('')
      : '<div class="note">No pending requests.</div>') +
    '</div></div>';
};

/* =================== ACTIVITY LOG =================== */
PAGES.activity = function () {
  const f = UI.filters.activity;
  let list = DB.activity.slice();
  if (f !== 'all') list = list.filter(a => a.kind === f);
  if (UI.search) { const q = UI.search.toLowerCase(); list = list.filter(a => a.detail.toLowerCase().includes(q) || a.actor.toLowerCase().includes(q)); }
  const kinds = [['all', 'Everything'], ['plan_change', 'Plan changes'], ['refund', 'Refunds'],
    ['role_change', 'Permission changes'], ['payroll', 'Payroll'], ['slip_publish', 'Payslips'],
    ['account_view', 'Account access'], ['export', 'Exports'], ['login', 'Sign-ins'], ['announce', 'Announcements']];

  return '<div class="stats">' +
    statCard({ label: 'Entries logged', value: DB.activity.length, tone: 'money', sub: 'Last 21 days' }) +
    statCard({ label: 'In ' + PERIOD.label.toLowerCase(), value: DB.activity.filter(a => inPeriod(a.at)).length, tone: 'info', sub: 'Actions inside the selected period' }) +
    statCard({ label: 'Money-touching', value: DB.activity.filter(a => ['refund', 'plan_change', 'payroll'].includes(a.kind)).length, tone: 'warn', sub: 'Refunds, plan changes, payroll' }) +
    statCard({ label: 'Permission changes', value: DB.activity.filter(a => a.kind === 'role_change').length, tone: 'bad', sub: 'Who can see what' }) +
    '</div>' +
    '<div class="bar">' +
    kinds.map(k => '<button class="tab' + (f === k[0] ? ' on' : '') + '" onclick="setFilter(\'activity\',\'' + k[0] + '\')">' + k[1] + '</button>').join('') +
    '<span class="spacer"></span><button class="btn" onclick="exportActivity()">Export CSV</button></div>' +
    '<div class="pnl"><div class="ph"><div><h3>Platform audit log</h3>' +
    '<div class="ph-sub">Tap any entry for the full record: who, when, from where, on what, and why</div></div></div>' +
    (list.length ? '<div class="tw"><table><thead><tr><th>Action</th><th>Detail</th><th>Who</th><th>When</th><th></th></tr></thead><tbody>' +
      list.slice(0, 120).map(a => '<tr class="klik" onclick="openDetail(\'audit\',' + a.id + ')">' +
        '<td class="t-main">' + a.action + '</td>' +
        '<td style="white-space:normal;max-width:340px">' + esc(a.detail) + '</td>' +
        '<td><div class="t-main">' + esc(a.actor) + '</div><div class="t-sub">' + a.actorRole + '</div></td>' +
        '<td>' + ago(a.at) + '</td><td class="chev">&rsaquo;</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="empty">Nothing logged for that filter.</div>') + '</div>';
};

/* =================== SETTINGS =================== */
PAGES.settings = function () {
  const s = DB.settings;
  const ic = (bg, path) => '<div class="sgrp-ic" style="background:' + bg + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg></div>';

  const grp = (open, iconHtml, title, desc, body) =>
    '<details class="sgrp"' + (open ? ' open' : '') + '><summary class="sgrp-h">' + iconHtml +
    '<div><div class="sgrp-t">' + title + '</div><div class="sgrp-d">' + desc + '</div></div>' +
    '<span class="sgrp-cv">&rsaquo;</span></summary><div class="sgrp-b">' + body + '</div></details>';

  /* --- appearance --- */
  const appearance =
    '<div class="sec-t">Theme</div>' +
    '<div class="chips">' +
    '<button class="chip' + (!document.body.classList.contains('light') ? ' on' : '') + '" onclick="setTheme(\'dark\')">Black</button>' +
    '<button class="chip' + (document.body.classList.contains('light') ? ' on' : '') + '" onclick="setTheme(\'light\')">White</button>' +
    '</div>' +
    '<div class="sec-t">Install</div>' +
    '<p class="note">Add the Admin Control Centre to your home screen or desktop so it opens like an app and keeps working ' +
    'when the connection drops. Use your browser menu and choose Install, or Add to Home Screen.</p>';

  /* --- platform --- */
  const platform =
    kvEdit('Platform name', s.platformName, "editSetting('platformName','Platform name','text')") +
    kvEdit('Default currency', s.currency + ' ₦', "editSetting('currency','Default currency','text')") +
    kvEdit('Trial length', s.trialDays + ' days', "editSetting('trialDays','Trial length in days','number')") +
    kvEdit('Support SLA', s.slaHours + ' hours', "editSetting('slaHours','Support SLA in hours','number')") +
    kvEdit('Referral commission', s.referralPct + '% of first month', "editSetting('referralPct','Referral commission %','number')") +
    kvEdit('Tax rate', s.taxPct + '% VAT', "editSetting('taxPct','Tax rate %','number')");

  /* --- company --- */
  const company =
    kvEdit('Invoice prefix', s.invoicePrefix, "editSetting('invoicePrefix','Invoice prefix','text')") +
    kvEdit('Settlement account', s.bank, "editSetting('bank','Settlement account','text')") +
    '<div class="sec-t">Numbering</div>' +
    '<p class="note">Invoices run as ' + s.invoicePrefix + '-00001 upward. Changing the prefix affects new invoices only, ' +
    'never ones already issued.</p>';

  /* --- team accounts --- */
  const accounts =
    '<p class="note">Each person signs in with their own username and password. The role controls what they can see and do.</p>' +
    '<div style="margin-top:12px">' +
    DB.staff.map(st => {
      const r = Q.role(st.roleId) || { name: '—' };
      return '<div class="row klik" onclick="openDetail(\'staff\',' + st.id + ')" style="border-left:3px solid ' +
        (st.roleId === 'owner' ? 'var(--gold)' : 'var(--green)') + ';padding-left:10px">' +
        '<div><b>' + esc(st.name) + ' <span class="pill grey">' + r.name + '</span></b>' +
        '<small>' + st.username + ' · ' + st.email + '</small></div>' +
        '<button class="btn sm" onclick="event.stopPropagation();formStaffRole(' + st.id + ')">Change role</button></div>';
    }).join('') + '</div>' +
    '<button class="btn gold" style="margin-top:14px" onclick="formInviteStaff()">+ Add account</button>';

  /* --- roles & permissions (editable) --- */
  const roles =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
    '<p class="note" style="flex:1;min-width:220px">Tap a page or a permission to turn it on (green) or off. ' +
    'Changes save straight away and apply the next time that person loads the portal.</p>' +
    '<div style="display:flex;gap:8px"><button class="btn" onclick="resetRoles()">Reset</button>' +
    '<button class="btn gold" onclick="formNewRole()">+ New role</button></div></div>' +
    '<div style="margin-top:14px">' + DB.roles.map(r => roleCard(r)).join('') + '</div>';

  /* --- notifications --- */
  const n = s.notify;
  const notif =
    '<div class="sec-t">Sound</div>' +
    '<div class="chips">' + ['chime', 'ping', 'marimba', 'bell', 'silent'].map(x =>
      '<button class="chip' + (n.sound === x ? ' on' : '') + '" onclick="setNotify(\'sound\',\'' + x + '\')">' +
      x.charAt(0).toUpperCase() + x.slice(1) + '</button>').join('') + '</div>' +
    '<div class="sec-t">Volume</div>' +
    '<input class="rng" type="range" min="0" max="100" value="' + n.volume + '" oninput="setNotify(\'volume\',+this.value)">' +
    '<div class="sec-t">Alert me when</div>' +
    [['payment', 'A payment comes in'], ['failed', 'A payment fails'], ['signup', 'A new subscriber signs up'],
     ['ticket', 'A support ticket is opened'], ['churn', 'An account churns'], ['payroll', 'A payroll run is due']]
      .map(a => '<div class="row"><div><b>' + a[1] + '</b></div>' +
        '<div class="tog' + (n.alerts[a[0]] ? ' on' : '') + '" onclick="toggleAlert(\'' + a[0] + '\')"><i></i></div></div>').join('') +
    '<div class="row"><div><b>Pop-up notifications</b><small>Desktop and phone alerts while the portal is open</small></div>' +
    '<div class="tog' + (n.popups ? ' on' : '') + '" onclick="setNotify(\'popups\',' + (!n.popups) + ')"><i></i></div></div>';

  /* --- integrations --- */
  const integ = s.integrations.map(i =>
    '<div class="row"><div><b>' + i.name + '</b><small>' + i.detail + '</small></div>' +
    (i.state === 'connected' ? statusPill('connected') : '<button class="btn sm">Set up</button>') + '</div>').join('');

  /* --- data --- */
  const data =
    '<div class="sec-t">Export</div>' +
    '<div class="chips">' +
    '<button class="chip" onclick="exportSubscribers()">Subscribers</button>' +
    '<button class="chip" onclick="exportPayments()">Payments</button>' +
    '<button class="chip" onclick="exportPayroll()">Payroll</button>' +
    '<button class="chip" onclick="exportStaff()">Staff</button>' +
    '<button class="chip" onclick="exportActivity()">Audit log</button></div>' +
    '<div class="sec-t">Reset</div>' +
    '<p class="note">Clears every local change you have made in this prototype — role edits, platform settings, ' +
    'clock-ins and published payslips — and puts the demo dataset back the way it started. It does not touch anything ' +
    'outside this browser.</p>' +
    '<button class="btn danger" style="margin-top:10px" onclick="resetAll()">Reset this prototype</button>';

  return '<div style="max-width:1000px">' +
    grp(false, ic('rgba(139,124,246,.16)', '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>'), 'Appearance &amp; app', 'Theme, install', appearance) +
    grp(false, ic('rgba(90,159,212,.16)', '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-7h6v7"/>'), 'Platform', 'Name, currency, trial, SLA, referral rate', platform) +
    grp(false, ic('rgba(63,157,120,.16)', '<path d="M14 3v5h5"/><path d="M19 21H5V3h9l5 5z"/>'), 'Company &amp; invoices', 'Numbering, settlement account', company) +
    grp(true, ic('rgba(233,150,190,.16)', '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6h5M18.5 3.5v5"/>'), 'Team &amp; notifications', 'Accounts, roles, alerts',
      '<div class="sec-t">Team accounts</div>' + accounts +
      '<div class="sec-t" style="margin-top:26px">Roles &amp; permissions</div>' + roles +
      '<div class="sec-t" style="margin-top:26px">Notifications</div>' + notif) +
    grp(false, ic('rgba(211,163,74,.16)', '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'), 'Integrations', 'Supabase, payments, email, WhatsApp', integ) +
    grp(false, ic('rgba(120,128,143,.16)', '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/>'), 'Data &amp; storage', 'Export, reset', data) +
    '</div>';
};

function kvEdit(k, v, onclick) {
  return '<div class="kv klik" style="cursor:pointer" onclick="' + onclick + '">' +
    '<span class="k">' + k + '</span><span class="v">' + esc(v) + ' <span class="chev">&rsaquo;</span></span></div>';
}

/* One role open at a time. All six expanded put 157 chips on screen at once,
   which reads as noise rather than as a control. */
function roleCard(r) {
  const pages = DB.pages, caps = DB.caps;
  const assigned = DB.staff.filter(s => s.roleId === r.id).length;
  const open = UI.openRole === r.id;

  const summary = r.locked
    ? 'Full access, always on'
    : r.pages.length + ' of ' + pages.length + ' pages · ' + r.caps.length + ' of ' + caps.length + ' permissions';

  return '<div class="rolecard">' +
    '<div class="rolehead" style="cursor:pointer" onclick="toggleRoleOpen(\'' + r.id + '\')">' +
    '<div class="roleav">' + r.name[0] + '</div>' +
    '<div style="flex:1"><div class="rolename">' + r.name +
    ' <span class="roletag">' + (r.builtin ? 'built-in' : 'custom') + '</span></div>' +
    '<div class="roledesc">' + summary + ' · ' + assigned + ' account' + (assigned === 1 ? '' : 's') + '</div></div>' +
    '<span class="sgrp-cv" style="transform:rotate(' + (open ? 90 : 0) + 'deg)">&rsaquo;</span></div>' +

    (!open ? '' :
      '<div style="margin-top:6px">' +
      (r.locked
        ? '<p class="note">Full access, always on and cannot be limited. Every page and every permission is granted, and that cannot be changed — there has to be one account that can always get back in.</p>'
        : '<div class="band">Pages this role can open</div><div class="chips">' +
        pages.map(p => '<button class="chip' + (r.pages.includes(p[0]) ? ' on' : '') + '" onclick="togglePage(\'' + r.id + '\',\'' + p[0] + '\')">' + p[1] + '</button>').join('') +
        '</div><div class="band">What this role can do</div><div class="chips">' +
        caps.map(c => '<button class="chip' + (r.caps.includes(c[0]) ? ' on' : '') + '" onclick="toggleCap(\'' + r.id + '\',\'' + c[0] + '\')">' + c[1] + '</button>').join('') +
        '</div>') +
      (assigned ? '<div class="band">Held by</div><div class="chips">' +
        DB.staff.filter(s => s.roleId === r.id).map(s =>
          '<button class="chip" onclick="openDetail(\'staff\',' + s.id + ')">' + esc(s.name) + ' &rsaquo;</button>').join('') +
        '</div>' : '') +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
      (r.locked ? '' : '<button class="btn sm" onclick="renameRole(\'' + r.id + '\')">Rename</button>') +
      (r.builtin ? '' : '<button class="btn sm danger" onclick="deleteRole(\'' + r.id + '\')">Delete</button>') +
      '</div></div>') +
    '</div>';
}
function toggleRoleOpen(id) { UI.openRole = (UI.openRole === id ? null : id); render(); }
