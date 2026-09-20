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

  /* ---- no trial ----
     There was a `trialDays: 14` here, quoted on eleven places across five
     pages. Kayode took it out on 18 Sep: the October cohort already gets a
     free month, so a trial on top of it gives the same business six weeks
     free, and nothing on this site ever ran self-serve anyway. Nobody gets
     an account until there has been a call, and the call is where they see
     it working on their own numbers.
     `audit_web.js` section 8 now fails if a trial is promised anywhere, so
     putting the key back is not enough to bring the offer back.           */

  /* ---- when we open ----
     The day the app goes on sale properly. ONE PLACE, because a date in
     two places is a date that will disagree with itself.

     CHANGE THIS AND NOTHING ELSE. The countdown on the home page, the word
     the page falls back to with JavaScript off, and the day the countdown
     takes itself off all read it.

     It is deliberately a date and not a countdown target dressed up as one:
     the page says "in November" on its own, and only becomes a number of
     days once the browser has worked it out. So if this is wrong, the site
     is vague rather than wrong.                                          */
  launchDate: '2026-11-01',
  launchMonth: 'November',

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

     Yearly is eleven months for twelve, worked out rather than typed, so it
     can never disagree with the monthly price.                          */
  /* Keyed by PLAN ID, not by the name a customer is sold. The ids are
     starter / pro and they are what the database stores; the names on the
     page are Basic and Pro. There is deliberately no `premium` here \u2014
     Bespoke is priced per business and quoting a number for it on a public
     page is the one thing it must never do. */
  currencies: [
    { code: 'NGN', symbol: '\u20a6', label: 'Nigeria (naira)',        starter: 20000, pro: 49000 },
    { code: 'USD', symbol: '$',       label: 'United States (dollar)', starter: 13,    pro: 32 },
    { code: 'GBP', symbol: '\u00a3', label: 'United Kingdom (pound)', starter: 10,    pro: 25 },
    { code: 'CAD', symbol: 'CA$',     label: 'Canada (dollar)',        starter: 18,    pro: 44 },
    { code: 'EUR', symbol: '\u20ac', label: 'Europe (euro)',          starter: 13,    pro: 30 },
    { code: 'GHS', symbol: 'GH\u20b5', label: 'Ghana (cedi)',         starter: 160,   pro: 390 }
  ],

  /* There were two lookup tables here, currencyByZone and currencyByRegion,
     which guessed a visitor's currency from the browser time zone and
     language. The picker now opens on NGN for everybody and they had no
     other reader, so they are gone rather than left looking live. To bring
     the guess back: restore them, restore guessCcy in site.js, and change
     one line to `remembered() || guessCcy()`.                           */

  /* ---- partner programme, mirrors PARTNERS.md and the portal ---- */
  partner: {
    base: 15, silver: 18, gold: 22, platinum: 25,
    holdDays: 31, payoutDay: '5th of the month', minPayout: 10000
  },

  /* There was a `referral: { monthsFree: 1 }` here: a second scheme that
     gave a customer and the customer they sent a free month each. It was
     marked PROPOSED and never built into billing, and on 20 Sep 2026 it
     was folded into the one programme. Every business now has a referral
     code that pays the same 8% as a partner's, and the referred business
     gets the ordinary price rather than a reward of its own.

     Nothing here replaces it, deliberately: the rate lives in the
     database (partner_rate_bands) and the website reads it through the
     portal rather than keeping a third copy. */
};

/* Values the pages ask for by name through data-cfg. */
SITE.text = {
  email: SITE.email,
  supportEmail: SITE.supportEmail,
  phone: SITE.phoneDisplay,
  city: SITE.city,
  instagram: '@' + SITE.instagram,
  launchMonth: SITE.launchMonth,
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
