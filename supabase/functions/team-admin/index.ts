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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = str(body.action)
    const payload = (body.payload ?? {}) as Record<string, unknown>

    /* ---- 2. WHICH BUSINESS, AND WHAT MAY THEY DO THERE ----------------
       This used to read profiles.business_id and profiles.role_id, and
       that was wrong for anybody who belongs to more than one studio.
       `profiles` holds ONE business per person and accept_invitation
       overwrites both fields, so somebody who owns Adé Bespoke and later
       joins Ìfé Leather as a viewer reads as "viewer of Ìfé Leather" —
       the one they joined last. team-admin would list the wrong team and
       refuse the right one. Measured on staging, 26 September.

       It was never a cross-tenant hole: every query was scoped to that
       same business, so the caller only ever reached one they genuinely
       belonged to. It failed toward LESS access. But an owner of two
       studios could be locked out of managing either, which is broken
       whichever way you say it.

       So the security fact is now `memberships`, which is what every RLS
       policy in this system already reads. A business_id in the request
       is a SELECTOR: it says which studio the caller means, and nothing
       more. The membership row says whether they may. */

    /* What each action needs. Taken from the code this replaces, not
       invented: `list` sat ABOVE the owner gate and everything else sat
       below it. Manager is deliberately NOT granted anything new here
       just because memberships.role has the word in it. */
    const OWNER_ONLY = ['invite', 'update', 'sendReset', 'delete']
    const needsOwner = OWNER_ONLY.includes(action)

    const eligible = async () => {
      const { data } = await admin
        .from('memberships').select('business_id,role')
        .eq('user_id', user.id).eq('status', 'active')
      return (data ?? []).filter(m => !needsOwner || m.role === 'owner')
    }

    let biz: string
    let myRole: string

    const wanted = str(payload.business_id) || str(body.business_id)
    if (wanted) {
      /* A selector, verified. Never taken on trust. */
      const { data: m } = await admin
        .from('memberships').select('business_id,role')
        .eq('user_id', user.id).eq('business_id', wanted).eq('status', 'active')
        .maybeSingle()
      if (!m) return json({ error: 'You are not a member of that studio.' }, 403)
      if (needsOwner && m.role !== 'owner') {
        return json({ error: 'Only the owner can add or change team accounts' }, 403)
      }
      biz = m.business_id as string
      myRole = m.role as string
    } else {
      /* No selector. Fall back to the caller's memberships — never to
         profiles — and refuse rather than guess when there is a choice
         to be made. Guessing is how somebody ends up editing the wrong
         studio's team and not noticing. */
      const rows = await eligible()
      if (rows.length === 0) {
        return json({ error: needsOwner
          ? 'You do not own a studio on this account.'
          : 'This account does not belong to a studio.' }, 403)
      }
      if (rows.length > 1) {
        return json({
          error: 'You belong to more than one studio. Say which one.',
          code: 'choose_business',
          choices: rows.map(r => r.business_id),
        }, 409)
      }
      biz = rows[0].business_id as string
      myRole = rows[0].role as string
    }
    const isOwner = myRole === 'owner'

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

      /* MEMBERSHIPS, not profiles. Same reason as the caller's own
         business above: profiles names one studio and the target may
         belong to several, so asking profiles would miss a genuine
         teammate and could match somebody who has since moved on. The
         membership is the fact every RLS policy already trusts. */
      const { data, error } = await admin
        .from('memberships').select('user_id')
        .eq('user_id', wanted).eq('business_id', biz)
        .in('status', ['active', 'invited']).maybeSingle()
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

    /* ---- list: this business's team, and nobody else's.
       Driven by MEMBERSHIPS. Listing by profiles.business_id would show
       only the people whose single profile happens to point here, and
       would silently omit anybody who has since joined a second studio —
       they would vanish from a team they are still a member of. */
    if (action === 'list') {
      const { data: mems } = await admin
        .from('memberships').select('user_id,role,status,branch_id')
        .eq('business_id', biz).in('status', ['active', 'invited'])
      const rows = []
      for (const m of mems ?? []) {
        const { data: au } = await admin.auth.admin.getUserById(m.user_id)
        /* the display name and the app-level role still live on profiles;
           they are labels, not authority */
        const { data: p } = await admin
          .from('profiles').select('name,role_id,staff_id').eq('id', m.user_id).maybeSingle()
        rows.push({
          id: m.user_id,
          name: p?.name ?? '',
          role_id: p?.role_id ?? m.role,
          staff_id: p?.staff_id ?? null,
          membership_role: m.role,
          status: m.status,
          branch_id: m.branch_id,
          email: au?.user?.email ?? '',
          /* so the team screen can say "invited, not signed in yet" */
          accepted: !!au?.user?.last_sign_in_at,
        })
      }
      return json({ rows, business_id: biz, your_role: myRole })
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

      /* NO .eq('business_id') HERE, AND THAT IS DELIBERATE.
         verifyTarget has already proved this person is a member of this
         studio; the scope check is done. Leaving it on would reintroduce
         B1's exact shape in a new place: a multi-business teammate whose
         profile points at their OTHER studio would match zero rows, and a
         zero-row write reports success. The owner would watch a rename
         succeed and find it unchanged, which is the bug this whole phase
         started with.

         ONLY WHAT WAS ASKED FOR. This used to write
         `role_id: str(payload.role_id) || 'cre'` and
         `staff_id: str(payload.staff_id) || null`, so a caller who sent
         just a name silently reset the person's role to the default and
         unlinked their staff record. The app's own form always sends all
         three, which is why nobody had seen it; anything else calling the
         same action would quietly demote somebody. */
      const patch: Record<string, unknown> = {}
      if ('name' in payload) patch.name = str(payload.name)
      if ('role_id' in payload) patch.role_id = str(payload.role_id) || 'cre'
      if ('staff_id' in payload) patch.staff_id = str(payload.staff_id) || null

      if (Object.keys(patch).length) {
        const { error } = await admin.from('profiles').update(patch).eq('id', v.target)
        if (error) return json({ error: error.message }, 400)
      }

      /* And the role THIS studio grants them lives on the membership, which
         is per business and is what RLS reads. Only touched when asked. */
      const wantRole = str(payload.membership_role)
      if (wantRole) {
        if (!['manager', 'staff', 'viewer'].includes(wantRole)) {
          return json({ error: 'role must be manager, staff or viewer' }, 400)
        }
        const { error: merr } = await admin.from('memberships')
          .update({ role: wantRole })
          .eq('user_id', v.target).eq('business_id', biz)
        if (merr) return json({ error: merr.message }, 400)
      }
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

    /* ---- delete: remove them from THIS studio, and only delete the account
       if that was the last studio they belonged to.
       Deleting the auth user outright would have been right when everybody
       had exactly one studio. It is wrong now: removing somebody from Adé
       Bespoke must not destroy the account they use to run their own label. */
    if (action === 'delete') {
      if (str(payload.id) === user.id) {
        return json({ error: 'You cannot delete your own account' }, 400)
      }
      const v = await verifyTarget(payload.id)
      if (!v.ok) return json({ error: v.error }, v.status)

      const { error: merr } = await admin.from('memberships')
        .delete().eq('user_id', v.target).eq('business_id', biz)
      if (merr) return json({ error: merr.message }, 400)

      /* anything left anywhere else? */
      const { data: rest } = await admin.from('memberships')
        .select('business_id,role').eq('user_id', v.target)
      if ((rest ?? []).length > 0) {
        /* They still work somewhere. Point their profile at one of the
           studios they are actually in, so it stops naming this one.

           AND DROP THE ROLE WITH IT. profiles.role_id is global — it is
           the app's own permission label, not per business — so leaving
           it alone means somebody removed from a studio where they were a
           manager keeps a manager's menus in the studio where they are a
           viewer. Measured on staging: removed from A as 'mgr', left in B
           as a viewer, profile still said 'mgr'.

           RLS was never fooled by it: in_scope and is_business_admin read
           memberships and nothing else. This is the app's UI, which is
           still worth getting right rather than leaving a label above
           what the remaining membership grants.

           Mapped conservatively and downward. An owner stays an owner
           because that is what their remaining membership says; everybody
           else lands on the app's own default. Being asked to restore
           somebody's role is a better failure than not noticing they kept
           one they should have lost. */
        const stays = rest![0]
        const APP_ROLE: Record<string, string> = { owner: 'owner', manager: 'mgr' }
        await admin.from('profiles')
          .update({
            business_id: stays.business_id,
            role_id: APP_ROLE[String(stays.role)] ?? 'cre',
          })
          .eq('id', v.target)
        return json({
          ok: true, removed_from_studio: true, account_deleted: false,
          now_in: stays.business_id,
        })
      }

      const { error: perr } = await admin.from('profiles').delete().eq('id', v.target)
      if (perr) return json({ error: perr.message }, 400)
      const { error } = await removeAccount(v.target)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, removed_from_studio: true, account_deleted: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    /* Never echo the thrown object: it can carry request detail, and in a
       service-role context that detail is privileged. */
    console.error('team-admin:', e)
    return json({ error: 'Something went wrong handling that request.' }, 500)
  }
})
