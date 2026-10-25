import { act, useLayoutEffect } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { expect } from 'vitest';
import { PlanProvider, usePlan } from '../../../hooks/usePlanContext';
import { ConfirmProvider, ToastProvider } from '..';
import { render } from './testUtils';

/** A minimal two-operation DBMS_XPLAN plan. */
export const SIMPLE_PLAN = `Plan hash value: 1234567890

--------------------------------------------------------------------------------
| Id  | Operation                    | Name       | Rows  | Bytes | Cost (%CPU)|
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT             |            |     1 |    10 |     5   (0)|
|   1 |  TABLE ACCESS FULL           | ORDERS     |     1 |    10 |     5   (0)|
--------------------------------------------------------------------------------
`;

export type PlanCtx = ReturnType<typeof usePlan>;
export interface PlanHandle {
  current: () => PlanCtx;
}

/** Wrap `children` in the providers the plan context needs (toasts, confirm dialog, plan). */
export function withPlanProviders(children: ReactNode): ReactElement {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <PlanProvider>{children}</PlanProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

/** Render a real PlanProvider (plus optional `ui` inside it) and track the latest context value. */
export function renderPlanContext(ui?: ReactNode): PlanHandle {
  const latest: { ctx: PlanCtx | null } = { ctx: null };
  function Probe() {
    const ctx = usePlan();
    useLayoutEffect(() => {
      latest.ctx = ctx;
    });
    return null;
  }
  render(
    withPlanProviders(
      <>
        <Probe />
        {ui}
      </>,
    ),
  );
  return { current: () => latest.ctx! };
}

/** Load plan text into the active slot (no confirm, not recorded in Recent) and expect it to parse. */
export async function loadPlan(handle: PlanHandle, text: string = SIMPLE_PLAN): Promise<void> {
  await act(async () => {
    await handle.current().loadAndParsePlan(text, undefined, { recordRecent: false, skipConfirm: true });
  });
  expect(handle.current().parsedPlan).not.toBeNull();
}

/**
 * Install the ResizeObserver and DOMMatrixReadOnly stubs React Flow needs;
 * jsdom has neither. Call from beforeAll.
 * Opt-in rather than global: InputPanel, NavRibbon, Sankey, Tabular and Flame
 * branch on `typeof ResizeObserver === 'undefined'`, and a global no-op
 * observer (which never fires) would silently switch every test onto the
 * observer path.
 */
export function installLayoutShims(): void {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  g.DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
}
