#!/usr/bin/env node
/* =====================================================================
   audit_calendar.js — the gate for the admin console's Calendar.

   Reads the shipped source and checks the things that would quietly stop
   being true. Every check exists because breaking it produces a console
   that still looks fine.

   Run:  node audit_calendar.js
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CAL = fs.readFileSync(path.join(ROOT, 'admin', 'js', 'calendar.js'), 'utf8');
const DATA = fs.readFileSync(path.join(ROOT, 'admin', 'js', 'data.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'admin', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'admin', 'css', 'app.css'), 'utf8');

/* Comments explain the rules and therefore quote them. Structural checks
   that must not match prose read this instead. */
const CODE = CAL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

// =====================================================================
section('1. The calendar is a view, not a second set of records');
// =====================================================================
{
  /* The whole point. If the calendar starts writing its own copy of a
     task, the console ends up with two records for one thing. */
  const owned = (CAL.match(/type:\s*'(\w+)'/g) || []).join(' ');
  ok('only meeting, reminder and content are owned kinds',
    /\['meeting', 'Meeting'\], \['reminder', 'Reminder'\], \['content', 'Content'\]/.test(CAL),
    'the Type dropdown must offer exactly those three');

  ok('the Type dropdown cannot create a task',
    !/opts\(\[[^\]]*'task'/.test(CAL));
  ok('the Type dropdown cannot create an announcement',
    !/opts\(\[[^\]]*'announcement'/.test(CAL));

  /* A task row must open the TASK, not a calendar copy of it. */
  ok('a task on the calendar opens the task record',
    /kind: 'task'[\s\S]{0,400}openDetail\('task'/.test(CAL));
  ok('an announcement opens the announcements page',
    /kind: 'announcement'[\s\S]{0,400}go\('announcements'\)/.test(CAL));
  ok('a renewal opens the subscriber',
    /kind: 'renewal'[\s\S]{0,400}openDetail\('sub'/.test(CAL));

  /* Writes must only ever touch DB.calendar. */
  const writes = CAL.match(/DB\.(\w+)\s*(=|\.push|\.splice|\.filter\([^)]*\)\s*;)/g) || [];
  const badWrites = writes.filter(w => !/DB\.calendar/.test(w));
  ok('nothing outside DB.calendar is written', badWrites.length === 0, badWrites.join(', '));

  ok('the seeded example data owns only the three kinds',
    /buildCalendar/.test(DATA) &&
    !/type:\s*'(task|announcement|renewal|trial|payroll)'/.test(
      (DATA.match(/function buildCalendar[\s\S]*?\n}/) || [''])[0]));
}

// =====================================================================
section('2. Video rooms are unique');
// =====================================================================
{
  ok('links are Jitsi rooms under our own prefix',
    /meet\.jit\.si\/TheLabelBoard-/.test(CAL));

  /* The salt is the whole protection. Without it two meetings with the
     same title share a room and one team walks into another team's call. */
  ok('a random salt is generated per link',
    /crypto\.getRandomValues/.test(CAL) &&
    /makeVideoLink[\s\S]{0,700}crypto\.getRandomValues/.test(CAL));
  ok('the salt is at least 10 characters', /new Uint8Array\((1[0-9]|[2-9][0-9])\)/.test(CAL));
  ok('the link is not built from the title alone',
    /salt/.test((CAL.match(/return 'https:\/\/meet\.jit\.si[^\n]*/) || [''])[0]));

  /* Run the real function in-process. */
  const fn = new Function('crypto', CAL.match(/function makeVideoLink[\s\S]*?\n}/)[0] +
    '; return makeVideoLink;')(require('crypto').webcrypto);
  const links = new Set();
  for (let i = 0; i < 500; i++) links.add(fn('Weekly standup'));
  ok('500 links for one title are all distinct', links.size === 500, 'got ' + links.size);
  ok('the shape is right',
    /^https:\/\/meet\.jit\.si\/TheLabelBoard-[a-z0-9-]+-[a-z0-9]{10}$/.test(fn('Weekly standup')));
  ok('a title of only punctuation still yields a room', /TheLabelBoard-meeting-/.test(fn('!!!')));
}

// =====================================================================
section('3. Repeats');
// =====================================================================
{
  const hits = new Function(
    'const DAY=86400000;' +
    'function parseD(v){const p=String(v).split("-");return new Date(+p[0],+p[1]-1,+p[2]);}' +
    CAL.match(/function calHitsDay[\s\S]*?\n}/)[0] + '; return calHitsDay;')();

  ok('an entry lands on its own day', hits({ date: '2026-08-04', repeat: '' }, '2026-08-04'));
  ok('without a repeat it lands nowhere else', !hits({ date: '2026-08-04', repeat: '' }, '2026-08-11'));
  ok('weekly lands 7, 14 and 21 days on',
    ['2026-08-11', '2026-08-18', '2026-08-25'].every(d => hits({ date: '2026-08-04', repeat: 'weekly' }, d)));
  ok('weekly does not land in between', !hits({ date: '2026-08-04', repeat: 'weekly' }, '2026-08-12'));
  ok('fortnightly skips the odd week',
    hits({ date: '2026-08-04', repeat: 'fortnightly' }, '2026-08-18') &&
    !hits({ date: '2026-08-04', repeat: 'fortnightly' }, '2026-08-11'));
  ok('daily lands every day', hits({ date: '2026-08-04', repeat: 'daily' }, '2026-08-09'));
  ok('monthly keeps the day of the month',
    hits({ date: '2026-08-04', repeat: 'monthly' }, '2026-09-04') &&
    !hits({ date: '2026-08-04', repeat: 'monthly' }, '2026-09-05'));
  /* Nothing may appear before it was created. */
  ok('a repeat never lands before its start date',
    !hits({ date: '2026-08-04', repeat: 'daily' }, '2026-08-03') &&
    !hits({ date: '2026-08-04', repeat: 'weekly' }, '2026-07-28'));
  /* Checked against code with comments stripped: the comment explaining
     this design says the word "occurrences" and would fail its own test. */
  ok('repeats are evaluated, not stored as occurrences',
    !/occurrences|expandRepeat|materialise/i.test(CODE) && /calHitsDay/.test(CODE));
}

// =====================================================================
section('4. The lens');
// =====================================================================
{
  ok('there are two lenses, everyone and mine', /calLens === 'mine'/.test(CAL) && /'all'/.test(CAL));
  ok('mine means assigned to me, or I was invited, or I own it',
    /e\.owner === me/.test(CAL) && /invitees \|\| \[\]\)\.indexOf\(me\)/.test(CAL));

  /* Platform-wide items must survive the filter. A support agent still
     needs to know when payroll runs. */
  ok('platform-wide entries stay visible in both lenses',
    /if \(!mine \|\| e\.everyone\) return true/.test(CAL));
  ['announcement', 'renewal', 'trial', 'payroll'].forEach(k => {
    const block = (CAL.match(new RegExp("kind: '" + k + "'[\\s\\S]{0,320}")) || [''])[0];
    ok('  ' + k + ' is marked everyone', /everyone: true/.test(block));
  });
  ok('tasks are NOT marked everyone, so Mine filters them',
    /kind: 'task'[\s\S]{0,320}everyone: false/.test(CAL));

  /* The control should not appear when there is nobody to filter against. */
  ok('the lens control only shows with more than one member of staff',
    /staffCount > 1/.test(CAL));
}

// =====================================================================
section('5. The form trap that cost the customer app a date and a link');
// =====================================================================
{
  /* Changing Type must not rebuild the form; anything read back as empty
     would be wiped. Visibility toggling sidesteps it entirely. */
  ok('changing Type only toggles visibility', /function calTypeChanged/.test(CAL) &&
    /style\.display = t === 'meeting'/.test(CAL));
  ok('changing Type does not re-render the form',
    !/function calTypeChanged[\s\S]{0,300}(formCalEntry|modal\()/.test(CAL));
  ok('the video link is written straight into the input',
    /function calMakeLink[\s\S]{0,300}f\.value = makeVideoLink/.test(CAL));
  ok('making a link does not re-render either',
    !/function calMakeLink[\s\S]{0,300}(render\(\)|formCalEntry)/.test(CAL));
}

// =====================================================================
section('6. Staff only');
// =====================================================================
{
  /* Kayode's decision: a studio owner is never invited from the console
     and never gains a console account. */
  ok('invitees are drawn from staff', /DB\.staff\.map\(s =>[\s\S]{0,200}class="chip/.test(CODE));
  ok('no tenant or subscriber is offered as an invitee',
    !/DB\.subscribers[\s\S]{0,120}chip/.test(CODE) && !/businessId/.test(CODE));
  /* CODE, not CAL: the header comment states this rule too, so a check
     against the raw file matches the prose and can never fail. Mutation
     testing is how that came to light. */
  ok('the form tells the user so, in the markup',
    /Label Board staff only/.test(CODE));
  ok('invitees are stored as ids, not emails',
    /\.map\(b => \+b\.dataset\.id\)/.test(CODE));
}

// =====================================================================
section('7. Wired into the console properly');
// =====================================================================
{
  ok('the page is registered', /PAGES\.calendar = function/.test(CAL));
  ok('the nav carries it', /\['calendar', 'Calendar'/.test(SHELL));
  ok('it has a title and subtitle', /calendar: \['Calendar',/.test(SHELL));
  ok('the script is loaded', /js\/calendar\.js/.test(SHELL));
  ok('loaded after pages2, so PAGES exists',
    SHELL.indexOf('js/pages2.js') < SHELL.indexOf('js/calendar.js'));
  ok('the icon exists in the sprite', /id="i-cal"/.test(SHELL));

  ok('the store is empty on a clean console', /onboarding: \[\], calendar: \[\]/.test(DATA));
  ok('example data seeds it', /calendar: buildCalendar\(staff\)/.test(DATA));
  ok('Load and Clear both reach it', /'calendar', 'activity'/.test(DATA));

  ok('it is in the canonical page list, so it can be granted or revoked',
    /\['calendar', 'Calendar'\]/.test(DATA));
  ok('every default role that has tasks or payroll has it',
    (DATA.match(/pages: \[[^\]]*'calendar'[^\]]*\]/g) || []).length >= 5);
}

// =====================================================================
section('8. The stale-roles trap');
// =====================================================================
{
  /* Saved roles replace DB.roles wholesale. Without a migration the page
     appears for the Owner alone and looks broken for everyone else. */
  ok('a role migration exists', /function migrateRoles/.test(DATA));
  ok('it runs on restore', /DB\.roles = migrateRoles\(r\)/.test(DATA));
  ok('calendar is registered as a new page', /page: 'calendar'/.test(DATA));
  ok('it is granted on the same basis as the defaults',
    /\['tasks', 'payroll'\]\.some/.test(DATA));
  ok('the owner always holds every page that exists',
    /if \(r\.locked\) \{ r\.pages = all\.slice\(\); return; \}/.test(DATA));
  /* And it must not undo a deliberate revoke on the next reload. */
  ok('a marker records that it ran', /ROLE_MIGRATIONS_KEY/.test(DATA));
  ok('an already-introduced page is skipped', /done\.indexOf\(n\.page\) >= 0\) return/.test(DATA));
}

// =====================================================================
section('9. Fits a phone');
// =====================================================================
{
  /* A grid item defaults to min-width:auto and will push the page wider
     than the screen. minmax(0,1fr) is what stops it. */
  ok('the grid uses minmax(0,1fr), not a min-width',
    /\.cal-grid\{[^}]*repeat\(7,minmax\(0,1fr\)\)/.test(CSS));
  ok('the weekday header matches the grid',
    /\.cal-head\{[^}]*repeat\(7,minmax\(0,1fr\)\)/.test(CSS));
  ok('cells never set a min-width', !/\.cal-cell\{[^}]*min-width:\s*[1-9]/.test(CSS));
  ok('there is a narrow-screen refinement', /@media\(max-width:440px\)[\s\S]{0,300}\.cal-grid/.test(CSS));
  ok('day cells stay square', /\.cal-cell\{[^}]*aspect-ratio:1\/1/.test(CSS));
}

// =====================================================================
section('10. Deletion');
// =====================================================================
{
  ok('only the owner of an entry, or someone who manages staff, may delete it',
    /e\.staffId !== ME\.staffId && needs\('manage_staff'/.test(CAL));
  ok('deleting is logged', /logAction\('calendar', 'Calendar entry removed'/.test(CAL));
  ok('creating is logged', /logAction\('calendar'/.test(CAL));
}

console.log('\n' + '='.repeat(64));
if (!fails.length) {
  console.log('ALL ' + pass + ' CHECKS PASSED');
} else {
  console.log(pass + ' passed, ' + fails.length + ' FAILED:');
  fails.forEach(f => console.log('  - ' + f));
}
console.log('='.repeat(64));
process.exit(fails.length ? 1 : 0);
