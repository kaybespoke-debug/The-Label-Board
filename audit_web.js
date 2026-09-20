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
  'partners.html', 'about.html', 'contact.html',
  'waitlist.html', 'reviews.html', 'privacy.html', 'terms.html',
  '404.html', 'thanks.html', 'trial.html'];

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

/* The font link is the third thing that exists once per page and has to be
   identical, and nothing was checking it. sync_web_shell copies the header and
   the footer; the <head> it does not touch, so the stylesheet link and the
   font link are fourteen hand-kept copies.

   It cost a pass on 20 Sep. The site moved from Georgia to Fraunces, index.html
   got the new link, sync_web_shell reported "14 already in step" because the
   header and footer had not changed, and every other page stayed on the old
   one. That does not look like an error. It looks like one page in a slightly
   different serif, which nobody notices until a customer does. */
/* css2 in the pattern, not just the host: the preconnect hint points at the
   same domain and comes first, so matching the host alone compares two
   preconnects and passes whatever the stylesheets say. */
const fontLink = t => (t.match(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/) || [''])[0];
const refFont = fontLink(html['index.html']);
check(!!refFont, 'index.html loads the site fonts');
check(/Fraunces/.test(refFont), 'and the serif is the one the brand uses');
built.filter(p => p !== 'index.html').forEach(p => {
  check(fontLink(html[p]) === refFont, p + ' loads the same fonts as every other page');
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
['features.html', 'pricing.html', 'book.html', 'partners.html', 'about.html',
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
/* Four, not five. referrals.html was deleted on 20 Sep 2026 when the two
   schemes became one: there is no separate customer referral to apply for,
   because every customer already has a code. */
check(forms.length === 4, 'there are four forms: booking, partners, contact and the waiting list');
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
const planRe = /\{\s*id:\s*'(starter|pro|premium)',\s*name:\s*'([^']+)',\s*monthly:\s*(\d+),\s*annual:\s*(\d+),\s*studios:\s*(\d+),\s*seats:\s*(\d+),\s*live:\s*true(,\s*invoiceOnly:\s*true)?/g;
const plans = all(adminData, planRe).map(m => ({
  id: m[1], name: m[2], monthly: +m[3], annual: +m[4], studios: +m[5], seats: +m[6], invoiceOnly: !!m[7]
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

  /* 0 means "whatever the contract says", which only Bespoke is. A table
     printing 0 against Team logins would read as a plan that includes
     nobody, so an unlimited plan has to say a word instead of a number. */
  const row = (label) => new RegExp('<td>' + label + '</td>([\\s\\S]{0,400}?)</tr>').exec(html['pricing.html']);
  [['Studios', pl.studios], ['Team logins', pl.seats]].forEach(([label, limit]) => {
    const r = row(label);
    check(!!r, 'the comparison table has a ' + label + ' row');
    if (!r) return;
    if (limit === 0) {
      check(/By agreement|Unlimited/.test(r[1]),
        pl.name + ' is not capped, so the ' + label + ' row must say so in a word');
    } else {
      check(new RegExp('>' + limit + '<').test(r[1]),
        'the comparison table shows the ' + pl.name + ' ' + label + ' limit (' + limit + ')');
    }
  });
  /* and the card a customer reads first has to agree with the table */
  if (!pl.invoiceOnly) {
    const card = new RegExp('<h3>' + pl.name + '</h3>[\\s\\S]*?</ul>').exec(html['pricing.html']);
    check(!!card && new RegExp('\\b' + pl.seats + ' team logins').test(card[0]),
      'the ' + pl.name + ' card says the same seat count as the table (' + pl.seats + ')');
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
/* Rewritten 20 September 2026, and this is the second rewrite of this
 * section in two days, which is the point worth recording rather than the
 * checks themselves.
 *
 * It has held three different programmes now: a one off share of a first
 * payment, then a four year recurring share on a tier ladder with milestone
 * bonuses, and now a flat eight per cent for twelve months. Each time, the
 * checks that had to go were the ones asserting the SHAPE of the old deal,
 * and each time they would have gone on passing against a page nobody had
 * updated. A gate can rot into enforcing the opposite of the truth, and it
 * does it silently.
 *
 * So this reads the two numbers out of the portal rather than carrying its
 * own copy, and checks the page for the FACTS a partner would be angry
 * about if the page and their ledger disagreed, rather than for phrases. */
const partnerData = fs.readFileSync(path.join(__dirname, 'partners', 'js', 'data.js'), 'utf8');
const ratePct = +(partnerData.match(/const RATE_PCT = (\d+);/) || [])[1];
const termMonths = +(partnerData.match(/const TERM_MONTHS = (\d+);/) || [])[1];
check(ratePct > 0, 'the partner rate was read out of the portal');
check(termMonths > 0, 'and the term a referred business earns for');

const pp = html['partners.html'] || '';
check(new RegExp('<h2>Eight per cent').test(pp) || pp.includes('>' + ratePct + '%<'),
  'the partner page prints the rate the portal pays (' + ratePct + '%)');
check(new RegExp('\\b' + ratePct + '%').test(pp), 'and prints it as a figure, not only as a word');

/* the two halves of the deal, monthly and yearly */
check(/twelve months|12 months/i.test(pp), 'the partner page states the ' + termMonths + ' month term');
check(/paid monthly|If they pay monthly/i.test(pp), 'the partner page says what a monthly plan earns');
check(/once|one credit/i.test(pp) && /yearly/i.test(pp),
  'the partner page says a yearly plan earns once rather than month after month');

/* THE CHECKS ARE WRITTEN AGAINST THE PAGE, NOT THE PAGE AGAINST THE CHECKS.

   Kayode replaced this page with seven lines on 20 Sep: "Place what I give,
   change nothing, expand nothing." Five checks here were asserting sentences
   that existed only because they had been written to satisfy checks, and the
   honest response is to delete the checks rather than put the sentences back
   to keep a gate quiet. A gate that makes a page longer is a gate working
   against the person the page is for.

   The 31 day hold, the per-business clock and "the referred business gets
   nothing" are all still true, still enforced in the database and still
   proved by referral_fraud_harness. They are on the FAQ and in the Terms.
   They are not on this page because he does not want them on this page. */
check(/If they leave, it stops|stops that day/i.test(pp),
  'the partner page says a business that leaves stops earning');
check(/cannot refer yourself|cannot refer itself/i.test(pp),
  'and that you cannot refer yourself');
check(/Paid yearly|once a year/i.test(pp), 'the partner page states when payouts run');
check(/naira/i.test(pp), 'and what it is paid in');

/* ONE programme. There were two until 20 Sep 2026: this one, and a
   customer referral that gave a free month to both sides. A second scheme
   coming back would not look like a mistake, it would look like a feature,
   which is exactly why it is worth a check rather than a memory. */
check(/every business|Everybody has a code|already in it/i.test(pp),
  'the referral page says every customer is already in the programme');
check(/cannot refer yourself|cannot refer itself|refer yourself/i.test(pp),
  'and that you cannot refer yourself');
built.forEach(q => {
  const v = visible(html[q]);
  check(!/free month|month free each|month of credit/i.test(v),
    q + ' does not offer a second referral scheme paying in free months');
});

/* and the programme that is over must not survive on the page */
check(!/milestone/i.test(pp), 'no milestone bonus is still offered on the partner page');
check(!/Getting started|Unlocked|Established|Senior/.test(pp), 'no tier ladder survives on the partner page');
check(!/four years|taper/i.test(pp), 'no four year term or taper survives on the partner page');
/* the one number that has to match the schema rather than the copy */
check(/in naira|Nigerian account/i.test(pp),
  'the partner page says partners are paid in naira, which is what partner_accounts holds');

/* ============ 8. the trial, and it says what the database does ============ */
/* There was no trial between 18 and 20 September. Kayode took it out, and
   this section was the old checks INVERTED so it could not creep back one
   page at a time. On 20 September he put it back, deliberately and with
   terms: 14 days of Pro, a card required at signup, first charge on day 15.

   So the checks turn round again, and the risk turns round with them. It is
   no longer a promise appearing on a page nobody meant to change. It is the
   website and the billing system drifting apart, which is worse, because
   one of them takes money from somebody.

   "The website trial terms must exactly match the billing system. Do not
    invent different terms."

   That is why the numbers below are not read from the copy and compared to
   each other. They are read from the MIGRATION, so a trial that becomes 30
   days in the database and stays 14 on the pricing page fails here rather
   than in somebody's bank statement. */
const trialSql = fs.readFileSync(
  path.join(__dirname, 'supabase/migrations/20260920150000_free_trial.sql'), 'utf8');
const sqlDays = (trialSql.match(/start_free_trial\(\s*\n?\s*p_business uuid, p_days int default (\d+)\)/) || [])[1];

check(S.trial && typeof S.trial === 'object', 'the configuration carries the trial terms');
check(S.trial && Number(S.trial.days) === 14,
  'the website says the trial is 14 days');
check(sqlDays === String(S.trial && S.trial.days),
  'and the database agrees, because that number is read out of the migration (sql ' + sqlDays + ')');
check(S.trial && S.trial.plan === 'pro', 'the trial is of the Pro plan, which is what plan_features gives it');
check(S.trial && S.trial.cardRequired === true,
  'the configuration says a card is required, because one is');
check(S.trial && Number(S.trial.chargesOnDay) === 15,
  'and that the first charge is day 15, which is the day after 14');

/* The exact sentence. Kayode gave it word for word and it is repeated
   beside every trial button rather than paraphrased per page. */
const REASSURANCE = 'Start free for 14 days. Card required, nothing charged until day 15. Cancel any time before then.';
check(S.trial && S.trial.reassurance === REASSURANCE,
  'the configuration holds the reassurance line exactly as it was given');

/* NEVER "no card needed". A card IS required, and this is the one place the
   copy could soften into a promise we do not keep. The booking page is
   allowed to say there is no card to BOOK a call, which is a different
   thing, so the patterns below are about starting rather than about booking. */
const CARD_LIES = [
  [/no card (needed|required)/i, '"no card needed"'],
  [/without a card/i, '"without a card"'],
  [/free.{0,20}no card/i, 'free with no card'],
  [/card.{0,10}not required/i, 'a card not being required'],
];
built.forEach(p => {
  const seen = visible(html[p]);
  CARD_LIES.forEach(pair => check(!pair[0].test(seen),
    p + ' never claims ' + pair[1] + ', because a card is required to start a trial'));
});

/* Every page that offers the trial must carry the line with it. A button
   with the terms on another page is a button with no terms. */
built.forEach(p => {
  const offersTrial = /href="trial\.html"/.test(html[p]);
  const isCta = /Start your 14-day free trial|Set up my trial/.test(visible(html[p]));
  if (!isCta) return;
  check(visible(html[p]).includes(REASSURANCE),
    p + ' puts the exact trial terms beside the button that starts one');
  void offersTrial;
});

/* The two cards that can actually be started: trial primary, demo secondary.
   Bespoke has neither, on purpose: it is priced per contract, so there is
   nothing for a card to be charged for on day 15. */
const pricingHtml = html['pricing.html'];
check(/<a class="btn btn-gold btn-wide" href="trial\.html"><span>Start your 14-day free trial<\/span><\/a>[\s\S]{0,400}?The essentials/.test(pricingHtml),
  'Basic leads with the trial');
check(/<a class="btn btn-gold btn-wide" href="trial\.html"><span>Start your 14-day free trial<\/span><\/a>[\s\S]{0,400}?Everything in Basic/.test(pricingHtml),
  'Pro leads with the trial');
check((pricingHtml.match(/href="book\.html"><span>Book a demo<\/span>/g) || []).length === 2,
  'and both of them keep Book a demo as the second choice');
check(!/trial\.html[\s\S]{0,300}?Everything in Pro/.test(pricingHtml),
  'Bespoke offers no trial, because it has no list price to charge on day 15');

/* The hero, the nav, the drawer and the footer all reach it. */
check(/<a class="btn btn-gold" href="trial\.html">Start your 14-day free trial<\/a>/.test(html['index.html']),
  'the home page hero leads with the trial');
check(html['index.html'].includes(REASSURANCE), 'and states the terms under it');
built.forEach(p => {
  check(/class="btn btn-gold btn-sm" href="trial\.html"/.test(html[p]),
    p + ' offers the trial in the header');
  check(/<a href="trial\.html">Start a free trial<\/a>/.test(html[p]),
    p + ' offers the trial in the footer');
});

/* And the page it all points at exists and is honest about the card. */
check(html['trial.html'].includes(REASSURANCE), 'the trial page states the terms');
check(/Card is required|card is required|Card required/.test(visible(html['trial.html'])),
  'and says plainly that a card is needed');

/* Taking the trial out must not leave a plan with no way to act on it. Every
   priced column and the invoice-only band send the reader to the same place,
   which is the call. */
{
  const next = (html['pricing.html'].match(/href="book\.html"/g) || []).length;
  check(next >= 3, 'every plan on the pricing page still has a next step (' + next + ' found)');
  /* The Bespoke card's own button, not the words "Talk to us": that phrase
     was in the billing questions, which moved to the FAQ on 20 Sep, so the
     check had started passing on a different part of the page from the one
     it was written about. */
  check(/<h3>Bespoke<\/h3>[\s\S]*?href="book\.html"/.test(html['pricing.html']),
    'the invoice-only plan does not offer a way to start the conversation');
}

/* ================= 9. it sounds like us ================= */
built.forEach(p => {
  const v = visible(html[p]);
  check(!v.includes('—'), p + ' contains no em dashes in anything a customer reads');
  check(!/&mdash;|&#8212;/.test(v), p + ' contains no em dashes written as an entity');
  check(!/\bLAYI\b/i.test(v), p + ' never calls the product LAYI');
  /* Copy is not the only place a real studio's name can reach this site.
     The screenshots are the other one, and this gate cannot read a PNG. */
  check(!/\bKay Ojomo\b/.test(v), p + " does not carry the founder's studio identity in copy");
  check(!/lorem ipsum/i.test(v), p + ' has no placeholder copy left in it');
  check(!/TODO|FIXME|XXX/.test(v), p + ' has no unfinished notes left in it');
});
/* the tagline and the product name are spelled the way the app spells them */
check(html['index.html'].includes('THE LABEL BOARD'), 'the brand mark is spelled the way the app spells it');

/* ================= 10. claims we can stand behind ================= */
/* Numbers on the home page strip are product facts, so they have to be true of
   the product. The nav of the studio app is the source for both. */
const app = fs.readFileSync(path.join(__dirname, 'site', 'layi_dashboard.html'), 'utf8');

/* ---------- and the pictures are product facts too ----------
   Every screenshot on this site is a capture of the running app through
   capture/shot.html, which calls demoLogin(), which calls loadExample(). So
   the example studio's seed IS the marketing site's imagery, and no check
   over the HTML can see it: the words are inside a PNG.

   Until 20 Sep that seed was a studio called LAYI owned by "Kay Ojomo" at
   hello@layiojomo.com, which is Kayode's own label. thelabelboard.com was
   showing his brand name, his first name in the dashboard greeting and his
   studio's books, and a visitor reading the dashboard had every reason to
   think the product was called LAYI.

   This reads the seed rather than the pictures. A seed that goes back to a
   real studio's identity fails here, which is one recapture away from being
   on the website again. */
{
  /* The seeded VALUES, read one at a time, not a blob scan over the function.
     A blob is the obvious way to write this and it is wrong: layi_dash_* is
     the storage key prefix on every real device and LAYI_BIZ is the demo
     tenant's uuid, so a scan for "LAYI" inside loadExample matches things
     that must never change and reports them as a leak. */
  /* The whole line, because the company object contains nested bank objects
     and a lazy [^}]* stops at the first one, three fields short of the end. */
  /* Anchored on the seeded pay instruction, which only the example studio
     has. Two other lines in the app assign SETTINGS.company from FORM FIELDS
     and both matched looser patterns, so the check was reading a line with no
     literal name in it and reporting that the studio had not said what it was
     called, which sounds like a missing name rather than a missed line. */
  const seedCompany = (app.match(/SETTINGS\.company=Object\.assign\(.*Balance due on collection.*/) || [''])[0];
  const co = (seedCompany.match(/name:'([^']*)'/) || [])[1];
  const email = (seedCompany.match(/email:'([^']*)'/) || [])[1];

  check(!!co, 'the example studio says what it is called');
  check(co !== 'LAYI', 'the example studio is not the founder’s own label (' + co + ')');
  check(!/layiojomo/.test(seedCompany),
    'the example studio is not on the founder’s own domain (' + email + ')');
  check(!/LAYI/.test(seedCompany),
    'nothing on the example studio’s letterhead is the founder’s label');

  /* Every u-owner in the file, not the first one: there are two, the blank
     one a fresh install gets and the one loadExample seeds, and they are
     written almost identically. Asserting over all of them is also the
     stronger question, because either of them reaching a screenshot is the
     same problem. */
  const owners = all(app, /\{id:'u-owner',name:'([^']*)'/g).map(m => m[1]);
  check(owners.length >= 1, 'the example studio has somebody signed in to it');
  owners.forEach(n => {
    check(n !== 'Kay Ojomo',
      'the dashboard greeting in every screenshot is not the founder (' + n + ')');
  });
  /* and nothing anywhere in the app still signs as him */
  check(app.indexOf('Kay Ojomo') === -1,
    'no record in the example studio is signed by the founder');
}
const views = new Set(all(app, /class="nav-item[^"]*"[^>]*data-view="([a-z]+)"/g).map(m => m[1]));
check(views.size >= 20, 'the studio app really does have that many screens (' + views.size + ')');
/* The home page used to print this in a four up strip. Kayode took the strip
   out on 20 Sep, so there is no claim left to check against the app. The
   check goes with the claim, rather than the claim being put back to keep a
   check quiet. views.size is still read: the product page depends on it. */
/* Read out of the app, not written down here. This check used to be the
   regex /six roles|Six roles|6<\/div>/, which is a number asserting itself:
   the site said six, the check looked for six, and the app had five. The
   sixth is a custom role the demo account creates to prove custom roles
   work, so the strip was quoting the demo rather than the product. */
const roleBlock = app.slice(app.indexOf('function defaultRoles()'),
                            app.indexOf('function canSeeProfit'));
const roleCount = all(roleBlock, /\{id:'[a-z]+',name:'[^']+',builtin:true/g).length;
check(roleCount >= 4, 'the app really does ship built in roles (' + roleCount + ')');
/* Same: the strip that carried this is gone. The comparison table still
   counts its roles row against the app, a few lines below. */
/* The comparison table said "Six roles with permissions" while the app shipped
   five and the home page strip said five. Two places on one site disagreeing
   about a countable fact, with the app right there to be read. */
{
  const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
  const row = (/<td>(\w+) roles with permissions[^<]*<\/td>/.exec(html['pricing.html']) || [])[1];
  check(!!row, 'the comparison table has a roles row');
  check(row === WORDS[roleCount],
    'and it counts the roles the app ships (' + WORDS[roleCount] + ', found ' + row + ')');
}

/* The table and the cards are two descriptions of one thing, and the way
   they go wrong is one of them being edited. These are the rows where the
   two contradicted each other on 20 Sep. */
{
  const pr = html['pricing.html'];
  const proCard = (/<h3>Pro<\/h3>[\s\S]*?<\/ul>/.exec(pr) || [''])[0];
  const row = label => (new RegExp('<td>' + label + '</td>([\\s\\S]{0,260}?)</tr>').exec(pr) || [, ''])[1];

  const sellsPriority = /priority support/i.test(proCard);
  const tablePriority = /Yes/.test((row('Priority support').match(/<td[\s\S]*?<\/td>/g) || [])[1] || '');
  check(sellsPriority === tablePriority,
    'the Pro card and the Priority support row agree (card ' + sellsPriority + ', table ' + tablePriority + ')');

  check(!/measurement history|fitting records/i.test(proCard) ||
        /Not included/.test(row('Customers and full measurements')),
    'the Pro card does not sell measurements the table gives to Basic');

  check(/<td>See who owes you<\/td>/.test(pr) && /<td>Chase list and payment reminders<\/td>/.test(pr),
    'the table carries the receivables rows, which are the real Basic-versus-Pro line');
}

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
/* The product page used to repeat the trade list in a lede. Kayode took that
   section out on 20 Sep, so what is left to check is that the app can really
   be set up as each one, and that the SITE names it somewhere — which is the
   check at the bottom of this file, over every page. Asking the product page
   specifically would be asking for the copy back. */
Object.keys(SELLS_TO).forEach(phrase => {
  const pair = SELLS_TO[phrase];
  check(crafts.indexOf(pair[0]) !== -1 && modes.indexOf(pair[1]) !== -1,
    'a studio can actually be set up as the "' + phrase + '" business the site names (' + pair.join(':') + ')');
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

/* every picture the pages ask for is actually in the folder.

   A src may carry ?v=N. That is a cache bust, not part of the filename: the
   screenshots are served with a week of Cache-Control and their names never
   change, so a browser that has seen the old capture keeps drawing it until
   the URL moves. Kayode reported exactly that on 20 Sep and reasonably asked
   whether the deploy had failed; it had not, the bytes on the server were
   already right. So the query is stripped before the file is looked for. */
const onDisk = src => src.split('?')[0];
built.forEach(p => {
  const wanted = new Set();
  all(html[p], /(?:src|data-photo)="(img\/[^"]+)"/g).forEach(m => wanted.add(m[1]));
  wanted.forEach(f => check(fs.existsSync(path.join(dir, onDisk(f))), p + ' asks for a picture that exists: ' + f));
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
/* Was 12. Several light sections went with the removals on 20 Sep. The point
   of the check is that the second ground is genuinely part of the design
   rather than a leftover of the old theme switch, and ten sections across
   twelve pages is still that. */
check(all(built.map(p => html[p]).join(''), /class="[^"]*on-light/g).length >= 8,
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
/* Was 12. Several light sections went with the removals on 20 Sep. The point
   of the check is that the second ground is genuinely part of the design
   rather than a leftover of the old theme switch, and ten sections across
   twelve pages is still that. */
check(all(built.map(p => html[p]).join(''), /class="[^"]*on-light/g).length >= 8,
  'the light ground is actually used across the site');
check(!/layi_/.test(js), 'the website never touches the studio app storage keys');

/* ---------- the product page lists its own areas ----------
   The strip came off on 19 September, because the Products dropdown said the
   same five things and having both was saying it twice. On 19 September it
   went back, because Kayode asked for the menu to go instead: "no more
   products dropdown just products then it opens up all the products list on
   the page".

   That makes the strip load bearing in a way it was not before. It is now
   the only way to change area, at every width, so a page that ships without
   it is a page stranded on whichever area happens to be open. These checks
   refuse that. */
{
  const feat = html['features.html'];
  const tabs = all(feat, /<button class="tab[^"]*"[^>]*data-tab="([a-z]+)"[^>]*>([^<]+)</g)
    .map(m => ({ id: m[1], title: m[2] }));
  const panes = all(feat, /data-pane="([a-z]+)" data-title="([^"]+)"/g)
    .map(m => ({ id: m[1], title: m[2] }));

  check(tabs.length >= 5, 'the product page lists its areas on the page (' + tabs.length + ')');
  check(panes.length === tabs.length,
    'every area listed has a pane and every pane is listed (' + tabs.length + ' and ' + panes.length + ')');
  tabs.forEach(t => {
    const pane = panes.filter(x => x.id === t.id)[0];
    check(!!pane, 'the list points at an area that exists: ' + t.id);
    check(!!pane && pane.title === t.title,
      'the area calls itself what the list calls it: ' + t.id +
      ' (' + (pane || {}).title + ' vs ' + t.title + ')');
  });

  /* exactly one open, or the page reads as empty or as noise */
  check(all(feat, /<button class="tab on"/g).length === 1, 'one area ships open');
  check(all(feat, /class="pane on /g).length === 1, 'and one pane ships open with it');

  /* the heading is written from the pane, and has to be right before any
     script runs, or the page says the wrong product name to a crawler */
  check(/<h1 data-feat-title>/.test(feat), 'the page has a heading the areas can write into');
  check(feat.indexOf('>' + (panes[0] || {}).title + '<') !== -1,
    'the heading ships with the name of the area that ships open, so it is right with no script');
}

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
/* The exclamation mark, on its own line of the gate, because leaving it off is
   not a typo that shows up as a broken build. Netlify applies a redirect only
   where no file matches the path, and reviews.html is a real file, so the rule
   without the ! is accepted, deployed, and quietly ignored. It went out like
   that once and the empty page was live at /reviews until the post-deploy
   check fetched the url. This is why that fetch is the last step of a release
   and not a formality: no static gate can prove what Netlify will do. */
check((revRedirects.indexOf('/reviews      /index.html     302!') !== -1) === !revLive,
  'the redirect away from the empty page is forced, or Netlify serves the file and ignores it');
check((revRedirects.indexOf('/reviews.html /index.html     302!') !== -1) === !revLive,
  'the .html form of the empty page is forced away too');
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
/* ---------- Products is a link, not a menu ----------
   Kayode, 19 September: the dropdown goes, the list lives on the page. What
   has to stay true is that nothing anywhere still expects the menu, because
   half a removal is what leaves a trigger that opens nothing.

   The header is copied into thirteen pages by sync_web_shell.js, so every
   page is checked rather than index alone. */
check(js.indexOf("addEventListener('hashchange'") !== -1,
  'picking an area from a link on the page itself still changes the area');
built.forEach(p => {
  check(html[p].indexOf('<a href="features.html">Products</a>') !== -1,
    p + ' offers Products as a plain link');
  ['nav-drop', 'nav-menu', 'data-drop', 'class="sub"'].forEach(t => {
    check(html[p].indexOf(t) === -1, p + ' has no dropdown left on it: ' + t);
  });
});

/* picking an area goes to the top, so the heading that names the area you
   just chose is the first thing on screen. It used to aim at the strip minus
   96, and when the strip was removed that selector stopped matching and it
   aimed at the pane, which landed below the heading with the sticky header
   over the first line. */
/* the hash handler goes to the top, and the five ids are at the top of the
   page rather than on the panes, so a link from another page lands there
   without the script having to race the browser for it */
const hashFn = js.slice(js.indexOf('function openFromHash'), js.indexOf('openFromHash(false)'));
check(hashFn.indexOf('window.scrollTo(0, 0)') !== -1,
  'picking an area scrolls to the top of the page');
const featTop = html['features.html'];
check(all(featTop, /<span id="[a-z]+" class="anchor"><\/span>/g).length >= 5,
  'the areas answer at the top of the page, so a link to one lands at the top');
check(!/class="pane[^"]*"[^>]*\sid=/.test(featTop),
  'and no pane carries an id of its own, which is what used to scroll into the middle');

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
  check(fs.existsSync(path.join(dir, onDisk(src))), 'the screenshot file is really there: ' + src);
  /* Required, not optional. A recapture that keeps the filename and does not
     move the version is invisible to every visitor who has been here in the
     last week, which is the failure this gate now exists to stop. */
  check(/\?v=\d+$/.test(src), 'the screenshot carries a version so a recapture actually reaches people: ' + src);
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
/* ONE currency, from 20 Sep 2026. There were six; the other five were
   conversions at a rate nobody had agreed, and a visitor cannot tell a
   seeded price from a real one. Kayode: "just naira so we dont cause
   confusuion, we can always add those when the app is ready to go
   international".

   So this asks for exactly one, and names it, rather than asking for
   "more than one" as it used to. A second row appearing here is either
   a real agreed price or somebody re-seeding, and the difference is
   worth a person looking rather than a build passing. */
check(markets.length === 1, 'the site quotes one currency and only one (' + markets.length + ')');
check(markets.length === 1 && markets[0].code === 'NGN',
  'and that currency is naira, which is what the console bills and what partners are paid in');
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
/* and no picker to put in it */
check(pr.indexOf('id="ccy-slot"') === -1, 'there is no currency picker on the pricing page');
check(!/\bccy\b/.test(visible(pr)), 'and no stray currency control left rendering');
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
/* There is no guess and there is no choice. The page is naira, full stop.

   Both of the things this used to defend are now moot and both are worth
   a line anyway, because each was a real bug within the last three days:

     a GUESS from the time zone, written to storage as if it were a choice,
     which then beat the naira default for ever on every returning browser

     a REMEMBERED choice, which is meaningless with nothing to choose from
     and would strand anybody who had picked pounds before today

   Neither can come back without this failing first. */
check(/setCcy\('NGN'\)/.test(siteJs),
  'the page sets naira outright rather than reading a stored preference');
check(siteJs.indexOf('guessCcy') === -1,
  'no guess from the time zone or the language survives');
/* Named for the STORAGE rather than for the function. The first version of
   this matched /remembered()/ and so failed on the COMMENT that explains
   why the function was removed, on a file that was already correct. A check
   that a name is absent will always be tripped by the note saying it is. */
check(siteJs.indexOf('CCY_KEY') === -1, 'no currency key survives in the script');
check(siteJs.indexOf('tlb_ccy') === -1,
  'and nothing reads or writes a remembered currency, which would strand anyone who had picked pounds');
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

/* Where somebody goes when neither priced plan fits.

   This used to be a band of its own under the three columns, asking
   "Neither of the two fit?" and answering "that is what Bespoke is for" a
   screen below the Bespoke card. Kayode, 20 Sep: put it in the card. So the
   check moves with it, and it is aimed at the same thing either way, which
   is that the invitation exists somewhere a reader will reach. */
const bespokeCard = (/<h3>Bespoke<\/h3>[\s\S]*?<\/ul>/.exec(html['pricing.html']) || [''])[0];
check(/Tell us what you need/.test(bespokeCard),
  'there is somewhere to go when neither priced plan fits');
check(/href="book\.html"/.test(bespokeCard), 'and it leads somewhere');
check(!/None of these three|Neither of the two fit/.test(html['pricing.html']),
  'the invitation is not also still sitting in a band of its own');

/* The comparison table is not behind a disclosure. A page that has just
   shown somebody three cards and then asks them to click to find out which
   one they are is asking them to opt in to the answer they came for. */
check(!/<details class="disclose">/.test(html['pricing.html']),
  'the plan comparison is open rather than behind a disclosure');
check(html['pricing.html'].indexOf('<div class="plans">') <
      html['pricing.html'].indexOf('<td>Team logins</td>'),
  'and it sits under the cards rather than further down the page');

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
/* Each craft, and ANY of the words the site uses for it. 'garments' had one
   word against it, and the only place the site said "garment" was a lede on
   the product page that has since been removed — while the home page has
   spoken to those studios all along, as bespoke tailors and ready to wear.
   A one-word map made this a check about vocabulary rather than about
   whether a studio sees itself on the site. */
const CRAFT_SAYS = {
  garments: ['garment', 'bespoke tailor', 'ready to wear'],
  footwear: ['shoe'],
  leather: ['bag', 'leather'],
  fabrics: ['fabric'],
  accessories: ['accessor']
};
crafts.forEach(c => {
  const words = CRAFT_SAYS[c] || [c];
  check(words.some(w => everyWord.indexOf(w) !== -1),
    'the site speaks to the "' + c + '" studios the app can be set up as');
});

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
