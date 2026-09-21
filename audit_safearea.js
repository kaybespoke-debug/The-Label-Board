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

// ---------------------------------------------------------------------
section('No table pushes the whole page sideways');
// ---------------------------------------------------------------------
// Reported with a photograph on 17 Sep: the console's Partners page on a
// phone, with the headings, the stat cards and the search box all sitting off
// the left edge. Nothing was wrong with any of them. One table was 606px wide
// inside a 375px screen, so the DOCUMENT was 635px and everything else was
// simply parked outside the window.
//
// Every table in the console and the portal sheds its secondary columns under
// 760px, which is what keeps them inside the screen. The Partners table was
// written without a single hide-sm on it. Measured in a real browser at 320,
// 414 and 768 afterwards: one offending page out of twenty-three, and it was
// that one.
//
// This is a static check because a page that scrolls sideways needs a layout
// engine to detect, and these gates run in node. It catches the thing that
// actually went wrong — a wide table with nothing allowed to drop — rather
// than pretending to measure. build_overflow_harness.js does the measuring.
{
  const SRC = [
    ['Admin console', ['admin/js/pages.js', 'admin/js/pages2.js', 'admin/js/detail.js',
      'admin/js/metrics.js', 'admin/js/calendar.js', 'admin/js/staffforms.js']],
    ['Partner portal', ['partners/js/pages.js', 'partners/js/pages2.js',
      'partners/js/detail.js', 'partners/js/actions.js']],
  ];
  const wide = [];
  for (const [app, files] of SRC) {
    for (const f of files) {
      const p = path.join(root, f);
      if (!fs.existsSync(p)) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const h of (src.match(/<thead>[\s\S]{0,1400}?<\/thead>/g) || [])) {
        const cols = (h.match(/<th[\s>]/g) || []).length;
        const droppable = (h.match(/hide-sm/g) || []).length;
        if (cols >= 4 && droppable === 0) {
          wide.push(app + ' — ' + f + ' (' + cols + ' columns, none droppable)');
        }
      }
    }
  }
  ok('every table of four columns or more can shed some on a phone',
     wide.length === 0, wide.join('; '));
}

// ---------------------------------------------------------------------
section('And a cell cannot be widened by one long unbroken string');
// ---------------------------------------------------------------------
// white-space:normal wraps at spaces. An email address has none, so the cell
// claims whatever width the address needs and the dropped columns were for
// nothing. This is the belt to that braces.
const adminCss = CSS['Admin console'];
ok('every cell in the console may break a long string, not just the ones asked to',
   /th,\s*td\{overflow-wrap:\s*anywhere\}/.test(adminCss),
   'the blanket rule is what protects a table nobody re-measured');
ok('and there is a class for the cells that carry an address',
   /\.brk\{[^}]*overflow-wrap:\s*anywhere/.test(adminCss),
   'an email with no spaces cannot wrap, so it sets the column width');
ok('content moved out of a dropped column has somewhere to go',
   /\.show-sm\{display:none\}/.test(adminCss) &&
   /\.show-sm\{display:block\}/.test(adminCss),
   'it has to be hidden by default AND shown on a phone, or it reads twice or never');

// The Partners page is the one this was found on, so it is named.
{
  const p2 = fs.readFileSync(path.join(root, 'admin/js/pages2.js'), 'utf8');
  const partners = (p2.match(/PAGES\.partners[\s\S]*?\n\};/) || [''])[0];
  ok('the Partners list still drops columns on a phone',
     (partners.match(/hide-sm/g) || []).length >= 3,
     'it went to six columns with none droppable once already');
  ok('and still shows the address somewhere when the Email column goes',
     /show-sm/.test(partners) && /brk/.test(partners),
     'who they are and how to reach them is the whole job of that list');
}

// =====================================================================
section('The page header stays put while the page scrolls');
// =====================================================================
// Kayode, 20 September 2026: "lets keep the headers firm, so the header
// doesnt scroll while you are scroliing other things on the profile".
//
// In all three apps the scroll container is .main, not the window, and the
// page header lives inside it. So the header went up with the content and
// the actions on a studio's record went with it.
//
// The first fix pulled the header up into .main's top padding with a
// negative margin. Measured in a browser, that left it stuck 26px down with
// a live strip above it that rows slid through: sticky positions against the
// scrollport and does not care what margin it was given. So the top padding
// moved ON TO the header instead, which is why both halves are checked here.
// Either one alone is a header that looks right and leaks.
{
  const APPS = [
    { name: 'console', css: 'admin/css/app.css',    header: '.top',    scroller: '.main' },
    { name: 'portal',  css: 'partners/css/app.css', header: '.top',    scroller: '.main' },
    { name: 'app',     css: 'site/layi_dashboard.html', header: '.topbar', scroller: '.main' },
  ];

  APPS.forEach(app => {
    /* Comments out first. A comment in this very file explaining what the old
       broken rule looked like was read as the rule itself, and the gate
       reported a padding that exists nowhere but in prose. */
    const src = fs.readFileSync(path.join(root, app.css), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    /* every rule for the header selector, so a later one can be seen too */
    const rules = [];
    let at = src.indexOf(app.header + '{');
    while (at !== -1) {
      rules.push(src.slice(at, src.indexOf('}', at) + 1));
      at = src.indexOf(app.header + '{', at + 1);
    }
    const all = rules.join('\n');

    ok(app.name + ': the page header is declared somewhere', rules.length > 0);
    ok(app.name + ': the page header is sticky', /position:\s*sticky/.test(all),
       'it scrolls away with the content');
    ok(app.name + ': and pinned to the top of its scroller', /top:\s*0/.test(all));
    ok(app.name + ': with a background, or the content shows through it',
       /background:\s*var\(--bg\)/.test(all));
    ok(app.name + ': and something to separate it from what it covers',
       /border-bottom:/.test(all));

    /* the other half: the scroller must not keep a top padding, or there is a
       strip above the sticky header for content to scroll into */
    const scrollerRules = [];
    let s = src.indexOf(app.scroller + '{');
    while (s !== -1) {
      scrollerRules.push(src.slice(s, src.indexOf('}', s) + 1));
      s = src.indexOf(app.scroller + '{', s + 1);
    }
    /* EVERY rule, not just the last: the customer app has three that touch
       .main, two of which only set padding-bottom, and checking the last one
       reported a bug that was not there. What matters is that none of them
       leaves a top padding behind. */
    const offenders = scrollerRules.filter(r => {
      const explicit = r.match(/padding-top:\s*([^;}]+)/);
      if (explicit && !/^0\b/.test(explicit[1].trim())) return true;
      const short = r.match(/[;{]\s*padding:\s*([^;}]+)/);
      if (short && !/^0\b/.test(short[1].trim())) return true;
      return false;
    });
    ok(app.name + ': the scroller has no top padding left for content to slide into',
       offenders.length === 0,
       offenders.length ? 'padding-top belongs on the header now: ' + offenders[0].slice(0, 90) : '');

    /* the negative-margin version must not come back */
    ok(app.name + ': the header is not pulled up by a negative margin',
       !/margin-top:\s*(-|calc\(\s*-)/.test(all),
       'that was tried, measured, and left a live strip above the header');
  });

  /* and the customer app keeps its safe-area inset on whichever element now
     carries the top padding, because that inset is what keeps a phone's
     status bar off the title */
  {
    const src = fs.readFileSync(path.join(root, 'site/layi_dashboard.html'), 'utf8');
    const topbar = src.slice(src.indexOf('.topbar{'));
    ok('app: the sticky header carries the top safe-area inset',
       /padding-top:\s*max\([^)]*env\(safe-area-inset-top\)/.test(topbar.slice(0, 900)),
       'the inset moved off .main with the padding and has to land here');
  }
}

// =====================================================================
section('Opening something takes you to the top of it');
// =====================================================================
// Kayode, 21 September 2026: "when you open a subscribr from the list, the
// page goes to the middle so i have to scroll back up."
//
// Below 680px .main stops being the scroll container and the document itself
// scrolls. Setting .main.scrollTop then moves nothing, and because the page
// you opened is usually SHORTER than the list you came from, the browser
// clamps your old offset to the new height and drops you somewhere arbitrary.
//
// The partner portal found this and fixed it with a two line helper. The
// console kept the bug for months, which is the same shape as the unquoted
// ids: fixed once, in one app, while the others carried on.
//
// So this checks the rule rather than the app: wherever a front end routes
// between pages, resetting the container is not enough on its own.
{
  const ROUTERS = [
    { name: 'console', file: 'admin/js/core.js',    fns: ['go', 'openDetail', 'goBack'] },
    { name: 'portal',  file: 'partners/js/core.js', fns: ['go', 'openDetail', 'goBack'] },
  ];

  ROUTERS.forEach(app => {
    const src = fs.readFileSync(path.join(root, app.file), 'utf8');

    /* the helper exists and does BOTH halves */
    const helper = src.slice(src.indexOf('function scrollTop()'));
    const body = helper.slice(0, helper.indexOf('}') + 1);
    ok(app.name + ': there is a scrollTop helper', src.indexOf('function scrollTop()') !== -1);
    ok(app.name + ': it resets the container', /\.scrollTop\s*=\s*0/.test(body));
    ok(app.name + ': and the window, which is what scrolls on a phone',
       /window\.scrollTo\(\s*0\s*,\s*0\s*\)/.test(body),
       'without this, opening a record on a narrow screen lands you mid page');

    /* and every route goes through it rather than doing half the job inline */
    app.fns.forEach(fn => {
      const at = src.indexOf('function ' + fn + '(');
      const chunk = at < 0 ? '' : src.slice(at, src.indexOf('\n}', at));
      ok(app.name + ': ' + fn + ' exists', at >= 0);
      ok(app.name + ': ' + fn + ' scrolls to the top through the helper',
         /\bscrollTop\(\)/.test(chunk),
         'it resets .main directly, which does nothing under 680px');
    });

    ok(app.name + ': no route still resets the container by hand',
       !/document\.querySelector\('\.main'\)\.scrollTop\s*=\s*0/.test(src),
       'that is the half fix this whole check exists to catch');
  });

  /* The customer app is the exception and it is worth writing down why, or
     somebody will "fix" it to match and wonder why nothing changed. Its .main
     keeps overflow-y:auto at every width, so it never hands scrolling to the
     document and resetting the container really is enough. */
  {
    const app = fs.readFileSync(path.join(root, 'site/layi_dashboard.html'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const mains = [...app.matchAll(/\.main\{[^}]*\}/g)].map(m => m[0]);
    const handsOver = mains.some(r => /overflow[^:]*:\s*visible/.test(r));
    ok('app: .main never hands scrolling to the document', !handsOver,
       'if it ever does, it needs the same helper as the other two');
  }
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
