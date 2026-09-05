// Client history gate — "what happened with this person?"
//
// Four things were asked of this app and only some of them were true:
//
//   1. Order stages record who handled them, and comments can be left under
//      each. This ALREADY worked. It is checked here anyway, by posting a real
//      update through the same path the button uses and reading it back off
//      the order, because "it already works" is a claim and not a test, and
//      the two attributions it keeps are easy to lose in a refactor: `by` is
//      who typed it, `worker` is who did the work, and they are frequently
//      different people.
//
//   2. Past orders. There is no archive and nothing prunes, which is the right
//      answer, but only as long as nothing starts filtering finished work out
//      of a client's record. So a DELIVERED order must still be in the client's
//      order history, and its comments must still be readable.
//
//   3. Measurements now say where they came from: who held the tape, and
//      whether it was in the studio, over a video call, or numbers the client
//      sent. The last one is the reason the question is worth asking — it is
//      flagged as unverified, on screen and on the printed sheet, because it
//      changes what a workroom should do before cutting.
//
//   4. Correspondence. One place holding notes, order comments, measurements,
//      payments and appointments for a client. The hard rule is that it READS
//      those and stores nothing: the moment it keeps its own copy, the copy
//      starts disagreeing with the order it came from, and a client record
//      that contradicts itself is worse than one that is merely scattered.
//      So the strongest check here is a deletion — remove a note at its source
//      and it must vanish from correspondence, because there was never a
//      second one to leave behind.
'use strict';
const fs = require('fs'), vm = require('vm');
const appPath = process.argv[2] || 'site/layi_dashboard.html';
const html = fs.readFileSync(appPath, 'utf8');
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = re.exec(html))) {
  const a = m[1] || '';
  if (/\bsrc\s*=/.test(a)) continue;
  const t = a.match(/type\s*=\s*["']([^"']+)["']/i);
  if (t && !/javascript|module/i.test(t[1])) continue;
  code += '\n;' + m[2] + '\n';
}
const cache = {}, _ls = {};
const mkEl = id => ({ _id: id, innerHTML: '', value: '', checked: false, textContent: '', placeholder: '', style: {}, dataset: {}, options: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false } }, setAttribute() {}, getAttribute() { return null }, appendChild(c) { return c }, addEventListener() {}, removeEventListener() {}, querySelector() { return null }, querySelectorAll() { return [] }, focus() {} });
let alerts = [];
const sb = { console, document: { getElementById(i) { return cache[i] || (cache[i] = mkEl(i)) }, querySelector() { return mkEl() }, querySelectorAll() { return [] }, createElement() { return mkEl() }, addEventListener() {}, removeEventListener() {}, body: mkEl(), documentElement: mkEl(), head: mkEl() }, localStorage: { getItem(k) { return k in _ls ? _ls[k] : null }, setItem(k, v) { _ls[k] = String(v) }, removeItem(k) { delete _ls[k] } }, setTimeout: f => { try { f && f() } catch (e) {} }, clearTimeout() {}, requestAnimationFrame: f => { try { f && f() } catch (e) {} }, navigator: { userAgent: 'n' }, location: { href: '' }, alert(m) { alerts.push(String(m)); }, confirm() { return true }, prompt() { return '2'; }, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Intl };
sb.window = sb; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(code, sb, { filename: 'x' });
sb.demoLogin();
const run = e => vm.runInContext(e, sb);
const set = (id, v) => run("document.getElementById(" + JSON.stringify(id) + ").value=" + JSON.stringify(String(v)) + ";");
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");

let fails = [], checks = 0;
const F = x => fails.push(x);
const ok = (cond, msg) => { checks++; if (!cond) F(msg); };

/* The set of storage keys BEFORE correspondence has ever been called. Taken
   here, at the top, and not next to the check that uses it: the first version
   of that check snapshotted immediately before one more call, which meant a
   cache written by an EARLIER call was already in the snapshot and the two
   sides matched. It passed against a version that really was caching, which is
   the exact failure mode a gate exists to prevent. */
const KEYS_BEFORE_ANY_CORRESPONDENCE = Object.keys(_ls).sort().join('|');

/* A client with orders to work on. */
const KEY = run("(function(){var d=buildCustomerData().filter(function(c){return c.orders.length>1;});return d.length?d[0].key:'';})()");
if (!KEY) F('no client in the example data has more than one order, so none of this can be tested');
const ORDER = run("buildCustomerData().find(c=>c.key===" + JSON.stringify(KEY) + ").orders[0].id");

/* ---- 1. stage updates: the comment, and both attributions ---------------- */
{
  const staffId = run("getStaff().filter(s=>s.active!==false)[0].id");
  const staffNm = run("staffName(" + JSON.stringify(staffId) + ")");
  const before = run("getOrders().find(o=>o.id===" + JSON.stringify(ORDER) + ").updates.length");

  run("openUpdate(" + JSON.stringify(ORDER) + ");");
  ok(run("!!updateDraft"), 'the update modal cannot be opened on an order');
  set('u_note', 'Waist taken in 2cm at first fitting');
  set('u_worker', staffId);
  set('u_stage', run("String(updateDraft.stage)"));
  run("saveUpdate();");

  const u = run("(function(){var o=getOrders().find(o=>o.id===" + JSON.stringify(ORDER) + ");return o.updates[o.updates.length-1];})()");
  ok(run("getOrders().find(o=>o.id===" + JSON.stringify(ORDER) + ").updates.length") === before + 1,
    'posting an update did not add one to the order');
  ok(u && u.note === 'Waist taken in 2cm at first fitting', 'the comment left on a stage update was not saved');
  ok(!!(u && u.stage), 'a stage update does not record which stage it was posted at');
  ok(!!(u && u.by), 'a stage update does not record who posted it');
  ok(u && u.worker === staffNm, 'a stage update does not record who did the work (' + (u && u.worker) + ')');
  ok(!!(u && u.at), 'a stage update is not timestamped, so it cannot be placed in a history');
  // by and worker are different questions and must stay separate fields
  ok(run("(function(){var o=getOrders().find(o=>o.id===" + JSON.stringify(ORDER) + ");var u=o.updates[o.updates.length-1];return u.by!==u.worker;})()"),
    'who typed the update and who did the work collapsed into one value, so a CRE posting for a tailor credits the wrong person');

  // and it is readable where somebody would look for it
  run("closeModal();openDetail(" + JSON.stringify(ORDER) + ");");
  const det = run("(document.getElementById('modal')||{}).innerHTML") || '';
  ok(/Waist taken in 2cm/.test(det), 'the comment is stored but never shown on the order');
  ok(det.indexOf(staffNm) >= 0, 'the order does not show who did the work');
}

/* ---- 2. past orders are still the client's ------------------------------- */
{
  // deliver it outright, the way the app does
  run("(function(){var l=rawOrders();var o=l.find(x=>x.id===" + JSON.stringify(ORDER) + ");o.stageIndex=STAGES.indexOf('Delivered');o.deliveredAt=new Date().toISOString();save('layi_dash_orders',l);})();");
  const inList = run("getOrders().some(o=>o.id===" + JSON.stringify(ORDER) + ")");
  ok(inList, 'a delivered order disappeared from getOrders(), so a studio loses its own trading history');
  const inCust = run("(buildCustomerData().find(c=>c.key===" + JSON.stringify(KEY) + ")||{orders:[]}).orders.some(o=>o.id===" + JSON.stringify(ORDER) + ")");
  ok(inCust, 'a delivered order is no longer in the client\'s order history');
  run("closeModal();openCustomer(" + JSON.stringify(KEY) + ");");
  const prof = run("(document.getElementById('modal')||{}).innerHTML") || '';
  ok(/Order history \(/.test(prof), 'the client profile has no order history section');
  const shown = run("(buildCustomerData().find(c=>c.key===" + JSON.stringify(KEY) + ")||{orders:[]}).orders.length");
  ok(new RegExp('Order history \\(' + shown + '\\)').test(prof),
    'the client profile counts a different number of orders from the one it holds');
  ok(prof.indexOf(ORDER) >= 0, 'a past order is not listed in the client profile');
  // its comments survive delivery
  ok(run("getOrders().find(o=>o.id===" + JSON.stringify(ORDER) + ").updates.length") > 0,
    'delivering an order cleared the comments left on it');
}

/* ---- 3. measurement provenance ------------------------------------------ */
{
  ok(run("Array.isArray(MEAS_SOURCES)&&MEAS_SOURCES.length>=4"), 'there are not enough answers to "how was this measured"');
  ok(run("MEAS_SOURCES.some(s=>s.k==='studio')"), 'a measurement cannot be recorded as taken in the studio');
  ok(run("MEAS_SOURCES.some(s=>s.k==='video')"), 'a measurement cannot be recorded as taken over a video call');
  ok(run("MEAS_SOURCES.some(s=>s.k==='client'&&s.unverified)"),
    'numbers the client sent are not marked unverified, which is the whole reason for asking');

  run("closeModal();openMeasRecord(" + JSON.stringify(KEY) + ");");
  const form = run("(document.getElementById('modal')||{}).innerHTML") || '';
  ok(/id="mr_source"/.test(form), 'the measurement form never asks how the measurement was taken');
  ok(/id="mr_takenBy"/.test(form), 'the measurement form never asks who took it');
  ok(/id="mr_date"/.test(form), 'the measurement form never asks when it was taken');

  const who = run("getStaff().filter(s=>s.active!==false)[0].name");
  set('mr_source', 'client'); set('mr_takenBy', who);
  set('mr_date', new Date().toISOString().slice(0, 10));
  set('mr_fit', ''); set('mr_posture', ''); set('mr_note', 'Sent over WhatsApp');
  run("saveMeasRecord(" + JSON.stringify(KEY) + ",'');");

  const rec = run("latestMeasOf(" + JSON.stringify(KEY) + ")");
  ok(rec && rec.source === 'client', 'how the measurement was taken was not saved');
  ok(rec && rec.takenBy === who, 'who took the measurement was not saved');
  ok(!!(rec && rec.recordedBy), 'who entered the measurement was not saved, so the two can never be told apart');
  const prov = run("measProvenance(latestMeasOf(" + JSON.stringify(KEY) + "))");
  ok(/not verified by us/.test(prov), 'a client-supplied measurement does not say it is unverified');
  ok(prov.indexOf(who) >= 0, 'the provenance line does not name who took it');
  // a record from before the question existed says nothing rather than guessing
  ok(run("measProvenance({at:'2020-01-01T00:00:00.000Z',meas:{}})") === '',
    'an older measurement is given a provenance it never had');

  // the workroom sees the warning on the sheet it actually cuts from
  const sheet = run("measSheetInner(" + JSON.stringify(KEY) + ")");
  ok(/supplied by the client/.test(sheet), 'the printed measurement sheet does not warn that the numbers are the client\'s own');
  ok(sheet.indexOf(who) >= 0, 'the printed measurement sheet does not say who took the measurements');
}

/* ---- 4. correspondence: a view, never a second copy ---------------------- */
{
  run("closeModal();");
  const data = "buildCustomerData().find(c=>c.key===" + JSON.stringify(KEY) + ")";
  const kinds = () => run("[...new Set(correspondenceOf(" + JSON.stringify(KEY) + "," + data + ").map(e=>e.kind))].sort()");

  // add a note so every source is represented
  set('cn_type', 'Call'); set('cn_text', 'Rang about the collar');
  run("saveCustomerNote(" + JSON.stringify(KEY) + ");");

  const k = kinds();
  ['note', 'update', 'order', 'meas'].forEach(want =>
    ok(k.indexOf(want) >= 0, 'correspondence never shows "' + want + '" entries (found: ' + k.join(', ') + ')'));

  const ev = run("correspondenceOf(" + JSON.stringify(KEY) + "," + data + ")");
  ok(ev.length > 3, 'correspondence found almost nothing for a client with orders, notes and measurements');
  ok(ev.every(e => !!e.at), 'a correspondence entry has no date, so it cannot be placed in the timeline');
  // newest first, with no exceptions — a single unsorted source ruins the answer
  ok(ev.every((e, i) => i === 0 || String(ev[i - 1].at) >= String(e.at)),
    'correspondence is not in date order, so the last thing that happened is not at the top');
  ok(ev.some(e => e.kind === 'update' && /Waist taken in 2cm/.test(e.text || '')),
    'a comment posted on an order never reaches the client\'s correspondence, which is the whole point of it');
  ok(ev.some(e => e.kind === 'update' && e.orderId),
    'an order comment in correspondence does not say which order it belongs to');
  ok(ev.some(e => e.kind === 'note' && /Rang about the collar/.test(e.text || '')),
    'a logged call never reaches correspondence');

  /* THE rule: it reads, it does not store. Deleting at the source deletes here. */
  const noteCount = () => run("correspondenceOf(" + JSON.stringify(KEY) + "," + data + ").filter(e=>e.kind==='note').length");
  const had = noteCount();
  ok(had > 0, 'the note that was just logged is not in correspondence');
  run("(function(){var c=getCustomers();c[" + JSON.stringify(KEY) + "].log=[];setCustomers(c);})();");
  ok(noteCount() === 0,
    'deleting a note at its source left it in correspondence, so correspondence is keeping its own copy and will drift');

  /* And it writes nothing at all — not a new key, and not a byte into an
     existing one. Read straight out of the harness's own backing store rather
     than through the page, so the page cannot answer for itself.

     Compared against the key set captured at the top of this file, before
     correspondence had ever run. A snapshot taken here would already contain
     any cache an earlier call had written, and the check would pass while the
     caching it was looking for sat in front of it. */
  {
    run("correspondenceOf(" + JSON.stringify(KEY) + "," + data + ");correspondenceHtml(" + JSON.stringify(KEY) + "," + data + ");");
    const now = Object.keys(_ls).sort().join('|');
    const added = Object.keys(_ls).filter(k => KEYS_BEFORE_ANY_CORRESPONDENCE.split('|').indexOf(k) < 0);
    ok(now === KEYS_BEFORE_ANY_CORRESPONDENCE,
      'correspondence created storage key(s) [' + added.join(', ') + '], so it is keeping a second record and not reading the first');
    // and it does not quietly grow an existing key either
    const snap = JSON.stringify(_ls);
    run("correspondenceOf(" + JSON.stringify(KEY) + "," + data + ");correspondenceHtml(" + JSON.stringify(KEY) + "," + data + ");");
    ok(JSON.stringify(_ls) === snap, 'opening correspondence changed what is stored');
  }

  // it is reachable, and it renders
  run("closeModal();openCustomer(" + JSON.stringify(KEY) + ");");
  const prof = run("(document.getElementById('modal')||{}).innerHTML") || '';
  ok(/data-pt="correspondence"/.test(prof), 'there is no Correspondence tab on the client profile');
  ok(/data-pane="correspondence"/.test(prof), 'the Correspondence tab has no pane behind it');
  ok(/Rang about the collar|Waist taken in 2cm|Measurements taken/.test(prof),
    'the Correspondence pane renders empty on a client who has a history');

  /* Money follows the role, not the tab. Somebody who may not see amounts
     still sees that a payment happened — it is part of the story — and not
     how much it was. */
  const AMT = run("(function(){var d=" + data + ";var t=getTxns().find(t=>t.dir==='in'&&t.orderId&&d.orders.some(o=>o.id===t.orderId));return t?t.amount:0;})()");
  if (AMT) {
    const withMoney = run("correspondenceOf(" + JSON.stringify(KEY) + "," + data + ").filter(e=>e.kind==='pay')");
    ok(withMoney.length > 0, 'payments against a client\'s orders never reach their correspondence');
    ok(withMoney.some(e => /[0-9]/.test(e.text || '')), 'a payment entry does not say how much, for a role that may see amounts');
    // drop to a role that cannot see money, and check that it really cannot
    run("currentUser={id:'u-t',name:'T',roleId:'tailor',staffId:''};");
    ok(run("can('money')") === false, 'the role picked to test money-hiding can see money, so the test proves nothing');
    const noMoney = run("correspondenceOf(" + JSON.stringify(KEY) + "," + data + ").filter(e=>e.kind==='pay')");
    ok(noMoney.length === withMoney.length, 'a role without money permission cannot see that a payment happened at all');
    /* Compare on the digits alone. cur() formats with thousands separators, so
       looking for "240000" in "₦240,000" finds nothing and the check passes
       while the amount is sitting there in plain sight — which is exactly what
       it did the first time this was run against an injected fault. */
    const sym = run("(CUR_SYM[SETTINGS.currency]||SETTINGS.currency)");
    const digits = s => String(s || '').replace(/[^0-9]/g, '');
    ok(noMoney.every(e => digits(e.text).indexOf(String(Math.round(AMT))) < 0),
      'a role that may not see amounts is shown the amount in correspondence');
    ok(noMoney.every(e => String(e.text || '').indexOf(sym) < 0),
      'a role that may not see amounts is shown a money figure in correspondence');
    run("currentUser=getUsers().find(u=>u.roleId==='owner');");
  }
}

console.log('Client history audit:');
console.log('  client tested : ' + KEY);
console.log('  correspondence: ' + run("[...new Set(correspondenceOf(" + JSON.stringify(KEY) + ",buildCustomerData().find(c=>c.key===" + JSON.stringify(KEY) + ")).map(e=>e.kind))].sort().join(', ')"));
if (fails.length) {
  console.log('\n✗ ' + fails.length + ' problem(s):');
  fails.forEach(x => console.log('   - ' + x));
  process.exit(1);
}
console.log('  ✓ ' + checks + ' checks: stage comments keep who typed and who worked, past orders stay');
console.log('    the client\'s, measurements say where they came from, and correspondence');
console.log('    reads every source without keeping a copy of any of them');
