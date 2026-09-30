import { describe, expect, it, vi } from 'vitest';
import { runPngExport, shareFeedback } from '../actionFeedback';

describe('shareFeedback', () => {
  it('confirms a clean copy', () => {
    expect(shareFeedback({ kind: 'copied', url: 'x' })).toEqual({ tone: 'success', message: 'Link copied to clipboard' });
  });

  it('passes the long-link warning through', () => {
    expect(shareFeedback({ kind: 'warning', url: 'x', warning: 'Over 8000 characters.' })).toEqual({
      tone: 'warning',
      title: 'Link copied to clipboard',
      message: 'Over 8000 characters.',
    });
  });

  it('falls back to a generic long-link message', () => {
    expect(shareFeedback({ kind: 'warning', url: 'x' })?.message).toMatch(/long/);
  });

  it('points a blocked copy at the dialog', () => {
    expect(shareFeedback({ kind: 'manual', url: 'x' })).toMatchObject({ tone: 'warning' });
  });

  it('stays quiet on errors (the dialog explains them)', () => {
    expect(shareFeedback({ kind: 'error', message: 'too big' })).toBeNull();
  });
});

describe('runPngExport', () => {
  it('reports success after the export resolves', async () => {
    const notify = vi.fn();
    await expect(runPngExport(async () => {}, notify)).resolves.toBe(true);
    expect(notify).toHaveBeenCalledWith({ tone: 'success', message: 'PNG downloaded' });
  });

  it('reports a failure instead of swallowing it', async () => {
    const notify = vi.fn();
    await expect(runPngExport(async () => { throw new Error('canvas tainted'); }, notify)).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith({ tone: 'error', title: 'PNG export failed', message: 'canvas tainted' });
  });

  it('uses a generic message for non-Error rejections', async () => {
    const notify = vi.fn();
    await runPngExport(() => Promise.reject('nope'), notify);
    expect(notify.mock.calls[0][0]).toMatchObject({ tone: 'error', message: 'The plan image could not be generated.' });
  });

  it('explains when no export is registered', async () => {
    const notify = vi.fn();
    await expect(runPngExport(null, notify)).resolves.toBe(false);
    expect(notify.mock.calls[0][0].message).toMatch(/Tree view/);
  });
});
