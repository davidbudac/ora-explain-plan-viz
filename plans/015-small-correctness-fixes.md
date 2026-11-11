# Plan 015: Five small correctness fixes — Storage filter in share links, OPT_PARAM outline diff, zero values in SQL Monitor XML, "× executions" wording, SQL ID of a SQL Monitor text report

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- src/lib/url.ts src/lib/clientReport.ts packages/ora-plan-core/src/hints.ts packages/ora-plan-core/src/format.ts packages/ora-plan-core/src/parser/sqlMonitorParser.ts packages/ora-plan-core/src/advisor/rules/cardinalityMismatch.ts src/lib/__tests__ src/lib/parser/__tests__ src/lib/advisor/__tests__`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> Expected, harmless differences from earlier plans:
> - `sqlMonitorParser.ts`: `plans/012-plan-table-prefix-and-nbsp.md` changed the
>   import list and the first line of `sqlMonitorTextParser.parse`;
>   `plans/014-validate-sql-id-and-plan-hash.md` wrapped three values in
>   `normalizeSqlId(…)` / `normalizePlanHash(…)` (see Step 5).
> - `advisor/rules/cardinalityMismatch.ts`:
>   `plans/009-advisor-effective-children.md` changed its imports and the body
>   of `evaluate` (not `describeEstimate`, which this plan replaces).
> - `format.ts`: `plans/016-formatter-unit-boundaries.md` rewrites the
>   formatters at the top of the file and runs **after** this plan.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/014-validate-sql-id-and-plan-hash.md` and
  `plans/009-advisor-effective-children.md` (same files — run after them to
  avoid edit conflicts; no logical dependency)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

Five independent defects, each small, each visible to a user:

- **(a)** A share link made while the *Storage* predicate filter is on (Exadata
  plans) opens for the recipient with that filter silently dropped — they see a
  different set of operations than the sender.
- **(b)** Comparing two plans whose outlines contain `OPT_PARAM(...)` entries
  reports parameters as "changed" into each other, or as "only in" one plan,
  merely because of their order or because one plan has an extra parameter.
- **(c)** In SQL Monitor XML an optimizer cost, row estimate or byte estimate of
  `0` is read as "missing" (`parseInt(x) || undefined`), so e.g. an
  `INDEX UNIQUE SCAN` with `<cost>0</cost>` shows no cost and no self cost. In
  the legacy XML shape A-Rows `0` is dropped the same way. Active-window
  offsets are computed with the viewer's local clock and are an hour off when
  the report straddles the viewer's daylight-saving change.
- **(d)** The explanation next to a cardinality mismatch prints arithmetic that
  does not add up: "estimated 835 rows (E-Rows 5 × 786 starts)". The total is
  right (5 × 167); the text multiplies by the operation's own Starts although
  the total was built with a different multiplier (see "Oracle semantics").
- **(e)** A SQL Monitor **text** report prints the statement before its header
  block, and the SQL ID is taken from the first `sql_id <word>` anywhere — so a
  statement like `select sql_id from v$sql` yields the SQL ID `from`.

## Current state

### Repository rules that apply

- The real code is in `packages/ora-plan-core/src/...`. Same-named files under
  `src/lib/` (`src/lib/format.ts`, `src/lib/hints.ts`,
  `src/lib/parser/sqlMonitorParser.ts`, `src/lib/advisor/rules/*.ts`) are
  one-line `export *` shims — **never edit a shim**. `src/lib/url.ts` and
  `src/lib/clientReport.ts` are real app files. App code and tests import
  through the shims without an extension (`from '../format'`).
- Inside the package, sibling imports carry an explicit `.ts` extension; no
  React, no DOM (except `DOMParser` for SQL Monitor XML). `import type` for
  type-only imports. TypeScript strict (`noUnusedLocals`).
- Fixtures in `src/lib/parser/__tests__/fixtures/` and examples in
  `src/examples/` are real captures: never edit them. Synthetic plans for unit
  tests are built with `buildPlan` from
  `src/lib/advisor/__tests__/helpers.ts` (advisor tests) or inline objects.
- Every fixture and example must keep parsing with no `ParsedPlan.warnings`.

### Oracle semantics behind (d) (project rules, quoted)

> E-Rows is per start, A-Rows is cumulative. Compare A-Rows only with
> `estimatedRowsTotal` via `nodeCardinalityRatio(node)`; never
> `actualRows / rows`. The total is E-Rows × Starts, except: inside a PX slave
> set and not on a NESTED LOOPS/FILTER probe side → E-Rows; under a partition
> iterator → the topmost iterator's Starts; a rowid fetch fed by an NLJ-batching
> / batched-rowid nested loop → the Starts of the index supplying the rowids;
> Starts = 0 or a COUNT STOPKEY cut-off → undefined.

So `estimatedRowsTotal / rows` is the number of executions the total was built
with, and it is **not** always `node.starts`. `format.ts` already exports the
helper that returns it (`packages/ora-plan-core/src/format.ts:85-93`):

```ts
export function effectiveExecutions(node: Pick<PlanNode, 'rows' | 'estimatedRowsTotal'>): number | undefined {
  const { rows, estimatedRowsTotal: total } = node;
  if (rows === undefined || total === undefined || rows <= 0 || total <= rows) return undefined;
  const raw = total / rows;
  // Floating noise (e.g. 80000 / 4 computed from a rounded total) — it is an execution count.
  const rounded = Math.round(raw);
  const executions = Math.abs(raw - rounded) < 1e-6 * Math.max(1, raw) ? rounded : raw;
  return executions > 1 ? executions : undefined;
}
```

`formatEstimatedRows` (same file) already uses it and says "executions"; the
three places in (d) do not.

### Excerpts (commit `b5635d8`)

**(a)** `src/lib/url.ts:531-534` (inside `readFilters`):

```ts
  if (Array.isArray(src.predicateTypes)) {
    const allowed: PredicateType[] = ['access', 'filter', 'none'];
    out.predicateTypes = src.predicateTypes.filter((v): v is PredicateType => allowed.includes(v as PredicateType));
  }
```

The type (`packages/ora-plan-core/src/types.ts:248`) is
`export type PredicateType = 'access' | 'filter' | 'storage' | 'none';` and the
filter panel offers all four.

**(b)** `packages/ora-plan-core/src/hints.ts:533-541`:

```ts
/** Cross-plan decision key: decision + the aliases (or query block) it names. */
export function outlineDecisionKey(hint: ParsedHint): string {
  const target = hint.aliases.length > 0
    ? [...hint.aliases].sort().join(',')
    : hint.queryBlock ?? '';
  // LEADING is one decision per query block, whatever the alias order.
  if (hint.family === 'order') return `order@${hint.queryBlock ?? ''}`;
  return `${decisionName(hint)}@${target}`;
}
```

`parseHint("OPT_PARAM('optimizer_index_cost_adj' 20)")` gives
`name: 'OPT_PARAM'`, `args: ["'optimizer_index_cost_adj'", '20']` (single
quotes are kept in `args`), no aliases, no query block — so every `OPT_PARAM`
gets the same key `opt_param@`.

**(c)** `packages/ora-plan-core/src/parser/sqlMonitorParser.ts`

`:877-893` (inside `parsePlanSection`):

```ts
    // Estimated cardinality (rows)
    const card = op.querySelector(':scope > card');
    if (card?.textContent) {
      estimates.rows = parseInt(card.textContent, 10) || undefined;
    }

    // Bytes
    const bytes = op.querySelector(':scope > bytes');
    if (bytes?.textContent) {
      estimates.bytes = parseInt(bytes.textContent, 10) || undefined;
    }

    // Cost
    const cost = op.querySelector(':scope > cost');
    if (cost?.textContent) {
      estimates.cost = parseInt(cost.textContent, 10) || undefined;
    }
```

`:982-989` (inside `parseMonitorOperation`):

```ts
  if (optimizer) {
    const card = optimizer.querySelector('cardinality');
    if (card?.textContent) rows = parseInt(card.textContent, 10) || undefined;
    const bytesEl = optimizer.querySelector('bytes');
    if (bytesEl?.textContent) bytes = parseInt(bytesEl.textContent, 10) || undefined;
    const costEl = optimizer.querySelector('cost');
    if (costEl?.textContent) cost = parseInt(costEl.textContent, 10) || undefined;
  }
```

`:1328-1359` (`parseOracleTimestamp`, then `getDirectChildInt`):

```ts
/**
 * Parse an Oracle SQL Monitor timestamp of the form "MM/DD/YYYY HH24:MI:SS"
 * (e.g. "07/04/2026 18:51:54") into epoch milliseconds. Returns undefined if
 * the string doesn't match — do NOT use Date.parse(), which does not reliably
 * handle this format across environments.
 *
 * Uses the *local* Date constructor (not UTC). Since this is only ever used
 * to diff two timestamps parsed the same way from the same report, timezone
 * offset cancels out — but the returned epoch ms is not a true UTC timestamp.
 */
export function parseOracleTimestamp(s: string): number | undefined {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  const [, mm, dd, yyyy, hh, mi, ss] = m;
  const ms = new Date(
    parseInt(yyyy, 10),
    parseInt(mm, 10) - 1,
    parseInt(dd, 10),
    parseInt(hh, 10),
    parseInt(mi, 10),
    parseInt(ss, 10)
  ).getTime();
  return isNaN(ms) ? undefined : ms;
}

/** Get an integer value from a direct child element. */
function getDirectChildInt(parent: Element, tagName: string): number | undefined {
```

`parseOracleTimestamp` has two callers, both in this file, and both only
subtract two of its results (offset from `sql_exec_start`).

`:1487-1498` (inside `parseLegacyXmlOperation`; the six lines with `||` between
two number lookups):

```ts
    rows: parseLegacyXmlNumber(op, 'cardinality') || parseLegacyXmlNumber(op, 'e_rows'),
    bytes: parseLegacyXmlNumber(op, 'bytes'),
    cost: parseLegacyXmlNumber(op, 'cost'),
    actualRows: parseLegacyXmlNumber(op, 'output_rows') || parseLegacyXmlNumber(op, 'a_rows'),
    actualTime: parseLegacyXmlNumber(op, 'elapsed_time'),
    starts: parseLegacyXmlNumber(op, 'starts'),
    memoryUsed: parseLegacyXmlNumber(op, 'max_memory') || parseLegacyXmlNumber(op, 'used_mem'),
    tempSpace: parseLegacyXmlNumber(op, 'temp_space'),
    tempUsed: parseLegacyXmlNumber(op, 'used_tmp'),
    physicalReads: parseLegacyXmlNumber(op, 'physical_reads') || parseLegacyXmlNumber(op, 'cr_buffer_gets'),
    logicalReads: parseLegacyXmlNumber(op, 'logical_reads') || parseLegacyXmlNumber(op, 'buffer_gets'),
    activityPercent: parseLegacyXmlFloat(op, 'activity_percent') || parseLegacyXmlFloat(op, 'percent'),
```

(`parseLegacyXmlNumber` / `parseLegacyXmlFloat` already return `0` for `"0"`;
only the `||` loses it.)

**(d)** `packages/ora-plan-core/src/format.ts:121-136`:

```ts
/**
 * One-line explanation of a node's estimate-vs-actual comparison, e.g.
 * "Cardinality mismatch: estimated 1,000 rows (E-Rows 1 × 1,000 starts) vs A-Rows 250,000".
 * The "× starts" breakdown appears only when it changes the number.
 */
export function cardinalityMismatchText(node: PlanNode): string {
  const total = node.estimatedRowsTotal;
  const fmt = (n: number | undefined) => formatNumberShort(n) ?? '?';
  if (total === undefined) {
    return `Cardinality mismatch: E-Rows ${fmt(node.rows)} vs A-Rows ${fmt(node.actualRows)}`;
  }
  const perStart = node.starts !== undefined && node.starts > 1 && node.rows !== undefined && node.rows !== total
    ? ` (E-Rows ${fmt(node.rows)} × ${fmt(node.starts)} starts)`
    : '';
  return `Cardinality mismatch: estimated ${fmt(total)} rows${perStart} vs A-Rows ${fmt(node.actualRows)}`;
}
```

`packages/ora-plan-core/src/advisor/rules/cardinalityMismatch.ts:3` and `:6-12`,
and its only call at `:79`:

```ts
import { nodeCardinalityRatio, cardinalityRatioSeverity } from '../../format.ts';
```

```ts
function describeEstimate(c: { eRowsPerStart?: number; starts?: number; eRowsTotal: number }): string {
  if (c.starts !== undefined && c.starts > 1 && c.eRowsPerStart !== undefined && c.eRowsPerStart !== c.eRowsTotal) {
    const unit = c.eRowsPerStart === 1 ? 'row' : 'rows';
    return `Estimated ${c.eRowsPerStart.toLocaleString()} ${unit} per start × ${c.starts.toLocaleString()} starts = ${c.eRowsTotal.toLocaleString()} rows`;
  }
  return `Estimated ${c.eRowsTotal.toLocaleString()} rows (E-Rows)`;
}
```

```ts
        explanation: `${describeEstimate({ eRowsPerStart: node.rows, starts: node.starts, eRowsTotal: node.estimatedRowsTotal as number })} but actually produced ${(node.actualRows as number).toLocaleString()} rows (A-Rows), a ${c.deviation.toFixed(1)}x deviation.${root}${inheritNote}`,
```

`src/lib/clientReport.ts:5-12` and `:270-277` — a third copy of the same
arithmetic, in the exported client report:

```ts
import {
  nodeCardinalityRatio,
  formatCardinalityRatio,
  cardinalityRatioSeverity,
  formatBytes,
  formatNumberShort,
  formatTimeCompact,
} from './format';
```

```ts
/** Total estimate, with the per-start breakdown when Starts > 1 so it visibly matches the deviation. */
function estimateCell(node: PlanNode): string {
  const total = formatNumberShort(node.estimatedRowsTotal) ?? '';
  if (node.starts !== undefined && node.starts > 1 && node.rows !== undefined && node.rows !== node.estimatedRowsTotal) {
    return `${total} <span style="color:#64748b">(${formatNumberShort(node.rows) ?? ''} &times; ${formatNumberShort(node.starts) ?? ''} starts)</span>`;
  }
  return total;
}
```

**(e)** `packages/ora-plan-core/src/parser/sqlMonitorParser.ts:222-233`:

```ts
function extractSqlId(lines: string[]): string | undefined {
  for (const line of lines) {
    // Matches both the SQL Monitor header ("SQL ID : 7ch0an9vx5ysp") and the
    // DBMS_XPLAN.DISPLAY_CURSOR header ("SQL_ID  7ch0an9vx5ysp, child number 0"),
    // which this parser also handles via its A-Rows detection.
    const match = line.match(/SQL[\s_]*ID[:\s]+(\w+)/i);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}
```

If `plans/014-validate-sql-id-and-plan-hash.md` has landed, the inner line
reads `return normalizeSqlId(match[1]);` and `normalizeSqlId` is imported from
`./values.ts`. Step 5 gives both variants.

The real header forms are ` SQL ID              :  3cjg20q2vw41f` (SQL Monitor
"Global Information", see
`src/examples/18-sql_monitor-Skewed Parallel (J. Lewis).txt:41`) and
`SQL_ID  7ch0an9vx5ysp, child number 0` (DISPLAY_CURSOR).

### Verified outcome of the design

Applied to a scratch copy on top of plans 012–014: only **two** existing test
expectations change (both are the "× starts" wording, Step 4); the parsed
output of all fixtures and examples differs in exactly four fields (two
operations whose cost `0` is now read, Step 3); all 15 new tests fail on the
old code and pass on the new.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest; at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`, ~15 s (more if earlier plans landed) |
| One file | `npx vitest run --environment jsdom path/to/file.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):

- `src/lib/url.ts` (a)
- `packages/ora-plan-core/src/hints.ts` (b)
- `packages/ora-plan-core/src/parser/sqlMonitorParser.ts` (c), (e)
- `packages/ora-plan-core/src/format.ts` (d) — `cardinalityMismatchText` only
- `packages/ora-plan-core/src/advisor/rules/cardinalityMismatch.ts` (d) —
  `describeEstimate`, its call, one import
- `src/lib/clientReport.ts` (d) — `estimateCell`, one import
- Tests: `src/lib/__tests__/url.workspace.test.ts`,
  `src/lib/__tests__/hints.test.ts`,
  `src/lib/parser/__tests__/sqlMonitorXml.test.ts`,
  `src/lib/parser/__tests__/allstats.test.ts`,
  `src/lib/__tests__/estimatedRows.test.ts`,
  `src/lib/advisor/__tests__/cardinalityMismatch.test.ts`,
  `src/lib/__tests__/clientReport.test.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):

- The formatters at the top of `format.ts` (`formatNumberShort`, `formatBytes`,
  `formatTime*`) — `plans/016-formatter-unit-boundaries.md`.
- `effectiveExecutions`, `formatEstimatedRows`, `computeEstimatedRowTotals` —
  they are correct; (d) only makes three texts use them.
- The rest of `cardinalityMismatch.ts` (`evaluate`, `inputsOff`, …) —
  `plans/009-advisor-effective-children.md`.
- SQL Monitor text reports: reading `Duration` or the SQL text block (a missing
  feature, not this bug).
- `parseLegacyXmlNumber` / `parseLegacyXmlFloat` themselves, and
  `getStatByName` (they handle 0 correctly).
- Other wordings that mention "starts" as a concept (`SankeyView.tsx`,
  `ScatterView.tsx`, `CommandPalette.tsx`, the handoff's "Reading the numbers",
  `site/docs.html`, the skill) — they describe the rule, not this arithmetic.
- Fixtures, examples, and the `src/lib/**` shims.

## Git workflow

- Branch: `fix/small-correctness-fixes`
- One commit per step (a)–(e), conventional-commit style as in the repo's
  history (`fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`),
  e.g. `fix(share): keep the Storage predicate filter in share links`,
  `fix(hints): key OPT_PARAM outline entries by parameter`,
  `fix(parser): read 0 as a value in SQL Monitor XML`,
  `fix(advisor): explain estimates with the executions the total used`,
  `fix(parser): take the SQL ID of a SQL Monitor text report from its header line`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Record what every fixture and example parses to today

Create these two scripts **outside the repository** and run the first from the
repository root:

```bash
mkdir -p /tmp/oraplan-015
cat > /tmp/oraplan-015/dump-plans.mts <<'EOF'
// Characterisation dump: parse every real fixture and bundled example, print one JSON document.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const require = createRequire(join(root, 'package.json'));
// SQL Monitor XML parsing needs a DOMParser; jsdom is a devDependency of the repo.
const { JSDOM } = require('jsdom');
(globalThis as Record<string, unknown>).DOMParser = new JSDOM('').window.DOMParser;

const core = await import(pathToFileURL(join(root, 'packages/ora-plan-core/src/index.ts')).href);

const dirs = ['src/lib/parser/__tests__/fixtures', 'src/examples'];
const out: Record<string, unknown> = {};
for (const dir of dirs) {
  for (const name of readdirSync(join(root, dir)).sort()) {
    if (!/\.(txt|csv)$/.test(name)) continue;
    const plan = core.parsePlan(readFileSync(join(root, dir, name), 'utf-8'));
    out[`${dir}/${name}`] = JSON.parse(
      JSON.stringify(plan, (key, value) => {
        if (key === 'rootNode') return value ? value.id : null;
        if (key === 'children') return (value as { id: number }[]).map((c) => c.id);
        return value;
      }),
    );
  }
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
EOF
cat > /tmp/oraplan-015/cmp-plans.mjs <<'EOF'
// Field-by-field comparison of two dump-plans.mts outputs. Prints one line per difference.
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map((path) => JSON.parse(readFileSync(path, 'utf-8')));
const show = (value) => JSON.stringify(value) ?? 'undefined';
for (const file of Object.keys(a)) {
  const name = file.split('/').pop();
  for (const key of new Set([...Object.keys(a[file]), ...Object.keys(b[file])])) {
    if (key === 'allNodes') continue;
    if (show(a[file][key]) !== show(b[file][key])) console.log(name, 'plan', key, show(a[file][key]), '->', show(b[file][key]));
  }
  a[file].allNodes.forEach((before, i) => {
    const after = b[file].allNodes[i] ?? {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (show(before[key]) !== show(after[key])) console.log(name, 'id', before.id, key, show(before[key]), '->', show(after[key]));
    }
  });
}
EOF
npx tsx /tmp/oraplan-015/dump-plans.mts > /tmp/oraplan-015/before.json
```

**Verify**: `node -e "console.log(Object.keys(require('/tmp/oraplan-015/before.json')).length)"` → `28`

### Step 1 (a): Keep the Storage predicate filter in share links

In `src/lib/url.ts`, `readFilters`, change the allow-list to all four values:

```ts
    const allowed: PredicateType[] = ['access', 'filter', 'storage', 'none'];
```

In `src/lib/__tests__/url.workspace.test.ts`, inside
`describe('buildShareWorkspace / readShareWorkspace', …)`, directly before
`it('returns null for an old link without a workspace block', …)`, add (the
describe already defines `input` and the file defines `baseFilters`):

```ts
  it('keeps every predicate-type filter the app offers, including Storage', () => {
    const filters: FilterState = { ...baseFilters, predicateTypes: ['storage', 'filter'] };
    const workspace = buildShareWorkspace({ ...input, compareMetrics: ['cost'], filters });
    const payload = JSON.parse(JSON.stringify({ plans: [{ rawInput: 'a' }, { rawInput: 'b' }], workspace })) as SharePayload;
    expect(readShareWorkspace(payload, 2)?.filters).toEqual({ predicateTypes: ['storage', 'filter'] });

    const all = { plans: [{ rawInput: 'a' }], workspace: { v: 1, filters: { predicateTypes: ['access', 'filter', 'storage', 'none', 'x'] } } };
    expect(readShareWorkspace(all as unknown as SharePayload, 1)?.filters).toEqual({
      predicateTypes: ['access', 'filter', 'storage', 'none'],
    });
  });
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/url.workspace.test.ts`
→ all pass (1 more than before).

### Step 2 (b): Key `OPT_PARAM` outline entries by parameter name

In `packages/ora-plan-core/src/hints.ts`, `outlineDecisionKey`, add three lines
after the `if (hint.family === 'order') …` line:

```ts
  // OPT_PARAM names no alias or query block: each parameter is its own decision.
  if (hint.name === 'OPT_PARAM' && hint.args.length > 0) {
    return `opt_param@${hint.args[0].replace(/'/g, '').toLowerCase()}`;
  }
```

Leave `diffOutlines` (including its "keep them apart by text" fallback)
unchanged.

In `src/lib/__tests__/hints.test.ts`, inside `describe('diffOutlines', …)`,
after `it('is empty for two plans without an outline', …)`, add:

```ts
  describe('OPT_PARAM entries', () => {
    const FEEDBACK = "OPT_PARAM('_optimizer_use_feedback' 'false')";
    const COST_ADJ = "OPT_PARAM('optimizer_index_cost_adj' 20)";

    it('matches the same parameters whatever their order', () => {
      const d = diffOutlines([FEEDBACK, COST_ADJ], [COST_ADJ, FEEDBACK]);
      expect(d.same.map((e) => e.key).sort()).toEqual(['opt_param@_optimizer_use_feedback', 'opt_param@optimizer_index_cost_adj']);
      expect(d.changed).toEqual([]);
      expect(d.onlyA).toEqual([]);
      expect(d.onlyB).toEqual([]);
    });

    it('reports a parameter that only one plan sets as "only in" that plan', () => {
      const d = diffOutlines([FEEDBACK], [COST_ADJ, FEEDBACK]);
      expect(d.same.map((e) => e.a)).toEqual([FEEDBACK]);
      expect(d.changed).toEqual([]);
      expect(d.onlyA).toEqual([]);
      expect(d.onlyB.map((e) => e.b)).toEqual([COST_ADJ]);
    });

    it('reports a parameter whose value differs as changed', () => {
      const d = diffOutlines([COST_ADJ], ["OPT_PARAM('optimizer_index_cost_adj' 50)"]);
      expect(d.changed.map((e) => [e.key, e.a, e.b])).toEqual([
        ['opt_param@optimizer_index_cost_adj', COST_ADJ, "OPT_PARAM('optimizer_index_cost_adj' 50)"],
      ]);
      expect(d.same).toEqual([]);
    });
  });
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/hints.test.ts`
→ all pass (3 more than before).

### Step 3 (c): Zero is a value, and timestamps are differenced in UTC

All in `packages/ora-plan-core/src/parser/sqlMonitorParser.ts`.

1. Directly above the `/** Get an integer value from a direct child element. */`
   comment of `getDirectChildInt`, add:

   ```ts
   /** Integer in an element's text, or undefined when it is not a number. 0 is a value, not "missing". */
   function parseIntText(text: string): number | undefined {
     const num = parseInt(text.trim(), 10);
     return isNaN(num) ? undefined : num;
   }
   ```

2. Replace the six `parseInt(<x>.textContent, 10) || undefined` expressions
   (three in `parsePlanSection`, three in `parseMonitorOperation`) with
   `parseIntText(<x>.textContent)`, keeping everything around them:

   ```ts
      estimates.rows = parseIntText(card.textContent);
      estimates.bytes = parseIntText(bytes.textContent);
      estimates.cost = parseIntText(cost.textContent);
   ```

   ```ts
    if (card?.textContent) rows = parseIntText(card.textContent);
    if (bytesEl?.textContent) bytes = parseIntText(bytesEl.textContent);
    if (costEl?.textContent) cost = parseIntText(costEl.textContent);
   ```

3. In `parseLegacyXmlOperation`, in the six lines quoted in "Current state"
   that join two lookups (`rows`, `actualRows`, `memoryUsed`, `physicalReads`,
   `logicalReads`, `activityPercent`), replace the `||` between the two calls
   with `??`. Do not touch the `||` in the `objectName`, `accessPredicates` and
   `filterPredicates` lines (those are strings).

4. In `parseOracleTimestamp`, replace `new Date(` … `).getTime();` by
   `Date.UTC(` … `);` (same six arguments):

   ```ts
     const ms = Date.UTC(
       parseInt(yyyy, 10),
       parseInt(mm, 10) - 1,
       parseInt(dd, 10),
       parseInt(hh, 10),
       parseInt(mi, 10),
       parseInt(ss, 10)
     );
   ```

   and replace the last paragraph of its doc comment ("Uses the *local* Date
   constructor … not a true UTC timestamp.") with:

   ```ts
    * The fields are read as if they were UTC. The report does not say which zone its
    * timestamps are in, and the result is only ever used to subtract two timestamps of the
    * same report: reading both as UTC gives their wall-clock difference, whereas the local
    * Date constructor would lose or gain an hour across the viewer's daylight-saving change.
   ```

Tests, in `src/lib/parser/__tests__/sqlMonitorXml.test.ts`:

- inside `describe('Nested Loops example (sql-monitor-xml-nested-loops.txt)', …)`,
  directly before `it('handles INDEX operations with options and SORT ORDER BY', …)`:

  ```ts
      it('keeps an optimizer cost of 0 (line 12, <cost>0</cost>) instead of dropping it', () => {
        expect(byId(12)?.cost).toBe(0);
        expect(byId(12)?.rows).toBe(1);
      });
  ```

- directly before
  `describe('Partition pruning example (27-sql_monitor-Partitioned Star Query.txt)', …)`:

  ```ts
    describe('zero values and timestamps (synthetic)', () => {
      it('reads 0 from <plan> and <optimizer> elements as 0, not as missing', () => {
        const xml = `<report><sql_monitor_report>
          <plan>
            <operation name="SELECT STATEMENT" id="0" depth="0"><card>0</card><bytes>0</bytes><cost>0</cost></operation>
          </plan>
          <plan_monitor>
            <operation id="0" name="SELECT STATEMENT" depth="0"/>
            <operation id="1" parent_id="0" name="TABLE ACCESS" options="FULL" depth="1">
              <optimizer><cardinality>0</cardinality><bytes>0</bytes><cost>0</cost></optimizer>
            </operation>
          </plan_monitor>
        </sql_monitor_report></report>`;
        const result = sqlMonitorXmlParser.parse(xml);
        for (const id of [0, 1]) {
          const node = result.allNodes.find((n) => n.id === id)!;
          expect([node.rows, node.bytes, node.cost]).toEqual([0, 0, 0]);
        }
      });

      it('legacy format: A-Rows 0 stays 0 and does not fall through to the alternative attribute', () => {
        const xml = `<?xml version="1.0"?><report><sql_monitor><plan_operations>
          <operation id="0" name="SELECT STATEMENT" depth="0" cardinality="0" e_rows="7" output_rows="0" a_rows="9"
                     max_memory="0" used_mem="5" physical_reads="0" cr_buffer_gets="4" logical_reads="0" buffer_gets="3"
                     activity_percent="0" percent="50"/>
        </plan_operations></sql_monitor></report>`;
        const [node] = sqlMonitorXmlParser.parse(xml).allNodes;
        expect(node.rows).toBe(0);
        expect(node.actualRows).toBe(0);
        expect(node.memoryUsed).toBe(0);
        expect(node.physicalReads).toBe(0);
        expect(node.logicalReads).toBe(0);
        expect(node.activityPercent).toBe(0);
      });

      it('computes active-window offsets as wall-clock differences, whatever the viewer time zone', () => {
        // 2026-03-08 is the night US clocks jump from 02:00 to 03:00: local Date arithmetic loses an hour.
        const xml = `<report><sql_monitor_report>
          <report_parameters><sql_exec_start>03/08/2026 01:30:00</sql_exec_start></report_parameters>
          <plan_monitor>
            <operation id="0" name="SELECT STATEMENT" depth="0">
              <stats type="plan_monitor">
                <stat name="first_active">03/08/2026 01:30:00</stat>
                <stat name="last_active">03/08/2026 03:30:00</stat>
              </stats>
            </operation>
          </plan_monitor>
        </sql_monitor_report></report>`;
        const previous = process.env.TZ;
        try {
          for (const zone of ['America/New_York', 'UTC', 'Asia/Kolkata']) {
            process.env.TZ = zone;
            const [node] = sqlMonitorXmlParser.parse(xml).allNodes;
            expect([zone, node.firstActiveOffset, node.lastActiveOffset]).toEqual([zone, 0, 7200]);
          }
        } finally {
          if (previous === undefined) delete process.env.TZ;
          else process.env.TZ = previous;
        }
      });
    });
  ```

**Verify**:
- `npm run typecheck` → exit 0
- `npx vitest run --environment jsdom src/lib/parser/__tests__/sqlMonitorXml.test.ts src/lib/parser/__tests__/sqlMonitorXmlExtras.test.ts`
  → all pass (4 more than before)
- `TZ=America/New_York npx vitest run --environment jsdom src/lib/parser/__tests__/sqlMonitorXml.test.ts`
  → all pass
- Characterisation:

  ```bash
  npx tsx /tmp/oraplan-015/dump-plans.mts > /tmp/oraplan-015/after.json
  node /tmp/oraplan-015/cmp-plans.mjs /tmp/oraplan-015/before.json /tmp/oraplan-015/after.json
  ```

  → exactly these four lines (their order may differ):

  ```text
  sql-monitor-xml-nested-loops.txt id 12 cost undefined -> 0
  sql-monitor-xml-nested-loops.txt id 12 selfCost undefined -> 0
  24-sql_monitor-Recursive BOM.txt id 13 cost undefined -> 0
  24-sql_monitor-Recursive BOM.txt id 13 selfCost undefined -> 0
  ```

### Step 4 (d): Explain an estimate with the executions its total was built from

1. `packages/ora-plan-core/src/format.ts` — replace the doc comment and body of
   `cardinalityMismatchText` with:

   ```ts
   /**
    * One-line explanation of a node's estimate-vs-actual comparison, e.g.
    * "Cardinality mismatch: estimated 1.0K rows (E-Rows 1 × 1.0K executions) vs A-Rows 250.0K".
    * The "× executions" breakdown appears only when it changes the number, and uses the multiplier
    * the total was built with (`effectiveExecutions`), which is not always the node's own Starts.
    */
   export function cardinalityMismatchText(node: PlanNode): string {
     const total = node.estimatedRowsTotal;
     const fmt = (n: number | undefined) => formatNumberShort(n) ?? '?';
     if (total === undefined) {
       return `Cardinality mismatch: E-Rows ${fmt(node.rows)} vs A-Rows ${fmt(node.actualRows)}`;
     }
     const executions = effectiveExecutions(node);
     const breakdown = executions !== undefined
       ? ` (E-Rows ${fmt(node.rows)} × ${fmt(Number.isInteger(executions) ? executions : Math.round(executions * 10) / 10)} executions)`
       : '';
     return `Cardinality mismatch: estimated ${fmt(total)} rows${breakdown} vs A-Rows ${fmt(node.actualRows)}`;
   }
   ```

   (`effectiveExecutions` is defined earlier in the same file; no import.)

2. `packages/ora-plan-core/src/advisor/rules/cardinalityMismatch.ts`
   - add `effectiveExecutions` to the existing import from `'../../format.ts'`;
   - replace the whole `describeEstimate` function with:

     ```ts
     /** "Estimated 5 rows per execution × 167 executions = 835 rows": the arithmetic behind `estimatedRowsTotal`. */
     function describeEstimate(node: PlanNode): string {
       const total = node.estimatedRowsTotal as number;
       const executions = effectiveExecutions(node);
       if (executions !== undefined && node.rows !== undefined) {
         const unit = node.rows === 1 ? 'row' : 'rows';
         const times = Number.isInteger(executions) ? executions.toLocaleString() : executions.toFixed(1);
         return `Estimated ${node.rows.toLocaleString()} ${unit} per execution × ${times} executions = ${total.toLocaleString()} rows`;
       }
       return `Estimated ${total.toLocaleString()} rows (E-Rows)`;
     }
     ```

   - in the `explanation:` template, replace
     `${describeEstimate({ eRowsPerStart: node.rows, starts: node.starts, eRowsTotal: node.estimatedRowsTotal as number })}`
     with `${describeEstimate(node)}` (rest of the line unchanged).

3. `src/lib/clientReport.ts`
   - add `effectiveExecutions,` to the import list from `'./format'`;
   - replace `estimateCell` (comment and function) with:

     ```ts
     /** Total estimate, with its per-execution breakdown when the operation ran more than once, so it visibly matches the deviation. */
     function estimateCell(node: PlanNode): string {
       const total = formatNumberShort(node.estimatedRowsTotal) ?? '';
       const executions = effectiveExecutions(node);
       if (executions !== undefined) {
         const times = formatNumberShort(Number.isInteger(executions) ? executions : Math.round(executions * 10) / 10) ?? '';
         return `${total} <span style="color:#64748b">(${formatNumberShort(node.rows) ?? ''} &times; ${times} executions)</span>`;
       }
       return total;
     }
     ```

4. Update the **two existing expectations** that quote the old wording:
   - `src/lib/advisor/__tests__/cardinalityMismatch.test.ts`, test "flags the
     inner scan when the all-starts estimate is far off, explaining the
     multiplication": the expected string becomes
     `'Estimated 1 row per execution × 1,000 executions = 1,000 rows but actually produced 250,000 rows (A-Rows), a 250.0x deviation.'`
   - `src/lib/__tests__/clientReport.test.ts`, test "shows the all-starts
     estimate with its per-start breakdown next to the deviation": the expected
     string becomes
     `'1.0K <span style="color:#64748b">(1 &times; 1.0K executions)</span>'`

5. New tests.

   `src/lib/__tests__/estimatedRows.test.ts` — change the import to
   `import { cardinalityMismatchText, effectiveExecutions, formatEstimatedRows } from '../format';`
   and append at the end of the file (the file already defines `node(...)`):

   ```ts
   describe('cardinalityMismatchText', () => {
     it('multiplies by the executions the total was built with, not by the node\'s own Starts', () => {
       // allstats-nlj-batching.txt line 7: a rowid fetch with Starts 786 whose total is E-Rows 5 × 167 (the index's Starts).
       const n = node({ rows: 5, starts: 786, estimatedRowsTotal: 835, actualRows: 786 });
       expect(cardinalityMismatchText(n)).toBe('Cardinality mismatch: estimated 835 rows (E-Rows 5 × 167 executions) vs A-Rows 786');
     });

     it('keeps the plain nested-loop case, now worded as executions', () => {
       const n = node({ rows: 1, starts: 1000, estimatedRowsTotal: 1000, actualRows: 250000 });
       expect(cardinalityMismatchText(n)).toBe('Cardinality mismatch: estimated 1.0K rows (E-Rows 1 × 1.0K executions) vs A-Rows 250.0K');
     });

     it('has no breakdown when the total is the per-start estimate (PX slave set, single execution)', () => {
       expect(cardinalityMismatchText(node({ rows: 1000, starts: 8, estimatedRowsTotal: 1000, actualRows: 9 }))).toBe(
         'Cardinality mismatch: estimated 1.0K rows vs A-Rows 9',
       );
     });

     it('falls back to E-Rows when there is no comparable total', () => {
       expect(cardinalityMismatchText(node({ rows: 7, actualRows: 3 }))).toBe('Cardinality mismatch: E-Rows 7 vs A-Rows 3');
     });
   });
   ```

   `src/lib/advisor/__tests__/cardinalityMismatch.test.ts` — inside
   `describe('starts-aware estimates', …)`, directly before
   `it('does not flag E-Rows 1 with A-Rows 0', …)`:

   ```ts
       it('explains a batched rowid fetch with the executions its total was built from, not its own Starts', () => {
         // NLJ batching: the table line's E-Rows is per start of the index feeding it (167), not per rowid (50,000).
         const plan = buildPlan({
           id: 0, operation: 'SELECT STATEMENT', children: [{
             id: 1, operation: 'NESTED LOOPS', rows: 830, actualRows: 50000, starts: 1, children: [
               {
                 id: 2, operation: 'NESTED LOOPS', rows: 830, actualRows: 50000, starts: 1, children: [
                   { id: 3, operation: 'TABLE ACCESS FULL', rows: 166, actualRows: 167, starts: 1 },
                   { id: 4, operation: 'INDEX RANGE SCAN', rows: 5, actualRows: 50000, starts: 167 },
                 ],
               },
               { id: 5, operation: 'TABLE ACCESS BY INDEX ROWID', rows: 5, actualRows: 50000, starts: 50000 },
             ],
           }],
         });
         const finding = cardinalityMismatchRule.evaluate(ruleCtx(plan)).find((f) => f.nodeIds[0] === 5);
         expect(finding?.explanation).toContain(
           'Estimated 5 rows per execution × 167 executions = 835 rows but actually produced 50,000 rows (A-Rows), a 59.9x deviation.',
         );
       });
   ```

**Verify**:
- `npm run typecheck` → exit 0
- `npx vitest run --environment jsdom src/lib/__tests__/estimatedRows.test.ts src/lib/advisor/__tests__/cardinalityMismatch.test.ts src/lib/__tests__/clientReport.test.ts src/components`
  → all pass
- `grep -rn "per start ×\|starts)</span>" src packages/ora-plan-core/src --include=*.ts --include=*.tsx`
  → no matches

### Step 5 (e): Take the SQL ID of a SQL Monitor text report from its header line

In `packages/ora-plan-core/src/parser/sqlMonitorParser.ts`, replace the whole
`extractSqlId` function (the one that takes `lines: string[]`, near the top of
the file) with the variant that matches the current state of the file.

If the function currently ends in `return match[1];` (plan 014 has **not**
landed):

```ts
function extractSqlId(lines: string[]): string | undefined {
  // The "Global Information" line of a SQL Monitor report: " SQL ID              :  7ch0an9vx5ysp".
  // The report prints the statement above it, so a "sql_id" inside the SQL text must not win:
  // only a line that is nothing but this field counts.
  for (const line of lines) {
    const match = line.match(/^\s*SQL\s+ID\s*:\s*(\w+)\s*$/i);
    if (match) return match[1];
  }
  // The DBMS_XPLAN.DISPLAY_CURSOR header ("SQL_ID  7ch0an9vx5ysp, child number 0"), which this
  // parser also handles via its A-Rows detection.
  for (const line of lines) {
    const match = line.match(/^\s*SQL_ID\s*[:\s]\s*(\w+)\s*(?:,.*)?$/i);
    if (match) return match[1];
  }
  return undefined;
}
```

If it currently reads `return normalizeSqlId(match[1]);` (plan 014 has landed),
use the same code with **both** `return match[1];` lines written as
`return normalizeSqlId(match[1]);`.

Tests, in `src/lib/parser/__tests__/allstats.test.ts`, inside
`describe('format routing', …)`, directly before
`it('keeps SQL Monitor reports on the SQL Monitor text parser even with a plan hash line', …)`
(the file already imports `readFileSync`, `join`, `parsePlan`):

```ts
  it('reads the SQL ID from its own header line, not from "sql_id" inside the SQL text above it', () => {
    const report = readFileSync(join(__dirname, '../../../examples', '18-sql_monitor-Skewed Parallel (J. Lewis).txt'), 'utf-8');
    // SQL Monitor prints the statement before the Global Information block.
    const withSqlIdInText = report.replace('WHERE 1 = 1', 'WHERE 1 = 1\nAND s.sql_id is not null\nORDER BY\nsql_id desc');
    expect(withSqlIdInText).not.toBe(report);
    const plan = parsePlan(withSqlIdInText);
    expect(plan.source).toBe('sql_monitor_text');
    expect(plan.sqlId).toBe('3cjg20q2vw41f');
  });

  it('still reads the SQL_ID of a DISPLAY_CURSOR header when the table has no plan hash line', () => {
    const bare = [
      'SQL_ID  7ch0an9vx5ysp, child number 2',
      '-------------------------------------',
      'select sql_id from v$sql',
      '',
      '| Id | Operation        | Name | E-Rows | A-Rows | A-Time   | Starts |',
      '|  0 | SELECT STATEMENT |      |        |      1 | 00:00:01 |      1 |',
    ].join('\n');
    const plan = parsePlan(bare);
    expect(plan.source).toBe('sql_monitor_text');
    expect(plan.sqlId).toBe('7ch0an9vx5ysp');
    expect(plan.childNumber).toBe(2);
  });
```

**Verify**:
- `npm run typecheck` → exit 0
- `npx vitest run --environment jsdom src/lib/parser` → all pass (2 more than
  after Step 3)
- The characterisation comparison of Step 3 still prints exactly the same four
  lines (re-run both commands).

### Step 6: Full gates

**Verify**:
- `npm run lint` → exit 0
- `npm run typecheck` → exit 0
- `npm test` → all pass, 15 more tests than before this plan (1 + 3 + 4 + 5 + 2)

## Test plan

| Step | Test file | New tests | What they pin down |
|---|---|---|---|
| (a) | `url.workspace.test.ts` | 1 | `storage` survives build → JSON → read; all four values allowed, unknown ones dropped |
| (b) | `hints.test.ts` | 3 | same parameters in another order → all "same"; extra parameter → exactly one "only in B"; different value → one "changed" keyed by the parameter |
| (c) | `sqlMonitorXml.test.ts` | 4 | real fixture line 12 has cost 0; `<card>/<bytes>/<cost>` and `<optimizer>` zeros; legacy zeros do not fall through to the alternative attribute; offsets are 0 / 7200 s in three time zones across a DST night |
| (d) | `estimatedRows.test.ts`, `cardinalityMismatch.test.ts` | 4 + 1 | text uses `effectiveExecutions` (5 × 167, not × 786); plain nested loop; no breakdown when total = E-Rows; fallback without a total; advisor finding for a batched rowid fetch |
| (e) | `allstats.test.ts` | 2 | `sql_id` words in the SQL text do not win over the header line; the DISPLAY_CURSOR header form still works |

Two existing expectations change, both in Step 4 item 4. No other existing test
may need an edit.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; the 15 new tests exist and pass
- [ ] `node /tmp/oraplan-015/cmp-plans.mjs /tmp/oraplan-015/before.json /tmp/oraplan-015/after.json | wc -l`
      → `4` (after re-running the dump)
- [ ] `grep -c "|| undefined" packages/ora-plan-core/src/parser/sqlMonitorParser.ts`
      → `27` (it is `33` before this plan), and
      `grep -c "parseIntText(" packages/ora-plan-core/src/parser/sqlMonitorParser.ts` → `7`
- [ ] `grep -c "new Date(" packages/ora-plan-core/src/parser/sqlMonitorParser.ts` → `0`
- [ ] `grep -c "'storage'" src/lib/url.ts` → `1`
- [ ] `grep -rn "per start ×" src packages/ora-plan-core/src --include=*.ts --include=*.tsx`
      returns no matches
- [ ] `git status --porcelain` lists only the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- An excerpt in "Current state" does not match the live code beyond the
  differences listed in the drift-check note.
- The characterisation comparison prints anything other than the four expected
  lines. More lines mean a real capture now parses differently in a way nobody
  reviewed (for example an estimate of 0 rows appearing somewhere) — report the
  lines.
- More than the two listed existing expectations need to change for the suite
  to pass.
- The time-zone test in Step 3 passes **before** you change
  `parseOracleTimestamp` (then `process.env.TZ` is not taking effect in this
  environment and the test proves nothing — report it instead of keeping it).
- `effectiveExecutions` is not exported from `format.ts`, or `formatEstimatedRows`
  no longer uses it (the premise of (d) changed).
- A SQL Monitor text example or fixture loses its `sqlId` after Step 5 (shows up
  as a `plan sqlId` line in the comparison).

## Maintenance notes

- (a) The allow-list in `readFilters` is a second copy of `PredicateType`. If a
  fifth predicate type is added to the type, add it here too (the new test lists
  all four so a reviewer will notice).
- (b) Only `OPT_PARAM` is keyed by its first argument. Other alias-less,
  block-less outline entries (`OPTIMIZER_FEATURES_ENABLE`, `DB_VERSION`,
  `ALL_ROWS`) are boilerplate and skipped; if another repeatable statement-level
  hint turns up, extend the same branch.
- (c) A cost or estimate of 0 now reaches the UI as `0` (cost cell, self cost,
  tooltips). `planRootCost` uses `root.cost !== undefined`, so a root cost of 0
  is now taken as the total instead of falling back to the largest child cost.
  `parseOracleTimestamp` results are only meaningful as differences.
- (d) Wording is now "executions" in all three places plus `formatEstimatedRows`.
  The tabular client report column header still says "Estimated rows (all
  starts)" — it names the concept and was left alone.
- (e) Deliberately not done: reading `Duration` and the "SQL Text" block of a
  SQL Monitor text report (today `totalElapsedTime` comes from the root row and
  `sqlText` is not set for that source). That is a feature gap, not this bug.
- Reviewer: in (c) check that only number lookups got `??` and that the string
  fallbacks kept `||`.
