/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useLayoutEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlanProvider, usePlan } from '../usePlanContext';
import { ConfirmProvider, ToastProvider } from '../../components/ui';
import { cleanup, render } from '../../components/ui/__tests__/testUtils';

const TWO_PLAN_CSV = [
  'SQL_ID,CHILD_NUMBER,PLAN_HASH_VALUE,ID,PARENT_ID,OPERATION,OBJECT_NAME',
  'a1,0,111,0,,SELECT STATEMENT,',
  'a1,0,111,1,0,TABLE ACCESS FULL,ORDERS',
  'b2,0,222,0,,SELECT STATEMENT,',
  'b2,0,222,1,0,HASH JOIN,',
  'b2,0,222,2,1,TABLE ACCESS FULL,ITEMS',
  'b2,0,222,3,1,TABLE ACCESS FULL,ORDERS',
].join('\n');

type Ctx = ReturnType<typeof usePlan>;

function renderPlanContext(): { current: () => Ctx } {
  const latest: { ctx: Ctx | null } = { ctx: null };
  function Probe() {
    const ctx = usePlan();
    useLayoutEffect(() => {
      latest.ctx = ctx;
    });
    return null;
  }
  render(
    <ToastProvider>
      <ConfirmProvider>
        <PlanProvider>
          <Probe />
        </PlanProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
  return { current: () => latest.ctx! };
}

beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('importing a V$SQL_PLAN CSV', () => {
  it('turns a two-plan CSV into two parsed plan slots', async () => {
    const ctx = renderPlanContext();
    await act(async () => {
      await ctx.current().loadExample({ name: 'CSV', category: 'json', data: TWO_PLAN_CSV });
    });
    const parsed = ctx.current().plans.filter((p) => p.parsedPlan);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.parsedPlan!.sqlId)).toEqual(['a1', 'b2']);
    expect(parsed.map((p) => p.parsedPlan!.source)).toEqual(['csv', 'csv']);
    expect(parsed[1].parsedPlan!.allNodes).toHaveLength(4);
  });
});
