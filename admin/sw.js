/* The Label Board — Admin Control Centre service worker
   Bump CACHE on every release so clients pick up new files. */
const CACHE = 'tlb-admin-v11';
const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'icon.svg',
  'css/app.css',
  'js/data.js',
  'js/core.js',
  'js/pages.js',
  'js/pages2.js',
  'js/detail.js',
  'js/metrics.js',
  'js/actions.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network first, fall back to cache when offline. Keeps the console usable
   on a bad connection without ever serving a stale build while online. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // let fonts hit the network

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
