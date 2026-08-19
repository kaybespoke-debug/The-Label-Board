// parsecheck.js — extract inline <script> blocks from the HTML and syntax-check each with the V8 parser.
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2] || 'layi_dashboard.html';
const html = fs.readFileSync(file, 'utf8');

// Match <script ...>...</script> but skip src-only and non-JS type scripts.
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, idx = 0, errors = 0;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  const code = m[2] || '';
  idx++;
  if (/\bsrc\s*=/.test(attrs)) continue;               // external script, nothing inline
  const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/i);
  if (typeMatch && !/javascript|module|^text\/babel$/i.test(typeMatch[1])) continue; // json, template, etc.
  if (!code.trim()) continue;
  const line = html.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(code, { filename: `${file}#script${idx}@L${line}` });
  } catch (e) {
    errors++;
    console.error(`✗ script #${idx} (starts ~line ${line}): ${e.message}`);
    // Try to surface the offending line
    const lm = String(e.stack || '').match(/@L(\d+)[^\n]*:(\d+)/);
    if (lm) console.error(`   near HTML line ~${(+lm[1]) + (+lm[2]) - 1}`);
  }
}

if (errors === 0) console.log(`0 errors — ${idx} script block(s) checked in ${file}`);
else { console.error(`\n${errors} error(s) found`); process.exit(1); }
