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
  owner:     ['me', 'tenants', 'tenant', 'setPlan', 'setStatus', 'setNote', 'audit'],
  finance:   ['me', 'tenants', 'tenant', 'setPlan', 'setStatus'],
  support:   ['me', 'tenants', 'tenant', 'setNote'],
  developer: ['me', 'tenants', 'tenant'],
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
      const VALID = action === 'setPlan'
        ? ['trial', 'studio', 'growth', 'atelier']
        : ['active', 'past_due', 'paused', 'cancelled']
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

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
