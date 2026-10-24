# @davidbudac/ora-plan-core

Oracle execution plan types, parsers, analysis helpers and the plan advisor of
[ora-explain-plan-viz](https://github.com/davidbudac/ora-explain-plan-viz), as a standalone ESM package with
no React and no DOM dependency. Not published; consumers vendor `package.json` and `dist/`
(modern-tkprof does, see its `web/scripts/sync-core.sh`). This package inherits the repository's licence.

```ts
import { parsePlan, runAdvisor } from '@davidbudac/ora-plan-core';

const plan = parsePlan(JSON.stringify(rows));   // V$SQL_PLAN-style row array, or DBMS_XPLAN / SQL Monitor / CSV / xbi text
const report = runAdvisor(plan, null);          // no metadata bundle: metadata-free rules only
for (const f of report.findings) console.log(f.severity, f.title, f.nodeIds);
```

Exports: `parsePlan`/`parsePlans`/`detectFormat`, `parsePlanRows` (row objects only, tree-shakes the text parsers away), the individual parsers and `buildPlanFromRows`, the plan types
(`ParsedPlan`, `PlanNode`, ...), `analysis` and `format` helpers, `runAdvisor` with `DEFAULT_THRESHOLDS`,
`Finding`/`AdvisorReport`, and the metadata bundle types.

Caveat: SQL Monitor XML / ACTIVE parsing uses a global `DOMParser` (browser or jsdom); in plain Node that one format throws.
Everything else is pure.

## Source layout and build

`src/` mirrors the old `src/lib/` of the app (`types`, `analysis`, `format`, `planSignals`, `flameLayout`, `parser/`,
`advisor/`, `metadata/`); the app's `src/lib/...` files are one-line re-exports. Sibling imports carry explicit `.ts`
extensions so `tsc` can emit Node-compatible ESM.

`npm run build:core` (repo root) compiles to `dist/` (ESM JS + `.d.ts`), which is committed. Test:
`npx vitest run packages`.
