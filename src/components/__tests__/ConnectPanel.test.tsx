/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  health: vi.fn(),
  verifyToken: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  recentSql: vi.fn(),
  fetchPlanWithMetadata: vi.fn(),
  testConnect: vi.fn(),
  testDisconnect: vi.fn(),
}));
const loadAndParsePlan = vi.hoisted(() => vi.fn());

vi.mock('../../lib/agent/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/agent/client')>();
  return { ...actual, ...client };
});
vi.mock('../../hooks/usePlanContext', () => ({ usePlan: () => ({ loadAndParsePlan }) }));

import { ConnectPanel } from '../ConnectPanel';
import { AgentError, AGENT_TOKEN_STORAGE_KEY } from '../../lib/agent/client';
import { buttonByText, cleanup, click, render } from '../ui/__tests__/testUtils';

// React commits (and runs effects) only when act() exits, so timers registered
// by an effect need a second advance: settle first, then move the clock.
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  if (ms > 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
}

const stepOf = (n: number) => document.querySelector<HTMLElement>(`li[data-step="${n}"]`)!;

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(client)) fn.mockReset();
  loadAndParsePlan.mockReset();
  loadAndParsePlan.mockResolvedValue(true);
  client.recentSql.mockResolvedValue({ items: [] });
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ConnectPanel walkthrough', () => {
  it('shows install and start commands when the connector is not reachable, and keeps polling', async () => {
    client.health.mockRejectedValue(new AgentError('Agent not reachable at http://127.0.0.1:8521. Is it running?'));
    render(<ConnectPanel />);
    await flush();

    const step1 = stepOf(1);
    // Not running yet is a waiting state, not a failure: no red marker or text.
    expect(step1.dataset.status).toBe('current');
    expect(step1.textContent).not.toContain('!');
    expect(step1.querySelector('.text-red-600, .dark\\:text-red-400')).toBeNull();
    const hint = Array.from(step1.querySelectorAll('[role="status"]')).find((el) => el.textContent?.includes("Can't reach the connector"));
    expect(hint?.className).toContain('text-amber-700');
    expect(hint?.className).not.toContain('red');
    expect(step1.textContent).toContain('pipx install git+https://github.com/davidbudac/oraplanviz-db-connector.git');
    expect(step1.textContent).toContain('oraplanviz-agent --allow-origin');
    expect(step1.textContent).toContain("Can't reach the connector");
    expect(stepOf(2).dataset.status).toBe('locked');
    expect(stepOf(2).textContent).toContain('Complete step 1 first');
    expect(document.getElementById('agent-token')).toBeNull();

    // Polling: the connector appears later and step 1 completes by itself.
    const callsBefore = client.health.mock.calls.length;
    client.health.mockResolvedValue({ version: '0.2.0', connected: false, oracleVersion: null });
    await flush(3100);
    expect(client.health.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(stepOf(1).dataset.status).toBe('done');
    expect(stepOf(1).textContent).toContain('Connector v0.2.0 running at');
    expect(stepOf(2).dataset.status).toBe('current');

    // Polling stops once the connector is found.
    const settled = client.health.mock.calls.length;
    await flush(10_000);
    expect(client.health.mock.calls.length).toBe(settled);
  });

  it('stops polling on unmount', async () => {
    client.health.mockRejectedValue(new AgentError('nope'));
    const { unmount } = render(<ConnectPanel />);
    await flush();
    unmount();
    const calls = client.health.mock.calls.length;
    await flush(10_000);
    expect(client.health.mock.calls.length).toBe(calls);
  });

  it('shows the database form once the connector is up and the stored token verifies', async () => {
    sessionStorage.setItem(AGENT_TOKEN_STORAGE_KEY, 'secret');
    client.health.mockResolvedValue({ version: '0.2.0', connected: false, oracleVersion: null });
    client.verifyToken.mockResolvedValue(true);
    render(<ConnectPanel />);
    await flush(500);

    expect(client.verifyToken).toHaveBeenCalledWith(expect.objectContaining({ token: 'secret' }));
    expect(stepOf(2).dataset.status).toBe('done');
    expect(stepOf(2).textContent).toContain('Token accepted');
    expect(stepOf(3).dataset.status).toBe('current');
    expect(stepOf(3).getAttribute('aria-current')).toBe('step');
    const dsn = document.getElementById('agent-dsn') as HTMLInputElement;
    expect(dsn.placeholder).toBe('dbhost:1521/service_name');
    expect(document.getElementById('agent-user')).not.toBeNull();
    expect(document.getElementById('agent-password')).not.toBeNull();
    // Step 4 is still locked.
    expect(stepOf(4).dataset.status).toBe('locked');
    expect(document.getElementById('manual-sql-id')).toBeNull();
  });

  it('reports a rejected token with a friendly message and keeps later steps locked', async () => {
    sessionStorage.setItem(AGENT_TOKEN_STORAGE_KEY, 'wrong');
    client.health.mockResolvedValue({ version: '0.2.0', connected: false, oracleVersion: null });
    client.verifyToken.mockResolvedValue(false);
    render(<ConnectPanel />);
    await flush(500);

    expect(stepOf(2).dataset.status).toBe('error');
    expect(stepOf(2).textContent).toContain('rejected the token');
    expect(stepOf(3).dataset.status).toBe('locked');
  });

  it('skips the form when the connector is already connected and unlocks the statement step', async () => {
    sessionStorage.setItem(AGENT_TOKEN_STORAGE_KEY, 'secret');
    client.health.mockResolvedValue({ version: '0.2.0', connected: true, oracleVersion: 'Oracle 19.27' });
    client.verifyToken.mockResolvedValue(true);
    client.recentSql.mockResolvedValue({
      items: [
        { sqlId: 'abc123xyz', childNumber: 0, planHashValue: 42, sqlText: 'select 1 from dual', elapsedSec: 0.5, executions: 1, lastActive: '2026-10-01' },
      ],
    });
    client.fetchPlanWithMetadata.mockResolvedValue({ source: 'cursor', text: 'PLAN TEXT' });
    render(<ConnectPanel />);
    await flush(500);

    expect(stepOf(3).dataset.status).toBe('done');
    expect(stepOf(3).textContent).toContain('Connected — Oracle 19.27');
    expect(document.getElementById('agent-dsn')).toBeNull();
    expect(buttonByText('Disconnect')).toBeTruthy();

    // Step 4 controls are present and the recent list loaded automatically.
    expect(stepOf(4).dataset.status).toBe('current');
    expect(client.recentSql).toHaveBeenCalled();
    expect(buttonByText('Refresh')).toBeTruthy();
    expect(stepOf(4).textContent).toContain('abc123xyz');
    expect(stepOf(4).textContent).toContain('Attach DB metadata');

    click(buttonByText('Load'));
    await flush();
    expect(client.fetchPlanWithMetadata).toHaveBeenCalled();
    expect(loadAndParsePlan).toHaveBeenCalledWith('PLAN TEXT', undefined);
    expect(stepOf(4).textContent).toContain('Loaded abc123xyz');

    // By SQL ID tab keeps the manual form.
    click(buttonByText('By SQL ID'));
    expect(document.getElementById('manual-sql-id')).not.toBeNull();
    expect(document.querySelector('label[for="manual-child"]')?.textContent).toBe('Child #');
  });

  it('shows the empty-state hint when no statements are found', async () => {
    sessionStorage.setItem(AGENT_TOKEN_STORAGE_KEY, 'secret');
    client.health.mockResolvedValue({ version: '0.2.0', connected: true, oracleVersion: '19c' });
    client.verifyToken.mockResolvedValue(true);
    render(<ConnectPanel />);
    await flush(500);
    expect(stepOf(4).textContent).toContain('No statements found — run your query, then Refresh.');
  });

  it('describes the live state on the flow diagram', async () => {
    client.health.mockResolvedValue({ version: '0.2.0', connected: false, oracleVersion: null });
    render(<ConnectPanel />);
    await flush();
    const label = document.querySelector('[role="img"][aria-label^="Connection path"]')!.getAttribute('aria-label')!;
    expect(label).toContain('Connector running at 127.0.0.1:8521');
    expect(label).toContain('Database not connected');
  });

  it('shows the page host (not a hard-coded name) on the browser-tab diagram box', async () => {
    client.health.mockResolvedValue({ version: '0.2.0', connected: false, oracleVersion: null });
    render(<ConnectPanel />);
    await flush();
    const diagram = document.querySelector('[role="img"][aria-label^="Connection path"]')!;
    expect(window.location.host).not.toBe('');
    expect(diagram.textContent).toContain(window.location.host);
    expect(diagram.textContent).not.toContain('oraplanviz');
  });

  it('uses the amber waiting tone on the connector box while it is not running', async () => {
    client.health.mockRejectedValue(new AgentError('Agent not reachable'));
    render(<ConnectPanel />);
    await flush();
    const diagram = document.querySelector('[role="img"][aria-label^="Connection path"]')!;
    expect(diagram.textContent).toContain('waiting · 127.0.0.1:8521');
    expect(diagram.innerHTML).not.toContain('border-red-300');
    expect(diagram.innerHTML).toContain('border-amber-300');
  });

  it('points the outdated-agent upgrade hint at the pipx package name', async () => {
    sessionStorage.setItem(AGENT_TOKEN_STORAGE_KEY, 'secret');
    client.health.mockResolvedValue({ version: '0.0.1', connected: false, oracleVersion: null });
    client.verifyToken.mockResolvedValue(true);
    render(<ConnectPanel />);
    await flush(500);
    expect(stepOf(1).textContent).toContain('pipx upgrade oraplanviz-agent');
    expect(stepOf(1).textContent).not.toContain('pipx upgrade oraplanviz-db-connector');
  });

  it('clears a stale database error when the token changes', async () => {
    sessionStorage.setItem(AGENT_TOKEN_STORAGE_KEY, 'secret');
    client.health.mockResolvedValue({ version: '0.2.0', connected: false, oracleVersion: null });
    client.verifyToken.mockResolvedValue(true);
    client.connect.mockRejectedValue(new Error('ORA-01017: invalid credential'));
    render(<ConnectPanel />);
    await flush(500);

    const setValue = async (id: string, value: string) => {
      const input = document.getElementById(id) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await setValue('agent-dsn', 'host:1521/svc');
    await setValue('agent-user', 'scott');
    await setValue('agent-password', 'tiger');
    click(buttonByText('Connect'));
    await flush();
    expect(stepOf(3).textContent).toContain('ORA-01017');

    // Change the token, then put the original back so step 3 is visible again.
    click(buttonByText('Change'));
    await flush();
    await setValue('agent-token', 'other');
    await flush();
    await setValue('agent-token', 'secret');
    await flush(500);
    expect(stepOf(3).dataset.status).toBe('current');
    expect(stepOf(3).textContent).not.toContain('ORA-01017');
  });
});
