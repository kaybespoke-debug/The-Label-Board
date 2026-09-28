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

/* ===== SENDING THE INVITATION OURSELVES ==============================
   The same Resend path admin-api has used since September, and the same
   two environment variables, so there is one sending identity across the
   platform rather than two that can drift.

   WHY WE SEND IT AND NOT SUPABASE. inviteUserByEmail hands the message to
   Supabase's own mailer, which is rate limited to a handful an hour and
   whose wording is not ours. generateLink makes the same account and
   returns the link instead of posting it, so we choose the words, we
   choose the sender, and a studio invitation reads like it came from the
   studio rather than from a database. ACCOUNTS.md also records Supabase's
   SMTP as broken since 13 September; this path does not touch it. */
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || ''
const MAIL_FROM = Deno.env.get('INVITE_FROM') || 'The Label Board <hello@thelabelboard.com>'

async function sendViaResend(to: string, subject: string, html: string, text: string) {
  if (!RESEND_KEY) return { ok: false, error: 'No mail provider is configured.' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html, text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: 'The mail provider refused it (' + res.status + '): ' + body.slice(0, 200) }
  }
  /* The provider's own id for the message. Not a secret and not a link: it is
     what turns "they say they never got it" into something answerable, and it
     is the only part of a send that can be shown to the person who asked for
     it. The LINK is never returned to the inviter under any circumstances —
     whoever holds it can finish signing in as the invitee. */
  const ok = await res.json().catch(() => null) as { id?: string } | null
  return { ok: true, id: ok?.id || '' }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* ---- the invitation itself -------------------------------------------
   TWO KINDS, and the difference is the whole point.

   'new'      they have no account. The link is GoTrue's, it confirms the
              address and lets them choose a password, and it carries our
              invitation id in the fragment so the app knows what they are
              accepting once they land.

   'existing' they already use The Label Board. They must NOT be walked
              through account creation — they have an account, and telling
              somebody to "set a password" when they already have one is
              how a person ends up resetting a login that was working. The
              link goes straight to the app; they sign in as they always
              do and the invitation is waiting.

   Nothing in here is a password and nothing in here is a secret. The
   fragment carries an invitation id, which grants nothing on its own:
   accept_invitation still requires a session whose confirmed email
   matches the address the invitation names. */
function invitationEmail(kind: 'new' | 'existing', c: {
  studio: string; role: string; branch: string; inviter: string; link: string; expires: string;
}) {
  const S = esc(c.studio)
  const subject = kind === 'new'
    ? `${c.studio} has invited you to join them on The Label Board`
    : `${c.studio} has added you on The Label Board`
  const opening = kind === 'new'
    ? `${esc(c.inviter)} has invited you to join <b>${S}</b> on The Label Board, the system they use to run the studio.`
    : `${esc(c.inviter)} has added you to <b>${S}</b> on The Label Board. You already have an account, so there is nothing to set up.`
  const cta = kind === 'new' ? `Join ${c.studio}` : `Open ${c.studio}`
  const note = kind === 'new'
    ? 'You will choose your own password on the way in. Nobody at the studio can see it.'
    : `Sign in with this email address and ${S} will be there.`

  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px 12px;font-family:ui-sans-serif,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;padding:32px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#17385c;padding-bottom:22px">The Label Board</td></tr>
<tr><td style="font-size:21px;font-weight:700;line-height:1.35;padding-bottom:14px">${esc(cta)}</td></tr>
<tr><td style="font-size:15px;line-height:1.65;color:#3f4a5a;padding-bottom:20px">${opening}</td></tr>
<tr><td style="padding-bottom:22px">
  <table role="presentation" width="100%" style="background:#f5f6f9;border-radius:10px;padding:14px 16px" cellpadding="0" cellspacing="0">
    <tr><td style="font-size:13px;color:#6b7280;padding-bottom:4px">Studio</td><td style="font-size:14px;font-weight:600;text-align:right">${S}</td></tr>
    <tr><td style="font-size:13px;color:#6b7280;padding:4px 0">Your role</td><td style="font-size:14px;font-weight:600;text-align:right">${esc(c.role)}</td></tr>
    <tr><td style="font-size:13px;color:#6b7280;padding-top:4px">Branch</td><td style="font-size:14px;font-weight:600;text-align:right">${esc(c.branch)}</td></tr>
  </table></td></tr>
<tr><td style="padding-bottom:18px"><a href="${esc(c.link)}" style="display:inline-block;background:#17385c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 26px;border-radius:10px">${esc(cta)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6b7280;padding-bottom:6px">${note}</td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6b7280;padding-bottom:22px">This invitation expires on ${esc(c.expires)}.</td></tr>
<tr><td style="border-top:1px solid #e5e7eb;padding-top:18px;font-size:12px;line-height:1.6;color:#9ca3af">
  Not expecting this? Ignore it and nothing happens.<br>
  Need a hand? Reply to this email and a person will read it.</td></tr>
</table></td></tr></table></body></html>`

  const text = [
    'THE LABEL BOARD', '',
    cta, '',
    kind === 'new'
      ? `${c.inviter} has invited you to join ${c.studio} on The Label Board, the system they use to run the studio.`
      : `${c.inviter} has added you to ${c.studio} on The Label Board. You already have an account, so there is nothing to set up.`,
    '',
    `Studio:    ${c.studio}`,
    `Your role: ${c.role}`,
    `Branch:    ${c.branch}`,
    '', cta + ':', c.link, '',
    note,
    `This invitation expires on ${c.expires}.`,
    '',
    'Not expecting this? Ignore it and nothing happens.',
    'Need a hand? Reply to this email and a person will read it.',
  ].join('\n')

  return { subject, html, text }
}

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
    const OWNER_ONLY = ['invite', 'resendInvitation', 'update', 'sendReset', 'delete']
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

    /* ---- invite ------------------------------------------------------
       WHAT PHASE 1A TURNED OFF, AND WHAT REPLACED IT.

       The old body called inviteUserByEmail and then inserted a profile.
       That was proved unsafe before it ever ran: the auth.users INSERT
       fires app.provision_studio(), which found no invitation waiting on
       the address, took its third path, and INVENTED A STUDIO NAMED AFTER
       THE INVITEE. Measured, not guessed: 9 businesses before an invite,
       10 after. Underneath that, it wrote `profiles` and never
       `memberships`, and every RLS policy in this system reads
       memberships — so anybody who did get through held a profile and
       could read nothing.

       THE ORDER BELOW IS THE FIX, and it is the whole reason this reads
       the way it does:

         1. the invitation row is written FIRST, with a one-time nonce
         2. the account is created SECOND, carrying that nonce
         3. provision_studio sees its own invitation and abstains
         4. we send the email ourselves
         5. the membership is written at ACCEPTANCE, by the invitee, and
            not one moment earlier

       Reverse 1 and 2 and the trigger invents a studio again, because at
       the moment it fires there is nothing on the address for it to find.

       NO MEMBERSHIP AND NO PROFILE ARE WRITTEN HERE. The seat is held by
       the pending invitation itself — app.seats_used counts pending
       invitations as well as memberships — so the studio cannot invite
       its way past the plan, and nobody holds access they have not yet
       accepted.

       WE SEND THE EMAIL, NOT SUPABASE. generateLink makes the same
       account and hands back the link instead of posting it, so the
       wording is ours, the sender is ours, and we are not behind
       Supabase's own mailer, which ACCOUNTS.md records as broken since
       13 September and which rate limits to a handful an hour. */
    /* ON IN STAGING, OFF IN PRODUCTION, DECIDED BY WHICH DATABASE THIS IS.

       Not an environment variable. A variable has to be set correctly on
       two projects and nothing stops it being set on the wrong one; this
       cannot be turned on in production by a settings change, because
       production is not that project and never will be. Same reasoning as
       the app choosing its backend by hostname: the safe state is the one
       you get by default, and turning it on is an edit somebody has to
       make on purpose and explain in a commit.

       Phase 1C flips this to a plain `true` once the flow has been run
       end to end against a real mailbox and a real person. */
    const STAGING_REF = 'pakxhimjhrcpqvtsqwqz'
    const TEAM_INVITES_ENABLED = (Deno.env.get('SUPABASE_URL') || '').includes(STAGING_REF)

    if (action === 'invite' || action === 'resendInvitation') {
      if (!TEAM_INVITES_ENABLED) {
        /* Before any validation, so no code path below can run and no
           argument about input shape can change the outcome. */
        return json({
          error: 'Team invitations are temporarily unavailable.',
          code: 'invites_disabled',
        }, 503)
      }
    }

    /* Shared by invite and resend, so the two emails cannot drift. */
    const ROLE_WORD: Record<string, string> = {
      manager: 'Manager', staff: 'Team member', viewer: 'Can view only',
    }
    const studioAndInviter = async () => {
      const { data: b } = await admin.from('businesses').select('name').eq('id', biz).maybeSingle()
      const { data: p } = await admin.from('profiles').select('name').eq('id', user.id).maybeSingle()
      return {
        studio: str(b?.name) || 'your studio',
        inviter: str(p?.name) || 'The owner',
      }
    }
    const branchWord = async (branch: string | null) => {
      if (!branch) return 'All branches'
      const { data: br } = await admin
        .from('branches').select('name').eq('id', branch).eq('business_id', biz).maybeSingle()
      return br ? str(br.name) : ''
    }
    const dayOf = (iso: string) => {
      try {
        return new Date(iso).toLocaleDateString('en-GB',
          { day: 'numeric', month: 'long', year: 'numeric' })
      } catch { return String(iso).slice(0, 10) }
    }
    /* The landing page. The invitation id travels in the QUERY STRING and
       not the fragment, which the design originally called for.

       Reason, and it is mechanical: GoTrue appends its own fragment to
       redirect_to. A redirect_to that already ends in "#invitation=..."
       produces "#invitation=...#access_token=...", the browser hands the
       whole thing to location.hash as one string, and the app's arrival
       parser then finds no access_token at all. The id in the query is
       read before anything else runs and is wiped from the address bar on
       the way in.

       It costs privacy of the id — a query string reaches the web server's
       logs, a fragment does not. That is acceptable for this value and for
       nothing else: an invitation id is a POINTER, not a credential.
       accept_invitation still requires a session whose CONFIRMED email
       matches the address the invitation names, so an id on its own buys
       an attacker nothing at all. */
    const landingFor = (invitationId: string) => APP_URL + '?invitation=' + invitationId

    if (action === 'invite') {
      const email = str(payload.email).toLowerCase()
      const name = str(payload.name)
      const role = str(payload.role) || str(payload.membership_role) || 'staff'
      const branch = str(payload.branch_id) || null
      if (!email || !email.includes('@')) return json({ error: 'A valid email address is needed' }, 400)
      if (!name) return json({ error: 'A name is needed' }, 400)
      if (!['manager', 'staff', 'viewer'].includes(role)) {
        return json({ error: 'role must be manager, staff or viewer' }, 400)
      }

      /* A Label Board operator is not somebody's teammate, and support
         staff holding a studio membership is how a support account ends
         up inside a tenant's data. platform_admins carries the address,
         so this costs one read and does not need the auth user. */
      const { data: staff } = await admin
        .from('platform_admins').select('id').eq('email', email).maybeSingle()
      if (staff) {
        return json({ error: 'That address belongs to a Label Board operator, not a studio account.' }, 403)
      }

      const bw = await branchWord(branch)
      if (!bw) return json({ error: 'That branch is not in this studio.' }, 400)
      const who = await studioAndInviter()

      /* 1. THE INVITATION FIRST. One transaction, and it is the one that
            takes the seat lock, refuses somebody already on the team, and
            refuses an invite that would break the plan. The nonce comes
            back exactly once and is never stored on this side. */
      const { data: made, error: cerr } = await admin.rpc('create_team_invitation', {
        p_business: biz,
        p_email: email,
        p_role: role,
        p_branch: branch,
        p_invited_by: user.id,
      })
      if (cerr) return json({ error: cerr.message }, 400)
      const inv = (Array.isArray(made) ? made[0] : made) as
        { invitation_id: string; nonce: string; expires_at: string } | undefined
      if (!inv?.invitation_id) return json({ error: 'The invitation could not be created.' }, 500)

      /* 2. THE ACCOUNT SECOND, carrying the nonce so provision_studio can
            recognise its own invitation and write nothing. */
      let kind: 'new' | 'existing' = 'new'
      let link = landingFor(inv.invitation_id)
      let createdUser = ''

      const { data: gl, error: gerr } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
          redirectTo: link,
          data: {
            name,
            team_invitation_id: inv.invitation_id,
            team_invitation_nonce: inv.nonce,
          },
        },
      })

      if (gerr) {
        /* An address that already has an account is not an error, it is
           the other half of the feature: they sign in as themselves and
           the invitation is waiting. Anything else is a real failure and
           the invitation goes back. */
        const exists = /already|registered|exists/i.test(gerr.message || '')
        if (!exists) {
          await admin.rpc('discard_invitation', {
            p_invitation_id: inv.invitation_id,
            p_reason: 'account creation failed: ' + (gerr.message || '').slice(0, 120),
          })
          return json({ error: 'Could not create the account: ' + gerr.message }, 400)
        }
        kind = 'existing'
      } else {
        createdUser = str(gl?.user?.id)
        link = str(gl?.properties?.action_link) || link
        /* THE PAIR IS CLEARED IMMEDIATELY. The nonce has already done its
           only job — the trigger fired during the INSERT above and wiped
           nonce_hash — so leaving it in the invitee's own metadata gains
           nobody anything and is one more copy of a secret than needed.

           NOT `user_metadata: {}`. updateUserById MERGES, so sending a key
           as null is what deletes it, and the name has to survive:
           accept_invitation reads raw_user_meta_data->>'name' to write
           their profile. Wiping the object wholesale would leave every
           invited teammate named after the front of their email address. */
        if (createdUser) {
          await admin.auth.admin.updateUserById(createdUser, {
            user_metadata: { name, team_invitation_id: null, team_invitation_nonce: null },
          })
        }
      }

      /* 3. SEND IT. Nothing in the message is a secret: the studio, the
            role, the branch, the expiry, and a link. */
      const mail = invitationEmail(kind, {
        studio: who.studio,
        role: ROLE_WORD[role] || role,
        branch: bw,
        inviter: who.inviter,
        link,
        expires: dayOf(inv.expires_at),
      })
      const sent = await sendViaResend(email, mail.subject, mail.html, mail.text)
      if (!sent.ok) {
        /* An invitation nobody was told about is worse than no invitation:
           it holds a seat, it expires silently, and the owner believes it
           was sent. So it goes back, and the account we just made goes
           with it. Both compensations are safe — no business was created,
           no membership was written, and the invitee has no session. */
        await admin.rpc('discard_invitation', {
          p_invitation_id: inv.invitation_id,
          p_reason: 'invitation email could not be sent',
        })
        if (createdUser) await admin.auth.admin.deleteUser(createdUser)
        return json({
          error: 'The invitation could not be emailed, so nothing was kept. ' + sent.error,
          code: 'mail_failed',
        }, 502)
      }

      return json({
        ok: true,
        invitation_id: inv.invitation_id,
        invited: email,
        kind,
        role,
        branch_id: branch,
        expires_at: inv.expires_at,
        account_created: !!createdUser,
        mail_id: sent.id || '',
        /* Where it points, not what it is. Enough to catch a staging build
           emailing a production link, which is the mistake worth catching. */
        link_host: (function () { try { return new URL(link).host } catch { return '' } })(),
      })
    }

    /* ---- resendInvitation: the same invitation, a fresh link.
       NOT a new invitation and NOT a new account. A second invitation row
       would hold a second seat and leave two live links for one person,
       and a second account is not possible anyway — the address is taken
       by the first one.

       WHICH LINK depends on what the account can do with it, and this is
       the part the design said was unproven until it ran against real
       GoTrue:
         invite    — what we want, but GoTrue refuses it for an address it
                     already holds in most versions
         recovery  — a password link, which is right for somebody who was
                     invited and never chose one
         magiclink — signs them in without a password, which is right for
                     somebody who already has one
       Tried in that order, and the one that worked is reported so the
       behaviour is recorded rather than assumed. */
    if (action === 'resendInvitation') {
      const invId = str(payload.invitation_id)
      if (!invId) return json({ error: 'Which invitation?' }, 400)

      const { data: row } = await admin
        .from('team_invitations')
        .select('id,email,role,branch_id,status,expires_at')
        .eq('id', invId).eq('business_id', biz).maybeSingle()
      if (!row) return json({ error: 'That invitation is not in this studio.' }, 403)
      if (row.status !== 'pending') {
        return json({ error: 'That invitation is no longer pending.' }, 400)
      }
      if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
        return json({ error: 'That invitation has expired. Send a new one.' }, 400)
      }

      const email = String(row.email)
      const landing = landingFor(invId)
      const bw = await branchWord(row.branch_id ? String(row.branch_id) : null)
      const who = await studioAndInviter()

      let link = landing
      let via = 'none'
      let confirmed = false
      for (const type of ['invite', 'recovery', 'magiclink'] as const) {
        /* No `data` on any of these. The nonce was single-use and is
           already spent; re-issuing one would mean a second abstain signal
           for an INSERT that cannot happen again. */
        const { data: gl, error } = await admin.auth.admin.generateLink({
          type, email, options: { redirectTo: landing },
        })
        if (!error && gl?.properties?.action_link) {
          link = String(gl.properties.action_link)
          via = type
          confirmed = !!gl?.user?.email_confirmed_at
          break
        }
      }

      /* THE WORDING FOLLOWS THE LINK, NOT THE ACCOUNT.

         It used to follow email_confirmed_at, and that was wrong in the one
         case that matters. Somebody who opened an invitation, confirmed their
         address and then failed to finish choosing a password is CONFIRMED and
         has no usable password: GoTrue writes a placeholder into
         encrypted_password at confirmation whether or not anybody chose one.
         Measured on staging, 28 September, on two accounts. Telling that person
         “you already have an account, there is nothing to set up” sends them to
         a sign-in form with nothing to type, which is the 13 September bug
         again in different clothes.

         The link knows what the account needs. invite and recovery both land on
         the choose-a-password screen; magiclink signs them straight in. So the
         link decides the words. */
      const mail = invitationEmail(via === 'magiclink' ? 'existing' : 'new', {
        studio: who.studio,
        role: ROLE_WORD[String(row.role)] || String(row.role),
        branch: bw || 'All branches',
        inviter: who.inviter,
        link,
        expires: dayOf(String(row.expires_at)),
      })
      const sent = await sendViaResend(email, mail.subject, mail.html, mail.text)
      if (!sent.ok) {
        /* NOTHING IS DISCARDED HERE. The invitation was already sent once
           and may already be in use; a failed resend must not take it
           away. The owner is told, and can try again. */
        return json({ error: 'Could not send it again: ' + sent.error, code: 'mail_failed' }, 502)
      }
      return json({
        ok: true, invitation_id: invId, resent_to: email, link_type: via, confirmed,
        mail_id: sent.id || '',
        link_host: (function () { try { return new URL(link).host } catch { return '' } })(),
      })
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
