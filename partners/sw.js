/* The Label Board — Partner Portal service worker
   Bump CACHE on every release so clients pick up new files. */
const CACHE = 'tlb-partners-v5';
const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'css/app.css',
  'js/config.js',
  'js/data.js',
  'js/core.js',
  'js/pages.js',
  'js/pages2.js',
  'js/detail.js',
  'js/actions.js',
  'js/live.js',
  'js/auth.js',
  'js/splash.js'
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

/* Network first, fall back to cache when offline. A partner checking earnings
   on a bad connection still sees the last known figures. */
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
