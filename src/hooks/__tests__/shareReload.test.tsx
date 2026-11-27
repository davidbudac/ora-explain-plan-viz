import { act } from 'react';
import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { renderPlanContext } from '../../components/ui/__tests__/planContext';
import type { PlanHandle } from '../../components/ui/__tests__/planContext';
import { loadSession } from '../../lib/session';

const EXAMPLE = '28-sql_monitor-Partition Range Iterator';
const readExample = (file: string) => readFileSync(join(__dirname, '../../examples', file), 'utf-8');
const PLAN = readExample(`${EXAMPLE}.txt`);

/**
 * The example's real bundle plus a histogram too large for a share link
 * (high-entropy endpoint values, so gzip cannot shrink them).
 */
function oversizedBundle(): string {
  const bundle = JSON.parse(readExample(`${EXAMPLE}.meta.json`));
  const table = Object.values(bundle.objects as Record<string, { columns?: Record<string, { histogram?: unknown }> }>)
    .find((object) => object.columns);
  const column = Object.values(table!.columns!)[0];
  let seed = 42;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed.toString(16);
  };
  column.histogram = {
    type: 'FREQUENCY',
    buckets: 254,
    endpoints: Array.from({ length: 4000 }, (_, i) => ({ value: `${next()}${next()}`, endpoint_number: i })),
  };
  return JSON.stringify(bundle);
}

/** What a browser reload does: pagehide flushes the autosave, then the app starts from the same address. */
async function reload(): Promise<PlanHandle> {
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  cleanup();
  const handle = renderPlanContext();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return handle;
}

beforeEach(() => {
  // jsdom's Blob has no stream(); Node's lets the real gzip share link run.
  vi.stubGlobal('Blob', NodeBlob);
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('reload after sharing', () => {
  it('brings back the full local workspace, not the reduced link', async () => {
    const sender = renderPlanContext();
    await act(async () => {
      await sender.current().loadExample({ name: 'Iterator', category: 'sql_monitor', data: PLAN, metadata: oversizedBundle() });
    });
    expect(sender.current().metadataBundle).not.toBeNull();
    act(() => {
      sender.current().renamePlanSlot(0, 'Before fix');
    });

    let warning = '';
    await act(async () => {
      const result = await sender.current().sharePlan();
      expect(result.ok).toBe(true);
      if (result.ok) warning = result.warning ?? '';
    });
    expect(warning).toContain('Metadata bundle omitted');

    const reloaded = await reload();
    const ctx = reloaded.current();
    expect(ctx.plans).toHaveLength(1);
    expect(ctx.plans[0].customLabel).toBe('Before fix');
    expect(ctx.metadataBundle).not.toBeNull();

    await reload();
    const saved = loadSession();
    expect(saved?.slots[0].customLabel).toBe('Before fix');
    expect(saved?.slots[0].metadataText).toBeDefined();
  });
});
