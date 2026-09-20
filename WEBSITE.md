# The public website

The fourth app in the family, and the only one a stranger sees. The customer app
(`layi_dashboard.html`) is what a studio runs its business on, `admin/` is the
operator console, `partners/` is for the people who bring us subscribers, and
`web/` is the shop window: what we do, what it costs, how to see it working, and
how to earn from it.

It is a separate Netlify deployment with its own `netlify.toml` and
`_redirects`, exactly like `admin/` and `partners/`. Nothing is shared at
runtime, so a bad release in one cannot take down the others.

## The 20 September pass, part two: type, the story, and whose data is in the pictures

### Fraunces everywhere, Inter for everything else

Three front ends had three typographic systems. The website was on Georgia,
a system serif that is on the machine rather than chosen. The console and
the portal used Playfair Display for headings, **Source Serif 4 for body
text** and Jost for small caps, which meant every table cell and every form
label in the console was set in a serif on a screen somebody reads all day.

All three are now Fraunces for anything set in a serif and Inter for
everything else. Fraunces has an optical size axis, which is why it is
worth a web font over a system one here: the same family stays soft at 13px
on a card heading and tightens at 64px on a hero without anybody setting
`opsz`.

**The customer app is deliberately left alone.** It is one file with no
build step and no network dependency, and it has to open on a phone with no
signal. A web font is a request that can fail.

Two things went wrong and both are now gated:

- **The font link is in `<head>`, which `sync_web_shell` does not copy.**
  index.html got Fraunces, sync reported "14 already in step" because the
  header and footer had not changed, and every other page stayed on the old
  link. That does not look like an error, it looks like one page in a
  slightly different serif. `audit_web` section 2 now compares the font link
  across pages the same way it compares the header.
- **`--sans` and `--serif` landed in `body.light`.** The patch anchored on
  `--shadow`, which is declared in both `:root` and `body.light`, so the
  dark console rendered every word in Times New Roman. Glaring on screen,
  invisible in a diff. Both console gates now check the tokens are in
  `:root`.

### The screenshots were of Kayode's own studio

The product screenshots are captures of the running app through
`capture/shot.html`, which calls `demoLogin()`, which calls `loadExample()`.
**So the example studio IS the marketing imagery.** That seed was a studio
called LAYI owned by "Kay Ojomo" at hello@layiojomo.com, which is his own
label, so the site was showing his brand name, his first name in the
dashboard greeting and his studio's books. A visitor reading the dashboard
had fair reason to think the product was called LAYI.

Fixed at the source rather than in the images: the seed is now Adé Atelier,
owned by Adé Sowande, and the five screenshots were retaken from it.
`audit_web` section 10 reads the seed and fails if it goes back.

**The framing was measured, not chosen.** It had never been written down, so
a recapture in September guessed at it and relaid the app out. `capture/
measure.js` scans one row of pixels across the KPI band and reports where
each card starts and ends as a fraction of the image width; two captures
whose runs line up are the same layout. The settings that reproduce the
originals to within two pixels are in `web/img/README.txt` and in
`capture/recapture.js`, which takes all five in one command.

The thing worth remembering: **the window width IS the framing.** At 1010 the
six KPI cards on Orders wrap four and then two, which is what the originals
show. At 1396 they fit six across and the whole picture changes shape.

### Our story, in his words, with his face on it

Replaced wholesale with the text Kayode sent. The only liberty taken is the
byline: he wrote "Kayode Olayiwola Ojomo — FOUNDER" and also asked for no em
dashes, so it is set the way every other signature on this site is, with the
role on its own line.

The photograph is in the **hero**, not beside the text. He asked once before
for this page to be a full length read rather than a narrow column with
something next to it, and a portrait alongside the story would walk that
back. It is a real `<img>` with alt text rather than the `data-photo`
background slot the rest of the site uses: those are decoration and degrade
to a gradient, and a photograph of the person telling you the story is
content.

### One referral programme

`referrals.html` is **deleted**. It described a second scheme giving a free
month each to a customer and the customer they sent, and there is one
programme now: every business gets a code on its first day and every code
pays the same 8%. Deleted rather than left redirecting, because a page that
says "this has moved" is a page somebody still finds in search two years
later, and this site already has that rule.

Fourteen footers were repointed, the sitemap entry removed, the Terms
paragraph rewritten (it still described the ORIGINAL first-payment model,
two programmes out of date), and `SITE.referral` taken out of config. The
gate now fails if any page offers a second scheme paying in free months.

## The 20 September pass: one FAQ, one rate, two new prices

Seven sections came off, two numbers changed, and a page was added. Worth
taking the changes in the order of how much they matter rather than the order
they were asked for.

### The FAQ was in three places, so it was in no place

About, Support and Partners had each grown their own question list. A reader
with a question had to guess which page had thought of it, and all three pages
were long because of it. The three lists are now `faq.html`, in three groups:
the software and your records, the first month, and the partner programme.

**Seventeen questions, not eighteen.** About asked "Do you take a cut of what
I sell?" and Pricing asks "Do you charge per order or take a percentage?",
which is the same question twice. Pricing keeps it, because somebody reading
prices should not have to leave the page to find out, and the FAQ does not
repeat it. That was the only overlap, and the build script fails loudly rather
than quietly deduplicating: a repeated question is a decision somebody should
make, not something a script should silently resolve.

Each page that lost its list gained a line pointing at the new one, and
Support gained a closing band so the page does not end on a form.

### The comparison table came out of its drawer

It was inside a `<details>` that said "Open the full feature comparison, 30
rows", and it sat three sections below the plan cards, under a stat strip and
a four card argument. Both were the same mistake: a reader who has just looked
at three cards wants the row that tells them which one they are, and was being
asked to scroll past two arguments and then click to see it.

It is now open, directly under the cards. The gate checks both halves — that
no `<details class="disclose">` survives on that page, and that the table
appears in the source before the VAT note does — because "move it up" and
"open it" are two changes and only one of them is visible in a diff.

### "Neither of the two fit?" is what the Bespoke card says now

It was a band of its own a screen below the Bespoke card, describing Bespoke
in different words. The check that used to look for `callout-row` now looks
inside the Bespoke card for the same invitation, so the gate follows the
content rather than the markup.

### What was simply deleted

- **"The loop that closes itself"** from the home page. Three cards restating
  the trade tiles and the hero in different words.
- **"Try it before you decide anything"** from Pricing. The third time that
  page asked for the same call, and the last thing before the footer.
- **The tier ladder and the milestone bonuses** from Partners, because the
  programme no longer has either.

### Two prices and four limits

Basic 27,000 → **20,000**. Pro 65,000 → **49,000**. Yearly is still eleven
months for twelve and is still worked out rather than typed, so 220,000 and
539,000 follow from the monthly figures and cannot drift from them.

The limits were agreed earlier and had never been applied anywhere: Basic is
1 studio and **5** logins, Pro is **5** studios and **50** logins. Pro used to
say unlimited team logins. That is the one change here that takes something
away from a promise already made, so it is a number in every place a customer
can read rather than a softer form of words.

The other five currencies were re-seeded at the same ratio. They are still
seeds and still Kayode’s to set properly: a price for a market is a decision
about that market, not arithmetic on a rate.

### The currency picker opens on Nigeria

It used to guess from the browser’s time zone and language. Naira is what this
is really sold at and what every other price on the page is worked out from,
so the page opens saying so, and the picker is one click away. `guessCcy` and
the two lookup tables it read are **deleted rather than left unreachable**. To
put the guess back: restore `currencyByZone` and `currencyByRegion` in
`config.js`, restore `guessCcy` in `site.js`, and change one line to
`remembered() || guessCcy()`.

### And a bug in sync_web_shell that only bit when it rewrote a header

Every page failed section 2 at once with "carries the same header as every
other page", which reads like the header changed. What changed was two bytes:
the sync wrote `'\n\n'` between the header and `<main>` into files that are
CRLF throughout, and the gate compares that whitespace because it is inside
the slice. It now writes whatever newline the page it is editing already uses.

It is invisible in an editor and invisible in a diff that normalises newlines,
which is the whole reason it is worth a paragraph.

## Two rules the Multi branches shot re-learned

**Outcomes, not mechanisms.** The first two attempts at that screenshot were
the branch report and then the Settings branches editor. Kayode rejected the
second on sight: "its giving away our features to developers to copy". He is
right, and it is already the rule. A configuration screen shows how the
feature is built, which is the half worth keeping, and shows a customer
nothing about what they get, which is the half worth publishing. If a
screenshot is of a settings page, it is the wrong screenshot.

**Keep the red.** Asked whether to hide an outlet that was losing money:
"keep everything, they want to see loses too not just gains/profits." So the
shot carries 2,920,000 outstanding and two overdue jobs, and nothing is
cropped to flatter. A dashboard that is all green reads as a mock-up. Seeing
which outlet is behind is the thing being sold.

Worth separating the two, because they pull in opposite directions and both
are right: **hide how it works, show what it finds.**

The capture itself is the dashboard with `toggleSidebar` called and the
remaining icon rail cropped off, over all time. Prototypes were built first
and picked from, which is what saved the two wrong ones from shipping.

## A sixth area, and two numbers that were not true

The "Inside the product" section came off the home page on 19 September and
its two cards became a sixth product area, **Multi branches**. Both cards
were about the same thing, that the app changes shape with the business, by
size and by trade. That is a product area rather than a home page aside. The
two "more" links went with the move: on the home page they pointed at the
product page, and inside the product page they would point at themselves.

Removing the section broke the product page's Back link, which pointed at
`index.html#product`. Its fallback is `index.html` now. The gate caught that
one on the next run, which is what it is for.

### The proof strip, checked rather than believed

Kayode asked whether the numbers add up. Two of the four did not.

| Claim | Verdict |
| --- | --- |
| 22 screens | **True.** 22 nav items in the app. |
| 6 staff roles | **False.** The app ships five. |
| 0 bars of signal | **True.** localStorage first, `sw.js` present. |
| 100% exportable | **False.** The export writes 20 of the 21 keys the app syncs. |

**The roles number was quoting the demo, not the product.** `defaultRoles()`
returns owner, manager, client relations, tailor and accountant. The sixth is
a custom role the example data creates, and the comment beside it in the app
says exactly why: "a custom role this demo business created, proves the app
adapts to roles beyond the built-in five." The strip now says five built in,
and that you can add your own, which is the better claim anyway.

**The gate could never have caught it.** The check was
`/six roles|Six roles|6<\/div>/` against the home page: a number asserting
itself. The site said six, the check looked for six, the app had five. It
reads `defaultRoles()` out of the app now, the way the screen count already
did. Any number on this site that is a fact about the product should be read
from the product, and a check that hardcodes the same literal the page does
is not a check.

**The export claim is an app bug, not a copy problem.** `exportData()` writes
20 keys; `STATE_KEYS` syncs 21. `orders_done`, `planner` and `shifts` are
real data that reach the cloud and are missing from the downloaded file, so
somebody who exports and reinstalls loses them. The copy has been softened to
what the export actually does, and the app side is logged in `OUTSTANDING.md`.
Once that is fixed the cell can go back to a percentage.

## Products is a page, not a menu

Kayode, 19 September: "no more products dropdown, just products, then it
opens up all the products list on the page, then selecting each opens each
product." The dropdown is gone, the list is back on the product page, and
Products in the header is a plain link again.

The list is load bearing in a way it was not before it was removed. It is now
the only way to change area, at every width, so a page that ships without it
is a page stranded on whichever area happens to be open. The gate refuses
that: the list and the panes have to be the same five, with the same names,
and exactly one of each has to ship open.

**The order on the page changed with it.** Back, then the list, then the
heading that names the area you picked, then the pane. The heading stopped
being a hero above the controls and became the title of what the controls
just opened, which is what it always was.

### Landing at the top, and why the obvious fix does not work

Picking an area used to drop you into the middle of the page with the heading
already scrolled past and the sticky header over the first line. Three routes
reach the same action and all three were different:

- **A link from another page.** The browser scrolls to the fragment.
- **A hash change on the page you are on.** Nothing navigates, so nothing
  scrolls unless the script does it.
- **A click on the list.** `selectTab` plus `replaceState`, which fires no
  hashchange at all, so that route missed the fix written for the second one.

**The first one cannot be fixed by scrolling.** Measured: arriving at
`features.html#inventory` landed at 278 and stayed. The panes are
`display:none` while the page is parsed, so Chrome finds no fragment target
then. The script reveals the right pane on `DOMContentLoaded`, Chrome notices
the target has appeared, and scrolls to it **after** everything the script has
just done. Scrolling to the top on load, and again in the next frame, both
lose that race. Anything that wins it wins it on one machine.

So the target moved instead. The five ids came off the panes and onto empty
markers at the top of the page. The browser still finds the fragment, and
scrolling to it is scrolling to the top, because that is where it is now. No
timing, nothing to lose a race to. The gate asserts both halves: the markers
are there, and no pane carries an id of its own.

### What went with the dropdown

Fifty one lines of stylesheet, forty two of script, and the four drawer
sub-item rules. Two attempts at removing them overshot, both the same way:
the script block was cut at the first `document.addEventListener('click'`,
which occurs **inside** the block being removed, and the stylesheet rule was
cut by filtering lines that named it, which left the closing brace of a
three line rule behind. Cut a block by its first and last line number, not by
searching for a string that might also be inside it.

`sync_web_shell.js` needed no change: it reads the header out of
`index.html` rather than holding its own copy, so editing the original was
enough to carry the new nav to all fourteen pages.

## Running it

```bash
npx --yes http-server web -p 3003 -c-1
```

Or use the **Website** entry in `.claude/launch.json`.

## The pages

| Page | What it is for |
| --- | --- |
| `index.html` | Hero, the eight kinds of business with their detail, the product and the closing call |
| `features.html` | Six product areas behind tabs, deep linkable as `#money` and the rest |
| `pricing.html` | Plans, the comparison table, and the billing questions |
| `book.html` | The booking form, which is what "Book a demo" opens |
| `partners.html` | The one referral programme: 8%, who is in it, and the form for outside partners |
| `about.html` | Why it exists and what we will not compromise on |
| `contact.html` | Help and contact in one: channels and the form |
| `faq.html` | Every question anybody asks, in one place, in three groups |
| `privacy.html` · `terms.html` | Plain language, and both need a lawyer's eye |
| `thanks.html` | Where every form lands |
| `404.html` | Netlify serves this for anything that is not a page |

It is a real multi page site rather than a single page app, because search
engines and a phone on a bad line both do better with plain HTML. There is
deliberately **no service worker**: a marketing page that serves a stale price
is worse than one that takes a second longer.

## What the navigation says

Two labels changed on 2026-08-27. **Product became Features**, which is what the
page is and what the file was always called, and **Help became Support**, which
is the word people go looking for. The page keeps its address: `contact.html`
is where support and contact were merged into one page, and `_redirects`
already sent `/support` there.

The nav is now Home, Products, Pricing, Partners, Our story, Support, with Book
a demo as the button.

**Features became Products on 2026-09-17**, and it opens a menu. That menu
listed all ten feature areas, which was a map of the app; it lists five as of
the disclosure pass below.

## Ten feature areas, not six

> **Superseded on 2026-09-18.** There are five, and three screenshots rather
> than eight. See "The disclosure pass" below for what was folded into what and
> why. The rest of this section is still worth reading: it is how four panes
> came to show the wrong screen for a fortnight.

**Four of them showed the wrong screen for two weeks.** When these panes were
written there was no capture of the calendar, logistics, marketing or audit
view, so each borrowed a picture from a pane that had one: the calendar pane
showed the dashboard, delivery showed orders, marketing showed customers,
records showed payroll. Kayode spotted it on 2026-09-11. All four have their
own capture now.

**They were also using the wrong component.** `.pic-panel` with `data-photo`
is the photograph component: it lays a navy wash over the image (`.3` to `.42`
alpha) so white text can sit on top. Over a screenshot that wash only dims the
product, which is why those four looked flat beside the other six. They are
plain `<img class="shot">` now, the same as every other pane, and there are no
`.pic-panel` elements left on the page.

**The rule that follows: a pane needs a capture of its own view.** Reusing a
neighbour's picture passes every check the gate makes, because the file
exists, it is referenced, it has an alt and it has dimensions. Nothing can
tell the gate that the picture is of the wrong screen. That one is on whoever
adds the pane.

The Product page showed six areas while the app has twenty two screens, so
whole parts of it went unmentioned. Four were added, and two things moved to
where they belonged:

- **Calendar and fittings**, which was not on the site at all
- **Delivery and dispatch**: couriers, who signed, courier performance
- **Repeat business**: the segments the app works out (top tier, owing a
  balance, new this month, not back in ninety days) and the message it writes
- **Records and control**: the six roles, the searchable audit trail, and the
  announcement and task board

Roles and the audit trail used to sit inside "Phone and offline", which was the
wrong home for them. They moved to Records and control, and the offline pane
got two facts that are actually about being offline.

**Every claim was read out of `site/layi_dashboard.html` before it was
written**, and one of them nearly went in wrong. Marketing does not send
anything: `copyNewsletter()` puts the message on the clipboard for you to paste
into your own email or WhatsApp broadcast. The roadmap band on the same page
already says automatic sending is not built, so a claim that it sends would
have contradicted the page it sits on. The copy says the app picks the people
and writes the message, and that sending is still yours.

## The decongestion pass

Kayode, 2026-09-17: the pages were carrying too much. Seven changes, and the
shape of every one of them is the same, which is that something was being
said in two places or being said to somebody who had not asked.

**The four claims left the hero and became a moving strip above the header.**
They were a block of eight lines under the buttons, competing with the thing
the hero is for. As a ticker they are a texture rather than a paragraph. Three
things about it are load bearing:

- It sits in normal flow ABOVE the sticky header, so it scrolls away. That
  breaks the phone drawer, which is positioned at the header height and would
  cover the top of the header while the strip is still on screen. The fix is
  one line, `body.menu-open .ticker{display:none}`, and it is safe because
  with the menu open the page cannot scroll anyway.
- The claims are written twice and the track slides by half its own width, so
  the copy on screen when it snaps back is identical to the one a frame
  earlier. The duplicate is `aria-hidden`, so a screen reader hears them once.
- Under `prefers-reduced-motion` it stops and the duplicate goes with it. A
  strip that moves on its own is exactly what that setting is for.

**What else came off.** The lede under the trade tiles, because the tiles say
it. The city and opening hours from the footer. The "When we answer" card and
the whole five step getting started section from Support, because neither is
support: somebody lands there because something is wrong, and both were making
them scroll past help to find help. Support went from 6.0 screens to 4.7.

**The "Inside the product" paragraph moved to Features**, where it replaced the
screen count line. It was making an argument about what the software is for,
which belongs on the page about the software.

**The booking page lost everything that competes with the form**: the
walkthrough section and its screenshot, the three reassurance bullets, and
four of the nine fields. City, team size, how they keep records and best time
are all things we ask on the call, and each one was a reason to close the tab.
Four required fields and one optional box now. It went from 4.3 screens to
**2.6**. The four fields are easy to put back if we miss them.

That removal orphaned `customers.png` and `finance.png`, which were only on
the walkthrough. Deleted rather than rehomed, because the point of the pass is
fewer things on a page. It also broke a gate check that compared the position
of the form against the first screenshot: with no screenshots, `indexOf`
returns -1 and the form is "after" it. That check now treats a page with no
screenshots as a pass.

**The story on About is one column now, with the naming note underneath.** It
was a half width column with the note in a box beside it, which made a long
read narrower than it needed to be. Note that "full screen length" cannot mean
edge to edge for body copy: a line across this 1680px container is about two
hundred characters and the eye loses its place coming back to the left. It is
set at 820px and centred, which is what a long article is set at. **This is the
one page that got longer**, 5.3 screens to 6.0, because what used to sit side
by side is now stacked. That is the trade the change asks for.

## The disclosure pass

Kayode, 2026-09-18: *"as much as we want to sell, we also dont wamt to give too
much information that leaks all our key features to the public or for other
developers to steal."*

He was right, and the worst of it was not the trade tiles he pointed at. It was
`features.html`, which had become a specification. Four cuts came out of that
conversation. Each one removes something an ordinary marketing instinct will try
to put straight back, so the reasoning is written down here rather than left in
a commit message.

**1. The roadmap is gone.** `features.html` carried a section called "Built and
shipping soon": three cards naming collecting payment in the app, automatic
WhatsApp, and orders dropping in from a storefront, each marked as not finished.
It was written for honesty and it was honest. It was also a public list of where
we are weakest and what to beat us to, on the page a competitor reads first, and
it told a buyer what is missing in the same breath as what is there.

`audit_web.js` used to **insist** that section stayed. That gate now runs the
other way round. `NOT_BUILT_YET` holds the claim phrases, and any page that sells
one of those three things as built fails the build. The honesty it protected is
enforced from the other side now. Read the comment above the list before adding
to it: "we never take a card" on the pricing page is true and has to keep
passing, which is why "take payment" and "card payment" were tried and removed.

**2. Five of the nine screenshots were deleted.** A 1700px capture of a working
screen is the fastest thing on this site to copy. It hands over the layout, the
column set and what sits next to what, in a way prose never does. `calendar`,
`delivery`, `marketing`, `payroll` and `records` are gone; `dash`, `orders`,
`production`, `stock` and `phone` stay, which is still enough to prove the app
is real.

They were **deleted from `web/img/screens`, not merely unlinked**. A file left
in a published folder is fetchable by anyone who guesses its name, so removing
the `<img>` tag alone would have changed nothing. The gate's minimum came down
from eight tags to five, deliberately, with the reason in the comment.

**3. Mechanism became outcome.** The old page wrote out the profit formula, the
three ways an owner's draw can be set, the payroll model, the four customer
groups the app works out and the ninety day threshold on one of them, the count
of roles, the six importers and the fact that running one twice is safe. Those
are design decisions that took months. Each is now a result instead: "what a job
actually made, after everything it cost you" tells a studio exactly what it
needs and a builder nothing at all.

**4. Ten areas became five, and eight trade panels became eight tiles.** The
Products menu was a map of the app. The home page's tiles each opened a panel of
four detail lines. Both are compressed. The tile carries three short highlights
and opens nothing.

What it cost and what it saved, measured rather than guessed:

| | Before | After |
|---|---|---|
| `features.html` words | 1,952 | 1,153 |
| `index.html` words | 1,888 | 1,273 |
| Trades section, 1280 | 1,032px | 744px |
| Trades section, 390 | 801px | 460px |
| `features.html` page, 1280 | 2,734px | 2,031px |
| `features.html` page, 390 | 3,907px | 2,748px |
| Screenshot files published | 10 | 5 |
| Products menu items | 10 | 5 |

### Eight tiles that stack into a swipe, not a column

The obvious build was eight cards two up on a phone. It was measured before it
was believed, and it came out at **1247px**, which is longer than the 801px of
tiles and panel it replaced. Making a page shorter by adding eight cards to it
only works on a laptop.

So the row keeps the horizontal swipe it already had below 900px, and the tile
grows only enough to hold its three lines: 196px wide, a 92px picture, 11.5px
text. That is 460px on a 390 phone. The grid is four across above 900.

**Check the phone before the laptop on anything in `web/`.** Kayode asked for
this as a standing rule on the same day, and this section is why: the two
viewports disagreed about whether the change was an improvement at all.

### Ids, because thirteen footers point at them

Thirteen pages carry a footer linking to `index.html#tailors` and five siblings.
The tiles kept every id, so nothing broke. `features.html` lost five of its ten,
and the two the footer used moved with it: `#team` became `#money` in the
footer, in the Products menu and in the "How branches work" link on the home
page. `audit_web.js` catches a dead anchor, and did catch that one.


## Where a review lands

Kayode, 19 September 2026, on my advice to wait for three real reviews before
building anywhere to put them: *"we wait till october for reviews because it
will be a problem when its time, reviews wont get anywhere to fall so it hangs
in the cloud."* And then: *"i mean we cant wait."*

He was right and the advice was wrong. The first studios open accounts in
October. The first good thing one of them says about us would have arrived with
nowhere to go, and the work of building somewhere would have been competing
with everything else that happens in a launch month.

So the destination exists now and is empty.

### One source, six copies, and a single command

`web/reviews.html` is the only file a review is ever typed into, between
`<!-- REVIEWS START -->` and `<!-- REVIEWS END -->`. Then:

```
node sync_reviews.js
node audit_web.js
```

`sync_reviews.js` copies the first three cards onto the home page and the
pricing page, un-hides both of those sections, takes the `noindex` off
`reviews.html`, adds it to `sitemap.xml`, puts a link in the footer, reruns
`sync_web_shell.js` so all thirteen pages carry it, and drops the redirect that
currently sends `/reviews` to the home page. Run it on an empty `reviews.html`
and it does all six in reverse, which is how the site sits today.

### Why the gate matters more than the script

Seven things have to agree about whether there are any reviews. The script
flips all seven. The gate fails the build if they ever disagree.

That is not belt and braces. Switching this on is the sort of job that happens
at eleven at night when the first good quote comes in, and the failure is not a
crash: it is a live page with a heading and nothing under it, or a review
sitting on `reviews.html` that nobody can reach because the redirect is still
in place. Both would sit there for weeks.

It was tested by doing it. A card went in, the switch flipped, every one of the
seven was checked by hand and the page was looked at in a browser at 1280 and
390, then the card came out and the site returned to exactly the shape it is
deployed in. Nine mutants, one per way of half-switching it, and all nine were
caught.

### The redirect needs an exclamation mark

It shipped once without one. Netlify applies a redirect only where no file
matches the path, and `reviews.html` is a real file, so
`/reviews /index.html 302` was accepted, deployed and quietly ignored. The
empty page was live at `thelabelboard.com/reviews` until the post-deploy fetch
went looking for it. `302!` forces the rule over the file.

The gate demands the mark now, but the real lesson is about the release and
not the rule. **No static gate can prove what Netlify will do with a
redirect.** Fetching the url after the deploy is what caught this, and it is
the last step of a release rather than a formality.

The block in `_redirects` also sits between markers now. The first version of
`sync_reviews.js` removed it by matching its exact text, so the day the rule
was corrected the old one could not be recognised and the file ended up
carrying both.

### The card

Initials rather than a photograph. A studio owner should not have to send us a
picture before we can quote them, and a stock face on a real person's words is
a lie. Five stars are always drawn; the unlit ones carry `class="off"`, so the
count is always five and the gate checks that, along with the `aria-label` that
tells a screen reader the rating.

The grid is `auto-fit` with a centred track list rather than three fixed
columns, because the first month there will be one review and then two, and
three fixed columns would put a single card in the left third with a hole beside
it. Below 900px it is the same swipe row as the trade tiles, for the same
measured reason.

### The part that is not built, and blocks all of it

**Nothing anywhere records that a studio said we may quote them.**

The collection half already exists and is better than it looks:
`public.feedback` has taken `kind = 'review'` since August, with a 1 to 5
`rating`, a title, a body and a contact, and the console reads it. The app's
feedback form offers it as "Something you like" with the hint "What is working
well. We may ask if we can quote you."

We may **ask**. Asking is a conversation, and the answer lives in a WhatsApp
thread. Publishing a studio's name and words off the back of that is not
something to do, and a year from now nobody will be able to point at the
permission.

What that needs, and it is in three other apps so it is three other chats:

- a migration adding `may_quote`, `quote_name` and `quote_role` to
  `public.feedback`, so the permission is a column and not a memory
- the app's review form gaining the question, only on `kind = 'review'`, with
  the name and the label they want printed
- the console showing the flag, and generating the finished
  `<article class="rev">` so the October job really is paste and run

Until that exists, this section stays empty however good the feedback is.

## The Products menu, which looked right and did nothing

Kayode, 2026-09-19: *"this dropdown should be an actual dropdown that works not
just a pretend on cos right now it does nothing, clicking product shoulndnt open
products but clicking each items in the dropdown list should open what the
clicked button says, also make the list a vertical one."*

It never reached the live site: the batch it came in is still queued, and he
found it in the local preview.

Two separate faults. Fixing either one alone leaves it broken, which is why
`audit_web.js` now has a check for each.

**The hash never fired twice.** Every item in the menu points at
`features.html#something`. From `features.html` itself that is a hash change on
a document the browser already has open: nothing reloads, so the code that
opens the right area, which ran once in the load handler, never ran again. The
pane stayed where it was and the click looked dead. `openFromHash` is now a
named function called on load **and** on `hashchange`. On a click it also
scrolls the tab strip into view, because the pane was hidden when the browser
decided where to scroll, found nothing, and stayed put.

**The trigger was a link.** Clicking Products went to `features.html` instead of
opening the list. It is still `<a href="features.html">` in the markup, which is
what a crawler and a browser with no script need, and the script turns it into a
toggle: click opens and closes, Escape closes and returns focus, a click
anywhere else closes, ArrowDown opens and moves into the list, and choosing an
item closes the menu behind it. Hover still opens it on a fine cursor, in CSS,
untouched. The nav does not exist below 1000px, so none of this is ever on a
touch screen where a stuck `:hover` would leave the panel hanging.

The trigger is found by `data-drop`, and the header is copied into twelve pages
by `sync_web_shell.js`, so the gate checks every page rather than `index.html`
alone. A page that lost the attribute in a bad sync would be a menu that does
nothing on that page only, which is exactly the kind of thing nobody notices.

**The list is one column.** Five items in two columns read as a panel of
thumbnails with an odd one hanging, rather than as a menu.

## The phone type pass

Kayode, same day: *"strip down all pages and tabs sizes for mobile view
especially font sizes."*

Measured at 390 first, because the numbers say more than the impression did:

- the product page lede was **17px and 163px tall**, seven lines, while the body
  text below it was 13.5
- a pane paragraph was **16px**, so the supporting sentence was larger than the
  page's own body text
- a card heading was **20px** on top of 14px card text, a magazine proportion on
  a screen 390 wide
- the two long reads, `privacy` and `terms`, ran entirely at **16px** because
  `.prose` never set a size and inherited the page default

The phone was reading a laptop's type scale with nothing taken off it.

The new block is at the **end** of the stylesheet and has to stay there. The
retuned scale further up sets `h1`, `h2`, `.lede` and the rest unscoped, so a
phone block placed before it loses on source order at equal specificity and
silently does nothing. That has now happened twice on this stylesheet.

Where a rule in that block looks over-specific it is not decoration. `.card h3`
has to name the card because a bare `h3` loses to it. `.features-tabs .tab` has
to name the strip for the same reason. `.faq summary`, `.banner h4`,
`.callout-row h4`, `.step h4`, `.prose h2`, `.sig` and `.tier .rt` are each set
by name somewhere above and each had to be named again.

What it saved, every page measured at 390 with the block on and then deleted
from the CSSOM in the same run:

| Page | Before | After | Saved |
|---|---|---|---|
| `partners` | 4,679 | 4,245 | 434px |
| `about` | 3,320 | 2,952 | 368px |
| `referrals` | 4,404 | 4,099 | 305px |
| `features` | 2,748 | 2,518 | 230px |
| `pricing` | 5,231 | 5,025 | 206px |
| `privacy` | 2,234 | 2,074 | 160px |
| `index` | 3,435 | 3,278 | 157px |
| `thanks` | 1,508 | 1,366 | 142px |
| `terms` | 2,075 | 1,935 | 140px |
| `contact` | 2,826 | 2,693 | 133px |
| `book` | 1,936 | 1,878 | 58px |
| `waitlist` | 1,916 | 1,908 | 8px |

2,341px across the twelve, and nothing above 16px left on a phone except
headings, the prices, the countdown digits, the partner figures and the
signature on the story page.

## The offline area opens out

The "Built for a real Lagos day" card came off at Kayode's request and the
"It does not stop when the network does" area now runs the full width of the
page, with its five lines in two columns above 680px and one below. It uses
`.split-list`, which the partners page already had.


## Two trims to the home page

**The trade tiles are centred.** A grid cannot centre an orphan row: with four
fixed tracks, a last row of three sits against the left and leaves a hole on
the right, which is what seven tiles were doing. Flex wrap can, so the strip is
flex now, capped at 1124px so exactly four fit a line, with the tiles growing
to fill a line but never past 272px, which is the size the photographs were cut
for. The basis matters more than it looks: at 200px a fifth tile fitted the
line and the row became five. It is 240px, which is the only range where four
fit and five do not.

**The finance screenshot came out of "Inside the product".** It was the second
big product screenshot on one page, a few hundred pixels below the one in the
hero, and it read as repetition rather than proof. The two cards sit side by
side instead. finance.png is still used on the booking page, so nothing was
orphaned, and .showcase, .stack and .shot-cap went with it. The home page came
down from 5.6 screens to 5.3.

## Haberdashery came off, and it should never have been on

Taken off the site entirely on 2026-08-27. This was not a change of mind about
a market. **It was never a business type the app offers.**

`DEFAULT_ACTIVITIES` in the app is what decides what a shop can be set up as,
and it holds five: bespoke, footwear, leather, ready to wear and fabrics.
Haberdashery appears in the app only as a line of demo data, an expense note on
an Ibadan stock purchase. So the site carried a tile, a photograph and a panel
of promises for a setup a customer could not have chosen, on the page whose
whole job is to get them to book a demo.

The gate had already half noticed. It reads the five out of the app and asserts
the site names each of them, and a comment in there records that the count
used to come to five by accident, because the list it read then was a legacy
one that never contained footwear or leather at all.

**The check that would have caught it runs the other way now.** Naming every
trade the app has was never enough; the site also has to offer no trade the app
lacks. That, plus the picture being gone, is asserted by name.

What went: the tile, the panel, the photograph, the card on the Features page,
the footer link, and two lines of copy that listed it among the trades. The
strip is seven tiles now rather than eight, so the second row is three rather
than four. **The counts in the gate are derived rather than written down**, so
this removal cost four failing checks that were only ever saying "the number I
was written with", and they will not need editing again the next time a trade
comes or goes.

## Four ways to pay us, and what each one is missing

The three plans got three changes on 2026-08-27, all Kayode’s call.

**Premium stopped saying "Talk to us first."** A conversation wall on the most
expensive tier is backwards: the buyer most ready to spend is the one being
made to wait. It has a trial like the others now, seven days rather than
fourteen. Both numbers live in config.js as trialDays and trialDaysPremium, and
the gate checks the page takes them from there rather than having them typed
in, so they cannot drift apart.

**A fourth offer, for the shops none of the three fit**: a group under one
owner, an association buying for its members, a business that needs something
built around it. It is deliberately **not a fourth column**. It has no price
and no self serve sign up, so in the grid it would read as the top of a ladder
the other three are on, and on a phone a fourth full card costs about four
tenths of a screen where a band costs one. The gate asserts it stays a band.

**Every plan below the top says what it does not include.** A list of only good
news makes three tiers look interchangeable, and the gap is what makes somebody
move up. Two rules hold it: two to four items each and never more, because a
long list of crosses makes the cheap plan look broken rather than making the
dear one look worth it; and **nothing crossed off Premium**, because there is
nothing above it to be missing and crosses there would read as the product
being unfinished. The thirty row table still does the exhaustive version.

One detail that cost a moment: the first crossed item carries the dashed
divider above the group and its mark is absolutely positioned, so it floated in
the padding above its own text until li:not(.no)+li.no::before pushed it down
with the words.

## Six currencies, and why none of them is converted

Kayode's point: somebody outside Nigeria who wants this should not have to work
out what the naira price means to them. The pricing page now shows the price in
the reader's own currency. Kayode's six lead markets: naira, dollars, pounds,
Canadian dollars, euro and cedi.

**Nothing is converted in the browser and no rate is fetched.** Every price is
set, per currency, in `config.js`. A live rate would change what the page says
without anybody having decided it, and the naira has moved enough in a week to
quote the same shop two different numbers on two days. Yearly is the only thing
worked out rather than typed, at ten months for twelve, so it can never
disagree with the monthly price beside it.

**Naira is the real one.** It is the price the admin console bills, the gate
checks the two against each other, and the structured data quotes it alone,
because a search engine should be told one price rather than seven. The other
five were seeded by converting at roughly 1,530 to the dollar in August 2026 and
rounding to something clean. **They are Kayode's to set properly**, and they say
so in the file: a market price is a decision about that market, not arithmetic.

**The first guess comes from the browser, never from an IP lookup.** The time
zone, then the language region, then naira. Canada needs its zones named one by
one, because every Canadian time zone is an America/ one and the last resort
sends anything America/ to dollars. An IP lookup would mean calling a
third party on every page load and telling them who is reading our pricing, and
adding a dependency to a site that has none, all for a guess that the picker
sitting right there corrects in one click. The choice is remembered under
`tlb_ccy`, which is ours; the app's `layi_*` keys are never touched.

**With no JavaScript the page is still correct.** The naira price is written
into the HTML as plain text and everything above only ever replaces it. The
picker is built by the script rather than written into the page, because a
control that cannot do anything is worse than no control.

The gate holds all of it: every market has a price for every plan, the plans go
up in price in every currency, the naira prices match the console, the page
still carries naira before any script runs, and nothing anywhere fetches a rate
or a location.

## Making the price defensible

Kayode's read, and it was right: the pricing page said what it cost and how it
was billed but never why it was worth it, so the reader had nothing to weigh
29,000 a month against.

Two things went on, both arithmetic rather than adjectives:

- a compact strip of the four facts that make the price fair: nothing taken
  from what you sell, unlimited orders and customers and invoices, two months
  free on yearly, and the free trial
- four cards putting the fee next to something the reader already knows the
  size of: one forgotten balance, what a percentage of sales would cost at
  their own turnover, what hiring the hand to do it costs, and what trying it
  costs

**No figure in there is a claim about anybody else.** "A percentage" is a shape
of pricing, not a company, and the arithmetic is done on a number the reader
supplies. Keep it that way.

## The trades are the home page

> **Partly superseded on 2026-09-18.** The tiles are still the home page and
> still carry every id. The panels that opened under them are gone, and with
> them the tile as a control. See "The disclosure pass" below.

The Solutions page is gone. Kayode's call, and the reasoning is right: the seven
trades were already on the home page as tiles, so a whole separate page and a
navigation tab to say more about them was a page and a tab to get through for
something the reader had already found.

Its seven panes moved onto the home page under the tiles. **The tile is the
control now**: point at one with a cursor, tap one on a phone, and its panel
opens in place. An eighth was added at the same time, multi location, which is
the shape of business the app is most differentiated on and which also makes
the grid divide evenly. Seven always left one tile on its own at the end of a
row; eight is two rows of four.

**Hover is only half an answer**, and getting that wrong is the trap here. A
phone has no cursor, and this site is read on a phone first. So a tile is a
real control that opens on click or tap, which the existing click delegate
already did for anything carrying `data-tab`. Hover is an extra, added only
where `(hover:hover) and (pointer:fine)` matches. Without that media query a
touch screen reports a hover on the tap that precedes the click, so a tap would
open one panel on the hover and a different one on the click. There is a 110ms
delay so a cursor dragged across the row does not flip through all eight, and
nothing closes on leaving, so the panel you last looked at stays where it is.

**The ids came across unchanged**, so `index.html#shoes` opens the shoe maker's
panel exactly as `solutions.html#shoes` did, every footer link still lands on
its trade, and `_redirects` sends the old page and its address to the strip.

Three things this pass broke and the fixes, all worth knowing:

- **`selectTab` only moved things with class `.tab`.** Two different controls
  open panes now, the pill tabs and the photograph tiles, so a tile's panel
  opened while its highlight stayed behind on the previous one. It selects on
  the attribute rather than the class now, which is what the click delegate
  already did and for the same reason.
- **A rule outside a media query silently beat the ones inside it.**
  `.industry .pic{height:164px}` sat in the sharpness block near the end of the
  file, after the phone and tablet breakpoints and with the same specificity,
  so source order won and a phone got a 164px picture in a 134px swipe tile.
  It was a duplicate of a rule at the top. Nothing in that block may set a
  height on a tile picture, and the comment there now says so.
- **A panel can pass every check and still be in the wrong place.** The eighth
  one first landed inside the hero, because the anchor the patch searched for
  matched an earlier closing tag. It answered its tile, it carried its id, and
  every check passed while it rendered in the middle of the hero. The gate now
  asserts all eight sit inside the detail block, and that none of them outranks
  the heading of the section they are in.

## The way back from a deep link

The seven tiles on the home page drop you into one pane on Solutions, and there
was nothing at the far end to get you back. Solutions and Product now carry a
back link above their tabs.

It has a real `href` at the section it came from (`index.html#product`, marked
`.anchor` so the sticky header does not sit on top of it). That is what happens
with no JavaScript, and it is the right destination for somebody who arrived
from the navigation instead of a link. Solutions had one of these too, at
`index.html#trades`; it went with the page, because the trades no longer take
you anywhere to come back from.

When `document.referrer` says they came from our own site, `site.js` turns the
click into `history.back()` instead. That is the only thing that returns them
to **the exact place on the page they left** rather than the top of the
section, which is the whole point. Measured: leave the home page at scrollY
845, come back, land on 845.

This works because tab switching never pushes a history entry. `selectTab` does
not touch history and the jump links use `replaceState`, so one `history.back()`
always leaves the page rather than undoing a tab change. If anybody ever
changes those to `pushState`, the back link quietly stops working.

## The footer

Every link in it always resolved, but it read like a placeholder, because
three of its twelve links went to the same contact page and there was nothing
in it you could not already reach from the header. It now carries the thing a
footer is actually for: **how to reach a person.** Five columns, the last of
them WhatsApp, phone, email, Instagram, the city and the working hours.

Those details come out of `config.js` through `data-cfg`, so they are written
once, and the pages carry the current value as plain text for anyone with no
JavaScript. **They are still placeholders** until the real address and number
replace them, in that one file.

Two things this cost, both worth knowing:

- **A fifth column doubled the footer's height on a phone**, because four link
  columns at two across is two rows where there was one, and the footer repeats
  on every page. It pushed Help and Partners over six screens. Fixed by putting
  the three link columns back on one row and laying the contact block full
  width underneath as a wrapped line, which is how you want to read a phone
  number on a phone anyway. Nothing is hidden.
- **The word "boutique" used to live only in a footer link.** The gate checks
  the home page speaks to more than tailors by looking for it, so shortening
  that link failed the build. That was the gate being right: a trade we sell to
  should be named in the page's own copy, not in a footer label. It is in the
  "One system. Many workflows." card now.

## Prices live on one page

Kayode's call: pricing came off the home page and stays on the Pricing tab,
which is where somebody looking for it goes. What went with it:

- The three price rows and their `.minis` component, about 750 bytes of
  stylesheet that nothing else used.
- The priced structured data. Search engines expect the offers in the markup to
  be the offers a reader can see on that page, so the `SoftwareApplication`
  block with its three Naira prices moved to `pricing.html`. The
  `Organization` block stays on the home page, which is the right place for it.

The gate used to check that the home page and the pricing page agreed with each
other about every figure. It now checks something stronger: **no page except
`pricing.html` prints a price at all.** Two pages carrying the same number is
how one of them ends up stale, and the surest fix is to only ever have one.

## There is no self serve demo

Kayode's call on 2026-08-27: **nobody outside gets into the demo account.** The
site used to print the sign in details on a page called `demo.html` and invite
strangers to open the live app. That page is gone.

"Book a demo" now opens `book.html`, which is a form we receive. We reply, set
a session up with them, and onboard from there if they want to subscribe. The
form itself is unchanged, it is still the Netlify form named `demo`, so nothing
already wired up had to be renamed.

What went with the page:

- `demoUser` and `demoPass` are out of `config.js` entirely, not just off the
  page. The gate asserts the password string itself is nowhere in the site.
- Every "Open the live demo" button became "Book a demo". The seven trade panes
  on Solutions offer "See it set up for you" instead.
- The **Demo tab is off the navigation**. The header carries Product,
  Solutions, Pricing, Our story and Help, and the booking is the CTA button.
- `_redirects` sends `/demo` and `/demo.html` to `/book.html`, so anyone
  holding the old address still lands somewhere useful.

The screenshots stayed. They are not the demo, they are a picture of what the
call will walk through, and they are the reason someone books it.

## The design

Rebuilt 2026-08-27 against a reference Kayode brought: a darker navy ground,
gold, serif headlines over an Inter interface face, a plain tab header, and
photography of the trade beside the product itself.

- **The header is three columns**: wordmark in the left corner, tabs on the
  centre of the page, Log in and Book a demo on the right. The middle column
  is `auto` and the outer two are `1fr`, so the tabs land on the centre of the
  page rather than the centre of what is left over beside the wordmark.

  **Each item names its column** (`grid-column:1`, `2`, `3`). That is not
  decoration. Hiding the tabs below 1000px takes them out of the grid
  altogether, and without an explicit column the actions get auto placed into
  the middle track, which parks them beside the wordmark instead of at the
  right edge. It looked correct on a desktop and wrong on every tablet.

  On a phone the tabs and the Log in link are gone and the gold button comes
  off too: at 360px it has to share the row with the wordmark and the burger
  and wraps onto two lines. Every hero carries the same button, and so does the
  drawer the burger opens, so nothing is lost.
- **One theme, two grounds.** There is no light and dark switch any more. The
  page is dark navy by default, and any section can stand on the light ground
  by taking `class="on-light"`, which swaps the tokens for everything inside
  it. No component needs to know: they all read the same variables.

  The rhythm is deliberate rather than alternating for its own sake. **Dark**
  carries the hero, the product screens, the closing call and the footer.
  **Light** carries the parts people actually read: the trade strip, the plans,
  the steps, the forms, the privacy notice and the terms. A photograph on the
  light ground drops its dark wash, because it is no longer sitting under white
  text.

- **Tokens** live at the top of `web/css/site.css`, with the light ground under
  `.on-light` at the bottom. Dark: ground `#06101d`, panels `#0d1725`, hairline
  `#223149`, gold `#e0aa3f`. Light: cream `#f7f4ef`, ink `#0d1726`, and a deeper
  gold for anything that has to be legible as text rather than as a button.
  Headings are Georgia, which is already on the device, so the only web font is
  Inter.
- **The header is plain tabs**, no dropdowns: Product, Solutions, Pricing,
  Demo, Our story, Help, then Log in and the gold Book a demo. Dropdowns were
  removed on 2026-08-27 (a hover menu that also toggles on click reads as
  broken), and Support was merged into Contact the same day because the two
  meant the same thing to a visitor.
- **The product is drawn, not photographed.** The dashboard and the phone in the
  hero are HTML built from the same tokens (`.screen`, `.kpis`, `.rows`,
  `.phone`), so they stay sharp, they theme with the site, and they cost no
  bandwidth. The figures in them are the demo account's real figures, so
  somebody who opens the demo sees what the site showed them.

### Photography

The eight pictures are Kayode's own, generated to the brand on 2026-08-27. They
replaced a set of Pexels stock, which had replaced a set cut out of his
reference board that went blurry the moment a tile was stretched.

That history is written into the stylesheet, and it is the thing to understand
before touching the treatment. The stock set came from a dozen different rooms
and needed a heavy hand to read as one set: brightness .86, saturation .82, and
a navy wash over the tiles, with saturate .55 and brightness .72 over the hero.
**This set was made to one look already.** Put the old treatment over it and an
already dark picture goes to nearly black: the first attempt lost the dress
form and the rail out of the hero entirely. It is a light touch now, and it is
still there rather than removed, because the haberdashery and the retail floor
are brighter than the other six.

Two other things changed with them:

- The hero photograph was drawn at `right center/62% 100%`. That second value
  is a height, not a ratio, so it stretched the picture to the height of the
  band whatever shape it was. It is `cover` now, and the left to right gradient
  does the darkening that keeps the headline readable.
- **Each picture is seen twice, at very different sizes**: a 200px tile on the
  home page, and a much larger panel on Solutions. Anything in a picture you
  would not want read is invisible on the tile and legible on the panel.

`tools/convert_images.ps1` turns the source PNGs into the JPEGs the site
serves, cropping and resizing first. It uses System.Drawing, so it needs no
dependency and no build step, which is the rule for everything in this repo.

Every slot still degrades on purpose, so a missing file never leaves a hole:

- **Trade tiles** hold an icon with an `<img>` over it. If the file is missing
  the image removes itself and the icon shows.
- **Panels** (`.pic-panel`) and the hero background take `data-photo="..."` and
  only apply it once the browser has actually loaded the file. The url is made
  absolute first: a relative `url()` inside a custom property resolves against
  the stylesheet, so it would otherwise go looking in `css/`.

A note worth keeping: the Unsplash ids in the reference HTML do not resolve to
the pictures in the reference image, which was generated rather than built. Two
came back as a corporate stock photo and a carpenter. Do not trust them.

Photographs of the real workroom, the real stock and the real team beat anything
generated, and they are the one thing a competitor cannot copy. When they exist,
drop them into `web/img/` with the same filenames and nothing else changes.

### Screenshots of the real product

> **Five of these were deleted on 2026-09-18.** The sizing reasoning below still
> holds for the five that remain. See "The disclosure pass" for why the other
> five had to leave the folder rather than just the page.

**They are 1700x1063, and the number is not arbitrary.** Kayode reported the
screenshots looking blurry on a big screen on 2026-09-11, and he was right:
they were 1180 wide. The widest a screenshot is ever drawn on this site is 831
CSS pixels, in the hero, and 817 in the panes. A 1x display downscales 1180
into 831 and looks sharp. A 2x display needs 1662 real pixels and had 1180, so
the browser stretched it by 1.42 and every retina laptop saw soft text. The
ratio of source pixels to needed pixels went from 0.71 to 1.02.

Capture at `--force-device-scale-factor=2` on a 1180 wide window, which gives
2360x1476, then scale that down to 1700 with `tools_pngcrop.js`. Rendering
straight to 1700 would work, but the downscale from 2360 supersamples and the
text comes out visibly cleaner.

`phone.png` is 480 wide on the same reasoning: it is only ever drawn 158 CSS
pixels wide, so 480 covers 3x. It was briefly 680, which cost the landing page
68KB for pixels nothing could ever show.

The set costs 1.7MB against 1.1MB before, and the landing page carries 378KB
of screenshot against 232KB. That is the price of the product not looking
blurry in the one picture that proves it is real.

Every product screen on this site is a photograph of the running app, not a
drawing of it. Kayode's reasoning, and it is right: a visitor who can see the
actual dashboard knows what they are signing up for, and a drawn mockup is a
picture of a promise.

They live in `web/img/screens/` at 1180x738, captured from the demo account:

| file | where it is used |
| --- | --- |
| `dash.png` | home hero, Demo tab one |
| `phone.png` | home hero, the phone over the corner |
| `orders.png` | Product, "Orders and customers" |
| `production.png` | Product "Production", Demo tab two |
| `stock.png` | Product, "Stock and suppliers" |
| `finance.png` | home "Inside the product", Demo tab three |
| `payroll.png` | Product, "Team and branches" |
| `customers.png` | Demo tab four |

**How to take them again.** `capture/shot.html` is the harness. It loads the app
in an iframe, calls the app's own `demoLogin()` so no real credentials are
involved, sets the theme, navigates to a view from the hash, and freezes every
animation and transition so nothing is caught mid fade.

```
node -e "require('http')" # any static server on 8010, serving the repo root
chrome --headless=new --hide-scrollbars --user-data-dir=<throwaway> \
  --window-size=1180,738 --virtual-time-budget=15000 \
  --screenshot=out.png "http://localhost:8010/capture/shot.html?theme=black#orders"
node tools_pngcrop.js out.png web/img/screens "orders:0,0,1180,738,1180"
```

Three things that will bite whoever does this next:

- **Use a throwaway `--user-data-dir` and a separate port.** `demoLogin()` calls
  `loadExample(true)`, which replaces everything in storage. Point it at the
  origin a real studio uses and you wipe their data.
- **Do not force `opacity:1` on the app to beat the fade.** It reveals the
  hidden mobile "More" sheet, and the phone capture comes out as a menu list
  instead of the dashboard. Freeze `animation` and `transition` instead.
- **Capture the phone at 430 wide, not 390.** At 390 the app fits (no overflow,
  measured) but the dashboard heading is cut, which reads as a bug in the
  screenshot rather than a tight viewport.

The gate holds all of it: every capture a page asks for exists, every one has an
alt that says what it shows, every capture in the folder is used by some page,
and only the hero screenshot is allowed to jump the loading queue.

**Checking anything at a phone width goes through an iframe.** `capture/site.html`
loads a page of this site in an iframe of a given width, which is the only way
to get a real viewport here: Chrome's `--window-size` lays the page out wide and
the screenshot merely crops it, and the browser tool's own resize reported
success while `clientWidth` stayed at 1897. Both produce a picture of a page
apparently running off the side of the screen when nothing is wrong with it.

```
capture/site.html?p=pricing&w=390&h=844
```

Measured that way, no page scrolls sideways at 390px, and the page heights in
"Length is a feature" came from the same harness.

**A hidden pane's screenshot is warmed on purpose.** A lazy image inside a tab
that is not showing is not fetched until the tab is clicked, so the first click
used to land on an empty box for a second or two. `site.js` waits for load, then
for an idle moment, then flips every pane image to eager. The picture above the
fold has already been painted by then. If tab switching ever starts flashing
empty again, that is the thing that broke.

## Shipped like a real site

The build pass on 2026-08-27 added the things nobody notices until they are
missing, and the gate now holds each of them:

- **A sharing picture.** Every indexable page carries `og:image`, so a link
  pasted into WhatsApp or Instagram shows a photograph rather than bare text.
  It points at `img/hero.jpg`. A purpose made 1200x630 card would be better
  when there is one.
- **Structured data** on the home page: Organization, founder, Lagos, and the
  three plans with their Naira prices, so a search engine reads the facts
  rather than guessing them.
- **Pictures load late** (`loading="lazy" decoding="async"`) and sit inside
  fixed height boxes, so they never block the first paint and never shift the
  layout as they arrive.
- **Images are cached for a year** in `netlify.toml`, while pages, CSS and JS
  are revalidated every time. A photograph never changes under the same name.
- **Line length is capped** even though the container is 1680px wide. Text
  keeps a 56 to 62 character measure; only grids and panels stretch.
- **Photographs adapt to the ground they sit on.** The dark wash that lets a
  photo carry white text is dropped on the light sections, where it would only
  make the page look grey.

That debt is now paid. Both drawn screen components (`.mock` and `.screen`,
plus `.kpis`, `.rows`, `.phone` and the rest of the hand drawn furniture) have
been deleted outright, about 7KB of stylesheet, because the site shows real
captures of the app instead. The gate fails if any of them reappear.

## Length is a feature

Kayode has raised this three times, so treat it as a standing rule rather than
a preference. Nothing should need more than about six phone screens of
scrolling. Measured in a 390x844 viewport, after the real screenshots went in:

| Page | Screens |
| --- | --- |
| Home | 4.8 |
| Features | 5.1 |
| Pricing | 7.6 |
| Book a demo | 2.6 |
| Partners | 6.1 |
| Referrals | 5.6 |
| About | 6.0 |
| Support and contact | 4.7 |
| Privacy | 2.8 |
| Terms | 2.8 |

**Pricing is the one over the line, at 7.0**, and it is the one page where that
is arguable rather than a mistake. Everybody else arrives at a page and skims;
somebody who opens Pricing arrived to study it. Where the height goes at 390px:
the hero and its switches 503px, the three plans and the two bands under them
2,563px, the fairness strip 104px, what the fee is standing next to 778px, the
folded comparison 254px, the billing questions 710px, the closing call 346px.

The plans are 43% of it and they are the page. If it has to come under six, the
honest lever is folding "what the fee is standing next to" into a details,
which buys nine tenths of a screen at the cost of hiding the argument that
makes the number defensible. Do that only if somebody actually complains.

Screenshots did not cost length, which is worth knowing before anyone trims one
out to save room. A capture replaced a drawn mockup of about the same height,
the fourth tab on the booking page is a pane that swaps rather than stacks, and
the phone shot in the hero is hidden below 680px.

**Measure width as well as height, and not only on a phone.** Checking 390px
alone missed a real fault for a while: the trade strip was laid out by counting
columns, four across below 1100px, and four 200px tiles plus their gaps need
938px of window. Between 938 and 681 the home page scrolled sideways on a
tablet. Counting columns cannot know how much room there is;
`repeat(auto-fit,200px)` can, and it needs no breakpoint at all. Every page is
now clean from 320px to 1280px.

Six mechanisms hold that, and every one of them is easy to undo by accident:

- **Tabs, not stacks.** Product shows six areas one at a time, Solutions shows
  seven trades one at a time. The panes only hide on a page that has confirmed
  its JavaScript, so with scripts off everything still reads top to bottom.
- **Long reference material folds.** The plan comparison, and every section of
  the privacy notice and the terms, sit inside `details`. That alone took the
  legal pages from nearly nine screens to under three. A link to `#who` opens
  that section on arrival.
- **The trade strip swipes on a phone** rather than stacking into four rows.
- **Cards go two up** where the copy is short enough (`class="g3 g-2up"`).
- **Decorative pictures beside body copy are hidden on a phone**
  (`.row2 .pic-panel`). They are there to furnish a wide screen.
- **The footer is compact on a phone**: three columns, no blurb. It repeats on
  every page, so a hundred pixels there costs a hundred pixels twelve times.

If you add a section, decide what comes off in exchange. The gate does not
measure length, so this one is on whoever is editing.

## Who it is for

The app is not tailoring software and the site must not read like it is.
`BRANCH_TYPES` in the studio app offers five kinds of business, and the demo
seed runs four outlets of different types at once:

| In the app | On the site |
| --- | --- |
| `bespoke` | Made to order, which covers clothing, shoes and bags |
| `rtw` | Ready to wear, boutiques selling off the rail |
| `both` | A workroom at the back and a rail at the front |
| `fabrics` | Sold by length, by the yard or the metre |
| `haberdashery` | Trims, notions, threads, zips, buttons |

The words that follow from that, and the gate enforces the first two:

- The product page names all five, read out of `layi_dashboard.html` so the
  two cannot drift.
- The home page names ready to wear, boutiques, shoe makers, fabric and
  haberdashery, and the trade strip names all seven.
- **Customer, not client.** The app's own screen is called Customers, and it
  covers somebody buying a zip as well as a bride.
- **Business or shop, not studio**, unless the sentence really is about a
  bespoke workroom. The word studio appeared 165 times in the first build.
- **Maker, not tailor**, in any sentence that is not specifically about sewing.

One thing this rewrite could not fix: the product line is *Run the business
behind your label*, and a fabric shop or a haberdashery does not have a label.
The hero sub line does the broadening instead. Worth deciding whether the
tagline should widen too.

## Editing it

Four rules keep it maintainable.

**An HTML comment is published.** Everything in `web/` is served to the public
web, comments included, and anyone can read them with View Source. On 18 Sep
three of them were found live: one on `pricing.html` explaining that a
withdrawn offer "would have been sold at a loss", and one on each of
`privacy.html` and `terms.html` saying to have a Nigerian lawyer read the page
before relying on it. A legal page whose own source doubts it is worse than no
comment at all. Design notes are fine, and there are plenty. Commercial
reasoning, anything about money we have not decided, and anything addressed to
the owner go in `OUTSTANDING.md`, which is not published.

**The header and footer live in `index.html` and nowhere else.** Every other
page carries a copy. `audit_web.js` fails if any copy drifts. To change the
navigation, edit `index.html`, then run `node sync_web_shell.js`, which copies
it into every other page. It is safe to run as often as you like, and the gate
tells you immediately if a page was missed.

**Anything you are likely to change lives in `web/js/config.js`.** The contact
address, the phone number, the WhatsApp link, the URLs of the other three apps,
the demo credentials and the trial length. Pages carry the same values as plain
text so the site still reads correctly with JavaScript off, and the gate fails
if the two ever disagree. Change the config, and every page follows.

**Copy has no em dashes.** The gate enforces it on everything a customer reads,
including the page titles. It also fails if the product is ever called LAYI,
which is the tenant, not the product.

## What still has a placeholder in it

Everything here is in `web/js/config.js` except where noted. None of it stops
the site working, but all of it is wrong until you say otherwise.

- `email`, `supportEmail`, `phoneDisplay`, `phoneDial`, `whatsapp`, `instagram`
- `appUrl` and `partnerPortalUrl`, which are guesses at where the studio app and
  the partner portal will be published
- `domain`, which also appears in each page's `canonical` and `og:url` tags, in
  `robots.txt`, in `sitemap.xml` and in two rules in `_redirects`. Search and
  replace `thelabelboard.app` when the real domain is settled.
- There is no social sharing image yet, so a link posted to WhatsApp or
  Instagram shows text without a picture. One 1200x630 image dropped in as
  `web/og.png` plus an `og:image` tag on each page fixes it.

## Decisions baked in that are yours to change

- **Prices are the ones the admin console bills**: Starter 29,000, Pro 49,000,
  Premium 79,000 a month, and ten months for twelve on a yearly plan. The gate
  reads them straight out of `admin/js/data.js`, so changing them there and
  here in the same commit is the only way it passes. The trajectory in the
  roadmap notes (Studio / Growth / Atelier) is a different ladder, and if you
  want that one instead, both places have to move together.
- **The trial is 14 days with no card**, which matches the Trial plan in the
  console. `SITE.trialDays` drives every mention of it.
- **Founding studios**, the first seventy five at forty percent off for life, is
  on the pricing page as a banner. Delete that one block to drop it.
- **The customer referral reward** (a free month each, and an invitation to the
  partner programme after three) is a proposal. It is not built into billing
  anywhere, and the whole of `referrals.html` is the only place it exists.
- **The demo credentials are published**, `owner` and `layi2025`, on the demo
  page. That is the app's local demo sign in, so it touches nothing real, but
  it is a choice rather than an accident.
- **Partner terms are not a choice.** The rates, the thresholds, the milestone
  bonuses, the 31 day hold, the 5th of the month and the 10,000 minimum are
  read out of `partners/js/data.js` by the gate. If the portal and the website
  ever disagree about what a partner earns, the build fails.

## Forms

Four of them: `demo`, `partner`, `referral` and `contact`. They use Netlify
Forms, which means no backend: the hidden `form-name` input and
`data-netlify="true"` are what makes a submission arrive, and each one has a
honeypot field that a real person never sees. Submissions appear under Forms in
the Netlify dashboard.

**Two things to do after the first deploy:** turn on email notifications for
each form in Netlify, and send a test through every one of them. A form that
silently goes nowhere looks exactly like a form that works.

## Deploying

Same shape as the other two. New site on Netlify, connect this repo, publish
directory `web`. The `netlify.toml` in that folder handles the headers, and
unlike the signed in apps this one is deliberately **allowed to be indexed**.

Point the domain at it, then update `config.js` and the `thelabelboard.app`
references listed above.

## The gate

```bash
node audit_web.js
```

2349 checks. It reads every page and asserts the things a person stops noticing
after the third read: that every internal link and anchor resolves, that the
header and footer are identical everywhere, that every form will actually reach
Netlify and every input has a label, that the prices match the console and the
partner terms match the portal, that no page quotes a trial length we do not
offer, that nothing claims a feature that is only on the roadmap, that the
sitemap and the pages agree, and that no em dash has crept back in.

It caught real problems during the build: a quick jump link swallowed by the
tab handler, a header that overflowed a 375px phone by 164 pixels, copy that
would have stayed invisible if a script failed to load, a theme switch that
left half the page behind, and two panes plus a closing tag lost out of
demo.html by a scripted edit, which is why the gate now counts opening and
closing tags per page.

**A gate can lie.** The image checks in this file sat dead for a while without
anyone noticing. They were written as `/<img\b[^>]*>/g`, then edited through a
shell heredoc, which turned the `\b` into a literal backspace byte. The regex
then matched nothing, the loop ran zero times, and every run reported a clean
pass. Two rules came out of that: do not put regexes through a heredoc, write
the patch to a file and run it; and when a check iterates, have it report how
many things it iterated over, so a count of zero is visible instead of silent.
