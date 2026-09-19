/* audit_web.js — the public website.
 *
 * Why this gate exists: the website is the only one of the four deployments a
 * stranger sees, and the only one where being wrong costs a sale rather than a
 * support message. Three kinds of wrong are worth failing a build over:
 *
 *   1. it is broken. A link to a page that is not there, a form Netlify will
 *      never receive, an input with no label, a page missing its header.
 *   2. it disagrees with the product. The commission rates printed here have
 *      to be the rates the partner portal actually pays, and the prices have
 *      to be the prices the admin console bills. Two sources of truth is how
 *      a customer ends up quoting a number back at you that you never charged.
 *   3. it does not sound like us. Kayode's standing rule is no em dashes in
 *      anything a customer reads, and the product is never called LAYI.
 *
 * Run: node audit_web.js
 */
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, 'web');
const fail = [];
const ok = [];
const check = (cond, msg) => (cond ? ok : fail).push(msg);

const PAGES = ['index.html', 'features.html', 'pricing.html', 'book.html',
  'partners.html', 'referrals.html', 'about.html', 'contact.html',
  'waitlist.html', 'reviews.html', 'privacy.html', 'terms.html',
  '404.html', 'thanks.html'];

const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const html = {};
PAGES.forEach(p => {
  const full = path.join(dir, p);
  if (!fs.existsSync(full)) { fail.push('page exists: ' + p); return; }
  html[p] = read(p);
});
const built = Object.keys(html);

/* The pages search engines should be offered: everything except the two that
   only exist as a destination, and anything carrying a noindex of its own.
   reviews.html is the third kind. It is a real page with a real shell, waiting
   for the October studios to say something, and until one of them does it is
   noindex and unreachable rather than an empty page with a heading on it. So
   it is checked like every other page for structure, and skipped for the
   things that only make sense once a stranger is meant to find it. */
const INDEXABLE = built.filter(p => p !== 'thanks.html' && p !== '404.html'
  && !/<meta name="robots" content="noindex">/.test(html[p]));

/* ---------- helpers ---------- */
/* Strip out everything a visitor never reads, so the copy checks below only
   look at copy. Comments, scripts, styles and the machine readable head. */
function visible(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '');
}
function attrs(tag, name) {
  const re = new RegExp(name + '="([^"]*)"');
  const m = tag.match(re);
  return m ? m[1] : null;
}
function all(src, re) {
  const out = [];
  let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(src)) !== null) out.push(m);
  return out;
}

/* ================= 1. structure ================= */
built.forEach(p => {
  const s = html[p];
  check(/^<!DOCTYPE html>/i.test(s.trim()), p + ' starts with a doctype');
  check(/<html lang="en">/.test(s), p + ' declares its language');
  check(/<meta name="viewport"[^>]*width=device-width/.test(s), p + ' is set up for a phone');
  check(/<title>[^<]{10,70}<\/title>/.test(s), p + ' has a title of a sensible length');
  check(/<meta name="description" content="[^"]{50,175}"/.test(s), p + ' has a description of a sensible length');
  check(/<link rel="stylesheet" href="css\/site\.css">/.test(s), p + ' loads the stylesheet');
  check(s.includes('<script src="js/config.js"></script>'), p + ' loads the configuration');
  check(s.includes('<script src="js/site.js"></script>'), p + ' loads the behaviour');
  check(s.includes('<main id="main">'), p + ' has a main landmark');
  check(s.includes('class="skip"'), p + ' has a skip to content link');
  check(all(s, /<h1[ >]/g).length === 1, p + ' has exactly one h1');
  check(s.includes('<header class="hdr">'), p + ' has the header');
  check(s.includes('<footer class="ftr">'), p + ' has the footer');
  check(/theme-color/.test(s), p + ' sets a theme colour');
});

/* the two pages that must not be indexed say so, and the rest are canonical */
check(/<meta name="robots" content="noindex">/.test(html['thanks.html'] || ''), 'the thank you page is kept out of search results');
check(/<meta name="robots" content="noindex">/.test(html['404.html'] || ''), 'the 404 page is kept out of search results');
INDEXABLE.forEach(p => {
  check(/<link rel="canonical" href="https:\/\/[^"]+">/.test(html[p] || ''), p + ' has a canonical url');
});

/* ================= 2. header and footer are one thing ================= */
function block(src, startMark, endMark) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  return a < 0 || b < 0 ? null : src.slice(a, b);
}
const refHeader = block(html['index.html'], '<header class="hdr">', '<main id="main">');
const refFooter = block(html['index.html'], '<footer class="ftr">', '</footer>');
built.filter(p => p !== 'index.html').forEach(p => {
  check(block(html[p], '<header class="hdr">', '<main id="main">') === refHeader,
    p + ' carries the same header as every other page');
  check(block(html[p], '<footer class="ftr">', '</footer>') === refFooter,
    p + ' carries the same footer as every other page');
});

/* ================= 3. every link goes somewhere ================= */
let internal = 0;
built.forEach(p => {
  all(html[p], /<a\b[^>]*href="([^"]+)"/g).forEach(m => {
    const href = m[1];
    if (/^(https?:|mailto:|tel:)/.test(href)) return;
    const [file, hash] = href.split('#');
    internal++;
    const target = file || p;
    if (file) {
      check(fs.existsSync(path.join(dir, file)), p + ' links to a file that exists: ' + file);
    }
    if (hash && html[target] !== undefined) {
      check(html[target].includes('id="' + hash + '"'),
        p + ' links to an anchor that exists: ' + href);
    }
  });
});
check(internal > 100, 'the pages are actually linked together (' + internal + ' internal links)');

/* every page is reachable from the header or the footer of every other page */
['features.html', 'pricing.html', 'book.html', 'partners.html', 'referrals.html', 'about.html',
  'contact.html', 'privacy.html', 'terms.html'].forEach(p => {
  check(refHeader.includes(p) || refFooter.includes(p), p + ' is reachable from the shared navigation');
});

/* ================= 4. the forms will actually reach Netlify ================= */
const forms = [];
built.forEach(p => {
  all(html[p], /<form\b[^>]*>/g).forEach(m => {
    const tag = m[0];
    const name = attrs(tag, 'name');
    forms.push({ page: p, name, tag });
    check(tag.includes('data-netlify="true"'), p + ' form "' + name + '" is submitted to Netlify');
    check(attrs(tag, 'method') === 'POST', p + ' form "' + name + '" posts rather than gets');
    check(attrs(tag, 'action') === 'thanks.html', p + ' form "' + name + '" lands on the thank you page');
    check(html[p].includes('<input type="hidden" name="form-name" value="' + name + '">'),
      p + ' form "' + name + '" carries the hidden form name Netlify needs');
    const pot = attrs(tag, 'netlify-honeypot');
    check(!!pot, p + ' form "' + name + '" declares a honeypot');
    if (pot) check(html[p].includes('name="' + pot + '"'), p + ' form "' + name + '" contains the honeypot field it declares');
    check(html[p].includes('name="consent"'), p + ' form "' + name + '" asks for consent before we contact anyone');
    check(html[p].includes('href="privacy.html"'), p + ' form "' + name + '" points at the privacy notice');
  });
});
check(forms.length === 5, 'there are five forms: booking, partners, referrals, contact and the waiting list');
check(new Set(forms.map(f => f.name)).size === forms.length, 'no two forms share a name, which would merge their submissions');

/* every field a person types into has a label tied to it */
built.forEach(p => {
  all(html[p], /<(input|select|textarea)\b[^>]*>/g).forEach(m => {
    const tag = m[0];
    const type = attrs(tag, 'type');
    if (type === 'hidden') return;
    const id = attrs(tag, 'id');
    const name = attrs(tag, 'name');
    if (!id) {
      /* the honeypot and the consent box are wrapped in their own label */
      check(/tabindex="-1"/.test(tag) || name === 'consent',
        p + ' field "' + name + '" either has an id or is wrapped in its label');
      return;
    }
    check(html[p].includes('for="' + id + '"'), p + ' field "' + id + '" has a label pointing at it');
  });
});

/* ================= 5. the configuration and the copy agree ================= */
const cfgSrc = read('js/config.js');
const SITE = {};
/* run config.js the way a browser would, without pulling in a whole DOM */
new Function('globalThis', cfgSrc + '\nglobalThis.__SITE = SITE;')(SITE);
const S = SITE.__SITE;
check(!!S && !!S.text && !!S.link, 'the configuration loads and exposes text and links');

built.forEach(p => {
  all(html[p], /<[^>]*data-cfg="([^"]+)"[^>]*>([^<]*)</g).forEach(m => {
    const key = m[1], shown = m[2].trim();
    check(S.text[key] !== undefined, p + ' uses a configured value that exists: ' + key);
    if (S.text[key] !== undefined && shown) {
      check(shown === S.text[key],
        p + ' shows the configured "' + key + '" (page says "' + shown + '")');
    }
  });
  all(html[p], /<a\b[^>]*data-cfg-link="([^"]+)"[^>]*href="([^"]+)"/g).forEach(m => {
    const key = m[1], href = m[2];
    check(S.link[key] !== undefined, p + ' links to a configured destination that exists: ' + key);
    if (S.link[key] !== undefined) {
      check(href === S.link[key], p + ' link "' + key + '" matches the configuration');
    }
  });
});

/* ================= 6. the prices match the ones we bill ================= */
const adminData = fs.readFileSync(path.join(__dirname, 'admin', 'js', 'data.js'), 'utf8');
/* The id is what the database stores; the NAME is what a customer is sold,
   and the two are deliberately different — starter/pro/premium against
   Basic/Pro/Bespoke. This used to read them as if they were the same word,
   which quietly compared a naira price against `undefined` the moment a plan
   was renamed. */
const planRe = /\{\s*id:\s*'(starter|pro|premium)',\s*name:\s*'([^']+)',\s*monthly:\s*(\d+),\s*annual:\s*(\d+),\s*seats:\s*(\d+),\s*live:\s*true(,\s*invoiceOnly:\s*true)?/g;
const plans = all(adminData, planRe).map(m => ({
  id: m[1], name: m[2], monthly: +m[3], annual: +m[4], seats: +m[5], invoiceOnly: !!m[6]
}));
check(plans.length === 3, 'the three paid plans were read out of the admin console');

const naira = n => n.toLocaleString('en-US');
plans.forEach(pl => {
  check(html['pricing.html'].includes('<h3>' + pl.name + '</h3>'), 'the pricing page offers the ' + pl.name + ' plan');

  if (pl.invoiceOnly) {
    /* A plan priced per business must not carry a figure anywhere on a public
       page. Printing one is worse than printing nothing: it becomes the number
       the customer believes, and it is not a number anybody agreed. */
    check(!html['pricing.html'].includes('data-plan="' + pl.id + '"'),
      pl.name + ' is invoice-only and must not be wired to the currency table');
    check(/Priced per business/i.test(html['pricing.html']),
      pl.name + ' does not say it is priced per business');
    check(/invoice/i.test(html['pricing.html']),
      pl.name + ' does not tell them they will be invoiced rather than charged');
  } else {
    check(html['pricing.html'].includes('data-monthly="' + naira(pl.monthly) + '"'),
      'pricing.html prints the ' + pl.name + ' monthly price the console bills (' + naira(pl.monthly) + ')');
    check(html['pricing.html'].includes('data-annual="' + naira(pl.annual) + '"'),
      'pricing.html prints the ' + pl.name + ' yearly price the console bills (' + naira(pl.annual) + ')');
    check(pl.annual === pl.monthly * 11, pl.name + ' yearly really is eleven months for twelve');
    check(html['pricing.html'].includes('data-plan="' + pl.id + '"'),
      pl.name + ' is not wired to the currency table, so it never changes currency');
  }

  /* seats: 0 means unlimited. A comparison table printing "0" against Team
     logins reads as a plan that includes nobody. */
  if (pl.seats === 0) {
    check(/<td>Team logins<\/td>[\s\S]{0,200}?Unlimited/.test(html['pricing.html']),
      pl.name + ' has unlimited seats but the table does not say Unlimited');
  } else {
    check(html['pricing.html'].includes('>' + pl.seats + '<'),
      'the comparison table shows the ' + pl.name + ' seat count (' + pl.seats + ')');
  }
});
/* The comparison table must never print a bare 0 in a plan column: it is
   always either a real number or a word. */
check(!/<td class="c">0<\/td>/.test(html['pricing.html']),
  'the comparison table prints a bare 0 in a plan column, which reads as "none"');
/* Pricing lives on the Pricing tab and nowhere else. Two pages printing the
   same figure is how one of them ends up stale, so rather than checking that
   they agree, the gate now checks there is only ever one of them. */
built.filter(p => p !== 'pricing.html').forEach(p => {
  check(!/data-monthly=/.test(html[p]), p + ' leaves the prices to the pricing page');
});
check(/data-monthly=/.test(html['pricing.html']), 'the pricing page does print the prices');
/* nothing anywhere may quote a price we do not charge */
const knownPrices = new Set(plans.flatMap(pl => [naira(pl.monthly), naira(pl.annual)]));
built.forEach(p => {
  all(html[p], /data-(?:monthly|annual)="([^"]+)"/g).forEach(m => {
    check(knownPrices.has(m[1]), p + ' quotes only prices the console bills (' + m[1] + ')');
  });
});

/* ================= 7. the partner terms match the portal ================= */
const partnerData = fs.readFileSync(path.join(__dirname, 'partners', 'js', 'data.js'), 'utf8');
const tiers = all(partnerData, /\{\s*id:\s*'(bronze|silver|gold|platinum)',\s*name:\s*'([^']+)',\s*min:\s*(\d+),\s*pct:\s*(\d+)/g)
  .map(m => ({ id: m[1], name: m[2], min: +m[3], pct: +m[4] }));
check(tiers.length === 4, 'the four partner tiers were read out of the portal');

const pp = html['partners.html'] || '';
tiers.forEach(t => {
  check(pp.includes('<div class="nm">' + t.name + '</div>'), 'the partner page lists the ' + t.name + ' tier');
  check(pp.includes('<div class="rt num">' + t.pct + '%</div>'),
    'the partner page prints the ' + t.name + ' rate the portal pays (' + t.pct + '%)');
  if (t.min > 0) {
    /* the number has to be the portal's, the noun around it is free to change
       as the positioning does, so this matches the figure rather than a phrase */
    check(new RegExp('From ' + t.min + ' paying \\w+').test(pp),
      'the partner page prints the ' + t.name + ' threshold the portal uses (' + t.min + ')');
  }
});
const msMatch = partnerData.match(/const MILESTONES = \{([^}]+)\}/);
check(!!msMatch, 'the milestone bonuses were read out of the portal');
if (msMatch) {
  const pairs = all(msMatch[1], /(\d+):\s*(\d+)/g).map(m => [+m[1], +m[2]]);
  check(pairs.length === 4, 'there are four milestone bonuses');
  pairs.forEach(([n, amt]) => {
    check(new RegExp(n + ' paying \\w+, <span class="hl num">₦' + naira(amt) + '</span>').test(pp),
      'the partner page prints the ' + n + ' account bonus the portal pays (₦' + naira(amt) + ')');
  });
}
/* the money rules that PARTNERS.md says the portal is built on */
check(/31 days/.test(pp) || /thirty one days/.test(pp), 'the partner page states the 31 day hold');
check(/5th of the month|on the 5th/.test(pp), 'the partner page states when payouts run');
check(pp.includes('₦10,000'), 'the partner page states the minimum payout');
check(/first payment/.test(pp), 'the partner page is clear that commission is on the first payment');
check(/once per business|counted once per business/.test(pp), 'the partner page is clear it is counted once per business');
check(/never rewrites the past|already been credited/.test(pp), 'the partner page explains that a promotion does not rewrite past credits');

/* ================= 8. nothing offers a free trial ================= */
/* Kayode took the trial out on 18 Sep. It had been quoted in eleven places
   across five pages, all fed by `trialDays` in the configuration.

   His reason: the October cohort already gets a free month, so a trial on top
   of that is the same business free for six weeks. And the trial was never
   self-serve anyway — nobody gets an account until there has been a call, and
   the call is where somebody sees it working on their own numbers, which is
   the job the trial was supposed to do.

   These are the old checks inverted rather than deleted. A trial is the kind
   of promise that creeps back one page at a time, and every page carrying it
   is a promise we are held to, so the gate now fails on the offer itself
   rather than on the offer being stated inconsistently. */
check(S.trialDays === undefined, 'the configuration carries no trial length');
check(S.trialDaysPremium === undefined, 'the configuration carries no second trial length either');

/* The phrases a trial comes back as. "no card" on its own is deliberately NOT
   here: the booking page still says "No card, and no account until we have
   spoken", which is about the call rather than about a countdown. */
const TRIAL_WORDS = [
  [/\d+\s+days?\s+free/i, 'a number of days free'],
  [/free\s+trial/i, 'a free trial'],
  [/\d+\s+day\s+trial/i, 'a day trial'],
  [/trials?\s+for\s+\d+/i, 'a trial of a number of days'],
  [/start\s+free/i, 'a "start free" button'],
  [/no card to start/i, 'a card-free start'],
];
built.forEach(p => {
  const seen = visible(html[p]);
  TRIAL_WORDS.forEach(pair => check(!pair[0].test(seen), p + ' does not offer ' + pair[1]));
  /* an attribute rather than copy, so this one reads the raw page */
  check(!html[p].includes('data-cfg="trialDays"'),
    p + ' does not read a trial length from the configuration');
  /* visible() strips <meta>, so a promise could survive in the search result
     alone, which is the one place nobody looks */
  const m = html[p].match(/<meta name="description" content="([^"]*)"/);
  check(!m || !/trial|days free/i.test(m[1]),
    p + ' does not advertise a trial in its search description');
});

/* Taking the trial out must not leave a plan with no way to act on it. Every
   priced column and the invoice-only band send the reader to the same place,
   which is the call. */
{
  const next = (html['pricing.html'].match(/href="book\.html"/g) || []).length;
  check(next >= 3, 'every plan on the pricing page still has a next step (' + next + ' found)');
  check(/Talk to us/.test(html['pricing.html']),
    'the invoice-only plan does not offer a way to start the conversation');
}

/* ================= 9. it sounds like us ================= */
built.forEach(p => {
  const v = visible(html[p]);
  check(!v.includes('—'), p + ' contains no em dashes in anything a customer reads');
  check(!/&mdash;|&#8212;/.test(v), p + ' contains no em dashes written as an entity');
  check(!/\bLAYI\b/i.test(v), p + ' never calls the product LAYI');
  check(!/lorem ipsum/i.test(v), p + ' has no placeholder copy left in it');
  check(!/TODO|FIXME|XXX/.test(v), p + ' has no unfinished notes left in it');
});
/* the tagline and the product name are spelled the way the app spells them */
check(html['index.html'].includes('THE LABEL BOARD'), 'the brand mark is spelled the way the app spells it');

/* ================= 10. claims we can stand behind ================= */
/* Numbers on the home page strip are product facts, so they have to be true of
   the product. The nav of the studio app is the source for both. */
const app = fs.readFileSync(path.join(__dirname, 'site', 'layi_dashboard.html'), 'utf8');
const views = new Set(all(app, /class="nav-item[^"]*"[^>]*data-view="([a-z]+)"/g).map(m => m[1]));
check(views.size >= 20, 'the studio app really does have that many screens (' + views.size + ')');
check(html['index.html'].includes('<div class="v num">' + views.size + '</div>'),
  'the home page claims the number of screens the app actually has (' + views.size + ')');
check(/six roles|Six roles|6<\/div>/.test(html['index.html']), 'the home page claims the six roles the app has');

/* The app serves five kinds of business, not only tailors. The site has to say
   so, because a shoemaker or a fabric seller who reads it as tailoring software
   never gets as far as booking. Read out of the app so the two cannot drift. */
// Read CRAFTS and MODES, the two answers that actually decide what a studio can be.
// This used to read a single DEFAULT_ACTIVITIES list, and before that BRANCH_TYPES,
// a legacy list that never contained footwear or leather at all — so it was already
// promising the wrong trades before haberdashery was dropped, and nobody noticed
// because the count happened to come to five.
//
// A business the site sells to is now a PAIR: what the studio works in, and how the
// piece reaches the customer. A bespoke tailor and a boutique are the same craft in
// different modes, which is why counting chips stopped being the right check.
const craftBlock = (app.match(/const CRAFTS=\[[\s\S]*?\n\];/) || [''])[0];
const crafts = all(craftBlock, /\{key:'(\w+)'/g).map(m => m[1]);
const modeBlock = (app.match(/const MODES=\[[\s\S]*?\n\];/) || [''])[0];
const modes = all(modeBlock, /\{key:'(\w+)'/g).map(m => m[1]);
check(crafts.length === 5, 'the app offers the five crafts the site is written for (' + crafts.length + ')');
check(modes.length === 2, 'and the two modes a craft can be reached in (' + modes.length + ')');
// Each business the site names, and the craft x mode a studio would actually pick.
const SELLS_TO = {
  'made to order': ['garments', 'make'],
  'ready to wear': ['garments', 'stock'],
  'shoe':          ['footwear', 'make'],
  'bag':           ['leather',  'make'],
  'fabric':        ['fabrics',  'stock'],
  'accessor':      ['accessories', 'make']
};
const productCopy = visible(html['features.html']).toLowerCase();
Object.keys(SELLS_TO).forEach(phrase => {
  const pair = SELLS_TO[phrase];
  check(crafts.indexOf(pair[0]) !== -1 && modes.indexOf(pair[1]) !== -1,
    'a studio can actually be set up as the "' + phrase + '" business the site names (' + pair.join(':') + ')');
  check(productCopy.includes(phrase),
    'the product page names the "' + phrase + '" business the app supports');
});
const homeCopy = visible(html['index.html']).toLowerCase();
// haberdashery was dropped as a business type we sell to. Requiring the site to
// keep advertising it would have this gate enforcing the opposite of the truth.
['ready to wear', 'boutique', 'shoe maker', 'fabric', 'leather'].forEach(w =>
  check(homeCopy.includes(w), 'the home page speaks to more than tailors: "' + w + '"'));

/* Nothing unbuilt may be sold as built.
 *
 * This check used to run the other way round. The product page carried a
 * "Built and shipping soon" section naming the three things that are not
 * finished, and this gate insisted that section stayed. Honest, but it was
 * also a public list of where we are weakest and what a competitor could beat
 * us to, sitting on the page a competitor reads first. The section is gone.
 *
 * The honesty it protected is not. It just has to be enforced from the other
 * side now: if we no longer say these are coming, we must never say they are
 * here. So this fails on the claim rather than on the absence of the caveat.
 *
 * Phrasing matters. "we never take a card" on the pricing page is the truth
 * and must keep passing, so the forbidden phrases are the claims themselves
 * and not the words they are built from. "take payment" and "card payment"
 * were in this list and came straight back out: the pricing page says the cost
 * would be stated plainly if we ever collected card payments on a studio's
 * behalf, and that is the honest sentence this gate exists to protect. */
const NOT_BUILT_YET = [
  'pay from the invoice', 'pays from the invoice', 'pay online', 'pay in the app',
  'pay by card', 'pays by card', 'payments in the app',
  'collect payment', 'collects payment', 'collecting payment',
  'flutterwave', 'paystack',
  'automatic whatsapp', 'whatsapp automatically', 'sends itself', 'send themselves',
  'sending itself', 'sent automatically', 'messages itself',
  'your storefront', 'orders from your website', 'orders from your own website'
];
built.forEach(p => {
  const words = visible(html[p]).toLowerCase();
  NOT_BUILT_YET.forEach(phrase => check(words.indexOf(phrase) === -1,
    p + ' sells something that is not built yet as though it were: "' + phrase + '"'));
});

/* ================= shipped like a real site ================= */
/* Things nobody notices until they are missing: a picture when the link is
   pasted into WhatsApp, images that do not block the first paint, and the
   plain facts in a form a search engine can read. */
INDEXABLE.forEach(p => {
  check(/<meta property="og:image" content="https:\/\/[^"]+">/.test(html[p]),
    p + ' has a sharing picture for when the link is pasted somewhere');
  check(/<meta property="og:title"/.test(html[p]), p + ' has a sharing title');
});
/* Every picture waits its turn except the one above the fold, which is the
   largest thing painted and has to be asked for first. Written with split
   rather than a word boundary, because this file has been through a shell
   heredoc before and a mangled \b silently matches nothing, which turns a
   loop of real checks into a loop that runs zero times and still passes. */
function imgTags(src) {
  return src.split('<img').slice(1).map(part => '<img' + part.split('>')[0] + '>');
}
built.forEach(p => {
  imgTags(html[p]).forEach(tag => {
    const src = attrs(tag, 'src') || '';
    const eager = /loading="eager"/.test(tag);
    check(/loading="lazy"/.test(tag) || eager, p + ' says when its picture loads: ' + src);
    check(!/fetchpriority="high"/.test(tag) || eager,
      p + ' only hurries a picture it also loads eagerly: ' + src);
    check(/alt="/.test(tag), p + ' gives every picture an alt: ' + src);
    check(/decoding="async"/.test(tag), p + ' decodes its pictures off the main thread: ' + src);
  });
  /* eager is fine for anything above the fold, but only one picture on a page
     may jump the queue, or nothing has actually been prioritised */
  const hurried = imgTags(html[p]).filter(t => /fetchpriority="high"/.test(t)).length;
  check(hurried <= 1, p + ' hurries at most one picture (' + hurried + ')');
});
check(html['index.html'].includes('application/ld+json'), 'the home page carries the plain facts for search engines');
check(/"@type": "Organization"/.test(html['index.html']), 'the home page describes the company to search engines');
check(!/"priceCurrency"/.test(html['index.html']),
  'the home page does not describe prices it no longer shows');
/* structured data has to describe what is actually on the page it sits on */
check(html['pricing.html'].includes('application/ld+json'), 'the pricing page carries the offers for search engines');
check(/"priceCurrency": "NGN"/.test(html['pricing.html']), 'the structured data prices are in Naira');
plans.filter(pl => !pl.invoiceOnly).forEach(pl => {
  check(html['pricing.html'].includes('"price": "' + pl.monthly + '"'),
    'the structured data quotes the ' + pl.name + ' price the console bills (' + pl.monthly + ')');
});
// and a plan with no price must not invent one for a search engine either
plans.filter(pl => pl.invoiceOnly).forEach(pl => {
  check(!new RegExp('"name": "' + pl.name + '"[^}]*"price"').test(html['pricing.html']),
    'the structured data puts a price on ' + pl.name + ', which is agreed per business');
});

/* every picture the pages ask for is actually in the folder */
built.forEach(p => {
  const wanted = new Set();
  all(html[p], /(?:src|data-photo)="(img\/[^"]+)"/g).forEach(m => wanted.add(m[1]));
  wanted.forEach(f => check(fs.existsSync(path.join(dir, f)), p + ' asks for a picture that exists: ' + f));
});

/* ================= photography ================= */
/* The site is designed to carry photographs it does not have yet. Every slot
   has to hold a drawn fallback, or the first deploy ships holes. */
built.forEach(p => {
  all(html[p], /<span class="pic">([\s\S]*?)<\/span>/g).forEach(m => {
    check(/<svg/.test(m[1]), p + ' every photo tile keeps an icon behind the picture');
  });
  all(html[p], /<div class="pic-panel"[^>]*>([\s\S]*?)<\/div>/g).forEach(m => {
    check(/<svg/.test(m[1]), p + ' every picture panel keeps an icon behind the picture');
  });
});
check(read('js/site.js').includes('img.remove()'), 'a picture that fails to load takes itself out of the way');
check(fs.existsSync(path.join(dir, 'img', 'README.txt')), 'the picture folder says what belongs in it');

/* ================= 11. deployment ================= */
check(fs.existsSync(path.join(dir, 'netlify.toml')), 'the website has its own netlify.toml');
check(fs.existsSync(path.join(dir, '_redirects')), 'the website has its own redirects');
check(fs.existsSync(path.join(dir, 'robots.txt')), 'the website has a robots file');
check(fs.existsSync(path.join(dir, 'sitemap.xml')), 'the website has a sitemap');
check(fs.existsSync(path.join(dir, 'icon.svg')), 'the website has the brand mark');
check(fs.existsSync(path.join(dir, 'apple-touch-icon.png')), 'the website has an icon for a phone home screen');

const toml = read('netlify.toml');
check(toml.includes('publish = "."'), 'the website publishes itself rather than a folder inside another site');
check(!toml.includes('noindex'), 'the website is allowed to be indexed, unlike the signed in apps');
check(toml.includes('X-Content-Type-Options'), 'the website sets the basic security headers');
check(/for = "\/\*\.html"[\s\S]*must-revalidate/.test(toml), 'pages are never served stale from the CDN');

const redirects = read('_redirects');
check(!/^\/\*\s+\/index\.html\s+200/m.test(redirects),
  'there is no catch all rule, so a broken link shows a 404 rather than the home page');

const robots = read('robots.txt');
check(robots.includes('Sitemap: https://'), 'the robots file points at the sitemap');
check(robots.includes('Disallow: /thanks.html'), 'the thank you page is kept out of the index');

const sitemap = read('sitemap.xml');
/* The domain comes from config.js, which says of itself that everything
   Kayode is likely to change lives there and nowhere else. It was written
   out again here, so moving from thelabelboard.app to the .com that was
   actually bought turned ten passing checks red while the sitemap was
   right and the check was the stale one. A gate holding its own copy of a
   value the site owns will always eventually disagree with it. */
const ORIGIN = 'https://' + S.domain;
INDEXABLE.forEach(p => {
  const loc = p === 'index.html' ? '<loc>' + ORIGIN + '/</loc>' : '<loc>' + ORIGIN + '/' + p + '</loc>';
  check(sitemap.includes(loc), 'the sitemap offers ' + p);
});
/* One domain, everywhere. Written against whatever config.js says rather
   than against a spelling, so it holds before and after a move and catches
   the half-finished version of one — which is the state that actually
   hurts, because a sitemap advertising a domain the canonical tags deny is
   worse than either domain on its own. */
{
  // all() yields match objects, not strings — [0] is the matched text.
  const strays = [...new Set(all(sitemap + robots + redirects, /thelabelboard\.[a-z]+/g).map(m => m[0]))]
    .filter(d => d !== S.domain);
  check(strays.length === 0,
    'the sitemap, robots and redirects all use the domain config.js names',
    strays.join(', '));
}
check(!sitemap.includes('thanks.html') && !sitemap.includes('404.html'),
  'the sitemap does not offer the pages that should not be indexed');
check(all(sitemap, /<loc>/g).length === INDEXABLE.length,
  'the sitemap lists every indexable page and nothing else');

/* the site is genuinely separate from the other three deployments */
check(!fs.existsSync(path.join(dir, 'sw.js')),
  'the website has no service worker, because a marketing page should never serve a stale price');

/* ================= 12. the stylesheet covers what the pages use ================= */
const css = read('css/site.css');
const usedClasses = new Set();
built.forEach(p => all(html[p], /class="([^"]+)"/g).forEach(m =>
  m[1].split(/\s+/).forEach(c => c && usedClasses.add(c))));
const missing = [...usedClasses].filter(c => !css.includes('.' + c));
check(missing.length === 0, 'every class the pages use is styled (' + (missing.join(', ') || 'none missing') + ')');
check(css.includes('.on-light{'), 'the stylesheet carries the light ground as a section surface');
/* one theme now, so there is no switch left to leave anything half applied */
check(!/tlb_site_theme/.test(read('js/site.js') + built.map(p => html[p]).join('')),
  'there is no theme switch left anywhere');
check(!/html\.light|body\.light/.test(css), 'no switchable theme remains in the stylesheet');
built.forEach(p => check(!html[p].includes('class="tgl"'), p + ' has no theme toggle button'));
check(all(built.map(p => html[p]).join(''), /class="[^"]*on-light/g).length >= 12,
  'the light ground is used across the site (' +
  all(built.map(p => html[p]).join(''), /class="[^"]*on-light/g).length + ' sections)');
check(css.includes('@media (prefers-reduced-motion:reduce)'), 'the stylesheet respects reduced motion');
check(css.includes('@media (max-width:680px)'), 'the stylesheet has a phone breakpoint, which is the primary device');

/* copy must never depend on a script arriving: the reveal animation is only
   allowed to hide anything once the page has confirmed its JavaScript is there,
   and it un-hides itself if the script never turns up */
check(/html\.js-on \.reveal\{opacity:0/.test(css), 'the reveal animation only hides copy on a page that has its JavaScript');
check(!/^\.reveal\{opacity:0/m.test(css), 'nothing hides copy unconditionally');
built.forEach(p => {
  check(html[p].includes("classList.add('js-on')"), p + ' marks itself as having JavaScript before it hides anything');
  check(html[p].includes('__tlbReady'), p + ' un-hides itself if the script never arrives');
});

const js = read('js/site.js');
check(js.includes('window.__tlbReady = true'), 'the script tells the page it arrived');
check(js.includes('window.scrollTo'), 'in page links use window.scrollTo, which is the one that works everywhere');
check(!/\.scrollIntoView\s*\(/.test(js), 'nothing relies on scrollIntoView');
check(all(built.map(p => html[p]).join(''), /class="[^"]*on-light/g).length >= 12,
  'the light ground is actually used across the site');
check(!/layi_/.test(js), 'the website never touches the studio app storage keys');

/* ---------- reviews are on or off, never half on ----------
   Kayode, 19 September 2026: "we cant wait ... reviews wont get anywhere to
   fall so it hangs in the cloud." The first studios open accounts in October,
   so the destination was built before the thing that fills it.

   There are seven separate places that have to agree about whether there are
   any reviews: the source page, the home page block, the pricing block, the
   noindex, the sitemap, the footer and the redirect. Switching on is the kind
   of job that gets done at eleven at night when the first good quote comes in,
   and the failure mode is not a crash, it is a live page with a heading and
   nothing under it, or a review sitting on reviews.html that nobody can reach.

   So none of those seven is trusted to a memory. sync_reviews.js flips all of
   them and this fails the build if they ever disagree. */
const REV_START = '<!-- REVIEWS START -->';
const REV_END = '<!-- REVIEWS END -->';
function reviewCards(src, where) {
  const a = src.indexOf(REV_START);
  const b = src.indexOf(REV_END, a);
  check(a >= 0 && b > a, where + ' keeps the markers sync_reviews.js writes between');
  return a < 0 || b < a ? '' : src.slice(a + REV_START.length, b);
}
const revSource = reviewCards(html['reviews.html'], 'reviews.html');
const revCount = (revSource.match(/<article class="rev"/g) || []).length;
const revLive = revCount > 0;

/* every card is whole, and says who said it. A quote with no name against it
   is the thing every fake testimonial on the internet has in common. */
revSource.split('<article class="rev"').slice(1).forEach((card, i) => {
  const n = 'review ' + (i + 1);
  check(card.indexOf('<blockquote>') !== -1, n + ' has the words');
  check(card.indexOf('class="ini"') !== -1, n + ' has the initials');
  check(/<b>[^<]{2,}<\/b>/.test(card), n + ' has a name against it');
  check(/<span>[^<]{3,}<\/span>/.test(card), n + ' says the trade and the city');
  const stars = (card.match(/<svg/g) || []).length;
  check(stars === 5, n + ' shows five stars, lit or not (' + stars + ')');
  check(/aria-label="(One|Two|Three|Four|Five) out of five"/.test(card),
    n + ' tells a screen reader the rating');
});

['index.html', 'pricing.html'].forEach(p => {
  const here = reviewCards(html[p], p);
  const openTag = (html[p].match(/<section id="reviews"[^>]*>/) || [''])[0];
  check(!!openTag, p + ' has the reviews section at all');
  check(/ hidden>/.test(openTag) === !revLive,
    p + ' shows its reviews section only when there is a review in it');
  const n = (here.match(/<article class="rev"/g) || []).length;
  check(n === Math.min(revCount, 3),
    p + ' carries the first three reviews and no more (' + n + ' of ' + revCount + ')');
  /* and they are the same words, not a second copy somebody edited */
  if (n) check(revSource.indexOf(here.trim().slice(0, 120)) !== -1,
    p + ' quotes the same review as reviews.html rather than a drifted copy');
});

const revRedirects = read('_redirects');
const revSitemap = read('sitemap.xml');
check(/<meta name="robots" content="noindex">/.test(html['reviews.html']) === !revLive,
  'reviews.html is offered to search engines only once it has something on it');
check((revSitemap.indexOf('reviews.html') !== -1) === revLive,
  'the sitemap offers the reviews page only once it has something on it');
check((revRedirects.indexOf('/reviews      /index.html') !== -1) === !revLive,
  'an empty reviews page is redirected away rather than shown to anybody');
check((refFooter.indexOf('reviews.html') !== -1) === revLive,
  'the footer links to the reviews page only once there is a review on it');
/* And no page offers a way to the reviews page while it is empty.
   The block's own "Read them all" button does not count as an offer: it lives
   inside the hidden section, so it is not on the page in any sense a visitor
   can act on, and it has to stay there because sync_reviews.js un-hides the
   section as one piece. Everything outside that section does count, which is
   what this cuts away before looking. */
built.forEach(p => {
  const a = html[p].indexOf('<section id="reviews"');
  const rest = a < 0 ? html[p]
    : html[p].slice(0, a) + html[p].slice(html[p].indexOf('</section>', a));
  check((rest.indexOf('href="reviews.html"') !== -1) === revLive,
    p + ' offers a way to the reviews page only once there is a review on it');
});

/* ---------- the Products menu is a menu, not a picture of one ----------
   It was built looking right and doing nothing, and was caught in the preview
   before it went anywhere: "this dropdown should be an actual dropdown that
   works not just a pretend on cos right now it does nothing."

   Two separate faults, and each has its own check here because fixing one
   without the other puts it straight back.

   The first was the hash. Every item points at features.html#something, so from
   features.html itself the browser changes the hash on a document that is
   already open. Nothing reloads. The code that opens the right area ran once,
   on load, so it never ran again and the page sat there. The listener below is
   the whole fix.

   The second was the trigger. It was a plain link to features.html, so a click
   left the page instead of opening the list. It is still a link in the markup,
   which is what a crawler and a browser with no script need, and the script
   turns it into a toggle. That only happens if data-drop is on it, and the
   header is copied into twelve pages by sync_web_shell.js, so every page is
   checked rather than index alone. */
check(js.indexOf("addEventListener('hashchange'") !== -1,
  'the menu still works from the page it points at: a hash change reopens the area');
check(js.indexOf("$$('.nav-drop > a[data-drop]')") !== -1,
  'the Products trigger is wired up as a menu toggle');
/* This has to look inside the click handler and nowhere else. Written as a
   loose search for preventDefault next to setOpen it passed a mutant that took
   preventDefault off the click entirely, because the ArrowDown handler a few
   lines below has the same pair and satisfied it. */
const clickAt = js.indexOf("trigger.addEventListener('click'");
const clickBlock = clickAt < 0 ? '' : js.slice(clickAt, js.indexOf('});', clickAt));
check(clickBlock.indexOf('preventDefault') !== -1,
  'clicking Products opens the list rather than navigating away');
check(js.indexOf("ev.key !== 'Escape'") !== -1, 'Escape closes the menu');
built.forEach(p => {
  const drop = (html[p].match(/<a href="features\.html" data-drop[^>]*>/) || [])[0];
  check(!!drop, p + ' carries the Products trigger the script looks for');
  check(!!drop && drop.indexOf('aria-expanded=') !== -1,
    p + ' tells a screen reader whether the menu is open');
  const menu = html[p].slice(html[p].indexOf('<span class="nav-menu">'));
  const items = (menu.slice(0, menu.indexOf('</span>')).match(/<a href="features\.html#/g) || []).length;
  check(items >= 4, p + ' has the areas in the menu (' + items + ')');
});
/* one column. Two read as a panel of thumbnails rather than as a list, which
   is the other half of what Kayode asked for. */
check(/\.nav-menu\{[^}]*grid-template-columns:minmax\(0,1fr\)/.test(css),
  'the menu is a single vertical list');

/* ---------- the product is shown, not drawn ----------
   Every screen on this site is a capture of the running app, taken through
   capture/shot.html and scaled by tools_pngcrop.js. Two ways that rots: a
   capture is deleted and a page points at nothing, or somebody quietly puts a
   hand drawn mockup back, which is a picture of a promise rather than of the
   product. Both fail the build. */
const shotDir = path.join(dir, 'img', 'screens');
const shotFiles = fs.existsSync(shotDir) ? fs.readdirSync(shotDir).filter(f => f.endsWith('.png')) : [];
check(shotFiles.length >= 5, 'the site carries real screenshots of the app (' + shotFiles.length + ')');

const everyPage = built.map(k => html[k]).join('');
const shotTags = imgTags(everyPage).filter(t => / class="shot/.test(t) || /class="shot"/.test(t));
/* Eight came down to five on purpose. A 1700px capture of a working screen is
   the fastest thing on this site for somebody to copy: it hands over the
   layout, the columns and what sits next to what, in a way prose never does.
   Five is still enough to prove the app is real, which is all this gate was
   ever for. The five that went are deleted from img/screens rather than just
   unlinked, because a file left in a published folder is still fetchable by
   anyone who guesses its name. */
check(shotTags.length >= 5, 'the product is shown as a screenshot in several places (' + shotTags.length + ')');
shotTags.forEach(tag => {
  const src = attrs(tag, 'src') || '';
  const name = src.split('/').pop();
  check(src.indexOf('img/screens/') === 0, 'the screenshot comes out of img/screens: ' + src);
  check(fs.existsSync(path.join(dir, src)), 'the screenshot file is really there: ' + src);
  check((attrs(tag, 'alt') || '').length >= 20, 'the screenshot says what it shows: ' + name);
  check(attrs(tag, 'width') && attrs(tag, 'height'), 'the screenshot reserves its space: ' + name);
});

/* a capture nobody points at is a capture nobody maintains */
shotFiles.forEach(f => {
  check(everyPage.indexOf('img/screens/' + f) !== -1, 'the capture is actually used on a page: ' + f);
});

/* the hero screenshot is the largest thing above the fold */
const heroShot = imgTags(html['index.html']).filter(t => /class="shot"/.test(t))[0] || '';
check(/loading="eager"/.test(heroShot), 'the hero screenshot loads eagerly, it is the largest paint');
check(/fetchpriority="high"/.test(heroShot), 'the hero screenshot is the one picture that jumps the queue');

/* the drawn mockups these replaced must not creep back */
['.mock{', '.screen-body', '.screen-side', '.kpis'].forEach(sel => {
  check(css.indexOf(sel) === -1, 'no hand drawn product mockup returned to the stylesheet: ' + sel);
});
check(everyPage.indexOf('class="mock') === -1, 'no page draws a fake screen instead of showing a real one');
check(everyPage.indexOf('class="screen"') === -1, 'no page draws a fake screen in the hero either');

/* ---------- nobody outside gets into the demo account ----------
   Kayode's call on 2026-08-27: the website used to print the demo sign in
   details and invite strangers to open the live app. It does not any more.
   "Book a demo" lands on a form we receive, and we set the session up with
   them. The details themselves are the thing that must never come back, so
   they are asserted against here by value as well as by name. */
const everyFile = built.map(k => html[k]).join('') + read('js/config.js') + read('js/site.js');
['layi2025', 'demoUser', 'demoPass', 'Demo sign in', 'Open the live demo'].forEach(t => {
  check(everyFile.indexOf(t) === -1, 'the demo sign in details are nowhere on the site: ' + t);
});
check(!fs.existsSync(path.join(dir, 'demo.html')), 'the self serve demo page is gone');
check(built.indexOf('book.html') !== -1, 'the booking page exists');

/* the booking page is a form first, not a page with a form at the bottom */
const bookMain = html['book.html'].slice(html['book.html'].indexOf('<main id="main">'));
/* a page with no screenshots on it passes: there is nothing for the form to
   come before, which is the point of the page being this short */
const bookShot = bookMain.indexOf('class="shot"');
check(bookShot === -1 || bookMain.indexOf('<form') < bookShot,
  'the booking form comes before anything else on the page');
check(attrs((html['book.html'].match(/<form[^>]*>/) || [''])[0], 'name') === 'demo',
  'the booking form is the one Netlify already knows by name');

/* every route that used to open the app now lands on the form */
['/demo ', '/demo.html', '/book ', '/trial '].forEach(r => {
  check(redirects.indexOf(r) !== -1, 'the short route still resolves: ' + r.trim());
});
check(redirects.indexOf('/demo.html    /book.html') !== -1,
  'anyone holding the old demo url is sent to the booking form');
check(read('sitemap.xml').indexOf('demo.html') === -1, 'the sitemap no longer offers the demo page');

/* the Demo tab is off the navigation, and Book a demo points at the form */
check(refHeader.indexOf('>Demo<') === -1, 'there is no Demo tab in the header');
check(refHeader.indexOf('href="book.html"') !== -1, 'the header CTA goes to the booking form');
built.forEach(p => {
  check(html[p].indexOf('href="demo.html"') === -1, p + ' has no link left to the retired demo page');
});

/* ---------- the eight trades live on the home page as tiles ----------
   The Solutions page is gone, and so are the panels that replaced it. Each of
   those eight panels was a heading, a paragraph and four lines of detail, 768
   words in total, describing how the app works on the page that a competitor
   and a developer read before any other. A tile now carries its own three
   lines and opens nothing.

   What has to keep working: the ids, because thirteen footers link to
   index.html#tailors and the rest and a dead anchor is a silent 404 to the top
   of the page; the photographs, because a tile naming a file that is not there
   gives every visitor a real 404 on load; and the fact that nothing opened
   below, because half a removal is worse than none. */
check(!fs.existsSync(path.join(dir, 'solutions.html')), 'the separate Solutions page is gone');
const home = html['index.html'];
const tileTrades = all(home, /<article class="tt[^"]*" id="([a-z]+)">/g).map(m => m[1]);
check(tileTrades.length >= 5, 'the home page shows several kinds of business (' + tileTrades.length + ')');
check(new Set(tileTrades).size === tileTrades.length, 'no two tiles claim the same address');

/* the panels are gone, not merely hidden. A pane left on the page with the
   open class removed still ships every word of it to everyone who reads the
   source, which is the whole point of taking them out. */
check(home.indexOf('trade-detail') === -1, 'the panels under the tiles are gone, not hidden');
check(home.indexOf('data-pane=') === -1, 'no tile on the home page still opens a panel');
check(home.indexOf('class="industry') === -1, 'the old tile markup is gone with its panels');

/* every tile sits inside the row, carries its heading and carries its lines.
   A tile that lands outside the row still passes the id check above while it
   renders in the middle of the hero, which is where the eighth one once did. */
const tilesStart = home.indexOf('<div class="trade-tiles">');
const tilesEnd = home.indexOf('trade-cta', tilesStart);
check(tilesStart > 0 && tilesEnd > tilesStart, 'the tile row is where it should be');
const tileBlock = home.slice(tilesStart, tilesEnd);
/* Counting tiles between the row and the button is not enough, and a mutant
   proved it: close the row early with a stray </div> and the last tile is still
   textually before the button, so a slice still finds it. This walks the
   nesting instead. Every tile has to be exactly one level inside the row, and
   the row has to close before the button. */
(function () {
  const open = '<div class="trade-tiles">';
  let i = home.indexOf(open) + open.length;
  let depth = 1, seen = 0, astray = 0;
  while (i < tilesEnd && depth > 0) {
    const nx = home.indexOf('<', i);
    if (nx < 0 || nx >= tilesEnd) break;
    const tag = home.slice(nx, nx + 18);
    if (tag.indexOf('<article class="tt') === 0) { if (depth !== 1) astray++; seen++; depth++; }
    else if (tag.indexOf('</article') === 0) depth--;
    else if (tag.indexOf('<div') === 0) depth++;
    else if (tag.indexOf('</div') === 0) depth--;
    i = nx + 1;
  }
  check(seen === tileTrades.length && astray === 0 && depth === 0,
    'every tile is one level inside the row and the row closes (' + seen + ' tiles, '
    + astray + ' astray, depth ' + depth + ')');
})();
check(home.indexOf('<article class="tt', tilesEnd) === -1, 'no tile has landed below the row');
/* the section already has its own h2, so a tile heads at h3 */
check(all(tileBlock, /<h2[ >]/g).length === 0, 'no tile outranks the heading of the section it sits in');
check(all(tileBlock, /<h3 class="trade-h">/g).length === tileTrades.length, 'every tile has its heading');
tileBlock.split('<article class="tt').slice(1).forEach((card, i) => {
  check(all(card, /<li>/g).length >= 3,
    'the ' + (tileTrades[i] || i) + ' tile carries its highlights, which is all it is now for');
});

/* the tiles are statements now, not controls, so nothing about them may imply
   there is more to open */
check(!/<button[^>]*class="tt/.test(home), 'a tile is not a button any more');
built.forEach(p => {
  check(html[p].indexOf('solutions.html') === -1, p + ' has no link left to the retired Solutions page');
  check(html[p].indexOf('>Solutions<') === -1, p + ' has no Solutions tab');
});
const solRedirects = read('_redirects');
check(solRedirects.indexOf('/solutions') !== -1, 'anyone holding the old Solutions url is sent to the trades');
check(read('sitemap.xml').indexOf('solutions.html') === -1, 'the sitemap no longer offers the Solutions page');

/* Every trade names a picture and every picture is on disk — or the missing one is
   written down in img/README.txt as still wanted.

   The exception exists because a trade can be added to the app and the site faster than a
   photograph can be made, and the alternatives are both worse: pointing at a file that is
   not there gives every visitor a 404 on load, and dropping in a stand-in photograph puts
   a picture of somebody else's work on a page selling ours. The tile falls back to its
   line drawing, which is already drawn for every trade.

   What this must never become is a silent gap, so the README has to name the file. That
   is the difference between a decision and an oversight. */
const imgNotes = read('img/README.txt');
tileTrades.forEach(t => {
  const want = 'img/' + t + '.jpg';
  const onDisk = fs.existsSync(path.join(dir, want));
  const named = home.indexOf(want) !== -1;
  if (onDisk) {
    check(named, 'the ' + t + ' tile carries the photograph that exists for it');
  } else {
    check(!named, 'the ' + t + ' tile asks for a photograph that is not there, so every visitor loads a 404');
    check(imgNotes.indexOf(t + '.jpg') !== -1,
      'the ' + t + ' tile has no photograph and nothing says one is wanted: ' + want);
    check(/STILL WANTED/i.test(imgNotes),
      'img/README.txt lists no still-wanted section, so a missing photograph reads as an oversight');
  }
});

/* ---------- what each market pays ----------
   The page is written in naira and JavaScript swaps in another currency the
   configuration already holds. Two things have to stay true: naira is still
   what the console bills, and no price is ever worked out from a live rate,
   because a rate that moved would quote a shop two different numbers on two
   days without anybody having decided anything. */
const ccyBlock = (cfgSrc.match(/currencies:\s*\[[\s\S]*?\n  \]/) || [''])[0];
/* Only the PRICED plans appear here. Bespoke is agreed per business, so it
   carries no figure in any currency — and the regex no longer demands one,
   because requiring `premium:` was what made this read zero currencies the
   moment it was correctly removed. */
const markets = all(ccyBlock, /\{\s*code:\s*'([A-Z]{3})'[^}]*?starter:\s*(\d+),\s*pro:\s*(\d+)/g)
  .map(m => ({ code: m[1], starter: +m[2], pro: +m[3] }));
check(markets.length >= 2, 'the site quotes more than one currency (' + markets.length + ')');
markets.forEach(m => {
  check(m.starter > 0 && m.pro > 0, 'every market has a price for every priced plan: ' + m.code);
  check(m.starter < m.pro, 'the plans go up in price in ' + m.code);
});

/* naira is the real one, and it is the one the console bills */
const ngn = markets.filter(m => m.code === 'NGN')[0];
check(!!ngn, 'naira is one of the currencies');
if (ngn) {
  /* Keyed by plan ID. The currency table is a map from the id the database
     stores to a price, not from the name on the card. */
  plans.filter(pl => !pl.invoiceOnly).forEach(pl => {
    check(ngn[pl.id] === pl.monthly, 'the naira ' + pl.name + ' price is the one the console bills (' +
      ngn[pl.id] + ' against ' + pl.monthly + ')');
  });
  plans.filter(pl => pl.invoiceOnly).forEach(pl => {
    check(ngn[pl.id] === undefined,
      pl.name + ' is priced per business but carries a currency price, which the page would print');
  });
  /* And every market has to price every priced plan, or a visitor in one
     currency sees a card with no figure on it. */
  markets.forEach(mk => {
    plans.filter(pl => !pl.invoiceOnly).forEach(pl => {
      check(typeof mk[pl.id] === 'number' && mk[pl.id] > 0,
        mk.code + ' has no price for ' + pl.name);
    });
  });
}

/* the page still reads correctly with no JavaScript at all */
const pr = html['pricing.html'];
check(pr.indexOf('data-plan="starter"') !== -1, 'each plan tells the currency table which one it is');
check(pr.indexOf('id="ccy-slot"') !== -1, 'there is somewhere for the currency picker to go');
plans.filter(pl => !pl.invoiceOnly).forEach(pl => {
  check(pr.indexOf('data-monthly="' + pl.monthly.toLocaleString('en-US') + '"') !== -1,
    'the page still carries the naira price as plain text: ' + pl.name);
});
check(pr.indexOf('\u20a6') !== -1, 'the page still shows naira before any script runs');

/* no live rate, and nothing asked of a third party to guess where a reader is.
   The ban used to include the word `fetch(` outright, which was the cheapest
   way to enforce it and is now too blunt: the forms send a copy of each
   enquiry to our OWN backend so the operator console can see it. That is a
   first-party POST of data the visitor deliberately typed and submitted, not
   a rate lookup and not a third party being told who is reading our pricing.
   So the third parties stay banned by name, and the one call we do make is
   pinned to exactly what it is allowed to be. */
const siteJs = read('js/site.js');
['XMLHttpRequest', 'ipapi', 'geoip', 'exchangerate', 'openexchange', 'ip-api', 'ipinfo'].forEach(t => {
  check(siteJs.indexOf(t) === -1, 'no price or location is fetched from anywhere: ' + t);
});
check(siteJs.indexOf('resolvedOptions().timeZone') !== -1,
  'the currency guess comes from the browser rather than an IP lookup');
check(siteJs.indexOf("'tlb_ccy'") !== -1, 'the chosen currency is remembered under our own key');
check(!/layi_/.test(siteJs), 'the website still never touches the app storage keys');

/* The one call the site makes, pinned to exactly what it may be.
   The property being protected is not "we make no requests" — it is that a
   form reaches somebody whatever happens. Netlify is the path that must never
   break; this is a copy for the console alongside it. */
{
  const calls = all(siteJs, /fetch\(/g).length;
  check(calls === 1, 'the website makes exactly one request, and it is the enquiry copy (' + calls + ' found)');
  check(/rpc\/submit_enquiry/.test(siteJs),
    'the only request goes to submit_enquiry, the one function the public key may call');
  check(/cfg\.supabaseUrl/.test(siteJs),
    'it is addressed to our own backend from configuration, not a hardcoded third party');
  /* Nothing on page load. A visitor reading the pricing page tells us
     nothing until they choose to send something. */
  check(/addEventListener\('submit'/.test(siteJs),
    'the request only happens when somebody submits a form');
  check(!/DOMContentLoaded[\s\S]{0,400}fetch\(/.test(siteJs),
    'nothing is sent merely because a page was opened');

  /* THE one that matters. If this code ever cancels or rewrites a submission,
     the Netlify path dies with it and enquiries stop reaching anybody, while
     the form still looks like it worked. */
  /* Comments stripped first. The block's own comment says "no
     preventDefault", and a check that reads prose rather than code fails on
     the sentence promising the very thing it is checking for. */
  const enqRaw = (siteJs.match(/Enquiries also reach the operator console[\s\S]*$/) || [''])[0];
  /* The match begins INSIDE the block's opening comment, so that comment has
     no `/*` left to strip — drop everything up to where it closes, then strip
     the rest. Without this the check reads the sentence "no preventDefault"
     and reports the opposite of what the code does. */
  const enqBlock = enqRaw.slice(enqRaw.indexOf('*/') + 2)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check(enqRaw.length > 0, 'the enquiry copy is where it says it is');
  check(!/preventDefault/.test(enqBlock),
    'the enquiry copy cancels the form submission, so Netlify never receives it');
  check(!/\.action\s*=[^=]/.test(enqBlock), 'the enquiry copy rewrites the form action');
  check(/keepalive:\s*true/.test(enqBlock),
    'the request is cancelled by the navigation that follows it unless keepalive is TRUE');
  check(/\.catch\(/.test(enqBlock),
    'the request has no catch, so a failed copy can surface as an unhandled rejection');
  check(!/\balert\(|\bconfirm\(/.test(enqBlock),
    'a failed copy must never interrupt the visitor, whose submission already reached Netlify');
  /* Nothing is sent because a page was opened — only because somebody chose
     to submit something. The whole privacy argument for this file rests on it. */
  check(!/DOMContentLoaded|window\.onload|readystatechange/.test(enqBlock),
    'the enquiry copy runs on page load, so a reader who sent nothing is reported anyway');
  check((enqBlock.match(/send\(/g) || []).length <= 2,
    'send() is called from more than the submit handler and its own definition');

  /* The public key may sit in configuration and nowhere else. */
  const cfgJs = read('js/config.js');
  check(/supabaseAnonKey/.test(cfgJs), 'the public key lives in configuration');
  check(!/eyJ[A-Za-z0-9_-]{20,}/.test(siteJs), 'no key is hardcoded into the behaviour file');
  /* and it must be the ANON key, never a service role one */
  const key = (cfgJs.match(/supabaseAnonKey:\s*'([^']+)'/) || [])[1] || '';
  if (key) {
    let role = '';
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString()).role; } catch (e) {}
    check(role === 'anon', 'the key on the public website is the anon key, not "' + role + '"');
  }
}
/* Netlify stays the path that must never break: every form keeps posting to
   it, with no JavaScript required. */
forms.forEach(f => {
  check(/data-netlify="true"/.test(f.tag), f.page + ' form "' + f.name + '" still posts to Netlify');
});

/* structured data stays in one currency, the one we actually bill */
check(/"priceCurrency": "NGN"/.test(pr), 'the structured data is in the currency the console bills');
check(all(pr, /"priceCurrency"/g).length === 3, 'the structured data quotes one currency for three plans');

/* ---------- what a plan is missing ----------
   A list of only good news makes three tiers look interchangeable. Each plan
   below the top says what it does not include, because the gap is the thing
   that makes somebody move up. Premium says nothing of the kind: there is
   nothing above it to be missing, and crosses there would read as the product
   being unfinished rather than as a reason to upgrade. */
/* the middle one carries an extra class for its badge, so the split has to
   allow for that rather than matching the bare attribute */
const prPlans = html['pricing.html'].split(/<div class="plan(?: [a-z]+)?">/).slice(1)
  /* each block is cut at the end of its own feature list. Without this the
     last one runs to the end of the page and picks up the comparison table,
     which marks its cells "no" as well. */
  .map(b => b.slice(0, b.indexOf(String.fromCharCode(60)+"/ul>") + 5));
check(prPlans.length === 3, 'there are three self serve plans (' + prPlans.length + ')');
prPlans.forEach((block, i) => {
  const name = (block.match(/<h3>([^<]+)<\/h3>/) || [])[1] || ('plan ' + i);
  const gaps = (block.match(/class="no"/g) || []).length;
  /* The ENTRY plan has to be honest about its ceiling, or nobody understands
     what they are moving up for. Pro no longer crosses anything off, and that
     is the point of the retier rather than an omission: it is sold as the
     full product with no feature held back, so a list of things it lacks
     would be a list we would have to invent. */
  if (i === 0) {
    check(gaps >= 2, 'the ' + name + ' plan says what you would gain by moving up (' + gaps + ')');
    check(gaps <= 4, 'the ' + name + ' plan does not read as a list of complaints (' + gaps + ')');
  } else {
    check(gaps === 0, 'the ' + name + ' plan crosses things off, but it is sold as complete');
  }
});

/* The band under the three columns. It has no price and no self serve sign up,
   so in the grid it would look like the top of a ladder.

   It used to ask "None of these three fit?", which counted Bespoke among the
   three and then offered Bespoke as the answer. Kayode's correction on 18 Sep:
   it is the two priced plans that might not fit, and Bespoke is what you take
   when neither does. Checked on the invitation rather than the wording, so a
   rewrite does not fail this and a deletion still does. */
check(/href="book\.html"[^>]*>Tell us what you need</.test(html['pricing.html']),
  'there is somewhere to go when neither priced plan fits');
check(!/None of these three/.test(html['pricing.html']),
  'the band does not count Bespoke among the plans it is the answer to');
check(html['pricing.html'].indexOf('callout-row') !== -1, 'the fourth offer is a band rather than a priced column');

/* ---------- we only offer what a shop can actually choose ----------
   Haberdashery sat on this site as a trade for months and was never one of
   the five DEFAULT_ACTIVITIES, so a haberdasher could read the page, book a
   demo, and find there was no such setup waiting for them. The checks above
   run one way, that the site names every trade the app has. This runs the
   other way. */
const everyWord = built.map(k => visible(html[k])).join(' ').toLowerCase();
['haberdashery', 'haberdasher'].forEach(w => {
  check(everyWord.indexOf(w) === -1, 'the site does not offer a trade the app cannot be set up as: ' + w);
});
check(!fs.existsSync(path.join(dir, 'img', 'haberdashery.jpg')), 'its picture went with it');
/* The site has sold to MADE TO MEASURE since it launched: its own tile, its own photograph
   and its own panel. The app had no word for it until 11 September, so anybody who booked a
   demo off that tile arrived to find nothing matching how they actually work. The app has
   to carry every way of working the site advertises, not only every trade. */
const methodBlock = (app.match(/const MAKE_METHODS=\[[\s\S]*?\n\];/) || [''])[0];
const methods = all(methodBlock, /label:'([^']+)'/g).map(m => m[1].toLowerCase());
check(methods.indexOf('made to measure') !== -1,
  'the app can record the made-to-measure work the site sells to');
check(methods.indexOf('bespoke') !== -1,
  'the app can tell bespoke apart from a block adjusted, which the site prices differently');
check(everyWord.indexOf('made to measure') !== -1,
  'the site still speaks to made-to-measure studios');

// and the other way round: every craft the app can be set up as is spoken to somewhere,
// or a studio the app serves reads the site and never sees itself in it.
const CRAFT_SAYS = { garments: 'garment', footwear: 'shoe', leather: 'bag', fabrics: 'fabric', accessories: 'accessor' };
crafts.forEach(c => check(everyWord.indexOf(CRAFT_SAYS[c] || c) !== -1,
  'the site speaks to the "' + c + '" studios the app can be set up as'));

/* ---------- report ---------- */
function report() {
  console.log('\nWebsite audit\n' + '='.repeat(60));
  ok.forEach(m => console.log('  pass  ' + m));
  if (fail.length) {
    console.log('\n' + '-'.repeat(60));
    fail.forEach(m => console.log('  FAIL  ' + m));
  }
  console.log('\n' + '='.repeat(60));
  console.log(ok.length + ' passed, ' + fail.length + ' failed\n');
}
report();
process.exit(fail.length ? 1 : 0);
