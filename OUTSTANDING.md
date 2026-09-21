# Outstanding

Everything known to be unfinished, wrong, or waiting on somebody. Updated at
the end of every session. Nothing is removed until it is actually done — if
something turns out not to be worth doing, it moves to **Decided against**
with the reason, so it does not get re-raised in six months.

Last updated: 21 September 2026 (eighteenth session)

## Shipped 21 September 2026

`main` -> `a7660eb`, `admin-deploy` -> `d78d0c0`, branches differing only by
`netlify.toml` as intended, `publish = "site"` confirmed on the merge commit.

**Every button on the console was broken for a real studio.** Seventy-three
inline handlers passed the id into the call unquoted, which is valid while ids
are numbers and a syntax error the moment one is a uuid. Demo data has numeric
ids, so every gate was green and only the live console was dead. It had been
found once in August for the row-opening handler and fixed there alone. Fixed
in two halves now: the ids are quoted, and twenty-five lookups reading them
with `x.id === +id` compare as text, because `+id` is NaN for a uuid.

**`audit_console_clicks.js` is new**, 185 checks. It renders all sixteen pages,
all ten detail screens and every tab, pulls every inline handler out of the
HTML, checks the function exists, calls the ones that do not reach the gateway,
then does it all again with a uuid in place and fails on any handler that drops
an id in unquoted.

**The page header is now firm in all three apps.** The obvious fix does not
work and was tried first: keeping `.main`'s top padding and pulling the header
up with a negative margin leaves it stuck 26px down with a live strip above it.
Sticky positions against the scrollport. The padding moved onto the header
instead, safe-area inset with it. `audit_safearea` went 23 -> 66 checks and
refuses the negative margin coming back.

**Opening a record landed you mid-page.** Below 680px `.main` stops being the
scroll container and the document itself scrolls, so resetting `.main.scrollTop`
moves nothing — and because the record is usually shorter than the list you
came from, the browser clamps your old offset to the new height and drops you
somewhere arbitrary. The partner portal found this months ago and fixed it with
a two-line helper; the console never got it, the same shape as the unquoted
ids. Same helper now, and `go`, `openDetail`, `goBack` and `setVTab` all route
through it. The customer app is exempt and the gate says why: its `.main` keeps
`overflow-y:auto` at every width, so it never hands scrolling to the document.

### Applied to the live database

| Migration | What |
|---|---|
| `console_owner_email_swap` | the console owner signs in as `layiwolaojomo@thelabelboard.com` |
| `account_directory` | a view saying which app each auth account belongs to |
| `rename_seeded_layi_studio` | the September fixture is **Seed Multi Studio**, freeing the name |
| `prepare_layi_studio` | **LAYI** exists, on Pro at zero, waiting for its owner |
| `partner_and_studio_together` | a partner who was also prepared a studio gets both |

### The studio that was prepared and then swallowed

Kayode created the account. The studio was not claimed, he was attached to
partner **KUNLE** instead, and nothing anywhere said so: the business kept its
pending address, the trigger returned happily, and `account_directory` quietly
read "partner". `app.provision_studio()` opened with a partner claim that
returned outright, so the prepared-studio branch below it was unreachable for
anybody who had been invited as a partner first.

The early return was not wrong, it was too wide. It exists to stop the INVENT
path from handing a studio to somebody who never asked for one, and that is
still refused. A studio prepared by an operator is not a guess.

**Then it cost an hour, because the function has four generations.** The first
attempt copied the 4 September body — the one the partner claim was added to —
and silently undid the billing record added on the 5th and the referral code
added on the 20th. `billing_harness` went red in under a minute, which is the
only reason this is a paragraph and not an incident. The live function was
wrong for about ten minutes; no account was created in that window and every
studio was checked afterwards for its billing row. **Before touching that
function again: grep every migration for the name, take the LAST, and diff
what you are about to apply against it.**

**And the re-diff found a third thing that had to change.** `partners.user_id`
is UNIQUE, and the whole function is wrapped in `exception when others`. So
the referral code the trigger hands every new studio blows up for somebody who
is already a partner, and the rollback takes the profile and the membership
with it: no studio at all, one warning in a log nobody reads. Guarded now, and
`onboarding_harness` went 28 -> 35 checks. Mutating that one guard out fails
nine of them.

**LAYI has no referral code of its own, and that is correct.** Kayode already
holds partner KUNLE personally, `user_id` is unique, so the studio cannot also
have one. His referral code is KUNLE. Worth a decision at some point: whether
an owner's personal partner row and their studio's referral code should be the
same thing.

**Leaked password protection is off** in Supabase Auth, and it is not where
the first note said it was. It lives under **Authentication -> Sign In /
Providers -> Email**, in the Password section, as "Prevent use of leaked
passwords". It checks new passwords against HaveIBeenPwned and refuses the
ones already in a breach list. Pro plan and above, and the organisation is on
Pro, so it is available.

It is an Auth config setting rather than anything in the database, so no
migration reaches it and the Supabase MCP tools here have no action for it.
It is also a security setting on a live project, which is Kayode's to change
rather than mine. Thirty seconds in the dashboard, and worth doing now that
real people have passwords on it.

Worth a look on the same screen while it is open: minimum password length
(default 6) and the required character classes. Both are the same kind of
change and the same one toggle away.

**A button that looked like it worked.** Kayode renamed a studio in the
console, watched it rename, and found it unchanged afterwards.
`doEditSubscriber` wrote to the in-memory object and called `render()`, so the
screen agreed with him and the database never heard about it. `doChangePlan`
did the same, and `liveSetPlan` had sat in `live.js` since the gateway was
built with nothing ever calling it.

This is the worst shape a bug can take. A button that does nothing gets
reported in a minute; a button that looks like it worked is found days later,
from the wrong direction, and by then you have made decisions on it.

`doChangePlan` now goes through the gateway. `formEditSubscriber` has no
gateway action behind it at all, so on a live studio it now refuses and says
what *does* reach the database. `audit_console_pages` gained a block that will
not let either come back — every editing action must reach the gateway or
refuse outright, and no write function in `live.js` may sit uncalled. Run
against three broken copies; none survived.

**Still not wired: `setTenant`.** Editing a real studio's name, contact or
notes needs a gateway action that does not exist yet, which is an Edge Function
deploy and therefore Kayode's call. Until then Edit is honest about it rather
than silent. `liveSetState` is exempted in the gate with a written reason: the
feedback screen is read-only by omission, not by bug.

The email moved in all three places at once: `auth.users.email`,
`auth.identities.identity_data` and `platform_admins.email`.
`auth.identities.email` is GENERATED from identity_data so it followed, and
`provider_id` was checked first and holds the user id rather than the address.
Kayode confirmed sign-in afterwards. `layiojomo@gmail.com` is now free.

### What the directory showed on its first run

Every one of the six seeded test studios is ALSO a partner, which is the seed
data rather than a bug, but it means `is_partner` is noisy until the test rows
are cleared. There is also a real partner signup nobody had mentioned,
`r2wapparels@gmail.com`, last seen 15 September.

**Two orphan memberships are invisible to it and should not be.** Test Studio
and Test Studio Two have owner rows pointing at auth users that do not exist,
so they are not accounts with nothing behind them, they are studios with nobody
in front. The directory lists auth users, so it cannot show them. Worth a
companion view, or a check in a harness.

## Still to do, Kayode's own list

1. ~~rename the console login~~ done
2. ~~rename the seeded LAYI studio~~ done — it is **Seed Multi Studio**. He
   renamed it in the console on the 21st and it did not save; see the
   write-through bug below. Done by migration instead, matched on the slug,
   which is deliberately left as `layi-multi-studio` because two other
   migrations and `seed_sql.mjs` look the fixture up by it.
3. ~~invite `layiojomo@gmail.com` as a studio called LAYI~~ done — the row is
   prepared and live, `slug = 'layi'`, one branch, waiting to be claimed.
4. ~~set the app password~~ done, by him, 21 September. Nothing in this system
   ever sends or stores a password on somebody's behalf, which is why the
   console invites rather than creating accounts.
5. ~~change the plan to Pro~~ done — **Pro at a price of zero**, on purpose.
   The plan gates what the app allows; the price is what we invoice. LAYI is
   our own label, so it needs what Pro unlocks (5 studios, 50 seats, enforced
   by `plan_limits`) and must not turn up as ₦49,000 of revenue nobody is
   going to pay us.

**All five are done.** `layiojomo@gmail.com` reads `partner + studio`, owner of
LAYI, one profile, one membership, plan `pro`, nothing stranded. Step 4 was the
one that turned up the bug above, which is the argument for doing these in
order against a live database rather than reasoning about them.


## The order form and the invoice, 21 September — PROTOTYPED, NOT BUILT

Kayode signed into the app as LAYI for the first time, tried to add an order,
and said it was "just a very long unending list ... its certain this is not the
only affected page". Then: "theres no where for me to create an invoice? like
we said, invoicing should be first before an order is created".

**Both complaints are one complaint.** Invoice-first is built and working
exactly as decided. The form hides it.

### Measured rather than eyeballed

`renderOrderModal` is **42 fields** with three headings, and between field 10
and field 38 there are **28 fields with no signpost at all**. That stretch is
the unending list.

The quote switch — *"Not agreed yet, this is a quote"*, the entry to the whole
invoice-first flow — is **field 40 of 42**. You fill in stock used, who is
making it, the profit and loss and the director allocation before the app
mentions you could have been invoicing. Of course it looks like invoicing is
not there.

He is right that it is not the only form, but it is narrower than it feels. Of
22 forms with six fields or more, only two are long: this one and **Add staff**
at 35. Everything else is 12 or fewer. Fifteen have no headings, which matters
much less at seven fields.

### The shape proposed

Prototype, five boards: <https://claude.ai/artifact/Ke4FCtCLqX6HnesNm71LBG>

**28 of the 42 fields are things you only know AFTER the yes** — what fabric
went in, who made it, what it cost, what stage it is at. Asking for them while
you are still quoting is why the form never ends. They move onto the order
itself, in closed sections. That leaves eight fields to price a job, and two
doors in: *Quote & invoice*, or *Straight to an order* when it is already
agreed. Same record either way, so the decision already made survives.

**Kayode approved the two doors on 21 September**: "2 doors is okay".

### The invoice: five things the app cannot produce

He sent his real LAYI invoice (#308, Dr Ellis Enabosi, 21 Aug 2026) and the
app it comes from. Compared against `invoiceInner`:

| His invoice | The app today |
|---|---|
| PRICE x QUANTITY = AMOUNT | item and amount only; no quantity outside a batch |
| photo in the line itself | up to four thumbnails in a strip at the foot |
| sort code, IBAN, BIC/SWIFT | a bank row is currency, bank, account name, number. **His GBP and USD accounts cannot be written down at all.** |
| signature, name, date | nothing |
| two trading addresses (Lagos and Stotfold) | one free-text address box |

Smaller: his logo sits top right and the app's sits left; he writes a discount
as `(N40,000.00)` and the app writes `- N40,000`; he says **Amount due** and the
app says **Balance due**.

**Quantity is the only structural one.** An order stores a price per piece and
no count, so a quantity column touches the order record, the totals,
`invoiceFigures` and the migration path. The other four are additive.

### THE INVOICE SPEC, as Kayode gave it on 21 September 2026

He had given this before and it was never written down, which is how a
session came to ask for it twice. It is written down now. Anything added
later goes here, not into a commit message and not into a chat.

Prototype, six boards: <https://claude.ai/artifact/Ke4FCtCLqX6HnesNm71LBG>

**Set once in Settings, carried onto every invoice automatically.**

| | State |
|---|---|
| Logo | exists |
| Company name | exists |
| Email | exists |
| Address | exists, but ONE box. He trades from Lagos and Stotfold, so it has to take more than one line and print them both |
| Phone | exists |
| Company registration number | exists (`co.reg`) |
| Payment instruction | exists (`co.pay`) |
| **Signature** | **NEW.** An image he uploads once. Prints above his name and the date at the foot of every invoice. Not a typed name |
| **Tax** | **NEW.** Optional: a switch, a label (VAT) and a rate. Off by default, because most studios will not charge it |
| Payment accounts | exists, but only currency / bank / account name / number |

**Payment accounts are REACTIVE to the currency.** His words: *"add the
sortcode, iban and bic but make it reactive, so it reflects when its the
currency that requires it."* Every business adds its own accounts and the
invoice carries them. The point is that a Nigerian studio with one Naira
account never sees an IBAN box.

| Currency | Fields shown |
|---|---|
| NGN | bank, account name, account number |
| GBP | bank, account name, account number, **sort code** |
| USD | bank, account name, account number, **IBAN**, **BIC/SWIFT** |
| EUR | bank, account name, **IBAN**, **BIC/SWIFT** |

**On the invoice itself.**

- Client name, email, phone. Email is the one not shown today
- Line items, with a **thumbnail in the row**
- **Shipment details.** The order already stores courier, delivery address,
  waybill number and status, and the invoice uses only the fee, as a
  Shipping money line. All four should print
- Discount
- Tax, when it is on
- **Deposit already paid**, deducted, so the figure at the foot is what is
  actually owed. Labelled **Amount due**, not Balance due
- **The large finished-piece photo at the end**, as well as the thumbnail.
  Confirmed: he wants BOTH
- The signature block

### Settled 21 September, second pass

**Quantity is in.** Price, Qty, Amount, as on his own invoice. It is the only
structural change in the list: an order stores a price per piece and no count,
so it touches the order record, `invoiceFigures`, the totals and the migration
path.

**Currencies are optional.** The invoice prints only the accounts a studio
actually added. A studio paid only in naira gets one line, never an empty GBP
or USD block. Today `invoiceInner` filters accounts to the order currency and
falls back to printing ALL of them when none match, which is the behaviour to
watch.

**One page.** His own invoice is one page and he wants that. The finished-piece
photo goes on its own page after it rather than lengthening the document.

### Settled, and one still open

**Tax, settled 21 September.** Optional, off by default. It applies to the
whole order **after the discount** and **not to shipping**, so:

    taxable = subtotal - discount
    tax     = taxable * rate
    total   = subtotal - discount + tax + shipping

Shipping sits outside the tax and after it on the invoice, which is what makes
the order of those two lines load-bearing rather than cosmetic.

**A US domestic dollar account** uses a routing number, not an IBAN. His own
USD account is a GB-based Revolut, so IBAN and BIC suit him and would strand an
American studio.

### Where the build happens

**Both pieces of work are the customer app, and they are one piece of work.**
One fresh chat for both, per the one-app-per-chat rule.

**On `admin-deploy`, not on `main`.** An earlier pass in this session said the
opposite and it was wrong. The customer app SHIPS from `main`; the work happens
on `admin-deploy` like everything else, and merging is the release step at the
end, with the `netlify.toml` recipe at the top of CLAUDE.md. Starting the build
on `main` would also mean starting without this spec, because these twelve
commits are on `admin-deploy` and `main` has none of them.

Green before starting and green before shipping: `node verify.js`, then
`node audit_safearea.js` after any stylesheet or table change. Bump `CACHE` in
`site/sw.js` before the release or installed phones keep the old version.


## The free trial is SILENT until Flutterwave, 21 September

Kayode asked whether the trial, demo and partner buttons should all be
active while the app opens in November and tests in October. Checked
rather than guessed, and they are not the same kind of thing.

**Book a demo and Become a partner stay on.** Both are real forms that
post to Netlify AND to `submit_enquiry`, and seven enquiries are sitting in
the live console already: 4 demo, 1 partner, 1 contact, 1 early access.
They are conversations rather than product, and they are how October’s
cohort gets filled.

**The trial came off every page.** Three reasons, worst first:

1. The home page argued with itself. "Start your 14-day free trial" in
   gold, and two inches below a clock counting down 41 days until we open.
2. The dates did not work. A trial started that day ended **3 October**,
   **29 days before** the 1 November launch and before the October test
   had even finished.
3. It did not do what it said. No card form, so it sent people to the
   booking page. Zero of the 8 businesses had a trial running.

### It is a flag, not a date, and that is the point

`SITE.trial.live` is `false`. **1 November is when we OPEN, which is not
the same as when the card form starts working.** A button wired to a date
appears whether or not it can do anything, which is the exact fault being
fixed. A person turns it on in the release that connects Flutterwave.

`audit_web.js` follows the flag **both ways**, and that is mutation tested:

- `false` and the trial must be offered NOWHERE, trial.html noindex and out
  of the sitemap, and both priced plans must still lead with Book a demo,
  because a plan card with no action is worse than one with the wrong one.
- `true` and it must be on the cards, the hero, the header, the drawer and
  the footer, and the page must be findable again.

Flipping the flag to true with no buttons behind it turns 33 checks red.
So the flag cannot be flipped without the gate noticing, and the buttons
cannot come back without the flag.

**Nothing else moved.** trial.html, its terms, `start_free_trial()`,
`convert_trial_to_paid()`, `cancel_trial()` and the 41-check harness are
all exactly as they were, waiting.

### October is a test MONTH, not a 14-day trial

Kayode’s plan, 21 September: hand-pick individuals, invite them manually as
tenants, with a proposal sent to each. They get the chance to become the
first subscribers at launch if they want to keep using it.

That is a different shape from the trial and needs nothing from the trial
machinery: `inviteStudio` already takes a `cohort`, so October’s intake is
one tag and one count in the console.

**The proposal is written** and lives as a Claude doc rather than in this
repo, because it is a thing he sends to people rather than code:
https://claude.ai/code/artifact/ee3bae71-802d-46ac-8a65-274f4927cf9c

Five sections: what is being asked (run real work through it, say what
breaks, one call at the end), what they get (everything, free, no card),
what happens on 1 November (they choose, with the three prices), what we
promise about their records, and how to start.

**One decision is deliberately NOT in it: whether October testers get a
price advantage at launch.** Kayode said "the chance of becoming first
subscribers" and said nothing about a discount, so nothing was invented.
A founding rate is the obvious lever and it is his to pull; the doc is one
edit away from carrying it.

**Also not in it:** how many studios. The doc says "a small number" rather
than a figure, because a figure nobody has decided is a promise.

## Android, not just iPhone

Kayode: "please think of android screens too not jus IOS". Fair: the sweep
above was 375px, which is an iPhone. **The most common Android width is 360,
which is NARROWER than anything that had been tested**, and the repo’s own
documented floor is 320.

| Width | Device | Pricing | Home | Sideways scroll |
|---|---|---|---|---|
| 320 | the floor | 5.77 screens | 2.39 | none |
| 360 | most Android | 4.78 | 2.19 | none |
| 375 | iPhone | 4.58 | 2.15 | none |
| 412 | Pixel | 3.77 | 1.94 | none |

Nothing overflows at any of the four, the comparison table scrolls 0px
sideways at all of them, and the plan columns hold their measured 60px even
at 320 where that leaves only 140px for the feature name.

### What 320 turned up: forty rows and no column headings

By row twenty the Basic / Pro / Bespoke heading has scrolled away, and
three columns of ticks mean nothing without it. You can see that something
is included without being able to say in WHICH plan. It is worse on Android
because a 360 or 320 screen puts more rows between you and the heading.

The heading is sticky now, parked at 66px so it sits under the page header
rather than behind it. Phone only; the desktop table is unchanged and
checked to still be `position:static`.

**Sticky goes on the CELLS, not on the `thead`.** A `thead` is not a
positionable box in most engines and the rule is silently ignored there,
which looks exactly like it working until you scroll.

## The phone sweep, 20 September: all fifteen pages

Every page measured at 375px on the live site. **Nothing scrolls sideways**
anywhere, and the one real bug found is below.

| Page | Screens |
|---|---|
| trial | 1.19 |
| products | 1.35 |
| 404 | 1.38 |
| thanks | 1.46 |
| book | 1.74 |
| home | 2.15 |
| terms | 2.17 |
| waitlist | 2.18 |
| faq | 2.23 |
| privacy | 2.31 |
| about | 2.52 |
| contact | 2.69 |
| partners | 2.83 |
| pricing | 4.58 |

### THE BUG: iOS was zooming the page on every form field

Safari on iPhone treats an input whose font is under 16px as too small to
read and **zooms the page in when it takes focus. It does not zoom back
out.** So the rest of the form is filled in on a page that is now wider
than the screen and scrolling sideways.

Every field on the site was 15px: 8 on book, 12 on contact, 15 on waitlist,
10 on partners. One pixel of design costing the whole form on the device
most people use, and on the pages that are the entire point of the site.

16px on the phone, 15 everywhere else. It is now a gate, and the gate is
mutation tested: putting it back to 15px turns it red. **It had to be a
check rather than something to remember, because it is invisible on a
desktop browser, which is where all of this gets built.** Same reason the
safe-area gate exists.

### Three things that look wrong in a measurement and are not

- **`minFont: 0` on pricing.** The comparison table renders Yes and Not
  included as a tick and a dash by setting `font-size:0` and drawing the
  glyph in `::before`. The words are still in the HTML and still read out.
- **A `.wrap` on the home page reports 16px of horizontal overflow.** That
  is the trade tiles: a deliberate full-bleed carousel, 1,656px of tiles in
  a 375px scroller, bleeding past the wrap’s gutters on purpose. The
  document itself does not scroll sideways, which is the thing that matters.
- **`reviews.html` 302s to the home page.** Deliberate and documented in
  `web/_redirects`: there are no reviews yet, the section is `hidden`, and
  nothing visibly links to it.

### Checked and fine

The drawer opens over the whole screen, locks the body, lists nine links
with a smallest tap target of 49px, and closes again. The footer sits at
the bottom on every short page. No page anywhere scrolls sideways.

## Launch day, a floating footer, and a note that would not die

### The countdown takes the waiting list with it

The clock removed itself at zero and left "Join waitlist" on a row of its
own with a gap where the numbers had been. The WHOLE row goes now.

Kayode: "there’s no need for a join waitlist when the timer goes off, they
work today, waitlist ends when the timer ends." A waiting list is for a
thing you cannot have yet. The morning it opens, the answer to "how do I
get in" stops being "wait" and becomes the trial button three inches above
it, and a list still offering to queue you is the site contradicting itself
on the one day it matters.

**Tested by moving `launchDate` to 2020 and loading the page**, not by
reading the code: clock gone, row gone, no link to the waiting list left
anywhere on the site, three buttons closed up with no hole. Then the real
date went back and the clock came back at 41 days.

It is the only link to `waitlist.html` on the site, so removing that row
retires the offer rather than hiding one of several doors.

### A near miss worth writing down: hrefs differ live

**Netlify serves pretty URLs.** `waitlist.html` in the source is `/waitlist`
in the live DOM. So a selector like `a[href$="waitlist.html"]` matches
locally and matches NOTHING on the live site.

The first version of the launch-day change used exactly that selector, to
move the button rather than remove it. It passed every local test and would
have silently done nothing in production, on the one morning it runs, with
no error and nobody watching. Kayode changed his mind about the behaviour
before it shipped, which is the only reason it did not go out; the selector
was wrong either way and the local test could never have shown it.

It was caught afterwards because a verification query used the same bad
selector against the live page and reported the waiting list as already
gone while the clock was still running at 41 days. The wrong answer came
from the check rather than the site, which is its own lesson: a probe is
code too.

**The rule:** never key JavaScript off an href string. The remaining one in
`site.js` is `a[href^="#"]`, which is an in-page anchor and is not rewritten.
Everything else selects on a class or a data attribute, which is what the
HTML controls and Netlify does not.

### The footer was floating on short pages

`trial.html`, `thanks.html` and `404.html` are all shorter than a desktop
window, so the footer ended where the content ended and the rest of the
screen was empty below it. It reads as though the page failed to load.

The body is a flex column with `main` taking the slack. The drawer is
`position:fixed` and the skip link is absolute, so neither is a flex child
and nothing else moved. `svh` rather than `vh`, because on a phone `vh` is
the tallest the viewport ever gets and every page would gain a scrollbar it
does not need. Verified at 1900x1300: zero gap on all three, long pages
unaffected.

### The note I was asked to remove, twice

"i dont want this notes anywhere, i said this a lot of times". He had. The
first pass took out the long version and left a SHORTER one in its place,
which is not removing it.

It is a gate now rather than a memory: no page may carry `class="trial-note"`
and the stylesheet may not keep a hook for one. A styled class for a thing
that should not exist is an invitation to reattach it.

### The FAQ order, his

My guess was a buying journey with money first. His is **The software, your
data, and us > Getting started > Paying for it > The partner programme**:
the product first and the money third, which reads as wanting somebody to
understand what the thing is before being asked what it costs.

## The repeated trial line, the footer again, and the FAQ order

### The trial terms are said once now, not five times

They were under the home hero, on both plan cards, and twice on the trial
page. All five are gone at Kayode’s request.

**What did NOT go, and must not:** the trial page still states all four
facts in its own bullet list. How long it runs, that a card is required,
that day 15 is the first charge, and that it can be cancelled. Repeating
the sentence beside four buttons was what he objected to; a "Start your
14-day free trial" button with the card mentioned nowhere on the site
would be the exact mismatch the trial build exists to avoid.

So the gate moved rather than being deleted. It used to require the exact
sentence beside every call to action. It now requires that the sentence is
NOT repeated, that trial.html states each of the four facts separately, and
the sweep for "no card needed" still runs on every page. Checking the four
facts one at a time rather than as one string leaves the wording Kayode’s
to change while the facts stay ours to keep.

### The footer, desktop this time

| | Before | Now |
|---|---|---|
| Desktop footer | 398px | **310px** |
| Desktop tap target | 17px | **25px** |

The same bug as the phone: the row kept the body line height and the
anchor sat on it with no padding, so the space was dead AND not a target.

**"Refer a business" is gone.** It pointed at `partners.html`, the same
place as "Become a partner", in the same column.

**It saved nothing on the phone, as predicted.** Product and Company sit
side by side and the row is as tall as the longer one. Company went from
six links to five; Product still has six; the phone footer is still 401px.
Links have to come out in PAIRS to shorten it, and that is a navigation
decision rather than a spacing one.

### The FAQ

Rows tightened on desktop and again on the phone: 2.42 screens to **2.25**.

**The sections were reordered, and the order is a guess worth checking.**
He asked for them rearranged without saying how. They now run in the order
somebody meets them: **Paying for it** first, because most people arrive
from the pricing page with a question about money; then **The software,
your data, and us**, which is what they would be buying; then **Getting
started**, which is after they have; and **The partner programme** last,
because it is a different reader entirely.

## The footer on a phone, and a tap target that was not one

461px under every page, which is more than half a screen. Now **401px**,
and pricing is 4.69 screens.

**Most of it came from one thing, and it was a bug rather than a
preference.** Each footer link row was 26px tall of which only 16px was
clickable: the `li` kept the body line height and the anchor sat on that
line box with no padding of its own. So the extra 10px was dead space AND
not a tap target, which is the worst of both. The leading came off the li
and went back on the anchor as real padding, so the row got SHORTER and the
thing you aim at got BIGGER: 23px row, 22px tap target, up from 16.

That supersedes the note from earlier today that said the footer links were
left small on purpose and that making them comfortable would cost 250px.
It would have, as padding on top of what was there. Replacing the dead
space rather than adding to it costs nothing.

**Nothing was removed.** What is in the footer is a navigation decision
rather than a spacing one.

### What is left, and it is not spacing

The phone footer is now essentially `links in the longest column x 23px`.
Product and Company have six each and sit side by side, so the row is as
tall as six links whatever the other column does. **Taking a link out of
one column alone saves nothing**, which is worth knowing before anybody
tries it: they have to come out in pairs.

One duplicate exists and is worth fixing for its own sake rather than for
height: **Become a partner** and **Refer a business** both point at
`partners.html`. Two links, one destination, in the same column.

Desktop was deliberately not touched: 398px, and the 17px tap target there
is a mouse rather than a thumb.

## The pricing cards, tightened

Kayode: "cut off the excess spaces on each of the tier card / tighten the
line spaces too / i am trying to strip down the scrolling on phone version".

| | Before | After |
|---|---|---|
| Pricing on a phone | 5.37 screens | **4.76** |
| The three cards | 1,855px | 1,525px |
| The comparison table | 1,497px | 1,335px |

**Two of the three crossed-out lines on Basic were already on the Pro card
in other words.** Reminders and the chase list, and a second studio, were
both there. So Basic was paying for them in vertical space and telling
nobody anything new. They are gone from Basic and payroll, which was on
neither card, joins Pro. The list now reads forwards: what Pro adds IS
what Basic does not have.

The gate check moved with it. It used to count `class="no"` on the entry
card and require at least two; it now requires NO card to cross anything
off, and separately asserts that Pro names all three capabilities. Counting
crosses would have passed a Basic card that said nothing at all.

**Bespoke’s empty bottom was `align-items:stretch`**, making every card as
tall as the tallest. Fine when the lists are a similar length; Bespoke has
five bullets against Pro’s eight, so it was carrying three bullets of
nothing. `start` lets each card be its own height, and the desktop spread
is now 149px rather than a hole.

**`min-height` on `.who` and `.price-note` is a three-column problem.** It
keeps the prices level across the row. On a phone the cards are stacked and
there is nothing to line up with, so on the phone it is pure scrolling and
both are dropped there rather than everywhere.

**The card collapse button lost its count.** It said "See all 8 features"
and "See all 5 features", which made three buttons look like three
different controls and invited a comparison of list LENGTHS. It is "See
more" on all three now.

**One thing the currency change had left behind:** the pricing hero still
said "Shown and invoiced in your own currency" with one currency on the
page. It says naira, and a check now fails if a choice is offered in words
while none is offered in the interface.

## Naira only, and the end of a three-day currency saga

Kayode, 20 September: "lets revert back to naira, no currency change for
now, just naira so we dont cause confusuion, we can always add those when
the app is ready to go international".

The picker is gone and five of the six currencies with it. Those five were
SEEDS: dollars, pounds, Canadian dollars, euros and cedis, worked out from
the naira price at a rate nobody had agreed and nobody was going to honour.
Fine in a spreadsheet, not fine on a pricing page, because the person
reading it cannot tell a seeded price from a real one.

**Three versions of the same mistake in three days, which is the part worth
keeping.** Each one was a way of letting something that was not a decision
behave like one:

| | What it was | How it went wrong |
|---|---|---|
| 18 Sep | a guess from the time zone and language | written to storage exactly like a choice, so it beat the naira default for ever on every returning browser |
| 20 Sep, morning | a remembered choice under a new key | correct, and still meant Kayode saw pounds and reported the default as broken |
| 20 Sep, evening | six currencies, five of them seeded | a price on the page that nobody had agreed to honour |

Nothing is stored and nothing is read now. Whatever is still in a visitor’s
browser from either scheme is ignored, so everybody sees naira from the
first paint. Proved by planting both `tlb_ccy` and `tlb_ccy2` and loading
the page.

**To go international**, the note is written at the site of each removal:
`currencies` in `web/js/config.js`, `buildCcyPicker()` in `web/js/site.js`,
the `ccy-slot` span on pricing.html, and three checks in `audit_web.js`.
The price table and `paint()` already handle several currencies, so it is
putting rows back with real agreed prices rather than rebuilding anything.

**A gate check bit me while doing it**, worth one line: the first version
asserted the source did not contain `remembered()`, which failed on the
COMMENT explaining why the function had been removed. A check that a name
is absent is always tripped by the note saying it is absent. Name the
storage, not the function.

## THE 14 DAY TRIAL — applied and live, except the card step

Kayode asked for it on 20 September, billing and website together, and for
both halves to be proved in Flutterwave test mode.

**The half that decides what is true is built and green.** 41 checks in
`supabase/tests/trial_harness.mjs`, covering exactly the two scenarios he
asked for: a trial that converts and a trial that is cancelled.

**The half that talks to Flutterwave is not, and could not be.** There is
no account, no key, and the standing rule is that the secret key is set by
Kayode server-side and never reaches this repo. So there is nothing to run
a test-mode charge against. What was done instead was to build everything
the charge lands on, so that when the webhook exists it is a third caller
of two functions that are already proved rather than a new set of rules.

### The rule that mattered most

A free trial plus a referral programme is a machine for paying commission
on revenue that never arrived. Fourteen days is long enough to sign up,
collect 8% of a subscription nobody paid for, and walk away.

So it is enforced twice. `partner_accrue_month` skips a business still on
trial, which is the engine doing the right thing. And a trigger on
`partner_ledger` REFUSES any accrual for a referral whose business has
never had a completed payment, which is the engine being unable to do the
wrong thing: not by hand, not from the console, not from a future webhook
written by somebody who has not read the file.

**Mutation tested.** Breaking `app.has_paid()` so it always returns true
turns six checks red. The suite is not passing by accident.

It also caught a fixture: `referral_fraud_harness` was seeding referrals as
"subscribed" by setting a date and nothing else, which is now a state the
database says cannot exist. Those two fixtures book a real payment now.

### Two decisions worth knowing about

**A trial now gets Pro ceilings, 5 studios and 50 logins, not 1 and 3.**
"Full Pro access" is a sentence with a consequence: a studio told that and
then refused a second studio would be right to say we had lied. The card
requirement is what makes it safe to hand out. `plan_limits_harness` used
to assert 1 and 3 and now asserts it equals Pro.

**`subscribed_on` finally has one writer.** No migration in this repo had
ever set it; it was written by hand, and it is the field the whole twelve
month commission clock counts from. `convert_trial_to_paid()` is now the
only thing that sets it.

### The website half is built and deliberately NOT live

Trial primary on Basic and Pro with Book a demo demoted, a primary call to
action in the hero, the trial in the nav, the drawer and the footer, and
Kayode’s exact line beside every one of them. `audit_web.js` reads the 14
out of the MIGRATION and fails if the pricing page disagrees with it, so
the two cannot drift.

**It is live, indexed and in the sitemap.** Kayode was shown the risk and
chose to ship the foundation anyway: "let’s get the foundation set so when
the keys land and flutterwave accounts land, its very easy to proceed."

So the one thing that is not true yet is stated here rather than buried.
The page says "Card required, nothing charged until day 15" and there is no
card form, because there is no Flutterwave. The button goes to the booking
page and a person sets the trial up, which an operator really can do:
`start_free_trial()` is applied and proved. **When the keys land, the only
thing that changes on the website is that button’s href.**

Applied to `eskubrbgbcbaejynjxvh` on 20 September. Verified after: trial
ceilings 5/50 matching Pro, the three trial columns, the commission guard
trigger attached, all five functions present, and neither anon nor
authenticated able to start a trial.

A side effect worth knowing: the demo `LAYI` account was over its ceiling
at 4 studios against a trial limit of 1. Moving the trial to Pro’s ceilings
cleared it, so nothing on the live project is over a limit any more.

### What is needed to finish it

Everything in the "What I need from you" table in BILLING.md, unchanged:
the dedicated Flutterwave account in test mode, the public key, the secret
key set by Kayode as an Edge Function secret, the webhook secret hash, and
the five decisions. Nothing here should be pasted into a chat message.

## Two bugs that both looked like something else

Both were reported on 20 September as "you did not do what I asked". Both
times the work had been done and something older was hiding it. Worth
keeping together, because the shape repeats: **a stale copy beat a correct
one, and nothing on the page could say so.**

### The screenshots that would not update

Kayode saw the old LAYI captures on the live site, sidebar and all, and
asked whether it was a regression, a bug or a bad upload. It was none of
them. All six live files were byte-identical to the repo, checked by hash.

They are served with `Cache-Control: public, max-age=604800` under filenames
that never change, so any browser that had loaded the old capture kept
drawing it from disk for a week. A hard refresh would have shown the new
one. **Nothing in the deploy was wrong and nothing in the deploy could have
fixed it.**

Every screenshot src now carries `?v=2`, and `audit_web.js` REQUIRES one.
A recapture that keeps the filename and forgets to bump the version is
invisible to every visitor who has been here that week, so the gate fails
the build rather than letting it ship to nobody. Bump the number on every
recapture. The gate also strips the query before checking the file exists,
because the query is a cache bust and not part of a filename.

### The naira default that was done and could not work

The picker opened in pounds on his machine. `setCcy(remembered() || 'NGN')`
was correct and had been since the morning.

**Before 20 September the page GUESSED a currency from the time zone and the
language, and wrote that guess to localStorage exactly as if somebody had
chosen it.** From then on the guess beat the default for ever. His browser
was replaying a guess made in August.

The first answer given was "that is your browser, not the page", which was
true and useless: every returning visitor had the same stuck value, and no
visitor can be told to clear their storage. The key is now `tlb_ccy2`, so
every old value is ignored and only a currency picked from the picker is
remembered. Proved on the live site by planting `tlb_ccy=GBP` and watching
pricing still open on naira at 20,000 and 49,000.

**The rule worth keeping:** never write a guess into the same place as a
choice. Once it is there, nothing downstream can tell them apart, and the
only way out is a new key.

## Products and the FAQ, 20 September

**Products is just the feature lists now.** "no explanations or long
stories". Every pane is the title and one list of bullets; the narrative
sub-heading and the paragraph under it are gone from all six. The Money
pane was six cards of heading-plus-paragraph and is now six bullets in the
same shape as the rest, carrying his sentences across rather than rewriting
them. Screenshots stayed, because they are the proof and he did not ask for
them to go. 1.5 screens to 1.4 on a phone.

**The FAQ was repeating itself in the answers, not the questions.** Three
promised the same export in different words, three explained the same 8%,
two explained the same 31 day hold. Each fact is now stated once, where
somebody would look for it. "Is it recurring, or only the first payment?"
and "Is the rate the same for every partner?" were one question asked twice
and are now "How much do I earn, and for how long?".

| | Before | After |
|---|---|---|
| Questions | 25 | 24 |
| Words in answers | 1,098 | 873 |
| Average answer | 44 words | 36 |

Four sections kept, which he asked for by name. Also reconciled: "How do I
pay?" said bank transfer or card while the next answer said we never take a
card. Both true, and together they read as a contradiction. It now says we
do not keep the card, which is what was meant.

**Still open:** the FAQ tone is a judgement call rather than a fact. He
asked for it to sound like a person wrote it and approved the deploy without
reading the new wording first, so it is worth him reading once on the live
site.

## SHIPPED 20 September 2026, and applied

The whole of this session went out, database first. `main` → `3eec43b` (a
merge), `admin-deploy` → `e110ffb`, and the two differ only by
`netlify.toml`, as intended.

**The order mattered and is the reason nothing broke.** The live database
had been moved onto the TIERED partner programme on 19 September while
every page in this tree said a flat 8%. Pushing either branch first would
have put the website and the database into open disagreement, in public,
about how much money a partner earns. So:

1. the five migrations, in filename order
2. `admin-api` redeployed (version 10 → 11, `verify_jwt` kept on)
3. the pre-flight queries
4. `admin-deploy` pushed — the console and the portal
5. `site/sw.js` bumped to `layi-v43`, merged to `main` with the
   `netlify.toml` recipe, pushed — the customer app and the website

### What the pre-flight actually found

| Check | Answer |
|---|---|
| Over a plan ceiling | **one**: `LAYI`, trial, 4 studios against 1. Known, deliberate, and what the console’s "Over plan" pill is for. Nothing was taken from it: the triggers only refuse an INSERT. |
| Referral codes backfilled | 8 businesses, 8 codes, none missing |
| Rate bands | 1 band at 8%, the three tiered ones deleted |
| Plan features | 10 in the catalogue, Pro has 10, **Basic has 0** |
| `partner_milestones` | dropped |
| New triggers | all 10 present |
| `anon`/`authenticated` write on the new tables | none |

`partner_milestones` held four definition rows (5→25k, 10→50k, 20→100k,
30→150k) and no awards, so dropping it lost a ladder nobody had climbed.
Earned money lives in `partner_ledger`, which was not touched.

### Verified on the live sites rather than assumed

- `app.thelabelboard.com` serves the **customer app** at `layi-v43`, not the
  console. The `netlify.toml` trap did not fire, and `publish = "site"` was
  confirmed on the merge commit itself before the push.
- `admin.` and `partners.` serve the console and the portal, both in Fraunces
- the story reads 15px at 1440 and 12px on a phone
- `referrals.html` returns **404**: deleted, not unlinked
- pricing opens in **naira** at ₦20,000 and ₦49,000, with no tier language
  anywhere. (It first appeared to open in GBP. That was this browser’s own
  remembered `tlb_ccy`, not the page. Worth knowing before somebody reports
  it as a bug: the default is NGN, and a remembered choice beats it.)
- partners.html is the seven lines and the form, 1,898 characters, 8% and
  twelve months, no tiers

### Two things this turned up, neither fixed

**`supabase/.temp/linked-project.json` is stale and points somewhere else.**
It names `gcdrkoitjqwbidcfgyzl` "The Label Board". The live project the apps
actually talk to is `eskubrbgbcbaejynjxvh`, which is where everything above
was applied. The file is gitignored CLI cache, so it misleads only whoever
runs `supabase link` next. Confirmed the right way round: all 31 applied
migration names line up with this repo’s files, ending in yesterday’s three.

**Leaked password protection is off** in Supabase Auth. Pre-existing, not
from this release, and an owner-only settings change. Kayode’s to turn on.

The security linter reports nothing new. The three `my_*` functions being
callable by `authenticated` is the design: each one is scoped by
`app.in_scope()` or `app.current_partner()` and can only ever answer about
the caller.

## The story type scale, and a rule that came out of it

Our story reads 15px on a wide screen, 13 on a tablet, 12 on a phone. It
took four passes, because the size was asked for without a device and I
applied it to all three: "font size 12 is a good enough size" meant the
laptop, and 12 on a laptop is not 12 on a phone.

**One of the three was dead.** The tablet rule was sitting inside a
`max-width:680px` block, and a later `680px` block further down the file
set 12px over the top of it, so a tablet silently got the desktop size and
the middle step never existed. It is in the story’s own `max-width:900px`
block now. The lesson is the same one this stylesheet keeps teaching: this
file has several phone blocks appended at different times, and a rule’s
position decides whether it renders at all. Measure the rendered size in a
browser rather than reading the declaration.

**Still open, and Kayode’s call.** At 15px the story line is 143
characters on an 1848px screen, against a comfortable 60 to 90. He asked
for the column not to be narrowed, so the fix, if he ever wants one, is
two columns on wide screens rather than a narrower single one.

## The phone pass, 20 September

Two attempts. The first one was wrong and is worth recording.

**What went wrong.** Kayode asked to check the phone sizes, with "no long
scrolling, not too much details". I read the small numbers as faults and
raised eight of them: footer links 12.5 to 14, trade tile lists 11.5 to 13,
tabs 12 to 13, buttons 12.5 to 13.5, and so on. He caught it: "you table
looks like increase rather than a decrease that i asked for."

He had already asked for the opposite on 18 September, in a comment sitting
in this very stylesheet: "strip down all pages and tabs sizes for mobile
view especially font sizes." Raising them also made most pages LONGER,
which is the thing he was asking to fix. Two instructions pointing the same
way, and I went against both.

**The lesson.** Small type and a small tap target are different faults with
different fixes. A 15px tall footer link is hard to hit; the answer is
padding, not a bigger word. And when a measurement looks like a fault, check
whether it was a decision first. This one was, and it was written down eight
lines above where I was working.

**What the second attempt did.** Reverted every size. Then took out SPACE
rather than growing anything: section padding from the 32px clamp floor to
22, plan card padding, feature list rhythm, table row padding, FAQ summary
padding, footer padding. Not one font size changed, not one word removed.

| Page | Before | After |
|---|---|---|
| pricing | 6.5 | 5.9 |
| faq | 3.8 | 3.6 |
| about | 3.3 | 3.2 |
| partners | 3.2 | 3.0 |
| contact | 2.9 | 2.8 |
| waitlist | 2.4 | 2.3 |
| home | 2.3 | 2.2 |
| book | 1.9 | 1.8 |
| products | 1.7 | 1.6 |

No page scrolls sideways at 375. The footer also still declared three list
columns on the phone after Your trade came out, so the right third was an
empty hole; that is fixed and was a real bug rather than a preference.

**The third pass took the type down**, which is what he asked for twice and
what the first pass had gone against. Body text 14 to 13, ledes 14.5 to
13.5, h1 29 to 26, h2 20 to 18, card text 13 to 12.5, FAQ answers 13.5 to
12.5, tabs 12 to 11.5, buttons 12.5 to 12, table cells 13.5 to 11.

### The comparison table now fits the screen

It used to be `min-width:540px` inside a horizontal scroller, so a phone
swiped sideways through it. Three changes and it fits 375 with none:

- `table-layout:fixed` with the three plan columns pinned, so the feature
  name takes what is left instead of four columns negotiating.
- **Yes and Not included render as a tick and a dash.** This is what makes
  it possible: "Not included" is twelve characters holding open a column
  that carries one bit of information. The words are still in the HTML and
  still read out; only their rendering changes.
- The plan columns are **60px**, which is measured rather than guessed. At
  10.5px the word "agreement" renders at 54px and needs 60 with its
  padding. 52 broke it as "agreeme / nt" and 56 as "agreemen / t"; both
  were guesses, and the third attempt measured the text with a canvas
  instead. Worth remembering: when a box is one word too narrow, measure
  the word.

The table went from 2.6 screens to 1.7 and from a sideways scroll to none.
The "swipe the table sideways" hint hides itself, because it would now be
a lie.

| Page | Start of day | Now |
|---|---|---|
| pricing | 6.5 | **5.1** |
| faq | 3.8 | 3.4 |
| about | 3.3 | 3.0 |
| partners | 3.2 | 2.9 |
| contact | 2.9 | 2.8 |
| privacy | 2.6 | 2.4 |
| terms | 2.4 | 2.2 |
| waitlist | 2.4 | 2.3 |
| home | 2.3 | 2.2 |
| book | 1.9 | 1.8 |
| thanks | 1.7 | 1.5 |
| 404 | 1.6 | 1.5 |
| features | 1.7 | 1.5 |
| reviews | 1.5 | 1.3 |

Nothing scrolls sideways on any of the fourteen. Pricing is still the
longest at 5.1, and what is left of it is three stacked plan cards (1.9)
and the table (1.7). Neither can shrink further without taking something
out of the cards, which is a content decision.

## Flutterwave billing: planned, not built

`BILLING.md` holds the plan. Seven phases, each ending in something
demonstrable. It is waiting on five decisions and a test-mode account.
The recommendation is tokenised charges over Flutterwave Payment Plans,
because the plan gates, the suspension rules and the commission engine all
already read from our database and Payment Plans would put the schedule
somewhere else.

## A fourth pass on the website, 20 September

| Change | Where |
|---|---|
| The seven billing questions moved to the FAQ | off `pricing.html`, onto `faq.html` as a fourth group |
| The footer link is now "Frequently asked questions" | was "Questions and answers" |
| Three sections deleted | `features.html`: "Not only for tailors", "Bring what you already have", "The fastest way to judge it is to open it" |
| The Your trade column is gone from the footer | every item was an anchor into the home page, not a page of its own |
| "Made in Lagos" is gone from the footer | |

`faq.html` is now four groups and 25 questions with none repeated. It is the
only place on the site that holds questions.

Five gate checks were re-aimed rather than the copy being put back:

- The product page no longer lists the trades, so only the site-wide check
  remains. Asking the product page specifically would be asking for the
  copy back.
- `CRAFT_SAYS` mapped each craft to ONE word, and the only place the site
  said "garment" was the lede that was removed. The home page has spoken to
  those studios all along, as bespoke tailors and ready to wear, so the map
  takes a list now. One word made it a check about vocabulary rather than
  about whether a studio sees itself on the site.
- The `on-light` floor came down from 12 to 8, which the site still clears.
- The invoice-only route is checked on the Bespoke CARD, not on the words
  "Talk to us", which had moved to the FAQ with the billing questions. The
  check had started passing on a different part of the page from the one it
  was written about, which is the quiet way a gate stops meaning anything.
- `.ftr-top` declared five columns and now has four children, which left a
  dead column on the right.

## The sections Kayode asked to be removed, finished

He screenshotted seven regions of the site and asked for all of them out.
The first pass removed some, moved some and left the rest, which he had to
raise twice: "if i want them, i wont ask that they been taken out".

Now out in full:

| Page | Gone |
|---|---|
| Home | the 22/5/0/1 strip, "The loop that closes itself", "See it with your own orders in it" |
| Pricing | the November waiting list band, the 0%/Unlimited/1/100% strip, "What the fee is standing next to", "Try it before you decide anything", "Neither of the two fit?" (folded into the Bespoke card as asked) |
| Partners | the whole page, replaced with the seven lines he sent |
| About | "Why it is called The Label Board", the questions list, "Come and see whether it fits your shop" |
| Support | "Things people ask in the first month" |

The three question lists are on `faq.html`, seventeen questions with none
repeated. Two gate checks went with the home strip: they asserted the
screen count and the role count that the strip printed. The check goes
with the claim rather than the claim being restored to keep a gate quiet.

**`waitlist.html` is still reachable** from the home hero, so removing the
pricing band did not orphan it.

## The plans are enforced now, 20 September

Was open on this list for one day. Kayode: "Build the gates properly, now
— this needs to be set up correctly before launch, not left open."

`PLAN_FEATURES` held one key, `chase`, and the comparison table marked
eight rows "Not included" for Basic that nothing enforced. There are ten
features now and the database holds every one of them.

| Feature | Enforced on | How |
|---|---|---|
| inventory | `app_state` `layi_dash_supplies` | trigger |
| suppliers | `app_state` `layi_dash_bills`, and the `suppliers` table | trigger |
| funds | `app_state` `layi_dash_pots` | trigger |
| team | `app_state` `_attendance` `_leave` `_shifts`, and the `attendance` table | trigger |
| marketing | `app_state` `layi_dash_campaigns` | trigger |
| companylog | `app_state` `layi_dash_log` `layi_dash_anns` | trigger |
| payroll | `staff.basic`, the rate every payroll figure is computed from | trigger |
| chase, reporting, reports | nothing | see below |

**Writes are blocked, reads are not.** A studio that drops from Pro to
Basic keeps everything it had and cannot add more, which is the rule
`audit_tiers` has had since the beginning. A new Basic account has nothing
in those keys, so reads return nothing anyway.

**Three features have no server surface and it is better to say so.**
Sending a reminder is a `wa.me` link opened on the device, with no server
in the path until we send messages ourselves. Reporting lines and full
reports are read-side arithmetic over rows Basic legitimately holds. All
three are gated in the app and listed in `my_plan_features()`, so a client
cannot grant itself one, but somebody determined with the anon key could
still compute them. What they cannot do is STORE anything.

Proved twice. `plan_feature_harness.mjs` (85) refuses each write on Basic
and accepts the identical write on Pro, including from a signed-in Basic
owner going straight at the table with no app in the way.
`audit_tiers.js` section 11 replaces each view’s render function with a
counter and shows it never runs on Basic and does run on Pro. Both were
mutation tested: giving Basic `funds` fails on the feature list AND on the
screen drawing.

**Still open:** `chase` cannot be enforced until reminders are sent by us
rather than handed to WhatsApp on the device. That is the one gate in the
ten that is still only a nudge.

## The comparison table, reconciled 20 September

Six discrepancies between the table, the pricing cards and the app. Five
fixed, one left for the decision above.

| # | What was wrong | Fixed to |
|---|---|---|
| 1 | The receivables rows were missing entirely, and they are the one real Basic-versus-Pro capability in the software | Added "See who owes you" (Basic: Yes, view only) and "Chase list and payment reminders" (Basic: Not included) |
| 2 | Table said "Six roles with permissions"; `defaultRoles()` returns five and the home page strip says five | "Five roles with permissions, and you can add your own" |
| 3 | Pro card sold "Client fitting records and measurement history" while the table gave "Customers and full measurements" to Basic. The app gates neither | The card line removed. Basic gets measurements and fitting history |
| 4 | Table said Pro had no priority support; the Pro card and the operator console both say it does | Table: Pro Yes |
| 5 | "Reporting lines, so managers see their own team" was on the Pro card and had no row | Row added, Pro and Bespoke |
| 6 | Onboarding: table Basic "Self serve", Pro Yes | Checked, already agreed with the cards. No change |

Three gate checks were added so the table and the cards cannot contradict
each other again: the roles row is counted against the app, the Priority
support row is compared with the Pro card, and the receivables rows have
to exist.

## APPLIED AND SHIPPED — 20 September, part three

Everything from parts one and two below, PLUS a fifth migration. All five
were applied to `eskubrbgbcbaejynjxvh` on 20 September and `admin-api` was
redeployed in the same release. The sections below are kept as the record
of what went in and in what order, not as a list of things still to do.

| Applied, in this order | What it does |
|---|---|
| `20260920100000_plan_limits.sql` | Studio and login ceilings, enforced by triggers |
| `20260920110000_partner_flat_commission.sql` | One 8% band, the twelve month clock |
| `20260920120000_console_plan_and_partner_usage.sql` | What the console reads |
| `20260920130000_one_referral_programme.sql` | Every customer is a referrer, and the anti-fraud |
| `20260920140000_plan_feature_gates.sql` | **New.** Basic cannot write a Pro feature, by app or by hand |

`admin-api` now also serves `partnerCommission`, `setStudioLimits`,
`referralRisk` and `setPayoutFrozen`, and its `partners` action reads a
summary rather than the table. It has to be redeployed in the same release.

### The fourth migration is the one to read before applying

It is the only one that changes what happens on every future SIGNUP:
`app.provision_studio()` now also creates a `partners` row for the new
studio and, if the account carried a `referral_code` in its metadata,
attaches the referral. It also backfills a code for every business that
already exists.

Two things to know before it runs:

1. **The backfill skips a business with no active owner**, because a code
   belongs to a person. Those get one the day somebody signs in. Expect the
   count of new `partners` rows to be lower than the count of businesses.
2. **An existing partner who is also a customer is converted rather than
   duplicated**: their row gets `business_id` and `kind = 'customer'`.

### Pre-flight, after applying

```sql
-- who is over a plan limit (they will ring)
select b.name, b.plan, u.studios, u.max_studios, u.seats, u.max_seats
from public.businesses b cross join lateral app.usage_for(b.id) u
where (u.max_studios is not null and u.studios > u.max_studios)
   or (u.max_seats   is not null and u.seats   > u.max_seats);

-- every business should now have a code, or have no owner yet
select count(*) filter (where p.id is not null) as with_code,
       count(*) filter (where p.id is null)     as without_code
from public.businesses b
left join public.partners p on p.business_id = b.id;

-- and nothing should be flagged on day one
select kind, count(*) from public.platform_referral_risk() group by 1;
```

### What changed in part two

**One referral programme.** Every business gets a code on its first day.
Outside partners and customers are the same table and the same 8%.
`referrals.html` and its free-month scheme are deleted.

**Anti-fraud, built in rather than bolted on.** Self-referral refused on
four axes, one payment method per business, attribution permanent, churn or
refund inside the 31 day hold voiding pending commission, a per-referrer
payout freeze, and a risk list for the console. `referral_fraud_harness`
proves the two Kayode asked for and 73 other things.

**Typography.** Fraunces plus Inter across the website, the console and the
portal. The customer app is deliberately untouched: it must open with no
network.

**The screenshots no longer show Kayode’s studio.** The example studio is
Adé Atelier now, and all six images were retaken from it at framings
measured back off the originals.

**Our story** is his text, with his photograph in the hero.

### Found on the way

- **`app_schema_harness` was reading the wrong `provision_studio`.** My
  fourth migration copied the 20260904180000 version, which is one
  generation behind: the billing migration had since added
  `perform app.ensure_billing_record(v_biz)` to it. Copying the wrong
  generation is the same failure as retyping from memory and looks
  identical in a diff. `billing_harness` caught it in one run. **When
  replacing a function, grep every migration for its name and copy the
  LAST one.**
- **A late self-referral is not a churn.** The recheck marked a
  never-converted referral as lapsed, which
  `partner_referrals_lapsed_after_paid` correctly refuses, so the payment
  method insert failed. The test helper swallowed the error and the failure
  surfaced three assertions later pointing at the wrong function. Both are
  fixed; the harness now asserts every insert it performs.

### Still open

- **`ownerPassword: 'layi2025'`** is still the fallback password for any
  studio that never set one. It was left alone with the demo rename because
  changing it locks those studios out. It wants a migration that forces a
  reset, not a rename.
- **`apple-mobile-web-app-title` is still "LAYI"** in the customer app, so
  an installed phone shows that on the home screen. Changing it renames the
  app on devices that already have it, which is a decision rather than a fix.
- **The website has no signup form that carries a referral code yet.** The
  database reads `raw_user_meta_data ->> 'referral_code'`, and the only
  thing that writes it today is the console invitation. A public "you were
  sent by" field is the next piece.
- **Nothing writes `payment_methods` yet.** The table, the uniqueness and
  the self-referral recheck are all live and proved, but no payment
  processor is connected, so nothing inserts a fingerprint. The control is
  in place ahead of the thing it controls, which is the right way round.
- `mutation_check.mjs` still reports three SKIPs, unchanged and
  pre-existing. See part one.

## NOT APPLIED AND NOT DEPLOYED — 20 September, the repricing and the flat programme

Everything below is written, green on every gate, and **sitting in the working
tree**. Nothing is committed, nothing is pushed, and the three new migrations
have **not** been applied to `eskubrbgbcbaejynjxvh`.

That last one matters more than usual. The live database was moved onto the
TIERED programme yesterday (`20260919171055`, `171119`, `171236`), so until
these are applied the live project pays 0/6/7/8 on a four year clock while
every page, portal and console in this tree says a flat 8% for twelve months.
The two must not be released separately.

| To apply, in this order | What it does |
|---|---|
| `20260920100000_plan_limits.sql` | The studio and login ceilings, enforced by triggers |
| `20260920110000_partner_flat_commission.sql` | One 8% band, the twelve month clock, drops the milestones |
| `20260920120000_console_plan_and_partner_usage.sql` | What the console reads to show usage and commission owed |

`admin-api` also has three changes in it (`partners` now reads the summary,
plus `partnerCommission` and `setStudioLimits`), so the Edge Function has to
be redeployed in the same release or the console calls two actions that are
not there.

### A pre-flight worth running before the limits migration

The triggers only ever refuse an INSERT, so applying them cannot break an
existing studio. But it is worth knowing who is over, because they are the
ones who will ring:

```sql
select b.name, b.plan, u.studios, u.max_studios, u.seats, u.max_seats
from public.businesses b cross join lateral app.usage_for(b.id) u
where (u.max_studios is not null and u.studios > u.max_studios)
   or (u.max_seats   is not null and u.seats   > u.max_seats);
```

(Run it after applying, since `app.usage_for` is created by the migration.)
The demo `layi-multi-studio` account is known to be one of them: it is on
trial with four branches, which is deliberate and is what the console’s new
"Over plan" pill is there to show.

### What changed, in one list

**Prices.** Basic 27,000 → 20,000, Pro 65,000 → 49,000, in the website config,
the pricing page, the console, the app and the portal. Yearly is still worked
out as eleven months for twelve. The five non-naira currencies were re-seeded
at the same ratio and are still seeds.

**Limits, agreed earlier and never applied anywhere until now.** Basic 1
studio / 5 logins, Pro 5 studios / 50 logins, Bespoke by contract. Enforced by
BEFORE INSERT triggers on `branches` and `memberships`, with per-business
overrides on `businesses.max_branches` and `max_seats` that a tenant cannot
write. Pro used to sell unlimited logins; that is the one change that narrows
a promise already made, and it is a number everywhere rather than a softer
form of words.

**The partner programme, flattened.** 8% of what each referred business
actually pays: every month for twelve months on a monthly plan, once on a
yearly plan, only while they pay, and only the partner earns. Tiers and
milestone bonuses are gone from the website, the portal, the console and the
database — the milestone table and its function are DROPPED rather than
emptied, so nobody can turn the programme back on with four inserts.

**The website.** Seven sections removed, `faq.html` added carrying the
seventeen questions that were spread across three pages, the comparison table
taken out of its `<details>` and moved under the cards, "Neither of the two
fit?" folded into the Bespoke card, the currency picker opening on Nigeria,
and "Founder, England" became "Founder".

### Three things found on the way that were nobody’s ask

1. **`sync_web_shell.js` wrote LF into CRLF pages.** Only bit when it rewrote
   a header, and then every page failed the gate at once with "carries the
   same header as every other page", which reads like the header changed.
   Two bytes of whitespace. Fixed.

2. **`plan_limits` was writable by `authenticated`.** First draft revoked from
   `anon` only, and Supabase’s default privileges had already granted all to
   both. RLS meant the write touched no rows and reported no error, so it
   looked harmless. The harness asks for the PRIVILEGE rather than trying the
   write, which is the only way that shows up. Third time this project has
   been caught by the same default.

3. **`app_schema_harness` never checked an RPC that takes arguments.** The
   pattern was `rpc\('([a-z_]+)'\)`, with a closing paren, so it only ever
   matched a call with no arguments: `set_studio_plan`, `set_studio_storage_cap`
   and every new one went unverified. A gateway calling a function that does
   not exist ships green and fails the first time an operator presses the
   button. Fixed, and it now covers fourteen RPCs instead of nine.

### Still open from this session

- **`mutation_check.mjs` reports three SKIPs**, which it counts as a failure.
  They are pre-existing: all three patterns target
  `20260827090000_tenant_isolation.sql`, which this session did not touch, and
  the patterns have drifted from that file’s current text. The suite it
  mutates (`rls_harness`) is green at 71 checks. Worth an hour to re-aim the
  three patterns, because a meta-check that always reports a failure is a
  meta-check nobody reads.

- **The customer referral programme still gives a free month to both sides**
  (`referrals.html`, `SITE.referral`), while the partner programme now says in
  as many words that a referred business gets nothing. They are two different
  programmes so it is not a contradiction, but a business referred by a partner
  and a business referred by a customer are treated differently and nothing on
  the site explains why. The referral reward is still marked PROPOSED and never
  built into billing. Kayode’s call.

- **The pricing table still says "Six roles with permissions"** and the app
  ships five (the sixth is demo-only). Known before this session, untouched in
  it, and it is a claim on a public page.

- **`partners.tier` is a column nothing reads.** Left in place rather than
  dropped: it is not null with a check constraint and live rows carry it, so
  dropping it is a migration with nothing to gain. `admin-api` ignores
  `body.tier` rather than validating it, so a stale client cannot set it.

- **Kayode is sending a photograph for Our story**, and will edit that page’s
  text and send it back. Nothing has been changed there beyond the signature.

## Shipped 19 September 2026, third batch

`main` -> `f108ce9`, `admin-deploy` -> `c4bddf4`. Verified live rather than
assumed: the partner ladder reads 0, 6, 7 and 8 per cent under the new names,
the product page opens with the area you picked and has no tab strip, the
drawer carries the five areas, the screenshots are the cropped ones at
1328x1063, and all twelve pages render at 390 with no broken image and no
sideways scroll. `app.thelabelboard.com` still serves the customer app.

## The commission engine is live in the database, 19 September

Both migrations applied to `eskubrbgbcbaejynjxvh`, plus a third the Supabase
linter asked for. The pre-flight check came back clean: **0 referrals marked
lapsed without a date**, and none lapsed at all.

| Applied | |
|---|---|
| `20260919171055` | `partner_commission` |
| `20260919171119` | `partner_milestones_and_payouts` |
| `20260919171236` | `partner_tier_rate_invoker` |

Verified against the live database rather than assumed: the ladder reads
0/5/15/30 to 0/6/7/8 under the new labels, the four milestones are 25k, 50k,
100k and 150k, all four new constraints exist, and the two historic ledger
rows at 30% are untouched, one paid and one pending. Forward only held.

Grants, checked with `has_function_privilege` rather than by calling:
all seven functions executable by `service_role`, **none by `anon`**, and only
`partner_tier_rate` by `authenticated`, which is the ladder the portal shows.

**The linter found one of mine.** `partner_tier_rate` was SECURITY DEFINER out
of habit and sat on `/rest/v1/rpc` callable by any signed-in user. It reads
nothing they cannot already read, so it is INVOKER now and the warning is
gone. The four remaining security findings are older and deliberate:
`submit_enquiry` is anon-callable because the website forms use it,
`my_storage_usage` is a studio reading its own, and four service-role-only
tables have RLS on with no policy on purpose.

**Nothing is scheduled yet.** No job calls `partner_accrue_month`,
`partner_award_milestones`, `partner_clear_ledger` or `partner_payout_run`.
Until one does, no commission accrues. Today that costs nothing: one partner
has a single paying referral, which is under the five needed to unlock
earning, and the other three have none.

**Next, and it is the last piece:** a monthly job and a yearly one. A Supabase
scheduled function is the obvious home, and it needs the service role key,
which is Kayode's to put in.

The whole partner commission engine is in the repo and proven by a 137 check
harness, and **none of it is in the live database**. Nothing deployed calls
it, so the site is consistent either way, but no commission is being accrued
and no milestone awarded.

| Migration | What it adds |
|---|---|
| `20260919120000_partner_commission.sql` | the rate ladder, the four year clock, the monthly accrual |
| `20260919160000_partner_milestones_and_payouts.sql` | the milestones, clearing, the yearly payout run |

**Check this before applying.** The first migration adds
`check (stage <> 'lapsed' or lapsed_on is not null)` to `partner_referrals`.
If any live row is marked lapsed with no date, the migration fails and stops.
Run this first and expect zero:

```sql
select count(*) from public.partner_referrals
 where stage = 'lapsed' and lapsed_on is null;
```

**Also still to build:** nothing calls `partner_accrue_month`,
`partner_award_milestones`, `partner_clear_ledger` or `partner_payout_run` on
a schedule. They are functions waiting for a monthly job and a yearly one.

## Reviews: the landing place is built, the permission is not

**Deployed 19 September.** `main` -> `ce23e06`, `admin-deploy` -> `5889cea`.
Nothing on the live site looks any different, which is the point: the blocks
are hidden, `/reviews` and `/reviews.html` both redirect to the home page,
`reviews.html` is noindex and out of the sitemap, and no footer links to it.
All seven flip together the day the first real review goes in.


**Built 19 September, not deployed.** Kayode overruled my advice to wait for
three real reviews before building anywhere to put them: *"reviews wont get
anywhere to fall so it hangs in the cloud ... i mean we cant wait."* He was
right. October is the month the first studios say something and it would have
arrived with nowhere to go.

There is now a `reviews.html`, a block on the home page and a block on the
pricing page, all empty and all invisible. Nothing on the live site changes
until a real review goes in.

**In October the whole job is:**

1. paste the card into `web/reviews.html` between the two markers, shape
   documented in the file
2. `node sync_reviews.js`
3. `node audit_web.js`
4. deploy

**The redirect needs a `!` and went out once without one.** Netlify applies a
redirect only where no file matches the path, and `reviews.html` is a real
file, so the plain rule was accepted, deployed and silently ignored: the empty
page was live at `thelabelboard.com/reviews` until the post-deploy fetch found
it. Fixed the same hour with `302!`, and the gate now demands the mark. The
lesson is about the release rather than the rule: **no static gate can prove
what Netlify will do, so fetching the url after a deploy is the last step and
not a formality.**

Step 2 flips all seven things that have to agree: the two page blocks, the
`hidden` attribute on each, the `noindex`, the sitemap, the footer link and the
redirect that currently sends `/reviews` to the home page. `audit_web.js` fails
if any one of them is done and the rest are not, so it cannot end up half on.
Tested by doing it and then undoing it; nine mutants, none survived.

### BLOCKING: nothing records permission to quote

This is the real gap and it is **not** on the website.

`public.feedback` has taken `kind = 'review'` since August, with a 1 to 5
rating, a body and a contact, and the console reads it. The app offers it as
"Something you like" with the hint "What is working well. **We may ask if we
can quote you.**"

We may ask. Asking is a conversation, the answer lives in somebody's WhatsApp,
and a year from now nobody can point at it. Publishing a studio's name and their
words off the back of that is not something to do.

Three chats, none of them the website:

| Where | What |
|---|---|
| `supabase/` | a migration adding `may_quote boolean not null default false`, `quote_name text` and `quote_role text` to `public.feedback`. Copy the shipped function bodies, do not retype them |
| `site/` | the review form asks the question, only on `kind = 'review'`, and takes the name and the label they want printed |
| `admin/` | the feedback screen shows the flag and generates the finished `<article class="rev">` to paste, so the October job really is paste and run |

**Do this before October**, not during it. Without it the section stays empty
however good the feedback is.

## Shipped 19 September 2026

**All five queued commits are live.** `main` → `4845afa` (a merge), `admin-deploy`
→ `fbc7fe1`, and the two branches differ only by `netlify.toml`, as intended.
`publish = "site"` on main was confirmed before the merge commit and again on
the commit itself, and `app.thelabelboard.com` was checked afterwards: it serves
the customer app, not the console, so the trap did not fire.

What went out:

| Commit | What it is |
|---|---|
| `8c4ad58` | Yearly is eleven months for twelve, a Products menu, a lighter pricing page |
| `c53c149` | Hero buttons and clock back at the pixels they were at |
| `5b35f54` | The dead band cut off the bottom of the hero |
| `8933306` | The disclosure pass |
| `fbc7fe1` | The Products menu made real, the phone type pass, the Lagos card off |

Verified on the live site rather than assumed:

- all five deleted screenshots return **404** at their old urls, and the five
  kept return 200
- the Products menu opens on click, is one column, switches the area without a
  reload and closes behind the choice
- the home page has eight tiles, no panels, and every one of the eight ids the
  footers link to
- all twelve pages at 390 match the local measurements to the pixel, and none
  of them scrolls sideways
- no broken image on the home page

**Still to decide:** whether the five deleted screenshots should be recaptured
smaller and put back, or left out. They are in git history at `5b35f54~1`.

**Where client reviews go is answered**, see the section above. The
recommendation to wait was overruled on the same day and rightly.

## What went out, and why it waited

Kayode said "dont deploy yet" on the batch of 17 September, and lifted it on
19 September once the menu and the phone type were done. In order:

| Commit | What it is |
|---|---|
| `8c4ad58` | Yearly is eleven months for twelve, not ten. A Products menu in place of the Features tab. Pricing page trimmed. **The eleven month change is in `admin/js/data.js` too**, so the console and the site quote the same number |
| `c53c149` | The hero buttons and clock put back at the pixels they were at before the screenshot moved |
| `5b35f54` | The dead band of photograph cut off the bottom of the hero |
| `8933306` | The disclosure pass: see below |

The recipe, for next time: every gate, then
`git checkout main && git merge --no-ff --no-commit admin-deploy && git checkout HEAD -- netlify.toml && git commit`,
confirm `publish = "site"`, push `main` then `admin-deploy`, verify live.

## The disclosure pass — 18 September, not deployed

Kayode: "as much as we want to sell, we also dont wamt to give too much
information that leaks all our key features to the public or for other
developers to steal." Four cuts, all four done, reasoning in `WEBSITE.md`
under "The disclosure pass".

1. The "Built and shipping soon" roadmap is gone from `features.html`. The gate
   that used to demand it now fails on the opposite: any page selling payments,
   automatic WhatsApp or the storefront as built breaks the build.
2. Five of the nine app screenshots **deleted** from `web/img/screens`, not
   just unlinked. A file left in a published folder is still fetchable.
3. Mechanism rewritten as outcome throughout `features.html`.
4. Ten feature areas became five, the Products menu with them, and the eight
   home page trade panels became eight tiles carrying their own highlights.

**Then, 19 September, still not deployed:** the Products menu is a real menu.
It was built looking right and doing nothing, and never deployed, because every item points
at `features.html#something` and the code that opens the right area ran only on
load, so from the product page itself the hash changed and nothing happened. It
runs on `hashchange` now, and the trigger opens the list rather than navigating
away. The list is one column. Every page is checked rather than `index.html`
alone, because the header is copied into twelve.

**And a phone type pass.** Every page measured at 390, **2,341px saved across
the twelve**, most of it on `partners`, `about` and `referrals`. The product
page lede was 17px and seven lines tall sitting over 13.5px body text, and
`privacy` and `terms` ran entirely at 16px. Nothing above 16px is left on a
phone except headings, prices, the countdown digits, the partner figures and the
signature on the story page.

**The "Built for a real Lagos day" card came off** and the offline area runs the
full width of the product page now.

**Still to decide:** whether the deleted five should be recaptured smaller and
put back, or left out. They are in git history at `5b35f54~1` if wanted.

**Standing rule from the same day:** check the phone before the laptop on
anything in `web/`. The tile change was 258px shorter at 1280 and would have
been 446px longer at 390 if it had been built the obvious way.

**Shipped 18 September, second batch.** The home page carries a live
countdown clock to the launch date and a Join waitlist button. The hero lede
moved down to the trades section. `main` -> `9542877`, `admin-deploy` ->
`c6b7ca1`, and the two branches differ only by `netlify.toml`, as intended.

**The launch date is `2026-11-01`, set in `web/js/config.js`.** Kayode said
"November" and never a day; this was chosen and deployed on his word to go
ahead. It is one line, in one place, and the clock, the fallback sentence and
the day the clock removes itself all read it. Change it there and nothing else
needs touching.

**Shipped 18 September.** The free trial is off the site entirely, the website
is decongested, October early access is built and deployed, and the waiting
list is live at `thelabelboard.com/join`. Migration `early_access_cohort`
applied, `admin-api` at **version 10**, `main` → `6dd9e74`,
`admin-deploy` → `7cf0e34`. Every gate green, including a new one.

## How this run works

**Prototype first.** Anything that changes a workflow or a data model gets its
shape shown and agreed before it is built.

**Answered, 11 Sep.** One Shop and one board for a studio doing both halves of a craft.
A custom type is asked for its craft *and* its mode, and **both modes can be true**.
`SETTINGS.businessType` stays as a read-only fallback — it is the last thing standing
behind a device whose branch list has not arrived yet, and deleting it to be tidy is how
somebody signs in to an app with no tabs.

**Nothing ships until Kayode says so.** Commits are fine. Pushing, merging to
`main`, deploying an Edge Function and applying a migration to the live
Supabase project all wait, and happen at the END of the run rather than after
each change. Gates still run every time. *This run: said on 11 Sep, and
`layi-v40` went out. The rule stands for the next batch.*

---

## The deploy — shipped 11 September 2026

**`layi-v40` is out.** Both branches pushed on Kayode's word.

| | Step | State |
|---|---|---|
| 1 | `APP_VERSION` and the service worker `CACHE` moved to `layi-v40` | done |
| 2 | `git push origin admin-deploy` → `5b3d452`, publishes the **admin console**. Netlify site `thelabelboard-admin`, built and published | done |
| 3 | Merge to `main` → `d0c50b5`, publishes the **customer app**. Netlify site `thelabelboard`, built and published | done |
| 4 | Build stamp on a real phone reads **layi-v40** | **confirmed by Kayode** |
| 5 | Tell every device in a studio to **reload once**. Not required, but it collapses the window below to nothing | **Kayode, when convenient** |

**Correction:** step 2 does *not* publish the partner portal. Only two Netlify
sites deploy from GitHub, `thelabelboard` and `thelabelboard-admin`, and the
admin one publishes `admin/` alone. **`partners/` is deployed nowhere.** See
the Netlify section below.

**Nothing in this release touched the database.** `supabase/` was unchanged
against `main`, so no migration was applied and no Edge Function deployed. The
whole release is static files, which is why it could go before the Supabase
dashboard items were finished.

**How the merge was done, for the next time.** In a throwaway `git worktree` on
`main`, not by switching branches: the working tree had 19 uncommitted files
from another session's work on `web/`, and switching would have dragged them
across. The worktree was checked three ways before the commit — `netlify.toml`
still reads `publish = "site"`, `site/` is byte-identical to `admin-deploy`, and
all 50 gates were run **against the merged tree** rather than against the branch.
The worktree is gone and those 19 files never moved.

**The release window.** For as long as one phone in a studio is on v40 and
another has not swapped yet, the old one shows only open orders: it knows one
storage key and the new build writes the finished half into a second one.
**Nothing is lost** — the finished orders are in the cloud and on every updated
device, and they come back the moment the old phone reloads. Found and fixed
on 11 Sep: the same window used to make the new build count those orders twice,
which read as ₦696,000 of revenue nobody earned on the demo data alone.

```bash
git checkout main && git merge --no-ff --no-commit admin-deploy && git checkout HEAD -- netlify.toml && git commit
```

That `git checkout HEAD -- netlify.toml` is the whole trick. The file says
`publish = "admin"` on this branch and `publish = "site"` on `main`, the merge
is clean, and without that line every studio opens the app and gets the
operator console. Item 6 under **Waiting on Kayode** removes the trap for good.

**Not blocking the deploy, but true:** the marketing site `web/` has
uncommitted work in the tree from another session (screenshots, `WEBSITE.md`,
`.claude/launch.json`). It is untouched and unstaged. `web/` is connected to no
Netlify site, so it publishes nowhere either way.

---

## Already built — do not spend a day rebuilding these

Checked in the code, not assumed.

| Thought to be missing | What is actually there |
|---|---|
| Fabric costing for solo studios with no inventory | Every order has `costs[]` — label, amount, supplier — feeding profit per order. No stock record needed |
| Tenant switching the currency they are paid in | Per-order **"Client pays in"** dropdown plus an fx rate. Studio base currency in Settings |
| Payment by cash tracking | Studio-editable payment-method list; every money path asks how it moved. Money with no method reads "Not recorded" rather than being guessed |
| Shop purchase → sale, stock down, revenue | `recordSale()` checks stock by size/colour, refuses if short, decrements the variant, captures unit cost, logs the movement, posts the income |
| Expense structuring | 13 categories, departments, vendors, projects, branches, and recurring bills |
| Invoice carrying discount, deposit, balance, logistics | All present, and a receipt is generated on completion |
| **QC checklist** | Exists, is editable per studio, and since 11 Sep starts from the craft. Ticked per check, pass/fail with who and when, a fail sends it back for rework. Still one verdict per order rather than per item — see #7 |

---

## In the morning — 19 September

Four things, in this order. The first three take a few minutes between them.

1. **Read the 3 demo submissions** on the website's Netlify Forms tab, the last
   dated 15 Sep. Real people asked for a walkthrough and nothing told us. They
   sat there because notifications were only turned on last night.
2. **Check `contact` for a submission in spam.** That form showed "No
   submissions yet" and "Last submission on Sep 16" at the same time, which
   usually means one was filtered rather than lost.
3. **Test the waiting list end to end.** Fill it in on the live site, confirm
   the email reaches `hello@`, confirm the row appears on the console's Early
   access tab, then delete the Netlify submission. This is the one thing the
   deploy checks could not prove: the curl test called the database directly
   and never went through Netlify, so it exercised one half of the chain.
4. **Clear the deploy check row** from the console: "Deploy Check / Deploy Check
   Studio", `deploy-check-18sep@thelabelboard.test`, sitting on Early access as
   `new`. Mark it spam or closed. It could not be removed when it was made
   because the SQL tool is read only, and deleting one row through the
   migration tool would have recorded a data delete as a schema change.

---

## Why the waiting list page is only a form

It shipped on 18 Sep with a hero above the form and a "What you are joining"
section under that. Both came off the same day on Kayode's call, and the
reasoning is worth keeping because it applies to every page of this kind:

**Somebody who has clicked Join waitlist has already decided.** A page that
keeps making the case to a person who has said yes is giving them time to
change their mind. Everything those two blocks said is either on the home page
they came from, where a clock is counting to the same date, or is something
they hear on the call.

The page is now the heading and the form. "Tell us about your studio" is the
h1, because the one it had went with the hero.

**No count of places appears anywhere public**, here or on the home page. A
counter is a promise that has to be fed from the console or it is decoration,
and `cohort_taken()` exists in the database for the day that changes.

---

## The roll-out plan — Kayode's numbers, 18 September 2026

**This is a planner, not copy. None of it goes on the website until it is
decided and written properly.**

A "founding members" band sat on the pricing page promising the first seventy
five businesses **forty percent off the list price, for life**. Nobody had
agreed those numbers, and at that discount the offer loses money on every
business it wins. It came off on 18 Sep.

What Kayode actually intends:

| When | What | The point of it |
|---|---|---|
| **October 2026** | Early access | The **first 20 sign-ups get one month free** |
| **November 2026** | Full roll-out | The app opens properly, at list price |

The month is not a discount, it is a trade: real studios using it on real work,
telling us what breaks, and leaving a review at the end. Three things follow,
and none of them are built:

1. **Somebody has to count the twenty.** A free month for the first twenty
   means the console knows which twenty and stops at twenty. Nothing counts
   sign-ups today.
2. **A free month is a billing state, not a coupon.** `trialEndsOn` exists on a
   subscriber record but nothing sets it from a rule.
3. **Collecting the feedback is the whole reason for the month.** The feedback
   channel is built and reaches the console. What is missing is asking at the
   moment somebody has just done the thing.

---

## Waiting on Kayode

Needs a password, a dashboard setting on a live service, or a commercial call.

| | What | Why it matters |
|---|---|---|
| 1 | **Supabase → Auth → URL Configuration.** Site URL + redirect URLs with `/**` | Password resets and email confirmations land nowhere until this is set |
| 2 | ~~SMTP for auth email~~ | **Done 12 Sep.** Resend, sending as `hello@thelabelboard.com` from the verified root domain. Both `thelabelboard.com` and `send.thelabelboard.com` are verified; the root is the one that matters, because it is what lets the From address be clean and stops Gmail showing "via". Mail records re-checked after every step and never touched. **Untested until a real auth email is sent** |
| 3 | **Auth → Policies → leaked-password protection: ON** | Off today. Checks new passwords against known breaches. One toggle — and it matters more now the per-IP sign-in limit is 200, because a password policy is the real brute-force defence, not a rate limit |
| 4 | **Move Supabase off Free before the first studio uploads photos** | Free is **1GB of file storage**, and Basic is sold as **20GB**. One studio cannot use a twentieth of what it is promised. Also 500MB database and 5GB egress, about 15 studio-months of data and 3 of traffic. Pro is $25/mo ≈ ₦33,300, roughly one Basic subscriber. Checked 11 Sep: 30MB of 500MB used, 0 of 1GB storage, 11 monthly active users |
| 5 | ~~Delete the old project `gcdrkoitjqwbidcfgyzl`~~ | **Done 11 Sep.** One project left: ref `eskubrbgbcbaejynjxvh`, eu-west-2, renamed to `The Label Board` the same day. A rename does not change the ref or the URL, so no config moved. The CLI link on any machine that pointed at the old project must be redone: `supabase link --project-ref eskubrbgbcbaejynjxvh` |
| 6 | **Change the password that appeared in a screenshot** | It was visible in an image shared into a session |
| 6b | ~~Turn on Netlify form notifications~~ | **Done 18 Sep.** One rule, `hello@thelabelboard.com` on a new submission from **any form**, which covers all five and does not need updating when a sixth appears. A waitlist-specific rule was added first and removed, because "any form" already included it and two copies of one enquiry in a shared inbox get worked twice. **Still to do: send a real submission through and confirm the email lands** |
| 6c | **Have a Nigerian lawyer read `privacy.html` and `terms.html`** | Both are honest plain-language drafts that match how the site, the app and the partner programme actually behave, but neither has been reviewed. This was only ever recorded as an HTML comment inside the two pages, which means it was being served to the public until 18 Sep. Re-read them the day analytics, a payment provider or an email list is added, because each one changes what the privacy notice has to say |
| 7 | Netlify: **over 75% of the monthly credit allowance used** on 11 Sep | Check Usage & billing for whether it is builds or bandwidth. Four pushes in one hour on 11 Sep each rebuilt the admin site, which did not help. Batch pushes |
| 8 | **The backup file leaves out three keys the app syncs.** `exportData()` writes 20 keys; `STATE_KEYS` syncs 21. `orders_done`, `planner` and `shifts` are real data that reach the cloud and are missing from the downloaded file, so a customer who exports and reinstalls loses them. Found on 2026-09-19 while checking whether the website could honestly claim 100% exportable. It cannot, and the website copy has been softened; the app is the actual fix. | small |
| 9 | **The branch report clips its Outstanding figure.** The four combined-total cards at the top of `openBranchReport()` are wider than the modal body, so the last digit of Outstanding is cut off. Reproduced at 1180, 1400 and 1700 wide, so it is the modal max-width rather than a narrow viewport. Found on 2026-09-19 while capturing that screen for the website; the website crop avoids it. | small |

---

## SMTP, the last thing the partner portal needs

**Supabase’s built-in sender cannot do this.** It sends **2 messages an hour,
and only to your own team**, explicitly not for production. So a real provider
is required, not optional.

**Do not use the Microsoft 365 mailbox**, tempting though it is since it exists
and is paid for. Microsoft disables SMTP AUTH by default on new tenants and is
retiring basic authentication for SMTP submission, so it is a login flow built
on a door Microsoft is closing. It also throttles, and a throttled one-time code
is a partner who cannot get in.

**Use a sending SUBDOMAIN, not the root domain.** This is the part that matters
here. `thelabelboard.com` publishes `v=spf1 include:secureserver.net -all` — a
**hard fail**. Adding another sender to that record risks the mailbox that now
runs the business. Verifying `send.thelabelboard.com` instead leaves every
existing MX, SPF and DKIM record untouched, which is the same rule we have
followed through six DNS changes today.

Recommended: **Resend**. First on Supabase's own list, 3,000 emails a month
free, three domains on the free tier.

1. Create the account, then **Domains → Add Domain → `send.thelabelboard.com`**.
   It asks for a **region**: pick the one closest to the recipients, which for
   Nigerian partners is **eu-west-1 (Ireland)**.
2. Resend then shows the records. In GoDaddy: **Add New Record** for each,
   TTL 600.

   **Resend asks for an MX record, and that is fine.** Earlier note said "touch
   nothing of type MX", which was right about the root and wrong as a blanket
   rule. The real rule is narrower: **never touch the MX whose Name is `@`** —
   that one is the Microsoft mailbox. An MX on `send` is a different record and
   cannot affect it. That is the entire reason for using a subdomain.

   Still true: do not edit the existing root TXT records.
3. Say the word and I will verify they have propagated, and re-check that the
   root mail records are still intact, the same way as the domains.
4. Create an API key in Resend.
5. Supabase → **Authentication → SMTP Settings** → enable custom SMTP:

   | Field | Value |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `587` |
   | Username | `resend` |
   | Password | the Resend API key |
   | Sender email | `hello@thelabelboard.com` |
   | Sender name | The Label Board |

6. **Rate limits, settled 12 Sep.** Every one of these is **per IP address**,
   not global, which is the thing that makes them easy to get wrong: ten
   thousand studios on ten thousand connections are ten thousand separate
   buckets. They only bite when people share an IP — and **Nigerian carrier NAT
   puts hundreds of unrelated subscribers behind one address**, so the numbers
   have to cover strangers colliding, not just one studio's staff.

   | Setting | Value | Why |
   |---|---|---|
   | Sign-ups and sign-ins | **200** /5min | Carrier NAT headroom. Still caps one attacker at 2,400 password attempts an hour, which is nothing against a decent password. The real defence is item 3 |
   | Token refreshes | **500** /5min | Refreshes cluster: everyone opens the app at 9am and a shared carrier IP can push 200+ into one window. Low risk to raise, since refreshing needs a token you already hold |
   | Token verifications | **30** /5min | Left alone deliberately. This is the brute-force guard on a six-digit code, and it is somebody typing what they were just sent. Lower is safer here |
   | Emails sent | **200** /h | Covers onboarding a hundred studios in a morning. Also bounds a runaway loop |
   | SMS, Web3, anonymous | untouched | Not used |
   | IP address forwarding | **OFF** | It lets a caller *claim* an IP, so every per-IP limit above would trust whatever it is told. For server-side setups behind a trusted proxy. These are browser apps |

   **This rate limit counts Supabase Auth email only** — codes, resets,
   confirmations, invites. A newsletter never touches it. The binding ceiling is
   **Resend's free tier: 3,000 a month, about 100 a day**, and that is the
   number to watch when real volume arrives.

**Kayode enters the API key, not me.** It is a credential.

---
## Netlify — all four apps are deployed

**This table said "two of four" and listed the portal and the website as
"nowhere" until 18 Sep, while the table below it said all four had been live
since 12 Sep. Two tables on one page disagreeing is worse than either being
wrong, and a stale doc has now cost two wrong answers in this repo — CLAUDE.md
also claimed `web/` was not connected to Netlify.**

| App | Netlify site | Deploys from | State |
|---|---|---|---|
| Customer app | `thelabelboard` | GitHub, `main` | **live** |
| Admin console | `thelabelboard-admin` | GitHub, `admin-deploy` | **live** |
| Partner portal | `thelabelboard-partners` | GitHub, `admin-deploy` | **live** |
| Public website | `thelabelboard-web` | GitHub, `main` | **live** |

**The website is the site whose Forms tab holds the five public forms**, and the
only one of the four where form notifications matter. The other three carry no
forms at all.

*On its name:* this file recorded the slug `thelabelboard-web`, but the Netlify
UI shows the project as **`thelabelboard.com`** (seen in the breadcrumb on 18
Sep). Either it was renamed or the newer UI displays the custom domain rather
than the slug. Go by what the breadcrumb says when you are looking for it, and
correct this line once somebody has the URL in front of them.

Also on the account: `layi-website` (Netlify Drop, 4 Aug) and
`loquacious-pika-32f045` (Netlify Drop, 5 Jul), neither connected to this repo.
Confirm whether `layi-website` still serves the LAYI tenant before deleting
either.

**Both undeployed apps are already wired to Supabase**, at the surviving project
`eskubrbgbcbaejynjxvh` with the public anon key. Supabase is not what is holding
either of them back. Each has exactly one blocker:

- **Partner portal — blocked on SMTP alone now.** The hydrate that was the other
  half is **built** (12 Sep): `partners/js/live.js` reads the five tables plus
  `app.partner_me()` and produces the same object the demo does, gated by 26
  checks with the network stubbed, ten mutants all caught. SMTP is the last
  thing standing between a partner and a working portal.
- **Public website — blocked on the domain and a real phone number.** It is the
  only one of the four meant to be found by Google. Today `web/js/config.js`
  carries `+234 800 000 0000` and `wa.me/2348000000000`, so "WhatsApp us" goes
  nowhere, and `domain: 'thelabelboard.com'` drives every canonical tag,
  `robots.txt` and `sitemap.xml`. Publishing before that is settled tells Google
  the real copy of every page lives at an address that may not be yours.
  - *If you want a live URL sooner:* connect it with `robots.txt` set to
    disallow everything. A real link to look at and share, no search damage, and
    one line to lift when the details are settled. Say the word and it is a
    two-minute change.

### Pointing `thelabelboard.com` at the apps

Kayode owns the domain, confirmed 12 Sep 2026, and bought `hello@` email on it
the same day.

| Address | App | Netlify site | State |
|---|---|---|---|
| `app.thelabelboard.com` | Customer app | `thelabelboard` | **live, 12 Sep.** CNAME, set as Primary |
| `partners.thelabelboard.com` | Partner portal | `thelabelboard-partners` | **live, 12 Sep.** Deploys `partners/` from `admin-deploy` |
| `admin.thelabelboard.com` | Admin console | `thelabelboard-admin` | **live, 12 Sep.** `noindex, nofollow` and `X-Frame-Options: DENY` confirmed on the live response |
| `thelabelboard.com` + `www` | Public website | `thelabelboard-web` | **live, 12 Sep.** Deploys `web/` from `main` |

**All four apps are on the domain.** Every address returns 200 with a valid
certificate, no Netlify badge anywhere, and the apex serves the real site rather
than GoDaddy's parking page — checked on the live response, not assumed. `www`
301s to the apex. `robots.txt` and `sitemap.xml` both answer, so the site is
findable. Mail was re-checked after the last change and is untouched: MX, SPF,
the Microsoft verification TXT, both DKIM selectors and autodiscover.

Two things about the apex worth knowing. GoDaddy has no ALIAS, so it is an
**A record to `75.2.60.5`**, Netlify's load balancer, edited in place over the
"WebsiteBuilder Site" record rather than added beside it. And `www` already
existed as a CNAME to the apex, GoDaddy's default, so that was an edit too —
adding it fails with "conflicts with another record".

**Open question, not urgent:** the apex is Primary and `www` redirects to it.
Netlify's own advice for externally hosted DNS is the reverse, because an apex
is one load-balancer IP while a CNAME reaches the nearest edge. For readers in
Lagos that is a real if modest difference. Bare domain reads better in print.
One dropdown either way.

**Netlify project visibility, decided 12 Sep.** Production stays **Public** on all
four; Deploy Previews go **Private**, because a preview is a draft build at a
guessable url and an unreleased pricing page should not be findable. Private was
considered for the admin console and rejected on two grounds: on the free plan
only the *Team Owner* can view a private project, so the first finance or support
operator added would be locked out unless given the whole hosting account; and
private projects carry Netlify's pre-launch toolbar overlay, which is trading one
overlay for another. The console's own password wall plus `noindex` is the right
layer for that, not hosting visibility.

**The verification is per domain, not per subdomain.** The first one, `app.`,
needed a TXT record at `subdomain-owner-verification` before Netlify would hand
over the CNAME, because the domain is registered elsewhere. Every subdomain
after that is **one record**: Netlify already trusts `thelabelboard.com` and
goes straight to "found". The certificate also issues in seconds rather than
minutes once the domain is known.

Nothing has been deleted from the zone at any point. All 21 records stayed, and
mail was re-checked after every change: MX, SPF, both DKIM selectors and
autodiscover all intact each time.

**The partner portal is live and cannot sign anybody in.** That is the expected
state, not a fault: it sends a one-time code by email and there is no SMTP yet
(item 2). The plumbing is finished, so SMTP is the single switch left.

**Registrar is GoDaddy, and so is the mail.** Both bought there on 12 Sep 2026.

**Do not move the nameservers to Netlify DNS.** Netlify offers it and it is the
tidier option in the abstract; here it would carry the MX records away with it,
and a missed one takes `hello@` down silently for days. Add individual records
in GoDaddy's DNS screen and leave every MX record alone. A CNAME for a subdomain
cannot touch mail. Only a nameserver change can.

**GoDaddy has no ALIAS or ANAME record**, so when the apex is finally pointed at
the website it needs an **A record**, not a CNAME, and GoDaddy's existing parked
`@` record is *edited* rather than added alongside. Subdomains are ordinary
CNAMEs and have no such problem.

**The admin console deliberately gets no subdomain.** It already ships
`X-Robots-Tag: noindex`, but `admin.thelabelboard.com` is the first thing
anybody would try. It is not security on its own — the console has a real
password wall — there is just no reason to advertise it. Kayode's call.

Per subdomain, the shape is always the same: add the domain in Netlify first,
because Netlify then tells you the exact record to create, and typing a record
from memory is how this goes wrong. Then create that record at the registrar,
leave every MX record untouched, and wait for Netlify to issue the certificate.

**Turn off the "Powered by Netlify" badge on every new site.** It is on by
default on free plans for any project created on or after 19 Aug 2026, and it
renders bottom-right of the page. Checked 12 Sep: the customer app does not have
it on either of its addresses (that site predates the cutoff), the admin console
does. **The website and the partner portal are both new sites, so both will have
it.** Do it as part of creating each one, before pointing a domain at it — a
Powered by Netlify badge in the corner of the marketing homepage of a ₦65,000 a
month product is the worst place it could appear.

> Project configuration → General → Powered by Netlify badge
> `https://app.netlify.com/projects/{site}/configuration/general#powered-by-netlify-badge`

Injected at the edge, so turning it off takes effect on the next request with no
redeploy. It is not a reason to leave Netlify, which was the first instinct.

**Optional tidying, not urgent:** set base directories (`site` and `admin`) on
the two live sites and delete the root `netlify.toml`. It only bites at the
moment of merging `admin-deploy` into `main`, the recipe for doing that safely
is in `CLAUDE.md` and in the file itself, and it was followed correctly on
11 Sep. `site/netlify.toml` was fixed the same day so this job will actually
work when somebody does it.

---

## Shipped 17 September 2026 — the console stops scrolling sideways

`admin-deploy` → `48962f1`, live and verified against the running server.

The Partners page was 606px of table inside a 375px screen, so the **document**
was wider than the window and every heading, card and search box sat off the
left edge. Nothing was wrong with any of them. That table was added two
sessions ago with six columns and no `hide-sm`, which is the thing every other
table in the console has.

Two guards behind the fix: every cell may now break a long unbroken string (an
email has no spaces, so `white-space:normal` cannot wrap it and one address
sets a column's width), and `audit_safearea.js` refuses any table of four
columns or more with nothing droppable.

**Measured rather than reasoned about.** `build_overflow_harness.js` renders
every page of the console and the portal — neither can be opened without
signing in — into the real shell with the real stylesheet for a browser to
measure. One page out of twenty-three overflowed. After the fix: none, at 320,
414 and 768, plus all 24 views of the customer app at 320 and 375.

The harness is committed, and its header documents the two ways this
measurement lies: a single file holding both stylesheets and toggling
`disabled` measures against whichever sheet was live a tick earlier, and
measuring in the same call that resizes the viewport reads the old layout.
Both produced confident, wrong answers first.

## Shipped 15 September 2026 — `layi-v42`

Live and verified against the running servers, not the repo. `main` → `56b5082`,
`admin-deploy` → `dd72e99`, `admin-api` at version 7.

- **The first-run screen holds its place.** Every tick rebuilt the modal and
  scrolled it to the top, so answering the last question meant scrolling back
  down to it, seven times over.
- **Several studios are set up on the way in.** Saying "2 or 3" used to make one
  branch and point at Settings, so somebody who had just said they run three
  outlets opened the app with no switcher.
- **Our example studio is locked away from real studios.** It REPLACES
  everything, and on a live account the replacement syncs to the cloud and every
  other phone on the account.
- **The console stops blanking its own Subscribers page.** Three clicks into a
  real studio, the Referrals tab read `.length` of a field a live row never had.
- **The partner portal signs in with a password**, with a reset link for the day
  somebody forgets, and an invitation that asks for a password instead of
  spending its one-shot link on a single sign-in.
- **Nothing sits under a status bar or a home bar** in any of the three apps.
  New gate: `audit_safearea.js`.
- **A partner who lands on the customer app is handed over** rather than told
  they have no studio and left there.

### The one thing still outstanding on the partner invitation

The gateway is correct and deployed: `invitePartner` points at
`partners.thelabelboard.com`, and the redirect is decided in the function rather
than sent by the browser. **Supabase will still ignore it** unless the address is
on the project's allow list, and when it ignores one it falls back to the Site
URL silently, which is the customer app.

So: **Authentication → URL Configuration → Redirect URLs** needs all three.

```
https://app.thelabelboard.com/**
https://partners.thelabelboard.com/**
https://admin.thelabelboard.com/**
```

The same setting governs the partner password-reset email.

**To stop depending on a setting we cannot see from the code**, the gateway
should generate the link itself (`generateLink`), check the link it got back
actually points where we asked, and send the email through Resend rather than
letting Supabase send it. That removes the silent fallback entirely, and gives
us invitation emails in our own words instead of the Supabase default. It needs
one new secret, `RESEND_API_KEY`. Not built yet — Kayode's call.

## Fixed after the first real end-to-end test — 14 September 2026

The invite chain worked end to end for the first time. Kayode reported three
things from that run. All three are built and gated, **none is deployed yet**.

Customer app goes to **`layi-v42`** (`site/sw.js` `CACHE` bumped to match).

- **1. Two banners sat over the dashboard.** Face ID and Install are both
  offered on a first mobile sign-in, and stacked they are about 200px of fixed
  banner above the tab bar, on top of the dashboard somebody just signed in to
  look at. Clearing one slid the other into its place, which reads as the thing
  refusing to go away. Only one shows now: Face ID first, because it is offered
  once per device and then never again, and the install prompt takes its turn
  when that is dealt with. Gated in `audit_first_run.js`, and the gate first
  proves the install prompt *would* have shown, so "it waited" cannot pass
  because it was never eligible.
- **2a. Every new studio was called LAYI.** `DEFAULTS.company.name` was the
  literal `'LAYI'`, so a studio inherited the demo tenant's name — in the
  header, on a supplier WhatsApp message, and in `businesses.name`, which the
  app writes from that value. Now blank, and three things follow: the console's
  name for a studio is adopted on first sign-in (`adoptStudioName()`), presence
  never reports a blank over a real name, and the two `||'LAYI'` fallbacks are
  placeholders. Gated in `audit_print.js` — the check is on the source, because
  a fallback nobody can see is the only safe kind.
- **2b. The header disagreed with the rest of the screen.** `go()` painted the
  title once on the way in and nothing repainted it, so a studio that named
  itself on the first-run screen kept reading the placeholder in the header
  while the sidebar and welcome strip showed its real name. One
  `paintPageTitle()` now, called from the two places that change the answer.
- **2c. The greeting was an email address.** "Good afternoon, Olayiwola.lad" —
  an invited account carries no name, so the trigger falls back to the part
  before the @. The first-run screen now asks, prefilling only when the stored
  name could plausibly be one (a space in it is a name; dots and digits are a
  mailbox), and writes the answer to `profiles`.
- **3. The partner invitation went to the customer app.** The gateway never
  sent a `redirectTo`, so Supabase used the project Site URL — the customer app
  — for every invitation of every kind. A partner following their own
  invitation was shown a studio sign-in and told, correctly, that they had no
  studio. Fixed in three places:
  - `admin-api` now has an `APP_URLS` table, one address per invite action,
    **decided in the function and not by the caller** — a redirect the browser
    can name is a redirect an attacker can name, and this one goes out in an
    email we send. Overridable by env for staging.
  - The **partner portal** honours the link: a partner arrives already signed
    in and needs no password, because that portal signs people in with an
    emailed code and has none. One tap from the email into the portal, welcome
    page and all. Dead links, non-partner accounts and suspended partners are
    each handled separately.
  - The **console** now has an invitation screen. Without one, redirecting an
    operator there would have signed them in on the link's own session having
    set no password: in once, locked out forever after, which reads as the
    console being broken rather than a step being skipped.

**Mutation-tested, not just gated.** 19 deliberate breakages across the three
files — including "the handler is correct but nothing calls it", which is the
exact shape of the bug in 2b and 2c. All 19 caught.

### Before this batch goes out — Kayode

**Supabase → Authentication → URL Configuration → Redirect URLs.** A
`redirectTo` is only honoured when it matches the allowlist; anything else
falls back to the Site URL silently, which is the bug this fixes. All three
need to be there:

```
https://app.thelabelboard.com/**
https://partners.thelabelboard.com/**
https://admin.thelabelboard.com/**
```

Then: deploy `admin-api`, push `admin-deploy`, merge to `main` for the customer
app. Test a **partner** invite end to end — that path has never once run for
real.

## Fixed in the run before

Committed, gated, and **shipped** in `layi-v40` on 11 September 2026.

- **0a. Footwear and leather could not see their own sales.** They were given a
  Shop and a "Record a sale" button, then had the Sales tab hidden, because
  visibility asked whether the trade’s *kind* was retail and theirs is
  `bespoke`. Sales now follows the Shop. `showsRetail()` untouched, so nothing
  else changed meaning. Gated in `audit_trades.js`; the old code fails it four
  times.
- **0b. The job sheet’s Fabric column was dead.** It read `x.fabric`, renamed to
  `materials` long ago, so every bespoke work order printed that column blank.
  Now prints the materials, falls back to any legacy `fabric` value, and the
  heading reads **Material** — a shoemaker was being handed a column called
  Fabric. Gated in `audit_print.js`; the old code fails it.

- **2. Craft × mode.** `does[]` carries `craft:mode` in the same array, so nothing new
  syncs. **Craft** (garments, footwear, bags & leather, fabrics) decides the word for one
  piece, the measurements offered, the stage presets suggested and the QC checks. **Mode**
  (`make`, `stock`) decides which tabs open, and nothing else. The gate proves neither half
  decides the other, both ways round.
  - Every studio on a device migrates on read: `bespoke`→`garments:make`,
    `rtw`→`garments:stock`, `footwear` and `leather`→both halves. A studio that had saved
    its own option list has `bespoke` and `rtw` folded into the one craft they always were.
  - **One deliberate change:** a fabric shop gains a Shop. It sells cloth by length off a
    shelf and was carrying stock with no catalogue to hold it.
  - Adding your own type asks both halves, and **both can be true** — a studio that sews
    uniforms and also sells them off a rail is one type doing two things, not two types.
- **7. QC per craft.** **Construction** and **symmetry** added (the two your supervisors
  check that the app did not list), and each craft gets its own list: a shoemaker checks
  pair symmetry and sole attachment, a bag maker hardware and edge finishing, a fabric shop
  dye shading across the run. Every item the old list had survives on the garments list, so
  nobody loses a check they relied on. The checks on an order come from the studio that
  made it. Nothing covered QC before, so pass/fail is gated too.
- **The “What your studio does” panel was inert.** It wrote `SETTINGS.businessType`, a
  field read only when a business has no branches at all — which never happens, because
  `getBranches()` always returns one. Tapping “Selling” opened no Shop, no Sales, and gave
  no sign it had not worked. It edits the studio's own `does[]` now.
- **A near-miss worth recording.** A batch of edits to the branch editor rolled back
  halfway, leaving markup calling four renamed functions. **Every gate stayed green**,
  because nothing ever rendered that screen. The gate now renders all three pickers and
  checks that every function named in an `onclick` exists — which catches the whole class,
  not this one instance.

- **The mode labels** read **Made to order** and **Ready made**, Kayode's own words. The
  hint above the chips states what each one opens, because a label sewing its own rail is
  not making to *order* and would otherwise skip the tick that gives it a production board.
- **5. Fabric check.** An item records **whose** the material is (we supplied it, ordered
  in for this, client brought it in, client sent it ahead). The last two are irreplaceable,
  and one such item makes the whole order careful. The work order carries a red block
  saying THE CLIENT'S OWN FABRIC, the source under each material, and a line to sign on
  paper. Somebody is asked to check the cloth against the photo in the progress update they
  already post, after work starts and before QC, signed and dated, never asked twice. No
  prompt when there is nothing to check against. New gate `audit_fabric.js`.
- **Two records made in the same millisecond could share an id.** The branch-scope gate had
  been failing about **once in twenty-five runs** with *"txns: 2 record(s) show in more
  than one studio"*, and passing every time it was run alone. Not a scope leak: `uid()` was
  `Date.now()` plus three random base-36 characters, 46,656 values inside one millisecond.
  Measured, a burst of 60 collided **4.0%** of the time and a **200-row CSV import 31.6%**.
  Every edit, delete and lookup is `list.find(x => x.id === id)`, which returns the first
  match, so a shared id means editing one record edits the other. Fixed with a
  per-millisecond counter and a wider random tail; saved ids untouched. Gated in
  `audit_import.js`. Ten consecutive full verify runs green, against roughly one in six.

- **Accessories is a craft.** Caps, gele, scarves, beadwork and jewellery, with its own
  measurements (head, cap size, neck, wrist, ring size, belt length), its own stages
  (Design, Materials Ready, Cutting & Shaping, Assembly, Beading & Trims, Fastenings,
  Finishing), its own quality checks, and an example studio. **The website says it in the
  same commit**: a trade tile and pane, a product-page card, the footer link on all twelve
  pages and both meta descriptions.
  - **Still wanted: `web/img/accessories.jpg`.** The tile keeps its line drawing until that
    photograph exists. `img/README.txt` names it, and the website gate now enforces the
    rule rather than letting it pass quietly: a tile either carries a photograph that
    exists, or names none and the README says one is wanted. **Kayode made the photograph
    the same day**, so the tile carries it like the other seven.
  - Two bugs fell out of it. A **necklace** was filed as Fabric (`lace` matched inside it)
    and an **aso-oke cap** was filed as Fabric too, because the fabric test ran before the
    accessory one and matched what the cap is made *of*. What a thing IS now beats what it
    is made from.
- **9 + 7. Per-piece stages and per-piece QC.** A piece can name its craft and walks that
  craft's pipeline; unnamed, it walks the studio's, which is every order in existence. The
  order sits where its **least advanced piece** sits, measured as a fraction, because that
  is the only way to compare a 12-stage bag with a 10-stage agbada. The gate checks every
  pair of positions and requires exactly the old answer, so nothing on any device moves.
  Quality control follows: each piece checked as its own craft, passing one moves on to the
  next unchecked piece, the order passes only when all have, and failing one sends **that**
  piece back without touching another piece's pass. A single-piece order is untouched.
  New gate `audit_pieces.js`.

- **3. Production runs.** Materials in, stock out, and the money counted once. Buying the
  fabric is money out the day it leaves, as now. The run posts nothing and divides its cost
  over the pieces it makes (180,000 over 20 is 9,000 each), blended with what is already on
  the shelf. The till then charges **no** stock cost for those pieces, because they are
  already paid for, while bought-in stock is charged as before and a mixed sale charges only
  the bought part. A run lives in the orders store so it gets the board, stages, QC, history
  and sync for nothing, which meant the 28 filters reading `o.kind!=='sale'` now read
  `isClientOrder(o)`, because every one of them means "somebody is paying for this".
  New gate `audit_runs.js`.
  - Found on the way: labour with **nobody named** was dropped from the cost, because
    `orderTeam()` filters on `staffId`. A run showed 9,000 a piece while the books said
    7,500. Unnamed labour is booked as a cost line now.
  - Also found: the per-item craft picker from the previous commit **had never been
    written**. An edit script rolled back halfway and every gate stayed green because none
    of them rendered the order form. `audit_pieces.js` renders it now.

- **8. Bespoke, made to measure, or off the shelf.** Recorded on the **piece**, never on the
  studio: a shoemaker does all three in a week at the same bench. Not a third mode on craft
  × mode either, because bespoke and made to measure behave identically in the app.
  - The **work order** tells the bench which it is, because that decides what they pick up.
  - A shelf piece needs no measurements; a piece nobody recorded still does, because
    assuming otherwise is how a measurement gets skipped.
  - The **dashboard** answers the question the field exists for: of the work booked this
    period, at this studio, what share was cut from scratch. Counted on the order rather
    than on money received, converted at each order’s own rate, with pieces nobody
    recorded on their own line rather than spread across the others.
  - The website gate now checks the app carries every **way of working** the site
    advertises, not only every trade. That is what would have caught this: the site has sold
    to made-to-measure studios since launch and the app had no word for it.
  - New gate `audit_method.js`.

- **4. Quoted → Confirmed.** The invoice-first flow. A quote is an order with `quoted:true`
  and no `confirmedAt`: **one field, no second store, nothing to reconcile.** It already
  carries the client, items, prices, discount, deposit terms, logistics and the invoice
  document.
  - Out of the **production board**, **receivables**, the **work booked**, **Active Orders**
    and every late/QC/fabric nudge, because none of it is true yet. Receivables took one
    line: `orderOutstanding()` returns zero for a quote, and every chase reads through it.
  - Confirmed by hand, or **on its own the moment any money arrives**, because a deposit is
    the yes and confirming an order you have just been paid for is a step that only ever
    gets forgotten. Stamped with who and when either way.
  - The invoice carries the line that makes the flow work: *"This confirms your order once
    payment is received. Nothing is cut until then."* A receipt never says it.
  - A confirmed order **cannot be quietly turned back into a quote**. Work has started and
    money may have arrived.
  - A **Quotes Out** tile on the dashboard with what they are worth, shown only when there
    are any. New gate `audit_quote.js`.

- **6. Work sent out.** Beading, monogramming, soling. Recorded on the **cost line that
  already carries the vendor**, so the money cannot move and the books cannot disagree with
  the bench. The gate checks that first and hardest.
  - The order says **"With Musa Beads"** instead of "In progress", above the due-date lines,
    because where the piece IS beats how long it has been there. The due column beside it
    still shows the lateness, so nothing is hidden.
  - A piece late back is **somebody else’s delay** and reads as one, with *chase them* and a
    button to say it came back. A piece with **no agreed date back is never called late**: a
    vendor who never gave a date cannot have missed it.
  - Coming back is recorded once, **with how long it took**, which is the only way a studio
    learns a vendor is slow.
  - The block sits **outside the profit section**: a machinist needs to know the beading is
    with Musa and due Friday, and has no business seeing what it cost.
  - **Bug found by the gate:** `migrate()` rebuilds every cost line field by field, so the
    sent and due-back dates were being silently dropped on the next read. Anything new on a
    cost line has to be named there, and now is, with a comment saying why.
  - New gate `audit_outwork.js`.

- **10. About Us.** Rewritten as the story only Kayode can tell: ten years in the trade,
  four of them running the studio from another country, and the line the rest of the page
  hangs off — *nothing was being stolen and nothing was being done badly, there was just no
  system, and without one a studio cannot see itself.*
- **Housekeeping 11 to 20**, all ten. Two gateway actions got the buttons they had been
  waiting weeks for; Bespoke stopped booking `0` of revenue in five places; an ended trial
  stopped reading as one ending today; recurring bills come round on their own period;
  product photos moved to Storage; role migration stopped depending on the order of the
  Settings screen; and the money now says which currency it arrived in.
- **1. Incremental sync, solved from the other end.** Measured rather than estimated: an
  order is ~1.7KB of JSON, and a busy label after three years rebroadcasts a 5,400-order
  blob on every stage move. Six moves an order across fifty devices is **~426GB a month,
  about ₦51,800 of egress against a ₦65,000 subscription**. A factory comes out near
  ₦368,000, five times what it pays. Worse than the estimate that used to sit here.
  - Almost all of it is finished work, so the store splits: open work in `layi_dash_orders`,
    finished work in `layi_dash_orders_done`. A stage move sends only the first.
    **Year 1: 142GB → 9GB. Year 3: 426GB → 9GB. Year 5: 711GB → 9GB.**
  - No migration, no Edge Function, nothing to deploy: `app_state` takes any key. A device
    still holding one blob reads it unchanged and splits on its next save.
  - An order **delivered but still owed for stays live**, because it is the one that needs
    chasing. So does a quote. So does anything the test cannot judge: archiving an order
    that is not finished stops it syncing, so unsure costs money rather than losing work.
  - New gate `audit_orderstore.js`.
  the same day on Kayode's call: a nice addition, not worth more time on. Both halves went
  together, because both existed to move a finished photograph somewhere.
  - Out of the app: the **Ready to post panel** on Marketing, the caption writer, the post
    draft screen, "plan it in the calendar", "mark as posted", and the `postedAt` stamp.
  - Out with it: `SHARE_URL_TTL`, `finishedPhotoOf`, `sharePhotoLink`, the `{photo}` token in
    the ready template, and the whole signing dance in the message helper. The message helper
    is a plain synchronous function again.
  - **Kept:** the **Email it** button beside Open in WhatsApp. It is not part of the photo
    feature. It puts the same message into email for a client who does not use WhatsApp, and
    nothing signs a url for it.
  - No client ever saw any of this. Nothing was pushed, so no device has it.
  - **The check that matters when a feature is pulled** is that it left nothing behind: a
    leftover `onclick` draws fine, renders fine, passes every other gate and throws the first
    time a studio taps it. `audit_marketing.js` now names all eighteen removed identifiers and
    fails if any survives, then opens the Marketing tab and the message helper for real.
    `audit_media.js` holds the rule that replaced the feature: nothing signs a url on a longer
    clock than the app's own, because a url signed for longer is one meant to leave the studio.
  - **Ten mutants run against the new checks, all ten caught.** Then the app was opened in a
    browser and all 23 tabs were visited, the Marketing tab drawn and the message helper
    opened on a phone screen: no console errors, no `{photo}`, both send buttons there.

All 50 gates green after each change, plus the 1,827-check website gate, the 311-check partner
gate and the 80-check console gate. Every gate written this run was run against a deliberately
broken copy of the app first, and every mutant was caught.

---

## Still open

Nothing here is blocking. The list of half-day items is empty.

### A. Sign-in events in the console  —  needs a deploy
The console says **Last synced**, which is honestly what it measures: the last time any
data reached the cloud. Actual sign-ins live in Supabase's `auth` schema, which the console
cannot read without a new SQL function **and** a new `admin-api` action. That is a migration
and an Edge Function deploy, so it waits for Kayode. Half a day once it is wanted.

### B. Per-record sync  —  the full version, if it is ever needed
Splitting the orders store took the worst case from ~426GB a month to ~9GB, which is under
`₦1,100` of egress on a `₦65,000` subscription at three years. **Pro is comfortable well past
200 staff now.** Moving each store into real relational tables with per-row upserts would be
the textbook answer and is weeks of work, a migration per store, RLS per store and a
migration path for every device. **Not worth starting until a real studio's numbers say so.**
The measurements are in `audit_orderstore.js`, so the day they do, they will say it plainly.

### C. Sharing finished work  —  closed, not parked
Settled on 11 Sep and closed rather than left on a list. The panel, the caption writer and the
photo link to the client are **all removed**, and posting to Instagram or Facebook is not being
built: it is app review, tokens that expire and a publishing flow, which is a second product
rather than a feature. If a studio asks for it twice, it starts from nothing, which is the
honest position anyway.

For the record, storage was never the reason. At the shipped compression a reference photo is
about 200KB, so **20GB is roughly 97,000 photos** — a studio doing 40 orders a month with five
photos each takes **41 years** to fill Basic, and a 100-order studio with eight photos each
takes **10 years**. Finished photos are not what fills a cap. It was removed for the reason
Kayode gave, which is time, not space.

---

## Verified, with the limits stated

- **The service worker's outbound fetch** could not be exercised in a real
  browser — the preview environment blocks worker-initiated cross-origin
  requests. The cache-serving path *was* proven: three different signed tokens,
  one long expired, all returned the same photo byte for byte with the network
  never touched.
- **A live photo upload end to end** needs a signed-in studio, so a password.
  Covered by the harness; the last leg wants five minutes with somebody
  signed in.
- **Four test enquiries sit in the live console** (Ada Obi, Test Two, Grant
  Check, Bimpe Adeyinka). Mine, from building the pipeline.

---

## Decided against

- **Beauticians — hairdressers, makeup, manicure, pedicure.** Not a new trade,
  a different core loop: appointment-first, a service not a good, no materials
  per job, no production stages, no measurements. It would add a third
  dimension — *makes things* vs *does things to people* — to a model already
  failing at two (see #2). And commercially: adding a second industry before
  proving the first is how a product becomes mediocre at both. If it is still
  attractive in a year it is a separate product sharing a codebase, not a trade
  in this one.
- **A sixth "haberdashery" trade.** Small shops, workflow a subset of a fabric
  shop's. Survives as an inventory category, which every tailor uses.
- **Taking payments in-app.** No gateway, no card, no webhook. An operator
  records a payment that already happened.
- **Enforcing the Basic/Pro receivables split server-side.** Chasing is a
  `wa.me` link with no server in the path. It is a commercial nudge and honest
  about it. It becomes enforceable the day reminders go through our own sender.
- **Invoices as a separate record type.** See #4 — an unconfirmed order does
  the same job without a second set of books to reconcile.
