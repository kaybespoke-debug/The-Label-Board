/* ==========================================================================
   The Label Board — website behaviour
   Nothing here is required to read the site. Every page is real HTML and
   stands on its own with JavaScript off; this file adds the menu, the price
   toggle, the tabs, the reveals, and the rule that a photograph which has not
   arrived yet leaves no broken box behind.
   ========================================================================== */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------- menus ---------------- */
  function closeMenu() { document.body.classList.remove('menu-open'); }
  function toggleMenu() { document.body.classList.toggle('menu-open'); }

  /* ---------------- current page in the nav ---------------- */
  function markCurrent() {
    var here = location.pathname.replace(/\/$/, '/index.html').split('/').pop() || 'index.html';
    $$('.hdr-nav a, .drawer a, .menu a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('#')[0].split('/').pop();
      if (href && href === here) { a.classList.add('on'); a.setAttribute('aria-current', 'page'); }
    });
  }

  /* ---------------- configured details ----------------
     Pages already carry the right words. This replaces them only when
     config.js says something different, so one edit updates every page. */
  function applyConfig() {
    if (typeof SITE === 'undefined') return;
    $$('[data-cfg]').forEach(function (el) {
      var key = el.getAttribute('data-cfg');
      var txt = SITE.text[key];
      if (txt != null && el.textContent.trim() !== txt) el.textContent = txt;
    });
    $$('[data-cfg-link]').forEach(function (el) {
      var key = el.getAttribute('data-cfg-link');
      var href = SITE.link[key];
      if (href) el.setAttribute('href', href);
    });
  }

  /* ---------------- photography ----------------
     Two slots, both of which have to look deliberate while empty. A tile
     photo sits over its icon and removes itself if the file is not there; a
     panel photo is only applied once the browser has actually loaded it. */
  function photos() {
    $$('.pic img, .pic-panel img').forEach(function (img) {
      if (img.complete && img.naturalWidth === 0) { img.remove(); return; }
      img.addEventListener('error', function () { img.remove(); });
    });
    $$('[data-photo]').forEach(function (el) {
      var src = el.getAttribute('data-photo');
      if (!src) return;
      var probe = new Image();
      probe.onload = function () {
        /* absolute, because a relative url() inside a custom property is
           resolved against the stylesheet rather than the page, which would
           send it looking in css/ */
        el.style.setProperty('--photo', 'url("' + probe.src + '")');
        el.classList.add('has-photo');
      };
      probe.src = src;
    });
  }

  /* ---------------- price cycle ---------------- */
  /* ---------------- currency ----------------
     The page is written in naira, which is what it says with no JavaScript
     and what the admin console actually bills. Everything here only ever
     replaces that text with another price the configuration already holds.
     Nothing is converted in the browser and no rate is fetched: a rate that
     moved would quote a shop two different numbers on two days without
     anybody having decided anything.

     The first guess comes from the browser's own time zone and language,
     never from an IP lookup. An IP lookup means calling a third party on
     every page load and telling them who is reading our pricing, for a
     guess that a picker sitting right there can correct in one click. */
  var CCY_KEY = 'tlb_ccy';
  var cycleNow = 'monthly';
  var ccyNow = null;

  function currencies() {
    return (typeof SITE !== 'undefined' && SITE.currencies) || [];
  }
  function findCcy(code) {
    var list = currencies();
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    return list[0] || null;
  }
  function remembered() {
    try { return window.localStorage.getItem(CCY_KEY); } catch (e) { return null; }
  }
  function remember(code) {
    try { window.localStorage.setItem(CCY_KEY, code); } catch (e) { /* private mode, fine */ }
  }
  function guessCcy() {
    if (typeof SITE === 'undefined') return 'NGN';
    var zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { zone = ''; }
    if (SITE.currencyByZone && SITE.currencyByZone[zone]) return SITE.currencyByZone[zone];
    var lang = (navigator.language || '').toUpperCase();
    var region = lang.split('-')[1] || '';
    if (SITE.currencyByRegion && SITE.currencyByRegion[region]) return SITE.currencyByRegion[region];
    /* a whole continent shares a handful of zones, so this is the last resort */
    if (zone.indexOf('Europe/') === 0) return 'EUR';
    if (zone.indexOf('America/') === 0) return 'USD';
    return 'NGN';
  }
  function group(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function paint() {
    var c = findCcy(ccyNow);
    if (!c) return;
    var annual = cycleNow === 'annual';
    $$('[data-plan]').forEach(function (el) {
      var amount = c[el.getAttribute('data-plan')];
      if (amount == null) return;
      var amt = el.querySelector('[data-monthly]');
      var sym = el.querySelector('.cur');
      if (amt) amt.textContent = group(annual ? amount * 10 : amount);
      if (sym) sym.textContent = c.symbol;
    });
    $$('[data-per]').forEach(function (el) {
      el.textContent = annual ? 'per year' : 'per month';
    });
    $$('[data-note-monthly]').forEach(function (el) {
      var note = el.getAttribute(annual ? 'data-note-annual' : 'data-note-monthly');
      el.textContent = c.code === 'NGN' ? note : note + ', invoiced in ' + c.code;
    });
    $$('[data-ccy-code]').forEach(function (el) { el.textContent = c.code; });
  }

  function setCcy(code) {
    ccyNow = findCcy(code) ? code : 'NGN';
    remember(ccyNow);
    var sel = $('#ccy');
    if (sel && sel.value !== ccyNow) sel.value = ccyNow;
    paint();
  }

  function setCycle(cycle) {
    cycleNow = cycle === 'annual' ? 'annual' : 'monthly';
    $$('[data-cycle]').forEach(function (b) {
      var on = b.getAttribute('data-cycle') === cycleNow;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    paint();
  }

  /* Builds the picker from the configuration, so adding a market is one line
     in config.js and nothing else. It is built rather than written into the
     page because with no JavaScript there is nothing it could do, and a dead
     control is worse than no control. */
  function buildCcyPicker() {
    var slot = $('#ccy-slot');
    if (!slot || !currencies().length) return;
    var sel = document.createElement('select');
    sel.id = 'ccy';
    sel.className = 'ccy';
    sel.setAttribute('aria-label', 'Currency');
    currencies().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.code;
      o.textContent = c.code + ' \u00b7 ' + c.label;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { setCcy(sel.value); });
    slot.appendChild(sel);
    setCcy(remembered() || guessCcy());
  }

  /* ---------------- tabs ----------------
     A screenshot inside a hidden pane is lazy, so the browser does not fetch it
     until the pane is shown, and the first click on a tab leaves an empty box
     for a beat. Once the page has finished loading and the browser is idle, the
     panes that are still hidden are told to load anyway. The picture above the
     fold has already been painted by then, so nothing is taken from it. */
  function warmPanes() {
    $$('.pane img[loading="lazy"]').forEach(function (img) { img.loading = 'eager'; });
  }
  /* Warmed when the tab strip is nearly in view, not on load. Four screens is
     most of a megabyte, and somebody who reads the hero and leaves should not
     pay for it on a phone. By the time they have read the section above the
     tabs, the pictures are there. Same sweep as the reveals, for the same
     reason: an observer that never delivers would leave the panes cold. */
  function warmPanesWhenQuiet() {
    var strips = $$('.tabs, .industries');
    if (!strips.length) return;
    function sweep() {
      var h = window.innerHeight || 800;
      var near = strips.some(function (el) {
        var r = el.getBoundingClientRect();
        return r.top < h * 1.5 && r.bottom > -h;
      });
      if (!near) return;
      warmPanes();
      window.removeEventListener('scroll', sweep);
      window.removeEventListener('resize', sweep);
    }
    window.addEventListener('scroll', sweep, { passive: true });
    window.addEventListener('resize', sweep);
    sweep();
  }

  /* Keyed on the attribute rather than the class, because two different
     controls open panes now: the pill tabs on Product and the booking page,
     and the photograph tiles on the home page. Selecting .tab only would leave
     a tile's highlight behind while its panel opened, which it did. */
  function selectTab(group, name) {
    $$('[data-group="' + group + '"][data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.pane[data-group="' + group + '"]').forEach(function (p) {
      p.classList.toggle('on', p.getAttribute('data-pane') === name);
    });
  }

  /* ---------------- in page links ----------------
     Deliberately window.scrollTo rather than scrollIntoView: it is the one
     that behaves the same everywhere, including inside app shells. */
  function jumpTo(id) {
    var el = document.getElementById(id);
    if (!el) return false;
    var top = el.getBoundingClientRect().top + window.pageYOffset - 88;
    window.scrollTo(0, Math.max(0, top));
    return true;
  }

  /* ---------------- reveal on scroll ----------------
     A plain measurement on scroll rather than an observer. There are only a
     dozen of these on a page, so the cost is nothing, and an observer that
     never delivers its first batch would leave the copy invisible. */
  function reveal() {
    var items = $$('.reveal');
    if (!items.length) return;

    function sweep() {
      var h = window.innerHeight || 800;
      var left = 0;
      items.forEach(function (el) {
        if (el.classList.contains('in')) return;
        var r = el.getBoundingClientRect();
        if (r.top < h * 0.99 && r.bottom > 0) el.classList.add('in'); else left++;
      });
      if (!left) {
        window.removeEventListener('scroll', sweep);
        window.removeEventListener('resize', sweep);
      }
    }

    sweep();
    window.addEventListener('scroll', sweep, { passive: true });
    window.addEventListener('resize', sweep);
    window.addEventListener('load', sweep);
    /* whatever happens, nothing stays hidden for longer than this */
    setTimeout(function () { items.forEach(function (el) { el.classList.add('in'); }); }, 3000);
  }

  /* ---------------- boot ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    /* tells the head script this file arrived, so it leaves the reveals alone */
    window.__tlbReady = true;
    applyConfig();
    markCurrent();
    photos();
    reveal();

    /* A link like features.html#money has to open that area, not just scroll
       to a hidden one. The hash is scrubbed before it goes near a selector. */
    var hash = (location.hash || '').slice(1).replace(/[^a-z0-9-]/gi, '');
    if (hash) {
      var pane = $('.pane[data-pane="' + hash + '"]');
      if (pane) selectTab(pane.getAttribute('data-group'), hash);
      /* a folded section that is linked to has to be open when you land */
      var d = document.getElementById(hash);
      if (d && d.tagName === 'DETAILS') d.open = true;
    }

    $$('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });

    buildCcyPicker();

    warmPanesWhenQuiet();

    /* ---------------- the trade tiles ----------------
       Kayode asked for the detail to appear when you point at a tile. Hover is
       only half an answer, because a phone has no cursor and this site is read
       on a phone first, so a tile is a real control: tapping or clicking it
       opens its panel, which is what the click delegate below already does for
       anything carrying data-tab.

       Hover is then an extra, and only where there is a true cursor. The media
       query matters: a touch screen reports hover on the tap that precedes the
       click, so without it a tap would open one panel on touch and another on
       click. The small delay stops a cursor dragged across the row from
       flipping through all eight, and nothing closes on leaving, so the panel
       you last looked at stays put. */
    var fineCursor = window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    if (fineCursor) {
      var hoverTimer = null;
      $$('.industries [data-tab]').forEach(function (tile) {
        tile.addEventListener('mouseenter', function () {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(function () {
            selectTab(tile.getAttribute('data-group'), tile.getAttribute('data-tab'));
          }, 110);
        });
        tile.addEventListener('mouseleave', function () { clearTimeout(hoverTimer); });
      });
    }

    document.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-act],[data-cycle],[data-tab],[data-back],a[href^="#"]') : null;

      if (!t) return;

      /* The back link. Its href points at the section on the home page it came
         from, which is right for somebody who arrived from the navigation and
         is what happens with no JavaScript. But if they got here from our own
         site, going back through history is the only thing that returns them
         to the exact place on the page they left, rather than the top of the
         section, and that is the whole point of the link. */
      if (t.hasAttribute && t.hasAttribute('data-back')) {
        var from = document.referrer || '';
        if (from.indexOf(location.origin + '/') === 0 && history.length > 1) {
          ev.preventDefault();
          history.back();
        }
        return;
      }

      var act = t.getAttribute('data-act');
      if (act === 'menu') { ev.preventDefault(); toggleMenu(); return; }

      if (t.getAttribute('data-cycle')) { ev.preventDefault(); setCycle(t.getAttribute('data-cycle')); return; }

      /* Deliberately keyed on the attribute, not the class. Jump links wear the
         same pill styling without being tabs, and treating those as tabs would
         swallow the jump. */
      if (t.getAttribute('data-tab')) {
        ev.preventDefault();
        var name = t.getAttribute('data-tab');
        selectTab(t.getAttribute('data-group'), name);
        if (history.replaceState) history.replaceState(null, '', '#' + name);
        return;
      }

      var href = t.getAttribute('href') || '';
      if (href.length > 1 && href.charAt(0) === '#') {
        var target = document.getElementById(href.slice(1));
        if (target && target.tagName === 'DETAILS') target.open = true;
        if (jumpTo(href.slice(1))) { ev.preventDefault(); closeMenu(); history.replaceState(null, '', href); }
      }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { closeMenu(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 1000) closeMenu();
    });

    $$('.drawer a').forEach(function (a) { a.addEventListener('click', closeMenu); });
  });
})();

/* ==========================================================================
   Enquiries also reach the operator console
   --------------------------------------------------------------------------
   The forms post to Netlify exactly as they always did. Nothing below changes
   that: no preventDefault, no interception, no rewriting of the action. The
   submission goes to Netlify whether this code runs, fails, or never loads at
   all, which is the property worth protecting — a marketing form that silently
   stops reaching anybody is the most expensive bug a website can have.

   This adds a second copy, sent to the database, so the console can see and
   work an enquiry instead of somebody remembering to open Netlify's dashboard.
   It is fire-and-forget with keepalive, because the browser is navigating to
   the thank-you page a few milliseconds later and a normal fetch would be
   cancelled mid-flight.
   ========================================================================== */
(function () {
  var FORM_KIND = { demo: 'demo', contact: 'contact', partner: 'partner', referral: 'referral' };
  /* The honeypot on each form. A bot fills every field it can see; a person
     never sees these, so anything in one means we write nothing and say
     nothing — the database answers "fine" so the bot learns no more from
     being refused than from succeeding. */
  var TRAPS = ['studio-url', 'site-url', 'website-url', 'extra-url'];
  /* Fields that have a column of their own. Everything else on the form is
     carried in `extra`, so adding a question to a form never silently drops
     the answer. */
  var MAPPED = ['name', 'email', 'phone', 'studio', 'business', 'company', 'note', 'message', 'consent', 'form-name'];

  function val(fd, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = fd.get(keys[i]);
      if (v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  function send(form) {
    var cfg = (typeof SITE !== 'undefined') ? SITE : null;
    if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
    var kind = FORM_KIND[form.getAttribute('name')];
    if (!kind) return;

    var fd;
    try { fd = new FormData(form); } catch (e) { return; }

    var trap = '';
    TRAPS.forEach(function (t) { var v = fd.get(t); if (v && String(v).trim()) trap = String(v).trim(); });

    var extra = {};
    fd.forEach(function (v, k) {
      if (MAPPED.indexOf(k) >= 0 || TRAPS.indexOf(k) >= 0) return;
      if (v === null || String(v).trim() === '') return;
      extra[k] = String(v).slice(0, 500);
    });

    var body = {
      p_kind: kind,
      p_name: val(fd, ['name']),
      p_email: val(fd, ['email']),
      p_phone: val(fd, ['phone']),
      p_business: val(fd, ['studio', 'business', 'company']),
      p_message: val(fd, ['note', 'message']),
      p_source_page: (location.pathname || '').replace(/^\//, '') || 'index.html',
      p_extra: extra,
      p_trap: trap
    };

    try {
      fetch(cfg.supabaseUrl + '/rest/v1/rpc/submit_enquiry', {
        method: 'POST',
        headers: {
          'apikey': cfg.supabaseAnonKey,
          'Authorization': 'Bearer ' + cfg.supabaseAnonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        /* the page is navigating; without this the request is cancelled */
        keepalive: true
      }).catch(function () { /* Netlify still has it */ });
    } catch (e) { /* Netlify still has it */ }
  }

  /* Capture phase, so this runs before anything else can stop the event —
     and it never stops it itself. */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    try { send(form); } catch (err) { /* never let this break a submission */ }
  }, true);
})();
