/* ============================================================
   The Label Board — Partner Portal
   data.js — deterministic dataset for one signed-in partner.
   Every figure in the UI is DERIVED from here, so the dashboard,
   the ledger and the payout statements cannot disagree.

   Wiring this to Supabase later means replacing buildDB() with a
   fetch. Nothing above this file knows where the numbers came from.
   ============================================================ */

const TODAY = new Date(2026, 7, 25); // 25 Aug 2026 — "now" for this prototype

/* seeded PRNG so the dataset is identical on every reload */
function mkRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rnd = mkRng(20260825);
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

/* ---------------- helpers (same shapes as the admin console) ---------------- */
const DAY = 86400000;
function dAgo(n) { return new Date(TODAY.getTime() - n * DAY); }

/* Local-time date handling. A bare "YYYY-MM-DD" must mean local midnight, not
   UTC midnight, or every comparison against a local day boundary slips by a day. */
function parseD(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const p = v.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  return new Date(v);
}
function iso(d) {
  const x = parseD(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
function fmtD(d) { return parseD(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtDShort(d) { return parseD(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function fmtMonth(d) { return parseD(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); }
function ago(d) {
  const ms = TODAY - parseD(d);
  if (ms < 0) {
    const fd = Math.round(-ms / DAY);
    if (fd === 0) return 'today';
    if (fd === 1) return 'tomorrow';
    if (fd < 30) return 'in ' + fd + ' days';
    return fmtD(d);
  }
  const dd = Math.floor(ms / DAY);
  if (dd === 0) return 'today';
  if (dd === 1) return 'yesterday';
  if (dd < 30) return dd + ' days ago';
  if (dd < 60) return 'last month';
  if (dd < 365) return Math.round(dd / 30) + ' months ago';
  return fmtD(d);
}
function money(n) { return '₦' + Math.round(n).toLocaleString('en-NG'); }
function moneyShort(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return '₦' + (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
  if (a >= 1e6) return '₦' + (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  if (a >= 1e3) return '₦' + Math.round(n / 1e3) + 'K';
  return '₦' + Math.round(n);
}
function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; }
function initials(s) {
  return s.split(/\s+/).filter(w => /[A-Za-z]/.test(w[0])).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* ---------------- plan catalogue (mirrors the admin console) ---------------- */
const PLANS = [
  { id: 'starter', name: 'Starter', monthly: 29000, annual: 290000, seats: 3 },
  { id: 'pro', name: 'Pro', monthly: 49000, annual: 490000, seats: 10 },
  { id: 'premium', name: 'Premium', monthly: 79000, annual: 790000, seats: 30 },
  { id: 'trial', name: 'Trial', monthly: 0, annual: 0, seats: 3 }
];
const planById = id => PLANS.find(p => p.id === id);

/* ---------------- the partner tier ladder ----------------
   The base rate is 15%, the same figure the admin console publishes. Volume
   moves you up the ladder, and the rate that applies to a referral is the rate
   you were on the day that account started paying, so nothing already earned
   is ever recalculated behind a partner's back. */
const TIERS = [
  { id: 'bronze', name: 'Bronze', min: 0, pct: 15,
    perks: ['15% of every first payment', 'Unlimited referral links', 'Monthly payouts'] },
  { id: 'silver', name: 'Silver', min: 5, pct: 18,
    perks: ['18% of every first payment', 'Priority support queue', 'Early access to new features'] },
  { id: 'gold', name: 'Gold', min: 15, pct: 22,
    perks: ['22% of every first payment', 'A named partner manager', 'Co-branded launch assets'] },
  { id: 'platinum', name: 'Platinum', min: 30, pct: 25,
    perks: ['25% of every first payment', 'Payouts twice a month', 'Revenue share on enterprise deals'] }
];
/* the tier you are on once n accounts have converted */
function tierFor(n) {
  let t = TIERS[0];
  TIERS.forEach(x => { if (n >= x.min) t = x; });
  return t;
}
function nextTier(n) { return TIERS.find(x => n < x.min) || null; }

/* ---------------- the signed-in partner ---------------- */
const ME = {
  id: 'P-0042',
  name: 'Amaka Okafor',
  business: 'Lux Couture',
  email: 'amaka@luxcouture.com',
  phone: '+234 803 411 2290',
  city: 'Lagos',
  joined: '2024-11-03',
  /* Partners are usually subscribers who liked the product enough to sell it.
     A partner who is not a subscriber works exactly the same way; this flag
     only controls whether we show the "your own subscription" line. */
  isSubscriber: true,
  ownPlan: 'Premium',
  manager: { name: 'Bisi Adeyemi', role: 'Partner Manager', email: 'partners@thelabelboard.com', phone: '+234 701 220 8845' },
  taxId: '31459872-0044'
};

/* ---------------- referral links ----------------
   One default link that cannot be deleted, plus a link per campaign so a
   partner can tell which channel is actually doing the work. */
const BASE_URL = 'https://thelabelboard.com/join/';
const LINK_SEED = [
  ['Main link', 'AMAKA', 470, true, 'Your default link. It goes on your profile and in your email signature.'],
  ['Instagram bio', 'AMAKA-IG', 320, true, 'Link in bio, swapped in whenever you post a fitting.'],
  ['WhatsApp broadcast', 'AMAKA-WA', 240, true, 'Sent round your tailor groups.'],
  ['Lagos Fashion Week', 'AMAKA-LFW', 130, true, 'Printed on the cards you handed out at the stand.'],
  ['Newsletter', 'AMAKA-NL', 90, false, 'Paused while the newsletter is on a break.']
];

/* ---------------- referred businesses ----------------
   Stages a referral moves through:
     signed-up   account created with your code, never really started
     trial       inside the free trial, no money yet
     subscribed  paying, and earning you commission
     lapsed      paid at least once, then stopped
   Only "subscribed" and "lapsed" ever earned commission, because commission is
   a share of a real first payment. */
const BIZ_A = ['Stella', 'Desert Rose', 'Thread', 'Regal', 'Velvet', 'Golden', 'Ivory', 'Sable', 'Crown', 'Zuri',
  'Amara', 'Nala', 'Obi', 'Bespoke', 'Atelier', 'Maison', 'Silk', 'Indigo', 'Adire', 'Aso', 'Kente', 'Weaver',
  'The Cutting', 'House of', 'Artisan', 'Ada', 'Kofi', 'Tiwa', 'Studio', 'Palm'];
const BIZ_B = ['Couture', 'Studio', 'Designs', 'Atelier', 'Threads', 'Tailors', 'Fashion House', 'Bespoke',
  'Garments', 'Collective', 'Workroom', 'Label', 'Sartoria', 'Stitches', 'Room', 'Craft', 'Menswear', 'Bridal'];
const FIRST = ['Tomi', 'Zainab', 'Ahmed', 'Chidi', 'Ngozi', 'Bisi', 'Seyi', 'Idara', 'Femi', 'Funmi', 'Kemi',
  'Yusuf', 'Halima', 'Emeka', 'Folake', 'Segun', 'Aisha', 'Uche', 'Dare', 'Nneka', 'Musa', 'Tunde', 'Grace',
  'Ifeoma', 'Bola', 'Sadiq', 'Adaeze', 'Kunle', 'Rita', 'Peter'];
const LAST = ['Okafor', 'Adeyemi', 'Musa', 'Okonkwo', 'Hassan', 'Eze', 'Bello', 'Adeyinka', 'Balogun', 'Umah',
  'Adebayo', 'Oladele', 'Ibrahim', 'Nwosu', 'Lawal', 'Obi', 'Sanni', 'Akande', 'Yakubu', 'Chukwu'];
const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Enugu', 'Benin City', 'Uyo', 'Kaduna', 'Accra'];

/* how many referrals sit in each stage — these sum to 44 */
const STAGE_MIX = [
  { stage: 'subscribed', n: 24 },
  { stage: 'lapsed', n: 5 },
  { stage: 'trial', n: 6 },
  { stage: 'signed-up', n: 9 }
];

function buildReferrals(links) {
  const out = [];
  const used = new Set();
  let id = 1;

  STAGE_MIX.forEach(block => {
    for (let i = 0; i < block.n; i++) {
      let name, guard = 0;
      do { name = pick(BIZ_A) + ' ' + pick(BIZ_B); guard++; } while (used.has(name) && guard < 60);
      if (used.has(name)) name = name + ' ' + id;
      used.add(name);

      const converted = block.stage === 'subscribed' || block.stage === 'lapsed';

      /* Dates are anchored on the day that matters and worked backwards, never
         forwards. Deriving the conversion from the signup pushed a handful of
         accounts past today, which is how you end up telling a partner an
         account will stop paying next October. Paying accounts skew older so
         the earnings chart has real history rather than a spike at the edge,
         with a few recent ones so the current month is never empty. */
      let convAgo = null, signupAgo;
      if (block.stage === 'lapsed') convAgo = int(200, 600);
      else if (block.stage === 'subscribed') convAgo = i < 3 ? int(2, 26) : int(30, 620);
      if (converted) signupAgo = convAgo + int(5, 21);        // they paid after a trial, not before one
      else signupAgo = block.stage === 'trial' ? int(1, 13) : int(2, 150);

      const signedUpOn = dAgo(signupAgo);
      const subscribedOn = converted ? dAgo(convAgo) : null;
      /* Stopped at least a fortnight ago, after at least two months of paying. */
      const lapsedOn = block.stage === 'lapsed' ? dAgo(int(15, convAgo - 60)) : null;

      const planId = block.stage === 'trial' || block.stage === 'signed-up'
        ? 'trial'
        : (rnd() < 0.42 ? 'premium' : rnd() < 0.6 ? 'pro' : 'starter');
      const plan = planById(planId);
      const cycle = planId === 'trial' ? 'trial' : (rnd() < 0.24 ? 'annual' : 'monthly');

      out.push({
        id: id++,
        business: name,
        owner: pick(FIRST) + ' ' + pick(LAST),
        city: pick(CITIES),
        stage: block.stage,
        linkId: pick(links).id,
        plan: planId,
        planName: plan.name,
        cycle,
        /* what they pay us each month, so a partner can see the weight of the
           account they brought in */
        mrr: converted && block.stage !== 'lapsed'
          ? (cycle === 'annual' ? Math.round(plan.annual / 12) : plan.monthly) : 0,
        /* the first real payment, which is what commission is a share of */
        firstPayment: converted ? (cycle === 'annual' ? plan.annual : plan.monthly) : 0,
        signedUpOn: iso(signedUpOn),
        subscribedOn: converted ? iso(subscribedOn) : null,
        lapsedOn: lapsedOn ? iso(lapsedOn) : null,
        trialEndsIn: block.stage === 'trial' ? 14 - signupAgo : null,
        outlets: converted ? int(1, planId === 'premium' ? 4 : 2) : 1,
        staff: converted ? int(2, 14) : int(1, 3),
        /* Some accounts you set up yourself at their table, others followed the
           link on their own. Worth separating: the ones you set up convert far
           better, and that is a fact a partner can act on. */
        addedBy: converted && rnd() < 0.3 ? 'partner' : 'self',
        lastSeen: iso(dAgo(block.stage === 'lapsed' ? int(30, 200) : int(0, 11)))
      });
    }
  });

  return out.sort((a, b) => b.signedUpOn.localeCompare(a.signedUpOn));
}

/* ---------------- links ---------------- */
function buildLinks() {
  return LINK_SEED.map((l, i) => ({
    id: i + 1,
    label: l[0],
    code: l[1],
    url: BASE_URL + l[1],
    clicks: l[2],
    active: l[3],
    note: l[4],
    isDefault: i === 0,
    custom: false,
    createdOn: iso(dAgo(i === 0 ? 660 : int(90, 520)))
  }));
}

/* ---------------- the earnings ledger ----------------
   One row per thing that earned money, built from the referrals, so the ledger
   can never claim a commission that no referral supports.

   Status:
     pending  inside the 31 day hold after that account's first payment
     cleared  out of the hold, waiting for the next payout run
     paid     swept up by a payout that has landed
*/
const HOLD_DAYS = 31;
const PAYOUT_DAY = 5;   // payouts run on the 5th of each month

/* The minimum a run has to reach before it is worth a transfer. It came down
   from 25,000 to 10,000 earlier this year, and the history has to reflect that
   or the announcement about it is a lie. */
const MIN_PAYOUT = 10000;
const MIN_PAYOUT_BEFORE = 25000;
const THRESHOLD_CHANGED_ON = iso(dAgo(75));
function minPayoutOn(runDate) { return iso(runDate) >= THRESHOLD_CHANGED_ON ? MIN_PAYOUT : MIN_PAYOUT_BEFORE; }

function payoutRef(d) {
  const x = parseD(d);
  return 'PO-' + x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0');
}
/* the first run on or after a date */
function payoutDateFor(clearedOn) {
  const d = parseD(clearedOn);
  let run = new Date(d.getFullYear(), d.getMonth(), PAYOUT_DAY);
  if (d > run) run = new Date(d.getFullYear(), d.getMonth() + 1, PAYOUT_DAY);
  return run;
}

const MILESTONES = { 5: 25000, 10: 50000, 20: 100000, 30: 150000 };

function buildLedger(referrals) {
  const rows = [];
  let id = 1;

  /* Commission uses the rate the partner was on when that account started
     paying, so we walk conversions in the order they actually happened. */
  const converted = referrals.filter(r => r.subscribedOn)
    .slice().sort((a, b) => a.subscribedOn.localeCompare(b.subscribedOn));

  converted.forEach((r, i) => {
    const tier = tierFor(i);              // i accounts had converted before this one
    const clearsOn = iso(new Date(parseD(r.subscribedOn).getTime() + HOLD_DAYS * DAY));
    rows.push({
      id: id++,
      type: 'signup',
      refId: r.id,
      business: r.business,
      date: r.subscribedOn,
      clearsOn,
      rate: tier.pct,
      tier: tier.name,
      basis: r.firstPayment,
      basisLabel: r.cycle === 'annual' ? 'first year, paid up front' : 'first month',
      amount: Math.round(r.firstPayment * tier.pct / 100),
      note: r.planName + ' · ' + tier.pct + '% of ' + money(r.firstPayment)
    });

    /* Milestone bonuses, credited the day the milestone was hit. */
    const n = i + 1;
    if (MILESTONES[n]) {
      rows.push({
        id: id++,
        type: 'bonus',
        refId: r.id,
        business: null,
        date: r.subscribedOn,
        clearsOn,
        rate: 0,
        tier: tier.name,
        basis: 0,
        basisLabel: '',
        amount: MILESTONES[n],
        note: n + ' paying accounts referred · milestone bonus'
      });
    }
  });

  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

/* ---------------- settlement ----------------
   Walks the payout calendar forward from the first commission that cleared.
   A run only happens when what is waiting reaches the minimum in force that
   month; anything short of it rolls into the next run rather than going out as
   a transfer worth less than the fee. This is the only place a row's status is
   decided, and the payouts fall out of the same pass, so a statement cannot
   disagree with the ledger that produced it. */
function settle(rows) {
  rows.forEach(r => { r.status = 'pending'; r.payoutRef = null; r.paidOn = null; });

  const cleared = rows.filter(r => parseD(r.clearsOn) <= TODAY)
    .sort((a, b) => a.clearsOn.localeCompare(b.clearsOn));
  cleared.forEach(r => { r.status = 'cleared'; });
  if (!cleared.length) return [];

  const runs = [];
  let run = payoutDateFor(cleared[0].clearsOn);
  let waiting = [];
  let i = 0;

  while (run <= TODAY) {
    while (i < cleared.length && parseD(cleared[i].clearsOn) <= run) waiting.push(cleared[i++]);
    const total = waiting.reduce((t, r) => t + r.amount, 0);
    if (waiting.length && total >= minPayoutOn(run)) {
      const ref = payoutRef(run), paidOn = iso(run);
      waiting.forEach(r => { r.status = 'paid'; r.payoutRef = ref; r.paidOn = paidOn; });
      runs.push({ ref, paidOn, amount: total, items: waiting.slice() });
      waiting = [];
    }
    run = new Date(run.getFullYear(), run.getMonth() + 1, PAYOUT_DAY);
  }
  return runs;
}

/* ---------------- payout accounts ---------------- */
function buildAccounts() {
  return [
    { id: 1, type: 'bank', primary: true, verified: true,
      accountName: 'Amaka Okafor', bankName: 'Guaranty Trust Bank',
      accountNumber: '0148820371', currency: 'NGN',
      addedOn: '2024-11-05', verifiedOn: '2024-11-06' },
    { id: 2, type: 'bank', primary: false, verified: true,
      accountName: 'Lux Couture Ltd', bankName: 'Kuda Microfinance Bank',
      accountNumber: '2009114466', currency: 'NGN',
      addedOn: '2025-06-19', verifiedOn: '2025-06-19' }
  ];
}

/* ---------------- payouts ----------------
   Dressing for what settle() already worked out. Newest first, because that is
   the one a partner is looking for. */
function buildPayouts(runs, accounts) {
  const acct = accounts.find(a => a.primary) || accounts[0];
  return runs.slice().reverse().map(r => ({
    ref: r.ref,
    paidOn: r.paidOn,
    amount: r.amount,
    count: r.items.length,
    accountId: acct ? acct.id : null,
    method: 'Bank transfer',
    status: 'paid',
    /* the reference the bank puts on the partner's statement */
    bankRef: 'TLB' + r.ref.replace(/-/g, '') + '/' + String(r.items.length).padStart(2, '0'),
    itemIds: r.items.map(x => x.id)
  }));
}

/* ---------------- news and updates ---------------- */
function buildUpdates() {
  const seed = [
    ['Gold partners now earn 22%', 'programme', -6, true,
      'From this month Gold partners earn 22% of every first payment, up from 20%. The new rate applies to accounts that start paying from 1 August onward. Nothing you have already earned changes.'],
    ['August payouts landed on the 5th', 'payouts', -20, false,
      'Every cleared commission went out on schedule. If your bank has not shown it yet, give it one working day before raising a ticket, and check that the account marked primary is the one you expect.'],
    ['Co-branded launch kit for Gold and above', 'programme', -31, false,
      'Posters, an Instagram carousel and a one-page explainer, all carrying your name and your code. Ask your partner manager and they will send the pack over.'],
    ['Concierge is live for Premium studios', 'product', -44, false,
      'Premium accounts can now take measurements and style briefs through a guided panel that hands off to WhatsApp. It is the strongest reason a bigger studio moves up a plan, so it is worth leading with when you pitch.'],
    ['The production board now works without signal', 'product', -58, false,
      'The board keeps working offline and syncs once the connection is back. Useful for anyone who has told you their workshop has no reception.'],
    ['Payout threshold dropped to 10,000', 'payouts', -75, false,
      'You no longer need to reach 25,000 before a payout runs. Anything cleared above 10,000 goes out on the 5th.'],
    ['Lagos Fashion Week stand, October', 'event', 41, false,
      'We are taking a stand again this year. Partners get two passes and a slot at the table if you want to bring people by. Reply to your partner manager to claim yours.'],
    ['Referral links now carry campaign names', 'product', -96, false,
      'Make as many links as you like and give each one a name, so you can see whether Instagram or WhatsApp is doing the work.']
  ];
  return seed.map((u, i) => ({
    id: i + 1,
    title: u[0],
    category: u[1],
    date: iso(dAgo(-u[2])),
    pinned: u[3],
    body: u[4],
    upcoming: u[2] > 0
  })).sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));
}

/* ---------------- assemble ---------------- */
const DB = (function buildDB() {
  const links = buildLinks();
  const referrals = buildReferrals(links);
  const ledger = buildLedger(referrals);
  const accounts = buildAccounts();
  const payouts = buildPayouts(settle(ledger), accounts);
  const updates = buildUpdates();

  /* Signups per link are counted from the referrals, never stored twice. */
  links.forEach(l => {
    const mine = referrals.filter(r => r.linkId === l.id);
    l.signups = mine.length;
    l.converted = mine.filter(r => r.subscribedOn).length;
    l.earned = ledger.filter(x => x.type === 'signup' && mine.some(r => r.id === x.refId))
      .reduce((t, x) => t + x.amount, 0);
  });

  return {
    today: TODAY,
    me: ME,
    plans: PLANS,
    tiers: TIERS,
    links, referrals, ledger, accounts, payouts, updates,
    settings: {
      baseRatePct: 15,
      holdDays: HOLD_DAYS,
      payoutDay: PAYOUT_DAY,
      minPayout: MIN_PAYOUT,
      autoPayout: true,
      currency: 'NGN',
      readUpdates: [],
      notify: {
        signup: true,      // somebody used your link
        conversion: true,  // they started paying
        payout: true,      // money left our account
        news: true,        // programme and product updates
        email: true,
        whatsapp: true
      }
    }
  };
})();

/* ---------------- restore anything this browser changed ---------------- */
(function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('tlb_partner_settings') || 'null');
    if (s) Object.assign(DB.settings, s);
    const l = JSON.parse(localStorage.getItem('tlb_partner_links') || 'null');
    if (Array.isArray(l)) {
      /* Only the extra links made in this browser come back. The seeded five
         keep their generated click counts. */
      l.forEach(x => { if (!DB.links.some(y => y.code === x.code)) DB.links.push(x); });
    }
    const a = JSON.parse(localStorage.getItem('tlb_partner_accounts') || 'null');
    if (Array.isArray(a) && a.length) DB.accounts = a;
  } catch (e) { /* a broken value in storage must never stop the portal loading */ }
})();

function saveSettings() { try { localStorage.setItem('tlb_partner_settings', JSON.stringify(DB.settings)); } catch (e) {} }
function saveLinks() { try { localStorage.setItem('tlb_partner_links', JSON.stringify(DB.links.filter(l => l.custom))); } catch (e) {} }
function saveAccounts() { try { localStorage.setItem('tlb_partner_accounts', JSON.stringify(DB.accounts)); } catch (e) {} }
