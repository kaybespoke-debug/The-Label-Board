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

One flow: type your email, we send a six digit code, you type it back. No
password.

That is not a shortcut. Partners open this every few weeks on a phone, and a
password set in November is a password forgotten by February. A code that
expires in ten minutes cannot be reused, cannot be shared by accident, and
cannot be the same one they use for their bank.

`partners/js/auth.js` has two providers behind the same four functions, and
`config.js` picks between them by whether `SUPA_URL` and `SUPA_KEY` are filled
in:

- **demo** (config blank) — three example partners, the code shown on screen
  because there is no email to send it to. The screen says so in as many words.
- **supabase** (config filled) — `signInWithOtp` / `verifyOtp` against Supabase
  Auth, then `app.partner_me()` to find out who signed in.

Sessions last 30 days and are stored per browser. Signing out clears the
session; it does not touch anything the partner changed on that device.

An address we do not know behaves exactly like one we do: same screen, same
wait, no code issued. Otherwise the box becomes a way to find out who our
partners are.

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

## How the money works

Worth understanding before changing anything, because being believable about
this is the portal's whole job.

- Commission is a share of a referred account's **first payment**, once per
  business. An annual plan pays commission on the whole year, because the whole
  year is what they paid.
- The rate is the partner's **tier rate on the day that account started
  paying**, stored on the ledger row rather than computed at read time. Moving
  up a tier lifts what you earn from then on and never recalculates what has
  already been credited. Base rate is 15%, matching the figure the admin console
  publishes; Silver is 18%, Gold 22%, Platinum 25%.
- Credit lands the day they first pay, and **clears 31 days later**. The hold
  covers refunds and chargebacks.
- Payouts run on the **5th of the month**. A run only happens when what is
  waiting reaches the minimum in force that month (10,000 now, 25,000 before the
  threshold dropped). Anything short of it rolls into the next run rather than
  going out as a transfer worth less than the fee.
- Milestone bonuses at 5, 10, 20 and 30 paying accounts sit on top, and follow
  the same hold and payout rules.

`settle()` in `partners/js/data.js` is the only place a row's status is decided,
and the payout records fall out of the same pass. That is deliberate: build the
statements separately and they start disagreeing with the ledger that produced
them.

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
node supabase/tests/rls_harness.mjs
```

308, 75 and 71 checks. All three pass.

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
