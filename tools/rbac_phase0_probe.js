/* =====================================================================
   PHASE 0 — can a member of a studio promote themselves?

   STAGING ONLY, and deliberately not a unit test. Every assertion below is
   a real HTTP request with a real session for a real member, straight to
   PostgREST. There is no app in the path, because the thing being tested
   is what the DATABASE will accept, and a test that goes through the app
   can only ever tell you what the app does.

   Written BEFORE the protection, and it failed: a staff member rewrote the
   studio's permission table to give their own role finance, payroll,
   profit, the audit trail and Accounts & roles, and PostgREST returned
   200. The run is recorded in RBAC_DESIGN.md.

   Two separate holes are covered, because closing one does not close the
   other:

     THE TABLE   layi_dash_roles is an app_state row and app_state's RLS is
                 in_scope, so any active member could rewrite what every
                 role in the studio is allowed to do.

     THE NAME    profiles.role_id is what the app reads to decide which
                 role somebody holds, and profiles_update_self lets anybody
                 update their own row. Setting it to 'owner' must grant
                 NOTHING at the database. This file proves it grants
                 nothing, and keeps proving it after Phase 2 makes the
                 database care about permissions.

   usage:  node tools/rbac_phase0_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const BIZ = 'c80aba9c-d12e-4302-a442-2669b0907a95';          // Adé Bespoke, staging
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

/* Four memberships in one studio. The viewer is a staff account demoted for
   the run and put back at the end. */
const WHO = {
  owner:   { id: '4c5767ee-0258-4a90-8e46-3dd53920340a', label: 'e2e.owner.a' },
  manager: { id: '2f7e2234-9477-461b-933e-1371d2ef1a57', label: 'mb.user3' },
  staff:   { id: '594d2ea0-855a-4a13-bfa4-bf1c7eafeed3', label: 'e2e.jane' },
  viewer:  { id: 'eb6d2d29-f882-4eab-b5ab-47472c026c63', label: 'e2e.jane2' },
};

const ROLES_PATH = `/rest/v1/app_state?business_id=eq.${BIZ}&key=eq.layi_dash_roles`;
const SETTINGS_PATH = `/rest/v1/app_state?business_id=eq.${BIZ}&key=eq.layi_dash_settings`;
const ORDERS_PATH = `/rest/v1/app_state?business_id=eq.${BIZ}&key=eq.layi_dash_orders`;

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (why ? ' — ' + why : '')); }
};
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const asUser = async (uid, calls) => (await fetch(PROJ + '/functions/v1/as-user', {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ as_user_id: uid, calls }),
})).json();

const one = async (uid, call) => (await asUser(uid, [call])).results[0];

const readRoles = async () => {
  const r = await one(WHO.owner.id, { method: 'GET', path: ROLES_PATH + '&select=data' });
  return (r.body && r.body[0]) ? r.body[0].data : null;
};

/* The escalation itself: take whatever role the caller might plausibly hold
   and switch on everything that decides money, people and the studio. */
const elevate = roles => roles.map(r => (r.id === 'owner' ? r : Object.assign({}, r, {
  perms: Object.assign({}, r.perms, {
    finance: 1, payroll: 1, seeProfit: 1, seeCost: 1,
    users: 1, settings: 1, team: 1, audit: 1, setCompany: 1, setData: 1,
  }),
})));

const grantsMoney = roles => {
  const r = (roles || []).find(x => x.id === 'tailor') || (roles || []).find(x => x.id === 'cre');
  return !!(r && r.perms && (r.perms.payroll || r.perms.finance || r.perms.users));
};

(async () => {
  console.log('=== PHASE 0 PROBE — Adé Bespoke, staging ===');

  const baseline = await readRoles();
  if (!Array.isArray(baseline)) {
    console.error('no layi_dash_roles row on this studio; nothing to test');
    process.exit(1);
  }
  console.log('roles in this studio: ' + baseline.map(r => r.id).join(', '));

  // -------------------------------------------------------------------
  section('Nobody but the owner may rewrite what a role is allowed to do');
  // -------------------------------------------------------------------
  for (const role of ['manager', 'staff', 'viewer']) {
    const res = await one(WHO[role].id, {
      method: 'PATCH', path: ROLES_PATH, body: { data: elevate(baseline) },
      prefer: 'return=representation',
    });
    const after = await readRoles();
    const landed = grantsMoney(after);
    ok('a ' + role + ' cannot give their own role finance, payroll and roles',
       !landed,
       'PATCH returned ' + res.status + ' and the change ' + (landed ? 'LANDED' : 'did not land'));
    ok('  and is told why rather than silently ignored',
       res.status === 403 || res.status === 401,
       'got ' + res.status + ' — a refusal that reports success is the B1 shape');
    if (landed) await one(WHO.owner.id, { method: 'PATCH', path: ROLES_PATH, body: { data: baseline } });
  }

  /* The owner must keep working through the transition: the existing screen
     is the only way to manage these until Phase 3 moves them to a table. */
  {
    const tweaked = baseline.map(r => (r.id === 'cre'
      ? Object.assign({}, r, { name: 'Client Relations (probe)' }) : r));
    const res = await one(WHO.owner.id, {
      method: 'PATCH', path: ROLES_PATH, body: { data: tweaked }, prefer: 'return=representation',
    });
    const after = await readRoles();
    const renamed = (after || []).some(r => r.name === 'Client Relations (probe)');
    ok('the owner can still manage roles during the transition', res.status < 300 && renamed,
       'status ' + res.status);
    await one(WHO.owner.id, { method: 'PATCH', path: ROLES_PATH, body: { data: baseline } });
  }

  // -------------------------------------------------------------------
  section('A name in profiles grants no authority in the database');
  // -------------------------------------------------------------------
  {
    const P = `/rest/v1/profiles?id=eq.${WHO.viewer.id}`;
    const before = (await one(WHO.owner.id, { method: 'GET', path: P + '&select=role_id' })).body[0];

    const claim = await one(WHO.viewer.id, {
      method: 'PATCH', path: P, body: { role_id: 'owner' }, prefer: 'return=representation',
    });
    const now = (await one(WHO.owner.id, { method: 'GET', path: P + '&select=role_id' })).body[0];
    const claimed = now && now.role_id === 'owner';
    console.log('  (a viewer setting their own profiles.role_id to owner: '
      + claim.status + ', ' + (claimed ? 'accepted' : 'refused') + ')');

    /* Whether or not the claim was accepted, it must buy nothing. */
    const r1 = await one(WHO.viewer.id, {
      method: 'PATCH', path: ROLES_PATH, body: { data: elevate(baseline) }, prefer: 'return=representation',
    });
    const rolesAfter = await readRoles();
    ok('calling yourself the owner does not let you rewrite the roles',
       !grantsMoney(rolesAfter), 'status ' + r1.status);
    if (grantsMoney(rolesAfter)) await one(WHO.owner.id, { method: 'PATCH', path: ROLES_PATH, body: { data: baseline } });

    const cur = (await one(WHO.owner.id, { method: 'GET', path: SETTINGS_PATH + '&select=data' })).body[0].data;
    const r2 = await one(WHO.viewer.id, {
      method: 'PATCH', path: SETTINGS_PATH,
      body: { data: Object.assign({}, cur, { company: Object.assign({}, cur.company, { name: 'CLAIMED' }) }) },
      prefer: 'return=representation',
    });
    const s = (await one(WHO.owner.id, { method: 'GET', path: SETTINGS_PATH + '&select=data' })).body[0].data;
    ok('nor to rename the studio', (s.company || {}).name !== 'CLAIMED', 'status ' + r2.status);

    const r3 = await one(WHO.viewer.id, {
      method: 'PATCH', path: `/rest/v1/businesses?id=eq.${BIZ}`,
      body: { name: 'CLAIMED' }, prefer: 'return=representation',
    });
    const b = (await one(WHO.owner.id, { method: 'GET', path: `/rest/v1/businesses?id=eq.${BIZ}&select=name` })).body[0];
    ok('nor to rename the business row', b.name !== 'CLAIMED', 'status ' + r3.status);

    const r4 = await one(WHO.viewer.id, {
      method: 'PATCH', path: `/rest/v1/memberships?user_id=eq.${WHO.viewer.id}&business_id=eq.${BIZ}`,
      body: { role: 'owner' }, prefer: 'return=representation',
    });
    const m = (await one(WHO.owner.id, {
      method: 'GET', path: `/rest/v1/memberships?user_id=eq.${WHO.viewer.id}&business_id=eq.${BIZ}&select=role`,
    })).body[0];
    ok('nor to promote their own membership', m.role !== 'owner', 'status ' + r4.status);

    /* Put it back if it moved. It has to be the viewer who does it:
       profiles_update_self is the only write policy on this table, so
       nobody can repair somebody else's row from a browser — including
       the owner. That is worth knowing on its own. */
    if (claimed) {
      await one(WHO.viewer.id, { method: 'PATCH', path: P, body: { role_id: before ? before.role_id : 'staff' } });
    }
    const restored = (await one(WHO.owner.id, { method: 'GET', path: P + '&select=role_id' })).body[0];
    ok('  (profile restored)', !!restored && restored.role_id !== 'owner',
       'left as ' + (restored && restored.role_id));
  }

  // -------------------------------------------------------------------
  section('Ordinary work is untouched');
  // -------------------------------------------------------------------
  for (const role of ['owner', 'manager', 'staff', 'viewer']) {
    const stamp = 'phase0-' + Date.now() + '-' + role;
    const res = await one(WHO[role].id, {
      method: 'POST', path: '/rest/v1/app_state?on_conflict=business_id,key',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: { business_id: BIZ, key: 'layi_dash_orders', data: [{ id: stamp, client: 'Phase 0 probe' }] },
    });
    const back = (await one(WHO.owner.id, { method: 'GET', path: ORDERS_PATH + '&select=data' })).body[0];
    ok('a ' + role + ' can still save an order', !!back && JSON.stringify(back.data).includes(stamp),
       'status ' + res.status);
  }
  await one(WHO.owner.id, { method: 'DELETE', path: ORDERS_PATH });

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  console.log('A studio can only be as safe as what the database refuses.');
  process.exit(fail ? 1 : 0);
})();
