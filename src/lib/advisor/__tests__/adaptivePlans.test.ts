import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { parsePlan } from '../../parser';
import { runAdvisor } from '../engine';
import { selfBuffers } from '../rules/shared';
import { byId } from './helpers';

// Real 19c capture (DISPLAY_CURSOR ALLSTATS LAST +ADAPTIVE). The adaptive join resolved to nested loops:
//    3 UNION-ALL
//  - 27   HASH JOIN               (inactive)
//    28     NESTED LOOPS
//  - 29       STATISTICS COLLECTOR (inactive)
//    30         INDEX FULL SCAN    <- outer input of 28, under an inactive row
//    31       INDEX RANGE SCAN     <- inner input of 28
//  - 32     INDEX FULL SCAN        (inactive)
// Never edit the fixture file: each test parses it and adjusts numbers on the parsed nodes in memory.
const adaptive = () =>
  parsePlan(readFileSync(join(__dirname, '../../parser/__tests__/fixtures/allstats-adaptive-19c.txt'), 'utf-8'));

const findingsOf = (plan: ReturnType<typeof adaptive>, ruleId: string) =>
  runAdvisor(plan, null).findings.filter((f) => f.ruleId === ruleId);

describe('advisor rules on adaptive plans (inactive rows are looked through)', () => {
  it('has the shape these tests rely on', () => {
    const plan = adaptive();
    expect([27, 29, 32].every((id) => byId(plan, id).inactive === true)).toBe(true);
    expect([3, 28, 30, 31].some((id) => byId(plan, id).inactive === true)).toBe(false);
    expect(byId(plan, 28).children.map((n) => n.id)).toEqual([29, 31]);
  });

  it('nested-loop-volume sees the outer input under the STATISTICS COLLECTOR', () => {
    const plan = adaptive();
    Object.assign(byId(plan, 30), { actualRows: 500_000 });
    Object.assign(byId(plan, 31), { starts: 500_000, actualRows: 5_000_000 });
    const findings = findingsOf(plan, 'nested-loop-volume');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'critical', nodeIds: [28] });
    expect(findings[0].explanation).toContain('probed 500,000 times');
  });

  it('hash-join-build-side finds build and probe when the join resolved to a hash join', () => {
    const plan = adaptive();
    // The other resolution of the same adaptive join: HASH JOIN 27 ran, NESTED LOOPS 28 and its inner 31 did not.
    byId(plan, 27).inactive = false;
    byId(plan, 28).inactive = true;
    byId(plan, 31).inactive = true;
    byId(plan, 32).inactive = false;
    Object.assign(byId(plan, 30), { actualRows: 5_000_000 });
    Object.assign(byId(plan, 32), { starts: 1, actualRows: 10 });
    const findings = findingsOf(plan, 'hash-join-build-side');
    expect(findings).toHaveLength(1);
    expect(findings[0].nodeIds).toEqual([27]);
    expect(findings[0].explanation).toContain('operation 30');
    expect(findings[0].explanation).toContain('operation 32');
  });

  it('cardinality-mismatch attributes the error to the input under the inactive row, not to the join', () => {
    const plan = adaptive();
    Object.assign(byId(plan, 30), { actualRows: 100_000 }); // estimated 1
    Object.assign(byId(plan, 28), { actualRows: 100_000 }); // estimated 1: inherits the error of 30
    const findings = findingsOf(plan, 'cardinality-mismatch');
    expect(findings.some((f) => f.nodeIds.includes(28))).toBe(false);
    const origin = findings.find((f) => f.nodeIds.includes(30));
    expect(origin).toBeDefined();
    expect(origin!.explanation).toContain('The estimates of 1 operation above it are off because of this error.');
  });

  it('per-row-reexecution reaches a REMOTE inner side below an inactive row', () => {
    const plan = adaptive();
    Object.assign(byId(plan, 31), { operation: 'REMOTE', starts: 5_000, actualRows: 5_000 });
    const findings = findingsOf(plan, 'per-row-reexecution');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'critical', nodeIds: [31] });
    expect(findings[0].explanation).toContain('the inner side of the NESTED LOOPS at operation 28');
  });

  it('selfBuffers subtracts the active rows below an inactive child', () => {
    const plan = adaptive();
    expect(selfBuffers(byId(plan, 28))).toBe(0); // 2 - 1 (30) - 1 (31); was 1 when 30 was dropped with 29
    expect(selfBuffers(byId(plan, 3))).toBe(0); // 17495 - 17493 (4) - 2 (28); was 2 when 28 was dropped with 27
  });
});
