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
  domain: 'thelabelboard.app',

  /* ---- where the other apps live -------------------------------------
     PLACEHOLDERS. Point these at the real Netlify URLs once each app is
     deployed. Until then every button that uses them still renders, it
     simply lands on a site that is not published yet.                  */
  appUrl: 'https://app.thelabelboard.app',
  partnerPortalUrl: 'https://partners.thelabelboard.app',

  /* ---- how people reach us ----
     PLACEHOLDERS. Replace with the real address and number.            */
  email: 'hello@thelabelboard.app',
  supportEmail: 'support@thelabelboard.app',
  phoneDisplay: '+234 800 000 0000',
  phoneDial: '+2348000000000',
  whatsapp: '2348000000000',
  instagram: 'thelabelboard',
  city: 'Lagos, Nigeria',

  /* ---- the demo studio anyone can open ---- */
  demoUser: 'owner',
  demoPass: 'layi2025',

  /* ---- trial ---- */
  trialDays: 14,

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
  demoUser: SITE.demoUser,
  demoPass: SITE.demoPass,
  trialDays: String(SITE.trialDays)
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
