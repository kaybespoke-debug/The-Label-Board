# Feature gap audit — six candidate areas

**Date:** 30 September 2026
**Scope:** `site/layi_dashboard.html` (the customer app), `supabase/` (schema, migrations,
Edge Functions), `web/` (the marketing site), and the repo's own gates.
**Method:** source reading. Nothing was changed, nothing was committed, no test was run
against live data. Where a gate already answers a question definitively it was run
read-only and is cited.
**Audience:** product director. Plain English; the engineering detail is the evidence, not
the point.

---

## Summary

| # | Question | Status | One line |
|---|---|---|---|
| 1 | What import accepts | **PARTLY BUILT** | Six CSV importers. **CSV only — the "Excel" claim on screen is false.** No payments importer |
| 2 | Imported history in reports | **PARTLY BUILT** | Order-value reports work at original dates. **Cash revenue gets nothing** unless finances are imported separately |
| 3 | Import side effects / historical flag | **PARTLY BUILT** | No WhatsApp, no stock movement. **But every imported order lands on the production board as new work, and there is no historical flag** |
| 4 | Bank / POS statement import | **MISSING** | A generic finances CSV exists; no bank or provider format, no OFX/QIF |
| 5 | Bank reconciliation | **MISSING** | Nothing. No statement, no match status, no cleared flag |
| 6 | Custom date range + export | **PARTLY BUILT** | **Any From→To range works.** No report export in any format |
| 7 | Gross margin | **PARTLY BUILT** | Per product and per order, yes. **Material cost is typed by hand, never taken from stock** |
| 8 | Registration & tax details | **BUILT** | Stored in Settings, printed on invoices and receipts. Not on job sheets or reports |
| 9 | Audit trail export / date filter | **PARTLY BUILT** | Filter by action, person, free text. **No date filter, no export** |
| 10 | Auto stock deduction per product | **PARTLY BUILT** | Recipes exist but are applied **by a button**, and deduct **on save**, not at cut or production |
| 11 | Actual used vs expected variance | **PARTLY BUILT** | Actual is recorded. **Expected is overwritten by it, so variance cannot be calculated** |
| 12 | Unit conversion | **MISSING** | One free-text unit per item. No buy-in-rolls, use-in-yards |
| 13 | Client-supplied fabric | **PARTLY BUILT** | Flagged per item, excluded from stock and cost, warned about on the job sheet. **Not logged in, no leftover returned** |
| 14 | Remnants / off-cuts | **MISSING** | No concept at all |
| 15 | PR / gift / sample out of stock | **MISSING** | Fixed movement reasons, none of them a gift. No recipient, no cost booked |
| 16 | Campaigns linked to sales | **MISSING** | No codes, no attribution |
| 17 | Public order intake page | **MISSING** | Mapping is built and tested. **The transport was never built**, so nothing can reach it |
| 18 | Channel recorded | **PARTLY BUILT** | Fixed list of six, asked **only on a hand-logged payment**. An order's channel is guessed |
| 19 | Codes / SKUs | **PARTLY BUILT** | On an order line only. **Catalogue products and materials have none**, and one lookup reads a field nothing writes |
| 20 | localStorage-only features | **NONE** | Everything syncs, and a gate proves it. **But 17 of 23 keys sync as one JSON blob each, not as rows** |
| 21 | Bugs and dead controls | — | Five, listed at the end |

**The three that would bite hardest if a spec assumed otherwise:** #3 (imported history
goes on the production board and into the chase list), #2 (imported money is invisible to
revenue), and #20 (most data is a JSON blob, so no server-side reporting on it).

---

## A. Historical import

### 1. What "Import old data" accepts

**Status: PARTLY BUILT**

**Evidence:** `IMPORTERS` (site/layi_dashboard.html:10254), `parseCSV` (:10209), the file
input at :10354, `openImportMigrate` (:10329). Separately `exportData`/`importData`
(:10399) and the JSON input at :1580.

Six importers, each its own card with a downloadable template:

| Importer | Brings in |
|---|---|
| Customers & measurements | Name, phone, email, address, note, and every measurement column it recognises |
| Orders & past productions | Client, item, price, deposit, due date, status, date, reference |
| Stock & inventory | Item, category, subcategory, quantity, unit, cost, reorder level, note |
| Staff & profiles | Name, role, phone, email, salary, start date, department |
| Vendors & suppliers | Business, type, phone, email, note |
| Finances & transactions | Date, income/expense, amount, category, method, note |

Column matching is by alias, so exports from other software line up without editing
(`price`/`total`/`amount`/`value` all find the total). Re-importing is safe: matched
records update rather than duplicate.

**CSV only.** The file picker is `accept=".csv,text/csv"` and there is no spreadsheet
parser anywhere in the app — zero references to xlsx or any library that reads one. **The
screen tells the studio it "Works with a CSV or Excel export", which is not true:** an
`.xlsx` file cannot even be selected. See #21.

**Payments have no importer of their own.** A deposit rides on the order row as one
column, or arrives as an income line through the Finances importer. There is no way to
import a payment history against specific orders.

**The JSON backup is a different thing entirely** and sits in a different Settings panel.
It is the app's own format, it restores the whole studio, and it replaces rather than
merges. There is also a server-side "Download everything" JSON export, which includes the
costs and contact details a given device may not have been allowed to see.

### 2. Do imported orders and payments feed the reports, at their original dates?

**Status: PARTLY BUILT — and this is the one most likely to surprise**

**Evidence:** `webOrderToStudio` (:3745) sets `createdAt` from the file; the orders
importer patches `o.paid` (:10276); the finances importer writes `at: impDate(...)`
(:10320); `buildCustomerData` (:14330) sums `orderNetBase`; the finance screen's Revenue
and Cash flow read transactions (`renderFinance`, :13432).

**What works.** Everything computed from the order record honours the original date:

- Sales by category and by product type
- Client lifetime value and loyalty tier — these sum **order value**, so an imported client
  with three years of orders gets the right total and the right tier
- "Order value billed" (the accrual figure)
- Outstanding balances

**What does not.** The app's headline money figures are **cash basis** — Revenue, Money
in, Cash flow and Net profit all come from recorded transactions. **The orders importer
never creates a transaction.** It writes the deposit onto the order and stops there.

So a studio that imports three years of orders with their deposits will see correct
outstanding balances, correct client totals, and **a revenue chart that is empty for those
three years.** The fix available today is to also import the Finances CSV, which does keep
its dates and does feed revenue. Nothing on screen tells them that.

### 3. Do imported records trigger live side effects? Is there a historical flag?

**Status: PARTLY BUILT**

**Evidence:** `importWebOrders` (:3759) and `webOrderToStudio` (:3745).

| Side effect | Happens? |
|---|---|
| WhatsApp message | **No.** Auto-WhatsApp fires from `saveOrder()`; the importer writes straight to storage |
| Stock deduction | **No** for imported orders. Only a website *retail sale* decrements stock |
| Production job created | **Yes** — see below |
| Appears in receivables / chase list | **Yes**, if a balance remains |
| Due-date reminders | **Yes** — an old due date reads as overdue |

**Every imported order lands at stage 0, the first production stage.** The importer reads
the `status` column only to decide paid / partial / unpaid; it never maps a status to a
stage. A job delivered in 2024 arrives on the production board as new work for the
workroom, and the studio has to walk each one through nine stages or leave the board
wrong.

**There is no historical flag.** The only trace is the word `Imported` in the notes field
and a `web-csv-…` id prefix. No part of the app's logic distinguishes a historical record
from a live one, so nothing can exclude them from the board, the chase list or the
reminders.

### 4. Bank statements, POS or payment-provider exports

**Status: MISSING**

The Finances importer is generic — date, type, amount, category, method, note — and would
accept a bank export that somebody had reshaped into those columns by hand. There is no
bank-specific or provider-specific mapping, no OFX, QIF or MT940, no Flutterwave/Paystack/
POS format, and no duplicate detection beyond an exact date + amount + label match.

---

## B. Finance and funding readiness

### 5. Bank reconciliation

**Status: MISSING**

**Evidence:** every occurrence of "reconcile" in the app is either `reconcileDeletes()`
(:3534, removing cloud rows that no longer exist locally) or prose about two screens
agreeing on a figure.

There is no statement import, no matched/unmatched state on a payment or an expense, no
"cleared" flag, and no screen that puts recorded money beside bank money. A studio cannot
answer "which of these thirty payments has actually landed".

### 6. Custom date ranges and export

**Status: PARTLY BUILT — ranges yes, export no**

**Evidence:** `inPeriod` (:11647), `PERIOD_OPTS` (:11659), `renderGlobalPeriodPopup`
(:11700), `applyGlobalRange` (:11708), `VIEW_PERIOD` (:11666), `renderFinance` (:13432).

**Ranges work.** The period button offers Today, This week, This month, This year, All
time, a specific day, and **a custom From → To range**. It drives the dashboard, Orders,
Production, Sales, Finance, Logistics and Funds together. "The last 12 months" is two
taps.

**What can be read for a range:** Revenue, Expenses, Net profit, Stock on hand, and a Cash
flow panel showing Money in, Money out and Net flow, each drilling into its detail.
Outstanding is deliberately a snapshot of all orders and is never period-filtered — that
is a decision, not an oversight, so a funder asking for "outstanding at 31 December" would
not get it.

**Export is missing.** No CSV, no PDF, no print for any report. What exists is:

- The JSON backup, and the server-side JSON export — machine formats, not something to
  hand an accountant or a lender
- Print-to-PDF for **documents**: invoice, receipt, job sheet, measurement sheet, stock
  list, payslips

For a funding pack, everything would be read off a screen and retyped.

### 7. Gross margin

**Status: PARTLY BUILT**

**Evidence:** product margin at :11389 (`price − cost`, with a percentage);
`orderCost` (:3930), `orderProfit` (:3934), `orderAllCost` (:3933); the order form's profit
and loss block; `saveRun` (:7875).

- **Per ready-to-wear product:** yes. Selling price minus cost price, shown with a
  percentage on the product.
- **Per order:** yes, and in more depth. Revenue after discount, minus materials and
  production, gives operating profit; commissions, delivery, the director allocation and
  fund set-asides come off to give retained profit.

**Where material cost comes from is the problem: somebody types it.** The order has cost
lines — fabric, trims, outsourced work — entered by hand. The "Stock used" rows on the same
form deduct **quantities** from inventory and are explicitly not money: they never touch
the order's cost or profit. A studio that issues ₦30,000 of fabric from its own shelves
and forgets to type a matching cost line sees that job at 100% margin.

Stock *purchases* are expensed when received, so the money is in the books at the business
level — it is the per-job attribution that is manual.

**Production runs are the exception and are worth copying.** A run's typed costs plus its
labour become the cost of the finished pieces, which reach the shelf carrying it, so a
later sale of those pieces has a real margin.

### 8. Business registration and tax details

**Status: BUILT, with a narrow reach**

**Evidence:** `co_reg` field (:1441), `taxOn`/`taxLabel`/`taxRate` (:9800 and the company
panel), `invoiceInner` (:7500+), `invoiceText` (:7564), `docHeader`.

Stored in Settings → Company & invoices: business registration (RC / TIN), plus an
optional tax switch with its own name and rate. Tax is off by default and applies after
any discount and never to shipping.

They appear on **the invoice and the receipt** — registration under the company block, tax
as its own line — and in the WhatsApp/email text version of both.

They do **not** appear on the job sheet, the measurement sheet, the stock list or any
report; those use a shorter letterhead. There is no tax return, no tax period, and no
"tax collected this quarter" figure anywhere.

### 9. Audit trail and company log

**Status: PARTLY BUILT**

**Evidence:** `renderAudit` (:13706).

The audit log filters by **action type** (created, edited, deleted, payments, status,
other), by **person**, and by **free text**, and groups entries by day.

It has **no date filter** — it is the one significant list outside the period system — and
**no export**. It leaves the app only inside the JSON backup or the server export. For a
funder or an auditor asking for "all changes to orders in Q3", it would have to be
scrolled and screenshotted.

---

## C. Fabric and materials

### 10. Is fabric deducted automatically at a standard amount, and when?

**Status: PARTLY BUILT**

**Evidence:** `recipeFor` (:6520), `aggregateRecipes` (:6522), `applyRecipesToOrder`
(:6523), the deduction in `saveOrder` (:7063–7065), `saveRun` (:7875).

**Recipes exist.** Settings holds a bill of materials per product type — an Agbada needs
so many yards of this and so many of that.

**They are not automatic.** A recipe is applied only when somebody presses the button on
the order form, which fills the "Stock used" rows with the standard amounts. If nobody
presses it, nothing is filled and nothing is deducted.

**The trigger is the save, not the work.** Stock comes out when the order is saved, as the
difference against the previous save — so editing an order corrects the inventory rather
than double-counting. Nothing happens at cut, at production start, or at completion. A
stage change moves no stock.

### 11. Actual quantity used, and expected vs actual variance

**Status: PARTLY BUILT — actual yes, variance impossible**

The "Stock used" rows *are* the actual figures and can be edited at any time, with the
difference applied to inventory. So the workroom can record what really went in.

**But the recipe writes into the same field the workroom then edits.** The expected figure
is never stored alongside the actual one, so after an edit there is nothing left to compare
against. Variance is not calculated and is not reported anywhere. Adding it needs a field,
not a screen.

### 12. Buying in one unit and using in another

**Status: MISSING**

A supply has a single free-text `unit` — `pcs`, `yards`, whatever is typed. There is no
purchase unit, no issue unit, and no conversion factor. Buying a 50-yard roll and issuing
2 yards at a time means entering the stock as 50 yards and remembering that a roll is 50.

### 13. Client-supplied fabric

**Status: PARTLY BUILT — better than expected, with two real gaps**

**Evidence:** `FABRIC_SOURCES` (:6258), `itemIsTheirs` (:6266), `orderHasTheirFabric`
(:6268), `fabricCheckNeeded` (:6276), the job sheet warning (:7601).

Each item on an order says whose cloth it is, from four options: we supplied it, ordered in
for this, **client brought it in**, **client sent it ahead**. The last two are flagged as
theirs.

What that already does: the cloth is not studio stock and carries no cost, because it is
simply never a stock row or a cost line. The job sheet prints a bold warning in the only
colour on the page saying the client's own fabric cannot be replaced and must be checked
against the photo before cutting. A fabric check is prompted once, after work starts and
before quality control, and is signed and dated.

**The gaps:** it is never **logged as received** — no quantity, no date it arrived, no
receipt record separate from the order — and **leftover is not recorded at all.** There is
nowhere to say two yards went back to the client.

### 14. Remnants and off-cuts

**Status: MISSING**

No concept anywhere in the app.

---

## D. PR and gifting

### 15. Stock leaving as PR, a gift or a sample

**Status: MISSING**

**Evidence:** every `logMove` call in the app. The reasons a stock movement can carry are
fixed and internal: Used on order, Returned from order, Received / restocked, Manual
reduction, Opening stock, Manual adjustment, Stock count adjustment.

There is no gift, PR or sample reason, no recipient field, and no date beyond the movement
timestamp. A studio sending a piece to an influencer either records a generic manual
reduction, which loses the reason, or a zero-value sale, which distorts the sales figures.
**The cost of a giveaway is booked nowhere**, so marketing spend in kind is invisible.

### 16. Campaigns linked to sales

**Status: MISSING**

A campaign records its subject, message, type, channel, segment and how many people it
reached. There are no discount codes anywhere in the app, no attribution field on an order
or a sale, and no way to ask what a campaign earned.

---

## E. Order intake

### 17. A public page where a customer can submit an order

**Status: MISSING — the mapping is built, the transport never was**

**Evidence:** `web/` contains only marketing pages (`book.html`, `waitlist.html`,
`contact.html`, `partners.html` — all of them for us, not for a studio's clients).
`normalizeWebOrder`, `webOrderToStudio` and `importWebOrders` (:3700–3775) are built and
gated by `audit_webimport.js`. `WEBSITE_INTEGRATION.md` lists the transport under "what
go-live adds". The deployed Edge Functions are `admin-api`, `auth-recover`, `billing`,
`billing-webhook` and `team-admin` — none of them ingests an order.

So: there is no page a studio can send a client to, and no endpoint a studio's own website
can post to. What *is* finished is the hard half — turning an order from Shopify,
WooCommerce, Wix or a custom cart into the right kind of studio record (a made-to-measure
order if measurements came with it, a retail sale if not, an appointment if it was a
consultation), idempotently, with retail sales decrementing the right studio's stock.

Today a studio's website orders reach the app only by exporting them to CSV and using the
Orders importer by hand.

### 18. How the channel is recorded

**Status: PARTLY BUILT, and lopsided**

**Evidence:** `IN_CHANNELS` (:8780), the channel selector on the payment logger (:8824),
the order inference at :8797.

The list is **fixed in code and not configurable**: Studio, Website, WhatsApp, Instagram,
Referral, Other.

**It is asked on a hand-logged payment, not on an order.** An order's channel is *inferred*
— a website import carries one, everything else falls through to "Studio". So there is no
way to record that an order came from Instagram or WhatsApp. Only the money can be tagged,
and only when it is logged by hand rather than taken as a deposit on the order.

The Money In hub does break revenue down by channel, so the reporting end is ready for
better data than it is being given.

---

## F. Codes

### 19. Codes and SKUs

**Status: PARTLY BUILT**

**Evidence:** `of_code_*` on the order item (:6921, :6627), the catalogue save at :6356,
`productDraft` (:11474), `blankVariant` (:11470), `webDecrementStock` (:3729–3734), the
stock importer's field list (:10289).

- **Order line items have a product code.** Typed by hand, printed under the item name on
  the invoice, and remembered against that product type when "Save this piece for future
  invoices" is ticked, so picking the type again fills the code.
- **Catalogue products have no code field.** A product is id, name, category, price, cost,
  photo, note, variants, active.
- **Variants have no SKU.** A variant is id, size, colour, quantity.
- **Materials and supplies have no code at all.**

No generation from a pattern, no uniqueness check, and nothing that warns on a duplicate.

**Not searchable.** The list search is a text filter over the rows as drawn, and the code
is not drawn in any list, so it cannot be found by searching.

**And one lookup reads a field nothing writes:** `webDecrementStock()` matches a website
order's line to a product by `p.sku` or a variant's `v.sku`. Neither field is ever created
by the product editor. That path can only ever match on the internal id or `studio_ref`.

---

## G. General

### 20. Anything that saves only to localStorage

**Status: NONE — but read the caveat, it matters more than the answer**

**Evidence:** `audit_sync.js`, run read-only: *"keys=31 relational=6 app_state=17 — every
persisted key is wired for cloud sync exactly once."* `STATE_KEYS` (:2688), `DEVICE_LOCAL`
(audit_sync.js:51).

Nothing in these areas is stranded on one device. The gate fails the build if a new storage
key is added without wiring, and equally if a deliberately device-local key is quietly
wired up. The eight device-local keys are all correctly local: the outbox of unsent
writes, which studio this device is viewing, cached media URLs, storage usage, fault
records, and the local user list.

**The caveat.** Only **six** things are real database rows: orders, finished orders,
payments, customers, suppliers and feedback. The other **seventeen sync as one JSON blob
per key per business** through a single `app_state` table — products, supplies,
appointments, staff, campaigns, the audit log, attendance, leave, shifts, tasks, funds,
bills, announcements, roles, the planner and settings.

That is genuinely backed up and genuinely shared between devices. But a blob cannot be
queried, cannot be reported on server-side, and cannot be partially updated — two people
editing different products write the whole products blob. **Anything that needs
server-side reporting — a funder dashboard, cross-studio analytics, a scheduled export —
needs those blobs turned into tables first.** That is the largest hidden cost in this
whole list, and it sits underneath several of the features being scoped.

### 21. Bugs and dead controls found on the way

Not fixed, as instructed.

1. **The import screen claims Excel support it does not have.** It says "Works with a CSV
   or Excel export from almost any app"; the picker accepts `.csv` only and no spreadsheet
   parser exists. An `.xlsx` cannot be selected. A studio with an Excel export hits a dead
   end after being told it would work.
2. **Imported orders all land at stage 0** regardless of the `status` column, so completed
   historical work appears on the production board as new.
3. **An imported deposit posts no transaction**, so money that was genuinely received is
   invisible to Revenue, Money in, Cash flow and Net profit.
4. **`webDecrementStock()` matches on `sku` fields that nothing creates** — not on the
   product, not on the variant. Dead branch in a live path.
5. **The audit log is outside the period system** — no date filter, while every other
   significant list has one.

---

## What this means for the six candidate specs

Three things are cheaper than they look, because the hard half is already done:

- **Order intake** needs a transport, not a mapping. The mapping is finished and tested.
- **Variance on materials** needs one stored field, not a feature. Actuals are already
  captured; only the expected figure is being thrown away.
- **Channel on an order** needs a field and a picker. The list and the reporting already
  exist and are being starved of data.

Three are genuinely new builds:

- **Bank reconciliation** — nothing exists, and it implies a statement format, a matching
  rule and a status on every payment.
- **PR and gifting** — needs a movement reason, a recipient and a cost posting.
- **Report export** — no report leaves this app in any format today.

And one thing is not a feature at all but will decide how much the others cost:
**seventeen of the app's twenty-three data sets are JSON blobs, not tables.** Any feature
that needs the server to read, filter or total data — rather than the phone doing it —
starts by turning the relevant blob into rows.
