/* ============================================================
   The Label Board — Admin Control Centre
   data.js — deterministic dataset. Every figure shown in the UI
   is DERIVED from here, so no two screens can disagree.
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

/* ---------------- helpers ---------------- */
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
function fmtD(d) {
  return parseD(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDShort(d) {
  return parseD(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function ago(d) {
  const ms = TODAY - parseD(d);
  if (ms < 0) {
    const fm = Math.round(-ms / 60000), fh = Math.round(fm / 60), fd = Math.round(fh / 24);
    if (fm < 60) return 'in ' + fm + 'm';
    if (fh < 24) return 'in ' + fh + 'h';
    if (fd === 1) return 'tomorrow';
    return 'in ' + fd + 'd';
  }
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), dd = Math.floor(h / 24);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  if (h < 24) return h + 'h ago';
  if (dd === 1) return 'yesterday';
  if (dd < 30) return dd + 'd ago';
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

/* ---------------- plan catalogue ---------------- */
const PLANS = [
  { id: 'starter', name: 'Starter', monthly: 29000, annual: 290000, seats: 3, live: true,
    features: ['1 outlet', '3 team seats', 'Orders & production board', 'Basic reports'] },
  { id: 'pro', name: 'Pro', monthly: 49000, annual: 490000, seats: 10, live: true,
    features: ['3 outlets', '10 team seats', 'Inventory & suppliers', 'Payroll & attendance', 'Full reports'] },
  { id: 'premium', name: 'Premium', monthly: 79000, annual: 790000, seats: 30, live: true,
    features: ['Unlimited outlets', '30 team seats', 'Everything in Pro', 'Concierge & storefront', 'Priority support'] },
  { id: 'trial', name: 'Trial', monthly: 0, annual: 0, seats: 3, live: true,
    features: ['14 days', 'Full Pro features', 'No card required'] }
];
const planById = id => PLANS.find(p => p.id === id);

/* ---------------- subscriber generation ---------------- */
const BIZ_A = ['Lux', 'Weaver', 'Desert Rose', 'Stella', 'Artisan', 'House of', 'Ada', 'Thread', 'Regal', 'Velvet',
  'Golden', 'Ivory', 'Sable', 'Crown', 'Zuri', 'Amara', 'Kofi', 'Nala', 'Obi', 'Tiwa', 'Bespoke', 'Atelier',
  'Maison', 'Studio', 'The Cutting', 'Silk', 'Indigo', 'Adire', 'Aso', 'Kente'];
const BIZ_B = ['Couture', 'Studio', 'Designs', 'Atelier', 'Threads', 'Tailors', 'Fashion House', 'Bespoke',
  'Garments', 'Collective', 'Workroom', 'Label', 'Sartoria', 'Stitches', 'Room', 'Craft', 'Menswear', 'Bridal'];
const FIRST = ['Amaka', 'Tomi', 'Zainab', 'Stella', 'Ahmed', 'Chidi', 'Ngozi', 'Bisi', 'Seyi', 'Idara', 'Femi',
  'Funmi', 'Kemi', 'Yusuf', 'Halima', 'Emeka', 'Folake', 'Segun', 'Aisha', 'Uche', 'Dare', 'Nneka', 'Musa',
  'Tunde', 'Grace', 'Ifeoma', 'Bola', 'Sadiq', 'Adaeze', 'Kunle'];
const LAST = ['Okafor', 'Adeyemi', 'Musa', 'Okonkwo', 'Hassan', 'Eze', 'Bello', 'Adeyinka', 'Balogun', 'Umah',
  'Adebayo', 'Oladele', 'Ibrahim', 'Nwosu', 'Lawal', 'Obi', 'Sanni', 'Akande', 'Yakubu', 'Chukwu'];
const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu', 'Benin City', 'Kaduna', 'Uyo', 'Accra'];
const CHANNELS = ['Instagram', 'Referral', 'Google search', 'Word of mouth', 'WhatsApp', 'Trade fair', 'Partner'];

/* target composition — these sum to 128 exactly */
const MIX = [
  { plan: 'premium', status: 'active',  n: 56 },
  { plan: 'pro',     status: 'active',  n: 33 },
  { plan: 'starter', status: 'active',  n: 16 },
  { plan: 'trial',   status: 'trial',   n: 11 },
  { plan: 'premium', status: 'expired', n: 6  },
  { plan: 'pro',     status: 'expired', n: 4  },
  { plan: 'starter', status: 'expired', n: 2  }
];

function buildSubscribers() {
  const out = [];
  const usedNames = new Set();
  let id = 1;

  MIX.forEach(block => {
    for (let i = 0; i < block.n; i++) {
      let name, guard = 0;
      do {
        name = pick(BIZ_A) + ' ' + pick(BIZ_B);
        guard++;
      } while (usedNames.has(name) && guard < 60);
      if (usedNames.has(name)) name = name + ' ' + (id);
      usedNames.add(name);

      const plan = planById(block.plan);
      const owner = pick(FIRST) + ' ' + pick(LAST);
      const cycle = block.plan === 'trial' ? 'trial' : (rnd() < 0.22 ? 'annual' : 'monthly');

      // tenure: expired & premium tend to be older
      /* Tenure spread over roughly three and a half years, so the year-on-year
         views have real history behind them rather than a flat line. */
      let ageDays;
      if (block.status === 'trial') ageDays = int(0, 13);
      else if (block.status === 'active' && rnd() < 0.07) ageDays = int(0, 8);  // a few brand-new paid accounts
      else if (block.plan === 'premium') ageDays = int(90, 1240);
      else if (block.plan === 'pro') ageDays = int(45, 1000);
      else ageDays = int(20, 700);

      const joined = dAgo(ageDays);
      const mrr = block.status === 'active'
        ? (cycle === 'annual' ? Math.round(plan.annual / 12) : plan.monthly)
        : 0;

      // renewal date
      const renewIn = block.status === 'active' ? int(0, 30)
        : block.status === 'trial' ? Math.max(0, 14 - ageDays)
          : -int(1, 60);
      const renewsOn = dAgo(-renewIn);

      const users = block.plan === 'premium' ? int(6, 28)
        : block.plan === 'pro' ? int(3, 10) : int(1, 3);

      const outlets = block.plan === 'premium' ? int(1, 4) : block.plan === 'pro' ? int(1, 3) : 1;
      const city = pick(CITIES);
      const businesses = [];
      for (let b = 0; b < outlets; b++) {
        businesses.push({
          name: b === 0 ? city + ' HQ' : pick(['Ikoyi', 'Lekki', 'Surulere', 'Wuse', 'GRA', 'Maitama', 'Yaba', 'Asokoro']) + ' branch',
          city: b === 0 ? city : pick(CITIES),
          staff: int(2, 12),
          openedOn: iso(dAgo(int(10, ageDays || 20)))
        });
      }

      const pastDue = block.status === 'active' && rnd() < 0.067;   // ~7 of 105
      const health = block.status === 'expired' ? 'churned'
        : pastDue ? 'at-risk'
          : block.status === 'trial' ? 'onboarding'
            : (rnd() < 0.12 ? 'at-risk' : rnd() < 0.4 ? 'steady' : 'healthy');

      out.push({
        id: id++,
        name, owner,
        email: owner.split(' ')[0].toLowerCase() + '@' + name.toLowerCase().replace(/[^a-z]+/g, '') + '.com',
        phone: '+234 ' + int(700, 909) + ' ' + int(100, 999) + ' ' + int(1000, 9999),
        city,
        plan: block.plan,
        planName: plan.name,
        cycle,
        status: block.status,
        pastDue,
        health,
        users, seats: plan.seats,
        joined: iso(joined),
        renewsOn: iso(renewsOn),
        renewIn,
        mrr,
        channel: pick(CHANNELS),
        /* Where the attribution actually came from. A referral is inferred from the
           link, never self-reported; a demo request is typed in by sales; everything
           else is the optional one-tap question on the last step of signup. */
        channelSource: 'signup',
        businesses,
        referredBy: null,
        lastSeen: iso(dAgo(block.status === 'expired' ? int(30, 200) : int(0, 9))),
        ordersLast30: block.status === 'active' ? int(4, 220) : block.status === 'trial' ? int(0, 18) : 0,
        notes: []
      });
    }
  });

  /* ---- referrals: build a real referral graph with commission ---- */
  const active = out.filter(s => s.status !== 'expired');
  out.forEach(s => { s.referrals = []; });
  // ~34 referral links
  for (let i = 0; i < 34; i++) {
    const referrer = pick(active);
    const invitee = pick(out);
    if (!invitee || invitee.id === referrer.id || invitee.referredBy) continue;
    invitee.referredBy = referrer.id;
    invitee.channel = 'Referral';
    invitee.channelSource = 'referral-link';   // inferred, not self-reported
    referrer.referrals.push(invitee.id);
  }
  /* A minority arrive through a sales conversation, where the channel is typed in
     by whoever took the call rather than chosen by the subscriber. */
  out.forEach(s => {
    if (s.channelSource === 'signup' && s.plan === 'premium' && rnd() < 0.3) s.channelSource = 'demo-request';
  });
  // commission = 15% of first month for each converted referral, paid once
  out.forEach(s => {
    s.referralLedger = s.referrals.map(rid => {
      const r = out.find(x => x.id === rid);
      const converted = r.status === 'active' || r.status === 'expired';
      const base = converted ? planById(r.plan).monthly : 0;
      return {
        subId: rid, name: r.name, plan: r.planName, status: r.status,
        joined: r.joined,
        converted,
        commission: Math.round(base * 0.15),
        paid: converted && new Date(r.joined) < dAgo(30),
        creditedOn: converted ? iso(new Date(new Date(r.joined).getTime() + 31 * DAY)) : null
      };
    });
    s.referralEarned = s.referralLedger.reduce((t, r) => t + r.commission, 0);
    s.referralPaid = s.referralLedger.filter(r => r.paid).reduce((t, r) => t + r.commission, 0);
    s.referralPending = s.referralEarned - s.referralPaid;
    s.referralConverted = s.referralLedger.filter(r => r.converted).length;
  });

  return out;
}

/* ---------------- staff (16) ---------------- */
const STAFF_SEED = [
  ['Kayode Ojomo', 'Management', 'Super Admin', 'owner', 900000, 'M', '1988-04-12'],
  ['Bisi Adeyemi', 'Management', 'Operations Lead', 'ops', 520000, 'F', '1990-09-02'],
  ['Funmi Oladele', 'Finance', 'Finance Manager', 'finance', 480000, 'F', '1991-11-08'],
  ['Chidi Okonkwo', 'Finance', 'Accountant', 'finance', 320000, 'M', '1993-02-19'],
  ['Nneka Eze', 'Finance', 'Billing Analyst', 'finance', 260000, 'F', '1995-07-30'],
  ['Sarah Bello', 'Support', 'Support Manager', 'support_mgr', 400000, 'F', '1992-06-15'],
  ['Femi Adebayo', 'Support', 'Support Agent', 'support', 210000, 'M', '1995-03-20'],
  ['Idara Umah', 'Support', 'Support Agent', 'support', 205000, 'F', '1996-01-24'],
  ['Yusuf Lawal', 'Support', 'Support Agent', 'support', 198000, 'M', '1997-05-11'],
  ['Halima Ibrahim', 'Support', 'Onboarding Specialist', 'support', 240000, 'F', '1994-08-06'],
  ['Seyi Balogun', 'Product', 'Head of Product', 'product', 600000, 'M', '1989-12-01'],
  ['Ngozi Nwosu', 'Product', 'Product Designer', 'product', 350000, 'F', '1994-04-17'],
  ['Emeka Chukwu', 'Product', 'Engineer', 'product', 520000, 'M', '1992-10-09'],
  ['Folake Akande', 'Operations', 'Ops Analyst', 'ops', 280000, 'F', '1996-06-28'],
  ['Tunde Sanni', 'Operations', 'Partner Manager', 'ops', 330000, 'M', '1991-03-15'],
  ['Aisha Yakubu', 'Operations', 'Compliance Officer', 'ops', 300000, 'F', '1990-07-21']
];

function buildStaff() {
  return STAFF_SEED.map((s, i) => {
    const [name, dept, title, roleId, basic, gender, dob] = s;
    const startDays = int(120, 1300);
    const first = name.split(' ')[0].toLowerCase();
    return {
      id: i + 1,
      staffId: 'TLB-' + String(i + 1).padStart(3, '0'),
      name, dept, title, roleId,
      username: '@' + first,
      email: first + '@thelabelboard.com',
      phone: '+234 ' + int(700, 909) + ' ' + int(100, 999) + ' ' + int(1000, 9999),
      gender: gender === 'M' ? 'Male' : 'Female',
      dob,
      address: pick(['Surulere', 'Ikoyi', 'Lekki', 'Yaba', 'Maitama', 'Wuse II', 'GRA']) + ', ' + pick(['Lagos', 'Abuja', 'Port Harcourt']),
      nationality: 'Nigerian',
      emergency: pick(FIRST) + ' ' + name.split(' ')[1] + ' · +234 80' + int(1, 9) + ' ' + int(100, 999) + ' ' + int(1000, 9999) + ' · ' + pick(['Spouse', 'Sibling', 'Parent']),
      empType: i < 13 ? 'Full time' : pick(['Full time', 'Contract']),
      startDate: iso(dAgo(startDays)),
      status: 'active',
      reportsTo: i === 0 ? null : (dept === 'Management' ? 1 : (dept === 'Finance' ? 3 : dept === 'Support' ? 6 : dept === 'Product' ? 11 : 2)),
      workLocation: pick(['Lagos office', 'Abuja office', 'Remote']),
      bankName: pick(['GTBank', 'Access Bank', 'Zenith Bank', 'UBA', 'Kuda']),
      bankAccount: String(int(1000000000, 9999999999)),
      bankAccountName: name,
      salaryType: 'Monthly salary',
      basic,
      /* Allowances are switched off platform-wide while we are a startup.
         The fields stay so they can be turned on later without a migration. */
      housing: 0,
      transport: 0,
      /* Pension is voluntary — the staff member has to agree to it. */
      pension: { optedIn: i % 3 !== 0, rate: 8, agreedOn: i % 3 !== 0 ? iso(dAgo(startDays - 5)) : null },
      nhfOptIn: i % 4 !== 0,
      lastActive: iso(dAgo(0)),
      lastActiveLabel: i === 0 ? 'Now' : pick(['3m ago', '12m ago', '45m ago', '2h ago', 'Yesterday']),
      leaveEntitlement: 20,
      rating: Math.round((3.6 + rnd() * 1.3) * 10) / 10
    };
  });
}

/* ---------------- payments (derived from subscribers) ---------------- */
function buildPayments(subs) {
  const out = [];
  let n = 1;
  subs.forEach(s => {
    if (s.status === 'trial') return;
    const start = new Date(s.joined);
    const monthsHeld = Math.max(1, Math.floor((TODAY - start) / (30.44 * DAY)));
    const cap = Math.min(monthsHeld, 42);
    const amt = s.cycle === 'annual' ? planById(s.plan).annual : planById(s.plan).monthly;
    const step = s.cycle === 'annual' ? 12 : 1;
    for (let m = 0; m < cap; m += step) {
      const when = new Date(start.getTime() + m * 30.44 * DAY);
      if (when > TODAY) break;
      let status = 'successful';
      if (s.status === 'expired' && m >= cap - step) status = 'failed';
      else if (s.pastDue && m >= cap - step) status = 'failed';
      else if (rnd() < 0.035) status = 'failed';
      else if (rnd() < 0.012) status = 'refunded';
      out.push({
        id: n++, subId: s.id, subscriber: s.name, plan: s.planName, cycle: s.cycle,
        ref: 'FLW-' + int(600000, 999999),
        amount: amt, provider: rnd() < 0.9 ? 'Flutterwave' : 'Bank transfer',
        method: pick(['Card •••6411', 'Card •••9072', 'Bank transfer', 'USSD']),
        status, date: iso(when),
        invoice: 'INV-' + String(n).padStart(5, '0')
      });
    }
  });

  // pending today + upcoming renewals + overdue
  subs.filter(s => s.status === 'active').forEach(s => {
    const amt = s.cycle === 'annual' ? planById(s.plan).annual : planById(s.plan).monthly;
    if (s.renewIn >= 0 && s.renewIn <= 30) {
      out.push({
        id: n++, subId: s.id, subscriber: s.name, plan: s.planName, cycle: s.cycle,
        ref: 'SCH-' + int(600000, 999999), amount: amt, provider: 'Flutterwave',
        method: 'Card on file', status: s.renewIn === 0 ? 'pending' : 'upcoming',
        date: s.renewsOn, invoice: 'INV-' + String(n).padStart(5, '0')
      });
    }
    if (s.pastDue) {
      out.push({
        id: n++, subId: s.id, subscriber: s.name, plan: s.planName, cycle: s.cycle,
        ref: 'OVD-' + int(600000, 999999), amount: amt, provider: 'Flutterwave',
        method: 'Card declined', status: 'overdue',
        date: iso(dAgo(int(3, 26))), invoice: 'INV-' + String(n).padStart(5, '0')
      });
    }
  });

  // guarantee some activity dated today so "Today" is never a dead screen
  for (let i = 0; i < 4; i++) {
    const s = pick(subs.filter(x => x.status === 'active'));
    out.push({
      id: n++, subId: s.id, subscriber: s.name, plan: s.planName, cycle: s.cycle,
      ref: 'FLW-' + int(600000, 999999),
      amount: s.cycle === 'annual' ? planById(s.plan).annual : planById(s.plan).monthly,
      provider: 'Flutterwave', method: 'Card •••6411',
      status: i === 3 ? 'failed' : 'successful', date: iso(TODAY),
      invoice: 'INV-' + String(n).padStart(5, '0')
    });
  }

  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/* ---------------- payroll + payslips ---------------- */
const PAY_MONTHS = 6;
function buildPayroll(staff) {
  const runs = [];   // one run per month
  const slips = [];  // one slip per staff per month
  let sid = 1;

  for (let m = 0; m < PAY_MONTHS; m++) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - m, 25);
    const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    let gross = 0, ded = 0, net = 0;

    staff.forEach(s => {
      const bonus = rnd() < 0.25 ? Math.round(s.basic * 0.08 / 1000) * 1000 : 0;
      const overtime = s.dept === 'Support' && rnd() < 0.4 ? int(5, 20) * 2500 : 0;
      const g = s.basic + s.housing + s.transport + bonus + overtime;
      const paye = Math.round(g * 0.115 / 100) * 100;
      const pension = s.pension && s.pension.optedIn ? Math.round(s.basic * (s.pension.rate / 100) / 100) * 100 : 0;
      const nhf = s.nhfOptIn ? Math.round(s.basic * 0.025 / 100) * 100 : 0;
      const loan = (s.id % 7 === 0) ? 25000 : 0;
      const dd = paye + pension + nhf + loan;
      const nn = g - dd;

      // current month: not everyone processed yet
      const state = m === 0 ? (s.id <= 13 ? 'paid' : 'pending') : 'paid';

      slips.push({
        id: sid++, staffId: s.id, staffName: s.name, dept: s.dept, monthKey: key, month: label,
        payDate: iso(d), basic: s.basic, housing: s.housing, transport: s.transport,
        bonus, overtime, gross: g,
        paye, pension, nhf, loan, deductions: dd, net: nn,
        pensionOptedIn: !!(s.pension && s.pension.optedIn), nhfOptedIn: !!s.nhfOptIn,
        status: state, bank: s.bankName + ' · ' + s.bankAccount,
        uploaded: m > 0,                     // historic slips already published to staff
        publishedOn: m > 0 ? iso(d) : null
      });

      gross += g; ded += dd; net += nn;
    });

    runs.push({
      monthKey: key, month: label, payDate: iso(d), headcount: staff.length,
      gross, deductions: ded, net,
      paid: slips.filter(x => x.monthKey === key && x.status === 'paid').length,
      pending: slips.filter(x => x.monthKey === key && x.status === 'pending').length,
      status: m === 0 ? 'open' : 'closed'
    });
  }
  return { runs, slips };
}

/* ---------------- attendance ---------------- */
function buildAttendance(staff) {
  const rows = [];
  let id = 1;
  for (let d = 0; d < 30; d++) {
    const day = dAgo(d);
    const dow = day.getDay();
    if (dow === 0) continue;                       // closed Sundays
    staff.forEach(s => {
      const r = rnd();
      let state = 'present', inT = null, outT = null;
      if (r < 0.045) state = 'leave';
      else if (r < 0.07) state = 'absent';
      else {
        const late = rnd() < 0.16;
        state = late ? 'late' : 'present';
        const ih = late ? 9 : 8;
        const im = late ? int(16, 55) : int(2, 14);
        inT = String(ih).padStart(2, '0') + ':' + String(im).padStart(2, '0');
        const oh = int(17, 19), om = int(0, 59);
        outT = String(oh).padStart(2, '0') + ':' + String(om).padStart(2, '0');
      }
      // today: some are still clocked in (no out yet)
      if (d === 0 && inT && rnd() < 0.6) outT = null;
      rows.push({
        id: id++, staffId: s.id, date: iso(day), in: inT, out: outT, state,
        hours: (inT && outT) ? Math.round(((+outT.slice(0, 2) * 60 + +outT.slice(3)) - (+inT.slice(0, 2) * 60 + +inT.slice(3))) / 6) / 10 : 0
      });
    });
  }
  return rows;
}

/* ---------------- staff documents ---------------- */
function buildDocs(staff) {
  const out = []; let id = 1;
  staff.forEach(s => {
    const start = fmtD(s.startDate);
    const set = [
      { kind: 'Employment contract', status: 'on file', pages: 6,
        body: [['Employee', s.name], ['Staff ID', s.staffId], ['Job title', s.title],
          ['Department', s.dept], ['Employment type', s.empType], ['Start date', start],
          ['Monthly basic', money(s.basic)], ['Notice period', '1 month either side'],
          ['Probation', '3 months from start date'], ['Signed by employee', start],
          ['Signed by company', start], ['Governing law', 'Federal Republic of Nigeria']],
        note: 'Standard contract of employment. Salary is stated as a monthly basic with no allowances, matching the current pay policy.' },
      { kind: 'ID verification', status: 'on file', pages: 1,
        body: [['Document type', 'National Identity Number (NIN)'],
          ['Number', '••••••' + int(1000, 9999)], ['Name on document', s.name],
          ['Date of birth', fmtD(s.dob)], ['Verified on', start], ['Verified by', 'Funmi Oladele'],
          ['Status', 'Matched against payroll record']],
        note: 'Identity confirmed against the NIMC database. Full number is masked here and held encrypted.' },
      { kind: 'Bank mandate', status: 'on file', pages: 1,
        body: [['Account name', s.bankAccountName], ['Bank', s.bankName],
          ['Account number', s.bankAccount], ['Account type', 'Savings'],
          ['Mandate signed', start], ['Last changed', 'Never']],
        note: 'Authorises salary payment into this account. A change of account requires a fresh mandate and a second approver.' },
      { kind: 'Next of kin', status: 'on file', pages: 1,
        body: [['Emergency contact', s.emergency.split(' · ')[0]],
          ['Phone', s.emergency.split(' · ')[1] || '—'],
          ['Relationship', s.emergency.split(' · ')[2] || '—'],
          ['Home address', s.address], ['Recorded on', start]],
        note: 'Used only in an emergency. Visible to the Owner and to whoever the person reports to.' },
      { kind: 'Pension enrolment', status: s.pension.optedIn ? 'on file' : 'not enrolled', pages: 1,
        body: s.pension.optedIn
          ? [['Scheme', 'Contributory pension'], ['Employee rate', s.pension.rate + '% of basic'],
             ['Monthly contribution', money(Math.round(s.basic * s.pension.rate / 100))],
             ['Agreed on', fmtD(s.pension.agreedOn)], ['Status', 'Active']]
          : [['Status', 'Not enrolled'], ['Reason', 'Employee has not opted in'],
             ['Note', 'Enrolment is voluntary and needs the employee\'s written agreement']],
        note: s.pension.optedIn
          ? 'Signed enrolment form. Deductions began the month after it was agreed.'
          : 'No enrolment on file. Nothing is deducted for pension until this person opts in.' },
      { kind: 'Tax identification (TIN)', status: rnd() < 0.75 ? 'on file' : 'missing', pages: 1,
        body: [['TIN', rnd() < 0.75 ? int(10000000, 99999999) + '-0001' : 'Not supplied'],
          ['Issued by', 'Federal Inland Revenue Service'], ['Required for', 'PAYE remittance']],
        note: 'Needed to remit PAYE against the right taxpayer. Chase anyone showing as missing.' }
    ];
    set.forEach(d => out.push(Object.assign({ id: id++, staffId: s.id, addedOn: s.startDate }, d)));
  });
  return out;
}

/* ---------------- leave ---------------- */
function buildLeave(staff) {
  const out = []; let id = 1;
  staff.forEach(s => {
    const count = int(0, 3);
    for (let i = 0; i < count; i++) {
      const from = dAgo(int(-40, 220));
      const days = int(1, 8);
      out.push({
        id: id++, staffId: s.id, type: pick(['Annual', 'Sick', 'Compassionate', 'Study']),
        from: iso(from), to: iso(new Date(from.getTime() + days * DAY)), days,
        status: from > TODAY ? pick(['pending', 'approved']) : 'approved',
        note: pick(['Family event', 'Medical', 'Travel', 'Rest', 'Exams'])
      });
    }
  });
  return out;
}

/* ---------------- tickets / feedback / tasks / announcements ---------------- */
const TICKET_SEED = [
  ['Checkout not loading', 'Payment checkout hangs after choosing a plan. Card never gets charged and the tab freezes.', 'urgent', 'bug'],
  ['Invoice showing wrong month', 'August invoice is labelled July. Needs reissuing with the right period.', 'in-progress', 'billing'],
  ['How do I add another branch?', 'Wants to set up a second outlet and move three staff across.', 'open', 'question'],
  ['Cannot invite a 4th team member', 'Starter plan seat limit reached but no upgrade prompt is shown.', 'open', 'bug'],
  ['Production board dates off by one', 'Due dates render a day early in the week view.', 'in-progress', 'bug'],
  ['Refund request for duplicate charge', 'Charged twice on 12 Aug. Asking for one leg to be refunded.', 'urgent', 'billing'],
  ['Export to CSV is empty', 'Orders export downloads a file with headers only.', 'open', 'bug'],
  ['Request: bulk price update', 'Wants to raise all catalogue prices by 10% in one action.', 'open', 'question'],
  ['Login loop after password reset', 'Reset works but signing in bounces back to the login screen.', 'resolved', 'bug'],
  ['WhatsApp link not opening', 'Concierge hand-off opens a blank tab on iPhone.', 'resolved', 'bug'],
  ['Attendance shows wrong hours', 'Clock-out at 6pm recorded as 8 hours instead of 9.5.', 'resolved', 'bug']
];
function buildTickets(subs, staff) {
  const agents = staff.filter(s => s.dept === 'Support');
  return TICKET_SEED.map((t, i) => {
    const sub = pick(subs.filter(s => s.status !== 'expired'));
    const opened = dAgo(t[2] === 'resolved' ? int(1, 6) : (i < 3 ? 0 : int(0, 4)));
    const assigned = t[2] === 'open' && i > 6 ? null : pick(agents);
    return {
      id: i + 1, ref: 'TLB-' + (2100 + i), title: t[0], body: t[1],
      priority: t[2] === 'urgent' ? 'urgent' : t[2] === 'resolved' ? 'normal' : 'normal',
      state: t[2], kind: t[3],
      subId: sub.id, subscriber: sub.name, plan: sub.planName,
      assignedTo: assigned ? assigned.id : null,
      assignedName: assigned ? assigned.name : 'Unassigned',
      openedAt: iso(opened),
      firstReplyMins: int(3, 48),
      resolvedAt: t[2] === 'resolved' ? iso(dAgo(int(0, 3))) : null,
      satisfaction: t[2] === 'resolved' ? pick([5, 5, 4, 5, 3]) : null,
      thread: [
        { who: sub.owner, side: 'them', at: iso(opened), text: t[1] },
        assigned ? { who: assigned.name, side: 'us', at: iso(opened), text: 'Thanks for flagging this. Taking a look now and will come back to you shortly.' } : null
      ].filter(Boolean)
    };
  });
}

const FEEDBACK_SEED = [
  ['Fabric consumption calculator', 'Estimate how much fabric an order needs straight from the client measurements.', 'feature', 18, 'under review'],
  ['WhatsApp order updates', 'Send the customer a message automatically each time the order changes stage.', 'feature', 11, 'planned'],
  ['Offline mode on the production board', 'Workroom has patchy signal. Board should keep working and sync later.', 'feature', 16, 'planned'],
  ['Bulk import of past orders', 'A spreadsheet importer for historic jobs so reports look right from day one.', 'feature', 9, 'under review'],
  ['Multi-currency invoices', 'Diaspora clients pay in GBP and USD.', 'feature', 7, 'backlog'],
  ['Barcode scan for inventory', 'Scan fabric rolls in and out instead of typing.', 'feature', 6, 'backlog'],
  ['Darker dark mode', 'The panels still read a little light on OLED screens.', 'suggestion', 4, 'backlog'],
  ['Shortcut to repeat an order', 'Regulars order the same thing. One tap to duplicate.', 'suggestion', 12, 'planned'],
  ['Production tracking is excellent', 'Makes it much easier to see where every order actually is.', 'review', 0, 'published'],
  ['Payroll saved us a whole day', 'Month end used to take a full day of spreadsheets.', 'review', 0, 'published'],
  ['Support replies fast', 'Had a billing question answered in under ten minutes.', 'review', 0, 'published'],
  ['Would like more report filters', 'Good product overall, reports could slice by tailor.', 'review', 0, 'pending']
];
function buildFeedback(subs) {
  return FEEDBACK_SEED.map((f, i) => {
    const sub = pick(subs.filter(s => s.status === 'active'));
    return {
      id: i + 1, title: f[0], body: f[1], kind: f[2], votes: f[3], state: f[4],
      subId: sub.id, subscriber: sub.name, plan: sub.planName,
      rating: f[2] === 'review' ? pick([5, 5, 4, 5]) : null,
      at: iso(dAgo(int(0, 40)))
    };
  });
}

const TASK_SEED = [
  ['Call Lux Couture about checkout', 'Follow up once the checkout fix ships. Confirm the plan change went through.', 'high', 1, 0],
  ['Reissue August invoices', 'Three invoices carry the wrong period label. Reissue and email the subscribers.', 'high', 3, -2],
  ['Review August feature requests', 'Prioritise the top eight requests with product before the sprint.', 'medium', 11, 1],
  ['Chase 7 past-due accounts', 'Retry cards, then call the ones that fail twice.', 'high', 5, 0],
  ['Publish July payslips', 'Upload and publish so staff can see them in their profiles.', 'medium', 3, -1],
  ['Onboarding call: House of Dara', 'Walk them through catalogue setup and first staff invite.', 'medium', 10, 2],
  ['Quarterly churn review', 'Pull the twelve churned accounts and write up why each left.', 'low', 2, 6],
  ['Audit admin access', 'Check every role still matches what the person actually does.', 'medium', 16, 4]
];
function buildTasks(staff) {
  return TASK_SEED.map((t, i) => {
    const due = dAgo(-t[4]);
    const done = i === 6 ? true : false;
    return {
      id: i + 1, title: t[0], body: t[1], priority: t[2],
      assignedTo: t[3], assignedName: (staff.find(s => s.id === t[3]) || {}).name || 'Unassigned',
      due: iso(due), dueIn: t[4], done,
      createdBy: 1, createdAt: iso(dAgo(int(1, 12)))
    };
  });
}

function buildAnnouncements() {
  const seed = [
    ['Production Board improvements', 'Faster board, drag between stages, and due dates now respect your week start.', 'All subscribers', 'In-app + Email', 'published', -3],
    ['Payroll and payslips are live', 'Run payroll, publish payslips, and staff can see them in their own profile.', 'Pro & Premium', 'In-app + Email', 'published', -11],
    ['New: offline production board', 'The board keeps working without signal and syncs when you are back.', 'All subscribers', 'In-app', 'published', -24],
    ['Scheduled maintenance, 28 Aug', 'Fifteen minutes of downtime from 01:00 WAT while we upgrade the database.', 'All subscribers', 'In-app + Email', 'scheduled', 3],
    ['September price review', 'Starter moves to ₦31,000 from 1 October. Existing plans keep their price for 6 months.', 'Starter', 'Email', 'scheduled', 9],
    ['Concierge beta invitation', 'Draft — invite 20 Premium studios into the concierge beta.', 'Premium', 'In-app', 'draft', 0],
    ['Referral programme refresh', 'Draft — raise referral commission to 20% for Q4.', 'All subscribers', 'In-app + Email', 'draft', 0]
  ];
  return seed.map((a, i) => ({
    id: i + 1, title: a[0], body: a[1], audience: a[2], channel: a[3], state: a[4],
    date: iso(dAgo(-a[5])),
    reach: a[4] === 'published' ? int(90, 128) : 0,
    opened: a[4] === 'published' ? int(40, 110) : 0,
    author: 'Kayode Ojomo'
  }));
}

/* ---------------- onboarding pipeline ---------------- */
const ONB_STEPS = ['Account created', 'Business profile', 'Catalogue', 'First staff invite', 'First order', 'Card added'];
function buildOnboarding(subs) {
  const trials = subs.filter(s => s.status === 'trial');
  return trials.map((s, i) => {
    const step = int(1, 6);
    return {
      id: i + 1, subId: s.id, name: s.name, owner: s.owner, email: s.email, plan: 'Trial',
      city: s.city, channel: s.channel,
      joined: s.joined, trialEndsIn: s.renewIn,
      step, steps: ONB_STEPS.map((t, k) => ({ label: t, done: k < step })),
      progress: Math.round(step / ONB_STEPS.length * 100),
      state: step >= 6 ? 'ready' : step >= 2 ? 'setup' : 'new',
      owner_id: null,
      lastTouch: iso(dAgo(int(0, 5)))
    };
  });
}

/* ---------------- roles & permissions ---------------- */
const ADMIN_PAGES = [
  ['dashboard', 'Dashboard'], ['subscribers', 'Subscribers'], ['onboarding', 'Onboarding'],
  ['billing', 'Plans & Billing'], ['payments', 'Payments'], ['payroll', 'Payroll'],
  ['revenue', 'Revenue'], ['support', 'Support & Usage'],
  ['announcements', 'Announcements'], ['tasks', 'Tasks'],
  ['staff', 'Staff & Roles'], ['activity', 'Activity Log'], ['settings', 'Settings']
];
const ADMIN_CAPS = [
  ['see_money', 'See revenue & financials'],
  ['edit_sub', 'Edit subscriber records'],
  ['change_plan', 'Change a plan or price'],
  ['refund', 'Issue refunds'],
  ['run_payroll', 'Run payroll'],
  ['publish_slips', 'Publish payslips'],
  ['manage_staff', 'Manage staff accounts'],
  ['edit_roles', 'Edit roles & permissions'],
  ['send_announce', 'Send announcements'],
  ['close_ticket', 'Close support tickets'],
  ['export', 'Export data'],
  ['delete', 'Delete records'],
  ['see_audit', 'See the audit log'],
  ['impersonate', 'Open a subscriber account']
];

function defaultRoles() {
  const all = ADMIN_PAGES.map(p => p[0]);
  const allCaps = ADMIN_CAPS.map(c => c[0]);
  return [
    { id: 'owner', name: 'Owner', builtin: true, locked: true,
      desc: 'Full access, always on and cannot be limited.', pages: all.slice(), caps: allCaps.slice() },
    { id: 'ops', name: 'Operations Lead', builtin: true, locked: false,
      desc: 'Runs the day to day across every team.',
      pages: ['dashboard', 'subscribers', 'onboarding', 'billing', 'payments', 'revenue', 'support', 'announcements', 'tasks', 'staff', 'activity'],
      caps: ['see_money', 'edit_sub', 'change_plan', 'manage_staff', 'send_announce', 'close_ticket', 'export', 'see_audit'] },
    { id: 'finance', name: 'Finance', builtin: true, locked: false,
      desc: 'Billing, payments, payroll and revenue.',
      pages: ['dashboard', 'subscribers', 'billing', 'payments', 'payroll', 'revenue', 'activity'],
      caps: ['see_money', 'change_plan', 'refund', 'run_payroll', 'publish_slips', 'export', 'see_audit'] },
    { id: 'support_mgr', name: 'Support Manager', builtin: true, locked: false,
      desc: 'Owns the support queue and the team on it.',
      pages: ['dashboard', 'subscribers', 'onboarding', 'support', 'announcements', 'tasks', 'activity'],
      caps: ['edit_sub', 'close_ticket', 'send_announce', 'impersonate', 'export'] },
    { id: 'support', name: 'Support Agent', builtin: true, locked: false,
      desc: 'Answers tickets. No money, no staff records.',
      pages: ['dashboard', 'subscribers', 'onboarding', 'support', 'tasks'],
      caps: ['close_ticket', 'impersonate'] },
    { id: 'product', name: 'Product', builtin: true, locked: false,
      desc: 'Usage, feedback and what ships next.',
      pages: ['dashboard', 'support', 'announcements', 'tasks'],
      caps: ['send_announce', 'export'] }
  ];
}

/* ---------------- activity log ---------------- */
function buildActivity(subs, staff, tickets) {
  const out = []; let id = 1;
  const kinds = [
    ['plan_change', 'Subscription plan changed'],
    ['ticket_closed', 'Support ticket closed'],
    ['account_view', 'Subscriber account opened'],
    ['refund', 'Refund issued'],
    ['payroll', 'Payroll run closed'],
    ['role_change', 'Role permissions changed'],
    ['login', 'Admin signed in'],
    ['announce', 'Announcement sent'],
    ['slip_publish', 'Payslips published'],
    ['export', 'Data exported'],
    ['sub_edit', 'Subscriber record edited'],
    ['staff_invite', 'Staff invited']
  ];
  for (let i = 0; i < 46; i++) {
    const k = pick(kinds);
    const who = pick(staff);
    const sub = pick(subs);
    const when = new Date(TODAY.getTime() - Math.floor(rnd() * 21 * DAY) - Math.floor(rnd() * DAY));
    let detail = '', target = null;
    switch (k[0]) {
      case 'plan_change': detail = who.name + ' moved ' + sub.name + ' from Pro to Premium'; target = 'subscriber:' + sub.id; break;
      case 'ticket_closed': { const t = pick(tickets); detail = who.name + ' closed #' + t.ref + ' — ' + t.title; target = 'ticket:' + t.id; break; }
      case 'account_view': detail = who.name + ' opened ' + sub.name; target = 'subscriber:' + sub.id; break;
      case 'refund': detail = who.name + ' refunded ' + money(planById(sub.plan).monthly) + ' to ' + sub.name; target = 'subscriber:' + sub.id; break;
      case 'payroll': detail = who.name + ' closed the ' + pick(['July', 'June', 'May']) + ' payroll run'; break;
      case 'role_change': detail = who.name + ' changed permissions on the ' + pick(['Support Agent', 'Finance', 'Product']) + ' role'; break;
      case 'login': detail = who.name + ' signed in from ' + pick(['Lagos, NG', 'Abuja, NG', 'London, UK']); break;
      case 'announce': detail = who.name + ' sent "' + pick(['Production Board improvements', 'Scheduled maintenance']) + '"'; break;
      case 'slip_publish': detail = who.name + ' published ' + int(14, 16) + ' payslips'; break;
      case 'export': detail = who.name + ' exported ' + pick(['payments', 'subscribers', 'payroll']) + ' as CSV'; break;
      case 'sub_edit': detail = who.name + ' edited ' + sub.name; target = 'subscriber:' + sub.id; break;
      case 'staff_invite': detail = who.name + ' invited ' + pick(FIRST).toLowerCase() + '@thelabelboard.com'; break;
    }
    out.push({
      id: id++, kind: k[0], action: k[1], detail,
      actorId: who.id, actor: who.name, actorRole: who.title,
      at: when.toISOString(), target,
      ip: '102.' + int(10, 250) + '.' + int(1, 250) + '.' + int(1, 250),
      device: pick(['Chrome on Windows', 'Safari on macOS', 'Chrome on Android', 'Safari on iPhone']),
      reason: pick(['Requested by subscriber', 'Scheduled task', 'Support escalation', 'Routine review', 'Billing correction'])
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------------- usage ---------------- */
function buildUsage(subs) {
  const active = subs.filter(s => s.status === 'active');
  const series = [];
  for (let d = 29; d >= 0; d--) {
    const day = dAgo(d);
    const dow = day.getDay();
    const base = dow === 0 ? 0.55 : dow === 6 ? 0.8 : 1;
    series.push({
      date: iso(day),
      dab: Math.round((58 + rnd() * 22) * base),
      mau: Math.round((690 + rnd() * 180) * base),
      orders: Math.round((120 + rnd() * 90) * base)
    });
  }
  const atRisk = active.filter(s => s.health === 'at-risk');
  return { series, atRisk };
}

/* ---------------- assemble ---------------- */
const DB = (function () {
  const subscribers = buildSubscribers();
  const staff = buildStaff();
  const payments = buildPayments(subscribers);
  const { runs, slips } = buildPayroll(staff);
  const attendance = buildAttendance(staff);
  const leave = buildLeave(staff);
  const docs = buildDocs(staff);
  const tickets = buildTickets(subscribers, staff);
  const feedback = buildFeedback(subscribers);
  const tasks = buildTasks(staff);
  const announcements = buildAnnouncements();
  const onboarding = buildOnboarding(subscribers);
  const activity = buildActivity(subscribers, staff, tickets);
  const usage = buildUsage(subscribers);

  return {
    today: TODAY,
    plans: PLANS,
    subscribers, staff, payments,
    payrollRuns: runs, payslips: slips,
    attendance, leave, docs,
    tickets, feedback, tasks, announcements, onboarding, activity, usage,
    roles: defaultRoles(),
    pages: ADMIN_PAGES,
    caps: ADMIN_CAPS,
    settings: {
      platformName: 'The Label Board',
      currency: 'NGN',
      trialDays: 14,
      slaHours: 4,
      referralPct: 15,
      taxPct: 7.5,
      invoicePrefix: 'INV',
      /* Where subscription money lands. Structured, because "GTBank · 0011223344 · The
         Label Board Ltd" in one box is impossible to validate or reconcile against. */
      settlement: {
        accountName: 'The Label Board Ltd',
        bankName: 'Guaranty Trust Bank',
        accountNumber: '0011223344',
        accountType: 'Current',
        currency: 'NGN',
        branch: 'Victoria Island, Lagos',
        sortCode: '058152036',
        swift: 'GTBINGLA',
        tin: '31459872-0001',
        payoutSchedule: 'T+1 working day',
        verified: true,
        verifiedOn: '2026-02-14'
      },
      /* Allowances are off while we are a startup. Kept as a switch, not deleted,
         so turning them on later needs no rework. */
      allowances: { enabled: false, housingPct: 15, transportPct: 10 },
      pensionDefaultRate: 8,
      notify: { sound: 'chime', volume: 70, popups: false,
        alerts: { payment: true, signup: true, failed: true, ticket: true, churn: true, payroll: false } },
      integrations: [
        { name: 'Supabase', detail: 'Database & auth', state: 'connected' },
        { name: 'Flutterwave', detail: 'Card & transfer payments', state: 'connected' },
        { name: 'Email (SMTP)', detail: 'Receipts & announcements', state: 'connected' },
        { name: 'WhatsApp Business', detail: 'Concierge hand-off', state: 'setup' }
      ]
    }
  };
})();

/* restore any saved role edits / settings */
(function restore() {
  try {
    const r = JSON.parse(localStorage.getItem('tlb_admin_roles') || 'null');
    if (Array.isArray(r) && r.length) DB.roles = r;
    const s = JSON.parse(localStorage.getItem('tlb_admin_settings') || 'null');
    if (s) Object.assign(DB.settings, s);
  } catch (e) { /* ignore */ }
})();
function saveRoles() { try { localStorage.setItem('tlb_admin_roles', JSON.stringify(DB.roles)); } catch (e) {} }
function saveSettings() { try { localStorage.setItem('tlb_admin_settings', JSON.stringify(DB.settings)); } catch (e) {} }
