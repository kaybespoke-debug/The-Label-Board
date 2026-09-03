/* ============================================================
   calendar.js — the operator's calendar.

   Ported from the customer app's planner (see PLANNER.md), with one
   deliberate difference: the console is not a studio. It runs no fittings
   and makes no garments, so the two sources that drive the studio's
   planner have no equivalent here and were NOT recreated. Adding an
   appointments store to the console just to mirror the app would invent
   exactly the duplication the rule below exists to prevent.

   THE RULE, unchanged: the calendar is a VIEW over records that already
   exist, not a second set of records.

   Five sources are read, never copied:

     task          DB.tasks                    due date + who it is for
     announcement  DB.announcements            the scheduled ones
     renewal       subscribers renewing/overdue when money is due
     trial         DB.onboarding               when a trial lapses
     payroll       DB.payslips                 when people get paid

   Three kinds own their own record, because nothing in the console held
   them before:

     meeting   with a video link
     reminder
     content   the content calendar

   Editing a task from here edits the TASK. There is no second copy of it,
   so there is never an argument about which one is right. audit_calendar.js
   checks that, and it is the first thing to keep true.

   Invitees are Label Board staff only. Kayode's decision: a studio owner
   is never invited from here and never gains a console account. If that
   changes, invitees stay staff ids and guests become plain email strings;
   never a join onto tenant users.
   ============================================================ */

/* ---------------- repeats ----------------
   Evaluated per day rather than stored as occurrences, so editing an entry
   changes every future one and a year of weekly meetings costs one record
   instead of fifty-two. */
function calHitsDay(e, dayIso) {
  if (!e || !e.date) return false;
  if (e.date === dayIso) return true;
  if (!e.repeat) return false;
  const start = parseD(e.date), day = parseD(dayIso);
  if (day < start) return false;
  const days = Math.round((day - start) / DAY);
  if (e.repeat === 'daily') return true;
  if (e.repeat === 'weekly') return days % 7 === 0;
  if (e.repeat === 'fortnightly') return days % 14 === 0;
  /* Monthly keeps the day-of-month. A 31st simply does not land in a
     30-day month, which is honest rather than silently moving it. */
  if (e.repeat === 'monthly') return day.getDate() === start.getDate();
  return false;
}

/* ---------------- free video ----------------
   A Jitsi room. No server, no account, no bill. The salt is not
   decoration: two meetings sharing a room means one team walks into
   another team's call. */
function makeVideoLink(title) {
  const slug = String(title || 'meeting').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'meeting';
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  let salt = '';
  for (let i = 0; i < 10; i++) salt += abc[b[i] % abc.length];
  return 'https://meet.jit.si/TheLabelBoard-' + slug + '-' + salt;
}

/* ---------------- the five read-only sources ----------------
   `everyone: true` means the entry stays visible in both lenses because it
   is the platform's business and everybody needs it. A support agent
   opening the calendar should see their own work, not the owner's diary,
   but they still need to know payroll runs on Tuesday. */
function calDerived() {
  const out = [];
  const t0 = startOfDay(DB.today).getTime();
  const dayFromNow = n => iso(new Date(t0 + n * DAY));

  DB.tasks.forEach(t => out.push({
    kind: 'task', recId: t.id, title: t.title, date: t.due, time: '',
    sub: '→ ' + t.assignedName, done: t.done,
    tone: t.done ? 'grey' : t.dueIn < 0 ? 'red' : t.dueIn === 0 ? 'amber' : 'blue',
    go: "openDetail('task'," + t.id + ")",
    owner: t.assignedTo, everyone: false
  }));

  DB.announcements.filter(a => a.state === 'scheduled').forEach(a => out.push({
    kind: 'announcement', recId: a.id, title: a.title, date: a.date, time: '',
    sub: a.audience + ' · ' + a.channel, tone: 'purple',
    go: "go('announcements')", everyone: true
  }));

  Q.subsAsOf().filter(s => s.status === 'active' && s.renewIn >= 0 && s.renewIn <= 45)
    .forEach(s => out.push({
      kind: 'renewal', recId: s.id, title: s.name + ' renews', date: dayFromNow(s.renewIn), time: '',
      sub: money(s.mrr) + ' · ' + s.planName, tone: s.renewIn <= 3 ? 'amber' : 'green',
      go: "openDetail('sub'," + s.id + ")", everyone: true
    }));

  Q.pastDue().forEach(s => out.push({
    kind: 'renewal', recId: s.id, title: s.name + ' is past due', date: dayFromNow(Math.min(0, s.renewIn)),
    time: '', sub: money(s.mrr) + ' not collected', tone: 'red',
    go: "openDetail('sub'," + s.id + ")", everyone: true
  }));

  (DB.onboarding || []).forEach(o => out.push({
    kind: 'trial', recId: o.id, title: o.name + ' trial ends', date: dayFromNow(o.trialEndsIn), time: '',
    sub: o.progress + '% set up · ' + o.plan, tone: o.trialEndsIn <= 3 ? 'red' : 'amber',
    go: "go('onboarding')", everyone: true
  }));

  /* One entry per pay date, not one per payslip. */
  const payDates = {};
  (DB.payslips || []).forEach(p => {
    if (!p.payDate) return;
    payDates[p.payDate] = payDates[p.payDate] || { n: 0, net: 0, month: p.month };
    payDates[p.payDate].n++;
    payDates[p.payDate].net += p.net;
  });
  Object.keys(payDates).forEach(d => out.push({
    kind: 'payroll', recId: d, title: 'Payroll — ' + payDates[d].month, date: d, time: '',
    sub: payDates[d].n + ' staff · ' + money(payDates[d].net) + ' net', tone: 'gold',
    go: "go('payroll')", everyone: true
  }));

  return out;
}

/* Entries the calendar owns: meetings, reminders, content. */
function calOwned() {
  return (DB.calendar || []).map(e => ({
    kind: e.type, recId: e.id, title: e.title, date: e.date, time: e.time || '',
    sub: (e.time ? e.time + ' · ' : '') +
      (e.invitees && e.invitees.length
        ? e.invitees.length + ' invited'
        : e.notes ? String(e.notes).slice(0, 40) : 'Just you'),
    tone: e.type === 'meeting' ? 'blue' : e.type === 'content' ? 'purple' : 'amber',
    go: "formCalEntry(" + e.id + ")", link: e.link, repeat: e.repeat,
    owner: e.staffId, invitees: e.invitees || [], everyone: false, own: true, done: e.done,
    date_raw: e.date, entry: e
  }));
}

/* Everything landing on one day, after the lens. */
function calForDay(dayIso) {
  const mine = UI.calLens === 'mine';
  const me = ME.staffId;
  const derived = calDerived().filter(e => e.date === dayIso);
  const owned = calOwned().filter(e => calHitsDay(e.entry, dayIso));
  return derived.concat(owned).filter(e => {
    if (!mine || e.everyone) return true;
    return e.owner === me || (e.invitees || []).indexOf(me) >= 0;
  }).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

/* ---------------- the page ---------------- */
PAGES.calendar = function () {
  if (UI.calMonth == null) UI.calMonth = iso(DB.today).slice(0, 7);
  if (!UI.calDay) UI.calDay = iso(DB.today);
  if (!UI.calLens) UI.calLens = 'all';

  const [yy, mm] = UI.calMonth.split('-').map(Number);
  const first = new Date(yy, mm - 1, 1);
  const daysIn = new Date(yy, mm, 0).getDate();
  const lead = (first.getDay() + 6) % 7;            // Monday-first
  const monthName = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const todayIso = iso(DB.today);

  /* Count once per day rather than per cell render. */
  const counts = {};
  for (let d = 1; d <= daysIn; d++) {
    const k = UI.calMonth + '-' + String(d).padStart(2, '0');
    counts[k] = calForDay(k);
  }

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell out"></div>');
  for (let d = 1; d <= daysIn; d++) {
    const k = UI.calMonth + '-' + String(d).padStart(2, '0');
    const list = counts[k];
    const tones = [...new Set(list.map(e => e.tone))].slice(0, 4);
    cells.push('<button class="cal-cell' + (k === todayIso ? ' today' : '') +
      (k === UI.calDay ? ' on' : '') + '" onclick="setCalDay(\'' + k + '\')">' +
      '<span class="cal-n">' + d + '</span>' +
      '<span class="cal-dots">' + tones.map(t => '<i class="' + t + '"></i>').join('') + '</span>' +
      '</button>');
  }

  const dayList = calForDay(UI.calDay);
  const staffCount = DB.staff.length;
  const upcoming = [];
  for (let n = 0; n <= 14 && upcoming.length < 8; n++) {
    const k = iso(new Date(startOfDay(DB.today).getTime() + n * DAY));
    calForDay(k).forEach(e => { if (upcoming.length < 8) upcoming.push([k, e]); });
  }

  const mineCount = (() => {
    let n = 0;
    for (let i = 0; i <= 30; i++) {
      const k = iso(new Date(startOfDay(DB.today).getTime() + i * DAY));
      n += calForDay(k).filter(e => !e.everyone).length;
    }
    return n;
  })();

  return '<div class="stats">' +
    statCard({ label: 'Today', value: calForDay(todayIso).length, tone: 'money',
      onclick: "setCalDay('" + todayIso + "')", sub: fmtD(todayIso) }) +
    statCard({ label: 'Next 7 days', value: (() => {
      let n = 0; for (let i = 0; i < 7; i++) n += calForDay(iso(new Date(startOfDay(DB.today).getTime() + i * DAY))).length;
      return n; })(), tone: 'info', sub: 'Everything landing this week' }) +
    statCard({ label: UI.calLens === 'mine' ? 'Mine, 30 days' : 'Assigned work, 30 days',
      value: mineCount, tone: 'warn', sub: 'Tasks, meetings and reminders' }) +
    statCard({ label: 'Meetings booked', value: (DB.calendar || []).filter(e => e.type === 'meeting').length,
      tone: 'good', sub: 'Video links included' }) +
    '</div>' +

    '<div class="bar">' +
    '<button class="btn" onclick="setCalMonth(-1)">&lsaquo;</button>' +
    '<b style="min-width:150px;text-align:center">' + monthName + '</b>' +
    '<button class="btn" onclick="setCalMonth(1)">&rsaquo;</button>' +
    '<button class="btn" onclick="setCalToday()">Today</button>' +
    '<span class="spacer"></span>' +
    /* The lens only earns its place once there is more than one person to
       filter against. A one-person console has nothing to choose between. */
    (staffCount > 1
      ? '<div class="tabs" style="margin:0">' +
        '<button class="tab' + (UI.calLens === 'all' ? ' on' : '') + '" onclick="setCalLens(\'all\')">Everyone</button>' +
        '<button class="tab' + (UI.calLens === 'mine' ? ' on' : '') + '" onclick="setCalLens(\'mine\')">Mine</button>' +
        '</div>' : '') +
    '<button class="btn gold" onclick="formCalEntry(null)">+ New entry</button>' +
    '</div>' +

    '<div class="pnl">' +
    '<div class="cal-head">' + ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
      .map(d => '<span>' + d + '</span>').join('') + '</div>' +
    '<div class="cal-grid">' + cells.join('') + '</div>' +
    '<div class="cal-key">' +
    [['blue','Task or meeting'],['amber','Due soon'],['red','Late or overdue'],
     ['green','Renewal'],['purple','Announcement or content'],['gold','Payroll']]
      .map(k => '<span><i class="' + k[0] + '"></i>' + k[1] + '</span>').join('') +
    '</div></div>' +

    '<div class="cols2">' +
    '<div class="pnl"><div class="ph"><div><h3>' + fmtD(UI.calDay) + '</h3>' +
    '<div class="ph-sub">' + (dayList.length ? dayList.length + ' thing' + (dayList.length === 1 ? '' : 's') + ' on this day' : 'Nothing on this day') +
    '</div></div></div>' +
    (dayList.length ? dayList.map(e => calRow(e)).join('')
      : '<div class="empty" style="padding:22px 6px">Nothing scheduled.</div>') + '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>Coming up</h3>' +
    '<div class="ph-sub">Next fourteen days</div></div></div>' +
    (upcoming.length ? upcoming.map(([k, e]) =>
      '<div class="row klik" onclick="' + e.go + '">' +
      '<div><b>' + esc(e.title) + '</b><small>' + calKindLabel(e.kind) + ' · ' + esc(e.sub) + '</small></div>' +
      '<span class="note">' + (k === todayIso ? 'Today' : fmtDShort(k)) + '</span></div>').join('')
      : '<div class="empty" style="padding:22px 6px">Nothing in the next two weeks.</div>') +
    '</div></div>';
};

function calKindLabel(k) {
  return { task: 'Task', announcement: 'Announcement', renewal: 'Renewal', trial: 'Trial',
    payroll: 'Payroll', meeting: 'Meeting', reminder: 'Reminder', content: 'Content' }[k] || k;
}

function calRow(e) {
  return '<div class="row klik" onclick="' + e.go + '">' +
    '<div style="min-width:0"><b>' + (e.time ? '<span class="note">' + e.time + '</span> ' : '') +
    esc(e.title) + '</b>' +
    '<small>' + calKindLabel(e.kind) + ' · ' + esc(e.sub) +
    (e.repeat ? ' · repeats ' + e.repeat : '') + '</small></div>' +
    (e.link ? '<a class="btn" style="padding:6px 10px;font-size:11.5px" href="' + esc(e.link) +
      '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Join</a>'
      : '<span class="pill ' + e.tone + '">' + calKindLabel(e.kind) + '</span>') +
    '</div>';
}

function setCalMonth(delta) {
  const [y, m] = UI.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  UI.calMonth = iso(d).slice(0, 7);
  render();
}
function setCalToday() { UI.calMonth = iso(DB.today).slice(0, 7); UI.calDay = iso(DB.today); render(); }
function setCalDay(k) { UI.calDay = k; UI.calMonth = k.slice(0, 7); render(); }
function setCalLens(v) { UI.calLens = v; render(); }

/* ---------------- the form ----------------
   Every field is rendered once and stays in the DOM. Changing the Type
   dropdown only toggles visibility, so nothing is ever read back as empty
   and wiped. That bug cost the customer app a date and a freshly generated
   video link, and the cheapest fix is to never re-render at all. */
function formCalEntry(id) {
  const e = id ? (DB.calendar || []).find(x => x.id === +id) : null;
  const type = e ? e.type : 'meeting';
  const opts = (list, sel) => list.map(o =>
    '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + o[1] + '</option>').join('');

  modal(e ? 'Edit ' + calKindLabel(e.type).toLowerCase() : 'New calendar entry',
    e ? e.title : 'A meeting, a reminder, or something to publish',

    '<div class="fg"><label>Type</label><select id="calType" onchange="calTypeChanged()">' +
    opts([['meeting', 'Meeting'], ['reminder', 'Reminder'], ['content', 'Content']], type) +
    '</select></div>' +

    '<div class="fg"><label>Title</label><input id="calTitle" value="' + (e ? esc(e.title) : '') +
    '" placeholder="What is it"></div>' +

    '<div class="f2"><div class="fg"><label>Date</label>' +
    '<input type="date" id="calDate" value="' + (e ? e.date : UI.calDay) + '"></div>' +
    '<div class="fg"><label>Time</label>' +
    '<input type="time" id="calTime" value="' + (e && e.time ? e.time : '') + '"></div></div>' +

    '<div class="fg"><label>Repeats</label><select id="calRepeat">' +
    opts([['', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'],
          ['fortnightly', 'Fortnightly'], ['monthly', 'Monthly']], e ? (e.repeat || '') : '') +
    '</select></div>' +

    '<div id="calMeetOnly" style="display:' + (type === 'meeting' ? 'block' : 'none') + '">' +
    '<div class="fg"><label>Video link</label>' +
    '<div class="pw-row"><input id="calLink" value="' + (e && e.link ? esc(e.link) : '') +
    '" placeholder="Add one, or make a free room" style="padding-right:96px">' +
    '<span class="pw-show" onclick="calMakeLink()">Make one</span></div>' +
    '<div class="hint">A free Jitsi room. Anyone invited just opens the link, no account needed.</div></div>' +

    '<div class="fg"><label>Invite</label>' +
    '<div class="chips" id="calInvitees">' +
    DB.staff.map(s => '<button type="button" class="chip' +
      (e && (e.invitees || []).indexOf(s.id) >= 0 ? ' on' : '') + '" data-id="' + s.id +
      '" onclick="this.classList.toggle(\'on\')">' + esc(s.name.split(' ')[0]) + '</button>').join('') +
    '</div>' +
    '<div class="hint">Label Board staff only. Studios are never invited from here.</div></div>' +
    '</div>' +

    '<div class="fg"><label>Notes</label><textarea id="calNotes">' + (e ? esc(e.notes || '') : '') +
    '</textarea></div>',

    (e ? '<button class="btn" onclick="deleteCalEntry(' + e.id + ')">Delete</button>' : '') +
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doCalEntry(' + (id || 'null') + ')">' +
    (e ? 'Save' : 'Add to calendar') + '</button>');
}

function calTypeChanged() {
  /* Toggles visibility only. Nothing is re-rendered, so no field can be
     read back as empty and lost. */
  const t = document.getElementById('calType').value;
  document.getElementById('calMeetOnly').style.display = t === 'meeting' ? 'block' : 'none';
}

function calMakeLink() {
  const f = document.getElementById('calLink');
  const title = (document.getElementById('calTitle') || {}).value || 'meeting';
  /* Written straight into the input rather than through a re-render. */
  f.value = makeVideoLink(title);
}

function doCalEntry(id) {
  const title = document.getElementById('calTitle').value.trim();
  if (!title) { toast('Give it a title'); return; }
  const date = document.getElementById('calDate').value;
  if (!date) { toast('Pick a date'); return; }

  const type = document.getElementById('calType').value;
  const invitees = [...document.querySelectorAll('#calInvitees .chip.on')].map(b => +b.dataset.id);
  const rec = {
    title: title,
    date: date,
    time: document.getElementById('calTime').value || '',
    type: type,
    link: type === 'meeting' ? (document.getElementById('calLink').value.trim() || '') : '',
    repeat: document.getElementById('calRepeat').value || '',
    invitees: type === 'meeting' ? invitees : [],
    notes: document.getElementById('calNotes').value || ''
  };

  DB.calendar = DB.calendar || [];
  if (id) {
    const e = DB.calendar.find(x => x.id === +id);
    Object.assign(e, rec);
    logAction('calendar', 'Calendar entry updated', title);
    toast('Updated');
  } else {
    DB.calendar.push(Object.assign({
      id: (DB.calendar.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1,
      staffId: ME.staffId, by: (Q.staffM(ME.staffId) || {}).name || '',
      at: iso(DB.today), done: false
    }, rec));
    logAction('calendar', calKindLabel(type) + ' added', title + ' on ' + fmtD(date));
    toast(calKindLabel(type) + ' added');
  }
  UI.calDay = date;
  UI.calMonth = date.slice(0, 7);
  closeModal();
  render();
}

function deleteCalEntry(id) {
  const e = (DB.calendar || []).find(x => x.id === +id);
  if (!e) return;
  /* Only the person who made it, or someone who can manage staff, may
     remove it. Otherwise anyone could quietly delete the owner's meeting. */
  if (e.staffId !== ME.staffId && needs('manage_staff', 'Deleting someone else\'s entry')) return;
  DB.calendar = DB.calendar.filter(x => x.id !== +id);
  logAction('calendar', 'Calendar entry removed', e.title);
  closeModal();
  toast('Removed');
  render();
}
