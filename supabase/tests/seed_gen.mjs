/* Generate a live studio's starting data by running the app's own example
   loader headlessly, rather than hand-writing rows and guessing at shapes.
   Whatever loadExampleAs() produces is by definition what the app expects
   to read back. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const repo = join(import.meta.dirname, '..', '..');
const html = readFileSync(join(repo, 'site', 'layi_dashboard.html'), 'utf8');

function freshSandbox() {
  const cache = {}; const _ls = {};
  const mkEl = (id) => ({ _id: id, innerHTML: '', value: '', checked: false, textContent: '',
    placeholder: '', style: {}, dataset: {}, options: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    setAttribute() {}, getAttribute() { return null }, appendChild(c) { return c },
    addEventListener() {}, removeEventListener() {}, querySelector() { return null },
    querySelectorAll() { return [] }, focus() {}, select() {}, remove() {}, closest() { return null } });
  const sb = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    document: {
      getElementById(i) { return cache[i] || (cache[i] = mkEl(i)) },
      querySelector() { return mkEl() }, querySelectorAll() { return [] },
      createElement() { return mkEl() }, addEventListener() {}, removeEventListener() {},
      body: mkEl(), documentElement: mkEl(), head: mkEl(), execCommand() { return true },
    },
    localStorage: {
      getItem(k) { return k in _ls ? _ls[k] : null },
      setItem(k, v) { _ls[k] = String(v) },
      removeItem(k) { delete _ls[k] },
    },
    setTimeout: f => { try { f && f() } catch (e) {} }, clearTimeout() {},
    setInterval() {}, clearInterval() {},
    requestAnimationFrame: f => { try { f && f() } catch (e) {} },
    navigator: { userAgent: 'node', onLine: true },
    location: { href: '', hash: '', search: '' },
    alert() {}, confirm() { return true }, prompt() { return '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Promise,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Intl, Error,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
  };
  sb.window = sb; sb.globalThis = sb; sb._ls = _ls;
  return sb;
}

const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, code = '';
while ((m = re.exec(html))) {
  const a = m[1] || '';
  if (/\bsrc\s*=/.test(a)) continue;
  const t = a.match(/type\s*=\s*["']([^"']+)["']/i);
  if (t && !/javascript|module/i.test(t[1])) continue;
  code += '\n;' + m[2] + '\n';
}

const KEYS = JSON.parse(process.env.SEED_KEYS || 'null') || null;
const out = {};
const studios = ['bespoke', 'footwear', 'leather', 'rtw', 'fabrics', 'multi'];

for (const key of studios) {
  const sb = freshSandbox();
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'app' });
  const run = e => vm.runInContext(e, sb);
  run('loadExample(true);');
  if (key !== 'multi') run(`applyExampleStudio(${JSON.stringify(key)});`);
  const stateKeys = run('STATE_KEYS');
  const bundle = { state: {}, customers: run('getCustomers()'), suppliers: run('getSuppliers()') };
  for (const k of stateKeys) {
    const v = run(`load(${JSON.stringify(k)}, null)`);
    if (v != null) bundle.state[k] = v;
  }
  /* The app loads settings as Object.assign({}, DEFAULTS, saved), so only the
     keys that actually differ from DEFAULTS need to be stored. Six near
     identical copies of the same tier ladder, QC checklist and message
     templates are noise in a migration, and noise in a migration is where a
     value nobody meant to pin gets pinned. */
  const defaults = run('DEFAULTS');
  const full = bundle.state['layi_dash_settings'] || {};
  const diff = {};
  for (const k of Object.keys(full)) {
    if (JSON.stringify(full[k]) !== JSON.stringify(defaults[k])) diff[k] = full[k];
  }
  bundle.settingsDiff = diff;
  out[key] = bundle;
  const bytes = Buffer.byteLength(JSON.stringify(bundle));
  const co = run('(SETTINGS.company&&SETTINGS.company.name)||""');
  const orders = run('rawOrders().length');
  const prods = run('getProducts().length');
  const staff = run('getStaff().length');
  const custs = Object.keys(bundle.customers || {}).length;
  console.log(
    key.padEnd(9) + String(co).padEnd(22) +
    'orders ' + String(orders).padStart(3) +
    '  products ' + String(prods).padStart(3) +
    '  staff ' + String(staff).padStart(3) +
    '  customers ' + String(custs).padStart(3) +
    '  ' + (bytes / 1024).toFixed(0).padStart(4) + ' KB');
}

mkdirSync(join(repo, '.seed'), { recursive: true });
writeFileSync(join(repo, '.seed', 'studios.json'), JSON.stringify(out));
console.log('\ntotal ' + (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0) + ' KB written to .seed/studios.json');
