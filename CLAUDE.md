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
| **Database** — schema, row-level security, edge functions | `supabase/` | `SUPABASE_SETUP.md` | `node supabase/tests/rls_harness.mjs` |

The gate scripts and preview servers live at the repo root, never inside an
app folder, because every app folder is published to the public web.

## The customer app

`site/layi_dashboard.html` is the product. One file, no build step, no
dependencies — open it in a browser and it runs. It is around 7,100 lines and
holds all of its state in `localStorage` under `layi_dash_*` keys.

There used to be a second copy at the repo root. It is gone. If you ever find
a loose `layi_dashboard.html` outside `site/`, it is stale — do not edit it.

```bash
node verify.js
```

Twenty-three gates. Green before you start, green before you ship. A change
that turns a gate red is a regression: fix the cause, not the test. `HANDOFF.md`
explains what each gate exists to catch.

## Branches and deploys

- `main` publishes `site/` — **the customer app ships from here**
- `admin-deploy` publishes `admin/`
- `partners/` and `web/` have their own Netlify sites

`admin-deploy` currently contains everything on `main` plus 20 commits.

**Careful:** the root `netlify.toml` is deliberately different on the two
branches — `publish = "site"` on `main`, `publish = "admin"` on `admin-deploy`.
Merging `admin-deploy` into `main` as-is would point the customer app's site at
the admin console. Merge the folders you mean, not the branch, until that is
fixed with Netlify branch contexts.

## Storage keys

Never rename a `layi_*` storage key. LAYI is now only the demo tenant's name,
but those keys are live data on real devices and renaming one wipes it.

## Local preview

`.claude/launch.json` has an entry per app. The customer app is **Customer App**
on port 8000.
