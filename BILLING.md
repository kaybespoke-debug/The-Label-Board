# Subscription billing with Flutterwave

**Status: the database half is BUILT. The Flutterwave half is not, and
cannot be until there is an account and a key.**

What exists, applied nowhere yet but green on its own suite:

| Built | What it does |
|---|---|
| `20260920150000_free_trial.sql` | the 14 day trial, and the wall that stops it paying commission |
| `trial_harness.mjs` | 41 checks: a trial that converts, and one that is cancelled |

The two functions a webhook will call already exist and are already proved:
`convert_trial_to_paid()` for a settled charge and `cancel_trial()` for
somebody stopping. When Flutterwave arrives it is a third caller of the
same two functions, not a new set of rules.

Written 20 September 2026 for Kayode to approve or change before any code
exists. Every phase below is a thing that can be shown working on its own.

---

## The one rule everything else hangs off

**We never see a card.** The number is typed on Flutterwave's own hosted
form, in their iframe, on their domain. Nothing in this repo — not the app,
not the console, not the database — has a column that could hold a PAN, and
nothing in `web/`, `site/`, `admin/` or `partners/` ever holds a secret key.

What we store is a **token**: an opaque string Flutterwave gives back that
means "charge that card again". A token is useless to anybody else, cannot
be turned back into a card number, and is revoked by Flutterwave the moment
the customer says so.

The same discipline as tenant isolation: the boundary is server side, and
the browser is never trusted with anything that decides money.

---

## The choice to make first

Flutterwave offers two ways to bill the same customer every month. They are
not interchangeable and the decision shapes everything after it.

### Option A — Payment Plans (Flutterwave runs the schedule)

Create a plan in Flutterwave (amount, interval), attach a customer to it,
and Flutterwave charges them on the due date without us doing anything. We
listen to webhooks and update our records.

- **Less to build.** No scheduler, no retry logic of our own.
- **Less control.** A plan fixes the amount and the interval. An upgrade
  mid-cycle means cancelling one plan and starting another, and the
  proration is ours to work out anyway.
- The schedule lives at Flutterwave, so "what does this business owe" has
  two answers that can drift.

### Option B — Tokenised charges (we run the schedule)  ← **recommended**

Charge once through hosted checkout, keep the token, and charge the token
ourselves on the due date.

- **Fits what already exists.** `tlb_subscriptions` already holds the plan,
  the cycle, the price and the renewal date, and `record_studio_payment`
  already books a payment. The renewal date is already the thing the console
  reports on.
- **Upgrades, downgrades and the yearly discount are just amounts.** Eleven
  months for twelve is a number, not a second plan object.
- **One payment row per cycle, ours, tied to a business** — which is exactly
  what the partner commission engine already reads.
- **The cost:** retries, dunning, card expiry and the scheduler are ours to
  write. That is the work described in the requirements anyway.

**Recommendation: Option B.** The reason is not effort, it is that the plan
gates, the suspension rules and the commission engine all already read from
our database, and Option A would put the schedule somewhere else.

> I will confirm the exact endpoint shapes against Flutterwave's current
> documentation before writing a line of it. Their API has changed between
> v2 and v3 and I am not going to build from memory.

---

## What I need from you

Nothing here should be pasted into a chat message.

| # | What | Where it goes |
|---|---|---|
| 1 | The dedicated Flutterwave account, **in test mode** | — |
| 2 | Public key | `web/js/config.js` and the app. It is meant to be public. |
| 3 | Secret key | **You** set it as a Supabase Edge Function secret. Tell me only that it is set. Never in the repo, never in chat. |
| 4 | Secret hash for webhooks | You choose the string in the Flutterwave dashboard and set it as an Edge Function secret the same way. |
| 5 | The webhook URL registered in the dashboard | I will give you the exact URL at the end of Phase 1. |

### Five decisions

1. **Option A or Option B** above.
2. **Retry schedule.** I propose: retry on day 1, day 3 and day 7 after a
   failure.
3. **Grace period.** I propose 7 days from the first failure before access
   is suspended, so a card that expired over a weekend does not cost anybody
   a Monday.
4. **What "suspended" means.** I propose **read only**: they can open the
   app, read everything, print and export, and cannot create or change
   anything. Locking them out entirely would be holding their own records
   hostage, which this repo has a rule against and which I do not think you
   want. Say if you disagree.
5. **Currency.** The website shows six, the console bills naira, partner
   payouts are naira. I propose billing in **NGN only** at launch and
   treating the other five as display prices until somebody actually asks.
   The alternative is a Flutterwave settlement account per currency.

---

## The phases

Each one ends with something demonstrable.

### Phase 0 — Decisions and keys
Yours. Nothing is written until the five decisions above are made.

### Phase 1 — The webhook receiver, and nothing else
A new Edge Function `flw-webhook`. It:

- validates the `verif-hash` header against the secret hash, and **refuses
  anything that does not match** before reading a single byte of the body;
- **re-verifies every event by calling Flutterwave's verify endpoint** with
  the transaction id, and trusts that answer rather than the payload. A
  webhook body is attacker-controllable; a verify call is not. This is the
  single most important line in the whole design;
- writes the event to a new `billing_events` table, raw, before acting on
  it, so nothing is ever lost and a replay is possible;
- is idempotent on Flutterwave's transaction id, because webhooks arrive
  more than once and a duplicate must not book a second payment.

**Proof:** send a test event from the Flutterwave dashboard, show it stored,
show a forged one with a wrong hash refused, show the same event twice
producing one row.

### Phase 2 — The first charge
Hosted checkout from the app. On success Flutterwave returns a token; we
store the token, the card's last four digits and expiry (for the UI only),
and the fingerprint — **which is the same fingerprint the referral
anti-fraud already uses**, so a card on two businesses is caught here too.

The subscription goes active, the plan gates open, the renewal date is set.

**Proof:** a successful test charge, the business on Pro, a Pro screen that
was refused now opening.

### Phase 3 — The recurring run
A scheduled job finds every subscription due today and charges its token.
Each success calls the existing `record_studio_payment` and advances the
renewal date by a month or a year.

**Proof:** a subscription due today, charged, booked, renewal moved on. Run
it twice and show the second run does nothing.

### Phase 4 — When it fails
Failure moves the subscription to `past_due` and schedules a retry. After
the last retry and the grace period, `status` becomes `suspended` and the
app drops to read only. The customer is emailed at each step.

**Proof:** a card that declines, the retries, the suspension, and the app
refusing a write while still allowing an export.

### Phase 5 — Upgrades, downgrades, cancellation
- **Upgrade** takes effect immediately and charges the difference for the
  rest of the cycle.
- **Downgrade** takes effect at renewal, so nothing already paid for is lost
  — and the plan limits already handle being over a limit without taking
  anything away.
- **Cancellation** runs to the end of the paid period, then stops.

**Proof:** each of the three, with the plan gates following.

### Phase 6 — The two things that read from this
- **The plan gates** already read `businesses.plan`. Suspension adds one
  state to that and nothing else changes.
- **The partner commission engine** already accrues from
  `partner_referrals.mrr` on a monthly run. It now accrues **only against a
  payment that actually settled**, and a refund or chargeback inside the 31
  day hold voids the pending row — which `partner_void_on_refund()` already
  does. The webhook is what calls it.

**Proof:** commission on a real payment, no commission on a failed one, and
a refund voiding a pending row.

### Phase 7 — The gates
A new `billing_harness.mjs` alongside the twelve that exist, proving the
state machine against a real Postgres with Flutterwave stubbed, plus a live
test-mode run of the four proofs you asked for.

---

## What this touches that already exists

| Already built | What changes |
|---|---|
| `tlb_subscriptions` | gains token, status and retry columns |
| `record_studio_payment()` | called by the webhook rather than by an operator |
| `businesses.plan` | gains a suspended state |
| `plan_features` gates | read the suspended state; no other change |
| `payment_methods` | the fingerprint arrives from Flutterwave instead of by hand |
| `partner_accrue_month()` | accrues only against a settled payment |
| `admin-api` | gains a view of subscription status and a manual retry |

---

## What I will not do

- Put a secret key anywhere the browser can reach.
- Store a card number, a CVV, or anything that could be turned back into one.
- Trust a webhook body without verifying the transaction.
- Charge anybody real money in test mode, or move to live keys without you
  saying so explicitly.
