/* ============================================================
   config.js — where the console gets its data.

   Blank on purpose, exactly like the studio app and the partner portal.
   With these empty the console runs on the worked example in data.js:
   every screen is populated, every number moves, and you can show
   somebody what the product does without a database behind it.

   Fill them in and the console signs in against Supabase Auth and reads
   real studios through the admin-api Edge Function. Nothing else in the
   console changes: live.js picks the source from whether these are set,
   and merges what it finds into the same DB the demo uses, so every
   page, query and detail view carries on working untouched.

   FN_URL is derived rather than typed, because getting it wrong points
   the console at a function that does not exist and the failure looks
   like "no tickets" rather than "wrong URL".

   The anon key is designed to be public and is safe in this file. The
   service role key is not, and must never appear here — the console
   never holds it. Cross-tenant reads happen inside the Edge Function,
   which checks platform_admins server side and logs what it served.
   ============================================================ */

const CONFIG = {
  SUPA_URL: 'https://eskubrbgbcbaejynjxvh.supabase.co',
  SUPA_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVza3VicmJnYmNiYWVqeW5qeHZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjYzOTYsImV4cCI6MjEwNDEwMjM5Nn0.BayRVXbba6Ga8jjMwd36bQh112s_2FWMbhCcE5R1_fc',

  /* How often the inbox re-reads itself while the console is open.
     Support staff leave this on a second monitor all day, so a quiet
     poll beats a refresh button they have to remember to press. */
  inboxRefreshSeconds: 90
};

CONFIG.live = !!(CONFIG.SUPA_URL && CONFIG.SUPA_KEY);
CONFIG.FN_URL = CONFIG.SUPA_URL ? CONFIG.SUPA_URL.replace('.supabase.co', '.functions.supabase.co') : '';
