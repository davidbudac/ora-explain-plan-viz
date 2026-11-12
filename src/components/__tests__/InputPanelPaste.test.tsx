import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputPanel } from '../InputPanel';
import { cleanup } from '../ui/__tests__/testUtils';
import { SIMPLE_PLAN, renderPlanContext } from '../ui/__tests__/planContext';
import type { PlanHandle } from '../ui/__tests__/planContext';

const HINT = 'Press Parse';

function mountPanel(): { handle: PlanHandle; textarea: HTMLTextAreaElement } {
  const handle = renderPlanContext(<InputPanel />);
  act(() => handle.current().setInputPanelCollapsed(false));
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan text"]')!;
  expect(textarea).not.toBeNull();
  return { handle, textarea };
}

/**
 * What a browser does on Ctrl+V: a `paste` event carrying the raw clipboard
 * text, then the text lands in the textarea (whose `.value` always reports LF
 * line endings) and an `input` event fires.
 */
async function paste(textarea: HTMLTextAreaElement, clipboardText: string, resultingValue = clipboardText) {
  await act(async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => clipboardText } });
    textarea.dispatchEvent(event);

    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setValue.call(textarea, resultingValue);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // handlePaste looks at the result on the next macrotask; parsing is async.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('InputPanel paste', () => {
  it('parses a pasted plan straight away', async () => {
    const { handle, textarea } = mountPanel();
    await paste(textarea, SIMPLE_PLAN);
    expect(handle.current().parsedPlan?.planHashValue).toBe('1234567890');
    expect(document.body.textContent).not.toContain(HINT);
  });

  it('parses a pasted plan whose clipboard text has Windows (CRLF) line endings', async () => {
    const { handle, textarea } = mountPanel();
    const crlf = SIMPLE_PLAN.replace(/\n/g, '\r\n');
    expect(crlf).toContain('\r\n');
    await paste(textarea, crlf);
    // The textarea reports LF, so the comparison must not depend on line endings.
    expect(textarea.value).not.toContain('\r');
    expect(handle.current().parsedPlan?.planHashValue).toBe('1234567890');
    expect(document.body.textContent).not.toContain(HINT);
  });

  it('only hints when the paste is added to existing text', async () => {
    const { handle, textarea } = mountPanel();
    await paste(textarea, SIMPLE_PLAN, `-- my notes\n${SIMPLE_PLAN}`);
    expect(handle.current().parsedPlan).toBeNull();
    expect(document.body.textContent).toContain(HINT);
  });

  it('only hints when the pasted text is not a plan', async () => {
    const { handle, textarea } = mountPanel();
    await paste(textarea, 'select * from dual');
    expect(handle.current().parsedPlan).toBeNull();
    expect(document.body.textContent).toContain(HINT);
  });
});
