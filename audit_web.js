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
  'privacy.html', 'terms.html', 'thanks.html', '404.html'];
/* the pages search engines should be offered, which is everything except the
   two that only exist as a destination */
const INDEXABLE = PAGES.filter(p => p !== 'thanks.html' && p !== '404.html');

const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const html = {};
PAGES.forEach(p => {
  const full = path.join(dir, p);
  if (!fs.existsSync(full)) { fail.push('page exists: ' + p); return; }
  html[p] = read(p);
});
const built = Object.keys(html);

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
check(forms.length === 4, 'there are four forms, one each for the booking, partners, referrals and contact');
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
const planRe = /\{\s*id:\s*'(starter|pro|premium)',\s*name:\s*'([^']+)',\s*monthly:\s*(\d+),\s*annual:\s*(\d+),\s*seats:\s*(\d+)/g;
const plans = all(adminData, planRe).map(m => ({ id: m[1], name: m[2], monthly: +m[3], annual: +m[4], seats: +m[5] }));
check(plans.length === 3, 'the three paid plans were read out of the admin console');

const naira = n => n.toLocaleString('en-US');
plans.forEach(pl => {
  ['pricing.html'].forEach(p => {
    check(html[p].includes('data-monthly="' + naira(pl.monthly) + '"'),
      p + ' prints the ' + pl.name + ' monthly price the console bills (' + naira(pl.monthly) + ')');
    check(html[p].includes('data-annual="' + naira(pl.annual) + '"'),
      p + ' prints the ' + pl.name + ' yearly price the console bills (' + naira(pl.annual) + ')');
  });
  check(pl.annual === pl.monthly * 10, pl.name + ' yearly really is ten months for twelve');
  check(html['pricing.html'].includes('>' + pl.seats + '<'),
    'the comparison table shows the ' + pl.name + ' seat count (' + pl.seats + ')');
  check(html['pricing.html'].includes('<h3>' + pl.name + '</h3>'), 'the pricing page offers the ' + pl.name + ' plan');
});
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

/* ================= 8. the trial is stated consistently ================= */
const trial = S.trialDays;
check(String(trial) === '14', 'the trial length in the configuration is the one the console offers');
/* Premium is shorter on purpose, and both numbers come from the configuration
   rather than being typed into the page, so they cannot drift apart. */
const trialTop = S.trialDaysPremium;
check(typeof trialTop === 'number' && trialTop > 0, 'there is a trial length for Premium (' + trialTop + ')');
check(trialTop <= trial, 'the Premium trial is not longer than the standard one');
check(html['pricing.html'].indexOf('data-cfg="trialDaysPremium"') !== -1,
  'Premium has a trial of its own, taken from the configuration');
check(html['pricing.html'].indexOf('Talk to us first') === -1,
  'no plan sends a ready buyer away to a conversation instead of a trial');
['pricing.html', 'book.html'].forEach(p => {
  check(html[p].includes('data-cfg="trialDays"'), p + ' takes the trial length from the configuration');
});
/* nobody may hard code a different number of days next to the word "free" */
built.forEach(p => {
  const bad = all(visible(html[p]), /(\d+)\s+days free/g).filter(m => m[1] !== String(trial));
  check(bad.length === 0, p + ' never quotes a trial length other than ' + trial + ' days');
});

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
// Read DEFAULT_ACTIVITIES, which is what actually decides what a studio can be.
// This used to read BRANCH_TYPES, a legacy list that never contained footwear
// or leather at all — so it was already promising the wrong trades before
// haberdashery was dropped, and nobody noticed because the count happened to
// come to five. BRANCH_TYPES has since been deleted; it was dead code.
const kindsBlock = (app.match(/const DEFAULT_ACTIVITIES=\[[\s\S]*?\n\];/) || [''])[0];
const kinds = all(kindsBlock, /\{key:'(\w+)'/g).map(m => m[1]);
check(kinds.length === 5, 'the app really does offer five kinds of business (' + kinds.length + ')');
const SAYS = { bespoke: 'made to order', rtw: 'ready to wear',
  footwear: 'shoe', leather: 'bag', fabrics: 'fabric' };
const productCopy = visible(html['features.html']).toLowerCase();
kinds.forEach(k => check(productCopy.includes(SAYS[k]),
  'the product page names the "' + SAYS[k] + '" business the app supports'));
const homeCopy = visible(html['index.html']).toLowerCase();
// haberdashery was dropped as a business type we sell to. Requiring the site to
// keep advertising it would have this gate enforcing the opposite of the truth.
['ready to wear', 'boutique', 'shoe maker', 'fabric', 'leather'].forEach(w =>
  check(homeCopy.includes(w), 'the home page speaks to more than tailors: "' + w + '"'));

/* anything we say is not built yet must be marked as not built yet */
check(/coming|on the way|being finished|shipping soon|Built and shipping soon/i.test(html['features.html']),
  'the product page is honest about what is not built yet');
['Collecting payment in the app', 'Automatic WhatsApp', 'Storefront to studio'].forEach(t => {
  check(html['features.html'].includes(t), 'the product page lists "' + t + '" as still to come rather than as a feature');
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
plans.forEach(pl => {
  check(html['pricing.html'].includes('"price": "' + pl.monthly + '"'),
    'the structured data quotes the ' + pl.name + ' price the console bills (' + pl.monthly + ')');
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
INDEXABLE.forEach(p => {
  const loc = p === 'index.html' ? '<loc>https://thelabelboard.app/</loc>' : '<loc>https://thelabelboard.app/' + p + '</loc>';
  check(sitemap.includes(loc), 'the sitemap offers ' + p);
});
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
check(shotTags.length >= 8, 'the product is shown as a screenshot in several places (' + shotTags.length + ')');
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
check(bookMain.indexOf('<form') < bookMain.indexOf('class="shot"'),
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

/* ---------- the seven trades, and the eighth shape, live on the home page ----
   The Solutions page is gone. Its panes moved onto the home page under the
   tiles, so a tile is now the thing that opens the detail rather than a link to
   somewhere else. What has to keep working: every tile has a panel, every
   panel has a tile, and the ids came across unchanged so that every link
   written as solutions.html#shoes still finds the shoe maker's panel. */
check(!fs.existsSync(path.join(dir, 'solutions.html')), 'the separate Solutions page is gone');
const home = html['index.html'];
const tileTrades = all(home, /class="industry[^"]*"[^>]*data-tab="([a-z]+)"/g).map(m => m[1]);
const paneTrades = all(home, /class="pane[^"]*"[^>]*data-pane="([a-z]+)"/g).map(m => m[1]);
check(tileTrades.length === 8, 'the home page shows eight kinds of business (' + tileTrades.length + ')');
check(paneTrades.length === 8, 'each of them has a panel behind it (' + paneTrades.length + ')');
tileTrades.forEach(t => {
  check(paneTrades.indexOf(t) !== -1, 'the tile opens a panel that exists: ' + t);
  check(home.indexOf('id="' + t + '"') !== -1, 'the panel keeps its own address: index.html#' + t);
});
paneTrades.forEach(t => check(tileTrades.indexOf(t) !== -1, 'the panel has a tile to open it: ' + t));
/* and every one of them is inside the detail block. A panel that lands
   somewhere else on the page still answers its tile and still carries its id,
   so all of the checks above pass while it renders in the middle of the hero.
   That is not a hypothetical: it is where the eighth one first landed. */
const detailStart = home.indexOf('<div class="trade-detail">');
const detailEndAt = home.indexOf('inside the product', detailStart);
check(detailStart > 0 && detailEndAt > detailStart, 'the detail block is where it should be');
const detailBlock = home.slice(detailStart, detailEndAt);
check(all(detailBlock, /class="pane/g).length === 8, 'all eight panels sit inside the detail block');
/* the section already has its own h2, so the panels head at h3 */
check(all(detailBlock, /<h2[ >]/g).length === 0, 'no panel outranks the heading of the section it sits in');
check(all(detailBlock, /<h3 class="trade-h">/g).length === 8, 'every panel has its heading');
/* exactly one open to begin with, or the section reads as empty or as noise */
check(all(home, /class="industry on"/g).length === 1, 'one tile starts open');
check(all(home, /class="pane on anchor"/g).length === 1, 'one panel starts open');

/* the tiles are controls, not links: a link would leave the page */
check(!/class="industry"[^>]*href=/.test(home), 'the tiles are controls rather than links away');
built.forEach(p => {
  check(html[p].indexOf('solutions.html') === -1, p + ' has no link left to the retired Solutions page');
  check(html[p].indexOf('>Solutions<') === -1, p + ' has no Solutions tab');
});
const solRedirects = read('_redirects');
check(solRedirects.indexOf('/solutions') !== -1, 'anyone holding the old Solutions url is sent to the trades');
check(read('sitemap.xml').indexOf('solutions.html') === -1, 'the sitemap no longer offers the Solutions page');

/* every trade names a picture, and every picture is on disk */
tileTrades.forEach(t => {
  const want = 'img/' + t + '.jpg';
  check(home.indexOf(want) !== -1, 'the ' + t + ' tile carries its photograph');
  check(fs.existsSync(path.join(dir, want)), 'the photograph is on disk: ' + want);
});

/* ---------- what each market pays ----------
   The page is written in naira and JavaScript swaps in another currency the
   configuration already holds. Two things have to stay true: naira is still
   what the console bills, and no price is ever worked out from a live rate,
   because a rate that moved would quote a shop two different numbers on two
   days without anybody having decided anything. */
const ccyBlock = (cfgSrc.match(/currencies:\s*\[[\s\S]*?\n  \]/) || [''])[0];
const markets = all(ccyBlock, /\{\s*code:\s*'([A-Z]{3})'[^}]*starter:\s*(\d+),\s*pro:\s*(\d+),\s*premium:\s*(\d+)/g)
  .map(m => ({ code: m[1], starter: +m[2], pro: +m[3], premium: +m[4] }));
check(markets.length >= 2, 'the site quotes more than one currency (' + markets.length + ')');
markets.forEach(m => {
  check(m.starter > 0 && m.pro > 0 && m.premium > 0, 'every market has a price for every plan: ' + m.code);
  check(m.starter < m.pro && m.pro < m.premium, 'the plans go up in price in ' + m.code);
});

/* naira is the real one, and it is the one the console bills */
const ngn = markets.filter(m => m.code === 'NGN')[0];
check(!!ngn, 'naira is one of the currencies');
if (ngn) {
  const byName = {};
  plans.forEach(pl => { byName[pl.name.toLowerCase()] = pl.monthly; });
  ['starter', 'pro', 'premium'].forEach(k => {
    check(ngn[k] === byName[k], 'the naira ' + k + ' price is the one the console bills (' +
      ngn[k] + ' against ' + byName[k] + ')');
  });
}

/* the page still reads correctly with no JavaScript at all */
const pr = html['pricing.html'];
check(pr.indexOf('data-plan="starter"') !== -1, 'each plan tells the currency table which one it is');
check(pr.indexOf('id="ccy-slot"') !== -1, 'there is somewhere for the currency picker to go');
plans.forEach(pl => {
  check(pr.indexOf('data-monthly="' + pl.monthly.toLocaleString('en-US') + '"') !== -1,
    'the page still carries the naira price as plain text: ' + pl.name);
});
check(pr.indexOf('\u20a6') !== -1, 'the page still shows naira before any script runs');

/* no live rate, and nothing asked of a third party to guess where a reader is */
const siteJs = read('js/site.js');
['fetch(', 'XMLHttpRequest', 'ipapi', 'geoip', 'exchangerate', 'openexchange'].forEach(t => {
  check(siteJs.indexOf(t) === -1, 'no price or location is fetched from anywhere: ' + t);
});
check(siteJs.indexOf('resolvedOptions().timeZone') !== -1,
  'the currency guess comes from the browser rather than an IP lookup');
check(siteJs.indexOf("'tlb_ccy'") !== -1, 'the chosen currency is remembered under our own key');
check(!/layi_/.test(siteJs), 'the website still never touches the app storage keys');

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
  if (i < prPlans.length - 1) {
    check(gaps >= 2, 'the ' + name + ' plan says what you would gain by moving up (' + gaps + ')');
    check(gaps <= 4, 'the ' + name + ' plan does not read as a list of complaints (' + gaps + ')');
  } else {
    check(gaps === 0, 'the top plan has nothing crossed off it, because nothing is above it');
  }
});

/* the fourth offer is a band, not a fourth column: it has no price and no self
   serve sign up, so in the grid it would look like the top of a ladder */
check(html['pricing.html'].indexOf('None of these three fit?') !== -1, 'there is somewhere to go when no plan fits');
check(html['pricing.html'].indexOf('callout-row') !== -1, 'the fourth offer is a band rather than a priced column');

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
