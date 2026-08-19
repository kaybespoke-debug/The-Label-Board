/* audit_sort.js — the shared list sorting.
 *
 * Why this gate exists: every long list used to carry a sort order baked into its
 * renderer, and one of them (customers, by spend) pushed a brand new client to the
 * very bottom, which is the worst place for the person you most likely want. The
 * fix was a shared control on six lists. This gate stops the wiring rotting:
 * the control must exist for each list, every comparator must actually reorder,
 * the choice must be remembered per list, a new customer must reach the top under
 * "Newest first", and Production must stay UNSORTABLE because its order is its
 * meaning.
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || 'layi_dashboard.html');
const src = fs.readFileSync(file, 'utf8');
const fail = [];
const ok = [];
const check = (cond, msg) => (cond ? ok : fail).push(msg);

/* ---------- 1. the engine is present ---------- */
for (const fn of ['sortPref', 'setSort', 'applySort', 'sortInPlace', 'renderSortControl', 'custAdded']) {
  check(new RegExp('function\\s+' + fn + '\\s*\\(').test(src), 'engine: ' + fn + '() defined');
}

/* ---------- 2. every list has a control, options and wiring ---------- */
const LISTS = {
  customers: 'renderCustomers',
  orders:    'renderOrders',
  team:      'renderTeam',
  supplies:  'renderSupplies',
  suppliers: 'renderSuppliers',
  products:  'renderProducts',
};
for (const [key, renderer] of Object.entries(LISTS)) {
  check(src.includes('id="sort_' + key + '"'), key + ': control in the markup');
  check(src.includes("setSort('" + key + "'"), key + ': control calls setSort');
  check(src.includes("renderSortControl('" + key + "')"), key + ': options are populated');
  check(new RegExp("(applySort|sortInPlace)\\('" + key + "'").test(src), key + ': renderer applies the sort');
  check(src.includes(renderer), key + ': renderer ' + renderer + ' still exists');
}

/* ---------- 3. each list offers three real choices ---------- */
const cfg = src.match(/const SORTS=\{[\s\S]*?\n\};/);
check(!!cfg, 'SORTS config block found');
if (cfg) {
  for (const key of Object.keys(LISTS)) {
    const block = cfg[0].match(new RegExp(key + ':\\s*\\[[\\s\\S]*?\\]'));
    check(!!block, key + ': has a SORTS entry');
    if (block) {
      const opts = (block[0].match(/\{v:/g) || []).length;
      check(opts >= 3, key + ': offers ' + opts + ' sort options (need 3+)');
      check(/label:'[^']+'/.test(block[0]), key + ': options are labelled');
    }
  }
  /* an alphabetical option everywhere, since that is the one people reach for */
  const azCount = (cfg[0].match(/_az\(/g) || []).length;
  check(azCount >= 6, 'alphabetical comparators present (' + azCount + ')');
}

/* ---------- 4. the preference is remembered, per list, per device ---------- */
check(/localStorage\.getItem\('layi_sort'\)/.test(src), 'preference is read from storage');
check(/localStorage\.setItem\('layi_sort'/.test(src), 'preference is written to storage');
check(!/STATE_KEYS.*layi_sort|layi_sort.*STATE_KEYS/.test(src),
      'preference is NOT cloud-synced (a view setting, not business data)');

/* ---------- 5. a new customer can actually reach the top ---------- */
check(/createdAt:ex\.createdAt\|\|new Date\(\)\.toISOString\(\)/.test(src),
      'customers: createdAt is stamped and preserved across rewrites');
const stamps = (src.match(/createdAt:(?:ex\.createdAt\|\|)?new Date\(\)\.toISOString\(\),name/g) || []).length;
check(stamps >= 4, 'customers: every write site stamps createdAt (' + stamps + ' of 4)');
check(/m\.createdAt=p\.createdAt/.test(src),
      'customers: createdAt is carried into the list objects (otherwise Newest first is dead)');
check(/function custAdded[\s\S]{0,320}getOrders\(\)/.test(src),
      'customers: falls back to first order date for records predating the stamp');

/* ---------- 6. Production stays out of it, deliberately ---------- */
check(!src.includes('id="sort_production"'), 'production: has NO sort control');
check(!/(applySort|sortInPlace)\('production'/.test(src), 'production: renderer does not apply a sort');
check(!/production:\s*\[\{v:/.test(src), 'production: absent from the SORTS config');
check(/ordering is the information|order IS the information|ordered by urgency/i.test(src),
      'production: the exclusion is explained in a comment');

/* ---------- 7. the labels do not lie ---------- */
const inv = cfg && cfg[0].match(/supplies:\s*\[[\s\S]*?\]/);
if (inv) {
  const claimsNewest = /label:'Newest first'/.test(inv[0]);
  const usesUpdated  = /updatedAt/.test(inv[0]);
  check(!(claimsNewest && usesUpdated),
        'inventory: does not claim "Newest first" while sorting on updatedAt');
}

/* ---------- report ---------- */
console.log(ok.map(m => '  ok   ' + m).join('\n'));
if (fail.length) {
  console.error('\n' + fail.map(m => '  FAIL ' + m).join('\n'));
  console.error('\n' + fail.length + ' sorting check(s) failed.');
  process.exit(1);
}
console.log('\n\u2713 six lists sortable and remembered, a new client reaches the top, production left alone');
