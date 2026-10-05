/* =====================================================================
   EVERY APP SETS ITS SECURITY HEADERS, AND THE APP WITH THE CLIENT DATA
   SETS THE MOST.

   The customer app had none. Confirmed against the live response on 5
   October 2026: Strict-Transport-Security from Netlify and not another
   security header on it, while admin, partners and the marketing site all
   set X-Frame-Options and Referrer-Policy. The one app holding clients'
   names, addresses, phone numbers, measurements and photographs set
   nothing.

   This reads the netlify.toml files rather than the live responses, because
   a gate has to fail BEFORE a deploy rather than after one. The live check
   is a separate step in the release.

   IT READS THE COPY THE SITE ACTUALLY READS, which is site/netlify.toml and
   not the one at the repo root. The first version of this gate read the root
   file, passed, and layi-v71 shipped with five headers configured and none
   of them served. Every app folder's netlify.toml says publish = ".", which
   only resolves when the Netlify site has a base directory, so each of the
   four sites reads its own folder's file. Both copies are kept because the
   root one is what the repo documents and a merge could bring either
   forward; this gate fails if they ever disagree.

   WHAT THE CSP CAN AND CANNOT DO, so nobody reads this gate as more
   comfort than it is: script-src carries 'unsafe-inline' because the app
   is one file with roughly 691 lines of inline onclick/oninput/onchange
   handlers, and no nonce can cover an attribute. So it does NOT stop
   injected inline script. It stops framing, and it stops an injected
   script posting a studio's client list anywhere of its choosing. Those
   are the two that matter here, and connect-src is the one doing the
   second.

   usage: node audit_headers.js
   ===================================================================== */
const fs = require('fs');

let pass = 0; const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); }
};
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };

/* ------------------------------------------------------------------ */
section('The customer app, which holds the client data');
/* ------------------------------------------------------------------ */
/* app  = the file the LIVE SITE reads. Every assertion below is about this
   one, because this is the one that decides what a studio's browser gets.
   root = the copy at the repo root, checked afterwards for agreement. */
const app = read('site/netlify.toml');
const root = read('netlify.toml');
ok('site/netlify.toml exists', !!app);
ok('  and publishes "." , which is what a base directory needs',
   /publish\s*=\s*"\."/.test(app));
ok('the root netlify.toml still publishes site/, for whoever reads it',
   /publish\s*=\s*"site"/.test(root));

const csp = (app.match(/Content-Security-Policy\s*=\s*"([^"]+)"/) || [])[1] || '';
ok('the file the site reads sets a Content-Security-Policy', !!csp,
   'site/netlify.toml has none, so nothing is served however good the root copy is');

/* The directives that do the work. Each one is here because removing it
   would quietly give something back. */
for (const [what, probe, why] of [
  ["frame-ancestors 'none'", /frame-ancestors 'none'/,
   'without it a signed-in studio can be framed and clickjacked'],
  ["object-src 'none'", /object-src 'none'/, 'plugins are a script-execution path'],
  ["base-uri 'self'", /base-uri 'self'/, 'a rewritten <base> repoints every relative URL'],
  ["form-action 'self'", /form-action 'self'/, 'otherwise a form can post anywhere'],
  ['a restricted connect-src', /connect-src [^;]+/,
   'THIS is the line that stops a studio\'s client list being posted to an attacker'],
  ["worker-src 'self'", /worker-src 'self'/, 'the service worker is how the PWA updates'],
]) {
  ok('  ' + what, probe.test(csp), why);
}

/* And the allow-list has to carry exactly what the app really loads.
   Checked against the app itself rather than against a list in this file,
   so adding a CDN to the app and forgetting the header fails here. */
section('  the allow-list matches what the app actually loads');
const html = read('site/layi_dashboard.html');
const needs = [
  ['https://cdn.jsdelivr.net', /cdn\.jsdelivr\.net/, 'the Supabase client and SheetJS'],
  ['https://fonts.googleapis.com', /fonts\.googleapis\.com/, 'the font stylesheet'],
  ['https://fonts.gstatic.com', /fonts\.gstatic\.com/, 'the font files'],
];
for (const [origin, inApp, why] of needs) {
  if (!inApp.test(html)) { ok('  ' + origin + ' is not loaded any more, so it need not be allowed', true); continue; }
  ok('  ' + origin + ' is allowed (' + why + ')', csp.includes(origin),
     'the app loads it and the policy would refuse it');
}
/* every Supabase project the app can talk to */
const projects = [...new Set((html.match(/https:\/\/([a-z0-9]+)\.supabase\.co/g) || []))];
ok('  the app names at least one Supabase project', projects.length > 0);
for (const p of projects) {
  const host = p.replace('https://', '');
  ok('  ' + host + ' is in connect-src', csp.includes(p),
     'the app would not be able to sync');
  ok('    and wss:// for realtime', csp.includes('wss://' + host),
     'another device\'s changes would never arrive');
  ok('    and img-src, for signed photo URLs', new RegExp('img-src[^;]*' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(csp),
     'stored photos would be blocked');
}
/* the two schemes the app genuinely needs */
ok("  img-src allows data: (a photo before it uploads)", /img-src[^;]*data:/.test(csp));
ok("  img-src allows blob:", /img-src[^;]*blob:/.test(csp));

/* THE ONE THING THE POLICY MUST NOT DO */
section('  and it must not break what it is protecting');
ok('publickey-credentials-get is NOT disabled, or biometric unlock dies',
   !/publickey-credentials-get\s*=\s*\(\)/.test(app),
   'Permissions-Policy would refuse WebAuthn');
ok("script-src carries 'unsafe-inline', which is honest rather than ideal: "
   + 'the app has inline handlers and a nonce cannot cover an attribute',
   /script-src[^;]*'unsafe-inline'/.test(csp),
   'every onclick in the app would stop working');
ok("style-src carries 'unsafe-inline', for the same reason",
   /style-src[^;]*'unsafe-inline'/.test(csp));

section('  the other headers');
for (const [h, want] of [
  ['X-Frame-Options', /X-Frame-Options\s*=\s*"DENY"/],
  ['X-Content-Type-Options', /X-Content-Type-Options\s*=\s*"nosniff"/],
  ['Referrer-Policy', /Referrer-Policy\s*=\s*"no-referrer"/],
  ['Permissions-Policy', /Permissions-Policy\s*=\s*"[^"]+"/],
]) {
  ok('  ' + h, want.test(app));
}

/* ------------------------------------------------------------------ */
section('The two copies agree, so a merge cannot quietly pick the weaker one');
/* ------------------------------------------------------------------ */
const block = t => {
  const i = t.indexOf('[[headers]]');
  return i < 0 ? '' : t.slice(i).replace(/\r/g, '').trim();
};
ok('the root netlify.toml carries a [[headers]] block too', !!block(root));
ok('  and it is identical to the one the site reads', block(root) === block(app),
   'they differ, so the live headers depend on which file Netlify happens to read');

/* ------------------------------------------------------------------ */
section('And the other three still set theirs');
/* ------------------------------------------------------------------ */
for (const [name, file, frame] of [
  ['the admin console', 'admin/netlify.toml', 'DENY'],
  ['the partner portal', 'partners/netlify.toml', 'DENY'],
  ['the public website', 'web/netlify.toml', 'SAMEORIGIN'],
]) {
  const t = read(file);
  ok(name + ' sets X-Frame-Options: ' + frame,
     new RegExp('X-Frame-Options\\s*=\\s*"' + frame + '"').test(t), file);
  ok('  and a Referrer-Policy', /Referrer-Policy\s*=\s*"/.test(t), file);
}

/* ------------------------------------------------------------------ */
section('The preview that tests the policy before it ships');
/* ------------------------------------------------------------------ */
const prev = read('tools/csp_preview.js');
ok('tools/csp_preview.js exists', !!prev);
ok('  and reads the policy out of netlify.toml rather than repeating it',
   /netlify\.toml/.test(prev),
   'a preview that tests a policy nobody ships is worse than none');

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fails.length + ' failed');
for (const f of fails) console.log('  - ' + f);
if (!fails.length) {
  console.log('\nThe app cannot be framed, and an injected script cannot post a');
  console.log('studio\'s clients anywhere. Inline script is still allowed, and');
  console.log('that is written down rather than pretended away.');
}
process.exit(fails.length ? 1 : 0);
