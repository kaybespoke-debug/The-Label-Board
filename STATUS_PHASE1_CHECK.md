# Phase 1 status check

Read from the shipped code and the live database on 5 October 2026, not from
screen labels. Where something is unreachable or contradicts its own label it
says so.

---

## The one screen

| Item | Status | In one line |
|---|---|---|
| **1. Releases** | — | v67 is one commit (import fixes), v68 is three (the money boundary). `origin/main` matches local exactly. |
| **2. Import re-check** | — | **Nothing to repair.** No live studio has imported an order: no `historical` flag, no imported payment, no order created since 30 September. |
| **3. Phase 1 progress** | — | **None started.** One stale branch, `phase-1b-team-invitations`, is an older piece of work 38 commits behind main. |
| **a. Material cost on orders** | **PARTLY BUILT** | Stock is really deducted and a move is logged, but **no cost is booked to the order**. Shop sales do capture cost; bespoke orders do not. |
| **b. Expected vs actual materials** | **UI ONLY** | Recipes can be entered and **can never be applied** — the function has no caller. No variance calculation exists anywhere. |
| **c. Channel on the order** | **PARTLY BUILT** | Orders have no channel field at all. Everything not from the website is reported as "Studio". |
| **d. Codes for products and materials** | **PARTLY BUILT** | **Two different code fields** on two catalogues, a variant field with no input, and a material code only the importer can write. |
| **e. Where these live** | — | Products, materials and recipes are all **JSON blobs**. Nothing in Phase 1 forces a migration — unless material cost must be permission-gated, which would. |

**The two findings worth reading first.** The recipe feature is not partly
built, it is unreachable: `applyRecipesToOrder()` exists and nothing calls it,
and the slot where its button belongs has been an empty template since the
first commit. And margin is currently **overstated on every bespoke order that
consumed materials**, because the stock comes off the shelf and no cost
follows it onto the job.

---

## 1. Releases

`git ls-remote origin refs/heads/main` → `a679e754…`
local `main` → `a679e754…` — **identical.** Working tree clean.

### layi-v67 — one commit

| Commit | What it did |
|---|---|
| `7eeec43` | History is not work: four import bugs, before the studios arrive — a real `historical:true` flag, status-to-stage mapping, imported deposits becoming transactions, Excel actually accepted, an optional SKU on products and variants, and a three-way review for an imported balance (chase / mark settled / write off). |

### layi-v68 — three commits

| Commit | What it did |
|---|---|
| `a660bda` | What the client pays is a permission too — `order_pricing` behind `money`, `order_settlement` behind `receivables`, `orders.total` and `order_summary` dropped, withheld figures stop printing as ₦0. |
| `6802027` | Prove the money boundary on staging, with real sessions — the 77-check five-role probe at the API. |
| `b3473ef` | Release layi-v68 — the version bump and the production promotion. |

`3fd66e1` (the public-key check against production) landed while v68 was live
and shipped no app change. **v69** is now live and is covered in section 5.

---

## 2. Import re-check — nothing found, nothing applied

The v67 importer marks real history with `doc.historical = true`. The repair
tool's own detection rule is: *not already flagged, and either `doc.notes`
contains "import" or `app_id` starts `web-csv-`.* I ran that rule read-only
against production.

| Studio | By notes | By `web-csv-` id | Already flagged | Orders |
|---|---|---|---|---|
| Adé Bespoke | 0 | 0 | 0 | 28 |
| Seed Multi Studio | 0 | 0 | 0 | 28 |

Across all nine studios: **0** orders carrying a `historical` key, **0**
imported payments, **0** orders created since 30 September (the newest order
on production is dated 15 September), **0** import entries in the audit log.

**So there is no dry-run output to show: the dry run would print "no
businesses matched".** I did not run the tool itself, because it requires a
service-role key from the environment and the read-only SQL above answers the
question completely. Nothing was applied.

---

## 3. Phase 1 progress — not started

| Branch | Head | Relationship to main |
|---|---|---|
| `main` | `a679e75` | current, v69 live |
| `admin-deploy` | `d730aa3` | the console's publish branch, not a working branch |
| `audit-remediation` | `eba7cd6` | finished; its work is in main |
| `phase-1b-team-invitations` | `71f90c6` | **1 commit ahead, 38 behind.** Older work about team invitations — not these items. |

No branch, commit or file addresses any of items (a) to (e). `PHASE_1B_DESIGN.md`
is a different Phase 1 (team invitations, 25 September). The nearest thing to a
spec for the items below is `AUDIT_FEATURE_GAPS.md`, which predates v67.

---

## 4. What already exists

### a) Material cost on orders — **PARTLY BUILT**

**What happens today.** The order form has a "Fabric & stock used" section
holding two unrelated things side by side: a hand-typed cost list, and a
"Stock used" picker. When you save the order, the stock picker is real — the
difference between the old and new quantities comes off the material's
on-hand figure and a movement is written to its ledger reading "Used on
order" with the order's reference. Returning stock reverses it.

**No cost is booked to the order by that.** The cost list beside it is typed
by hand: a label, an amount and a supplier. Nothing reads the material's unit
cost, multiplies it by the quantity used, or writes the result anywhere on the
order.

**The money is not lost — it is booked somewhere else.** When you receive
stock, the material editor writes a *purchase expense* against the studio
("Stock · Aso-oke (royal blue) (6 sets)"). So materials hit Finance at the
moment of buying, against the business, never against the job that consumed
them.

**Shop sales are the exception and they do it properly.** A ready-to-wear sale
copies the catalogue product's cost onto the line at the moment of sale and
writes a matching cost row: *"Stock cost (3 × ₦4,500)"*. So the capability
exists in the codebase — it has simply never been extended to materials on a
bespoke order.

**From what source, and is it stored at the time of use?** For shop sales:
from the product's `cost` field, **captured at the time of sale** and stored on
the line, so later price changes do not rewrite history. For materials: there
is no source in use. If one were wired up, the only figure available is the
material's single `cost` field — the *current* typed unit cost, overwritten on
every restock. There is no last-purchase-price history and no moving average:
the movement ledger records quantities and never the cost at the time.

**Client-supplied fabric is handled, but only as a warning.** Each item asks
"Whose material is it" with four answers — we supplied it, ordered in for
this, client brought it in, client sent it ahead. The last two are flagged as
theirs, which raises an amber note ("Their own cloth, and there is no second
piece") and prints in bold on the work order. It has **no cost consequence**,
and nothing stops someone adding a stock line for cloth the client supplied.

**Margin when stock is used but no cost typed: it is overstated, silently.**
Margin is the order's value less the typed costs and commissions. Materials
consumed contribute zero. The section note even reads "nothing recorded" next
to a populated stock list, which is accurate about the cost field and
misleading about the job.

**Evidence.** `stockUsed` as `[{supplyId, qty}]` ([site/layi_dashboard.html:8206](site/layi_dashboard.html#L8206));
the deduction and movement log on save ([:7362](site/layi_dashboard.html#L7362));
the typed cost total ([:7183](site/layi_dashboard.html#L7183)) and its section
([:7325](site/layi_dashboard.html#L7325)); the shop sale capturing
`unitCost` from `p.cost` ([:12082](site/layi_dashboard.html#L12082));
the purchase expense in `saveSupply` ([:11483](site/layi_dashboard.html#L11483));
`FABRIC_SOURCES` and `itemIsTheirs` ([:6555](site/layi_dashboard.html#L6555)).

**Missing against the spec:** a cost per material line captured at the moment
of use, from a named source, written to the order so margin is true.

---

### b) Expected vs actual materials — **UI ONLY**

**Where each number lives.** The recipe is `SETTINGS.recipes`, shaped
`{ "Agbada": [{supplyId, qty}, …] }`, edited in Settings → "Stock used per
product". The actual is `stockUsed` on the order document. **Different places,
so they are not the same field** — but they would collide if they ever met:
the apply function overwrites the actual quantity with the recipe quantity for
any material already listed.

**Is there a rule that applies the recipe at a production stage? No — and
there is no button either.** `applyRecipesToOrder()` is written, correct and
**never called.** Its button belongs in a slot that reads
`${recipesExist()?``:''}` — an empty template that evaluates to nothing
whichever way the test goes. That has been the case since the first commit in
this repository's history, so the recipe has never been applicable to an order
by any route: no button, no stage trigger, no setting.

**Variance: nothing.** There is no variance calculation, report, threshold or
highlighting for materials, by product, material, staff member or date. The
only "Variance" in the app is attendance hours measured against a standard
eight-hour day.

**The Settings contradiction — the body text is closer to true, and the
heading is wrong for the panel it sits on.** The heading says "(auto-deduct
from inventory)". That panel's recipes deduct nothing, because nothing can
apply them. The body's "as a reference" is the honest description of intent,
though currently generous: nothing reads the recipe at all. What *does*
auto-deduct is the separate "Stock used" list on the order itself. The heading
appears to have been written about that feature and placed on this one.

**Evidence.** `getRecipes` / `recipeFor` / `aggregateRecipes`
([:6816–6819](site/layi_dashboard.html#L6816)); the unreachable
`applyRecipesToOrder` ([:6820](site/layi_dashboard.html#L6820), zero call
sites); the empty button slot ([:7166](site/layi_dashboard.html#L7166)); the
panel heading and text ([:1545–1546](site/layi_dashboard.html#L1545)); the
recipe editor ([:10337–10346](site/layi_dashboard.html#L10337)).

**Missing against the spec:** a way to apply the recipe at all; expected
stored separately from actual rather than over it; and any variance output.

---

### c) Channel on the order — **PARTLY BUILT, payments only**

**Orders and sales have no channel field.** The order form has no channel
input and `draft.channel` is never written anywhere in the file. Two
read-only leftovers exist on the order shape — `o.source` and `o.channel` —
and only `source === 'website'` is ever set, by the website order path.

**How the channel is guessed.** For a money-in entry: use an explicit
`channel` on the payment if present; otherwise find its order and return
"Website" if the order came from the website, "Studio" if `o.channel` happens
to be `showroom`, and **"Studio" for everything else**. So in practice every
payment against a normal order is reported as Studio.

And the explicit branch is almost never taken: a payment logged in the app
writes a label, amount, date, order link, branch and method — **no channel**.
The only payments carrying one are the imported ones, which v67 tags
"Imported".

**Two separate lists, and only one is editable.**

| List | Where | Values | Editable? |
|---|---|---|---|
| `IN_CHANNELS` | code, line 9081 | Studio, Website, WhatsApp, Instagram, Referral, Imported, Other | **No — fixed in code** |
| `PAY_METHODS` | Settings → "How you get paid" | Bank transfer, Cash, Card, POS, Transfer to staff, Cheque, Mobile money | **Yes**, saved as `SETTINGS.payMethods` |
| `IN_METHODS` | code, line 9082 | Transfer, Cash, Card, POS | No — a third, shorter list used in reporting |

**What payments do inherit from their order:** the branch, the currency and
exchange rate, the client's name in the label, and the order link. Not a
channel, because there is none to inherit.

**Evidence.** `IN_CHANNELS` / `IN_METHODS` ([:9081](site/layi_dashboard.html#L9081));
`normChannel` and `txnChannel` ([:9084–9100](site/layi_dashboard.html#L9084));
the payment writer ([:8429](site/layi_dashboard.html#L8429)); `PAY_METHODS`
([:8447](site/layi_dashboard.html#L8447)) and its editor
([:8762–8779](site/layi_dashboard.html#L8762)); the "How you get paid" panel
([:1525](site/layi_dashboard.html#L1525)).

**Missing against the spec:** a channel on the order or sale, set when the
work is taken; payments inheriting it; and an editable list.

---

### d) Codes for products and materials — **PARTLY BUILT, and there are two fields**

v67 added an optional SKU, so the audit's "catalogue products have none" is
out of date. But what exists is **two different code fields on two different
catalogues**, which is the thing to decide before building on it.

| Thing | Field | Who writes it | Who reads it |
|---|---|---|---|
| Shop product | `sku` | the product editor, "Product code / SKU (optional)" | **only** website order matching |
| Shop variant | `sku` | **nothing — there is no input for it** | website order matching |
| Product type (the order's type list) | `code` | copied up from an order line when "save to catalogue" is ticked | copied back down to autofill the next order line |
| Order line | `code` | typed on the order | printed on the invoice row and in the item note |
| Material | `sku` | **only the CSV importer** | nothing |

**No automatic generation and no pattern.** Every code is typed. The only
thing resembling automation is the round trip between an order line and the
product-type catalogue.

**No uniqueness check** of any kind — nothing anywhere tests a code for being
already in use.

**Searchable: effectively no.** The list searches filter the text of the rows
as drawn, and a product's `sku` is not drawn in the list, so it cannot be
found by it.

**Printed: only the order line's own code.** It appears on the invoice and in
the item note. The shop product's `sku`, the variant's and the material's are
printed nowhere — not on job sheets, not on the inventory print list, not on
invoices.

**Evidence.** `blankVariant` and `productDraft` carrying `sku`
([:11934](site/layi_dashboard.html#L11934), [:11938](site/layi_dashboard.html#L11938));
the product editor input and its save ([:11954](site/layi_dashboard.html#L11954),
[:11958](site/layi_dashboard.html#L11958) — note the variant loop reads size,
colour and quantity and never a SKU); `webDecrementStock` matching on
`sku`/`studio_ref` ([:3932–3953](site/layi_dashboard.html#L3932));
`rememberItems` writing `.code` and `ofTypeChanged` reading it back
([:6648–6671](site/layi_dashboard.html#L6648)); the order-line input
([:7218](site/layi_dashboard.html#L7218)); the material importer's `sku`
column ([:10636–10642](site/layi_dashboard.html#L10636)) against `saveSupply`,
which does not store one ([:11483](site/layi_dashboard.html#L11483)).

**Missing against the spec:** one field rather than three; a variant input; a
material code in the editor; uniqueness; inclusion in search; and printing
where a code is useful.

---

### e) Where these live

| Thing | Shape | Where | On production today |
|---|---|---|---|
| Shop products (with variants) | **JSON blob** | `app_state['layi_dash_products']` | 2 studios, 20 items |
| Materials / supplies (with movement ledgers) | **JSON blob** | `app_state['layi_dash_supplies']` | 2 studios, 48 items |
| Recipes | **JSON blob, nested** | `SETTINGS.recipes` inside `app_state['layi_dash_settings']` | 2 studios hold the key |
| Product types | **JSON blob, nested** | `SETTINGS.productCatalog` | same blob |
| Suppliers (vendors) | **rows** | `public.suppliers` | 22 rows |
| Orders and their money | **rows** | `orders` + five satellites | 56 orders |

`public.products` exists as a table and holds **zero rows** — it was created
and never used.

**Would any Phase 1 item force a migration to tables? On the face of it, no.**
Material cost per order, a channel on the order, and codes can all be done
inside the current blobs: they are per-studio documents and these are
per-studio features. A variance report is the heaviest of them and is still
only arithmetic over one studio's own data.

**There is one thing that would force it, and it is worth deciding
deliberately.** The per-key permission rules put the products blob behind
`products` and the materials blob behind `supplies`. A blob is all-or-nothing:
anyone who may read materials reads **every field in them, including the unit
cost.** If a material's cost is to sit behind `seeCost` — as an order's cost
now does — that cannot be done in a blob, and the materials would have to
become rows with a satellite, exactly as the order money did in v68. So the
question is not "tables or blobs" but **"is a material's cost price a
`seeCost` thing?"** If yes, Phase 1 contains a migration. If no, it does not.

---

*Sections 1–4 are read-only: nothing in the database or the app was changed to
produce them.*
