// Nothing lives under the phone's status bar or its home bar.
//
// Reported on 15 Sep with a photograph: the console's "Load example data"
// sheet, on a phone, with the clock printed straight through the modal title —
// "Load 12:43mple data". The cause is the same every time and it is invisible
// on a desktop browser, which is where all of this gets built.
//
// An element pinned to an edge of the screen is positioned against the VIEWPORT,
// not against the part of the viewport you can actually see. On a phone with a
// notch or a home bar those are different rectangles, and the difference is
// exactly env(safe-area-inset-*). Miss it at the top and the status bar prints
// through your header. Miss it at the bottom and the last row of every page
// sits behind the home indicator.
//
// Three apps, three stylesheets, and the same trap in each. The customer app
// had already been through it and carries the insets; the console and the
// portal had not. So this checks all three, by selector, because a selector is
// what somebody edits.
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const pass = [];
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass.push(name); console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* Pull one declaration block by selector. Good enough for stylesheets we
   control and write by hand; it is not a CSS parser and does not pretend to be.
   Returns every block whose selector list contains the name, joined, so a
   selector restated inside a media query is checked too. */
function blocks(css, selector) {
  const out = [];
  const re = new RegExp('(^|[,{}\\s])' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(,[^{]*)?\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(css))) out.push(m[3]);
  return out;
}
function anyBlockHas(css, selector, needle) {
  return blocks(css, selector).some(b => b.indexOf(needle) >= 0);
}

const APPS = [
  { name: 'Admin console', css: 'admin/css/app.css' },
  { name: 'Partner portal', css: 'partners/css/app.css' },
  { name: 'Customer app', css: 'site/layi_dashboard.html' },
];
const CSS = {};
for (const a of APPS) CSS[a.name] = fs.readFileSync(path.join(root, a.css), 'utf8');

// ---------------------------------------------------------------------
section('A sheet that fills the screen starts below the status bar');
// ---------------------------------------------------------------------
// Both the console and the portal turn a modal into a bottom sheet on a phone
// and set the mask's padding to 0. A sheet taller than the screen then reaches
// the very top of it, and .mh is sticky at top:0 — which is where the clock is.
ok('the console\'s modal mask keeps the top inset',
   anyBlockHas(CSS['Admin console'], '.mask', 'safe-area-inset-top'),
   'a tall sheet starts under the status bar');
ok('and so does the partner portal\'s',
   anyBlockHas(CSS['Partner portal'], '.mask', 'safe-area-inset-top'));
ok('the customer app puts it on the bar itself, which is the same guarantee',
   /\.modal-topbar\{[^}]*safe-area-inset-top/.test(CSS['Customer app']));

// ---------------------------------------------------------------------
section('A sticky footer clears the home bar');
// ---------------------------------------------------------------------
ok('the console\'s modal footer clears it',
   anyBlockHas(CSS['Admin console'], '.mf', 'safe-area-inset-bottom'));
ok('and the portal\'s', anyBlockHas(CSS['Partner portal'], '.mf', 'safe-area-inset-bottom'));
ok('and the customer app\'s modal body',
   /\.modal-page\{[^}]*safe-area-inset-bottom/.test(CSS['Customer app']));

// ---------------------------------------------------------------------
section('Fixed navigation clears it too, and the page leaves room for it');
// ---------------------------------------------------------------------
// The portal's entire navigation is a bottom bar on a phone. It had no inset
// at all, so the bottom of every tab sat behind the home indicator.
ok('the console\'s bottom bar clears the home bar',
   anyBlockHas(CSS['Admin console'], '.mobbar', 'safe-area-inset-bottom'));
ok('the portal\'s bottom navigation clears it',
   anyBlockHas(CSS['Partner portal'], '.side', 'safe-area-inset-bottom'),
   'the whole navigation sat under the home indicator');
ok('the customer app\'s tab bar clears it',
   /\.mob-bar\{[^}]*safe-area-inset-bottom/.test(CSS['Customer app']));

// A bar that grew by the inset hides content unless the page grew too.
ok('the portal reserves room for a bar that is taller than 66px',
   anyBlockHas(CSS['Partner portal'], '.shell', 'safe-area-inset-bottom'),
   'the last row of every page sits behind the navigation');
ok('the console reserves room for its bar',
   anyBlockHas(CSS['Admin console'], '.main', 'safe-area-inset-bottom'));
ok('and the customer app for its own',
   /\.main\{[^}]*safe-area-inset-bottom/.test(CSS['Customer app']));

// ---------------------------------------------------------------------
section('A drawer that runs the height of the screen clears both ends');
// ---------------------------------------------------------------------
ok('the console drawer clears the status bar',
   anyBlockHas(CSS['Admin console'], '.side', 'safe-area-inset-top'));
ok('the customer app drawer clears it',
   /\.sidebar\{[^}]*safe-area-inset-top/.test(CSS['Customer app']));

// ---------------------------------------------------------------------
section('And the splash screen, which is the first thing anybody sees');
// ---------------------------------------------------------------------
for (const a of APPS) {
  const css = CSS[a.name];
  if (css.indexOf('#splash') < 0) continue;
  ok(a.name + '\'s splash sits inside the safe area',
     anyBlockHas(css, '#splash', 'safe-area-inset-top'));
}

console.log('\n' + '='.repeat(62));
if (failures.length) {
  console.log(pass.length + ' passed, ' + failures.length + ' FAILED:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(pass.length + ' passed, 0 failed');
console.log('\nNothing in any of the three apps is pinned to an edge of the');
console.log('screen without allowing for what the phone puts there.');
