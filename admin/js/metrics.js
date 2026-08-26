/* ============================================================
   metrics.js — every KPI card opens the records BEHIND its number,
   not the page the number happens to live on.

   A card says "Revenue today ₦418,000" → the drill shows the three
   payments that add up to ₦418,000, how the figure is worked out,
   and only then a way onward to the full page.
   ============================================================ */

/* ---------- row renderers, one per record shape ---------- */
const ROWS = {
  subs(list) {
    if (!list.length) return '<div class="empty">No accounts in this figure.</div>';
    return '<div class="tw"><table><thead><tr><th>Business</th><th class="hide-sm">Plan</th><th>Status</th>' +
      '<th class="hide-sm">Joined</th><th class="num">MRR</th><th></th></tr></thead><tbody>' +
      list.map(s => '<tr class="klik" onclick="openDetail(\'sub\',' + s.id + ')">' +
        '<td><div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + esc(s.owner) + '</div></td>' +
        '<td class="hide-sm"><span class="tier">' + s.planName + '</span></td>' +
        '<td>' + statusPill(s.status) + (s.pastDue ? ' <span class="pill red">Past due</span>' : '') + '</td>' +
        '<td class="hide-sm">' + fmtD(s.joined) + '</td>' +
        '<td class="num">' + (s.mrr ? money(s.mrr) : '—') + '</td>' +
        '<td class="chev">&rsaquo;</td></tr>').join('') +
      '<tr class="hide-sm"><td colspan="4" style="text-align:right;font-weight:600">' + list.length + ' account' + (list.length === 1 ? '' : 's') + '</td>' +
      '<td class="num"><b>' + money(list.reduce((t, s) => t + s.mrr, 0)) + '</b></td><td></td></tr>' +
      '</tbody></table></div>';
  },
  pays(list) {
    if (!list.length) return '<div class="empty">No payments in this figure.</div>';
    return '<div class="tw"><table><thead><tr><th class="hide-sm">Date</th><th>Subscriber</th>' +
      '<th class="hide-sm">Reference</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.slice(0, 150).map(p => '<tr class="klik" onclick="openDetail(\'pay\',' + p.id + ')">' +
        '<td class="hide-sm">' + fmtD(p.date) + '</td>' +
        '<td><div class="t-main">' + esc(p.subscriber) + '</div><div class="t-sub">' + p.plan + ' · ' + p.cycle + '</div></td>' +
        '<td class="hide-sm">' + p.ref + '</td>' +
        '<td class="num">' + money(p.amount) + '</td>' +
        '<td>' + statusPill(p.status) + '</td>' +
        '<td class="chev">&rsaquo;</td></tr>').join('') +
      '<tr class="hide-sm"><td colspan="3" style="text-align:right;font-weight:600">' + list.length + ' payment' + (list.length === 1 ? '' : 's') + '</td>' +
      '<td class="num"><b>' + money(list.reduce((t, p) => t + p.amount, 0)) + '</b></td><td colspan="2"></td></tr>' +
      '</tbody></table></div>' +
      (list.length > 150 ? '<div class="pager"><span>Showing the first 150</span></div>' : '');
  },
  tickets(list) {
    if (!list.length) return '<div class="empty">No tickets in this figure.</div>';
    return list.map(t => '<div class="row klik" onclick="openDetail(\'ticket\',' + t.id + ')">' +
      '<div><b>' + esc(t.title) + '</b><small>#' + t.ref + ' · ' + esc(t.subscriber) + ' · ' +
      (t.assignedTo ? esc(t.assignedName) : 'unassigned') + ' · ' + ago(t.openedAt) + '</small></div>' +
      statusPill(t.state) + '</div>').join('');
  },
  staff(list) {
    if (!list.length) return '<div class="empty">Nobody in this figure.</div>';
    return '<div class="tw"><table><thead><tr><th>Name</th><th class="hide-sm">Department</th><th>Today</th>' +
      '<th class="num hide-sm">Monthly gross</th><th></th></tr></thead><tbody>' +
      list.map(s => {
        const a = Q.attToday(s.id);
        return '<tr class="klik" onclick="openDetail(\'staff\',' + s.id + ')">' +
          '<td><div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + s.title + '</div></td>' +
          '<td class="hide-sm">' + s.dept + '</td>' +
          '<td>' + (a && a.in ? (a.out ? a.in + '–' + a.out : '<span class="pill green">In since ' + a.in + '</span>') : (a ? statusPill(a.state) : '<span class="note">—</span>')) + '</td>' +
          '<td class="num hide-sm">' + money(s.basic + s.housing + s.transport) + '</td>' +
          '<td class="chev">&rsaquo;</td></tr>';
      }).join('') + '</tbody></table></div>';
  },
  slips(list) {
    if (!list.length) return '<div class="empty">No payslips in this figure.</div>';
    return '<div class="tw"><table><thead><tr><th>Staff</th><th class="hide-sm">Department</th><th class="num hide-sm">Gross</th>' +
      '<th class="num hide-sm">Deductions</th><th class="num">Net</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.map(s => '<tr class="klik" onclick="openDetail(\'slip\',' + s.id + ')">' +
        '<td class="t-main">' + esc(s.staffName) + '</td><td class="hide-sm">' + s.dept + '</td>' +
        '<td class="num hide-sm">' + money(s.gross) + '</td>' +
        '<td class="num hide-sm" style="color:var(--red)">−' + money(s.deductions) + '</td>' +
        '<td class="num"><b>' + money(s.net) + '</b></td>' +
        '<td>' + statusPill(s.status) + '</td><td class="chev">&rsaquo;</td></tr>').join('') +
      '<tr class="hide-sm"><td colspan="2" style="text-align:right;font-weight:600">' + list.length + ' staff</td>' +
      '<td class="num"><b>' + money(list.reduce((t, s) => t + s.gross, 0)) + '</b></td>' +
      '<td class="num" style="color:var(--red)"><b>−' + money(list.reduce((t, s) => t + s.deductions, 0)) + '</b></td>' +
      '<td class="num"><b>' + money(list.reduce((t, s) => t + s.net, 0)) + '</b></td><td colspan="2"></td></tr>' +
      '</tbody></table></div>';
  },
  onb(list) {
    if (!list.length) return '<div class="empty">Nothing in this figure.</div>';
    return list.map(o => '<div class="row klik" onclick="openDetail(\'onb\',' + o.id + ')">' +
      '<div><b>' + esc(o.name) + '</b><small>' + esc(o.owner) + ' · step ' + o.step + ' of 6 · trial ends ' +
      (o.trialEndsIn <= 0 ? 'today' : 'in ' + o.trialEndsIn + ' days') + '</small></div>' +
      statusPill(o.state) + '</div>').join('');
  },
  referrers(list) {
    if (!list.length) return '<div class="empty">Nobody has referred anyone yet.</div>';
    return '<div class="tw"><table><thead><tr><th>Subscriber</th><th class="hide-sm">Plan</th>' +
      '<th class="num hide-sm">Referred</th>' +
      '<th class="num hide-sm">Converted</th><th class="num">Earned</th><th class="num hide-sm">Paid</th>' +
      '<th class="num hide-sm">Outstanding</th><th></th></tr></thead><tbody>' +
      list.map(s => '<tr class="klik" onclick="UI.vtab[\'sub' + s.id + '\']=\'referrals\';openDetail(\'sub\',' + s.id + ')">' +
        '<td><div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + esc(s.owner) + '</div></td>' +
        '<td class="hide-sm"><span class="tier">' + s.planName + '</span></td>' +
        '<td class="num hide-sm">' + s.referrals.length + '</td>' +
        '<td class="num hide-sm">' + s.referralConverted + '</td>' +
        '<td class="num">' + money(s.referralEarned) + '</td>' +
        '<td class="num hide-sm">' + money(s.referralPaid) + '</td>' +
        '<td class="num hide-sm"' + (s.referralPending ? ' style="color:var(--amber)"' : '') + '>' +
        (s.referralPending ? money(s.referralPending) : '—') + '</td>' +
        '<td class="chev">&rsaquo;</td></tr>').join('') +
      '<tr class="hide-sm"><td colspan="2" style="text-align:right;font-weight:600">' + list.length + ' referrers</td>' +
      '<td class="num"><b>' + list.reduce((t, s) => t + s.referrals.length, 0) + '</b></td>' +
      '<td class="num"><b>' + list.reduce((t, s) => t + s.referralConverted, 0) + '</b></td>' +
      '<td class="num"><b>' + money(list.reduce((t, s) => t + s.referralEarned, 0)) + '</b></td>' +
      '<td class="num"><b>' + money(list.reduce((t, s) => t + s.referralPaid, 0)) + '</b></td>' +
      '<td class="num"><b>' + money(list.reduce((t, s) => t + s.referralPending, 0)) + '</b></td>' +
      '<td></td></tr></tbody></table></div>';
  },
  tasks(list) {
    if (!list.length) return '<div class="empty">Nothing in this figure.</div>';
    return list.map(t => '<div class="row klik" onclick="openDetail(\'task\',' + t.id + ')">' +
      '<div><b>' + esc(t.title) + '</b><small>' + esc(t.assignedName) + ' · due ' + fmtD(t.due) + '</small></div>' +
      '<span class="pill ' + (t.done ? 'green' : t.dueIn < 0 ? 'red' : 'amber') + '">' +
      (t.done ? 'Done' : t.dueIn < 0 ? Math.abs(t.dueIn) + 'd late' : t.dueIn === 0 ? 'Today' : 'In ' + t.dueIn + 'd') + '</span></div>').join('');
  }
};

/* ---------- small breakdown helper ---------- */
function planBars(list, field) {
  const rows = ['premium', 'pro', 'starter', 'trial'].map(id => {
    const sub = list.filter(s => s.plan === id);
    return {
      label: planById(id).name,
      value: field === 'mrr' ? sub.reduce((t, s) => t + s.mrr, 0) : sub.length,
      color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)', trial: 'var(--blue)' }[id]
    };
  }).filter(r => r.value);
  return rows.length ? hBars(rows, { money: field === 'mrr' }) : '';
}

/* ---------- the registry ----------
   Each entry returns what the number is, how it was worked out, and the
   actual records underneath it. */
const METRICS = {

  /* ----- subscribers ----- */
  'subs.total': () => {
    const list = Q.subsAsOf(), nw = Q.newSubs();
    return {
      title: 'Total subscribers', value: list.length, tone: 'money',
      how: 'Every account created on or before ' + fmtD(PERIOD.to) + ', whatever state it is in now.',
      facts: [['Paying', Q.active().length], ['On trial', Q.trial().length], ['Expired', Q.expired().length],
        ['Joined in ' + PERIOD.label.toLowerCase(), nw.length]],
      breakdown: { title: 'Split by plan', html: planBars(list, 'count') },
      kind: 'subs', rows: list.slice().sort((a, b) => b.joined.localeCompare(a.joined)),
      rowsTitle: 'Every account, newest first',
      onward: ['subscribers', 'Open the full directory']
    };
  },

  'subs.active': () => {
    const list = Q.active();
    return {
      title: 'Active subscribers', value: list.length, tone: 'good',
      how: 'Accounts on a paid plan with a live subscription. Trials and expired accounts are excluded, which is why this is lower than the total.',
      facts: [['Share of all accounts', pct(list.length, Q.subsAsOf().length) + '%'],
        ['Combined MRR', money(Q.mrr())], ['Average per account', money(Q.arpu())],
        ['Of those, past due', Q.pastDue().length]],
      breakdown: { title: 'MRR by plan', html: planBars(list, 'mrr') },
      kind: 'subs', rows: list.slice().sort((a, b) => b.mrr - a.mrr),
      rowsTitle: 'Every paying account, largest first',
      onward: ['subscribers', 'Open the full directory']
    };
  },

  'subs.trial': () => {
    const list = Q.trial();
    return {
      title: 'On trial', value: list.length, tone: 'info',
      how: 'Accounts inside their ' + DB.settings.trialDays + '-day trial. They contribute nothing to MRR until they convert.',
      facts: [['Ending within 3 days', list.filter(s => s.renewIn <= 3).length],
        ['Finished setting up', DB.onboarding.filter(o => o.state === 'ready').length],
        ['Not started setup', DB.onboarding.filter(o => o.state === 'new').length],
        ['MRR if all converted', money(list.reduce((t, s) => t + planById('pro').monthly, 0))]],
      kind: 'onb', rows: DB.onboarding.slice().sort((a, b) => a.trialEndsIn - b.trialEndsIn),
      rowsTitle: 'Trial pipeline, soonest to expire first',
      onward: ['onboarding', 'Open the onboarding pipeline']
    };
  },

  'subs.renewals': () => {
    const list = Q.renewing();
    return {
      title: 'Renewals due', value: list.length, tone: 'warn',
      how: 'Paying accounts whose next charge falls within seven days. Worth watching because a failed charge here becomes churn next week.',
      facts: [['Value up for renewal', money(list.reduce((t, s) => t + s.mrr, 0))],
        ['Due today', list.filter(s => s.renewIn === 0).length],
        ['Already past due', Q.pastDue().length],
        ['On annual billing', list.filter(s => s.cycle === 'annual').length]],
      kind: 'subs', rows: list.slice().sort((a, b) => a.renewIn - b.renewIn),
      rowsTitle: 'Soonest first',
      onward: ['payments', 'See scheduled charges']
    };
  },

  'subs.pastdue': () => {
    const list = Q.pastDue();
    const pays = DB.payments.filter(p => p.status === 'overdue' || p.status === 'failed');
    return {
      title: 'Past due', value: list.length, tone: 'bad',
      how: 'Paying accounts whose last charge failed and has not been recovered. Each one is revenue you have earned but not collected.',
      facts: [['Unpaid MRR', money(list.reduce((t, s) => t + s.mrr, 0))],
        ['Failed charges on record', pays.length],
        ['Value of those charges', money(pays.reduce((t, p) => t + p.amount, 0))]],
      kind: 'subs', rows: list,
      rowsTitle: 'Accounts to chase',
      onward: ['payments', 'Open failed payments']
    };
  },

  'subs.expired': () => {
    const list = Q.expired();
    return {
      title: 'Expired', value: list.length, tone: 'bad',
      how: 'Accounts that stopped paying and were not recovered. The MRR column reads zero because they no longer bill, so churn is measured on what they used to pay.',
      facts: [['Churn rate', pct(list.length, Q.subsAsOf().length) + '% of all accounts'],
        ['MRR lost', money(list.reduce((t, s) => t + planById(s.plan).monthly, 0))],
        ['Average tenure before leaving', Math.round(list.reduce((t, s) => t + (parseD(s.renewsOn) - parseD(s.joined)) / DAY, 0) / Math.max(1, list.length) / 30) + ' months']],
      breakdown: { title: 'Which plans churned', html: planBars(list, 'count') },
      kind: 'subs', rows: list,
      rowsTitle: 'Churned accounts',
      onward: ['revenue', 'See churn in context']
    };
  },

  'subs.atrisk': () => {
    const list = Q.atRisk();
    return {
      title: 'At-risk accounts', value: list.length, tone: 'bad',
      how: 'Paying accounts showing one of the early churn signals: a failed charge, a drop in orders, or a long gap since anyone signed in.',
      facts: [['MRR exposed', money(list.reduce((t, s) => t + s.mrr, 0))],
        ['Flagged for failed payment', list.filter(s => s.pastDue).length],
        ['Flagged for low activity', list.filter(s => !s.pastDue).length]],
      kind: 'subs', rows: list.slice().sort((a, b) => b.mrr - a.mrr),
      rowsTitle: 'Highest value first',
      onward: ['support', 'Open the at-risk list']
    };
  },

  /* ----- money ----- */
  'revenue': () => {
    const list = Q.payments('successful');
    const failed = Q.payments('failed');
    return {
      title: 'Revenue collected', value: moneyShort(list.reduce((t, p) => t + p.amount, 0)), tone: 'money',
      how: 'Every payment that actually settled between ' + fmtD(PERIOD.from) + ' and ' + fmtD(PERIOD.to) +
        '. This is cash in, not MRR — an annual plan lands as one large payment rather than twelve small ones.',
      facts: [['Payments settled', list.length],
        ['Exact total', money(list.reduce((t, p) => t + p.amount, 0))],
        ['Largest single payment', list.length ? money(Math.max.apply(null, list.map(p => p.amount))) : '—'],
        ['Failed in the same window', failed.length + (failed.length ? ' worth ' + money(failed.reduce((t, p) => t + p.amount, 0)) : '')],
        ['Same length of time before this', money(Q.revenuePrev())]],
      chart: { title: 'How it arrived', html: areaChart(Q.revenueSeries(), { money: true, color: 'var(--gold)', height: 180 }) },
      kind: 'pays', rows: list.slice().sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount),
      rowsTitle: 'The payments that make up this figure',
      onward: ['payments', 'Open all transactions']
    };
  },

  'mrr': () => {
    const list = Q.active();
    const split = Q.planSplit().filter(s => s.mrr);
    return {
      title: 'Monthly recurring revenue', value: moneyShort(Q.mrr()), tone: 'money',
      how: 'The sum of what every active account bills in a month. Annual subscriptions are divided by twelve so the figure stays comparable, and trials count as zero.',
      facts: [['Exact total', money(Q.mrr())],
        ['Paying accounts', list.length],
        ['Average per account', money(Q.arpu())],
        ['Annualised', money(Q.arr())],
        ['On annual billing', list.filter(s => s.cycle === 'annual').length + ' of ' + list.length]],
      breakdown: {
        title: 'Where the MRR comes from',
        html: hBars(split.map(s => ({
          label: s.name, value: s.mrr,
          color: { premium: 'var(--gold)', pro: 'var(--green)', starter: 'var(--purple)' }[s.id] || 'var(--blue)'
        })), { money: true }) +
          '<div style="margin-top:14px">' + split.map(s =>
            '<div class="kv"><span class="k">' + s.name + ' · ' + s.active + ' accounts</span>' +
            '<span class="v">' + money(s.mrr) + ' <span class="note">(' + pct(s.mrr, Q.mrr()) + '%)</span></span></div>').join('') + '</div>'
      },
      kind: 'subs', rows: list.slice().sort((a, b) => b.mrr - a.mrr),
      rowsTitle: 'Every account contributing, largest first',
      onward: ['revenue', 'Open the revenue page']
    };
  },

  'arr': () => ({
    title: 'ARR run rate', value: moneyShort(Q.arr()), tone: 'money',
    how: 'Current MRR multiplied by twelve. It is a run rate, not a forecast: it assumes today\'s subscriptions carry on unchanged for a year, with no new signups and no churn.',
    facts: [['Exact figure', money(Q.arr())], ['Built from MRR of', money(Q.mrr())],
      ['Across', Q.active().length + ' paying accounts'],
      ['Churn drag over a year', money(Q.churnedMrr() * 12)]],
    kind: 'subs', rows: Q.active().slice().sort((a, b) => b.mrr - a.mrr),
    rowsTitle: 'Accounts behind the run rate',
    onward: ['revenue', 'Open the revenue page']
  }),

  'arpu': () => {
    const list = Q.active();
    return {
      title: 'Average revenue per account', value: moneyShort(Q.arpu()), tone: 'money',
      how: 'Total MRR divided by the number of paying accounts. It rises when subscribers move up a tier and falls when growth comes mostly from Starter.',
      facts: [['Exact figure', money(Q.arpu())], ['MRR', money(Q.mrr())], ['Paying accounts', list.length],
        ['Highest paying', list.length ? money(Math.max.apply(null, list.map(s => s.mrr))) : '—'],
        ['Lowest paying', list.length ? money(Math.min.apply(null, list.map(s => s.mrr))) : '—']],
      breakdown: { title: 'MRR by plan', html: planBars(list, 'mrr') },
      kind: 'subs', rows: list.slice().sort((a, b) => b.mrr - a.mrr),
      rowsTitle: 'Every paying account',
      onward: ['revenue', 'Open the revenue page']
    };
  },

  'churn': () => {
    const list = Q.expired();
    return {
      title: 'Churned MRR', value: moneyShort(Q.churnedMrr()), tone: 'bad',
      how: 'What the accounts that left used to bill each month. Measured on their old plan price, since they now bill nothing.',
      facts: [['Accounts churned', list.length],
        ['As a share of MRR', pct(Q.churnedMrr(), Q.mrr()) + '%'],
        ['Annualised loss', money(Q.churnedMrr() * 12)],
        ['Still recoverable (past due)', Q.pastDue().length + ' accounts worth ' + money(Q.pastDue().reduce((t, s) => t + s.mrr, 0))]],
      breakdown: { title: 'Which plans churned', html: planBars(list, 'count') },
      kind: 'subs', rows: list,
      rowsTitle: 'Accounts that left',
      onward: ['subscribers', 'Open expired accounts']
    };
  },

  'newmrr': () => {
    const list = Q.newSubs().filter(s => s.status === 'active');
    return {
      title: 'New MRR', value: moneyShort(list.reduce((t, s) => t + s.mrr, 0)), tone: 'good',
      how: 'MRR added by accounts that started paying inside the selected period. Trials that signed up but have not converted are not counted here.',
      facts: [['New paying accounts', list.length],
        ['New signups of any kind', Q.newSubs().length],
        ['Average deal size', list.length ? money(list.reduce((t, s) => t + s.mrr, 0) / list.length) : '—'],
        ['Net of churn', money(list.reduce((t, s) => t + s.mrr, 0) - Q.churnedMrr())]],
      kind: 'subs', rows: list.slice().sort((a, b) => b.mrr - a.mrr),
      rowsTitle: 'Accounts that started paying',
      onward: ['subscribers', 'Open the directory']
    };
  },

  /* ----- payments ----- */
  'pay.collected': () => METRICS.revenue(),
  'pay.problems': () => {
    const list = Q.payments('failed').concat(Q.payments('overdue'));
    return {
      title: 'Payment problems', value: moneyShort(list.reduce((t, p) => t + p.amount, 0)), tone: 'bad',
      how: 'Charges that did not go through in this window — declines and accounts already past due. Every one is money earned but not collected.',
      facts: [['Charges affected', list.length],
        ['Failed on first attempt', Q.payments('failed').length],
        ['Already past due', Q.payments('overdue').length],
        ['Accounts involved', new Set(list.map(p => p.subId)).size]],
      kind: 'pays', rows: list.slice().sort((a, b) => b.amount - a.amount),
      rowsTitle: 'Largest first — retry these',
      onward: ['payments', 'Open all transactions']
    };
  },
  'pay.scheduled': () => {
    const list = Q.payments('upcoming').concat(Q.payments('pending'));
    return {
      title: 'Scheduled charges', value: moneyShort(list.reduce((t, p) => t + p.amount, 0)), tone: 'info',
      how: 'Charges queued against a card on file — either clearing right now, or dated for an upcoming renewal.',
      facts: [['Charges queued', list.length],
        ['Clearing today', Q.payments('pending').length],
        ['Future renewals', Q.payments('upcoming').length]],
      kind: 'pays', rows: list.slice().sort((a, b) => a.date.localeCompare(b.date)),
      rowsTitle: 'Soonest first',
      onward: ['payments', 'Open all transactions']
    };
  },
  'pay.refunded': () => {
    const list = Q.payments('refunded');
    return {
      title: 'Refunded', value: moneyShort(list.reduce((t, p) => t + p.amount, 0)), tone: 'money',
      how: 'Payments sent back to the subscriber in this window. Refunds reduce collected revenue but leave MRR alone, since the subscription itself continues.',
      facts: [['Refunds issued', list.length],
        ['As a share of collected', pct(list.reduce((t, p) => t + p.amount, 0), Q.revenue()) + '%']],
      kind: 'pays', rows: list,
      rowsTitle: 'Refunds in this period',
      onward: ['payments', 'Open all transactions']
    };
  },

  /* ----- payroll ----- */
  'pay.gross': () => {
    const key = UI.payMonth || DB.payrollRuns[0].monthKey;
    const run = Q.runByKey(key), slips = Q.slipsFor(key);
    return {
      title: 'Gross payroll', value: moneyShort(run.gross), tone: 'money',
      how: 'Basic salary plus housing and transport allowances, plus any bonus or overtime, for all ' + run.headcount + ' staff in ' + run.month + '. This is the cost before anything is deducted.',
      facts: [['Exact total', money(run.gross)], ['Staff on the run', run.headcount],
        ['Basic salary portion', money(slips.reduce((t, s) => t + s.basic, 0))],
        ['Allowances', money(slips.reduce((t, s) => t + s.housing + s.transport, 0))],
        ['Bonus and overtime', money(slips.reduce((t, s) => t + s.bonus + s.overtime, 0))]],
      kind: 'slips', rows: slips.slice().sort((a, b) => b.gross - a.gross),
      rowsTitle: 'Every payslip in this run',
      onward: ['payroll', 'Open the payroll run']
    };
  },
  'pay.deductions': () => {
    const key = UI.payMonth || DB.payrollRuns[0].monthKey;
    const run = Q.runByKey(key), slips = Q.slipsFor(key);
    return {
      title: 'Total deductions', value: moneyShort(run.deductions), tone: 'warn',
      how: 'What comes off gross pay before anyone is paid: PAYE at 11.5% of gross, pension at 8% of basic, NHF at 2.5% of basic, and any staff loan repayment.',
      facts: [['Exact total', money(run.deductions)],
        ['PAYE tax', money(slips.reduce((t, s) => t + s.paye, 0))],
        ['Pension', money(slips.reduce((t, s) => t + s.pension, 0))],
        ['NHF', money(slips.reduce((t, s) => t + s.nhf, 0))],
        ['Loan repayments', money(slips.reduce((t, s) => t + s.loan, 0))],
        ['As a share of gross', pct(run.deductions, run.gross) + '%']],
      kind: 'slips', rows: slips.slice().sort((a, b) => b.deductions - a.deductions),
      rowsTitle: 'Deductions per person',
      onward: ['payroll', 'Open the payroll run']
    };
  },
  'pay.net': () => {
    const key = UI.payMonth || DB.payrollRuns[0].monthKey;
    const run = Q.runByKey(key), slips = Q.slipsFor(key);
    return {
      title: 'Net to pay', value: moneyShort(run.net), tone: 'good',
      how: 'Gross pay less deductions — the amount that actually leaves the bank on ' + fmtD(run.payDate) + '.',
      facts: [['Exact total', money(run.net)],
        ['Gross', money(run.gross)], ['Less deductions', '−' + money(run.deductions)],
        ['Already released', money(slips.filter(s => s.status === 'paid').reduce((t, s) => t + s.net, 0))],
        ['Still to release', money(slips.filter(s => s.status === 'pending').reduce((t, s) => t + s.net, 0))]],
      kind: 'slips', rows: slips.slice().sort((a, b) => b.net - a.net),
      rowsTitle: 'What each person receives',
      onward: ['payroll', 'Open the payroll run']
    };
  },
  'pay.pending': () => {
    const key = UI.payMonth || DB.payrollRuns[0].monthKey;
    const run = Q.runByKey(key);
    const list = Q.slipsFor(key).filter(s => s.status === 'pending');
    return {
      title: 'Payroll pending', value: list.length, tone: list.length ? 'bad' : 'good',
      how: 'Staff on the ' + run.month + ' run who have not been paid yet. Running payroll clears all of them at once.',
      facts: [['Value outstanding', money(list.reduce((t, s) => t + s.net, 0))],
        ['Value date', fmtD(run.payDate)],
        ['Already paid', (run.headcount - list.length) + ' of ' + run.headcount]],
      kind: 'slips', rows: list,
      rowsTitle: 'Awaiting payment',
      onward: ['payroll', 'Open the payroll run']
    };
  },
  'pay.slips': () => {
    const key = UI.payMonth || DB.payrollRuns[0].monthKey;
    const run = Q.runByKey(key), slips = Q.slipsFor(key);
    const un = slips.filter(s => !s.uploaded);
    return {
      title: 'Payslips published', value: (slips.length - un.length) + '/' + slips.length,
      tone: un.length ? 'warn' : 'good',
      how: 'Publishing a payslip makes it visible to that staff member inside their own profile. Until it is published, only you and Finance can see it.',
      facts: [['Published', slips.length - un.length], ['Not yet published', un.length], ['Run', run.month]],
      kind: 'slips', rows: un.length ? un : slips,
      rowsTitle: un.length ? 'Not yet visible to these people' : 'All published',
      onward: ['payroll', 'Open the payroll run']
    };
  },

  /* ----- support ----- */
  'tickets.open': () => {
    const list = Q.openTickets();
    return {
      title: 'Open support tickets', value: list.length, tone: Q.urgentTickets().length ? 'bad' : 'warn',
      how: 'Everything not yet resolved, across every subscriber. Urgent means a subscriber cannot work until it is fixed.',
      facts: [['Urgent', Q.urgentTickets().length], ['In progress', list.filter(t => t.state === 'in-progress').length],
        ['Unassigned', list.filter(t => !t.assignedTo).length],
        ['Average first reply', Q.avgFirstReply() + ' minutes against a ' + (DB.settings.slaHours * 60) + ' minute target'],
        ['Agents on the queue', DB.staff.filter(s => s.dept === 'Support').length]],
      kind: 'tickets', rows: list,
      rowsTitle: 'Open tickets',
      onward: ['support', 'Open the support queue']
    };
  },
  'tickets.urgent': () => {
    const list = Q.urgentTickets();
    return {
      title: 'Urgent tickets', value: list.length, tone: 'bad',
      how: 'Tickets where the subscriber is blocked — checkout down, duplicate charge, cannot sign in. These jump the queue.',
      facts: [['Unassigned of those', list.filter(t => !t.assignedTo).length],
        ['Accounts affected', new Set(list.map(t => t.subId)).size],
        ['MRR affected', money(list.reduce((t, x) => t + (Q.sub(x.subId) || { mrr: 0 }).mrr, 0))]],
      kind: 'tickets', rows: list,
      rowsTitle: 'Deal with these first',
      onward: ['support', 'Open the support queue']
    };
  },

  /* ----- staff ----- */
  'staff.total': () => ({
    title: 'Total staff', value: DB.staff.length, tone: 'money',
    how: 'Everyone with an account on this console, across all five departments.',
    facts: [['Full time', DB.staff.filter(s => s.empType === 'Full time').length],
      ['Contract', DB.staff.filter(s => s.empType !== 'Full time').length],
      ['Monthly gross payroll', money(DB.staff.reduce((t, s) => t + s.basic + s.housing + s.transport, 0))],
      ['Roles in use', new Set(DB.staff.map(s => s.roleId)).size + ' of ' + DB.roles.length]],
    kind: 'staff', rows: DB.staff,
    rowsTitle: 'The whole team',
    onward: ['staff', 'Open the team list']
  }),
  'staff.onfloor': () => {
    const list = DB.staff.filter(s => { const a = Q.attToday(s.id); return a && a.in && !a.out; });
    return {
      title: 'On the floor now', value: list.length, tone: 'good',
      how: 'Staff who have clocked in today and not clocked out yet.',
      facts: [['Clocked in and out already', DB.staff.filter(s => { const a = Q.attToday(s.id); return a && a.in && a.out; }).length],
        ['Not clocked in at all', DB.staff.filter(s => { const a = Q.attToday(s.id); return !a || !a.in; }).length],
        ['On leave', Q.onLeaveToday()]],
      kind: 'staff', rows: list,
      rowsTitle: 'Currently clocked in',
      onward: ['staff', 'Open the team list']
    };
  },
  'staff.late': () => {
    const list = DB.staff.filter(s => { const a = Q.attToday(s.id); return a && a.state === 'late'; });
    return {
      title: 'Late today', value: list.length, tone: list.length ? 'warn' : 'good',
      how: 'Anyone who clocked in after 09:00. Attendance rates on each profile count late as present, so this is a separate signal.',
      facts: [['Share of the team', pct(list.length, DB.staff.length) + '%']],
      kind: 'staff', rows: list,
      rowsTitle: 'Late arrivals',
      onward: ['staff', 'Open the team list']
    };
  },
  'staff.leave': () => {
    const list = DB.staff.filter(s => { const a = Q.attToday(s.id); return a && a.state === 'leave'; });
    return {
      title: 'On leave today', value: list.length, tone: 'info',
      how: 'Staff signed off today. Leave days do not count against their attendance rate.',
      facts: [['Requests awaiting approval', DB.leave.filter(l => l.status === 'pending').length],
        ['Leave days taken this year', DB.staff.reduce((t, s) => t + Q.leaveTaken(s.id), 0)]],
      kind: 'staff', rows: list,
      rowsTitle: 'Away today',
      onward: ['staff', 'Open the team list']
    };
  },

  /* ----- onboarding ----- */
  'onb.stage': (stage) => {
    const names = { new: 'Not started', setup: 'Setting up', ready: 'Ready to convert' };
    const list = DB.onboarding.filter(o => o.state === stage);
    return {
      title: names[stage] || 'Onboarding', value: list.length,
      tone: stage === 'ready' ? 'good' : stage === 'new' ? 'warn' : 'info',
      how: stage === 'new' ? 'The owner created an account and then stopped. Nothing has been set up, so there is nothing keeping them here.'
        : stage === 'setup' ? 'Partway through the six-step checklist. The blocker is usually whichever step comes next.'
          : 'Every setup step is done. These are ready to be moved onto a paid plan.',
      facts: [['Trials ending within 3 days', list.filter(o => o.trialEndsIn <= 3).length],
        ['Average progress', Math.round(list.reduce((t, o) => t + o.progress, 0) / Math.max(1, list.length)) + '%']],
      kind: 'onb', rows: list.slice().sort((a, b) => a.trialEndsIn - b.trialEndsIn),
      rowsTitle: 'Soonest to expire first',
      onward: ['onboarding', 'Open the pipeline']
    };
  },

  /* ----- referrals ----- */
  'referrers': () => {
    const referrers = DB.subscribers.filter(s => s.referralConverted > 0)
      .sort((a, b) => b.referralEarned - a.referralEarned);
    const earned = Q.refCommissionTotal();
    const invited = DB.subscribers.reduce((t, s) => t + s.referrals.length, 0);
    const converted = DB.subscribers.reduce((t, s) => t + s.referralConverted, 0);
    const mrrFromRef = DB.subscribers.filter(s => s.referredBy && s.status === 'active').reduce((t, s) => t + s.mrr, 0);
    return {
      title: 'Top referrers', value: referrers.length, tone: 'money',
      how: 'Subscribers who have brought in at least one account that converted to a paid plan. Commission is ' +
        DB.settings.referralPct + '% of the referred account\'s first month, credited 31 days after they convert — ' +
        'the hold exists so a refund inside the first month does not leave commission paid on revenue we gave back.',
      facts: [['Accounts referred in total', invited],
        ['Of those, converted', converted + ' (' + pct(converted, invited) + '%)'],
        ['MRR now coming from referrals', money(mrrFromRef) + ' — ' + pct(mrrFromRef, Q.mrr()) + '% of all MRR'],
        ['Commission earned', money(earned)],
        ['Commission paid out', money(DB.subscribers.reduce((t, s) => t + s.referralPaid, 0))],
        ['Still inside the hold', money(DB.subscribers.reduce((t, s) => t + s.referralPending, 0))],
        ['Best single referrer', referrers.length ? referrers[0].name + ' — ' + money(referrers[0].referralEarned) : '—']],
      breakdown: {
        title: 'Commission earned, per referrer',
        html: hBars(referrers.slice(0, 8).map((s, i) => ({
          label: s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name,
          value: s.referralEarned,
          color: ['var(--gold)', 'var(--green)', 'var(--blue)', 'var(--purple)', 'var(--amber)'][i % 5],
          onclick: "UI.vtab['sub" + s.id + "']='referrals';openDetail('sub'," + s.id + ")"
        })), { money: true })
      },
      kind: 'referrers', rows: referrers,
      rowsTitle: 'Every referring subscriber — tap for their ledger',
      onward: ['billing', 'Back to the referral programme']
    };
  },

  /* ----- tasks ----- */
  'tasks.overdue': () => {
    const list = DB.tasks.filter(t => !t.done && t.dueIn < 0);
    return {
      title: 'Overdue tasks', value: list.length, tone: list.length ? 'bad' : 'good',
      how: 'Internal work past its due date and not marked done.',
      facts: [['Oldest', list.length ? Math.abs(Math.min.apply(null, list.map(t => t.dueIn))) + ' days late' : '—'],
        ['People affected', new Set(list.map(t => t.assignedTo)).size]],
      kind: 'tasks', rows: list.slice().sort((a, b) => a.dueIn - b.dueIn),
      rowsTitle: 'Most overdue first',
      onward: ['tasks', 'Open the task board']
    };
  }
};

/* ---------- the drill view ---------- */
DETAIL.metric = function (key) {
  const parts = String(key).split(':');
  const fn = METRICS[parts[0]];
  if (!fn) return '<div class="pnl"><div class="empty">No breakdown for this figure yet.</div></div>';
  const m = fn(parts[1]);

  return backBtn() +
    '<div class="dhead"><div style="flex:1;min-width:240px">' +
    '<h2>' + m.title + '</h2>' +
    '<div class="dmeta">' + PERIOD.label + ' · ' + fmtD(PERIOD.from) + ' to ' + fmtD(PERIOD.to) + '</div></div>' +
    '<div class="dstat ' + ({ money: 'm', good: 'g', bad: 'r', warn: 'a', info: '' }[m.tone] || '') + '" style="text-align:right">' +
    '<div class="dv" style="font-size:30px">' + m.value + '</div>' +
    '<div class="dl">' + m.title + '</div></div></div>' +

    '<div class="pnl" style="border-left:3px solid var(--gold)">' +
    '<div class="ph"><h3>How this number is worked out</h3></div>' +
    '<p class="note">' + m.how + '</p>' +
    (m.facts && m.facts.length ? '<div style="margin-top:12px">' +
      m.facts.map(f => '<div class="kv"><span class="k">' + f[0] + '</span><span class="v">' + f[1] + '</span></div>').join('') +
      '</div>' : '') + '</div>' +

    (m.chart ? '<div class="pnl"><div class="ph"><h3>' + m.chart.title + '</h3></div>' + m.chart.html + '</div>' : '') +
    (m.breakdown && m.breakdown.html ? '<div class="pnl"><div class="ph"><h3>' + m.breakdown.title + '</h3></div>' + m.breakdown.html + '</div>' : '') +

    '<div class="pnl"><div class="ph"><div><h3>' + (m.rowsTitle || 'The records behind this figure') + '</h3>' +
    '<div class="ph-sub">Tap any row to open it</div></div>' +
    (m.onward ? '<button class="lnk" onclick="go(\'' + m.onward[0] + '\')">' + m.onward[1] + ' &rsaquo;</button>' : '') + '</div>' +
    ROWS[m.kind](m.rows) + '</div>';
};

/* one call for every card */
function drill(key) { openDetail('metric', key); }
