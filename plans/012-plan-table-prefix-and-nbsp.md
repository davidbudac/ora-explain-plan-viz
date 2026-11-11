# Plan 012: A plan pasted with a per-line prefix or no-break spaces parses like the original capture

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- packages/ora-plan-core/src/parser/values.ts packages/ora-plan-core/src/parser/index.ts packages/ora-plan-core/src/parser/dbmsXplanParser.ts packages/ora-plan-core/src/parser/sqlMonitorParser.ts packages/ora-plan-core/src/parser/warnings.ts src/lib/parser/__tests__ site/docs.html`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `plans/013-display-cursor-sql-text.md`, `plans/014-validate-sql-id-and-plan-hash.md`
> and `plans/015-small-correctness-fixes.md` edit the same two parser files
> (`dbmsXplanParser.ts`, `sqlMonitorParser.ts`) in other functions and are meant
> to run **after** this plan; if one of them already landed, the regions this
> plan quotes are still untouched by them.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

People rarely paste a plan straight from SQL*Plus. It arrives through a mail
reply (`> ` in front of every line), a Markdown code block or a ticket (every
line indented), a CSV export of `PLAN_TABLE_OUTPUT` (every line in double
quotes), a log viewer (a timestamp in front of every line), or Outlook / Teams /
Word, which replace spaces with no-break spaces (U+00A0).

Today both text parsers accept a plan-table row only when the line **starts**
with `|`, and count only U+0020 as indentation. The result, confirmed by running
the parser on the repository's real captures:

- one leading space, or a 4-space Markdown indent → **0 operations, no warning**;
- `> ` quoting, one quoted string per line, a log timestamp → 0 operations plus
  a **wrong** warning (`wrapped_plan_table`: "run SET LINESIZE 300 …");
- no-break spaces in the Operation column → every row is read, but every depth
  is 0, so the **tree collapses to a flat list with no warning**.

For a first-time user this is "the tool cannot read my plan". After this plan
all of these inputs produce exactly the same parsed plan as the unmangled text,
already-aligned input is handled byte-for-byte as before, and two new warnings
say so when rows still cannot be used.

## Current state

### Repository rules that apply

- The real code is in `packages/ora-plan-core/src/...`. Files with the same
  name under `src/lib/` (e.g. `src/lib/parser/values.ts`,
  `src/lib/parser/index.ts`) are one-line `export *` shims — **never edit a
  shim**. Tests import through the shims (`from '../index'`, `from '../values'`).
- Inside the package, sibling imports carry an explicit `.ts` extension
  (`from './values.ts'`); no React, no DOM.
- TypeScript strict with `noUnusedLocals`: an import you stop using must be
  removed. Use `import type` for type-only imports.
- Parser fixtures in `src/lib/parser/__tests__/fixtures/` are **real Oracle
  captures and must never be edited or hand-written**. Mangled inputs for tests
  are built in memory from a fixture string.
- Every fixture and bundled example must parse with **no**
  `ParsedPlan.warnings` (enforced by
  `src/lib/parser/__tests__/warnings.test.ts`, "no false alarms").
- Parsers are tolerant: they never throw on bad input; problems are reported
  through `ParsedPlan.warnings` (`{ code, message, detail?, severity? }`, type
  `PlanWarning` in `packages/ora-plan-core/src/types.ts`). Every warning has a
  stable snake_case `code` and one sentence that says what was lost and what to
  do.
- Oracle semantics that must not change: the tree is built from the indentation
  of the Operation column; text parsers normalise CRLF and expand tabs; inactive
  adaptive rows (`-` in the Id column) stay marked `inactive`.

### The files

- `packages/ora-plan-core/src/parser/values.ts` — small shared value parsers;
  holds `normalizeNewlines`, `expandTabs`, `expandTableTabs`. **The new helper
  goes here.**
- `packages/ora-plan-core/src/parser/dbmsXplanParser.ts` — DBMS_XPLAN text
  parser and the multi-plan splitter `extractDbmsXplanSegments`.
- `packages/ora-plan-core/src/parser/sqlMonitorParser.ts` — SQL Monitor text
  parser (`sqlMonitorTextParser`) and the XML parser (not touched).
- `packages/ora-plan-core/src/parser/warnings.ts` — `textTableWarnings` builds
  the warnings for both text parsers.
- `packages/ora-plan-core/src/parser/index.ts` — `detectFormat`, `parsePlan`,
  `splitPlanBatches`.

### Excerpts (commit `b5635d8`)

`values.ts:30-36` — tabs are expanded only on lines that start with `|`:

```ts
/**
 * Expand tabs in plan-table lines (those starting with `|`) so column slicing and
 * indentation depth see real columns. Other lines (SQL text, predicates) are untouched.
 */
export function expandTableTabs(lines: string[]): string[] {
  return lines.map((line) => (line.startsWith('|') ? expandTabs(line) : line));
}
```

`dbmsXplanParser.ts:131-132` and `sqlMonitorParser.ts:52-53` — both parsers
prepare their lines the same way:

```ts
  parse(input: string): ParsedPlan {
    const lines = expandTableTabs(normalizeNewlines(input).split('\n'));
```

`dbmsXplanParser.ts:453-454` (same shape at `sqlMonitorParser.ts:340`, and the
look-ahead regex `/^\|.*\d+.*\|/` at `dbmsXplanParser.ts:438` /
`sqlMonitorParser.ts:325`) — a row must start at column 0:

```ts
    // Parse data row if it looks like a plan row
    if (/^\|/.test(line)) {
```

`dbmsXplanParser.ts:690-702` (identical logic at `sqlMonitorParser.ts:552-562`)
— only U+0020 counts as indentation:

```ts
function calculateDepth(operationStr: string): number {
  // Count leading spaces to determine nesting level
  let spaces = 0;
  for (const char of operationStr) {
    if (char === ' ') {
      spaces++;
    } else {
      break;
    }
  }
```

`dbmsXplanParser.ts:233-238` — the splitter looks for `SQL_ID` headers at the
start of a line, so it also needs the prefix removed:

```ts
export function extractDbmsXplanSegments(input: string): string[] {
  const normalized = normalizeNewlines(input).trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const segmentStarts: number[] = [];
```

`index.ts:44-45` and `index.ts:78-80`:

```ts
export function detectFormat(input: string): DetectedFormat {
  const cleaned = stripWrappingQuotes(normalizeNewlines(input));
```

```ts
export function parsePlan(input: string): ParsedPlan {
  input = stripWrappingQuotes(normalizeNewlines(input));
  const format = detectFormat(input);
```

`stripWrappingQuotes` (same file, above `detectFormat`) removes one `"` from
the very start and the very end of the whole text. It must keep working for a
paste wrapped in **one** pair of quotes, and must not eat the first and last
quote of a paste that has quotes around **every line** — which is why the new
per-line clean-up has to run *before* it.

`warnings.ts:104-136` — the diagnostics input and the start of
`textTableWarnings`:

```ts
export interface TextTableDiagnostics {
  lines: string[];
  headerIndex: number;
  /** Header cells no column rule matched (and not on the ignore list). */
  unknownColumns: string[];
  /** Lines that begin a data row but were rejected by the row parser. */
  rejectedLines: string[];
  /** Ids of the operations that were read. */
  nodeIds: number[];
  /** Ids the Predicate Information section refers to. */
  predicateIds: number[];
}

/** Warnings for a DBMS_XPLAN / SQL Monitor text plan table. */
export function textTableWarnings(d: TextTableDiagnostics): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const shape = scanTableShape(d.lines, d.headerIndex);

  if (shape.wrapped) {
    // Wrapped rows make every other symptom (rejected rows, id gaps, odd columns) noise.
    warnings.push({
      code: 'wrapped_plan_table',
      message: WRAPPED_TABLE_MESSAGE,
    });
    return warnings;
  }

  if (shape.truncated) {
    warnings.push({
      code: 'truncated_plan_table',
      message: `The plan ends in the middle of a row, so the paste looks cut off. ${TRUNCATION_ADVICE}`,
    });
  }
```

Both parsers call it twice: once in the "no rows" early return (with
`nodeIds: []`) and once after the tree is built, e.g. `dbmsXplanParser.ts:196-203`:

```ts
    const warnings: PlanWarning[] = textTableWarnings({
      lines,
      headerIndex: table.headerIndex,
      unknownColumns: table.unknownColumns,
      rejectedLines: table.rejectedLines,
      nodeIds: allNodes.map(node => node.id),
      predicateIds: [...predicates.keys()],
    });
```

(the SQL Monitor text parser has the same call at `sqlMonitorParser.ts:104-111`).

### Design (already proven against the repository's fixtures)

One helper pair in `values.ts`:

- `stripLinePrefix(lines)` — finds the header row (`| Id | … Operation`), takes
  the text in front of its `| Id |` as the prefix, and removes that prefix from
  every line that carries it. Matching is by pattern: a digit in the prefix
  matches any digit (timestamps), a blank matches any blank, everything else
  literally; table rows and separator rules with other text of the same width in
  front are cut too. If the prefix is a quote character, the closing quote at
  the end of the line goes as well (and `""` becomes `"`, as CSV exports double
  inner quotes). Nothing happens unless at least one row below the header
  carries the prefix; then the **same array object** is returned.
- `prepareTextLines(input)` — `normalizeNewlines` → split → `stripLinePrefix` →
  if a plan-table line contains a Unicode space separator, turn all of them into
  U+0020 on every line → `expandTableTabs`.

Call sites: both text parsers (so a direct `parser.parse()` works),
`extractDbmsXplanSegments` (prefix only), and a new `cleanInput` in `index.ts`
used by `detectFormat` and `parsePlan` so the clean-up runs before format
detection and before `stripWrappingQuotes`. The helper is idempotent, so running
it in `parsePlan` and again inside the parser is harmless.

This design was applied to a scratch copy of the repository: all 1787 existing
tests still pass, the parsed output of every fixture and example is
byte-identical, and the test file in Step 6 passes (93 tests).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0, no output after the `eslint .` line |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest; at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`, ~15 s |
| One file | `npx vitest run --environment jsdom src/lib/parser/__tests__/manglingCorpus.test.ts` | all pass |
| Parser tests | `npx vitest run --environment jsdom src/lib/parser` | all pass |

(Node prints `--localstorage-file` warnings during tests; ignore them.)

## Scope

**In scope** (the only files you should modify):

- `packages/ora-plan-core/src/parser/values.ts`
- `packages/ora-plan-core/src/parser/index.ts`
- `packages/ora-plan-core/src/parser/dbmsXplanParser.ts`
- `packages/ora-plan-core/src/parser/sqlMonitorParser.ts`
- `packages/ora-plan-core/src/parser/warnings.ts`
- `src/lib/parser/__tests__/manglingCorpus.test.ts` (create)
- `site/docs.html` (one sentence, Step 7)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):

- Anything in `src/lib/parser/__tests__/fixtures/` and `src/examples/` — real
  captures.
- `calculateDepth`, `parseDataRow`, `parseTableSection`, `alignColumnsToRow` —
  after the lines are cleaned they work unchanged. Do not "also" make them
  tolerant.
- `extractSqlHeader` / `cleanSqlLines` in `dbmsXplanParser.ts` (belongs to
  `plans/013-display-cursor-sql-text.md`) and `extractSqlId` in
  `sqlMonitorParser.ts` (belongs to plans 014 and 015).
- `src/lib/formats.ts` (`describeParseFailure`, `looksLikePlan`) — it calls
  `detectFormat`, which this plan fixes; no change needed there.
- The xbi, JSON, CSV and XML parsers.
- The `src/lib/parser/*.ts` shims.

## Git workflow

- Branch: `fix/plan-table-prefix-and-nbsp`
- One commit per step or one for the whole plan; conventional-commit style as in
  the repo's history (`fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`),
  e.g. `fix(parser): read plan tables behind a per-line prefix or no-break spaces`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record what every fixture and example parses to today

Create this script **outside the repository** and run it from the repository
root:

```bash
mkdir -p /tmp/oraplan-012
cat > /tmp/oraplan-012/dump-plans.mts <<'EOF'
// Characterisation dump: parse every real fixture and bundled example, print one JSON document.
// Run from the repo root:  npx tsx /tmp/oraplan-012/dump-plans.mts > before.json
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
npx tsx /tmp/oraplan-012/dump-plans.mts > /tmp/oraplan-012/before.json
```

**Verify**: `node -e "console.log(Object.keys(require('/tmp/oraplan-012/before.json')).length)"` → `28`

### Step 2: Add the helpers to `values.ts`

In `packages/ora-plan-core/src/parser/values.ts`, directly **after** the
`expandTableTabs` function, add exactly this:

```ts
/** The plan-table header row ("| Id | Operation | ..."). */
const TABLE_HEADER = /\|\s*Id\s*\|.*Operation/i;
/** Unicode space separators that mail clients, chat tools and word processors put in place of U+0020. */
const SPACE_LIKE = '\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000';
const SPACE_LIKE_CHAR = new RegExp(`[${SPACE_LIKE}]`);
const SPACE_LIKE_ALL = new RegExp(`[${SPACE_LIKE}]`, 'g');
/** A separator rule of the plan table or of a section title ("-----", "=====", "+----+"). */
const RULE_REST = /^[-=+]{5,}\s*$/;

/**
 * Pattern for a per-line prefix, built from the text in front of the header row's first `|`:
 * a digit matches any digit (timestamps, line numbers), a blank matches any blank (space, tab,
 * no-break space ...), everything else must match literally.
 */
function prefixPattern(prefix: string): RegExp {
  let source = '^';
  for (const ch of prefix) {
    if (/\d/.test(ch)) source += '\\d';
    else if (ch === ' ' || ch === '\t' || SPACE_LIKE_CHAR.test(ch)) source += `[ \\t${SPACE_LIKE}]`;
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(source);
}

/**
 * Remove a prefix that something between Oracle and the paste put in front of every line:
 * indentation (Markdown code blocks), "> " quoting (mail), a quote character per line (CSV
 * export of PLAN_TABLE_OUTPUT) or a log timestamp. The prefix is the text before the first
 * `|` of the plan-table header row and is removed only when a table row below the header
 * carries it too, so output copied straight from SQL*Plus comes back unchanged (same array).
 */
export function stripLinePrefix(lines: string[]): string[] {
  const headerIndex = lines.findIndex((line) => TABLE_HEADER.test(line));
  if (headerIndex < 0) return lines;
  const width = lines[headerIndex].search(/\|\s*Id\s*\|/i);
  if (width <= 0) return lines;

  const prefix = lines[headerIndex].slice(0, width);
  const pattern = prefixPattern(prefix);
  /** How many leading characters of `line` are prefix; -1 when the line does not carry it. */
  const cutAt = (line: string): number => {
    const padded = line.length < width ? line.padEnd(width) : line;
    if (pattern.test(padded)) return Math.min(width, line.length);
    // Same-width prefix with other text (a thread name, a wider line number) in front of a table line.
    const rest = line.slice(width);
    if ((rest.startsWith('|') || RULE_REST.test(rest)) && !line.slice(0, width).includes('|')) return width;
    return -1;
  };

  const confirmed = lines.some((line, i) => i > headerIndex && cutAt(line) === width && line[width] === '|');
  if (!confirmed) return lines;

  const quote = prefix.trim();
  const quoted = quote === '"' || quote === "'";
  return lines.map((line) => {
    const cut = cutAt(line);
    if (cut < 0) return line;
    let rest = line.slice(cut);
    if (quoted) {
      // "| Id | Operation |" - one quoted string per line; CSV exports also double the inner quotes.
      rest = rest.replace(new RegExp(`${quote}\\s*$`), '');
      if (quote === '"') rest = rest.replace(/""/g, '"');
    }
    return rest;
  });
}

/**
 * Split plan text into lines ready for the column-position parsers: line endings normalised,
 * a per-line prefix removed (`stripLinePrefix`), tabs expanded on plan-table lines and - when
 * the plan table shows the paste went through a rich-text tool - Unicode space separators
 * turned back into plain spaces, so indentation depth is read correctly.
 */
export function prepareTextLines(input: string): string[] {
  const lines = stripLinePrefix(normalizeNewlines(input).split('\n'));
  const richText = lines.some((line) => line.startsWith('|') && SPACE_LIKE_CHAR.test(line));
  return expandTableTabs(richText ? lines.map((line) => line.replace(SPACE_LIKE_ALL, ' ')) : lines);
}
```

Type it as written: the `SPACE_LIKE` string must contain the escapes
`\u00A0` … `\u3000` (backslash-u), not literal invisible characters. Some editing tools turn such
escapes into the real character while writing the file; the second check below
catches that.

**Verify**:
- `npm run typecheck` → exit 0
- `grep -c 'u00A0' packages/ora-plan-core/src/parser/values.ts` → `1`
- `LC_ALL=C grep -c "$(printf '\302\240')" packages/ora-plan-core/src/parser/values.ts`
  → `0` (no literal no-break space in the source file)

### Step 3: Use `prepareTextLines` in both text parsers and `stripLinePrefix` in the splitter

In `packages/ora-plan-core/src/parser/dbmsXplanParser.ts`:

1. In the import from `./values.ts`, remove `expandTableTabs` and add
   `prepareTextLines` and `stripLinePrefix` (keep `normalizeNewlines` — the
   splitter still uses it).
2. In `dbmsXplanParser.parse`, replace
   `const lines = expandTableTabs(normalizeNewlines(input).split('\n'));`
   with `const lines = prepareTextLines(input);`
3. In `extractDbmsXplanSegments`, replace `const lines = normalized.split('\n');`
   with:

   ```ts
   // A quoted / indented / log-prefixed paste: find the SQL_ID headers and hash lines on the bare text.
   const lines = stripLinePrefix(normalized.split('\n'));
   ```

   Leave the rest of the function alone (in particular the single-plan branch
   keeps returning `[normalized]`).

In `packages/ora-plan-core/src/parser/sqlMonitorParser.ts`:

1. In the import from `./values.ts`, remove **both** `expandTableTabs` and
   `normalizeNewlines` (neither is used elsewhere in this file) and add
   `prepareTextLines`.
2. In `sqlMonitorTextParser.parse`, replace
   `const lines = expandTableTabs(normalizeNewlines(input).split('\n'));`
   with `const lines = prepareTextLines(input);`

**Verify**:
- `npm run typecheck` → exit 0 (an "unused import" error means an import from
  item 1 was left behind).
- `npx vitest run --environment jsdom src/lib/parser` → all pass.

### Step 4: Clean the input before format detection (`index.ts`)

In `packages/ora-plan-core/src/parser/index.ts`:

1. Change `import { normalizeNewlines } from './values.ts';` to
   `import { normalizeNewlines, prepareTextLines } from './values.ts';`
2. Directly above `export function detectFormat`, add:

   ```ts
   /**
    * Line endings normalised, then - for text that holds a plan-table header row - a per-line
    * prefix and rich-text blanks undone (`prepareTextLines`), then wrapping quotes stripped.
    * JSON, CSV and XML have no such header row and pass through untouched.
    */
   function cleanInput(input: string): string {
     const text = normalizeNewlines(input);
     return stripWrappingQuotes(/\|\s*Id\s*\|/i.test(text) ? prepareTextLines(text).join('\n') : text);
   }
   ```

3. In `detectFormat`, replace
   `const cleaned = stripWrappingQuotes(normalizeNewlines(input));` with
   `const cleaned = cleanInput(input);`
4. In `parsePlan`, replace
   `input = stripWrappingQuotes(normalizeNewlines(input));` with
   `input = cleanInput(input);`

Do not change `splitPlanBatches` (it still needs `normalizeNewlines`).

**Verify**:
- `npm run typecheck` → exit 0.
- `npx vitest run --environment jsdom src/lib/parser` → all pass.
- `npx tsx /tmp/oraplan-012/dump-plans.mts > /tmp/oraplan-012/after.json && cmp /tmp/oraplan-012/before.json /tmp/oraplan-012/after.json && echo IDENTICAL`
  → prints `IDENTICAL`.

### Step 5: Two new warnings in `warnings.ts`, fed by both parsers

In `packages/ora-plan-core/src/parser/warnings.ts`:

1. Change `import type { PlanWarning } from '../types.ts';` to
   `import type { PlanNode, PlanWarning } from '../types.ts';`
2. In `interface TextTableDiagnostics`, after the `predicateIds` field, add:

   ```ts
   /** Ids of operations that were read but hang under no parent (see `unreachableNodeIds`). */
   unreachableIds?: number[];
   ```

3. Directly after that interface, add:

   ```ts
   /** Ids of the nodes that cannot be reached from the root by following `children`. */
   export function unreachableNodeIds(rootNode: PlanNode | null, allNodes: PlanNode[]): number[] {
     if (!rootNode) return [];
     const reached = new Set<PlanNode>();
     const pending: PlanNode[] = [rootNode];
     while (pending.length > 0) {
       const node = pending.pop()!;
       if (reached.has(node)) continue;
       reached.add(node);
       pending.push(...node.children);
     }
     return allNodes.filter((node) => !reached.has(node)).map((node) => node.id);
   }
   ```

4. In `textTableWarnings`, directly **after** the `if (shape.truncated) { … }`
   block (and before `const unknown = …`), add:

   ```ts
   if (d.nodeIds.length === 0 && d.rejectedLines.length === 0 && !shape.truncated) {
     warnings.push({
       code: 'no_plan_rows',
       message: 'The plan-table header was found but no rows could be read under it. Rows must start with "|" exactly as Oracle printed them: copy the plain output again, without quoting or re-formatting it.',
     });
     return warnings;
   }

   const unreachable = d.unreachableIds ?? [];
   if (unreachable.length > 0) {
     const n = unreachable.length;
     warnings.push({
       code: 'disconnected_rows',
       message: `${n} operation${n === 1 ? '' : 's'} could not be attached to the plan tree (id${n === 1 ? '' : 's'} ${listIds(unreachable)}), so the tree is incomplete. The tree is built from the indentation of the Operation column: paste the plan as plain text with its spacing intact.`,
     });
   }
   ```

   (`listIds` already exists in this file.)

In **both** `dbmsXplanParser.ts` and `sqlMonitorParser.ts`:

5. Add `unreachableNodeIds` to the import from `./warnings.ts`.
6. In the `textTableWarnings({ … })` call that runs **after** `buildTree` (the
   one with `nodeIds: allNodes.map(node => node.id)`), add one property after
   `predicateIds`:

   ```ts
   unreachableIds: unreachableNodeIds(rootNode, allNodes),
   ```

   Leave the earlier "no rows" call (with `nodeIds: []`) unchanged.

**Verify**:
- `npm run typecheck` → exit 0.
- `npx vitest run --environment jsdom src/lib/parser/__tests__/warnings.test.ts`
  → all pass (this includes "fixture/example … parses without warnings").
- The dump is still identical: re-run the three-part command from Step 4 →
  `IDENTICAL`.

### Step 6: Add the mangling-corpus test

Create `src/lib/parser/__tests__/manglingCorpus.test.ts` with exactly this
content (structure follows `src/lib/parser/__tests__/warnings.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan, splitPlanBatches } from '../index';
import { stripLinePrefix } from '../values';
import type { ParsedPlan } from '../../types';

const FIXTURES = join(__dirname, 'fixtures');
const EXAMPLES = join(__dirname, '../../../examples');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8').replace(/\r\n?/g, '\n');
const example = (name: string): string => readFileSync(join(EXAMPLES, name), 'utf-8').replace(/\r\n?/g, '\n');

/** Real captures, mangled in memory only (the files themselves are never edited). */
const CORPUS: Array<[string, string]> = [
  ['allstats-nlj-batching.txt', fixture('allstats-nlj-batching.txt')],
  ['allstats-adaptive-19c.txt', fixture('allstats-adaptive-19c.txt')],
  ['allstats-adaptive-19c-tabs.txt', fixture('allstats-adaptive-19c-tabs.txt')],
  ['awr-advanced-19c.txt', fixture('awr-advanced-19c.txt')],
  ['advanced-allstats-19c.txt', fixture('advanced-allstats-19c.txt')],
  ['17-sql_monitor (text)', example('17-sql_monitor-Exadata Cell Offload (K. Osborne).txt')],
  ['18-sql_monitor (text)', example('18-sql_monitor-Skewed Parallel (J. Lewis).txt')],
  ['26-dbms_xplan (parallel)', example('26-dbms_xplan-Parallel Query.txt')],
];

const NBSP = '\u00a0';
const perLine = (fn: (line: string, index: number) => string) => (text: string): string =>
  text.split('\n').map(fn).join('\n');

/** What mail clients, chat tools, Markdown, CSV exports and log viewers do to a pasted plan. */
const MANGLERS: Array<[string, (text: string) => string]> = [
  ['1-space indent', perLine((line) => ` ${line}`)],
  ['4-space indent (Markdown code block)', perLine((line) => `    ${line}`)],
  ['4-space indent, blank lines trimmed', perLine((line) => (line.trim() === '' ? '' : `    ${line}`))],
  ['tab indent', perLine((line) => `\t${line}`)],
  ['"> " mail quoting', perLine((line) => (line === '' ? '>' : `> ${line}`))],
  ['one double-quoted string per line', perLine((line) => `"${line}"`)],
  ['CSV-quoted lines (inner quotes doubled)', perLine((line) => `"${line.replace(/"/g, '""')}"`)],
  [
    'fixed-width log timestamp',
    perLine((line, i) => `2026-11-11 10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')} ${line}`),
  ],
  ['every space a no-break space', (text) => text.replace(/ /g, NBSP)],
  ['space runs alternating space / no-break space', (text) => text.replace(/ {2,}/g, (run) => [...run].map((_, i) => (i % 2 ? NBSP : ' ')).join(''))],
  ['space runs alternating no-break space / space', (text) => text.replace(/ {2,}/g, (run) => [...run].map((_, i) => (i % 2 ? ' ' : NBSP)).join(''))],
];

/** The whole plan as plain data (tree links as ids), so two parses can be compared with toEqual. */
const snapshot = (plan: ParsedPlan): unknown =>
  JSON.parse(
    JSON.stringify(plan, (key, value) => {
      if (key === 'rootNode') return value ? (value as { id: number }).id : null;
      if (key === 'children') return (value as Array<{ id: number }>).map((child) => child.id);
      return value;
    }),
  );

const tree = (plan: ParsedPlan): Array<[number, number | null, number]> =>
  plan.allNodes.map((node) => [node.id, node.parentId ?? null, node.depth]);

describe('mangled pastes parse like the original capture', () => {
  describe.each(CORPUS)('%s', (_name, text) => {
    const clean = parsePlan(text);

    it.each(MANGLERS)('%s', (_label, mangle) => {
      const mangled = mangle(text);
      expect(mangled).not.toBe(text);
      const plan = parsePlan(mangled);
      expect(plan.allNodes).toHaveLength(clean.allNodes.length);
      expect(tree(plan)).toEqual(tree(clean));
      expect(plan.warnings).toBeUndefined();
      expect(snapshot(plan)).toEqual(snapshot(clean));
    });
  });

  it('returns the lines of an aligned plan untouched (same array)', () => {
    for (const [, text] of CORPUS) {
      const lines = text.split('\n');
      expect(stripLinePrefix(lines)).toBe(lines);
    }
  });

  it('still strips quotes wrapped around the whole paste', () => {
    const text = fixture('allstats-workarea.txt');
    const clean = parsePlan(text);
    const plan = parsePlan(`"${text.trim()}"`);
    expect(tree(plan)).toEqual(tree(clean));
    expect(plan.sqlId).toBe(clean.sqlId);
    expect(plan.warnings).toBeUndefined();
  });

  it('splits a mail-quoted paste of two plans at their SQL_ID headers', () => {
    const first = fixture('allstats-workarea.txt');
    const second = first.replace('child number 0', 'child number 1').replace(/Plan hash value: \d+/, 'Plan hash value: 999');
    const quoted = `${first}\n${second}`.split('\n').map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
    const batches = splitPlanBatches(quoted);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatch(/^SQL_ID\s+\S+, child number 0/);
    expect(batches[1]).toMatch(/^SQL_ID\s+\S+, child number 1/);
    expect(batches.map((batch) => parsePlan(batch).planHashValue)).toEqual([parsePlan(first).planHashValue, '999']);
  });
});

describe('plan-table rows that cannot be used', () => {
  const WORKAREA = fixture('allstats-workarea.txt');
  const lines = WORKAREA.split('\n');
  const headerIndex = lines.findIndex((line) => /\|\s*Id\s*\|/.test(line));

  it('warns when the header row is there but no row below it could be read', () => {
    const plan = parsePlan(lines.slice(0, headerIndex + 2).join('\n'));
    expect(plan.rootNode).toBeNull();
    expect((plan.warnings ?? []).map((w) => w.code)).toEqual(['no_plan_rows']);
  });

  it('warns when rows cannot be attached to the tree because the indentation was lost', () => {
    // Collapse the Operation cell's indentation to one space, keeping the column width.
    const flattened = lines
      .map((line) => {
        if (!/^\|[^|]*\d[^|]*\|/.test(line)) return line;
        const cells = line.split('|');
        cells[2] = ` ${cells[2].trim()}`.padEnd(cells[2].length);
        return cells.join('|');
      })
      .join('\n');
    const plan = parsePlan(flattened);
    const clean = parsePlan(WORKAREA);
    expect(plan.allNodes).toHaveLength(clean.allNodes.length);
    const warning = (plan.warnings ?? []).find((w) => w.code === 'disconnected_rows');
    expect(warning?.message).toContain(`${clean.allNodes.length - 1} operations`);
    expect(warning?.message).toContain('ids 1, 2, 3');
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/lib/parser/__tests__/manglingCorpus.test.ts`
→ `Tests  93 passed (93)` (8 captures × 11 manglers + 5).

### Step 7: One sentence in the user docs

In `site/docs.html`, in the Troubleshooting section, the paragraph under
`"Could not detect the plan format"` ends with:

```html
(set <code>LINESIZE 300</code> or more in SQL*Plus).</p>
```

(`grep -c 'or more in SQL\*Plus).</p>' site/docs.html` → `1`.) Replace that
ending with:

```html
(set <code>LINESIZE 300</code> or more in SQL*Plus). A prefix in front of every line (indentation, <code>&gt;</code> mail quoting, one quoted string per line, a log timestamp) and no-break spaces left by mail or chat tools are removed automatically.</p>
```

**Verify**: `grep -c "no-break spaces left by mail or chat tools" site/docs.html` → `1`

### Step 8: Full gates

**Verify**:
- `npm run lint` → exit 0
- `npm run typecheck` → exit 0
- `npm test` → all pass; one more test file and 93 more tests than before this
  plan (at `b5635d8`: 156 files, 1880 tests).

## Test plan

- New file `src/lib/parser/__tests__/manglingCorpus.test.ts` (Step 6):
  - 8 real captures (5 DBMS_XPLAN fixtures incl. the adaptive plan with its
    wide `Id` column and the tab-containing capture, 2 SQL Monitor text reports,
    1 parallel DBMS_XPLAN example) × 11 transforms (1-space indent, 4-space
    indent, 4-space indent with trimmed blank lines, tab indent, `> ` quoting,
    per-line double quotes, CSV-doubled quotes, fixed-width timestamp, all
    spaces → NBSP, alternating space/NBSP in both phases). Each asserts: same
    node count, same `[id, parentId, depth]` list, no warnings, and the whole
    parsed plan deep-equal to the unmangled parse.
  - aligned input returns the same array from `stripLinePrefix`;
  - a paste wrapped in one pair of quotes still parses (regression guard for
    `stripWrappingQuotes`);
  - a mail-quoted paste of two plans splits into two batches at their headers;
  - `no_plan_rows` and `disconnected_rows` warnings.
- Existing guard that must stay green:
  `src/lib/parser/__tests__/warnings.test.ts` → "no false alarms" (no fixture
  or example may gain a warning).
- Verification: `npm test` → all pass, including the 93 new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `manglingCorpus.test.ts` exists and its 93 tests pass
- [ ] `cmp /tmp/oraplan-012/before.json /tmp/oraplan-012/after.json` exits 0
      (after re-running the dump as in Step 4)
- [ ] `grep -n "expandTableTabs" packages/ora-plan-core/src/parser/dbmsXplanParser.ts packages/ora-plan-core/src/parser/sqlMonitorParser.ts`
      returns no matches
- [ ] `grep -c "prepareTextLines" packages/ora-plan-core/src/parser/index.ts`
      → `2` or more
- [ ] `grep -c "no_plan_rows\|disconnected_rows" packages/ora-plan-core/src/parser/warnings.ts`
      → `2`
- [ ] `git status --porcelain` lists only the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts.
- The dump comparison in Step 4 or Step 5 is not identical. That means aligned
  input is no longer parsed exactly as before — the one thing this plan must
  not change.
- Any test in "no false alarms" (`warnings.test.ts`) fails: a real fixture or
  example gained a warning.
- A combination in the mangling corpus fails after two attempts at checking
  that the helper was typed exactly as given. Report the capture name and the
  transform; do not weaken the assertion or drop the combination.
- Making a test pass seems to require editing a file under `fixtures/` or
  `src/examples/`.
- An existing test outside `manglingCorpus.test.ts` starts failing.

## Maintenance notes

- `prepareTextLines` is now the single entry point for turning DBMS_XPLAN or
  SQL Monitor **text** into lines. A new text parser should call it instead of
  `normalizeNewlines(...).split('\n')`.
- Limits, by design: (1) the prefix is found through the plan-table header
  row, so text without a `| Id | … Operation` header is never touched;
  (2) a variable-width prefix (right-aligned line numbers of growing length) is
  removed from table rows and rules only, so the tree is right but predicate and
  note sections of such a paste may be lost; (3) only the listed Unicode space
  separators are normalised — zero-width characters are not.
- The space normalisation applies to **all** lines once any plan-table line
  contains such a character (evidence the paste went through a rich-text tool).
  A genuine capture never has one in a table line, so real output is untouched.
- `sqlMonitorTextParser.parse` still tests `SQL_MONITOR_MARKERS` against the raw
  `input` when deciding on the `bare_a_rows_table` info warning. Through
  `parsePlan` the input is already clean; a direct call with an all-NBSP paste
  could add that info warning. Left alone on purpose (out of scope).
- Reviewer: check that `cleanInput` runs before `stripWrappingQuotes` and that
  `extractDbmsXplanSegments` still returns the untouched text for a single plan
  (the app keeps the user's original text as the tab's raw input).
- `src/lib/formats.ts` `describeParseFailure` still calls `looksWrappedTable`
  on the raw text. It is only reached when nothing parsed, which these inputs no
  longer cause; if a "wrapped" message for a prefixed paste is ever reported
  again, that is the place to look.
