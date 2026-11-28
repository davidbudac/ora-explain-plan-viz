import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parsePlan } from '../index';

const readExample = (name: string) => readFileSync(join(__dirname, '../../../examples', name), 'utf-8');
const node = (plan: ReturnType<typeof parsePlan>, id: number) => plan.allNodes.find((n) => n.id === id)!;

const EXADATA = '17-sql_monitor-Exadata Cell Offload (K. Osborne).txt';
const SKEWED = '18-sql_monitor-Skewed Parallel (J. Lewis).txt';
const PART_STAR = '27-sql_monitor-Partitioned Star Query.txt';

/** The report with its Global Information and Global Stats sections cut out (plan table only). */
function withoutGlobalSections(text: string): string {
  const lines = text.split('\n');
  const from = lines.findIndex((l) => l.startsWith('Global Information'));
  const to = lines.findIndex((l) => l.startsWith('Parallel Execution Details'));
  return [...lines.slice(0, from), ...lines.slice(to)].join('\n');
}

describe('SQL Monitor statement duration', () => {
  it('text: keeps the report Duration, the accumulated Global Stats elapsed time and the root window apart', () => {
    const plan = parsePlan(readExample(EXADATA));
    // Global Information "Duration : 13s", Global Stats "Elapsed Time(s) 96" (8 PX servers), root "Time Active(s) 1".
    expect(plan.monitorMetadata?.duration).toBe(13);
    expect(plan.monitorMetadata?.status).toBe('DONE (ALL ROWS)');
    expect(plan.totalElapsedTime).toBe(96_000);
    expect(plan.rootNode?.actualTime).toBe(1000);
  });

  it('text: reads the Duration of a report whose root window is blank', () => {
    const plan = parsePlan(readExample(SKEWED));
    expect(plan.monitorMetadata?.duration).toBe(221);
    expect(plan.monitorMetadata?.status).toBe('EXECUTING');
    expect(plan.totalElapsedTime).toBe(222_000);
    expect(plan.rootNode?.actualTime).toBeUndefined();
  });

  it('text: leaves duration and elapsed time unknown when the report has no Global sections', () => {
    const plan = parsePlan(withoutGlobalSections(readExample(EXADATA)));
    expect(plan.allNodes).toHaveLength(7);
    expect(plan.monitorMetadata?.duration).toBeUndefined();
    expect(plan.totalElapsedTime).toBeUndefined();
  });

  it('XML: target duration is the wall clock, the global elapsed_time is summed over PX processes', () => {
    const plan = parsePlan(readExample(PART_STAR));
    expect(plan.monitorMetadata?.duration).toBeCloseTo(0.0861, 6);
    expect(plan.totalElapsedTime).toBeCloseTo(325.716, 3);
  });

  it('XML: leaves elapsed time unknown, not the root active window, when the global elapsed_time is absent', () => {
    const xml = readExample(PART_STAR).replace('<stat name="elapsed_time">325716</stat>', '');
    const plan = parsePlan(xml);
    expect(plan.timeIsActiveWindow).toBe(true);
    expect(plan.rootNode?.actualTime).toBe(1000);
    expect(plan.totalElapsedTime).toBeUndefined();
  });
});

describe('SQL Monitor text Start Active offsets', () => {
  it('places each operation from its Start Active offset and Time Active window', () => {
    const plan = parsePlan(readExample(EXADATA));
    // | 4 | SORT AGGREGATE | ... | 13 | +1 | ...  → active seconds 1..13
    expect(node(plan, 4).firstActiveOffset).toBe(1);
    expect(node(plan, 4).lastActiveOffset).toBe(13);
    // | 3 | PX SEND QC (RANDOM) | ... | 2 | +12 | ...  → 12..13
    expect(node(plan, 3).firstActiveOffset).toBe(12);
    expect(node(plan, 3).lastActiveOffset).toBe(13);
    expect(node(plan, 0).firstActiveOffset).toBe(13);
    expect(node(plan, 0).lastActiveOffset).toBe(13);
  });

  it('leaves operations with blank Start Active cells unplaced', () => {
    const plan = parsePlan(readExample(SKEWED));
    expect(node(plan, 0).firstActiveOffset).toBeUndefined();
    expect(node(plan, 0).lastActiveOffset).toBeUndefined();
    // | 22 | TABLE ACCESS BY LOCAL INDEX ROWID | ... | 3 | +1 | ...
    expect(node(plan, 22).firstActiveOffset).toBe(1);
    expect(node(plan, 22).lastActiveOffset).toBe(3);
    // | -> 30 | TABLE ACCESS BY LOCAL INDEX ROWID | ... | 220 | +2 | ...
    expect(node(plan, 30).firstActiveOffset).toBe(2);
    expect(node(plan, 30).lastActiveOffset).toBe(221);
  });
});
