// team-admin — owner-gated team account management (Supabase Edge Function, Deno).
// The service-role key lives ONLY here on the server; the browser never sees it.
// Deploy:  supabase functions deploy team-admin
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// =====================================================================
// WHY THIS FILE IS SHAPED THE WAY IT IS
//
// The service role is subject to NO row level security. Everywhere else in
// this system a mistake is caught by Postgres underneath; here it is not.
// So this file does not rely on anybody remembering to check.
//
// FOUND BY AUDIT, 23 September 2026, live since 3 May. `update` scoped its
// profile write correctly:
//
//     .from('profiles').update({...}).eq('id', id).eq('business_id', biz)
//     if (error) return json({ error: error.message }, 400)
//     if (password) await admin.auth.admin.updateUserById(id, { password })
//
// PostgREST returns NO ERROR when a write matches zero rows. So for an id
// belonging to another studio the update quietly did nothing, `error` was
// null, the guard never fired, and the next line reset that account's
// password with an UNSCOPED id. Any studio owner could take over any
// account on the platform, another studio's owner or a Label Board admin
// included. `delete` never looked at the result at all.
//
// A SCOPED WRITE TELLS YOU NOTHING. A READ DOES.
//
// The fix is structural rather than a rule to remember. `payload` is typed
// Record<string, unknown>, so `payload.id` is `unknown`. The privileged
// helpers take `VerifiedTarget`, a branded string that ONLY verifyTarget()
// can produce. Passing a raw id to them does not type check, so the
// invariant is enforced on deploy rather than by review.
//
// PASSWORDS DO NOT PASS THROUGH HERE, from 23 September 2026. A studio
// owner invites; the person sets their own password from the email. An
// owner who could set a colleague's password could read their mail, sign
// in as them, and act as them in the audit trail. `admin-api` already held
// this line for studios, partners and operators; this brings team accounts
// in with them.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/* Where an invited teammate lands to choose their password. Same default as
   admin-api's STUDIO_APP_URL so the two cannot drift apart silently. */
const withSlash = (u: string) => (u.endsWith('/') ? u : u + '/')
const APP_URL = withSlash(Deno.env.get('STUDIO_APP_URL') || 'https://app.thelabelboard.com/')

/* A target id PROVED to be a profile in the caller's business. Only
   verifyTarget() returns one, and `unknown` is not assignable to it, so a
   raw payload id cannot reach the privileged helpers below. */
type VerifiedTarget = string & { readonly __inCallersStudio: unique symbol }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // ---- 1. Who is calling? Verified against their own token, never claimed.
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user }, error: uerr } = await caller.auth.getUser()
    if (uerr || !user) return json({ error: 'Not signed in' }, 401)

    const admin = createClient(url, service)

    // ---- 2. Which business, and what may they do? From the database, not the body.
    const { data: me } = await admin
      .from('profiles').select('role_id,business_id').eq('id', user.id).single()
    if (!me) return json({ error: 'No profile for this user' }, 403)
    const biz = me.business_id as string
    const isOwner = me.role_id === 'owner'

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = str(body.action)
    const payload = (body.payload ?? {}) as Record<string, unknown>

    /* ---- 3. THE ONLY ROUTE TO A PRIVILEGED CALL ----------------------
       Reads the row back and confirms it is in the caller's business. A
       scoped write cannot do this job: it reports success when it matched
       nothing, which is exactly how the original bug worked.

       Platform admins are refused explicitly as well as implicitly. They
       hold no profile in any studio, so the read already misses them; the
       second check states the intent so nobody later "fixes" it by giving
       support staff a profile somewhere. */
    async function verifyTarget(
      id: unknown,
    ): Promise<{ ok: true; target: VerifiedTarget } | { ok: false; status: number; error: string }> {
      const wanted = str(id)
      if (!wanted) return { ok: false, status: 400, error: 'No account id' }

      const { data: isStaff } = await admin
        .from('platform_admins').select('id').eq('id', wanted).maybeSingle()
      if (isStaff) return { ok: false, status: 403, error: 'That account is not in your studio.' }

      const { data, error } = await admin
        .from('profiles').select('id').eq('id', wanted).eq('business_id', biz).maybeSingle()
      if (error) return { ok: false, status: 500, error: error.message }
      if (!data) return { ok: false, status: 403, error: 'That account is not in your studio.' }

      return { ok: true, target: wanted as VerifiedTarget }
    }

    /* These two are the whole reason this file needs care. They take a
       VerifiedTarget, so they cannot be called with an id straight off the
       wire — that is a type error, caught on deploy. */
    const removeAccount = (t: VerifiedTarget) => admin.auth.admin.deleteUser(t)
    const emailPasswordReset = async (t: VerifiedTarget) => {
      const { data: au } = await admin.auth.admin.getUserById(t)
      const email = au?.user?.email
      if (!email) return { error: { message: 'That account has no email address.' } }
      /* The link goes to THEM, by email, from Supabase. The owner never sees
         it and never learns the password. */
      return await admin.auth.resetPasswordForEmail(email, { redirectTo: APP_URL })
    }

    // ---- list: this business's team, and nobody else's.
    if (action === 'list') {
      const { data: profs } = await admin
        .from('profiles').select('id,name,role_id,staff_id').eq('business_id', biz)
      const rows = []
      for (const p of profs ?? []) {
        const { data: au } = await admin.auth.admin.getUserById(p.id)
        rows.push({
          ...p,
          email: au?.user?.email ?? '',
          /* so the team screen can say "invited, not signed in yet" */
          accepted: !!au?.user?.last_sign_in_at,
        })
      }
      return json({ rows })
    }

    // ---- Everything below changes accounts — owner only.
    if (!isOwner) return json({ error: 'Only the owner can add or change team accounts' }, 403)

    /* ---- invite: replaces `create`. No password crosses this boundary.
       Supabase emails them; they choose their own and land in the app.

       =============== OFF, DELIBERATELY, SINCE 23 SEPTEMBER 2026 =========
       Proved unsafe before it was ever deployed. inviteUserByEmail inserts
       a row into auth.users, which fires app.provision_studio(). That
       trigger finds no partner and no business waiting on the address, so
       it takes its third path and INVENTS A STUDIO NAMED AFTER THE
       INVITEE, makes them its owner, and writes their profile and an owner
       membership. team-admin's own profile insert then dies on the primary
       key, and the rescue path deletes the auth user while the invented
       business stays behind.

       Measured, not guessed: 9 businesses before an invite, 10 after.

       Underneath that sits a second problem that a collision fix would not
       touch. team-admin writes `profiles` and never writes `memberships`,
       and every RLS policy in this system reads memberships. So a teammate
       who did get through would hold a profile and be able to read
       nothing: app.in_scope returns false for them. Seat limits are in the
       same position, since their trigger is on memberships.

       That is a lifecycle to design, not a line to patch, and it is Phase
       1B. Until then this action does NOTHING AT ALL. It is deliberately
       not "best effort": a half-working invite leaves orphan businesses
       behind, and an orphan business is harder to explain than an error.

       Phase 1B turns this back on by flipping the constant, after
       provision_studio learns to attach somebody to a business that
       already exists. Nothing else here needs to change. =============== */
    const TEAM_INVITES_ENABLED = false

    if (action === 'invite') {
      if (!TEAM_INVITES_ENABLED) {
        /* Before any validation, so no code path below can run and no
           argument about input shape can change the outcome. */
        return json({
          error: 'Team invitations are temporarily unavailable.',
          code: 'invites_disabled',
        }, 503)
      }

      const email = str(payload.email).toLowerCase()
      const name = str(payload.name)
      if (!email || !email.includes('@')) return json({ error: 'A valid email address is needed' }, 400)
      if (!name) return json({ error: 'A name is needed' }, 400)

      const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: APP_URL,
        data: { name },
      })
      if (error) {
        const already = /already|registered|exists/i.test(error.message || '')
        return json({
          error: already
            ? 'That email already has an account. Ask them to sign in, or use Send password reset.'
            : 'Could not send the invitation: ' + error.message,
        }, 400)
      }

      const newId = invited?.user?.id
      if (!newId) return json({ error: 'The invitation was sent but no account came back.' }, 500)

      const { error: perr } = await admin.from('profiles').insert({
        id: newId,
        name,
        role_id: str(payload.role_id) || 'cre',
        business_id: biz,
        staff_id: str(payload.staff_id) || null,
      })
      /* The account exists but is attached to nothing, which would leave them
         able to sign in with no studio. Undo it rather than leave that. */
      if (perr) {
        await admin.auth.admin.deleteUser(newId)
        return json({ error: perr.message }, 400)
      }
      return json({ id: newId, invited: email })
    }

    // ---- update: name, role and linked staff. Never a password.
    if (action === 'update') {
      const v = await verifyTarget(payload.id)
      if (!v.ok) return json({ error: v.error }, v.status)

      if ('password' in payload) {
        return json({
          error: 'Passwords are not set from here. Use Send password reset and they choose their own.',
        }, 400)
      }

      const { error } = await admin.from('profiles')
        .update({
          name: str(payload.name),
          role_id: str(payload.role_id) || 'cre',
          staff_id: str(payload.staff_id) || null,
        })
        .eq('id', v.target).eq('business_id', biz)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    /* ---- sendReset: the owner asks, the teammate receives. The owner never
       sees the link and never learns the password. */
    if (action === 'sendReset') {
      const v = await verifyTarget(payload.id)
      if (!v.ok) return json({ error: v.error }, v.status)
      const { error } = await emailPasswordReset(v.target)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // ---- delete: the profile and the account, in that order, both proved first.
    if (action === 'delete') {
      if (str(payload.id) === user.id) {
        return json({ error: 'You cannot delete your own account' }, 400)
      }
      const v = await verifyTarget(payload.id)
      if (!v.ok) return json({ error: v.error }, v.status)

      const { error: derr } = await admin.from('profiles')
        .delete().eq('id', v.target).eq('business_id', biz)
      if (derr) return json({ error: derr.message }, 400)

      const { error } = await removeAccount(v.target)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    /* Never echo the thrown object: it can carry request detail, and in a
       service-role context that detail is privileged. */
    console.error('team-admin:', e)
    return json({ error: 'Something went wrong handling that request.' }, 500)
  }
})
