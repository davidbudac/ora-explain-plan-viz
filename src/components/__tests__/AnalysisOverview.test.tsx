/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdvisorReport } from '../../lib/advisor';
import type { ParsedPlan, PlanNode } from '../../lib/types';

function node(id: number, operation: string, objectName?: string): PlanNode {
  return { id, depth: id === 0 ? 0 : 1, operation, objectName, parentId: id === 0 ? undefined : 0, children: [] };
}

const ctx = vi.hoisted(() => ({
  parsedPlan: null as unknown,
  advisorReport: null as unknown,
  hottestNodeId: null as number | null,
  metadataBundle: null as unknown,
  focusMode: false,
  selectNode: vi.fn(),
  narrow: false,
}));

vi.mock('../../hooks/usePlanContext', () => ({ usePlan: () => ctx }));
vi.mock('../../hooks/useNarrowWorkspace', () => ({ useNarrowWorkspace: () => ctx.narrow }));
vi.mock('../GatherScriptModal', () => ({
  GatherScriptModal: () => <div data-testid="gather-modal" />,
}));

import { AnalysisOverview } from '../AnalysisOverview';
import { SHOW_OVERVIEW_EVENT } from '../../lib/overview';
import { buttonByText, cleanup, click, press, render } from '../ui/__tests__/testUtils';

function makePlan(): ParsedPlan {
  const children = [node(1, 'TABLE ACCESS FULL', 'EMP')];
  const root = { ...node(0, 'SELECT STATEMENT'), children };
  return { rootNode: root, allNodes: [root, ...children], hasActualStats: false } as unknown as ParsedPlan;
}

function setReport(plan: ParsedPlan) {
  ctx.parsedPlan = plan;
  ctx.advisorReport = {
    findings: [
      {
        ruleId: 'cardinality-mismatch',
        severity: 'critical',
        nodeIds: [1],
        title: 'Cardinality mismatch on TABLE ACCESS FULL',
        explanation: 'Estimated 1 row but produced 5,000. Gather fresh statistics.',
        suggestion: '',
      },
    ],
    findingsByNodeId: new Map(),
    counts: { info: 0, warning: 0, critical: 1 },
    maxSeverityByNodeId: new Map(),
  } satisfies AdvisorReport;
}

const region = () => document.querySelector('[aria-label="Analysis overview"]');

beforeEach(() => {
  localStorage.clear();
  ctx.metadataBundle = null;
  ctx.focusMode = false;
  ctx.narrow = false;
  ctx.hottestNodeId = null;
  ctx.selectNode.mockReset();
  setReport(makePlan());
});

afterEach(() => cleanup());

describe('AnalysisOverview', () => {
  it('appears for a newly loaded plan, lists the finding and focuses its node', () => {
    render(<AnalysisOverview active />);
    expect(region()).not.toBeNull();
    expect(document.querySelectorAll('li')).toHaveLength(1);
    expect(region()!.textContent).toContain('#1 TABLE ACCESS FULL EMP');
    click(buttonByText('Focus'));
    expect(ctx.selectNode).toHaveBeenCalledWith(1);
  });

  it('offers "Attach metadata…" which opens the gather dialog', () => {
    render(<AnalysisOverview active />);
    click(buttonByText('Attach metadata…'));
    expect(document.querySelector('[data-testid="gather-modal"]')).not.toBeNull();
  });

  it('dismisses with the close button and does not return on re-render', () => {
    const view = render(<AnalysisOverview active />);
    click(document.querySelector('button[aria-label="Dismiss analysis overview"]')!);
    expect(region()).toBeNull();
    view.rerender(<AnalysisOverview active top={20} />);
    expect(region()).toBeNull();
  });

  it('closes on Escape from inside the card', () => {
    render(<AnalysisOverview active />);
    press(buttonByText('Focus'), 'Escape');
    expect(region()).toBeNull();
  });

  it('can be reopened by the palette event', () => {
    render(<AnalysisOverview active />);
    click(document.querySelector('button[aria-label="Dismiss analysis overview"]')!);
    expect(region()).toBeNull();
    act(() => {
      window.dispatchEvent(new Event(SHOW_OVERVIEW_EVENT));
    });
    expect(region()).not.toBeNull();
  });

  it('stays hidden when the setting is off; the checkbox persists the choice', () => {
    localStorage.setItem('ora-explain-viz-settings', JSON.stringify({ version: 1, showAnalysisOverview: false }));
    render(<AnalysisOverview active />);
    expect(region()).toBeNull();
    cleanup();

    localStorage.clear();
    render(<AnalysisOverview active />);
    const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    click(box);
    expect(JSON.parse(localStorage.getItem('ora-explain-viz-settings')!).showAnalysisOverview).toBe(false);
  });

  it('is not shown when inactive or when nothing is notable', () => {
    render(<AnalysisOverview active={false} />);
    expect(region()).toBeNull();
    cleanup();
    ctx.advisorReport = { findings: [], findingsByNodeId: new Map(), counts: { info: 0, warning: 0, critical: 0 }, maxSeverityByNodeId: new Map() };
    render(<AnalysisOverview active />);
    expect(region()).toBeNull();
  });

  it('collapses to a slim bar in the narrow layout', () => {
    ctx.narrow = true;
    render(<AnalysisOverview active />);
    expect(region()).not.toBeNull();
    expect(document.querySelectorAll('li')).toHaveLength(0);
    click(buttonByText('Show 1'));
    expect(document.querySelectorAll('li')).toHaveLength(1);
  });
});
