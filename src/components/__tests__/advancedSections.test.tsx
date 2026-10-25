import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeDetailBody } from '../NodeDetailPanel';
import { SqlTextView } from '../views/SqlTextView';
import { cleanup } from '../ui/__tests__/testUtils';
import { loadPlan, renderPlanContext } from '../ui/__tests__/planContext';

const ADVANCED = readFileSync(
  resolve(__dirname, '../../lib/parser/__tests__/fixtures/advanced-allstats-19c.txt'),
  'utf8',
);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => cleanup());

async function mount(ui: React.ReactNode) {
  const plan = renderPlanContext(ui);
  await loadPlan(plan, ADVANCED);
  return plan.current;
}

describe('ADVANCED sections in the UI', () => {
  it('shows hints with status and reason, and the projection, for the selected operation', async () => {
    const ctx = await mount(<NodeDetailBody />);
    act(() => ctx().selectNode(1));

    const text = document.body.textContent ?? '';
    expect(text).toContain('no_such_hint');
    expect(text).toContain('syntax error');
    expect(text).toContain('index(o)');
    expect(text).toContain('unused');
    expect(text).toContain('hint on view cannot be pushed into view');
    expect(text).toContain('Projection');
    expect(text).toContain('COUNT(*)[22]');
  });

  it('shows no hint or projection sections for an operation without them', async () => {
    const ctx = await mount(<NodeDetailBody />);
    act(() => ctx().selectNode(0));
    const headings = Array.from(document.querySelectorAll('h4')).map((h) => h.textContent);
    expect(headings).not.toContain('Hints');
    expect(headings).not.toContain('Projection');
  });

  it('lists the outline hints and the hint summary under the SQL text', async () => {
    await mount(<SqlTextView />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Hint report: 3 hints (1 unused, 2 syntax errors)');
    expect(text).toContain('Outline hints');
    expect(text).toContain('IGNORE_OPTIM_EMBEDDED_HINTS');
    expect(text).toContain('Copy as hint block');
  });
});
