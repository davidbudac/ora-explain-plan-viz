// Node >= 22 ships a built-in `globalThis.localStorage` getter that resolves to
// `undefined` (Node 22-24) or a method-less object (Node 25) unless
// `--localstorage-file` is set. vitest's jsdom environment leaves pre-existing
// globals alone, so tests would see no usable Web Storage at all. Replace the
// stubs with real jsdom Storage objects when that happens.
import { JSDOM } from 'jsdom';

let dom: JSDOM | null = null;
for (const key of ['localStorage', 'sessionStorage'] as const) {
  const current = (globalThis as Record<string, unknown>)[key] as Partial<Storage> | undefined;
  if (typeof current?.getItem !== 'function') {
    dom ??= new JSDOM('', { url: 'http://localhost/' });
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
}

// jsdom has no matchMedia; the plan provider reads prefers-color-scheme on
// init and several components query pointer / width media. Install a
// never-matching stub (node-environment tests have no window; tests that need
// a matching query stub it themselves).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
