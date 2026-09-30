/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnotationEditor, BulkHighlightPicker } from '../AnnotationEditor';
import { ConfirmProvider } from '../ui';
import { buttonByText, cleanup, click, render } from '../ui/__tests__/testUtils';

afterEach(cleanup);

describe('AnnotationEditor swatches', () => {
  it('exposes each colour as a named toggle with its pressed state', () => {
    render(
      <AnnotationEditor
        nodeId={1}
        annotationText=""
        highlightColor="green"
        highlightStyle="tint"
        onHighlightStyleChange={() => {}}
        onTextChange={() => {}}
        onTextRemove={() => {}}
        onHighlightChange={() => {}}
        onHighlightRemove={() => {}}
      />,
    );
    const green = document.querySelector<HTMLButtonElement>('button[aria-label="Green highlight"]');
    const red = document.querySelector<HTMLButtonElement>('button[aria-label="Red highlight"]');
    expect(green?.getAttribute('aria-pressed')).toBe('true');
    expect(red?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('BulkHighlightPicker', () => {
  function setup(nodeIds: number[]) {
    const onHighlightRemove = vi.fn();
    render(
      <ConfirmProvider>
        <BulkHighlightPicker nodeIds={nodeIds} onHighlightChange={() => {}} onHighlightRemove={onHighlightRemove} />
      </ConfirmProvider>,
    );
    return onHighlightRemove;
  }
  const alert = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

  it('clears a single node straight away, without a confirm', async () => {
    const remove = setup([4]);
    await act(async () => {
      click(buttonByText('Clear'));
    });
    expect(alert()).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(4);
  });

  it('asks before clearing several nodes, and only clears on confirm', async () => {
    const remove = setup([4, 5, 6]);

    await act(async () => {
      click(buttonByText('Clear'));
    });
    expect(alert()?.textContent).toContain('Clear highlights on 3 nodes?');
    expect(remove).not.toHaveBeenCalled();

    // Declining changes nothing
    await act(async () => {
      click(buttonByText('Cancel', alert()!));
    });
    expect(remove).not.toHaveBeenCalled();

    await act(async () => {
      click(buttonByText('Clear'));
    });
    await act(async () => {
      click(buttonByText('Clear highlights', alert()!));
    });
    expect(remove.mock.calls.map((c) => c[0])).toEqual([4, 5, 6]);
  });
});
