// team-admin — owner-gated team account management (Supabase Edge Function, Deno).
// The service-role key lives ONLY here on the server; the browser never sees it.
// Deploy:  supabase functions deploy team-admin
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Who is calling? (their JWT is forwarded in the Authorization header)
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: { user }, error: uerr } = await caller.auth.getUser()
    if (uerr || !user) return json({ error: 'Not signed in' }, 401)

    const admin = createClient(url, service)
    const { data: me } = await admin.from('profiles').select('role_id,business_id').eq('id', user.id).single()
    if (!me) return json({ error: 'No profile for this user' }, 403)
    const biz = me.business_id
    const isOwner = me.role_id === 'owner'

    const { action, payload = {} } = await req.json()

    if (action === 'list') {
      const { data: profs } = await admin.from('profiles').select('id,name,role_id,staff_id').eq('business_id', biz)
      const rows = []
      for (const p of profs ?? []) {
        const { data: au } = await admin.auth.admin.getUserById(p.id)
        rows.push({ ...p, email: au?.user?.email ?? '' })
      }
      return json({ rows })
    }

    // Everything below changes accounts — owner only.
    if (!isOwner) return json({ error: 'Only the owner can add or change team accounts' }, 403)

    if (action === 'create') {
      const { email, password, name, role_id, staff_id } = payload
      if (!email || !password) return json({ error: 'Email and password are required' }, 400)
      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })
      if (error) return json({ error: error.message }, 400)
      const { error: perr } = await admin.from('profiles').insert({ id: created.user.id, name, role_id: role_id || 'cre', business_id: biz, staff_id: staff_id || null })
      if (perr) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: perr.message }, 400) }
      return json({ id: created.user.id })
    }

    if (action === 'update') {
      const { id, name, role_id, staff_id, password } = payload
      const { error } = await admin.from('profiles').update({ name, role_id, staff_id: staff_id || null }).eq('id', id).eq('business_id', biz)
      if (error) return json({ error: error.message }, 400)
      if (password) { const { error: pe } = await admin.auth.admin.updateUserById(id, { password }); if (pe) return json({ error: pe.message }, 400) }
      return json({ ok: true })
    }

    if (action === 'delete') {
      const { id } = payload
      if (id === user.id) return json({ error: 'You cannot delete your own account' }, 400)
      await admin.from('profiles').delete().eq('id', id).eq('business_id', biz)
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
