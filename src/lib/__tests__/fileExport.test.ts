import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.hoisted(() => vi.fn());
vi.mock('../../components/ui', () => ({ toast: { show, dismiss: vi.fn() } }));

import { downloadTextFile, popupBlockedMessage, printHtml } from '../fileExport';

beforeEach(() => {
  show.mockReset();
  // jsdom has no object-URL support
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('popupBlockedMessage', () => {
  it('names what could not be opened', () => {
    expect(popupBlockedMessage('Metadata Explorer')).toBe(
      'Pop-up blocked. Allow pop-ups for this site to open the Metadata Explorer in a window',
    );
  });
});

describe('downloadTextFile', () => {
  it('clicks a download anchor with the file name and cleans up the object URL', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    expect(downloadTextFile('select 1', 'plan.sql')).toBe(true);

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('plan.sql');
    expect(anchor.href).toBe('blob:fake');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    // The anchor is removed again
    expect(document.body.contains(anchor)).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });

  it('raises an error toast (and returns false) when the browser refuses', () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error('Blob URLs are disabled');
    });

    expect(downloadTextFile('x', 'report.html', 'text/html')).toBe(false);

    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toMatchObject({
      tone: 'error',
      title: 'Download failed',
      message: 'Blob URLs are disabled',
    });
  });
});

describe('printHtml', () => {
  it('toasts the pop-up message when the new window is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(printHtml('<p>hi</p>')).toBe(false);

    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toMatchObject({
      tone: 'error',
      message: popupBlockedMessage('print view'),
    });
  });

  it('writes the document and opens the print dialog after a beat', () => {
    vi.useFakeTimers();
    const fakeWin = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);

    expect(printHtml('<p>hi</p>')).toBe(true);

    expect(fakeWin.document.write).toHaveBeenCalledWith('<p>hi</p>');
    expect(fakeWin.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(fakeWin.print).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
  });

  it('closes the window and toasts when the document cannot be written', () => {
    const fakeWin = {
      document: {
        open: vi.fn(),
        write: vi.fn(() => {
          throw new Error('nope');
        }),
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);

    expect(printHtml('<p>hi</p>')).toBe(false);
    expect(fakeWin.close).toHaveBeenCalled();
    expect(show.mock.calls[0][0]).toMatchObject({ tone: 'error', message: 'nope' });
  });
});
