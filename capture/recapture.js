/* Recapture the product screenshots from the example studio.

   THE FRAMING IS THE WHOLE JOB. The last attempt at these recaptured them at
   a window size that felt sensible, which relaid the app out, rewrapped the
   card rows and drew the software smaller inside the picture. Kayode's
   answer: "i didnt ask you to change the images/screenshots".

   So the settings below were not chosen, they were MEASURED back off the
   committed originals. scratchpad/measure.js scans one row of pixels across
   the KPI band and reports where each card starts and ends as a fraction of
   the image width; two captures whose runs line up are the same layout. The
   numbers here reproduce the originals to within about five pixels in 1328.

     orders, stock, production, dash    window 1010 wide, crop x=80 w=927
     branches                           window 1600 wide, crop x=61 w=1535

   Why two recipes: the dashboard shot on the product page is the same screen
   as the one in the hero, captured wider so it comes out shorter. That was
   already true and is not something to tidy.

   The crop takes the collapsed sidebar's icon rail off the left. The rail is
   furniture; the software is the part to the right of it.

   node scratchpad/recapture.js      (needs http-server on :8010 at the repo root) */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/* Chrome, wherever it is. Edge renders this identically but is not what the
   originals were taken with, and a font hinting difference would show. */
const CHROME = process.env.CHROME ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:8010/capture/shot.html';
const REPO = path.join(__dirname, '..');
/* Straight into the published folder. These ARE the shipped pictures; there
   is no staging copy to forget to promote. */
const OUT = path.join(REPO, 'web', 'img', 'screens');

/* name, hash view, extra calls, window w, window h, crop x, crop w */
const SHOTS = [
  ['dash',       'activity',   '',                  1010, 742, 80, 927],
  ['orders',     'orders',     '',                  1010, 605, 80, 927],
  ['production', 'production', '',                  1010, 605, 80, 927],
  ['stock',      'supplies',   '',                  1010, 605, 80, 927],
  /* All time, because the demo's current month has three of the four outlets
     at zero and this is the picture that has to show four outlets trading.
     The original carries the same decision; it is in web/img/README.txt. */
  ['branches',   'activity',   ',setGlobalPeriod:all', 1600, 1002, 61, 1535]
];

fs.mkdirSync(OUT, { recursive: true });

SHOTS.forEach(function (s) {
  const [name, view, extra, w, h, cx, cw] = s;
  const url = BASE + '?theme=black&call=toggleSidebar' + extra + '#' + view;
  const raw = path.join(require('os').tmpdir(), '_raw_' + name + '.png');
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=' + w + ',' + h,
    '--virtual-time-budget=5000',
    '--screenshot=' + raw, url
  ], { stdio: 'pipe' });

  execFileSync('node', [
    path.join(REPO,'tools_pngcrop.js'),
    raw, OUT, name + ':' + cx + ',0,' + cw + ',' + h + ',1328'
  ], { stdio: 'pipe', cwd: REPO });

  const made = path.join(OUT, name + '.png');
  const b = fs.readFileSync(made);
  console.log('  ' + name.padEnd(12) + b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) +
    '  ' + Math.round(b.length / 1024) + 'KB');
});
console.log('\nCaptured into ' + OUT + '. Nothing copied into web/img/screens yet.');
