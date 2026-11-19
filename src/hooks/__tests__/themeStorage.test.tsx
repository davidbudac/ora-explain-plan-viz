import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { renderPlanContext } from '../../components/ui/__tests__/planContext';

/** localStorage as browsers expose it when site data is blocked: every call throws. */
function blockedStorage(): Storage {
  const deny = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return { length: 0, clear: deny, getItem: deny, key: deny, removeItem: deny, setItem: deny };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
  localStorage.clear();
});

describe('theme persistence', () => {
  it('remembers the chosen theme across mounts', () => {
    const first = renderPlanContext();
    expect(first.current().theme).toBe('light');
    act(() => first.current().setTheme('dark'));
    expect(localStorage.getItem('theme')).toBe('dark');
    cleanup();

    const second = renderPlanContext();
    expect(second.current().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('starts and switches theme when localStorage is blocked', () => {
    vi.stubGlobal('localStorage', blockedStorage());

    const handle = renderPlanContext();
    // vitest.setup.ts stubs matchMedia to never match, so the fallback is light.
    expect(handle.current().theme).toBe('light');

    act(() => handle.current().setTheme('dark'));
    expect(handle.current().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
