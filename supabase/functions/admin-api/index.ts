// admin-api — the operator console's only door to the database.
//
// The console never queries a table. It calls this, and this decides what the
// caller may see. That is what lets tenant row-level security stay absolute:
// we work around it in one audited place instead of weakening it everywhere.
//
// Deploy:  supabase functions deploy admin-api
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const URL_ = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/* what each role is allowed to ask for. Anything not listed is refused. */
const ALLOWED: Record<string, string[]> = {
  owner:     ['me', 'tenants', 'tenant', 'setPlan', 'setStatus', 'setNote', 'audit',
              'feedback', 'feedbackThread', 'setFeedbackState', 'replyFeedback'],
  finance:   ['me', 'tenants', 'tenant', 'setPlan', 'setStatus'],
  support:   ['me', 'tenants', 'tenant', 'setNote',
              'feedback', 'feedbackThread', 'setFeedbackState', 'replyFeedback'],
  // a developer reads what studios reported and can move it along, but does
  // not write to a studio in our name
  developer: ['me', 'tenants', 'tenant', 'feedback', 'feedbackThread', 'setFeedbackState'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // 1. who is calling? verified against the token they sent, not what they claim
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401)

  const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } })
  const { data: { user }, error: uerr } = await asUser.auth.getUser()
  if (uerr || !user) return json({ error: 'Not signed in' }, 401)

  // 2. are they OUR staff? tenants reach this point and stop here.
  const admin = createClient(URL_, SERVICE)
  const { data: staff } = await admin
    .from('platform_admins')
    .select('id,name,role,active')
    .eq('id', user.id)
    .maybeSingle()

  if (!staff || staff.active === false) {
    return json({ error: 'This account is not a Label Board staff account.' }, 403)
  }

  const role = String(staff.role || 'support')
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  if (!(ALLOWED[role] || []).includes(action)) {
    return json({ error: `Your role (${role}) cannot do that.` }, 403)
  }

  /* every call is recorded. Reads included: the point is being able to answer
     "who looked at my studio", not just "who changed it". */
  const log = (detail: unknown, business_id: string | null = null) =>
    admin.from('platform_audit').insert({
      admin_id: user.id, admin_email: user.email, action,
      business_id, detail: detail as Record<string, unknown>,
    })

  try {
    if (action === 'me') {
      return json({ ok: true, me: { id: user.id, email: user.email, name: staff.name, role } })
    }

    if (action === 'tenants') {
      const { data, error } = await admin.rpc('platform_tenant_summary')
      if (error) return json({ error: error.message }, 500)
      await log({ count: (data || []).length })
      return json({ ok: true, tenants: data || [], role })
    }

    if (action === 'tenant') {
      const id = String(body.id || '')
      if (!id) return json({ error: 'No studio id' }, 400)
      const { data, error } = await admin.rpc('platform_tenant_summary')
      if (error) return json({ error: error.message }, 500)
      const one = (data || []).find((t: Record<string, unknown>) => t.id === id)
      if (!one) return json({ error: 'No such studio' }, 404)
      const { data: notes } = await admin.from('businesses').select('notes').eq('id', id).maybeSingle()
      await log({ viewed: id }, id)
      return json({ ok: true, tenant: { ...one, notes: notes?.notes || '' } })
    }

    if (action === 'setPlan' || action === 'setStatus') {
      const id = String(body.id || '')
      const value = String(body.value || '')
      const col = action === 'setPlan' ? 'plan' : 'status'
      // These have to match the CHECK constraints on businesses, or the
      // update is refused by the database after passing validation here.
      // They also match PLANS in the customer app and the plan names the
      // console displays — one vocabulary, in four places.
      const VALID = action === 'setPlan'
        ? ['trial', 'starter', 'pro', 'premium']
        : ['active', 'suspended', 'closed']
      if (!id) return json({ error: 'No studio id' }, 400)
      if (!VALID.includes(value)) return json({ error: `${col} must be one of: ${VALID.join(', ')}` }, 400)
      const { error } = await admin.from('businesses').update({ [col]: value }).eq('id', id)
      if (error) return json({ error: error.message }, 500)
      await log({ [col]: value }, id)
      return json({ ok: true })
    }

    if (action === 'setNote') {
      const id = String(body.id || '')
      const notes = String(body.notes ?? '').slice(0, 4000)
      if (!id) return json({ error: 'No studio id' }, 400)
      const { error } = await admin.from('businesses').update({ notes }).eq('id', id)
      if (error) return json({ error: error.message }, 500)
      await log({ noteLength: notes.length }, id)
      return json({ ok: true })
    }

    if (action === 'audit') {
      const { data, error } = await admin
        .from('platform_audit').select('*').order('at', { ascending: false }).limit(200)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, audit: data || [] })
    }

    /* ---- the inbox: what studios have told us -------------------------------
       Read with the service role, because tenant row-level security quite
       correctly refuses to show one studio's message to anyone but that
       studio. This is the one audited door through that wall. */
    if (action === 'feedback') {
      const state = String(body.state || '')
      const kind = String(body.kind || '')
      let q = admin.from('feedback_inbox').select('*').order('created_at', { ascending: false }).limit(500)
      if (state) q = q.eq('state', state)
      if (kind) q = q.eq('kind', kind)
      const { data, error } = await q
      if (error) return json({ error: error.message }, 500)
      await log({ count: (data || []).length, state: state || 'all', kind: kind || 'all' })
      return json({ ok: true, feedback: data || [], role })
    }

    if (action === 'feedbackThread') {
      const id = String(body.id || '')
      if (!id) return json({ error: 'No message id' }, 400)
      const { data: msg, error: e1 } = await admin
        .from('feedback_inbox').select('*').eq('id', id).maybeSingle()
      if (e1) return json({ error: e1.message }, 500)
      if (!msg) return json({ error: 'No such message' }, 404)
      const { data: replies, error: e2 } = await admin
        .from('feedback_replies').select('*').eq('feedback_id', id).order('at', { ascending: true })
      if (e2) return json({ error: e2.message }, 500)
      await log({ viewed: id }, msg.business_id as string)
      return json({ ok: true, message: msg, replies: replies || [] })
    }

    if (action === 'setFeedbackState') {
      const id = String(body.id || '')
      const value = String(body.value || '')
      const VALID = ['new', 'open', 'in-progress', 'planned', 'resolved', 'declined']
      if (!id) return json({ error: 'No message id' }, 400)
      if (!VALID.includes(value)) return json({ error: `state must be one of: ${VALID.join(', ')}` }, 400)
      const { data, error } = await admin
        .from('feedback').update({ state: value }).eq('id', id).select('business_id').maybeSingle()
      if (error) return json({ error: error.message }, 500)
      await log({ state: value, id }, data?.business_id ?? null)
      return json({ ok: true })
    }

    /* A reply is written as side 'us'. The tenant policy refuses that insert
       from a browser, so a reply from support can only ever come from here. */
    if (action === 'replyFeedback') {
      const id = String(body.id || '')
      const text = String(body.body ?? '').trim().slice(0, 4000)
      if (!id) return json({ error: 'No message id' }, 400)
      if (!text) return json({ error: 'Nothing to send' }, 400)
      const { data: msg } = await admin
        .from('feedback').select('business_id').eq('id', id).maybeSingle()
      if (!msg) return json({ error: 'No such message' }, 404)
      const { error } = await admin.from('feedback_replies').insert({
        feedback_id: id, business_id: msg.business_id, side: 'us',
        author: staff.name || user.email, body: text,
      })
      if (error) return json({ error: error.message }, 500)
      // replying to something nobody has picked up yet means it is now open
      await admin.from('feedback').update({ state: 'open' }).eq('id', id).eq('state', 'new')
      await log({ replied: id, length: text.length }, msg.business_id as string)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
