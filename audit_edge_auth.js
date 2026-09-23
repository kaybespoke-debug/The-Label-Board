#!/usr/bin/env node
/* =====================================================================
   audit_edge_auth.js — the Edge Functions are the only code that holds
   the service role key, and the service role is subject to NO row level
   security whatsoever.

   Everything else in this system is protected twice: the app asks
   politely, and Postgres refuses regardless. These two files are the
   one place where Postgres will not save you, so they are the one place
   that needs reading rather than trusting.

   WHY THIS FILE EXISTS. On 23 September 2026 an audit found that
   `team-admin` would reset the password of ANY account on the platform
   on the say-so of any studio owner. Another studio's owner. A Label
   Board admin. The code looked right:

       .from('profiles').update({...}).eq('id', id).eq('business_id', biz)
       if (error) return json({ error: error.message }, 400)
       if (password) await admin.auth.admin.updateUserById(id, {...})

   PostgREST returns no error when a write matches zero rows. So for
   somebody else's id the update quietly did nothing, `error` was null,
   the guard did not fire, and the line below it reached auth with an
   unscoped id. `delete` never looked at the result at all.

   It was live for four months. Every database suite was green the whole
   time, because none of them can see a Deno file. That is the gap this
   closes.

   WHAT IT CANNOT DO. This is a static read. It proves the guard is
   written; it cannot prove the guard works — for that the function has
   to run, against a staging project, which is T01 to T05 in the audit
   and needs an environment that does not exist yet. A green run here
   means "nobody deleted the guard", not "the function is safe".
   Both statements are worth knowing.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const root = __dirname;

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
};
const section = t => console.log('\n' + t);

const src = f => fs.readFileSync(path.join(root, 'supabase/functions', f, 'index.ts'), 'utf8');

/* The body of one `if (action === 'x') { ... }` block, brace matched, so a
   guard sitting in a DIFFERENT action does not count as this one's. */
function actionBody(code, action) {
  const at = code.indexOf(`if (action === '${action}')`);
  if (at < 0) return '';
  const open = code.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return code.slice(open, i + 1); }
  }
  return code.slice(open);
}

// =====================================================================
section('team-admin: the privileged calls are unreachable without a proved target');
// =====================================================================
{
  const code = src('team-admin');

  /* ---- the guard itself ---- */
  const at = code.indexOf('async function verifyTarget(');
  ok('there is one function whose whole job is proving ownership', at >= 0,
     'without it every action re-derives the check and one of them gets it wrong');

  if (at >= 0) {
    const guard = code.slice(at, code.indexOf('\n    }', at));
    ok('it proves ownership with a SELECT, not a scoped write',
       /\.from\('profiles'\)\s*\.select\(/.test(guard),
       'a scoped UPDATE that matches nothing returns no error. That was the bug');
    ok('scoped to the caller’s business', /\.eq\('business_id',\s*biz\)/.test(guard));
    ok('scoped to the id it was handed', /\.eq\('id',\s*wanted\)/.test(guard));
    ok('a missing row is a refusal, not a pass',
       /if\s*\(!data\)\s*return\s*\{\s*ok:\s*false/.test(guard),
       'maybeSingle returns null rather than throwing, so this has to be explicit');
    ok('a platform admin is refused explicitly as well as implicitly',
       /from\('platform_admins'\)/.test(guard),
       'they hold no studio profile so the read already misses them, but say it out loud');
    ok('it refuses with 403', /status:\s*403/.test(guard));
  }

  /* ---- THE STRUCTURAL PART ------------------------------------------
     A rule people must remember is a rule that gets forgotten. The point
     of the branded type is that passing a raw id to a privileged call is
     a TYPE ERROR, caught on deploy, not something review has to spot. */
  ok('there is a branded type for a target that has been proved',
     /type VerifiedTarget = string & \{[^}]*unique symbol[^}]*\}/.test(code),
     'without the brand, any string reaches the privileged helpers');

  ok('the payload is typed unknown, so a raw id cannot satisfy the brand',
     /payload\s*=\s*\(body\.payload\s*\?\?\s*\{\}\)\s*as Record<string,\s*unknown>/.test(code),
     'if payload were `any`, `any` is assignable to anything and the brand proves nothing');

  ok('only verifyTarget can mint one',
     (code.match(/as VerifiedTarget/g) || []).length === 1,
     'found ' + (code.match(/as VerifiedTarget/g) || []).length + ' casts; a second one is a back door');

  ok('the privileged helpers take the branded type',
     /removeAccount = \(t: VerifiedTarget\)/.test(code)
     && /emailPasswordReset = async \(t: VerifiedTarget\)/.test(code));

  /* ---- and the ordering, per action, derived from the file ---- */
  const allActions = [...code.matchAll(/if \(action === '([a-zA-Z]+)'\)/g)].map(m => m[1]);
  ok('the actions were found (' + allActions.join(', ') + ')', allActions.length >= 4);

  allActions.forEach(a => {
    const body = actionBody(code, a);
    /* does this action reach a privileged call with a target from the body? */
    const priv = /(removeAccount|emailPasswordReset)\(/.exec(body);
    if (!priv) return;
    ok(`'${a}' proves ownership before the privileged call`,
       /verifyTarget\(/.test(body) && body.indexOf('verifyTarget(') < priv.index,
       'a guard after the damage is decoration');
    ok(`'${a}' refuses on the guard’s own verdict`,
       /if\s*\(!v\.ok\)\s*return json\(\{ error: v\.error \}, v\.status\)/.test(body),
       'calling the check and not reading its answer is the same as not calling it');
  });

  /* ---- passwords ---- */
  ok('no action takes a password from the browser',
     !/payload\.password/.test(code) && !/password:\s*str\(/.test(code),
     'an owner who can set a colleague’s password can sign in as them');
  ok('createUser with a caller-supplied password is gone',
     !/auth\.admin\.createUser\(/.test(code),
     'invitations replaced it: they choose their own and it never crosses this boundary');
  ok('an invitation is what creates a teammate now',
     /auth\.admin\.inviteUserByEmail\(/.test(code));
  ok('a password sent anyway is refused rather than ignored',
     /'password' in payload/.test(code),
     'silently dropping it would leave an owner believing they had set one');

  /* ---- what the caller is allowed to be ---- */
  ok('the studio comes from the database, never the body',
     /from\('profiles'\)\.select\('role_id,business_id'\)\.eq\('id', user\.id\)/.test(code)
     && !/payload\.business_id/.test(code));
  ok('everything that changes an account is owner only',
     /if \(!isOwner\) return json\(/.test(code));
  ok('the error handler does not echo the thrown object',
     !/String\(\(e as Error\)\.message/.test(code),
     'in a service-role context the detail in a thrown error is privileged');
}

// =====================================================================
section('team-admin: the caller is still established the same way');
// =====================================================================
/* The fix must not have loosened anything above it. These are the checks
   that were already right on 23 September and have to stay right. */
{
  const code = src('team-admin');
  ok('the caller is resolved from their own token, not from the body',
     /auth\.getUser\(\)/.test(code) && !/payload\.(user_id|caller|business_id)/.test(code));
  ok('an unsigned caller is refused', /return json\(\{ error: 'Not signed in' \}, 401\)/.test(code));
  ok('the business comes from the caller’s profile, never the body',
     /from\('profiles'\)\.select\('role_id,business_id'\)\.eq\('id', user\.id\)/.test(code));
  ok('everything that changes an account is owner only',
     /if \(!isOwner\) return json\(/.test(code));
}

// =====================================================================
section('admin-api: the platform gateway still gates the same way');
// =====================================================================
/* Not changed by this work. Checked so that a later edit to one function
   cannot quietly diverge from the other. */
{
  const code = src('admin-api');
  ok('the caller is verified against their token', /auth\.getUser\(\)/.test(code));
  ok('tenants are stopped at the door', /from\('platform_admins'\)/.test(code));
  ok('a deactivated staff account is refused', /staff\.active === false/.test(code));
  ok('every action is checked against the role’s own list',
     /ALLOWED\[role\]\s*\|\|\s*\[\]\)\.includes\(action\)/.test(code));
  ok('every call is written down, reads included', /platform_audit/.test(code));
}

// =====================================================================
console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nThe service role answers to nobody. These two files are the');
  console.log('only place a mistake is not caught by Postgres underneath.');
  process.exit(1);
}
console.log('\nAn id from a browser is proved to belong to the caller before');
console.log('anything reaches auth. Static proof only: the runtime tests');
console.log('(T01-T05 in AUDIT_2026-09-23.md) still need a staging project.');
