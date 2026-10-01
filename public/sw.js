/* Service worker: makes the app open offline. Plain JS, no dependencies.
 *
 * Strategy (everything is scoped to the SW's own scope, so the same file works
 * under `/` and under the GitHub Pages base `/ora-explain-plan-viz/`):
 *  - Hashed build assets (`<scope>assets/...`): cache-first. Names change on
 *    every build, so a cached copy never goes stale.
 *  - Navigations (the app shell): network-first, falling back to the cached
 *    shell, so a fresh deploy is picked up online and the app still opens
 *    offline.
 *  - Everything else is NOT intercepted: non-GET requests, cross-origin
 *    requests (AI providers, CDNs, fonts) and the local DB agent (a different
 *    origin/port) all go straight to the network. Plan data never touches the
 *    cache; only the static app files do.
 *
 * `__BUILD_ID__` is replaced at build time (vite.config.ts) so every deploy
 * gets a new cache name and the old caches are removed on activate.
 */
const BUILD_ID = '__BUILD_ID__';
const CACHE_PREFIX = 'planviz-';
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;

const SCOPE = new URL(self.registration ? self.registration.scope : './', self.location.href);
/** The cached app shell is always stored under the scope URL itself. */
const SHELL_URL = SCOPE.href;
const ASSETS_PREFIX = SCOPE.pathname + 'assets/';

/** Decide how a request is handled: 'asset' | 'navigate' | null (hands off). */
function classify(request) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return null;
  if (url.pathname.startsWith(ASSETS_PREFIX)) return 'asset';
  // The app is a single page: only the scope root (or its index.html) is the
  // shell. Other in-scope documents (e.g. a showcase page) pass through.
  if (request.mode === 'navigate' && (url.pathname === SCOPE.pathname || url.pathname === SCOPE.pathname + 'index.html')) {
    return 'navigate';
  }
  return null;
}

// Pre-cache the shell plus the assets it references, so the very first visit
// is already usable offline (those requests happen before the SW controls the
// page and would otherwise never be cached).
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const res = await fetch(SHELL_URL, { cache: 'reload' });
      if (!res.ok) throw new Error('shell fetch failed: ' + res.status);
      const html = await res.clone().text();
      await cache.put(SHELL_URL, res);
      const refs = new Set();
      for (const m of html.matchAll(/(?:href|src)="([^"]*\/assets\/[^"]+)"/g)) {
        const u = new URL(m[1], SHELL_URL);
        if (u.origin === SCOPE.origin) refs.add(u.href);
      }
      await Promise.all([...refs].map((href) => cache.add(href).catch(() => undefined)));
    })(),
  );
  // No skipWaiting() here: the page offers "reload" and asks us to activate
  // via the SKIP_WAITING message, so an open session is never swapped silently.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const kind = classify(event.request);
  if (kind === 'asset') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        // ignoreVary: precached copies were fetched without an Origin header but
        // the page's module/CSS requests send one, and servers may answer
        // `Vary: Origin`. Safe because asset names are content-hashed.
        const hit = await cache.match(event.request, { ignoreVary: true });
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      }),
    );
  } else if (kind === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const res = await fetch(event.request);
          // Cache only a real shell response (not an error page), under one key
          // so `?share=` / deep-link navigations all fall back to the same shell.
          if (res.ok && res.type === 'basic') cache.put(SHELL_URL, res.clone());
          return res;
        } catch (err) {
          const shell = await cache.match(SHELL_URL, { ignoreVary: true });
          if (shell) return shell;
          throw err;
        }
      })(),
    );
  }
});
