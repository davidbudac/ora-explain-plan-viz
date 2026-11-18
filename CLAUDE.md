# Oracle Execution Plan Visualizer

Client-side React 19 + TypeScript + Vite app that parses Oracle execution plans (DBMS_XPLAN, SQL Monitor text/XML/ACTIVE, V$SQL_PLAN JSON/CSV, xbi.sql) and renders interactive views (tree, tabular, Sankey, flame, compare, …). No backend. User-facing behaviour is documented in `site/docs.html`; how to get each input format out of Oracle is in `docs/input-formats.md`.

## Where things live

- `packages/ora-plan-core/`: types, parsers, `analysis`, `format`, `hints`, `planSignals`, `flameLayout`, the advisor and its rules. No React, no DOM (except `DOMParser` for SQL Monitor XML). **Edit here.** The matching `src/lib/...` files are one-line `export *` shims kept so app imports work. `npm test` builds the package first (`pretest` → `build:core`); modern-tkprof vendors its `dist/`.
- `src/lib/`: app-only logic (url/session/annotations/compare/AI/agent/metadata…); `src/hooks/usePlanContext.tsx`: global state; `src/components/ui/`: shared primitives.
- `src/examples/`: bundled examples, auto-loaded by the `NN-category-Name.txt` filename; blurbs and start-screen `featured` flags in `examples/descriptions.ts`.
- `skills/oracle-plan-analysis/`: companion agent skill, bundled into the app (`lib/agentSkill.ts`).
- `evals/`: AI eval harness (Node + tsx + oracledb, not part of the Vite build; see `evals/README.md`). `livetests/`: SQL*Plus scripts that capture real SQL Monitor reports. `scripts/`: SQL scripts (`plan_to_json.sql`, `plan_to_url.sql`, `gather_plan_metadata.sql`) and the showcase capture.

## Commands

CI (`.github/workflows/ci.yml`) runs `npm run lint`, `npm run typecheck`, `npm test`; run all three before calling work done. A PR touching only root `*.md`, `docs/`, `site/` or `LICENSE` skips them; `skills/**/*.md` always runs the full suite.

```bash
npx vitest run --environment jsdom path/to/file.test.ts   # one file
npx vitest bench --environment jsdom --run src/lib/__tests__/largePlan.bench.ts
npm run build:single   # dist-single/index.html, opens from file://; v* tag → release.yml attaches it
```

## Oracle semantics (do not break)

- **E-Rows is per start, A-Rows is cumulative.** Compare A-Rows only with `estimatedRowsTotal` via `nodeCardinalityRatio(node)`; never `actualRows / rows`. The total is E-Rows × Starts, except: inside a PX slave set and not on a NESTED LOOPS/FILTER probe side → E-Rows; under a partition iterator → the topmost iterator's Starts; a rowid fetch fed by an NLJ-batching / batched-rowid nested loop → the Starts of the index supplying the rowids; Starts = 0 or a COUNT STOPKEY cut-off → undefined. Ratios floor both sides at 1. Verified on 19c (`allstats-*` fixtures).
- **Cost is cumulative**: `totalCost` = root cost; `selfCost` = cost − Σ children. A-Rows never needs × Starts.
- **Inactive adaptive rows** (`-` prefix, XML `skp="1"`; `PlanNode.inactive`) are excluded from totals, hotspots, self numbers and every advisor rule. Use `analysis.effectiveChildren(node)` for self cost/time/buffers. `->` is the SQL Monitor "executing" marker, not inactive.
- **Temp**: `tempSpace` = optimizer estimate; `tempUsed` = actual spill.
- Aliases are normalised without quotes across all parsers (`"P"@"SEL$1"` → `P@SEL$1`). Text parsers normalise CRLF and expand tabs.
- 19c `ADVANCED` prints the Hint Report including used hints; `TYPICAL` shows only unused/error; `+HINT_REPORT` adds used ones to any format. Misspelt hints are reported by name only.

## Data and fixtures

- Parser fixtures in `src/lib/parser/__tests__/fixtures/` are **real Oracle captures**, never hand-written; say which version and call produced a new one. Synthetic trees go through `src/lib/__tests__/fixtures/buildPlan.ts`.
- Bundled examples and fixtures must parse with no `ParsedPlan.warnings` (tested).
- Test helpers: `components/ui/__tests__/testUtils.tsx` (no Testing Library), `planContext.tsx` beside it (`renderPlanContext`, `loadPlan`, `installLayoutShims` for React Flow), `advisor/__tests__/helpers.ts` (`ruleCtx`), `ai/__tests__/anthropicSdkMock.ts`.
- Oracle-facing SQL (scripts, skill `data-requests.md`, fetch SQL) gets run on the 19c test DB (dbmint skill) after edits.

## Invariants

- **Nothing leaves the browser.** Network code lives in four modules only, enforced by `src/lib/__tests__/networkBoundary.test.ts`: `src/lib/agent/client.ts` (local DB connector, build-gated on `VITE_ENABLE_DB_AGENT=1`; Pages build never sets it) and the AI providers `src/lib/ai/providers/{anthropic,openaiCompat,agent}.ts`. The only third-party resources a page loads are Google Fonts stylesheets (`index.html`, `src/index.css`) and, in the GitHub Pages build only, the GoatCounter page-view script (`APP_ANALYTICS=1`). AI sends only on explicit Run, to the chosen provider; API keys live in sessionStorage only (`lib/ai/secrets.ts`), never in localStorage, settings or share URLs. AI-suggested SQL never runs without per-script user approval. The service worker never intercepts non-GET, cross-origin or agent requests and never caches plan data.
- **Old saved state keeps loading**: share URLs (`lib/url.ts`, versioned `workspace` block, read tolerantly), session autosave (`lib/session.ts`), annotation exports (`NodeHighlight.style` optional). The `flame` view mode is a legacy alias redirected to Experimental → Flame.
- All localStorage access is try/catch-guarded and size-capped; oversized sessions are skipped, never truncated.
- `generateId()` (`lib/ids.ts`), not `crypto.randomUUID` (plain-HTTP origins).

## Gotchas

- **Context performance**: the context value is one `useMemo`; the per-keystroke draft lives in `DraftInputContext`. Read live draft text with `useDraftInput()`: `plans[i].draftInput` is stale. `rawInput` is the loaded text, `draftInput` the textarea. `PlanNode` is `memo`'d on `data` and reads no context; the tree applies selection in a separate pass.
- **Node toolbar** mounts only while visible (it subscribes to context) and stops event bubbling so painting never selects or drags a node.
- Bundle attach (`attachBundleText`) resolves its promise only when the pairing chooser settles.
- New UI uses `components/ui` primitives: `Dialog`, `useConfirm` for destructive actions, `toast` for otherwise invisible outcomes, `useMenuKeyboard`, `FOCUS_RING`.
- Walkthrough step = a `data-tour="…"` anchor + an entry in `WALKTHROUGH_STEPS` (`lib/walkthrough.ts`).
- Style: Tailwind with `dark:` for dark mode; `import type` for type-only imports.

## Keep in sync (same change)

- User-facing feature ships or changes → `site/docs.html` (and landing cards if relevant). Pushes to `main` deploy app + `site/` (`/welcome/`).
- Edit `scripts/gather_plan_metadata.sql` → run `node scripts/sync-plan-to-json.mjs` (a test fails otherwise).
- Agent handoff's "Reading the numbers" + inventory fetch SQL (`lib/agentHandoff.ts`) ↔ the skill's copies. In `data-requests.md`, `SET SERVEROUTPUT OFF` must precede the statement or `DISPLAY_CURSOR(NULL, NULL)` shows SQL*Plus's own call.
- DB Connect panel step names ↔ connector README Quick start + `site/docs.html#db-connector`. Connector install is `pipx install git+https://github.com/davidbudac/oraplanviz-db-connector.git` (not on PyPI).
- README diagrams: `docs/diagrams/build_diagrams.py` (light + dark); regenerate both skins.
- Edit classes in `site/*.html` → run `npm run build:site-css` and commit `site/assets/site.css` (a test fails otherwise; the pages load no CDN script).

## Showcase media

`node scripts/capture-showcase.mjs http://localhost:5199/ 9222 site/assets [shot,...]` needs the dev server, headless Chrome (`--remote-debugging-port=9222 --hide-scrollbars`) and ffmpeg, all run unsandboxed. A full run stalls after `annotate`: run the rest separately (e.g. `hero,timeline`). Delete the stray `sankey.gif`. Look at every PNG and a few GIF frames before committing (hover toolbar / selection leftovers).
