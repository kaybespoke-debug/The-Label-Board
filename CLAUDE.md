# The Label Board — repo map

One repo, four separate apps and one shared database. They deploy to four
separate Netlify sites on purpose, so a bad release on one cannot take down
the others.

**Work on one app per chat.** Before changing anything, be clear which of the
four you are in, and read that app's doc first.

| App | Lives in | Read first | Gates |
|---|---|---|---|
| **Customer app** — what tenants use to run their label | `site/` | `HANDOFF.md` | `node verify.js` |
| **Admin console** — our operator control centre | `admin/` | `SUPABASE_SETUP.md` | — |
| **Partner portal** — referral partners | `partners/` | `PARTNERS.md` | `node audit_partners.js` |
| **Public website** — marketing, the only one meant to be found by Google | `web/` | `WEBSITE.md` | `node audit_web.js` |
| **Database** — schema, row-level security, edge functions | `supabase/` | `SUPABASE_SETUP.md` | `node supabase/tests/app_schema_harness.mjs` |

The gate scripts and preview servers live at the repo root, never inside an
app folder, because every app folder is published to the public web.

One gate spans all three front ends rather than belonging to any of them:

```bash
node audit_safearea.js
```

One more spans the app and the database rather than belonging to either:

```bash
node audit_withheld_money.js
```

A figure somebody may not see is **absent** from their device, not zero. The
price lives in `order_pricing` behind `money` and what has been paid in
`order_settlement` behind `receivables`, so a role without them pulls an order
with no `value` on it at all. Every money formatter in the app read
`fmtNum(n||0)` until October, which would have printed that as ₦0 — a
confident wrong number on the screen where somebody decides whether an order
has been paid for. Run it after touching any money formatter or any order
screen.

Nothing may be pinned to an edge of the screen without allowing for what the
phone puts there, and no table may push the whole page sideways. Both are
invisible on a desktop browser, which is where all of this gets built, and both
go wrong the same way every time: a status bar printing through a modal title,
a navigation bar under the home indicator, or a six-column table making the
document wider than the window so every heading sits off the left edge. Run it
after touching any stylesheet or any table.

That gate is static, because a page that scrolls sideways needs a layout engine
to detect and these run in node. To actually measure:

```bash
node build_overflow_harness.js
npx http-server . -p 3005 -c-1
```

Then open `http://localhost:3005/_overflow_tmp/console.html` (and `portal.html`)
at 320, 414 and 768. It renders every page of the console and the portal —
neither of which can be opened without signing in — into the real shell with
the real stylesheet. The file itself documents the two ways this measurement
lies to you; read them before trusting a result.

## The customer app

`site/layi_dashboard.html` is the product. One file, no build step, no
dependencies — open it in a browser and it runs. It is around 7,100 lines and
holds all of its state in `localStorage` under `layi_dash_*` keys.

There used to be a second copy at the repo root. It is gone. If you ever find
a loose `layi_dashboard.html` outside `site/`, it is stale — do not edit it.

```bash
node verify.js
```

Twenty-five gates. Green before you start, green before you ship. A change
that turns a gate red is a regression: fix the cause, not the test. `HANDOFF.md`
explains what each gate exists to catch.

## Branches and deploys

**Work on `main`. Release from `main`. There is no merge step any more.**

- `main` publishes `site/`, the customer app, and `web/`, the marketing site
  at thelabelboard.com. A push rebuilds both.
- `admin-deploy` publishes `admin/`, the operator console. It is **not a
  working branch**, and has not been one since the middle of September.

This section used to say the opposite: that day-to-day work happened on
`admin-deploy` and reaching `main` meant a merge. It stopped being true and
the file did not notice, so on 30 September a session read it, committed to
the branch it named, and had the push refused as out of place. By then `main`
was **29 commits ahead** of `admin-deploy`, including `Release layi-v66`. The
repo had been working this way for a fortnight.

That is the second time this file has described a deploy arrangement that had
already changed. Check a claim like this against `git log` and the Netlify
dashboard before you act on it, not against this paragraph.

### What `admin-deploy` is still for

One thing: its `netlify.toml` says `publish = "admin"`, so the console's
Netlify site has a branch that serves the console rather than the customer
app. That is the whole of it.

Measured on 30 September, `admin-deploy` holds **no content that `main` does
not**, except that one line:

- `admin/` and `partners/` are byte-identical on both branches, so the console
  and the portal are not running behind. Nothing published from this branch is
  stale.
- no file exists on `admin-deploy` that is missing from `main`.
- `admin-deploy` is 29 commits behind on `site/`, `web/`, `supabase/` and the
  docs. That costs nothing to what it publishes, but it does mean **anyone
  reading the repo while checked out on `admin-deploy` is reading a fortnight
  of stale documentation.** Read the docs on `main`.

`partners/` is listed in the old text as publishing from here too. That could
not be confirmed from the repo: a `netlify.toml` sets one publish directory
and this one sets `admin`, so the portal's site must have its own directory
set in the dashboard. Check there before relying on it either way.

### If you ever do merge the two

**Read this first, 5 October: the root `netlify.toml` may not be read by any
site at all.** All four app folders carry their own `netlify.toml` saying
`publish = "."`, which only resolves when the Netlify site has a base
directory set — and the live responses say that is what is happening.
`thelabelboard.com` serves `web/netlify.toml`'s `SAMEORIGIN` and
`strict-origin-when-cross-origin`, not the root file's `DENY` and
`no-referrer`; the partner portal serves `partners/netlify.toml`'s; and the
customer app served **no security header at all** on the day the root file
set five of them. That cost a release: `layi-v71` put the headers in the
root file, `audit_headers.js` read the same file and passed, and nothing
reached a browser until the block was moved into `site/netlify.toml`.

So the warning below describes a disaster that probably cannot happen the
way it is written. It is left standing because "probably" is not good
enough for a change that would serve the operator console to every studio,
and because this file has twice described a deploy arrangement that had
already changed. **Settle it in the Netlify dashboard before relying on it
either way** — which is what this section already told you to do.

The root `netlify.toml` is deliberately different: `publish = "site"` on
`main`, `publish = "admin"` on `admin-deploy`. Git will not warn you. A clean
merge takes the admin config over main's, and the customer app's site starts
serving the operator console to every studio.

```bash
git checkout main && git merge --no-ff --no-commit admin-deploy && git checkout HEAD -- netlify.toml && git commit
```

Both copies of the file carry the same warning and the same recipe. The
permanent fix is to set each site's publish directory in the Netlify dashboard
and delete the file, which is a settings change on live sites and so Kayode's
call rather than a commit.

### Releasing

1. `node verify.js`, and `node audit_safearea.js` after any stylesheet or
   table change
2. Bump `APP_VERSION` in `site/layi_dashboard.html` **and** `CACHE` in
   `site/sw.js` to the same value. `audit_build_stamp` fails if they disagree,
   because a version that disagrees with the service worker reports a fix as
   landed while the browser is still serving the build before it. Installed
   phones keep the old version until `CACHE` moves.
3. Commit on `main` and push. Netlify does the rest.

## The database

Every object the apps talk to is created by a migration in
`supabase/migrations/`, applied in filename order. Nothing is created by hand
any more, and there is now a way to prove it rather than believe it. Five
objects once were made by hand and were missing from the migrations entirely,
so a fresh project would have run none of it. It happened again on 29
September with sixteen more, including the two columns the whole
audit-authenticity claim rests on. Twenty suites guard it:

```bash
node supabase/tests/app_schema_harness.mjs     # a fresh DB actually runs the app
node supabase/tests/rls_harness.mjs            # no tenant can reach another
node supabase/tests/feedback_rls_harness.mjs   # what studios tell us stays theirs
node supabase/tests/partner_rls_harness.mjs    # no partner can reach another
node supabase/tests/tlb_policy_harness.mjs     # our own books, as Supabase serves them
node supabase/tests/onboarding_harness.mjs      # a new account becomes a studio it can sign into
node supabase/tests/billing_harness.mjs         # every studio is on the books, and revenue is what arrived
node supabase/tests/plan_limits_harness.mjs     # a plan is a ceiling, not a suggestion
node supabase/tests/partner_commission_harness.mjs  # 8%, twelve months, and it stops when they do
node supabase/tests/referral_fraud_harness.mjs  # nobody earns a commission off themselves
node supabase/tests/plan_feature_harness.mjs   # Basic cannot write a Pro feature, by app or by hand
node supabase/tests/trial_harness.mjs           # a free trial gives away the product, never the commission
node supabase/tests/account_directory_harness.mjs # which app each account belongs to, and who may ask
node supabase/tests/storage_rls_harness.mjs    # a studio reaches its own photos and nobody else's
node supabase/tests/lifecycle_harness.mjs       # a studio can close, come back, and be purged without taking our books with it
node supabase/tests/restore_harness.mjs         # a studio exported, purged, and put back from the file alone
node supabase/tests/subscription_harness.mjs    # the price is ours, a retry is not a second payment, and not paying costs writing not work
node supabase/tests/cross_app_harness.mjs       # the console, the portal and the website against the backend the app just got
node supabase/tests/upgrade_harness.mjs         # a studio that is ALREADY working survives the migrations about to be applied to it
```

`upgrade_harness` is the one to run before a promotion. Every other suite
builds the whole schema at once, which cannot answer the only question that
matters on the day: does a database that already has studios, people and data
in it survive the migrations. It stops at whatever production has applied,
puts a working studio in, and only then applies the release.

And one check that is not a suite, because it compares the repo with a real
project rather than testing behaviour:

```bash
node supabase/tests/schema_inventory.mjs --check       # the migrations still produce what is recorded
node supabase/tests/schema_inventory.mjs --fingerprint # one md5, to compare with a live project
node supabase/tests/schema_inventory.mjs --sql         # the query to run there
```

**Never apply SQL to a project except from a migration file.** That is the
rule the sixteen broke. Nothing in the repo referenced those objects by name,
so no gate that reads the app could have found them; only counting both sides
did. `supabase/schema_inventory.txt` is the snapshot that makes it one command
each way. `RECOVERY.md` is what to do when data is actually gone.

The first reads the shipped code for every table, function and column it
names — the two Edge Functions included, because they are the half that
talks to the tables the browser is deliberately not allowed to touch. So a
new table the app starts using is checked the day it is used.

**`tlb_policy_harness` builds a different database on purpose.** Every other suite
runs the migrations at a bare Postgres, which is right for the tenant
tables because they grant and revoke explicitly. It is wrong for the `tlb_`
tables, which granted nothing and relied on an absence — and a bare
Postgres has that absence for free while Supabase does not. Supabase ships
`alter default privileges in schema public grant all on tables to anon,
authenticated` on every project, so a table in `public` is reachable with
the public anon key from the moment it exists. `tlb_policy_harness` sets
that default first, so the policies are actually reached and tested.

Four of the twenty are different in kind. Every other suite proves something is
walled off; `plan_limits_harness`, `partner_commission_harness` and
`referral_fraud_harness` and `plan_feature_harness` prove something is REFUSED, and both show the refusal and then the same operation
succeeding once it is allowed. A check that only ever sees the refusal cannot
tell a working rule from a broken table.

`SUPABASE_SETUP.md` is the go-live runbook.

## Storage keys

Never rename a `layi_*` storage key. LAYI is now only the demo tenant's name,
but those keys are live data on real devices and renaming one wipes it.

## Local preview

`.claude/launch.json` has an entry per app. The customer app is **Customer App**
on port 8000.
