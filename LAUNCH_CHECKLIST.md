# Launch checklist

What "launch-ready" means, as a finite list. Read from the shipped code, the
live database and the live Netlify config on 5 October 2026. Read-only:
nothing was changed to produce it.

**S** = under a day. **M** = a few days. **L** = a week or more.

---

## The short version

**Eleven blockers.** One of them is the spine: **a real studio cannot give
anybody else an account**, so every role, every permission and the whole
money boundary built over the last fortnight are unreachable in practice.
Two are about losing work, and they share one cause. Two are security
defaults the app never got. The rest are money being wrong or a screen
promising something that cannot happen.

The thing I did not expect to find: **the app has no security headers at
all** — no CSP, no X-Frame-Options — while the admin console, the partner
portal and the marketing site all have them. The app is the one holding
clients' measurements and photographs.

| # | Cat | Blocker | Effort |
|---|---|---|---|
| B1 | 1 | 14 synced keys are last-write-wins over a whole array | L |
| B2 | 1 | Unsynced offline edits are replaced on reconnect (same cause as B1) | — |
| B3 | 2 | No security headers on the customer app: no CSP, framable | S |
| B4 | 2 | No in-app privacy policy or terms, and no DPA for studios | M |
| B5 | 2 | Leaked-password protection is off on production Auth | S |
| B6 | 2 | Email delivery unconfirmed — password reset depends on it | S to check |
| B7 | 3 | Material cost never reaches an order, so margin is overstated | L |
| B8 | 3 | Money In by channel reports every payment as "Studio" | M |
| B9 | 3 | Two payment forms, two different method lists | S |
| B10 | 4 | Team invitations are off — only the owner can have an account | M–L |
| B11 | 4 | Face ID unlock can never work on the live app | S |
| B12 | 4 | Stock-used recipes can never be applied | M |

---

# BLOCKERS

## B1 — Fourteen synced keys are last-write-wins over a whole array
**Category 1, loses data. Effort: L.**

**What happens.** Every one of the 17 keys in `STATE_KEYS` is pushed to the
server as a whole blob: `pushState` queues the entire array
([:2801](site/layi_dashboard.html#L2801)) and the outbox upserts it with
`onConflict: 'business_id,key'` and **no revision check**
([:2812](site/layi_dashboard.html#L2812)). Coming back the other way,
`hydrateFromCloud` does `saveLocal(r.key, r.data)` — the cloud copy
**replaces** the device's whole array
([:3887](site/layi_dashboard.html#L3887)).

Orders and payments were fixed in v64–v66: they are rows, they carry `rev`,
and a conflicting write is detected and surfaced. Those three keys are
explicitly excluded from the blob hydrate. **Nothing else was fixed.**

Still exposed: `layi_dash_staff` (team and pay), `layi_dash_products`,
`layi_dash_supplies` (stock), **`layi_dash_bills` (expenses)**, **`layi_dash_pots`
(funds)**, `layi_dash_attendance`, `layi_dash_leave`, `layi_dash_shifts`,
`layi_dash_appts` (diary), `layi_dash_tasks`, `layi_dash_anns`,
`layi_dash_campaigns`, `layi_dash_log`, `layi_dash_settings`.

**User impact:** an owner who adds a staff member on their laptop and logs
an expense on their phone loses one of the two, with no error and no
conflict shown — and two of those keys are the studio's money.

**Why it is not already causing incidents:** invitations are off (B10), so
most studios have exactly one account. One person with a phone and a laptop
is still enough.

**Note:** this is the same table and the same shape the order money came out
of. The fix is the same shape too — rows with a revision, or a per-key
merge. Phase 1 item 1 already moves `layi_dash_supplies` out, so that is one
of the fourteen done.

## B2 — Unsynced offline edits are replaced on reconnect
**Category 1, loses data. Effort: folded into B1.**

Same cause, different moment. The outbox survives a closed tab
([:2822](site/layi_dashboard.html#L2822)), which is right, but
`hydrateFromCloud` overwrites local arrays on every sign-in and reconnect
independently of whether the outbox has drained. An edit that never reached
the outbox is gone; one that did will win and destroy the other device's.
Either way somebody's afternoon disappears.

**User impact:** a tailor edits stock in a workroom with no signal, the
signal returns, and either their change or the office's is silently lost.

## B3 — No security headers on the customer app
**Category 2, leaks data. Effort: S.**

`netlify.toml` for `site/` contains a publish directory and one redirect
and nothing else. There is **no `_headers` file anywhere in the repository**.
So the app that every studio signs into has:

- **no Content-Security-Policy** — and the app itself records this at
  [:10781](site/layi_dashboard.html#L10781): *"There is no
  Content-Security-Policy on this site today"*
- **no X-Frame-Options** — the signed-in app can be framed by any site
- **no Referrer-Policy**, no Permissions-Policy, no HSTS

`admin/netlify.toml` has `X-Frame-Options: DENY` and `Referrer-Policy:
no-referrer`. `partners/netlify.toml` has the same. `web/netlify.toml` has
those plus a Permissions-Policy. **The customer app, which is the only one
holding clients' names, addresses, phone numbers, measurements and
photographs, has none of them.**

**User impact:** a logged-in studio can be framed and clickjacked, and any
script that gets into the page can read the live session token and
exfiltrate the studio's entire client list, measurements and photographs.

**Effort is S** because the allow-list is already known: `cdn.jsdelivr.net`
(Supabase client and SheetJS), `fonts.googleapis.com` and
`fonts.gstatic.com`, and the two Supabase project origins. `audit_partners.js`
already checks the portal's `toml` for `X-Frame-Options`, so there is a gate
pattern to copy.

## B4 — No in-app privacy policy or terms, and no DPA for studios
**Category 2, NDPR. Effort: M.**

The marketing site is in good shape: `web/privacy.html` draws the
controller/processor distinction explicitly, names measurements among the
records a studio keeps, sets retention periods, and states NDPR access,
correction, deletion and portability rights with a thirty-day response.
`web/terms.html` exists.

What is missing:

- **Nothing in the app links to either.** A grep of
  `site/layi_dashboard.html` for "privacy" or "terms" finds only a
  studio's own payment-terms field.
- **There is no acceptance step.** A studio starts processing their clients'
  personal data without ever being shown the terms.
- **There is no data processing agreement.** The privacy policy itself says
  *"we are the data processor for the records your business keeps inside the
  app"*. Under the NDPA a processor needs an agreement with each controller.
  Every studio is a controller. There is no such document anywhere in the
  repository.

**User impact:** studios process clients' personal data — including
measurements and photographs of people — with no agreement in place and no
visible policy, which is the studio's exposure as much as ours.

**The export and deletion halves are built**, which is worth saying:
`export_studio` gives a studio its whole record, and
`request_account_deletion` / `confirm_account_deletion` /
`delete_my_account` exist with a `lifecycle_harness` behind them. It is the
paperwork and the linking that is absent, not the capability.

## B5 — Leaked-password protection is off on production Auth
**Category 2. Effort: S.**

Supabase advisor `auth_leaked_password_protection`, confirmed against the
live project today. Compromised passwords are not checked against
HaveIBeenPwned.

**User impact:** the owner account is the only account most studios have,
and it can be set to a password already in a public breach corpus. One
dashboard toggle.

## B6 — Email delivery is unconfirmed, and password reset depends on it
**Category 1 and 2. Effort: S to establish, unknown to fix.**

`forgotPassword()` ([:5000](site/layi_dashboard.html#L5000)) deliberately
uses our own `auth-recover` Edge Function rather than Supabase's mailer, and
that function is deployed on production. What I **cannot** confirm from here
is whether a custom SMTP sender is configured on the live project, and the
project notes still carry "SMTP / email spam" as an open owner task.

**User impact:** if mail does not deliver or lands in spam, a studio that
forgets its password is locked out of its own business records with no
self-service route back — and the same channel is what invitations (B10)
will need.

**Listed as a blocker because it is unverified, not because it is known
broken.** Send one real reset to a Gmail and a Yahoo address and this either
closes in ten minutes or becomes a real piece of work.

## B7 — Material cost never reaches an order, so margin is overstated
**Category 3, gets money wrong. Effort: L. (Phase 1 items 1–2, as agreed.)**

When stock is used on an order the deduction is real — the quantity comes
off the material and a movement is logged against the order reference
([:7362](site/layi_dashboard.html#L7362)) — but **no cost is written to the
order**. The only material cost an order has is the hand-typed list beside
the stock picker.

**User impact:** every bespoke order that consumed materials reports a
margin higher than the truth, by exactly the cost of the cloth. The section
note reads "nothing recorded" next to a populated stock list.

**State:** item 1's database half is **built and gated** — four tables, cost
behind `seeCost`, the perpetual moving average, the migration, a 62-check
harness, and a dry run showing all 48 live materials crossing with their
opening averages. Committed, applied nowhere. Item 1's app half and item 2
remain, with the four decisions you have now given.

## B8 — Money In by channel reports every payment as "Studio"
**Category 3, gets money wrong. Effort: M. (Phase 1 item 5.)**

Orders and sales have **no channel field at all** — `draft.channel` is never
written anywhere in the file, and the order form has no such input.
`txnChannel` ([:9096](site/layi_dashboard.html#L9096)) therefore falls
through: "Website" if the order came from the website, "Studio" if
`o.channel` happens to be `showroom`, **and "Studio" for everything else.**
And a payment logged in the app never records a channel either
([:8429](site/layi_dashboard.html#L8429)), so the explicit branch is only
ever taken by imported payments.

**User impact:** the channel report is not approximately wrong, it is
uniformly wrong. A studio reading it would conclude every naira came from
the showroom and cut its Instagram spend on that basis.

## B9 — Two payment forms offer two different method lists
**Category 3, gets money wrong. Effort: S. (Decision 3, agreed.)**

`openPayment` uses `PAY_METHODS` — the studio's own editable list from
Settings → "How you get paid", seven entries
([:8422](site/layi_dashboard.html#L8422)). The other payment form uses
`IN_METHODS`, hardcoded, four entries
([:9136](site/layi_dashboard.html#L9136)), and it is the **only** place
`IN_METHODS` is used.

**User impact:** a studio that adds "Mobile money" in Settings sees it on
one payment screen and not the other, so the same payment is recorded
differently depending on where it was entered, and method totals mix two
vocabularies.

## B10 — Team invitations are off: only the owner can have an account
**Category 4, claims something that doesn't work. Effort: M–L.**

`TEAM_INVITES_ENABLED = false`
([:16116](site/layi_dashboard.html#L16116)). The owner is told honestly
("Temporarily unavailable"), and the reason is recorded in the code:
inviting somebody currently makes them the **owner of a brand new studio
named after them**, because the provisioning trigger cannot attach an
account to a business that already exists. `public.team_invitations` has RLS
enabled and no policy, so it is deny-all.

**User impact:** The Label Board is sold as a studio operating system with
roles, branch scope and permissions. A real studio cannot put a second
person in it. Everything built over the last fortnight — the five roles, the
`seeCost` boundary, the `receivables` boundary, branch scope, the accountant
role standardised across nine studios — is **unreachable for any real
studio**, because there is nobody to hold a role but the owner.

**This is the spine of the list.** Nothing else on it changes what a studio
can actually do as much as this.

**State:** branch `phase-1b-team-invitations` is 1 commit ahead of main and
38 behind. `PHASE_1B_DESIGN.md` (25 September, design and audit only) says
*"Most of this is already built. The schema was designed for invitations and
then never wired up"*, verified against production at the time.
`public.accept_invitation` exists. The `team-admin` Edge Function exists,
is owner-gated, and already handles listing and editing.

## B11 — Face ID unlock can never work on the live app
**Category 4, claims something that doesn't work. Effort: S.**

`biometricUnlock()` refuses unless `localLoginAllowed()`
([:5775](site/layi_dashboard.html#L5775)), and that function is
`!SUPA_URL` — false on `app.thelabelboard.com`. So the unlock always ends
at "Sign in with your email address and password."

Meanwhile `renderBiometricSetting()`
([:5796](site/layi_dashboard.html#L5796)) enables the toggle on **any**
capable device with no such check, enrolment genuinely succeeds, the setting
reports "On for this device", and the unlock button appears on the login
screen.

This is collateral damage from the v63 credential fix, which correctly
disabled username/PIN sign-in on backend-connected installs. Biometric
unlock rode on that same local-account path and was killed with it.

**User impact:** a studio turns on Face ID, is told it is on, sees the
button, presses it, and is told to type their password — every time.

**Effort: S** to hide the toggle and the button when a backend is connected,
which is honest. **M** to make it real by binding the credential to a
Supabase session instead of a local account.

## B12 — Stock-used recipes can never be applied
**Category 4, claims something that doesn't work. Effort: M. (Phase 1 item 3.)**

`applyRecipesToOrder()` ([:6820](site/layi_dashboard.html#L6820)) is
written, correct, and **has zero call sites**. The slot where its button
belongs is `${recipesExist()?``:''}`
([:7166](site/layi_dashboard.html#L7166)) — an empty template that renders
nothing whichever way its own test goes, and has been that way since the
first commit in this repository.

The Settings panel it sits under is headed **"Stock used per product
(auto-deduct from inventory)"**
([:1545](site/layi_dashboard.html#L1545)).

**User impact:** a studio works through every garment type entering the
materials each one consumes, under a heading promising automatic deduction,
and nothing ever reads a single row of it.

---

## Checked in the sweep and NOT blockers

Worth recording, because three of these were on your list and they turned
out to be honest.

| Feature | Verdict |
|---|---|
| **Automatic WhatsApp updates** | Toggle saves and sends nothing — **and the copy says so**: *"Automatic sending needs a WhatsApp Business API sender connected to your live account… this switch just remembers your choice."* The token is only ever in an Edge Function, and no `send-whatsapp` function is deployed. A dormant seam that admits it. |
| **Notifications** | Honest. The panel ends with *"Sounds and pop-ups fire while the app is open."* `PUSH_PUBLIC_KEY` is empty so `subscribeToPush()` returns immediately — nothing half-built, nothing discarded. Only quibble: the button reads "Enable phone / desktop alerts", which over-promises slightly. After-launch copy fix. |
| **Storage** | Fully built. Photos upload to the `studio-media` bucket, records hold `sb:<path>` strings, signed URLs are cached so they survive offline, and inline data URIs are a deliberate transient state that `sweepInlinePhotos()` moves up when signal returns. Production holds 0 objects only because no studio has used it. |
| **Install as app** | Real. `beforeinstallprompt` on Android and desktop, a guided sheet on iPhone, and `navigator.storage.persist()` is requested, which is the right mitigation against browser eviction. |
| **Plan / Subscription** | Honest, and carefully so. The panel asks the server whether billing is `configured` and **hides the plan buttons when it is not**, on the stated grounds that "a button that apologises is worse than no button". Prices come from `plan_prices` server-side; the browser cannot suggest one. |
| **`payment_methods`, `plan_state_keys`, `referral_attempts` with RLS and no policy** | Not leaks. RLS enabled with no policy denies everything, and the app never reads any of the three. |
| **Import** | The four v67 bugs are fixed, and no live studio has ever used it: zero `historical` orders, zero imported payments, zero import audit entries across all nine studios. |
| **Close and reopen a studio** | `close_studio` and `reopen_studio` exist, are owner-gated, and `lifecycle_harness` covers close → reopen → purge → restore. |
| **Password reset** | Works, through our own `auth-recover` function rather than Supabase's mailer. Subject to B6. |

## Account lifecycle, end to end

| Step | State |
|---|---|
| Sign-up | **Operator-provisioned.** There is no sign-up form in the app; the marketing site collects an enquiry and an account is created for them. Fine for an invite-only launch, and worth deciding deliberately rather than by default. |
| Email verification | Supabase default. **Depends on B6.** |
| Password reset | Built and deployed. **Depends on B6.** |
| Inviting staff | **Off. B10.** |
| Roles | Built, gated and proven across five roles at the API — but unreachable while B10 stands. |
| Closing a studio | Built, owner-gated, harnessed. |
| Reopening | Built, harnessed. |
| Deleting an account | Built: preview, request, confirm, and a 30-day purge window. |

---

# AFTER LAUNCH

Not padding this. Everything here is real and none of it stops an outside
studio using the app safely.

**Flagged first, because it gates charging rather than using:** card payment
is not live. The Subscription panel correctly hides plan buttons until
Flutterwave is configured, so nothing lies — but **no studio can pay.** If
the first outside studios are paying customers this moves into the blocker
list; if they are free pilots it does not. Your call, and it is the one item
here I would not simply defer without deciding.

- **Phase 1 item 4 — the variance report.** Expected vs actual by date,
  product, material and staff, with a threshold. Needs items 1–3 first.
- **Phase 1 item 6 — one `code` field.** Today there are three: `sku` on
  shop products, `sku` on variants with **no input to set it**, `code` on
  product types, `code` on order lines, and `sku` on materials that only the
  CSV importer can write. No generation, no uniqueness, not searchable, and
  only the order line's own code is printed.
- **Shop products to rows.** `public.products` exists and holds zero rows.
  The product `cost` has exactly the problem the material cost had. Agreed
  as a later phase.
- **The duplicate example data.** Adé Bespoke and Seed Multi Studio hold
  byte-identical demo data (same fingerprints over order ids, prices and
  every material). Harmless, but every cross-studio figure is doubled, which
  will read as a bug in any report.
- **"Enable phone / desktop alerts"** should say what it does.
- **The seven empty shell studios** — one member each, a mid-September
  sign-in, two synced keys. Decide whether they are kept as fixtures or
  cleared.
- **`order_items` is unused** — zero rows, nothing in the app writes it, and
  it now sits behind `money` because it holds a price.
- **Self-serve sign-up**, if the invite-only model is not permanent.
- **Passkeys proper**, if B11 is fixed the cheap way now.
- **Push notifications**, if they are wanted at all — the service worker
  listener is already there.
- **Off-provider backups.** The nightly round lives inside the project it
  backs up; a destination decision (S3, R2, Backblaze) is still open.

---

# The order I would do them in

**1. B10, team invitations.** First, and not close. Everything built over
the last fortnight is theoretical until a studio can have a second person in
it, and every other fix on this list is easier to validate once more than one
account exists. It also decides how much B1 matters: single-account studios
mostly dodge the blob problem, multi-user ones cannot.

**2. B3, security headers.** An afternoon, and it closes the worst
exposure on the list. Do it before any outside studio signs in, because the
window is open for exactly as long as it takes.

**3. B6, email delivery.** Ten minutes to establish. It gates both password
reset and invitations, so find out before building B10 on top of it.

**4. B5, leaked passwords.** A toggle. Do it in the same sitting as B3.

**5. B1 and B2, the blob problem.** The largest piece and the one that
actually loses work. Phase 1 item 1 already takes `layi_dash_supplies` out
of it, so do the rest the same way, money keys first: `layi_dash_bills` and
`layi_dash_pots` before the diary.

**6. B7, material cost — Phase 1 items 1 and 2**, which are already agreed
and half built. Naturally bundled with step 5 because item 1 is one of the
fourteen keys.

**7. B12 then B8 then B9.** Recipes, then the channel, then the two method
lists. B12 shares the order form's stock section with B7, so they go
together. B9 is an hour.

**8. B11, Face ID.** Last of the blockers, and I would take the S option —
hide it honestly now, build passkeys later — rather than hold a launch for
a convenience feature.

**9. B4, the paperwork.** Runs in parallel with all of it and does not
depend on any of it, but it must land before the first outside studio, not
after. The DPA is the long pole and it is drafting rather than engineering.

The honest summary: **B10 and B3 are the two that change the answer to
"could we invite somebody on Monday".** B1 is the one that will cost a
studio real work if left. Everything else is a day or two each.
