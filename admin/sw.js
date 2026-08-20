// The Label Board Admin Dashboard - Service Worker
const CACHE_NAME = 'tlb-admin-v2';
const ASSETS = [
  'dashboard.html',
  'manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Install event - cache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(err => {
        // Non-critical assets may fail in offline
        console.log('Cache install partial:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip Supabase API calls - always use network
  if (event.request.url.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({error: 'Offline - API unavailable'}), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({'Content-Type': 'application/json'})
        });
      })
    );
    return;
  }

  // For other requests: try network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clonedResponse);
          });
        }
        return response;
      })
      .catch(() => {
        // Return cached version if network fails
        return caches.match(event.request).then(cachedResponse => {
          return cachedResponse || new Response('Offline - Page not cached', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});

// Handle messages from clients
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
