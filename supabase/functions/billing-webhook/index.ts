/* The webhook, which is the only part of this system a stranger can reach.
 *
 * It is deployed with --no-verify-jwt, because Flutterwave has no Supabase
 * token to send. That makes it the one public door in the whole project, so it
 * is the one place where every line is about not believing what it was told.
 *
 *   1. THE HEADER FIRST. Flutterwave sends `verif-hash` on every webhook and
 *      the value is the Secret Hash set in their dashboard. No hash, or the
 *      wrong hash, and nothing is read and nothing is recorded: a 401 and an
 *      empty body. Compared in constant time, because comparing a secret with
 *      === leaks its length and its prefix to anybody willing to send a few
 *      thousand requests.
 *
 *   2. THEN THE PROVIDER IS ASKED AGAIN. Even with a valid hash the body is
 *      only a claim about what happened. Flutterwave's own guidance is to
 *      re-query the transaction before giving value, and that is what decides
 *      the status, the amount and the currency.
 *
 *   3. AND THE STUDIO IS NEVER IN THE MESSAGE. Which studio and which plan
 *      come from our own billing_intents row, matched on the reference. A
 *      webhook naming a business id, a plan or a price settles nothing,
 *      because none of those are parameters.
 *
 *   4. ONCE. The event id is fw-tx-<transaction id>, which is stable across
 *      retries and identical to the one the redirect path uses, so the two
 *      cannot both apply.
 *
 * It answers 200 to anything it has authenticated, including things it decided
 * not to act on. A provider that gets a 500 retries for hours; a 200 with
 * nothing done is the honest answer to "I have recorded this and it changes
 * nothing".
 *
 * SECRETS: FLW_SECRET_HASH to check the header, FLW_SECRET_KEY to ask again.
 * Neither is logged, echoed or included in any response.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const FLW = 'https://api.flutterwave.com/v3'
const FLW_KEY = Deno.env.get('FLW_SECRET_KEY') || ''
const FLW_HASH = Deno.env.get('FLW_SECRET_HASH') || ''

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/* Constant time, and length-safe. A === on a secret answers faster the sooner
   it differs, which is a few thousand requests away from being the secret. */
function sameSecret(a: string, b: string) {
  if (!a || !b) return false
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

async function reportEdgeFault(where: string, e: unknown) {
  try {
    const u = Deno.env.get('SUPABASE_URL')
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!u || !service) return
    await fetch(u + '/rest/v1/error_reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', apikey: service,
        Authorization: 'Bearer ' + service, Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        business_id: null, kind: 'edge', source: 'server', at_url: where,
        message: where + ': ' + String((e as Error)?.message ?? e ?? '').slice(0, 1000),
        stack: String((e as Error)?.stack ?? '').slice(0, 4000),
      }),
    })
  } catch { /* never the thing that fails */ }
}

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
  /* No CORS headers anywhere in this file. A browser has no business calling
     this, and advertising that it may is how somebody starts trying. */
  if (req.method !== 'POST') return new Response('', { status: 405 })

  /* THE HASH, BEFORE THE BODY IS EVEN READ. */
  if (!FLW_HASH) {
    await reportEdgeFault('billing-webhook', 'FLW_SECRET_HASH is not set; webhooks are being refused')
    return new Response('', { status: 503 })
  }
  if (!sameSecret(req.headers.get('verif-hash') || '', FLW_HASH)) {
    return new Response('', { status: 401 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const data = (body.data ?? {}) as Record<string, unknown>
    const txId = str(data.id) || String(data.id ?? '')
    if (!txId) return json({ ok: true, settled: false, reason: 'no transaction id' })

    /* Ask Flutterwave what actually happened. If we cannot ask, do not guess:
       a 200 with nothing done, and the provider's retry will bring it back. */
    const tx = await verifyTransaction(txId)
    if (!tx) return json({ ok: true, settled: false, reason: 'could not verify' })

    const url = Deno.env.get('SUPABASE_URL')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, service)

    const { data: applied, error } = await admin.rpc('settle_checkout', {
      p_event_id: 'fw-tx-' + String(tx.id ?? txId),
      p_tx_ref: str(tx.tx_ref),
      p_fw_tx_id: String(tx.id ?? txId),
      p_amount: Number(tx.amount ?? 0),
      p_currency: str(tx.currency) || 'NGN',
      p_status: str(tx.status),
      p_payload: { event: str(body.event), data: tx },
    })
    if (error) {
      /* This one DOES deserve a retry: we authenticated the caller, verified
         the transaction, and failed to write it down. */
      await reportEdgeFault('billing-webhook/settle', error.message)
      return new Response('', { status: 500 })
    }
    return json({ ok: true, result: applied })
  } catch (e) {
    console.error('billing-webhook:', e)
    await reportEdgeFault('billing-webhook', e)
    return new Response('', { status: 500 })
  }
})
