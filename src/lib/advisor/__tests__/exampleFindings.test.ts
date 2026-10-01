import { describe, it, expect } from 'vitest';
import { SAMPLE_PLANS } from '../../../examples';
import { parsePlan } from '../../parser';
import { parseBundle } from '../../metadata/bundle';
import { runAdvisor } from '../engine';

// Rules added with the functional backlog plus the two they changed. Findings of other rules
// are deliberately left out so this snapshot only moves when these rules do.
const TRACKED = new Set([
  'cardinality-mismatch',
  'spill-to-disk',
  'nested-loop-volume',
  'per-row-reexecution',
  'index-rows-discarded',
  'buffer-gets-per-row',
  'function-on-indexed-column',
  'hash-join-build-side',
  'px-skew',
  'note-dynamic-sampling',
  'note-sql-plan-directive',
  'note-adaptive-plan',
  'note-sql-profile',
  'note-sql-baseline',
  'note-sql-patch',
  'note-stored-outline',
  'note-cardinality-feedback',
]);

function trackedFindings(name: string): string[] {
  const sample = SAMPLE_PLANS.find((s) => s.name === name);
  if (!sample) throw new Error(`example ${name} not found`);
  const plan = parsePlan(sample.data);
  const bundle = sample.metadata ? parseBundle(sample.metadata) : null;
  return runAdvisor(plan, bundle).findings
    .filter((f) => TRACKED.has(f.ruleId))
    .map((f) => `${f.severity}:${f.ruleId}@${f.nodeIds.join(',')}`);
}

describe('advisor findings on the bundled examples', () => {
  it('runs on every example without throwing', () => {
    for (const sample of SAMPLE_PLANS) {
      expect(() => trackedFindings(sample.name), sample.name).not.toThrow();
    }
  });

  it('keeps the new rules quiet on examples where they do not apply', () => {
    // Only these rules are new; nothing in the bundled examples is a per-row subquery, a discarded-index
    // read, a buffer hog, a wrapped indexed column an oversized build side or a skewed PX server set (example 27's four servers per set are within ~1.3x).
    const NEW = ['per-row-reexecution', 'index-rows-discarded', 'buffer-gets-per-row', 'function-on-indexed-column', 'hash-join-build-side', 'px-skew'];
    for (const sample of SAMPLE_PLANS) {
      const hits = trackedFindings(sample.name).filter((f) => NEW.some((id) => f.includes(`:${id}@`)));
      expect(hits, sample.name).toEqual([]);
    }
  });

  it('matches the per-example finding list', () => {
    const actual = Object.fromEntries(SAMPLE_PLANS.map((s) => [s.name, trackedFindings(s.name)]));
    expect(actual).toMatchSnapshot();
  });
});
