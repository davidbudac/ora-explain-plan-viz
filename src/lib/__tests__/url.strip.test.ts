import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseExplainPlan } from '../parser';
import { buildShareLink, stripUnusedXmlSections } from '../url';
import type { SharePayload, ShareResult } from '../url';

const EXAMPLES = join(__dirname, '../../examples');
const FIXTURES = join(__dirname, '../parser/__tests__/fixtures');
const REPORT = readFileSync(join(EXAMPLES, '23-sql_monitor-Window Sort Spill.txt'), 'utf-8');
const XML_CAPTURES: Array<[string, string]> = [EXAMPLES, FIXTURES]
  .flatMap((dir) => readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .map((name): [string, string] => [name, readFileSync(join(dir, name), 'utf-8')]))
  .filter(([, text]) => /<sql_monitor_report|<plan_monitor/i.test(text));

/** Builder that accepts only payloads whose plan text passes `fits`, and records what it accepted. */
function budgetBuilder(fits: (rawInput: string) => boolean) {
  const accepted: SharePayload[] = [];
  const build = async (payload: SharePayload): Promise<ShareResult> => {
    if (!fits(payload.plans[0].rawInput)) return { ok: false, error: 'Plan is too large to share via URL.' };
    accepted.push(payload);
    return { ok: true, url: 'https://x/#gz=a' };
  };
  return { build, accepted };
}

/** Everything the app reads from a plan. */
function parsed(text: string): unknown {
  return JSON.parse(JSON.stringify(parseExplainPlan(text)));
}

describe('share link for a SQL Monitor XML report over the size limit', () => {
  it('drops only what no view reads when that is enough to fit', async () => {
    const { build, accepted } = budgetBuilder((text) => text.length < REPORT.length);
    const result = await buildShareLink([{ rawInput: REPORT }], { build });

    expect(result.ok).toBe(true);
    const shared = accepted[0].plans[0].rawInput;
    const plan = parseExplainPlan(shared);
    // The report's activity_detail holds 9 one-sample buckets; its outline_data holds 8 hints.
    expect(plan.activityTimeline?.samples.reduce((sum, sample) => sum + sample.count, 0)).toBe(9);
    expect(plan.outlineHints).toHaveLength(8);
    expect(parsed(shared)).toEqual(parsed(REPORT));
  });

  it.each(XML_CAPTURES)('drops nothing the app reads from %s', (_name, text) => {
    const stripped = stripUnusedXmlSections(text);
    expect(stripped.length).toBeLessThan(text.length);
    expect(parsed(stripped)).toEqual(parsed(text));
  });

  it('names what the recipient loses when only the last-resort strip fits', async () => {
    const { build } = budgetBuilder((text) => {
      const plan = parseExplainPlan(text);
      return !plan.outlineHints && !plan.activityTimeline?.samples.length;
    });
    const result = await buildShareLink([{ rawInput: REPORT }], { build });

    expect(result.ok).toBe(true);
    const warning = result.ok ? result.warnings.join(' ') : '';
    expect(warning).toMatch(/activity/i);
    expect(warning).toMatch(/Waits/);
    expect(warning).toMatch(/outline/i);
  });

  it('points at the full export when no link fits', async () => {
    const { build } = budgetBuilder(() => false);
    const result = await buildShareLink([{ rawInput: REPORT }], { build });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(/Save annotated plan/);
  });
});
