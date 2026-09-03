# Going live — a fresh Supabase project, then Netlify, then the domain

This is the runbook for standing the whole thing up properly, in the order
that costs least. Follow it top to bottom; each step says how to check it
worked before you move on, because a wrong step here fails quietly rather
than loudly.

**Do the database first.** It is the cheapest thing to get right today and
the most expensive to change once real studios have data in it.

---

## Before you touch anything: what runs without a backend

The customer app is local-first. Most of what you want to test needs none of
this and can be tested right now on the live URL:

- branch and studio scoping, the studio switcher
- payment methods and the money-moved breakdown
- trades, production stages, measurements
- pay setup, allowances, pension, payslips
- everything in Settings

What genuinely needs the steps below: tenant isolation with real logins, team
sign-in, feedback reaching the operator console, cloud sync and realtime, and
PWA install over HTTPS on a real phone.

So do not hold up your testing for this. Run them in parallel.

---

## 0. Prove the migrations still build a working database

Before creating anything, run the three suites. They build a database from
`supabase/migrations/` **alone**, in filename order, and attack it.

```bash
node supabase/tests/app_schema_harness.mjs
```

```bash
node supabase/tests/rls_harness.mjs
```

```bash
node supabase/tests/feedback_rls_harness.mjs
```

All three must be green. The first one is the one that matters most here: it
checks that every table and function the shipped code names is actually
created by a migration, and that every column the app writes exists on the
table it writes to. It exists because five objects the app uses every day
(`app_state`, `profiles`, `suppliers`, `platform_audit` and
`platform_tenant_summary()`) were once created by hand and were missing from
the migrations entirely — a fresh project would have failed silently.

---

## 1. Create the project

Supabase → **New project**. Region closest to your customers (Europe West or
Africa, not US). Save the database password somewhere real.

Then from **Project Settings → API**, copy:

- the **Project URL**
- the **anon / public** key — safe to ship in a browser, it is designed for it
- the **service_role** key — never put this in any file in this repo

---

## 2. Run the migrations

From the repo root, with the Supabase CLI linked to the new project:

```bash
supabase db push
```

If you would rather paste SQL by hand, run the files in
`supabase/migrations/` in **filename order**, all seven, without skipping:

```
20260827090000_tenant_isolation.sql     the tenant spine + row-level security
20260827090100_saas_admin.sql           the console's own subscriber tables
20260827090200_staff_management.sql     our staff, tickets, tasks
20260827090300_rls_hardening.sql        tightens the above
20260827090400_partner_portal.sql       partners, referrals, payouts
20260827090500_feedback.sql             studios talking to us
20260828090000_app_runtime.sql          what the running apps talk to
```

**Do not run any loose .sql from the repo root.** There aren't any any more,
and that is deliberate: the old ones created `businesses`, `platform_admins`
and `customers` with older shapes, and because they used
`create table if not exists`, whichever ran first would win and the security
policies would land on the wrong columns.

**Check it worked.** In the SQL editor:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;
```

You should see `app_state`, `businesses`, `branches`, `customers`,
`feedback`, `feedback_replies`, `memberships`, `orders`, `partners`,
`platform_admins`, `platform_audit`, `products`, `profiles`, `staff`,
`suppliers`, `transactions` and the `tlb_*` set. If `memberships` is missing,
stop — every security policy calls `app.in_scope()`, which reads it, and
nothing is isolated without it.

---

## 3. Deploy the two Edge Functions

```bash
supabase functions deploy admin-api
```

```bash
supabase functions deploy team-admin
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by Supabase; you do not set them.

`admin-api` is the operator console's only door to the database. It checks
`platform_admins` server side and logs every read to `platform_audit`. That
is why the console never queries a table directly, and why the service_role
key never leaves the server.

---

## 4. Make yourself a platform admin

Auth → Users → **Add user** with your own email and a password. Copy the
UUID, then:

```sql
insert into public.platform_admins (id, name, role, active)
values ('<your-uuid>', 'Kayode', 'owner', true);
```

**Check it worked:** sign in to the console once step 6 is done and the
support page should say **Live**, not **Example data**.

---

## 5. Auth URLs — do this before testing sign-in

Authentication → URL Configuration:

- **Site URL:** the app's real address
- **Redirect URLs:** add the app, the console and the partner portal, each
  with `/**` on the end

Get this wrong and sign-in appears to work, then bounces the user back to the
login screen with no error. It is the single most common cause of "the login
loops".

While you are here: Authentication → Emails. The default Supabase sender goes
to spam often enough to matter. Point it at your own SMTP before you invite
anybody real.

---

## 6. Point the apps at the project

Three files, three edits.

**Customer app** — `site/layi_dashboard.html`, near the top:

```js
const SUPA_URL='https://<your-project>.supabase.co';
const SUPA_KEY='<anon key>';
```

**Admin console** — `admin/js/config.js`:

```js
SUPA_URL: 'https://<your-project>.supabase.co',
SUPA_KEY: '<anon key>',
```

**Partner portal** — `partners/js/config.js`: the same two lines.

The console and the portal ship blank on purpose: with these empty they run a
self-contained worked example, which is what you want for a demo. Filling
them in is what switches them to real data. Nothing else changes.

---

## 7. Deploy

Bump the service worker first, or installed phones keep serving the old
version:

```bash
node verify.js
```

Then bump `CACHE` in `site/sw.js`, commit, and merge to `main` using the
recipe in `netlify.toml` — the one that keeps main's own publish path. See
`CLAUDE.md`.

The customer app and the console already deploy from this repo. The partner
portal needs a Netlify site if it does not have one; the public website
should **not** be connected yet — it still carries placeholders and an
unsettled domain, and it is the only one of the four meant to be indexed.

---

## 8. The domain

Start this early: DNS takes hours, and the auth URLs in step 5, the PWA
install prompt and the email confirmation links all key off it.

Netlify → Domain settings → add the domain, follow the DNS records, wait for
the certificate. Then go back to step 5 and update the Site URL and redirect
URLs to the real domain, and update `web/js/config.js` and the `canonical` /
`og:url` tags on the website when that goes live.

---

## What to test once, in this order

1. **Sign in** on the app with an email and password. An email address is
   what triggers the cloud path; a username stays local.
2. **Create an order**, then check `app_state` has a row for that business
   and key.
3. **Sign in as a second business** and confirm you cannot see the first
   one's anything. This is the one worth doing by hand even though 71
   automated checks already cover it.
4. **Send feedback** from the app, then open the console's support page and
   confirm it arrives and says Live.
5. **Install on a phone** over HTTPS, go offline, create an order, come back
   online and confirm it syncs.

---

## Use a throwaway studio

Sign up a test business, not your real label, and plan to delete it. Once
there is real data, schema changes stop being edits and start being
migrations — so do your shaking-out on a tenant you are happy to drop.

---

## Rolling back

Nothing here touches a device's local data. If the project is wrong, blank
the three config files and every app falls back to local-only and the worked
example, exactly as it behaves today. That is the whole point of them
shipping blank.
