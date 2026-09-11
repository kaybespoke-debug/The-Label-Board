# Outstanding

Everything known to be unfinished, wrong, or waiting on somebody. Updated at
the end of every session. Nothing is removed until it is actually done — if
something turns out not to be worth doing, it moves to **Decided against**
with the reason, so it does not get re-raised in six months.

Last updated: 11 September 2026

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
| **QC checklist** | Exists, is editable per studio, and since 11 Sep starts from the craft. Ticked per check, pass/fail with who and when, a fail sends it back for rework. Still one verdict per order rather than per item — see #7 |

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
| 9 | **Decide accessories** | Now a **one-line change** — a fifth entry in `CRAFTS` and nothing else. But a studio has to read the website and see itself, so the copy goes in the same breath: a web session, not an app one |

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

All 42 gates green after each, plus the 1,758-check website gate. Seventeen mutations run
against the two gates; all seventeen caught.

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

### 7. QC per ITEM
Per-craft checks are done. What remains is the multi-item order, which can still only be
passed or failed as a whole — a bag and a belt on one order get one verdict between them.
**Folds into #9**, because both want an item to carry a craft of its own.

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
`outfits[].stageIndex` already exists per item; the per-item stage **set** does not. A bag
and a belt on one order do not share stages.

**Unblocked now.** Craft × mode gives an item somewhere to read its craft from, which is
what both this and QC-per-item were waiting for. Give each item an optional craft,
defaulting to the studio's, and the stage set and the QC list both follow it.
**Carries #7 with it.**

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
