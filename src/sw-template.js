// Service worker (PWA): generated at build by vite.config.ts from this template — __BUILD__ and
// __PRECACHE__ are filled in. Precaches the whole game (page, hashed bundles, sprites, textures,
// font, icons) so it opens offline and loads instantly; each deploy gets a new cache name.
//  - pages (navigation): network first, cache fallback (a deploy shows up on the next open)
//  - version.json: network only (the in-game "새 버전" check must see the live deploy)
//  - Polyfork CDN props: stale-while-revalidate (they work offline after the first visit)
//  - everything else same-origin: cache first (names are hashed or change with the build)
const CACHE = 'dig-down-__BUILD__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache (GitHub Pages sends max-age=600): otherwise a
  // new worker could precache the previous deploy's unhashed files (sprites, page)
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dig-down-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.endsWith('/version.json')) return; // network only
  if (url.origin === 'https://polyfork.dev') {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // no-store: always the live page when online (an HTTP-cached copy kept old builds up to 10 min)
    e.respondWith(fetch(req, { cache: 'no-store' }).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return r;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('3d.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});
