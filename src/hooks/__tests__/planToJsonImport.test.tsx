import { act } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { renderPlanContext } from '../../components/ui/__tests__/planContext';

// Real Oracle 19c terminal output of scripts/plan_to_json.sql.
const OUTPUT = readFileSync(join(__dirname, '../../lib/__tests__/fixtures/plan-to-json-cursor-19c.txt'), 'utf-8');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe('pasting plan_to_json.sql output', () => {
  it('loads the plan and attaches its embedded metadata bundle in one go', async () => {
    const ctx = renderPlanContext();
    await act(async () => {
      await ctx.current().parsePlan(OUTPUT);
    });
    const slot = ctx.current().plans[ctx.current().activePlanIndex];
    expect(slot.error).toBeNull();
    expect(slot.parsedPlan?.sqlId).toBe('a1nvpc4f1kamw');
    expect(slot.parsedPlan?.planHashValue).toBe('2030497504');
    expect(slot.parsedPlan?.hasActualStats).toBe(true);
    expect(slot.parsedPlan?.warnings ?? []).toEqual([]);
    // The drawer shows the plan text, not the JSON.
    expect(slot.rawInput.startsWith('SQL_ID  a1nvpc4f1kamw')).toBe(true);
    expect(slot.draftInput).toBe(slot.rawInput);
    expect(Object.keys(slot.metadataBundle?.objects ?? {}).sort()).toEqual([
      'CAPDEMO.CAP_FIXTURE_SNAPSHOT',
      'CAPDEMO.CAP_FIXTURE_TIME_MODEL',
    ]);
  });

  it('loads the plan alone when the metadata gather printed null', async () => {
    const withoutBundle = OUTPUT.replace(/,"metadataBundle":[\s\S]*\n\}\n==== ORAPLANVIZ/, ',"metadataBundle":\nnull\n}\n==== ORAPLANVIZ');
    expect(withoutBundle).not.toBe(OUTPUT);
    const ctx = renderPlanContext();
    await act(async () => {
      await ctx.current().parsePlan(withoutBundle);
    });
    const slot = ctx.current().plans[ctx.current().activePlanIndex];
    expect(slot.error).toBeNull();
    expect(slot.parsedPlan?.sqlId).toBe('a1nvpc4f1kamw');
    expect(slot.metadataBundle).toBeNull();
  });
});
