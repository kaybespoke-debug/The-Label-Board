/* Taking a payment, and finishing one the moment somebody comes back.
 *
 * Two actions, and between them they cover every way a payment can reach us:
 *
 *   checkout  the owner asks to pay. This function does NOT decide who the
 *             owner is or what the plan costs — it calls public.open_checkout
 *             as the caller, and the database answers both questions. What it
 *             adds is the one thing only a server can do: hold the secret key
 *             and ask Flutterwave for a payment link.
 *
 *   finish    the person lands back on the app with a reference and a
 *             transaction id in the URL. We re-query Flutterwave and settle,
 *             rather than waiting for a webhook that may be a minute behind
 *             somebody staring at the screen.
 *
 * WHY BOTH PATHS ARE SAFE TOGETHER. `finish` and the webhook produce the SAME
 * event id for the same transaction — fw-tx-<id> — so settle_checkout applies
 * whichever arrives first and records the other as already seen. There is no
 * race to lose and no double charge to reconcile.
 *
 * WHAT IS NEVER TRUSTED. Nothing in the redirect or the webhook body decides
 * anything. The status, the amount and the currency come from Flutterwave's own
 * verify endpoint, which is their guidance and the only version of events that
 * is not simply whatever was posted to us. The studio and the plan come from
 * our billing_intents row.
 *
 * SECRETS: FLW_SECRET_KEY, and STUDIO_APP_URL for where to come back to.
 * Neither is ever logged, returned, or put in an error message.
 */
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
const FLW_KEY = Deno.env.get('FLW_SECRET_KEY') || ''
const FLW = 'https://api.flutterwave.com/v3'

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/* WHEN THIS FUNCTION IS THE THING THAT BROKE. Same shape as the other three:
   a row in error_reports rather than a line in a log nobody is reading. It can
   never be the thing that fails, and it never carries a key. */
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

/* Flutterwave's own account of what happened, which is the only one that
   counts. Returns null rather than throwing, so a caller can tell "we could
   not ask" apart from "it did not succeed". */
async function verifyTransaction(id: string) {
  if (!FLW_KEY) return null
  const res = await fetch(FLW + '/transactions/' + encodeURIComponent(id) + '/verify', {
    headers: { Authorization: 'Bearer ' + FLW_KEY },
  })
  if (!res.ok) return null
  const body = await res.json().catch(() => null) as
    { status?: string; data?: Record<string, unknown> } | null
  if (!body || body.status !== 'success' || !body.data) return null
  return body.data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    /* The caller, verified against their own token. Everything owner-only is
       decided by the database with this session, not by this function. */
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user }, error: uerr } = await caller.auth.getUser()
    if (uerr || !user) return json({ error: 'Not signed in' }, 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = str(body.action)
    const payload = (body.payload ?? {}) as Record<string, unknown>

    /* IS THIS ENVIRONMENT TAKING PAYMENTS AT ALL?
       Asked before anything else, and answerable on its own, because the app
       has to know whether to OFFER a card payment rather than find out by
       failing one. Production ships with the key unset until Flutterwave is
       configured and has passed staging end to end, and until then the
       Subscription panel shows no plan buttons instead of buttons that
       apologise. */
    if (action === 'status') {
      return json({ ok: true, configured: !!FLW_KEY })
    }

    if (!FLW_KEY) {
      /* SAID PLAINLY RATHER THAN FAILING OBSCURELY. Until the key is set this
         is a 503 with a sentence, not a crash in the middle of a checkout. */
      return json({ error: 'Payments are not switched on for this environment yet.' }, 503)
    }

    // -----------------------------------------------------------------
    if (action === 'checkout') {
      const business = str(payload.business)
      const plan = str(payload.plan)
      const cycle = str(payload.cycle)
      if (!business || !plan || !cycle) return json({ error: 'Which plan, and monthly or annual?' }, 400)

      /* THE DATABASE DECIDES. Owner-only, the price, the plan-limit check on a
         downgrade, and the intent row all happen here, as the caller. */
      const { data: intent, error: ierr } = await caller.rpc('open_checkout', {
        p_business: business, p_plan: plan, p_cycle: cycle,
      })
      if (ierr) return json({ error: ierr.message }, 400)

      const i = intent as { tx_ref: string; amount: number; currency: string; plan: string; cycle: string }

      const res = await fetch(FLW + '/payments', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + FLW_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_ref: i.tx_ref,
          amount: String(i.amount),
          currency: i.currency,
          /* OUR URL, NOT THE CALLER'S. A redirect taken from the request is an
             open redirect with a payment attached to it. */
          redirect_url: APP_URL + '?billing=return',
          customer: { email: user.email, name: str(payload.name) || user.email },
          customizations: {
            title: 'The Label Board',
            description: (i.plan === 'pro' ? 'Pro' : 'Basic') + ' — ' + i.cycle,
          },
          /* Read back for information only. Nothing is decided from it. */
          meta: { business_id: business, tx_ref: i.tx_ref },
        }),
      })
      const link = await res.json().catch(() => null) as
        { status?: string; data?: { link?: string }; message?: string } | null
      if (!res.ok || link?.status !== 'success' || !link?.data?.link) {
        await reportEdgeFault('billing/checkout', link?.message || ('provider ' + res.status), business)
        return json({ error: 'The payment page could not be opened. Nothing has been charged.' }, 502)
      }
      return json({ ok: true, link: link.data.link, tx_ref: i.tx_ref, amount: i.amount, currency: i.currency })
    }

    // -----------------------------------------------------------------
    if (action === 'finish') {
      /* The person is back from the payment page. The URL carries a reference
         and a transaction id; neither is believed, both are looked up. */
      const txId = str(payload.transaction_id)
      const txRef = str(payload.tx_ref)
      if (!txId) return json({ ok: true, settled: false, reason: 'nothing to check' })

      const tx = await verifyTransaction(txId)
      if (!tx) {
        return json({ ok: true, settled: false,
          reason: 'We could not confirm that with the payment provider yet. If you paid, it will arrive on its own.' })
      }
      /* The reference from the provider, not from the URL, because the URL is
         whatever the browser was handed. */
      const ref = str(tx.tx_ref) || txRef
      const admin = createClient(url, service)
      const { data: applied, error: serr } = await admin.rpc('settle_checkout', {
        p_event_id: 'fw-tx-' + String(tx.id ?? txId),
        p_tx_ref: ref,
        p_fw_tx_id: String(tx.id ?? txId),
        p_amount: Number(tx.amount ?? 0),
        p_currency: str(tx.currency) || 'NGN',
        p_status: str(tx.status),
        p_payload: tx,
      })
      if (serr) {
        await reportEdgeFault('billing/finish', serr.message)
        return json({ error: 'That payment could not be applied. Nothing has been charged twice.' }, 500)
      }
      return json({ ok: true, settled: true, result: applied })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    /* Never echo the thrown object: in a service-role context the detail is
       privileged, and here it can carry a provider response. */
    console.error('billing:', e)
    await reportEdgeFault('billing', e)
    return json({ error: 'Something went wrong handling that request.' }, 500)
  }
})
