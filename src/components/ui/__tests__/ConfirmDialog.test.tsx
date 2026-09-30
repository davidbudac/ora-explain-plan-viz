/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm } from '../ConfirmDialog';
import type { ConfirmOptions } from '../ConfirmDialog';
import { buttonByText, cleanup, click, press, render } from './testUtils';

afterEach(cleanup);

function Asker({ options, label = 'Ask' }: { options: ConfirmOptions; label?: string }) {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>('pending');
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void confirm(options).then((value) => setResult(`${label}:${value}`));
        }}
      >
        {label}
      </button>
      <output data-testid={`result-${label}`}>{result}</output>
    </div>
  );
}

const result = (label = 'Ask') => document.querySelector(`[data-testid="result-${label}"]`)!.textContent;
const alertDialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

describe('ConfirmProvider / useConfirm', () => {
  it('resolves true when the user confirms', async () => {
    render(
      <ConfirmProvider>
        <Asker options={{ title: 'Delete note?', message: 'This cannot be undone.', confirmLabel: 'Delete' }} />
      </ConfirmProvider>,
    );
    expect(alertDialog()).toBeNull();

    click(buttonByText('Ask'));
    expect(alertDialog()?.textContent).toContain('Delete note?');
    expect(alertDialog()?.textContent).toContain('This cannot be undone.');

    await act(async () => {
      click(buttonByText('Delete'));
    });
    expect(result()).toBe('Ask:true');
    expect(alertDialog()).toBeNull();
  });

  it('resolves false on Cancel, on Escape, and on backdrop click', async () => {
    render(
      <ConfirmProvider>
        <Asker options={{ title: 'Proceed?' }} />
      </ConfirmProvider>,
    );

    click(buttonByText('Ask'));
    await act(async () => {
      click(buttonByText('Cancel'));
    });
    expect(result()).toBe('Ask:false');

    click(buttonByText('Ask'));
    await act(async () => {
      press(buttonByText('Confirm'), 'Escape');
    });
    expect(result()).toBe('Ask:false');
    expect(alertDialog()).toBeNull();

    click(buttonByText('Ask'));
    await act(async () => {
      click(document.querySelector('[data-ui-backdrop]')!);
    });
    expect(result()).toBe('Ask:false');
  });

  it('gives Cancel initial focus and a red confirm button for tone "danger"', () => {
    render(
      <ConfirmProvider>
        <Asker options={{ title: 'Delete?', tone: 'danger', confirmLabel: 'Delete' }} />
      </ConfirmProvider>,
    );
    click(buttonByText('Ask'));
    expect(document.activeElement).toBe(buttonByText('Cancel'));
    expect(buttonByText('Delete').className).toContain('bg-red-');
  });

  it('gives the confirm button initial focus for the default tone', () => {
    render(
      <ConfirmProvider>
        <Asker options={{ title: 'Continue?' }} />
      </ConfirmProvider>,
    );
    click(buttonByText('Ask'));
    expect(document.activeElement).toBe(buttonByText('Confirm'));
    expect(buttonByText('Confirm').className).not.toContain('bg-red-');
  });

  it('queues concurrent confirmations and settles them in order', async () => {
    render(
      <ConfirmProvider>
        <Asker label="First" options={{ title: 'First question' }} />
        <Asker label="Second" options={{ title: 'Second question' }} />
      </ConfirmProvider>,
    );
    click(buttonByText('First'));
    click(buttonByText('Second'));
    expect(alertDialog()?.textContent).toContain('First question');

    await act(async () => {
      click(buttonByText('Confirm'));
    });
    expect(result('First')).toBe('First:true');
    expect(alertDialog()?.textContent).toContain('Second question');

    await act(async () => {
      click(buttonByText('Cancel'));
    });
    expect(result('Second')).toBe('Second:false');
    expect(alertDialog()).toBeNull();
  });
});
