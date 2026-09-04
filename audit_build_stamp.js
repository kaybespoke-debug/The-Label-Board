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
  F('there is no build stamp element on the sign-in screen');
if (!/buildStamp'\)[\s\S]{0,80}APP_VERSION/.test(html))
  F('the build stamp element is never filled in, so it renders empty');

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
console.log('  ✓ one marker, shown on the sign-in screen, agreeing with the service worker');
