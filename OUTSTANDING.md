# Outstanding

Everything known to be unfinished, wrong, or waiting on somebody. Updated at
the end of every session. Nothing is removed until it is actually done — if
something turns out not to be worth doing, it moves to **Decided against**
with the reason, so it does not get re-raised in six months.

Last updated: 10 September 2026

## How this run works

**Prototype first.** Anything that changes a workflow or a data model gets its
shape shown and agreed before it is built.

**Nothing ships until Kayode says so.** Commits are fine. Pushing, merging to
`main`, deploying an Edge Function and applying a migration to the live
Supabase project all wait, and happen at the END of the run rather than after
each change. Gates still run every time.

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
| **QC checklist** | Exists and is editable per studio: measurements, stitching & seams, fit confirmed, finishing & detailing, embellishment/monogram, pressed & packaged. Ticked per item, pass/fail with who and when, fail sends it back for rework |

---

## Waiting on Kayode

Needs a password, a dashboard setting on a live service, or a commercial call.

| | What | Why it matters |
|---|---|---|
| 1 | **Supabase → Auth → URL Configuration.** Site URL + redirect URLs with `/**` | Password resets and email confirmations land nowhere until this is set |
| 2 | **SMTP for auth email** | The partner portal signs people in with a one-time code. Without SMTP nobody can sign in |
| 3 | **Auth → Policies → leaked-password protection: ON** | Off today. Checks new passwords against known breaches. One toggle |
| 4 | **Move Supabase off Free before real subscribers** | Free is 500MB database and 5GB egress — about **15 studio-months of data and 3 of traffic**. Pro is $25/mo ≈ ₦33,300, roughly one Basic subscriber |
| 5 | **Delete the old project `gcdrkoitjqwbidcfgyzl`** | Two projects, one live. Easy to point something at the wrong one |
| 6 | **Set Netlify publish directories in the dashboard, then delete `netlify.toml`** | The file differs by branch on purpose; a clean merge silently serves the admin console to every studio |
| 7 | **Connect `web/` to Netlify** | The marketing site is finished and deployed nowhere |
| 8 | **Change the password that appeared in a screenshot** | It was visible in an image shared into a session |
| 9 | **Decide accessories** | Depends on #3 below |

---

## Fixed this run

Committed on `admin-deploy`, gated, and **not pushed**.

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

All 42 gates green after both.

---

## Waiting on a decision — prototype ready

### 2. Craft × mode

The shape is drawn and reviewable, with a live picker, the full migration table
and the three open questions:
**https://claude.ai/code/artifact/083b814a-4473-4d27-81a4-774c8537abb3**

Nothing is built. The three answers needed:

1. A studio doing garments **made** and **ready** — one Shop and one board, or
   two? *(Recommended: one of each; whether a piece was cut for a client or for
   stock is a property of the order — item #8.)*
2. Should adding a custom type ask for a craft as well as a mode?
   *(Recommended: yes, craft optional — "Rentals" should not have to be filed
   under a craft.)*
3. Keep `SETTINGS.businessType` as a read-only fallback? *(Recommended: yes.
   It is the only thing standing behind a device whose branch list has not
   synced yet.)*

One row of the migration is a deliberate change rather than a no-op: a **fabric
shop gains a Shop**. It sells cloth by length off a shelf and has been carrying
stock with no catalogue to hold it. Say so if you would rather leave it.

---

## Foundations — these unblock other things

### 1. Incremental sync
Orders, transactions, staff, tasks and settings still sync as **whole JSON
blobs**: one row per studio per key, rewritten in full on every change and
re-read in full on every sign-in. Photos came out of that blob, which cut it
roughly a hundredfold, but the shape is unchanged and it still scales as
*library × headcount*.

| Staff | Cost to serve | % of ₦65,000 |
|---|---|---|
| 50 | ~₦6,200 | 10% |
| 100 | ~₦21,100 | 33% |
| 200 | ~₦79,000 | **122%, loss-making** |

**Large — its own session, with a plan first.** Until then Pro is comfortable
to ~50 staff and should become a Bespoke conversation around 120.

### 2. Craft × mode
`DEFAULT_ACTIVITIES` conflates **what a studio works in** (garments, footwear,
bags & leather, fabrics, accessories) with **how it reaches the customer**
(made to order / ready made / both). `bespoke` is a craft named after a mode,
`rtw` is a mode named as a craft, and footwear and leather have the mode
decided for them and hardcoded to *both*:

```
bespoke     board: true   shop: false   sales: false
rtw         board: false  shop: true    sales: true
footwear    board: true   shop: true    sales: FALSE   <- both, and broken
leather     board: true   shop: true    sales: FALSE   <- both, and broken
fabrics     board: false  shop: false   sales: true
```

Carry both halves in `does`: `garments:made`, `footwear:ready`, and so on. The
craft half picks stages, wording and QC defaults; the mode half decides the
board, the Shop and Sales. Migration changes nobody's setup:
`bespoke`→`garments:made`, `rtw`→`garments:ready`, `footwear`/`leather`→both
halves, `fabrics`→`fabrics:ready`.

**~1 day.** 0a is already fixed separately. **Do before accessories** — against the current model
accessories would need its mode hardcoded to *both*, repeating the footwear
mistake exactly.

### 3. Production batches — made-in-house ready-to-wear
The sharpest thing on Kayode's list, and the right question was asked with it:
*how do we do this without the data conflicting?*

A production run that creates stock is **neither an order nor a purchase** —
there is no client, and you did not buy it. Today it can only be faked as one
or the other, and both lie.

**The rule that resolves it: a batch records COST only, never revenue.** It
consumes materials, occupies the production board, and its output becomes
stock units. Revenue happens later, when a unit sells. Book it at both ends
and every RTW brand's numbers are wrong by the cost of goods.

Without this an RTW brand cannot know what a garment cost to make, so cannot
know its margin — the central question this software exists to answer.

**~1 day. Prototype the record shape first.**

### 4. Quoted → Confirmed order state
Kayode's invoice-first flow: invoice a new client, their payment confirms the
order, production starts.

**Do not build invoices as a separate record.** That creates a second thing to
reconcile against orders, which is the same data-conflict problem as #3. An
invoice-first flow is just **an order that has not been confirmed yet** — add a
state before the first production stage. It reuses client, items, prices,
discount, deposit, logistics and the receipt, and answers "was it paid, how
much, what is the balance" for free.

Also delivers the "paid invoice prompts you to start the order" automation
almost free. **~half a day.**

---

## Real value, well defined

### 5. Fabric check
Each item already carries a **Material(s)** picker and its own **"Photos of
this item / fabric"**, now in Storage. Missing:
- the job sheet prints neither (see 0b — it prints a blank Fabric column)
- nothing records **whose** fabric it is (studio-supplied / client brought it /
  client sent it ahead) — mix-ups are nearly always client-brought
- nothing asks anyone to **check it before cutting**

Proposed: the two fixes above, plus a tick on the first production stage —
*"fabric checked against the photo"* — with who ticked it and when.
**Half a day.**

### 6. In-house vs outsourced work
Embellishment, monogram, beading. Outsourced work needs a vendor, a cost, sent
and due dates, and a **"waiting on them"** state that does not make the
workroom look idle. Vendors and maker commissions already exist; this extends
them. **Half a day.**

### 7. QC checklist per trade, and per item
The checklist exists and is editable, but it is **one flat list for the whole
studio**. A shoemaker checks symmetry of a pair and sole attachment; a bag
maker checks hardware and edge finishing; a tailor checks drape and balance.

- Add **construction** and **symmetry** to the tailoring default (from
  Kayode's own management training document — the two his supervisor checks
  that the app does not list)
- Per-trade defaults, driven by the craft half of #2
- On a multi-item order, QC per item rather than per order

**Small once #2 lands.**

### 8. Bespoke / made to measure / from stock — on the ORDER
The website sells to **Made to measure** as a trade; the app has no concept of
it. Deliberately not a third mode on #2: bespoke and made-to-measure behave
identically in the app (board, measurements, fittings) while ready-made needs
none of them.

And it is not a property of a studio at all. A shoemaker cuts a bespoke last
for one client, adjusts a standard last for the next, and sells ready-made off
the shelf — same week, same workshop. One field per order, which also finally
answers what share of revenue is bespoke versus made to measure. **Small.**

### 9. Per-item production stages
`outfits[].stageIndex` already exists per item; the per-item stage **set** does
not. A bag and a belt on one order do not share stages. **Fold into #2.**

### 10. About Us rewrite
Ten years of it. Four years of running a business from another country. The
confusion of trying to build structure with no system. Not another SaaS.

The one thing no competitor can copy and no funded company can fake, and the
cheapest item on this list. **1 hour**, website session.

---

## Housekeeping

| | Item | Size |
|---|---|---|
| 11 | Buttons with no UI: record a payment, grant extra storage | 1hr each |
| 12 | Sign-in events into the console | small |
| 13 | Console demo paths book ₦0 MRR for Bespoke (`formConvert`, `doChangePlan`, `doConvert`, `formNewSubscriber`, `core.js` forecast, plan editor seat field) | small |
| 14 | Trial expiry: flagged, nothing acts on it | small |
| 15 | Per-currency revenue reporting — orders hold currency, Finance converts everything to naira | medium |
| 16 | Expense cadence: quarterly and annual (recurring is a boolean today) | small |
| 17 | Multi-currency invoices — largely works, needs confirming | small |
| 18 | Product photos still inline base64 | small |
| 19 | `migrateRoles()` latent bug | unknown |
| 20 | Stale `audit_trades` description in `verify.js` (still lists haberdashery as a trade) | trivial |

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
