/* ============================================================
   staffforms.js — the forms that were missing: adding a person,
   editing their record, setting their pay, their bank, their
   pension, and reading their documents. Permission-gated.
   ============================================================ */

/* Who is signed in, and what their role allows. Everything that writes goes
   through can(), so a read-only role genuinely cannot change a record. */
const ME = { staffId: 1 };
function myRole() { return Q.role((Q.staffM(ME.staffId) || {}).roleId) || { locked: true, caps: [], pages: [] }; }
function can(cap) { const r = myRole(); return !!(r.locked || r.caps.indexOf(cap) >= 0); }
function needs(cap, what) {
  if (can(cap)) return false;
  const label = (DB.caps.find(c => c[0] === cap) || [, cap])[1];
  modal('Not allowed', what || '',
    '<p class="note">Your role is <b>' + myRole().name + '</b>, which does not have the ' +
    '&ldquo;' + label + '&rdquo; permission, so this is read-only for you.</p>' +
    '<p class="hint">Whoever holds the Owner role can grant it in Settings &rarr; Team &amp; notifications &rarr; ' +
    'Roles &amp; permissions.</p>',
    '<button class="btn" onclick="closeModal()">Close</button>');
  return true;
}

/* ---------------- add a person ---------------- */
function formAddStaff() {
  if (needs('manage_staff', 'Adding someone to the team')) return;
  const deptOpts = ['Management', 'Finance', 'Support', 'Product', 'Operations'];
  modal('Add staff', 'Creates the account, sets what they can see, and puts them on the next payroll run',
    '<div class="sec-t">Who they are</div>' +
    '<div class="f2"><div class="fg"><label>Full name</label><input id="nsName" placeholder="e.g. Chinedu Okeke"></div>' +
    '<div class="fg"><label>Work email</label><input id="nsEmail" type="email" placeholder="name@thelabelboard.com"></div></div>' +
    '<div class="f2"><div class="fg"><label>Phone</label><input id="nsPhone" placeholder="+234 …"></div>' +
    '<div class="fg"><label>Date of birth</label><input id="nsDob" type="date"></div></div>' +
    '<div class="f2"><div class="fg"><label>Gender</label><select id="nsGender">' +
    '<option>Male</option><option>Female</option><option>Prefer not to say</option></select></div>' +
    '<div class="fg"><label>Home address</label><input id="nsAddr" placeholder="Area, city"></div></div>' +
    '<div class="fg"><label>Emergency contact</label><input id="nsEmg" placeholder="Name · phone · relationship"></div>' +

    '<div class="sec-t">The job</div>' +
    '<div class="f2"><div class="fg"><label>Job title</label><input id="nsTitle" placeholder="e.g. Support Agent"></div>' +
    '<div class="fg"><label>Department</label><select id="nsDept">' + deptOpts.map(d => '<option>' + d + '</option>').join('') + '</select></div></div>' +
    '<div class="f2"><div class="fg"><label>Employment type</label><select id="nsType">' +
    '<option>Full time</option><option>Contract</option><option>Part time</option></select></div>' +
    '<div class="fg"><label>Start date</label><input id="nsStart" type="date" value="' + iso(DB.today) + '"></div></div>' +
    '<div class="f2"><div class="fg"><label>Reports to</label><select id="nsBoss">' +
    '<option value="">Nobody</option>' + DB.staff.map(x => '<option value="' + x.id + '">' + esc(x.name) + ' · ' + x.title + '</option>').join('') +
    '</select></div><div class="fg"><label>Work location</label><select id="nsLoc">' +
    '<option>Lagos office</option><option>Abuja office</option><option>Remote</option></select></div></div>' +

    '<div class="sec-t">Access</div>' +
    '<div class="fg"><label>Role — what they can see and do</label><select id="nsRole">' +
    DB.roles.filter(r => !r.locked).map(r => '<option value="' + r.id + '">' + r.name + ' — ' +
      r.pages.length + ' pages, ' + r.caps.length + ' permissions</option>').join('') + '</select>' +
    '<div class="hint">Edit what each role can reach in Settings &rarr; Team &amp; notifications.</div></div>' +

    '<div class="sec-t">Pay</div>' +
    '<div class="f2"><div class="fg"><label>Monthly basic (₦)</label><input id="nsPay" type="number" placeholder="250000"></div>' +
    '<div class="fg"><label>Salary type</label><select id="nsPayType">' +
    '<option>Monthly salary</option><option>Commission</option><option>Monthly salary + commission</option></select></div></div>' +
    '<div class="f2"><div class="fg"><label>Bank</label><select id="nsBank">' +
    ['GTBank', 'Access Bank', 'Zenith Bank', 'UBA', 'First Bank', 'Kuda', 'Opay', 'Moniepoint'].map(b => '<option>' + b + '</option>').join('') +
    '</select></div><div class="fg"><label>Account number</label><input id="nsAcct" placeholder="10 digits"></div></div>' +
    '<div class="row" style="margin-top:6px"><div><b>Enrol in pension</b>' +
    '<small>' + DB.settings.pensionDefaultRate + '% of basic. Voluntary — only tick this if they have agreed.</small></div>' +
    '<div class="tog" id="nsPension" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    '<div class="row"><div><b>Enrol in NHF</b><small>2.5% of basic. Also voluntary.</small></div>' +
    '<div class="tog" id="nsNhf" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    (DB.settings.allowances.enabled ? '' :
      '<p class="hint">Allowances are switched off platform-wide, so gross will equal basic. ' +
      'Turn them on in Settings &rarr; Platform when that changes.</p>'),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doAddStaff()">Add to the team</button>', true);
}

function doAddStaff() {
  const v = id => (document.getElementById(id) || {}).value || '';
  const name = v('nsName').trim();
  if (!name) { toast('Give them a name'); return; }
  const basic = +v('nsPay') || 0;
  if (!basic) { toast('Set a monthly basic — they go onto the payroll run'); return; }

  const al = DB.settings.allowances;
  const id = Math.max.apply(null, DB.staff.map(s => s.id)) + 1;
  const first = name.split(' ')[0].toLowerCase();
  const pensionOn = document.getElementById('nsPension').classList.contains('on');
  const nhfOn = document.getElementById('nsNhf').classList.contains('on');

  const st = {
    id, staffId: 'TLB-' + String(id).padStart(3, '0'), name,
    dept: v('nsDept'), title: v('nsTitle') || 'Team member',
    roleId: v('nsRole'), username: '@' + first,
    email: v('nsEmail') || first + '@thelabelboard.com',
    phone: v('nsPhone') || '—',
    gender: v('nsGender'), dob: v('nsDob') || '—',
    address: v('nsAddr') || '—', nationality: 'Nigerian',
    emergency: v('nsEmg') || '—',
    empType: v('nsType'), startDate: v('nsStart') || iso(DB.today), status: 'active',
    reportsTo: v('nsBoss') ? +v('nsBoss') : null,
    workLocation: v('nsLoc'),
    bankName: v('nsBank'), bankAccount: v('nsAcct') || '—', bankAccountName: name,
    salaryType: v('nsPayType'), basic,
    housing: al.enabled ? Math.round(basic * al.housingPct / 100) : 0,
    transport: al.enabled ? Math.round(basic * al.transportPct / 100) : 0,
    pension: { optedIn: pensionOn, rate: DB.settings.pensionDefaultRate, agreedOn: pensionOn ? iso(DB.today) : null },
    nhfOptIn: nhfOn,
    lastActive: iso(DB.today), lastActiveLabel: 'Invited', leaveEntitlement: 20, rating: 0,
    /* A new account has no password yet — the invite link is how they set one.
       Without this block their profile and Login & passwords have nothing to read. */
    auth: {
      passwordSetOn: iso(DB.today),
      mustReset: true,            // they must choose a password on first sign-in
      neverSignedIn: true,
      twoFactor: DB.settings.security.twoFactorRequired,
      failedAttempts: 0,
      locked: false,
      lockedAt: null,
      resetSentOn: iso(DB.today), // the invite doubles as the first reset link
      sessions: []
    }
  };
  DB.staff.push(st);
  addStaffToOpenRun(st);
  seedDocsFor(st);
  logAction('staff_invite', 'Staff added',
    'Kayode Ojomo added ' + name + ' as ' + st.title + ' (' + st.dept + ') on ' + money(basic) + ' a month');
  closeModal();
  toast(name + ' added · invite sent to ' + st.email);
  render();
}

/* keep the open payroll run consistent whenever the team changes */
function addStaffToOpenRun(st) {
  const run = DB.payrollRuns[0];
  const g = st.basic + st.housing + st.transport;
  const paye = Math.round(g * 0.115 / 100) * 100;
  const pen = st.pension.optedIn ? Math.round(st.basic * st.pension.rate / 100 / 100) * 100 : 0;
  const nhf = st.nhfOptIn ? Math.round(st.basic * 0.025 / 100) * 100 : 0;
  const ded = paye + pen + nhf;
  DB.payslips.push({
    id: Math.max.apply(null, DB.payslips.map(x => x.id)) + 1,
    staffId: st.id, staffName: st.name, dept: st.dept,
    monthKey: run.monthKey, month: run.month, payDate: run.payDate,
    basic: st.basic, housing: st.housing, transport: st.transport, bonus: 0, overtime: 0, gross: g,
    paye, pension: pen, nhf, loan: 0, deductions: ded, net: g - ded,
    pensionOptedIn: st.pension.optedIn, nhfOptedIn: st.nhfOptIn,
    status: 'pending', bank: st.bankName + ' · ' + st.bankAccount, uploaded: false, publishedOn: null
  });
  run.headcount = DB.staff.length;
  run.gross += g; run.deductions += ded; run.net += (g - ded); run.pending += 1;
}
/* recompute the open run's slip for one person after a pay change */
function refreshOpenSlip(st) {
  const run = DB.payrollRuns[0];
  const slip = DB.payslips.find(x => x.staffId === st.id && x.monthKey === run.monthKey);
  if (!slip) { addStaffToOpenRun(st); return; }
  run.gross -= slip.gross; run.deductions -= slip.deductions; run.net -= slip.net;
  const g = st.basic + st.housing + st.transport + slip.bonus + slip.overtime;
  slip.basic = st.basic; slip.housing = st.housing; slip.transport = st.transport; slip.gross = g;
  slip.paye = Math.round(g * 0.115 / 100) * 100;
  slip.pension = st.pension.optedIn ? Math.round(st.basic * st.pension.rate / 100 / 100) * 100 : 0;
  slip.nhf = st.nhfOptIn ? Math.round(st.basic * 0.025 / 100) * 100 : 0;
  slip.pensionOptedIn = st.pension.optedIn; slip.nhfOptedIn = st.nhfOptIn;
  slip.deductions = slip.paye + slip.pension + slip.nhf + slip.loan;
  slip.net = g - slip.deductions;
  slip.bank = st.bankName + ' · ' + st.bankAccount;
  run.gross += slip.gross; run.deductions += slip.deductions; run.net += slip.net;
}
function seedDocsFor(st) {
  const id0 = Math.max.apply(null, DB.docs.map(d => d.id)) + 1;
  DB.docs.push(
    { id: id0, staffId: st.id, kind: 'Employment contract', status: 'missing', pages: 0, addedOn: iso(DB.today),
      body: [['Status', 'Not uploaded'], ['Needed before', 'First payroll run']],
      note: 'No signed contract on file yet.' },
    { id: id0 + 1, staffId: st.id, kind: 'ID verification', status: 'missing', pages: 0, addedOn: iso(DB.today),
      body: [['Status', 'Not uploaded']], note: 'Identity has not been verified yet.' },
    { id: id0 + 2, staffId: st.id, kind: 'Bank mandate', status: st.bankAccount !== '—' ? 'on file' : 'missing',
      pages: 1, addedOn: iso(DB.today),
      body: [['Account name', st.bankAccountName], ['Bank', st.bankName], ['Account number', st.bankAccount],
        ['Recorded on', fmtD(DB.today)]],
      note: 'Captured when the account was created.' }
  );
}

/* ---------------- edit a person ---------------- */
function formEditStaff(id) {
  if (needs('manage_staff', 'Editing a staff record')) return;
  const s = Q.staffM(id);
  modal('Edit ' + s.name, s.staffId + ' · ' + s.title,
    '<div class="sec-t">Personal</div>' +
    '<div class="f2"><div class="fg"><label>Full name</label><input id="esN" value="' + esc(s.name) + '"></div>' +
    '<div class="fg"><label>Work email</label><input id="esE" value="' + esc(s.email) + '"></div></div>' +
    '<div class="f2"><div class="fg"><label>Phone</label><input id="esP" value="' + esc(s.phone) + '"></div>' +
    '<div class="fg"><label>Date of birth</label><input id="esD" type="date" value="' + (/^\d{4}-\d{2}-\d{2}$/.test(s.dob) ? s.dob : '') + '"></div></div>' +
    '<div class="f2"><div class="fg"><label>Gender</label><select id="esG">' +
    ['Male', 'Female', 'Prefer not to say'].map(g => '<option' + (s.gender === g ? ' selected' : '') + '>' + g + '</option>').join('') +
    '</select></div><div class="fg"><label>Nationality</label><input id="esNat" value="' + esc(s.nationality) + '"></div></div>' +
    '<div class="fg"><label>Home address</label><input id="esA" value="' + esc(s.address) + '"></div>' +
    '<div class="fg"><label>Emergency contact</label><input id="esEm" value="' + esc(s.emergency) + '"></div>' +

    '<div class="sec-t">The job</div>' +
    '<div class="f2"><div class="fg"><label>Job title</label><input id="esT" value="' + esc(s.title) + '"></div>' +
    '<div class="fg"><label>Department</label><select id="esDept">' +
    ['Management', 'Finance', 'Support', 'Product', 'Operations'].map(d => '<option' + (s.dept === d ? ' selected' : '') + '>' + d + '</option>').join('') +
    '</select></div></div>' +
    '<div class="f2"><div class="fg"><label>Employment type</label><select id="esTy">' +
    ['Full time', 'Contract', 'Part time'].map(t => '<option' + (s.empType === t ? ' selected' : '') + '>' + t + '</option>').join('') +
    '</select></div><div class="fg"><label>Start date</label><input id="esS" type="date" value="' + s.startDate + '"></div></div>' +
    '<div class="f2"><div class="fg"><label>Reports to</label><select id="esB">' +
    '<option value="">Nobody</option>' +
    DB.staff.filter(x => x.id !== s.id).map(x => '<option value="' + x.id + '"' + (s.reportsTo === x.id ? ' selected' : '') + '>' +
      esc(x.name) + ' · ' + x.title + '</option>').join('') + '</select></div>' +
    '<div class="fg"><label>Work location</label><select id="esL">' +
    ['Lagos office', 'Abuja office', 'Remote'].map(l => '<option' + (s.workLocation === l ? ' selected' : '') + '>' + l + '</option>').join('') +
    '</select></div></div>' +
    '<div class="fg"><label>Status</label><select id="esSt">' +
    ['active', 'suspended', 'left'].map(x => '<option value="' + x + '"' + (s.status === x ? ' selected' : '') + '>' + x + '</option>').join('') +
    '</select></div>' +
    '<p class="hint">Pay, bank and pension are edited on the Pay setup tab so a change to them is logged separately.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doEditStaff(' + id + ')">Save changes</button>', true);
}
function doEditStaff(id) {
  const s = Q.staffM(id);
  const v = x => (document.getElementById(x) || {}).value;
  const before = s.name + ' · ' + s.title;
  s.name = v('esN') || s.name; s.email = v('esE') || s.email; s.phone = v('esP') || s.phone;
  s.dob = v('esD') || s.dob; s.gender = v('esG'); s.nationality = v('esNat') || s.nationality;
  s.address = v('esA') || s.address; s.emergency = v('esEm') || s.emergency;
  s.title = v('esT') || s.title; s.dept = v('esDept'); s.empType = v('esTy');
  s.startDate = v('esS') || s.startDate;
  s.reportsTo = v('esB') ? +v('esB') : null;
  s.workLocation = v('esL'); s.status = v('esSt');
  s.bankAccountName = s.name;
  /* keep denormalised copies in step */
  DB.payslips.filter(x => x.staffId === s.id).forEach(x => { x.staffName = s.name; x.dept = s.dept; });
  logAction('sub_edit', 'Staff record edited', 'Kayode Ojomo edited ' + before + ' → ' + s.name + ' · ' + s.title);
  closeModal(); toast('Saved'); render();
}

/* ---------------- salary ---------------- */
function formSalary(id) {
  if (needs('run_payroll', 'Setting somebody\'s salary')) return;
  const s = Q.staffM(id);
  const al = DB.settings.allowances;
  modal('Set salary', s.name + ' · currently ' + money(s.basic) + ' a month',
    '<div class="fg"><label>Monthly basic (₦)</label><input id="salB" type="number" value="' + s.basic + '"></div>' +
    '<div class="fg"><label>Salary type</label><select id="salT">' +
    ['Monthly salary', 'Commission', 'Monthly salary + commission'].map(t => '<option' + (s.salaryType === t ? ' selected' : '') + '>' + t + '</option>').join('') +
    '</select></div>' +
    '<div class="fg"><label>Reason for the change</label><input id="salWhy" placeholder="e.g. Annual review, promotion"></div>' +
    (al.enabled
      ? '<p class="hint">Housing (' + al.housingPct + '%) and transport (' + al.transportPct +
        '%) recalculate from the new basic automatically.</p>'
      : '<p class="hint">Allowances are off platform-wide, so gross will equal this basic. ' +
        'PAYE is 11.5% of gross' + (s.pension.optedIn ? ', pension ' + s.pension.rate + '% of basic' : '') +
        (s.nhfOptIn ? ', NHF 2.5% of basic' : '') + '.</p>') +
    '<div class="pnl" style="background:var(--panel-2);margin-top:14px"><div class="ph"><h3 style="font-size:13px">' +
    'What this changes</h3></div>' +
    '<div class="kv"><span class="k">This month\'s run</span><span class="v">Recalculated straight away</span></div>' +
    '<div class="kv"><span class="k">Payslips already published</span><span class="v">Left untouched</span></div>' +
    '<div class="kv"><span class="k">Logged to the audit trail</span><span class="v">Yes, with the reason</span></div></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doSalary(' + id + ')">Save salary</button>');
}
function doSalary(id) {
  const s = Q.staffM(id);
  const n = +document.getElementById('salB').value;
  if (!n || n < 0) { toast('Enter a monthly basic'); return; }
  const al = DB.settings.allowances;
  const old = s.basic;
  s.basic = n;
  s.housing = al.enabled ? Math.round(n * al.housingPct / 100) : 0;
  s.transport = al.enabled ? Math.round(n * al.transportPct / 100) : 0;
  s.salaryType = document.getElementById('salT').value;
  refreshOpenSlip(s);
  const why = document.getElementById('salWhy').value;
  logAction('payroll', 'Salary changed',
    'Kayode Ojomo changed ' + s.name + '\'s monthly basic from ' + money(old) + ' to ' + money(n) +
    (why ? ' — ' + why : ''));
  closeModal();
  toast(s.name.split(' ')[0] + ' now on ' + money(n) + ' a month');
  render();
}

/* ---------------- bank ---------------- */
function formBank(id) {
  if (needs('run_payroll', 'Changing where somebody is paid')) return;
  const s = Q.staffM(id);
  modal('Bank details', s.name,
    '<div class="fg"><label>Bank</label><select id="bkN">' +
    ['GTBank', 'Access Bank', 'Zenith Bank', 'UBA', 'First Bank', 'Kuda', 'Opay', 'Moniepoint', 'Stanbic IBTC']
      .map(b => '<option' + (s.bankName === b ? ' selected' : '') + '>' + b + '</option>').join('') + '</select></div>' +
    '<div class="fg"><label>Account number</label><input id="bkA" value="' + esc(s.bankAccount) + '"></div>' +
    '<div class="fg"><label>Account name</label><input id="bkNm" value="' + esc(s.bankAccountName) + '"></div>' +
    '<p class="hint">A change of account should be backed by a fresh signed mandate. ' +
    'It is logged, and the mandate belongs under Documents.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doBank(' + id + ')">Save</button>');
}
function doBank(id) {
  const s = Q.staffM(id);
  const before = s.bankName + ' · ' + s.bankAccount;
  s.bankName = document.getElementById('bkN').value;
  s.bankAccount = document.getElementById('bkA').value || s.bankAccount;
  s.bankAccountName = document.getElementById('bkNm').value || s.bankAccountName;
  refreshOpenSlip(s);
  logAction('payroll', 'Bank details changed',
    'Kayode Ojomo changed ' + s.name + '\'s payment account from ' + before + ' to ' + s.bankName + ' · ' + s.bankAccount);
  closeModal(); toast('Bank details saved'); render();
}

/* ---------------- pension / NHF ---------------- */
function formPension(id) {
  if (needs('run_payroll', 'Changing a pension enrolment')) return;
  const s = Q.staffM(id);
  modal('Pension & NHF', s.name,
    '<p class="note">Both are voluntary. Nothing is deducted from anyone\'s pay until they have agreed to it, ' +
    'so only switch these on once you have the signed form.</p>' +
    '<div class="row" style="margin-top:14px"><div><b>Contributory pension</b>' +
    '<small>Deducts a percentage of basic every month</small></div>' +
    '<div class="tog' + (s.pension.optedIn ? ' on' : '') + '" id="pnOn" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    '<div class="fg" style="margin-top:12px"><label>Employee rate (% of basic)</label>' +
    '<input id="pnRate" type="number" value="' + s.pension.rate + '"></div>' +
    '<div class="row"><div><b>National Housing Fund</b><small>2.5% of basic</small></div>' +
    '<div class="tog' + (s.nhfOptIn ? ' on' : '') + '" id="nhOn" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    '<div class="pnl" style="background:var(--panel-2);margin-top:14px"><div class="ph"><h3 style="font-size:13px">' +
    'Effect on take-home</h3></div>' +
    '<div class="kv"><span class="k">Monthly basic</span><span class="v">' + money(s.basic) + '</span></div>' +
    '<div class="kv"><span class="k">Pension if enrolled</span><span class="v">−' +
    money(Math.round(s.basic * s.pension.rate / 100)) + '</span></div>' +
    '<div class="kv"><span class="k">NHF if enrolled</span><span class="v">−' + money(Math.round(s.basic * 0.025)) + '</span></div></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doPension(' + id + ')">Save</button>');
}
function doPension(id) {
  const s = Q.staffM(id);
  const wasP = s.pension.optedIn, wasN = s.nhfOptIn;
  const nowP = document.getElementById('pnOn').classList.contains('on');
  const nowN = document.getElementById('nhOn').classList.contains('on');
  s.pension.rate = +document.getElementById('pnRate').value || s.pension.rate;
  s.pension.optedIn = nowP;
  if (nowP && !wasP) s.pension.agreedOn = iso(DB.today);
  if (!nowP) s.pension.agreedOn = null;
  s.nhfOptIn = nowN;
  refreshOpenSlip(s);
  /* keep the enrolment document honest */
  const doc = DB.docs.find(d => d.staffId === s.id && d.kind === 'Pension enrolment');
  if (doc) {
    doc.status = nowP ? 'on file' : 'not enrolled';
    doc.body = nowP
      ? [['Scheme', 'Contributory pension'], ['Employee rate', s.pension.rate + '% of basic'],
         ['Monthly contribution', money(Math.round(s.basic * s.pension.rate / 100))],
         ['Agreed on', fmtD(s.pension.agreedOn)], ['Status', 'Active']]
      : [['Status', 'Not enrolled'], ['Reason', 'Employee has not opted in']];
    doc.note = nowP ? 'Enrolment recorded in this session.' : 'No enrolment on file — nothing is deducted.';
  }
  const parts = [];
  if (nowP !== wasP) parts.push('pension ' + (nowP ? 'enrolled at ' + s.pension.rate + '%' : 'withdrawn'));
  if (nowN !== wasN) parts.push('NHF ' + (nowN ? 'enrolled' : 'withdrawn'));
  if (parts.length) logAction('payroll', 'Deductions changed', 'Kayode Ojomo: ' + s.name + ' — ' + parts.join(', '));
  closeModal(); toast(parts.length ? 'Saved · ' + parts.join(', ') : 'No change'); render();
}

/* ---------------- document viewer ---------------- */
function viewDoc(docId) {
  const d = DB.docs.find(x => x.id === +docId);
  if (!d) return;
  const s = Q.staffM(d.staffId);
  if (d.status !== 'on file') {
    modal(d.kind, esc(s.name) + ' · nothing on file',
      '<p class="note">' + d.note + '</p>' +
      (d.body && d.body.length ? '<div style="margin-top:12px">' +
        d.body.map(r => '<div class="kv"><span class="k">' + r[0] + '</span><span class="v">' + esc(r[1]) + '</span></div>').join('') +
        '</div>' : ''),
      '<button class="btn" onclick="closeModal()">Close</button>' +
      '<button class="btn gold" onclick="closeModal();toast(\'Upload lands with the storage bucket\')">Upload it</button>');
    return;
  }
  modal(d.kind, esc(s.name) + ' · ' + s.staffId + ' · ' + d.pages + ' page' + (d.pages === 1 ? '' : 's') + ' · added ' + fmtD(d.addedOn),
    '<div class="pnl" style="background:var(--panel-2);margin:0">' +
    d.body.map(r => '<div class="kv"><span class="k">' + r[0] + '</span><span class="v">' + esc(r[1]) + '</span></div>').join('') +
    '</div>' +
    '<div class="sec-t">Note</div><p class="note">' + d.note + '</p>',
    '<button class="btn" onclick="closeModal()">Close</button>' +
    '<button class="btn" onclick="downloadDoc(' + d.id + ')">Download</button>', true);
  logAction('account_view', 'Document opened', 'Kayode Ojomo opened ' + s.name + '\'s ' + d.kind.toLowerCase());
}
function downloadDoc(docId) {
  const d = DB.docs.find(x => x.id === +docId);
  const s = Q.staffM(d.staffId);
  const rows = [['THE LABEL BOARD — ' + d.kind.toUpperCase()], [''], ['Staff', s.name], ['Staff ID', s.staffId], ['']]
    .concat(d.body.map(r => [r[0], r[1]]))
    .concat([[''], ['Note', d.note]]);
  download(d.kind.toLowerCase().replace(/[^a-z]+/g, '-') + '-' + s.staffId + '.csv', toCsv(rows), 'text/csv;charset=utf-8');
  toast('Downloaded');
}
function downloadStaffDocs(staffId) {
  const s = Q.staffM(staffId);
  exportCsv('documents-' + s.staffId, ['Document', 'Status', 'Pages', 'Added', 'Note'],
    DB.docs.filter(d => d.staffId === staffId).map(d => [d.kind, d.status, d.pages, d.addedOn, d.note]));
}

/* ---------------- settlement account ---------------- */
function formSettlement() {
  const t = DB.settings.settlement;
  modal('Settlement account', 'Where subscription money lands',
    '<div class="sec-t">Account</div>' +
    '<div class="f2"><div class="fg"><label>Account name</label><input id="stName" value="' + esc(t.accountName) + '"></div>' +
    '<div class="fg"><label>Account number</label><input id="stNum" value="' + esc(t.accountNumber) + '"></div></div>' +
    '<div class="f2"><div class="fg"><label>Bank</label><input id="stBank" value="' + esc(t.bankName) + '"></div>' +
    '<div class="fg"><label>Account type</label><select id="stType">' +
    ['Current', 'Savings', 'Domiciliary'].map(x => '<option' + (t.accountType === x ? ' selected' : '') + '>' + x + '</option>').join('') +
    '</select></div></div>' +
    '<div class="f2"><div class="fg"><label>Branch</label><input id="stBranch" value="' + esc(t.branch) + '"></div>' +
    '<div class="fg"><label>Currency</label><input id="stCur" value="' + esc(t.currency) + '"></div></div>' +
    '<div class="sec-t">Codes</div>' +
    '<div class="f2"><div class="fg"><label>Sort code</label><input id="stSort" value="' + esc(t.sortCode) + '"></div>' +
    '<div class="fg"><label>SWIFT / BIC</label><input id="stSwift" value="' + esc(t.swift) + '"></div></div>' +
    '<div class="f2"><div class="fg"><label>Tax ID (TIN)</label><input id="stTin" value="' + esc(t.tin) + '"></div>' +
    '<div class="fg"><label>Payout schedule</label><input id="stSched" value="' + esc(t.payoutSchedule) + '"></div></div>' +
    '<p class="hint">Changing the settlement account changes where every subscription payment is paid out. ' +
    'It is logged, and the provider re-verifies the account before the next payout.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doSettlement()">Save account</button>', true);
}
function doSettlement() {
  const t = DB.settings.settlement;
  const v = x => (document.getElementById(x) || {}).value;
  const before = t.bankName + ' ' + t.accountNumber;
  t.accountName = v('stName') || t.accountName;
  t.accountNumber = v('stNum') || t.accountNumber;
  t.bankName = v('stBank') || t.bankName;
  t.accountType = v('stType'); t.branch = v('stBranch') || t.branch;
  t.currency = v('stCur') || t.currency; t.sortCode = v('stSort') || t.sortCode;
  t.swift = v('stSwift') || t.swift; t.tin = v('stTin') || t.tin;
  t.payoutSchedule = v('stSched') || t.payoutSchedule;
  if (before !== t.bankName + ' ' + t.accountNumber) { t.verified = false; t.verifiedOn = null; }
  saveSettings();
  logAction('sub_edit', 'Settlement account changed',
    'Kayode Ojomo changed the settlement account from ' + before + ' to ' + t.bankName + ' ' + t.accountNumber);
  closeModal();
  toast(t.verified ? 'Settlement account saved' : 'Saved · awaiting re-verification');
  render();
}

/* ---------------- allowances switch ---------------- */
function formAllowances() {
  const a = DB.settings.allowances;
  modal('Allowances', a.enabled ? 'Currently in use' : 'Currently switched off',
    '<p class="note">While allowances are off, gross pay equals basic plus anything variable. ' +
    'Switching them on adds housing and transport to every staff record and to the open payroll run, ' +
    'calculated from each person\'s basic.</p>' +
    '<div class="row" style="margin-top:14px"><div><b>Pay allowances</b>' +
    '<small>Applies across the whole team</small></div>' +
    '<div class="tog' + (a.enabled ? ' on' : '') + '" id="alOn" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    '<div class="f2" style="margin-top:12px"><div class="fg"><label>Housing (% of basic)</label>' +
    '<input id="alH" type="number" value="' + a.housingPct + '"></div>' +
    '<div class="fg"><label>Transport (% of basic)</label><input id="alT" type="number" value="' + a.transportPct + '"></div></div>' +
    '<div class="pnl" style="background:var(--panel-2);margin-top:8px"><div class="ph"><h3 style="font-size:13px">' +
    'If switched on now</h3></div>' +
    '<div class="kv"><span class="k">Current monthly gross</span><span class="v">' +
    money(DB.staff.reduce((t, s) => t + s.basic + s.housing + s.transport, 0)) + '</span></div>' +
    '<div class="kv"><span class="k">Would become</span><span class="v">' +
    money(DB.staff.reduce((t, s) => t + s.basic * (1 + (a.housingPct + a.transportPct) / 100), 0)) + '</span></div></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doAllowances()">Save</button>');
}
function doAllowances() {
  const a = DB.settings.allowances;
  const was = a.enabled;
  a.enabled = document.getElementById('alOn').classList.contains('on');
  a.housingPct = +document.getElementById('alH').value || a.housingPct;
  a.transportPct = +document.getElementById('alT').value || a.transportPct;
  DB.staff.forEach(s => {
    s.housing = a.enabled ? Math.round(s.basic * a.housingPct / 100) : 0;
    s.transport = a.enabled ? Math.round(s.basic * a.transportPct / 100) : 0;
    refreshOpenSlip(s);
  });
  saveSettings();
  if (was !== a.enabled) {
    logAction('payroll', 'Allowance policy changed',
      'Kayode Ojomo turned allowances ' + (a.enabled ? 'on' : 'off') + ' across the platform');
  }
  closeModal();
  toast('Allowances ' + (a.enabled ? 'switched on' : 'switched off'));
  render();
}
