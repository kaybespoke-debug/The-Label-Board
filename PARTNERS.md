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

The limits are held by the audit, so the next feature has to argue for itself:
at most five destinations, at most three stat cards on a page, at most four
tabs, no charts, and no tabs inside a detail view.

## Signing in

Email and password.

**This changed on 15 September 2026.** It used to email a six digit code every
single time, on the reasoning that partners open this every few weeks and a
password set in November is forgotten by February. In practice that reasoning
cost more than it saved: every sign-in waited on an email arriving, and a screen
that asks only for an email address and then sends something reads as though
anybody can let themselves in. It could not — the code was only ever issued to
an address that already had an account — but a door has to look shut as well as
be shut. Kayode's call.

Forgetting is handled by a reset link, which is the same thing the code was,
asked for on the rare day it is needed instead of every time.

A partner never sets a password in advance. The invitation link hands the
browser a live session, and the portal spends it on one thing: asking for a
password. That link works exactly once, so signing somebody in on it and
stopping there would let them in today and lock them out tomorrow.

`partners/js/auth.js` has two providers behind the same four functions, and
`config.js` picks between them by whether `SUPA_URL` and `SUPA_KEY` are filled
in:

- **demo** (config blank) — three example partners, any password, and the screen
  says so. Refusing one would be theatre: the data it guards is invented.
- **supabase** (config filled) — `grant_type=password` against Supabase Auth,
  then `app.partner_me()` to find out who signed in.

Every route in ends at `sessionFromToken()`, which asks the same three questions
however somebody arrived: is the account real, is it a partner, is that partner
still active. Suspending somebody therefore ends the session they already had
rather than only stopping new ones.

Sessions last 30 days and are stored per browser. Signing out clears the
session; it does not touch anything the partner changed on that device.

**One answer for a wrong password and for an address with no account**, word for
word, and it names neither. A different answer for each turns the sign-in box
into a way to enumerate our partners one address at a time. The gate checks the
two strings are identical, not just that both fail.

The three demo partners exist because a front door with one person behind it
proves nothing. Their histories are deliberately different: forty-four
referrals over two years, fifteen over one year, and two in eleven days with
nothing earned yet. The third is the only way to see whether the empty states
read properly, and the audit checks them on that account specifically.

Local storage is keyed per partner. Two people signing in on the same phone
must not see each other's extra links and bank details.

### What the front door does not do

Nothing in `auth.js` is a security control. The guard in `render()` stops the
portal drawing an empty shell; it does not stop anyone reading anything. What a
signed-out browser can actually reach is decided by row level security in the
database, because the anon key ships in the browser and is not a secret.

Treat every check in the client as a convenience for the honest.

## The security model

`supabase/migrations/20260827090400_partner_portal.sql` is where isolation
lives. It follows the same three ideas as `tenant_isolation.sql` — every row
carries `partner_id NOT NULL`, RLS is on and FORCED, and composite foreign keys
pin children to their parent — plus a fourth that matters more here:

**Being able to read your own row is not the same as being able to write it.**

A partner who can UPDATE their own ledger can pay themselves. A partner who can
tick `partner_accounts.verified` can mark an unchecked account as checked, which
is the whole control on paying money to the wrong name. Those columns are closed
with **column-level grants**, which Postgres enforces underneath RLS, so a
policy mistake cannot reopen them.

What a partner may write, in full:

| Table | They may change |
| --- | --- |
| `partners` | name, business, email, phone, city. Not tier, not code, not status |
| `partner_links` | create, rename, pause, delete an unused one. Not the click count |
| `partner_accounts` | add and edit their own. Not the verified tick |

`partner_referrals`, `partner_ledger` and `partner_payouts` carry **no write
policy at all**. Commission, referrals and payouts are written server side by
the billing path and the admin gateway, under the service role.

Three more that are easy to miss:

- Changing the bank details on a verified account clears the tick, by trigger.
  Otherwise a partner gets verified on their own name, then swaps the number.
- The join page has no session, and `anon` holds no table grants. Resolving
  `/join/AMAKA-IG` goes through `app.claim_referral_code()`, which returns an id
  and nothing else, and counts the click server side. That is why the click
  count is not writable by the partner: the number is only worth having if they
  cannot move it.
- A suspended partner can still read their own `partners` row, on purpose, so
  the portal can say why they are locked out instead of showing a blank screen.
  Every other table stays gated on being active, so the failure mode of a client
  that forgets to check is an empty portal, never someone else's data.

## Wiring it to a real project

The portal runs on demo data until you do this. Nothing here is destructive, and
blanking the config again puts it back.

1. **Run the migration.** `supabase db push`, or paste
   `supabase/migrations/20260827090400_partner_portal.sql` into the SQL editor.
   It is idempotent.
2. **Create a login.** Authentication → Users → Add user, with **Auto Confirm
   User** ticked, then insert the matching partner row:

   ```sql
   insert into public.partners (user_id, code, name, business_name, email, tier)
   values ('PASTE-THE-AUTH-USER-UUID', 'AMAKA', 'Amaka Okafor',
           'Lux Couture', 'amaka@luxcouture.com', 'gold');
   ```

   There is no self-signup by design: a partner who can insert their own row can
   mint a code and start earning.
3. **Auth URLs.** Authentication → URL Configuration → add the partner portal
   origin to Site URL and Redirect URLs, or the sign-in emails bounce.
4. **Fill in `partners/js/config.js`** with the project URL and the anon key.
   The anon key is public by design and safe in that file. The service role key
   is not, and must never appear there.
5. ~~Wire the hydrate.~~ **Done, 12 Sep 2026.** `partners/js/live.js` reads the
   five tables plus `app.partner_me()` and builds the same object `buildDB()`
   produces, so every page above it is unchanged and cannot tell the difference.

   Three things worth knowing before editing it:

   - **The selects carry no `partner_id` filter, deliberately.** Row level
     security already answers with only the signed-in partner's rows. A filter
     there would read like the protection while being only a convenience, and if
     RLS were ever dropped it would hide the hole rather than close it. The gate
     fails if somebody adds one.
   - **A failed request returns `null`, never an empty portal.** A partner shown
     a confident zero because the network dropped is worse than an error.
   - **PostgREST answers `snake_case` and returns numerics as strings.** Every
     column is mapped by hand for that reason: a silent rename or an unconverted
     string turns a total into zero rather than into a crash. `audit_partners.js`
     feeds `buildLiveDB` a row of every shape with the network stubbed and checks
     what comes out, so this is testable with no Supabase and no partner.

   What is left before a partner can actually sign in is **SMTP** (step 2), and
   nothing else.

## One programme, and who is in it

Since 20 September 2026 there is **one** referral programme. There used to
be two: this one, and a customer referral that gave a free month each to a
customer and the customer they sent. The second is gone, folded into this.

**Every business gets a referral code on its first day.** `provision_studio()`
creates a `partners` row alongside the studio, with `kind = 'customer'` and
`business_id` pointing at it. Outside partners (fabric houses, associations,
schools, consultants) are the same table with `kind = 'partner'` and no
`business_id`.

**`kind` decides nothing about the rate.** That is the point of the
unification and it is a constraint rather than a comment: a partner with
forty introductions and a studio who told one friend are paid the same on
each business they bring.

### The anti-fraud, which is the same change

Opening the programme to every customer is what creates the fraud. Sign up,
take your own code, sign up again, and collect 8% of your own subscription
for a year. A programme open to everybody without a self-referral block is
not a generous programme, it is a discount with extra steps and a worse
audit trail. So both went in together, in
`20260920130000_one_referral_programme.sql`.

| Control | Where |
|---|---|
| No self-referral, on four axes | `app.self_referral_reason()` |
| Attribution set once and never moved | `app.attach_referral()`, `businesses_referral_is_permanent` |
| One payment method, one business | `payment_methods_one_business` trigger |
| A late card still voids the referral | `payment_methods_recheck_referral` |
| Churn inside the hold voids pending commission | `partner_referrals_void_on_churn` |
| A refund does the same | `public.partner_void_on_refund()` |
| An operator can freeze a payout | `public.set_partner_payout_frozen()` |
| Patterns an operator should look at | `public.platform_referral_risk()` |

**The four axes of "the same person"**, because they cost different amounts
to get around: the same business (free to attempt), the same account (free),
the same email address (a minute of work), and the same card. The last one
is the control that does the real work. A fraudster can make twenty email
addresses in a minute; they cannot make twenty cards.

`payment_methods.fingerprint` is whatever the processor returns that
identifies an instrument without being one, a token or a hash. **No card
number can be stored in this schema.** The uniqueness is a trigger rather
than an index so an operator can allow a genuinely shared card, which
happens: one owner paying for two studios. Both sides have to be flagged,
so one exempt business cannot drag another into sharing.

**Every attempt is written down**, accepted or refused, in
`referral_attempts`. A refusal that leaves no trace is a refusal nobody can
count, and the console's risk list is built on it.

**The risk list is patterns, not accusations.** Three of the four kinds have
ordinary explanations: an association signs a dozen members up at an event,
a husband and wife share an address, one owner pays for two studios. The
fourth is something the database already refused, so no commission was ever
created. The console says all of that on the panel, because an operator who
is told these are proof will act on them as proof.

## How the money works

Worth understanding before changing anything, because being believable about
this is the portal’s whole job.

**One rate: 8% of what each referred business actually pays.** The same for
every partner and every business. There is no tier to unlock and none to fall
back down to.

- **Monthly plan.** 8% of every monthly payment, for **twelve months** from
  the day that business first pays. After the twelfth month that business
  stops earning.
- **Yearly plan.** 8% of that year’s payment, **once**, because there is one
  payment to take a share of. The basis is the year, not the monthly
  equivalent: taking 8% of a twelfth would pay the partner a twelfth of what
  they are owed and would look like a rounding problem rather than a missing
  year.
- **Only while they pay.** If a business leaves, commission stops that day and
  nothing further is owed on it. The month it left in earns nothing at all,
  rather than a pro rata: a partner cannot check a part month against a
  payment that was never made.
- **Only the partner earns.** The referred business is an ordinary customer at
  the ordinary price, with no discount and no reward. What the partner is paid
  comes out of our side.
- **The clock is per business**, counted from its own first payment. It never
  resets and never pauses, and the partner’s other businesses have no effect
  on it.
- Credit lands at the end of each month it is for, and **clears 31 days
  later**. The hold covers refunds and chargebacks.
- **Payouts run once a year**, at the end of January, for everything that
  cleared in the year before. A run only happens when what is waiting reaches
  the minimum in force that year (10,000 now, 25,000 before the threshold
  dropped).

### Three programmes in three days, and why

This is the third shape in a month and the reasons are worth keeping, because
the next person will otherwise assume nobody was thinking.

The **first** was a one off share of a business’s FIRST payment, 15 to 25 per
cent. It paid a partner the same for a business that lasted one month as for
one that lasted five years, so it rewarded introductions rather than good
introductions.

The **second** fixed that and overcorrected: four years, a taper in years
three and four, and a rate that moved with a live count of active businesses.
Every rule in it was defensible, and the answer to "what will I earn on this
one" was four numbers and two dates. For a programme whose entire promise is
that a partner can check the working, that is a failure rather than a detail.

The **third** is one number and two conditions. It is worth less to a partner
with forty businesses than the ladder was, and worth more to every partner who
has not got there yet, which today is all of them.

### Where each rule actually lives

The rate that decides money is `public.partner_referral_rate()` in
`supabase/migrations/20260920110000_partner_flat_commission.sql`. The portal
and the console both carry a DISPLAY copy and neither can be persuaded to pay
from it: a partner’s browser works out nothing.

`public.partner_commission_summary()` is the per-business working. The portal
reads it through `my_commission_summary()` with the partner filled in from the
session; the console reads it directly through the `partnerCommission` action
on `admin-api`, passing the partner in. **Deliberately the same function.** If
the console summed it separately the two would drift the first time either was
changed, and the partner would be the one who noticed.

`settle()` in `partners/js/data.js` is the only place a demo row’s status is
decided, and the payout records fall out of the same pass. That is deliberate:
build the statements separately and they start disagreeing with the ledger
that produced them.

`partners.tier` still exists as a column and live rows still carry `bronze`.
It decides nothing. Nothing reads it, the console no longer offers it on an
invitation, and `admin-api` ignores `body.tier` rather than validating it, so
a stale client holding the key cannot set a field that looks like it decides
what somebody earns.

## Data model

`partners/js/data.js` builds the signed-in partner's data when they sign in, not
when the file loads, because until then we do not know whose data to build.
Everything the UI shows is derived from it through `Q` in `core.js`, so no two
screens can disagree.

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

Dates always run backwards from a known day, never forwards, and nothing can
predate the day someone became a partner. Both rules exist because breaking them
produced real bugs, twice.

## The gates

```bash
node audit_partners.js
node supabase/tests/partner_rls_harness.mjs
node supabase/tests/partner_commission_harness.mjs
node supabase/tests/referral_fraud_harness.mjs
node supabase/tests/rls_harness.mjs
```

408, 82, 81, 75 and 71 checks. All five pass.

`referral_fraud_harness.mjs` shows the two things Kayode asked to be shown
rather than described: a self-referral attempt blocked, and a business that
churns inside the 31 day hold paying nothing. Both are shown the way every
rule in this repo gets shown, refused and then the same operation succeeding
once it is legitimate. It found a real bug on its first run: the late-card
recheck marked a never-converted referral as lapsed, which
`partner_referrals_lapsed_after_paid` correctly refuses, and the payment
method insert failed silently because the test helper swallowed it.

`partner_commission_harness.mjs` is the one that proves the programme rather
than the plumbing. It shows a monthly referral paying for twelve months and
then stopping, a churned business stopping the day it churns with the day
before untouched, a yearly referral paying once on the year rather than on the
month, a partner with one business earning exactly what a partner with forty
earns on each, and the portal reading the console’s function rather than its
own sum. It also checks the milestone table and its function are GONE rather
than empty: an empty table and a function that awards nothing is a programme
somebody could turn back on with four inserts.

`audit_partners.js` drives the sign-in flow, then runs every page and detail
view against a stub DOM **for all three partners**, reconciles the money for
each, and holds the size limits. It deliberately does not test whether one
partner can read another's rows: that is a database question, and a test proving
the client filters correctly would prove nothing, because anyone holding the
anon key can skip the client.

`partner_rls_harness.mjs` answers it properly. It applies every migration to a
real Postgres (PGlite, no Docker) and attacks the policies from two positions: a
signed-in partner reaching for another partner's rows, and a signed-in partner
reaching for their own rows with a pen. Among other things it proves a partner
cannot write themselves a bonus, promote themselves to a better rate, inflate
their click count, or keep a verified tick after swapping the account number.

Between them these gates caught five real bugs during the build: payouts going
out under the stated minimum, accounts shown as having stopped paying on a date
that had not happened yet, `anon` being unable to reach the join-page function
at all, a suspended partner getting two different answers from the table and the
RPC, and a brand-new partner showing referrals from before the day they joined.
