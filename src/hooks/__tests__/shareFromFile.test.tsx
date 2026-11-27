import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { loadPlan, renderPlanContext } from '../../components/ui/__tests__/planContext';

// What buildShareLink returns is decided per test: the single-file build opened
// from file:// produces links to the hosted app (see shareBaseUrl in lib/url.ts).
const link = vi.hoisted(() => ({ url: '', fail: false }));
vi.mock('../../lib/url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/url')>();
  return {
    ...actual,
    buildShareLink: async () => {
      if (link.fail) throw new Error('boom');
      return { ok: true as const, url: link.url, warnings: [] };
    },
  };
});

const PUBLIC_LINK = 'https://davidbudac.github.io/ora-explain-plan-viz/#gz=H4sIAAAA';

beforeEach(() => {
  link.url = '';
  link.fail = false;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('share', () => {
  it.each([
    ['a link to the hosted app', PUBLIC_LINK],
    ['a same-origin link', `${window.location.origin}/#gz=H4sIAAAA`],
  ])('hands out %s without touching the address bar', async (_name, url) => {
    link.url = url;
    const handle = renderPlanContext();
    await loadPlan(handle);
    const replaceState = vi.spyOn(window.history, 'replaceState');

    await act(async () => {
      await handle.current().share();
    });

    expect(replaceState).not.toHaveBeenCalled();
    const notice = handle.current().shareNotice;
    expect(notice).not.toBeNull();
    expect(notice?.kind).not.toBe('error');
    expect(notice && 'url' in notice ? notice.url : '').toBe(url);
    expect(window.location.hash).toBe('');
  });

  it('reports a failure instead of rejecting', async () => {
    link.fail = true;
    const handle = renderPlanContext();
    await loadPlan(handle);

    await act(async () => {
      await handle.current().share();
    });

    expect(handle.current().shareNotice).toEqual({ kind: 'error', message: 'Could not create a share link: boom' });
  });
});
