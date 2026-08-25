# AI Plan Analysis & Test-Case Builder — local companion engines, hosted SaaS, guided test cases

> Phases 0–4 (Analyze Plan through the mandatory local companion) are specified in full
> below. Phases 5–8 (hosted SaaS provider, test-case builder, evaluation harness,
> guided chat + agent auto-run) follow at the end of this document.

## Goal and release boundary

The visualizer already has a deterministic advisor made of heuristic rules. The AI feature adds an optional expert report over the currently loaded plan.

Phase 1 is deliberately narrow:

- One-shot, streamed **Analyze Plan** report; it is not a chat.
- The AI feature is available only when the local `oraplanviz-agent` companion is installed, running, paired, and compatible.
- The browser never calls a model provider and never receives provider credentials.
- The companion initially supports one proven engine end to end. The preferred first engine is Codex through the official Codex SDK/App Server; an OpenAI API-key engine or loopback OpenAI-compatible local model is an acceptable fallback if Codex proves unsuitable for Oracle plan analysis.
- Claude Code is the next named engine after its authentication, non-interactive output, and cancellation behavior pass the same contract tests.
- The user reviews the exact outbound context before every run.
- Compare Plans and generic hosted compatibility gateways are deferred.

This is a complete vertical slice: choose the service, review/minimize data, run, stream a sanitized report, validate structured findings, and navigate from a finding to the referenced plan node.

## Architectural decision: the companion is mandatory

The visualizer remains deployable as a static GitHub Pages application, but AI analysis is a local two-process feature:

```text
Browser UI
  -> paired HTTPS/loopback request
Local oraplanviz-agent companion
  -> Codex SDK/App Server, Claude Code SDK, provider API, or local model
Selected inference engine
```

This is the security seam. The browser owns plan selection, context minimization, exact outbound preview, report rendering, and node navigation. The companion owns credentials, installed-agent discovery, process lifecycle, provider protocols, timeouts, and normalized streaming. An engine adapter owns only the differences for one inference route.

No companion means no AI controls beyond an installation/connect explanation. There is no browser-key fallback.

Official OpenAI documentation explicitly supports embedding Codex through the Codex App Server and controlling local Codex agents through server-side SDKs. Codex clients can authenticate either with ChatGPT for subscription access or with an API key for usage-based access. The companion must use those documented interfaces and the Codex-managed login state; it must never read, copy, decrypt, export, or transmit Codex credential files. See [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), and [Codex authentication](https://learn.chatgpt.com/docs/auth).

Anthropic documents Claude Code subscription login and non-interactive/SDK operation. Treat that as a separate adapter with its own feasibility gate rather than assuming it behaves like Codex. Do not automate the Claude desktop GUI or reuse browser cookies.

## Delivery phases

| Phase | Deliverable |
|---|---|
| **0** | Versioned browser/companion contract, local pairing, capability discovery, and deterministic fake engine |
| **1** | Analyze Plan through one real companion engine, preferably Codex SDK/App Server |
| **2** | Add provider-key and loopback OpenAI-compatible engines behind the same companion seam |
| **3** | Add Claude Code after its separate feasibility and security gate |
| **4** | Compare Plans using the same contracts and slot-qualified references |

Hosted compatibility services other than named provider adapters are not part of Phase 1. They can be evaluated later as named, tested profiles rather than being covered by a generic claim.

## Module shape

Add a pure `src/lib/ai/` module, a small `src/hooks/useAiAnalysis.tsx` state module, a mandatory review dialog, and an AI report view.

The AI module exposes one small interface:

```ts
interface AnalysisTransport {
  stream(
    request: AnalysisRequestV1,
    signal: AbortSignal
  ): AsyncGenerator<AnalysisStreamEventV1>;
}
```

Phase 1 has one concrete adapter, `OpenAiStyleTransport`. Official OpenAI and local-compatible are two configurations of this adapter. Do not build a multi-provider dispatcher until another wire protocol is actually implemented.

The adapter owns URL normalization, request-field mapping, SSE parsing, capability checks, and provider error normalization. Callers only know the versioned request, normalized events, cancellation rules, and normalized errors.

## Versioned contracts and identity

All data crossing the context/transport/report seams is versioned and runtime-validated. Keep canonical JSON Schemas in the repository and validate them with Ajv.

```ts
interface PlanRefV1 {
  slotId: string;
  sourceFingerprint: string;
}

interface NodeRefV1 {
  slotId: string;
  nodeId: number;
}

interface AnalysisRequestV1 {
  schemaVersion: 1;
  runId: string;
  promptVersion: string;
  kind: 'analyze';
  planRef: PlanRefV1;
  contextFingerprint: string;
  systemMessage: string;
  userMessage: string;
  maxOutputTokens: number;
}

interface FindingV1 {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  explanation: string;
  suggestion?: string;
  nodeRefs: NodeRefV1[];
}

interface AnalysisOutputV1 {
  schemaVersion: 1;
  runId: string;
  contextFingerprint: string;
  findings: FindingV1[];
}

type AnalysisStreamEventV1 =
  | { schemaVersion: 1; runId: string; sequence: number; type: 'text'; text: string }
  | { schemaVersion: 1; runId: string; sequence: number; type: 'done'; stopReason: 'stop' | 'length' | 'refusal' | 'other'; usage?: TokenUsageV1 }
  | { schemaVersion: 1; runId: string; sequence: number; type: 'error'; error: AnalysisErrorV1 };
```

Rules:

- Use `NodeRefV1` in Phase 1 even though only one plan is submitted. Bare numeric IDs would become ambiguous as soon as comparison is introduced.
- Validate node references against the exact submitted plan snapshot, not the plan active when the response finishes.
- `sourceFingerprint` identifies normalized source plan content. `contextFingerprint` identifies the exact reviewed prompt, included sections, redactions, and prompt version.
- Store `schemaVersion`, `promptVersion`, run/fingerprint values, service profile, model, endpoint origin, timestamps, stop reason, and validation warnings in `AiReport`. Never store credentials.
- Unknown contract versions, mismatched run IDs, or mismatched fingerprints fail closed.
- Malformed structured findings degrade to a narrative-only report. Do not partially trust invalid output.

The Phase 4 compare contract will carry two `PlanRefV1` values and findings will continue to use slot-qualified `NodeRefV1` values. This design work happens now; comparison UI and prompts do not.

## Phase 1 OpenAI-style compatibility profile

OpenAI's Chat Completions interface is the common protocol for Phase 1. The official reference documents `POST /chat/completions` and streamed completion chunks.

### Endpoint boundary

- Official profile uses the fixed OpenAI API root and requires a Bearer API key.
- Local profile accepts a configurable scheme, port, and optional path, but the host must be loopback: `localhost`, `127.0.0.1`, or `[::1]`.
- Phase 1 rejects non-loopback custom hosts with a clear message. LAN servers and hosted gateways require a later explicit profile/security decision.
- Normalize a bare origin to an API root ending in `/v1`; preserve an explicitly supplied `/v1` path. Show the final request destination in the review dialog.

### Required request support

A qualifying local server must support:

- `POST {baseUrl}/chat/completions`
- JSON `model`, `messages`, and `stream: true`
- `system` and `user` text messages
- A configured output-token limit field: `max_tokens` or `max_completion_tokens`
- Optional `Authorization: Bearer <token>`; the client omits the header when no local token is supplied
- Browser CORS from the visualizer origin

Tools, function calling, embeddings, images, the Responses API, and server-side conversation state are not required.

### Required stream support

- HTTP 200 with `Content-Type: text/event-stream`
- UTF-8 SSE chunks that may split at arbitrary byte or line boundaries
- Text deltas in `choices[0].delta.content`
- A terminal `data: [DONE]`, or clean EOF after a chunk containing a non-null `finish_reason`
- OpenAI-style JSON HTTP errors or plain-text HTTP errors

The client reports an unsupported server when a 200 response is not SSE, no valid text delta arrives, the stream is persistently malformed, or no valid terminal condition exists. It names the missing behavior instead of reporting a vague network failure.

### Capability detection

- `GET {baseUrl}/models` is an optional reachability/model-discovery check. A 404 does not disqualify a server if the user enters a model manually.
- There is no assumed universal capability-discovery interface. Observed request behavior is authoritative.
- Cache detected capabilities for the current session by endpoint origin plus model.
- Display separate status for reachability, authentication, model visibility, SSE support, and JSON-schema output support.
- Never silently claim that an untested server is compatible. Documentation lists only exact server/version combinations that passed the profile.

### Structured findings and fallback

The portable request asks for Markdown followed by one final fenced `analysis-output-v1` JSON object. The JSON contains `schemaVersion`, `runId`, `contextFingerprint`, and findings with slot-qualified node references.

- Hide an incomplete JSON fence while streaming.
- Parse the final fence only after completion and validate it against `AnalysisOutputV1`.
- Filter unknown node references and record validation warnings.
- JSON Schema response formatting is an optional enhanced capability, not part of the local minimum profile.
- When the fenced output is invalid and JSON Schema support is known or explicitly enabled, allow one non-streaming repair request containing only the invalid structured block, allowed node references, and schema. Do not resend the full plan automatically.
- If the server rejects JSON Schema before producing output, cache the capability as unsupported and retain the narrative with a “structured findings unavailable” warning.
- A repair response with a different run ID or context fingerprint is discarded.

## Context construction and minimization

### Core renderers

- `renderPlanTable(plan)`: compact DBMS_XPLAN-style table with Id, depth-indented Operation, Name, Starts, E-Rows, A-Rows, A-Time, A-Self, Cost, memory, temp, and reads. Actual-stat columns appear only when present.
- `renderPredicates(plan)` and `renderNotes(plan)`.
- Reuse `computeSelfTimes`, ASH aggregation, parallel/pruning signals, advisor findings, monitor metadata, bind parsing, and metadata lookup helpers.
- `projectMetadata(bundle, plan)`: referenced objects only, no DDL, predicate columns only, deterministic size cap, explicit truncation marker.

### Review sections

Each `ContextSectionV1` has a stable ID, label, text, character count, inclusion state, and sensitivity category.

- Always included and visibly labelled: compact plan table.
- Default on: derived plan signals and heuristic advisor summary when available.
- Default off and explicit opt-in: SQL text, predicates, bind values, annotations, Oracle notes, monitor/optimizer metadata, ASH detail, and projected object/column metadata.
- Bind names and types without values may be a separate lower-sensitivity section.
- Offer deterministic literal/bind redaction before preview.
- New sensitive section types introduced by future versions default to off, even when merging older saved preferences.

The mandatory review dialog shows the service profile, exact endpoint origin, model, every available section, sensitivity and character counts, rough `ceil(chars / 4)` token estimate, and the exact final `userMessage`. The outbound message must be constructed from the same immutable object shown in the preview.

## Secrets and privacy boundary

- Official API key is required; a local Bearer token is optional.
- Keep secrets only in React memory in Phase 1. Do not add a long-term “remember” option.
- Never place a key/token in settings, local/session storage, share URLs, reports, clipboard exports, errors, diagnostics, or logs.
- Clear secrets on profile change and provide an explicit Clear action.
- Name the actual destination before Run. A loopback URL means the browser sends to that local process; it does not prove the process will not log or forward the prompt.
- Model output and all prompt-derived content are untrusted. Render through `marked`, then `DOMPurify.sanitize`, before `dangerouslySetInnerHTML`.
- The application makes no GDPR or other compliance claim. German/EU organizational users must evaluate their chosen provider/server's retention, processing location, contractual terms, and internal approval before including personal or confidential data.

## Streaming lifecycle

`useAiAnalysis.tsx` owns one active run:

- State: `idle | reviewing | streaming | done | error | cancelled`.
- Generate a unique `runId` for every Run and Regenerate action.
- Snapshot the reviewed `AnalysisRequestV1`; retry and regeneration never rebuild silently from changed UI state.
- Only events matching the active run ID may mutate state. Ignore late deltas, timers, completion handlers, and repair results from stale runs.
- Starting a new run aborts the old controller before installing the new run.
- Cancellation aborts fetch, calls `reader.cancel()` when available, releases the reader lock, flushes the buffered text once, and retains the partial report as cancelled.
- Use separate connection and stream-idle timeouts. Timeout is not reported as user cancellation.
- Flush text to React on a short interval (about 100 ms) and synchronously flush the final buffer on every terminal path.
- Replacing/reparsing the source plan cancels the run, invalidates the report by fingerprint, and disables stale node links.

### Retry boundary

- Never automatically retry authentication, invalid-model, bad-request, CORS, protocol, refusal, or schema-version failures.
- Surface `Retry-After` for rate limits/overload and require the user to initiate the retry.
- The only automatic retry is a capability downgrade attempted before any replacement output has been displayed.
- After the first visible text delta, Retry creates a new report from the immutable reviewed snapshot; it never appends to partial output.

`AnalysisErrorV1` includes kind, safe message, HTTP status, retryable flag, optional `retryAfterMs`, provider error code, request ID, and endpoint origin. Error kinds include `auth`, `rate-limit`, `overloaded`, `network`, `cors`, `timeout`, `refusal`, `bad-request`, `invalid-model`, `protocol`, `aborted`, and `unknown`.

## Files

### New `src/lib/ai/`

- `contracts.ts` — versioned types, JSON Schemas, Ajv validators, errors, service profiles, and normalized events.
- `fingerprint.ts` — deterministic source/context SHA-256 helpers.
- `planText.ts` — compact plan, predicate, and note renderers.
- `context.ts` — privacy-classified section building, redaction, assembly, and token estimate.
- `metadataProjection.ts` — minimal referenced-object/column projection.
- `prompts.ts` — versioned Analyze Plan system/task prompt.
- `findings.ts` — streamed fence handling, output validation, and node-reference validation.
- `openAiStyleTransport.ts` — official/local configuration, models probe, raw fetch, SSE parser, capability cache, error normalization, cancellation, and optional structured repair.
- `secrets.ts` — in-memory secret holder and explicit clearing.

### New UI/state

- `src/hooks/useAiAnalysis.tsx`
- `src/components/AiAnalysisDialog.tsx`
- `src/components/views/AiReportView.tsx`

### Modified

- `settings.ts` — non-secret profile, local base URL, model, token-limit mapping, and section preferences; increment/migrate the settings version.
- `types.ts` — add `'ai'` to `ViewMode`.
- `VisualizationTabs.tsx` / `NavRibbon.tsx` — AI view and Analyze Plan action only.
- `CommandPalette.tsx` — `ai-analyze-plan` and `ai-open-report`; no compare command.
- `App.tsx` — mount AI state and dialog.
- README/CLAUDE.md — scope, security warning, privacy flow, compatibility profile, and troubleshooting.

## Dependencies

| Package | Purpose |
|---|---|
| `ajv` | Runtime validation of the versioned JSON contracts |
| `marked` | Markdown-to-HTML conversion |
| `dompurify` | Sanitization of untrusted generated HTML |

Use raw fetch rather than a provider SDK so the deliberately small OpenAI-style subset is explicit and testable. No SSE dependency is needed.

## Tests and diagnostics

### Pure/contract tests

- Exact optimizer-only and actual-stat plan tables.
- Deterministic sections, conservative defaults, redaction, projection caps, toggles, token estimate, and fingerprints.
- Valid/wrong-version/malformed/mismatched-run/mismatched-fingerprint outputs.
- Unknown node references and duplicate numeric node IDs in different slots.
- Partial/valid/invalid JSON fences and narrative-only degradation.
- Hostile Markdown/HTML and prompt-derived injection content after sanitization.

### Transport tests

- URL normalization and loopback-host enforcement.
- Official required Bearer header; optional local Bearer header; no secret in safe errors.
- `ReadableStream` fixtures split at arbitrary bytes/lines.
- Text deltas, `[DONE]`, finish-reason EOF, length/refusal, usage when present, malformed SSE, non-SSE 200, JSON/plain-text HTTP errors, CORS, timeouts, abort, and reader cleanup.
- Optional `/models` behavior and capability-cache isolation.
- Both output-token field mappings.
- JSON-schema repair success, unsupported downgrade, and proof that a repair does not resend full plan context.

### State/UI/privacy tests

- Full fake-transport Analyze Plan flow before any real endpoint work.
- Sensitive sections off by default and requiring explicit opt-in.
- Preview message byte-for-byte equal to the outbound `userMessage`.
- Run-ID races: cancel/restart, stale stream finishing late, final-buffer flush, source reparse mid-stream.
- Key/token absent from settings, browser storage, share URLs, report, clipboard, diagnostics, and logs.
- Actionable unsupported-state messages for missing CORS, model, SSE, terminal marker, or structured findings.

### Privacy-preserving diagnostics

Keep only a bounded in-memory run record: run ID, contract/prompt versions, service profile, model, endpoint origin, input/output character counts, request/first-token/end times, stop reason, retry count, HTTP/error kind, and provider request ID when available. Never record prompts, reports, SQL, binds, metadata, credentials, Authorization headers, or credential-bearing URLs. Phase 1 sends no telemetry.

## Revised implementation order

1. **Feasibility gate:** test official OpenAI CORS/streaming with a disposable restricted key and record the browser-key security decision. Build a deterministic loopback fixture server for the compatibility profile.
2. **Freeze contracts:** add JSON Schemas/validators, `PlanRefV1`, slot-qualified `NodeRefV1`, fingerprints, normalized events/errors, profile rules, and fixtures.
3. **Build pure context:** plan rendering, privacy-labelled sections, opt-in defaults, redaction, metadata projection, prompt v1, exact preview object, and findings validation.
4. **Complete the vertical slice with a fake transport:** review dialog → immutable request → race-safe stream lifecycle → sanitized report → validated node navigation.
5. **Implement the OpenAI-style adapter:** pass protocol tests and one named local-server smoke test. Enable official OpenAI only if step 1 passed.
6. **Harden Phase 1:** structured repair/fallback, error/capability UX, storage-leak tests, privacy copy, diagnostics, lint, builds, full tests, and manual smoke.
7. **Defer expansion:** add comparison only after the single-plan evidence is solid; add Anthropic and the companion proxy as separate later adapters.

This order proves one usable result end to end before multiplying modes and protocols.

## Verification

- `npx vitest run --environment jsdom`
- `npm run lint`
- `npm run build`
- `npm run build:pages`
- Confirm production exposes Analyze Plan only: no Compare Plan, Anthropic, hosted generic-compatible, or agent-proxy controls.
- Confirm sensitive content remains off after fresh load and settings migration.
- Confirm cancellation/race behavior, sanitized rendering, node navigation, capability messages, and credential non-persistence.
- Record the exact local server/version used for compatibility smoke testing; make no claims about untested servers.

---

# Later phases: hosted SaaS + AI-guided test cases

Direction: offer the AI features as a **hosted SaaS** (an oraplanviz cloud backend holds
the Anthropic key; users authenticate with an account token), and beyond analysis have
the AI help non-experts **build a reproducible test case** for a problem plan (starting
from just plan + SQL ID) and **test whether an alternative plan is an improvement** —
via an interactive guided chat, with automated execution through the local
`oraplanviz-agent` against a designated *test* database.

The versioned contracts above (`AnalysisRequestV1`, `AnalysisStreamEventV1`,
`AnalysisErrorV1`) and the `AnalysisTransport` seam are what all later phases build
on; Phase 5 adds a hosted transport beside the companion.

## Phase 5 — Hosted provider (SaaS)

Phase 5 is the one deliberate exception to the companion-mandatory rule: for hosted
users the cloud backend replaces the local companion as the credential/security seam
(browser → oraplanviz cloud directly). The mandatory review dialog, versioned
contracts, and fail-closed validation apply unchanged; self-hosted users keep the
companion engines.

- **`src/lib/ai/hostedTransport.ts`** — a second `AnalysisTransport` implementation
  streaming the same normalized `AnalysisStreamEventV1` events
  (`delta {"text"}` · `done {"stopReason"}` · `error {"message","status"}` on the
  wire). Config `{ baseUrl, accountToken }`; the account token lives in the
  `secrets.ts` in-memory holder — whether a lower-sensitivity remember option is
  acceptable for account tokens (unlike provider keys) is decided in this phase.
- **Backend HTTP contract** (service in a new repo, e.g. `oraplanviz-cloud`; only the
  contract lives here):
  ```
  POST /v1/analyze     Authorization: Bearer <account token>
  Body: { system, prompt, model|null, maxTokens|null, kind: 'analyze'|'compare'|'testcase'|'chat' }
  → 200 text/event-stream (delta/done/error)   → 401/402/429/500 JSON {"error","code"}
  GET  /v1/me          → { plan: 'free'|'pro', usage: { tokensThisMonth, limit } }
  ```
- **Backend responsibilities**: holds the Anthropic key server-side; per-token auth;
  usage metering + monthly caps; rate limiting; streaming pass-through; **no retention
  of plan payloads** (log metadata only: token counts, timings). Model pinned
  server-side (`claude-opus-5` default; per-tier overrides). Billing/signup out of
  scope for v1 — start with manually issued tokens.
- **UI**: hosted becomes the first service choice in `AiAnalysisDialog`; the
  companion engines (Codex, provider API key, loopback OpenAI-compatible, Claude
  Code) remain for self-hosters. No new dependencies (raw fetch + existing SSE
  parsing).

## Phase 6 — Test Case Builder (scripts; user runs them)

Goal: from plan + metadata bundle (or plan + SQL ID → gather script first), produce a
runnable synthetic repro so the optimizer reproduces the plan in a scratch schema —
no production data required — plus scripts to try alternative plans.

- **Bundle v3** (`src/lib/metadata/bundle.ts`, `SUPPORTED_BUNDLE_VERSIONS = [1,2,3]`):
  add per-column `histogram.endpoints: [{ value, endpoint_number, repeat_count }]`
  gathered from `DBA_TAB_HISTOGRAMS` (capped at 254 buckets). v2 stores only histogram
  type + bucket count, which cannot replicate skew-dependent plans. Extend
  `scripts/gather_plan_metadata.sql` inside the existing `@@GEN:...@@` marker scheme;
  `gatherScript.ts` stamping unchanged.
- **`src/lib/ai/testCase.ts`** — deterministic skeleton generator modeled on
  `buildBaselineScript()` (`src/lib/baselineScript.ts`):
  `buildTestCaseScript({ plan, bundle, targetSchema }): string`, emitting in order:
  1. banner + safety note (scratch schema only);
  2. `CREATE TABLE` / `CREATE INDEX` from bundle `ddl` (already storage-stripped) +
     v2 `constraints`;
  3. `DBMS_STATS.SET_TABLE_STATS` / `SET_INDEX_STATS` / `SET_COLUMN_STATS` from bundle
     stats, incl. `PREPARE_COLUMN_VALUES` built from v3 histogram endpoints and
     low/high raw values via the `srec` interface;
  4. `ALTER SESSION` for non-default `optimizer_env` parameters;
  5. the SQL with `VARIABLE`/bind stubs;
  6. verification: `EXPLAIN PLAN` + `DBMS_XPLAN.DISPLAY` with the original plan hash
     noted for comparison.
- **AI's role on top of the skeleton** — judgment gaps only: bind values consistent
  with predicates and low/high values; an optional row-data generator
  (`INSERT … CONNECT BY` with skew matching histograms) when stats-only repro fails;
  a narrative explaining each step. New prompt kind `'testcase'` in `prompts.ts`;
  context = the analyze section builders + full (unprojected) metadata for referenced
  objects.
- **`src/lib/ai/experiments.ts`** — alternative-plan experiments. Candidates sourced
  from `AdvisorReport.findings[].suggestion` + AI reasoning. Per candidate emit one of:
  hint-variant SQL; a `DBMS_SQLDIAG.CREATE_SQL_PATCH` script via a new
  `buildSqlPatchScript()` cloned from the `baselineScript.ts` structure (pre-checks →
  create block → verification → drop crib sheet); or session-parameter script. The
  winner is locked in with the existing `buildBaselineScript()`. Each experiment ends
  with: load the resulting DBMS_XPLAN back into the app and use the Compare view.
- **UI**: "Build test case" action in the AI dialog + command palette; scripts rendered
  in the AI report view with per-script copy/download (reuse `clipboard.ts`; filename
  helper in the style of `baselineScriptFilename`).
- **Tests**: `testCase.test.ts`, `experiments.test.ts` — fixture bundle → exact script
  text, same style as `baselineScript.test.ts`.

## Phase 7 — Evaluation & backtesting harness

The product's core claims are objectively checkable against a real Oracle instance:
"the synthetic test case reproduces the plan" (plan shape match), "the analysis found
the real problem" (known injected fault), and "the proposed alternative is faster"
(measured runtime). This phase builds a harness that turns those into tracked metrics,
run before every prompt/model/generator change. Four layers, cheapest first.

### Layer 1 — deterministic unit tests (free, already planned)

The vitest suites above (`planText`, `context`, `findings`, transports, `testCase`,
`experiments`): fixture in → exact text out. No DB, no LLM, run on every commit.

### Layer 2 — repro-fidelity backtest (no LLM needed for the skeleton path)

**Question**: given a bundle gathered from a real schema, does the generated test-case
script make the optimizer produce the same plan in a scratch schema?

**Implementation** — new top-level `evals/` directory (excluded from the Vite build;
plain Node + TypeScript via `tsx`, DB access via `node-oracledb` thin mode — no
Instant Client needed):

- **Database**: `gvenzl/oracle-free:23` in Docker (`evals/docker-compose.yml`); works
  locally and as a GitHub Actions service container. Each scenario gets its own
  schema (`EVAL_S01` …), dropped and recreated per run — no cross-contamination.
- **Scenario corpus** — `evals/scenarios/NN-name/` with three files:
  - `setup.sql` — schema + data + the deliberate condition (e.g. skewed column with a
    FREQUENCY histogram, stale stats, missing index, partition layout);
  - `query.sql` — the statement (with binds where relevant);
  - `expect.json` — `{ tags: ["skew","histogram"], rootCause: "...", planFeatures:
    ["TABLE ACCESS FULL EMP", "HASH JOIN"] }` (ground truth for layers 3–4).
  Seed corpus (~15 scenarios): NL↔hash-join tipping point, frequency/hybrid histogram
  skew, stale stats, implicit conversion disabling an index, cartesian merge join,
  partition pruning present/absent, bind peeking, unindexed FK, temp spill,
  selective full scan. Grow it over time with anonymized real-world cases.
- **Runner** — `evals/run.ts`, per scenario:
  1. provision schema, run `setup.sql`, execute `query.sql`;
  2. capture the original plan (`DBMS_XPLAN.DISPLAY_CURSOR ... ALLSTATS LAST`) and
     gather a bundle by executing `scripts/gather_plan_metadata.sql` in the container
     (`docker exec ... sqlplus`) — this regression-tests the gather script and bundle
     v3 for free;
  3. run the pipeline under test: skeleton-only (`buildTestCaseScript`, deterministic)
     or skeleton+AI (bind values / data generator filled by the model);
  4. execute the generated script in a fresh scratch schema, `EXPLAIN PLAN`, parse
     both plans with the app's own parser;
  5. compare **plan shape**, not plan hash (hash differs across environments):
     normalize each line to `(operation, options, objectName)` and reuse
     `matchNodes` from `src/lib/compare.ts`; a scenario passes when all original
     nodes match in order.
- **Metrics** — `evals/results/<timestamp>.json` + a markdown summary: overall
  **repro rate**, broken down by tag (histograms, partitioning, binds…), plus
  gather-script coverage warnings. CI job (nightly + on-demand label, not per-PR —
  the DB container is ~2 min startup) fails if repro rate drops below the last
  recorded baseline.

### Layer 3 — analysis-quality evals (LLM-judged over known faults)

**Question**: does the analysis report identify the injected root cause?

- Reuses the same scenarios: each `expect.json` names the fault the report must find.
- `evals/analyze.ts` builds the context exactly as the app does (the `context.ts`
  section builders) from the captured plan + bundle, calls the transport layer
  directly (API key from env), and scores each report twice:
  - **Hard checks, no judge** (in `evals/scoring.ts`): findings JSON validates
    against `AnalysisOutputV1`; every `nodeRefs` entry exists in the plan; every object name
    mentioned in findings exists in the bundle (hallucination check); the report
    references the plan lines from `expect.json.planFeatures`.
  - **LLM judge**: rubric prompt ("Did the report identify <rootCause>? Did it point
    at the correct plan line(s)? Score 0–2 with quote as evidence"), run with a fixed
    cheap model (`claude-haiku-4-5`), temperature-stable, 3 samples majority vote.
- **Baseline floor**: run `runAdvisor` on the same input; the report's recall over the
  advisor's own findings must be ≥ 90% — the AI must never miss what the free
  heuristics already catch.
- Output: per-scenario score matrix by prompt version + model, appended to
  `evals/results/`; a prompt change ships only if mean score is non-decreasing.

### Layer 4 — experiment payoff backtest (measured, no judge)

**Question**: do the proposed alternative-plan experiments actually help?

- `evals/experiments.ts`: for each scenario, take the AI's proposed experiments
  (hints / SQL Patch / parameter scripts), execute each variant in the scenario
  schema, and measure elapsed time and buffer gets (from
  `V$SQL_PLAN_STATISTICS_ALL` after execution) vs. the original.
- Metrics per proposal: *plan changed?* (shape diff), *improved?* (≥20% fewer buffer
  gets), *regressed?*. Headline numbers: improvement rate and regression rate —
  the two numbers that decide whether the guidance is worth paying for.

### Production feedback loop (SaaS)

- Backend addition: `POST /v1/feedback { runId, verdict: 'up'|'down', kind }` and a
  per-run event log (kind, model, prompt version, token counts, latency — never plan
  payloads). Thumbs up/down buttons in `AiReportView`.
- The Phase-8 agent loop generates its own labels: every iteration records
  `reproMatched: boolean` and, for experiments, the measured before/after plan pair —
  a live repro-rate / improvement-rate dashboard segmented by model + prompt version,
  the online counterpart of layers 2 and 4.
- Prompt versions are tagged (the `promptVersion` value in `prompts.ts`, sent to the
  backend) so offline eval results and online feedback join on the same key.

## Phase 8 — Guided chat + agent auto-run

- **Chat mode**: `useAiAnalysis.tsx` grows `messages: AiChatMessage[]` alongside the
  one-shot report; the hosted backend's `kind: 'chat'` runs a server-side tool-use
  loop. Tools exposed to the model:
  - `get_plan_context(sections)` — resolved client-side from the analysis context
    builders (`context.ts`);
  - `run_script(sql, purpose)` / `explain(sql)` — available only when the local agent
    is connected; **every call renders an approval card in the UI** (AI proposes →
    user clicks Run → agent executes → result returned to the model).
- **Agent extension** (contract only; implementation in `../oraplanviz-agent`):
  ```
  POST /api/test/connect     { dsn, user, password }      # separate TEST connection
  POST /api/test/exec        { script }  → { ok, output, errors[] }
  POST /api/test/explain     { sql }     → { dbmsXplanText }
  POST /api/test/disconnect
  ```
  Invariants: the test connection is distinct from the read-only source connection;
  the source connection never executes AI/user SQL; every exec requires explicit
  per-call user approval; the agent keeps a statement log; bump `MIN_AGENT_VERSION`.
- **Iteration loop**: AI generates repro → user approves, agent runs → resulting plan
  is parsed back → AI compares plan hash/shape against the target → adjusts stats,
  binds, or hints → repeat until reproduced; then run experiments and compare A/B in
  the app's compare view.

## Sequencing (phases)

1. **Phases 0–4** — companion-based analysis: contract + pairing, first engine
   (Codex), provider-key/loopback engines, Claude Code, Compare Plans (this document
   above).
2. **Phase 5** — hosted provider + `oraplanviz-cloud` contract.
3. **Phase 6** — bundle v3 histograms; test-case + experiment script generators.
4. **Phase 7** — `evals/` harness: Docker Oracle, scenario corpus, repro-rate
   runner first (validates Phase 6 deterministically), then analysis evals and
   experiment payoff. Built alongside Phase 6, gating from then on.
5. **Phase 8** — chat mode; agent test-execution endpoints; approval-gated auto-run;
   feedback loop wired into the hosted backend.

## Privacy (later phases)

- Hosted provider: plan data leaves the browser to oraplanviz cloud **only when Run is
  clicked**; the backend streams to Anthropic and retains no plan payloads.
- Agent execution: SQL and results stay on localhost between browser and agent; only
  the AI conversation (including tool results the user approved) reaches the model.
