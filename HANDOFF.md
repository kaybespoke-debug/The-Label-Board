# LAYI Studio OS — Engineering Handoff

**For:** Claude Code (or any engineer) picking this up cold.
**App:** `layi_dashboard.html` — a single-file, client-side studio-management system for a fashion house (bespoke tailoring + retail), being prepared for sale as a SaaS product to other brands.
**Size:** ~7,100 lines. No build step. No dependencies. Open the file in a browser and it runs.

---

## 0. Read this before you change anything

**Run the gates first, on the unmodified file:**

```bash
node audit/verify.js layi_dashboard.html
```

All seven should be green. Run it again after every change. **A change that turns a gate red is a regression — fix the cause, not the test.**

These gates are not decoration. They encode bugs that were actually shipped and actually hurt. They have been verified to catch real regressions: removing a branch filter from one drill-down trips `check_sync`; removing one card's click handler trips `audit_cards` across 12 role/branch combinations.

---

## 1. Architecture in one page

**Single HTML file.** Two inline `<script>` blocks. All state in `localStorage`. No backend, no server, no auth beyond a client-side password check.

**Storage keys** (all `layi_dash_*`):
`orders, txns, appts, customers, staff, users, roles, products, supplies, suppliers, bills, pots, tasks, anns, attendance, leave, shifts, campaigns, log, audit, settings`

**Three cross-cutting models drive nearly all behaviour.** Almost every bug in this codebase has been a violation of one of them.

### 1a. Branch scoping
Everything is tagged to a branch (studio/outlet). The current view is the global `activeBranchView` (`'all'` or a branch name).

- `inBranch(rec)` — the filter every list/total must pass through.
- `branchOf(rec)`, `branchNames()`, `multiBranch()`, `canSwitchBranch()`, `userBranch()`.
- Branch renames must call `renameBranchRefs(old,new)` or you orphan orders, transactions, supplies, appointments and staff.

**Rule:** if a figure is displayed, both the figure *and* its drill-down must be computed from the same `inBranch`-filtered set. Violating this is the single most common bug in this file's history.

### 1b. What a studio does (activities)
A branch stores `does: []` — a list of activity keys. Each activity has a `kind`:
- `kind:'bespoke'` → that branch shows **Production**
- `kind:'retail'` → that branch shows **Sales**
- `catalog:true` (Ready-to-wear) → also shows **Products**

Owners can add/remove activity types freely (`SETTINGS.branchActivities`). The built-in four (bespoke, rtw, haberdashery, fabrics) are a starting point, **not** guaranteed to exist — never hardcode them.

Legacy branches store `type: 'bespoke'|'rtw'|'both'|...`; `branchDoes(b)` migrates that transparently. Don't reintroduce a `type`-only code path. **"Both" was deliberately removed** from the UI — it explained nothing. Multi-select replaced it.

### 1c. Roles & permissions
Roles: `owner, manager, cre (Client Relations), tailor, accountant` + any custom role the owner creates.

**34 permission keys**, resolved by `permVal(role,key)` / `can(key)`:

```
orders products customers marketing logistics supplies team branchSwitch attendance
finance expenses funds sales payroll audit settings users
money receivables seeProfit seeCost seeContact allOrders editStaff
update canQC canDispatch appts del
setCatalog setCompany setWorkflow setBranches setData
```

**The critical mechanism — `PERM_FALLBACK`.** When a *new* permission is added, existing roles have no value for it. Rather than defaulting to `0` (which silently strips access from every live account), each new key declares a fallback to its historical coupling. Example: `expenses` used to ride on `money`, so a role with `money:1` and no `expenses` key still resolves `expenses → true` until an owner explicitly toggles it.

**If you add a permission, add its `PERM_FALLBACK` entry.** `audit_perms.js` will fail you if you don't.

The dashboard renders in **four different layouts** depending on role — this trips people up constantly:

| Layout | Who gets it | Function |
|---|---|---|
| `owner` | finance or seeProfit (owner/manager/accountant) | `renderActivity` + `renderOwnerFinance` |
| `team` | can post updates (CRE) | same, finance strip swapped for receivables |
| `maker` | tailors / workroom | `renderMakerDash` |
| `cre` | appts but no update/finance (office assistant, receptionist) | `renderCreDash` |

**A fix applied to one layout is not applied to the others.** This was the cause of "it works on the owner dashboard but not the tailor's."

---

## 2. Conventions and hazards

**Dev loop:** edit → `node audit/verify.js` → open in a real browser → ship.

**Parse hazards** (these have broken the file before, and `parsecheck.js` exists solely to catch them):
- A straight apostrophe inside a single-quoted JS string (`'don't'`). Use `\u2019` or double quotes.
- A literal `</script>` inside a template literal.
- Don't let a tool interpret `\uXXXX` before it reaches the file — write the real character.

**Do not re-add the build stamp / version badge.** It was removed on purpose.

**UI conventions:**
- Every KPI stat card must be clickable and open a focused breakdown modal. Cards must **never** navigate to another tab — that loses the user's context and was a top complaint. `audit_cards.js` enforces this.
- Cards and page filter-chips must not fight over the same state. Cards open modals; chips filter the page. Both must use the same underlying definition (e.g. "in progress" = `stageIndex < STAGES.indexOf('Ready for Delivery')`), or the counts drift apart.
- Long modal lists get a search box via `listSearch(placeholder, selector, count)` — it renders only at 8+ rows.
- Money helpers: `orderNet`, `orderNetBase`, `orderOutstanding`, `orderOutstandingBase`, `orderProfit`, `toBase(n,o)` (multi-currency: NGN/GBP).
- Expense gating: `expenseCounts(t)` — pending and rejected expenses must never be counted in any total.

**Finance semantics (learned the hard way):** headline figures are **cash basis** (money actually received/spent). The accrual figure is labelled "Order value billed." Outstanding is a **snapshot**, never period-filtered. Mixing these produced numbers that didn't reconcile across the dashboard, finance tab and branch report.

---

## 3. What is verified working

Verified by the gates + manual browser walkthroughs:

- Dashboard KPI cards, all four role layouts, all branches — every card drills into a scope-matched breakdown.
- Finance reconciles: dashboard = finance tab = branch report, on cash basis.
- Branch report + per-branch drill-downs (revenue, expenses, outstanding, active orders, inventory, team, customers).
- Appointments: type/status model, fitting record (what was done, adjustments needed, client feedback), completion + follow-up flagging.
- Needs-Attention: focused "why is this flagged / what to do / post an update" view for orders and low stock.
- Orders, Production, Products, Sales, Inventory, Logistics, Attendance — no dead KPI cards, for any role, on any studio.
- Permissions: role matrix, new-permission fallbacks, permission isolation.
- CRE receivables: who owes, what's paid in, chase list with pre-filled WhatsApp reminders — without exposing profit or expenses.
- Branch editor: multi-select activities, add/remove custom types, rename propagation across all records.

---

## 4. Known gaps — do not spend time rediscovering these

These are **architectural**, already understood, and not findable by code review:

1. **No backend.** Everything is `localStorage`. Mobile Safari/Chrome evict it under storage pressure. **The day staff depend on this daily, data loss is a when, not an if.** This is the #1 blocker to going live, let alone selling.
2. **No real authentication.** Client-side password check only. Anyone with the file has every account. Roles are a UI convenience, not a security boundary.
3. **No multi-tenancy.** One deployment = one business. Selling to other brands requires tenant isolation.
4. **No payments.** Paystack/Flutterwave integration was specced, never built. (Flutterwave recommended — NGN + GBP client base.)
5. **No server-side backup/export beyond a JSON dump.**
6. **No offline/sync conflict handling.** Two staff on two phones will silently overwrite each other.
7. **NDPR (Nigerian data protection) compliance** unaddressed — matters commercially, as the app stores customer names, phones, addresses and body measurements.

Agreed target stack when the backend happens: **Supabase** (Postgres + auth + row-level security for tenancy) + **Flutterwave**.

---

## 5. What I'd actually do next, in order

Honest prioritisation. The top three are the difference between "impressive prototype" and "sellable product." Everything below them is polish.

**Tier 1 — before this can be trusted with real data**
1. **Supabase backend + real auth.** Migrate the 21 `localStorage` keys to Postgres tables. Keep the getters/setters as the seam — `getOrders()`/`save()` are the only places that touch storage, so this is a contained change. Row-level security keyed on tenant + branch gives you multi-tenancy and turns roles into a real security boundary rather than hidden buttons.
2. **Data safety net now, before (1) lands.** Automatic scheduled export + a loud warning when `localStorage` is near quota. Cheap; buys time.
3. **Audit the money math against an accountant.** The cash/accrual split is coherent, but commissions, discounts, multi-currency (`toBase`) and partial payments deserve a second pair of eyes before anyone runs payroll off it.

**Tier 2 — before selling to another brand**
4. **Onboarding for an empty studio.** Everything is tuned for the demo seed. A brand starting from zero orders/staff/branches needs a guided setup, and empty states that teach rather than just say "nothing here."
5. **Self-serve signup + tenant provisioning.**
6. **Payments (Flutterwave)** — deposits, balance collection, receipts.
7. **WhatsApp/SMS notifications (Termii)** — the chase list already builds the messages; automate the sending.

**Tier 3 — product polish**
8. Accessibility pass (keyboard navigation, focus traps in modals, ARIA on the stat cards, contrast in light mode).
9. Performance: `renderAll()` re-renders every tab on every mutation. Fine at demo scale; will crawl at 10k orders.
10. `renderProduction()` has an unreachable block after an early `return` — dead code from an earlier pipeline design. Delete it.
11. Split the single file into modules with a light build step. Do this **only after** the backend exists — right now single-file deployment is a genuine asset (drop it on Netlify, done).

---

## 6. How to ask for a review (suggested prompt)

Open-ended "what could be improved?" will produce a long, flat list where the important things are buried. Be specific:

> Read `HANDOFF.md` first, then `layi_dashboard.html`.
> Run `node audit/verify.js layi_dashboard.html` and confirm all gates pass.
> Do **not** propose the known gaps in §4 — I know about them.
>
> Then, for **one** of these at a time:
> (a) Trace the money math end-to-end (`orderNet` → `financeTotals` → dashboard/finance/branch report) and tell me where the numbers could disagree.
> (b) Find every place a figure is displayed whose drill-down is computed by a different code path than the figure itself.
> (c) Find state that a non-owner role can reach but shouldn't, or vice versa.
> (d) Run the app in a real browser with Playwright, click every KPI card in every tab as each of the 5 roles, and report anything that errors, shows nothing, or shows another branch's data.
>
> For each finding: quote the exact lines, explain the user-visible symptom, and propose the smallest fix. Then re-run the gates.

**(d) is the highest-value ask** — Claude Code can drive a real browser, which the environment these gates were written in could not. The gates simulate the DOM; a real browser will catch layout, focus and event bugs they cannot.

**What not to ask it:** what fashion brands want, or how to prioritise commercially. It will produce confident, plausible product strategy that is really just pattern-matching on generic SaaS advice. That judgment is yours.

---

## 7. Files in this package

```
layi_dashboard.html      the app
HANDOFF.md               this file
audit/verify.js          runs all gates; exit 0 = green
audit/parsecheck.js      syntax
audit/smoke_dash_fixes.js runtime smoke of dashboard drills
audit/check_sync.js      card figure == drill-down figure
audit/audit_branches.js  per-studio parity
audit/audit_roles.js     per-role parity
audit/audit_perms.js     permission matrix + fallbacks + isolation
audit/audit_cards.js     dead KPI card sweep
```

Gates run on Node with no dependencies. They stub a minimal DOM and `localStorage`, load the app's real inline scripts, seed demo data through the app's own `demoLogin()`, and then call real functions. They test the actual code, not a copy of it.
