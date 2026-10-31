import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- shared mocks ----------------------------------------------------------
const copyToClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());
vi.mock('../../lib/clipboard', () => ({ copyToClipboard }));

const downloadTextFile = vi.hoisted(() => vi.fn<(...args: unknown[]) => boolean>());
vi.mock('../../lib/fileExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/fileExport')>()),
  downloadTextFile,
}));

const plan = vi.hoisted(() => ({
  shortcutsOverlayOpen: true,
  setShortcutsOverlayOpen: vi.fn(),
  shareNotice: null as unknown,
  dismissShareNotice: vi.fn(),
  loadMetadataBundle: vi.fn(),
  attachMetadataBundleToSlot: vi.fn(),
  parsedPlan: null as unknown,
}));
const stable = vi.hoisted(() => ({
  plans: [{ parsedPlan: null }] as unknown[],
  comparePlanIndices: [0, 1] as [number, number],
  annotations: { nodeAnnotations: new Map(), nodeHighlights: new Map(), groups: [] },
}));
vi.mock('../../hooks/usePlanContext', () => ({
  usePlan: () => ({
    ...plan,
    plans: stable.plans,
    activePlanIndex: 0,
    comparePlanIndices: stable.comparePlanIndices,
    metadataBundle: null,
    rawInput: 'plan text',
    annotations: stable.annotations,
    advisorReport: null,
    hottestNodeId: null,
  }),
}));

const runAnalysis = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useAiAnalysis', () => ({
  useAi: () => ({ aiDialogMode: 'analyze', runAnalysis, status: 'idle' }),
}));

vi.mock('../../lib/clientReport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/clientReport')>()),
  buildClientReport: () => '<html>report</html>',
  clientReportFilename: () => 'report.html',
}));

import { AiAnalysisDialog } from '../AiAnalysisDialog';
import { BaselineScriptModal } from '../BaselineScriptModal';
import { ClientReportModal } from '../ClientReportModal';
import { GatherScriptModal } from '../GatherScriptModal';
import { ShareResultDialog } from '../ShareResultDialog';
import { ShortcutsOverlay } from '../ShortcutsOverlay';
import { ConfirmProvider, ToastProvider } from '../ui';
import { buttonByText, cleanup, click, press, render } from '../ui/__tests__/testUtils';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </ToastProvider>,
  );
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const confirmDialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const toastText = () => document.querySelector<HTMLElement>('[data-ui-toast-region]')?.textContent ?? '';

async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  copyToClipboard.mockReset();
  downloadTextFile.mockReset();
  runAnalysis.mockReset();
  plan.setShortcutsOverlayOpen.mockReset();
  plan.dismissShareNotice.mockReset();
  plan.shortcutsOverlayOpen = true;
  plan.shareNotice = null;
  plan.parsedPlan = null;
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---- every modal is a proper dialog -----------------------------------------
describe('modal dialogs', () => {
  const cases: Array<[string, () => React.ReactElement, string]> = [
    ['BaselineScriptModal', () => <BaselineScriptModal onClose={() => {}} />, 'Create SQL plan baseline'],
    ['GatherScriptModal', () => <GatherScriptModal onClose={() => {}} />, 'Gather schema metadata'],
    ['AiAnalysisDialog', () => <AiAnalysisDialog onClose={() => {}} />, 'AI Analyze Plan'],
    ['ShortcutsOverlay', () => <ShortcutsOverlay />, 'Keyboard shortcuts'],
  ];

  it.each(cases)('%s has role=dialog, aria-modal and a labelled title with a Close button', (_name, make, title) => {
    renderWithProviders(make());
    const el = dialog()!;
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-modal')).toBe('true');
    const labelId = el.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent).toBe(title);
    expect(el.querySelector('button[aria-label="Close"]')).not.toBeNull();
  });

  it('ClientReportModal and ShareResultDialog are labelled dialogs too', () => {
    plan.parsedPlan = { sqlText: 'select 1', hasActualStats: false, allNodes: [], source: 'dbms_xplan' };
    plan.shareNotice = { kind: 'manual', url: 'https://example.test/#p=abc' };
    renderWithProviders(
      <>
        <ClientReportModal onClose={() => {}} />
        <ShareResultDialog />
      </>,
    );
    const titles = Array.from(document.querySelectorAll('[role="dialog"]')).map(
      (d) => document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent,
    );
    expect(titles).toEqual(expect.arrayContaining(['Export client report', 'Copy your share link']));
  });
});

// ---- Escape vs unsaved input ------------------------------------------------
describe('dirty guard', () => {
  it('Baseline: prefilled-but-untouched closes on Escape; typing asks first', async () => {
    const onClose = vi.fn();
    renderWithProviders(<BaselineScriptModal initialSqlId="abc123" initialPlanHash="42" onClose={onClose} />);

    press(dialog()!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockReset();
    await typeInto(document.querySelector<HTMLInputElement>('input[placeholder^="e.g. an05"]')!, 'zzz999');
    await act(async () => {
      press(dialog()!, 'Escape');
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDialog()?.textContent).toContain('Discard your changes?');

    await act(async () => {
      click(buttonByText('Keep editing', confirmDialog()!));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDialog()).toBeNull();
  });

  it('Gather: a typed object list is protected, an untouched dialog is not', async () => {
    const onClose = vi.fn();
    renderWithProviders(<GatherScriptModal initialMode="manual" onClose={onClose} />);

    press(dialog()!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockReset();
    await typeInto(document.querySelector<HTMLTextAreaElement>('textarea')!, 'HR.EMPLOYEES');
    await act(async () => {
      press(dialog()!, 'Escape');
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDialog()).not.toBeNull();

    await act(async () => {
      click(buttonByText('Discard', confirmDialog()!));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Gather: pasting terminal output keeps only the bundle JSON in the box', async () => {
    renderWithProviders(<GatherScriptModal initialMode="manual" onClose={() => {}} />);
    const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Script output to attach"]')!;
    const json = '{"format":"ora-plan-metadata","version":1,"objects":{}}';
    const paste = async (text: string) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
      await act(async () => {
        box.dispatchEvent(event);
      });
      return event;
    };

    const cleaned = await paste(`SQL> SQL>   2   3 ${json.slice(0, 20)}\n${json.slice(20)}\n\nPL/SQL procedure successfully completed.\nSQL> `);
    expect(cleaned.defaultPrevented).toBe(true);
    expect(box.value).toBe(json);

    // Text without a bundle is left to the browser's normal paste.
    const plain = await paste('just some text');
    expect(plain.defaultPrevented).toBe(false);
  });

  it('Gather: the mode switch is a pressed-state toggle group', async () => {
    renderWithProviders(<GatherScriptModal initialMode="manual" onClose={() => {}} />);
    expect(buttonByText('Object list').getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText('SQL_ID').getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      click(buttonByText('SQL_ID'));
    });
    expect(buttonByText('SQL_ID').getAttribute('aria-pressed')).toBe('true');
  });

  it('ClientReport: typed title is protected', async () => {
    plan.parsedPlan = { sqlText: 'select 1', hasActualStats: false, allNodes: [], source: 'dbms_xplan' };
    const onClose = vi.fn();
    renderWithProviders(<ClientReportModal onClose={onClose} />);

    await typeInto(document.querySelector<HTMLInputElement>('input[placeholder="Query Performance Documentation"]')!, 'My report');
    await act(async () => {
      press(dialog()!, 'Escape');
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDialog()).not.toBeNull();
  });

  it('AI analysis: a typed API key is protected', async () => {
    const onClose = vi.fn();
    renderWithProviders(<AiAnalysisDialog onClose={onClose} />);

    press(dialog()!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockReset();
    await typeInto(document.querySelector<HTMLInputElement>('input[placeholder="sk-ant-…"]')!, 'sk-ant-secret');
    await act(async () => {
      press(dialog()!, 'Escape');
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDialog()).not.toBeNull();
  });
});

// ---- copy buttons never claim success on failure ------------------------------
describe('copy script buttons', () => {
  async function openValidBaseline() {
    renderWithProviders(<BaselineScriptModal initialSqlId="abc123" initialPlanHash="42" onClose={() => {}} />);
  }

  it('Baseline: shows "Copied!" only after the copy succeeded', async () => {
    copyToClipboard.mockResolvedValue(true);
    await openValidBaseline();
    await act(async () => {
      click(buttonByText('Copy script'));
    });
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard.mock.calls[0][0]).toContain('abc123');
    expect(buttonByText('Copied!')).toBeTruthy();
  });

  it('Baseline: Copy is disabled until the SQL_ID and plan hash are valid', () => {
    renderWithProviders(<BaselineScriptModal onClose={() => {}} />);
    expect(buttonByText('Copy script').disabled).toBe(true);
  });

  it('Gather: copy works for a valid SQL_ID and reports failure honestly', async () => {
    copyToClipboard.mockResolvedValue(false);
    renderWithProviders(<GatherScriptModal initialSqlId="abc123" initialMode="sqlid" onClose={() => {}} />);
    await act(async () => {
      click(buttonByText('Copy paste-ready script'));
    });
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(() => buttonByText('Copied!')).toThrow();
    expect(toastText()).toContain('Copy failed');
  });
});

// ---- downloads / print feedback -----------------------------------------------
describe('ClientReportModal feedback', () => {
  beforeEach(() => {
    plan.parsedPlan = { sqlText: 'select 1', hasActualStats: false, allNodes: [], source: 'dbms_xplan' };
  });

  it('confirms a successful download with a toast', async () => {
    downloadTextFile.mockReturnValue(true);
    renderWithProviders(<ClientReportModal onClose={() => {}} />);
    await act(async () => {
      click(buttonByText('Download .html'));
    });
    expect(downloadTextFile).toHaveBeenCalledWith('<html>report</html>', 'report.html', 'text/html;charset=utf-8');
    expect(toastText()).toContain('Report downloaded');
  });

  it('does not claim success when the download was refused', async () => {
    downloadTextFile.mockReturnValue(false);
    renderWithProviders(<ClientReportModal onClose={() => {}} />);
    await act(async () => {
      click(buttonByText('Download .html'));
    });
    expect(toastText()).not.toContain('Report downloaded');
  });

  it('tells the user when the print window is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    renderWithProviders(<ClientReportModal onClose={() => {}} />);
    await act(async () => {
      click(buttonByText('Print / save as PDF'));
    });
    expect(toastText()).toContain('Pop-up blocked');
  });
});

// ---- content -------------------------------------------------------------------
describe('ShortcutsOverlay content', () => {
  it('closes on Escape and on the Close button', () => {
    renderWithProviders(<ShortcutsOverlay />);
    press(dialog()!, 'Escape');
    expect(plan.setShortcutsOverlayOpen).toHaveBeenCalledWith(false);

    plan.setShortcutsOverlayOpen.mockReset();
    click(dialog()!.querySelector('button[aria-label="Close"]')!);
    expect(plan.setShortcutsOverlayOpen).toHaveBeenCalledWith(false);
  });

  it('renders nothing while closed', () => {
    plan.shortcutsOverlayOpen = false;
    renderWithProviders(<ShortcutsOverlay />);
    expect(dialog()).toBeNull();
  });
});

describe('ShareResultDialog', () => {
  it('focuses the read-only link and dismisses on Escape', () => {
    plan.shareNotice = { kind: 'manual', url: 'https://example.test/#p=abc' };
    renderWithProviders(<ShareResultDialog />);
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Share link"]')!;
    expect(document.activeElement).toBe(input);
    press(dialog()!, 'Escape');
    expect(plan.dismissShareNotice).toHaveBeenCalledTimes(1);
  });

  it('copies the link with the shared button and only then says "Copied!"', async () => {
    copyToClipboard.mockResolvedValue(true);
    plan.shareNotice = { kind: 'warning', url: 'https://example.test/#p=abc' };
    renderWithProviders(<ShareResultDialog />);
    await act(async () => {
      click(buttonByText('Copy'));
    });
    expect(copyToClipboard).toHaveBeenCalledWith('https://example.test/#p=abc');
    expect(buttonByText('Copied!')).toBeTruthy();
  });
});

// ---- SQL Patch mode of the baseline dialog ----------------------------------
describe('BaselineScriptModal: SQL Patch mode', () => {
  const OUTLINE = ['FULL(@"SEL$1" "E"@"SEL$1")', 'INDEX(@"SEL$1" "D"@"SEL$1" ("DEPT"."ID"))'];
  const title = () => document.getElementById(dialog()!.getAttribute('aria-labelledby')!)?.textContent;
  const radio = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find((r) => r.textContent?.startsWith(label))!;
  const hints = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
  const nameInput = () => document.querySelector<HTMLInputElement>('input[placeholder^="PLANVIZ_PATCH"]')!;

  it('opens in baseline mode with a script-type radiogroup, and switching changes the title', () => {
    renderWithProviders(<BaselineScriptModal initialSqlId="abc123" initialPlanHash="42" onClose={() => {}} />);
    expect(title()).toBe('Create SQL plan baseline');
    expect(document.querySelector('[role="radiogroup"][aria-label="Script type"]')).not.toBeNull();
    expect(radio('SQL plan baseline').getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('input[placeholder^="e.g. 3001"]')).not.toBeNull();

    click(radio('SQL patch'));
    expect(title()).toBe('Create SQL patch');
    expect(radio('SQL patch').getAttribute('aria-checked')).toBe('true');
    // baseline-only fields are hidden
    expect(document.querySelector('input[placeholder^="e.g. 3001"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Mark as FIXED');
  });

  it('initialKind="patch" opens in patch mode with the hint box prefilled from the outline', () => {
    renderWithProviders(
      <BaselineScriptModal initialKind="patch" initialSqlId="abc123" initialOutlineHints={OUTLINE} onClose={() => {}} />,
    );
    expect(title()).toBe('Create SQL patch');
    expect(hints().value).toBe(OUTLINE.join('\n'));
    expect(nameInput().value).toBe('PLANVIZ_PATCH_abc123');
    expect(document.body.textContent).toContain('pins the current plan');
    // untouched prefill is not "dirty"
    const onClose = vi.fn();
    cleanup();
    renderWithProviders(
      <BaselineScriptModal initialKind="patch" initialSqlId="abc123" initialOutlineHints={OUTLINE} onClose={onClose} />,
    );
    press(dialog()!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('without an outline the hint box is empty and Copy is disabled', () => {
    renderWithProviders(<BaselineScriptModal initialKind="patch" initialSqlId="abc123" onClose={() => {}} />);
    expect(hints().value).toBe('');
    expect(document.body.textContent).toContain('ADVANCED');
    expect(buttonByText('Copy script').disabled).toBe(true);
  });

  it('Copy stays enabled when the hint text contains & (the script switches substitution off)', async () => {
    renderWithProviders(
      <BaselineScriptModal initialKind="patch" initialSqlId="abc123" initialOutlineHints={OUTLINE} onClose={() => {}} />,
    );
    expect(buttonByText('Copy script').disabled).toBe(false);
    await typeInto(hints(), 'FULL(a) & x');
    expect(buttonByText('Copy script').disabled).toBe(false);
    expect(document.body.textContent).not.toContain('must not contain');
  });

  it('the patch name follows the SQL_ID until edited, and is validated', async () => {
    renderWithProviders(<BaselineScriptModal initialKind="patch" initialSqlId="abc123" initialOutlineHints={OUTLINE} onClose={() => {}} />);
    await typeInto(document.querySelector<HTMLInputElement>('input[placeholder^="e.g. an05"]')!, 'zzz999');
    expect(nameInput().value).toBe('PLANVIZ_PATCH_zzz999');
    await typeInto(nameInput(), 'MY PATCH');
    expect(buttonByText('Copy script').disabled).toBe(true);
    expect(document.body.textContent).toContain('Patch name is 1');
    await typeInto(nameInput(), 'MY_PATCH');
    expect(buttonByText('Copy script').disabled).toBe(false);
  });

  it('"Use plan outline" restores the prefill and the preview uses CREATE_SQL_PATCH', async () => {
    renderWithProviders(
      <BaselineScriptModal initialKind="patch" initialSqlId="abc123" initialOutlineHints={OUTLINE} onClose={() => {}} />,
    );
    expect(() => buttonByText('Use plan outline')).toThrow();
    await typeInto(hints(), 'FULL(t)');
    click(buttonByText('Use plan outline'));
    expect(hints().value).toBe(OUTLINE.join('\n'));
    const preview = document.querySelector('details pre')!.textContent!;
    expect(preview).toContain('DBMS_SQLDIAG.CREATE_SQL_PATCH');
    expect(preview).toContain('DEFINE patch_name = "PLANVIZ_PATCH_abc123"');
  });

  it('editing the hints makes Escape ask first, and Download uses the patch filename', async () => {
    downloadTextFile.mockReturnValue(true);
    const onClose = vi.fn();
    renderWithProviders(
      <BaselineScriptModal initialKind="patch" initialSqlId="abc123" initialOutlineHints={OUTLINE} onClose={onClose} />,
    );
    click(buttonByText('Download .sql'));
    expect(downloadTextFile.mock.calls[0][1]).toBe('create_sql_patch_abc123.sql');
    await typeInto(hints(), 'FULL(t)');
    await act(async () => {
      press(dialog()!, 'Escape');
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDialog()).not.toBeNull();
  });
});
