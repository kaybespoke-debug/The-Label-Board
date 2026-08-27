/* ============================================================
   login.js — Login & passwords.

   Two rules this is built around:
   1. A password is never stored, shown, logged or exported. The form checks
      it, records the date it changed, and discards it.
   2. Nobody sets somebody else's password. An admin sends a reset link and
      the person chooses their own, so no one ever knows another's password.
   ============================================================ */

/* Guarantees the sign-in block exists. Any path that creates a staff record
   without one degrades to "never signed in" rather than throwing. */
function authOf(s) {
  if (!s) return null;
  if (!s.auth) {
    s.auth = {
      passwordSetOn: iso(DB.today), mustReset: true, neverSignedIn: true,
      twoFactor: false, failedAttempts: 0, locked: false, lockedAt: null,
      resetSentOn: null, sessions: []
    };
  }
  if (!Array.isArray(s.auth.sessions)) s.auth.sessions = [];
  return s.auth;
}

/* ---------------- password strength ---------------- */
const COMMON_PASSWORDS = [
  'password', 'password1', 'passw0rd', '12345678', '123456789', 'qwerty', 'qwerty123',
  'letmein', 'welcome', 'welcome1', 'admin', 'admin123', 'iloveyou', 'monkey',
  'abc12345', 'football', 'dragon', 'sunshine', 'princess', 'labelboard',
  'thelabelboard', 'lagos', 'nigeria', 'changeme', 'secret'
];

/* Returns every rule with whether it passes, plus a 0–4 score. */
function checkPassword(pw, staff) {
  const s = DB.settings.security;
  const lower = (pw || '').toLowerCase();
  const rules = [
    { id: 'len', label: 'At least ' + s.minLength + ' characters', ok: pw.length >= s.minLength },
    { id: 'case', label: 'An upper and a lower case letter', ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw), skip: !s.requireMix },
    { id: 'num', label: 'At least one number', ok: /[0-9]/.test(pw), skip: !s.requireMix },
    { id: 'sym', label: 'At least one symbol', ok: /[^A-Za-z0-9]/.test(pw), skip: !s.requireSymbol },
    { id: 'common', label: 'Not a commonly used password', ok: pw.length > 0 && !COMMON_PASSWORDS.some(c => lower === c || lower.startsWith(c)) },
    { id: 'self', label: 'Does not contain your name or username',
      ok: pw.length > 0 && !(staff && (lower.includes(staff.name.split(' ')[0].toLowerCase()) ||
        lower.includes(staff.username.replace('@', '').toLowerCase()))) }
  ].filter(r => !r.skip);

  const passed = rules.filter(r => r.ok).length;
  const allOk = rules.every(r => r.ok);
  /* Length is what actually buys strength, so it gates the score: a three
     character password must never read "Fair" just because it has a capital. */
  let score = 0;
  if (pw.length) {
    score = Math.min(4, Math.floor(passed / rules.length * 3) + (pw.length >= s.minLength + 6 ? 1 : 0));
    if (!allOk) score = Math.min(score, 2);
    if (pw.length < s.minLength) score = 1;                    // too short is simply weak
    if (pw.length < Math.max(6, s.minLength - 4)) score = 1;
  }
  return { rules, allOk, score,
    label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] || '',
    color: ['var(--faint)', 'var(--red)', 'var(--amber)', 'var(--blue)', 'var(--green)'][score] };
}

function strengthMeter(pw, staff) {
  const r = checkPassword(pw, staff);
  return '<div style="margin-top:10px">' +
    '<div style="display:flex;gap:4px;margin-bottom:7px">' +
    [1, 2, 3, 4].map(i => '<div style="flex:1;height:4px;border-radius:2px;background:' +
      (i <= r.score ? r.color : 'var(--panel-2)') + '"></div>').join('') + '</div>' +
    '<div style="font-size:11.5px;color:' + (pw ? r.color : 'var(--faint)') + ';font-weight:600;margin-bottom:8px">' +
    (pw ? r.label : 'Type a password to see how strong it is') + '</div>' +
    r.rules.map(x => '<div style="font-size:11.5px;color:' + (x.ok ? 'var(--green)' : 'var(--faint)') +
      ';padding:2px 0">' + (x.ok ? '✓' : '·') + ' ' + x.label + '</div>').join('') +
    '</div>';
}

/* live update as the field is typed — the value is read, scored and dropped */
function onPwType() {
  const pw = (document.getElementById('pwNew') || {}).value || '';
  const box = document.getElementById('pwMeter');
  if (box) box.innerHTML = strengthMeter(pw, Q.staffM(ME.staffId));
  const conf = (document.getElementById('pwConfirm') || {}).value || '';
  const note = document.getElementById('pwMatch');
  if (note) {
    note.innerHTML = !conf ? '' : (conf === pw
      ? '<span style="color:var(--green)">✓ Both entries match</span>'
      : '<span style="color:var(--red)">The two entries do not match</span>');
  }
}

/* ---------------- change your own password ---------------- */
function formChangePassword() {
  const me = Q.staffM(ME.staffId);
  const a0 = authOf(me);
  const age = Math.round((DB.today - parseD(a0.passwordSetOn)) / DAY);
  modal('Change your password', me.name + ' · ' + me.username,
    '<p class="note">You need your current password to change it. Everyone else stays signed out of your account: ' +
    'changing it ends every other session, so anyone using your login elsewhere is dropped.</p>' +

    '<div class="fg" style="margin-top:16px"><label>Current password</label>' +
    '<input id="pwCurrent" type="password" autocomplete="current-password" placeholder="Your password today"></div>' +

    '<div class="fg"><label>New password</label>' +
    '<input id="pwNew" type="password" autocomplete="new-password" oninput="onPwType()" placeholder="At least ' +
    DB.settings.security.minLength + ' characters">' +
    '<div id="pwMeter">' + strengthMeter('', me) + '</div></div>' +

    '<div class="fg"><label>New password again</label>' +
    '<input id="pwConfirm" type="password" autocomplete="new-password" oninput="onPwType()">' +
    '<div class="hint" id="pwMatch"></div></div>' +

    '<div class="row" style="margin-top:6px"><div><b>Sign out my other devices</b>' +
    '<small>Recommended. Ends the ' + Math.max(0, authOf(me).sessions.length - 1) + ' other session' +
    (authOf(me).sessions.length - 1 === 1 ? '' : 's') + ' on this account.</small></div>' +
    '<div class="tog on" id="pwRevoke" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +

    '<p class="hint">Your password was last changed ' + (age === 0 ? 'today' : age + ' days ago') +
    '. It is stored only as a one-way hash — nobody at The Label Board can read it, including you, ' +
    'which is why a forgotten password is reset rather than looked up.</p>',

    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doChangePassword()">Change password</button>');
}

async function doChangePassword() {
  const me = Q.staffM(ME.staffId);
  const cur = (document.getElementById('pwCurrent') || {}).value || '';
  const pw = (document.getElementById('pwNew') || {}).value || '';
  const conf = (document.getElementById('pwConfirm') || {}).value || '';

  if (!cur) { toast('Enter your current password'); return; }
  if (!pw) { toast('Enter a new password'); return; }
  if (pw !== conf) { toast('The two new entries do not match'); return; }
  if (pw === cur) { toast('The new password is the same as the current one'); return; }

  const r = checkPassword(pw, me);
  if (!r.allOk) {
    const missing = r.rules.filter(x => !x.ok)[0];
    toast('Not accepted yet — ' + missing.label.toLowerCase());
    return;
  }

  /* The current password is genuinely verified, and the new one genuinely
     stored, by credentials.js. Without this the form was theatre. */
  const target = credEmailFor(me);
  if (!credFor(target)) { toast('No password is set on this account yet'); return; }
  if (!await verifyPassword(target, cur)) {
    toast('That is not your current password');
    return;
  }
  await setPassword(target, pw);
  clearFailures(target);

  const revoke = document.getElementById('pwRevoke').classList.contains('on');
  const dropped = revoke ? authOf(me).sessions.filter(s => !s.current).length : 0;
  if (revoke) authOf(me).sessions = authOf(me).sessions.filter(s => s.current);
  authOf(me).passwordSetOn = iso(DB.today);
  authOf(me).mustReset = false;
  authOf(me).failedAttempts = 0;
  authOf(me).locked = false;

  logAction('login', 'Password changed',
    me.name + ' changed their own password' + (dropped ? ' and signed out ' + dropped + ' other session' + (dropped === 1 ? '' : 's') : ''));

  closeModal();
  toast('Password changed' + (dropped ? ' · ' + dropped + ' other session' + (dropped === 1 ? '' : 's') + ' signed out' : ''));
  render();
}

/* ---------------- two-step verification ---------------- */
function formTwoFactor() {
  const me = Q.staffM(ME.staffId);
  const on = authOf(me).twoFactor;
  modal('Two-step verification', on ? 'Currently on' : 'Currently off',
    '<p class="note">With two-step on, signing in needs your password and a six-digit code from an authenticator ' +
    'app on your phone. It is the single best protection on an account that can move money, because a stolen ' +
    'password on its own stops being enough.</p>' +
    '<div class="row" style="margin-top:14px"><div><b>Require a code when I sign in</b>' +
    '<small>Uses any authenticator app — Google Authenticator, Authy, 1Password</small></div>' +
    '<div class="tog' + (on ? ' on' : '') + '" id="tfOn" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    (on ? '' : '<div class="pnl" style="background:var(--panel-2);margin-top:14px">' +
      '<div class="ph"><h3 style="font-size:13px">How setting it up will work</h3></div>' +
      '<div class="kv"><span class="k">1</span><span class="v" style="font-weight:400;text-align:right">' +
      'We show a QR code once</span></div>' +
      '<div class="kv"><span class="k">2</span><span class="v" style="font-weight:400;text-align:right">' +
      'You scan it with your authenticator app</span></div>' +
      '<div class="kv"><span class="k">3</span><span class="v" style="font-weight:400;text-align:right">' +
      'You type the code it shows, to prove it worked</span></div>' +
      '<div class="kv"><span class="k">4</span><span class="v" style="font-weight:400;text-align:right">' +
      'We give you ten recovery codes to keep somewhere safe</span></div></div>' +
      '<p class="hint">The QR code and recovery codes need the Supabase auth backend, so this switch records the ' +
      'intent for now and the setup runs when that lands.</p>'),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doTwoFactor()">Save</button>');
}
function doTwoFactor() {
  const me = Q.staffM(ME.staffId);
  const was = authOf(me).twoFactor;
  authOf(me).twoFactor = document.getElementById('tfOn').classList.contains('on');
  if (was !== authOf(me).twoFactor) {
    logAction('login', 'Two-step verification changed',
      me.name + ' turned two-step verification ' + (authOf(me).twoFactor ? 'on' : 'off') + ' on their own account');
  }
  closeModal();
  toast('Two-step verification ' + (authOf(me).twoFactor ? 'on' : 'off'));
  render();
}

/* ---------------- sessions ---------------- */
function sessionAge(mins) {
  if (mins < 1) return 'active now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
  return Math.floor(mins / 1440) + 'd ago';
}
function revokeSession(staffId, sessionId) {
  const s = Q.staffM(staffId);
  const sess = authOf(s).sessions.find(x => x.id === sessionId);
  if (!sess) return;
  if (sess.current) { toast('That is the session you are using right now'); return; }
  authOf(s).sessions = authOf(s).sessions.filter(x => x.id !== sessionId);
  logAction('login', 'Session ended',
    (staffId === ME.staffId ? s.name + ' signed out their ' : 'Kayode Ojomo signed out ' + s.name + '\'s ') +
    sess.device + ' in ' + sess.place);
  toast('Signed out ' + sess.device);
  render();
}
function revokeAllSessions(staffId) {
  const s = Q.staffM(staffId);
  const others = authOf(s).sessions.filter(x => !x.current);
  if (!others.length) { toast('No other sessions to end'); return; }
  const mine = staffId === ME.staffId;
  modal('Sign out everywhere', s.name,
    '<p class="note">This ends ' + others.length + ' session' + (others.length === 1 ? '' : 's') +
    (mine ? ' on your other devices. The one you are using now stays signed in.'
      : ' on ' + s.name.split(' ')[0] + '\'s devices. They will need to sign in again.') + '</p>' +
    '<div style="margin-top:12px">' + others.map(x =>
      '<div class="row"><div><b>' + x.device + '</b><small>' + x.place + ' · ' + x.ip + ' · ' +
      sessionAge(x.lastSeenMins) + '</small></div></div>').join('') + '</div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn danger" onclick="doRevokeAll(' + staffId + ')">End ' + others.length + ' session' +
    (others.length === 1 ? '' : 's') + '</button>');
}
function doRevokeAll(staffId) {
  const s = Q.staffM(staffId);
  const n = authOf(s).sessions.filter(x => !x.current).length;
  authOf(s).sessions = authOf(s).sessions.filter(x => x.current);
  logAction('login', 'Sessions ended',
    (staffId === ME.staffId ? s.name + ' signed out ' + n + ' of their own sessions'
      : 'Kayode Ojomo signed out all ' + n + ' of ' + s.name + '\'s sessions'));
  closeModal();
  toast(n + ' session' + (n === 1 ? '' : 's') + ' ended');
  render();
}

/* ---------------- admin: reset links, never set a password ---------------- */
function formSendReset(staffId) {
  if (needs('manage_staff', 'Sending a password reset')) return;
  const s = Q.staffM(staffId);
  const hrs = DB.settings.security.resetLinkHours;
  modal('Send a password reset', s.name + ' · ' + s.email,
    '<p class="note">This emails ' + s.name.split(' ')[0] + ' a link that lets them set a new password themselves. ' +
    'The link works once and expires after ' + hrs + ' hours.</p>' +
    '<p class="note" style="margin-top:10px"><b style="color:var(--text)">You cannot set it for them</b>, and that is ' +
    'deliberate. Passwords are stored as one-way hashes, so nobody here can read an existing one, and letting an ' +
    'admin type a new one would mean two people knowing it. A reset link keeps it to one.</p>' +
    '<div class="row" style="margin-top:16px"><div><b>Also end their current sessions</b>' +
    '<small>Use this if you think the account has been got at</small></div>' +
    '<div class="tog" id="rsRevoke" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    '<div class="row"><div><b>Make them set a new one at next sign-in</b>' +
    '<small>They can still sign in with the old password once, then must change it</small></div>' +
    '<div class="tog" id="rsForce" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    (authOf(s).resetSentOn ? '<p class="hint">A reset was last sent ' + ago(authOf(s).resetSentOn) + '.</p>' : ''),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doSendReset(' + staffId + ')">Send the link</button>');
}
function doSendReset(staffId) {
  const s = Q.staffM(staffId);
  const revoke = document.getElementById('rsRevoke').classList.contains('on');
  const force = document.getElementById('rsForce').classList.contains('on');
  authOf(s).resetSentOn = iso(DB.today);
  if (force) authOf(s).mustReset = true;
  let dropped = 0;
  if (revoke) { dropped = authOf(s).sessions.length; authOf(s).sessions = []; }
  authOf(s).locked = false; authOf(s).failedAttempts = 0;
  logAction('login', 'Password reset sent',
    'Kayode Ojomo sent a password reset link to ' + s.name + ' (' + s.email + ')' +
    (dropped ? ', ending ' + dropped + ' session' + (dropped === 1 ? '' : 's') : '') +
    (force ? ', and required a change at next sign-in' : ''));
  closeModal();
  toast('Reset link sent to ' + s.email);
  render();
}
function unlockAccount(staffId) {
  if (needs('manage_staff', 'Unlocking an account')) return;
  const s = Q.staffM(staffId);
  authOf(s).locked = false; authOf(s).lockedAt = null; authOf(s).failedAttempts = 0;
  logAction('login', 'Account unlocked', 'Kayode Ojomo unlocked ' + s.name + '\'s account');
  toast(s.name.split(' ')[0] + '\'s account unlocked');
  render();
}
function toggleForceReset(staffId) {
  if (needs('manage_staff', 'Requiring a password change')) return;
  const s = Q.staffM(staffId);
  authOf(s).mustReset = !authOf(s).mustReset;
  logAction('login', 'Sign-in requirement changed',
    'Kayode Ojomo ' + (authOf(s).mustReset ? 'required' : 'cleared the requirement for') +
    ' ' + s.name + ' to change their password at next sign-in');
  toast(authOf(s).mustReset ? s.name.split(' ')[0] + ' must change their password at next sign-in'
    : 'Requirement cleared');
  render();
}

/* ---------------- password policy ---------------- */
function formPasswordPolicy() {
  if (needs('edit_roles', 'Changing the password policy')) return;
  const s = DB.settings.security;
  modal('Password policy', 'Applies to everyone who signs in to this console',
    '<div class="f2"><div class="fg"><label>Minimum length</label>' +
    '<input id="secLen" type="number" min="8" max="64" value="' + s.minLength + '"></div>' +
    '<div class="fg"><label>Lock the account after</label>' +
    '<input id="secLock" type="number" min="3" max="20" value="' + s.lockoutAfter + '">' +
    '<div class="hint">failed attempts</div></div></div>' +
    '<div class="f2"><div class="fg"><label>Block reuse of the last</label>' +
    '<input id="secReuse" type="number" min="0" max="10" value="' + s.blockReuse + '">' +
    '<div class="hint">passwords</div></div>' +
    '<div class="fg"><label>Sign out after idle</label>' +
    '<input id="secIdle" type="number" min="15" max="10080" value="' + s.sessionIdleMins + '">' +
    '<div class="hint">minutes</div></div></div>' +
    '<div class="fg"><label>Reset link valid for</label>' +
    '<input id="secHrs" type="number" min="1" max="168" value="' + s.resetLinkHours + '">' +
    '<div class="hint">hours</div></div>' +
    '<div class="row"><div><b>Require upper, lower and a number</b>' +
    '<small>A mix is harder to guess than one long run of letters</small></div>' +
    '<div class="tog' + (s.requireMix ? ' on' : '') + '" id="secMix" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    '<div class="row"><div><b>Require a symbol</b>' +
    '<small>Adds strength, but people write these down more often</small></div>' +
    '<div class="tog' + (s.requireSymbol ? ' on' : '') + '" id="secSym" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    '<div class="row"><div><b>Require two-step verification for everyone</b>' +
    '<small>Anyone without it is asked to set it up at next sign-in</small></div>' +
    '<div class="tog' + (s.twoFactorRequired ? ' on' : '') + '" id="secTf" onclick="this.classList.toggle(\'on\')"><i></i></div></div>' +
    '<p class="hint">Length does more for safety than any of the character rules, which is why the minimum sits at ' +
    'ten rather than eight. Expiry is deliberately off: forcing regular changes tends to produce weaker, ' +
    'more predictable passwords.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doPasswordPolicy()">Save policy</button>', true);
}
function doPasswordPolicy() {
  const s = DB.settings.security;
  const v = id => +(document.getElementById(id) || {}).value;
  const before = JSON.stringify(s);
  s.minLength = Math.max(8, v('secLen') || s.minLength);
  s.lockoutAfter = Math.max(3, v('secLock') || s.lockoutAfter);
  s.blockReuse = v('secReuse') || 0;
  s.sessionIdleMins = Math.max(15, v('secIdle') || s.sessionIdleMins);
  s.resetLinkHours = Math.max(1, v('secHrs') || s.resetLinkHours);
  s.requireMix = document.getElementById('secMix').classList.contains('on');
  s.requireSymbol = document.getElementById('secSym').classList.contains('on');
  s.twoFactorRequired = document.getElementById('secTf').classList.contains('on');
  saveSettings();
  if (before !== JSON.stringify(s)) {
    logAction('role_change', 'Password policy changed',
      'Kayode Ojomo changed the password policy — minimum ' + s.minLength + ' characters, lock after ' +
      s.lockoutAfter + ' failed attempts');
  }
  closeModal(); toast('Password policy saved'); render();
}

/* ---------------- the Settings section ----------------
   No KPI cards here. Settings is a place you come to change a thing, not a
   dashboard, so the counts read as a sentence and the detail lives in a
   searchable, sortable table. */
function loginSection() {
  const me = Q.staffM(ME.staffId);
  const a = authOf(me);
  const sec = DB.settings.security;
  const age = Math.round((DB.today - parseD(a.passwordSetOn)) / DAY);
  const canManage = can('manage_staff');

  /* --- your own sign-in --- */
  let html =
    '<div class="sec-t">Your sign-in</div>' +
    '<div class="pnl" style="background:var(--panel-2);margin:0 0 14px">' +
    '<div class="ph"><div><h3 style="font-size:13px">' + esc(me.name) + '</h3>' +
    '<div class="ph-sub">' + me.username + ' · ' + esc(me.email) + '</div></div>' +
    (a.twoFactor ? '<span class="pill green">Two-step on</span>' : '<span class="pill amber">Two-step off</span>') +
    '</div>' +
    kv('Password', '•••••••••••• <span class="note">changed ' + (age === 0 ? 'today' : age + ' days ago') + '</span>') +
    kv('Two-step verification', a.twoFactor
      ? '<span style="color:var(--green)">On</span>' : '<span style="color:var(--amber)">Off</span>') +
    kv('Signed in on', a.sessions.length + ' device' + (a.sessions.length === 1 ? '' : 's')) +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn gold" onclick="formChangePassword()">Change my password</button>' +
    '<button class="btn" onclick="formTwoFactor()">' + (a.twoFactor ? 'Manage' : 'Turn on') + ' two-step</button>' +
    '</div>' +
    '<p class="hint">Passwords are stored as one-way hashes. Nobody here can read yours, which is why a forgotten ' +
    'one is reset rather than looked up.</p>';

  /* --- your sessions --- */
  html += '<div class="sec-t" style="margin-top:26px">Where you are signed in</div>' +
    '<p class="note">If you do not recognise something here, end it and change your password.</p>' +
    '<div style="margin-top:10px">' +
    a.sessions.map(x => '<div class="row"><div><b>' + x.device +
      (x.current ? ' <span class="pill green">This device</span>' : '') + '</b>' +
      '<small>' + x.place + ' · ' + x.ip + ' · ' + sessionAge(x.lastSeenMins) + '</small></div>' +
      (x.current ? '<span class="note">in use</span>'
        : '<button class="btn sm" onclick="revokeSession(' + me.id + ',&#39;' + x.id + '&#39;)">Sign out</button>') +
      '</div>').join('') + '</div>' +
    (a.sessions.filter(x => !x.current).length
      ? '<button class="btn danger" style="margin-top:12px" onclick="revokeAllSessions(' + me.id + ')">' +
        'Sign out my other devices</button>' : '');

  /* --- everyone else, searchable and sortable --- */
  if (canManage) {
    const locked = DB.staff.filter(s => authOf(s).locked).length;
    const mustReset = DB.staff.filter(s => authOf(s).mustReset).length;
    const noTf = DB.staff.filter(s => !authOf(s).twoFactor).length;
    const stale = DB.staff.filter(s => (DB.today - parseD(authOf(s).passwordSetOn)) / DAY > 365).length;
    const never = DB.staff.filter(s => authOf(s).neverSignedIn).length;

    /* the counts as a readable line, not four cards */
    const bits = [];
    if (locked) bits.push('<b style="color:var(--red)">' + locked + ' locked out</b>');
    if (never) bits.push('<b style="color:var(--blue)">' + never + ' yet to sign in</b>');
    if (mustReset) bits.push('<b style="color:var(--amber)">' + mustReset + ' must change their password</b>');
    if (noTf) bits.push(noTf + ' without two-step');
    if (stale) bits.push(stale + ' with a password over a year old');

    const filter = UI.loginFilter || 'all';
    const buckets = {
      all: DB.staff,
      locked: DB.staff.filter(s => authOf(s).locked),
      never: DB.staff.filter(s => authOf(s).neverSignedIn),
      mustreset: DB.staff.filter(s => authOf(s).mustReset),
      notf: DB.staff.filter(s => !authOf(s).twoFactor),
      stale: DB.staff.filter(s => (DB.today - parseD(authOf(s).passwordSetOn)) / DAY > 365)
    };
    let list = (buckets[filter] || DB.staff).slice();

    const q = UI.q.login || '';
    if (q) list = list.filter(s => matches(q, [s.name, s.username, s.email, s.dept, s.title, s.staffId]));

    const pwAge = s => Math.round((DB.today - parseD(authOf(s).passwordSetOn)) / DAY);
    const risk = s => (authOf(s).locked ? 0 : authOf(s).neverSignedIn ? 1 : authOf(s).mustReset ? 2
      : authOf(s).failedAttempts ? 3 : !authOf(s).twoFactor ? 4 : 5);
    const sorters = {
      risk: (x, y) => risk(x) - risk(y) || pwAge(y) - pwAge(x),
      name: (x, y) => x.name.localeCompare(y.name),
      dept: (x, y) => x.dept.localeCompare(y.dept) || x.name.localeCompare(y.name),
      'age-desc': (x, y) => pwAge(y) - pwAge(x),
      'age-asc': (x, y) => pwAge(x) - pwAge(y),
      sessions: (x, y) => authOf(y).sessions.length - authOf(x).sessions.length,
      twofactor: (x, y) => (authOf(x).twoFactor ? 1 : 0) - (authOf(y).twoFactor ? 1 : 0) || x.name.localeCompare(y.name)
    };
    list.sort(sorters[UI.sort.login || 'risk'] || sorters.risk);

    html += '<div class="sec-t" style="margin-top:26px">Everyone else</div>' +
      '<p class="note">Send a reset link, require a change, unlock an account or end its sessions. ' +
      'You cannot set anyone&rsquo;s password — they choose their own from the link.' +
      (bits.length ? '<br><span style="color:var(--text)">Right now: ' + bits.join(' · ') + '.</span>'
        : '<br><span style="color:var(--green)">Right now: nothing needs attention.</span>') + '</p>' +

      '<div class="bar" style="margin-top:12px">' +
      [['all', 'All', DB.staff.length], ['locked', 'Locked', locked], ['never', 'Yet to sign in', never],
       ['mustreset', 'Must change', mustReset], ['notf', 'No two-step', noTf], ['stale', 'Old password', stale]]
        .filter(t => t[0] === 'all' || t[2] > 0)
        .map(t => '<button class="tab' + (filter === t[0] ? ' on' : '') +
          '" onclick="UI.loginFilter=&#39;' + t[0] + '&#39;;render()">' + t[1] +
          '<span class="n">' + t[2] + '</span></button>').join('') +
      '</div>' +
      '<div class="bar">' +
      searchBox('login', 'Search name, username, email, department…') +
      sortSelect('login', [['risk', 'Needs attention first'], ['name', 'Name A–Z'], ['dept', 'Department'],
        ['age-desc', 'Oldest password first'], ['age-asc', 'Newest password first'],
        ['sessions', 'Most sessions'], ['twofactor', 'Without two-step first']]) +
      '<span class="note" style="margin-left:auto">' + list.length + ' of ' + DB.staff.length + '</span>' +
      '</div>' +

      (list.length
        ? '<div class="tw"><table><thead><tr><th>Person</th><th class="hide-sm">Department</th>' +
        '<th class="num hide-sm">Password age</th>' +
        '<th class="hide-sm">Two-step</th><th class="num hide-sm">Sessions</th>' +
        '<th>State</th><th></th></tr></thead><tbody>' +
        list.map(s => {
          const au = authOf(s);
          const d = pwAge(s);
          const state = au.locked ? '<span class="pill red">Locked</span>'
            : au.neverSignedIn ? '<span class="pill blue">Yet to sign in</span>'
              : au.mustReset ? '<span class="pill amber">Must change</span>'
                : au.failedAttempts ? '<span class="pill amber">' + au.failedAttempts + ' failed</span>'
                  : '<span class="pill green">Normal</span>';
          return '<tr><td class="klik" onclick="openDetail(&#39;staff&#39;,' + s.id + ')">' +
            '<div class="t-main">' + esc(s.name) + '</div><div class="t-sub">' + s.username + '</div></td>' +
            '<td class="hide-sm">' + s.dept + '</td>' +
            '<td class="num hide-sm"' + (d > 365 ? ' style="color:var(--amber)"' : '') + '>' +
            (au.neverSignedIn ? '<span class="note">—</span>' : d + ' days') + '</td>' +
            '<td class="hide-sm">' + (au.twoFactor ? '<span class="pill green">On</span>' : '<span class="pill grey">Off</span>') + '</td>' +
            '<td class="num hide-sm">' + au.sessions.length + '</td>' +
            '<td>' + state + '</td>' +
            '<td><div style="display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap">' +
            '<button class="btn sm" onclick="formSendReset(' + s.id + ')">Reset link</button>' +
            (au.locked ? '<button class="btn sm gold" onclick="unlockAccount(' + s.id + ')">Unlock</button>' : '') +
            (au.sessions.length ? '<button class="btn sm" onclick="revokeAllSessions(' + s.id + ')">End sessions</button>' : '') +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty">Nobody matches that.</div>') +
      '<button class="btn gold" style="margin-top:14px" onclick="formAddStaff()">+ Add staff</button>';
  }

  /* --- policy --- */
  html += '<div class="sec-t" style="margin-top:26px">Rules for everyone</div>' +
    kv('Minimum length', sec.minLength + ' characters') +
    kv('Must mix upper, lower and a number', sec.requireMix ? 'Yes' : 'No') +
    kv('Must include a symbol', sec.requireSymbol ? 'Yes' : 'No') +
    kv('Cannot reuse the last', sec.blockReuse ? sec.blockReuse + ' passwords' : 'No restriction') +
    kv('Account locks after', sec.lockoutAfter + ' failed attempts') +
    kv('Signed out after idle', (sec.sessionIdleMins >= 60
      ? Math.round(sec.sessionIdleMins / 60) + ' hours' : sec.sessionIdleMins + ' minutes')) +
    kv('Reset link valid for', sec.resetLinkHours + ' hours') +
    kv('Passwords expire', sec.expiryDays ? 'Every ' + sec.expiryDays + ' days' : 'Never, by choice') +
    kv('Two-step required', sec.twoFactorRequired ? 'Yes, for everyone' : 'Optional') +
    (can('edit_roles')
      ? '<button class="btn" style="margin-top:14px" onclick="formPasswordPolicy()">Edit the policy</button>'
      : '<p class="hint">Only a role with &ldquo;Edit roles &amp; permissions&rdquo; can change these.</p>');

  return html;
}
