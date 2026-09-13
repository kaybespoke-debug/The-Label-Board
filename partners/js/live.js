/* ============================================================
   live.js — the hydrate.

   The portal renders from one object, DB. In demo mode data.js invents it. In
   live mode this file builds the same shape out of the partner's own rows.

   That is the whole design: every page, every helper, every total already works
   against DB and none of them knows or cares where it came from. So the live
   path is one function, not a rewrite, and a bug here cannot change what a page
   shows for a demo partner.

   WHAT KEEPS A PARTNER OUT OF ANOTHER PARTNER'S ROWS is row level security in
   supabase/migrations/20260827090400_partner_portal.sql, not the queries below.
   These selects carry no partner filter on purpose: the database already
   answers with only the signed-in partner's rows, and a filter here would read
   like the protection when it is only a convenience. If RLS were ever dropped,
   adding `partner_id=eq.x` to these would hide the hole rather than close it.
   ============================================================ */

/* PostgREST rows come back snake_case; the portal speaks camelCase. Mapping is
   done explicitly per table rather than by a clever converter, because a silent
   rename is how a total quietly becomes zero. */

async function supaSelect(table, query, token) {
  const r = await supaFetch('/rest/v1/' + table + (query ? '?' + query : ''), { token });
  if (!r.ok || !Array.isArray(r.body)) return null;
  return r.body;
}

const LIVE_TIER_PCT = { bronze: 15, silver: 18, gold: 22, platinum: 25 };

/* The portal wants a plan NAME on a referral for its captions; the database
   stores the plan id. PLANS already exists for the demo and is the same list
   the console bills, so read it rather than keeping a second copy here. */
function livePlanName(id) {
  const p = (typeof PLANS !== 'undefined') && PLANS.find(x => x.id === id);
  return p ? p.name : (id || '');
}

function liveDaysBetween(a, b) {
  return Math.round((parseD(b) - parseD(a)) / DAY);
}

async function buildLiveDB(session) {
  const token = session.token;

  /* One round trip each, in parallel. Five small tables for one partner is a
     few hundred rows at most, so paging would be ceremony. */
  const [links, referrals, ledger, accounts, payouts] = await Promise.all([
    supaSelect('partner_links', 'select=*&order=is_default.desc,created_at.asc', token),
    supaSelect('partner_referrals', 'select=*&order=signed_up_on.desc', token),
    supaSelect('partner_ledger', 'select=*&order=credited_on.desc', token),
    supaSelect('partner_accounts', 'select=*&order=is_primary.desc,added_on.asc', token),
    supaSelect('partner_payouts', 'select=*&order=paid_on.desc', token)
  ]);

  /* A null means the request failed, which is not the same as a partner with no
     referrals yet. Failing loudly here is what stops the portal drawing a
     confident zero over a network error. */
  if (!links || !referrals || !ledger || !accounts || !payouts) return null;

  const L = links.map(l => ({
    id: l.id,
    label: l.label, code: l.code, url: CONFIG.joinUrl + l.code,
    clicks: +l.clicks || 0, active: !!l.active, isDefault: !!l.is_default,
    custom: !l.is_default,
    note: l.is_default
      ? 'Your default link. It goes on your profile and in your email signature.'
      : '',
    createdOn: (l.created_at || '').slice(0, 10),
    signups: 0, converted: 0, earned: 0        // counted from referrals below
  }));

  const R = referrals.map(r => ({
    id: r.id,
    business: r.business_name,
    owner: r.owner_name || '',
    city: r.city || '',
    stage: r.stage,
    linkId: r.link_id,
    plan: r.plan,
    planName: livePlanName(r.plan),
    cycle: r.cycle,
    mrr: +r.mrr || 0,
    firstPayment: +r.first_payment || 0,
    signedUpOn: r.signed_up_on,
    subscribedOn: r.subscribed_on,
    lapsedOn: r.lapsed_on,
    /* The demo carries a countdown because it invents the dates. Here the trial
       length is whatever the studio's own record says, so it is derived rather
       than assumed, and left null unless they really are on trial. */
    trialEndsIn: r.stage === 'trial'
      ? Math.max(0, CONFIG.trialDays - liveDaysBetween(r.signed_up_on, iso(TODAY)))
      : null,
    outlets: +r.outlets || 1,
    staff: +r.staff_count || 0,
    addedBy: r.added_by,
    lastSeen: r.last_seen
  }));

  const byRef = {};
  R.forEach(r => { byRef[r.id] = r; });

  const X = ledger.map(x => {
    const ref = x.referral_id ? byRef[x.referral_id] : null;
    return {
      id: x.id,
      type: x.kind,
      refId: x.referral_id,
      business: ref ? ref.business : null,
      date: x.credited_on,
      clearsOn: x.clears_on,
      rate: +x.rate_pct || 0,
      tier: x.tier || '',
      basis: +x.basis || 0,
      basisLabel: ref && ref.cycle === 'annual' ? 'first year, paid up front'
        : (+x.basis ? 'first month' : ''),
      amount: +x.amount || 0,
      note: x.note || '',
      /* status and payout come from the database here rather than being worked
         out on the device. The demo settles its own ledger because nothing else
         can; live, the books are the books. */
      status: x.status,
      payoutId: x.payout_id,
      payoutRef: null,          // filled in from payouts below
      paidOn: null
    };
  });

  const A = accounts.map(a => ({
    id: a.id, type: 'bank',
    accountName: a.account_name, bankName: a.bank_name, accountNumber: a.account_number,
    primary: !!a.is_primary, verified: !!a.verified, currency: a.currency || 'NGN',
    addedOn: a.added_on, verifiedOn: a.verified_on
  }));

  const P = payouts.map(p => {
    const items = X.filter(x => x.payoutId === p.id);
    items.forEach(x => { x.payoutRef = p.ref; x.paidOn = p.paid_on; });
    return {
      id: p.id, ref: p.ref, paidOn: p.paid_on, amount: +p.amount || 0,
      count: items.length,
      accountId: (A.find(a => a.primary) || A[0] || {}).id || null,
      method: p.method || 'Bank transfer', status: 'paid',
      bankRef: p.bank_ref || '',
      itemIds: items.map(x => x.id)
    };
  });

  /* Per-link counts are derived, never stored twice: a stored count is a count
     that goes stale the first time a referral moves. */
  L.forEach(l => {
    const mine = R.filter(r => r.linkId === l.id);
    l.signups = mine.length;
    l.converted = mine.filter(r => r.subscribedOn).length;
    l.earned = X.filter(x => x.type === 'signup' && mine.some(r => r.id === x.refId))
      .reduce((t, x) => t + x.amount, 0);
  });

  const me = session.me || {};
  return {
    today: TODAY,
    key: session.partnerKey,
    me: {
      id: me.code || session.partnerKey,
      name: me.name || session.name, business: me.business_name || '',
      email: me.email || session.email, phone: me.phone || '', city: me.city || '',
      joined: me.joined_on || '', taxId: me.tax_id || '',
      tier: me.tier || 'bronze',
      isSubscriber: false, ownPlan: null,
      manager: CONFIG.manager || {
        name: 'The Label Board', role: 'Partner team',
        email: 'hello@thelabelboard.com', phone: ''
      }
    },
    plans: (typeof PLANS !== 'undefined') ? PLANS : [],
    tiers: (typeof TIERS !== 'undefined') ? TIERS : [],
    links: L, referrals: R, ledger: X, accounts: A, payouts: P,
    updates: (typeof buildUpdates === 'function') ? buildUpdates() : [],
    settings: {
      baseRatePct: LIVE_TIER_PCT[me.tier] || 15,
      holdDays: HOLD_DAYS,
      payoutDay: PAYOUT_DAY,
      minPayout: MIN_PAYOUT,
      currency: 'NGN',
      readUpdates: [],
      notify: { signup: true, conversion: true, payout: true, news: true, email: true, whatsapp: true }
    }
  };
}
