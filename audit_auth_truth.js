/* =====================================================================
   THE TWO PLACES THIS APP TOLD SOMEBODY A THING HAD HAPPENED WHEN IT HAD
   NOT.

   Both are on the sign-in screen, which is the one screen a studio reaches
   when something has already gone wrong, and both had the same shape: the
   app reported success because it never looked at the answer.

   1. PASSWORD RESET. forgotPassword() posted to auth-recover and threw the
      reply away, printing "a link is on its way" whatever came back. And
      auth-recover answered `ok: true` with no mail provider configured —
      which is what production had, because RESEND_API_KEY was set on the
      STAGING project on 28 September and never on production. The live
      project held ONE reset request ever made and ZERO emails ever sent. An
      owner locked out of their own business was told to check an inbox
      nothing had been sent to.

   2. FACE ID UNLOCK. The setting enrolled, reported "On for this device",
      put a button on the sign-in screen, and the unlock behind it has been
      impossible since layi-v62 — the guard in biometricUnlock() is
      localLoginAllowed(), which is !SUPA_URL, false for every studio.

   THE RULE THE MAIL PATH NOW FOLLOWS, and the reason this gate is not just
   "check it returns an error": LOUD ABOUT OURSELVES, SILENT ABOUT THEM.

     A missing mail provider is a property of our deployment. It is
     identically true for every address on earth, so saying it out loud
     reveals nothing about who has an account here, and NOT saying it strands
     the one person it matters to.

     A failure for one PARTICULAR address is the opposite. Which addresses
     bounce, are suppressed or do not exist is precisely the list this
     function exists to withhold. That case must still answer the same
     sentence as everything else and go to error_reports instead.

   So this gate checks BOTH directions. A version that shouted about every
   failure would pass a naive test and reintroduce the disclosure the whole
   function is built around.

   usage: node audit_auth_truth.js
   ===================================================================== */
const fs = require('fs');

let pass = 0; const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); }
};
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const html = fs.readFileSync('site/layi_dashboard.html', 'utf8');
const fn = fs.readFileSync('supabase/functions/auth-recover/index.ts', 'utf8');
const slice = (src, from, len) => { const i = src.indexOf(from); return i < 0 ? '' : src.slice(i, i + len); };

/* ================================================================== */
section('The function admits when it cannot send');
/* ================================================================== */
ok('auth-recover reads a mail key at all', /RESEND_API_KEY/.test(fn));
ok('it has an answer that is NOT the same-for-everybody one', /mail_not_configured/.test(fn),
   'with no provider configured it reports success and sends nothing');
ok('  that answer says ok: false, which is what the app tests',
   /ok:\s*false/.test(slice(fn, 'const notConfigured', 400)),
   'the app would print the reassuring sentence over it');
ok('  it is returned when there is no key, before any address is looked up',
   /if\s*\(!RESEND_KEY\)\s*\{[\s\S]{0,400}?return json\(notConfigured/.test(fn),
   'the check must not sit after the account lookup, or it becomes address-dependent');
ok('  and it is recorded where we already look, not only in a Deno log',
   /reportEdgeFault\('auth-recover\/not-configured'/.test(fn),
   'reading Deno logs means somebody deciding to go and look on a day nobody knows to');

section('  and the provider is quoted, so a failure is actionable');
ok('a refusal from the provider carries its reason, not just a status',
   /res\.text\(\)/.test(fn) && /'provider '\s*\+\s*res\.status/.test(fn),
   '"provider 403" cannot be told from "the sending domain is not verified"');
ok('a send failure is reported', /reportEdgeFault\('auth-recover\/send'/.test(fn));
ok('a link that cannot be minted is reported too',
   /reportEdgeFault\('auth-recover\/generate-link'/.test(fn),
   'no link is as complete a lockout as no email');

/* ================================================================== */
section('But it still never says WHICH addresses have accounts');
/* ================================================================== */
/* The important half. A per-address failure must leave the caller with the
   identical sentence, or the function becomes an oracle for whether an
   address banks here. */
const sendBlock = slice(fn, 'const sent = await send(', 1400);
ok('a failed send still answers the same sentence as everything else',
   /return json\(same\)/.test(sendBlock),
   'the caller could tell a real address from an unknown one by the reply');
/* Not "does the word email appear" — it does, in prose. The question is
   whether the `email` VARIABLE reaches a report, and whether the provider's
   own reply is cleaned before it does, because Resend quotes the request
   back in some of its errors. */
ok('  no report interpolates the address variable',
   !/reportEdgeFault\([^;]*?\+\s*email\b/.test(fn)
   && !/reportEdgeFault\([^;]*?\$\{\s*email\s*\}/.test(fn),
   'a table a platform admin reads would rebuild the list the function withholds');
ok('  and the provider\'s reply is redacted before it is reported',
   /replace\(\/\[\\w\.\+-\]\+@/.test(fn) && /address redacted/.test(fn),
   'Resend quotes the request back, so its error text can carry the recipient');
ok('an address with no account still answers the same sentence',
   /!\(who as unknown\[\]\)\.length\) return json\(same\)/.test(fn));
ok('the rate-limited case answers the same sentence',
   /recently_sent\) return json\(same\)/.test(fn));
ok('even a crash answers the same sentence',
   /catch \(e\)[\s\S]{0,400}?return json\(same\)/.test(fn));
ok('the not-configured answer is the ONLY one that differs',
   (fn.match(/mail_not_configured/g) || []).length === 1,
   'more than one route out of the same-answer rule is more than one disclosure');

/* ================================================================== */
section('And the app repeats what it is told rather than guessing');
/* ================================================================== */
const fp = slice(html, 'async function forgotPassword()', 2600);
ok('forgotPassword exists', !!fp);
ok('  it keeps the response instead of discarding it', /const r\s*=\s*await fetch\(/.test(fp),
   'it awaited the fetch and ignored it, which is how the lie survived');
ok('  it parses the body', /await r\.json\(\)/.test(fp));
ok('  it checks ok === false', /ok\s*===\s*false/.test(fp));
ok('  and shows the server\'s own sentence when it fails',
   /out\.message/.test(fp),
   'a message written twice drifts; the function owns the wording');
ok('  it returns before printing the reassuring sentence',
   fp.indexOf('return;') < fp.indexOf('a link is on its way'),
   'both would print and the last one wins');
ok('  the reassuring sentence is still there for the ordinary case',
   /a link is on its way/.test(fp));

/* ================================================================== */
section('Face ID is not offered where it cannot work');
/* ================================================================== */
ok('there is one place that decides', /function biometricCanWorkHere\(\)/.test(html),
   'three separate checks drift and the one nobody tests is the one that rots');
ok('  and it is the same condition the unlock itself enforces',
   /function biometricCanWorkHere\(\)\s*\{\s*return localLoginAllowed\(\);\s*\}/.test(html),
   'if the gate and the unlock disagree, one of them is lying');

/* all three surfaces. the banner is the one that matters most: it appears
   unasked, which is how a studio came to believe the feature existed. */
const refresh = slice(html, 'async function refreshBiometricUI()', 500);
ok('the sign-in button is hidden', /biometricCanWorkHere\(\)/.test(refresh));
const setting = slice(html, 'async function renderBiometricSetting()', 900);
ok('the Settings toggle is hidden', /biometricCanWorkHere\(\)/.test(setting));
ok('  the whole row, not just the checkbox',
   /getElementById\('bioField'\)/.test(setting),
   'a disabled checkbox beside those words still advertises the feature');
/* 1600, not 900: the comment explaining the guard pushed the stamp out of a
   shorter window and indexOf returned -1, which compared as 'before'. */
const offer = slice(html, 'async function maybeOfferBiometric()', 1600);
ok('the unasked banner is not shown', /biometricCanWorkHere\(\)/.test(offer));
/* Compared on the CODE, not on the comment that explains it. The first
   version of this check read indexOf('layi_bio_asked'), found it in the
   comment above the guard, and failed on correct code. */
ok('  and checked BEFORE the once-per-device flag is stamped',
   offer.indexOf('biometricCanWorkHere())return') >= 0
   && offer.indexOf('biometricCanWorkHere())return') < offer.indexOf("setItem('layi_bio_asked'"),
   'suppressing it after the stamp burns the one offer they get when it works');

section('  without throwing away anybody\'s enrolment');
ok('the stored credential handle is still read and written',
   /function bioGet\(\)/.test(html) && /function bioSet\(/.test(html));
ok('  and nothing clears it on the way past',
   !/bioSet\(null\)[\s\S]{0,120}biometricCanWorkHere/.test(html)
   && !/biometricCanWorkHere[\s\S]{0,200}bioSet\(null\)/.test(html),
   'hiding a feature is reversible; deleting the enrolment is not');
ok('the layi_biometric key name is untouched',
   /'layi_biometric'/.test(html),
   'renaming a layi_* key wipes live data on real devices');

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fails.length + ' failed');
for (const f of fails) console.log('  - ' + f);
if (!fails.length) {
  console.log('\nThe reset path is loud about our own failures and silent about');
  console.log('whose address it is, the app repeats what the server tells it, and');
  console.log('Face ID is not offered on an install where it cannot work.');
}
process.exit(fails.length ? 1 : 0);
