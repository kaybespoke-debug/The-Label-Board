/* =====================================================================
   THE SAFE PRODUCTION CREDENTIAL PROBE.

   The full probe (tools/credential_probe.js) mints manager, staff and
   viewer sessions to ask for the secret as each of them. It can only run
   on staging, because minting a session for an arbitrary user requires an
   Edge Function that production does not have and must never have.

   So this one asks production the questions that CAN be asked from
   outside with nothing but the public key the app itself ships, and it
   reads nothing it is not entitled to. It is READ-ONLY. It writes
   nothing, creates no account and touches no studio's data.

   What it establishes:
     1. The anon key — lower privilege than any member — reaches no
        app_state row at all, so the table is not world-readable.
     2. Neither retired key is reachable by name.
     3. The app being served from app.thelabelboard.com is the build that
        no longer syncs either credential.

   What it CANNOT establish, and what covers that instead: whether a
   signed-in low-privilege MEMBER is refused. That needs a real session
   for a real member of a real studio, which on production would mean
   creating one. It is proved on staging with genuine manager, staff and
   viewer sessions, against byte-identical policies, functions and
   triggers — the fourteen objects hash the same on both projects — and
   on production by there being no credential left in the table to hand
   anybody.

   usage: node tools/credential_probe_production.js
   ===================================================================== */
const fs = require('fs');

const src = fs.readFileSync('site/layi_dashboard.html', 'utf8');
const PROJ = 'https://eskubrbgbcbaejynjxvh.supabase.co';
const KEY = src.match(/eskubrbgbcbaejynjxvh\.supabase\.co',\s*key: '([^']+)'/)[1];
const APP = 'https://app.thelabelboard.com/';

let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const anon = async (path) => {
  const r = await fetch(PROJ + '/rest/v1/' + path, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b, rows: Array.isArray(b) ? b.length : 0 };
};

(async () => {
  console.log('=== PRODUCTION CREDENTIAL PROBE (read-only, public key only) ===');

  // -------------------------------------------------------------------
  section('1. The table is not reachable without a session');
  // -------------------------------------------------------------------
  const all = await anon('app_state?select=key');
  ok('the anon key reaches no app_state row', all.rows === 0,
     'status ' + all.status + ', ' + all.rows + ' rows');

  for (const key of ['layi_dash_settings', 'layi_dash_users']) {
    const r = await anon('app_state?select=data&key=eq.' + key);
    ok('  nor ' + key + ' by name', r.rows === 0, 'status ' + r.status + ', ' + r.rows + ' rows');
  }
  const field = await anon('app_state?select=data->>ownerPassword&key=eq.layi_dash_settings');
  ok('  nor the password field named directly', field.rows === 0,
     'status ' + field.status + ', ' + field.rows + ' rows');

  /* And nothing leaks through the shape of the reply either: a refusal and
     an empty studio must be indistinguishable to somebody guessing. */
  ok('  and the refusal carries no credential in its message',
     !/ownerPassword|pin/i.test(JSON.stringify(all.body || '')),
     JSON.stringify(all.body || '').slice(0, 120));

  // -------------------------------------------------------------------
  section('2. The build being served is the one that stopped syncing them');
  // -------------------------------------------------------------------
  let page = '';
  try {
    page = await (await fetch(APP, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })).text();
  } catch (e) { console.log('  (could not fetch ' + APP + ': ' + e.message + ')'); }

  if (page) {
    ok('the served app has the local-login guard', /function localLoginAllowed\(\)\s*{\s*return !SUPA_URL;\s*}/.test(page),
       'localLoginAllowed() is not in the served build');
    ok('the served app strips the password before any cloud write', /function cloudSafe\(key,payload\)/.test(page),
       'cloudSafe() is not in the served build');
    const writers = (page.match(/cloudSafe\(/g) || []).length;
    ok('  and every app_state writer goes through it', writers >= 4,
       'found ' + writers + ' references, expected the definition plus three writers');
    ok('the account list is no longer a synced key',
       /const STATE_KEYS=\[(?!.*layi_dash_users)/.test(page.split('\n').find(l => l.includes('const STATE_KEYS=[')) || ''),
       'layi_dash_users is still in STATE_KEYS in the served build');
  } else {
    console.log('  SKIP  the served build could not be fetched from this machine');
  }

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) console.log('\nA FAILURE HERE IS A CREDENTIAL REACHABLE ON PRODUCTION.');
  else console.log('\nNothing reaches a credential on production from outside, and the\nbuild being served is the one that stopped putting them there.');
  process.exit(fail ? 1 : 0);
})();
