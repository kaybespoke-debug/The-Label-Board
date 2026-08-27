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
- `admin-deploy` publishes `admin/` — the operator console, and where the
  partner portal lives
- `web/` is not connected to Netlify yet. It still carries placeholders and an
  unsettled domain, so pushing it publishes nothing.

Day-to-day work happens on `admin-deploy`. Releasing the customer app means
merging it into `main`.

**The one thing to get right when you do.** The root `netlify.toml` is
deliberately different on the two branches: `publish = "site"` on `main`,
`publish = "admin"` on `admin-deploy`. Git will not warn you, because `main`
is an ancestor of `admin-deploy` and the merge is clean — it simply
fast-forwards the admin config over main's, and the customer app's site starts
serving the admin console to every studio.

So merge like this:

```bash
git checkout main && git merge --no-ff --no-commit admin-deploy && git checkout HEAD -- netlify.toml && git commit
```

Both copies of the file carry the same warning and the same recipe, so you do
not have to remember it. The permanent fix is to set each site's publish
directory in the Netlify dashboard and delete the file — a settings change on
live sites, so it is Kayode's call, not a commit.

Bump `CACHE` in `site/sw.js` before every release, or installed phones keep
serving the old version.

## Storage keys

Never rename a `layi_*` storage key. LAYI is now only the demo tenant's name,
but those keys are live data on real devices and renaming one wipes it.

## Local preview

`.claude/launch.json` has an entry per app. The customer app is **Customer App**
on port 8000.
