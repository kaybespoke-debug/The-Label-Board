# Outstanding

Everything known to be unfinished, wrong, or waiting on somebody. Updated at
the end of every session. Nothing is removed until it is actually done — if
something turns out not to be worth doing, it moves to **Decided against**
with the reason, so it does not get re-raised in six months.

Last updated: 7 September 2026

---

## Waiting on Kayode

Things I cannot do: they need an account password, a dashboard setting on a
live service, or a commercial decision.

| | What | Why it matters |
|---|---|---|
| 1 | **Supabase → Auth → URL Configuration.** Set Site URL and add redirect URLs with `/**` | Password resets and email confirmations land on the wrong page, or nowhere, until this is set |
| 2 | **SMTP for auth email** | The partner portal signs people in with a one-time code. Without SMTP those emails go to spam or do not arrive, and nobody can sign in |
| 3 | **Auth → Policies → leaked-password protection: ON** | Currently off. It checks new passwords against known breached ones. Free, one toggle |
| 4 | **Move Supabase off Free before real subscribers** | Free gives 500MB database and 5GB egress. That is roughly **15 studio-months of data and 3 of traffic** — it cannot carry a launch. Pro is $25/mo ≈ ₦33,300, about one Basic subscriber |
| 5 | **Delete the old Supabase project `gcdrkoitjqwbidcfgyzl`** | Two projects, one live. The wrong one is easy to point something at by mistake |
| 6 | **Set each Netlify site's publish directory in the dashboard, then delete `netlify.toml`** | The file differs by branch on purpose and a clean merge silently serves the admin console to every studio. There is a recipe in CLAUDE.md, but a setting is safer than a habit |
| 7 | **Connect `web/` to Netlify** | The marketing site is finished and deployed nowhere |
| 8 | **Change the account password that appeared in a screenshot** | It was visible in an image shared into a session |
| 9 | **Decide the accessories question** | See *Open questions* below. Depends on Engineering #3 |

---

## Engineering, in the order I would do them

### 0. LIVE BUG: footwear and leather studios cannot see their own sales
They get the Shop (`catalog: true`), and the Shop toolbar has "Record a sale".
But `kind: 'bespoke'` makes `showsRetail()` false, so the **Sales tab is
hidden** and navigating to it redirects to the dashboard. They can take money
all day and never see the screen that reports daily, weekly and monthly
takings.

Fix, independent of any redesign: **if you have a Shop with stock, you can see
Sales** — make `showsRetail()` true for any activity with `catalog: true`.
Two lines.

### 1. Incremental sync — the one that changes the shape of the curve
Orders, transactions, staff, tasks and settings still sync as **whole JSON
blobs**: one row per studio per key, rewritten in full on every change and
re-read in full on every sign-in. The photos came out of that blob, which cut
it roughly a hundredfold, but the shape is unchanged and it still scales as
*library size × headcount*.

| Staff | Cost to serve | % of ₦65,000 |
|---|---|---|
| 50 | ~₦6,200 | 10% |
| 100 | ~₦21,100 | 33% |
| 200 | ~₦79,000 | **122%, loss-making** |

Pulling only rows changed since the last sync would flatten that almost
entirely and make 200 staff cost about what 20 does. **Large**: it touches
every read and write path, needs a per-key watermark, and needs conflict
handling for two devices editing the same list offline. Wants its own session
and a plan first. Until it is done, Pro is comfortable to ~50 staff and should
become a Bespoke conversation somewhere around 120.

### 2. The fabric check — small, and it prevents a real, expensive mistake
Each item on an order already carries a **Material(s)** picker and its own
**"Photos of this item / fabric"**, and those photos now live in Storage. Three
things are missing:

- **The printed job sheet's Fabric column is dead.** It reads `x.fabric`; the
  field was renamed to `materials` and the sheet was never updated. It prints
  blank on every bespoke job sheet, and `fabric:` is only ever assigned in one
  place, always to an empty string. **Two-line fix.**
- **The job sheet carries no photo.** The person about to cut holds a page with
  a client name, a blank fabric column and no picture.
- **Nothing says whose fabric it is, and nothing asks anyone to check it.**
  Proposed: one field per item (studio-supplied / client brought it / client
  sent it ahead), and a tick on the first production stage — *"fabric checked
  against the photo"*, with who ticked it and when.

Half a day with a gate.

### 3. Craft × mode — the trade list is modelling two things as one
`DEFAULT_ACTIVITIES` conflates **what a studio works in** (garments, footwear,
bags & leather, fabrics, accessories) with **how it reaches the customer**
(made to order, ready made, both). `bespoke` is a craft named after a mode,
`rtw` is a mode named as a craft, and footwear and leather have the mode
decided for them — hardcoded to *both*:

```
bespoke     board: true   shop: false   sales: false
rtw         board: false  shop: true    sales: true
footwear    board: true   shop: true    sales: FALSE   <- both, and broken
leather     board: true   shop: true    sales: FALSE   <- both, and broken
fabrics     board: false  shop: false   sales: true
```

So a shoe shop that only stocks gets a production board with Clicking and
Lasting; a bespoke shoemaker gets a Shop with stock levels.

**Contains a live bug — see the top of the Engineering list.**

Fix: carry both halves in `does`, as `garments:made`, `footwear:ready` and so
on. The craft half picks the stages and the word; the mode half decides the
board, the Shop and Sales. Migration is clean and changes nobody's setup:
`bespoke`→`garments:made`, `rtw`→`garments:ready`, `footwear`→both halves,
`leather`→both halves, `fabrics`→`fabrics:ready`.

**About a day** with gates. Touches `activityKind`, `activityHasCatalog`,
`branchDoes`, `summaryType`, `showsBespoke/RTW/Retail`, stage selection, the
first-run screen and the branch editor, plus audit_trades, audit_first_run,
audit_channels, audit_branch_scope and audit_simplicity.

**Do this before accessories.** Against the current model, accessories would
have to have its mode hardcoded to *both*, repeating the footwear mistake
exactly. After this it is a one-line addition.

### 4. Buttons that do not exist yet
Wired, gated and callable, with no UI calling them:
- `liveRecordPayment` — recording a payment against a studio
- `liveSetStorageCap` — granting one studio extra space after agreeing a price

Both work today via SQL. Each is about an hour of form.

### 5. Sign-in events are not surfaced
Registrations, activity, last-seen and app version all reach the console.
*Who signed in and when* lives in Supabase Auth and nothing reads it. Asked for
as part of "all logins".

### 6. Nothing expires a trial
The console flags a trial that has run out; no job acts on it. At current
volume that is a weekly glance rather than a problem, but it is a decision, not
an oversight.

### 7. Console demo-data paths still assume every plan has a price
Live paths are correct. These four are not, and would misprice a real Bespoke
customer converted through the console UI:
- `formConvert` prints "Bespoke — ₦0/mo"
- `doChangePlan` / `doConvert` / `formNewSubscriber` set `mrr` from
  `p.monthly`, so moving a studio to Bespoke books **₦0 MRR**
- `core.js` MRR forecast sums `planById(s.plan).monthly`, so Bespoke
  contributes nothing
- the plan editor's seat field accepts 0 with no hint that it means unlimited

### 8. Product photos are still inline base64
Order, outfit, progress and client photos moved to Storage. Catalogue product
photos did not. Bounded by catalogue size rather than trading volume, so it is
much smaller — a 500-product shop is about 60MB — but it is the same 7.8×
overpayment on those bytes.

### 9. `migrateRoles()` marker
A latent bug flagged in an earlier session and deliberately not patched. Needs
re-reading before it bites.

---

## Verified, with the limits stated

- **The service worker's outbound fetch** could not be exercised in a real
  browser — the preview environment blocks worker-initiated cross-origin
  requests. The *cache-serving* path was proven for real: three different
  signed tokens, one long expired, all returned the same photo byte for byte
  with the network never touched.
- **A live photo upload end to end** needs a signed-in studio, which needs a
  password. Covered by the harness; the last leg wants five minutes with
  somebody signed in.
- **Four test enquiries are in the live console** (Ada Obi, Test Two, Grant
  Check, Bimpe Adeyinka). Mine, from building the pipeline. Marking them Spam
  or Closed is a fair first use of the feature.

---

## Open questions

**Accessories.** Gele, fila, beadwork, jewellery, scarves, belts. They already
work as a Shop product with sizes and stock, as a line on a bespoke order, and
as an inventory category — a tailor selling fila today can already do it. What
does not exist is a **trade** for a studio whose *whole* business is
accessories; at first run they must currently describe themselves as bespoke
tailoring, which is the exact wrongness the first-run screen was built to
remove.

**Do Engineering #3 first.** Against the current model an accessories trade
would need its mode hardcoded to *both*, exactly repeating the footwear
mistake. Afterwards it is one line. And accessories is not one workflow —
millinery, beadwork and jewellery share no stages with each other — so its
stages should be a deliberately generic made-to-order set the studio renames,
not a pretence that we know them.

---

## Decided against

- **A sixth "haberdashery" trade.** Dropped as a business type: the shops are
  small and the workflow is a subset of a fabric shop's. It survives as an
  inventory category, which every tailor uses. (Recorded in the code at
  `DEFAULT_ACTIVITIES`.)
- **Taking payments in-app.** No gateway, no card, no webhook. An operator
  records a payment that already happened, the same way a studio records how
  its own customer paid.
- **Enforcing the Basic/Pro receivables split server-side.** Chasing is a
  `wa.me` link with no server in the path, so there is nothing to authorise.
  It is a commercial nudge, and honest about it. It becomes enforceable the day
  reminders go through our own WhatsApp sender.
