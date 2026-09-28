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
  if (!res.ok) return { ok: false, id: '', error: 'provider ' + res.status }
  const body = await res.json().catch(() => null) as { id?: string } | null
  return { ok: true, id: body?.id || '', error: '' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  /* THE SAME ANSWER, ALWAYS. Every return below is this object. Anything
     that varies with whether the address exists is a disclosure. */
  const same = { ok: true, message: 'If that address has an account, a link is on its way.' }

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
      console.error('auth-recover generateLink:', gerr?.message)
      return json(same)
    }

    const mail = recoveryEmail(kind, String(gl.properties.action_link))
    const sent = await send(email, mail.subject, mail.html, mail.text)
    if (!sent.ok) console.error('auth-recover send:', sent.error)
    return json(same)
  } catch (e) {
    /* Even a crash answers the same way. A 500 for one address and a 200 for
       another is the disclosure this whole function exists to avoid. */
    console.error('auth-recover:', e)
    return json(same)
  }
})
