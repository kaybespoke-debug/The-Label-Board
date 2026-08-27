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
| `index.html` | Hero, the seven trades, the product, pricing and the story |
| `features.html` | Six product areas behind tabs, deep linkable as `#money` and the rest |
| `solutions.html` | Seven trades behind tabs, deep linkable as `#shoes`, `#fabrics` and the rest |
| `pricing.html` | Plans, the comparison table, and the billing questions |
| `demo.html` | Open the demo, or book a walkthrough |
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

## The design

Rebuilt 2026-08-27 against a reference Kayode brought: a darker navy ground,
gold, serif headlines over an Inter interface face, a plain tab header, and
photography of the trade beside the product itself.

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

The trade tiles and the hero are high resolution photographs from Pexels, free
for commercial use with no attribution required, each one looked at before it
was used. They were the second attempt: the first set was cut out of the
reference board Kayode generated, and at 192px a tile it looked blurry the
moment it was stretched across a wide screen. `tools_pngcrop.js` is the
dependency free PNG cropper written for that attempt, kept because it is useful.

Because the photographs come from a dozen different rooms, the stylesheet puts
**one treatment over all of them** (brightness .86, saturation .82, and a navy
wash), which is what makes a bright studio and a dark workshop read as one set.
Change it in `site.css` under "photographs, once they arrive".

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

Photographs of the real workroom, the real stock and the real team beat all of
this, and they are the one thing a competitor cannot copy. When they exist, drop
them into `web/img/` with the same filenames and nothing else changes.

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

The one piece of debt worth naming: the product screens on the Product and Demo
pages still use the older `.mock` component while the hero and the showcase use
`.screen`. They are styled from the same tokens and look the same, but they are
two components doing one job. Worth merging the day either one needs a real
change.

## Length is a feature

Kayode has raised this twice, so treat it as a standing rule rather than a
preference. Nothing should need more than about six phone screens of
scrolling. Where it is today, at 375px wide:

| Page | Screens |
| --- | --- |
| Home | 6.4 |
| Product | 5.2 |
| Solutions | 2.9 |
| Pricing | 5.8 |
| Demo | 5.2 |
| Partners | 6.2 |
| Referrals | 5.7 |
| About | 5.4 |
| Help and contact | 6.2 |
| Privacy | 2.7 |
| Terms | 2.6 |

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

1332 checks. It reads every page and asserts the things a person stops noticing
after the third read: that every internal link and anchor resolves, that the
header and footer are identical everywhere, that every form will actually reach
Netlify and every input has a label, that the prices match the console and the
partner terms match the portal, that no page quotes a trial length we do not
offer, that nothing claims a feature that is only on the roadmap, that the
sitemap and the pages agree, and that no em dash has crept back in.

It caught real problems during the build: a quick jump link swallowed by the
tab handler, a header that overflowed a 375px phone by 164 pixels, copy that
would have stayed invisible if a script failed to load, and a theme switch that
left half the page behind.
