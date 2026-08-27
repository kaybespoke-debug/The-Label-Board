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

const PAGES = ['index.html', 'features.html', 'solutions.html', 'pricing.html', 'demo.html',
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
['features.html', 'pricing.html', 'demo.html', 'partners.html', 'referrals.html', 'about.html',
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
check(forms.length === 4, 'there are four forms, one each for the demo, partners, referrals and contact');
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
  ['pricing.html', 'index.html'].forEach(p => {
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
/* the two pages that show prices must not disagree with each other */
plans.forEach(pl => {
  const onHome = html['index.html'].includes('data-monthly="' + naira(pl.monthly) + '"');
  const onPricing = html['pricing.html'].includes('data-monthly="' + naira(pl.monthly) + '"');
  check(onHome === onPricing, 'the home page and the pricing page agree about ' + pl.name);
});
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
['index.html', 'pricing.html', 'demo.html'].forEach(p => {
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
   never gets as far as the demo. Read out of the app so the two cannot drift. */
const kindsBlock = (app.match(/const BRANCH_TYPES=\[[^;]+\];/) || [''])[0];
const kinds = all(kindsBlock, /\['(\w+)','([^']+)'\]/g).map(m => m[1]);
check(kinds.length === 5, 'the app really does offer five kinds of business (' + kinds.length + ')');
const SAYS = { bespoke: 'made to order', rtw: 'ready to wear', both: 'both',
  haberdashery: 'haberdashery', fabrics: 'fabrics' };
const productCopy = visible(html['features.html']).toLowerCase();
kinds.forEach(k => check(productCopy.includes(SAYS[k]),
  'the product page names the "' + SAYS[k] + '" business the app supports'));
const homeCopy = visible(html['index.html']).toLowerCase();
['ready to wear', 'boutique', 'shoe maker', 'fabric', 'haberdashery'].forEach(w =>
  check(homeCopy.includes(w), 'the home page speaks to more than tailors: "' + w + '"'));

/* anything we say is not built yet must be marked as not built yet */
check(/coming|on the way|being finished|shipping soon|Built and shipping soon/i.test(html['features.html']),
  'the product page is honest about what is not built yet');
['Collecting payment in the app', 'Automatic WhatsApp', 'Storefront to studio'].forEach(t => {
  check(html['features.html'].includes(t), 'the product page lists "' + t + '" as still to come rather than as a feature');
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
check(css.includes('html.light'), 'the stylesheet has a light theme, like the rest of the family');
check(!/\bbody\.light\b/.test(css) && !/document\.body\.classList\.(add|toggle)\('light'/.test(
  read('js/site.js') + built.map(p => html[p]).join('')),
  'the theme is switched on the root element only, so nothing is left half switched');
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
check(js.includes('tlb_site_theme'), 'the theme choice is remembered under its own key');
check(!/layi_/.test(js), 'the website never touches the studio app storage keys');

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
