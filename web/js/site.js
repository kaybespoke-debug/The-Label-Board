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
  function setCycle(cycle) {
    $$('[data-cycle]').forEach(function (b) {
      var on = b.getAttribute('data-cycle') === cycle;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $$('[data-monthly]').forEach(function (el) {
      el.textContent = el.getAttribute(cycle === 'annual' ? 'data-annual' : 'data-monthly');
    });
    $$('[data-per]').forEach(function (el) {
      el.textContent = cycle === 'annual' ? 'per year' : 'per month';
    });
    $$('[data-note-monthly]').forEach(function (el) {
      el.textContent = el.getAttribute(cycle === 'annual' ? 'data-note-annual' : 'data-note-monthly');
    });
  }

  /* ---------------- tabs ---------------- */
  function selectTab(group, name) {
    $$('.tab[data-group="' + group + '"]').forEach(function (b) {
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

    document.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-act],[data-cycle],[data-tab],a[href^="#"]') : null;

      if (!t) return;

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
