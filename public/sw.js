// ---------------------------------------------------------------------------
// ArriveO'Clock service worker — makes the app shell launch offline and be
// installable. Strategy:
//   • same-origin GET (HTML/JS/CSS/icons): stale-while-revalidate, so the app
//     opens instantly and offline after the first visit.
//   • navigations offline: fall back to the cached app shell ("/").
//   • cross-origin (map tiles, Photon, OSRM, Supabase): left to the network —
//     they need connectivity and shouldn't be cached blindly.
//
// The alarm itself keeps working offline mid-journey regardless of this SW:
// it runs on device GPS + local maths once a route is loaded.
// ---------------------------------------------------------------------------

const CACHE = 'aoc-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tiles / APIs → network
  if (url.pathname.startsWith('/api/')) return; // never cache function calls

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        network; // refresh in background
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('/')) || Response.error();
      return Response.error();
    })()
  );
});
