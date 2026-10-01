// Service-worker registration for the offline / installable build.
//
// Production only: in dev the worker would cache stale modules and fight HMR,
// and vitest has no `navigator.serviceWorker`. The worker never intercepts
// cross-origin traffic (AI providers, the local DB agent), see public/sw.js.
import { toast } from '../components/ui';

/** `import.meta.env.BASE_URL` is `/` or `/ora-explain-plan-viz/` (always slash-terminated). */
export function serviceWorkerUrls(baseUrl: string): { url: string; scope: string } {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return { url: `${base}sw.js`, scope: base };
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const { url, scope } = serviceWorkerUrls(import.meta.env.BASE_URL);

  const register = async () => {
    const reg = await navigator.serviceWorker.register(url, { scope });
    const offerReload = (worker: ServiceWorker) => {
      toast.show({
        title: 'New version available',
        message: 'Reload to use the latest version.',
        duration: 0,
        action: {
          label: 'Reload',
          onClick: () => {
            // Reload once the new worker has taken over.
            navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
            worker.postMessage({ type: 'SKIP_WAITING' });
          },
        },
      });
    };
    // Only an update (a controller already exists) gets the prompt; the very
    // first install just starts working silently.
    const watch = (worker: ServiceWorker | null) => {
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerReload(worker);
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offerReload(reg.waiting);
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
  };

  // Wait for load so registration never competes with the app's own startup.
  window.addEventListener('load', () => {
    register().catch((err) => console.warn('[pwa] service worker registration failed', err));
  });
}
