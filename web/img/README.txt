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


There are eleven of them: dash, orders, calendar, production, stock, delivery,
finance, payroll, customers, marketing, records, plus phone. Each one is the
view the pane beside it is describing. Four of them (calendar, delivery,
marketing, records) were borrowing another pane's picture until 2026-09-11,
because they were written before those views were ever captured, so the
calendar pane showed the dashboard. If you add a pane, capture its view.
THE PRODUCT SCREENS in img/screens/ are a separate set, captured from the
running app rather than generated. They are 1700x1063, which is not arbitrary:
the widest a screenshot is ever drawn on this site is 831 CSS pixels, and a 2x
screen needs twice that. They were 1180 wide until 2026-09-11 and looked soft
on every retina laptop. Recapture with --force-device-scale-factor=2 at a
1180 wide window, then scale the 2360 result down to 1700; the supersample is
what makes the text clean. phone.png is 480 wide for the same reason, since it
is only ever drawn 158 CSS pixels wide.

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
