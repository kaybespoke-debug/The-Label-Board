/* =====================================================================
   THE PUBLIC KEY OPENS NONE OF THE MONEY.

   Production-safe: it reads with the publishable anon key, which anybody
   who views source already has, and writes nothing. Two tables arrived in
   October and Supabase grants all on a new table in `public` to anon by
   default, so "we revoked it" has to be checked rather than believed —
   `revoke from public` does not undo an explicit grant, and that is the
   mistake tlb_policy_harness exists for.

   usage: node tools/anon_money_check.js [--staging]
   ===================================================================== */
const fs = require('fs');

const STAGING = process.argv.includes('--staging');
const html = fs.readFileSync('site/layi_dashboard.html', 'utf8');
const ref = STAGING ? 'pakxhimjhrcpqvtsqwqz' : 'eskubrbgbcbaejynjxvh';
const m = html.match(new RegExp(ref + "\\.supabase\\.co',\\s*\\n?\\s*key: '([^']+)'"));
if (!m) { console.error('no anon key for ' + ref + ' in the app'); process.exit(1); }
const KEY = m[1];
const BASE = 'https://' + ref + '.supabase.co';

let pass = 0; const fails = [];
const ok = (n, c, why) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fails.push(n + (why ? ' — ' + why : '')); console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); }
};

/* Every table an order's money lives in, plus the view that used to
   publish the price to anybody with a login. */
const TABLES = ['order_pricing', 'order_settlement', 'orders', 'order_costs',
                'order_commissions', 'order_contacts', 'order_items',
                'transactions', 'order_summary'];

(async () => {
  console.log('=== THE PUBLIC KEY, AGAINST ' + (STAGING ? 'STAGING' : 'PRODUCTION') + ' ===\n');
  for (const t of TABLES) {
    const r = await fetch(BASE + '/rest/v1/' + t + '?select=*&limit=1',
      { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    const body = (await r.text()).slice(0, 120);
    let rows = null;
    try { const j = JSON.parse(body); if (Array.isArray(j)) rows = j.length; } catch (e) { /* not an array */ }

    if (t === 'order_summary') {
      /* Gone, not merely empty. It was a security_invoker view granted to
         authenticated, selecting the selling price. */
      ok('order_summary is gone rather than empty', rows === null && r.status >= 400,
         'status ' + r.status + ' ' + body);
      continue;
    }
    /* An empty array is the right answer as well as a 401/403: RLS with no
       matching policy returns no rows rather than an error. What must never
       happen is a row coming back. */
    ok('anon reads nothing from ' + t, rows === 0 || rows === null && r.status >= 400,
       'status ' + r.status + ', ' + (rows === null ? 'non-array' : rows + ' row(s)') + ' ' + body);
  }

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fails.length + ' failed');
  for (const f of fails) console.log('  - ' + f);
  if (!fails.length) console.log('\nNothing an order is worth, and nothing paid on it, is reachable\nwith the key that ships in the page.');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('CHECK BROKE: ' + (e && e.message || e)); process.exit(1); });
