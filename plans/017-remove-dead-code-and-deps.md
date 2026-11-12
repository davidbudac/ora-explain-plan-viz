# Plan 017: Unreachable prototype views, unused dependencies and the eagerly bundled AI SDK are gone from the app bundle

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- src/components/views/prototype src/components/VisualizationTabs.tsx packages/ora-plan-core/src/types.ts src/components/viewIcons.tsx src/lib/session.ts src/components/CommandPalette.tsx src/hooks/usePlanContext.tsx src/lib/ai/provider.ts package.json src/assets`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first
> and shifted line numbers; match on the quoted code, not the line number.
> `src/hooks/usePlanContext.tsx` and `package.json` are edited by several
> other plans — this plan changes one line in each. This plan does not touch
> `src/components/AiAnalysisDialog.tsx` or `src/lib/ai/secrets.ts`
> (`plans/019-security-docs-match-code.md` does).

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

The production bundle ships code nobody can reach and packages nothing
imports: an 8-file prototype of an AI report view (1,553 lines, with mock data
and a simulated stream) rendered for a view mode that nothing can select; the
`d3-force` dependency and two `@types` packages with no importer; an orphan
SVG; and the 320 KB Anthropic SDK, loaded on every start although the AI "Run"
button is hard-disabled ("Coming soon"). Dead code misleads maintainers (the
`'ai-report'` view mode appears in types, session and icon tables), and unused
dependencies are supply-chain surface for nothing. Measured in a clean copy at
the planned commit, this plan shrinks the main JS chunk from 2,258,893 to
about 1,906,000 bytes (−16%), and the CSS by about 7 KB.

## Current state

Client-side React 19 + TypeScript + Vite 7 app. Types, parsers and the advisor
live in `packages/ora-plan-core/src/`; files of the same name under `src/lib/`
(for example `src/lib/types.ts`) are one-line `export *` shims — never edit
the shims.

### (1) The prototype view

- `src/components/views/prototype/` — 8 files: `AiReportPrototypeView.tsx`,
  `VariantA.tsx`, `VariantB.tsx`, `VariantC.tsx`, `shared.tsx`, `styles.ts`,
  `mockReport.ts`, `useSimulatedStream.ts`. Nothing outside the directory
  imports them except:
- `src/components/VisualizationTabs.tsx`:
  ```tsx
  17	import { AiReportView } from './views/AiReportView';
  18	import { AiReportPrototypeView } from './views/prototype/AiReportPrototypeView';
  ...
  105	        {viewMode === 'ai' && <AiReportView />}
  106	        {viewMode === 'ai-report' && <AiReportPrototypeView />}
  ```
- Nothing can set `viewMode` to `'ai-report'`. Every other reference only
  excludes it or lists it:
  - `packages/ora-plan-core/src/types.ts:305`
    ```ts
    export type ViewMode = 'hierarchical' | 'sankey' | 'flame' | 'tabular' | 'text' | 'sql' | 'metadata' | 'compare' | 'monitor' | 'experimental' | 'ai' | 'ai-report';
    ```
  - `src/components/viewIcons.tsx:23` — an entry `'ai-report': 'M12 3l1.8 4.7…'`
    in `const VIEW_ICON_PATHS: Record<ViewMode, string>`.
  - `src/lib/session.ts:23-26`
    ```ts
    const VIEW_MODES: readonly ViewMode[] = [
      'hierarchical', 'sankey', 'flame', 'tabular', 'text', 'sql', 'metadata',
      'compare', 'monitor', 'experimental', 'ai', 'ai-report',
    ];
    ```
  - `src/components/CommandPalette.tsx:100`
    ```ts
    const VIEW_MODE_LABELS: Record<Exclude<ViewMode, 'ai' | 'ai-report'>, string> = {
    ```
  - `src/hooks/usePlanContext.tsx:104`
    ```ts
      if (!mode || mode === 'ai' || mode === 'ai-report') return null;
    ```
  - `src/lib/__tests__/url.test.ts:259` — a test that a share link carrying
    `viewMode: 'ai-report'` is ignored. **Keep this test unchanged**; it is the
    backward-compatibility guard for share links (the payload field is typed
    `string`, so it still compiles).
- Old saved state must keep loading (project invariant). The session reader
  already falls back for unknown view modes — `src/lib/session.ts:142`:
  ```ts
      viewMode: isViewMode(obj.viewMode) ? obj.viewMode : 'hierarchical',
  ```
  and `src/lib/__tests__/session.test.ts:115-123` tests that with `'bogus'`.

### (2) Unused dependencies

`package.json` lists `"d3-force": "^3.0.1"` (dependencies),
`"@types/d3-force": "^3.0.10"` and `"@types/lz-string": "^1.5.0"`
(devDependencies). No file under `src/`, `packages/`, `evals/`, `scripts/` or
`vite.config.ts` imports `d3-force`. `lz-string` is used (`src/lib/url.ts`)
but ships its own types (`node_modules/lz-string/package.json` has
`"typings": "typings/lz-string.d.ts"`), so `@types/lz-string` is redundant.

### (3) Orphan asset

`src/assets/react.svg` is referenced nowhere. **`public/vite.svg` is NOT an
orphan** — `scripts/capture-showcase.mjs:381` navigates to `${BASE}/vite.svg`
as a same-origin static page. Leave it.

### (4) The Anthropic SDK in the initial chunk

`src/lib/ai/provider.ts` (the only non-test importer of the Anthropic
provider, which is the only importer of `@anthropic-ai/sdk`):

```ts
8	import type { AgentConfig } from '../agent/client';
9	import type { AiChatMessage, AiProviderId, AiRequest, AiStreamEvent } from './types';
10	import { AiError } from './types';
11	import { streamAnthropic } from './providers/anthropic';
12	import { streamOpenAiCompat } from './providers/openaiCompat';
13	import { streamAgentProxy } from './providers/agent';
```

`streamAnthropic` is called at two places in the file (in `streamAnalysis` and
`streamChat`), each as `return streamAnthropic({ apiKey: runConfig.apiKey }, …, signal);`.
Its signature in `src/lib/ai/providers/anthropic.ts:59-63`:

```ts
export async function* streamAnthropic(
  config: { apiKey: string },
  req: AiRequest & { messages?: AiChatMessage[] },
  signal: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
```

The AI Run button is disabled in `src/components/AiAnalysisDialog.tsx`
(`disabled`, label `AI_COMING_SOON_LABEL`), so today the SDK is downloaded and
parsed for nothing. Two facts about lazy chunks in this app: the service
worker (`public/sw.js`) precaches only the assets referenced from
`index.html`, so a lazily loaded chunk is fetched (and then cached) on first
use — acceptable, because calling an AI provider needs the network anyway;
and the single-file build (`npm run build:single`) inlines dynamic imports, so
it stays one file.

### Conventions

TypeScript strict; `import type` for type-only imports; tests are vitest with
explicit imports (`import { describe, it, expect } from 'vitest'`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | all files pass (baseline at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`, about 15 s) |
| One test file | `npx vitest run --environment jsdom src/lib/__tests__/session.test.ts` | all pass |
| Build | `npm run build` | exit 0; prints the size of each file in `dist/assets/` (`dist/` is git-ignored) |
| Single-file build | `npm run build:single` | exit 0; `dist-single/` contains only `index.html` |

## Scope

**In scope** (the only files you should modify or delete):

- `src/components/views/prototype/` (delete all 8 files)
- `src/components/VisualizationTabs.tsx`
- `packages/ora-plan-core/src/types.ts` (the `ViewMode` line only)
- `src/components/viewIcons.tsx`
- `src/lib/session.ts`
- `src/components/CommandPalette.tsx` (line 100 only)
- `src/hooks/usePlanContext.tsx` (line 104 only)
- `src/lib/__tests__/session.test.ts` (add one test)
- `src/assets/react.svg` (delete)
- `package.json`, `package-lock.json` (via `npm uninstall` only)
- `src/lib/ai/provider.ts`

**Out of scope** (do NOT touch, even though they look related):

- `src/components/views/AiReportView.tsx`, `src/components/AiAnalysisDialog.tsx`,
  `src/hooks/useAiAnalysis.tsx`, everything else under `src/lib/ai/` and the
  `'ai'` view mode — the real (currently disabled) AI feature stays as it is.
- `public/vite.svg` — used by `scripts/capture-showcase.mjs`.
- `src/lib/__tests__/url.test.ts` — keep the `'ai-report'` case as is.
- Lazy-loading other views or dialogs, and `vite.config.ts` chunking options.
- `src/lib/parser.ts` versus `src/lib/parser/index.ts` (two entry points) —
  separate clean-up.
- Any `src/lib/*.ts` one-line shim.

## Git workflow

- Branch: `chore/remove-dead-code`
- One commit per step group is ideal, conventional-commit style, e.g.
  `chore: remove the unreachable AI report prototype views`,
  `chore(deps): drop unused d3-force and redundant @types`,
  `perf(ai): load the Anthropic provider on first use`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record the baseline bundle size

Run `npm run build` and note the size of `dist/assets/index-*.js` from the
build output (at the planned commit: `2,258.89 kB`).

**Verify**: the build exits 0 and you have written the number down.

### Step 2: Add the backward-compatibility test first

In `src/lib/__tests__/session.test.ts`, directly after the test
`'sanitizes the active index and view mode'`, add:

```ts
  it('falls back to the tree view for a session saved on the removed ai-report view', () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 1, activePlanIndex: 0, viewMode: 'ai-report', slots: [{ text: 'a' }] }),
    );
    const loaded = loadSession();
    expect(loaded?.slots).toHaveLength(1);
    expect(loaded?.viewMode).toBe('hierarchical');
    expect(isViewMode('ai-report')).toBe(false);
  });
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/session.test.ts`
→ this one test fails (received `'ai-report'`); all others pass.

### Step 3: Remove the prototype view and the `'ai-report'` view mode

1. `git rm -r src/components/views/prototype`
2. `src/components/VisualizationTabs.tsx`: delete the import on line 18 and
   the render line 106 (both quoted above).
3. `packages/ora-plan-core/src/types.ts`: end the `ViewMode` union at
   `| 'ai';` (remove ` | 'ai-report'`).
4. `src/components/viewIcons.tsx`: delete the `'ai-report': '…',` entry.
5. `src/lib/session.ts`: in `VIEW_MODES`, change the second line to
   `'compare', 'monitor', 'experimental', 'ai',`.
6. `src/components/CommandPalette.tsx`: change
   `Exclude<ViewMode, 'ai' | 'ai-report'>` to `Exclude<ViewMode, 'ai'>`.
7. `src/hooks/usePlanContext.tsx`: change the condition to
   `if (!mode || mode === 'ai') return null;`.

Decision rule: if `npm run typecheck` then reports errors in files other than
the six edited above, and fixing them would mean editing more than two further
files, undo sub-steps 3–7 (`git checkout -- <those files>`), keep only
sub-steps 1–2 (directory and render removed; the unused `'ai-report'` type
member stays), and say so in your report.

**Verify**:
- `npm run typecheck` → exit 0
- `npx vitest run --environment jsdom src/lib/__tests__/session.test.ts src/lib/__tests__/url.test.ts` → all pass
- `grep -rn "ai-report\|views/prototype" src packages/ora-plan-core/src --include=*.ts --include=*.tsx | grep -v __tests__` → no output

### Step 4: Remove the orphan asset and the unused packages

1. `git rm src/assets/react.svg`
2. First confirm nothing imports the packages:
   `grep -rn "d3-force" src packages/ora-plan-core/src evals scripts vite.config.ts` → no output.
   `grep -n '"typings"\|"types"' node_modules/lz-string/package.json` → shows a typings entry.
3. `npm uninstall d3-force @types/d3-force @types/lz-string`

**Verify**:
- `grep -c "d3-force\|@types/lz-string" package.json` → `0`
- `git diff --stat -- package.json package-lock.json` → both files changed, and
  the `package.json` diff removes exactly three lines
- `npm run typecheck` → exit 0 (proves `lz-string` still has types)

### Step 5: Load the Anthropic provider on first use

In `src/lib/ai/provider.ts`:

1. Delete the line `import { streamAnthropic } from './providers/anthropic';`
2. Directly above the comment `/** Resolved, ready-to-run configuration for one analysis request. */`
   add a local wrapper with the same name and signature, so the two call
   sites stay unchanged:

   ```ts
   /**
    * The Anthropic provider is loaded on first use, so the Anthropic SDK stays
    * out of the initial bundle (the other providers are plain `fetch`).
    */
   async function* streamAnthropic(
     config: { apiKey: string },
     req: AiRequest & { messages?: AiChatMessage[] },
     signal: AbortSignal,
   ): AsyncGenerator<AiStreamEvent> {
     const provider = await import('./providers/anthropic');
     yield* provider.streamAnthropic(config, req, signal);
   }
   ```

   (`AiRequest`, `AiChatMessage` and `AiStreamEvent` are already imported as
   types on line 9.) Change nothing else in the file.

**Verify**:
- `npm run typecheck` → exit 0
- `npx vitest run --environment jsdom src/lib/ai` → all pass (this includes
  `chat.test.ts`, which drives the Anthropic path through `streamChat`)
- `npm run build` → the output now lists a separate `dist/assets/anthropic-*.js`
  chunk (about 320 kB) and `dist/assets/index-*.js` is below `1,950 kB`
- `npm run build:single` then `ls dist-single` → only `index.html`

### Step 6: Full check

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0; `npm test`
→ all pass (at the planned commit: `Test Files 155 passed (155)`,
`Tests 1788 passed (1788)` — one new test).

## Test plan

- New test in `src/lib/__tests__/session.test.ts`:
  `falls back to the tree view for a session saved on the removed ai-report view`
  (Step 2) — the saved-state compatibility guard for this removal. Modelled on
  the neighbouring `sanitizes the active index and view mode`.
- Existing guard kept as is: `src/lib/__tests__/url.test.ts`
  `ignores unknown or unsafe view modes on decode` (share links).
- The lazy import is covered by the existing `src/lib/ai/__tests__/chat.test.ts`
  (Anthropic path through `streamChat`) and `anthropic.test.ts`.
- No test covers bundle size; the build-output checks in Step 5 are the proof.

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including the new session test
- [ ] `test ! -e src/components/views/prototype && test ! -e src/assets/react.svg` succeeds
- [ ] `grep -rn "ai-report" src packages/ora-plan-core/src --include=*.ts --include=*.tsx | grep -v __tests__` prints nothing
- [ ] `grep -c "d3-force\|@types/lz-string" package.json` prints `0`
- [ ] `grep -c "from './providers/anthropic'" src/lib/ai/provider.ts` prints `0` and `grep -c "import('./providers/anthropic')" src/lib/ai/provider.ts` prints `1`
- [ ] `npm run build` output shows `dist/assets/index-*.js` smaller than the Step 1 number by at least 300 kB
- [ ] `test -e public/vite.svg` succeeds (not deleted)
- [ ] `git status --porcelain` lists only in-scope paths
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `grep -rn "prototype/" src --include=*.ts --include=*.tsx` shows an importer
  of the prototype directory other than `VisualizationTabs.tsx`.
- Anything outside tests can set the `'ai-report'` view mode (search for
  `setViewMode('ai-report')` or a nav tab / palette command with that value) —
  then the view is reachable and must not be removed.
- `grep -rn "d3-force"` finds an import — then the dependency is used.
- `npm uninstall` fails (for example no registry access) — report it; do not
  hand-edit `package-lock.json`.
- After Step 5 any test under `src/lib/ai` fails twice after a reasonable fix
  attempt — revert Step 5 only (`git checkout -- src/lib/ai/provider.ts`),
  finish the other steps, and report.
- `npm run build:single` leaves more than one file in `dist-single/`.

## Maintenance notes

- `ViewMode` is exported by the `ora-plan-core` package, whose built `dist/`
  another project vendors. Removing a union member is a (tiny) breaking type
  change for consumers that list every member; mention it in the changelog.
- If the AI report is ever redesigned, start from `git show b5635d8:src/components/views/prototype/`.
- The lazy Anthropic chunk is not precached by the service worker, so the
  first AI run after a new deploy needs the network — which an AI call needs
  anyway. If more code is lazy-loaded later, extend the precache list in
  `public/sw.js` (it currently reads asset URLs out of `index.html`).
- Still bundled eagerly although unreachable while the Run button is
  disabled: the AI dialog, the AI report view, `marked` and `dompurify`.
  Whether to finish the AI feature, hide it behind a build flag (the way
  `VITE_ENABLE_DB_AGENT` gates the DB connector) or remove it is a product
  decision; this plan only removes what is dead under every outcome.
- Reviewers: check that `public/vite.svg` survived and that the
  `package-lock.json` diff only removes the three packages (plus their
  now-unused transitive entries, if any).
