/* =====================================================================
   BATCH B — the permission refuses the request, not the screen.

   STAGING ONLY. Real sessions, straight to PostgREST, no app in the path.
   Every assertion is a capability someone either can or cannot exercise
   against the database itself. A screen that hides a button proves nothing
   and is not tested here.

   usage: node tools/rbac_batch_b_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const BIZ = 'c80aba9c-d12e-4302-a442-2669b0907a95';   // Adé Bespoke
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

const WHO = {
  owner:   '4c5767ee-0258-4a90-8e46-3dd53920340a',
  manager: '2f7e2234-9477-461b-933e-1371d2ef1a57',
  staff:   '594d2ea0-855a-4a13-bfa4-bf1c7eafeed3',
  viewer:  'eb6d2d29-f882-4eab-b5ab-47472c026c63',
};

let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const asUser = async (uid, calls) => (await fetch(PROJ + '/functions/v1/as-user', {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ as_user_id: uid, calls }),
})).json();
const one = async (uid, call) => (await asUser(uid, [call])).results[0];

const readKey = async (uid, key) => {
  const r = await one(uid, { method: 'GET', path: `/rest/v1/app_state?business_id=eq.${BIZ}&key=eq.${key}&select=key` });
  return Array.isArray(r.body) && r.body.length > 0;
};
const writeKey = async (uid, key, data) => {
  const r = await one(uid, {
    method: 'POST', path: '/rest/v1/app_state?on_conflict=business_id,key',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { business_id: BIZ, key, data },
  });
  return { status: r.status, ok: r.status >= 200 && r.status < 300 };
};

/* Restore whatever the probe touches, as the owner, at the end. */
const snapshot = {};
const take = async (keys) => {
  for (const k of keys) {
    const r = await one(WHO.owner, { method: 'GET', path: `/rest/v1/app_state?business_id=eq.${BIZ}&key=eq.${k}&select=data` });
    snapshot[k] = (r.body && r.body[0]) ? r.body[0].data : null;
  }
};
const restore = async () => {
  for (const k of Object.keys(snapshot)) {
    if (snapshot[k] === null) {
      await one(WHO.owner, { method: 'DELETE', path: `/rest/v1/app_state?business_id=eq.${BIZ}&key=eq.${k}` });
    } else {
      await one(WHO.owner, {
        method: 'POST', path: '/rest/v1/app_state?on_conflict=business_id,key',
        prefer: 'resolution=merge-duplicates',
        body: { business_id: BIZ, key: k, data: snapshot[k] },
      });
    }
  }
};

/* who should be able to read what, by design */
/* NOT bills, pots, campaigns or attendance. Those keys are Pro features and
   this fixture studio is on Basic, so the plan trigger refuses them to the
   OWNER as well, which is the plan gate working and not a permission answer.
   Mixing the two in one matrix reads like a permission failure and is how a
   green suite starts lying. */
const READ = {
  layi_dash_orders:   { owner: true, manager: true,  staff: true,  viewer: true },
  layi_dash_txns:     { owner: true, manager: true,  staff: false, viewer: false },
  layi_dash_audit:    { owner: true, manager: true,  staff: false, viewer: false },
  layi_dash_appts:    { owner: true, manager: true,  staff: true,  viewer: false },
  layi_dash_tasks:    { owner: true, manager: true,  staff: true,  viewer: false },
  layi_dash_staff:    { owner: true, manager: true,  staff: true,  viewer: true },
  layi_dash_settings: { owner: true, manager: true,  staff: true,  viewer: true },
  layi_dash_roles:    { owner: true, manager: true,  staff: true,  viewer: true },
};
const WRITE = {
  layi_dash_orders:   { owner: true, manager: true,  staff: true,  viewer: false },
  layi_dash_txns:     { owner: true, manager: true,  staff: false, viewer: false },
  layi_dash_audit:    { owner: true, manager: true,  staff: false, viewer: false },
  /* layi_dash_users LEFT THIS MATRIX ON 29 SEPTEMBER, and not because the
     permission changed. The key is refused to EVERYBODY now, the owner
     included: it is the device's list of usernames and PINs, it should never
     have been synced, and an old build pushing it is answered with a 42501.
     Leaving 'owner: true' here would have this probe assert the leak.
     tools/credential_probe.js is where the refusal is proved, from both
     sides, with a sentinel that is written before it is looked for. */
  layi_dash_staff:    { owner: true, manager: true,  staff: false, viewer: false },
};

const setRole = async (uid, tierKey) => {
  const role = (await one(WHO.owner, {
    method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.${tierKey}&select=id`,
  })).body[0];
  return await one(WHO.owner, {
    method: 'PATCH', path: `/rest/v1/memberships?user_id=eq.${uid}&business_id=eq.${BIZ}`,
    body: { role: tierKey, role_id: role.id }, prefer: 'return=representation',
  });
};

(async () => {
  console.log('=== BATCH B — enforcement, staging ===');
  /* Do not assume what a fixture is. Say what it is. */
  const putBack = await setRole(WHO.viewer, 'viewer');
  if (putBack.status >= 400) { console.error('could not make the viewer fixture a viewer'); process.exit(1); }
  await take(Object.keys(READ).concat(Object.keys(WRITE)));

  // -------------------------------------------------------------------
  section('Reading a key needs the permission for that key');
  // -------------------------------------------------------------------
  /* seed every key as the owner so a false read is a refusal and not an
     empty studio */
  for (const k of Object.keys(READ)) {
    if (snapshot[k] === null) await writeKey(WHO.owner, k, k === 'layi_dash_roles' ? [] : []);
  }
  for (const k of Object.keys(READ)) {
    for (const role of ['owner', 'manager', 'staff', 'viewer']) {
      const got = await readKey(WHO[role], k);
      const want = READ[k][role];
      ok(`${role} ${want ? 'reads' : 'cannot read'} ${k.replace('layi_dash_', '')}`,
         got === want, 'got ' + got);
    }
  }

  // -------------------------------------------------------------------
  section('Writing needs a different permission, and a viewer has none');
  // -------------------------------------------------------------------
  for (const k of Object.keys(WRITE)) {
    for (const role of ['owner', 'manager', 'staff', 'viewer']) {
      const r = await writeKey(WHO[role], k, [{ probe: role }]);
      const want = WRITE[k][role];
      ok(`${role} ${want ? 'writes' : 'cannot write'} ${k.replace('layi_dash_', '')}`,
         r.ok === want, 'status ' + r.status);
    }
  }

  // -------------------------------------------------------------------
  section('A viewer is genuinely read-only');
  // -------------------------------------------------------------------
  {
    const del = await one(WHO.viewer, { method: 'DELETE', path: `/rest/v1/app_state?business_id=eq.${BIZ}&key=eq.layi_dash_orders` });
    const still = await readKey(WHO.owner, 'layi_dash_orders');
    ok('a viewer cannot delete the orders key', still, 'status ' + del.status);
  }

  // -------------------------------------------------------------------
  section('Granting a permission opens exactly one door');
  // -------------------------------------------------------------------
  {
    const staffRole = (await one(WHO.owner, {
      method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.staff&select=id`,
    })).body[0];

    ok('a staff member cannot read transactions', !(await readKey(WHO.staff, 'layi_dash_txns')));
    await one(WHO.owner, {
      method: 'POST', path: '/rest/v1/business_role_permissions',
      body: { role_id: staffRole.id, permission_key: 'receivables' },
    });
    ok('the owner grants receivables and they can, immediately',
       await readKey(WHO.staff, 'layi_dash_txns'));
    ok('  but still cannot WRITE one', !(await writeKey(WHO.staff, 'layi_dash_txns', [{ probe: 1 }])).ok,
       'reading money in is not recording a payment');
    ok('  and still cannot read the audit trail', !(await readKey(WHO.staff, 'layi_dash_audit')));

    await one(WHO.owner, {
      method: 'DELETE',
      path: `/rest/v1/business_role_permissions?role_id=eq.${staffRole.id}&permission_key=eq.receivables`,
    });
    ok('revoking closes it again, immediately', !(await readKey(WHO.staff, 'layi_dash_txns')));
  }

  // -------------------------------------------------------------------
  section('Branches are the owner’s, and the studio’s name still is');
  // -------------------------------------------------------------------
  {
    for (const role of ['manager', 'staff', 'viewer']) {
      const r = await one(WHO[role], {
        method: 'POST', path: '/rest/v1/branches', prefer: 'return=representation',
        body: { business_id: BIZ, name: 'Ghost outlet ' + role },
      });
      ok('a ' + role + ' cannot add a branch', r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0),
         'status ' + r.status);
    }
    const r = await one(WHO.owner, {
      method: 'POST', path: '/rest/v1/branches', prefer: 'return=representation',
      body: { business_id: BIZ, name: 'Probe outlet' },
    });
    /* This studio is on Basic, which allows one branch and already has it,
       so the owner is refused too — by the PLAN, with 23514, not by a
       permission with 42501. The distinction is the whole assertion: a
       refusal that looks the same from outside for two different reasons is
       how a permission bug hides inside a billing rule. */
    const why = (r.body && r.body.code) || '';
    ok('the owner is refused only by the plan, never by the permission',
       r.status < 300 || why === '23514',
       'status ' + r.status + ' code ' + why);
    if (r.status < 300 && r.body && r.body[0]) {
      await one(WHO.owner, { method: 'DELETE', path: `/rest/v1/branches?id=eq.${r.body[0].id}` });
    }

    /* presence still works for everybody, which it did not under
       is_business_admin */
    for (const role of ['manager', 'staff', 'viewer']) {
      const p = await one(WHO[role], {
        method: 'PATCH', path: `/rest/v1/businesses?id=eq.${BIZ}`,
        body: { last_seen_at: new Date().toISOString(), app_version: 'probe' },
        prefer: 'return=representation',
      });
      ok('a ' + role + ' can still report presence', p.status < 400, 'status ' + p.status);
      const n = await one(WHO[role], {
        method: 'PATCH', path: `/rest/v1/businesses?id=eq.${BIZ}`,
        body: { name: 'HIJACKED' }, prefer: 'return=representation',
      });
      const now = (await one(WHO.owner, { method: 'GET', path: `/rest/v1/businesses?id=eq.${BIZ}&select=name` })).body[0];
      ok('  and still cannot rename the studio', now.name !== 'HIJACKED', 'status ' + n.status);
    }
  }

  await restore();
  await setRole(WHO.viewer, 'staff');
  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
