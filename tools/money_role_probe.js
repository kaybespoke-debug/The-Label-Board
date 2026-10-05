/* =====================================================================
   WHAT EACH ROLE ACTUALLY GETS BACK, ON STAGING, WITH A REAL SESSION.

   STAGING ONLY. The October release moved the selling price into
   order_pricing behind `money` and what has been paid into
   order_settlement behind `receivables`. Hiding a control in the app
   proves nothing about that: the question is what the API hands over to a
   real signed-in member with no app anywhere in the path.

   So this signs in as five people and asks for every part of an order —
   the document, the price, the payment, the cost, the commission, the
   contact — straight at PostgREST. It also tries to WRITE the two new
   ones, because a read boundary with a writable table behind it is not a
   boundary. And it asks for the price through an EMBEDDED read, which is
   the shape that carries a refused table in on the back of a permitted
   one.

   The cast is the one the role model describes:

     OWNER            everything, by tier
     ACCOUNTANT       the money and the books, and no authority over people
     HEAD PRODUCTION  the workroom: orders yes, price no, paid no, cost no
     STAFF            whatever `money` and `receivables` say for staff
     VIEWER           read-only, and only the fields its permissions grant

   NOTHING IS ASSERTED FROM A ROLE NAME. Every expectation is read out of
   business_role_permissions through the API first, because the defaults
   are not what a reasonable person guesses — a manager does not hold
   seeCost, and a staff member does hold seeContact. Writing the answers
   in by hand is how a probe ends up asserting that a bug is correct.

   usage: node tools/money_role_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const BIZ  = '7ab5535d-a5b8-4449-afb1-073cc5dcb280';   // Money Role Proof
const ORD  = 'e33f18e3-badf-4071-b5c5-eb8ca99c9508';
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

/* name, address, membership TIER, the role key they are to hold */
const CAST = [
  ['OWNER',           'probe.money.owner@thelabelboard.com',  'owner',   'owner'],
  ['ACCOUNTANT',      'probe.money.acct@thelabelboard.com',   'staff',   'accountant'],
  ['HEAD PRODUCTION', 'probe.money.hp@thelabelboard.com',     'manager', 'headprod'],
  ['STAFF',           'probe.money.staff@thelabelboard.com',  'staff',   'staff'],
  ['VIEWER',          'probe.money.viewer@thelabelboard.com', 'viewer',  'viewer'],
];

let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, why) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; fails.push(n + (why ? ' — ' + why : '')); console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); }
};
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const fn = async (name, body) => (await fetch(PROJ + '/functions/v1/' + name, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})).json();

const asUser = async (uid, calls) => {
  const r = await fn('as-user', { as_user_id: uid, calls });
  if (!r.results) throw new Error('as-user: ' + JSON.stringify(r).slice(0, 300));
  return r.results;
};
const rows = r => (Array.isArray(r && r.body) ? r.body : []);

/* Every part of the order, each asked for on its own. */
const READS = [
  ['doc',        `/rest/v1/orders?select=app_id,doc,status&business_id=eq.${BIZ}`],
  ['price',      `/rest/v1/order_pricing?select=value,discount,detail&business_id=eq.${BIZ}`],
  ['settlement', `/rest/v1/order_settlement?select=paid,detail&business_id=eq.${BIZ}`],
  ['cost',       `/rest/v1/order_costs?select=cost,detail&business_id=eq.${BIZ}`],
  ['commission', `/rest/v1/order_commissions?select=total&business_id=eq.${BIZ}`],
  ['contact',    `/rest/v1/order_contacts?select=detail&business_id=eq.${BIZ}`],
  ['payments',   `/rest/v1/transactions?select=amount,kind&business_id=eq.${BIZ}`],
  ['items',      `/rest/v1/order_items?select=price&business_id=eq.${BIZ}`],
].map(([label, path]) => ({ label, path }));

/* Which permission each part answers to. Read keys, from the migration. */
const GOVERNS = {
  price: 'money', items: 'money',
  settlement: 'receivables', payments: 'receivables',
  cost: 'seeCost', commission: 'seeCost',
  contact: 'seeContact',
};

(async () => {
  console.log('=== WHAT EACH ROLE GETS BACK, staging, real sessions ===');
  console.log('studio ' + BIZ + ', one order carrying every part\n');

  /* ---------------------------------------------------------------- */
  section('1. The cast');
  /* ---------------------------------------------------------------- */
  const who = {};
  for (const [name, email, tier, roleKey] of CAST) {
    await fn('e2e-fixture', { mode: 'clean', emails: [email] });
    const m = await fn('e2e-fixture', { mode: 'member', email, name, business_id: BIZ, role: tier, role_key: roleKey });
    if (!m.user_id) { ok(name + ' exists', false, JSON.stringify(m).slice(0, 200)); continue; }
    who[name] = { uid: m.user_id, email, roleKey, tier };
  }
  ok('all five accounts exist and belong to the studio',
     CAST.every(([n]) => who[n]), Object.keys(who).join(', '));
  if (fail) { console.log('\nthe cast could not be built'); process.exit(1); }

  /* ---------------------------------------------------------------- */
  section('2. What the DATABASE says each of them holds');
  /* ---------------------------------------------------------------- */
  /* Through the API, as them, so even this is not taken on trust. */
  const perms = {};
  for (const [name] of CAST) {
    const w = who[name];
    if (!w) continue;
    const res = await asUser(w.uid, [
      { label: 'roles', path: `/rest/v1/business_roles?select=id,key,tier,is_system&business_id=eq.${BIZ}` },
      { label: 'perms', path: `/rest/v1/business_role_permissions?select=role_id,permission_key` },
      { label: 'mine',  path: `/rest/v1/memberships?select=role,role_id,status&business_id=eq.${BIZ}&user_id=eq.${w.uid}` },
    ]);
    const roles = rows(res[0]);
    const mine = rows(res[2])[0] || {};
    const myRole = roles.find(r => r.id === mine.role_id);
    w.roleRow = myRole;
    w.roleIds = roles;
    const held = new Set(rows(res[1]).filter(p => p.role_id === mine.role_id).map(p => p.permission_key));
    perms[name] = (mine.role === 'owner') ? 'ALL' : held;
    console.log('  ' + name.padEnd(16) + 'tier ' + (mine.role || '?')
      + ', role ' + (myRole ? myRole.key : '?')
      + ' — ' + (perms[name] === 'ALL' ? 'the owner tier: everything'
                 : ([...held].sort().join(', ') || '(nothing)')));
  }
  const holds = (name, key) => perms[name] === 'ALL' || !!(perms[name] && perms[name].has(key));

  ok('each member holds the role they were given',
     CAST.every(([n, , , rk]) => who[n] && who[n].roleRow && who[n].roleRow.key === rk),
     CAST.map(([n, , , rk]) => n + ':' + ((who[n] && who[n].roleRow && who[n].roleRow.key) || '?') + '/' + rk).join(' '));
  ok('and the accountant is a role we ship rather than a custom one',
     !!(who.ACCOUNTANT && who.ACCOUNTANT.roleRow && who.ACCOUNTANT.roleRow.is_system === true),
     JSON.stringify(who.ACCOUNTANT && who.ACCOUNTANT.roleRow));

  /* ---------------------------------------------------------------- */
  section('3. What the API hands each of them, part by part');
  /* ---------------------------------------------------------------- */
  const matrix = {};
  for (const [name] of CAST) {
    const w = who[name];
    if (!w) continue;
    const res = await asUser(w.uid, READS);
    matrix[name] = {};
    res.forEach((r, i) => { matrix[name][READS[i].label] = rows(r).length; });
    console.log('  ' + name.padEnd(16) + JSON.stringify(matrix[name]));
  }

  for (const [name] of CAST) {
    if (!matrix[name]) continue;
    const m = matrix[name];
    /* AND THE ORDER ROW ITSELF ANSWERS TO `orders`, WHICH THE ACCOUNTANT
       DOES NOT HOLD. That is the role the app has shipped for a long time —
       orders:0, because an accountant works from Finance, Sales and Payroll
       rather than the Orders list — and the database now reproduces it
       faithfully. It is not a leak and it is not new: the production
       accountant role has never held `orders` either. It is the one thing
       this proof turned up that nobody has decided, so it is written down
       in OUTSTANDING.md rather than quietly widened here. `orders` is a
       page permission and granting it is a product decision. */
    const mayOpen = holds(name, 'orders');
    ok(name + (mayOpen ? ' can open the order itself'
                       : ' holds no orders permission, and the order row is refused'),
       mayOpen ? m.doc > 0 : m.doc === 0, m.doc + ' rows');
    for (const part of Object.keys(GOVERNS)) {
      const key = GOVERNS[part];
      const may = holds(name, key);
      const got = m[part] > 0;
      ok('  ' + (may ? 'holds ' + key + ' and IS handed the ' + part
                     : 'lacks ' + key + ' and is REFUSED the ' + part),
         may ? got : !got,
         may ? 'nothing came back' : 'the API returned ' + m[part] + ' row(s)');
    }
  }

  /* ---------------------------------------------------------------- */
  section('4. A read boundary with a writable table behind it is not one');
  /* ---------------------------------------------------------------- */
  /* PostgREST answers a zero-row write with 200 and an empty body, so
     "accepted" has to mean a row came back, not that nothing errored. */
  for (const [name] of CAST) {
    const w = who[name];
    if (!w) continue;
    const res = await asUser(w.uid, [
      { label: 'set the price', path: `/rest/v1/order_pricing?order_id=eq.${ORD}`, method: 'PATCH',
        body: { value: 999999 }, prefer: 'return=representation' },
      { label: 'set what was paid', path: `/rest/v1/order_settlement?order_id=eq.${ORD}`, method: 'PATCH',
        body: { paid: 999999 }, prefer: 'return=representation' },
    ]);
    const priceWrote = rows(res[0]).length > 0;
    const paidWrote  = rows(res[1]).length > 0;
    const mayPrice = holds(name, 'money') && holds(name, 'orders.edit');
    const mayPaid  = holds(name, 'finance.record_payment');

    ok(name + (mayPrice ? ' may set a price, and the API accepts it'
                        : ' may not set a price, and the API writes nothing'),
       mayPrice ? priceWrote : !priceWrote,
       'status ' + res[0].status + ', ' + rows(res[0]).length + ' row(s)');
    ok(name + (mayPaid ? ' may record a payment, and the API accepts it'
                       : ' may not record a payment, and the API writes nothing'),
       mayPaid ? paidWrote : !paidWrote,
       'status ' + res[1].status + ', ' + rows(res[1]).length + ' row(s)');
  }

  /* put the figures back whatever the writes managed */
  await asUser(who.OWNER.uid, [
    { label: 'reset price', path: `/rest/v1/order_pricing?order_id=eq.${ORD}`, method: 'PATCH',
      body: { value: 250000 }, prefer: 'return=representation' },
    { label: 'reset paid', path: `/rest/v1/order_settlement?order_id=eq.${ORD}`, method: 'PATCH',
      body: { paid: 100000 }, prefer: 'return=representation' },
  ]);
  {
    const back = await asUser(who.OWNER.uid, [
      { label: 'price', path: `/rest/v1/order_pricing?select=value&order_id=eq.${ORD}` },
      { label: 'paid',  path: `/rest/v1/order_settlement?select=paid&order_id=eq.${ORD}` },
    ]);
    ok('the figures are back where they started',
       Number(rows(back[0])[0] && rows(back[0])[0].value) === 250000
       && Number(rows(back[1])[0] && rows(back[1])[0].paid) === 100000,
       JSON.stringify([rows(back[0]), rows(back[1])]));
  }

  /* ---------------------------------------------------------------- */
  section('5. An embed does not carry a refused table in with it');
  /* ---------------------------------------------------------------- */
  for (const name of ['HEAD PRODUCTION', 'VIEWER']) {
    const w = who[name];
    if (!w) continue;
    const res = await asUser(w.uid, [
      { label: 'orders+price', path: `/rest/v1/orders?select=app_id,order_pricing(value)&business_id=eq.${BIZ}` },
      { label: 'orders+paid',  path: `/rest/v1/orders?select=app_id,order_settlement(paid)&business_id=eq.${BIZ}` },
      { label: 'orders+cost',  path: `/rest/v1/orders?select=app_id,order_costs(cost)&business_id=eq.${BIZ}` },
    ]);
    const carried = (r, k) => rows(r).some(x => {
      const v = x[k];
      return Array.isArray(v) ? v.length > 0 : !!(v && Object.keys(v).length);
    });
    for (const [i, part, key] of [[0, 'order_pricing', 'money'],
                                  [1, 'order_settlement', 'receivables'],
                                  [2, 'order_costs', 'seeCost']]) {
      const may = holds(name, key);
      ok(name + (may ? ' reaches ' + part + ' through an embed, as they may'
                     : ' cannot reach ' + part + ' through an embed either'),
         may ? carried(res[i], part) : !carried(res[i], part),
         'status ' + res[i].status + ' ' + JSON.stringify(rows(res[i])).slice(0, 120));
    }
  }

  /* ---------------------------------------------------------------- */
  section('6. The accountant runs the books and nothing else');
  /* ---------------------------------------------------------------- */
  {
    const w = who.ACCOUNTANT;
    const myRoleId = w.roleRow && w.roleRow.id;
    const res = await asUser(w.uid, [
      { label: 'settings', path: `/rest/v1/app_state?business_id=eq.${BIZ}&key=eq.layi_dash_settings`,
        method: 'PATCH', body: { data: { hijacked: true } }, prefer: 'return=representation' },
      { label: 'make me owner', path: `/rest/v1/memberships?business_id=eq.${BIZ}&user_id=eq.${w.uid}`,
        method: 'PATCH', body: { role: 'owner' }, prefer: 'return=representation' },
      { label: 'grant myself settings', path: `/rest/v1/business_role_permissions`,
        method: 'POST', body: { role_id: myRoleId, permission_key: 'settings' },
        prefer: 'return=representation' },
      { label: 'delete my own role', path: `/rest/v1/business_roles?id=eq.${myRoleId}`,
        method: 'DELETE', prefer: 'return=representation' },
    ]);

    ok('holds no team permission', !holds('ACCOUNTANT', 'team') && !holds('ACCOUNTANT', 'team.view'),
       [...perms.ACCOUNTANT].filter(k => /team/.test(k)).join(', ') || 'none');
    ok('nor settings, users, audit or editStaff',
       !['settings', 'users', 'audit', 'editStaff'].some(k => holds('ACCOUNTANT', k)),
       [...perms.ACCOUNTANT].filter(k => /settings|users|audit|editStaff/.test(k)).join(', ') || 'none');
    ok('nor anything to do with billing or ownership',
       !['billing.view', 'billing.manage', 'ownership.transfer'].some(k => holds('ACCOUNTANT', k)),
       [...perms.ACCOUNTANT].filter(k => /billing|ownership/.test(k)).join(', ') || 'none');

    ok('the API refuses their write to the studio settings',
       rows(res[0]).length === 0, 'status ' + res[0].status + ', ' + rows(res[0]).length + ' row(s)');
    ok('and refuses to let them make themselves the owner',
       rows(res[1]).length === 0, 'status ' + res[1].status + ', ' + rows(res[1]).length + ' row(s)');
    ok('and refuses to let them grant themselves a permission',
       rows(res[2]).length === 0, 'status ' + res[2].status + ', ' + rows(res[2]).length + ' row(s)');
    ok('and refuses to let them delete the role out from under the books',
       rows(res[3]).length === 0, 'status ' + res[3].status + ', ' + rows(res[3]).length + ' row(s)');

    ok('but they ARE handed what the order sold for', matrix.ACCOUNTANT.price > 0);
    ok('and what has been paid on it', matrix.ACCOUNTANT.settlement > 0);
    ok('and the payments behind that figure', matrix.ACCOUNTANT.payments > 0);
    ok('and the cost, which is what makes a margin possible', matrix.ACCOUNTANT.cost > 0);
  }

  /* ---------------------------------------------------------------- */
  section('7. Margin needs both halves, and neither of them is a field');
  /* ---------------------------------------------------------------- */
  for (const [name] of CAST) {
    if (!matrix[name]) continue;
    const can = matrix[name].price > 0 && matrix[name].cost > 0;
    const should = holds(name, 'money') && holds(name, 'seeCost');
    ok(name + (should ? ' can arrive at a margin, holding both halves'
                      : ' cannot arrive at a margin, missing a half'),
       can === should, 'price ' + matrix[name].price + ', cost ' + matrix[name].cost);
  }

  /* ---------------------------------------------------------------- */
  section('8. Tearing the cast down');
  /* ---------------------------------------------------------------- */
  const cleaned = await fn('e2e-fixture', { mode: 'clean', emails: CAST.map(c => c[1]) });
  ok('the probe accounts are gone', !!cleaned.ok, JSON.stringify(cleaned).slice(0, 200));

  console.log('\n' + '='.repeat(66));
  console.log(pass + ' passed, ' + fail + ' failed');
  for (const f of fails) console.log('  - ' + f);
  if (!fail) {
    console.log('\nThe API itself decides who is told what an order sold for and');
    console.log('what has been paid on it. No app is involved in the answer.');
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('PROBE BROKE: ' + (e && e.message || e)); process.exit(1); });
