/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.hoisted(() => vi.fn());
vi.mock('../ui/Toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/Toast')>();
  // Keep the real provider/hook plumbing, but observe what the chip asks to show
  return { ...actual, useToast: () => ({ show, dismiss: vi.fn() }) };
});
// The gather modal pulls in the whole plan context; it is irrelevant here
vi.mock('../GatherScriptModal', () => ({ GatherScriptModal: () => null }));

import { MetadataChip } from '../MetadataChip';
import { ConfirmProvider } from '../ui';
import { buttonByText, cleanup, click, render } from '../ui/__tests__/testUtils';
import type { MetadataBundle } from '../../lib/metadata/bundle';

const bundle = {
  format: 'ora-plan-metadata',
  version: 2,
  captured_at: '2026-07-01T10:00:00Z',
  source: { db_name: 'CDB1', oracle_version: '19.27', container_name: 'PDB1' },
  plan_ref: { sql_id: 'abc123', plan_hash_value: 42 },
  objects: {},
  coverage_warnings: [],
} as unknown as MetadataBundle;

beforeEach(() => {
  show.mockReset();
});
afterEach(cleanup);

const alert = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

function setup() {
  const onDetach = vi.fn();
  render(
    <ConfirmProvider>
      <MetadataChip bundle={bundle} warning={null} planSqlId="abc123" onDetach={onDetach} />
    </ConfirmProvider>,
  );
  click(document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!);
  return onDetach;
}

describe('MetadataChip detach', () => {
  it('asks for confirmation and does nothing when the user cancels', async () => {
    const onDetach = setup();
    await act(async () => {
      click(buttonByText('Detach'));
    });
    expect(alert()?.textContent).toContain('Detach the metadata bundle?');
    expect(alert()?.textContent).toContain('re-run the gather script');

    await act(async () => {
      click(buttonByText('Cancel', alert()!));
    });
    expect(onDetach).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('detaches and raises an info toast once confirmed', async () => {
    const onDetach = setup();
    await act(async () => {
      click(buttonByText('Detach'));
    });
    await act(async () => {
      click(buttonByText('Detach', alert()!));
    });
    expect(onDetach).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'info', message: 'Metadata bundle detached' }));
  });

  it('labels the warning badge for screen readers', () => {
    const withWarning = { ...bundle, coverage_warnings: [{ object: 'HR.T', reason: 'no grant' }] } as unknown as MetadataBundle;
    render(<MetadataChip bundle={withWarning} warning={null} onDetach={() => {}} />);
    expect(document.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('1 warning');
  });
});
