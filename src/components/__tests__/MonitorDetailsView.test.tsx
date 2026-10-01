/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sqlMonitorXmlParser } from '../../lib/parser/sqlMonitorParser';

const ctx = vi.hoisted(() => ({ parsedPlan: null as unknown }));

vi.mock('../../hooks/usePlanContext', () => ({
  usePlan: () => ({ parsedPlan: ctx.parsedPlan }),
}));

import { MonitorDetailsView } from '../views/MonitorDetailsView';
import { cleanup, render } from '../ui/__tests__/testUtils';

function load(file: string) {
  ctx.parsedPlan = sqlMonitorXmlParser.parse(
    readFileSync(join(__dirname, '../../examples', file), 'utf-8'),
  );
}

function sectionTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('h3')).map((h) => h.textContent ?? '');
}

describe('MonitorDetailsView plan extras', () => {
  afterEach(() => {
    cleanup();
    ctx.parsedPlan = null;
  });

  it('renders Plan Info, Outline Hints and Parallel Servers for a parallel capture', () => {
    load('27-sql_monitor-Partitioned Star Query.txt');
    const { container } = render(<MonitorDetailsView />);
    expect(sectionTitles(container)).toEqual(
      expect.arrayContaining(['Parallel Servers', 'Plan Info', 'Outline Hints']),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('DOP 4');
    expect(text).toContain('p005');
    expect(text).toContain('Set 2: max vs avg (4 servers)');
    expect(text).toContain('FULL(@"SEL$9E43CB6E" "P"@"SEL$1")');
    expect(text).toContain('plan_hash_full');
    expect(text).not.toContain('nodeid/pflags');
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Copy all'))).toBe(true);
  });

  it('omits Parallel Servers for a serial capture but keeps the other sections', () => {
    load('21-sql_monitor-Star Schema Rollup.txt');
    const { container } = render(<MonitorDetailsView />);
    const titles = sectionTitles(container);
    expect(titles).not.toContain('Parallel Servers');
    expect(titles).toEqual(expect.arrayContaining(['Plan Info', 'Outline Hints']));
  });
});
