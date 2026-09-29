/* LAYI Studio service worker.
   Purpose: make the app installable and usable offline, WITHOUT ever serving a
   stale build to an online user. Strategy:
     - navigations  -> network-first (fresh deploy wins), fall back to cached shell offline
     - same-origin static (icons, manifest) -> cache-first
     - Supabase Storage objects -> cache-first, keyed on the object PATH so a
       re-signed url is not a fresh miss (bounded, evicts oldest first)
     - other cross-origin (Supabase API, Google Fonts) -> untouched, straight to network
   Bump CACHE on any change to force a clean swap. */
const CACHE = 'layi-v63';
/* Photos live in their own cache, versioned on its own, because it must
   survive a shell release: see the fetch handler below. */
const MEDIA_CACHE = 'layi-media-v1';
const MEDIA_MAX_BYTES = 300 * 1024 * 1024;   // ~300MB, so it cannot eat a phone
const MEDIA_PATH = '/storage/v1/object/';
const SHELL = [
  '/',
  '/layi_dashboard.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

/* IT DOES NOT SKIP WAITING ANY MORE, AND THAT IS THE FIX.
   skipWaiting() here handed control to a new worker in the middle of a
   session, while the tab carried on running the OLD html and the old
   javascript against the new cache. Two things followed. The page kept
   showing the previous release until the app was properly closed — which
   on an installed iPhone app can be weeks — and for as long as it ran, a
   fetch for an asset could be answered by a build the running code was not
   written for.

   So the new worker installs and then waits. The PAGE decides when to
   swap, because only the page knows whether somebody is halfway through
   an order form. It asks by posting SKIP_WAITING, and reloads itself on
   controllerchange. */
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
});

/* The page's side of that conversation. VERSION is how the app can tell
   the build it is RUNNING from the build this device has CACHED — which is
   exactly the state somebody means by "my app is out of date". */
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (d.type === 'VERSION') {
    var reply = { type: 'VERSION', version: CACHE };
    if (e.ports && e.ports[0]) { e.ports[0].postMessage(reply); return; }
    if (e.source && e.source.postMessage) e.source.postMessage(reply);
  }
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    /* Drop old SHELL caches only. The media cache is deliberately spared:
       it is versioned separately and holds the studio's own photos, and
       clearing it on every release would silently re-download the whole
       library on the next connection — and leave a studio with no signal
       looking at a screen of blank thumbnails right after an update. */
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k !== MEDIA_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* ---- photos, so a workroom with no signal still sees its own work --------
   Photos moved out of the database and into Supabase Storage, which is
   cross-origin — and the rule below is to leave cross-origin to the network.
   That would have made every photo a broken image the moment the signal
   dropped, on an app whose offline behaviour is the point.

   THE PROBLEM WORTH UNDERSTANDING: the bucket is private, so a photo is
   fetched through a SIGNED url, and the token in it changes every time one
   is minted. Cached by full URL, every request after a refresh would be a
   miss against an entry that is already there under a slightly different
   name — a cache that fills up and never answers. So the cache KEY is the
   object path with the query string stripped. Any signed URL for a given
   photo, fresh or long expired, resolves to the same entry.

   That is also what makes offline work: the app hands the browser a URL
   whose token expired days ago, and this answers it from disk without ever
   asking the network whether the token is still good. */
function mediaKey(url) {
  // the object path alone: no token, no transform options, no cache-buster
  return new Request(url.origin + url.pathname, { method: 'GET' });
}

/* Oldest-first eviction. The Cache API has no size or age metadata, so
   insertion order is used, which for this cache is also access order:
   a hit does not reinsert, a miss does. Good enough to bound the disk. */
function trimMediaCache() {
  return caches.open(MEDIA_CACHE).then(function (c) {
    return c.keys().then(function (keys) {
      var total = 0, sizes = [];
      return keys.reduce(function (chain, k) {
        return chain.then(function () {
          return c.match(k).then(function (res) {
            if (!res) { sizes.push({ k: k, n: 0 }); return; }
            return res.clone().arrayBuffer().then(function (b) {
              total += b.byteLength; sizes.push({ k: k, n: b.byteLength });
            }).catch(function () { sizes.push({ k: k, n: 0 }); });
          });
        });
      }, Promise.resolve()).then(function () {
        if (total <= MEDIA_MAX_BYTES) return;
        var over = total - MEDIA_MAX_BYTES, i = 0;
        var next = function () {
          if (over <= 0 || i >= sizes.length) return Promise.resolve();
          var s = sizes[i++];
          over -= s.n;
          return c.delete(s.k).then(next);
        };
        return next();
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* Supabase Storage objects: cache-first, keyed on the path. Anything that
     is not an object read — the API, auth, realtime — falls through to the
     cross-origin rule below and is left alone. */
  if (url.origin !== self.location.origin) {
    if (url.pathname.indexOf(MEDIA_PATH) !== -1) {
      var key = mediaKey(url);
      e.respondWith(
        caches.open(MEDIA_CACHE).then(function (c) {
          return c.match(key).then(function (hit) {
            if (hit) return hit;                       // offline, or seen before
            return fetch(req).then(function (res) {
              /* Only a real image gets stored. A 400 from an expired token
                 or a 403 from a policy must never be cached, or one bad
                 moment poisons that photo until the cache is cleared. */
              if (res && res.status === 200 &&
                  (res.headers.get('content-type') || '').indexOf('image/') === 0) {
                var copy = res.clone();
                c.put(key, copy).then(trimMediaCache).catch(function () {});
              }
              return res;
            }).catch(function () {
              /* No network and nothing cached: answer with a transparent
                 pixel rather than a browser error page inside an <img>. */
              return new Response(
                Uint8Array.from(atob('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='), function (ch) { return ch.charCodeAt(0); }),
                { status: 200, headers: { 'Content-Type': 'image/gif' } });
            });
          });
        })
      );
    }
    return; // everything else cross-origin: straight to the network
  }

  var isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isNav) {
    e.respondWith(
      /* no-store on the REQUEST, not just network-first. Without it the
         browser's own HTTP cache can answer this before the network is
         ever asked, and network-first quietly becomes cache-first for the
         one file that decides which version of the app is running. */
      fetch(new Request(req.url, { cache: 'no-store', credentials: 'same-origin' })).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('/layi_dashboard.html', copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match('/layi_dashboard.html') || caches.match('/'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});

/* Web Push — dormant until the app registers a push subscription (at go-live).
   The client already scaffolds subscribeToPush(); once a push endpoint sends messages,
   these handlers show the alert and focus the app when tapped. No effect until then. */
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'LAYI', body: (e.data && e.data.text && e.data.text()) || '' }; }
  var title = data.title || 'LAYI Studio';
  var opts = { body: data.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url || '/' } };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
