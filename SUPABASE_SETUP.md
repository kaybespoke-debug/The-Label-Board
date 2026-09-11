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

## Where this has got to

Steps 0 to 3 are **done**. The project exists, the schema is on it, and both
Edge Functions are deployed and verified.

```
Project     the-label-board
Ref         eskubrbgbcbaejynjxvh
Org         The Label Board (free tier)
Region      eu-west-2 (London — the shorter hop to Lagos than Frankfurt,
            because Nigerian international fibre lands through London)
URL         https://eskubrbgbcbaejynjxvh.supabase.co
```

**Two projects still exist, and the names are the wrong way round.** Check the
ref, never the name, before touching either:

| On screen | Region | Ref | What it is |
|---|---|---|---|
| `the-label-board` | eu-west-2 | `eskubrbgbcbaejynjxvh` | **The live one.** All four apps point here |
| `The Label Board` | eu-central-1 | `gcdrkoitjqwbidcfgyzl` | The old hand-built one. **Delete this** |

The prettier name is the dead one. Read the ref.

The old project is the hand-built one: `memberships` never existed on it, so
nothing was isolated, and half the app's tables were missing. It holds one
business, `11111111-1111-1111-1111-111111111111`, which is the hardcoded
`LAYI_BIZ` placeholder, with 18 state rows and 11 customers of demo data.
Nothing real. **No app code points at it any more** — that was true when this
was written and is not now, so do not go looking for a reference to remove.

**The Supabase CLI on this machine is still linked to the old one.**
`supabase/.temp/linked-project.json` names `gcdrkoitjqwbidcfgyzl`, so a
`supabase db push` or `supabase functions deploy` from this repo would land on
the dead project and quietly appear to work. The file is gitignored, so it is
per-machine and nobody else's checkout is affected. Fix it before running
either command:

```bash
supabase link --project-ref eskubrbgbcbaejynjxvh
```

What is left for you: creating the test accounts (3b) and any other operator
accounts, because both mean setting a password, and steps 5 and 8, because
they need the domain.

---

## 0. Prove the migrations still build a working database  ✅ done

Run the five suites. They build a database from `supabase/migrations/`
**alone**, in filename order, and attack it.

```bash
node supabase/tests/app_schema_harness.mjs
```

```bash
node supabase/tests/rls_harness.mjs
```

```bash
node supabase/tests/feedback_rls_harness.mjs
```

```bash
node supabase/tests/partner_rls_harness.mjs
```

```bash
node supabase/tests/tlb_policy_harness.mjs
```

All five must be green. The first matters most here: it checks that every
table, function and column the shipped code names is actually created by a
migration — the two Edge Functions included. It exists because five objects
the app uses every day (`app_state`, `profiles`, `suppliers`,
`platform_audit` and `platform_tenant_summary()`) were once created by hand
and were missing from the migrations entirely.

The last one is newer and builds its database differently on purpose. See
the note in `CLAUDE.md`: Supabase grants `anon` blanket access to new tables
in `public` and a bare Postgres does not, so a suite that never had those
grants cannot tell you whether your policies would hold on a real project.

---

## 1. Create the project  ✅ done

Region closest to your customers (Europe West, not US). The database
password is generated at creation; if you ever need it, reset it from
**Project Settings → Database**.

From **Project Settings → API**:

- the **Project URL** and **anon / public** key are in step 6 below
- the **service_role** key — never put this in any file in this repo

---

## 2. Run the migrations  ✅ done

All thirteen applied, in filename order:

```
20260827090000_tenant_isolation.sql        the tenant spine + row-level security
20260827090100_saas_admin.sql              the console's own subscriber tables
20260827090200_staff_management.sql        our staff, tickets, tasks
20260827090300_rls_hardening.sql           tightens the above
20260827090400_partner_portal.sql          partners, referrals, payouts
20260827090500_feedback.sql                studios talking to us
20260828090000_app_runtime.sql             what the running apps talk to
20260904120000_fix_tlb_policy_recursion.sql  four console tables were unreadable
20260904130000_console_gateway_schema.sql    the console could not have signed anyone in
20260904140000_expose_browser_rpcs.sql       the partner portal could not either
20260904150000_seed_platform_owner.sql       who operates the platform
20260904160000_studio_onboarding.sql         an account now gets a studio to belong to
20260904170000_seed_test_studios.sql         six studios, one per trade
20260904180000_partner_onboarding.sql        a partner can exist before their account
```

**Do not run any loose .sql from the repo root.** There aren't any any more,
and that is deliberate: the old ones created `businesses`, `platform_admins`
and `customers` with older shapes, and because they used
`create table if not exists`, whichever ran first would win and the security
policies would land on the wrong columns.

To re-do this on some future project, `supabase db push` with the CLI
linked; the migrations are the source of truth and nothing is created by
hand any more.

**Checked, and worth re-checking after any change.** The live schema was
compared against one built from the migration files alone — every column,
every policy with its full USING and WITH CHECK expression and its role
list, every RLS enable/force flag, every function, every view. Identical.
The only difference left is that Supabase grants `authenticated` SELECT and
UPDATE on `feedback_ref_seq` on top of the USAGE the migration grants, which
is harmless.

If `memberships` is ever missing, stop — every security policy calls
`app.in_scope()`, which reads it, and nothing is isolated without it.

---

## 3. Deploy the two Edge Functions  ✅ done

```bash
supabase functions deploy admin-api --no-verify-jwt
```

```bash
supabase functions deploy team-admin --no-verify-jwt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by Supabase; you do not set them.

`admin-api` is the operator console's only door to the database. It checks
`platform_admins` server side and logs every read to `platform_audit`. That
is why the console never queries a table directly, and why the service_role
key never leaves the server.

**`--no-verify-jwt` is deliberate and is not a hole.** Both functions verify
the caller themselves: they take the forwarded `Authorization` header, call
`auth.getUser()` against it, and return 401 if it is missing or invalid,
then check `platform_admins` or `profiles` before doing anything. Leaving
the gateway's own check on would reject the browser's CORS preflight, which
carries no `Authorization` header, so the console would fail with a CORS
error instead of a login error. Verified after deploying: preflight 200, no
token 401, anon key alone 401.

---

## 3b. Create the test accounts  ← you, next

Six studios and one partner are already in the database, each waiting for
the address that will claim it. Nothing about them needs building: create
the account in **Auth → Users → Add user**, and a trigger on `auth.users`
attaches it as the owner the moment it appears — the business, the branch,
the profile and the membership all get written for you.

Set whatever password you like. It is yours, it is set in the dashboard,
and it appears nowhere in this repo.

| Create this account | and you get |
|---|---|
| `test.bespoke@thelabelboard.com` | Adé Bespoke — one workroom, Yaba |
| `test.footwear@thelabelboard.com` | Okoro & Sons Shoes — the bench, Aba |
| `test.leather@thelabelboard.com` | Ìfé Leather — the studio, Lekki |
| `test.rtw@thelabelboard.com` | House of Nneka — the boutique, Ikoyi |
| `test.fabrics@thelabelboard.com` | Balogun Fabrics — the shop, Balogun Market |
| `test.multi@thelabelboard.com` | LAYI — four studios, on trial |
| `test.partner@thelabelboard.com` | Chidi Okafor, a silver partner with two referrals |

Each studio arrives already set to its own trade, so the production board
shows *Last & Pattern → Clicking → Closing* for the shoemaker and *Cloth
Received → Measured & Cut → Packed* for the fabric shop. That is generated
from the app's own presets, not written out again in SQL.

**Tick "Auto Confirm User"**, or the account cannot sign in until the
confirmation email is dealt with, and email is step 5.

**They arrive with no orders.** The app fills an empty cloud from the device
on first sign-in, so to give a studio its full worked data — customers,
orders, staff, the lot — load the matching example in the app *before* you
sign in as that studio, and it will be pushed up as theirs. Signing in on a
clean device instead gives you a correctly configured, empty studio, which
is the better test of what a real new subscriber sees.

**An address nobody prepared still works.** Any other account gets a fresh
business of its own, named from `business_name` in the user metadata, or
from the email if there is none. That is the real signup path, and it is the
same code.

---

## 4. Make yourself a platform admin  ✅ done

Kayode / `layiojomo@gmail.com` is in `platform_admins` as `owner`, and the
console signs in with that account. If you add other operators, the four
roles `admin-api` knows are `owner`, `finance`, `support` and `developer` —
each allowed a different set of actions, and `owner` is the only one that
can read the audit log.

The console prefills `kayode@thelabelboard.com` on its sign-in screen, which
is the branded identity, not the account. **Sign in with the address the
Auth user actually has.**

<details>
<summary>The original step 4, for adding an operator later</summary>

This is the one step that cannot be done for you, because it means setting a
password.

Auth → Users → **Add user** with your own email and a password. Copy the
UUID, then in the SQL editor:

```sql
insert into public.platform_admins (id, name, role, active)
values ('<your-uuid>', 'Kayode', 'owner', true);
```

`role` must be one of `owner`, `finance`, `support`, `developer` — those are
the four `admin-api` knows, and each one is allowed a different set of
actions. `owner` is the only one that can read the audit log.

**Check it worked:** sign in to the console once step 6 is done and the
support page should say **Live**, not **Example data**. If it says your
account is not a Label Board staff account, the row is missing or `active`
is false — the message cannot tell those apart.

</details>

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

Three files, three edits. **Do step 4 first.** Filling these in is what
switches each app from its worked example to the real database, and until
your `platform_admins` row exists the console will switch to Live and then
refuse you, which looks like a broken deploy rather than a missing row.

The values, for all three:

```
URL   https://eskubrbgbcbaejynjxvh.supabase.co
key   the anon / public key from Project Settings → API
```

The anon key is safe in a browser — it is designed for it, and every table
in this project refuses it. That was checked directly: with the anon key
alone, all 34 tables answer `permission denied`, including the ones holding
our own subscribers and payments.

**Customer app** — `site/layi_dashboard.html`, near the top. This one is
**not blank today**: it still points at the old project, so it is a replace
rather than a fill-in.

```js
const SUPA_URL='https://eskubrbgbcbaejynjxvh.supabase.co';
const SUPA_KEY='<anon key>';
```

**Admin console** — `admin/js/config.js`:

```js
SUPA_URL: 'https://eskubrbgbcbaejynjxvh.supabase.co',
SUPA_KEY: '<anon key>',
```

**Partner portal** — `partners/js/config.js`: the same two lines.

The console and the portal ship blank on purpose: with these empty they run a
self-contained worked example, which is what you want for a demo. Filling
them in is what switches them to real data. Nothing else changes.

Once the customer app is pointed at the new project and you have signed in
once to confirm it works, **delete `gcdrkoitjqwbidcfgyzl`**. Leaving a second
project answering the same schema names is how the wrong one gets debugged
for an afternoon.

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
