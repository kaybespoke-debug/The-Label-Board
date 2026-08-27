/* ============================================================
   actions.js — every button does something: copying, sharing,
   links, payout accounts, preferences, exports
   ============================================================ */

/* ---------------- search ---------------- */
function searchBox(page, placeholder) {
  const v = UI.q[page] || '';
  return '<input class="srch" value="' + esc(v) + '" placeholder="' + placeholder +
    '" oninput="UI.q[\'' + page + '\']=this.value;renderDebounced()">';
}
let rdT;
function renderDebounced() { clearTimeout(rdT); rdT = setTimeout(render, 220); }
function matches(q, fields) {
  if (!q) return true;
  const s = q.toLowerCase();
  return fields.some(f => String(f == null ? '' : f).toLowerCase().includes(s));
}

/* ---------------- theme ---------------- */
function setTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  try { localStorage.setItem('tlb_partner_theme', t); } catch (e) {}
  render();
}
function toggleTheme() { setTheme(document.body.classList.contains('light') ? 'dark' : 'light'); }

/* ---------------- copying ----------------
   The clipboard API needs a secure context and can still be refused, so there
   is always the old textarea route behind it. A copy button that silently does
   nothing is worse than no copy button. */
function copyText(text, btn) {
  const done = () => {
    toast('Copied');
    if (btn) {
      const old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = old; }, 1600);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
  } else {
    legacyCopy(text, done);
  }
}
function legacyCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const okd = document.execCommand('copy');
    document.body.removeChild(ta);
    if (okd) { done(); return; }
  } catch (e) { /* fall through */ }
  modal('Copy this', 'Your browser would not let the button do it for you',
    '<div class="fg"><textarea id="cpBox" rows="3">' + esc(text) + '</textarea></div>',
    '<button class="btn gold" onclick="closeModal()">Done</button>');
  setTimeout(() => { const b = document.getElementById('cpBox'); if (b) b.select(); }, 60);
}

/* ---------------- sharing ---------------- */
function shareMessage(link) {
  return 'I use The Label Board to run ' + DB.me.business +
    '. Orders, fittings, payments and staff all on one board, and it works without signal. ' +
    'Two weeks free, no card: ' + link.url;
}
function shareWhatsApp(linkId) {
  const l = Q.link(linkId);
  if (!l) return;
  window.open('https://wa.me/?text=' + encodeURIComponent(shareMessage(l)), '_blank', 'noopener');
}
function shareNative(linkId) {
  const l = Q.link(linkId);
  if (!l) return;
  if (navigator.share) navigator.share({ title: 'The Label Board', text: shareMessage(l), url: l.url }).catch(() => {});
  else copyText(shareMessage(l));
}
function copyTemplate(i, linkId, btn) {
  const t = TEMPLATES(Q.link(linkId))[i];
  if (t) copyText(t[1], btn);
}
/* A message about one specific business. The partner picks the contact in
   WhatsApp; we never hold a referred owner's number. */
function nudge(refId) {
  const r = Q.ref(refId);
  if (!r) return;
  const msg = r.stage === 'trial'
    ? 'Hi, how are you getting on with The Label Board? Happy to sit with you for twenty minutes and set your board up properly before the trial runs out.'
    : 'Hi, I saw you opened an account on The Label Board but have not started yet. Want me to walk you through it? It takes about twenty minutes. ' + Q.linkFor(r).url;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
}
function messageManager() {
  const digits = DB.me.manager.phone.replace(/[^0-9]/g, '');
  const msg = 'Hi ' + DB.me.manager.name.split(' ')[0] + ', this is ' + DB.me.name +
    ' (' + DB.me.id + ') from ' + DB.me.business + '. ';
  window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
}
function emailManager() {
  window.location.href = 'mailto:' + DB.me.manager.email +
    '?subject=' + encodeURIComponent('Partner ' + DB.me.id + ' · ' + DB.me.name);
}

/* ---------------- referral links ---------------- */
function formNewLink() {
  modal('New link', 'Name it for where you will use it',
    '<div class="fg"><label>Where will you use it</label>' +
    '<input id="nlLabel" placeholder="e.g. TikTok bio"></div>' +
    '<div class="fg"><label>Code ending</label>' +
    '<input id="nlCode" placeholder="e.g. TIKTOK" maxlength="16">' +
    '<div class="hint">Your link becomes ' + CONFIG.joinUrl + DB.links[0].code + '-YOURENDING. ' +
    'Leave it blank and we will make one from the name.</div></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doNewLink()">Create</button>');
}
function doNewLink() {
  const label = document.getElementById('nlLabel').value.trim();
  if (!label) { toast('Give the link a name'); return; }
  const base = DB.links[0].code;
  let suffix = document.getElementById('nlCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!suffix) suffix = label.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!suffix) { toast('That name has no letters we can use, add a code ending'); return; }
  const code = base + '-' + suffix;
  if (DB.links.some(l => l.code === code)) { toast('You already have a link ending ' + suffix); return; }

  DB.links.push({
    id: Math.max.apply(null, DB.links.map(l => l.id)) + 1,
    label, code, url: CONFIG.joinUrl + code,
    clicks: 0, signups: 0, converted: 0, earned: 0,
    active: true, isDefault: false, custom: true,
    note: 'Made in the portal on ' + fmtD(DB.today),
    createdOn: iso(DB.today)
  });
  saveLinks();
  closeModal();
  toast(label + ' is ready');
  render();
}
function linkMenu(id) {
  const l = Q.link(id);
  if (!l) return;
  modal(esc(l.label), l.clicks + ' opened · ' + plural(l.signups, 'signup') +
    (l.earned ? ' · ' + money(l.earned) + ' earned' : ''),
    '<div class="fg"><label>Link</label>' +
    '<div class="copyfld"><input value="' + esc(l.url) + '" readonly aria-label="Referral link">' +
    '<button onclick="copyText(\'' + esc(l.url) + '\',this)">Copy</button></div></div>' +
    '<div class="fg"><label>Code</label>' +
    '<div class="copyfld"><input value="' + esc(l.code) + '" readonly aria-label="Referral code">' +
    '<button onclick="copyText(\'' + esc(l.code) + '\',this)">Copy</button></div>' +
    '<div class="hint">Someone can type the code instead of using the link and it still tracks to you.</div></div>',

    '<button class="btn" onclick="shareNative(' + l.id + ')">Share</button>' +
    (l.isDefault ? '' : '<button class="btn" onclick="toggleLink(' + l.id + ')">' + (l.active ? 'Pause' : 'Turn on') + '</button>') +
    (l.custom ? '<button class="btn danger" onclick="removeLink(' + l.id + ')">Delete</button>' : '') +
    '<button class="btn gold" onclick="closeModal()">Done</button>');
}
function toggleLink(id) {
  const l = Q.link(id);
  l.active = !l.active;
  if (l.custom) saveLinks();
  closeModal();
  toast(l.label + (l.active ? ' is live again' : ' is paused'));
  render();
}
function removeLink(id) {
  const l = Q.link(id);
  if (!l || !l.custom) { toast('That link cannot be deleted'); return; }
  if (l.signups) {
    modal('Keep this link', 'It has people attached to it',
      '<p class="note">' + esc(l.label) + ' brought in ' + plural(l.signups, 'signup') +
      '. Deleting it would leave those referrals pointing at nothing. Pause it instead and it stops working for ' +
      'anyone new, while everything it already brought in stays where it is.</p>',
      '<button class="btn" onclick="closeModal()">Leave it</button>' +
      '<button class="btn gold" onclick="toggleLink(' + id + ')">Pause instead</button>');
    return;
  }
  DB.links = DB.links.filter(x => x.id !== id);
  saveLinks();
  closeModal();
  toast('Deleted');
  render();
}

/* ---------------- payout accounts ---------------- */
const BANKS = ['Guaranty Trust Bank', 'Access Bank', 'Zenith Bank', 'First Bank of Nigeria', 'United Bank for Africa',
  'Kuda Microfinance Bank', 'Sterling Bank', 'Fidelity Bank', 'Stanbic IBTC', 'Union Bank', 'Wema Bank', 'Opay', 'Moniepoint'];

function accountForm(a) {
  a = a || {};
  return '<div class="fg"><label>Account name</label>' +
    '<input id="acName" value="' + esc(a.accountName || '') + '" placeholder="Exactly as your bank has it">' +
    '<div class="hint">This has to match the name on the account or the transfer bounces.</div></div>' +
    '<div class="fg"><label>Bank</label><select id="acBank">' +
    BANKS.map(b => '<option' + (a.bankName === b ? ' selected' : '') + '>' + b + '</option>').join('') +
    '</select></div>' +
    '<div class="fg"><label>Account number</label>' +
    '<input id="acNum" value="' + esc(a.accountNumber || '') + '" inputmode="numeric" maxlength="10" placeholder="10 digits"></div>';
}
function formAddAccount() {
  modal('Add a payout account', 'Where your commission should land',
    accountForm(null) +
    '<p class="hint">We check the name against the account before the first payout. Until that clears, payouts keep ' +
    'going to whichever account is already marked primary.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doAddAccount()">Add</button>');
}
function readAccountForm() {
  const name = document.getElementById('acName').value.trim();
  const bank = document.getElementById('acBank').value;
  const num = document.getElementById('acNum').value.replace(/[^0-9]/g, '');
  if (!name) { toast('The account name is needed'); return null; }
  if (num.length !== 10) { toast('A Nigerian account number is 10 digits'); return null; }
  return { accountName: name, bankName: bank, accountNumber: num };
}
function doAddAccount() {
  const v = readAccountForm();
  if (!v) return;
  if (DB.accounts.some(a => a.accountNumber === v.accountNumber && a.bankName === v.bankName)) {
    toast('That account is already here'); return;
  }
  DB.accounts.push({
    id: DB.accounts.length ? Math.max.apply(null, DB.accounts.map(a => a.id)) + 1 : 1,
    type: 'bank',
    primary: DB.accounts.length === 0,     // the first one has to be primary
    verified: false,
    accountName: v.accountName, bankName: v.bankName, accountNumber: v.accountNumber,
    currency: 'NGN',
    addedOn: iso(DB.today), verifiedOn: null
  });
  saveAccounts();
  closeModal();
  toast('Added, we will check the name');
  render();
}
function formEditAccount(id) {
  const a = Q.account(id);
  if (!a) return;
  modal('Edit account', a.primary ? 'This is where your payouts go' : 'A backup account',
    accountForm(a) + '<p class="hint">Changing the number or the bank sends it back for checking.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doEditAccount(' + id + ')">Save</button>');
}
function doEditAccount(id) {
  const a = Q.account(id);
  const v = readAccountForm();
  if (!a || !v) return;
  const changed = a.accountNumber !== v.accountNumber || a.bankName !== v.bankName;
  a.accountName = v.accountName; a.bankName = v.bankName; a.accountNumber = v.accountNumber;
  if (changed) { a.verified = false; a.verifiedOn = null; }
  saveAccounts();
  closeModal();
  toast(changed ? 'Saved, we will check it again' : 'Saved');
  render();
}
function makePrimary(id) {
  DB.accounts.forEach(a => { a.primary = a.id === +id; });
  saveAccounts();
  const a = Q.account(id);
  toast('Payouts now go to ' + a.bankName + ' ' + a.accountNumber.slice(-4));
  render();
}
function formRemoveAccount(id) {
  const a = Q.account(id);
  if (!a) return;
  const isLast = DB.accounts.length === 1;
  modal('Remove this account', esc(a.bankName) + ' · ' + esc(a.accountNumber),
    '<p class="note">' + (isLast
      ? 'This is your only payout account. Remove it and there is nowhere to send your commission, so the next run is held until you add one.'
      : a.primary
        ? 'This is the account payouts currently go to. Remove it and the other account becomes primary.'
        : 'Payouts do not go here, so removing it changes nothing about your next run.') +
    '<br><br>Payouts already sent keep showing this account on their statement.</p>',
    '<button class="btn" onclick="closeModal()">Keep it</button>' +
    '<button class="btn danger" onclick="doRemoveAccount(' + id + ')">Remove</button>');
}
function doRemoveAccount(id) {
  const wasPrimary = (Q.account(id) || {}).primary;
  DB.accounts = DB.accounts.filter(a => a.id !== +id);
  if (wasPrimary && DB.accounts.length) DB.accounts[0].primary = true;
  saveAccounts();
  closeModal();
  toast('Removed');
  render();
}

/* ---------------- preferences ---------------- */
function toggleNotify(key) {
  DB.settings.notify[key] = !DB.settings.notify[key];
  saveSettings();
  render();
}
function editProfile(key, label) {
  modal('Edit ' + label.toLowerCase(), '',
    '<div class="fg"><label>' + label + '</label><input id="pfv" value="' + esc(DB.me[key]) + '"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn gold" onclick="doProfile(\'' + key + '\')">Save</button>');
}
function doProfile(key) {
  const v = document.getElementById('pfv').value.trim();
  if (!v) { toast('That cannot be empty'); return; }
  DB.me[key] = v;
  closeModal(); toast('Saved'); render();
}

/* ---------------- updates ---------------- */
function markRead(id) {
  if (DB.settings.readUpdates.indexOf(+id) < 0) {
    DB.settings.readUpdates.push(+id);
    saveSettings();
  }
}
function markAllRead() {
  DB.settings.readUpdates = DB.updates.map(u => u.id);
  saveSettings();
  toast('All marked read');
  render();
}

/* ---------------- exports ---------------- */
function exportEarnings() {
  exportCsv('partner-earnings',
    ['Credited', 'Type', 'Business', 'Detail', 'Rate %', 'Basis', 'Amount', 'Status', 'Clears', 'Payout'],
    DB.ledger.map(r => [r.date, r.type, r.business || '', r.note, r.rate || '', r.basis || '',
      r.amount, r.status, r.clearsOn, r.payoutRef || '']));
}
function exportReferrals() {
  exportCsv('partner-referrals',
    ['Business', 'Owner', 'City', 'Stage', 'Plan', 'Cycle', 'Link', 'Code', 'Signed up', 'Started paying',
      'Stopped', 'Outlets', 'Staff', 'Earned you'],
    DB.referrals.map(r => {
      const l = Q.linkFor(r);
      return [r.business, r.owner, r.city, r.stage, r.planName, r.cycle, l.label, l.code,
        r.signedUpOn, r.subscribedOn || '', r.lapsedOn || '', r.outlets, r.staff, Q.earnedFor(r.id)];
    }));
}

/* A statement a partner can file, or send to whoever does their books. */
function downloadStatement(ref) {
  const p = Q.payout(ref);
  if (!p) return;
  const acct = Q.account(p.accountId);
  const items = Q.payoutItems(ref);
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  const lines = [
    'THE LABEL BOARD — PARTNER PAYOUT STATEMENT',
    '',
    'Payout          ' + p.ref,
    'Sent            ' + fmtD(p.paidOn),
    'Method          ' + p.method,
    'Bank reference  ' + p.bankRef,
    '',
    'Partner         ' + DB.me.name + ' (' + DB.me.id + ')',
    'Business        ' + DB.me.business,
    'Tax ID          ' + DB.me.taxId,
    '',
    'Paid into       ' + (acct ? acct.accountName : 'account since removed'),
    '                ' + (acct ? acct.bankName + ' · ' + acct.accountNumber : ''),
    '',
    'ITEMS',
    pad('Credited', 14) + pad('What earned it', 34) + pad('Rate', 7) + 'Amount',
    '-'.repeat(70)
  ];
  items.forEach(r => {
    lines.push(pad(r.date, 14) + pad(r.type === 'bonus' ? 'Milestone bonus' : r.business, 34) +
      pad(r.rate ? r.rate + '%' : '-', 7) + money(r.amount));
  });
  lines.push('-'.repeat(70));
  lines.push(pad('', 55) + 'TOTAL  ' + money(p.amount));
  lines.push('');
  lines.push('Commission is ' + DB.settings.baseRatePct + '% or more of a referred account\'s first payment,');
  lines.push('cleared ' + DB.settings.holdDays + ' days after that payment and paid on the ' +
    DB.settings.payoutDay + 'th of the month.');
  lines.push('Questions: ' + DB.me.manager.email);

  download('statement-' + p.ref + '.txt', lines.join('\n'));
  toast('Statement downloaded');
}

/* ---------------- start again ---------------- */
function resetLocal() {
  modal('Reset this browser', 'Only what you changed here',
    '<p class="note">Clears the extra links you made, any payout account changes and your preferences from this ' +
    'browser, then reloads. Your referrals, earnings and payouts are not touched.</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn danger" onclick="doResetLocal()">Reset</button>');
}
function doResetLocal() {
  /* Only this partner's own local changes. Signing out is a separate button,
     because "reset" and "log me out of everything" are different intentions
     and merging them surprises people. */
  clearPartnerStorage(DB.key);
  location.reload();
}
