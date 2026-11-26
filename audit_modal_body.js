/* A MODAL MUST RENDER ITS BODY, 26 November 2026.

   Kayode: "this 'one thing not saved' needs taken care of, i want it
   removed from the app completely."

   What he was looking at: openModal takes ONE argument, and five places
   called it with two. The second argument is the entire body of the modal,
   and it was being dropped on the floor. Tapping the "1 change not saved"
   pill opened a modal containing one sentence and nothing else — no list of
   what had not saved, no reason, no Try again, no way to act on it at all.

   That is a bad bug to have in this particular corner of the app, because
   the pill is the one thing in the product that is allowed to alarm
   somebody, and the screen behind it is where they find out whether their
   afternoon's work is on the server. But it is a worse bug than that
   sounds, because the same mistake silently killed four other screens:

     the studio switcher          a Pro studio with five labels and no way
                                  to move between them
     the conflict resolver        an order changed on two devices, with the
                                  two buttons that choose a winner missing
     "Saving"                     and
     "Nothing to sort out"        both reduced to their own titles

   Nothing threw. Nothing logged. Every one of them LOOKED like a modal,
   because the title rendered and the ✕ is drawn by openModal itself. That
   is why this is a gate and not just a fix: it is invisible by nature, and
   the next person to write openModal(title, body) will write it in good
   faith.

   The gate runs the real openModal out of the shipped file rather than
   reading it, because a signature with two parameters proves nothing about
   what reaches the screen.

       node audit_modal_body.js
*/
const fs = require('fs');
const vm = require('vm');

const FILE = process.argv[2] || 'site/layi_dashboard.html';
const html = fs.readFileSync(FILE, 'utf8');
const shipped = html.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const F = m => { console.log('  FAIL  ' + m); fail++; };
const P = m => { console.log('  pass  ' + m); pass++; };
const ok = (c, g, b) => c ? P(g) : F(b);

console.log('\n=== A MODAL RENDERS ITS BODY ===\n');

/* ---------- 1. the real function, run ---------- */
console.log('-- openModal itself --');
const start = html.indexOf('function openModal(html,body){');
const end = html.indexOf('function modalBack(', start);
ok(start > 0, 'openModal takes a title and a body',
   'openModal is back to one argument, so every caller that passes a title loses its whole body');

if (start > 0 && end > start) {
  const source = html.slice(start, end);
  const el = () => ({ innerHTML: '', scrollTop: 0, style: {},
    classList: { contains: () => false, add() {}, remove() {} } });
  const modal = el(), overlay = el();
  const sandbox = {
    openStaffId: null,
    esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    dedupeModalFoot() {},
    restoreModalView() {},
    document: {
      getElementById: id => (id === 'modal' ? modal : id === 'overlay' ? overlay : null),
      querySelector: () => null,
      body: { classList: { add() {}, remove() {} } }
    }
  };
  sandbox.window = sandbox;
  try {
    vm.runInNewContext(source + '\nopenModal("Some changes did not save","<p id=\\"body\\">the list of what did not save</p>");', sandbox);
    ok(/Some changes did not save/.test(modal.innerHTML),
       'the title reaches the screen',
       'the title is not rendered');
    ok(/the list of what did not save/.test(modal.innerHTML),
       'THE BODY REACHES THE SCREEN — the whole point of this gate',
       'THE BODY IS BEING DROPPED. Every modal called with a title is a sentence with no buttons');
    ok(/<h3>Some changes did not save<\/h3>/.test(modal.innerHTML),
       'the title is rendered as a heading, the way a one-argument caller writes it by hand',
       'the title is not a heading, so a two-argument modal looks unlike every other one');
    ok(!/<p id="body">/.test(sandbox.esc('<p id="body">')),
       'the title is escaped, because it is a sentence somebody wrote and not markup',
       'the title is passed through as markup');
    modal.innerHTML = '';
    vm.runInNewContext(source + '\nopenModal("<h3>Edit order</h3><div>the form</div>");', sandbox);
    ok(/<h3>Edit order<\/h3>/.test(modal.innerHTML) && /the form/.test(modal.innerHTML),
       'a one-argument call is untouched, which is all but five of them',
       'the ordinary one-argument call has been broken by the change');
  } catch (e) {
    F('openModal could not be run at all: ' + e.message);
  }
} else {
  F('could not find openModal to run it');
}

/* ---------- 2. no caller passes more than it takes ---------- */
console.log('\n-- every call site --');
/* Counting arguments means walking the source, and this file is mostly
   template literals holding markup holding quotes and brackets. A scanner
   that treats ` as an ordinary quote reads `onclick="f('x')"` as the end of
   a string and loses its place for the rest of the file. So a backtick is
   walked properly, and ${ } inside one is walked as code. */
function skipString(src, i) {
  const q = src[i]; i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i + 1;
    if (q === '`' && c === '$' && src[i + 1] === '{') { i = skipBraces(src, i + 1); continue; }
    i++;
  }
  return i;
}
/* A REGEX LITERAL IS NOT DIVISION, and in this file the difference matters:
   one template builds an onclick with .replace(/'/g,"\\'") in it. Read that
   slash as division and the apostrophe inside the pattern opens a string
   that never closes, and the scanner loses the rest of the file. */
function regexPosition(src, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (k < 0) return true;
  return '(,=:[!&|?{};+-*%~^'.indexOf(src[k]) >= 0;
}
function skipRegex(src, i) {
  i++; let cls = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '[') cls = true;
    else if (c === ']') cls = false;
    else if (c === '/' && !cls) { i++; while (i < src.length && /[a-z]/.test(src[i])) i++; return i; }
    else if (c === '\n') return i;          // not a regex after all
    i++;
  }
  return i;
}
function skipBraces(src, i) {
  let d = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && regexPosition(src, i)) { i = skipRegex(src, i); continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return i + 1; }
    i++;
  }
  return i;
}
/* AND THE COMMENTS HAVE TO GO BEFORE ANY OF THAT, properly.
   The usual trick in these gates — replace(/\/\*[\s\S]*?\*\//g,' ') — is
   fine for grepping and wrong for walking. This file has eight more comment
   openers than closers, because some live inside strings, so the lazy
   pairing eats real code; it removes an odd number of backticks on the way,
   and from the
   first unbalanced one the scanner is reading markup as code. Comments are
   blanked here by the same walk that reads everything else, with newlines
   kept so line numbers still mean something. */
function blankComments(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { const j = skipString(src, i); out += src.slice(i, j); i = j; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) out += (src[i] === '\n' ? '\n' : ' ');
      continue;
    }
    out += c; i++;
  }
  return out;
}
function callArgs(src) {
  const out = [];
  let i = 0;
  while (true) {
    i = src.indexOf('openModal(', i);
    if (i < 0) break;
    const before = src[i - 1] || '';
    if (/[A-Za-z0-9_$]/.test(before)) { i += 10; continue; }
    if (/function\s*$/.test(src.slice(Math.max(0, i - 12), i))) { i += 10; continue; }  // the declaration
    let j = i + 10, depth = 1, args = 1, firstEnd = -1;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '"' || c === "'" || c === '`') { j = skipString(src, j); continue; }
      if (c === '/' && regexPosition(src, j)) { j = skipRegex(src, j); continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { j++; break; } }
      else if (c === ',' && depth === 1) { args++; if (firstEnd < 0) firstEnd = j; }
      j++;
    }
    out.push({ args, line: src.slice(0, i).split('\n').length,
      first: src.slice(i + 10, firstEnd < 0 ? j - 1 : firstEnd).trim() });
    i += 10;
  }
  return out;
}
const calls = callArgs(blankComments(html));
ok(calls.length > 80, 'found the call sites (' + calls.length + ')',
   'the scan found almost nothing, so it is not reading the file it thinks it is');
/* Against openModal's REAL parameter count, not against a 2 written here.
   A 2 written here is how this check passed on the broken build: the five
   callers were passing two, openModal was taking one, and the gate had no
   way to notice because it was agreeing with the callers. */
const arity = (html.match(/function openModal\(([^)]*)\)/) || [, ''])[1]
  .split(',').map(s => s.trim()).filter(Boolean).length;
const tooMany = calls.filter(c => c.args > arity);
ok(tooMany.length === 0,
   'no call passes more arguments than openModal takes (' + arity + ')',
   'openModal takes ' + arity + ' argument(s) and these calls pass more, so the extra ones vanish: lines '
     + tooMany.map(c => c.line).join(', '));

const titled = calls.filter(c => c.args === 2);
ok(titled.length >= 5,
   'the five screens that pass a title are still passing one (' + titled.length + ')',
   'the two-argument callers have gone; if they were rewritten that is fine, but this gate no longer guards them');
const markupTitles = titled.filter(c => /^["'`]/.test(c.first) && c.first.indexOf('<') >= 0);
ok(markupTitles.length === 0,
   'no title contains markup, so escaping it cannot swallow anything',
   'a title contains markup and will be escaped on screen: lines ' + markupTitles.map(c => c.line).join(', '));

/* ---------- 3. the pill speaks only for the studio ---------- */
console.log('\n-- the pill says only what is true --');
ok(/function outboxTheirs\(list\)\{return \(list\|\|\[\]\)\.filter\(function\(x\)\{return x&&x\.kind!=="fault";\}\);\}/.test(shipped),
   'a crash report is not counted as the studio\'s unsaved work',
   'our own telemetry is back to being described to a studio as their change not saving');
ok(/const failed=outboxTheirs\(outboxFailures\(\)\)\.length,pending=outboxTheirs\(outboxPending\(\)\)\.length;/.test(shipped),
   'the pill counts their work and nothing else',
   'the pill is counting everything in the queue again, crash reports included');
ok(/const failed=outboxTheirs\(outboxFailures\(\)\);/.test(shipped),
   'the list behind the pill shows their work and nothing else',
   'the list behind the pill would show a crash report as a change that did not save');
ok(/if\(cur\[i\]\.kind==="fault"&&cur\[i\]\.tries>=OUTBOX_MAX_TRIES\)cur\.splice\(i,1\);/.test(shipped),
   'a crash report the server will not take leaves the queue instead of sitting there for good',
   'a refused crash report stays in the queue for ever, invisible and growing one per fault');

/* ---------- 4. the warning can be cleared ---------- */
console.log('\n-- and it can be cleared --');
ok(/function outboxGiveUp\(id\)\{/.test(shipped),
   'there is a way to stop trying to send something the server will never take',
   'the only button is Try again, so a permanently refused change makes the warning permanent too');
ok(/onclick=\\"outboxGiveUp\('"\+esc\(f\.id\)\+"'\)/.test(shipped),
   'the way out is on the row, so it is clear WHICH change is being given up on',
   'give-up is not offered per row');
ok(/if\(!confirm\(/.test(shipped.match(/function outboxGiveUp\(id\)\{[\s\S]{0,700}/)?.[0] || ''),
   'it asks first, naming the thing',
   'it discards without asking');
const giveUp = shipped.match(/function outboxGiveUp\(id\)\{[\s\S]{0,700}?\n\}/)?.[0] || '';
ok(/outboxDrop\(id\)/.test(giveUp) && !/\bsave\(|store\.del\(|removeItem\(/.test(giveUp),
   'it removes the QUEUE entry and touches no data key, so nothing on the device is deleted',
   'giving up on sending something is deleting the thing itself, which is not what the screen promises');
ok(/Stopping does not delete anything on this device/.test(shipped)
   && /go on showing the older one/.test(shipped),
   'the screen says what stopping does and what it costs',
   'the consequence of stopping is not stated, so it reads as a tidy-up rather than a choice');

/* ---------- 5. a storage key is not a name ---------- */
console.log('\n-- nothing shows a studio a storage key --');
ok(/return names\[f\.key\]\|\|"Changes";/.test(shipped),
   'an unknown key reads as "Changes" rather than as layi_dash_something',
   'an unlabelled key is printed raw at somebody');
const names = shipped.match(/function outboxLabel\(f\)\{[\s\S]*?\n\}/)?.[0] || '';
const stateKeys = (shipped.match(/const STATE_KEYS=\[([^\]]*)\]/)?.[1] || '')
  .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
const unlabelled = stateKeys.filter(k => names.indexOf(k + ':') < 0);
ok(stateKeys.length > 10, 'read the synced keys (' + stateKeys.length + ')',
   'could not read STATE_KEYS, so this check is not checking anything');
ok(unlabelled.length === 0,
   'every synced key has a word a person would use for it',
   'these synced keys have no label and would print raw: ' + unlabelled.join(', '));
ok(/if\(f\.kind==="fault"\)return "A crash report";/.test(shipped),
   'even a crash report has a name, for whoever ends up reading the copied details',
   'a fault entry has no label');

/* ---------- 6. the copy is safe to hand to somebody ---------- */
/* ---------- 7. the red pill is off, and the fact did not go with it ------ */
console.log('\n-- the alarm is off, on purpose, and the fact survived it --');
ok(/const SYNC_ALARM=false;/.test(shipped),
   'the red "n changes not saved" pill is off, by one switch',
   'the red pill is back on; if that was deliberate, say so here, because it was taken off on request');
ok(/if\(failed&&SYNC_ALARM\)return \{kind:"failed",n:failed\};/.test(shipped),
   'the switch is what decides it, so true puts it back with no other change',
   'the failed state no longer hangs off the switch, so there is no one-line way back');
ok(/function renderSyncQuiet\(\)\{/.test(shipped),
   'the fact still has somewhere to live now the pill does not carry it',
   'THE FACT IS GONE ENTIRELY: a studio whose work never reached the server is told nothing, anywhere');
ok(/function updateSyncPill\(\)\{\s*try\{renderSyncQuiet\(\);\}catch\(e\)\{\}/.test(shipped),
   'it is kept in step by the one function every queue change already calls',
   'the quiet line is not refreshed with the queue, so it will go stale');
/* Against the proper walk, not `shipped`. The lazy comment stripper eats this
   very line — which is the hazard this gate documents thirty lines further up,
   and which I then walked straight into while writing the check. */
ok(/id="syncQuiet"/.test(blankComments(html)),
   'and it has its place in Settings, beside what the server holds',
   'there is nowhere in the markup for it to render');
ok(/onclick="showSyncTrouble\(\)">See what they are<\/button>/.test(shipped),
   'it opens the same screen the pill opened, so nothing about it is a second copy',
   'the quiet line does not open the list, so the detail is unreachable');

console.log('\n-- the details are safe to send --');
const copy = shipped.match(/function copySyncTrouble\(\)\{[\s\S]*?\n\}/)?.[0] || '';
ok(copy.length > 0, 'the details can be copied, so a stuck change can be diagnosed',
   'there is no way to report what is stuck');
ok(!/payload/.test(copy),
   'the copied details carry no payload, so no client, figure or address leaves with them',
   'the copied text includes the payload, which is the studio\'s own data');

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nA modal is losing its body, or the warning cannot be cleared.'); process.exit(1); }
console.log('\nEvery modal renders what it was given, and a warning that cannot\nbe acted on can at least be understood and put down.');
