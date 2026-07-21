# Frontend: agent metadata integration + Connect polish

> Status (2026-07-21): DONE — all five tasks implemented and verified with a
> live click-through against dbmint (connect → manual sqlId load → plan tree
> with actual stats → Metadata view showing the auto-attached bundle:
> 2 tables, 1 index, system params, optimizer env, SQL plan directives).
> One parser fix fell out of verification: `extractSqlId` in
> `sqlMonitorParser.ts` now also matches the `SQL_ID  xxx, child number N`
> DISPLAY_CURSOR header — without it, plans loaded via the agent had no
> `sqlId` and bundle auto-pairing silently degraded to needs-choice.
>
> Backend prerequisite is done — the
> `oraplanviz-agent` repo now serves `GET /api/metadata?sqlId=[&planHash=]`
> → `{ bundle }` (an `ora-plan-metadata` v2 bundle, e2e-verified against
> dbmint and against this repo's `parseBundle`). This plan covers the
> remaining frontend work from docs/plans/db-connect-agent.md (which lives
> on in the agent repo).

## Context

- `src/lib/agent/client.ts` is the app's only HTTP module; it has
  `health/connect/disconnect/recentSql/fetchPlan` but no metadata call.
- `ConnectPanel.tsx` loads plans via `loadAndParsePlan(result.text)` in two
  places: `handleLoadRow` (recent-SQL table) and `handleManualLoad`.
- `loadAndParsePlan(input, metadataText?)` already accepts a bundle as a
  JSON *string* and attaches it via `parseBundle` (`usePlanContext.tsx`
  ~line 864). No context changes needed — stringify the fetched bundle.
- The whole feature stays gated behind `isDbAgentEnabled()`
  (`VITE_ENABLE_DB_AGENT`).

## Tasks

### 1. Client: `fetchMetadata` (S)

In `src/lib/agent/client.ts`:

```ts
export interface FetchMetadataParams { sqlId: string; planHash?: number }
export interface FetchMetadataResult { bundle: unknown }
export async function fetchMetadata(config, params): Promise<FetchMetadataResult>
```

- `GET /api/metadata`, query `{ sqlId, planHash }`, bearer token.
- Own timeout constant `METADATA_TIMEOUT_MS = 60_000` — the gather runs
  DBMS_METADATA DDL extraction per object and is the slowest agent call.
- Mirror on the `AgentClient` class.
- Vitest (mock fetch) in `src/lib/__tests__/agentClient.test.ts`: happy
  path, planHash omitted, 4xx error mapping to `AgentError`.

### 2. ConnectPanel: attach metadata on load (M)

- Panel-level toggle **"Attach DB metadata"** (checkbox, default ON, state
  local to the panel next to the source toggle).
- `handleLoadRow` / `handleManualLoad`: after `fetchPlan` succeeds and the
  toggle is on, call `fetchMetadata({ sqlId, planHash: item.planHashValue })`
  and pass `loadAndParsePlan(text, JSON.stringify(result.bundle))`.
- **Metadata failure must not block the plan**: on `AgentError`, still call
  `loadAndParsePlan(text)` and show a small non-blocking notice
  ("Plan loaded; metadata unavailable: <msg>"). Reuse the existing
  `recentError`/`manualError` slots only for plan failures — add a separate
  dismissible `metadataNotice` state so a degraded load doesn't look like
  a failure.
- Component test: mock the client module; assert both-call flow, the
  stringified bundle reaches `loadAndParsePlan`, and the degraded path.

### 3. Command palette: "Connect to database…" (S)

- `CommandPalette.tsx` builds its `commands: Command[]` list; add an entry
  gated on `isDbAgentEnabled()`.
- Action: reveal the input panel's Connect panel. `showConnectPanel` is
  currently local state in `InputPanel.tsx` — lift it to the same
  parent/context the palette already uses for its other UI commands
  (follow the pattern of the nearest existing command that toggles a
  panel; do not invent a new event bus).

### 4. Version-skew warning (S, optional)

- `health()` already returns the agent `version`. Define
  `MIN_AGENT_VERSION` in `client.ts`; ConnectPanel shows an inline hint
  when the probed version is older (e.g. missing `/api/metadata` → the
  metadata toggle also gets disabled with a tooltip).
- Keep the comparison dumb (semver triple compare, no dependency).

### 5. Docs (S)

- `README.md` + `CLAUDE.md`: "Connect to a database" section — what the
  agent is, install (`pipx install oraplanviz-agent` once published), the
  privacy statement (credentials/plans never leave the machine), pack
  licensing labels (cursor free / monitor Tuning / awr Diagnostics), and
  the `VITE_ENABLE_DB_AGENT=1` build flag.

## Verification

1. `npx vitest run --environment jsdom` — new client + panel tests, full
   suite green.
2. Live click-through against dbmint (agent via
   `ssh -p 2201 -f -N -L 15210:192.168.56.121:1521 oracle@dbmint`, DSN
   `//127.0.0.1:15210/pdb1.world`, planviz/planviz): connect → pick recent
   SQL → plan renders **with metadata badges** (table/index stats visible
   on nodes); toggle off → plan loads without bundle; kill agent →
   graceful "not reachable".

## Effort

S–M overall: ~1–2 days including the live click-through.
