// auth-recover — "I cannot get in", answered by us rather than by Supabase.
//
// WHY IT EXISTS. The app called supa.auth.resetPasswordForEmail, which hands
// the message to Supabase's own mailer. ACCOUNTS.md records that as broken
// since 13 September, and it has been the only way back into a studio ever
// since. An owner locked out of their own business is the end of that
// studio's goodwill, so this is not a nicety.
//
// Same architecture as the invitation: generateLink makes the link and hands
// it back instead of posting it, and Resend delivers it with our words and
// our sender.
//
// UNAUTHENTICATED ON PURPOSE, which makes three things load-bearing:
//
//   IT NEVER SAYS WHETHER AN ADDRESS EXISTS. Every request gets the same
//   answer. "No account with that email" is a free list of who banks here.
//
//   IT ONLY EVER SENDS TO THE ADDRESS IN THE REQUEST, and the link is minted
//   for that address by GoTrue. There is no parameter that redirects the
//   message anywhere else.
//
//   IT WILL NOT BE A MAIL CANNON. One send per address per minute, read from
//   the account's own recovery_sent_at, which GoTrue maintains. A second
//   request inside that window is answered exactly like the first and sends
//   nothing.
//
// AND SINCE 5 OCTOBER IT ADMITS WHEN IT CANNOT SEND. It used to answer "a
// link is on its way" with no mail provider configured, which is what it had
// been doing on production since the day it was deployed: RESEND_API_KEY was
// set on staging on 28 September and never on production. One request had
// ever been made and no email had ever been sent.
//
// The rule it follows now: LOUD ABOUT OURSELVES, SILENT ABOUT THEM. A missing
// provider is identically true for every address, so it is said plainly and
// the app repeats it. A failure for one particular address is the list this
// function exists to withhold, so that stays `same` and goes to
// error_reports without the address in it.
//
// TWO KINDS OF PERSON ARRIVE HERE and the difference matters. Somebody who
// has a password gets "choose a new one". Somebody who was invited and never
// finished gets "finish setting up" — telling them to reset a password they
// never had is how a person decides the product is broken.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const withSlash = (u: string) => (u.endsWith('/') ? u : u + '/')
const APP_URL = withSlash(Deno.env.get('STUDIO_APP_URL') || 'https://app.thelabelboard.com/')
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || ''
const MAIL_FROM = Deno.env.get('INVITE_FROM') || 'The Label Board <hello@thelabelboard.com>'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function recoveryEmail(kind: 'reset' | 'finish', link: string) {
  const title = kind === 'reset' ? 'Choose a new password' : 'Finish setting up your account'
  const lead = kind === 'reset'
    ? 'Somebody asked for a new password for this address on The Label Board. If it was you, the button below opens your studio and lets you choose one.'
    : 'You were invited to The Label Board and have not chosen a password yet. The button below opens your studio and lets you set one now.'
  const html = '<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px 12px;font-family:ui-sans-serif,system-ui,\'Segoe UI\',Helvetica,Arial,sans-serif;color:#111827">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;padding:32px" cellpadding="0" cellspacing="0">'
    + '<tr><td style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#17385c;padding-bottom:22px">The Label Board</td></tr>'
    + '<tr><td style="font-size:21px;font-weight:700;line-height:1.35;padding-bottom:14px">' + esc(title) + '</td></tr>'
    + '<tr><td style="font-size:15px;line-height:1.65;color:#3f4a5a;padding-bottom:22px">' + esc(lead) + '</td></tr>'
    + '<tr><td style="padding-bottom:18px"><a href="' + esc(link) + '" style="display:inline-block;background:#17385c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 26px;border-radius:10px">' + esc(title) + '</a></td></tr>'
    + '<tr><td style="font-size:13px;line-height:1.6;color:#6b7280;padding-bottom:22px">This link can be used once and expires in an hour. Nobody at The Label Board can see your password.</td></tr>'
    + '<tr><td style="border-top:1px solid #e5e7eb;padding-top:18px;font-size:12px;line-height:1.6;color:#9ca3af">'
    + 'Did not ask for this? Ignore it and nothing changes.<br>'
    + 'Need a hand? Reply to this email and a person will read it.</td></tr>'
    + '</table></td></tr></table></body></html>'
  const text = ['THE LABEL BOARD', '', title, '', lead, '', link, '',
    'This link can be used once and expires in an hour.',
    'Did not ask for this? Ignore it and nothing changes.'].join('\n')
  return { subject: title + ' — The Label Board', html, text }
}

async function send(to: string, subject: string, html: string, text: string) {
  if (!RESEND_KEY) return { ok: false, id: '', error: 'No mail provider is configured.' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html, text }),
  })
  if (!res.ok) {
    /* The provider's own words, which are the difference between "the key is
       wrong" and "the sending domain is not verified" and "that recipient is
       suppressed". Without them a failure here is a number nobody can act
       on. Capped, and it never contains the key.

       REDACTED FIRST. Resend quotes the request back in some of its errors,
       so its reply can contain the recipient. This string ends up in
       error_reports, which a platform admin reads — and the entire point of
       answering every caller the same sentence is that nobody learns which
       addresses have accounts here. Putting the address in the error table
       would rebuild that list on the other side of the wall. */
    const why = (await res.text().catch(() => ''))
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<address redacted>')
    return { ok: false, id: '', error: 'provider ' + res.status + ' ' + why.slice(0, 400) }
  }
  const body = await res.json().catch(() => null) as { id?: string } | null
  return { ok: true, id: body?.id || '', error: '' }
}

/* WHEN THIS FUNCTION IS THE THING THAT BROKE.
   Deno logs are there, and reading them means somebody deciding to go and
   look, on a day nobody knows there is anything to look for. A row in
   error_reports is the same failure in the place we already watch, beside
   the browser faults, so "the invitation did not arrive" has an answer
   before the studio has to ask twice.

   It writes as the service role, which is how this function already talks
   to the database, and the row is stamped source=server by the trigger
   rather than by this claim — the claim is only a default.

   return=minimal on purpose: error_reports has no SELECT for anybody but a
   platform admin, and asking for the row back runs that policy.

   And it can never be the thing that fails. Every path swallows. */
async function reportEdgeFault(where: string, e: unknown, businessId?: string | null) {
  try {
    const u = Deno.env.get('SUPABASE_URL')
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!u || !service) return
    const msg = String((e as Error)?.message ?? e ?? '').slice(0, 1000)
    const stack = String((e as Error)?.stack ?? '').slice(0, 4000)
    await fetch(u + '/rest/v1/error_reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: service,
        Authorization: 'Bearer ' + service,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        business_id: businessId ?? null, kind: 'edge', source: 'server',
        message: where + ': ' + msg, stack, at_url: where,
      }),
    })
  } catch { /* reporting must never be the thing that fails */ }
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  /* THE SAME ANSWER, ALWAYS. Every return below is this object. Anything
     that varies with whether the address exists is a disclosure. */
  const same = { ok: true, message: 'If that address has an account, a link is on its way.' }

  /* EXCEPT FOR THIS ONE, AND THE DISTINCTION IS THE WHOLE POINT.
     ========================================================================
     Until 5 October this function answered `same` even when it had no mail
     provider at all, so it reported success and sent nothing, and the app
     printed "a link is on its way" on top of that. The live project held one
     request ever made and zero emails ever sent. The cause was mundane:
     RESEND_API_KEY was set on the STAGING project on 28 September and never
     on production, which has only the seven secrets Supabase provides.

     A missing provider is a property of OUR DEPLOYMENT. It is identically
     true for every address on earth, so saying it out loud reveals nothing
     about who has an account here — and NOT saying it strands an owner who
     is locked out of their own business, which is the thing this function
     exists to prevent.

     A failure for one PARTICULAR address is the opposite. Which addresses
     bounce, are suppressed, or do not exist is exactly the list this
     function must never hand out, so that case still answers `same` and goes
     to error_reports instead, where we already look.

     Loud about ourselves, silent about them. */
  const notConfigured = {
    ok: false,
    code: 'mail_not_configured',
    message: 'We cannot send email at the moment, so no link has gone out. '
      + 'Nothing is wrong with your account. Please contact us and we will get you back in.',
  }
  if (!RESEND_KEY) {
    console.error('auth-recover: RESEND_API_KEY is not set on this project. No mail was attempted.')
    await reportEdgeFault('auth-recover/not-configured',
      new Error('RESEND_API_KEY is not set on this project; no recovery mail can be sent'))
    return json(notConfigured, 503)
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!email || !email.includes('@')) return json(same)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: who, error: werr } = await admin.rpc('account_for_recovery', { p_email: email })
    if (werr || !who || !(who as unknown[]).length) return json(same)
    const acct = (who as Array<{ confirmed: boolean; recently_sent: boolean }>)[0]

    if (acct.recently_sent) return json(same)   // one a minute, silently

    const kind: 'reset' | 'finish' = acct.confirmed ? 'reset' : 'finish'
    const { data: gl, error: gerr } = await admin.auth.admin.generateLink({
      type: acct.confirmed ? 'recovery' : 'invite',
      email,
      options: { redirectTo: APP_URL },
    })
    if (gerr || !gl?.properties?.action_link) {
      /* Reported as well as logged. A link that cannot be minted is as
         complete a lockout as mail that cannot be sent, and it used to leave
         nothing behind but a Deno log line nobody had a reason to read. */
      console.error('auth-recover generateLink:', gerr?.message)
      await reportEdgeFault('auth-recover/generate-link',
        new Error('generateLink failed for a ' + kind + ' link: ' + (gerr?.message ?? 'no action_link returned')))
      return json(same)
    }

    const mail = recoveryEmail(kind, String(gl.properties.action_link))
    const sent = await send(email, mail.subject, mail.html, mail.text)
    if (!sent.ok) {
      /* SILENT TO THE CALLER, LOUD TO US. The address is deliberately not in
         the report: the whole point of answering `same` is that nobody learns
         which addresses have accounts here, and a report naming the address
         would rebuild that list in a table a platform admin reads. The
         provider's reason is what makes it fixable, and the reason is not
         address-specific. */
      console.error('auth-recover send:', sent.error)
      await reportEdgeFault('auth-recover/send',
        new Error('the provider refused a ' + kind + ' message: ' + sent.error))
    }
    return json(same)
  } catch (e) {
    /* Even a crash answers the same way. A 500 for one address and a 200 for
       another is the disclosure this whole function exists to avoid. */
    console.error('auth-recover:', e)
    await reportEdgeFault('auth-recover', e)
    return json(same)
  }
})
