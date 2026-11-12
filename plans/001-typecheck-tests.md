# Plan 001: `npm run typecheck` also type-checks the test files and `evals/`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- package.json tsconfig.json tsconfig.app.json evals/tsconfig.json src/lib/ai/__tests__ src/lib/metadata/__tests__/pairing.test.ts src/components/__tests__/FilterPanel.test.tsx src/components/__tests__/ExperimentalView.test.tsx src/components/__tests__/FlameView.test.tsx src/components/__tests__/SankeyView.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number. Other
> plans add or edit test files (for example `plans/002-…`, `plans/004-…`,
> `plans/006-…`); if they landed first, Step 1 may list more errors than the 11
> below — see Step 1.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (do this one first: it guards every later plan's tests)
- **Category**: dx
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

`npm run typecheck` (`tsc -b`) is one of the three CI gates, but it only sees
application code: the 158 TypeScript files under `src/**/__tests__/` and the
whole `evals/` harness are outside every project `tsc -b` builds. Vitest strips
types without checking them, so a test can keep passing while it builds objects
that no longer match the real types. That has already happened: 11 type errors
sit in 6 test files today (a `PlanSlot` missing a required field, a record that
misses a newer union member, SDK errors constructed with the wrong arguments).
After this plan a type error in a test or in `evals/` fails `npm run typecheck`
locally and in CI.

## Current state

- `tsconfig.json` (repo root) — the solution file `tsc -b` builds:

  ```json
  {
    "files": [],
    "references": [
      { "path": "./tsconfig.app.json" },
      { "path": "./tsconfig.node.json" }
    ]
  }
  ```

- `tsconfig.app.json:27-28` — the app project excludes the tests:

  ```json
    "include": ["src"],
    "exclude": ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.spec.ts"]
  ```

  Its `compilerOptions` include `"strict": true`, `"noUnusedLocals": true`,
  `"erasableSyntaxOnly": true`, `"types": ["vite/client"]`, `"noEmit": true`.

- `evals/tsconfig.json` — exists, type-checks cleanly, but nothing runs it:

  ```json
  {
    "extends": "../tsconfig.app.json",
    "compilerOptions": {
      "tsBuildInfoFile": "../node_modules/.tmp/tsconfig.evals.tsbuildinfo",
      "types": ["node"]
    },
    "include": ["."]
  }
  ```

- `package.json:11-15` — three scripts run a bare `tsc -b`:

  ```json
      "build": "tsc -b && vite build",
      "build:single": "tsc -b && vite build --mode single",
      "typecheck": "tsc -b",
  ```

  **Design decision**: the new projects are added to the `typecheck` script
  only, NOT to the `references` in the root `tsconfig.json`. `build` and
  `build:single` (and through them the Docker image and the GitHub Pages
  deploy) also run `tsc -b`; they must keep checking only the app.

- `packages/ora-plan-core/test/core.test.ts:4` has
  `import * as built from '../dist/index.js';`. `dist/` is not committed and is
  only built by `npm test` (`pretest` → `build:core`), which CI runs *after*
  typecheck. This file is therefore deliberately left out of the new project.

- ESLint already covers the tests (`eslint .`, `eslint.config.js` matches
  `**/*.{ts,tsx}`); nothing to change there.

- The 11 errors a correct test project reports at `b5635d8` (verified by
  running the configuration from Step 1):

  ```
  src/components/__tests__/ExperimentalView.test.tsx(40,11): error TS2741: Property 'flame' is missing in type '{ scatter: string; timeline: string; waterfall: string; morph: string; waits: string; }' but required in type 'Record<ExperimentalSubView, string>'.
  src/components/__tests__/FilterPanel.test.tsx(28,38): error TS2352: Conversion of type '{ operationTypes: never[]; … }' to type 'FilterState' may be a mistake … missing the following properties from type 'FilterState': showPredicates, animateEdges, scaleEdgeWidth, focusSelection, nodeDisplayOptions
  src/components/__tests__/FlameView.test.tsx(50,19): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
  src/components/__tests__/SankeyView.test.tsx(74,19): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
  src/lib/ai/__tests__/anthropic.test.ts(121,13): error TS2554: Expected 4-5 arguments, but got 2.
  src/lib/ai/__tests__/anthropic.test.ts(134,40): error TS2559: Type '"aborted"' has no properties in common with type '{ message?: string | undefined; }'.
  src/lib/ai/__tests__/anthropic.test.ts(135,8): error TS2554: Expected 4-5 arguments, but got 2.
  src/lib/ai/__tests__/anthropic.test.ts(136,8): error TS2554: Expected 4-5 arguments, but got 2.
  src/lib/ai/__tests__/anthropic.test.ts(137,41): error TS2559: Type '"conn"' has no properties in common with type '{ message?: string | undefined; cause?: Error | undefined; }'.
  src/lib/ai/__tests__/anthropic.test.ts(138,8): error TS2554: Expected 4-5 arguments, but got 2.
  src/lib/metadata/__tests__/pairing.test.ts(21,3): error TS2741: Property 'metadataBundleWarning' is missing in type '{ id: string; … metadataBundle: null; }' but required in type 'PlanSlot'.
  ```

- Repo conventions that apply: TypeScript strict; `import type` for type-only
  imports; tests are vitest without Testing Library. Fix a test so it matches
  the real type. Never loosen an application type, never add `any`,
  `@ts-ignore`, `@ts-expect-error` or a new `as unknown as` cast to silence an
  error.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no output after the script header |
| Test project only | `npx tsc -b tsconfig.test.json` | exit 0, no output (after Step 6) |
| All tests | `npm test` | builds the core package, then vitest: `Test Files  155 passed (155)`, `Tests  1787 passed (1787)` (more if other plans landed first), ~15 s |
| One test file | `npx vitest run --environment jsdom path/to/file.test.ts` | all pass |

## Scope

**In scope** (the only files you should modify):
- `tsconfig.test.json` (create, repo root)
- `package.json` (the `typecheck` script only)
- `src/lib/metadata/__tests__/pairing.test.ts`
- `src/components/__tests__/FilterPanel.test.tsx`
- `src/components/__tests__/ExperimentalView.test.tsx`
- `src/components/__tests__/FlameView.test.tsx`
- `src/components/__tests__/SankeyView.test.tsx`
- `src/lib/ai/__tests__/anthropicSdkMock.ts`
- `src/lib/ai/__tests__/anthropic.test.ts`

**Out of scope** (do NOT touch):
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `evals/tsconfig.json` —
  changing the root references would make `npm run build`, the Docker build and
  the Pages deploy type-check tests.
- Any non-test file under `src/` or `packages/` — no application type may be
  changed to make a test compile.
- `packages/ora-plan-core/test/` — needs the built `dist/` (see Current state).
- `.github/workflows/ci.yml` — it already runs `npm run typecheck`.
- `vitest.config.ts`, `eslint.config.js`.

## Git workflow

- Branch: `chore/typecheck-tests`
- One commit is fine; message style is conventional commits, as in the repo's
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`. Suggested:
  `chore(typecheck): type-check tests and evals in npm run typecheck`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the test project

Create `tsconfig.test.json` in the repo root with exactly:

```json
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.test.tsbuildinfo",
    "types": ["vite/client", "node"]
  },
  "include": ["src"],
  "exclude": []
}
```

(`"exclude": []` is required: without it the `exclude` of `tsconfig.app.json`
is inherited and the tests are skipped again. `node` types are added here only;
the app project must stay without them.)

**Verify**: `npx tsc -b tsconfig.test.json` → fails, listing the 11 errors
quoted in "Current state" (same files and TS codes; line numbers may differ by
a few). If it lists *additional* errors in files under a `__tests__` directory
(another plan may have added tests), fix those too by the rules in "Current
state". If it lists an error in a file that is NOT under a `__tests__`
directory, STOP.

### Step 2: `pairing.test.ts` — add the missing `PlanSlot` field

In `src/lib/metadata/__tests__/pairing.test.ts`, function `makeSlot`, add one
property after `metadataBundle: null,`:

```ts
    metadataBundle: null,
    metadataBundleWarning: null,
  };
```

### Step 3: `FilterPanel.test.tsx` — build a complete `FilterState`

Add an import below the existing `import { FilterPanelBody } from '../FilterPanel';`:

```ts
import { defaultBehaviourOptions, defaultNodeDisplayOptions } from '../../lib/settings';
```

Replace the `DEFAULT_FILTERS` constant (currently ends with `} as FilterState;`) with:

```ts
const DEFAULT_FILTERS: FilterState = {
  operationTypes: [],
  minCost: 0,
  maxCost: Infinity,
  searchText: '',
  showPredicates: true,
  predicateTypes: [],
  ...defaultBehaviourOptions,
  nodeDisplayOptions: defaultNodeDisplayOptions,
  minActualRows: 0,
  maxActualRows: Infinity,
  minActualTime: 0,
  maxActualTime: Infinity,
  minCardinalityMismatch: 0,
};
```

(This mirrors `initialFilters` in `src/hooks/usePlanContext.tsx`; the cast is gone.)

### Step 4: `ExperimentalView.test.tsx` — cover the `flame` sub-view

`ExperimentalSubView` is `'flame' | 'scatter' | 'timeline' | 'waterfall' | 'morph' | 'waits'`
and the test's `expected` record misses `flame`.

1. Next to the other five `vi.mock('../views/experimental/…')` lines, add:

   ```tsx
   vi.mock('../views/FlameView', () => ({ FlameView: () => <div data-testid="flame" /> }));
   ```

2. In the test `describes the active sub-view under the switcher`, add as the
   first entry of `expected` (the text is the `description` of the `flame`
   entry of `SUB_VIEWS` in `src/components/views/experimental/ExperimentalView.tsx`;
   copy it from there if it differs):

   ```ts
      flame: "Flame graph — bars sized by each operation's own share of the metric; click a bar to zoom into its subtree",
   ```

### Step 5: `FlameView.test.tsx` and `SankeyView.test.tsx` — no parameter properties

Both files stub `ResizeObserver` with a class whose constructor is
`constructor(private cb: () => void) {}`. Parameter properties are not allowed
under `erasableSyntaxOnly`. In each file replace that one line with:

```ts
      private cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
      }
```

Leave the rest of each class (`observe`, `disconnect`) unchanged.

### Step 6: Anthropic SDK stand-in — export its error classes

`src/lib/ai/__tests__/anthropic.test.ts` constructs errors through the default
import `Anthropic`, which TypeScript types as the *real* SDK (4–5 constructor
arguments), while at runtime `vi.mock` swaps in the stand-in from
`anthropicSdkMock.ts` (`(message, status?)`). Make the stand-in's classes
importable and use them directly.

1. In `src/lib/ai/__tests__/anthropicSdkMock.ts`, move the six error classes
   out of `anthropicSdkModule()` to module scope, export them as one object,
   and keep the function returning the same shape. The file's tail (from
   `export function anthropicSdkModule() {` to the end) becomes:

   ```ts
   class APIError extends Error {
     status: number | undefined;
     constructor(message: string, status?: number) {
       super(message);
       this.status = status;
     }
   }
   class APIUserAbortError extends APIError {}
   class APIConnectionError extends APIError {}
   class AuthenticationError extends APIError {}
   class RateLimitError extends APIError {}
   class BadRequestError extends APIError {}

   /**
    * The stand-in error classes, for tests that need to throw one. Construct them
    * through this object, not through the `Anthropic` default import: that import
    * is typed as the real SDK, whose error constructors take different arguments.
    */
   export const sdkErrors = {
     APIError,
     APIUserAbortError,
     APIConnectionError,
     AuthenticationError,
     RateLimitError,
     BadRequestError,
   };

   export function anthropicSdkModule() {
     class Anthropic {
       beta = { messages: { stream: streamMock } };
       constructor(opts: unknown) {
         constructorMock(opts);
       }
       static APIError = APIError;
       static APIUserAbortError = APIUserAbortError;
       static APIConnectionError = APIConnectionError;
       static AuthenticationError = AuthenticationError;
       static RateLimitError = RateLimitError;
       static BadRequestError = BadRequestError;
     }
     return { default: Anthropic };
   }
   ```

   Keep the header comment and the `streamMock` / `constructorMock` exports as they are.

2. In `src/lib/ai/__tests__/anthropic.test.ts`:
   - change `import { streamMock, constructorMock } from './anthropicSdkMock';`
     to `import { streamMock, constructorMock, sdkErrors } from './anthropicSdkMock';`
   - delete the line `import Anthropic from '@anthropic-ai/sdk';` (it becomes unused);
   - replace all six occurrences of `new Anthropic.` with `new sdkErrors.`
     (`AuthenticationError`, `APIUserAbortError`, `RateLimitError`, `APIError`,
     `APIConnectionError`, `BadRequestError`). Arguments stay as they are.

   Do not touch the `vi.mock('@anthropic-ai/sdk', …)` line.

**Verify (Steps 2–6)**: `npx tsc -b tsconfig.test.json` → exit 0, no output.
Then `npx vitest run --environment jsdom src/components/__tests__/ExperimentalView.test.tsx src/components/__tests__/FilterPanel.test.tsx src/components/__tests__/FlameView.test.tsx src/components/__tests__/SankeyView.test.tsx src/lib/ai/__tests__/anthropic.test.ts src/lib/ai/__tests__/chat.test.ts src/lib/metadata/__tests__/pairing.test.ts`
→ `Test Files  7 passed (7)`, `Tests  50 passed (50)`.

### Step 7: Wire both projects into the `typecheck` script

In `package.json` change

```json
    "typecheck": "tsc -b",
```

to

```json
    "typecheck": "tsc -b tsconfig.json tsconfig.test.json evals/tsconfig.json",
```

Do not change `build` or `build:single`.

**Verify**: `npm run typecheck` → exit 0, no output after the script header.
A cold run now takes roughly 10–12 s instead of ~5 s (the test project
re-checks the app files its tests import); that is expected.

### Step 8: Prove the gate bites, then run everything

1. Temporarily add the line `const typecheckProbe: number = 'x';` at the end of
   `src/lib/metadata/__tests__/pairing.test.ts`.
   `npm run typecheck` → must FAIL with `error TS2322` in that file.
2. Remove the probe line again.

**Verify**: `git diff --stat -- src/lib/metadata/__tests__/pairing.test.ts`
shows only the one-line change from Step 2; `npm run typecheck` → exit 0;
`npm run lint` → exit 0; `npm test` → all pass, same counts as before this plan.

## Test plan

No new tests: this plan adds a compile-time gate. The seven test files touched
(listed in the Step 6 verification) must still pass unchanged in behaviour
(50 tests). The "gate bites" check in Step 8 is the regression proof.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `grep -c '"typecheck": "tsc -b tsconfig.json tsconfig.test.json evals/tsconfig.json"' package.json` prints `1`
- [ ] `npx tsc -p tsconfig.test.json --listFilesOnly | grep -c '/__tests__/'` prints a number ≥ 150
- [ ] `git diff --quiet b5635d8 -- tsconfig.json tsconfig.app.json tsconfig.node.json evals/tsconfig.json` exits 0 (unchanged)
- [ ] `grep -rn "typecheckProbe" src/` returns no matches
- [ ] `grep -rnE "@ts-ignore|@ts-expect-error" src/lib/ai/__tests__ src/lib/metadata/__tests__/pairing.test.ts src/components/__tests__/FilterPanel.test.tsx src/components/__tests__/ExperimentalView.test.tsx` returns no matches
- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0 with at least 155 files / 1787 tests passing
- [ ] `git status --porcelain` lists only the files in "In scope"
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 reports an error in a file outside a `__tests__` directory, or in `evals/`.
- A fix would need a change to a non-test source file, or an `any` /
  `@ts-ignore` / new `as unknown as` cast.
- `import { defaultBehaviourOptions, defaultNodeDisplayOptions } from '../../lib/settings'`
  does not resolve (the exports were renamed) — report what `src/lib/settings.ts` exports instead.
- After Step 6 any of the seven listed test files fails.
- `npm run typecheck` fails because of `packages/ora-plan-core/test` or a
  missing `dist/` — that directory must not be part of the new project.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- New test files anywhere under `src/` are picked up automatically. Tests in a
  new top-level directory need their own entry in the `typecheck` script.
- `packages/ora-plan-core/test/core.test.ts` is still not type-checked because
  it imports the built `dist/`. Covering it means building the package before
  typecheck (for example a `pretypecheck` script running `npm run build:core`);
  deferred because it changes CI step timing.
- Editors: `tsconfig.test.json` is not referenced from the root `tsconfig.json`
  on purpose (so `npm run build` stays app-only). An editor's TypeScript
  service may therefore still treat test files as loose files; the command
  line gate is the source of truth.
- Reviewer: check that no application type was widened and that
  `anthropic.test.ts` still exercises `instanceof` mapping in
  `src/lib/ai/providers/anthropic.ts` through the mocked module (the stand-in's
  static members are the same class objects as `sdkErrors`).
