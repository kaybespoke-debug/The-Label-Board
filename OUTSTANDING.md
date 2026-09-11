# Outstanding

Everything known to be unfinished, wrong, or waiting on somebody. Updated at
the end of every session. Nothing is removed until it is actually done — if
something turns out not to be worth doing, it moves to **Decided against**
with the reason, so it does not get re-raised in six months.

Last updated: 11 September 2026 (eighth session)

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
| 2 | `git push origin admin-deploy` → `5b3d452`, publishes the **admin console** and the partner portal | done |
| 3 | Merge to `main` → `d0c50b5`, publishes the **customer app** | done |
| 4 | Watch the sign-in screen on a real phone: the build stamp must read **layi-v40**. If it still says v39 the service worker did not swap | **Kayode, now** |
| 5 | Tell every device in a studio to **reload once**. Not required, but it collapses the window below to nothing | **Kayode, now** |

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

## Waiting on Kayode

Needs a password, a dashboard setting on a live service, or a commercial call.

| | What | Why it matters |
|---|---|---|
| 1 | **Supabase → Auth → URL Configuration.** Site URL + redirect URLs with `/**` | Password resets and email confirmations land nowhere until this is set |
| 2 | **SMTP for auth email** | The partner portal signs people in with a one-time code. Without SMTP nobody can sign in |
| 3 | **Auth → Policies → leaked-password protection: ON** | Off today. Checks new passwords against known breaches. One toggle |
| 4 | **Move Supabase off Free before the first studio uploads photos** | Free is **1GB of file storage**, and Basic is sold as **20GB**. One studio cannot use a twentieth of what it is promised. Also 500MB database and 5GB egress, about 15 studio-months of data and 3 of traffic. Pro is $25/mo ≈ ₦33,300, roughly one Basic subscriber. Checked 11 Sep: 30MB of 500MB used, 0 of 1GB storage, 11 monthly active users |
| 5 | ~~Delete the old project `gcdrkoitjqwbidcfgyzl`~~ | **Done 11 Sep.** One project left: ref `eskubrbgbcbaejynjxvh`, eu-west-2, renamed to `The Label Board` the same day. A rename does not change the ref or the URL, so no config moved. The CLI link on any machine that pointed at the old project must be redone: `supabase link --project-ref eskubrbgbcbaejynjxvh` |
| 6 | **Set Netlify publish directories in the dashboard, then delete `netlify.toml`** | The file differs by branch on purpose; a clean merge silently serves the admin console to every studio |
| 7 | **Connect `web/` to Netlify** | The marketing site is finished and deployed nowhere |
| 8 | **Change the password that appeared in a screenshot** | It was visible in an image shared into a session |

---

## Fixed this run

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
