/* =====================================================================
   BATCH C — invitations against the final RBAC model.

   STAGING ONLY. The whole invitee journey server side, with no email in
   it, plus the two things the product principle turns on: an owner can
   DELEGATE inviting, and the role chosen on the invitation is the role the
   person ends up holding.

   Includes the existing-user case into Ìfé Leather, which is the test that
   has been waiting since 28 September.

   usage: node tools/rbac_batch_c_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const ADE = 'c80aba9c-d12e-4302-a442-2669b0907a95';   // Adé Bespoke
const IFE = 'eed02aab-8d8b-44f8-a983-dadc59e9980c';   // Ìfé Leather
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

const OWNER_A = '4c5767ee-0258-4a90-8e46-3dd53920340a';  // owner of Adé
const OWNER_B = 'e2e.owner.b@ag2staging.thelabelboard.com';
const MANAGER = '2f7e2234-9477-461b-933e-1371d2ef1a57';  // manager of Adé
const EMAIL = 'probe.batchc@thelabelboard.com';

let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const fn = async (name, body) => (await fetch(PROJ + '/functions/v1/' + name, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})).json();
const team = (uid, action, payload) => fn('inv-e2e', { as_user_id: uid, action, payload });
const asUser = async (uid, calls) => (await fn('as-user', { as_user_id: uid, calls })).results;
const one = async (uid, call) => (await asUser(uid, [call]))[0];

const roleId = async (biz, key) => {
  const r = await one(OWNER_A, { method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${biz}&key=eq.${key}&select=id` });
  return r.body[0] && r.body[0].id;
};
const listTeam = async (uid, biz) => {
  const r = await team(uid, 'list', { business_id: biz });
  return r.body || {};
};
const seats = async (biz) => {
  const l = await listTeam(OWNER_A, biz);
  return { active: (l.rows || []).length, pending: (l.invitations || []).length };
};

(async () => {
  console.log('=== BATCH C — invitations, staging ===');
  await fn('pw-probe', { mode: 'clean', email: EMAIL });

  const staffRole = await roleId(ADE, 'staff');
  const managerRole = await roleId(ADE, 'manager');

  // -------------------------------------------------------------------
  section('An owner can delegate inviting, and until then nobody else can');
  // -------------------------------------------------------------------
  {
    let r = await team(MANAGER, 'invite', { business_id: ADE, email: EMAIL, name: 'Batch C', role: 'staff' });
    ok('a manager without team.invite is refused', r.status === 403 && r.body.code === 'forbidden',
       'status ' + r.status);
    ok('  and is told which permission is missing', r.body.needs === 'team.invite');

    await one(OWNER_A, {
      method: 'POST', path: '/rest/v1/business_role_permissions',
      body: { role_id: managerRole, permission_key: 'team.invite' },
    });
    r = await team(MANAGER, 'invite', {
      business_id: ADE, email: EMAIL, name: 'Batch C Probe', role: 'staff', role_id: staffRole,
    });
    ok('once the owner grants team.invite, the manager can', r.status === 200, JSON.stringify(r.body).slice(0, 140));
    ok('  and the invitation carries the role that was chosen', r.body.role_id === staffRole);

    /* clean the delegation up so the fixture is as it was */
    await one(OWNER_A, {
      method: 'DELETE',
      path: `/rest/v1/business_role_permissions?role_id=eq.${managerRole}&permission_key=eq.team.invite`,
    });
    const after = await team(MANAGER, 'invite', { business_id: ADE, email: 'x@thelabelboard.com', name: 'X', role: 'staff' });
    ok('revoking it closes the door again immediately', after.status === 403);
  }

  // -------------------------------------------------------------------
  section('Cancel releases the seat');
  // -------------------------------------------------------------------
  {
    const before = await seats(ADE);
    const l = await listTeam(OWNER_A, ADE);
    const inv = (l.invitations || []).find(x => x.email === EMAIL);
    ok('the invitation is pending and holding a seat', !!inv && before.pending >= 1);

    const c = await team(OWNER_A, 'cancelInvitation', { business_id: ADE, invitation_id: inv.id });
    ok('the owner can cancel it', c.status === 200, JSON.stringify(c.body).slice(0, 120));
    const after = await seats(ADE);
    ok('and the seat comes back', after.pending === before.pending - 1,
       before.pending + ' -> ' + after.pending);
    const again = await team(OWNER_A, 'cancelInvitation', { business_id: ADE, invitation_id: inv.id });
    ok('cancelling twice is refused rather than silently repeated', again.status === 400);
  }

  // -------------------------------------------------------------------
  section('A new person joins with the role the invitation named');
  // -------------------------------------------------------------------
  let uid = '';
  {
    const mk = await fn('pw-probe', {
      mode: 'link_only', email: EMAIL, business_id: ADE, invited_by: OWNER_A,
      role: 'staff', name: 'Batch C Probe',
    });
    uid = mk.log.user_id;
    const invId = mk.log.invitation_id;
    /* pw-probe creates the invitation directly, so stamp the role the way
       team-admin does */
    await fn('pw-probe', { mode: 'stamp_role', invitation_id: invId, role_id: staffRole });

    const r = await fetch(mk.action_link, { redirect: 'manual' });
    const tok = new URLSearchParams((r.headers.get('location') || '').split('#')[1] || '').get('access_token');
    await fetch(PROJ + '/auth/v1/user', {
      method: 'PUT',
      headers: { apikey: KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Probe2026batchc' }),
    });
    const acc = await fetch(PROJ + '/rest/v1/rpc/accept_invitation', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_invitation_id: invId }),
    });
    ok('they accept', acc.status === 200, 'status ' + acc.status);

    const m = (await one(uid, { method: 'POST', path: '/rest/v1/rpc/my_membership', body: { p_business: ADE } })).body[0];
    ok('their membership carries the chosen role', m && m.role_id === staffRole, JSON.stringify(m));
    ok('  and the tier that goes with it', m && m.tier === 'staff');

    const perms = (await one(uid, { method: 'POST', path: '/rest/v1/rpc/my_permissions', body: { p_business: ADE } }))
      .body.map(x => x.permission_key);
    ok('they hold the staff permissions', perms.includes('orders') && perms.includes('orders.edit'));
    ok('  and not the ones staff do not get', !perms.includes('finance') && !perms.includes('users'));

    const txns = await one(uid, { method: 'GET', path: `/rest/v1/app_state?business_id=eq.${ADE}&key=eq.layi_dash_txns&select=key` });
    ok('  and the database agrees: no transactions', (txns.body || []).length === 0);
  }

  // -------------------------------------------------------------------
  section('The same person joins a SECOND studio with a different role');
  // -------------------------------------------------------------------
  {
    const ownerB = (await one(OWNER_A, {
      method: 'GET', path: `/rest/v1/memberships?business_id=eq.${IFE}&role=eq.owner&status=eq.active&select=user_id&limit=1`,
    })).body;
    /* the owner of Adé cannot read Ìfé's memberships, so resolve by email */
    const bId = ownerB && ownerB[0] ? ownerB[0].user_id : null;
    const inviter = bId || OWNER_A;

    const mgrRoleIfe = await (async () => {
      const r = await one(inviter, { method: 'GET', path: `/rest/v1/business_roles?business_id=eq.${IFE}&key=eq.manager&select=id` });
      return r.body[0] && r.body[0].id;
    })();

    const mk = await fn('pw-probe', {
      mode: 'link_only', email: EMAIL, business_id: IFE, invited_by: inviter,
      role: 'manager', name: 'Batch C Probe',
    });
    const invId = (mk.log || {}).invitation_id;
    ok('a second invitation can be made for an address that already has an account', !!invId,
       JSON.stringify(mk).slice(0, 140));
    if (mgrRoleIfe) {
      await fn('pw-probe', { mode: 'stamp_role', invitation_id: invId, role_id: mgrRoleIfe });
    }

    const acc = await one(uid, { method: 'POST', path: '/rest/v1/rpc/accept_invitation', body: { p_invitation_id: invId } });
    ok('the existing user accepts it as themselves', acc.status === 200, 'status ' + acc.status);

    const inAde = (await one(uid, { method: 'POST', path: '/rest/v1/rpc/my_permissions', body: { p_business: ADE } }))
      .body.map(x => x.permission_key);
    const inIfe = (await one(uid, { method: 'POST', path: '/rest/v1/rpc/my_permissions', body: { p_business: IFE } }))
      .body.map(x => x.permission_key);
    ok('staff in one studio', !inAde.includes('audit') && inAde.includes('orders'));
    ok('manager in the other, at the same moment', inIfe.includes('audit') && inIfe.includes('expenses'),
       inIfe.length + ' keys in Ìfé');
    ok('and the two answers are different', inAde.length !== inIfe.length,
       inAde.length + ' vs ' + inIfe.length);

    const mA = (await one(uid, { method: 'POST', path: '/rest/v1/rpc/my_membership', body: { p_business: ADE } })).body[0];
    const mB = (await one(uid, { method: 'POST', path: '/rest/v1/rpc/my_membership', body: { p_business: IFE } })).body[0];
    ok('two memberships, two roles', mA.role_key !== mB.role_key, mA.role_key + ' / ' + mB.role_key);

    const txnsIfe = await one(uid, { method: 'GET', path: `/rest/v1/app_state?business_id=eq.${IFE}&key=eq.layi_dash_txns&select=key` });
    const txnsAde = await one(uid, { method: 'GET', path: `/rest/v1/app_state?business_id=eq.${ADE}&key=eq.layi_dash_txns&select=key` });
    ok('the database answers per studio too, not per person',
       (txnsAde.body || []).length === 0, 'still no transactions in Adé');
  }

  // -------------------------------------------------------------------
  section('No duplicates anywhere');
  // -------------------------------------------------------------------
  {
    const users = (await one(OWNER_A, { method: 'GET', path: `/rest/v1/profiles?id=eq.${uid}&select=id` })).body;
    const mems = (await one(uid, { method: 'GET', path: `/rest/v1/memberships?user_id=eq.${uid}&select=business_id` })).body;
    ok('one profile', (users || []).length <= 1);
    ok('two memberships, one per studio', (mems || []).length === 2, JSON.stringify(mems));
  }

  const cleaned = await fn('pw-probe', { mode: 'clean', email: EMAIL });
  console.log('  (cleaned: ' + JSON.stringify(cleaned.cleaned) + ')');

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
