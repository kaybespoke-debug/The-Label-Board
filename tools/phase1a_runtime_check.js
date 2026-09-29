/* =====================================================================
   phase1a_runtime_check.js

   The five Phase 1A runtime checks that need a signed-in owner. Everything
   that could be tested without a session already has been, against
   production: T09 (no header) and T10 (forged token) both return 401, and
   a validly signed non-user token is refused by the function itself.

   These five cannot be, because getting an owner's access token means
   signing in, and signing in means a password. Passwords are yours, so
   this script is yours to run.

   HOW. Sign in to https://app.thelabelboard.com as the owner, open the
   browser console (F12, then Console), paste this whole file, press enter.
   It reads the session the page already holds. It never asks for a
   password and never sends one anywhere.

   WHAT IT DOES. Five calls, none destructive:

     1  list                        an allowed action, expect 200
     2  update a foreign id         expect 403
     3  update a platform admin     expect 403
     4  update an unknown uuid      expect 403
     5  invite                      expect 503 and NOTHING created

   Nothing here targets a real account for deletion. The delete path shares
   the one guard with update, which is the point of having one guard, and
   it is proved against real rows in supabase/tests/team_admin_harness.mjs.

   After it finishes, send me the output and I will take the census again
   to confirm the invite created nothing.
   ===================================================================== */

(async () => {
  /* The app declares its client as `let supa=null;` at the top level, and a
     top-level let/const never becomes a property of window. So window.supa is
     undefined even on the right tab, and window.supabase is the LIBRARY, not a
     signed-in client — it has no .auth. The bare name does resolve, because
     the console evaluates through the global scope chain.

     Got this wrong first time and sent Kayode round in circles on the correct
     tab. `window.x` and `x` are not the same lookup. */
  const c = (typeof supa !== 'undefined' && supa) ? supa : null;
  if (!c || !c.auth) {
    return console.error(
      'No Supabase client on this page. This must run on the app.thelabelboard.com tab.');
  }

  const { data: { session } } = await c.auth.getSession();
  if (!session) return console.error('No session. Sign in first.');
  console.log('Signed in as', session.user.email);

  const call = async (action, payload) => {
    const r = await fetch(
      'https://eskubrbgbcbaejynjxvh.supabase.co/functions/v1/team-admin',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({ action, payload: payload || {} }),
      },
    );
    let body; try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  };

  /* Ids chosen so none of them is a real teammate of yours. The first is a
     seeded test studio's owner, the second is the console owner account,
     the third does not exist at all. */
  const FOREIGN = 'e27d7531-ab15-42d0-a414-7e1b154646da'; // Adé Bespoke's owner
  const PLATFORM = '52c36410-76d1-4a4e-b86a-9250640a46b7'; // your console login
  const UNKNOWN = '00000000-0000-4000-8000-000000000000';

  const CASES = [
    ['1  list (allowed)', 'list', {}, 200],
    ['2  update a foreign studio’s owner', 'update', { id: FOREIGN, name: 'x' }, 403],
    ['3  update a platform admin', 'update', { id: PLATFORM, name: 'x' }, 403],
    ['4  update an unknown uuid', 'update', { id: UNKNOWN, name: 'x' }, 403],
    ['5  invite (must be inert)', 'invite', { email: 'phase1a.check@example.com', name: 'Check' }, 503],
  ];

  const out = [];
  for (const [label, action, payload, want] of CASES) {
    const { status, body } = await call(action, payload);
    const pass = status === want;
    out.push({ check: label, expected: want, got: status, result: pass ? 'PASS' : 'FAIL',
               message: (body && (body.error || body.code)) || (body && body.rows ? body.rows.length + ' rows' : '') });
    console.log((pass ? 'PASS  ' : 'FAIL  ') + label + '  expected ' + want + ', got ' + status);
  }
  console.table(out);

  const failed = out.filter(o => o.result === 'FAIL').length;
  console.log(failed ? '\n' + failed + ' FAILED. Send me this output.'
                     : '\nAll five passed. Send me this output and I will take the census.');
})();
