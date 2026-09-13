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
  /* inviteOperator is deliberately owner-only and the other two are not.
     Inviting a studio or a partner is day-to-day work any manager should do
     without waiting for Kayode. Creating another operator hands somebody the
     ability to read every subscriber's books and every payment, and a support
     agent who can do that can quietly promote themselves. */
  owner:     ['me', 'tenants', 'tenant', 'setPlan', 'setStatus', 'setNote', 'audit',
              'feedback', 'feedbackThread', 'setFeedbackState', 'replyFeedback',
              'billing', 'payments', 'recordPayment', 'setStorageCap',
              'enquiries', 'setEnquiryState', 'partners',
              'inviteOperator', 'inviteStudio', 'invitePartner'],
  // Finance is the role that exists to do this. Support and developer are not
  // given it: what every subscriber pays is not something a support agent needs
  // to answer a ticket, and a role that can read it will eventually be given to
  // somebody because it was easier than making a new one.
  finance:   ['me', 'tenants', 'tenant', 'setPlan', 'setStatus',
              'billing', 'payments', 'recordPayment', 'setStorageCap',
              'enquiries', 'setEnquiryState', 'partners',
              'inviteStudio', 'invitePartner'],
  support:   ['me', 'tenants', 'tenant', 'setNote',
              'feedback', 'feedbackThread', 'setFeedbackState', 'replyFeedback',
              'enquiries', 'setEnquiryState', 'partners',
              'inviteStudio', 'invitePartner'],
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

    /* ---- billing ------------------------------------------------------------
       What every studio is on and what it has actually paid. paid_to_date sums
       only completed payments: a plan's list price is what a studio owes, and
       reporting that as revenue is how a business believes it is being paid
       while nothing has landed. */
    if (action === 'billing') {
      const { data, error } = await admin.rpc('platform_billing_summary')
      if (error) return json({ error: error.message }, 500)
      await log({ count: (data || []).length })
      return json({ ok: true, billing: data || [], role })
    }

    if (action === 'payments') {
      const id = String(body.id || '')
      // No id means every studio, for the Payments page; an id means one, for its panel.
      const { data, error } = await admin.rpc('studio_payments', { p_business: id || null })
      if (error) return json({ error: error.message }, 500)
      await log({ viewed: id || 'all' }, id || null)
      return json({ ok: true, payments: data || [] })
    }

    /* Recording a payment that has already happened — no gateway, no card. The
       subscription it belongs to is resolved in the database rather than passed
       in, so a payment cannot be filed against another studio's plan. */
    if (action === 'recordPayment') {
      const id = String(body.id || '')
      const amount = Number(body.amount)
      if (!id) return json({ error: 'No studio id' }, 400)
      if (!isFinite(amount) || amount <= 0) return json({ error: 'A payment must be for an amount' }, 400)
      const { data, error } = await admin.rpc('record_studio_payment', {
        p_business: id,
        p_amount: amount,
        p_method: String(body.method || 'bank transfer').slice(0, 60),
        p_reference: String(body.reference || '').slice(0, 120),
        p_note: String(body.note || '').slice(0, 500)
      })
      if (error) return json({ error: error.message }, 500)
      await log({ recorded: amount, method: body.method || 'bank transfer' }, id)
      return json({ ok: true, id: data })
    }

    /* setPlan moves BOTH books: businesses.plan, which decides what the studio
       may do in the app, and the active subscription, which is what we invoice.
       They are written by one function so they cannot end up disagreeing — a
       studio paying for Pro while the app treats it as a trial is the kind of
       thing a customer discovers before we do. */
    if (action === 'setPlan') {
      const id = String(body.id || '')
      const value = String(body.value || '')
      const cycle = String(body.cycle || (value === 'trial' ? 'trial' : 'monthly'))
      const price = Number(body.price)
      const VALID = ['trial', 'starter', 'pro', 'premium']
      if (!id) return json({ error: 'No studio id' }, 400)
      if (!VALID.includes(value)) return json({ error: `plan must be one of: ${VALID.join(', ')}` }, 400)
      if (!['monthly', 'annual', 'trial'].includes(cycle)) return json({ error: 'Unknown billing cycle' }, 400)
      if (!isFinite(price) || price < 0) return json({ error: 'A plan needs a price, even if it is zero' }, 400)
      const { error } = await admin.rpc('set_studio_plan', {
        p_business: id, p_plan: value, p_cycle: cycle, p_price: price
      })
      if (error) return json({ error: error.message }, 500)
      await log({ plan: value, cycle, price }, id)
      return json({ ok: true })
    }

    /* Selling one studio more space.
       Extra storage costs us about $0.0213/GB/month (~N28), so this is the
       row an operator writes after agreeing a price — never something a
       tenant can reach. The column behind it is not writable by the studio
       either: businesses carries column-level grants and storage_cap_bytes
       is not among them.
       A null gb clears the override and returns them to their plan's cap. */
    if (action === 'setStorageCap') {
      const id = String(body.id || '')
      const raw = body.gb
      if (!id) return json({ error: 'No studio id' }, 400)
      const gb = (raw === null || raw === undefined || raw === '') ? null : Number(raw)
      if (gb !== null && (!isFinite(gb) || gb < 0)) {
        return json({ error: 'Storage has to be a number of GB, or empty to use the plan default' }, 400)
      }
      // A cap below what they are already storing would strand them: they
      // could not upload, and could not be told a number that made sense.
      if (gb !== null) {
        const { data: b } = await admin
          .from('businesses').select('storage_used_bytes,name').eq('id', id).maybeSingle()
        const used = Number(b?.storage_used_bytes || 0)
        if (used > gb * 1e9) {
          return json({ error: `${b?.name || 'That studio'} is already storing ${(used / 1e9).toFixed(1)} GB. Set the cap above that, or ask them to delete some photos first.` }, 400)
        }
      }
      const { error } = await admin.rpc('set_studio_storage_cap', {
        p_business: id, p_gb: gb, p_note: String(body.note || '').slice(0, 500) || null
      })
      if (error) return json({ error: error.message }, 500)
      await log({ storageCapGb: gb, note: body.note || '' }, id)
      return json({ ok: true })
    }

    /* ---- enquiries from the public website -----------------------------
       The four forms post to Netlify (unchanged, and still the fallback that
       works with no JavaScript) and to the database, so this is the console's
       copy rather than the only one. Read with the service role because the
       table has row-level security on and no policies at all: nobody but us
       sees a stranger's phone number. */
    if (action === 'enquiries') {
      const state = String(body.state || '')
      const { data, error } = await admin.rpc('platform_enquiries', { p_state: state || null })
      if (error) return json({ error: error.message }, 500)
      await log({ count: (data || []).length, state: state || 'all' })
      return json({ ok: true, enquiries: data || [], role })
    }

    if (action === 'setEnquiryState') {
      const id = String(body.id || '')
      const value = String(body.value || '')
      const VALID = ['new', 'open', 'replied', 'converted', 'spam', 'closed']
      if (!id) return json({ error: 'No enquiry id' }, 400)
      if (!VALID.includes(value)) return json({ error: `state must be one of: ${VALID.join(', ')}` }, 400)
      const { error } = await admin.rpc('set_enquiry_state', {
        p_id: id, p_state: value,
        p_by: staff.name || user.email,
        p_notes: body.notes === undefined ? null : String(body.notes).slice(0, 2000)
      })
      if (error) return json({ error: error.message }, 500)
      await log({ enquiry: id, state: value })
      return json({ ok: true })
    }

    if (action === 'setStatus') {
      const id = String(body.id || '')
      const value = String(body.value || '')
      // These have to match the CHECK constraint on businesses, or the update
      // is refused by the database after passing validation here.
      const VALID = ['active', 'suspended', 'closed']
      if (!id) return json({ error: 'No studio id' }, 400)
      if (!VALID.includes(value)) return json({ error: `status must be one of: ${VALID.join(', ')}` }, 400)
      const { error } = await admin.from('businesses').update({ status: value }).eq('id', id)
      if (error) return json({ error: error.message }, 500)
      await log({ status: value }, id)
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

    /* Who our referral partners are, and how each of them is doing. Read
       through the service role like everything else here, because partner rows
       are readable by that partner and nobody else — an operator is not a
       partner, so row level security correctly refuses them and this is the one
       audited place that goes around it.

       pending_email is exposed deliberately: an invited partner who has not
       claimed their account yet is invisible otherwise, and "did that invite
       ever go out" is the first question anybody asks. */
    if (action === 'partners') {
      const { data, error } = await admin
        .from('partners')
        .select('id,code,name,business_name,email,phone,city,tier,status,joined_on,user_id,pending_email')
        .order('joined_on', { ascending: false })
      if (error) return json({ error: error.message }, 500)
      await log({ count: (data || []).length })
      return json({ ok: true, partners: data || [] })
    }

    /* ---------------- invitations ----------------------------------------
       The only way an account gets created anywhere. Before this, every studio,
       partner and colleague was made by hand in the Supabase dashboard with a
       password somebody invented and then sent them in a message.

       Nobody is ever sent a password. Supabase emails an invite and they set
       their own, so a credential never passes through an operator, a chat, or a
       screenshot.

       ORDER MATTERS AND IS NOT OBVIOUS. The record is written BEFORE the account.
       `app.provision_studio()` runs on insert into auth.users and claims a row
       whose pending address matches; if the account is created first there is
       nothing to claim, and the trigger cheerfully builds a brand new studio
       instead of attaching them to the one just prepared. */

    if (action === 'inviteOperator' || action === 'inviteStudio' || action === 'invitePartner') {
      const email = String(body.email || '').trim().toLowerCase()
      if (!email || !email.includes('@')) return json({ error: 'A valid email address is needed' }, 400)

      /* Prepare the record first. Each kind has its own table and its own idea
         of what the pending address is called. */
      let prepared: { table: string; id?: string } | null = null

      if (action === 'inviteOperator') {
        const ROLES = ['owner', 'finance', 'support', 'developer']
        const wanted = String(body.role || 'support')
        if (!ROLES.includes(wanted)) {
          return json({ error: `role must be one of: ${ROLES.join(', ')}` }, 400)
        }
        /* platform_admins is keyed by the auth user id, so unlike the other two
           it cannot be written until the account exists. Held and written after. */
        prepared = { table: 'platform_admins' }
      }

      if (action === 'inviteStudio') {
        const name = String(body.businessName || '').trim().slice(0, 200)
        if (!name) return json({ error: 'The studio needs a name' }, 400)
        const { data: existing } = await admin
          .from('businesses').select('id').eq('pending_owner_email', email).maybeSingle()
        if (existing) {
          prepared = { table: 'businesses', id: existing.id as string }
        } else {
          /* businesses.slug is NOT NULL, and the trigger only generates one on
             the path where it invents a studio from scratch. A studio prepared
             here takes the path that just clears the pending address, so the
             slug has to exist before the row does. Collisions are real: two
             studios called Adeola Couture is a Tuesday, not an edge case. */
          const base = name.toLowerCase().normalize('NFKD')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'studio'
          let slug = base
          for (let n = 1; n < 50; n++) {
            const { data: clash } = await admin
              .from('businesses').select('id').eq('slug', slug).maybeSingle()
            if (!clash) break
            slug = base + '-' + n
          }
          const { data: made, error } = await admin.from('businesses')
            .insert({ name, slug, plan: 'trial', status: 'active',
                      contact_email: email, pending_owner_email: email })
            .select('id').maybeSingle()
          if (error) return json({ error: 'Could not create the studio: ' + error.message }, 500)
          prepared = { table: 'businesses', id: made?.id as string }
          await admin.from('branches').insert({ business_id: made?.id, name: 'Main studio' })
        }
      }

      if (action === 'invitePartner') {
        const name = String(body.name || '').trim().slice(0, 160)
        const code = String(body.code || '').trim().toUpperCase().slice(0, 32)
        const tier = String(body.tier || 'bronze')
        if (!name) return json({ error: 'The partner needs a name' }, 400)
        if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(code)) {
          return json({ error: 'A referral code is needed: letters, numbers and hyphens' }, 400)
        }
        if (!['bronze', 'silver', 'gold', 'platinum'].includes(tier)) {
          return json({ error: 'Unknown tier' }, 400)
        }
        const { data: existing } = await admin
          .from('partners').select('id').eq('pending_email', email).maybeSingle()
        if (existing) {
          prepared = { table: 'partners', id: existing.id as string }
        } else {
          const { data: made, error } = await admin.from('partners')
            .insert({ name, email, code, tier, status: 'active', pending_email: email })
            .select('id').maybeSingle()
          if (error) return json({ error: 'Could not create the partner: ' + error.message }, 500)
          prepared = { table: 'partners', id: made?.id as string }
        }
      }

      /* Now the account. The invite email goes out from here. */
      const { data: invited, error: inviteErr } =
        await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: String(body.redirectTo || '') || undefined,
        })

      if (inviteErr) {
        /* An address that already has an account is a decision, not a failure:
           somebody may already be a studio owner and now also a partner. We do
           not guess. The console shows this and the operator chooses. */
        const already = /already|registered|exists/i.test(inviteErr.message || '')
        await log({ invite: email, kind: action, failed: inviteErr.message })
        return json({
          error: already
            ? 'That address already has an account. Adding a second role to an existing account is not built yet.'
            : 'Could not send the invitation: ' + inviteErr.message,
          alreadyExists: already,
        }, already ? 409 : 500)
      }

      const newUserId = invited?.user?.id
      if (!newUserId) return json({ error: 'The invitation was sent but no account came back' }, 500)

      /* platform_admins is the one the trigger does not handle, because an
         operator is not something anybody self-provisions into. */
      if (action === 'inviteOperator') {
        const { error } = await admin.from('platform_admins').upsert({
          id: newUserId, email,
          name: String(body.name || '').trim().slice(0, 160) || email.split('@')[0],
          role: String(body.role || 'support'), active: true,
        })
        if (error) return json({ error: 'Invited, but the operator record failed: ' + error.message }, 500)
      }

      /* Approving an enquiry and creating the account are one act, so the
         enquiry is closed here rather than in a second call the console might
         not make if the first one half-failed. */
      const enquiryId = String(body.enquiryId || '')
      if (enquiryId) {
        await admin.rpc('set_enquiry_state', {
          p_id: enquiryId, p_state: 'converted',
          p_by: staff.name || user.email, p_notes: 'Account created and invitation sent',
        })
      }

      await log({ invite: email, kind: action, record: prepared?.id || null, enquiry: enquiryId || null })
      return json({ ok: true, email, userId: newUserId })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
