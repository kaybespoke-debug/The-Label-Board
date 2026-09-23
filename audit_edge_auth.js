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
section('team-admin: an id from the browser is proved before auth is touched');
// =====================================================================
{
  const code = src('team-admin');

  /* The helper itself. It must READ the row back, not scope a write. */
  const helperAt = code.indexOf('async function mustBeOurs(');
  ok('there is a function whose whole job is proving ownership', helperAt >= 0,
     'without it every action is re-deriving the check and one of them will get it wrong');

  if (helperAt >= 0) {
    const helper = code.slice(helperAt, code.indexOf('\n    }', helperAt));
    ok('it proves ownership with a SELECT',
       /\.from\('profiles'\)\s*\.select\(/.test(helper),
       'a scoped UPDATE that matches nothing returns no error, which is the whole bug');
    ok('it scopes that read to the caller’s business',
       /\.eq\('business_id',\s*biz\)/.test(helper));
    ok('it scopes that read to the id it was given',
       /\.eq\('id',\s*id\)/.test(helper));
    ok('a row that is not found is a refusal, not a pass',
       /if\s*\(!\s*data\s*\)\s*return/.test(helper),
       'maybeSingle returns null rather than throwing, so this has to be explicit');
  }

  /* Every action that reaches auth.admin with an id from the body. */
  const DANGEROUS = [
    { action: 'update', reaches: 'updateUserById', harm: 'resets that account’s password' },
    { action: 'delete', reaches: 'deleteUser',     harm: 'deletes that account outright' },
  ];

  DANGEROUS.forEach(d => {
    const body = actionBody(code, d.action);
    ok(`'${d.action}' exists`, body.length > 0);
    if (!body) return;

    ok(`'${d.action}' calls mustBeOurs`, /mustBeOurs\(/.test(body),
       'it ' + d.harm + ' using an id the browser chose');

    ok(`'${d.action}' refuses on the result rather than ignoring it`,
       /if\s*\(\s*bad\s*\)\s*return\s+json\(/.test(body),
       'calling the check and not reading its answer is the same as not calling it');

    /* Order matters more than presence: a check AFTER the damage is done
       is decoration. Compare the offsets inside this action's own body. */
    const guardAt = body.indexOf('mustBeOurs(');
    const authAt = body.indexOf(d.reaches);
    ok(`'${d.action}' proves ownership BEFORE it reaches auth.admin`,
       guardAt >= 0 && authAt >= 0 && guardAt < authAt,
       'guard at ' + guardAt + ', ' + d.reaches + ' at ' + authAt);

    ok(`'${d.action}' returns 403 for somebody else’s account`,
       /return\s+json\(\{\s*error:\s*bad\s*\}\s*,\s*403\)/.test(body),
       'a 400 reads as "you sent something malformed"; this is "that is not yours"');
  });

  /* And the same rule for any action added LATER. The two above are
     named because they are the two that broke; this catches the third
     one somebody writes next year. Any action block that reaches
     auth.admin with the body's id has to prove ownership first.

     Deliberately derived from the file rather than from a list, so a new
     action is covered the day it is written rather than the day someone
     remembers to add it here. */
  const allActions = [...code.matchAll(/if \(action === '([a-zA-Z]+)'\)/g)].map(m => m[1]);
  ok('the actions were found in the file (' + allActions.join(', ') + ')', allActions.length >= 3);

  allActions.forEach(a => {
    const body = actionBody(code, a);
    /* auth.admin called with the body's id — createUser takes an email and
       makes its own id, so it is not in scope and correctly not flagged. */
    const touchesForeignId = /auth\.admin\.[a-zA-Z]+\(\s*id\b/.test(body);
    if (!touchesForeignId) return;
    ok(`'${a}' reaches auth.admin with a body id, and proves ownership first`,
       /mustBeOurs\(/.test(body) && body.indexOf('mustBeOurs(') < body.search(/auth\.admin\.[a-zA-Z]+\(\s*id\b/),
       'a new action inherited the old mistake');
  });
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
