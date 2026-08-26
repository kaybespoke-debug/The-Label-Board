# Partner Portal

The third app in the family. The customer app (`layi_dashboard.html`) is what a
label runs its business on, `admin/` is the operator console, and `partners/` is
for the people who bring us subscribers: they see what they have earned, who
they brought in, and when the money lands.

It is a separate Netlify deployment with its own `netlify.toml`, `_redirects`,
manifest and service worker, exactly like `admin/`. Nothing is shared at
runtime, so a bad release in one cannot take down the others.

## Running it

```bash
npx --yes http-server partners -p 3002 -c-1
```

Or use the **Partner Portal** entry in `.claude/launch.json`.

## Deliberately small

A partner opens this on a phone, standing up, between fittings. They have two
questions: *what am I owed*, and *who have I brought in*. Everything here has to
serve one of those or it is gone.

The first build did not. It had nine pages, six cards on the home screen, an
earnings chart, a conversion funnel, a plan breakdown and a city breakdown, and
it split referrals from businesses even though a partner thinks of those as one
thing. All of that has been taken out. What is left:

| Page | What it answers |
| --- | --- |
| Home | What am I owed, when does it land, who needs a nudge |
| Earnings | What I have been credited, and what has been sent (two tabs) |
| Referrals | Everyone I brought in, at whatever stage they reached |
| Share | My code, a link per campaign, something to send |
| Account | My details, payout accounts, how I get paid, preferences |

Updates hangs off the bell rather than taking a sixth slot in a bar that has to
fit a thumb.

The limits that came out of that are held by section 8 of the gate, so the next
feature has to argue for itself: at most five destinations, at most three stat
cards on a page, at most four tabs, no charts, and no tabs inside a detail view.

## How the money works

This is the part worth understanding before changing anything, because the
portal's whole job is to be believable about it.

- Commission is a share of a referred account's **first payment**, once per
  business. An annual plan pays commission on the whole year, because the whole
  year is what they paid.
- The rate is the partner's **tier rate on the day that account started
  paying**. Moving up a tier lifts what you earn from then on and never
  recalculates what has already been credited. Base rate is 15%, matching the
  figure the admin console publishes; Silver is 18%, Gold 22%, Platinum 25%.
- Credit lands the day they first pay, and **clears 31 days later**. The hold
  covers refunds and chargebacks.
- Payouts run on the **5th of the month**. A run only happens when what is
  waiting reaches the minimum in force that month (10,000 now, 25,000 before
  the threshold dropped). Anything short of it rolls into the next run rather
  than going out as a transfer worth less than the fee.
- Milestone bonuses at 5, 10, 20 and 30 paying accounts sit on top, and follow
  the same hold and payout rules.

`settle()` in `partners/js/data.js` is the only place a row's status is decided,
and the payout records fall out of the same pass. That is deliberate: build the
statements separately and they start disagreeing with the ledger that produced
them.

## Data model

`partners/js/data.js` generates one signed-in partner deterministically from a
seeded PRNG, so the figures are identical on every reload. Everything the UI
shows is derived from it through `Q` in `core.js`, so no two screens can
disagree.

- `DB.me` the partner
- `DB.links` one default link plus a link per campaign, each with its own clicks
- `DB.referrals` everyone who used a code, at stage `signed-up`, `trial`,
  `subscribed` or `lapsed`
- `DB.ledger` one row per thing that earned money, built from the referrals
- `DB.payouts` the runs, built from the ledger by `settle()`
- `DB.accounts` payout accounts
- `DB.updates` news

The dataset carries more than the screens show: outlets, staff counts, plans,
cities. That is on purpose. It costs nothing, the detail view uses some of it,
and it means a future decision to surface something does not need a data change.
It is the *pages* that stay lean, not the model.

Only what a partner changes in the browser is persisted, under
`tlb_partner_settings`, `tlb_partner_links` and `tlb_partner_accounts`.

## Wiring it to Supabase

Replace `buildDB()` with a fetch. Nothing above `data.js` knows or cares where
the numbers came from, so `core.js` and every page stay as they are. The tables
this implies:

- `partners` — the person, their tier, their default code
- `partner_links` — label, code, clicks, active
- `referrals` — the referred business, its stage, which link brought it, and
  the subscriber id it maps to in the main schema
- `partner_ledger` — type, amount, rate applied, basis, credited date, clears
  date, status, payout ref
- `partner_payouts` — ref, paid date, amount, account, bank reference
- `partner_accounts` — payout accounts

The rate applied and the amount belong **on the ledger row**, not computed at
read time from the partner's current tier. Otherwise every historic commission
silently changes the day someone gets promoted.

Referral attribution should be inferred from the link or code, never
self-reported, which is the same rule the admin console already follows for its
`channelSource` field.

## The gate

```bash
node audit_partners.js
```

It runs every page and every detail view against a stub DOM, reconciles the
money, and holds the size limits above. 165 checks. It caught two real bugs
during the build: payouts going out under the stated minimum, and two accounts
shown as having stopped paying on a date that had not happened yet.
