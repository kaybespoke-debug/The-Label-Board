/* ============================================================
   actions.js — every button does something: forms, mutations,
   exports, clock in/out, permissions
   ============================================================ */

/* ---------------- period picker ---------------- */
function periodBar() {
  const opts = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'],
    ['quarter', 'This quarter'], ['year', 'This year'], ['last30', 'Last 30 days'], ['last12m', 'Last 12 months'], ['all', 'All time']];
  return '<div class="periodbar"><div class="pwrap">' +
    '<button class="pbtn" onclick="togglePop(event)"><span>' + PERIOD.label + '</span><span class="cv">&#9660;</span></button>' +
    '<div class="ppop" id="ppop">' +
    opts.map(o => '<button class="popt' + (PERIOD.key === o[0] ? ' on' : '') + '" onclick="applyPeriod(\'' + o[0] + '\')">' + o[1] + '</button>').join('') +
    '<div class="psep"></div>' +
    '<div class="pfield"><label>From</label><input type="date" id="pFrom" value="' + iso(PERIOD.from) + '"></div>' +
    '<div class="pfield"><label>To</label><input type="date" id="pTo" value="' + iso(PERIOD.to) + '"></div>' +
    '<button class="papply" onclick="applyCustom()">Apply date range</button>' +
    '</div></div>' +
    /* The exact dates only earn their place when the label alone does not say it. */
    (PERIOD.key === 'custom' ? '' : '') +
    '</div>';
}

/* ---------------- reusable search + sort ---------------- */
function searchBox(page, placeholder) {
  const v = UI.q[page] || '';
  return '<input class="srch" style="min-width:200px;flex:1;max-width:320px" value="' + esc(v) +
    '" placeholder="' + placeholder + '" oninput="UI.q[\'' + page + '\']=this.value;renderDebounced()">';
}
function sortSelect(page, opts) {
  const cur = UI.sort[page];
  return '<select class="sel" onchange="UI.sort[\'' + page + '\']=this.value;render()">' +
    opts.map(o => '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>Sort: ' + o[1] + '</option>').join('') +
    '</select>';
}
let rdT;
function renderDebounced() { clearTimeout(rdT); rdT = setTimeout(render, 220); }
function matches(q, fields) {
  if (!q) return true;
  const s = q.toLowerCase();
  return fields.some(f => String(f == null ? '' : f).toLowerCase().includes(s));
}
function togglePop(e) { e.stopPropagation(); document.getElementById('ppop').classList.toggle('on'); }
function applyPeriod(k) { setPeriod(k); render(); }
function applyCustom() {
  const f = document.getElementById('pFrom').value, t = document.getElementById('pTo').value;
  if (!f || !t) { toast('Pick both a start and an end date'); return; }
  if (new Date(f) > new Date(t)) { toast('The start date is after the end date'); return; }
  setPeriod('custom', f, t); render();
  toast('Showing ' + fmtD(f) + ' to ' + fmtD(t));
}
document.addEventListener('click', function (e) {
  const p = document.getElementById('ppop');
  if (p && !e.target.closest('.pwrap')) p.classList.remove('on');
});

/* ---------------- theme ---------------- */
function setTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  localStorage.setItem('tlb_admin_theme', t);
  render();
}
function toggleTheme() { setTheme(document.body.classList.contains('light') ? 'dark' : 'light'); }

/* ---------------- clock in / out ---------------- */
function clockIn(staffId) {
  const s = Q.staffM(staffId);
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
  const t = iso(DB.today);
  let rec = DB.attendance.find(a => a.staffId === staffId && a.date === t);
  const late = now.getHours() >= 9;
  if (rec) { rec.in = hh + ':' + mm; rec.out = null; rec.state = late ? 'late' : 'present'; rec.hours = 0; }
  else {
    DB.attendance.unshift({ id: Date.now(), staffId, date: t, in: hh + ':' + mm, out: null, state: late ? 'late' : 'present', hours: 0 });
  }
  logAction('attendance', 'Staff clocked in', s.name + ' clocked in at ' + hh + ':' + mm);
  toast(s.name.split(' ')[0] + ' clocked in at ' + hh + ':' + mm + (late ? ' (late)' : ''));
  render();
}
function clockOut(staffId) {
  const s = Q.staffM(staffId);
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
  const rec = DB.attendance.find(a => a.staffId === staffId && a.date === iso(DB.today));
  if (!rec || !rec.in) { toast('Clock in first'); return; }
  rec.out = hh + ':' + mm;
  const inM = +rec.in.slice(0, 2) * 60 + +rec.in.slice(3);
  const outM = +hh * 60 + +mm;
  rec.hours = Math.max(0, Math.round((outM - inM) / 6) / 10);
  logAction('attendance', 'Staff clocked out', s.name + ' clocked out at ' + hh + ':' + mm + ' — ' + rec.hours + ' hours');
  toast(s.name.split(' ')[0] + ' clocked out · ' + rec.hours + ' hours');
  render();
}

/* ---------------- permissions ---------------- */
function togglePage(roleId, pageId) {
  const r = Q.role(roleId);
  if (!r || r.locked) { toast('The Owner role cannot be limited'); return; }
  const i = r.pages.indexOf(pageId);
  if (i >= 0) r.pages.splice(i, 1); else r.pages.push(pageId);
  saveRoles();
  logAction('role_change', 'Role permissions changed',
    'Kayode Ojomo ' + (i >= 0 ? 'removed' : 'granted') + ' "' + (DB.pages.find(p => p[0] === pageId) || [])[1] + '" on the ' + r.name + ' role');
  render();
}
function toggleCap(roleId, capId) {
  const r = Q.role(roleId);
  if (!r || r.locked) { toast('The Owner role cannot be limited'); return; }
  const i = r.caps.indexOf(capId);
  if (i >= 0) r.caps.splice(i, 1); else r.caps.push(capId);
  saveRoles();
  logAction('role_change', 'Role permissions changed',
    'Kayode Ojomo ' + (i >= 0 ? 'revoked' : 'granted') + ' "' + (DB.caps.find(c => c[0] === capId) || [])[1] + '" on the ' + r.name + ' role');
  render();
}
function renameRole(id) {
  const r = Q.role(id);
  modal('Rename role', r.name, '<div class="fg"><label>Role name</label><input id="rn" value="' + esc(r.name) + '"></div>' +
    '<div class="fg"><label>Description</label><input id="rd" value="' + esc(r.desc) + '"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doRenameRole(\'' + id + '\')">Save</button>');
}
function doRenameRole(id) {
  const r = Q.role(id);
  r.name = document.getElementById('rn').value || r.name;
  r.desc = document.getElementById('rd').value || r.desc;
  saveRoles(); closeModal(); toast('Role renamed'); render();
}
function formNewRole() {
  modal('New role', 'Start from nothing and switch on what this role needs',
    '<div class="fg"><label>Role name</label><input id="nrn" placeholder="e.g. Billing Analyst"></div>' +
    '<div class="fg"><label>Description</label><input id="nrd" placeholder="What this role is for"></div>' +
    '<p class="hint">The role starts with the Overview page only. Switch on the rest once it is created.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doNewRole()">Create role</button>');
}
function doNewRole() {
  const n = document.getElementById('nrn').value.trim();
  if (!n) { toast('Give the role a name'); return; }
  const id = n.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (Q.role(id)) { toast('A role with that name already exists'); return; }
  DB.roles.push({ id, name: n, builtin: false, locked: false, desc: document.getElementById('nrd').value || 'Custom role', pages: ['dashboard'], caps: [] });
  saveRoles(); closeModal(); toast('Role "' + n + '" created');
  logAction('role_change', 'Role created', 'Kayode Ojomo created the ' + n + ' role');
  render();
}
function deleteRole(id) {
  const r = Q.role(id);
  const assigned = DB.staff.filter(s => s.roleId === id).length;
  if (assigned) { toast('Move the ' + assigned + ' account(s) on this role first'); return; }
  modal('Delete role', r.name, '<p class="note">This removes the ' + esc(r.name) + ' role. Nobody is assigned to it, so no one loses access.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn danger" onclick="doDeleteRole(\'' + id + '\')">Delete role</button>');
}
function doDeleteRole(id) {
  const r = Q.role(id);
  DB.roles = DB.roles.filter(x => x.id !== id);
  saveRoles(); closeModal(); toast('Role deleted');
  logAction('role_change', 'Role deleted', 'Kayode Ojomo deleted the ' + r.name + ' role');
  render();
}
function resetRoles() {
  modal('Reset roles', 'Put every role back to its default permissions',
    '<p class="note">Custom roles you created are removed and the built-in roles go back to their starting permissions.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn danger" onclick="doResetRoles()">Reset all roles</button>');
}
function doResetRoles() {
  DB.roles = defaultRoles();
  localStorage.removeItem('tlb_admin_roles');
  closeModal(); toast('Roles reset to defaults'); render();
}
function formStaffRole(staffId) {
  const s = Q.staffM(staffId);
  modal('Change role', s.name + ' · currently ' + (Q.role(s.roleId) || {}).name,
    '<div class="fg"><label>Role</label><select id="srole">' +
    DB.roles.map(r => '<option value="' + r.id + '"' + (s.roleId === r.id ? ' selected' : '') + '>' + r.name + '</option>').join('') +
    '</select></div><p class="hint">The role decides which pages they can open and what they are allowed to do. ' +
    'Edit the roles themselves in Settings → Team &amp; notifications.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doStaffRole(' + staffId + ')">Save</button>');
}
function doStaffRole(staffId) {
  const s = Q.staffM(staffId);
  const old = (Q.role(s.roleId) || {}).name;
  s.roleId = document.getElementById('srole').value;
  logAction('role_change', 'Account role changed', 'Kayode Ojomo moved ' + s.name + ' from ' + old + ' to ' + (Q.role(s.roleId) || {}).name);
  closeModal(); toast(s.name.split(' ')[0] + ' is now ' + (Q.role(s.roleId) || {}).name); render();
}

/* ---------------- settings ---------------- */
function editSetting(key, label, type) {
  modal('Edit ' + label.toLowerCase(), '', '<div class="fg"><label>' + label + '</label>' +
    '<input id="setv" type="' + type + '" value="' + esc(DB.settings[key]) + '"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doSetting(\'' + key + '\',\'' + type + '\')">Save</button>');
}
function doSetting(key, type) {
  const v = document.getElementById('setv').value;
  DB.settings[key] = type === 'number' ? +v : v;
  saveSettings(); closeModal(); toast('Saved'); render();
}
function setNotify(k, v) { DB.settings.notify[k] = v; saveSettings(); if (k !== 'volume') render(); }
function toggleAlert(k) { DB.settings.notify.alerts[k] = !DB.settings.notify.alerts[k]; saveSettings(); render(); }
function resetAll() {
  modal('Reset this prototype', 'Everything goes back to how it started',
    '<p class="note">Clears role edits, platform settings, clock-ins and published payslips from this browser and reloads ' +
    'the demo dataset. Nothing outside this browser is touched.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn danger" onclick="localStorage.clear();location.reload()">Reset everything</button>');
}

/* ---------------- subscriber actions ---------------- */
function formAddSubscriber() {
  modal('Add subscriber', 'Create the account manually — normally they sign themselves up',
    '<div class="f2"><div class="fg"><label>Trading name</label><input id="asName" placeholder="e.g. Lux Couture"></div>' +
    '<div class="fg"><label>Owner</label><input id="asOwner" placeholder="Full name"></div></div>' +
    '<div class="f2"><div class="fg"><label>Email</label><input id="asEmail" type="email" placeholder="owner@business.com"></div>' +
    '<div class="fg"><label>Phone</label><input id="asPhone" placeholder="+234 …"></div></div>' +
    '<div class="f2"><div class="fg"><label>Plan</label><select id="asPlan" onchange="togglePlanPrice(\'asPlan\',\'asPriceWrap\')">' +
    DB.plans.map(p => '<option value="' + p.id + '">' + p.name + (p.monthly ? ' — ' + money(p.monthly) + '/mo' : (p.invoiceOnly ? ' — invoiced' : '')) + '</option>').join('') +
    '</select></div><div class="fg"><label>Billing cycle</label><select id="asCycle"><option value="monthly">Monthly</option><option value="annual">Annual</option></select></div></div>' +
    agreedPriceField('asPlan', 'asPriceWrap', 'asPrice', '', false) +
    '<div class="fg"><label>City</label><input id="asCity" placeholder="Lagos"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doAddSubscriber()">Create account</button>');
}
function doAddSubscriber() {
  const name = document.getElementById('asName').value.trim();
  const owner = document.getElementById('asOwner').value.trim();
  if (!name || !owner) { toast('Trading name and owner are required'); return; }
  const planId = document.getElementById('asPlan').value;
  const cycle = document.getElementById('asCycle').value;
  const p = planById(planId);
  const id = Math.max.apply(null, DB.subscribers.map(s => s.id)) + 1;
  DB.subscribers.unshift({
    id, name, owner,
    email: document.getElementById('asEmail').value || owner.split(' ')[0].toLowerCase() + '@example.com',
    phone: document.getElementById('asPhone').value || '+234 800 000 0000',
    city: document.getElementById('asCity').value || 'Lagos',
    plan: planId, planName: p.name, cycle: planId === 'trial' ? 'trial' : cycle,
    status: planId === 'trial' ? 'trial' : 'active', pastDue: false,
    health: planId === 'trial' ? 'onboarding' : 'healthy',
    users: 1, seats: p.seats, joined: iso(DB.today), renewsOn: iso(dAgo(planId === 'trial' ? -DB.settings.trialDays : -30)),
    renewIn: planId === 'trial' ? DB.settings.trialDays : 30,
    mrr: planMrr(p, cycle, document.getElementById('asPrice') && document.getElementById('asPrice').value),
    channel: 'Added by admin', businesses: [{ name: 'Main outlet', city: document.getElementById('asCity').value || 'Lagos', staff: 1, openedOn: iso(DB.today) }],
    referredBy: null, referrals: [], referralLedger: [], referralEarned: 0, referralPaid: 0, referralPending: 0, referralConverted: 0,
    lastSeen: iso(DB.today), ordersLast30: 0, notes: []
  });
  logAction('sub_edit', 'Subscriber created', 'Kayode Ojomo created ' + name + ' on the ' + p.name + ' plan', 'subscriber:' + id);
  closeModal(); toast(name + ' added'); render();
}
function formEditSubscriber(id) {
  const s = Q.sub(id);
  modal('Edit ' + s.name, 'TLB-S' + String(s.id).padStart(4, '0'),
    '<div class="f2"><div class="fg"><label>Trading name</label><input id="esName" value="' + esc(s.name) + '"></div>' +
    '<div class="fg"><label>Owner</label><input id="esOwner" value="' + esc(s.owner) + '"></div></div>' +
    '<div class="f2"><div class="fg"><label>Email</label><input id="esEmail" value="' + esc(s.email) + '"></div>' +
    '<div class="fg"><label>Phone</label><input id="esPhone" value="' + esc(s.phone) + '"></div></div>' +
    '<div class="f2"><div class="fg"><label>City</label><input id="esCity" value="' + esc(s.city) + '"></div>' +
    '<div class="fg"><label>Health</label><select id="esHealth">' +
    ['healthy', 'steady', 'at-risk', 'onboarding', 'churned'].map(h => '<option value="' + h + '"' + (s.health === h ? ' selected' : '') + '>' + h + '</option>').join('') +
    '</select></div></div>' +
    '<div class="fg"><label>Seats in use</label><input id="esUsers" type="number" value="' + s.users + '"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doEditSubscriber(' + id + ')">Save changes</button>');
}
function doEditSubscriber(id) {
  const s = Q.sub(id);
  s.name = document.getElementById('esName').value || s.name;
  s.owner = document.getElementById('esOwner').value || s.owner;
  s.email = document.getElementById('esEmail').value || s.email;
  s.phone = document.getElementById('esPhone').value || s.phone;
  s.city = document.getElementById('esCity').value || s.city;
  s.health = document.getElementById('esHealth').value;
  s.users = +document.getElementById('esUsers').value || s.users;
  logAction('sub_edit', 'Subscriber record edited', 'Kayode Ojomo edited ' + s.name, 'subscriber:' + s.id);
  closeModal(); toast('Saved'); render();
}
function formChangePlan(id) {
  const s = Q.sub(id);
  modal('Change plan', s.name + ' · currently ' + s.planName + ' (' + s.cycle + ')',
    '<div class="f2"><div class="fg"><label>New plan</label><select id="cpPlan" onchange="togglePlanPrice(\'cpPlan\',\'cpPriceWrap\')">' +
    DB.plans.map(p => '<option value="' + p.id + '"' + (s.plan === p.id ? ' selected' : '') + '>' + p.name + (p.monthly ? ' — ' + money(p.monthly) + '/mo' : '') + '</option>').join('') +
    '</select></div><div class="fg"><label>Billing cycle</label><select id="cpCycle">' +
    '<option value="monthly"' + (s.cycle === 'monthly' ? ' selected' : '') + '>Monthly</option>' +
    '<option value="annual"' + (s.cycle === 'annual' ? ' selected' : '') + '>Annual</option></select></div></div>' +
    agreedPriceField('cpPlan', 'cpPriceWrap', 'cpPrice', planIsInvoiced(planById(s.plan)) ? s.mrr : '', planIsInvoiced(planById(s.plan))) +
    '<div class="fg"><label>Reason (goes on the audit log)</label><input id="cpWhy" placeholder="e.g. Upgrade requested by owner"></div>' +
    '<p class="hint">Current MRR ' + (s.mrr ? money(s.mrr) : '—') + '. The change takes effect on the next renewal, ' + fmtD(s.renewsOn) + '.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doChangePlan(' + id + ')">Change plan</button>');
}
function doChangePlan(id) {
  const s = Q.sub(id);
  const oldName = s.planName;
  const pid = document.getElementById('cpPlan').value;
  const cycle = document.getElementById('cpCycle').value;
  const p = planById(pid);
  s.plan = pid; s.planName = p.name; s.cycle = pid === 'trial' ? 'trial' : cycle;
  s.seats = p.seats;
  s.status = pid === 'trial' ? 'trial' : 'active';
  s.mrr = planMrr(p, cycle, document.getElementById('cpPrice') && document.getElementById('cpPrice').value);
  if (planIsInvoiced(p) && !s.mrr) { toast('Bespoke has no list price. Type what ' + s.name + ' agreed to pay, or it counts for nothing.'); return; }
  logAction('plan_change', 'Subscription plan changed',
    'Kayode Ojomo moved ' + s.name + ' from ' + oldName + ' to ' + p.name +
    (document.getElementById('cpWhy').value ? ' — ' + document.getElementById('cpWhy').value : ''), 'subscriber:' + s.id);
  closeModal(); toast(s.name + ' moved to ' + p.name); render();
}
function formConvert(id) {
  const s = Q.sub(id);
  modal('Convert to paid', s.name + ' · trial ends ' + fmtD(s.renewsOn),
    '<div class="fg"><label>Plan</label><select id="cvPlan" onchange="togglePlanPrice(\'cvPlan\',\'cvPriceWrap\')">' +
    DB.plans.filter(p => p.id !== 'trial').map(p => '<option value="' + p.id + '">' + p.name + (p.invoiceOnly ? ' — invoiced' : ' — ' + money(p.monthly) + '/mo') + '</option>').join('') +
    '</select></div><div class="fg"><label>Billing cycle</label><select id="cvCycle"><option value="monthly">Monthly</option><option value="annual">Annual (2 months free)</option></select></div>' +
    agreedPriceField('cvPlan', 'cvPriceWrap', 'cvPrice', '', false),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doConvert(' + id + ')">Convert</button>');
}
function doConvert(id) {
  const s = Q.sub(id);
  const p = planById(document.getElementById('cvPlan').value);
  const cycle = document.getElementById('cvCycle').value;
  s.plan = p.id; s.planName = p.name; s.cycle = cycle; s.status = 'active'; s.health = 'healthy';
  s.mrr = planMrr(p, cycle, document.getElementById('cvPrice') && document.getElementById('cvPrice').value);
  if (planIsInvoiced(p) && !s.mrr) { toast('Bespoke has no list price. Type what ' + s.name + ' agreed to pay, or it counts for nothing.'); return; }
  s.seats = p.seats;
  DB.onboarding = DB.onboarding.filter(o => o.subId !== s.id);
  logAction('plan_change', 'Trial converted', 'Kayode Ojomo converted ' + s.name + ' to ' + p.name, 'subscriber:' + s.id);
  closeModal(); toast(s.name + ' is now on ' + p.name); render();
}

/* ---------------- plans ---------------- */
function formPlan(id) {
  const p = id ? planById(id) : null;
  modal(p ? 'Edit ' + p.name : 'Create plan', p ? (Q.planSplit().find(x => x.id === id).count + ' subscribers on this plan') : 'A new tier subscribers can buy',
    '<div class="fg"><label>Plan name</label><input id="plName" value="' + (p ? esc(p.name) : '') + '" placeholder="e.g. Enterprise"></div>' +
    (p && p.invoiceOnly
      ? '<p class="hint">This plan is invoiced per business, so it has no list price here. What each subscriber pays is set on their own record.</p>'
      : '<div class="f2"><div class="fg"><label>Monthly price (₦)</label><input id="plM" type="number" value="' + (p ? p.monthly : '') + '"></div>' +
        '<div class="fg"><label>Annual price (₦)</label><input id="plA" type="number" value="' + (p ? p.annual : '') + '"></div></div>') +
    '<div class="fg"><label>Team seats included</label><input id="plS" type="number" min="0" value="' + (p ? p.seats : 5) + '">' +
    '<p class="hint">Zero means unlimited, which is what Pro and Bespoke are.</p></div>' +
    '<div class="fg"><label>Features, one per line</label><textarea id="plF">' + (p ? p.features.join('\n') : '') + '</textarea></div>' +
    (p ? '<p class="hint">Changing the price does not re-charge anyone. Existing subscribers keep their current price until their next renewal.</p>' : ''),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doPlan(' + (id ? "'" + id + "'" : 'null') + ')">' + (p ? 'Save plan' : 'Create plan') + '</button>');
}
function doPlan(id) {
  const name = document.getElementById('plName').value.trim();
  if (!name) { toast('Give the plan a name'); return; }
  /* An invoiced plan renders no price inputs, so read what it already has rather than
     zero. Reading a field that is not there and saving the zero is how a plan loses its
     price by being opened and saved with nothing changed. */
  const existing = id ? planById(id) : null;
  const plM = document.getElementById('plM'), plA = document.getElementById('plA');
  const m = plM ? (+plM.value || 0) : (existing ? existing.monthly : 0);
  const a = plA ? (+plA.value || 0) : (existing ? existing.annual : 0);
  /* Zero seats means unlimited and is a real answer, so it cannot fall through to five. */
  const seatRaw = document.getElementById('plS').value;
  const s = seatRaw === '' ? (existing ? existing.seats : 5) : Math.max(0, +seatRaw || 0);
  const f = document.getElementById('plF').value.split('\n').map(x => x.trim()).filter(Boolean);
  if (id) {
    const p = planById(id);
    const old = p.monthly;
    p.name = name; p.monthly = m; p.annual = a; p.seats = s; p.features = f.length ? f : p.features;
    DB.subscribers.filter(x => x.plan === id).forEach(x => { x.planName = name; x.seats = s; });
    logAction('change_plan', 'Plan edited', p.invoiceOnly
      ? 'Kayode Ojomo edited ' + name + ', which is invoiced per business'
      : 'Kayode Ojomo changed ' + name + ' from ' + money(old) + ' to ' + money(m) + ' a month');
    toast(name + ' updated');
  } else {
    DB.plans.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name, monthly: m, annual: a, seats: s, live: true, features: f.length ? f : ['New plan'] });
    logAction('change_plan', 'Plan created', 'Kayode Ojomo created the ' + name + ' plan at ' + money(m) + ' a month');
    toast(name + ' created');
  }
  closeModal(); render();
}

/* ---------------- payments ---------------- */
function retryPayment(id) {
  const p = DB.payments.find(x => x.id === +id);
  p.status = 'successful'; p.method = 'Card •••6411 (retry)';
  const s = Q.sub(p.subId);
  if (s) { s.pastDue = false; if (s.health === 'at-risk') s.health = 'steady'; }
  logAction('refund', 'Payment retried', 'Kayode Ojomo retried ' + money(p.amount) + ' for ' + p.subscriber + ' — succeeded', 'subscriber:' + p.subId);
  toast('Charge went through · ' + money(p.amount)); render();
}
function formRefund(id) {
  const p = DB.payments.find(x => x.id === +id);
  modal('Issue refund', p.subscriber + ' · ' + p.ref,
    '<div class="fg"><label>Amount to refund (₦)</label><input id="rfAmt" type="number" value="' + p.amount + '"></div>' +
    '<div class="fg"><label>Reason</label><select id="rfWhy"><option>Duplicate charge</option><option>Billed in error</option>' +
    '<option>Service issue</option><option>Cancelled within cooling-off</option><option>Goodwill</option></select></div>' +
    '<p class="hint">The refund goes back to ' + p.method + '. Flutterwave usually settles it in 5 to 10 working days.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn danger" onclick="doRefund(' + id + ')">Refund ' + money(p.amount) + '</button>');
}
function doRefund(id) {
  const p = DB.payments.find(x => x.id === +id);
  const amt = +document.getElementById('rfAmt').value || p.amount;
  const why = document.getElementById('rfWhy').value;
  p.status = 'refunded';
  logAction('refund', 'Refund issued', 'Kayode Ojomo refunded ' + money(amt) + ' to ' + p.subscriber + ' — ' + why, 'subscriber:' + p.subId);
  closeModal(); toast('Refunded ' + money(amt)); render();
}
function downloadInvoice(id) {
  const p = DB.payments.find(x => x.id === +id);
  const s = Q.sub(p.subId);
  const html = '<h1>Invoice ' + p.invoice + '</h1><p>The Label Board Ltd</p><hr>' +
    '<p><b>Billed to</b><br>' + s.name + '<br>' + s.owner + '<br>' + s.email + '</p>' +
    '<p><b>Date</b> ' + fmtD(p.date) + '<br><b>Reference</b> ' + p.ref + '</p>' +
    '<table border="1" cellpadding="8" style="border-collapse:collapse"><tr><th>Item</th><th>Amount</th></tr>' +
    '<tr><td>' + p.plan + ' plan · ' + p.cycle + '</td><td>' + money(p.amount) + '</td></tr>' +
    '<tr><td><b>Total</b></td><td><b>' + money(p.amount) + '</b></td></tr></table>' +
    '<p>Status: ' + p.status + ' · paid by ' + p.method + '</p>';
  download(p.invoice + '.html', html, 'text/html;charset=utf-8');
  toast('Invoice ' + p.invoice + ' downloaded');
}

/* ---------------- payroll ---------------- */
function formRunPayroll() {
  const run = Q.currentRun();
  const pend = Q.slipsFor(run.monthKey).filter(s => s.status === 'pending');
  modal('Run payroll', run.month + ' · ' + run.headcount + ' staff',
    '<div class="kv"><span class="k">Gross</span><span class="v">' + money(run.gross) + '</span></div>' +
    '<div class="kv"><span class="k">Deductions</span><span class="v" style="color:var(--red)">−' + money(run.deductions) + '</span></div>' +
    '<div class="kv"><span class="k">Net to release</span><span class="v">' + money(run.net) + '</span></div>' +
    '<div class="kv"><span class="k">Still pending</span><span class="v">' + pend.length + ' staff · ' + money(pend.reduce((t, s) => t + s.net, 0)) + '</span></div>' +
    '<div class="fg" style="margin-top:16px"><label>Value date</label><input type="date" id="prDate" value="' + run.payDate + '"></div>' +
    '<p class="hint">Marks the ' + pend.length + ' pending staff as paid and closes the run. Payslips still need publishing separately so staff can see them.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doRunPayroll()">Release ' + money(pend.reduce((t, s) => t + s.net, 0)) + '</button>');
}
function doRunPayroll() {
  const run = Q.currentRun();
  Q.slipsFor(run.monthKey).forEach(s => { s.status = 'paid'; });
  run.paid = run.headcount; run.pending = 0; run.status = 'closed';
  logAction('payroll', 'Payroll run closed', 'Kayode Ojomo closed the ' + run.month + ' payroll — ' + money(run.net) + ' released to ' + run.headcount + ' staff');
  closeModal(); toast('Payroll released · ' + money(run.net)); render();
}
function formPublishSlips() {
  const key = UI.payMonth || DB.payrollRuns[0].monthKey;
  const run = Q.runByKey(key);
  const un = Q.slipsFor(key).filter(s => !s.uploaded);
  modal('Publish payslips', run.month,
    '<p class="note">Publishing makes each payslip visible to that staff member inside their own profile and account. ' +
    'They see their own slip only.</p>' +
    '<div class="kv" style="margin-top:14px"><span class="k">Payslips in this run</span><span class="v">' + Q.slipsFor(key).length + '</span></div>' +
    '<div class="kv"><span class="k">Already published</span><span class="v">' + (Q.slipsFor(key).length - un.length) + '</span></div>' +
    '<div class="kv"><span class="k">To publish now</span><span class="v">' + un.length + '</span></div>' +
    (un.length ? '<div class="sec-t">Will become visible to</div><div class="chips">' +
      un.map(s => '<span class="chip">' + esc(s.staffName) + '</span>').join('') + '</div>' : ''),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    (un.length ? '<button class="btn gold" onclick="doPublishSlips(\'' + key + '\')">Publish ' + un.length + ' payslip' + (un.length === 1 ? '' : 's') + '</button>' : ''));
}
function doPublishSlips(key) {
  const un = Q.slipsFor(key).filter(s => !s.uploaded);
  un.forEach(s => { s.uploaded = true; s.publishedOn = iso(DB.today); });
  logAction('slip_publish', 'Payslips published', 'Kayode Ojomo published ' + un.length + ' payslips for ' + Q.runByKey(key).month);
  closeModal(); toast(un.length + ' payslips published'); render();
}
function publishSlip(id) {
  const s = DB.payslips.find(x => x.id === +id);
  s.uploaded = true; s.publishedOn = iso(DB.today);
  logAction('slip_publish', 'Payslip published', 'Kayode Ojomo published ' + s.staffName + '\'s ' + s.month + ' payslip');
  toast('Published to ' + s.staffName.split(' ')[0]); render();
}
function publishSlipsFor(staffId) {
  const un = Q.slipsForStaff(staffId).filter(s => !s.uploaded);
  if (!un.length) { toast('Every payslip is already published'); return; }
  un.forEach(s => { s.uploaded = true; s.publishedOn = iso(DB.today); });
  logAction('slip_publish', 'Payslips published', 'Kayode Ojomo published ' + un.length + ' payslips for ' + Q.staffM(staffId).name);
  toast(un.length + ' payslip' + (un.length === 1 ? '' : 's') + ' published'); render();
}
function downloadSlip(id) {
  const s = DB.payslips.find(x => x.id === +id);
  const st = Q.staffM(s.staffId);
  const rows = [
    ['THE LABEL BOARD — PAYSLIP'], [''],
    ['Staff', s.staffName], ['Staff ID', st.staffId], ['Department', s.dept],
    ['Period', s.month], ['Pay date', fmtD(s.payDate)], ['Bank', s.bank], [''],
    ['EARNINGS', ''], ['Basic salary', s.basic], ['Housing allowance', s.housing], ['Transport allowance', s.transport]
  ];
  if (s.bonus) rows.push(['Performance bonus', s.bonus]);
  if (s.overtime) rows.push(['Overtime', s.overtime]);
  rows.push(['Gross pay', s.gross], [''], ['DEDUCTIONS', ''],
    ['PAYE tax', s.paye], ['Pension', s.pension], ['NHF', s.nhf]);
  if (s.loan) rows.push(['Staff loan', s.loan]);
  rows.push(['Total deductions', s.deductions], [''], ['NET PAY', s.net]);
  download('payslip-' + st.staffId + '-' + s.monthKey + '.csv', toCsv(rows), 'text/csv;charset=utf-8');
  toast('Payslip downloaded');
}
function downloadAllSlips(staffId) {
  const st = Q.staffM(staffId);
  const rows = Q.slipsForStaff(staffId).map(s => [s.month, s.basic, s.housing, s.transport, s.bonus, s.overtime, s.gross, s.paye, s.pension, s.nhf, s.loan, s.deductions, s.net, s.status]);
  exportCsv('payslips-' + st.staffId,
    ['Month', 'Basic', 'Housing', 'Transport', 'Bonus', 'Overtime', 'Gross', 'PAYE', 'Pension', 'NHF', 'Loan', 'Deductions', 'Net', 'Status'], rows);
}

/* ---------------- tickets ---------------- */
function resolveTicket(id) {
  const t = Q.ticket(id);
  t.state = 'resolved'; t.resolvedAt = iso(DB.today); t.satisfaction = t.satisfaction || 5;
  logAction('ticket_closed', 'Support ticket closed', 'Kayode Ojomo closed #' + t.ref + ' — ' + t.title, 'ticket:' + t.id);
  toast('#' + t.ref + ' marked resolved'); render();
}
function formAssignTicket(id) {
  const t = Q.ticket(id);
  modal('Assign ticket', '#' + t.ref + ' · ' + t.title,
    '<div class="fg"><label>Assign to</label><select id="atWho">' +
    '<option value="">Unassigned</option>' +
    DB.staff.filter(s => s.dept === 'Support' || s.dept === 'Management').map(s =>
      '<option value="' + s.id + '"' + (t.assignedTo === s.id ? ' selected' : '') + '>' + s.name + ' · ' + s.title + '</option>').join('') +
    '</select></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doAssignTicket(' + id + ')">Assign</button>');
}
function doAssignTicket(id) {
  const t = Q.ticket(id);
  const v = document.getElementById('atWho').value;
  t.assignedTo = v ? +v : null;
  t.assignedName = v ? Q.staffM(+v).name : 'Unassigned';
  if (v && t.state === 'open') t.state = 'in-progress';
  logAction('ticket_closed', 'Ticket assigned', 'Kayode Ojomo assigned #' + t.ref + ' to ' + t.assignedName, 'ticket:' + t.id);
  closeModal(); toast('Assigned to ' + t.assignedName); render();
}
function formNewTicket() {
  modal('Log a ticket', 'For something reported by phone or WhatsApp',
    '<div class="fg"><label>Subscriber</label><select id="ntSub">' +
    DB.subscribers.filter(s => s.status !== 'expired').slice(0, 60).map(s => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('') +
    '</select></div>' +
    '<div class="fg"><label>Subject</label><input id="ntTitle" placeholder="Short summary"></div>' +
    '<div class="fg"><label>What is happening</label><textarea id="ntBody" placeholder="What they reported"></textarea></div>' +
    '<div class="f2"><div class="fg"><label>Type</label><select id="ntKind"><option>bug</option><option>billing</option><option>question</option></select></div>' +
    '<div class="fg"><label>Urgency</label><select id="ntState"><option value="open">Normal</option><option value="urgent">Urgent</option></select></div></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doNewTicket()">Log ticket</button>');
}
function doNewTicket() {
  const title = document.getElementById('ntTitle').value.trim();
  if (!title) { toast('Give the ticket a subject'); return; }
  const sub = Q.sub(+document.getElementById('ntSub').value);
  const id = Math.max.apply(null, DB.tickets.map(t => t.id)) + 1;
  const body = document.getElementById('ntBody').value || '(no detail given)';
  DB.tickets.unshift({
    id, ref: 'TLB-' + (2100 + id), title, body,
    priority: 'normal', state: document.getElementById('ntState').value,
    kind: document.getElementById('ntKind').value,
    subId: sub.id, subscriber: sub.name, plan: sub.planName,
    assignedTo: null, assignedName: 'Unassigned',
    openedAt: iso(DB.today), firstReplyMins: 0, resolvedAt: null, satisfaction: null,
    thread: [{ who: sub.owner, side: 'them', at: iso(DB.today), text: body }]
  });
  logAction('ticket_closed', 'Ticket logged', 'Kayode Ojomo logged #TLB-' + (2100 + id) + ' for ' + sub.name, 'ticket:' + id);
  closeModal(); toast('Ticket logged'); render();
}

/* ---------------- tasks ---------------- */
function formTask(id) {
  const t = id ? DB.tasks.find(x => x.id === +id) : null;
  modal(t ? 'Edit task' : 'Create task', t ? t.title : 'Something the team needs to do',
    '<div class="fg"><label>Title</label><input id="tkTitle" value="' + (t ? esc(t.title) : '') + '" placeholder="What needs doing"></div>' +
    '<div class="fg"><label>Detail</label><textarea id="tkBody">' + (t ? esc(t.body) : '') + '</textarea></div>' +
    '<div class="f2"><div class="fg"><label>Assign to</label><select id="tkWho">' +
    DB.staff.map(s => '<option value="' + s.id + '"' + (t && t.assignedTo === s.id ? ' selected' : '') + '>' + s.name + '</option>').join('') +
    '</select></div><div class="fg"><label>Priority</label><select id="tkPri">' +
    ['high', 'medium', 'low'].map(p => '<option value="' + p + '"' + (t && t.priority === p ? ' selected' : '') + '>' + p + '</option>').join('') +
    '</select></div></div>' +
    '<div class="fg"><label>Due date</label><input type="date" id="tkDue" value="' + (t ? t.due : iso(DB.today)) + '"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doTask(' + (id || 'null') + ')">' + (t ? 'Save' : 'Create task') + '</button>');
}
function doTask(id) {
  const title = document.getElementById('tkTitle').value.trim();
  if (!title) { toast('Give the task a title'); return; }
  const due = document.getElementById('tkDue').value;
  const dueIn = Math.round((new Date(due) - startOfDay(DB.today)) / DAY);
  const who = +document.getElementById('tkWho').value;
  if (id) {
    const t = DB.tasks.find(x => x.id === +id);
    t.title = title; t.body = document.getElementById('tkBody').value;
    t.assignedTo = who; t.assignedName = Q.staffM(who).name;
    t.priority = document.getElementById('tkPri').value; t.due = due; t.dueIn = dueIn;
    toast('Task updated');
  } else {
    DB.tasks.unshift({
      id: Math.max.apply(null, DB.tasks.map(t => t.id)) + 1,
      title, body: document.getElementById('tkBody').value || '',
      priority: document.getElementById('tkPri').value,
      assignedTo: who, assignedName: Q.staffM(who).name,
      due, dueIn, done: false, createdBy: 1, createdAt: iso(DB.today)
    });
    toast('Task created');
  }
  closeModal(); render();
}
function completeTask(id) {
  const t = DB.tasks.find(x => x.id === +id);
  t.done = true; toast('"' + t.title + '" marked done'); render();
}
function reopenTask(id) {
  const t = DB.tasks.find(x => x.id === +id);
  t.done = false; toast('Task reopened'); render();
}

/* ---------------- staff ---------------- */
function formAddStaff() {
  modal('Invite staff', 'They get an email with a link to set their own password',
    '<div class="f2"><div class="fg"><label>Full name</label><input id="isName" placeholder="Full name"></div>' +
    '<div class="fg"><label>Work email</label><input id="isEmail" type="email" placeholder="name@thelabelboard.com"></div></div>' +
    '<div class="f2"><div class="fg"><label>Department</label><select id="isDept">' +
    ['Management', 'Finance', 'Support', 'Product', 'Operations'].map(d => '<option>' + d + '</option>').join('') +
    '</select></div><div class="fg"><label>Job title</label><input id="isTitle" placeholder="e.g. Support Agent"></div></div>' +
    '<div class="f2"><div class="fg"><label>Role (what they can access)</label><select id="isRole">' +
    DB.roles.filter(r => !r.locked).map(r => '<option value="' + r.id + '">' + r.name + '</option>').join('') +
    '</select></div><div class="fg"><label>Monthly basic (₦)</label><input id="isPay" type="number" placeholder="250000"></div></div>' +
    '<p class="hint">Inviting creates the account, sets the role, and adds them to the next payroll run. ' +
    'Housing is 15% and transport 10% of basic by default — change those on their record afterwards.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doInviteStaff()">Send invite</button>');
}
function doInviteStaff() {
  const name = document.getElementById('isName').value.trim();
  if (!name) { toast('Give them a name'); return; }
  const basic = +document.getElementById('isPay').value || 200000;
  const id = Math.max.apply(null, DB.staff.map(s => s.id)) + 1;
  const first = name.split(' ')[0].toLowerCase();
  const st = {
    id, staffId: 'TLB-' + String(id).padStart(3, '0'), name,
    dept: document.getElementById('isDept').value,
    title: document.getElementById('isTitle').value || 'Team member',
    roleId: document.getElementById('isRole').value,
    username: '@' + first,
    email: document.getElementById('isEmail').value || first + '@thelabelboard.com',
    phone: '+234 800 000 0000', gender: '—', dob: '—',
    address: '—', nationality: 'Nigerian', emergency: '—',
    empType: 'Full time', startDate: iso(DB.today), status: 'active',
    reportsTo: 1, workLocation: 'Lagos office', bank: 'Not set',
    salaryType: 'Monthly salary', basic, housing: Math.round(basic * 0.15), transport: Math.round(basic * 0.10),
    lastActive: iso(DB.today), lastActiveLabel: 'Invited', leaveEntitlement: 20, rating: 0
  };
  DB.staff.push(st);
  // add them to the open payroll run
  const run = DB.payrollRuns[0];
  const g = basic + st.housing + st.transport;
  const paye = Math.round(g * 0.115 / 100) * 100, pen = Math.round(basic * 0.08 / 100) * 100, nhf = Math.round(basic * 0.025 / 100) * 100;
  DB.payslips.push({
    id: Math.max.apply(null, DB.payslips.map(x => x.id)) + 1, staffId: id, staffName: name, dept: st.dept,
    monthKey: run.monthKey, month: run.month, payDate: run.payDate,
    basic, housing: st.housing, transport: st.transport, bonus: 0, overtime: 0, gross: g,
    paye, pension: pen, nhf, loan: 0, deductions: paye + pen + nhf, net: g - paye - pen - nhf,
    status: 'pending', bank: st.bank, uploaded: false, publishedOn: null
  });
  run.headcount = DB.staff.length;
  run.gross += g; run.deductions += (paye + pen + nhf); run.net += (g - paye - pen - nhf);
  run.pending += 1;
  logAction('staff_invite', 'Staff invited', 'Kayode Ojomo invited ' + name + ' as ' + st.title + ' (' + st.dept + ')');
  closeModal(); toast('Invite sent to ' + st.email); render();
}
function formLeave(staffId) {
  const s = Q.staffM(staffId);
  modal('Record leave', s.name + ' · ' + (s.leaveEntitlement - Q.leaveTaken(staffId)) + ' days left',
    '<div class="fg"><label>Type</label><select id="lvType"><option>Annual</option><option>Sick</option><option>Compassionate</option><option>Study</option></select></div>' +
    '<div class="f2"><div class="fg"><label>From</label><input type="date" id="lvFrom" value="' + iso(DB.today) + '"></div>' +
    '<div class="fg"><label>To</label><input type="date" id="lvTo" value="' + iso(DB.today) + '"></div></div>' +
    '<div class="fg"><label>Note</label><input id="lvNote" placeholder="Optional"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doLeave(' + staffId + ')">Record leave</button>');
}
function doLeave(staffId) {
  const f = document.getElementById('lvFrom').value, t = document.getElementById('lvTo').value;
  const days = Math.max(1, Math.round((new Date(t) - new Date(f)) / DAY) + 1);
  DB.leave.push({
    id: Date.now(), staffId, type: document.getElementById('lvType').value,
    from: f, to: t, days, status: 'approved', note: document.getElementById('lvNote').value || '—'
  });
  toast(days + ' day' + (days === 1 ? '' : 's') + ' of leave recorded');
  closeModal(); render();
}

/* ---------------- announcements ---------------- */
function formAnnouncement(id) {
  const a = id ? DB.announcements.find(x => x.id === +id) : null;
  modal(a ? 'Edit announcement' : 'New announcement', a ? a.title : 'Tell subscribers something',
    '<div class="fg"><label>Title</label><input id="anTitle" value="' + (a ? esc(a.title) : '') + '"></div>' +
    '<div class="fg"><label>Message</label><textarea id="anBody">' + (a ? esc(a.body) : '') + '</textarea></div>' +
    '<div class="f2"><div class="fg"><label>Audience</label><select id="anAud">' +
    ['All subscribers'].concat(PLANS.filter(p => p.id !== 'trial').map(p => p.name)).concat(['Trial users', 'Past due accounts']).map(x =>
      '<option' + (a && a.audience === x ? ' selected' : '') + '>' + x + '</option>').join('') +
    '</select></div><div class="fg"><label>Channel</label><select id="anCh">' +
    ['In-app', 'Email', 'In-app + Email'].map(x => '<option' + (a && a.channel === x ? ' selected' : '') + '>' + x + '</option>').join('') +
    '</select></div></div>' +
    '<div class="f2"><div class="fg"><label>Send</label><select id="anState">' +
    '<option value="draft"' + (a && a.state === 'draft' ? ' selected' : '') + '>Save as draft</option>' +
    '<option value="scheduled"' + (a && a.state === 'scheduled' ? ' selected' : '') + '>Schedule</option>' +
    '<option value="published"' + (a && a.state === 'published' ? ' selected' : '') + '>Send now</option></select></div>' +
    '<div class="fg"><label>Date</label><input type="date" id="anDate" value="' + (a ? a.date : iso(DB.today)) + '"></div></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doAnnouncement(' + (id || 'null') + ')">' + (a ? 'Save' : 'Create') + '</button>');
}
function doAnnouncement(id) {
  const title = document.getElementById('anTitle').value.trim();
  if (!title) { toast('Give it a title'); return; }
  const state = document.getElementById('anState').value;
  const fields = {
    title, body: document.getElementById('anBody').value || '',
    audience: document.getElementById('anAud').value, channel: document.getElementById('anCh').value,
    state, date: document.getElementById('anDate').value
  };
  if (id) {
    Object.assign(DB.announcements.find(x => x.id === +id), fields);
    toast('Announcement saved');
  } else {
    DB.announcements.unshift(Object.assign({
      id: Math.max.apply(null, DB.announcements.map(a => a.id)) + 1,
      reach: state === 'published' ? Q.subsAsOf().length : 0,
      opened: 0, author: 'Kayode Ojomo'
    }, fields));
    toast(state === 'published' ? 'Sent to ' + Q.subsAsOf().length + ' subscribers' : 'Saved as ' + state);
  }
  if (state === 'published') logAction('announce', 'Announcement sent', 'Kayode Ojomo sent "' + title + '" to ' + fields.audience);
  closeModal(); render();
}
function publishAnnouncement(id) {
  const a = DB.announcements.find(x => x.id === +id);
  a.state = 'published'; a.date = iso(DB.today);
  a.reach = Q.subsAsOf().length; a.opened = 0;
  logAction('announce', 'Announcement sent', 'Kayode Ojomo sent "' + a.title + '" to ' + a.audience);
  toast('Sent to ' + a.reach + ' subscribers'); render();
}

/* ---------------- exports ---------------- */
function exportSubscribers() {
  exportCsv('subscribers',
    ['ID', 'Business', 'Owner', 'Email', 'Phone', 'City', 'Plan', 'Cycle', 'Status', 'Health', 'Users', 'Seats', 'Joined', 'Renews', 'MRR', 'Referrals', 'Commission'],
    Q.subsAsOf().map(s => ['TLB-S' + String(s.id).padStart(4, '0'), s.name, s.owner, s.email, s.phone, s.city,
      s.planName, s.cycle, s.status, s.health, s.users, s.seats, s.joined, s.renewsOn, s.mrr, s.referralConverted, s.referralEarned]));
}
function exportPayments() {
  exportCsv('payments', ['Date', 'Subscriber', 'Reference', 'Invoice', 'Amount', 'Provider', 'Method', 'Status', 'Plan', 'Cycle'],
    DB.payments.filter(p => inPeriod(p.date)).map(p => [p.date, p.subscriber, p.ref, p.invoice, p.amount, p.provider, p.method, p.status, p.plan, p.cycle]));
}
function exportPayroll() {
  const key = UI.payMonth || DB.payrollRuns[0].monthKey;
  exportCsv('payroll-' + key,
    ['Staff', 'Department', 'Basic', 'Housing', 'Transport', 'Bonus', 'Overtime', 'Gross', 'PAYE', 'Pension', 'NHF', 'Loan', 'Deductions', 'Net', 'Status', 'Published'],
    Q.slipsFor(key).map(s => [s.staffName, s.dept, s.basic, s.housing, s.transport, s.bonus, s.overtime, s.gross, s.paye, s.pension, s.nhf, s.loan, s.deductions, s.net, s.status, s.uploaded ? 'yes' : 'no']));
}
function exportStaff() {
  exportCsv('staff', ['Staff ID', 'Name', 'Department', 'Title', 'Role', 'Email', 'Phone', 'Start date', 'Basic', 'Gross', 'Attendance 30d', 'Status'],
    DB.staff.map(s => [s.staffId, s.name, s.dept, s.title, (Q.role(s.roleId) || {}).name, s.email, s.phone, s.startDate,
      s.basic, s.basic + s.housing + s.transport, Q.attRate(s.id) + '%', s.status]));
}
function exportActivity() {
  exportCsv('audit-log', ['When', 'Action', 'Detail', 'Who', 'Role', 'IP', 'Device', 'Reason'],
    DB.activity.map(a => [a.at, a.action, a.detail, a.actor, a.actorRole, a.ip, a.device, a.reason]));
}
function exportOnboarding() {
  exportCsv('onboarding', ['Business', 'Owner', 'Email', 'City', 'Channel', 'Signed up', 'Trial ends in', 'Step', 'Progress', 'State'],
    DB.onboarding.map(o => [o.name, o.owner, o.email, o.city, o.channel, o.joined, o.trialEndsIn, o.step + '/6', o.progress + '%', o.state]));
}
function exportFeedback() {
  exportCsv('feedback', ['Title', 'Type', 'Subscriber', 'Plan', 'Votes', 'Rating', 'State', 'Date', 'Body'],
    DB.feedback.map(f => [f.title, f.kind, f.subscriber, f.plan, f.votes, f.rating || '', f.state, f.at, f.body]));
}
function exportRisk() {
  exportCsv('at-risk-accounts', ['Business', 'Owner', 'Plan', 'Status', 'Past due', 'Orders 30d', 'Last seen', 'MRR'],
    Q.atRisk().map(s => [s.name, s.owner, s.planName, s.status, s.pastDue ? 'yes' : 'no', s.ordersLast30, s.lastSeen, s.mrr]));
}

/* ---------------- example data ----------------
   The console ships empty. This is the only way the invented set appears, and
   it is reversible, which is why nothing needs a banner apologising for it. */
function formLoadExample() {
  const already = DB.demoData;
  modal('Load example data', already ? 'Replaces what is loaded now' : 'Fills every page with an invented dataset',
    '<p class="note">This loads a complete made-up business so every page has something to show: ' +
    '<b>128 subscribers</b> across four plans, roughly three years of payments, a team of <b>sixteen</b> with ' +
    'payroll, payslips and attendance, plus support tickets, feature requests and an audit trail.</p>' +
    '<p class="note" style="margin-top:10px">None of it is real. Nothing bills, emails or pays anyone. ' +
    'While it is loaded, a small <span class="demo" style="margin:0">Demo data</span> tag sits next to the page ' +
    'title so nobody mistakes it for the real thing.</p>' +
    (already ? '<p class="hint">Reloading rebuilds the set from scratch, discarding any edits you made to it.</p>'
      : '<p class="hint">Your own account, the plan catalogue, the roles and your settings are kept either way.</p>'),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doLoadExample()">' + (already ? 'Reload it' : 'Load it') + '</button>');
}
function doLoadExample() {
  loadExampleData();
  UI.detail = null; UI.page = 'dashboard';
  UI.filters.subscribers = 'all'; UI.planFilter = 'any';
  UI.payMonth = null;
  Object.keys(UI.q).forEach(k => { UI.q[k] = ''; });
  logAction('export', 'Example data loaded',
    'Kayode Ojomo loaded the example dataset — ' + DB.subscribers.length + ' subscribers and ' +
    DB.staff.length + ' staff');
  closeModal();
  toast('Example data loaded · ' + DB.subscribers.length + ' subscribers');
  render();
}
function formClearData() {
  modal('Clear all data', 'Back to an empty console',
    '<p class="note">Removes the ' + DB.subscribers.length + ' subscribers, ' + DB.staff.length +
    ' staff records, ' + DB.payments.length.toLocaleString() + ' payments and everything else that came with the ' +
    'example set.</p>' +
    '<div class="pnl" style="background:var(--panel-2);margin-top:12px">' +
    '<div class="ph"><h3 style="font-size:13px">What is kept</h3></div>' +
    '<div class="kv"><span class="k">Your owner account</span><span class="v">Kept</span></div>' +
    '<div class="kv"><span class="k">Plan catalogue</span><span class="v">Kept</span></div>' +
    '<div class="kv"><span class="k">Roles &amp; permissions</span><span class="v">Kept</span></div>' +
    '<div class="kv"><span class="k">Platform settings</span><span class="v">Kept</span></div>' +
    '<div class="kv"><span class="k">Everything else</span><span class="v" style="color:var(--red)">Removed</span></div>' +
    '</div>' +
    '<p class="hint">You can load the example set again whenever you like — it is generated, not stored.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn danger" onclick="doClearData()">Clear the data</button>');
}
function doClearData() {
  const n = DB.subscribers.length;
  clearAllData();
  UI.detail = null; UI.page = 'dashboard';
  UI.filters.subscribers = 'all'; UI.planFilter = 'any';
  UI.payMonth = null; UI.staffTab = 'team'; UI.billingTab = 'plans';
  Object.keys(UI.q).forEach(k => { UI.q[k] = ''; });
  closeModal();
  toast('Cleared · ' + n + ' subscribers removed');
  render();
}
