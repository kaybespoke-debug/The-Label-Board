/* ============================================================
   detail.js — full-page detail views (one .page active at a time,
   so nothing can overlap and Back always works)
   ============================================================ */

const DETAIL = {};

/* Just "Back". Naming the destination was wrong as often as it was right —
   arriving at a staff profile from Revenue still read "Back to staff". */
function backBtn() { return '<button class="back" onclick="goBack()">&larr; Back</button>'; }
function dstat(v, l, tone) { return '<div class="dstat ' + (tone || '') + '"><div class="dv">' + v + '</div><div class="dl">' + l + '</div></div>'; }
function vtabs(key, items, current) {
  return '<div class="vtabs">' + items.map(i =>
    '<button class="vtab' + (current === i[0] ? ' on' : '') + '" onclick="setVTab(\'' + key + '\',\'' + i[0] + '\')">' + i[1] + '</button>').join('') + '</div>';
}
function kv(k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }

/* =================== SUBSCRIBER 360° =================== */
DETAIL.sub = function (id) {
  const s = Q.sub(id);
  if (!s) return '<div class="empty">Subscriber not found.</div>';
  const key = 'sub' + id;
  const tab = UI.vtab[key] || 'profile';
  const pays = DB.payments.filter(p => p.subId === s.id).sort((a, b) => b.date.localeCompare(a.date));
  const lifetime = pays.filter(p => p.status === 'successful').reduce((t, p) => t + p.amount, 0);
  const tenure = Math.round((DB.today - new Date(s.joined)) / DAY);
  const tenureLbl = tenure >= 365 ? (Math.floor(tenure / 365) + 'y ' + Math.round((tenure % 365) / 30) + 'm')
    : tenure >= 30 ? Math.round(tenure / 30) + ' months' : tenure + ' days';
  const tickets = DB.tickets.filter(t => t.subId === s.id);
  const fb = DB.feedback.filter(f => f.subId === s.id);
  const acts = DB.activity.filter(a => a.target === 'subscriber:' + s.id);
  const referrer = s.referredBy ? Q.sub(s.referredBy) : null;

  let body = '';

  if (tab === 'profile') {
    body = '<div class="actrow"><a href="tel:' + s.phone.replace(/\s/g, '') + '">Call</a>' +
      '<a href="https://wa.me/' + s.phone.replace(/[^0-9]/g, '') + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a href="mailto:' + s.email + '">Email</a>' +
      '<button class="lnk" onclick="formEditSubscriber(' + s.id + ')">Edit record</button></div>' +
      '<div class="sec-t">Business</div>' +
      kv('Trading name', esc(s.name)) + kv('Owner', esc(s.owner)) + kv('Email', esc(s.email)) +
      kv('Phone', s.phone) + kv('Base city', s.city) + kv('Found us via', s.channel) +
      kv('Outlets', s.businesses.length) + kv('Team on the account', s.users + ' of ' + s.seats + ' seats') +
      '<div class="sec-t">Account</div>' +
      kv('Subscriber ID', 'TLB-S' + String(s.id).padStart(4, '0')) +
      kv('Status', statusPill(s.status) + (s.pastDue ? ' <span class="pill red">Past due</span>' : '')) +
      kv('Health', statusPill(s.health)) +
      kv('Joined', fmtD(s.joined)) + kv('Subscriber for', tenureLbl) +
      kv('Last seen', ago(s.lastSeen)) + kv('Orders in last 30 days', s.ordersLast30) +
      (referrer ? kv('Referred by', '<button class="lnk" onclick="openDetail(\'sub\',' + referrer.id + ')">' + esc(referrer.name) + ' &rsaquo;</button>') : kv('Referred by', '<span class="note">Direct signup</span>'));
  }

  else if (tab === 'subscription') {
    const p = planById(s.plan);
    body = '<div class="sec-t">Current plan</div>' +
      kv('Plan', '<span class="tier">' + s.planName + '</span>') +
      kv('Billing cycle', s.cycle === 'annual' ? 'Annual, paid up front' : s.cycle === 'trial' ? 'Free trial' : 'Monthly') +
      kv('List price', s.cycle === 'annual' ? money(p.annual) + ' / year' : p.monthly ? money(p.monthly) + ' / month' : 'Free') +
      kv('Recognised MRR', s.mrr ? money(s.mrr) : '—') +
      kv('Seats included', p.seats + ' (using ' + s.users + ')') +
      kv('Renews on', s.status === 'expired' ? '<span class="note">Not renewing</span>' : fmtD(s.renewsOn) + (s.renewIn <= 7 && s.renewIn >= 0 ? ' <span class="pill amber">in ' + s.renewIn + 'd</span>' : '')) +
      '<div class="sec-t">Value</div>' +
      kv('Lifetime revenue', money(lifetime)) +
      kv('Payments made', pays.filter(x => x.status === 'successful').length) +
      kv('Failed attempts', pays.filter(x => x.status === 'failed').length) +
      kv('Refunds', pays.filter(x => x.status === 'refunded').length) +
      '<div class="sec-t">Plan includes</div>' +
      '<div class="chips">' + p.features.map(f => '<span class="chip on">' + f + '</span>').join('') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">' +
      '<button class="btn gold" onclick="formChangePlan(' + s.id + ')">Change plan</button>' +
      '<button class="btn" onclick="setVTab(\'' + key + '\',\'payments\')">See payments</button>' +
      '</div>';
  }

  else if (tab === 'referrals') {
    body = '<div class="sec-t">Referral earnings</div>' +
      '<div class="stats" style="margin-bottom:8px">' +
      statCard({ label: 'People referred', value: s.referrals.length, tone: 'info', sub: s.referralConverted + ' converted to paid' }) +
      statCard({ label: 'Commission earned', value: money(s.referralEarned), tone: 'money', sub: DB.settings.referralPct + '% of each first month' }) +
      statCard({ label: 'Paid out', value: money(s.referralPaid), tone: 'good', sub: 'Credited to the account' }) +
      statCard({ label: 'Outstanding', value: money(s.referralPending), tone: s.referralPending ? 'warn' : 'good', sub: s.referralPending ? 'Clears 31 days after signup' : 'Nothing owing' }) +
      '</div>' +
      (s.referralLedger.length
        ? '<div class="tw"><table><thead><tr><th>Business referred</th><th class="hide-sm">Plan</th>' +
        '<th class="hide-sm">Status</th><th class="hide-sm">Joined</th>' +
        '<th class="num">Commission</th><th>Paid</th><th></th></tr></thead><tbody>' +
        s.referralLedger.map(r => '<tr class="klik" onclick="openDetail(\'sub\',' + r.subId + ')">' +
          '<td class="t-main">' + esc(r.name) + '</td>' +
          '<td class="hide-sm"><span class="tier">' + r.plan + '</span></td>' +
          '<td class="hide-sm">' + statusPill(r.status) + '</td>' +
          '<td class="hide-sm">' + fmtD(r.joined) + '</td>' +
          '<td class="num">' + (r.commission ? money(r.commission) : '—') + '</td>' +
          '<td>' + (r.paid ? '<span class="pill green">Paid ' + fmtDShort(r.creditedOn) + '</span>' : r.converted ? '<span class="pill amber">Pending</span>' : '<span class="pill grey">Not converted</span>') + '</td>' +
          '<td class="chev">&rsaquo;</td></tr>').join('') +
        '<tr class="hide-sm"><td colspan="4" style="text-align:right;font-weight:600">Total</td>' +
        '<td class="num"><b>' + money(s.referralEarned) + '</b></td><td colspan="2"></td></tr>' +
        '</tbody></table></div>'
        : '<div class="empty">This subscriber has not referred anyone yet.<br>' +
        '<span class="note">Commission is ' + DB.settings.referralPct + '% of the referred account\'s first month, credited 31 days after they convert.</span></div>');
  }

  else if (tab === 'businesses') {
    body = '<div class="sec-t">Outlets on this account</div>' +
      '<p class="note">Each outlet is a separate workroom or shop inside the subscriber\'s own app, with its own staff and stock.</p>' +
      '<div class="tw" style="margin-top:12px"><table><thead><tr><th>Outlet</th><th>City</th>' +
      '<th class="num hide-sm">Staff</th><th class="hide-sm">Opened</th></tr></thead><tbody>' +
      s.businesses.map(b => '<tr><td class="t-main">' + esc(b.name) + '</td><td>' + esc(b.city) + '</td>' +
        '<td class="num hide-sm">' + b.staff + '</td><td class="hide-sm">' + fmtD(b.openedOn) + '</td></tr>').join('') +
      '<tr class="hide-sm"><td style="font-weight:600">' + s.businesses.length + ' outlets</td><td></td>' +
      '<td class="num"><b>' + s.businesses.reduce((t, b) => t + b.staff, 0) + '</b></td><td></td></tr>' +
      '</tbody></table></div>';
  }

  else if (tab === 'payments') {
    body = '<div class="sec-t">Payment history</div>' +
      '<div class="stats" style="margin-bottom:8px">' +
      statCard({ label: 'Lifetime revenue', value: money(lifetime), tone: 'money', sub: pays.filter(p => p.status === 'successful').length + ' successful payments' }) +
      statCard({ label: 'Failed', value: pays.filter(p => p.status === 'failed').length, tone: pays.filter(p => p.status === 'failed').length ? 'bad' : 'good', sub: money(pays.filter(p => p.status === 'failed').reduce((t, p) => t + p.amount, 0)) + ' not collected' }) +
      statCard({ label: 'Next charge', value: s.status === 'expired' ? '—' : fmtDShort(s.renewsOn), tone: 'info', sub: s.mrr ? money(s.cycle === 'annual' ? planById(s.plan).annual : planById(s.plan).monthly) : 'No charge scheduled' }) +
      '</div>' +
      (pays.length ? '<div class="tw"><table><thead><tr><th>Date</th><th class="hide-sm">Reference</th><th class="hide-sm">Invoice</th>' +
        '<th class="num">Amount</th><th class="hide-sm">Method</th><th>Status</th><th></th></tr></thead><tbody>' +
        pays.map(p => '<tr class="klik" onclick="openDetail(\'pay\',' + p.id + ')">' +
          '<td>' + fmtD(p.date) + '</td><td class="hide-sm">' + p.ref + '</td><td class="hide-sm">' + p.invoice + '</td>' +
          '<td class="num">' + money(p.amount) + '</td><td class="hide-sm">' + p.method + '</td>' +
          '<td>' + statusPill(p.status) + '</td><td class="chev">&rsaquo;</td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty">No payments on this account — it is still on trial.</div>');
  }

  else if (tab === 'support') {
    body = '<div class="sec-t">Tickets from this subscriber</div>' +
      (tickets.length ? tickets.map(t => '<div class="row klik" onclick="openDetail(\'ticket\',' + t.id + ')">' +
        '<div><b>' + esc(t.title) + '</b><small>#' + t.ref + ' · ' + ago(t.openedAt) + ' · ' + t.assignedName + '</small></div>' +
        statusPill(t.state) + '</div>').join('') : '<div class="note">No tickets. Nothing has gone wrong for them yet.</div>') +
      '<div class="sec-t">Feedback &amp; reviews</div>' +
      (fb.length ? fb.map(f => '<div class="row klik" onclick="openDetail(\'fb\',' + f.id + ')">' +
        '<div><b>' + esc(f.title) + '</b><small>' + f.kind + (f.rating ? ' · ' + '★'.repeat(f.rating) : ' · ' + f.votes + ' votes') + '</small></div>' +
        statusPill(f.state === 'published' ? 'published' : 'open') + '</div>').join('') : '<div class="note">No feedback submitted.</div>');
  }

  else if (tab === 'activity') {
    body = '<div class="sec-t">What we have done on this account</div>' +
      (acts.length ? acts.map(a => '<div class="row klik" onclick="openDetail(\'audit\',' + a.id + ')">' +
        '<div><b>' + a.action + '</b><small>' + esc(a.detail) + '</small></div>' +
        '<span class="note">' + ago(a.at) + '</span></div>').join('')
        : '<div class="note">No admin actions recorded against this account.</div>');
  }

  return backBtn() +
    '<div class="dhead"><div class="dav">' + initials(s.name) + '</div>' +
    '<div style="flex:1;min-width:220px"><h2>' + esc(s.name) + ' ' + statusPill(s.status) + '</h2>' +
    '<div class="dmeta">TLB-S' + String(s.id).padStart(4, '0') + ' · ' + esc(s.owner) + ' · ' + s.planName + ' · ' + esc(s.city) + '</div></div>' +
    '<div style="display:flex;gap:8px"><button class="btn" onclick="formEditSubscriber(' + s.id + ')">Edit</button>' +
    '<button class="btn gold" onclick="formChangePlan(' + s.id + ')">Change plan</button></div></div>' +
    '<div class="dstats">' +
    dstat(s.mrr ? money(s.mrr) : '—', 'MRR', 'm') +
    dstat(money(lifetime), 'Lifetime revenue', 'g') +
    dstat(tenureLbl, 'Subscriber for') +
    dstat(s.referralConverted + (s.referralEarned ? ' · ' + moneyShort(s.referralEarned) : ''), 'Referrals', s.referralEarned ? 'm' : '') +
    dstat(s.users + '/' + s.seats, 'Seats used') +
    (s.pastDue ? dstat(money(s.mrr), 'Past due', 'r') : '') +
    '</div>' +
    '<div class="dsplit">' +
    vtabs(key, [['profile', 'Profile'], ['subscription', 'Subscription'], ['referrals', 'Referrals & bonuses'],
      ['businesses', 'Businesses'], ['payments', 'Payments'], ['support', 'Support & feedback'], ['activity', 'Activity']], tab) +
    '<div>' + body + '</div></div>';
};

/* =================== STAFF RECORD =================== */
DETAIL.staff = function (id) {
  const s = Q.staffM(id);
  if (!s) return '<div class="empty">Staff member not found.</div>';
  const key = 'staff' + id;
  const tab = UI.vtab[key] || 'profile';
  const gross = s.basic + s.housing + s.transport;
  const slips = Q.slipsForStaff(s.id);
  const att = Q.attFor(s.id, 30);
  const todayA = Q.attToday(s.id);
  const lv = Q.leaveFor(s.id);
  const role = Q.role(s.roleId) || { name: '—', pages: [], caps: [], desc: '' };
  const reports = DB.staff.filter(x => x.reportsTo === s.id);
  const boss = s.reportsTo ? Q.staffM(s.reportsTo) : null;

  let body = '';

  if (tab === 'profile') {
    body = '<div class="actrow"><a href="tel:' + s.phone.replace(/\s/g, '') + '">Call</a>' +
      '<a href="https://wa.me/' + s.phone.replace(/[^0-9]/g, '') + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a href="mailto:' + s.email + '">Email</a>' +
      (can('manage_staff') ? '<button class="lnk" onclick="formEditStaff(' + s.id + ')">Edit profile</button>' : '') + '</div>' +
      (can('manage_staff') ? '' : '<p class="hint">Read-only. Editing a staff record needs the ' +
        '&ldquo;Manage staff accounts&rdquo; permission, which your role does not have.</p>') +
      '<div class="sec-t">Personal information</div>' +
      kv('Staff ID', s.staffId) + kv('Username', s.username) + kv('Gender', s.gender) +
      kv('Date of birth', fmtD(s.dob)) + kv('Phone', s.phone) + kv('Email', esc(s.email)) +
      kv('Address', esc(s.address)) + kv('Nationality', s.nationality) +
      kv('Emergency contact', esc(s.emergency)) +
      '<div class="sec-t">Employment</div>' +
      kv('Job title', s.title) + kv('Department', s.dept) + kv('Employment type', s.empType) +
      kv('Start date', fmtD(s.startDate)) +
      kv('Length of service', Math.round((DB.today - new Date(s.startDate)) / DAY / 30) + ' months') +
      kv('Status', statusPill(s.status)) +
      kv('Reports to', boss ? '<button class="lnk" onclick="openDetail(\'staff\',' + boss.id + ')">' + esc(boss.name) + ' &rsaquo;</button>' : '<span class="note">Nobody</span>') +
      (reports.length ? '<div class="kv"><span class="k">Direct reports (' + reports.length + ')</span><span class="v">' +
        reports.map(r => '<button class="lnk" style="display:block;text-align:right" onclick="openDetail(\'staff\',' + r.id + ')">' + esc(r.name) + ' · ' + r.title + ' &rsaquo;</button>').join('') +
        '</span></div>' : kv('Direct reports', '<span class="note">None</span>')) +
      kv('Work location', s.workLocation) +
      '<div class="sec-t">Access</div>' +
      kv('Role', '<span class="pill grey">' + role.name + '</span>') +
      kv('Pages they can open', role.locked ? 'All pages' : role.pages.length + ' of ' + DB.pages.length) +
      kv('Permissions granted', role.locked ? 'Everything' : role.caps.length + ' of ' + DB.caps.length) +
      '<div class="sec-t">Sign-in</div>' +
      kv('Username', s.username) +
      kv('Password', '•••••••••••• <span class="note">changed ' +
        (Math.round((DB.today - parseD(authOf(s).passwordSetOn)) / DAY) || 'today') +
        (Math.round((DB.today - parseD(authOf(s).passwordSetOn)) / DAY) ? ' days ago' : '') + '</span>') +
      kv('Two-step verification', authOf(s).twoFactor
        ? '<span style="color:var(--green)">On</span>' : '<span style="color:var(--amber)">Off</span>') +
      kv('Signed in on', authOf(s).sessions.length + ' device' + (authOf(s).sessions.length === 1 ? '' : 's')) +
      kv('Account state', authOf(s).locked ? '<span class="pill red">Locked</span>'
        : authOf(s).mustReset ? '<span class="pill amber">Must change password</span>'
          : '<span class="pill green">Normal</span>') +
      (s.id === ME.staffId
        ? '<p class="hint">This is your own account. Change your password under ' +
          '<button class="lnk" onclick="go(\'settings\')">Settings &rarr; Login &amp; passwords</button>.</p>'
        : '<p class="hint">Nobody can set somebody else\'s password, including you. Send a reset link and ' +
          esc(s.name.split(' ')[0]) + ' chooses their own.</p>') +
      '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
      '<button class="btn" onclick="formStaffRole(' + s.id + ')">Change role</button>' +
      (s.id === ME.staffId
        ? '<button class="btn gold" onclick="formChangePassword()">Change my password</button>'
        : '<button class="btn" onclick="formSendReset(' + s.id + ')">Send a reset link</button>') +
      (authOf(s).locked ? '<button class="btn gold" onclick="unlockAccount(' + s.id + ')">Unlock account</button>' : '') +
      '<button class="btn" onclick="go(\'settings\')">Edit permissions</button></div>';
  }

  else if (tab === 'performance') {
    const closed = DB.tickets.filter(t => t.assignedTo === s.id && t.state === 'resolved');
    const openA = DB.tickets.filter(t => t.assignedTo === s.id && t.state !== 'resolved');
    const myTasks = DB.tasks.filter(t => t.assignedTo === s.id);
    body = '<div class="stats" style="margin-bottom:10px">' +
      statCard({ label: 'Rating', value: s.rating + '/5', tone: s.rating >= 4.3 ? 'good' : 'warn', sub: '★'.repeat(Math.round(s.rating)) }) +
      statCard({ label: 'Attendance 30d', value: Q.attRate(s.id) + '%', tone: Q.attRate(s.id) >= 90 ? 'good' : 'warn', sub: att.filter(a => a.state === 'late').length + ' late arrivals' }) +
      statCard({ label: 'Tickets closed', value: closed.length, tone: 'good', sub: openA.length + ' still open' }) +
      statCard({ label: 'Tasks', value: myTasks.filter(t => !t.done).length, tone: myTasks.filter(t => !t.done && t.dueIn < 0).length ? 'bad' : 'info', sub: myTasks.filter(t => t.done).length + ' completed' }) +
      '</div>' +
      '<div class="sec-t">Assigned tickets</div>' +
      (openA.concat(closed).length ? openA.concat(closed).slice(0, 8).map(t => '<div class="row klik" onclick="openDetail(\'ticket\',' + t.id + ')">' +
        '<div><b>' + esc(t.title) + '</b><small>' + esc(t.subscriber) + ' · ' + ago(t.openedAt) + '</small></div>' +
        statusPill(t.state) + '</div>').join('') : '<div class="note">No tickets assigned.</div>') +
      '<div class="sec-t">Open tasks</div>' +
      (myTasks.length ? myTasks.map(t => '<div class="row klik" onclick="openDetail(\'task\',' + t.id + ')">' +
        '<div><b>' + esc(t.title) + '</b><small>Due ' + fmtD(t.due) + '</small></div>' +
        '<span class="pill ' + (t.done ? 'green' : t.dueIn < 0 ? 'red' : 'amber') + '">' + (t.done ? 'Done' : t.dueIn < 0 ? Math.abs(t.dueIn) + 'd late' : 'Open') + '</span></div>').join('')
        : '<div class="note">No tasks assigned.</div>');
  }

  else if (tab === 'pay') {
    const al = DB.settings.allowances;
    const lastSlip = slips[0];
    body = '<div class="actrow">' +
      '<button class="lnk" onclick="formSalary(' + s.id + ')">Set salary</button>' +
      '<button class="lnk" onclick="formBank(' + s.id + ')">Bank details</button>' +
      '<button class="lnk" onclick="formPension(' + s.id + ')">Pension &amp; NHF</button></div>' +

      '<div class="sec-t">Earnings</div>' +
      kv('Salary type', s.salaryType) +
      kv('Monthly basic', '<b>' + money(s.basic) + '</b>') +
      (al.enabled
        ? kv('Housing allowance', money(s.housing) + ' <span class="note">' + al.housingPct + '% of basic</span>') +
          kv('Transport allowance', money(s.transport) + ' <span class="note">' + al.transportPct + '% of basic</span>')
        : '<div class="kv"><span class="k">Allowances</span><span class="v"><span class="pill grey">Not in use</span></span></div>') +
      kv('Monthly gross', '<b>' + money(gross) + '</b>') +
      (al.enabled ? '' : '<p class="hint">Allowances are switched off across the platform while we are a startup, so ' +
        'gross is basic plus anything variable. The housing and transport fields still exist and can be turned on in ' +
        'Settings &rarr; Platform later, without reworking anyone\'s record.</p>') +

      '<div class="sec-t">Deductions</div>' +
      kv('PAYE', '11.5% of gross' + (lastSlip ? ' · ' + money(lastSlip.paye) + ' last month' : '')) +
      '<div class="kv"><span class="k">Pension</span><span class="v">' +
      (s.pension.optedIn
        ? s.pension.rate + '% of basic · ' + money(Math.round(s.basic * s.pension.rate / 100)) +
          '<div class="t-sub" style="font-weight:400">Agreed ' + fmtD(s.pension.agreedOn) + '</div>'
        : '<span class="pill grey">Not enrolled</span>') + '</span></div>' +
      '<div class="kv"><span class="k">NHF</span><span class="v">' +
      (s.nhfOptIn ? '2.5% of basic · ' + money(Math.round(s.basic * 0.025)) : '<span class="pill grey">Not enrolled</span>') +
      '</span></div>' +
      (s.id % 7 === 0 ? kv('Staff loan', money(25000) + ' / month') : '') +
      '<p class="hint">Pension is voluntary — nothing is deducted until the person agrees to it, and the signed ' +
      'enrolment sits under Documents. NHF works the same way.</p>' +

      '<div class="sec-t">Where the money goes</div>' +
      kv('Bank', esc(s.bankName)) +
      kv('Account number', esc(s.bankAccount)) +
      kv('Account name', esc(s.bankAccountName)) +

      '<div class="sec-t">Over a year</div>' +
      kv('Annual gross', money(gross * 12)) +
      kv('Take-home last month', lastSlip ? money(lastSlip.net) : '—') +
      kv('Annualised take-home', lastSlip ? money(lastSlip.net * 12) : '—') +
      '<button class="btn" style="margin-top:16px" onclick="setVTab(\'' + key + '\',\'payslips\')">See payslips &rarr;</button>';
  }

  else if (tab === 'payslips') {
    body = '<div class="sec-t">Monthly pay history</div>' +
      '<p class="note">Tap a month to open the payslip: a full breakdown of how that pay was worked out. ' +
      'Published payslips are visible to ' + s.name.split(' ')[0] + ' in their own profile.</p>' +
      '<div class="tw" style="margin-top:12px"><table><thead><tr><th>Month</th><th class="num hide-sm">Gross</th>' +
      '<th class="num hide-sm">Deductions</th><th class="num">Net</th><th>Paid</th>' +
      '<th class="hide-sm">Visible to staff</th><th></th></tr></thead><tbody>' +
      slips.map(sl => '<tr class="klik" onclick="openDetail(\'slip\',' + sl.id + ')">' +
        '<td class="t-main">' + sl.month + '</td>' +
        '<td class="num hide-sm">' + money(sl.gross) + '</td>' +
        '<td class="num hide-sm" style="color:var(--red)">−' + money(sl.deductions) + '</td>' +
        '<td class="num"><b>' + money(sl.net) + '</b></td>' +
        '<td>' + statusPill(sl.status) + '</td>' +
        '<td class="hide-sm">' + (sl.uploaded ? '<span class="pill green">Published</span>' : '<span class="pill grey">Not yet</span>') + '</td>' +
        '<td class="chev">&rsaquo;</td></tr>').join('') + '</tbody></table></div>' +
      '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
      '<button class="btn" onclick="downloadAllSlips(' + s.id + ')">Download all as CSV</button>' +
      '<button class="btn gold" onclick="publishSlipsFor(' + s.id + ')">Publish unpublished slips</button></div>';
  }

  else if (tab === 'attendance') {
    const present = att.filter(a => a.state === 'present').length;
    const late = att.filter(a => a.state === 'late').length;
    const absent = att.filter(a => a.state === 'absent').length;
    const hours = att.reduce((t, a) => t + a.hours, 0);
    body = '<div class="pnl" style="background:var(--panel-2);margin-bottom:16px">' +
      '<div class="ph"><div><h3>Today · ' + fmtD(DB.today) + '</h3>' +
      '<div class="ph-sub">' + (!todayA || !todayA.in ? 'Not clocked in yet'
        : todayA.out ? 'Clocked out at ' + todayA.out + ' · ' + todayA.hours + ' hours'
          : 'On the floor since ' + todayA.in) + '</div></div>' +
      (!todayA || !todayA.in
        ? '<button class="btn gold" onclick="clockIn(' + s.id + ')">Clock in</button>'
        : !todayA.out ? '<button class="btn gold" onclick="clockOut(' + s.id + ')">Clock out</button>'
          : statusPill(todayA.state)) + '</div></div>' +
      '<div class="stats" style="margin-bottom:10px">' +
      statCard({ label: 'Attendance rate', value: Q.attRate(s.id) + '%', tone: Q.attRate(s.id) >= 90 ? 'good' : 'warn', sub: 'Last 30 days' }) +
      statCard({ label: 'Days present', value: present + late, tone: 'good', sub: late + ' of those late' }) +
      statCard({ label: 'Absent', value: absent, tone: absent ? 'bad' : 'good', sub: 'Unexplained days' }) +
      statCard({ label: 'Hours worked', value: Math.round(hours) + 'h', tone: 'money', sub: 'Avg ' + (Math.round(hours / Math.max(1, present + late) * 10) / 10) + 'h a day' }) +
      '</div>' +
      '<div class="sec-t">Daily log, last 30 days</div>' +
      '<div class="tw"><table><thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th>' +
      '<th class="num hide-sm">Hours</th><th class="hide-sm">State</th></tr></thead><tbody>' +
      att.map(a => '<tr><td>' + fmtD(a.date) + '</td>' +
        '<td>' + (a.in || '<span class="note">—</span>') + '</td>' +
        '<td>' + (a.out || (a.in ? '<span class="pill green">still in</span>' : '<span class="note">—</span>')) + '</td>' +
        '<td class="num hide-sm">' + (a.hours || '—') + '</td>' +
        '<td class="hide-sm">' + statusPill(a.state) + '</td></tr>').join('') + '</tbody></table></div>';
  }

  else if (tab === 'leave') {
    const taken = Q.leaveTaken(s.id);
    body = '<div class="stats" style="margin-bottom:10px">' +
      statCard({ label: 'Entitlement', value: s.leaveEntitlement + ' days', tone: 'info', sub: 'Per calendar year' }) +
      statCard({ label: 'Taken', value: taken + ' days', tone: 'money', sub: pct(taken, s.leaveEntitlement) + '% used' }) +
      statCard({ label: 'Remaining', value: (s.leaveEntitlement - taken) + ' days', tone: 'good', sub: 'Available to book' }) +
      statCard({ label: 'Pending requests', value: lv.filter(l => l.status === 'pending').length, tone: lv.filter(l => l.status === 'pending').length ? 'warn' : 'good', sub: 'Awaiting approval' }) +
      '</div>' +
      '<div class="sec-t">Leave history</div>' +
      (lv.length ? '<div class="tw"><table><thead><tr><th>Type</th><th>From</th><th class="hide-sm">To</th>' +
        '<th class="num">Days</th><th>Status</th><th class="hide-sm">Note</th></tr></thead><tbody>' +
        lv.map(l => '<tr><td class="t-main">' + l.type + '</td><td>' + fmtDShort(l.from) + '</td>' +
          '<td class="hide-sm">' + fmtD(l.to) + '</td>' +
          '<td class="num">' + l.days + '</td><td>' + statusPill(l.status === 'pending' ? 'open' : 'approved') + '</td>' +
          '<td class="note hide-sm">' + l.note + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="empty">No leave taken or booked.</div>') +
      '<button class="btn gold" style="margin-top:16px" onclick="formLeave(' + s.id + ')">Record leave</button>';
  }

  else if (tab === 'notes') {
    body = '<div class="sec-t">Reviews</div>' +
      kv('Current rating', s.rating + '/5 ' + '★'.repeat(Math.round(s.rating))) +
      kv('Last review', fmtD(dAgo(int(40, 200)))) +
      kv('Next review due', fmtD(dAgo(-int(20, 90)))) +
      '<div class="sec-t">Notes</div>' +
      '<p class="note">Private notes on this person. Only Owner and their manager can read these.</p>' +
      '<div class="row"><div><b>Onboarding complete</b><small>All induction modules signed off</small></div><span class="note">' + fmtDShort(s.startDate) + '</span></div>' +
      '<div class="row"><div><b>Handles escalations well</b><small>Noted during the July billing incident</small></div><span class="note">Jul 2026</span></div>' +
      '<button class="btn" style="margin-top:14px" onclick="toast(\'Note editor is not wired up in this prototype yet\')">+ Add note</button>';
  }

  else if (tab === 'docs') {
    const docs = DB.docs.filter(d => d.staffId === s.id);
    const onFile = docs.filter(d => d.status === 'on file').length;
    body = '<div class="sec-t">Documents</div>' +
      '<p class="note">' + onFile + ' of ' + docs.length + ' on file. Tap any document to read it — ' +
      'only the Owner and this person\'s manager can open these.</p>' +
      '<div style="margin-top:12px">' +
      docs.map(d => '<div class="row klik" onclick="viewDoc(' + d.id + ')">' +
        '<div><b>' + d.kind + '</b><small>' +
        (d.status === 'on file' ? d.pages + ' page' + (d.pages === 1 ? '' : 's') + ' · added ' + fmtD(d.addedOn)
          : d.status === 'not enrolled' ? 'Nothing to show — not enrolled' : 'Not supplied yet') +
        '</small></div>' +
        (d.status === 'on file' ? '<span class="pill green">View &rsaquo;</span>'
          : d.status === 'not enrolled' ? '<span class="pill grey">Not enrolled</span>'
            : '<span class="pill amber">Missing</span>') + '</div>').join('') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
      '<button class="btn" onclick="toast(\'File upload lands with the Supabase storage bucket\')">Upload a document</button>' +
      '<button class="btn" onclick="downloadStaffDocs(' + s.id + ')">Export the index</button></div>';
  }

  return backBtn() +
    '<div class="dhead"><div class="dav">' + initials(s.name) + '</div>' +
    '<div style="flex:1;min-width:220px"><h2>' + esc(s.name) + ' ' + statusPill(s.status) + '</h2>' +
    '<div class="dmeta">' + s.staffId + ' · ' + s.title + ' · ' + s.dept + ' · <span class="pill grey">' + role.name + '</span></div></div>' +
    '<div style="display:flex;gap:8px">' +
    (!todayA || !todayA.in ? '<button class="btn gold" onclick="clockIn(' + s.id + ')">Clock in</button>'
      : !todayA.out ? '<button class="btn gold" onclick="clockOut(' + s.id + ')">Clock out</button>' : '') +
    '<button class="btn" onclick="formStaffRole(' + s.id + ')">Change role</button></div></div>' +
    '<div class="dstats">' +
    dstat(money(s.basic), 'Monthly basic', 'm') +
    dstat(money(gross), 'Monthly gross', 'm') +
    dstat(slips.length ? money(slips[0].net) : '—', 'Last net pay', 'g') +
    dstat(Q.attRate(s.id) + '%', 'Attendance 30d', Q.attRate(s.id) >= 90 ? 'g' : 'a') +
    dstat((s.leaveEntitlement - Q.leaveTaken(s.id)) + 'd', 'Leave left') +
    dstat(s.rating, 'Rating') +
    '</div>' +
    '<div class="dsplit">' +
    vtabs(key, [['profile', 'Profile'], ['performance', 'Performance'], ['pay', 'Pay setup'],
      ['payslips', 'Payslips'], ['attendance', 'Attendance'], ['leave', 'Leave'],
      ['notes', 'Reviews & notes'], ['docs', 'Documents']], tab) +
    '<div>' + body + '</div></div>';
};

/* =================== PAYSLIP =================== */
DETAIL.slip = function (id) {
  const sl = DB.payslips.find(x => x.id === +id);
  if (!sl) return '<div class="empty">Payslip not found.</div>';
  const st = Q.staffM(sl.staffId);
  const allow = sl.housing + sl.transport + sl.bonus + sl.overtime;

  const others = Q.slipsForStaff(sl.staffId).filter(x => x.id !== sl.id);

  return backBtn() +
    '<div class="dhead"><div class="dav klik" style="cursor:pointer" onclick="openDetail(\'staff\',' + sl.staffId + ')">' +
    initials(sl.staffName) + '</div>' +
    '<div style="flex:1;min-width:220px"><h2>Payslip · ' + sl.month + '</h2>' +
    '<div class="dmeta">' + esc(sl.staffName) + ' · ' + st.staffId + ' · ' + sl.dept + ' · pay date ' + fmtD(sl.payDate) + '</div></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    /* the person's record belongs at the top, next to the other actions */
    '<button class="btn" onclick="openDetail(\'staff\',' + sl.staffId + ')">Open ' +
    esc(sl.staffName.split(' ')[0]) + '&rsquo;s record &rarr;</button>' +
    '<button class="btn" onclick="downloadSlip(' + sl.id + ')">Download</button>' +
    (sl.uploaded ? '' : '<button class="btn gold" onclick="publishSlip(' + sl.id + ')">Publish to staff</button>') +
    '</div></div>' +

    '<div class="dstats">' +
    dstat(money(sl.gross), 'Gross', 'm') +
    dstat('−' + money(sl.deductions), 'Deductions', 'r') +
    dstat(money(sl.net), 'Net paid', 'g') +
    dstat(statusPill(sl.status), 'Status') +
    dstat(sl.uploaded ? 'Published' : 'Not published', 'Visible to staff', sl.uploaded ? 'g' : 'a') +
    '</div>' +

    /* Payment and Other months side by side, above the breakdown */
    '<div class="cols2">' +
    '<div class="pnl"><div class="ph"><div><h3>Payment</h3>' +
    '<div class="ph-sub">Where and when this was paid</div></div></div>' +
    kv('Pay date', fmtD(sl.payDate)) +
    kv('Method', 'Bank transfer') +
    kv('Account', esc(sl.bank)) +
    kv('Status', statusPill(sl.status)) +
    kv('Visible to staff', sl.uploaded
      ? '<span style="color:var(--green)">Published ' + fmtD(sl.publishedOn) + '</span>'
      : '<span style="color:var(--amber)">Not yet</span>') +
    '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>Other months</h3>' +
    '<div class="ph-sub">' + others.length + ' more on record · tap to open</div></div></div>' +
    (others.length
      ? '<div class="tw"><table><thead><tr><th>Month</th><th class="num">Net</th><th class="hide-sm">Status</th><th></th></tr></thead><tbody>' +
      others.map(x => '<tr class="klik" onclick="openDetail(\'slip\',' + x.id + ')">' +
        '<td class="t-main">' + x.month + '</td>' +
        '<td class="num">' + money(x.net) + '</td>' +
        '<td class="hide-sm">' + statusPill(x.status) + '</td>' +
        '<td class="chev">&rsaquo;</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="note">This is the only payslip on record.</div>') +
    '</div></div>' +

    '<div class="pnl"><div class="ph"><div><h3>How this pay was worked out</h3>' +
    '<div class="ph-sub">Every line that moves gross to net</div></div></div>' +
    '<div class="cols2"><div>' +
    '<div class="sec-t">Earnings</div>' +
    kv('Basic salary', money(sl.basic)) +
    (DB.settings.allowances.enabled
      ? kv('Housing allowance', money(sl.housing)) + kv('Transport allowance', money(sl.transport))
      : '<div class="kv"><span class="k">Allowances</span><span class="v">' +
        '<span class="pill grey">Not in use</span></span></div>') +
    (sl.bonus ? kv('Performance bonus', money(sl.bonus)) : '') +
    (sl.overtime ? kv('Overtime', money(sl.overtime)) : '') +
    kv('<b>Gross pay</b>', '<b>' + money(sl.gross) + '</b>') +
    '</div><div>' +
    '<div class="sec-t">Deductions</div>' +
    kv('PAYE tax <span class="note">11.5% of gross</span>', '−' + money(sl.paye)) +
    '<div class="kv"><span class="k">Pension</span><span class="v">' +
    (sl.pensionOptedIn ? '−' + money(sl.pension) : '<span class="pill grey">Not enrolled</span>') + '</span></div>' +
    '<div class="kv"><span class="k">NHF</span><span class="v">' +
    (sl.nhfOptedIn ? '−' + money(sl.nhf) : '<span class="pill grey">Not enrolled</span>') + '</span></div>' +
    (sl.loan ? kv('Staff loan repayment', '−' + money(sl.loan)) : '') +
    kv('<b>Total deductions</b>', '<b style="color:var(--red)">−' + money(sl.deductions) + '</b>') +
    '</div></div>' +
    '<div style="border-top:2px solid var(--gold);margin-top:16px;padding-top:14px">' +
    '<div class="kv" style="border:0"><span class="k" style="font-size:15px">Net pay</span>' +
    '<span class="v" style="font-size:21px;font-family:\'Playfair Display\',serif">' + money(sl.net) + '</span></div></div>' +
    (sl.pensionOptedIn ? '' : '<p class="hint">No pension is deducted because ' +
      esc(sl.staffName.split(' ')[0]) + ' has not opted in. Enrolment is voluntary and set on their Pay setup tab.</p>') +
    '</div>';
};

/* =================== TICKET =================== */
DETAIL.ticket = function (id) {
  const t = Q.ticket(id);
  if (!t) return '<div class="empty">Ticket not found.</div>';
  const s = Q.sub(t.subId);
  return backBtn() +
    '<div class="dhead"><div style="flex:1;min-width:220px"><h2>' + esc(t.title) + ' ' + statusPill(t.state) + '</h2>' +
    '<div class="dmeta">#' + t.ref + ' · ' + t.kind + ' · opened ' + ago(t.openedAt) + ' · ' + (t.assignedTo ? 'assigned to ' + esc(t.assignedName) : 'unassigned') + '</div></div>' +
    '<div style="display:flex;gap:8px">' +
    '<button class="btn" onclick="formAssignTicket(' + t.id + ')">Assign</button>' +
    (t.state === 'resolved' ? '' : '<button class="btn gold" onclick="resolveTicket(' + t.id + ')">Mark resolved</button>') +
    '</div></div>' +
    '<div class="dstats">' +
    dstat(t.firstReplyMins + 'm', 'First reply', t.firstReplyMins < DB.settings.slaHours * 60 ? 'g' : 'r') +
    dstat(esc(t.subscriber), 'Subscriber') +
    dstat(t.plan, 'Plan', 'm') +
    (t.satisfaction ? dstat('★'.repeat(t.satisfaction), 'Rating', 'g') : '') +
    '</div>' +
    '<div class="cols"><div class="pnl"><div class="ph"><h3>Conversation</h3></div>' +
    t.thread.map(m => '<div style="padding:12px 14px;border-radius:11px;margin-bottom:10px;background:' +
      (m.side === 'us' ? 'color-mix(in srgb,var(--gold) 12%,var(--panel))' : 'var(--panel-2)') + '">' +
      '<div style="font-size:11px;color:var(--faint);margin-bottom:5px">' + esc(m.who) + ' · ' + fmtD(m.at) + '</div>' +
      '<div style="font-size:13px;line-height:1.6">' + esc(m.text) + '</div></div>').join('') +
    '<textarea class="fg" style="width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:9px;padding:11px;min-height:80px;margin-top:6px" placeholder="Write a reply…"></textarea>' +
    '<button class="btn gold" style="margin-top:8px" onclick="toast(\'Reply sending needs the email integration — coming with the backend\')">Send reply</button>' +
    '</div><div>' +
    '<div class="pnl"><div class="ph"><h3>Ticket</h3></div>' +
    kv('Reference', t.ref) + kv('Type', t.kind) + kv('State', statusPill(t.state)) +
    kv('Opened', fmtD(t.openedAt)) + kv('First reply', t.firstReplyMins + ' minutes') +
    kv('Assigned to', t.assignedTo ? '<button class="lnk" onclick="openDetail(\'staff\',' + t.assignedTo + ')">' + esc(t.assignedName) + ' &rsaquo;</button>' : '<span class="pill amber">Unassigned</span>') +
    (t.resolvedAt ? kv('Resolved', fmtD(t.resolvedAt)) : '') + '</div>' +
    '<div class="pnl"><div class="ph"><h3>Who raised it</h3></div>' +
    kv('Business', esc(t.subscriber)) + kv('Owner', esc(s.owner)) + kv('Plan', '<span class="tier">' + s.planName + '</span>') +
    kv('Health', statusPill(s.health)) + kv('MRR', s.mrr ? money(s.mrr) : '—') +
    '<button class="btn" style="width:100%;margin-top:12px" onclick="openDetail(\'sub\',' + s.id + ')">Open account &rarr;</button></div>' +
    '</div></div>';
};

/* =================== PAYMENT =================== */
DETAIL.pay = function (id) {
  const p = DB.payments.find(x => x.id === +id);
  if (!p) return '<div class="empty">Payment not found.</div>';
  const s = Q.sub(p.subId);
  return backBtn() +
    '<div class="dhead"><div style="flex:1;min-width:220px"><h2>' + money(p.amount) + ' ' + statusPill(p.status) + '</h2>' +
    '<div class="dmeta">' + p.ref + ' · ' + esc(p.subscriber) + ' · ' + fmtD(p.date) + '</div></div>' +
    '<div style="display:flex;gap:8px">' +
    (p.status === 'failed' || p.status === 'overdue' ? '<button class="btn gold" onclick="retryPayment(' + p.id + ')">Retry charge</button>' : '') +
    (p.status === 'successful' ? '<button class="btn danger" onclick="formRefund(' + p.id + ')">Issue refund</button>' : '') +
    '<button class="btn" onclick="downloadInvoice(' + p.id + ')">Invoice</button></div></div>' +
    '<div class="cols"><div class="pnl"><div class="ph"><h3>Transaction</h3></div>' +
    kv('Amount', '<b>' + money(p.amount) + '</b>') + kv('Status', statusPill(p.status)) +
    kv('Reference', p.ref) + kv('Invoice number', p.invoice) +
    kv('Provider', p.provider) + kv('Method', p.method) +
    kv('Date', fmtD(p.date)) + kv('Plan charged', '<span class="tier">' + p.plan + '</span> · ' + p.cycle) +
    (p.status === 'failed' ? '<div class="sec-t">Why it failed</div><p class="note">The card issuer declined the charge (insufficient funds). Flutterwave will retry automatically in 72 hours, or you can retry now.</p>' : '') +
    (p.status === 'upcoming' ? '<div class="sec-t">Scheduled</div><p class="note">This charge has not run yet. It will be taken from the card on file on ' + fmtD(p.date) + '.</p>' : '') +
    '</div><div><div class="pnl"><div class="ph"><h3>Subscriber</h3></div>' +
    kv('Business', esc(s.name)) + kv('Owner', esc(s.owner)) + kv('Status', statusPill(s.status)) +
    kv('MRR', s.mrr ? money(s.mrr) : '—') + kv('Lifetime', money(DB.payments.filter(x => x.subId === s.id && x.status === 'successful').reduce((t, x) => t + x.amount, 0))) +
    '<button class="btn" style="width:100%;margin-top:12px" onclick="openDetail(\'sub\',' + s.id + ')">Open account &rarr;</button></div>' +
    '<div class="pnl"><div class="ph"><h3>Other payments</h3></div>' +
    DB.payments.filter(x => x.subId === s.id && x.id !== p.id).slice(0, 6).map(x =>
      '<div class="row klik" onclick="openDetail(\'pay\',' + x.id + ')"><div><b>' + money(x.amount) + '</b><small>' + fmtD(x.date) + '</small></div>' +
      statusPill(x.status) + '</div>').join('') + '</div></div></div>';
};

/* =================== ONBOARDING =================== */
DETAIL.onb = function (id) {
  const o = DB.onboarding.find(x => x.id === +id);
  if (!o) return '<div class="empty">Not found.</div>';
  const s = Q.sub(o.subId);
  return backBtn() +
    '<div class="dhead"><div class="dav">' + initials(o.name) + '</div>' +
    '<div style="flex:1;min-width:220px"><h2>' + esc(o.name) + ' ' + statusPill(o.state) + '</h2>' +
    '<div class="dmeta">' + esc(o.owner) + ' · ' + esc(o.city) + ' · found us via ' + esc(o.channel) + '</div></div>' +
    '<div style="display:flex;gap:8px"><button class="btn" onclick="openDetail(\'sub\',' + s.id + ')">Full account</button>' +
    '<button class="btn gold" onclick="formConvert(' + s.id + ')">Convert to paid</button></div></div>' +
    '<div class="dstats">' +
    dstat(o.progress + '%', 'Setup complete', o.progress >= 80 ? 'g' : 'a') +
    dstat(o.step + '/6', 'Steps done') +
    dstat(o.trialEndsIn <= 0 ? 'today' : o.trialEndsIn + ' days', 'Trial ends', o.trialEndsIn <= 3 ? 'r' : '') +
    dstat(fmtD(o.joined), 'Signed up') +
    dstat(ago(o.lastTouch), 'Last activity') +
    '</div>' +
    '<div class="cols"><div class="pnl"><div class="ph"><div><h3>Setup checklist</h3>' +
    '<div class="ph-sub">What makes up this card — each step is something they have to finish before the account is live</div></div></div>' +
    o.steps.map((st, i) => '<div class="row"><div><b>' + (i + 1) + '. ' + st.label + '</b>' +
      '<small>' + (st.done ? 'Completed' : 'Not started') + '</small></div>' +
      (st.done ? '<span class="pill green">Done</span>' : '<span class="pill grey">Waiting</span>') + '</div>').join('') +
    '<div class="prog" style="margin-top:14px;height:8px"><i style="width:' + o.progress + '%"></i></div>' +
    '<p class="note" style="margin-top:8px">' + o.step + ' of 6 steps complete. ' +
    (o.state === 'ready' ? 'This account is ready to convert to a paid plan.'
      : o.state === 'new' ? 'Nothing has been set up yet — worth a call.'
        : 'Partway through. The next thing they need is: ' + (o.steps.find(x => !x.done) || {}).label + '.') + '</p>' +
    '</div><div><div class="pnl"><div class="ph"><h3>Contact</h3></div>' +
    kv('Owner', esc(o.owner)) + kv('Email', esc(o.email)) + kv('Phone', s.phone) + kv('City', esc(o.city)) +
    '<div class="actrow" style="margin-top:12px"><a href="tel:' + s.phone.replace(/\s/g, '') + '">Call</a>' +
    '<a href="https://wa.me/' + s.phone.replace(/[^0-9]/g, '') + '" target="_blank" rel="noopener">WhatsApp</a>' +
    '<a href="mailto:' + o.email + '">Email</a></div></div>' +
    '<div class="pnl"><div class="ph"><h3>Trial</h3></div>' +
    kv('Started', fmtD(o.joined)) + kv('Ends', fmtD(s.renewsOn)) +
    kv('Days left', o.trialEndsIn <= 0 ? '<span class="pill red">Ended</span>' : o.trialEndsIn) +
    kv('Orders created', s.ordersLast30) + kv('Team invited', s.users) + '</div></div></div>';
};

/* =================== SMALL DETAILS =================== */
DETAIL.fb = function (id) {
  const f = DB.feedback.find(x => x.id === +id);
  if (!f) return '<div class="empty">Not found.</div>';
  const s = Q.sub(f.subId);
  return backBtn() +
    '<div class="dhead"><div style="flex:1"><h2>' + esc(f.title) + '</h2>' +
    '<div class="dmeta">' + f.kind + ' · ' + esc(f.subscriber) + ' · ' + fmtD(f.at) + '</div></div>' +
    '<div style="display:flex;gap:8px"><button class="btn gold" onclick="toast(\'Status change saved locally\')">Change status</button></div></div>' +
    '<div class="dstats">' + dstat(f.votes || '—', 'Votes', 'm') + dstat(statusPill(f.state), 'Status') +
    (f.rating ? dstat('★'.repeat(f.rating), 'Rating', 'g') : '') + dstat(f.plan, 'Plan') + '</div>' +
    '<div class="cols"><div class="pnl"><div class="ph"><h3>What they said</h3></div>' +
    '<p style="font-size:14px;line-height:1.75">' + esc(f.body) + '</p></div>' +
    '<div class="pnl"><div class="ph"><h3>Who</h3></div>' + kv('Business', esc(s.name)) +
    kv('Owner', esc(s.owner)) + kv('Plan', '<span class="tier">' + s.planName + '</span>') +
    '<button class="btn" style="width:100%;margin-top:12px" onclick="openDetail(\'sub\',' + s.id + ')">Open account &rarr;</button></div></div>';
};

DETAIL.ann = function (id) {
  const a = DB.announcements.find(x => x.id === +id);
  if (!a) return '<div class="empty">Not found.</div>';
  return backBtn() +
    '<div class="dhead"><div style="flex:1"><h2>' + esc(a.title) + ' ' + statusPill(a.state) + '</h2>' +
    '<div class="dmeta">' + a.audience + ' · ' + a.channel + ' · ' + fmtD(a.date) + ' · by ' + a.author + '</div></div>' +
    '<div style="display:flex;gap:8px">' +
    (a.state === 'published' ? '' : '<button class="btn gold" onclick="publishAnnouncement(' + a.id + ')">' + (a.state === 'draft' ? 'Publish now' : 'Send now') + '</button>') +
    '<button class="btn" onclick="formAnnouncement(' + a.id + ')">Edit</button></div></div>' +
    '<div class="dstats">' + dstat(a.reach || '—', 'Reached', 'm') +
    dstat(a.reach ? pct(a.opened, a.reach) + '%' : '—', 'Open rate', 'g') +
    dstat(a.audience, 'Audience') + dstat(a.channel, 'Channel') + '</div>' +
    '<div class="pnl" style="max-width:720px"><div class="ph"><h3>Message</h3></div>' +
    '<p style="font-size:14px;line-height:1.75">' + esc(a.body) + '</p></div>';
};

DETAIL.task = function (id) {
  const t = DB.tasks.find(x => x.id === +id);
  if (!t) return '<div class="empty">Not found.</div>';
  return backBtn() +
    '<div class="dhead"><div style="flex:1"><h2>' + esc(t.title) + '</h2>' +
    '<div class="dmeta">' + t.priority + ' priority · assigned to ' + esc(t.assignedName) + ' · due ' + fmtD(t.due) + '</div></div>' +
    '<div style="display:flex;gap:8px">' +
    (t.done ? '<button class="btn" onclick="reopenTask(' + t.id + ')">Reopen</button>'
      : '<button class="btn gold" onclick="completeTask(' + t.id + ')">Mark done</button>') +
    '<button class="btn" onclick="formTask(' + t.id + ')">Edit</button></div></div>' +
    '<div class="dstats">' +
    dstat(t.done ? 'Done' : t.dueIn < 0 ? Math.abs(t.dueIn) + 'd late' : t.dueIn === 0 ? 'Due today' : 'In ' + t.dueIn + 'd', 'Status', t.done ? 'g' : t.dueIn < 0 ? 'r' : 'a') +
    dstat(t.priority, 'Priority') + dstat(esc(t.assignedName), 'Owner') + dstat(fmtD(t.createdAt), 'Created') + '</div>' +
    '<div class="pnl" style="max-width:720px"><div class="ph"><h3>Detail</h3></div>' +
    '<p style="font-size:14px;line-height:1.75">' + esc(t.body) + '</p>' +
    '<div class="sec-t">Assigned to</div>' +
    '<button class="btn" onclick="openDetail(\'staff\',' + t.assignedTo + ')">' + esc(t.assignedName) + ' &rarr;</button></div>';
};

DETAIL.audit = function (id) {
  const a = DB.activity.find(x => x.id === +id);
  if (!a) return '<div class="empty">Entry not found.</div>';
  const tgt = a.target ? a.target.split(':') : null;
  return backBtn() +
    '<div class="dhead"><div style="flex:1"><h2>' + a.action + '</h2>' +
    '<div class="dmeta">' + fmtD(a.at) + ' at ' + new Date(a.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · ' + ago(a.at) + '</div></div></div>' +
    '<div class="cols"><div class="pnl"><div class="ph"><h3>What happened</h3></div>' +
    '<p style="font-size:14px;line-height:1.75">' + esc(a.detail) + '</p>' +
    '<div class="sec-t">Why</div><p class="note">' + esc(a.reason) + '</p>' +
    (tgt && tgt[0] === 'subscriber' ? '<div class="sec-t">Affected account</div>' +
      '<button class="btn" onclick="openDetail(\'sub\',' + tgt[1] + ')">' + esc((Q.sub(tgt[1]) || {}).name || 'Open account') + ' &rarr;</button>' : '') +
    (tgt && tgt[0] === 'ticket' ? '<div class="sec-t">Related ticket</div>' +
      '<button class="btn" onclick="openDetail(\'ticket\',' + tgt[1] + ')">Open ticket &rarr;</button>' : '') +
    '</div><div class="pnl"><div class="ph"><h3>Record</h3></div>' +
    kv('Entry ID', 'AUD-' + String(a.id).slice(-6)) +
    kv('Action type', a.kind) +
    kv('Who did it', '<button class="lnk" onclick="openDetail(\'staff\',' + a.actorId + ')">' + esc(a.actor) + ' &rsaquo;</button>') +
    kv('Their role', a.actorRole) +
    kv('When', fmtD(a.at) + ' ' + new Date(a.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })) +
    kv('IP address', a.ip) + kv('Device', a.device) +
    kv('Target', a.target || '<span class="note">None</span>') + '</div></div>';
};
