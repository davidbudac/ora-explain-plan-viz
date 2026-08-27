// Node >= 22 ships a built-in `globalThis.localStorage` getter that resolves to
// `undefined` unless `--localstorage-file` is set. vitest's jsdom environment
// leaves pre-existing globals alone, so tests would see no Web Storage at all.
// Replace the stubs with real jsdom Storage objects when that happens.
import { JSDOM } from 'jsdom';

let dom: JSDOM | null = null;
for (const key of ['localStorage', 'sessionStorage'] as const) {
  if ((globalThis as Record<string, unknown>)[key] === undefined) {
    dom ??= new JSDOM('', { url: 'http://localhost/' });
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
}
