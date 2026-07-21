# Local DB-Connect Agent for the Oracle Execution Plan Visualizer

> **Status (2026-07-21, branch `feat/db-connect-agent`):** Phases 1–3 implemented. The Python agent has been extracted to its own adjacent repo `oraplanviz-agent` (`~/claude_projects/oraplanviz-agent`); this repo now keeps only the frontend integration (Connect panel behind `VITE_ENABLE_DB_AGENT`, `src/lib/agent/client.ts`). Remaining (in the agent repo): dbmint e2e, metadata endpoint (Phase 4), docs polish, PyPI publish.

## Context

Users today copy/paste plan text (DBMS_XPLAN, SQL Monitor, JSON, xbi) into the app. The question: add a backend that connects directly to the database so they don't have to.

**Assessment (agreed with user):**
- A *hosted* backend is rejected: it breaks the "your plan never leaves your machine" promise, can't reach firewalled corporate DBs, and creates credential-custody liability.
- The viable design is a **local companion agent**: a small **Python** process (single dependency: `oracledb` in thin mode — no Instant Client) the user runs on their own machine. It connects to their Oracle DB, exposes a localhost HTTP API, and the web app gets an optional "Connect to database" panel that talks to `http://127.0.0.1:<port>`.
- **Scope decision (2026-07-17):** the frontend integration is **build-time gated** behind `VITE_ENABLE_DB_AGENT=1`. It appears only in self-hosted/dev builds; the GitHub Pages build never sets the flag, so nothing renders there. This removes the fragile https-Pages→localhost concern from the critical path (the agent still ships CORS + PNA preflight handling since a self-hosted origin can differ from localhost).
- Credentials and plan data never leave the user's machine; the feature is fully optional and invisible when no agent is running.
- Key enabler found in exploration: ingestion is trivially injectable — `loadAndParsePlan(text, metadataText?)` in `src/hooks/usePlanContext.tsx` (~line 1246) accepts raw plan text in any supported format with auto-detection. The agent just returns raw `DBMS_XPLAN`/SQL Monitor XML text; **no parser changes needed**.
- The app currently has **zero** fetch/HTTP code — the agent client will be its first, kept isolated in one module.

## Architecture

```
Browser (self-hosted / dev build with VITE_ENABLE_DB_AGENT=1)
   │  fetch + Bearer token  (CORS + Chrome PNA preflight)
   ▼
Python agent  ── 127.0.0.1 only, token-gated ──►  Oracle DB (python-oracledb thin)
```

### Agent API (JSON over HTTP)

```
GET  /api/health                          → { version, connected, oracleVersion }
POST /api/connect                         { dsn, user, password } → { ok }   (creds in memory only)
POST /api/disconnect
GET  /api/sql/recent?source=cursor|monitor → [{ sqlId, childNumber, planHashValue, sqlText(trunc),
                                               elapsedSec, execs, lastActive }]
GET  /api/plan?sqlId=&childNumber=&source=cursor|monitor|awr[&sqlExecId=]
                                          → { source, text }   // raw plan text, app auto-detects format
GET  /api/metadata?sqlId=                 → { bundle }          // Phase 4, same JSON contract as
                                                                // scripts/gather_plan_metadata.sql
```

Plan sources map to: `cursor` → `DBMS_XPLAN.DISPLAY_CURSOR(sql_id, child, 'ALLSTATS LAST')` (free);
`monitor` → `DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(type=>'XML')` (Tuning Pack); `awr` → `DBMS_XPLAN.DISPLAY_AWR` (Diagnostics Pack). Default = cursor; pack-licensed sources labeled in UI (mirror the warning already in `scripts/plan_to_url.sql`).

### Security model
- Bind **127.0.0.1 only**, never 0.0.0.0.
- Random **bearer token** generated at startup, printed to stdout; user pastes it into the Connect panel (stored in `sessionStorage`). Blocks drive-by websites from hitting the agent.
- **CORS** allowlist: `https://davidbudac.github.io`, `http://localhost:5173`, `http://127.0.0.1:*` (configurable via `--allow-origin`). `Access-Control-Allow-Headers: authorization, content-type`.
- **Chrome Private Network Access**: answer `OPTIONS` preflights containing `Access-Control-Request-Private-Network: true` with `Access-Control-Allow-Private-Network: true`.
- Mixed content: Chrome/Firefox treat `http://127.0.0.1` as potentially trustworthy, so https Pages → http localhost fetch works; **Safari blocks it** — document this caveat (Safari users run the dev server or self-host over http).
- Credentials held only in agent process memory; never written to disk. Support `--wallet`/external auth later.

## Implementation phases

### Phase 1 — Python agent core (M, ~3 days)
New top-level `agent/` directory:
- `agent/pyproject.toml` — package `oraplanviz-agent`, single runtime dep `oracledb`; console script `oraplanviz-agent`. Runnable via `pipx run` / `uv tool run`.
- `agent/oraplanviz_agent/server.py` — stdlib `http.server.ThreadingHTTPServer` (no web framework), routing, token middleware, CORS/PNA headers.
- `agent/oraplanviz_agent/db.py` — `oracledb` thin-mode connection, the 4 queries (recent SQL, display_cursor, report_sql_monitor, display_awr) with bind variables only (no string interpolation of user input).
- `agent/oraplanviz_agent/cli.py` — args: `--port` (default e.g. 8521), `--allow-origin`, optional `--dsn/--user` (password always prompted, never an arg).
- `agent/README.md`.

### Phase 2 — Security hardening + browser-compat verification (S–M, ~2 days)
- Token + CORS + PNA implementation as above; regenerate token per start.
- Manually verify from the real Pages origin against Chrome, Firefox, Safari; document the matrix in `agent/README.md`.

### Phase 3 — Frontend Connect panel (M, ~3 days)
- `src/lib/agent/client.ts` — typed fetch wrapper (the app's only HTTP module): health probe, connect, recent SQL, fetch plan. Agent URL + token kept in component state / `sessionStorage` (deliberately **not** in `settings.ts` localStorage persistence for the token).
- `src/components/ConnectPanel.tsx` — agent URL/token fields, connect form (dsn/user/password → agent, never stored), recent-SQL table with source toggle, "Load plan" button → `loadAndParsePlan(text)`.
- Integrate into [InputPanel.tsx](src/components/InputPanel.tsx) as a mode/tab next to the paste textarea; feature is inert unless the user opens it (optionally auto-probe `/api/health` to light up a "agent detected" hint).
- Command palette entry in `CommandPalette.tsx` ("Connect to database…").
- Loading two plans for compare works for free (each fetch lands in a plan slot via existing multi-plan flow).

### Phase 4 — Metadata bundle endpoint (M, ~2–3 days, optional/deferrable)
- Port the queries from `scripts/gather_plan_metadata.sql` into `agent/oraplanviz_agent/metadata.py`, emitting the exact `"ora-plan-metadata"` JSON contract (`src/lib/metadata/`). "Load plan + metadata" button passes it as `metadataText` to `loadAndParsePlan`.

### Phase 5 — Tests + docs (M, ~2 days)
- Python: `pytest` unit tests with a mocked `oracledb`; header/CORS/PNA assertions against the running server.
- Frontend: vitest tests for `client.ts` (mock fetch) in `src/lib/__tests__/`.
- **E2E against dbmint** (use the `dbmint-oracle-test` skill; PDB connect string `//poug-dg1.localdomain:1521/pdb1.world`, PLANVIZ schema): run agent, fetch a known sql_id via cursor + monitor, assert the returned text parses via the existing parser; then click-through in the browser preview.
- Root `README.md` + `CLAUDE.md`: new "Connect to a database" section with explicit privacy statement (agent is local, credentials/plans never leave the machine) and licensing notes.
- Publish `oraplanviz-agent` to PyPI (user action / confirm before publishing).

## Effort & difficulty verdict

**Overall: Medium — roughly 10–13 dev-days** (Phases 1–3 + 5 ≈ 10 days for a solid v1; Phase 4 metadata adds ~2–3). No research risk in the DB or app layers; the only fragile spot is https-Pages→localhost browser behavior (PNA/mixed-content), which is why Phase 2 includes an explicit cross-browser verification step.

## Risks / gotchas
- **Licensing**: Monitor = Tuning Pack, AWR = Diagnostics Pack — label in UI, default to free cursor source.
- **Safari** blocks https→`http://localhost` mixed content; documented limitation.
- **PNA is evolving** in Chromium (moving toward Local Network Access permission prompts) — keep the preflight handling and revisit; worst case the user grants a one-time permission prompt.
- **Thin-mode auth limits** (some wallet/Kerberos setups unsupported) — document; verify dbmint auth early in Phase 1.
- **Version skew** between app and agent — `/api/health` returns agent version; Connect panel warns on mismatch.
- **Privilege needs**: agent user needs SELECT on `V$SQL`, `V$SQL_MONITOR` etc. — document a minimal grants snippet.

## Verification
1. Unit: `pytest` in `agent/`, `npx vitest run --environment jsdom` for `client.ts`.
2. E2E: agent → dbmint PDB1, fetch known sql_id (cursor + monitor), assert parse; browser preview click-through: connect → pick recent SQL → plan renders in tree view; repeat from the production Pages origin in Chrome + Firefox.
3. Negative: wrong token → 401; cross-origin from a non-allowlisted origin → CORS-blocked; agent down → panel shows graceful "no agent detected".
