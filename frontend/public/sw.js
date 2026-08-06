/* TravelMind AI Service Worker
 * - App shell: cache-first (offline capable UI)
 * - API: network-first with cache fallback for GET requests
 * - Itinerary data: cached so trips stay viewable offline
 * - Live-only features clearly fail with "Live data unavailable" while offline
 */
const VERSION = 'travelmind-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-maskable.svg'];
const ITINERARY_CACHE = 'travelmind-itinerary-cache';
const SHELL_CACHE = 'travelmind-shell-cache';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('travelmind-') && k !== SHELL_CACHE && k !== ITINERARY_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never cache cross-origin or non-app requests except same-origin API GETs
  if (url.origin !== self.location.origin) return;

  // API: network-first with cache fallback for itinerary/health reads
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.includes('/itinerary') || url.pathname.includes('/expenses/summary')) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(ITINERARY_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => caches.match(request).then((cached) => cached || offlineResponse('Live data unavailable while offline')))
      );
      return;
    }
    // Other API calls: don't cache, but respond gracefully offline
    event.respondWith(fetch(request).catch(() => offlineResponse('Live data unavailable while offline')));
    return;
  }

  // Static assets / app shell: cache-first, network fallback
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((response) => {
            if (response.ok && (url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname))) {
              const clone = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => caches.match('/index.html'))
    )
  );
});

function offlineResponse(message) {
  return new Response(JSON.stringify({ success: false, message, offline: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}
