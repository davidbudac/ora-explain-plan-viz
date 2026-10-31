import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanSlot } from '../../lib/compare';

const copyToClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());
vi.mock('../../lib/clipboard', () => ({ copyToClipboard }));

const downloads = vi.hoisted(() => ({
  text: vi.fn<(...args: unknown[]) => boolean>(),
  binary: vi.fn<(...args: unknown[]) => boolean>(),
}));
vi.mock('../../lib/fileExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/fileExport')>()),
  downloadTextFile: downloads.text,
  downloadBinaryFile: downloads.binary,
}));

const ctx = vi.hoisted(() => ({
  plans: [] as unknown[],
  activePlanIndex: 0,
  comparePlanIndices: [0, 1] as [number, number],
  viewMode: 'hierarchical',
}));
vi.mock('../../hooks/usePlanContext', () => ({ usePlan: () => ctx }));

import { buildPlan } from '../../lib/advisor/__tests__/helpers';
import { createEmptyAnnotationState } from '../../lib/annotations';
import { loadSettings } from '../../lib/settings';
import { AgentHandoffDialog } from '../AgentHandoffDialog';
import { ConfirmProvider, ToastProvider } from '../ui';
import { buttonByText, cleanup, click, render } from '../ui/__tests__/testUtils';

function slot(label: string, sqlId: string): PlanSlot {
  const plan = buildPlan(
    {
      id: 0,
      operation: 'SELECT STATEMENT',
      children: [{ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', rows: 14, actualRows: 14, starts: 1, filterPredicates: '"E"."DEPTNO"=:B1' }],
    },
    { source: 'dbms_xplan', hasActualStats: true },
  );
  plan.sqlId = sqlId;
  plan.sqlText = 'SELECT * FROM emp WHERE deptno = :b1';
  plan.bindVariables = [{ name: ':B1', type: 'NUMBER', value: '10' }];
  return {
    id: label,
    label,
    rawInput: `Plan for ${sqlId}`,
    parsedPlan: plan,
    error: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    annotations: createEmptyAnnotationState(),
    metadataBundle: null,
    metadataBundleWarning: null,
  };
}

function renderDialog() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <AgentHandoffDialog onClose={() => {}} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const checkbox = (label: string) =>
  Array.from(dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .find((input) => input.closest('label')?.textContent?.includes(label))!;

async function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function copyHandoff(): Promise<string> {
  await act(async () => {
    click(buttonByText('Copy handoff', dialog()));
  });
  expect(copyToClipboard).toHaveBeenCalledTimes(1);
  return copyToClipboard.mock.calls[0][0];
}

beforeEach(() => {
  copyToClipboard.mockReset().mockResolvedValue(true);
  downloads.text.mockReset().mockReturnValue(true);
  downloads.binary.mockReset().mockReturnValue(true);
  ctx.plans = [slot('Plan A', 'aaaaaaaaaaaaa')];
  ctx.activePlanIndex = 0;
  ctx.viewMode = 'hierarchical';
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentHandoffDialog', () => {
  it('copies a handoff carrying the typed question', async () => {
    renderDialog();
    expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)?.textContent).toBe('Agent handoff');
    await typeInto(dialog().querySelector('textarea')!, 'Why is it slow?');
    const markdown = await copyHandoff();
    expect(markdown).toContain('<!-- oraplanviz-agent-handoff v1 -->');
    expect(markdown).toContain('> Why is it slow?');
    expect(markdown).toContain('## Bind variables');
    expect(document.body.textContent).toContain('Agent handoff copied');
  });

  it('leaves out an unticked section and remembers the choice', async () => {
    renderDialog();
    await act(async () => { click(checkbox('Bind variables')); });
    const markdown = await copyHandoff();
    expect(markdown).not.toContain('## Bind variables');
    expect(markdown).toContain('Bind values — withheld by the user');
    expect(loadSettings().agentHandoffSections).toEqual({ binds: false });
  });

  it('embeds the skill playbook on request', async () => {
    renderDialog();
    await act(async () => { click(checkbox('Embed the analysis playbook')); });
    const markdown = await copyHandoff();
    expect(markdown).toContain('# Playbook: the `oracle-plan-analysis` skill');
    expect(markdown).toContain('### Reading the numbers');
    expect(loadSettings().agentHandoffPlaybook).toBe(true);
  });

  it('offers the comparison when two plans are loaded, preselected in the Compare view', async () => {
    ctx.plans = [slot('Plan A', 'aaaaaaaaaaaaa'), slot('Plan B', 'bbbbbbbbbbbbb')];
    ctx.viewMode = 'compare';
    renderDialog();
    const radios = dialog().querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[1].checked).toBe(true);
    expect(await copyHandoff()).toContain('# Oracle execution plan comparison: Plan A vs Plan B');
  });

  it('downloads the handoff and the skill', async () => {
    renderDialog();
    await act(async () => { click(buttonByText('Download .md', dialog())); });
    expect(downloads.text).toHaveBeenCalledWith(expect.stringContaining('# Plan data'), 'agent-handoff-aaaaaaaaaaaaa.md', 'text/markdown;charset=utf-8');
    await act(async () => { click(buttonByText('Download skill (.zip)', dialog())); });
    expect(downloads.binary).toHaveBeenCalledWith(expect.any(Uint8Array), 'oracle-plan-analysis.zip', 'application/zip');
  });
});
