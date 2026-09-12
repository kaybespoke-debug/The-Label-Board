// The app must be able to say which build it is.
//
// Three fixes were shipped in a row and each time the question "is this
// actually the new version?" could only be answered by reading the database
// and reasoning about timestamps. Two studios turned out to have been tested
// on the build before the fix, and there was no way to tell from the screen —
// so a fix that had landed and a fix that had not looked identical, and the
// only person who could tell was not the person looking at it.
//
// So: one release marker, shown on the sign-in screen, and held equal to the
// service worker's cache name. Those two must agree or the marker is worse
// than nothing — it would report a version the browser is not running, which
// is precisely the confusion it exists to end.
'use strict';
const fs = require('fs');

const appPath = process.argv[2] || 'site/layi_dashboard.html';
const swPath = process.argv[3] || 'site/sw.js';
const html = fs.readFileSync(appPath, 'utf8');
const sw = fs.readFileSync(swPath, 'utf8');

const fails = [];
const F = m => fails.push(m);

const appV = (html.match(/const APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
const cache = (sw.match(/const CACHE\s*=\s*'([^']+)'/) || [])[1];

if (!appV) F('the app declares no APP_VERSION');
if (!cache) F('the service worker declares no CACHE');

if (appV && cache && appV !== cache)
  F('APP_VERSION (' + appV + ') and the service worker CACHE (' + cache + ') disagree, '
    + 'so the app would report a build the browser is not running');

// It has to reach the screen, not just exist in a constant.
if (!/id="buildStamp"/.test(html))
  F('there is no build stamp element anywhere, so nobody can be asked which build they are on');
if (!/buildStamp'\)[\s\S]{0,80}APP_VERSION/.test(html))
  F('the build stamp element is never filled in, so it renders empty');

/* It moved to Settings on 12 Sep, at Kayode's ask, and the move is the point:
   the marker exists so somebody can READ it when a problem is reported, not so
   every client meets a version string on the front door. Keeping it reachable
   and keeping it off the sign-in screen are two separate requirements, so the
   gate holds both — otherwise "tidy it away" and "delete it" look identical. */
{
  const login = (html.match(/<div class="login-wrap"[\s\S]*?<!-- =+ APP/) ||
                 html.match(/id="loginPass"[\s\S]{0,4000}/) || [''])[0];
  if (/id="buildStamp"/.test(login))
    F('the build stamp is back on the sign-in screen; it belongs in Settings');
  const settings = (html.match(/<section class="view" id="view-settings"[\s\S]*?\n      <\/section>/) || [''])[0];
  if (!/id="buildStamp"/.test(settings))
    F('the build stamp is not in Settings, so nobody can find it when asked for it');
}

// Bumping the cache is what makes an installed phone swap. A release that
// forgets it serves the previous build to everyone who installed the app.
if (cache && !/^layi-v\d+$/.test(cache))
  F('the cache name is not the expected layi-vN form, so a bump cannot be checked: ' + cache);

console.log('Build stamp audit:');
console.log('  APP_VERSION      ' + (appV || '(none)'));
console.log('  sw.js CACHE      ' + (cache || '(none)'));
if (fails.length) {
  console.log('\n✗ ' + fails.length + ' problem(s):');
  fails.forEach(f => console.log('   - ' + f));
  process.exit(1);
}
console.log('  ✓ one marker, in Settings and not on the front door, agreeing with the service worker');
