# CURRENT PRODUCTION PROMOTION — READY, NOT EXECUTED

Prepared 29 September 2026. **Nothing in this document has been done to
production.** Production is untouched and still serving `layi-v46`.

Release name: **layi-v60**.

---

## 1. Exact commits being promoted

Branch `phase-1b-team-invitations`, head **`1418b6c`**, **44 commits** ahead of
`main`. `main` is at the commit production is serving now.

The last seven, which are this week's work:

| commit | what |
|---|---|
| `1418b6c` | Cross-app audit, upgrade rehearsal, installed-app updates |
| `146e4a2` | Outstanding list current, two stale claims corrected |
| `cd63e93` | Batch G: Flutterwave (code only — see §11) |
| `7d4378c` | Batch F: monitoring, closing, export, restore |
| `64690a3` | Customer contact details split out; sensitive-data probe |
| `e44b1bd` | Delivery status |
| `83c4c30` | A permission not granted is DENIED, not unanswered |

Everything before those is Phase 0 and Batches A–E, already listed in
`DELIVERY_STATUS.md`.

**54 files changed, ~15,000 insertions.** Roughly half is tests.

---

## 2. Migrations production needs

Production's last applied migration is `20260928160000_phase0_role_authority`.
Twelve are pending, and they must be applied **in filename order**:

```
20260929100000_rbac_foundation.sql
20260929110000_rbac_membership_authority.sql
20260929120000_accept_invitation_role_id.sql
20260929130000_rbac_enforcement.sql
20260929140000_orders_relational.sql
20260929150000_policy_roles_and_search_path.sql
20260929160000_batch_f_operations.sql
20260929170000_objects_that_were_never_in_a_migration.sql
20260929180000_studio_restore.sql
20260929190000_flutterwave_subscriptions.sql
20260929200000_a_studio_that_stops_stops_earning.sql
20260929210000_read_only_needs_a_way_to_pay.sql
```

**The one destructive step, named plainly.** `20260929140000` copies
`customers.phone/email/whatsapp/address` into `public.customer_contacts` and
then drops those four columns. Copy first, drop second, one transaction. The
upgrade rehearsal asserts the phone number is on the other side; the reverse is
one statement and it is in §8.

**Why the Flutterwave migration is in this list** even though Flutterwave is
blocked: `20260929210000` recreates a function `20260929190000` defines, and
creates the flag table that switches the only behaviour either of them can
cause. Splitting them would leave the flag table absent and the guard live.
Without the Edge Functions and the secrets — neither of which is being
promoted — the billing schema is inert: nothing can take a payment, nothing can
change a plan, and the checkout UI is hidden. Say so if you would rather hold
all three back, and I will re-cut it.

---

## 3. Edge Functions production needs

| function | action | note |
|---|---|---|
| `team-admin` | **redeploy** (prod is on v4) | permission-driven gate, invitations carrying a role, resend, cancel, password reset through Resend |
| `auth-recover` | **deploy new**, `--no-verify-jwt` | Supabase SMTP has been dead since 13 September; this is the way back in |
| `admin-api` | **redeploy** (prod is on v11) | reports its own failures to `error_reports`; stops echoing raw errors |
| `billing` | **not promoted** | Flutterwave blocked |
| `billing-webhook` | **not promoted** | Flutterwave blocked — no public door opens in production this release |

The customer app asks `billing` whether card payment is configured. With the
function absent that call fails, is caught, and the answer is "not configured",
which is the correct answer. Checked, not assumed.

---

## 4. Frontend and `main`

- `site/layi_dashboard.html` — **layi-v46 → layi-v60**. The bulk of the change.
- `site/sw.js` — cache `layi-v60`, and the update behaviour in §6.
- `web/` — **no changes.** The marketing site rebuilds identically.
- `netlify.toml` — see §5.

What a studio actually gets: team invitations that arrive and work; roles and
permissions that refuse rather than hide; branch scope; a studio switcher for
anybody in more than one; password recovery that sends; orders that survive a
device; saves that retry and say so when they fail; conflicts that ask instead
of guessing; an activity log nobody can rewrite; studio settings only the owner
can change; a server-side export of everything; the ability to close; and an
installed app that updates.

### `admin/js/live.js` is changed and does NOT go to `main`

It belongs to `admin-deploy`. **But the database is shared**, so the moment the
migrations land, the console is looking at the new backend whether or not its
own code has moved. The fix — a suspended studio no longer reading as an active
paying subscriber — should go out in the same window. That is a second, small
promotion to `admin-deploy`, and I have not done it either.

---

## 5. Netlify

No dashboard changes. One thing to get right in the merge:

```bash
git checkout main && git merge --no-ff --no-commit phase-1b-team-invitations && git checkout HEAD -- netlify.toml && git commit
```

This branch was cut from `admin-deploy` and carries `publish = "admin"`. `main`
must keep `publish = "site"` or the customer app's site serves the admin
console to every studio. Confirmed by reading both files today: branch line 30
says `admin`, main's line 34 says `site`.

Pushing this branch **also redeploys the staging site**, which builds from it
with a base directory of `site`. That is wanted — staging should be running
what is about to be promoted — but it is worth knowing it happens on the push,
before the merge.

---

## 6. Mobile / PWA update behaviour

**The bug, found by reading `sw.js`.** It called `self.skipWaiting()` on
install. A new worker therefore took control in the middle of a session while
the tab carried on running the old HTML and the old JavaScript against the new
cache. Nothing reloaded, so nothing changed on screen — for as long as the app
stayed open, which on an installed iPhone app can be weeks. That is the
installed app sitting on an older release.

What is in this release:

- **The worker installs and waits.** The page decides when to swap, because
  only the page knows whether somebody is halfway through an order form.
- **The page actually checks**: on start, every time the app comes back to the
  front, and every thirty minutes it stays open. An installed app can go days
  without a navigation, and a worker is only re-fetched on one.
- **Navigations are fetched `no-store`**, so the browser's own HTTP cache
  cannot answer for the one file that decides which version is running.
- **Safety before reload**: never while a field is focused or a sheet is open.
  The outbox is deliberately *not* part of that test — it lives in
  localStorage and survives a reload, which is why it was built that way.
- **Automatic when it is free**: if an update is ready and the app is in the
  background, it applies itself, so you come back to the new version already
  running. Otherwise an **Update** pill waits in the header and re-checks when
  tapped.
- **It confirms afterwards**: one toast, "Updated to layi-v60".
- **The version is visible**: Settings → About shows the build that is
  *running* and, beneath it, the build this device has *cached*. When they
  differ it turns amber, which is exactly the state you mean by "my app is out
  of date". That is how to check the phone.
- **Old caches retire** as before; the photo cache is versioned separately and
  survives, so an update never re-downloads a studio's library.
- **Offline still works**: the shell is still cached, the photos are still
  cached, and a failed navigation still falls back.
- **Staging cannot contaminate production**: different origins, so different
  cache stores. Nothing shared, by the browser's own rules.

`admin/sw.js` and `partners/sw.js` have the same `skipWaiting` pattern. They
are on `admin-deploy` and are **not** fixed in this release. Worth doing next.

---

## 7. Production preflight results

| check | result |
|---|---|
| Staging green | **Yes.** 20 database suites, `verify.js`, `audit_safearea`, and all four app gates. 1,780 assertions. |
| Staging is running this code | **Yes.** Staging's schema fingerprint `93ddbbc0…` over 838 objects is byte-identical to what the migrations produce. |
| Production has no pre-existing drift | **Yes, and this was worth checking.** Production's fingerprint is `3f03eb388a4ea8eb9e060b210f4ea5ad` over 619 objects, and a database built from the repo's migrations *up to production's level* produces exactly the same. Production is the repo, with nothing applied by hand. |
| Expected fingerprint after promotion | `93ddbbc0ecceaea7e41e1b937e836ffc`, 838 objects. Anything else means stop. |
| Production row counts, now | 9 studios, 9 memberships, 9 profiles, 53 app_state rows, 20 customers, 0 relational orders, 0 transactions, 10 accounts, 12 partners, 2 referrals, 0 payments |
| Any studio not `active` | **None.** All nine are active, so nothing is affected by the read-only work even if the flag were on. |
| Any trial about to expire | **None.** No production studio has a trial end date set. |
| Every member is an owner | **Yes** — 9 memberships across 9 studios. The RBAC change therefore cannot reduce anybody's access on day one. |
| The upgrade itself | **Rehearsed.** `upgrade_harness.mjs` builds production's exact schema, puts a working studio in it with an owner, a manager, 21 synced keys and clients with phone numbers, applies the twelve migrations, and then checks the studio still works. 29 assertions. |
| Secrets needed | `RESEND_API_KEY` (already in use by `admin-api` in production — **confirm**), optionally `INVITE_FROM` and `STUDIO_APP_URL` (defaults are correct for production). **No Flutterwave secrets.** |
| Supabase Auth config | Redirect URLs must include `https://app.thelabelboard.com/`. Production already sends invitations with links there, so this is a confirmation rather than a change. |

**The single most dangerous thing in this release, and why it is not.** A studio
created before RBAC has no roles and its membership has no `role_id`. The
seeding trigger only fires on INSERT, so all nine production studios depend on
the migration's backfill. If it missed them, an owner would open the app and see
nothing, with no error to explain it. The rehearsal asserts the four roles are
seeded, the owner role's permissions are granted, every membership is pointed at
a role, and then writes **every one of the 21 keys the live app syncs, one at a
time**.

---

## 8. Rollback

**Frontend — instant and safe.** Revert the merge commit on `main`; Netlify
redeploys `layi-v46`. The old app against the new schema is precisely what the
upgrade rehearsal exercises, so this is a real option and not a hope. Installed
phones: the new worker waits rather than seizing control, so a revert reaches
them the same way a release does.

**Edge Functions — one command each.** `supabase functions deploy team-admin`
from the previous commit restores v4. `auth-recover` is new, so rolling it back
is deleting it; nothing else calls it.

**Database — two levels.**

1. *Forward fix, for the one destructive step.* If the customer split is wrong,
   the data is not gone — it is in `customer_contacts`:

   ```sql
   alter table public.customers
     add column if not exists phone text, add column if not exists email text,
     add column if not exists whatsapp text, add column if not exists address text;
   update public.customers c set phone = k.phone, email = k.email,
          whatsapp = k.whatsapp, address = k.address
     from public.customer_contacts k where k.customer_id = c.id;
   ```

2. *Full restore*, from Supabase's daily backup or point-in-time recovery,
   into a **new project first** — never over the live one. `RECOVERY.md` has
   the procedure and the fingerprint check to confirm what you restored.

**Order matters for rollback to stay cheap:** database first, verify, then the
frontend. If the frontend is bad, revert only the frontend. Do not promote
`main` until §9's smoke test has passed against the new schema with the old app
still serving.

---

## 9. Production smoke test

To run immediately after the migrations, **before** merging `main`, with the
old app still live:

1. Sign in as the owner account. It still works.
2. The dashboard loads; customers load; orders load.
3. Create an order, edit it, save it. It saves.
4. Move an order through a production stage.
5. Record a payment; open an invoice.
6. Change a studio setting and save it.
7. Row counts unchanged: 9 / 9 / 9 / 53 / 20 / 10 (studios, memberships,
   profiles, app_state, customers, accounts).
8. `select md5(...)` fingerprint equals `93ddbbc0ecceaea7e41e1b937e836ffc`.

Then merge `main`, and after the deploy:

9. Hard-reload the app on desktop. Settings → About reads **Build layi-v60** and
   **Offline copy layi-v60**, both in grey.
10. On the installed phone: open it, leave it, come back. Either it updates on
    its own or the **Update** pill appears; tap it and About reads layi-v60.
11. Roles and permissions: the owner sees everything; invite somebody as a
    manager and confirm the invitation arrives and the role is what was chosen.
12. Password recovery: request a reset for a real address and confirm the email
    arrives from Resend.
13. Sync state: go offline, change something, come back, watch it send.
14. Tenant isolation probes stay green: `node supabase/tests/rls_harness.mjs`
    and `node tools/sensitive_data_probe.js` against production.

---

## 10. What remains staging-only after this release

- **Flutterwave, entirely.** The `billing` and `billing-webhook` functions, the
  FLW secrets, and the checkout buttons. The schema goes but cannot be used.
- **`platform_flags.enforce_unpaid_readonly`**, shipped **off**. Locking a
  studio out for non-payment is a billing action, and a studio told "writing
  starts again when the subscription is paid" must actually have a way to pay.
  It goes on in the same release that switches card payment on.
- **`admin/js/live.js`** and the two other service workers, which belong to
  `admin-deploy`.

---

## 11. Flutterwave

**BLOCKED EXTERNALLY — ACCOUNT NOT READY.**

The code is written, applied to staging and tested: 93 assertions covering the
price being ours, the webhook being matched rather than believed, a retry not
being a second payment, and a cancelled term keeping the month it paid for. It
needs two test-mode secrets on staging and one webhook URL pasted into the
Flutterwave dashboard, and then a real test payment end to end.

Until that has passed, production has no billing Edge Function, no FLW secrets,
no checkout buttons, and no enforcement. It promotes later as a normal tested
release.

---

## CROSS-APP IMPACT

### Customer app
- **Required changes:** all of §4. `layi-v46 → layi-v60`.
- **Tested:** `verify.js` (23 gates), `audit_safearea`, and 20 database suites.
  Rendered in a browser at desktop and 375px: the Subscription panel, the
  read-only banner, the closing panel, the update pill, and the fault reporter
  end to end with a real thrown error and a real unhandled rejection.

### Admin console
- **Required changes:** one. `liveToSubscriber` mapped a **suspended** studio to
  "active" and counted its list price as MRR — a studio locked out of its own
  books showing on our side as one that is paying and fine. It now maps
  honestly and carries `liveStatus`, `closedAt` and `purgeAfter`, so an operator
  can tell a studio the owner closed on Tuesday from one that lapsed in March.
  `platform_tenant_summary` gained the two columns to carry them.
- **Not required:** everything else. The console reaches the database only
  through `admin-api` under the service role, which holds BYPASSRLS, so none of
  the new policies touch it. Its authority is `tlb_staff`, untouched.
- **Tested:** `cross_app_harness.mjs` performs the console's own writes against
  a **suspended** studio with the read-only flag up — set the plan, record a
  payment, reopen it, set limits, write a note, raise storage, add a seat and
  remove it — and asserts every one still works while the owner's own writes are
  refused. Plus `audit_console_clicks` (185), `audit_console_pages` (141) and
  `audit_console_live`.

### Partner app
- **Required changes:** none to the portal's code.
- **One backend defect found and fixed.** Commission accrues on
  `partner_referrals.lapsed_on` being null and nothing else — not on payments,
  not on the studio. Closing a studio and a term running out are both new this
  week and neither touched that table, so a referrer would have gone on earning
  8% a month of a subscription nobody was paying, for the rest of the twelve
  months. A business leaving `active` now lapses its referral, which voids the
  pending ledger rows through machinery that already existed and nothing was
  calling. It goes both ways, so a studio suspended in error and put back does
  not cost the partner their year.
- **Tested:** `cross_app_harness.mjs` — accrue, close, assert the void, assert
  nothing accrues next month, reopen, assert it earns again; then purge the
  studio entirely and assert the partner still sees the referral by name, with
  its value, its ledger intact and the dead link honestly null. Plus
  `audit_partners` (408) and `partner_rls_harness` (82).

### Website
- **Required changes:** none, and that is the right answer — marketing pages do
  not change because backend internals did.
- **Tested:** the four published prices are compared against `plan_prices`
  character for character (Basic ₦20,000 / ₦220,000, Pro ₦49,000 / ₦539,000);
  `trial.html` is still `noindex` and still linked from nowhere, so nothing
  promises a card step that is not switched on. Plus `audit_web` (2,262).

### Backend shared
- **Compatibility confirmed.** `upgrade_harness.mjs` is the proof: production's
  exact schema, a studio already working in it, the twelve migrations, and then
  the same rows, the same people and the same access afterwards.
- The impact map, surface by surface:

| change | customer | admin | partner | web |
|---|---|---|---|---|
| `business_roles`, `business_role_permissions` | reads | — | — | — |
| `memberships.role_id` | reads | writes (default filled by trigger) | — | — |
| `team_invitations` | reads/writes via `team-admin` | invites studios via `admin-api` | — | — |
| `orders`, `order_costs` | reads/writes | counts only | — | — |
| `customers` / `customer_contacts` | reads/writes both | — | — | — |
| `audit_log` | writes, reads behind a permission | reads via `admin-api` | — | — |
| account deletion | owner-initiated | — | — | — |
| studio close / purge | owner-initiated | **sees the state** | **commission follows it** | — |
| `partners` / `partner_referrals` | — | reads | reads/writes | — |
| `plan_prices`, `billing_intents`, `payment_events` | reads prices only | — | — | **must match the page** |
| `error_reports` | writes | reads (platform admin) | — | — |
| `platform_flags` | — | — | — | backend only |

---

## STOP

Nothing above has been executed against production. Say go and I will run §2,
§3, §5 and §9 in that order, stopping at the first thing that does not match.
