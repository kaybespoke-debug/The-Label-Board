Photography for the website.

WHAT IS HERE NOW: eight pictures Kayode generated to the brand, on 2026-08-27.
They replaced a set of Pexels stock photographs. The difference matters for the
stylesheet: the stock set came from a dozen different rooms and needed a heavy
treatment to read as one set, while these were made to one look already, so the
treatment is now a light touch. It is in site.css under "photographs, once they
arrive", and over-darkening them is the mistake to avoid: the first attempt
took the hero down to nearly black and lost the dress form and the rack.

  hero.jpg           1600x853   the cutting table, the rail and the dress form
  tailors.jpg        1000x667   a tailor pinning a jacket on the form
  shoes.jpg          1000x667   a shoemaker lasting a brogue at the bench
  bags.jpg           1000x667   a maker at the machine, finished bags laid out
  readytowear.jpg    1000x667   a retail floor, rails and a till
  fabrics.jpg        1000x699   a fabric shop, rolls and a swatch book
  madetomeasure.jpg  1000x667   a fitting room, cloth books and a jacket
  multilocation.jpg  1000x667   an owner's desk, five outlets on one screen
  accessories.jpg    1000x667   a consultation table: cufflinks and sunglasses in
                                trays, belts and a tape measure, leather swatches, a
                                design sketch, with bags, shoes and scarves on the
                                shelves behind. Added 2026-09-11 with the accessories
                                trade, cover-cropped from 1536x1024.

Every one is JPEG at quality 84, and the whole set is about 1.1MB. hero.jpg is
also the sharing card, so it is the one a link pasted into WhatsApp shows.


branches.png is the dashboard with the sidebar collapsed and then cropped
off: the four KPI cards, all four outlets with their own takings and overdue
counts, and the workload and category charts under them.

Captured at a 1600 wide window rather than 1180, which is the whole trick to
its height. The same content laid out wider is shorter: 1328x867 against
1328x1221 for the same screen at the narrower window, so it draws about 215px
shorter in the pane. Nothing was cropped away to get there, and nothing can
be: the title, the four KPI cards, the four outlets and the three chart cards
are all still in it. Cutting a band out of the middle would mean stitching two
parts of a screen into a view that does not exist.

It took three goes. The branch report came first and was dropped because it
shows what each outlet EARNED rather than what it is, and because its four
combined-total cards clip the Outstanding figure at every width tried, which
is an app bug logged in OUTSTANDING.md. Settings, Branches and outlets came
second and was dropped for a better reason: it is the MECHANISM. A
configuration screen tells a developer how the feature is built and tells a
customer nothing about what they get. This site sells outcomes.

Captured over ALL TIME, because the demo's current month has three of the
four outlets at zero. Nothing else about it is tidied: it carries 2,920,000
outstanding in red and two overdue jobs against Lagos, on purpose. An
all-green dashboard reads as a mock-up; the red is the argument.

capture/shot.html takes &call=fn:arg,fn, &scroll=px and &open=elementId now.
This shot was ?theme=black&open=sg-business#settings: Settings is an accordion
and the group holding Branches ships closed, and its toggle is an inline
onclick rather than a named function, so &call= could not reach it.

There are eleven of them: dash, orders, calendar, production, stock, delivery,
finance, payroll, customers, marketing, records, plus phone. Each one is the
view the pane beside it is describing. Four of them (calendar, delivery,
marketing, records) were borrowing another pane's picture until 2026-09-11,
because they were written before those views were ever captured, so the
calendar pane showed the dashboard. If you add a pane, capture its view.
THE PRODUCT SCREENS in img/screens/ are captures of the running app, taken
through capture/shot.html, which loads site/layi_dashboard.html and calls
demoLogin(). So THE EXAMPLE STUDIO IS THE MARKETING IMAGERY. Whatever
loadExample() seeds is what a visitor to thelabelboard.com sees.

Until 20 Sep 2026 that seed was a studio called LAYI owned by "Kay Ojomo" at
hello@layiojomo.com, which is Kayode’s own label. The site was showing his
brand name, his first name in the dashboard greeting and his studio’s books,
and a visitor reading the dashboard had fair reason to think the product was
called LAYI. The seed is now Adé Atelier, owned by Adé Sowande, and
audit_web.js section 10 fails if it ever goes back.

THE RECIPE, WHICH WAS MEASURED RATHER THAN CHOSEN.

It was not written down, so a recapture in September guessed at it, relaid
the app out at a different window width, rewrapped the card rows and drew
the software smaller inside the picture. Kayode: "i didnt ask you to change
the images/screenshots". These numbers were read back OFF the committed
originals, by scanning one row of pixels across the KPI band and comparing
where each card starts and ends as a fraction of the image width. They
reproduce the originals to within about two pixels in 1328.

  serve the repo root:  npx http-server . -p 8010 -c-1

  chrome --headless=new --disable-gpu --hide-scrollbars
    --force-device-scale-factor=1 --window-size=W,H --virtual-time-budget=5000
    --screenshot=raw.png
    "http://localhost:8010/capture/shot.html?theme=black&call=toggleSidebar#VIEW"
  node tools_pngcrop.js raw.png web/img/screens "NAME:CX,0,CW,H,1328"

  NAME        VIEW        W     H     CX   CW     out
  dash        activity    1010  742   80   927    1328x1063
  orders      orders      1010  605   80   927    1328x867
  production  production  1010  605   80   927    1328x867
  stock       supplies    1010  605   80   927    1328x867
  branches    activity    1600  1002  61   1535   1328x867

  phone       activity    545   1005  0    480    480x1005  (no scaling)

branches also takes &call=toggleSidebar,setGlobalPeriod:all. ALL TIME is not
a flourish: the demo’s current month has three of the four outlets at zero,
and this is the one picture whose whole job is four outlets trading. dash is
left on This month, which is how the original was taken, and it does show
three zeros. That is the original’s decision, not a new one.

Two things in the table are load bearing:

  1010 rather than anything wider. At 1010 the six KPI cards on Orders wrap
    four and then two, which is what the originals show. At 1396 they fit
    six across and the whole picture changes shape. The window width IS the
    framing; there is no separate framing to preserve.
  CX takes the collapsed sidebar’s icon rail off the left. toggleSidebar
    collapses it to a rail; the crop removes the rail. The software is the
    part to the right of the furniture.

The four on the product page are one size, 1328x867, because they sit in the
same slot one tab apart and different shapes made the panes jump about.

THEY WERE MADE SHORTER BY TRIMMING, NOT BY RECAPTURING. 1063 became 867 by
cutting the bottom off, which takes the tail of a long list and leaves every
heading and figure alone. The H column above bakes that in: capture 605 tall
rather than 742 and the trim is already done.

Orders is the one to look at if these are ever retaken. Its six KPI cards
wrap onto two rows, so it spends more height before the list than the others,
and at 867 it ends on the table header with no rows under it.

THE HERO IS A DIFFERENT SHAPE on purpose. dash.png stays 1328x1063 and is
drawn 549 CSS wide rather than 817, so its pixel ratio is 1.21 where the
product shots are 0.81. If these ever need to be genuinely sharper, the
number to fix is natural width over twice the CSS width, and it has to be
done without changing the window size, or the framing goes with it.

founder.jpg is Kayode, 1122x1402 at quality 95, beside the story on
about.html. The source upload is 1122 wide and that is the ceiling: there is
no more detail to be had, so the only lever on sharpness is how large it is
DRAWN.

That is worth knowing because it was the whole problem. At 520 CSS wide it
needed 1040 device pixels on a 2x screen and had 1122, a ratio of 1.08,
which is effectively one to one and reads soft next to native text. Drawn at
380 the ratio is 1.48 and it looks like a photograph again. On a phone it is
260 wide, which is 2.16.

So if it ever looks blurry: the answer is a smaller slot, not a bigger file.
It was exported at 900 wide and quality 84 first, which made it worse on
both counts.

TO REPLACE ANY OF THEM: drop a file in with the same name. Nothing else needs
to change. Keep each one under about 350KB, most phones here are on paid data.
If you are converting from a PNG, tools/convert_images.ps1 in the scratch notes
did it with System.Drawing, no dependency and no build step.

WHERE EACH ONE IS SEEN TWICE: as a 200px tile on the home page, and as a much
larger panel on Solutions. Anything in the picture that you would not want read
at panel size will be legible there, even though it is invisible on the tile.

If a file is missing the site does not break: tiles fall back to a gold icon on
a dark panel, and the hero falls back to a gradient.

Photographs of your own workroom, your own stock and your own team will always
beat anything generated, and they are the one thing a competitor cannot copy.
When you have them, this is where they go.
