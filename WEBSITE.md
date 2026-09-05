# The public website

The fourth app in the family, and the only one a stranger sees. The customer app
(`layi_dashboard.html`) is what a studio runs its business on, `admin/` is the
operator console, `partners/` is for the people who bring us subscribers, and
`web/` is the shop window: what we do, what it costs, how to see it working, and
how to earn from it.

It is a separate Netlify deployment with its own `netlify.toml` and
`_redirects`, exactly like `admin/` and `partners/`. Nothing is shared at
runtime, so a bad release in one cannot take down the others.

## Running it

```bash
npx --yes http-server web -p 3003 -c-1
```

Or use the **Website** entry in `.claude/launch.json`.

## The pages

| Page | What it is for |
| --- | --- |
| `index.html` | Hero, the eight kinds of business with their detail, the product, the loop and the closing call |
| `features.html` | Six product areas behind tabs, deep linkable as `#money` and the rest |
| `pricing.html` | Plans, the comparison table, and the billing questions |
| `book.html` | The booking form, which is what "Book a demo" opens |
| `partners.html` | The partner programme, its rates, and the application form |
| `referrals.html` | A free month each, for customers who tell a friend |
| `about.html` | Why it exists and what we will not compromise on |
| `contact.html` | Help and contact in one: channels, the form, getting started, common questions |
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

The nav is now Features, Pricing, Our story, Support, with Book a demo as the
button. Four tabs and one action.

## Ten feature areas, not six

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
| Home | 5.6 |
| Features | 4.9 |
| Pricing | 7.0 |
| Book a demo | 4.3 |
| Partners | 6.0 |
| Referrals | 5.6 |
| About | 5.3 |
| Support and contact | 6.0 |
| Privacy | 2.7 |
| Terms | 2.7 |

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

Three rules keep it maintainable.

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

1738 checks. It reads every page and asserts the things a person stops noticing
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
