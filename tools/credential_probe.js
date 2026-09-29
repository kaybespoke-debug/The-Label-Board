/* =====================================================================
   NO AUTHENTICATION SECRET IS REACHABLE BY HOLDING A MEMBERSHIP.

   STAGING ONLY. Real sessions, straight to PostgREST.

   The finding this exists for, from the independent audit of 29 September:
   signed in as an ordinary staff member of a studio, over the public API,
   GET app_state?key=eq.layi_dash_settings returned the owner's password and
   GET app_state?key=eq.layi_dash_users returned everybody's PIN — and the
   app's local login accepted them. A staff member could read the owner's
   credential on their own phone and sign in as the owner on the studio's
   tablet, seeing every screen their role hides.

   Run BEFORE the fix and the checks in sections 1 and 2 fail, which is the
   finding reproduced. Run after and they pass. That is the point of it: a
   check that has only ever been run against the fixed database cannot tell
   a working rule from a table that happens to be empty, so this probe
   WRITES the credential first, as the owner, exactly as an old build does.

   Nothing here prints a secret. The probe writes a value it already knows
   and reports only whether that value came back.

   usage: node tools/credential_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const BIZ  = '7256137b-2d3b-4d2d-86da-a7651d6bb10c';   // Seed Multi Studio
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

/* A value that is not a real credential and never will be, so that a leak is
   unmistakable in the output without the output containing a secret. */
const SENTINEL = 'probe-sentinel-' + Date.now();

const OWNER_EMAIL   = 'probe.cred.owner@thelabelboard.com';
const MANAGER_EMAIL = 'probe.cred.manager@thelabelboard.com';
const STAFF_EMAIL   = 'probe.cred.staff@thelabelboard.com';
const VIEWER_EMAIL  = 'probe.cred.viewer@thelabelboard.com';

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

/* Does this response contain the sentinel ANYWHERE — top level, nested under
   company, inside an array of accounts, under a key nobody thought of. A
   field-by-field check would only ever find the leak it already expected. */
const leaks = (r) => JSON.stringify((r && r.body) || '').includes(SENTINEL);

(async () => {
  console.log('=== AUTHENTICATION SECRETS AND MEMBERSHIP, staging ===');
  await fn('e2e-fixture', { mode: 'clean', business_id: BIZ,
    emails: [OWNER_EMAIL, MANAGER_EMAIL, STAFF_EMAIL, VIEWER_EMAIL] });

  const owner   = await fn('e2e-fixture', { mode: 'member', email: OWNER_EMAIL,   name: 'Cred Owner',   business_id: BIZ, role: 'owner' });
  const manager = await fn('e2e-fixture', { mode: 'member', email: MANAGER_EMAIL, name: 'Cred Manager', business_id: BIZ, role: 'manager' });
  const staff   = await fn('e2e-fixture', { mode: 'member', email: STAFF_EMAIL,   name: 'Cred Staff',   business_id: BIZ, role: 'staff' });
  const viewer  = await fn('e2e-fixture', { mode: 'member', email: VIEWER_EMAIL,  name: 'Cred Viewer',  business_id: BIZ, role: 'viewer' });
  ok('the cast exists', !!owner.user_id && !!manager.user_id && !!staff.user_id && !!viewer.user_id,
     JSON.stringify([owner, manager, staff, viewer]).slice(0, 200));

  const CAST = [['a manager', manager.user_id], ['a staff member', staff.user_id], ['a viewer', viewer.user_id]];

  // -------------------------------------------------------------------
  section('1. The owner tries to store the credential, as an old build does');
  // -------------------------------------------------------------------
  /* The settings blob is written by forty-seven places in the app and most of
     them are somebody doing their job, so this write is ACCEPTED and the
     credential is dropped out of it. A phone that has not updated has to keep
     working; it simply stops syncing the password. */
  const put = await one(owner.user_id, {
    method: 'POST', path: '/rest/v1/app_state', prefer: 'resolution=merge-duplicates',
    body: { business_id: BIZ, key: 'layi_dash_settings',
            data: { currency: 'NGN', ownerPassword: SENTINEL,
                    company: { name: 'Seed Multi Studio', ownerPassword: SENTINEL } } },
  });
  ok('an ordinary settings save is still accepted', put.status < 300, 'status ' + put.status);

  const back = await one(owner.user_id, { method: 'GET', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=eq.layi_dash_settings&select=data' });
  ok('but the password is not in what was stored, even for the owner', !leaks(back),
     'the owner’s own password came back out of the table');
  ok('  and the rest of the settings were kept',
     !!(rows(back)[0] || {}).data && rows(back)[0].data.currency === 'NGN',
     JSON.stringify(rows(back).length) + ' rows');

  /* The account list is refused outright rather than stripped: it is a list of
     usernames and PINs and there is no part of it worth keeping. */
  const users = await one(owner.user_id, {
    method: 'POST', path: '/rest/v1/app_state', prefer: 'resolution=merge-duplicates',
    body: { business_id: BIZ, key: 'layi_dash_users',
            data: [{ id: 'u-owner', username: 'owner', roleId: 'owner', pin: SENTINEL }] },
  });
  ok('and the device account list is refused outright, even from the owner',
     users.status >= 400, 'status ' + users.status);

  // -------------------------------------------------------------------
  section('2. And nobody else can reach one either');
  // -------------------------------------------------------------------
  for (const [who, uid] of CAST) {
    const r = await one(uid, { method: 'GET', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=eq.layi_dash_settings&select=data' });
    ok(who + ' is not handed the owner’s password', !leaks(r), 'it was in the reply');
  }
  for (const [who, uid] of CAST) {
    const r = await one(uid, { method: 'GET', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=eq.layi_dash_users&select=data' });
    ok(who + ' is not handed anybody’s PIN', !leaks(r) && rows(r).length === 0,
       'status ' + r.status + ', ' + rows(r).length + ' rows');
  }
  /* Asking for the one field rather than the whole blob is not a way round a
     rule that is about the field. */
  for (const [who, uid] of CAST) {
    const r = await one(uid, { method: 'GET', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=eq.layi_dash_settings&select=data->>ownerPassword' });
    ok('  nor ' + who + ' naming the field directly', !leaks(r), 'it was in the reply');
  }

  // -------------------------------------------------------------------
  section('3. Nor put one there for somebody else to read');
  // -------------------------------------------------------------------
  for (const [who, uid] of CAST) {
    const w = await one(uid, {
      method: 'POST', path: '/rest/v1/app_state', prefer: 'resolution=merge-duplicates',
      body: { business_id: BIZ, key: 'layi_dash_users', data: [{ username: 'x', pin: SENTINEL }] },
    });
    ok(who + ' cannot create the account list', w.status >= 400, 'status ' + w.status);
  }
  /* And the strip is not a read-side illusion: a member writing the field into
     settings must not leave it in the row for the next reader. */
  const mgrPut = await one(manager.user_id, {
    method: 'PATCH', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=eq.layi_dash_settings',
    body: { data: { currency: 'NGN', ownerPassword: SENTINEL } },
  });
  const afterMgr = await one(owner.user_id, { method: 'GET', path: '/rest/v1/app_state?business_id=eq.' + BIZ + '&key=eq.layi_dash_settings&select=data' });
  ok('a member cannot plant a password in settings for anybody to read',
     !leaks(afterMgr), 'the write answered ' + mgrPut.status + ' and it stayed in the row');

  // -------------------------------------------------------------------
  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) console.log('\nA FAILURE HERE IS A CREDENTIAL REACHABLE BY A MEMBERSHIP.');
  else console.log('\nNo password and no PIN is reachable from a session that merely\nbelongs to the studio, and none can be put back.');
  process.exit(fail ? 1 : 0);
})();
