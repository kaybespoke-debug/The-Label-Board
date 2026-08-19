/* LAYI Studio service worker.
   Purpose: make the app installable and usable offline, WITHOUT ever serving a
   stale build to an online user. Strategy:
     - navigations  -> network-first (fresh deploy wins), fall back to cached shell offline
     - same-origin static (icons, manifest) -> cache-first
     - cross-origin (Supabase, Google Fonts) -> untouched, straight to network
   Bump CACHE on any change to force a clean swap. */
const CACHE = 'layi-v22';
const SHELL = [
  '/',
  '/layi_dashboard.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return; // leave CDNs/Supabase to the network

  var isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isNav) {
    e.respondWith(
      fetch(req).then(function (res) {
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
