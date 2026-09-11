/* ============================================================
   core.js — period engine, derived stats, chart builders,
   router, modal, toast, CSV/file download
   ============================================================ */

const UI = {
  page: 'dashboard',
  detail: null,               // {type,id} — when set, the detail view renders
  back: 'dashboard',
  filters: {                  // per-page sub-tab state
    subscribers: 'all', payments: 'all', announcements: 'published',
    tasks: 'mine', staff: 'all', support: 'tickets', feedback: 'all', enquiries: 'new',
    onboarding: 'all', activity: 'all'
  },
  sort: { subscribers: 'name', payments: 'date-desc', payroll: 'net-desc', activity: 'newest' },
  dashPanel: 0,               // which of the four dashboard panels shows on a phone
  search: '',
  q: {},                      // per-page search boxes
  vtab: {},                   // detail-view vertical tab state
  chartRange: {},             // per-chart time window, independent of the page period
  collapsed: {},              // collapsible sections
  openRole: null,
  planFilter: 'any'
};

/* ---------------- per-chart time ranges ----------------
   Charts get their own window so you can look at years of progression without
   changing the page period, which drives the cards and tables. */
const CHART_RANGES = [
  ['30d', '30 days'], ['3m', '3 months'], ['12m', '12 months'],
  ['3y', '3 years'], ['all', 'All time']
];
function chartRange(key, dflt) { return UI.chartRange[key] || dflt || '12m'; }
function setChartRange(key, r) { UI.chartRange[key] = r; render(); }
function chartRangeBar(key, dflt) {
  const cur = chartRange(key, dflt);
  return '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
    CHART_RANGES.map(r => '<button class="tab' + (cur === r[0] ? ' on' : '') +
      '" style="padding:5px 9px;font-size:11px" onclick="setChartRange(\'' + key + '\',\'' + r[0] + '\')">' +
      r[1] + '</button>').join('') + '</div>';
}

/* buckets for a range: [{from,to,label}] */
function rangeBuckets(range) {
  const t = DB.today, out = [];
  const mLabel = d => d.toLocaleDateString('en-GB', { month: 'short' });
  const myLabel = d => d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

  if (range === '30d') {
    for (let i = 29; i >= 0; i--) {
      const d = startOfDay(new Date(t.getTime() - i * DAY));
      out.push({ from: d, to: endOfDay(d), label: fmtDShort(d) });
    }
  } else if (range === '3m') {
    for (let i = 12; i >= 0; i--) {                      // 13 weeks
      const end = endOfDay(new Date(t.getTime() - i * 7 * DAY));
      const from = startOfDay(new Date(end.getTime() - 6 * DAY));
      out.push({ from, to: end, label: fmtDShort(from) });
    }
  } else if (range === '12m' || range === '3y') {
    const months = range === '12m' ? 12 : 36;
    for (let i = months - 1; i >= 0; i--) {
      const from = new Date(t.getFullYear(), t.getMonth() - i, 1);
      const to = new Date(t.getFullYear(), t.getMonth() - i + 1, 0, 23, 59, 59);
      out.push({ from, to, label: months > 12 ? myLabel(from) : mLabel(from) });
    }
  } else {                                               // all time, by quarter
    const first = DB.payments.reduce((m, p) => p.date < m ? p.date : m, '9999-99-99');
    let d = parseD(first); d = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
    while (d <= t) {
      const to = new Date(d.getFullYear(), d.getMonth() + 3, 0, 23, 59, 59);
      out.push({ from: new Date(d), to, label: 'Q' + (Math.floor(d.getMonth() / 3) + 1) + " '" + String(d.getFullYear()).slice(2) });
      d = new Date(d.getFullYear(), d.getMonth() + 3, 1);
    }
  }
  return out;
}
/* revenue actually collected, bucketed */
function revenueSeriesFor(range) {
  return rangeBuckets(range).map(b => ({
    label: b.label,
    value: DB.payments.filter(p => p.status === 'successful' && parseD(p.date) >= b.from && parseD(p.date) <= b.to)
      .reduce((t, p) => t + p.amount, 0)
  }));
}
/* cumulative subscriber count at the end of each bucket */
function growthSeriesFor(range) {
  return rangeBuckets(range).map(b => ({
    label: b.label,
    value: DB.subscribers.filter(s => parseD(s.joined) <= b.to).length
  }));
}
/* MRR as it stood at the end of each bucket */
function mrrSeriesFor(range) {
  return rangeBuckets(range).map(b => ({
    label: b.label,
    value: DB.subscribers.filter(s => s.status === 'active' && parseD(s.joined) <= b.to)
      .reduce((t, s) => t + s.mrr, 0)
  }));
}

/* ---------------- period ---------------- */
const PERIOD = {
  key: 'today',
  from: null, to: null,
  label: 'Today'
};

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

function setPeriod(key, from, to) {
  const t = DB.today;
  PERIOD.key = key;
  if (key === 'today') { PERIOD.from = startOfDay(t); PERIOD.to = endOfDay(t); PERIOD.label = 'Today'; }
  else if (key === 'yesterday') { const y = new Date(t.getTime() - DAY); PERIOD.from = startOfDay(y); PERIOD.to = endOfDay(y); PERIOD.label = 'Yesterday'; }
  else if (key === 'week') { const d = new Date(t); const dow = (d.getDay() + 6) % 7; PERIOD.from = startOfDay(new Date(d.getTime() - dow * DAY)); PERIOD.to = endOfDay(t); PERIOD.label = 'This week'; }
  else if (key === 'month') { PERIOD.from = startOfDay(new Date(t.getFullYear(), t.getMonth(), 1)); PERIOD.to = endOfDay(t); PERIOD.label = 'This month'; }
  else if (key === 'quarter') { const q = Math.floor(t.getMonth() / 3) * 3; PERIOD.from = startOfDay(new Date(t.getFullYear(), q, 1)); PERIOD.to = endOfDay(t); PERIOD.label = 'This quarter'; }
  else if (key === 'year') { PERIOD.from = startOfDay(new Date(t.getFullYear(), 0, 1)); PERIOD.to = endOfDay(t); PERIOD.label = 'This year'; }
  else if (key === 'last30') { PERIOD.from = startOfDay(new Date(t.getTime() - 29 * DAY)); PERIOD.to = endOfDay(t); PERIOD.label = 'Last 30 days'; }
  else if (key === 'last12m') { PERIOD.from = startOfDay(new Date(t.getFullYear(), t.getMonth() - 11, 1)); PERIOD.to = endOfDay(t); PERIOD.label = 'Last 12 months'; }
  else if (key === 'all') { PERIOD.from = new Date(2000, 0, 1); PERIOD.to = endOfDay(t); PERIOD.label = 'All time'; }
  else if (key === 'custom') {
    PERIOD.from = startOfDay(parseD(from)); PERIOD.to = endOfDay(parseD(to));
    PERIOD.label = fmtDShort(PERIOD.from) + ' → ' + fmtDShort(PERIOD.to);
  }
}
setPeriod('today');

function inPeriod(dateLike) {
  if (!dateLike) return false;
  const d = parseD(dateLike);
  return d >= PERIOD.from && d <= PERIOD.to;
}
/* previous window of the same length, for comparisons */
function prevWindow() {
  const span = PERIOD.to - PERIOD.from;
  return { from: new Date(PERIOD.from - span - 1), to: new Date(PERIOD.from - 1) };
}
function inPrev(dateLike) {
  if (!dateLike) return false;
  const p = prevWindow(); const d = parseD(dateLike);
  return d >= p.from && d <= p.to;
}
function periodDays() { return Math.max(1, Math.round((PERIOD.to - PERIOD.from) / DAY)); }

/* ---------------- derived stats (single source of truth) ---------------- */
const Q = {
  /* subscribers as they stood at the end of the selected period */
  subsAsOf() { return DB.subscribers.filter(s => parseD(s.joined) <= PERIOD.to); },
  subsAsOfPrev() { const p = prevWindow(); return DB.subscribers.filter(s => parseD(s.joined) <= p.to); },
  newSubs() { return DB.subscribers.filter(s => inPeriod(s.joined)); },
  newSubsPrev() { return DB.subscribers.filter(s => inPrev(s.joined)); },
  active() { return Q.subsAsOf().filter(s => s.status === 'active'); },
  trial() { return Q.subsAsOf().filter(s => s.status === 'trial'); },
  /* A trial still running, and one whose date has passed with nobody doing anything about
     it. They were the same list, so a trial that ended a week ago read as ending today and
     then dropped off the alerts entirely once it was four days old. That is a business that
     tried the software, was never asked for the money, and is still using it. */
  trialEnding() { return Q.trial().filter(s => s.renewIn >= 0 && s.renewIn <= 4); },
  trialEnded() { return Q.trial().filter(s => s.renewIn < 0).sort((a, b) => a.renewIn - b.renewIn); },
  expired() { return Q.subsAsOf().filter(s => s.status === 'expired'); },
  renewing() { return Q.active().filter(s => s.renewIn >= 0 && s.renewIn <= 7); },
  pastDue() { return Q.active().filter(s => s.pastDue); },
  atRisk() { return Q.subsAsOf().filter(s => s.health === 'at-risk'); },

  mrr() { return Q.active().reduce((t, s) => t + s.mrr, 0); },
  mrrPrev() {
    const p = prevWindow();
    return DB.subscribers.filter(s => s.status === 'active' && parseD(s.joined) <= p.to)
      .reduce((t, s) => t + s.mrr, 0);
  },
  arr() { return Q.mrr() * 12; },
  arpu() { const a = Q.active().length; return a ? Q.mrr() / a : 0; },
  /* What they were actually paying, which is s.mrr, not what their plan lists today. The
     old reading lost every Bespoke subscriber from churn entirely (list price zero), and
     mis-stated anyone on an annual cycle or on a price that has since moved. */
  churnedMrr() {
    return Q.expired().filter(s => inPeriod(s.renewsOn) || PERIOD.key === 'all' || PERIOD.key === 'last12m' || PERIOD.key === 'year')
      .reduce((t, s) => t + (+s.mrr || 0), 0);
  },

  payments(status) {
    let list = DB.payments.filter(p => inPeriod(p.date));
    if (status && status !== 'all') list = list.filter(p => p.status === status);
    return list;
  },
  paymentsAll(status) {
    let list = DB.payments.slice();
    if (status && status !== 'all') list = list.filter(p => p.status === status);
    return list;
  },
  revenue() { return Q.payments('successful').reduce((t, p) => t + p.amount, 0); },
  revenuePrev() {
    return DB.payments.filter(p => p.status === 'successful' && inPrev(p.date)).reduce((t, p) => t + p.amount, 0);
  },
  failedValue() { return Q.payments('failed').reduce((t, p) => t + p.amount, 0); },

  tickets(state) {
    let l = DB.tickets.slice();
    if (state === 'open') l = l.filter(t => t.state === 'open');
    else if (state === 'in-progress') l = l.filter(t => t.state === 'in-progress');
    else if (state === 'urgent') l = l.filter(t => t.state === 'urgent');
    else if (state === 'resolved') l = l.filter(t => t.state === 'resolved');
    return l;
  },
  openTickets() { return DB.tickets.filter(t => t.state !== 'resolved'); },
  urgentTickets() { return DB.tickets.filter(t => t.state === 'urgent'); },
  resolvedToday() { return DB.tickets.filter(t => t.resolvedAt && inPeriod(t.resolvedAt)); },
  avgFirstReply() {
    const l = DB.tickets; if (!l.length) return 0;
    return Math.round(l.reduce((t, x) => t + x.firstReplyMins, 0) / l.length);
  },
  satisfaction() {
    const l = DB.tickets.filter(t => t.satisfaction);
    if (!l.length) return 0;
    return Math.round(l.reduce((t, x) => t + x.satisfaction, 0) / l.length / 5 * 100);
  },

  planSplit() {
    const subs = Q.subsAsOf();
    return ['premium', 'pro', 'starter', 'trial'].map(id => {
      const p = planById(id);
      const list = subs.filter(s => s.plan === id);
      const activeList = list.filter(s => s.status === 'active');
      return {
        id, name: p.name, count: list.length,
        active: activeList.length,
        mrr: activeList.reduce((t, s) => t + s.mrr, 0),
        share: pct(list.length, subs.length)
      };
    });
  },

  /* daily revenue series across the current period (or last 30d if period is a single day) */
  revenueSeries() {
    let from = PERIOD.from, to = PERIOD.to;
    let days = Math.round((to - from) / DAY) + 1;
    if (days < 7) { to = PERIOD.to; from = new Date(to.getTime() - 29 * DAY); days = 30; }
    const buckets = [];
    const monthly = days > 92;
    if (monthly) {
      const months = Math.min(18, Math.round(days / 30));
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(to.getFullYear(), to.getMonth() - i, 1);
        const nd = new Date(to.getFullYear(), to.getMonth() - i + 1, 1);
        const v = DB.payments.filter(p => p.status === 'successful' && parseD(p.date) >= d && parseD(p.date) < nd)
          .reduce((t, p) => t + p.amount, 0);
        buckets.push({ label: d.toLocaleDateString('en-GB', { month: 'short' }), value: v });
      }
    } else {
      for (let i = days - 1; i >= 0; i--) {
        const d = startOfDay(new Date(to.getTime() - i * DAY));
        const e = endOfDay(d);
        const v = DB.payments.filter(p => p.status === 'successful' && parseD(p.date) >= d && parseD(p.date) <= e)
          .reduce((t, p) => t + p.amount, 0);
        buckets.push({ label: fmtDShort(d), value: v });
      }
    }
    return buckets;
  },

  /* cumulative subscriber growth, last 6 months */
  growthSeries(months) {
    months = months || 6;
    const out = [];
    for (let i = months - 1; i >= 0; i--) {
      const end = new Date(DB.today.getFullYear(), DB.today.getMonth() - i + 1, 0, 23, 59, 59);
      out.push({
        label: end.toLocaleDateString('en-GB', { month: 'short' }),
        value: DB.subscribers.filter(s => parseD(s.joined) <= end).length
      });
    }
    return out;
  },

  usageSeries(field) { return DB.usage.series.map(d => ({ label: fmtDShort(d.date), value: d[field] })); },

  /* payroll */
  currentRun() { return DB.payrollRuns[0]; },
  runByKey(k) { return DB.payrollRuns.find(r => r.monthKey === k); },
  slipsFor(key) { return DB.payslips.filter(s => s.monthKey === key); },
  slipsForStaff(id) { return DB.payslips.filter(s => s.staffId === id); },

  /* attendance */
  attFor(staffId, days) {
    const cut = new Date(DB.today.getTime() - (days || 30) * DAY);
    return DB.attendance.filter(a => a.staffId === staffId && parseD(a.date) >= cut)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  attRate(staffId) {
    const l = Q.attFor(staffId, 30).filter(a => a.state !== 'leave');
    if (!l.length) return 0;
    return Math.round(l.filter(a => a.state === 'present' || a.state === 'late').length / l.length * 100);
  },
  attToday(staffId) { return DB.attendance.find(a => a.staffId === staffId && a.date === iso(DB.today)); },
  onFloorNow() { return DB.staff.filter(s => { const a = Q.attToday(s.id); return a && a.in && !a.out; }).length; },
  lateToday() { return DB.staff.filter(s => { const a = Q.attToday(s.id); return a && a.state === 'late'; }).length; },
  onLeaveToday() { return DB.staff.filter(s => { const a = Q.attToday(s.id); return a && a.state === 'leave'; }).length; },
  leaveFor(staffId) { return DB.leave.filter(l => l.staffId === staffId); },
  leaveTaken(staffId) { return Q.leaveFor(staffId).filter(l => l.status === 'approved' && parseD(l.to) <= DB.today).reduce((t, l) => t + l.days, 0); },

  /* misc */
  /* Compared as text, not coerced with +id. Example subscribers have numeric
     ids and live ones are namespaced strings like "live-<uuid>", and +"live-…"
     is NaN — so a real studio was never found and its detail panel said
     "Subscriber not found." String() matches both without either having to
     pretend to be the other. */
  sub(id) { return DB.subscribers.find(s => String(s.id) === String(id)); },
  staffM(id) { return DB.staff.find(s => String(s.id) === String(id)); },
  role(id) { return DB.roles.find(r => r.id === id); },
  ticket(id) { return DB.tickets.find(t => String(t.id) === String(id)); },
  refCommissionTotal() { return DB.subscribers.reduce((t, s) => t + (s.referralEarned || 0), 0); },
  tasksFor(f) {
    if (f === 'mine') return DB.tasks.filter(t => t.assignedTo === 1 || t.createdBy === 1);
    if (f === 'overdue') return DB.tasks.filter(t => !t.done && t.dueIn < 0);
    if (f === 'done') return DB.tasks.filter(t => t.done);
    return DB.tasks;
  },
  activity(kind) {
    let l = DB.activity.slice();
    if (kind && kind !== 'all') l = l.filter(a => a.kind === kind);
    return l;
  }
};

/* ---------------- chart builders ---------------- */
function areaChart(data, opts) {
  opts = opts || {};
  const W = 760, H = opts.height || 200, PL = 52, PR = 8, PT = 10, PB = 24;
  const iw = W - PL - PR, ih = H - PT - PB;
  const vals = data.map(d => d.value);
  const max = Math.max(1, ...vals) * 1.12;
  const color = opts.color || 'var(--gold)';
  const gid = 'gr' + Math.random().toString(36).slice(2, 8);
  const x = i => PL + (data.length <= 1 ? iw / 2 : i * iw / (data.length - 1));
  const y = v => PT + ih - (v / max) * ih;

  let line = '', area = '', dots = '';
  data.forEach((d, i) => {
    line += (i ? ' L' : 'M') + x(i).toFixed(1) + ' ' + y(d.value).toFixed(1);
  });
  area = line + ' L' + x(data.length - 1).toFixed(1) + ' ' + (PT + ih) + ' L' + x(0).toFixed(1) + ' ' + (PT + ih) + ' Z';
  if (data.length <= 40) {
    data.forEach((d, i) => {
      dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(d.value).toFixed(1) + '" r="3" fill="' + color +
        '"><title>' + d.label + ': ' + (opts.money ? money(d.value) : d.value) + '</title></circle>';
    });
  }
  // y gridlines + labels
  let grid = '';
  const steps = 4;
  for (let g = 0; g <= steps; g++) {
    const v = max / steps * g, yy = y(v);
    grid += '<line class="cgrid" x1="' + PL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + yy.toFixed(1) + '"/>';
    grid += '<text class="cx-lbl" x="' + (PL - 7) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end">' +
      (opts.money ? moneyShort(v) : Math.round(v)) + '</text>';
  }
  // x labels — thin out
  let xl = '';
  const every = Math.max(1, Math.ceil(data.length / 7));
  data.forEach((d, i) => {
    if (i % every === 0 || i === data.length - 1) {
      xl += '<text class="cx-lbl" x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + d.label + '</text>';
    }
  });

  return '<div class="chartbox"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + color + '" stop-opacity=".30"/>' +
    '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
    grid +
    '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
    '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots + xl + '</svg></div>';
}

function donut(segs, centreTop, centreSub) {
  const R = 62, SW = 17, C = 75;
  const total = segs.reduce((t, s) => t + s.value, 0) || 1;
  const circ = 2 * Math.PI * R;
  let off = 0, arcs = '';
  segs.forEach(s => {
    const frac = s.value / total;
    const len = frac * circ;
    arcs += '<circle cx="' + C + '" cy="' + C + '" r="' + R + '" fill="none" stroke="' + s.color +
      '" stroke-width="' + SW + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (circ - len).toFixed(2) + '" ' +
      'stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 ' + C + ' ' + C + ')" stroke-linecap="butt">' +
      '<title>' + s.label + ': ' + s.value + '</title></circle>';
    off += len;
  });
  const legend = segs.map(s =>
    '<div class="lg" ' + (s.onclick ? 'onclick="' + s.onclick + '"' : '') + '>' +
    '<i style="background:' + s.color + '"></i><span>' + s.label + '</span>' +
    '<span class="lv">' + s.value + ' (' + pct(s.value, total) + '%)</span></div>').join('');
  return '<div class="donutwrap"><svg viewBox="0 0 150 150">' +
    '<circle cx="' + C + '" cy="' + C + '" r="' + R + '" fill="none" stroke="var(--line-soft)" stroke-width="' + SW + '"/>' +
    arcs +
    '<text x="' + C + '" y="' + (C - 2) + '" text-anchor="middle" style="font-family:\'Playfair Display\',serif;font-size:24px;font-weight:600;fill:var(--text)">' + centreTop + '</text>' +
    '<text x="' + C + '" y="' + (C + 15) + '" text-anchor="middle" style="font-size:9px;fill:var(--faint);letter-spacing:1px;text-transform:uppercase">' + (centreSub || '') + '</text>' +
    '</svg><div class="legend" style="flex:1;min-width:170px">' + legend + '</div></div>';
}

function hBars(items, opts) {
  opts = opts || {};
  const max = Math.max(1, ...items.map(i => i.value));
  return items.map(i =>
    '<div class="hbar"' + (i.onclick ? ' style="cursor:pointer" onclick="' + i.onclick + '"' : '') + '>' +
    '<div class="hl">' + i.label + '</div>' +
    '<div class="ht"><i style="width:' + Math.max(2, i.value / max * 100).toFixed(1) + '%;background:' + i.color + '"></i></div>' +
    '<div class="hv">' + (opts.money ? moneyShort(i.value) : i.value) + '</div></div>'
  ).join('') +
    '<div style="display:flex;justify-content:space-between;margin-top:8px;padding-left:74px;padding-right:88px">' +
    '<span class="note">' + (opts.money ? '₦0' : '0') + '</span>' +
    '<span class="note">' + (opts.money ? moneyShort(max) : max) + '</span></div>';
}

/* ---------------- router ---------------- */
function go(page) {
  if (typeof canPage === 'function' && !canPage(page)) { refusePage(page); return; }
  UI.detail = null;
  UI.page = page;
  render();
  document.querySelector('.main').scrollTop = 0;
}
function refusePage(page) {
  const t = (typeof TITLES !== 'undefined' && TITLES[page]) ? TITLES[page][0] : page;
  modal('Not allowed', t,
    '<p class="note">Your role is <b>' + myRole().name + '</b>, which does not include the ' +
    '<b>' + t + '</b> page.</p>' +
    '<p class="hint">Whoever holds the Owner role can grant it in Settings &rarr; Team &amp; notifications ' +
    '&rarr; Roles &amp; permissions.</p>',
    '<button class="btn" onclick="closeModal()">Close</button>');
}
function openDetail(type, id) {
  UI.back = UI.page;
  UI.detail = { type: type, id: id };
  UI.vtab[type + id] = UI.vtab[type + id] || null;
  render();
  document.querySelector('.main').scrollTop = 0;
}
function goBack() {
  UI.detail = null;
  UI.page = UI.back || 'dashboard';
  render();
  document.querySelector('.main').scrollTop = 0;
}
/* The strip that picks between panels on a phone. Rendered always, shown by CSS
   only under 760px, so the desktop row of four is untouched. */
function swapTabs(labels) {
  return '<div class="swap-tabs">' + labels.map((l, i) =>
    '<button class="sw' + (UI.dashPanel === i ? ' on' : '') + '" onclick="setDashPanel(' + i + ')">' +
    l + '</button>').join('') + '</div>';
}
function setDashPanel(i) { UI.dashPanel = i; render(); }

function setFilter(page, val) { UI.filters[page] = val; render(); }
function setVTab(key, val) { UI.vtab[key] = val; render(); }

/* ---------------- modal ---------------- */
function modal(title, sub, bodyHtml, footHtml, wide) {
  document.getElementById('mask').innerHTML =
    '<div class="modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
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
  logAction('export', 'Data exported', 'Kayode Ojomo exported ' + name + ' as CSV');
  toast('Exported ' + name + '.csv');
}

/* ---------------- audit helper ---------------- */
function logAction(kind, action, detail, target) {
  DB.activity.unshift({
    id: Date.now(), kind, action, detail,
    actorId: 1, actor: 'Kayode Ojomo', actorRole: 'Super Admin',
    at: new Date().toISOString(), target: target || null,
    ip: '102.89.14.7', device: 'Chrome on Windows', reason: 'Admin action in this session'
  });
}

/* ---------------- small render helpers ---------------- */
function statCard(o) {
  return '<div class="st ' + (o.tone || '') + (o.onclick ? ' klik' : '') + '"' +
    (o.onclick ? ' onclick="' + o.onclick + '" role="button" tabindex="0"' : '') + '>' +
    (o.onclick ? '<span class="arrow">&rsaquo;</span>' : '') +
    '<div class="sl">' + o.label + '</div>' +
    '<div class="sv">' + o.value + '</div>' +
    '<div class="sd">' + (o.sub || '') + '</div></div>';
}
function tabBar(page, items) {
  return items.map(i =>
    '<button class="tab' + (UI.filters[page] === i.k ? ' on' : '') + '" onclick="setFilter(\'' + page + '\',\'' + i.k + '\')">' +
    i.t + (i.n !== undefined ? '<span class="n">' + i.n + '</span>' : '') + '</button>').join('');
}
/* Collapsible panel. Long tables fold away so what sits under them is
   reachable on a phone without scrolling past a hundred rows. */
function section(key, title, sub, body, startClosed) {
  if (UI.collapsed[key] === undefined) UI.collapsed[key] = !!startClosed;
  const closed = UI.collapsed[key];
  return '<div class="pnl">' +
    '<div class="ph klik" style="cursor:pointer;margin-bottom:' + (closed ? '0' : '14px') + '" onclick="toggleSection(\'' + key + '\')">' +
    '<div><h3>' + title + '</h3>' + (sub ? '<div class="ph-sub">' + sub + '</div>' : '') + '</div>' +
    '<span class="sgrp-cv" style="transform:rotate(' + (closed ? 0 : 90) + 'deg)">&rsaquo;</span></div>' +
    (closed ? '' : body) + '</div>';
}
function toggleSection(key) { UI.collapsed[key] = !UI.collapsed[key]; render(); }

function statusPill(s) {
  const map = {
    active: ['green', 'Active'], trial: ['amber', 'Trial'], expired: ['red', 'Expired'],
    successful: ['green', 'Successful'], failed: ['red', 'Failed'], pending: ['amber', 'Pending'],
    refunded: ['purple', 'Refunded'], overdue: ['red', 'Overdue'], upcoming: ['blue', 'Upcoming'],
    paid: ['green', 'Paid'], open: ['amber', 'Open'], 'in-progress': ['blue', 'In progress'],
    urgent: ['red', 'Urgent'], resolved: ['green', 'Resolved'], published: ['green', 'Published'],
    scheduled: ['amber', 'Scheduled'], draft: ['grey', 'Draft'], approved: ['green', 'Approved'],
    operational: ['green', 'Operational'], degraded: ['amber', 'Degraded'], down: ['red', 'Down'],
    connected: ['green', 'Connected'], setup: ['amber', 'Set up'], healthy: ['green', 'Healthy'],
    steady: ['blue', 'Steady'], 'at-risk': ['amber', 'At risk'], churned: ['red', 'Churned'],
    onboarding: ['blue', 'Onboarding'], present: ['green', 'Present'], late: ['amber', 'Late'],
    absent: ['red', 'Absent'], leave: ['blue', 'On leave'], ready: ['green', 'Ready'],
    new: ['amber', 'New'], closed: ['grey', 'Closed'], investigating: ['amber', 'Investigating']
  };
  const m = map[s] || ['grey', s];
  return '<span class="pill ' + m[0] + '">' + m[1] + '</span>';
}
function trend(now, prev, opts) {
  opts = opts || {};
  const unit = opts.unit || 'period';
  if (!prev && !now) return '<span class="note">nothing in the previous ' + unit + ' either</span>';
  if (!prev) return '<span class="up">new</span> — nothing in the previous ' + unit;
  if (!now) return '<span class="down">none</span> vs previous ' + unit;
  const d = pct(now - prev, prev);
  if (d === 0) return '<span>level</span> with the previous ' + unit;
  const cls = d > 0 ? 'up' : 'down';
  const arrow = d > 0 ? '↑' : '↓';
  return '<span class="' + cls + '">' + arrow + ' ' + Math.abs(d) + '%</span> vs previous ' + unit;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
