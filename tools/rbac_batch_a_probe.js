/* =====================================================================
   BATCH A — the RBAC foundation, measured.

   STAGING ONLY. Real sessions for real members, straight to PostgREST.
   Batch A is additive: no policy reads app.can() yet, so this file proves
   the FACTS are right — who holds which role, what that role may do, and
   that the table governing all of it cannot be edited by the people it
   restricts. Batch B turns the facts into refusals; the tests for that
   live beside it.

   usage: node tools/rbac_batch_a_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const BIZ = 'c80aba9c-d12e-4302-a442-2669b0907a95';   // Adé Bespoke
const OTHER = 'eed02aab-8d8b-44f8-a983-dadc59e9980c'; // Ìfé Leather
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

const WHO = {
  owner:   '4c5767ee-0258-4a90-8e46-3dd53920340a',
  manager: '2f7e2234-9477-461b-933e-1371d2ef1a57',
  staff:   '594d2ea0-855a-4a13-bfa4-bf1c7eafeed3',
};
/* one person, two studios, opposite roles — owner of Adé, owner of Ìfé */
const MULTI = 'bba66275-ac8b-4767-941a-19c98636cbf9';  // mb.user1, owner of both
/* a manager of Adé Bespoke and nothing else — the invited account */
const ONLY_HERE = '03d256bc-13dd-4dbb-9798-91088b1fea94';

let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const asUser = async (uid, calls) => (await fetch(PROJ + '/functions/v1/as-user', {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ as_user_id: uid, calls }),
})).json();
const one = async (uid, call) => (await asUser(uid, [call])).results[0];

const perms = async (uid, biz) => {
  const r = await one(uid, { method: 'POST', path: '/rest/v1/rpc/my_permissions', body: { p_business: biz } });
  return (r.body || []).map(x => x.permission_key || x).sort();
};
const can = async (uid, biz, perm) => {
  const r = await one(uid, { method: 'POST', path: '/rest/v1/rpc/can', body: { p_business: biz, p_perm: perm } });
  return r.body === true;
};

(async () => {
  console.log('=== BATCH A — RBAC FOUNDATION, staging ===');

  // -------------------------------------------------------------------
  section('Every membership resolves to a role, and the role decides');
  // -------------------------------------------------------------------
  const o = await perms(WHO.owner, BIZ);
  const m = await perms(WHO.manager, BIZ);
  const s = await perms(WHO.staff, BIZ);
  console.log('  owner ' + o.length + ' · manager ' + m.length + ' · staff ' + s.length + ' permissions');

  ok('the owner has the whole catalogue', o.length >= 44, o.length + ' keys');
  ok('a manager has fewer', m.length > 0 && m.length < o.length);
  ok('a staff member has fewer still', s.length > 0 && s.length < m.length);

  /* The defaults that were argued for, and the reason they were argued
     for: what a garment costs and what everybody earns are the owner's
     business until the owner says otherwise. */
  for (const k of ['seeProfit', 'seeCost', 'payroll', 'funds', 'users', 'team.invite', 'setCompany', 'setData']) {
    ok('a manager does not have ' + k + ' by default', !m.includes(k));
  }
  for (const k of ['orders', 'customers', 'update', 'canQC', 'money', 'team.view']) {
    ok('a manager does have ' + k, m.includes(k));
    ok('  and so does a staff member', s.includes(k));
  }
  for (const k of ['del', 'audit', 'settings', 'expenses', 'receivables']) {
    ok('a staff member does not have ' + k, !s.includes(k));
  }

  // -------------------------------------------------------------------
  section('app.can agrees with the list, key by key');
  // -------------------------------------------------------------------
  for (const [role, uid, list] of [['owner', WHO.owner, o], ['manager', WHO.manager, m], ['staff', WHO.staff, s]]) {
    const yes = await can(uid, BIZ, 'orders');
    const no = await can(uid, BIZ, 'ownership.transfer');
    ok('can(' + role + ", 'orders') matches the list", yes === list.includes('orders'));
    ok('can(' + role + ", 'ownership.transfer') matches the list",
       no === (role === 'owner'), 'got ' + no);
  }
  /* Asked of a MANAGER, not the owner: app.can() answers true for an owner
     before it reads the table, so an owner is true for any string at all.
     Worth knowing — a misspelt permission check in code grants owners and
     denies everybody else, which is a quiet asymmetry. At the table the
     typo cannot even be stored: the foreign key refuses it. */
  ok('a permission that does not exist is simply false',
     (await can(WHO.manager, BIZ, 'finanace')) === false);
  ok('  and cannot be stored at all', await (async () => {
    const role = (await one(WHO.owner, { method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.staff&select=id` })).body[0];
    const r = await one(WHO.owner, { method: 'POST', path: '/rest/v1/business_role_permissions',
      body: { role_id: role.id, permission_key: 'finanace' }, prefer: 'return=representation' });
    return r.status >= 400;
  })(), 'the foreign key to the catalogue is the point of normalising');

  // -------------------------------------------------------------------
  section('A role in one studio says nothing about another');
  // -------------------------------------------------------------------
  {
    const here = await perms(WHO.manager, BIZ);
    /* mb.user3 is a manager of Adé and the OWNER of Ìfé, which is the
       feature working, not a leak. This asks somebody who belongs to Adé
       and nowhere else. */
    const there = await perms(ONLY_HERE, OTHER);
    ok('somebody who belongs to Adé alone has no permissions in Ìfé', there.length === 0,
       there.length + ' keys in a studio they do not belong to');
    ok('  and still has their own', here.length > 0);

    const both = await perms(MULTI, BIZ);
    const bothToo = await perms(MULTI, OTHER);
    ok('somebody in two studios is answered separately for each',
       both.length > 0 && bothToo.length > 0);
  }

  // -------------------------------------------------------------------
  section('The permission table is the owner’s');
  // -------------------------------------------------------------------
  {
    const roleRow = await one(WHO.owner, {
      method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.staff&select=id,name`,
    });
    const staffRole = roleRow.body[0];

    for (const role of ['manager', 'staff']) {
      const r1 = await one(WHO[role], {
        method: 'POST', path: '/rest/v1/business_role_permissions',
        body: { role_id: staffRole.id, permission_key: 'payroll' }, prefer: 'return=representation',
      });
      const after = await perms(WHO.staff, BIZ);
      ok('a ' + role + ' cannot grant payroll to the staff role',
         !after.includes('payroll'), 'status ' + r1.status);

      const r2 = await one(WHO[role], {
        method: 'PATCH', path: `/rest/v1/business_roles?id=eq.${staffRole.id}`,
        body: { name: 'Hijacked' }, prefer: 'return=representation',
      });
      const back = await one(WHO.owner, {
        method: 'GET', path: `/rest/v1/business_roles?id=eq.${staffRole.id}&select=name`,
      });
      ok('  nor rename it', back.body[0].name !== 'Hijacked', 'status ' + r2.status);
    }

    /* The owner can, and it takes effect with no sign-in in between. */
    const g = await one(WHO.owner, {
      method: 'POST', path: '/rest/v1/business_role_permissions',
      body: { role_id: staffRole.id, permission_key: 'expenses' }, prefer: 'return=representation',
    });
    const granted = await perms(WHO.staff, BIZ);
    ok('the owner can grant a permission', granted.includes('expenses'), 'status ' + g.status);
    ok('  and it is only that one', !granted.includes('payroll') && !granted.includes('funds'));

    const d = await one(WHO.owner, {
      method: 'DELETE',
      path: `/rest/v1/business_role_permissions?role_id=eq.${staffRole.id}&permission_key=eq.expenses`,
    });
    const revoked = await perms(WHO.staff, BIZ);
    ok('and revoking takes effect immediately', !revoked.includes('expenses'), 'status ' + d.status);
  }

  // -------------------------------------------------------------------
  section('An owner cannot be locked out of their own studio');
  // -------------------------------------------------------------------
  {
    const ownerRole = (await one(WHO.owner, {
      method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.owner&select=id`,
    })).body[0];

    const strip = await one(WHO.owner, {
      method: 'DELETE', path: `/rest/v1/business_role_permissions?role_id=eq.${ownerRole.id}`,
    });
    const still = await perms(WHO.owner, BIZ);
    ok('stripping the owner role changes nothing', still.length >= 44,
       'status ' + strip.status + ', ' + still.length + ' keys');
    ok('  because the tier answers before the table is read',
       await can(WHO.owner, BIZ, 'ownership.transfer'));

    const tier = await one(WHO.owner, {
      method: 'PATCH', path: `/rest/v1/business_roles?id=eq.${ownerRole.id}`,
      body: { tier: 'viewer' }, prefer: 'return=representation',
    });
    const t = (await one(WHO.owner, {
      method: 'GET', path: `/rest/v1/business_roles?id=eq.${ownerRole.id}&select=tier`,
    })).body[0];
    ok('and a built-in role’s level cannot be changed at all',
       t.tier === 'owner', 'status ' + tier.status);
  }

  // -------------------------------------------------------------------
  section('Nobody assigns themselves a better role');
  // -------------------------------------------------------------------
  {
    const ownerRole = (await one(WHO.owner, {
      method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${BIZ}&key=eq.owner&select=id`,
    })).body[0];
    for (const role of ['manager', 'staff']) {
      const r = await one(WHO[role], {
        method: 'PATCH', path: `/rest/v1/memberships?user_id=eq.${WHO[role]}&business_id=eq.${BIZ}`,
        body: { role_id: ownerRole.id }, prefer: 'return=representation',
      });
      const now = await perms(WHO[role], BIZ);
      ok('a ' + role + ' cannot point their membership at the owner role',
         now.length < 40, 'status ' + r.status + ', ' + now.length + ' keys');
    }
  }

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
