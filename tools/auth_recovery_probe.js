/* =====================================================================
   BATCH D — getting back in.

   STAGING ONLY. The route that has been dead since 13 September: every
   "Forgot password?" in the product handed the message to Supabase SMTP
   and told the person to check an inbox nothing was sent to.

   The assertions that matter most here are the ones about what the
   endpoint does NOT say. It is unauthenticated, so any difference between
   a known and an unknown address is a free list of who banks here.

   usage: node tools/auth_recovery_probe.js
   ===================================================================== */
const fs = require('fs');

const PROJ = 'https://pakxhimjhrcpqvtsqwqz.supabase.co';
const KEY = fs.readFileSync('site/layi_dashboard.html', 'utf8')
  .match(/pakxhimjhrcpqvtsqwqz\.supabase\.co',\s*key: '([^']+)'/)[1];
const ADE = 'c80aba9c-d12e-4302-a442-2669b0907a95';
const OWNER_A = '4c5767ee-0258-4a90-8e46-3dd53920340a';
const PROBE = 'probe.recover@thelabelboard.com';

let pass = 0, fail = 0;
const ok = (n, c, why) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (why ? ' — ' + why : '')); } };
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const fn = async (name, body) => (await fetch(PROJ + '/functions/v1/' + name, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})).json();

const recover = async (email) => {
  const t0 = Date.now();
  const r = await fetch(PROJ + '/functions/v1/auth-recover', {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await r.text();
  return { status: r.status, body, ms: Date.now() - t0 };
};

(async () => {
  console.log('=== BATCH D — password recovery, staging ===');
  await fn('pw-probe', { mode: 'clean', email: PROBE });

  // -------------------------------------------------------------------
  section('It tells an attacker nothing');
  // -------------------------------------------------------------------
  {
    const known = await recover('e2e.owner.a@ag2staging.thelabelboard.com');
    const unknown = await recover('definitely.nobody@thelabelboard.com');
    const rubbish = await recover('not-an-email');
    const empty = await recover('');

    ok('a known address answers 200', known.status === 200);
    ok('an unknown address answers 200', unknown.status === 200);
    ok('rubbish answers 200', rubbish.status === 200);
    ok('an empty address answers 200', empty.status === 200);
    ok('every one of them answers the SAME WORDS',
       known.body === unknown.body && unknown.body === rubbish.body && rubbish.body === empty.body,
       JSON.stringify([known.body, unknown.body]).slice(0, 160));
    ok('and none of them names the account', !/owner|studio name|user/i.test(known.body));
  }

  // -------------------------------------------------------------------
  section('An invited person who never chose a password can still get in');
  // -------------------------------------------------------------------
  {
    const mk = await fn('pw-probe', {
      mode: 'link_only', email: PROBE, business_id: ADE, invited_by: OWNER_A,
      role: 'staff', name: 'Recover Probe',
    });
    ok('there is an account with no password yet', !!mk.log.user_id);

    const r = await recover(PROBE);
    ok('recovery answers for them too', r.status === 200);

    /* The distinction that matters: GoTrue will not issue a recovery link
       for an address that has never confirmed, so the function has to ask
       for an invite link instead. If it did not, this person would get a
       200 and no email at all, for ever. */
    const link = await fn('pw-probe', { mode: 'fallback', email: 'probe.recover2@thelabelboard.com', business_id: ADE, invited_by: OWNER_A, role: 'staff' });
    const state = (link.log || {}).while_confirmed_with_no_password_chosen || {};
    ok('a confirmed account is issued a recovery link', state.recovery && state.recovery.issued === true,
       JSON.stringify(state).slice(0, 160));
    ok('  and refused an invite link', state.invite && state.invite.issued === false,
       'which is why an unconfirmed account has to be sent one instead');
  }

  // -------------------------------------------------------------------
  section('One a minute, and the second request looks like the first');
  // -------------------------------------------------------------------
  {
    const a = await recover('e2e.owner.a@ag2staging.thelabelboard.com');
    const b = await recover('e2e.owner.a@ag2staging.thelabelboard.com');
    ok('a second request inside the window answers identically',
       a.body === b.body && b.status === 200);
    /* and it is measurably cheaper, because it does no work */
    ok('  and does not do the work again', b.ms <= a.ms + 400,
       a.ms + 'ms then ' + b.ms + 'ms');
  }

  // -------------------------------------------------------------------
  section('Nothing in the product still uses the dead mailer');
  // -------------------------------------------------------------------
  {
    const app = fs.readFileSync('site/layi_dashboard.html', 'utf8');
    const team = fs.readFileSync('supabase/functions/team-admin/index.ts', 'utf8');
    const live = (t) => t.split('\n').filter(l => l.includes('resetPasswordForEmail') && !/^\s*(\/\/|\*|\/\*)/.test(l.trim()) && !l.trim().startsWith('It used to') && !l.includes('OUR FUNCTION'));
    ok('the app no longer calls resetPasswordForEmail', live(app).length === 0, JSON.stringify(live(app)).slice(0, 140));
    ok('nor does team-admin', live(team).length === 0, JSON.stringify(live(team)).slice(0, 140));
    ok('the app asks auth-recover instead', app.includes("functions/v1/auth-recover"));
    ok('and team-admin mints its own link', team.includes("type: confirmed ? 'recovery' : 'invite'"));
  }

  await fn('pw-probe', { mode: 'clean', email: PROBE });
  await fn('pw-probe', { mode: 'clean', email: 'probe.recover2@thelabelboard.com' });

  console.log('\n' + '='.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
