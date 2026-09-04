/* ============================================================
   config.js — where the portal gets its data and its logins.

   Blank on purpose, exactly like the studio app. With these empty the
   portal runs a self-contained demo on this device: sign-in works, the
   one-time code is shown on screen, and three example partners let you
   see what the portal looks like for someone with forty referrals and
   for someone who joined last week.

   Fill both in and the same portal signs people in against Supabase Auth
   and reads their real rows. Nothing else changes: auth.js picks the
   provider from whether these are set.

   The anon key is designed to be public and is safe in this file. The
   service role key is not, and must never appear here.
   ============================================================ */

const CONFIG = {
  SUPA_URL: 'https://eskubrbgbcbaejynjxvh.supabase.co',
  SUPA_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVza3VicmJnYmNiYWVqeW5qeHZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjYzOTYsImV4cCI6MjEwNDEwMjM5Nn0.BayRVXbba6Ga8jjMwd36bQh112s_2FWMbhCcE5R1_fc',

  /* How long a session lasts before we ask again. Thirty days suits a
     portal people check when they remember to, and the only thing behind
     it is their own figures. Supabase enforces its own expiry on top of
     this once it is wired up. */
  sessionDays: 30,

  /* Where a referral link points. The join page resolves the code through
     app.claim_referral_code(), which is the only thing an anonymous
     visitor may call. */
  joinUrl: 'https://thelabelboard.com/join/'
};

CONFIG.live = !!(CONFIG.SUPA_URL && CONFIG.SUPA_KEY);
