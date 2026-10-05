/* =====================================================================
   NOTHING THE BROWSER RUNS ARRIVES UNPINNED OR UNCHECKED.

   The app loaded `@supabase/supabase-js@2` from jsdelivr with no integrity
   hash. Two things follow from that, and neither is hypothetical:

   1. Every studio ran whatever that tag resolved to on the morning they
      opened the app. A breaking change in a minor release, or a bad publish,
      arrives on its own with nobody deciding anything.

   2. A tampered or swapped file would have been executed without question,
      in the one app holding clients' names, addresses, phone numbers,
      measurements and photographs, with the live session token in reach.

   THE CSP CANNOT CATCH THIS. `script-src` has to allow cdn.jsdelivr.net
   precisely because this tag needs it, so the policy's answer to a bad file
   at an allowed origin is "run it". An integrity hash is the only thing in
   the stack that reads the bytes.

   SheetJS was already pinned with a hash, which is the pattern this copies,
   and is the reason the gate is worth having rather than a one-off fix: the
   next person adding a library needs the rule written down somewhere that
   fails.

   WHAT crossorigin IS DOING HERE. Without `crossorigin="anonymous"` the
   browser will not check an integrity hash on a cross-origin script at all.
   It does not warn. The attribute is not decoration and a missing one turns
   the whole exercise into a comment, so it is checked as hard as the hash.

   usage: node audit_pinned_deps.js
   ===================================================================== */
const fs = require('fs');

let pass = 0; const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); }
};
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const html = fs.readFileSync('site/layi_dashboard.html', 'utf8');

/* ------------------------------------------------------------------ */
section('Every third-party script the browser is asked to run');
/* ------------------------------------------------------------------ */

/* Found from the file rather than listed here, so a NEW library is caught
   the day somebody adds it rather than the day somebody remembers to add it
   to this array. */
const urls = [...new Set(html.match(/https:\/\/cdn\.jsdelivr\.net\/[^'"\s)]+/g) || [])]
  /* the comment block that documents how to recompute a hash names a URL
     with a VERSION placeholder in it; it is prose, not a load */
  .filter(u => !u.includes('VERSION'));

ok('at least one third-party script is loaded, so there is something to check',
   urls.length > 0);

for (const u of urls) {
  const name = u.replace('https://cdn.jsdelivr.net/npm/', '');
  section('  ' + name);

  /* A version, and a whole one. @2 is a range; 2.117.2 is a decision. */
  const ver = u.match(/@(\d+\.\d+\.\d+)(\/|$)/);
  ok('    pinned to an exact version', !!ver,
     'the URL carries a range or a tag, so the bytes can change under us');

  /* The hash has to be on the SAME element as the src. Finding an integrity
     attribute anywhere in the file proves nothing.

     AND THE WINDOW MUST NOT INCLUDE THE COMMENT ABOVE THE TAG. The first
     version of this gate looked 700 characters backwards from the URL, which
     swept in the comment block explaining why crossorigin is required — so
     deleting the real attribute still passed, because the gate was reading
     its own documentation. The mutation drill caught it. The window is now
     exactly the element: from its own `<script` to the first `>` after the
     URL, and only if nothing closes a tag in between. */
  const at = html.indexOf(u);
  const close = html.indexOf('>', at);
  const open = html.lastIndexOf('<script', at);
  const isTag = open >= 0 && html.slice(open, at).indexOf('>') < 0;
  const tag = isTag ? html.slice(open, close + 1) : '';

  /* SheetJS is attached to an element built in JS (sc.src = …, sc.integrity
     = …, sc.crossOrigin = …), so that shape is allowed too — read forwards
     from the url only, never backwards into prose. */
  const js = html.slice(at, at + 700);

  const hasIntegrity = /integrity\s*=\s*['"]sha(256|384|512)-[A-Za-z0-9+/=]+['"]/.test(tag)
    || /\.integrity\s*=\s*['"]sha(256|384|512)-[A-Za-z0-9+/=]+['"]/.test(js);
  const hasCrossorigin = /crossorigin\s*=\s*['"]?anonymous/.test(tag)
    || /\.crossOrigin\s*=\s*['"]anonymous['"]/.test(js);

  ok('    carries an integrity hash on the same element as the src', hasIntegrity,
     'the browser will run whatever that origin serves');
  ok('    and crossorigin="anonymous", without which the hash is never checked',
     hasCrossorigin,
     'an integrity attribute on a cross-origin script with no crossorigin is ignored silently');
  ok('    loaded over https', u.startsWith('https://'));
  if (isTag) ok('    (a <script> tag)', true);
}

/* ------------------------------------------------------------------ */
section('The Supabase client specifically');
/* ------------------------------------------------------------------ */
const sb = urls.find(u => u.includes('@supabase/supabase-js'));
ok('the Supabase client is loaded from a pinned URL', !!sb);
if (sb) {
  const v = (sb.match(/supabase-js@(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
  ok('  it is a version, not the @2 range', v.length === 3,
     'this is what shipped before October and it is how a library changes without a commit');
  /* 2.105.0 is the floor for signInWithPasskey / registerPasskey. Face ID
     sign-in is the planned replacement for the unlock that cannot work, so
     dropping below this quietly removes the option. */
  if (v.length === 3) {
    const okFloor = v[0] > 2 || (v[0] === 2 && (v[1] > 105 || (v[1] === 105 && v[2] >= 0)));
    ok('  at least 2.105.0, the floor for passkey sign-in', okFloor,
       'found ' + v.join('.'));
  }
  ok('  it is the UMD build, which is what sets window.supabase',
     /dist\/umd\/supabase\.js$/.test(sb) || !sb.includes('/dist/'),
     'a module build would leave window.supabase undefined and the app would silently go local');
}

/* ------------------------------------------------------------------ */
section('And a failed load is not mistaken for "no backend"');
/* ------------------------------------------------------------------ */
/* This is the half that makes pinning safe to ship. An integrity hash turns
   a bad file into NO file, and the old bootstrap left `supa` null in that
   case — which is exactly what a local-only install looks like. A studio
   would have worked all day into localStorage believing it was syncing. */
ok('the app records that a configured client failed to load',
   /SUPA_CLIENT_MISSING\s*=\s*true/.test(html),
   'a refused or missing client is indistinguishable from a local install');
ok('  and says so where somebody is already looking at a login form',
   /SUPA_CLIENT_MISSING_MSG/.test(html));
const loginFn = html.slice(html.indexOf('async function doLogin()'), html.indexOf('async function doLogin()') + 900);
ok('  doLogin stops before claiming a password is wrong', /SUPA_CLIENT_MISSING/.test(loginFn),
   'it would tell somebody to sign in with a form that cannot work');
const fp = html.slice(html.indexOf('async function forgotPassword()'), html.indexOf('async function forgotPassword()') + 2200);
ok('  forgotPassword stops before promising an email', /SUPA_CLIENT_MISSING/.test(fp));

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fails.length + ' failed');
for (const f of fails) console.log('  - ' + f);
if (!fails.length) {
  console.log('\nEvery third-party script is a decided version whose bytes are');
  console.log('checked, and a file the browser refuses is reported rather than');
  console.log('mistaken for a studio that never had a backend.');
}
process.exit(fails.length ? 1 : 0);
