# Plan 016: Short number, byte and time formatters never print a value at or above its own unit

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- packages/ora-plan-core/src/format.ts src/lib/filterThresholds.ts src/lib/__tests__/format.units.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `plans/015-small-correctness-fixes.md` edits the same file `format.ts`, but
> only the function `cardinalityMismatchText` further down; the regions this
> plan replaces (the five formatters at the top, and one regex inside
> `formatEstimatedRows`) are not touched by it. Run this plan after 015.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/015-small-correctness-fixes.md` (same file — run after
  it to avoid edit conflicts; no logical dependency)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

Every number, size and duration in the app goes through five small formatters
in `packages/ora-plan-core/src/format.ts`. They pick the unit **before**
rounding and stop at "M" / "GB" / minutes, so values near a unit boundary and
large values print wrongly. Confirmed by running the current code:

| Call | Prints today | Should print |
|---|---|---|
| `formatNumberShort(999950)` | `1000.0K` | `1.0M` |
| `formatNumberShort(12345678901)` | `12345.7M` | `12.3G` |
| `formatBytes(1048575)` | `1024.0 KB` | `1.0 MB` |
| `formatBytes(5497558138880)` (5 TB) | `5120.0 GB` | `5.0 TB` |
| `formatTimeCompact(59999)` | `60.00s` | `1m 0.0s` |
| `formatTimeCompact(119960)` | `1m 60.0s` | `2m 0.0s` |
| `formatTimeCompact(7200000)` (2 h) | `120m 0.0s` | `2h 0m` |
| `formatTimeDetailed(999.96)` | `1000.0ms` | `1.00s` |
| `formatTimeDetailed(0.9996)` | `1000us` | `1.0ms` |
| `formatNumberShort(NaN)` | `NaN` | nothing (like `undefined`) |

These are the strings on plan nodes, in the tabular view, the details panel,
the compare view, advisor findings and the exported client report. Plans with
billions of rows (`12345.7M`) or hour-long steps (`120m 0.0s`) are exactly the
ones people bring to a plan visualizer. After this plan the unit is chosen
after rounding, counts gain `G` and `T` (the suffix letters Oracle itself
prints), bytes gain `TB`, times gain hours, and not-a-number input prints
nothing.

## Current state

### Repository rules that apply

- The real code is in `packages/ora-plan-core/src/format.ts`;
  `src/lib/format.ts` is a one-line `export *` shim — **never edit the shim**.
  App code and tests import through it (`from '../format'`).
- `src/lib/filterThresholds.ts` is a real app file.
- TypeScript strict; no React, no DOM in the package.
- No test file currently imports `formatNumberShort`, `formatBytes`,
  `formatTimeCompact`, `formatTimeShort` or `formatTimeDetailed` by name; they
  are exercised indirectly. The change in this plan was applied to a scratch
  copy of the repository and the **whole existing suite passed without a single
  expectation change**, so no existing test needs editing.

### Excerpts (commit `b5635d8`)

`packages/ora-plan-core/src/format.ts:1-56` — the region replaced in Step 1
(everything from `export function formatNumberShort` up to, not including, the
comment `/** Compute the ratio between actual and estimated rows. …`):

```ts
import type { PlanNode } from './types.ts';

export interface FormatOptions {
  empty?: string;
  infinity?: string;
}

export function formatNumberShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
  return value.toString();
}

export function formatBytes(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 1073741824) return (value / 1073741824).toFixed(1) + ' GB';
  if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB';
  if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
  return value + ' B';
}

export function formatTimeCompact(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 60000) {
    const mins = Math.floor(value / 60000);
    const secs = ((value % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
  }
  if (value >= 1000) return (value / 1000).toFixed(2) + 's';
  return value.toFixed(0) + 'ms';
}

export function formatTimeShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 60000) return (value / 60000).toFixed(1) + 'm';
  if (value >= 1000) return (value / 1000).toFixed(2) + 's';
  return value.toFixed(0) + 'ms';
}

export function formatTimeDetailed(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 60000) {
    const minutes = Math.floor(value / 60000);
    const seconds = ((value % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
  if (value >= 1000) return (value / 1000).toFixed(2) + 's';
  if (value >= 1) return value.toFixed(1) + 'ms';
  return (value * 1000).toFixed(0) + 'us';
}
```

All time formatters take **milliseconds**.

Two callers trim a trailing `.0` in front of the unit letter with a regex that
knows only `K` and `M`. With the new `G` / `T` units they must know those too:

`packages/ora-plan-core/src/format.ts:113` (inside `formatEstimatedRows`):

```ts
    text: `${formatNumberShort(node.rows)} × ${formatNumberShort(executions)!.replace(/\.0(?=[KM]$)/, '')}`,
```

`src/lib/filterThresholds.ts:83-88`:

```ts
/** Short display text for a threshold value (never "≥"; the caller adds that). */
export function formatThreshold(value: number, kind: ThresholdKind): string {
  if (kind === 'time') return formatTimeCompact(value) ?? '';
  if (kind === 'ratio') return `${Number(value.toFixed(1))}×`;
  return (formatNumberShort(value) ?? '').replace(/\.0(?=[KM]$)/, '');
}
```

### Behaviour that must NOT change

- `undefined` → `options.empty` (usually `undefined`); `Infinity` →
  `options.infinity ?? '∞'`.
- Below the first unit the number is printed as is: `formatNumberShort(999.5)`
  → `"999.5"`, `formatNumberShort(-5)` → `"-5"`, `formatBytes(1023)` →
  `"1023 B"`.
- One decimal for K/M/… and KB/MB/…, two decimals for seconds, one decimal for
  the seconds part of "Xm Y.Ys", no decimals for `ms` in the compact/short
  forms, one decimal for `ms` and none for `us` in the detailed form.
- Every value that is not within rounding distance of a unit boundary and is
  below the old top unit prints **exactly** as today (see the table in Step 2:
  rows marked `=`).

### Exemplar test file

`src/lib/__tests__/estimatedRows.test.ts` — plain `describe` / `it` /
`expect(...).toBe(...)` on functions imported from `'../format'`, with a local
`node(...)` helper:

```ts
import { describe, expect, it } from 'vitest';
import { effectiveExecutions, formatEstimatedRows } from '../format';
import { planNodeAriaLabel } from '../nodeAriaLabel';
import type { PlanNode } from '../types';

const node = (over: Partial<PlanNode>): PlanNode => ({ id: 1, depth: 1, operation: 'X', children: [], ...over });
```

(If `plans/015-small-correctness-fixes.md` landed, the second import also names
`cardinalityMismatchText`.)

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest; at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`, ~15 s (more if earlier plans landed) |
| One file | `npx vitest run --environment jsdom src/lib/__tests__/format.units.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):

- `packages/ora-plan-core/src/format.ts` — the five formatters and one regex
- `src/lib/filterThresholds.ts` — one regex
- `src/lib/__tests__/format.units.test.ts` (create)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):

- Everything else in `format.ts` (`computeCardinalityRatio`,
  `effectiveExecutions`, `formatEstimatedRows` apart from its regex,
  `cardinalityMismatchText`, `formatCardinalityRatio`, `formatPartitionRange`).
- `formatNumber` in `packages/ora-plan-core/src/types.ts` (an older duplicate
  with no callers in `src/`), the local `ms`-formatter in
  `packages/ora-plan-core/src/advisor/rules/pxSkew.ts`, the spoken form in
  `src/lib/nodeAriaLabel.ts`, the token counter in `AgentHandoffDialog.tsx`,
  `us()` in `src/lib/ai/context.ts`. Separate formatters, separate decisions.
- `parseThreshold` in `filterThresholds.ts` (what the threshold box accepts).
- The parsers' own unit tables (`parser/values.ts`).
- `src/lib/format.ts` (shim).

## Git workflow

- Branch: `fix/formatter-unit-boundaries`
- Conventional-commit message in the repo's style (example from history:
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`), e.g.
  `fix(format): choose the unit after rounding; add G/T, TB and hours`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the five formatters

In `packages/ora-plan-core/src/format.ts`, replace everything from
`export function formatNumberShort(` down to the closing `}` of
`formatTimeDetailed` (keep the `import` line and `FormatOptions` above it, and
everything from the `computeCardinalityRatio` doc comment onward) with:

```ts
/** `undefined`, NaN and -Infinity have no display value (Infinity has its own symbol). */
function isBlank(value: number | undefined): value is undefined {
  return value === undefined || Number.isNaN(value) || value === -Infinity;
}

/** Count suffixes as Oracle prints them in plan tables (1000-based). */
const COUNT_UNITS = ['K', 'M', 'G', 'T'];
const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'];

/**
 * `value` scaled down by `base` until it prints below `base` with one decimal: the unit is
 * chosen after rounding, so 999,950 reads "1.0M", never "1000.0K". Values past the last
 * unit stay in it.
 */
function scaleToUnit(value: number, base: number, units: string[]): { text: string; unit: string } {
  let scaled = value / base;
  let index = 0;
  while (index < units.length - 1 && Number(scaled.toFixed(1)) >= base) {
    scaled /= base;
    index++;
  }
  return { text: scaled.toFixed(1), unit: units[index] };
}

export function formatNumberShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value < 1000) return value.toString();
  const { text, unit } = scaleToUnit(value, 1000, COUNT_UNITS);
  return text + unit;
}

export function formatBytes(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value < 1024) return value + ' B';
  const { text, unit } = scaleToUnit(value, 1024, BYTE_UNITS);
  return `${text} ${unit}`;
}

// The time formatters take milliseconds. Each range test rounds to the precision that range
// prints with before comparing, so a value never shows as "1000ms", "60.00s" or "1m 60.0s".

/** "2m 5.3s" from a duration, via tenths of a second so the seconds part is always below 60. */
function minutesAndSeconds(ms: number): string {
  const tenths = Math.round(ms / 100);
  return `${Math.floor(tenths / 600)}m ${((tenths % 600) / 10).toFixed(1)}s`;
}

/** True while `ms` still prints below one hour in the "Xm Y.Ys" form. */
const belowOneHour = (ms: number): boolean => Math.round(ms / 100) < 36000;
/** True while `ms` still prints below one minute in the "S.SSs" form. */
const belowOneMinute = (ms: number): boolean => Math.round(ms / 10) < 6000;

export function formatTimeCompact(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (Math.round(value) < 1000) return value.toFixed(0) + 'ms';
  if (belowOneMinute(value)) return (value / 1000).toFixed(2) + 's';
  if (belowOneHour(value)) return minutesAndSeconds(value);
  const minutes = Math.round(value / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatTimeShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (Math.round(value) < 1000) return value.toFixed(0) + 'ms';
  if (belowOneMinute(value)) return (value / 1000).toFixed(2) + 's';
  if (Math.round(value / 6000) < 600) return (value / 60000).toFixed(1) + 'm';
  return (value / 3600000).toFixed(1) + 'h';
}

export function formatTimeDetailed(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (Math.round(value * 1000) < 1000) return (value * 1000).toFixed(0) + 'us';
  if (Math.round(value * 10) < 10000) return value.toFixed(1) + 'ms';
  if (belowOneMinute(value)) return (value / 1000).toFixed(2) + 's';
  if (belowOneHour(value)) return minutesAndSeconds(value);
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
}
```

Then update the two regexes:

- in `format.ts`, inside `formatEstimatedRows`: `/\.0(?=[KM]$)/` →
  `/\.0(?=[KMGT]$)/`
- in `src/lib/filterThresholds.ts`, inside `formatThreshold`: `/\.0(?=[KM]$)/` →
  `/\.0(?=[KMGT]$)/`

**Verify**:
- `npm run typecheck` → exit 0
- `grep -c "KMGT" packages/ora-plan-core/src/format.ts src/lib/filterThresholds.ts`
  → `1` for each file
- `npm test` → all pass, with **no** test edited (the count is the same as
  before this step)

### Step 2: Add the boundary tests

Create `src/lib/__tests__/format.units.test.ts`. The expected strings below
were produced by running the code of Step 1; in the table, `=` marks values
whose output is the same as before this plan and `→` marks the ones that
change.

| Function | Input → output (new) |
|---|---|
| `formatNumberShort` | `0`→`0` =, `999`→`999` =, `999.5`→`999.5` =, `1000`→`1.0K` =, `999949`→`999.9K` =, `999950`→`1.0M` → (was `1000.0K`), `1000000`→`1.0M` =, `999950000`→`1.0G` → (was `1000.0M`), `12345678901`→`12.3G` →, `1e12`→`1.0T` →, `5e15`→`5000.0T` →, `-5`→`-5` =, `NaN`→ nothing → |
| `formatBytes` | `1023`→`1023 B` =, `1024`→`1.0 KB` =, `1048575`→`1.0 MB` → (was `1024.0 KB`), `1073741823`→`1.0 GB` →, `1099511627776`→`1.0 TB` → (was `1024.0 GB`), `5497558138880`→`5.0 TB` → |
| `formatTimeCompact` | `999.4`→`999ms` =, `999.5`→`1.00s` → (was `1000ms`), `59994`→`59.99s` =, `59999`→`1m 0.0s` → (was `60.00s`), `119940`→`1m 59.9s` =, `119960`→`2m 0.0s` → (was `1m 60.0s`), `3599940`→`59m 59.9s` =, `3600000`→`1h 0m` → (was `60m 0.0s`), `5400000`→`1h 30m` →, `86400000`→`24h 0m` → |
| `formatTimeShort` | `999.6`→`1.00s` →, `59999`→`1.0m` → (was `60.00s`), `90000`→`1.5m` =, `3596999`→`59.9m` =, `3597000`→`1.0h` → (was `60.0m`), `7200000`→`2.0h` → |
| `formatTimeDetailed` | `0.9994`→`999us` =, `0.9996`→`1.0ms` → (was `1000us`), `999.94`→`999.9ms` =, `999.96`→`1.00s` → (was `1000.0ms`), `59999`→`1m 0.0s` →, `119960`→`2m 0.0s` →, `3723400`→`1h 2m 3s` → (was `62m 3.4s`) |

File content:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatEstimatedRows,
  formatNumberShort,
  formatTimeCompact,
  formatTimeDetailed,
  formatTimeShort,
} from '../format';
import { formatThreshold } from '../filterThresholds';
import type { PlanNode } from '../types';

describe('formatNumberShort', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [999.5, '999.5'],
    [1000, '1.0K'],
    [1500, '1.5K'],
    [999_949, '999.9K'],
    [999_950, '1.0M'],
    [999_999, '1.0M'],
    [1_000_000, '1.0M'],
    [1_500_000, '1.5M'],
    [999_949_999, '999.9M'],
    [999_950_000, '1.0G'],
    [1e9, '1.0G'],
    [12_345_678_901, '12.3G'],
    [999_950_000_000, '1.0T'],
    [1e12, '1.0T'],
    [5e15, '5000.0T'],
    [-5, '-5'],
  ])('%d → %s', (value, text) => {
    expect(formatNumberShort(value)).toBe(text);
  });

  it('has no text for values that are not numbers', () => {
    expect(formatNumberShort(undefined)).toBeUndefined();
    expect(formatNumberShort(NaN)).toBeUndefined();
    expect(formatNumberShort(-Infinity)).toBeUndefined();
    expect(formatNumberShort(NaN, { empty: '—' })).toBe('—');
    expect(formatNumberShort(Infinity)).toBe('∞');
    expect(formatNumberShort(Infinity, { infinity: 'inf' })).toBe('inf');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1_048_575, '1.0 MB'],
    [1_048_576, '1.0 MB'],
    [1_073_741_823, '1.0 GB'],
    [1_073_741_824, '1.0 GB'],
    [1_099_511_627_775, '1.0 TB'],
    [1_099_511_627_776, '1.0 TB'],
    [5_497_558_138_880, '5.0 TB'],
  ])('%d → %s', (value, text) => {
    expect(formatBytes(value)).toBe(text);
  });

  it('has no text for NaN', () => {
    expect(formatBytes(NaN)).toBeUndefined();
    expect(formatBytes(NaN, { empty: '' })).toBe('');
    expect(formatBytes(Infinity)).toBe('∞');
  });
});

describe('formatTimeCompact (milliseconds)', () => {
  it.each([
    [0, '0ms'],
    [5, '5ms'],
    [999.4, '999ms'],
    [999.5, '1.00s'],
    [999.6, '1.00s'],
    [1000, '1.00s'],
    [1500, '1.50s'],
    [59_994, '59.99s'],
    [59_999, '1m 0.0s'],
    [60_000, '1m 0.0s'],
    [61_500, '1m 1.5s'],
    [119_940, '1m 59.9s'],
    [119_960, '2m 0.0s'],
    [3_599_940, '59m 59.9s'],
    [3_599_960, '1h 0m'],
    [3_600_000, '1h 0m'],
    [5_400_000, '1h 30m'],
    [7_200_000, '2h 0m'],
    [86_400_000, '24h 0m'],
  ])('%d → %s', (value, text) => {
    expect(formatTimeCompact(value)).toBe(text);
  });

  it('has no text for NaN', () => {
    expect(formatTimeCompact(NaN)).toBeUndefined();
    expect(formatTimeCompact(Infinity)).toBe('∞');
  });
});

describe('formatTimeShort (milliseconds)', () => {
  it.each([
    [0, '0ms'],
    [5, '5ms'],
    [999.6, '1.00s'],
    [1000, '1.00s'],
    [59_994, '59.99s'],
    [59_999, '1.0m'],
    [60_000, '1.0m'],
    [90_000, '1.5m'],
    [3_596_999, '59.9m'],
    [3_597_000, '1.0h'],
    [3_600_000, '1.0h'],
    [7_200_000, '2.0h'],
    [90_000_000, '25.0h'],
  ])('%d → %s', (value, text) => {
    expect(formatTimeShort(value)).toBe(text);
  });

  it('has no text for NaN', () => {
    expect(formatTimeShort(NaN)).toBeUndefined();
  });
});

describe('formatTimeDetailed (milliseconds)', () => {
  it.each([
    [0, '0us'],
    [0.5, '500us'],
    [0.9994, '999us'],
    [0.9996, '1.0ms'],
    [1, '1.0ms'],
    [12.34, '12.3ms'],
    [999.94, '999.9ms'],
    [999.96, '1.00s'],
    [1000, '1.00s'],
    [59_994, '59.99s'],
    [59_999, '1m 0.0s'],
    [60_000, '1m 0.0s'],
    [119_960, '2m 0.0s'],
    [3_599_960, '1h 0m 0s'],
    [3_600_000, '1h 0m 0s'],
    [3_723_400, '1h 2m 3s'],
    [7_200_000, '2h 0m 0s'],
  ])('%d → %s', (value, text) => {
    expect(formatTimeDetailed(value)).toBe(text);
  });

  it('has no text for NaN', () => {
    expect(formatTimeDetailed(NaN)).toBeUndefined();
  });
});

describe('no formatter prints a value at or above its own unit', () => {
  // A deterministic sweep over 15 orders of magnitude, with extra points just below each unit boundary.
  const samples: number[] = [];
  let seed = 42;
  const next = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 20_000; i++) {
    const value = 10 ** (next() * 15);
    samples.push(value, Math.round(value), Math.round(value / 10) * 10 - 0.5);
  }
  for (const edge of [999.5, 999_950, 999_999_999, 59_995, 3_599_950, 3_597_000, 1_048_575, 1_073_741_823]) {
    for (const delta of [-1, -0.5, -0.1, 0, 0.1, 0.5, 1]) samples.push(edge + delta);
  }

  const violations = (format: (value: number) => string | undefined): string[] => {
    const bad: string[] = [];
    for (const value of samples) {
      const text = format(value) ?? '';
      const single = /^(\d+(?:\.\d+)?)(K|M|G| KB| MB| GB|us|ms|s|m)$/.exec(text);
      const minutes = /^(\d+)m (\d+\.\d)s$/.exec(text);
      const hours = /^(\d+)h (\d+)m(?: (\d+)s)?$/.exec(text);
      const limit = single
        ? { K: 1000, M: 1000, G: 1000, KB: 1024, MB: 1024, GB: 1024, us: 1000, ms: 1000, s: 60, m: 60 }[single[2].trim()]!
        : 0;
      if (
        /NaN|Infinity|undefined/.test(text)
        || (single && Number(single[1]) >= limit)
        || (minutes && (Number(minutes[1]) >= 60 || Number(minutes[2]) >= 60))
        || (hours && (Number(hours[2]) >= 60 || Number(hours[3] ?? 0) >= 60))
      ) {
        bad.push(`${value} → ${text}`);
      }
    }
    return bad;
  };

  it.each([
    ['formatNumberShort', formatNumberShort],
    ['formatBytes', formatBytes],
    ['formatTimeCompact', formatTimeCompact],
    ['formatTimeShort', formatTimeShort],
    ['formatTimeDetailed', formatTimeDetailed],
  ] as const)('%s', (_name, format) => {
    expect(violations((value) => format(value))).toEqual([]);
  });
});

describe('callers that trim a trailing ".0" before the unit', () => {
  const node = (over: Partial<PlanNode>): PlanNode => ({ id: 1, depth: 1, operation: 'X', children: [], ...over });

  it('formatEstimatedRows trims it for the G and T units too', () => {
    expect(formatEstimatedRows(node({ rows: 1, estimatedRowsTotal: 2_000_000_000 })).text).toBe('1 × 2G');
    expect(formatEstimatedRows(node({ rows: 1, estimatedRowsTotal: 3_000_000_000_000 })).text).toBe('1 × 3T');
  });

  it('formatThreshold trims it for the G and T units too', () => {
    expect(formatThreshold(2_000_000_000, 'count')).toBe('2G');
    expect(formatThreshold(2_500_000_000, 'count')).toBe('2.5G');
    expect(formatThreshold(1_000_000_000_000, 'count')).toBe('1T');
    expect(formatThreshold(7_200_000, 'time')).toBe('2h 0m');
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/format.units.test.ts`
→ `Tests  92 passed (92)`.

(Sanity check of the test itself, optional: with Step 1 temporarily reverted,
48 of the 92 fail.)

### Step 3: Full gates

**Verify**:
- `npm run lint` → exit 0
- `npm run typecheck` → exit 0
- `npm test` → all pass; one more test file and 92 more tests than before this
  plan

## Test plan

- New file `src/lib/__tests__/format.units.test.ts` (structure as in
  `src/lib/__tests__/estimatedRows.test.ts`):
  - a table per formatter with the boundary inputs listed in Step 2 — both the
    values that must stay as they are and the ones that change;
  - NaN / -Infinity / `undefined` / `Infinity` handling;
  - a deterministic sweep (60,000 values over 15 orders of magnitude plus
    points around every unit boundary) asserting that no output shows a number
    at or above its unit's limit (`1000.0K`, `1024.0 MB`, `60.00s`, `1m 60.0s`,
    `1h 60m`) or the text `NaN`;
  - the two `.0`-trimming callers with `G` and `T`.
- No existing test changes. If one fails, see STOP conditions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `format.units.test.ts` exists and its 92 tests pass
- [ ] `grep -c "KMGT" packages/ora-plan-core/src/format.ts src/lib/filterThresholds.ts`
      → `1` for each file
- [ ] `grep -c "toFixed(1) + 'M'\|toFixed(1) + 'K'" packages/ora-plan-core/src/format.ts`
      → `0`
- [ ] `git status --porcelain | grep -c "test"` → `1` (the only test file
      touched is the new `src/lib/__tests__/format.units.test.ts`)
- [ ] `git status --porcelain` lists only the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The formatters at the top of `format.ts` do not match the excerpt.
- After Step 1 any **existing** test fails. The change was verified not to move
  any existing expectation at `b5635d8` plus plans 012–015; a failure means a
  newer test pins a string this plan changes — report the test and both
  strings, do not edit the expectation on your own.
- A row of the Step 2 table marked `=` does not print as shown (a value that
  was not supposed to move, moved).
- The sweep test reports violations after two checks that Step 1 was typed
  exactly as given.

## Maintenance notes

- Where the strings appear (for the reviewer's visual pass): plan nodes
  (`src/components/nodes/PlanNode.tsx`), the details panel, tabular, compare,
  Sankey, flame, timeline / waterfall / scatter views, SQL Monitor details, the
  metadata explorer (table and index sizes), advisor findings (`spillToDisk`,
  `hashJoinBuildSide`), the client report, plan Markdown / AI plan text, and
  the filter panel's threshold boxes.
- Format choices made here: counts use Oracle's own suffix letters (`K`, `M`,
  `G`, `T`; beyond `T` the number just grows); the compact time form drops
  seconds once it shows hours (`1h 30m`), the detailed form keeps whole seconds
  (`1h 2m 3s`), the short form uses decimal hours (`1.5h`).
- The filter panel's time threshold box shows `formatThreshold(value, 'time')`.
  Compound forms (`1m 30.0s`, now also `1h 30m`) are not accepted back by
  `parseThreshold`, which takes one number and one unit — unchanged behaviour;
  the box keeps the previous value when the text does not parse.
- Anything that pattern-matches these strings must know the new units. The two
  known places are updated in Step 1; `grep -rn "\[KM\]" src packages` finds
  future ones.
- Deferred: `formatNumber` in `packages/ora-plan-core/src/types.ts` duplicates
  the old `formatNumberShort` logic and has no callers in `src/`; removing or
  redirecting it belongs to a dead-code clean-up, not here.
