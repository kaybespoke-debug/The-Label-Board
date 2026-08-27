/* sync_web_shell.js — copy the website header and footer out of index.html
 * into every other page.
 *
 * The public site is plain HTML with no build step, which is what keeps it
 * fast and legible, but it means the navigation exists twelve times. Rather
 * than trust anyone to edit twelve copies, index.html is the original and this
 * copies it out. audit_web.js fails if a page ever drifts, so the two together
 * make duplication safe.
 *
 * Edit the header or footer in web/index.html, then:
 *   node sync_web_shell.js
 *
 * A page that has already been synced is matched on its existing header and
 * footer, so this is safe to run as many times as you like.
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, 'web');
const home = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

function slice(src, startMark, endMark, includeEnd) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error('could not find ' + startMark + ' in index.html');
  return src.slice(a, includeEnd ? b + endMark.length : b).trimEnd();
}

const header = slice(home, '<header class="hdr">', '<main id="main">');
const footer = slice(home, '<footer class="ftr">', '</footer>', true);

let changed = 0, same = 0;
fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'index.html').forEach(f => {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;

  if (s.includes('<!--HEADER-->')) s = s.replace('<!--HEADER-->', header);
  else if (s.includes('<header class="hdr">')) {
    /* the blank line before main is part of the shape every page shares, and
       the slice above drops it, so it goes back in deliberately */
    s = s.slice(0, s.indexOf('<header class="hdr">')) + header + '\n\n' +
        s.slice(s.indexOf('<main id="main">'));
  }

  if (s.includes('<!--FOOTER-->')) s = s.replace('<!--FOOTER-->', footer);
  else if (s.includes('<footer class="ftr">')) {
    const a = s.indexOf('<footer class="ftr">');
    const b = s.indexOf('</footer>', a) + '</footer>'.length;
    s = s.slice(0, a) + footer + s.slice(b);
  }

  if (s === before) { same++; return; }
  fs.writeFileSync(p, s);
  changed++;
  console.log('  updated  ' + f);
});

console.log('\n' + changed + ' page(s) updated, ' + same + ' already in step');
console.log('now run: node audit_web.js\n');
