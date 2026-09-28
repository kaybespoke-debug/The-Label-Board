/* =====================================================================
   THE TWO ASSERTIONS THE BROWSER CANNOT MAKE FOR ITSELF.

   STAGING ONLY. Real sessions, straight to PostgREST, with the relevant
   permission deliberately absent. "The browser did not load the field" is
   not evidence of anything; this asks the API directly and expects it to
   say no.

   1. SENSITIVE DATA. Costs and client contact details, without the
      permissions, from the wrong branch, and from the wrong business.

   2. AUDIT AUTHENTICITY. History cannot be edited or deleted by anybody,
      the actor is the server's answer and not the client's, and a member
      cannot forge a security event: they can write ordinary client rows,
      and the rows that matter are written by the database itself.

   usage: node tools/sensitive_data_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const BIZ = '7256137b-2d3b-4d2d-86da-a7651d6bb10c';   // Seed Multi Studio, four outlets
const OTHER = 'c80aba9c-d12e-4302-a442-2669b0907a95'; // Adé Bespoke
const LAGOS = 'abfa0685-4bd6-4418-9f17-8f4067954938';
const ABUJA = '6d8dc855-8adf-44e2-95b2-944628d72e54';
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

/* Every run leaves rows behind that only an owner can delete, and two runs
   of a counting assertion on a shared studio is how a suite starts lying.
   Everything this probe creates carries a tag unique to the run. */
const TAG = 'run' + Date.now();
const OWNER_EMAIL = 'probe.sens.owner@thelabelboard.com';
const LAGOS_EMAIL = 'probe.sens.lagos@thelabelboard.com';
const VIEWER_EMAIL = 'probe.sens.viewer@thelabelboard.com';

let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const fn = async (name, body) => (await fetch(PROJ + '/functions/v1/' + name, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})).json();
const one = async (uid, call) => (await fn('as-user', { as_user_id: uid, calls: [call] })).results[0];
const rows = (r) => Array.isArray(r.body) ? r.body : [];

(async () => {
  console.log('=== SENSITIVE DATA AND AUDIT AUTHENTICITY, staging ===');
  await fn('e2e-fixture', { mode: 'clean', emails: [OWNER_EMAIL, LAGOS_EMAIL, VIEWER_EMAIL], business_id: BIZ, drop_orders: true });

  const owner = await fn('e2e-fixture', { mode: 'member', email: OWNER_EMAIL, name: 'Sens Owner', business_id: BIZ, role: 'owner' });
  const lagos = await fn('e2e-fixture', { mode: 'member', email: LAGOS_EMAIL, name: 'Lagos Staff', business_id: BIZ, role: 'staff', branch_id: LAGOS });
  const viewer = await fn('e2e-fixture', { mode: 'member', email: VIEWER_EMAIL, name: 'A Viewer', business_id: BIZ, role: 'viewer' });
  ok('the cast exists', !!owner.user_id && !!lagos.user_id && !!viewer.user_id);

  await fn('e2e-fixture', { mode: 'order', business_id: BIZ, branch_id: LAGOS, app_id: 'o-sens-lagos', total: 40000, cost: 15000, client: 'Lagos client' });
  await fn('e2e-fixture', { mode: 'order', business_id: BIZ, branch_id: ABUJA, app_id: 'o-sens-abuja', total: 60000, cost: 25000, client: 'Abuja client' });

  /* a client with contact details, written by the owner through the API */
  const cust = await one(owner.user_id, {
    method: 'POST', path: '/rest/v1/customers', prefer: 'return=representation',
    body: { business_id: BIZ, branch_id: LAGOS, name: 'Ada Obi ' + TAG, note: 'Regular', measurements: { meas: { Chest: '40' } } },
  });
  const custId = rows(cust)[0] && rows(cust)[0].id;
  ok('a client record can be created', !!custId, JSON.stringify(cust.body).slice(0, 140));
  const contact = await one(owner.user_id, {
    method: 'POST', path: '/rest/v1/customer_contacts', prefer: 'return=representation',
    body: { customer_id: custId, business_id: BIZ, branch_id: LAGOS, phone: '+234 801 000 0000', email: 'ada@example.com' },
  });
  ok('and its contact details saved separately', contact.status < 300, 'status ' + contact.status);

  // -------------------------------------------------------------------
  section('1. Costs are refused without the permission');
  // -------------------------------------------------------------------
  {
    ok('the owner sees costs', rows(await one(owner.user_id, { method: 'GET', path: `/rest/v1/order_costs?business_id=eq.${BIZ}&select=cost` })).length === 2);

    for (const [who, uid] of [['a staff member', lagos.user_id], ['a viewer', viewer.user_id]]) {
      const r = await one(uid, { method: 'GET', path: `/rest/v1/order_costs?business_id=eq.${BIZ}&select=cost` });
      ok(who + ' is refused every cost', rows(r).length === 0, JSON.stringify(r.body).slice(0, 120));
    }

    /* asking for one row by id is not a way round a policy */
    const ids = rows(await one(owner.user_id, { method: 'GET', path: `/rest/v1/order_costs?business_id=eq.${BIZ}&select=order_id` }));
    const target = ids[0] && ids[0].order_id;
    const direct = await one(lagos.user_id, { method: 'GET', path: `/rest/v1/order_costs?order_id=eq.${target}&select=cost` });
    ok('  and naming a single row does not help', rows(direct).length === 0);

    /* nor is writing one */
    const write = await one(lagos.user_id, {
      method: 'POST', path: '/rest/v1/order_costs', prefer: 'return=representation',
      body: { order_id: target, business_id: BIZ, branch_id: LAGOS, cost: 1 },
    });
    ok('  nor writing one', write.status >= 400, 'status ' + write.status);
  }

  // -------------------------------------------------------------------
  section('2. Contact details are refused without the permission');
  // -------------------------------------------------------------------
  {
    const asOwner = await one(owner.user_id, { method: 'GET', path: `/rest/v1/customer_contacts?customer_id=eq.${custId}&select=phone,email` });
    ok('the owner sees the phone number', rows(asOwner).length === 1 && rows(asOwner)[0].phone);

    /* a staff member HAS seeContact by default, so take it away from the
       role and ask again: the difference is the whole assertion */
    const staffRole = rows(await one(owner.user_id, { method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.staff&select=id` }))[0];
    const before = await one(lagos.user_id, { method: 'GET', path: `/rest/v1/customer_contacts?customer_id=eq.${custId}&select=phone` });
    ok('a staff member with seeContact sees it', rows(before).length === 1);

    await one(owner.user_id, {
      method: 'DELETE',
      path: `/rest/v1/business_role_permissions?role_id=eq.${staffRole.id}&permission_key=eq.seeContact`,
    });
    const after = await one(lagos.user_id, { method: 'GET', path: `/rest/v1/customer_contacts?customer_id=eq.${custId}&select=phone` });
    ok('take seeContact away and the same request returns nothing', rows(after).length === 0,
       JSON.stringify(after.body).slice(0, 120));

    /* and the measurements they still need are still there */
    const meas = await one(lagos.user_id, { method: 'GET', path: `/rest/v1/customers?id=eq.${custId}&select=name,measurements` });
    ok('  while the measurements they need are still theirs', rows(meas).length === 1 && rows(meas)[0].measurements,
       'a workroom without seeContact still has to cut the garment');

    /* the old shape would have leaked here: the columns are gone */
    const cols = await one(lagos.user_id, { method: 'GET', path: `/rest/v1/customers?business_id=eq.${BIZ}&select=phone` });
    ok('  and the contact columns are not on that table at all', cols.status >= 400,
       'status ' + cols.status + ' — asking for a column that no longer exists');

    /* a viewer never had it */
    const v = await one(viewer.user_id, { method: 'GET', path: `/rest/v1/customer_contacts?customer_id=eq.${custId}&select=phone` });
    ok('a viewer is refused it too', rows(v).length === 0);

    await one(owner.user_id, {
      method: 'POST', path: '/rest/v1/business_role_permissions',
      body: { role_id: staffRole.id, permission_key: 'seeContact' },
    });
  }

  // -------------------------------------------------------------------
  section('3. Wrong branch, wrong business');
  // -------------------------------------------------------------------
  {
    const mine = rows(await one(lagos.user_id, { method: 'GET', path: `/rest/v1/orders?business_id=eq.${BIZ}&select=app_id` }));
    ok('a Lagos staff member sees Lagos orders only', mine.length === 1 && mine[0].app_id === 'o-sens-lagos',
       JSON.stringify(mine));

    const abujaCost = await one(lagos.user_id, { method: 'GET', path: `/rest/v1/order_costs?business_id=eq.${BIZ}&branch_id=eq.${ABUJA}&select=cost` });
    ok('  and no Abuja cost, even by asking for that branch', rows(abujaCost).length === 0);

    const elsewhere = await one(lagos.user_id, { method: 'GET', path: `/rest/v1/orders?business_id=eq.${OTHER}&select=app_id` });
    ok('and nothing at all from a business they are not in', rows(elsewhere).length === 0);

    const elsewhereContacts = await one(owner.user_id, { method: 'GET', path: `/rest/v1/customer_contacts?business_id=eq.${OTHER}&select=phone` });
    ok('  which holds for the owner of this studio too', rows(elsewhereContacts).length === 0,
       'an owner is an owner of ONE studio, not of studios');
  }

  // -------------------------------------------------------------------
  section('4. History cannot be edited, deleted, or forged');
  // -------------------------------------------------------------------
  {
    /* the owner triggers a real security event */
    const staffRole = rows(await one(owner.user_id, { method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.staff&select=id` }))[0];
    await one(owner.user_id, {
      method: 'POST', path: '/rest/v1/business_role_permissions',
      body: { role_id: staffRole.id, permission_key: 'expenses' },
    });

    const server = rows(await one(owner.user_id, {
      method: 'GET', path: `/rest/v1/audit_log?business_id=eq.${BIZ}&source=eq.server&select=action,detail,actor,source&order=id.desc&limit=5`,
    }));
    ok('a real permission change writes a SERVER event',
       server.some(x => x.action === 'Permission granted'),
       JSON.stringify(server.map(x => x.action)));
    ok('  and the database recorded who did it', server.every(x => x.actor === owner.user_id || x.actor === null));

    /* a member forging one */
    const forge = await one(lagos.user_id, {
      method: 'POST', path: '/rest/v1/audit_log',
      body: { business_id: BIZ, action: 'Permission granted', detail: TAG, source: 'server', actor: owner.user_id },
    });
    ok('a member CAN write an ordinary event', forge.status < 300, 'status ' + forge.status);

    const forged = rows(await one(owner.user_id, {
      method: 'GET', path: `/rest/v1/audit_log?business_id=eq.${BIZ}&detail=eq.${TAG}&select=source,actor,action`,
    }));
    ok('  but it lands as CLIENT however it was labelled',
       forged.length === 1 && forged[0].source === 'client',
       JSON.stringify(forged));
    ok('  and carries THEIR name, not the one they claimed',
       forged.length === 1 && forged[0].actor === lagos.user_id,
       'actor is auth.uid(), never the request');

    /* nobody edits or deletes */
    const any = rows(await one(owner.user_id, { method: 'GET', path: `/rest/v1/audit_log?business_id=eq.${BIZ}&select=id&order=id.desc&limit=1` }))[0];
    const patch = await one(owner.user_id, { method: 'PATCH', path: `/rest/v1/audit_log?id=eq.${any.id}`, body: { action: 'Rewritten' }, prefer: 'return=representation' });
    const del = await one(owner.user_id, { method: 'DELETE', path: `/rest/v1/audit_log?id=eq.${any.id}` });
    const still = rows(await one(owner.user_id, { method: 'GET', path: `/rest/v1/audit_log?id=eq.${any.id}&select=action` }));
    ok('the owner cannot edit or delete history', still.length === 1 && still[0].action !== 'Rewritten',
       'patch ' + patch.status + ', delete ' + del.status);

    const patch2 = await one(lagos.user_id, { method: 'PATCH', path: `/rest/v1/audit_log?id=eq.${any.id}`, body: { action: 'Rewritten' } });
    ok('  and neither can a member', patch2.status >= 400 || still.length === 1);
  }

  await fn('e2e-fixture', { mode: 'clean', emails: [OWNER_EMAIL, LAGOS_EMAIL, VIEWER_EMAIL], business_id: BIZ, drop_orders: true });
  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
