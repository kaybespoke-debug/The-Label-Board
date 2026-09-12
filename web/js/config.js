/* ==========================================================================
   The Label Board — website configuration
   EVERYTHING Kayode is likely to change lives here and nowhere else.
   Pages carry the same values as plain text so the site still reads
   correctly with JavaScript switched off; site.js keeps them in step and
   audit_web.js fails the build if the two ever drift apart.
   ========================================================================== */

const SITE = {
  /* ---- identity ---- */
  name: 'The Label Board',
  tagline: 'Run the business behind your label.',
  domain: 'thelabelboard.com',

  /* ---- where the other apps live -------------------------------------
     appUrl is REAL as of 12 Sep 2026: app.thelabelboard.com is a CNAME onto the
     customer app's Netlify site, with its own certificate. The guess happened to
     be right, so the value never changed — only this comment did.

     partnerPortalUrl is STILL A PLACEHOLDER. The portal is not deployed
     anywhere, because it signs people in with an emailed one-time code and there
     is no SMTP yet, so a deployed portal would be a door nobody can open. The
     button that uses this still renders; it lands on nothing.            */
  appUrl: 'https://app.thelabelboard.com',
  partnerPortalUrl: 'https://partners.thelabelboard.com',

  /* ---- how people reach us ----
     The number is real, confirmed by Kayode on 11 Sep 2026. It is currently the
     same line the LAYI site uses, so it will want splitting once the two are
     answered by different people.

     All of these are real as of 12 Sep 2026. The hello@ mailbox exists and the
     Instagram handle is ours.

     There is deliberately only ONE address. support@ used to be separate, which
     for a business of this size means a second inbox for somebody to forget to
     open, and a customer writing to it wondering why nobody answered. One
     address that is read beats two that are not.                        */
  email: 'hello@thelabelboard.com',
  supportEmail: 'hello@thelabelboard.com',
  phoneDisplay: '+234 706 273 8923',
  phoneDial: '+2347062738923',
  whatsapp: '2347062738923',
  instagram: 'thelabelboard',
  city: 'Lagos, Nigeria',

  /* ---- where enquiries go ---------------------------------------------
     The four forms post to Netlify exactly as they always have. That path
     needs no JavaScript, carries Netlify's spam filtering, and stays the
     one that must never break.

     They now ALSO post here, so the operator console can see an enquiry
     instead of somebody remembering to open Netlify's dashboard. It is a
     second copy, not a replacement: if this call fails, or the visitor has
     scripts off, Netlify still has the submission and nobody is lost.

     This key is meant to be public — it ships in every browser. It is worth
     saying what it can actually do here, because "anon key on a marketing
     site" should make somebody nervous: exactly one function,
     submit_enquiry, which can only INSERT. It cannot read an enquiry, list
     them, change one, or reach any other table or function on the project.
     That is enforced by grants in the database and tested by
     storage_rls_harness, which fails if anything else ever becomes
     reachable by this key.                                              */
  supabaseUrl: 'https://eskubrbgbcbaejynjxvh.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVza3VicmJnYmNiYWVqeW5qeHZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjYzOTYsImV4cCI6MjEwNDEwMjM5Nn0.BayRVXbba6Ga8jjMwd36bQh112s_2FWMbhCcE5R1_fc',

  /* ---- trial ----
     One length, for both self-serve plans. Bespoke used to have a shorter
     trial of its own, which read as a penalty for paying more; it is now
     agreed and invoiced per business, so what it offers is a conversation
     rather than a countdown.                                             */
  trialDays: 14,

  /* ---- what each market pays -----------------------------------------
     Prices are SET per currency, not converted from naira in the browser.
     A live rate would change what the page says without anybody deciding
     it, and the naira rate moves enough that a shop could be quoted two
     different numbers on two days. Each line below is a decision.

     Naira is the real one: it is the price the admin console bills and the
     one audit_web.js checks against it. THE OTHER FIVE ARE SEEDS. They were
     worked out by converting the naira price at roughly 1,530 to the
     dollar in August 2026 and rounding to a clean number, and they are
     Kayode's to set properly. A price for a market is a decision about
     that market, not arithmetic on a rate. Change a number here and every plan, the
     yearly price and the comparison table all follow.

     Yearly is ten months for twelve, worked out rather than typed, so it
     can never disagree with the monthly price.                          */
  /* Keyed by PLAN ID, not by the name a customer is sold. The ids are
     starter / pro and they are what the database stores; the names on the
     page are Basic and Pro. There is deliberately no `premium` here \u2014
     Bespoke is priced per business and quoting a number for it on a public
     page is the one thing it must never do. */
  currencies: [
    { code: 'NGN', symbol: '\u20a6', label: 'Nigeria (naira)',        starter: 27000, pro: 65000 },
    { code: 'USD', symbol: '$',       label: 'United States (dollar)', starter: 18,    pro: 42 },
    { code: 'GBP', symbol: '\u00a3', label: 'United Kingdom (pound)', starter: 14,    pro: 33 },
    { code: 'CAD', symbol: 'CA$',     label: 'Canada (dollar)',        starter: 24,    pro: 58 },
    { code: 'EUR', symbol: '\u20ac', label: 'Europe (euro)',          starter: 17,    pro: 40 },
    { code: 'GHS', symbol: 'GH\u20b5', label: 'Ghana (cedi)',         starter: 215,   pro: 520 }
  ],

  /* Which one a visitor is shown first. Read from the browser's own time
     zone and language, never from an IP lookup: that would mean calling a
     third party on every page load, telling them who is reading our
     pricing, and adding a dependency to a site that has none. A guess is
     all this is, so the picker is always there to correct it, and the
     choice is remembered. */
  currencyByZone: {
    'Africa/Lagos': 'NGN', 'Africa/Accra': 'GHS', 'Europe/London': 'GBP',
    /* every Canadian zone is an America/ one, and the last resort in
       guessCcy sends America/ to dollars, so Canada has to be named */
    'America/Toronto': 'CAD', 'America/Vancouver': 'CAD', 'America/Edmonton': 'CAD',
    'America/Winnipeg': 'CAD', 'America/Halifax': 'CAD', 'America/St_Johns': 'CAD',
    'America/Regina': 'CAD', 'America/Montreal': 'CAD'
  },
  currencyByRegion: {
    NG: 'NGN', GH: 'GHS', GB: 'GBP', US: 'USD', CA: 'CAD',
    IE: 'EUR', FR: 'EUR', DE: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', PT: 'EUR', BE: 'EUR'
  },

  /* ---- partner programme, mirrors PARTNERS.md and the portal ---- */
  partner: {
    base: 15, silver: 18, gold: 22, platinum: 25,
    holdDays: 31, payoutDay: '5th of the month', minPayout: 10000
  },

  /* ---- customer referral reward ----
     PROPOSED, not yet built into billing. One month of credit each when a
     studio you referred pays for their first month.                    */
  referral: { monthsFree: 1, upgradeAfter: 3 }
};

/* Values the pages ask for by name through data-cfg. */
SITE.text = {
  email: SITE.email,
  supportEmail: SITE.supportEmail,
  phone: SITE.phoneDisplay,
  city: SITE.city,
  instagram: '@' + SITE.instagram,
  trialDays: String(SITE.trialDays),
};
SITE.link = {
  email: 'mailto:' + SITE.email,
  supportEmail: 'mailto:' + SITE.supportEmail,
  phone: 'tel:' + SITE.phoneDial,
  whatsapp: 'https://wa.me/' + SITE.whatsapp,
  instagram: 'https://instagram.com/' + SITE.instagram,
  app: SITE.appUrl,
  partnerPortal: SITE.partnerPortalUrl
};
