import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeDetailBody } from '../NodeDetailPanel';
import { SqlTextView } from '../views/SqlTextView';
import { ViewControls } from '../WorkspaceTools';
import { cleanup, click } from '../ui/__tests__/testUtils';
import { loadPlan, renderPlanContext } from '../ui/__tests__/planContext';

// Real 19c capture: full(o), index(u), leading(u o) used; use_nl(o u) unused on U; two misspelt hints.
const HINTED = readFileSync(
  resolve(__dirname, '../../lib/parser/__tests__/fixtures/advanced-hint-report-19c.txt'),
  'utf8',
);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => cleanup());

async function mount(ui: React.ReactNode) {
  const plan = renderPlanContext(ui);
  await loadPlan(plan, HINTED);
  return plan.current;
}

describe('hints in the SQL tab', () => {
  it('marks each hint in the SQL text with its Hint Report status', async () => {
    const ctx = await mount(<SqlTextView />);
    act(() => ctx().setHintLens(true));
    const byText = Object.fromEntries(
      Array.from(document.querySelectorAll('[data-testid="sql-hint"]')).map((el) => [el.textContent?.replace(/\s+/g, ' '), el.getAttribute('data-status')]),
    );
    expect(byText).toEqual({
      gather_plan_statistics: 'unknown',
      planviz_hr: 'error',
      'full(o)': 'used',
      'index(u)': 'used',
      'use_nl(o u)': 'used',
      'leading(u o)': 'used',
      'no_such_hint(x)': 'error',
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('4 used');
    expect(text).toContain('1 not used');
    expect(text).toContain('2 syntax errors');
    expect(text).toContain('Hint report: 7 hints (1 unused, 2 syntax errors)');
  });

  it('clicking a hint selects the operation Oracle reported it on and opens the tree', async () => {
    const ctx = await mount(<SqlTextView />);
    act(() => ctx().setViewMode('sql'));
    act(() => ctx().setHintLens(true));
    const full = Array.from(document.querySelectorAll('button[data-testid="sql-hint"]')).find((b) => b.textContent === 'full(o)')!;
    expect(full.getAttribute('title')).toContain('used on operation 5');
    act(() => click(full));
    expect(ctx().selectedNodeId).toBe(5);
    expect(ctx().viewMode).toBe('hierarchical');
  });

  it('lists the outline decisions with the ones the statement hinted credited to the user', async () => {
    const ctx = await mount(<SqlTextView />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('4 in the outline, 4 settled by your hints');
    const decisions = document.querySelector('[data-testid="plan-decisions"]')!;
    expect(decisions.textContent).toContain('Access path');
    expect(decisions.textContent).toContain('Join method');
    expect(decisions.textContent).toContain('Join order');
    const leading = Array.from(decisions.querySelectorAll('button')).find((b) => b.textContent?.startsWith('LEADING'))!;
    act(() => click(leading));
    expect(ctx().selectedNodeId).toBe(3);
  });

  it('offers the Hints lens from the SQL tab and the tree toolbar', async () => {
    const ctx = await mount(<><SqlTextView /><ViewControls /></>);
    act(() => ctx().setViewMode('hierarchical'));
    const buttons = Array.from(document.querySelectorAll('button[aria-pressed]'));
    const toolbar = buttons.find((b) => b.textContent === 'Hints')!;
    expect(toolbar.getAttribute('aria-pressed')).toBe('false');
    act(() => click(toolbar));
    expect(ctx().hintLens).toBe(true);
    expect(toolbar.getAttribute('aria-pressed')).toBe('true');
    expect(document.body.textContent).toContain('Hints lens on');
  });

  it('the SQL tab button toggles the hint highlighting in the SQL text and stays on the SQL tab', async () => {
    const ctx = await mount(<SqlTextView />);
    act(() => ctx().setViewMode('sql'));
    const lens = () => Array.from(document.querySelectorAll('button[aria-pressed]')).find((b) => b.textContent?.startsWith('Hints lens'))!;
    const marked = () => document.querySelectorAll('[data-testid="sql-hint"]').length;
    expect(lens().getAttribute('aria-pressed')).toBe('false');
    expect(marked()).toBe(0);
    expect(document.querySelector('[data-testid="hint-legend"]')).toBeNull();
    act(() => click(lens()));
    expect(ctx().hintLens).toBe(true);
    expect(ctx().viewMode).toBe('sql');
    expect(lens().textContent).toBe('Hints lens on');
    expect(marked()).toBe(7);
    expect(document.querySelector('[data-testid="hint-legend"]')).not.toBeNull();
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Open tree')).toBe(false);
    act(() => click(lens()));
    expect(ctx().hintLens).toBe(false);
    expect(ctx().viewMode).toBe('sql');
    expect(marked()).toBe(0);
  });
});

describe('hints in the details panel', () => {
  it('shows the outline decisions acting on the selected operation next to its Hint Report entries', async () => {
    const ctx = await mount(<NodeDetailBody />);
    act(() => ctx().selectNode(3));
    const decisions = Array.from(document.querySelectorAll('[data-testid="outline-decision"]')).map((el) => el.textContent ?? '');
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toContain('yours');
    expect(decisions[0]).toContain('INDEX_RS_ASC');
    expect(decisions[1]).toContain('LEADING');
    expect(decisions[1]).toContain('#1 in join order');
    expect(document.body.textContent).toContain('use_nl(o u)');
  });

  it('shows outline decisions on a join that carries no Hint Report entry of its own', async () => {
    const ctx = await mount(<NodeDetailBody />);
    act(() => ctx().selectNode(2));
    const decisions = Array.from(document.querySelectorAll('[data-testid="outline-decision"]')).map((el) => el.textContent ?? '');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toContain('USE_NL');
  });
});
