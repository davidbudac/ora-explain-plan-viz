import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { serviceWorkerUrls } from '../pwa';

describe('serviceWorkerUrls', () => {
  it('derives url and scope from the Vite base', () => {
    expect(serviceWorkerUrls('/')).toEqual({ url: '/sw.js', scope: '/' });
    expect(serviceWorkerUrls('/ora-explain-plan-viz/')).toEqual({
      url: '/ora-explain-plan-viz/sw.js',
      scope: '/ora-explain-plan-viz/',
    });
  });

  it('tolerates a base without a trailing slash', () => {
    expect(serviceWorkerUrls('/x')).toEqual({ url: '/x/sw.js', scope: '/x/' });
  });
});

describe('public/manifest.webmanifest', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../../../public/manifest.webmanifest'), 'utf8'));

  it('uses relative start_url/scope so it works under any base', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('standalone');
  });

  it('ships 192/512 and maskable icons that exist on disk', () => {
    const sizes = manifest.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}${i.purpose ? ':' + i.purpose : ''}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']));
    for (const icon of manifest.icons) {
      expect(() => readFileSync(join(__dirname, '../../../public', icon.src))).not.toThrow();
    }
  });
});

// Evaluate public/sw.js against a fake worker global and drive its listeners.
function loadWorker(scope: string) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    registration: { scope },
    location: { href: scope + 'sw.js' },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => {
      skipped = true;
    },
  };
  let skipped = false;
  const deleted: string[] = [];
  type Req = string | { url: string; headers?: Record<string, string> };
  const store = new Map<string, unknown>();
  // Honours `Vary: Origin` like the real Cache API: a stored response only
  // matches a request whose Origin header presence equals the stored request's.
  const hadOrigin = new Map<string, boolean>();
  const urlOf = (r: Req) => (typeof r === 'string' ? r : r.url);
  const originOf = (r: Req) => typeof r !== 'string' && !!r.headers?.origin;
  const cache = {
    match: async (req: Req, opts?: { ignoreVary?: boolean }) => {
      const hit = store.get(urlOf(req)) as { headers?: { vary?: string } } | undefined;
      if (hit?.headers?.vary === 'Origin' && !opts?.ignoreVary && hadOrigin.get(urlOf(req)) !== originOf(req)) return undefined;
      return hit;
    },
    put: async (req: Req, res: unknown) => {
      store.set(urlOf(req), res);
      hadOrigin.set(urlOf(req), originOf(req));
    },
  };
  const caches = {
    keys: async () => ['planviz-old', 'planviz-__BUILD_ID__', 'other-app'],
    delete: async (n: string) => {
      deleted.push(n);
      return true;
    },
    open: async () => cache,
  };
  // The network is down unless a test sets a response.
  const net: { res: unknown } = { res: null };
  const fetchFn = async () => {
    if (!net.res) throw new TypeError('offline');
    return net.res;
  };
  runInNewContext(readFileSync(join(__dirname, '../../../public/sw.js'), 'utf8'), { self, caches, URL, fetch: fetchFn });
  const respond = (url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) => {
    let result: Promise<unknown> | null = null;
    listeners.fetch({
      request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers: init.headers },
      respondWith: (p: Promise<unknown>) => {
        result = p;
      },
    });
    return result as Promise<unknown> | null;
  };
  const handles = (url: string, init: { method?: string; mode?: string } = {}) => {
    const r = respond(url, init);
    r?.catch(() => undefined);
    return r !== null;
  };
  return { listeners, handles, respond, store, cache, net, deleted, wasSkipped: () => skipped };
}

describe('public/sw.js request routing', () => {
  const scope = 'https://example.com/ora-explain-plan-viz/';
  const { handles } = loadWorker(scope);

  it('handles hashed assets inside the scope', () => {
    expect(handles(scope + 'assets/index-abc123.js')).toBe(true);
  });

  it('handles navigation to the app shell only', () => {
    expect(handles(scope, { mode: 'navigate' })).toBe(true);
    expect(handles(scope + '?share=abc', { mode: 'navigate' })).toBe(true);
    expect(handles(scope + 'site/index.html', { mode: 'navigate' })).toBe(false);
  });

  it('never intercepts non-GET requests', () => {
    expect(handles(scope + 'assets/index-abc123.js', { method: 'POST' })).toBe(false);
    expect(handles(scope, { method: 'POST', mode: 'navigate' })).toBe(false);
  });

  it('never intercepts cross-origin requests (AI providers, CDNs, local DB agent)', () => {
    expect(handles('https://api.anthropic.com/v1/messages')).toBe(false);
    expect(handles('https://fonts.googleapis.com/css2?family=Manrope')).toBe(false);
    expect(handles('http://localhost:8765/health')).toBe(false);
    expect(handles('https://example.com:8443' + '/ora-explain-plan-viz/assets/x.js')).toBe(false);
  });

  it('ignores same-origin requests outside the assets folder and other scopes', () => {
    expect(handles(scope + 'manifest.webmanifest')).toBe(false);
    expect(handles('https://example.com/other/assets/x.js')).toBe(false);
  });

  it('works when served from the root scope', () => {
    const root = loadWorker('https://example.com/');
    expect(root.handles('https://example.com/assets/x.css')).toBe(true);
    expect(root.handles('https://example.com/', { mode: 'navigate' })).toBe(true);
  });
});

describe('public/sw.js lifecycle', () => {
  it('only skips waiting when the page asks', () => {
    const w = loadWorker('https://example.com/');
    expect(w.wasSkipped()).toBe(false);
    w.listeners.message({ data: { type: 'noop' } });
    expect(w.wasSkipped()).toBe(false);
    w.listeners.message({ data: { type: 'SKIP_WAITING' } });
    expect(w.wasSkipped()).toBe(true);
  });

  it('removes only older planviz caches on activate', async () => {
    const w = loadWorker('https://example.com/');
    let done: Promise<unknown> = Promise.resolve();
    w.listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(w.deleted).toEqual(['planviz-old']);
  });
});

describe('public/sw.js caching behaviour', () => {
  const scope = 'https://example.com/app/';
  const okResponse = (body: string) => ({ ok: true, type: 'basic', body, clone() { return this; } });

  it('serves the cached shell when a navigation happens offline', async () => {
    const w = loadWorker(scope);
    w.net.res = okResponse('shell-v1');
    expect(((await w.respond(scope, { mode: 'navigate' })) as { body: string }).body).toBe('shell-v1');
    w.net.res = null; // go offline
    expect(((await w.respond(scope + '?share=x', { mode: 'navigate' })) as { body: string }).body).toBe('shell-v1');
  });

  it('prefers the network for navigations when online (fresh deploys)', async () => {
    const w = loadWorker(scope);
    w.net.res = okResponse('shell-v1');
    await w.respond(scope, { mode: 'navigate' });
    w.net.res = okResponse('shell-v2');
    expect(((await w.respond(scope, { mode: 'navigate' })) as { body: string }).body).toBe('shell-v2');
  });

  it('does not cache error responses as the shell', async () => {
    const w = loadWorker(scope);
    w.net.res = { ok: false, type: 'basic', body: 'oops', clone() { return this; } };
    await w.respond(scope, { mode: 'navigate' });
    expect(w.store.size).toBe(0);
  });

  it('serves assets cache-first', async () => {
    const w = loadWorker(scope);
    const url = scope + 'assets/index-abc.js';
    w.net.res = okResponse('js-1');
    expect(((await w.respond(url)) as { body: string }).body).toBe('js-1');
    w.net.res = null; // offline: must come from the cache
    expect(((await w.respond(url)) as { body: string }).body).toBe('js-1');
  });

  it('serves a precached asset (stored without Origin, Vary: Origin) to a request that sends Origin', async () => {
    const w = loadWorker(scope);
    const url = scope + 'assets/index-abc.js';
    await w.cache.put(url, { ok: true, type: 'basic', body: 'precached', headers: { vary: 'Origin' } });
    w.net.res = null; // offline
    const res = (await w.respond(url, { headers: { origin: 'https://example.com' } })) as { body: string };
    expect(res.body).toBe('precached');
  });

  it('falls back to a shell cached with Vary: Origin', async () => {
    const w = loadWorker(scope);
    await w.cache.put(scope, { ok: true, type: 'basic', body: 'shell', headers: { vary: 'Origin' } });
    const res = (await w.respond(scope, { mode: 'navigate', headers: { origin: 'https://example.com' } })) as { body: string };
    expect(res.body).toBe('shell');
  });
});
