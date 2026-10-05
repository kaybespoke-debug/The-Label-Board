# Phase 1 — make margins true: progress report

Nothing is deployed. Both projects are untouched: the migration is written
and gated in the repository and has not been applied to staging or
production. 5 October 2026.

---

## Where this got to, honestly

| Item | State |
|---|---|
| **1. Materials to rows** | **Database half DONE and gated** — 4 tables, the boundary, the average, the migration, the reconciliation, export/restore, 62-check harness. **App half not started.** |
| **2. Material cost on orders** | **Designed, not built.** The design changed once I had item 1 in place, and there is a question for you below. |
| **3. Recipes that actually work** | **Designed, not built.** |
| **4. Variance report** | **Designed, not built.** |
| **5. Channel on the order** | **Designed, not built.** The `IN_METHODS` recommendation you asked for is below. |
| **6. One code field** | **Partly prepared** — materials now have a `code` column with per-studio uniqueness enforced. The rest not built. |

I took item 1 first as instructed and to the standard v68 set, because
everything else reads from it. That is as far as one pass got. Each of
items 2 to 6 touches the 8,000-line app file in several places and needs
its own gate; stacking six half-finished ones would be worse than
finishing one and telling you where the line is.

**The honest shape of the remaining work:** item 1's app half is the
biggest single piece left, because `getSupplies()` and `setSupplies()` are
read and written throughout the file and the cost has to come out of what
syncs. Items 2 and 3 are moderate and share a code path. Items 4, 5 and 6
are independent of each other and can go in any order.

---

## 1. Materials to rows — what was built

### The tables

| Table | Holds | Read | Write |
|---|---|---|---|
| `public.materials` | name, category, unit, quantity, reorder level, supplier, note, **code** | `supplies` | `supplies` |
| `public.material_costs` | the running weighted average, **last paid** and when | **`seeCost`** | **`seeCost`** |
| `public.material_moves` | every in and out, its note and the order reference | `supplies` | `supplies` to add, **nobody** to change |
| `public.material_move_costs` | what that movement cost, **at the time** | **`seeCost`** | **`seeCost`** |

Same satellite shape as v68's order money, so there is one pattern in the
codebase rather than two.

**Named `materials`, not `supplies`.** `public.suppliers` already exists
and holds vendors. A table called `supplies` one letter away from it is a
mistake waiting for a tired afternoon. The app keeps its own vocabulary
and its storage key, which never changes.

### The thing that makes an average real

The old ledger recorded quantities and no money, so the only cost
available was whatever had most recently been typed into the material.
`material_move_costs` prices each receipt when it happens. Proven in the
harness with three receipts at three prices:

| Receipt | Qty | Unit cost |
|---|---|---|
| June | 10 | ₦9,000 |
| August | 10 | ₦11,000 |
| September | 20 | ₦10,000 |

Average = ₦400,000 ÷ 40 = **₦10,000**, last paid **₦10,000**. Then a
dearer October receipt of 10 at ₦20,000 moves the average to **₦12,000**
and last paid to ₦20,000 — **and June still reads ₦9,000**, which is the
whole reason the movements have a cost table. Delete that receipt's cost
and the average returns to ₦10,000, because it is recomputed from the
whole history rather than nudged. It cannot drift.

### The migration dry run, against the live blobs

Read-only. Nothing was written to production.

| | Adé Bespoke | Seed Multi Studio |
|---|---|---|
| Materials to write | 24 | 24 |
| Branch name resolved | **24 of 24** | **24 of 24** |
| Supplier reference resolved | **11 of 11** | **11 of 11** |
| Movements to write | 46 | 46 |
| Movements that get a cost | 24 | 24 |
| Opening averages set | 24 | 24 |
| Cost rows reading zero | 0 | 0 |
| **Stock on hand at cost** | **₦1,900,110** | **₦1,900,110** |

Every branch name resolves. Every supplier reference resolves. Every
material carries a cost, so every opening average is real. **The
valuation is the number the reconciliation gates on** — counts can match
while the money is wrong, and ₦1,900,110 on both sides is the proof the
opening average came across.

The blob is not touched and keeps syncing. Retiring it is a separate,
refusing step, exactly as the order blob was.

### The gate

`supabase/tests/materials_harness.mjs` — **62 checks, green**, now in
`node release.js`.

It holds, with four real signed-in roles (owner; a stock keeper with
`supplies` and no `seeCost`; a buyer with both; a workroom member with
neither):

- quantities and the movement ledger follow `supplies`; the average and
  every receipt price follow `seeCost`, and are **refused** without it
- **the join does not leak**: `materials left join material_costs` hands
  the stock keeper nulls rather than figures
- **the write side too**: the stock keeper cannot set an average, and
  **nobody rewrites a movement, the owner included** — a miscount is
  corrected by another movement, which is how a stockroom works
- another studio's owner reads nothing from any of the four tables, and
  the public key reads nothing at all
- the migration reconciles item by item, is idempotent, leaves the blob
  alone, and gives a material with no known cost a row reading zero
  rather than no row — because an absent row means "not for you"
- **and the one that protects the P&L**, below

Two bugs in my own first draft, both worth recording because they are the
kind that make a suite lie:

- **the session helper had no transaction.** `set local role` lives until
  the end of the enclosing transaction, and PGlite gives every loose
  statement one of its own, so the role was discarded before the query
  ran and every policy passed. The suite cheerfully reported a stock
  keeper reading costs and anon reading everything. Now copied verbatim
  from `restore_harness`, which does it correctly.
- **`on conflict` cannot infer a partial unique index.** The movement
  index was `where app_key is not null`, which is the obvious shape and
  made every upsert fail. NULLs are distinct in a unique index anyway, so
  the predicate bought nothing.

And one caught by an **existing** gate, which is the better kind.
`storage_rls_harness` sweeps the exposed schema rather than checking a
list, and it found that **`anon` could execute all three new `public.`
functions** — `material_cost_of`, `migrate_my_materials`,
`reconcile_my_materials`. Supabase grants EXECUTE on a new function in
`public` to `anon` and `authenticated`, and `revoke from public` does not
undo it, because that is a grant to a role rather than to PUBLIC. I had
revoked the four `app.` helpers and missed the three gateways. Revoked
from `anon`; `authenticated` keeps them because each one authorises
internally.

### Export and restore

`app.export_studio_raw` is **version 5** and carries all four tables.
`app.import_studio` reads the version: below 4 it carries the order money
forward out of the document, and **below 5 it builds the materials rows
from the restored supplies blob**. So the backups taken this morning still
restore complete tomorrow, and the eighteen version-3 files still restore
complete too.

### The gate that protects the cash P&L

You asked for proof that a material cost on an order never becomes an
expense. Section 5 of the harness measures it rather than asserting it:

- using stock on an order creates **no** transaction (counted before and
  after)
- migrating a whole blob creates **none** either
- **no trigger on any of the four tables mentions a transaction, an
  expense or finance** — read from `pg_trigger`, not from intent
- and the migration function's own source does not name
  `public.transactions`

The principle, written where the next person will find it: **materials are
expensed when they are bought.** `saveSupply` already writes a purchase
expense on receipt. A cost on an order says what that job consumed. If it
also wrote a transaction, every metre of lace would be counted twice and
the studio would think it spent double.

---

## Decisions I need from you

### 1. Which average? (please confirm)

I implemented **total paid across every costed receipt ÷ the quantity
those receipts brought in** — standard weighted average cost, not revalued
when stock is consumed. So it describes everything the studio has ever
bought of that material rather than only what is left on the shelf.

For "what does a metre of this lace cost us", that is the right answer and
the stable one. The alternative — an average that depletes as stock is
issued — drifts with every job and makes two orders on the same day cost
different amounts. **Confirm the first, or say if you want the second.**

### 2. Material cost on an order, when the person cannot see cost

This is the one the design of item 1 changed. The average now lives behind
`seeCost`, which is what you asked for. The consequence: **a staff member
without `seeCost` has no average on their device, so they cannot compute a
material cost at all.** If they save an order that used stock, the stock
still comes off the shelf correctly, and no material cost can be written.

Three ways to go, and I did not want to pick one for you:

- **(a) The server does it.** A trigger prices the line from the current
  average when a stock line is saved, regardless of who saved it. Margins
  are always complete. Cost is never exposed to anybody who may not see
  it, because they never receive it — the server writes it into the
  `seeCost` satellite directly. **My recommendation.**
- **(b) The device does it, when it can.** Simplest, matches how the price
  and the commissions already work, but an order saved by the workroom
  gets no material cost and permanently reads "margin excludes materials"
  until somebody with `seeCost` opens and re-saves it.
- **(c) Only people with `seeCost` may save a stock line.** Clean in the
  data, wrong in the workroom: the people who actually use the cloth are
  usually the ones without cost access.

**(a) is the only one that makes margins reliably true**, which is the
name of this phase. It is also slightly more machinery: a trigger on the
order's stock lines rather than arithmetic in the client.

### 3. `IN_METHODS` vs `PAY_METHODS` — proposal, not changed

There are three lists today:

| List | Items | Editable | Used for |
|---|---|---|---|
| `IN_CHANNELS` | 7 | no | where money came from |
| `PAY_METHODS` | 7 | **yes** | how a payment was taken |
| `IN_METHODS` | 4 | no | a method breakdown in the Money In reports |

**`IN_METHODS` should be retired in favour of `PAY_METHODS`.** It is a
strict subset in meaning (Transfer, Cash, Card, POS against the editable
list's seven), it is not editable, and a studio that adds "Mobile money"
in Settings sees it on the payment form and not in the report that counts
it — which reads as a missing figure rather than a missing list entry. One
editable list, used in both places.

The only care needed: payments recorded before the change carry method
strings from either list, so the report must group on the recorded string
and show anything unrecognised under its own name rather than dropping it.

### 4. Shop products to rows — proposal, not done

`public.products` exists and holds zero rows, so the shape is free. It
would be straightforward and it is the same job as the materials: the
product's `cost` has exactly the same problem the material's did, and
`saleItems[].unitCost` already captures cost at the time of sale, so the
satellite would only need to hold the catalogue cost.

**Worth doing, and not in this phase** — it is a second migration with its
own reconciliation and probe, and item 1's app half has to land first or
the two would be in flight over the same sync code at once.

---

## What is left, in the order I would do it

1. **Item 1's app half.** `getSupplies`/`setSupplies` read and write rows;
   a pusher and puller like `pushOrderRows`/`pullOrders`; cost stripped
   from what the non-cost tables receive; the blob retired behind a
   reconciliation that must come back green. Then the staging role probe
   with real sessions, and the promotion.
2. **Item 2**, once you have answered decision 2 above.
3. **Item 3**, which shares the order form's stock section with item 2.
4. **Items 4, 5, 6** in any order.

---

## Files

| File | Change |
|---|---|
| `supabase/migrations/20261005120000_a_material_cost_is_a_see_cost_thing.sql` | new, 740 lines: the four tables, the RLS, `app.recalc_material_average`, `app.material_cost_changed`, `public.material_cost_of`, `app.migrate_materials_to_rows`, `app.reconcile_materials`, `public.migrate_my_materials`, `public.reconcile_my_materials`, `app.export_studio_raw` at version 5, `app.import_studio` with the version-5 carry-forward |
| `supabase/tests/materials_harness.mjs` | new, 62 checks |
| `release.js` | the harness is a gate |
| `supabase/schema_inventory.txt` | re-snapshotted: **997 objects**, fingerprint `dd35a4e6ed8037fe2832dc595fd6ad7e` |

Production and staging both still read `b6f8aa23…` at 935 objects. The
difference is this release, unapplied.
