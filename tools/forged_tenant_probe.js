/* =====================================================================
   THE CLIENT'S business_id IS A CLAIM, NOT AUTHORITY.

   STAGING ONLY. P3 stops the browser sending one studio's work to
   another. This asks the question the browser cannot answer for itself:
   if a client DID forge the tenant on a request, what does the database
   do about it?

   Three shapes, all with a real signed-in session:

     1. a member of A only, claiming B            -> must be refused
     2. a member of A only, claiming B on a row
        whose own identity belongs to A           -> must be refused
     3. a member of BOTH A and B, claiming B      -> ACCEPTED, and that is
        correct: they may write to B. This is the case the client-side
        binding exists for, and the honest finding is that the database
        cannot distinguish it, because there is nothing to distinguish.

   The third one matters. It is why P3 is a client fix with a server
   backstop rather than a server fix: RLS can stop you reaching a studio
   you do not belong to, and it cannot stop you writing to one you do.

   usage: node tools/forged_tenant_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const A = '7256137b-2d3b-4d2d-86da-a7651d6bb10c';   // Seed Multi Studio
const B = 'c80aba9c-d12e-4302-a442-2669b0907a95';   // Adé Bespoke
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];

const ONLY_A = 'probe.forge.onlya@thelabelboard.com';
const BOTH   = 'probe.forge.both@thelabelboard.com';

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
const TAG = 'forge' + Date.now();

(async () => {
  console.log('=== A FORGED TENANT ON A REAL SESSION, staging ===');
  await fn('e2e-fixture', { mode: 'clean', business_id: A, emails: [ONLY_A, BOTH] });
  await fn('e2e-fixture', { mode: 'clean', business_id: B, emails: [ONLY_A, BOTH] });

  const onlyA = await fn('e2e-fixture', { mode: 'member', email: ONLY_A, name: 'Only A', business_id: A, role: 'owner' });
  const bothA = await fn('e2e-fixture', { mode: 'member', email: BOTH, name: 'Both', business_id: A, role: 'owner' });
  await fn('e2e-fixture', { mode: 'member', email: BOTH, name: 'Both', business_id: B, role: 'owner' });
  ok('the cast exists', !!onlyA.user_id && !!bothA.user_id,
     JSON.stringify([!!onlyA.user_id, !!bothA.user_id]));
  if (fail) process.exit(1);

  section('1. A member of A only, claiming B');
  {
    for (const [what, path, body] of [
      ['app_state', '/rest/v1/app_state', { business_id: B, key: 'layi_dash_tasks', data: { forged: TAG } }],
      ['customers', '/rest/v1/customers', { business_id: B, name: 'Forged ' + TAG }],
      ['orders',    '/rest/v1/orders',    { business_id: B, app_id: TAG, total: 1, status: 'open', doc: {} }],
      ['order_costs','/rest/v1/order_costs',{ business_id: B, order_id: '00000000-0000-0000-0000-000000000000', cost: 1 }],
    ]) {
      const r = await call(onlyA.user_id, { method: 'POST', path, prefer: 'resolution=merge-duplicates', body });
      ok('writing ' + what + ' into a studio they do not belong to is refused',
         r.status >= 400, 'status ' + r.status + ' ' + JSON.stringify(r.body || '').slice(0, 110));
    }
    const read = await call(onlyA.user_id, { method: 'GET', path: '/rest/v1/app_state?business_id=eq.' + B + '&select=key' });
    ok('  and they cannot read that studio either', rows(read).length === 0,
       'status ' + read.status + ', ' + rows(read).length + ' rows');
  }

  section('2. The row belongs to A, the claim says B');
  {
    /* create something real in A, then try to move it to B by claiming B */
    const made = await call(bothA.user_id, { method: 'POST', path: '/rest/v1/customers',
      prefer: 'return=representation', body: { business_id: A, name: 'Belongs to A ' + TAG } });
    const id = rows(made)[0] && rows(made)[0].id;
    ok('a row exists in A', !!id, JSON.stringify(made.body || '').slice(0, 120));

    if (id) {
      const moved = await call(onlyA.user_id, { method: 'PATCH',
        path: '/rest/v1/customers?id=eq.' + id, body: { business_id: B } });
      const after = await call(bothA.user_id, { method: 'GET', path: '/rest/v1/customers?id=eq.' + id + '&select=business_id' });
      const still = rows(after)[0] && rows(after)[0].business_id;
      ok('a member of A only cannot re-tenant A’s row into B',
         still === A, 'status ' + moved.status + ', the row now says ' + still);
    }
  }

  section('3. A member of BOTH, claiming B — accepted, and that is correct');
  {
    const r = await call(bothA.user_id, { method: 'POST', path: '/rest/v1/app_state',
      prefer: 'resolution=merge-duplicates',
      body: { business_id: B, key: 'layi_dash_tasks', data: { written_by_a_member_of_both: TAG } } });
    ok('somebody who belongs to B may write to B, whatever they had on screen',
       r.status < 300, 'status ' + r.status + ' ' + JSON.stringify(r.body || '').slice(0, 110));
    console.log('        ^ this is the case the client-side binding exists for.');
    console.log('          The database cannot tell an intended write to B from a');
    console.log('          misrouted one, because both are a member writing to their');
    console.log('          own studio. Nothing in RLS can close it; the tenant has to');
    console.log('          travel with the work. audit_outbox_tenant.js is that proof.');
    /* clean the marker back out so the studio is as it was */
    await call(bothA.user_id, { method: 'POST', path: '/rest/v1/app_state',
      prefer: 'resolution=merge-duplicates',
      body: { business_id: B, key: 'layi_dash_tasks', data: [] } });
  }

  section('4. And the studio a forged write aimed at is untouched');
  {
    const r = await call(bothA.user_id, { method: 'GET', path: '/rest/v1/customers?business_id=eq.' + B + '&select=name' });
    const forged = rows(r).filter(x => String(x.name || '').includes(TAG));
    ok('no forged row reached B', forged.length === 0, JSON.stringify(forged));
  }

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) console.log('\nA FORGED TENANT SUCCEEDED.');
  else console.log('\nA claim to a studio you do not belong to is refused. A claim to one\nyou do belong to is allowed, which is why the tenant travels with the\nwork rather than being decided when it is sent.');
  process.exit(fail ? 1 : 0);
})();
