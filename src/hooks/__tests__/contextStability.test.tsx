import { act, memo, useLayoutEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePlan, useDraftInput } from '../usePlanContext';
import { cleanup, render } from '../../components/ui/__tests__/testUtils';
import { SIMPLE_PLAN, withPlanProviders } from '../../components/ui/__tests__/planContext';
import type { PlanCtx } from '../../components/ui/__tests__/planContext';

const probe: { ctx: PlanCtx | null; draft: string; contextRenders: number; draftRenders: number } = {
  ctx: null,
  draft: '',
  contextRenders: 0,
  draftRenders: 0,
};

// Memoised, so it re-renders only when a context it reads changes.
const ContextProbe = memo(function ContextProbe() {
  const ctx = usePlan();
  useLayoutEffect(() => {
    probe.contextRenders++;
    probe.ctx = ctx;
  });
  return null;
});

const DraftProbe = memo(function DraftProbe() {
  const draft = useDraftInput();
  useLayoutEffect(() => {
    probe.draftRenders++;
    probe.draft = draft;
  });
  return null;
});

function Harness({ tick }: { tick: number }) {
  return withPlanProviders(
    <>
      <ContextProbe />
      <DraftProbe />
      <span data-tick={tick} />
    </>,
  );
}

afterEach(() => {
  cleanup();
  probe.ctx = null;
  probe.draft = '';
  probe.contextRenders = 0;
  probe.draftRenders = 0;
});

async function mountWithPlan() {
  const view = render(<Harness tick={0} />);
  await act(async () => {
    await probe.ctx!.loadAndParsePlan(SIMPLE_PLAN, undefined, { recordRecent: false, skipConfirm: true });
  });
  expect(probe.ctx!.parsedPlan).not.toBeNull();
  return view;
}

describe('plan context value stability', () => {
  it('keeps the same value (and every action) across a parent re-render', async () => {
    const view = await mountWithPlan();
    const before = probe.ctx!;
    view.rerender(<Harness tick={1} />);
    const after = probe.ctx!;
    expect(after).toBe(before);
    for (const key of Object.keys(before) as Array<keyof PlanCtx>) {
      expect(after[key], `${String(key)} changed identity`).toBe(before[key]);
    }
  });

  it('does not re-render usePlan() consumers while typing in the drawer', async () => {
    await mountWithPlan();
    const before = probe.ctx!;
    const rendersBefore = probe.contextRenders;

    act(() => before.setInput('select 1 from dual'));
    act(() => before.setInput('select 1 from dual where 1 = 1'));

    expect(probe.draft).toBe('select 1 from dual where 1 = 1');
    expect(probe.draftRenders).toBeGreaterThan(0);
    expect(probe.ctx).toBe(before);
    expect(probe.contextRenders).toBe(rendersBefore);
  });

  it('still produces a new value when something a consumer reads changes', async () => {
    await mountWithPlan();
    const before = probe.ctx!;
    act(() => before.setViewMode('tabular'));
    expect(probe.ctx).not.toBe(before);
    expect(probe.ctx!.viewMode).toBe('tabular');
    // Actions survive the change untouched.
    expect(probe.ctx!.setInput).toBe(before.setInput);
    expect(probe.ctx!.selectNode).toBe(before.selectNode);
  });

  it('picks up a re-parse of the drawer text (rawInput) even though drafts are ignored', async () => {
    await mountWithPlan();
    act(() => probe.ctx!.setInput(SIMPLE_PLAN.replace('ORDERS', 'CUSTOMERS')));
    const before = probe.ctx!;
    await act(async () => {
      await before.parsePlan();
    });
    expect(probe.ctx).not.toBe(before);
    expect(probe.ctx!.rawInput).toContain('CUSTOMERS');
    expect(probe.ctx!.plans[0].rawInput).toContain('CUSTOMERS');
  });
});
