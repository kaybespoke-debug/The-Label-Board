/* =====================================================================
   P2 AT THE API — the orders move, and the blob stops being a way round
   seeCost and seeContact.

   STAGING ONLY. Real sessions, straight to PostgREST, because a policy
   that holds in a local Postgres can still be handed round by the HTTP
   layer: a zero-row write answers 200, a RETURNING clause runs the SELECT
   policy, and an embedded resource can carry a table you were refused on
   its own. None of that is visible to a harness that speaks SQL.

   The shape of the fixture is the shape of the 68 production orders,
   including the three sensitive things that hide one level down —
   saleItems[].unitCost, delivery.location and commissions[] — because a
   fixture built from the schema instead of the data is how both the app
   and the migration function came to strip four field names that no order
   has ever had.

   Every refusal is shown next to the same read succeeding for somebody
   who is allowed it. Nothing is printed that a person could not already
   see, and no secret value appears in the output.

   usage: node tools/order_migration_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const BIZ = '9b2e7a10-0000-4000-8000-000000000002';   // P2 Probe Studio
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

const E = {
  owner:     'probe.p2.owner@thelabelboard.com',
  manager:   'probe.p2.manager@thelabelboard.com',
  staff:     'probe.p2.staff@thelabelboard.com',
  viewer:    'probe.p2.viewer@thelabelboard.com',
  nocost:    'probe.p2.nocost@thelabelboard.com',
  nocontact: 'probe.p2.nocontact@thelabelboard.com',
};

let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const fn = async (name, body) => (await fetch(PROJ + '/functions/v1/' + name, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})).json();
const call = async (uid, c) => (await fn('as-user', { as_user_id: uid, calls: [c] })).results[0];
const rows = r => (Array.isArray(r && r.body) ? r.body : []);

/* a sentinel per run, so a leak is unmistakable without printing a secret */
const TAG = 'p2probe' + Date.now();

const order = (i, o) => ({
  id: TAG + '-' + i, client: 'Client ' + i, branch: 'Lagos', value: o.value,
  paid: Math.floor(o.value / 2), discount: 0, stageIndex: 3, due: '2026-10-20',
  createdAt: '2026-09-1' + (i % 10) + 'T09:00:00.000Z', garment: 'Agbada', kind: 'bespoke',
  currency: 'NGN', fx: 1, makerId: '', invoiceNo: null, satisfaction: 5,
  email: '', whatsapp: '', address: '',
  costs: (o.costs || []).map((a, n) => ({ label: 'Fabric ' + n, amount: a, supplier: 'Aso-oke House' })),
  commissions: (o.comms || []).map((a, n) => ({ staffId: 'st-' + n, kind: 'maker', work: 'sewing', amount: a, paid: false })),
  directorOn: !!o.director, directorPct: o.director ? 10 : 0, directorAmount: o.director || null,
  referrerId: '', referralAmount: 0,
  saleItems: (o.items || []).map((it, n) => ({ productId: 'p-' + n, variantId: '', label: 'Item ' + n,
    qty: it.qty, unitPrice: it.price, unitCost: it.cost })),
  outfits: [{ name: 'Main', price: o.value, stageIndex: 3, person: 'Wearer ' + i, meas: { Chest: '40' }, photos: [] }],
  delivery: o.to ? { enabled: true, company: 'GIG', fee: 3500, status: 'booked', tracking: 'T' + i, location: o.to }
                 : { enabled: false, company: '', fee: 0, status: '', tracking: '' },
  updates: [{ at: '2026-09-20T10:00:00.000Z', by: 'Ada', stage: 2, note: 'cut', workerId: 'st-0', photos: [] }],
  qc: { status: 'passed', at: '2026-09-22T10:00:00.000Z', by: 'Ada', note: '', items: [] },
  batch: { on: false, qty: 1, reached: 0 }, group: { on: false },
  potContribs: [], stockUsed: [], clientPhotos: [],
});

const ACTIVE = [
  order(1, { value: 250000, costs: [60000, 15000], comms: [30000], items: [{ qty: 2, price: 50000, cost: 20000 }], to: TAG + ' Bode Thomas' }),
  order(2, { value: 180000, costs: [40000], comms: [20000, 5000], items: [] }),
  order(3, { value: 90000, costs: [], comms: [], items: [{ qty: 1, price: 90000, cost: 30000 }] }),
];
const DONE = [
  order(4, { value: 300000, costs: [70000], comms: [35000], items: [], director: 12000, to: TAG + ' Balogun Market' }),
];
const SRC_VALUE = [...ACTIVE, ...DONE].reduce((a, o) => a + o.value, 0);
const SRC_COST = [...ACTIVE, ...DONE].reduce((a, o) => a + o.costs.reduce((x, c) => x + c.amount, 0), 0);
const SRC_COMM = [...ACTIVE, ...DONE].reduce((a, o) => a + o.commissions.reduce((x, c) => x + c.amount, 0) + (o.directorAmount || 0), 0);
const SRC_CONTACTS = [...ACTIVE, ...DONE].filter(o => o.delivery.location).length;

(async () => {
  console.log('=== P2 AT THE API, staging ===');
  await fn('e2e-fixture', { mode: 'clean', business_id: BIZ, emails: Object.values(E) });

  const who = {};
  for (const [k, email] of Object.entries(E)) {
    const role = (k === 'nocost' || k === 'nocontact') ? 'manager' : k;
    who[k] = await fn('e2e-fixture', { mode: 'member', email, name: 'P2 ' + k, business_id: BIZ, role });
  }
  ok('the cast exists', Object.values(who).every(x => x && x.user_id),
     JSON.stringify(Object.entries(who).map(([k, v]) => k + ':' + !!(v && v.user_id))));
  if (fail) { console.log('\ncould not build the cast; stopping'); process.exit(1); }

  /* RESET, because a gate that only works the first time is not a gate.
     The first run of this probe migrated the studio and retired its blob,
     so the second run could not write a blob at all — the refusal trigger
     saw the relational orders and said "this app is out of date", which
     was the trigger being right and the probe being wrong. */
  section('0. Putting the studio back the way a studio starts');
  {
    const del = await call(who.owner.user_id, {
      method: 'DELETE', path: '/rest/v1/orders?business_id=eq.' + BIZ });
    ok('last run\u2019s orders are cleared', del.status < 300, 'status ' + del.status);
    await call(who.owner.user_id, {
      method: 'DELETE', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=like.layi_dash_orders*' });
    for (const k of ['p2nocost', 'p2nocontact']) {
      await call(who.owner.user_id, {
        method: 'DELETE', path: '/rest/v1/business_roles?business_id=eq.' + BIZ + '&key=eq.' + k });
    }
    const left = rows(await call(who.owner.user_id, {
      method: 'GET', path: '/rest/v1/orders?business_id=eq.' + BIZ + '&select=app_id' })).length;
    ok('  the studio has no relational orders to start from', left === 0, left + ' left');
  }

  section('0b. The studio starts with the orders in a blob');
  {
    const put = await call(who.owner.user_id, {
      method: 'POST', path: '/rest/v1/app_state', prefer: 'resolution=merge-duplicates',
      body: [{ business_id: BIZ, key: 'layi_dash_orders', data: ACTIVE },
             { business_id: BIZ, key: 'layi_dash_orders_done', data: DONE }] });
    ok('the blob is written', put.status < 300, 'status ' + put.status + ' ' + JSON.stringify(put.body || '').slice(0, 160));

    /* THE FINDING, at the API, as the lowest role there is. */
    const leak = await call(who.viewer.user_id, {
      method: 'GET', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=eq.layi_dash_orders&select=data' });
    const got = JSON.stringify(leak.body || '');
    ok('a viewer is handed the whole blob', rows(leak).length === 1, 'status ' + leak.status);
    ok('  including the costs', /"amount":60000/.test(got));
    ok('  the commissions', /"amount":30000/.test(got));
    ok('  a unit cost inside a sold item', /"unitCost":20000/.test(got));
    ok('  and a delivery address', got.includes(TAG + ' Bode Thomas'));
  }

  section('1. The owner moves them, through the public RPC');
  {
    const mig = await call(who.owner.user_id, {
      method: 'POST', path: '/rest/v1/rpc/migrate_my_orders', body: { p_business: BIZ } });
    const r = rows(mig)[0] || mig.body || {};
    ok('the migration ran', mig.status < 300, 'status ' + mig.status + ' ' + JSON.stringify(mig.body || '').slice(0, 200));
    ok('  it saw every order', Number(r.blob_orders) === 4 && Number(r.rows_after) === 4, JSON.stringify(r));
    ok('  the money came across', Number(r.rows_total) === SRC_VALUE, r.rows_total + ' vs ' + SRC_VALUE);
    ok('  and it reports matched from the reconciliation', r.matched === true, String(r.matched));

    const nonOwner = await call(who.manager.user_id, {
      method: 'POST', path: '/rest/v1/rpc/migrate_my_orders', body: { p_business: BIZ } });
    ok('a manager cannot run it', nonOwner.status >= 400, 'status ' + nonOwner.status);
  }

  section('2. Reconciled, identifier by identifier');
  {
    const rec = await call(who.owner.user_id, {
      method: 'POST', path: '/rest/v1/rpc/reconcile_my_orders', body: { p_business: BIZ } });
    const R = (Array.isArray(rec.body) ? rec.body[0] : rec.body) || {};
    ok('counts agree', R.source_orders === R.destination_orders, R.source_orders + ' vs ' + R.destination_orders);
    ok('nothing is missing', (R.missing_identifiers || []).length === 0, JSON.stringify(R.missing_identifiers));
    ok('nothing is duplicated', (R.duplicate_identifiers || []).length === 0, JSON.stringify(R.duplicate_identifiers));
    ok('the money matches', Number(R.source_money) === SRC_VALUE && Number(R.destination_money) === SRC_VALUE,
       R.source_money + ' / ' + R.destination_money);
    ok('the costs match', Number(R.source_cost) === SRC_COST && Number(R.destination_cost) === SRC_COST,
       R.source_cost + ' / ' + R.destination_cost);
    ok('the commissions match', Number(R.source_commission) === SRC_COMM && Number(R.destination_commission) === SRC_COMM,
       R.source_commission + ' / ' + R.destination_commission);
    ok('every delivery address arrived', Number(R.destination_contacts) === SRC_CONTACTS,
       R.destination_contacts + ' vs ' + SRC_CONTACTS);
    ok('no branch, client, assignment or status mismatched',
       [R.branch_mismatches, R.customer_mismatches, R.assignment_mismatches, R.status_mismatches].every(x => Number(x) === 0),
       JSON.stringify([R.branch_mismatches, R.customer_mismatches, R.assignment_mismatches, R.status_mismatches]));
    ok('and no secret survived into the order document',
       Number(R.doc_still_carrying_a_secret) === 0, String(R.doc_still_carrying_a_secret));
    ok('so it is green', R.green === true, String(R.green));
  }

  section('3. Six roles, asked directly');
  {
    /* The two custom roles: a manager minus exactly one permission, made
       through the API by the owner, the way a studio would make one. */
    const roleOf = async (key) => rows(await call(who.owner.user_id, {
      method: 'GET', path: '/rest/v1/business_roles?business_id=eq.' + BIZ + '&key=eq.' + key + '&select=id' }))[0];
    const mgrRole = await roleOf('manager');

    /* manager holds neither by default — grant both, so it is the control
       that CAN see and the two custom roles differ by one thing each */
    for (const p of ['seeCost', 'seeContact']) {
      await call(who.owner.user_id, { method: 'POST', path: '/rest/v1/business_role_permissions',
        prefer: 'resolution=ignore-duplicates', body: { role_id: mgrRole.id, permission_key: p } });
    }
    for (const [k, drop] of [['nocost', 'seeCost'], ['nocontact', 'seeContact']]) {
      const made = await call(who.owner.user_id, { method: 'POST', path: '/rest/v1/business_roles',
        prefer: 'return=representation', body: { business_id: BIZ, key: 'p2' + k, name: 'Floor (' + k + ')', tier: 'manager' } });
      const rid = rows(made)[0] && rows(made)[0].id;
      if (!rid) { ok('the ' + k + ' role was created', false, JSON.stringify(made.body || '').slice(0, 160)); continue; }
      /* A NEW ROLE ARRIVES WITH ITS TIER'S PERMISSIONS ALREADY GRANTED, by
         the seeding trigger. So copying the manager's list in and leaving
         one out does not remove it — the seed had already put it there.
         The one being dropped has to be deleted. This is why the first run
         reported that a role called "no seeContact" could see the delivery
         addresses, and passed, because the helper agreed with it. */
      const perms = rows(await call(who.owner.user_id, {
        method: 'GET', path: '/rest/v1/business_role_permissions?role_id=eq.' + mgrRole.id + '&select=permission_key' }));
      for (const p of perms.map(x => x.permission_key).filter(x => x !== drop)) {
        await call(who.owner.user_id, { method: 'POST', path: '/rest/v1/business_role_permissions',
          prefer: 'resolution=ignore-duplicates', body: { role_id: rid, permission_key: p } });
      }
      await call(who.owner.user_id, { method: 'DELETE',
        path: '/rest/v1/business_role_permissions?role_id=eq.' + rid + '&permission_key=eq.' + drop });
      const still = rows(await call(who.owner.user_id, {
        method: 'GET', path: '/rest/v1/business_role_permissions?role_id=eq.' + rid +
                            '&permission_key=eq.' + drop + '&select=permission_key' })).length;
      ok('  and ' + drop + ' really is gone from it', still === 0, still + ' still granted');
      await call(who.owner.user_id, { method: 'PATCH',
        path: '/rest/v1/memberships?business_id=eq.' + BIZ + '&user_id=eq.' + who[k].user_id,
        body: { role: 'manager', role_id: rid } });
      ok('the ' + k + ' role was created and assigned', true);
    }

    /* Asked of the database, not written down here, because the defaults
       are not what a reasonable person guesses: a manager does not hold
       seeCost, and a staff member does hold seeContact. The first version
       of this helper mixed .some() with an async callback, which is always
       truthy, so it answered "yes" for everybody — and every assertion
       still passed, because the rows were there to see. */
    const holds = async (k, perm) => {
      const m = rows(await call(who.owner.user_id, {
        method: 'GET', path: '/rest/v1/memberships?business_id=eq.' + BIZ +
                            '&user_id=eq.' + who[k].user_id + '&select=role,role_id' }))[0];
      if (!m) return false;
      if (m.role === 'owner') return true;
      if (!m.role_id) return false;
      return rows(await call(who.owner.user_id, {
        method: 'GET', path: '/rest/v1/business_role_permissions?role_id=eq.' + m.role_id +
                            '&permission_key=eq.' + perm + '&select=permission_key' })).length > 0;
    };

    for (const [what, table, perm] of [
      ['the costs', 'order_costs', 'seeCost'],
      ['the commissions', 'order_commissions', 'seeCost'],
      ['the delivery addresses', 'order_contacts', 'seeContact'],
    ]) {
      for (const k of ['owner', 'manager', 'staff', 'viewer', 'nocost', 'nocontact']) {
        const may = await holds(k, perm);
        const r = await call(who[k].user_id, {
          method: 'GET', path: '/rest/v1/' + table + '?business_id=eq.' + BIZ + '&select=*' });
        const n = rows(r).length;
        ok(k + (may ? ' holds ' + perm + ' and sees ' + what : ' lacks ' + perm + ' and is refused ' + what),
           may ? n > 0 : n === 0, 'status ' + r.status + ', ' + n + ' rows');
      }
    }

    section('4. And the document itself carries nothing protected');
    for (const k of ['owner', 'manager', 'staff', 'viewer', 'nocost', 'nocontact']) {
      const r = await call(who[k].user_id, {
        method: 'GET', path: '/rest/v1/orders?business_id=eq.' + BIZ + '&select=app_id,total,status,doc' });
      const j = JSON.stringify(r.body || '');
      ok(k + ' reads the orders but no cost, commission or address is in them',
         rows(r).length === 4 && !/"costs"|"commissions"|"unitCost"|"directorAmount"/.test(j) && !j.includes(TAG + ' Bode'),
         'status ' + r.status + ', ' + rows(r).length + ' rows');
    }

    section('5. An embedded read is not a way round it either');
    /* PostgREST will happily join a table you were refused on its own, and
       the answer comes back inside a resource you ARE allowed — which is a
       different question from "can you select it directly" and has to be
       asked separately.

       Per permission, not per person. The first version of this check
       expected a staff member to be refused the contacts, and a staff
       member holds seeContact by default, on purpose, because somebody has
       to ring the client. The embed was behaving correctly and the
       assertion was wrong. */
    for (const k of ['staff', 'viewer', 'nocost', 'nocontact']) {
      const mayCost = await holds(k, 'seeCost');
      const mayContact = await holds(k, 'seeContact');
      const r = await call(who[k].user_id, {
        method: 'GET', path: '/rest/v1/orders?business_id=eq.' + BIZ + '&select=app_id,order_costs(cost),order_commissions(total),order_contacts(detail)' });
      const got = rows(r);
      const sawCost = got.some(o => o.order_costs || o.order_commissions);
      const sawContact = got.some(o => o.order_contacts);
      ok(k + ' gets costs through an embed only with seeCost',
         sawCost === mayCost, 'holds ' + mayCost + ', saw ' + sawCost);
      ok(k + ' gets contacts through an embed only with seeContact',
         sawContact === mayContact, 'holds ' + mayContact + ', saw ' + sawContact);
    }
  }

  section('6. Retiring the blob, and the bypass with it');
  {
    const before = await call(who.viewer.user_id, {
      method: 'GET', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=eq.layi_dash_orders&select=data' });
    ok('the blob is still readable by a viewer right up until it is retired', rows(before).length === 1);

    const notOwner = await call(who.manager.user_id, {
      method: 'POST', path: '/rest/v1/rpc/retire_my_order_blob', body: { p_business: BIZ } });
    ok('a manager cannot retire it', notOwner.status >= 400, 'status ' + notOwner.status);

    const done = await call(who.owner.user_id, {
      method: 'POST', path: '/rest/v1/rpc/retire_my_order_blob', body: { p_business: BIZ } });
    const D = (Array.isArray(done.body) ? done.body[0] : done.body) || {};
    ok('the owner can, once it reconciles', done.status < 300 && D.retired === true,
       'status ' + done.status + ' ' + JSON.stringify(done.body || '').slice(0, 200));

    const after = await call(who.viewer.user_id, {
      method: 'GET', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=eq.layi_dash_orders&select=data' });
    ok('and the read that handed a viewer every cost now returns nothing',
       rows(after).length === 0, 'status ' + after.status + ', ' + rows(after).length + ' rows');

    const stale = await call(who.owner.user_id, {
      method: 'POST', path: '/rest/v1/app_state', prefer: 'resolution=merge-duplicates',
      body: { business_id: BIZ, key: 'layi_dash_orders', data: ACTIVE } });
    ok('a stale client cannot put it back, and is told why',
       stale.status >= 400 && /out of date/.test(JSON.stringify(stale.body || '')),
       'status ' + stale.status + ' ' + JSON.stringify(stale.body || '').slice(0, 140));

    const orders = await call(who.owner.user_id, {
      method: 'GET', path: '/rest/v1/orders?business_id=eq.' + BIZ + '&select=app_id,total' });
    const sum = rows(orders).reduce((a, o) => a + Number(o.total || 0), 0);
    ok('and every order is still there, worth what it was',
       rows(orders).length === 4 && sum === SRC_VALUE, rows(orders).length + ' orders, ' + sum);
  }

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) console.log('\nP2 IS NOT SAFE TO PROMOTE.');
  else console.log('\nThe orders moved, every figure reconciles, the blob is gone and\nno role reaches a cost or a contact it has no permission for.');
  process.exit(fail ? 1 : 0);
})();
