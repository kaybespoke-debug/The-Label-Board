/* sync_reviews.js — reviews live in one file and this puts them everywhere else.
 *
 * Kayode, 19 September 2026: "we cant wait ... reviews wont get anywhere to
 * fall so it hangs in the cloud." The first studios open accounts in October
 * and the first good thing one of them says about us would have had nowhere to
 * go. So the destination is built before the thing that fills it exists, and
 * this script is the bit that makes landing one a single command.
 *
 * WHAT TO DO IN OCTOBER
 *
 *   1. Paste the card into web/reviews.html, between REVIEWS START and
 *      REVIEWS END. The shape is documented there.
 *   2. node sync_reviews.js
 *   3. node audit_web.js
 *   4. deploy
 *
 * Step 2 does all of this, and refuses to do some of it and not the rest:
 *
 *   - copies the first three cards onto the home page and the pricing page
 *   - takes the hidden attribute off both of those sections
 *   - takes the noindex off reviews.html
 *   - puts reviews.html into sitemap.xml
 *   - puts a link in the footer, then reruns sync_web_shell.js so all twelve
 *     pages get it
 *   - removes the redirects that currently send /reviews to the home page
 *
 * With no reviews it does the exact opposite, so running it on an empty
 * reviews.html puts the site back to where it is today. That is the point: the
 * on state and the off state are both one command, and neither is a checklist
 * anybody has to remember.
 *
 * BEFORE ANY OF IT: the studio has to have said, in a form we can point at
 * later, that we may quote them by name. Nothing in the app records that yet.
 * OUTSTANDING.md carries it as the blocking item.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const dir = path.resolve(__dirname, 'web');
const ON_HOME = 3;

const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
function write(f, s) {
  const p = path.join(dir, f);
  if (fs.readFileSync(p, 'utf8') === s) return false;
  fs.writeFileSync(p, s);
  return true;
}
/* everything under web/ is CRLF on disk and audit_web.js compares the shared
   header byte for byte, so a stray LF is a failed build rather than a nit */
const nl = s => (s.indexOf('\r\n') >= 0 ? '\r\n' : '\n');

const START = '<!-- REVIEWS START -->';
const END = '<!-- REVIEWS END -->';

function cardsIn(src) {
  const a = src.indexOf(START);
  const b = src.indexOf(END, a);
  if (a < 0 || b < 0) throw new Error('the REVIEWS markers are missing');
  return src.slice(a + START.length, b);
}
function countCards(chunk) {
  return (chunk.match(/<article class="rev"/g) || []).length;
}
function putCards(src, chunk) {
  const a = src.indexOf(START);
  const b = src.indexOf(END, a);
  if (a < 0 || b < 0) throw new Error('the REVIEWS markers are missing');
  return src.slice(0, a + START.length) + chunk + src.slice(b);
}
/* the first N cards, whole. Splitting on the opening tag keeps each card
   intact however it is indented. */
function firstCards(chunk, n) {
  const parts = chunk.split('<article class="rev"');
  if (parts.length - 1 <= n) return chunk;
  return parts.slice(0, n + 1).join('<article class="rev"').replace(/\s*$/, '\n');
}

const source = read('reviews.html');
const all = cardsIn(source);
const total = countCards(all);
const live = total > 0;
const eol = nl(source);
const changed = [];

console.log(total + ' review(s) in web/reviews.html');

/* ---- 1. the home page and the pricing page carry the first three ---- */
const share = live ? firstCards(all, ON_HOME) : eol;
['index.html', 'pricing.html'].forEach(f => {
  let s = read(f);
  s = putCards(s, share);
  const openTag = s.match(/<section id="reviews"[^>]*>/);
  if (!openTag) throw new Error(f + ' has no reviews section');
  const wanted = live
    ? openTag[0].replace(' hidden>', '>')
    : (openTag[0].indexOf(' hidden>') >= 0 ? openTag[0] : openTag[0].replace(/>$/, ' hidden>'));
  s = s.split(openTag[0]).join(wanted);
  if (write(f, s)) changed.push(f);
});

/* ---- 2. reviews.html is findable only once there is something on it ---- */
{
  let s = source;
  const tag = '<meta name="robots" content="noindex">' + eol;
  if (live) s = s.split(tag).join('');
  else if (s.indexOf(tag) < 0) s = s.split('<link rel="canonical"').join(tag + '<link rel="canonical"');
  if (write('reviews.html', s)) changed.push('reviews.html');
}

/* ---- 3. the sitemap ---- */
{
  let s = read('sitemap.xml');
  const line = '  <url><loc>https://thelabelboard.com/reviews.html</loc><priority>0.7</priority><changefreq>monthly</changefreq></url>' + nl(s);
  const has = s.indexOf('reviews.html') >= 0;
  if (live && !has) s = s.split('</urlset>').join(line + '</urlset>');
  if (!live && has) s = s.split(line).join('');
  if (write('sitemap.xml', s)) changed.push('sitemap.xml');
}

/* ---- 4. the redirect that keeps it unreachable while it is empty ---- */
{
  let s = read('_redirects');
  const e = nl(s);
  /* The exclamation mark is load bearing and this shipped once without it.
     Netlify applies a redirect only when no file matches the path, and
     reviews.html is a real file, so the plain rule was ignored and the empty
     page was served at /reviews on the live site. The ! forces the rule to win
     over the file. Nothing in a static gate can prove Netlify honours it, so
     the check that caught this was fetching the url after the deploy, and that
     stays the last step of a release. */
  /* Markers, not a text match on the rule itself. The first version of this
     removed the block by searching for its exact lines, so the day the rule
     was corrected the old one had no way of being recognised and the file
     ended up with both. Everything between the markers is this script's, and
     it is thrown away and rewritten every run. */
  const TOP = '# --- REVIEWS, MANAGED BY sync_reviews.js, DO NOT EDIT BY HAND ---';
  const BOT = '# --- END REVIEWS ---';
  const rule = [
    TOP,
    '# There are no reviews yet, so this page is not somewhere to send anybody.',
    '# The ! is load bearing. Netlify applies a redirect only when no file',
    '# matches the path, and reviews.html is a real file, so without it Netlify',
    '# serves the empty page and ignores the rule. It did exactly that once.',
    '/reviews      /index.html     302!',
    '/reviews.html /index.html     302!',
    BOT,
    ''
  ].join(e);

  const a = s.indexOf(TOP);
  if (a >= 0) {
    const b = s.indexOf(BOT, a);
    s = s.slice(0, a) + s.slice(b < 0 ? a : b + BOT.length + e.length);
  } else {
    /* the first version had no markers, so clear its lines by hand, once */
    s = s.split(e).filter(l => l.indexOf('/reviews') !== 0
      && l !== '# There are no reviews yet, so this page is not somewhere to send anybody.'
      && l !== '# sync_reviews.js removes these two lines the moment the first one lands.').join(e);
  }
  while (s.indexOf(e + e + e) >= 0) s = s.split(e + e + e).join(e + e);
  if (!live) s = s.split('/support      /contact.html').join(rule + e + '/support      /contact.html');
  if (write('_redirects', s)) changed.push('_redirects');
}

/* ---- 5. the footer, which lives in index.html and is copied out ---- */
{
  let s = read('index.html');
  const e = nl(s);
  const link = '          <li><a href="reviews.html">What studios say</a></li>' + e;
  const anchor = '          <li><a href="about.html">Our story</a></li>' + e;
  const has = s.indexOf('href="reviews.html">What studios say') >= 0;
  if (live && !has) s = s.split(anchor).join(anchor + link);
  if (!live && has) s = s.split(link).join('');
  if (write('index.html', s) && changed.indexOf('index.html') < 0) changed.push('index.html');
}

console.log(changed.length ? '  updated  ' + changed.join(', ') : '  nothing to change');
console.log('\nrunning sync_web_shell.js so every page gets the same footer');
console.log(cp.execSync('node sync_web_shell.js', { cwd: __dirname }).toString().trim());
console.log('\nnow run: node audit_web.js');
