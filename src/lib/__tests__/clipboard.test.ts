// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyToClipboard } from '../clipboard';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * jsdom exposes neither a real Clipboard API nor a working execCommand, so we
 * stub both to assert the fallback ordering and the boolean contract that the
 * share flow relies on.
 */
describe('copyToClipboard', () => {
  it('uses the async Clipboard API in a secure context and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    const ok = await copyToClipboard('https://example.com/#gz=abc');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://example.com/#gz=abc');
  });

  it('falls back to execCommand when the async write is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    // execCommand is not implemented in jsdom; define it for the fallback path.
    (document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;

    const ok = await copyToClipboard('fallback-text');

    expect(writeText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(ok).toBe(true);
  });

  it('falls back to execCommand on an insecure origin where the async API is skipped', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;

    const ok = await copyToClipboard('http-origin-text');

    // Async API must be skipped entirely when the context is insecure.
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(ok).toBe(true);
  });

  it('returns false (never throws) when every strategy fails', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const execCommand = vi.fn().mockReturnValue(false);
    (document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;

    const ok = await copyToClipboard('nope');

    expect(ok).toBe(false);
  });
});
