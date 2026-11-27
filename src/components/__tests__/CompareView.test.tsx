import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CompareView } from '../views/CompareView';
import { cleanup } from '../ui/__tests__/testUtils';
import { loadPlan, renderPlanContext } from '../ui/__tests__/planContext';
import type { CompareMetric } from '../../lib/compare';

const allstats = (starts: number, eRows: number, aRows: number, aTime: string) => `Plan hash value: 1234567890

------------------------------------------------------------------------------------------
| Id  | Operation         | Name   | Starts | E-Rows | A-Rows |   A-Time   | Buffers |
------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT  |        |      1 |        |      1 |${aTime} |       3 |
|   1 |  TABLE ACCESS FULL| ORDERS | ${String(starts).padStart(6)} | ${String(eRows).padStart(6)} | ${String(aRows).padStart(6)} |${aTime} |       3 |
------------------------------------------------------------------------------------------
`;

const METRICS: CompareMetric[] = ['starts', 'rows', 'actualRows', 'actualTime'];

async function renderCompare() {
  const ctx = renderPlanContext(<CompareView />);
  await loadPlan(ctx, allstats(1, 1, 1, '00:00:00.01'));
  act(() => ctx.current().addPlanSlot());
  await loadPlan(ctx, allstats(1000, 50, 1000, '00:00:00.50'));
  act(() => ctx.current().setCompareMetrics(METRICS));
  return ctx;
}

/** Delta cell tone per metric for the TABLE ACCESS FULL row (every third metric cell is the delta). */
function scanDeltaTones(): Record<string, string> {
  const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('TABLE ACCESS FULL'))!;
  const metricCells = [...row.querySelectorAll('td')].slice(5);
  const tones: Record<string, string> = {};
  METRICS.forEach((metric, i) => {
    const cls = metricCells[i * 3 + 2].className;
    tones[metric] = cls.includes('text-green') ? 'improvement' : cls.includes('text-red') ? 'regression' : 'neutral';
  });
  return tones;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('CompareView delta tone', () => {
  it('gives counts no performance verdict and keeps it for elapsed time', async () => {
    await renderCompare();
    expect(scanDeltaTones()).toEqual({
      starts: 'neutral',
      rows: 'neutral',
      actualRows: 'neutral',
      actualTime: 'regression',
    });
  });
});
