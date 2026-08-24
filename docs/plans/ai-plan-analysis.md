# AI Plan Analysis — connect an LLM for plan analysis & comparison

## Context

The visualizer's advisor is a fixed set of 11 heuristic rules. The user wants an optional "connect an agent" feature: send the loaded plan (or two plans) to an LLM and get an expert analysis back. The app is fully client-side (GitHub Pages), so no backend can hold credentials.

**Confirmed requirements:**
- **Auth — all three**: (1) BYO Anthropic API key, browser → api.anthropic.com directly (SDK `dangerouslyAllowBrowser: true`; the API supports CORS via the `anthropic-dangerous-direct-browser-access` header); (2) OpenAI-compatible endpoint (custom base URL + key + model — Ollama/OpenRouter/gateways); (3) proxy via the local `oraplanviz-agent` companion which holds credentials — the only path that can use a Claude subscription (`ant auth login` profile agent-side). A claude.ai subscription cannot be used directly from a third-party web app.
- **UX**: one-shot streamed analysis report (not a chat). "Analyze plan" + "Compare plans" (when 2 plans loaded).
- **Data scope**: everything by default, but with a **review step** — a pre-send dialog previewing exactly what will be sent, per-section toggles, ~token estimate (chars/4).
- **Gating**: BYO-key + OpenAI-compat in the public GitHub Pages build; the local-agent proxy option only shown when `isDbAgentEnabled()`.

## Architecture

New pure library `src/lib/ai/` + a small dedicated React context `src/hooks/useAiAnalysis.tsx` (keeps the 1682-line `usePlanContext.tsx` from growing a streaming state machine) + a review dialog modeled on `BaselineScriptModal` + a new `'ai'` view tab as result surface.

Uniform provider abstraction — async generator of stream events, cancellable via `AbortSignal`:

```ts
type AiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; stopReason: 'end_turn'|'max_tokens'|'refusal'|'other'; refusalExplanation?: string };
interface AiRequest { system: string; user: string; model: string; maxTokens: number }
// each provider: stream(req, signal): AsyncGenerator<AiStreamEvent>
class AiError extends Error { kind: 'auth'|'rate-limit'|'overloaded'|'network'|'refusal'|'bad-request'|'aborted'|'unknown'; status: number | null }
```

## New files — `src/lib/ai/`

- **`types.ts`** — `AiProviderId = 'anthropic'|'openai-compat'|'agent'`; `AiSectionId = 'sql'|'predicates'|'notes'|'binds'|'monitorMeta'|'ash'|'signals'|'advisor'|'metadata'` (plan table always included); `ContextSection {id,label,text,charCount,included}`; `BuiltContext {sections,userMessage,tokenEstimate}`; `AiFinding {severity,title,explanation,suggestion?,nodeIds}` (mirrors advisor `Finding`); `AiReport {kind:'analyze'|'compare', markdown, findings|null, provider, model, createdAt, slotIds, truncated}`; `AiError`.
- **`planText.ts`** — `renderPlanTable(plan)`: regenerate a DBMS_XPLAN-style fixed-width table (models know this format cold): Id | Operation (depth-indented) | Name | Starts | E-Rows | A-Rows | A-Time | A-Self | Cost | Mem | Temp | Reads — actuals columns only when `hasActualStats` (run `computeSelfTimes` from `analysis.ts` first). Plus `renderPredicates(plan)` (per-id access/filter listing) and `renderNotes(plan)`.
- **`context.ts`** — review-step engine: `buildAnalyzeSections(slot, advisorReport)`, `buildCompareSections(a, b)`, `assembleContext(sections)` (filters `.included`, joins with `=== HEADER ===` delimiters), `estimateTokens(text) = ceil(len/4)`. Section builders reuse `aggregateActivityByLine` (`ash.ts`), `computeParallelSignals`/`getDopDowngrade`/`assessPartitionPruning` (`planSignals.ts`), advisor findings rendered as `[warning] title (lines 3,7): explanation` labeled "heuristic pre-analysis — verify, don't parrot", `monitorMetadata` key fields + non-default `optimizerEnv`, bind variables.
- **`metadataProjection.ts`** — `projectMetadata(bundle, plan)`: only objects referenced by the plan (`findObjectInBundle`, plus indexes of referenced tables); drop `ddl`; column stats only for predicate columns (`metadata/predicateColumns.ts`); cap ~20k chars with a truncation notice.
- **`prompts.ts`** — `buildSystemPrompt(kind)`, task lines, `MODEL_PRESETS` (default `claude-opus-5`; also `claude-sonnet-4-6`, `claude-haiku-4-5`; free-text override; OpenAI-compat is free-text only). System prompt: expert Oracle performance engineer; markdown report with `## Summary`, `## Where the time goes`, `## Cardinality & statistics issues`, `## Recommendations`; refer to operations by plan Id ("line 7"); base claims only on provided data; end with exactly one fenced ```json block: `{"findings":[{severity,title,explanation,suggestion,nodeIds}]}` as the last thing in the response.
  - Compare variant: both plans' compact tables + digest from `matchNodes` → `buildComparisonRows` (one line per matched node: `A#3 -> B#5 HASH JOIN: cost 1200->300, aTime 40s->3s`), unmatched-node lists, `computeComparisonSummary` totals; digest replaces per-plan predicates/metadata/ASH by default (toggles re-add).
- **`findings.ts`** — `splitReport(markdown)` (fence-aware on partial stream buffers, hides half-received JSON block) + `parseAiFindings(markdown, validNodeIds)`: last json fence, lenient parse, severity clamped to `FindingSeverity`, nodeIds filtered to valid ids; any failure → `null` (narrative-only degrade).
- **`providers/anthropic.ts`** — `@anthropic-ai/sdk`: `new Anthropic({apiKey, dangerouslyAllowBrowser: true})`; `client.beta.messages.stream({model, max_tokens: 32000, system, messages, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'}, {signal})`. **No `thinking` param** (claude-opus-5 runs adaptive by default). Yield text deltas; `finalMessage()` → map stop_reason (refusal → `stop_details.explanation`). Map SDK typed errors (`AuthenticationError`→auth, `RateLimitError`→rate-limit, 529→overloaded, `APIConnectionError`→network) to `AiError`. (Refusal fallback param is trivially removable if unwanted.)
- **`providers/openaiCompat.ts`** — raw fetch to `{baseUrl}/chat/completions` (append `/v1` when URL has no path — covers bare Ollama), `stream: true`, `Authorization: Bearer` only when key non-empty. Hand-rolled ~40-line SSE parser exported as `parseSseStream(reader)` for testability; `[DONE]` terminator; `finish_reason: 'length'` → max_tokens.
- **`providers/agent.ts`** — companion proxy, gated by `isDbAgentEnabled()`, reuses `AgentConfig`/token conventions and the same SSE parser. **HTTP contract** (companion repo implementation out of scope, contract documented in `docs/plans/`):
  ```
  POST {baseUrl}/api/ai/analyze   Authorization: Bearer <token>
  Body: { system, prompt, model|null, maxTokens|null }
  → 200 text/event-stream: event delta {"text"} · event done {"stopReason","explanation"?} · event error {"message","status"?}
  → 401/500 JSON {"error"} before streaming
  ```
- **`provider.ts`** — `streamAnalysis(runConfig, req, signal)` dispatch; `AiRunConfig {provider, apiKey?, baseUrl?, agent?}`.
- **`secrets.ts`** — ConnectPanel convention: sessionStorage keys `oraplanviz.aiAnthropicKey` / `oraplanviz.aiOpenAiKey`; opt-in "remember on this device" mirrors to localStorage; try/catch-wrapped; **never** in settings blob or share URLs (`url.ts` untouched).

## Modified files

- **`src/lib/settings.ts`** — non-secret prefs in `UserSettings` + `defaultSettings`: `aiProvider` ('anthropic'), `aiAnthropicModel` ('claude-opus-5'), `aiOpenAiBaseUrl` (''), `aiOpenAiModel` (''), `aiSections: Record<AiSectionId, boolean>` (all true; merged like `nodeDisplayOptions`).
- **`src/lib/types.ts`** — extend `ViewMode` union with `'ai'` (union at `src/lib/types.ts:203`).
- **New `src/hooks/useAiAnalysis.tsx`** — `AiProvider`/`useAi()`, nested inside `PlanProvider` in App.tsx. State: `aiDialogOpen`, `aiDialogMode`, `report: AiReport|null`, `status: 'idle'|'streaming'|'done'|'error'|'cancelled'`, `streamText` (internal buffer flushed on ~100 ms interval to avoid per-token renders), `error`. Actions: `openAiDialog(mode)`, `runAnalysis(runConfig, builtContext)` (drives the generator, `AbortController` in a ref, parses findings on done, switches `viewMode` to `'ai'` on start), `cancel()`, `clearReport()`. Effect clears the report when its source slot re-parses (same lifecycle as metadata bundles). One report at a time.
- **New `src/components/AiAnalysisDialog.tsx`** — clone `BaselineScriptModal` pattern (Escape listener, onClose, mounted in `AppContent`). Contents: provider radio (agent option only when `isDbAgentEnabled()`), model select + free-text, key input (`type="password"`, remember checkbox), base-URL field for openai-compat, section checklist with per-section char counts, live `~N tokens` total (warn above ~150k), collapsible raw-context `<pre>` preview of the exact `userMessage`, privacy notice naming the provider host, Run button.
- **New `src/components/views/AiReportView.tsx`** — streamed narrative (from `splitReport`), findings list styled via `severityStyles.ts` with nodeId chips calling `selectNode` (mirrors `FindingsList`), header (provider/model badge, Cancel while streaming, Regenerate, Copy via `clipboard.ts`), inline `AiError` + Retry, empty state with "Analyze plan" button. Markdown: `marked` → `DOMPurify.sanitize` → `dangerouslySetInnerHTML`.
- **`VisualizationTabs.tsx` + `NavRibbon.tsx`** — `'ai'` tab (visible when a plan is loaded or a report exists); ribbon "AI analysis" button (+ compare variant enabled when both compare slots parse) opening the dialog.
- **`CommandPalette.tsx`** — commands `ai-analyze-plan`, `ai-compare-plans`, `ai-open-report` with `isAvailable` guards; add to `CommandCategory` union + `CATEGORY_ORDER` if no existing category fits.
- **`App.tsx`** — mount `<AiProvider>` inside `PlanProvider`; `{aiDialogOpen && <AiAnalysisDialog/>}` alongside `BaselineScriptModal`.
- **README/CLAUDE.md** — short privacy note: data leaves the browser to the chosen provider only when Run is clicked.

## Dependencies (3)

| Package | Why |
|---|---|
| `@anthropic-ai/sdk` | Official client; browser support via `dangerouslyAllowBrowser`, typed errors, robust stream/abort. |
| `marked` | Small md→HTML; hand-rolling tables/nested lists is worse. |
| `dompurify` | Report is model output derived from untrusted pasted data (prompt-injection → XSS) rendered via innerHTML; sanitization non-negotiable. |

No SSE library — the ~40-line parser is unit-tested.

## Error handling & edge cases

- 401 → "Invalid API key" + shortcut back to dialog; 429 → surface retry-after; 529 → suggest retry; network/CORS on custom base URL → actionable message naming the URL.
- `refusal` → keep partial text + explanation banner; `max_tokens` → `report.truncated` banner.
- Cancel keeps partial text, status `'cancelled'`; `AbortError` never surfaces as failure.
- JSON fence split across chunks handled by fence-aware `splitReport`; garbled JSON → narrative-only; invented nodeIds filtered.
- Sections without data (no actuals/ASH/metadata) absent from checklist entirely; giant bundles capped by projection; storage unavailable → in-memory key for the session; view persisted as `'ai'` with no report → empty state.

## Testing (`src/lib/ai/__tests__/`, vitest + jsdom)

- `planText.test.ts` — fixture ParsedPlan → exact table; actuals columns absent when `hasActualStats` false.
- `context.test.ts` — deterministic sections; toggles change `userMessage` + `tokenEstimate`; compare digest from two fixtures.
- `findings.test.ts` — valid block / malformed → null / partial fence hidden / invalid nodeIds filtered.
- `openaiCompat.test.ts`, `agent.test.ts` — mock fetch with `ReadableStream` SSE chunks (incl. mid-line split): URL/headers/body shape, deltas, `[DONE]`, abort, 401→auth.
- `anthropic.test.ts` — `vi.mock('@anthropic-ai/sdk')`: `dangerouslyAllowBrowser: true`, no `thinking` param, refusal mapping.
- `secrets.test.ts` — session vs remember-to-local.

## Sequencing

1. `lib/ai` core (types, planText, context, metadataProjection, prompts, findings) + tests — pure, no UI risk.
2. Providers + dispatch + secrets + tests; add the 3 deps.
3. `settings.ts` fields; `ViewMode` `'ai'`.
4. `useAiAnalysis.tsx`; App wiring.
5. Dialog, report view, tabs/ribbon/palette entries.
6. Docs (privacy note; agent endpoint contract in `docs/plans/`).

## Verification

- `npx vitest run --environment jsdom`, `npm run lint`, `npm run build`, `npm run build:pages` (confirm agent provider absent from Pages UI — flag unset).
- Manual smoke via `npm run dev`: openai-compat path against local Ollama; Anthropic path with a real key (streamed report, cancel, findings→node navigation, compare mode).
- Confirm no key appears in localStorage without the remember opt-in, in the settings blob, or in share URLs.
