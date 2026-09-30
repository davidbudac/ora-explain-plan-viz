/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.hoisted(() => vi.fn());
vi.mock('../ui', () => ({ toast: { show, dismiss: vi.fn() } }));

import { PopoutWindow } from '../PopoutWindow';
import { cleanup, render } from '../ui/__tests__/testUtils';

beforeEach(() => {
  show.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PopoutWindow', () => {
  it('tells the user the pop-up was blocked, then resets via onClose', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const onClose = vi.fn();

    render(
      <PopoutWindow title="Metadata Explorer" onClose={onClose}>
        <p>content</p>
      </PopoutWindow>,
    );

    expect(onClose).toHaveBeenCalled();
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toMatchObject({
      tone: 'error',
      message: 'Pop-up blocked. Allow pop-ups for this site to open the Metadata Explorer in a window',
    });
  });
});
