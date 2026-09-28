/* =====================================================================
   BATCH E — branch scope, adversarially.

   STAGING ONLY. Seed Multi Studio has four outlets, which is what makes
   this testable at all: a studio with one branch cannot prove that a
   branch is a boundary.

   The cases are the seven from RBAC_DESIGN.md section 6, and the one most
   systems miss is B6: USING guards the row you can see, WITH CHECK guards
   the row you leave behind, and moving an order from a branch you may
   touch into one you may not needs both.

   usage: node tools/branch_scope_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const BIZ = '7256137b-2d3b-4d2d-86da-a7651d6bb10c';          // Seed Multi Studio
const LAGOS = 'abfa0685-4bd6-4418-9f17-8f4067954938';
const ABUJA = '6d8dc855-8adf-44e2-95b2-944628d72e54';
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

const OWNER_EMAIL = 'probe.branch.owner@thelabelboard.com';
const PINNED_EMAIL = 'probe.branch.lagos@thelabelboard.com';
const WIDE_EMAIL = 'probe.branch.wide@thelabelboard.com';

let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const fn = async (name, body) => (await fetch(PROJ + '/functions/v1/' + name, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})).json();
const one = async (uid, call) => (await fn('as-user', { as_user_id: uid, calls: [call] })).results[0];

(async () => {
  console.log('=== BATCH E — branch scope, staging ===');
  await fn('e2e-fixture', { mode: 'clean', emails: [OWNER_EMAIL, PINNED_EMAIL, WIDE_EMAIL], business_id: BIZ, drop_orders: true });

  const owner = await fn('e2e-fixture', { mode: 'member', email: OWNER_EMAIL, name: 'Branch Owner', business_id: BIZ, role: 'owner' });
  const pinned = await fn('e2e-fixture', { mode: 'member', email: PINNED_EMAIL, name: 'Lagos Only', business_id: BIZ, role: 'manager', branch_id: LAGOS });
  const wide = await fn('e2e-fixture', { mode: 'member', email: WIDE_EMAIL, name: 'All Branches', business_id: BIZ, role: 'manager' });
  ok('the cast exists', !!owner.user_id && !!pinned.user_id && !!wide.user_id,
     JSON.stringify([owner, pinned, wide]).slice(0, 200));

  const lagosOrder = await fn('e2e-fixture', { mode: 'order', business_id: BIZ, branch_id: LAGOS, app_id: 'o-lagos-1', total: 50000, cost: 20000, client: 'Lagos client' });
  const abujaOrder = await fn('e2e-fixture', { mode: 'order', business_id: BIZ, branch_id: ABUJA, app_id: 'o-abuja-1', total: 70000, cost: 30000, client: 'Abuja client' });
  ok('there is an order in each of two branches', !!lagosOrder.id && !!abujaOrder.id);

  // -------------------------------------------------------------------
  section('B1 — a branch-pinned member sees their branch and no other');
  // -------------------------------------------------------------------
  {
    const mine = await one(pinned.user_id, { method: 'GET', path: `/rest/v1/orders?business_id=eq.${BIZ}&select=app_id,branch_id` });
    const ids = (mine.body || []).map(o => o.app_id).sort();
    ok('Lagos only sees the Lagos order', ids.length === 1 && ids[0] === 'o-lagos-1', JSON.stringify(ids));

    const all = await one(wide.user_id, { method: 'GET', path: `/rest/v1/orders?business_id=eq.${BIZ}&select=app_id` });
    ok('somebody with all branches sees both', (all.body || []).length === 2, JSON.stringify((all.body || []).map(o => o.app_id)));
  }

  // -------------------------------------------------------------------
  section('B2 and B3 — writing into a branch you do not hold');
  // -------------------------------------------------------------------
  {
    const intoAbuja = await one(pinned.user_id, {
      method: 'POST', path: '/rest/v1/orders', prefer: 'return=representation',
      body: { business_id: BIZ, branch_id: ABUJA, app_id: 'o-sneak-1', total: 1, doc: { id: 'o-sneak-1' } },
    });
    ok('Lagos cannot create an order in Abuja', intoAbuja.status >= 400,
       'status ' + intoAbuja.status);

    const intoNull = await one(pinned.user_id, {
      method: 'POST', path: '/rest/v1/orders', prefer: 'return=representation',
      body: { business_id: BIZ, branch_id: null, app_id: 'o-sneak-2', total: 1, doc: { id: 'o-sneak-2' } },
    });
    /* THIS IS B3 AND IT FAILED THE FIRST TIME. A null branch means "the
       whole business", and app.in_scope(business, null) is true for a
       branch-pinned member on purpose: a row belonging to everybody belongs
       to them. Right for reading settings, wrong for writing an order, so
       the write policies ask has_all_branches as well and the read policies
       do not. A single-outlet studio is unaffected: its members are not
       pinned, so a branchless order is what they have always written. */
    ok('Lagos cannot widen themselves by leaving the branch out',
       intoNull.status >= 400, 'status ' + intoNull.status);

    const intoMine = await one(pinned.user_id, {
      method: 'POST', path: '/rest/v1/orders', prefer: 'return=representation',
      body: { business_id: BIZ, branch_id: LAGOS, app_id: 'o-lagos-2', total: 2, doc: { id: 'o-lagos-2' } },
    });
    ok('and CAN create one in their own branch', intoMine.status < 300, 'status ' + intoMine.status);
  }

  // -------------------------------------------------------------------
  section('B6 — moving a row out of the branch you hold');
  // -------------------------------------------------------------------
  {
    const move = await one(pinned.user_id, {
      method: 'PATCH', path: `/rest/v1/orders?business_id=eq.${BIZ}&app_id=eq.o-lagos-1`,
      body: { branch_id: ABUJA }, prefer: 'return=representation',
    });
    const after = await one(owner.user_id, { method: 'GET', path: `/rest/v1/orders?business_id=eq.${BIZ}&app_id=eq.o-lagos-1&select=branch_id` });
    ok('Lagos cannot move their own order to Abuja',
       after.body[0].branch_id === LAGOS,
       'status ' + move.status + ', now in ' + after.body[0].branch_id);
    ok('  and it is a refusal, not a silent no-op', move.status >= 400,
       'got ' + move.status + ' — USING passed on the old row, WITH CHECK is what catches the new one');
  }

  // -------------------------------------------------------------------
  section('B5 — cost is per branch as well as per permission');
  // -------------------------------------------------------------------
  {
    const c1 = await one(owner.user_id, { method: 'GET', path: `/rest/v1/order_costs?business_id=eq.${BIZ}&select=cost` });
    ok('the owner sees both costs', (c1.body || []).length === 2, JSON.stringify(c1.body));

    const c2 = await one(pinned.user_id, { method: 'GET', path: `/rest/v1/order_costs?business_id=eq.${BIZ}&select=cost` });
    ok('a manager sees none, because seeCost is not a manager default', (c2.body || []).length === 0,
       JSON.stringify(c2.body));

    /* give the pinned manager seeCost and they get their branch only */
    const role = (await one(owner.user_id, { method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.manager&select=id` })).body[0];
    await one(owner.user_id, {
      method: 'POST', path: '/rest/v1/business_role_permissions',
      body: { role_id: role.id, permission_key: 'seeCost' },
    });
    const c3 = await one(pinned.user_id, { method: 'GET', path: `/rest/v1/order_costs?business_id=eq.${BIZ}&select=cost,branch_id` });
    ok('granted seeCost, they see exactly one cost: their branch’s',
       (c3.body || []).length === 1 && c3.body[0].branch_id === LAGOS,
       JSON.stringify(c3.body));
    const c4 = await one(wide.user_id, { method: 'GET', path: `/rest/v1/order_costs?business_id=eq.${BIZ}&select=cost` });
    ok('  while all-branches sees both', (c4.body || []).length === 2);

    await one(owner.user_id, {
      method: 'DELETE',
      path: `/rest/v1/business_role_permissions?role_id=eq.${role.id}&permission_key=eq.seeCost`,
    });
  }

  // -------------------------------------------------------------------
  section('B4 — an aggregate is not widened by asking for one');
  // -------------------------------------------------------------------
  {
    const wideAll = await one(wide.user_id, { method: 'POST', path: '/rest/v1/rpc/can', body: { p_business: BIZ, p_perm: 'orders' } });
    ok('both hold the orders permission', wideAll.body === true);
    const sumPinned = await one(pinned.user_id, { method: 'GET', path: `/rest/v1/orders?business_id=eq.${BIZ}&select=total` });
    const sumWide = await one(wide.user_id, { method: 'GET', path: `/rest/v1/orders?business_id=eq.${BIZ}&select=total` });
    const tot = rows => (rows || []).reduce((a, r) => a + Number(r.total || 0), 0);
    ok('and the same query returns a different total for each',
       tot(sumPinned.body) !== tot(sumWide.body),
       tot(sumPinned.body) + ' vs ' + tot(sumWide.body));
  ok('  the pinned one being their branch alone', tot(sumPinned.body) === 50002,
     'got ' + tot(sumPinned.body) + ' \u2014 50000 and 2, and nothing branchless');
  }

  // -------------------------------------------------------------------
  section('The audit trail cannot be rewritten');
  // -------------------------------------------------------------------
  {
    const w = await one(pinned.user_id, {
      method: 'POST', path: '/rest/v1/audit_log', prefer: 'return=representation',
      body: { business_id: BIZ, action: 'Probe wrote this', detail: 'from a member' },
    });
    ok('any member can add to the audit trail', w.status < 300, 'status ' + w.status);
    const id = (w.body && w.body[0] && w.body[0].id);

    /* A manager holds `audit` by default, so they are the wrong contrast.
       Take it away from the role and ask again: the write stays, the read
       closes. */
    const mrole = (await one(owner.user_id, { method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.manager&select=id` })).body[0];
    const r0 = await one(pinned.user_id, { method: 'GET', path: `/rest/v1/audit_log?business_id=eq.${BIZ}&select=id` });
    ok('a manager reads the audit trail, which is their default', (r0.body || []).length >= 1);
    await one(owner.user_id, {
      method: 'DELETE',
      path: `/rest/v1/business_role_permissions?role_id=eq.${mrole.id}&permission_key=eq.audit`,
    });
    const r = await one(pinned.user_id, { method: 'GET', path: `/rest/v1/audit_log?business_id=eq.${BIZ}&select=id,action` });
    ok('take the permission away and the same request returns nothing',
       (r.body || []).length === 0, JSON.stringify(r.body).slice(0, 120));
    /* NO return=representation. PostgREST turns that into INSERT ... RETURNING,
       which needs the SELECT policy as well, and the whole point here is
       somebody who may write history and may not read it. The app inserts
       the same way for the same reason. */
    const w2 = await one(pinned.user_id, {
      method: 'POST', path: '/rest/v1/audit_log',
      body: { business_id: BIZ, action: 'Still recorded', detail: 'without being able to read it' },
    });
    ok('  and they can still be recorded doing things', w2.status < 300,
       'a trail somebody can switch off for themselves is not a trail');
    await one(owner.user_id, {
      method: 'POST', path: '/rest/v1/business_role_permissions',
      body: { role_id: mrole.id, permission_key: 'audit' },
    });
    const r2 = await one(owner.user_id, { method: 'GET', path: `/rest/v1/audit_log?business_id=eq.${BIZ}&select=id,action,actor` });
    ok('the owner can', (r2.body || []).length >= 1);
    ok('  and the server recorded who did it, not the client',
       r2.body.some(x => x.actor === pinned.user_id),
       'actor is stamped from auth.uid()');

    const edit = await one(owner.user_id, {
      method: 'PATCH', path: `/rest/v1/audit_log?id=eq.${id}`, body: { action: 'Rewritten' },
      prefer: 'return=representation',
    });
    const del = await one(owner.user_id, { method: 'DELETE', path: `/rest/v1/audit_log?id=eq.${id}` });
    const still = await one(owner.user_id, { method: 'GET', path: `/rest/v1/audit_log?id=eq.${id}&select=action` });
    ok('NOBODY can edit history, the owner included',
       (still.body || []).length === 1 && still.body[0].action === 'Probe wrote this',
       'patch ' + edit.status + ', delete ' + del.status);
  }

  await fn('e2e-fixture', { mode: 'clean', emails: [OWNER_EMAIL, PINNED_EMAIL, WIDE_EMAIL], business_id: BIZ, drop_orders: true });
  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
