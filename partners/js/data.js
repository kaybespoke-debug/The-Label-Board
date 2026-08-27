/* ============================================================
   The Label Board — Partner Portal
   data.js — the signed-in partner's data.

   DB is built when someone signs in, not when the file loads, because
   until then we do not know whose data to build. auth.js calls
   loadPartnerData(key) and the whole portal renders off the result.

   In demo mode the three profiles below are generated deterministically
   from a seeded PRNG, so the figures are identical on every reload. In
   live mode the same shapes are filled from Supabase, and nothing above
   this file needs to know which happened.
   ============================================================ */

const TODAY = new Date(2026, 7, 27); // 27 Aug 2026 — "now" for this prototype

/* seeded PRNG so a partner's dataset is identical on every reload */
function mkRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
let rnd = mkRng(1);
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

/* ---------------- the tier ladder ----------------
   Base rate 15%, the figure the admin console publishes. Volume moves you
   along it, and the rate that applies to a referral is the rate you were on
   the day that account started paying, so nothing already earned is ever
   recalculated behind a partner's back. */
const TIERS = [
  { id: 'bronze', name: 'Bronze', min: 0, pct: 15 },
  { id: 'silver', name: 'Silver', min: 5, pct: 18 },
  { id: 'gold', name: 'Gold', min: 15, pct: 22 },
  { id: 'platinum', name: 'Platinum', min: 30, pct: 25 }
];
function tierFor(n) {
  let t = TIERS[0];
  TIERS.forEach(x => { if (n >= x.min) t = x; });
  return t;
}
function nextTier(n) { return TIERS.find(x => n < x.min) || null; }

/* ---------------- the demo directory ----------------
   Three partners rather than one, because a portal with a front door and
   only one person behind it proves nothing. The third has been a partner
   for eleven days and has earned nothing yet, which is the only way to
   see that every empty state in here reads properly.

   In live mode this list is not used at all: Supabase Auth holds the
   logins and app.partner_me() says who signed in. */
const PARTNER_PROFILES = [
  {
    key: 'amaka', seed: 20260825,
    name: 'Amaka Okafor', business: 'Lux Couture', city: 'Lagos',
    email: 'amaka@luxcouture.com', phone: '+234 803 411 2290',
    code: 'AMAKA', joined: '2024-11-03', taxId: '31459872-0044',
    isSubscriber: true, ownPlan: 'Premium',
    mix: [
      { stage: 'subscribed', n: 24 }, { stage: 'lapsed', n: 5 },
      { stage: 'trial', n: 6 }, { stage: 'signed-up', n: 9 }
    ],
    links: [
      ['Main link', 'AMAKA', 470, true, true],
      ['Instagram bio', 'AMAKA-IG', 320, true, false],
      ['WhatsApp broadcast', 'AMAKA-WA', 240, true, false],
      ['Lagos Fashion Week', 'AMAKA-LFW', 130, true, false],
      ['Newsletter', 'AMAKA-NL', 90, false, false]
    ],
    accounts: [
      ['Amaka Okafor', 'Guaranty Trust Bank', '0148820371', true, true, '2024-11-05'],
      ['Lux Couture Ltd', 'Kuda Microfinance Bank', '2009114466', false, true, '2025-06-19']
    ]
  },
  {
    key: 'tomi', seed: 77014402,
    name: 'Tomi Adeyinka', business: 'Thread & Needle', city: 'Abuja',
    email: 'tomi@threadandneedle.com', phone: '+234 806 220 7741',
    code: 'TOMI', joined: '2025-09-14', taxId: '31459872-0071',
    isSubscriber: true, ownPlan: 'Pro',
    mix: [
      { stage: 'subscribed', n: 7 }, { stage: 'lapsed', n: 1 },
      { stage: 'trial', n: 3 }, { stage: 'signed-up', n: 4 }
    ],
    links: [
      ['Main link', 'TOMI', 118, true, true],
      ['WhatsApp groups', 'TOMI-WA', 76, true, false]
    ],
    accounts: [
      ['Tomi Adeyinka', 'Access Bank', '0771204488', true, true, '2025-09-16']
    ]
  },
  {
    key: 'femi', seed: 51120933,
    name: 'Femi Balogun', business: 'Cut & Sew Lagos', city: 'Lagos',
    email: 'femi@cutandsewlagos.com', phone: '+234 701 559 3320',
    code: 'FEMI', joined: iso(dAgo(11)), taxId: null,
    isSubscriber: false, ownPlan: null,
    /* Eleven days in. Two people have signed up, neither has paid, so
       there is no ledger, no payout and no bank account on file. Every
       empty state in the portal is on this partner's screen. */
    mix: [{ stage: 'trial', n: 1 }, { stage: 'signed-up', n: 1 }],
    links: [['Main link', 'FEMI', 9, true, true]],
    accounts: []
  }
];
const profileByKey = k => PARTNER_PROFILES.find(p => p.key === k);
const profileByEmail = e =>
  PARTNER_PROFILES.find(p => p.email.toLowerCase() === String(e || '').trim().toLowerCase());

/* ---------------- referred businesses ---------------- */
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

function buildLinks(profile) {
  return profile.links.map((l, i) => ({
    id: i + 1,
    label: l[0], code: l[1], url: CONFIG.joinUrl + l[1],
    clicks: l[2], active: l[3], isDefault: l[4],
    custom: false,
    note: l[4] ? 'Your default link. It goes on your profile and in your email signature.'
      : 'Made when you started sharing on ' + l[0].toLowerCase() + '.',
    createdOn: iso(dAgo(l[4] ? 660 : int(90, 520)))
  }));
}

function buildReferrals(profile, links) {
  const out = [];
  const used = new Set();
  let id = 1;
  const tenure = Math.round((TODAY - parseD(profile.joined)) / DAY);

  profile.mix.forEach(block => {
    for (let i = 0; i < block.n; i++) {
      let name, guard = 0;
      do { name = pick(BIZ_A) + ' ' + pick(BIZ_B); guard++; } while (used.has(name) && guard < 60);
      if (used.has(name)) name = name + ' ' + id;
      used.add(name);

      const converted = block.stage === 'subscribed' || block.stage === 'lapsed';

      /* Dates are anchored on the day that matters and worked backwards,
         never forwards. Deriving the conversion from the signup pushed a
         handful of accounts past today, which is how you end up telling a
         partner an account will stop paying next October.

         maxAgo is the hard ceiling: nobody can have been referred before the
         day this person became a partner. Without it a partner eleven days
         old had signups from a month before they joined, which is the sort
         of thing that reads as a bug in the money rather than in a date. */
      const maxAgo = Math.max(1, tenure);
      const maxConv = Math.max(1, maxAgo - 21);   // leave room for the trial before it
      let convAgo = null, signupAgo;
      if (block.stage === 'lapsed') convAgo = int(Math.min(200, maxConv), maxConv);
      else if (block.stage === 'subscribed') {
        convAgo = i < 3 ? int(2, Math.min(26, maxConv)) : int(Math.min(30, maxConv), maxConv);
      }
      if (converted) signupAgo = Math.min(maxAgo, convAgo + int(5, 21));
      else signupAgo = Math.min(maxAgo, block.stage === 'trial' ? int(1, 13) : int(2, 150));

      const signedUpOn = dAgo(signupAgo);
      const subscribedOn = converted ? dAgo(convAgo) : null;
      /* Stopped at least a fortnight ago, after at least two months of paying. */
      const lapsedOn = block.stage === 'lapsed' ? dAgo(int(15, Math.max(16, convAgo - 60))) : null;

      const planId = converted ? (rnd() < 0.42 ? 'premium' : rnd() < 0.6 ? 'pro' : 'starter') : 'trial';
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
        mrr: converted && block.stage !== 'lapsed'
          ? (cycle === 'annual' ? Math.round(plan.annual / 12) : plan.monthly) : 0,
        firstPayment: converted ? (cycle === 'annual' ? plan.annual : plan.monthly) : 0,
        signedUpOn: iso(signedUpOn),
        subscribedOn: converted ? iso(subscribedOn) : null,
        lapsedOn: lapsedOn ? iso(lapsedOn) : null,
        trialEndsIn: block.stage === 'trial' ? 14 - signupAgo : null,
        outlets: converted ? int(1, planId === 'premium' ? 4 : 2) : 1,
        staff: converted ? int(2, 14) : int(1, 3),
        /* Some accounts a partner sets up at their table, others follow the
           link on their own. The ones they set up convert far better, and
           that is a fact a partner can act on. */
        addedBy: converted && rnd() < 0.3 ? 'partner' : 'self',
        lastSeen: iso(dAgo(block.stage === 'lapsed' ? int(30, 200) : int(0, 11)))
      });
    }
  });

  return out.sort((a, b) => b.signedUpOn.localeCompare(a.signedUpOn));
}

/* ---------------- the earnings ledger ---------------- */
const HOLD_DAYS = 31;
const PAYOUT_DAY = 5;   // payouts run on the 5th of each month

/* The minimum a run has to reach before it is worth a transfer. It came down
   from 25,000 to 10,000 earlier this year, and the history has to reflect
   that or the announcement about it is a lie. */
const MIN_PAYOUT = 10000;
const MIN_PAYOUT_BEFORE = 25000;
const THRESHOLD_CHANGED_ON = iso(dAgo(75));
function minPayoutOn(runDate) { return iso(runDate) >= THRESHOLD_CHANGED_ON ? MIN_PAYOUT : MIN_PAYOUT_BEFORE; }

function payoutRef(d) {
  const x = parseD(d);
  return 'PO-' + x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0');
}
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
      id: id++, type: 'signup', refId: r.id, business: r.business,
      date: r.subscribedOn, clearsOn,
      rate: tier.pct, tier: tier.name,
      basis: r.firstPayment,
      basisLabel: r.cycle === 'annual' ? 'first year, paid up front' : 'first month',
      amount: Math.round(r.firstPayment * tier.pct / 100),
      note: r.planName + ' · ' + tier.pct + '% of ' + money(r.firstPayment)
    });

    const n = i + 1;
    if (MILESTONES[n]) {
      rows.push({
        id: id++, type: 'bonus', refId: r.id, business: null,
        date: r.subscribedOn, clearsOn,
        rate: 0, tier: tier.name, basis: 0, basisLabel: '',
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
   month; anything short of it rolls into the next run rather than going out
   as a transfer worth less than the fee. This is the only place a row's
   status is decided, and the payouts fall out of the same pass, so a
   statement cannot disagree with the ledger that produced it. */
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

function buildAccounts(profile) {
  return profile.accounts.map((a, i) => ({
    id: i + 1, type: 'bank',
    accountName: a[0], bankName: a[1], accountNumber: a[2],
    primary: a[3], verified: a[4], currency: 'NGN',
    addedOn: a[5], verifiedOn: a[4] ? a[5] : null
  }));
}

/* Dressing for what settle() already worked out. Newest first, because that
   is the one a partner is looking for. */
function buildPayouts(runs, accounts) {
  const acct = accounts.find(a => a.primary) || accounts[0];
  return runs.slice().reverse().map(r => ({
    ref: r.ref, paidOn: r.paidOn, amount: r.amount, count: r.items.length,
    accountId: acct ? acct.id : null,
    method: 'Bank transfer', status: 'paid',
    bankRef: 'TLB' + r.ref.replace(/-/g, '') + '/' + String(r.items.length).padStart(2, '0'),
    itemIds: r.items.map(x => x.id)
  }));
}

/* ---------------- news, the same for every partner ---------------- */
function buildUpdates() {
  const seed = [
    ['Gold partners now earn 22%', 'programme', -6,
      'From this month Gold partners earn 22% of every first payment, up from 20%. The new rate applies to accounts that start paying from 1 August onward. Nothing you have already earned changes.'],
    ['August payouts landed on the 5th', 'payouts', -22,
      'Every cleared commission went out on schedule. If your bank has not shown it yet, give it one working day before raising a ticket, and check that the account marked primary is the one you expect.'],
    ['Co-branded launch kit for Gold and above', 'programme', -33,
      'Posters, an Instagram carousel and a one-page explainer, all carrying your name and your code. Ask your partner manager and they will send the pack over.'],
    ['Concierge is live for Premium studios', 'product', -46,
      'Premium accounts can now take measurements and style briefs through a guided panel that hands off to WhatsApp. It is the strongest reason a bigger studio moves up a plan, so it is worth leading with when you pitch.'],
    ['The production board now works without signal', 'product', -60,
      'The board keeps working offline and syncs once the connection is back. Useful for anyone who has told you their workshop has no reception.'],
    ['Payout threshold dropped to 10,000', 'payouts', -75,
      'You no longer need to reach 25,000 before a payout runs. Anything cleared above 10,000 goes out on the 5th.'],
    ['Lagos Fashion Week stand, October', 'event', 39,
      'We are taking a stand again this year. Partners get two passes and a slot at the table if you want to bring people by. Reply to your partner manager to claim yours.'],
    ['Referral links now carry campaign names', 'product', -98,
      'Make as many links as you like and give each one a name, so you can see whether Instagram or WhatsApp is doing the work.']
  ];
  return seed.map((u, i) => ({
    id: i + 1, title: u[0], category: u[1], date: iso(dAgo(-u[2])), body: u[3],
    upcoming: u[2] > 0
  })).sort((a, b) => b.date.localeCompare(a.date));
}

/* ---------------- assemble one partner ---------------- */
let DB = null;

function buildDB(profile) {
  rnd = mkRng(profile.seed);          // reseed, so each partner is stable on its own

  const links = buildLinks(profile);
  const referrals = buildReferrals(profile, links);
  const ledger = buildLedger(referrals);
  const accounts = buildAccounts(profile);
  const payouts = buildPayouts(settle(ledger), accounts);

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
    key: profile.key,
    me: {
      id: 'P-' + String(1000 + profile.seed % 9000).slice(0, 4),
      name: profile.name, business: profile.business,
      email: profile.email, phone: profile.phone, city: profile.city,
      joined: profile.joined, taxId: profile.taxId,
      isSubscriber: profile.isSubscriber, ownPlan: profile.ownPlan,
      manager: { name: 'Bisi Adeyemi', role: 'Partner Manager',
        email: 'partners@thelabelboard.com', phone: '+234 701 220 8845' }
    },
    plans: PLANS,
    tiers: TIERS,
    links, referrals, ledger, accounts, payouts,
    updates: buildUpdates(),
    settings: {
      baseRatePct: 15,
      holdDays: HOLD_DAYS,
      payoutDay: PAYOUT_DAY,
      minPayout: MIN_PAYOUT,
      currency: 'NGN',
      readUpdates: [],
      notify: { signup: true, conversion: true, payout: true, news: true, email: true, whatsapp: true }
    }
  };
}

/* ---------------- load, and restore what this browser changed ----------------
   Storage is keyed per partner. Without that, signing out of one account and
   into another on the same phone would show the first partner's extra links
   and payout accounts under the second partner's name. */
function storeKey(key, what) { return 'tlb_partner_' + key + '_' + what; }

function loadPartnerData(key) {
  const profile = profileByKey(key);
  if (!profile) return false;
  DB = buildDB(profile);

  try {
    const s = JSON.parse(localStorage.getItem(storeKey(key, 'settings')) || 'null');
    if (s) Object.assign(DB.settings, s);
    const l = JSON.parse(localStorage.getItem(storeKey(key, 'links')) || 'null');
    if (Array.isArray(l)) l.forEach(x => { if (!DB.links.some(y => y.code === x.code)) DB.links.push(x); });
    const a = JSON.parse(localStorage.getItem(storeKey(key, 'accounts')) || 'null');
    if (Array.isArray(a)) DB.accounts = a;
  } catch (e) { /* a broken value in storage must never stop the portal loading */ }

  return true;
}

function saveSettings() {
  try { localStorage.setItem(storeKey(DB.key, 'settings'), JSON.stringify(DB.settings)); } catch (e) {}
}
function saveLinks() {
  try { localStorage.setItem(storeKey(DB.key, 'links'), JSON.stringify(DB.links.filter(l => l.custom))); } catch (e) {}
}
function saveAccounts() {
  try { localStorage.setItem(storeKey(DB.key, 'accounts'), JSON.stringify(DB.accounts)); } catch (e) {}
}
function clearPartnerStorage(key) {
  try { ['settings', 'links', 'accounts'].forEach(w => localStorage.removeItem(storeKey(key, w))); } catch (e) {}
}
