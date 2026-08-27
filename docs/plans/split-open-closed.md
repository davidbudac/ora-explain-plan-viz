# Open-source / closed-source split — execution plan

Decision (2026-08-26): ship two versions of the product.

1. **Open source** — this repo (`davidbudac/ora-explain-plan-viz`, MIT, public):
   the full visualizer **including BYO-key / OpenAI-compat / local-agent AI
   analysis**, with a dockerized self-host deployment. Rationale: all AI code
   on this branch was pushed to this public repo before the split decision, so
   it is already disclosed; BYO-key AI costs the project nothing and is the
   top-of-funnel for the hosted service.
2. **Closed source** — the SaaS: a hosted backend holding the Anthropic key
   (`oraplanviz-cloud`) plus a thin private downstream fork of this repo
   (`oraplanviz-pro`) that defaults to the hosted provider and carries SaaS
   chrome. The real closed assets are the hosted service, issued tokens,
   evolving prompts, and the growing eval corpus/results — not the current code.

## Target repo layout

| Repo | Visibility | Contents |
|---|---|---|
| `davidbudac/ora-explain-plan-viz` | public (exists) | Core app + BYO-key AI + evals harness + Docker deployment. Upstream of the fork. |
| `davidbudac/oraplanviz-pro` | private (created 2026-08-26) | Downstream fork tracking this repo as `upstream`. Delta only: hosted provider as default, SaaS branding/billing UI, future paid-only features. |
| `davidbudac/oraplanviz-cloud` | private (created 2026-08-26) | Hosted backend: streaming Anthropic proxy, token auth, metering. Contract: `docs/plans/ai-plan-analysis.md` Phase 1.5. |
| `davidbudac/oraplanviz-agent` | public (created 2026-08-27) | Local DB-connect companion. Needs the `/api/test/*` endpoints (Phase 3 contract). |

## Status

### Done (this branch)

- All AI phases implemented and green (659 tests): analysis (anthropic /
  openai-compat / agent / hosted providers), test-case builder, follow-up chat
  with approval-gated agent execution, `evals/` harness (existing-DB via
  `ORA_EVAL_*`).
- Docker deployment: existing `Dockerfile` (+ new `VITE_ENABLE_DB_AGENT` build
  arg), root `nginx.conf`, new `docker-compose.yml` (`app` on :8080; `agent`
  profile builds an agent-enabled UI on :8081), `docker:*` npm scripts.
- `oraplanviz-cloud` v0.1 **implemented and smoke-tested**, committed locally
  in the split-work container at `/home/user/oraplanviz-cloud` (single commit
  `de7a51d`). NOT yet pushed anywhere — the container is ephemeral; if the
  commit is lost, regenerate from the spec below (~1h of work).

### Done (2026-08-26, follow-up session)

- Private repos created: `davidbudac/oraplanviz-pro`, `davidbudac/oraplanviz-cloud`.
- `oraplanviz-cloud`: original `de7a51d` turned up on `origin/main` (pushed
  from the container after all); a spec-regenerated tree landed on top as
  `8037df5` v0.1.1 (32 tests, CORS allowlist, metadata-only logging,
  `.env.example`). Local clone at `~/claude_projects/oraplanviz-cloud`.
- `oraplanviz-pro` initialized at `~/claude_projects/oraplanviz-pro`
  (`upstream` = public repo, `origin` = private), with `PRO.md` and the
  `aiProvider: 'hosted'` default commit; pushed.
- Public repo: rebased branch pushed; test infra fixed for Node >= 22
  (`vitest.config.ts` + Web Storage shim); PR #95 opened
  `claude/ai-integration-changes-ynb1ak` -> `main`.

### Done (2026-08-27)

- PR #95 merged into `main` (merge commit `a6257da`); working branch deleted.
  Included a merge with main's single-bar chrome redesign (AI tab via
  `viewIcons`, AI launch button now in `HeaderActions`).
- `VITE_ENABLE_HOSTED` flag implemented (`isHostedAiEnabled()` in
  `src/lib/ai/provider.ts`, Dockerfile ARG, README). Public build hides the
  hosted radio; pro sets `VITE_ENABLE_HOSTED=1` via a committed `.env`.
- `oraplanviz-pro` merged `upstream/main` (hosted default preserved), builds.
- `oraplanviz-agent` repo created (**public**) and pushed; `/api/test/connect|
  exec|explain|disconnect` (+ `GET /api/test/log`) implemented on a separate
  `TestDb` session with statement log; agent v0.2.0; frontend
  `MIN_AGENT_VERSION` bumped to `0.2.0`.

### Open

- `oraplanviz-cloud` deploy: no hosting platform CLI/credentials on this
  machine (no flyctl/railway) — needs a human to pick a host, set
  `ANTHROPIC_API_KEY` / `OPV_TOKENS` / `OPV_ALLOWED_ORIGINS`, and point
  `api.oraplanviz.com` at it.
- Agent `/api/test/*` verified by unit tests only; dbmint live e2e not run.

## Remaining steps (in order)

### 1. Create the private repos

Create `oraplanviz-pro` and `oraplanviz-cloud` as **private**, no auto-init
(empty, no README), and grant the automation (Claude GitHub App / deploy
credentials) push access to both.

### 2. Push `oraplanviz-cloud`

If the container clone at `/home/user/oraplanviz-cloud` still exists:

```bash
cd /home/user/oraplanviz-cloud
git remote add origin git@github.com:davidbudac/oraplanviz-cloud.git
git push -u origin main
```

Otherwise regenerate v0.1 from this spec (contract details in
`ai-plan-analysis.md` Phase 1.5):

- Node 22 + TypeScript (`tsx` runtime, `strict`, ESM, zero-framework
  `node:http`), deps: `@anthropic-ai/sdk` only.
- `src/config.ts` — env config: `PORT` (8787), `OPV_TOKENS` (comma-separated
  account tokens; empty ⇒ all 401), `OPV_MODEL` (`claude-opus-5`, pinned
  server-side — client-requested models ignored), `OPV_MAX_TOKENS` (32000 cap),
  `OPV_MONTHLY_TOKEN_LIMIT` (5M), `OPV_ALLOWED_ORIGINS` (CORS allowlist).
- `src/usage.ts` — per-token monthly token metering, in-memory v0.1 (replace
  with a durable store before billing).
- `src/server.ts` — endpoints: `GET /healthz`; bearer-auth gate; `GET /v1/me`
  → `{plan, usage:{tokensThisMonth, limit}}`; `POST /v1/analyze`
  `{system, prompt, model|null, maxTokens|null, kind}` → SSE
  `delta {"text"}` / `done {"stopReason","explanation"?}` /
  `error {"message","status"}`, pre-stream failures as JSON
  `{error, code}` (400/401/402 quota/429/500). Upstream call:
  `anthropic.beta.messages.stream({model, max_tokens, system, messages:
  [{role:'user', content: prompt}], betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default'}, {signal})`; abort on client disconnect; record
  input+output tokens per account token; **log metadata only — never plan
  payloads** (kind/model/tokens/latency/stop reason). Dockerfile (node:22-alpine,
  port 8787). README documenting all of the above.

### 3. Initialize `oraplanviz-pro` (private downstream fork)

```bash
git clone https://github.com/davidbudac/ora-explain-plan-viz.git oraplanviz-pro
cd oraplanviz-pro
git checkout claude/ai-integration-changes-ynb1ak   # or main once merged (step 4)
git remote rename origin upstream
git remote add origin git@github.com:davidbudac/oraplanviz-pro.git
git branch -M main
git push -u origin main
```

Then the pro delta (each its own commit):

- `PRO.md` — fork workflow: this repo is a private downstream of
  `ora-explain-plan-viz`; sync with
  `git fetch upstream && git merge upstream/main` (never rebase published
  history); closed-only changes stay minimal and in separate files where
  possible to keep merges clean; **never push this repo's content to any
  public remote**.
- Default `aiProvider` to `'hosted'` in `src/lib/settings.ts` and pre-fill the
  hosted base URL (`https://api.oraplanviz.com` constant already exists as
  `DEFAULT_HOSTED_BASE_URL` in `src/lib/ai/provider.ts`).
- Optional later: SaaS branding, sign-up/token UI, billing.

### 4. Merge the AI branch in the public repo

`claude/ai-integration-changes-ynb1ak` → `main` (PR or direct merge — owner's
call). This makes the open-source AI version official and becomes the base the
pro fork tracks. After merging, delete the working branch.

### 5. Repo hygiene / follow-ups

- Public repo: keep GitHub Pages build as-is (BYO-key + OpenAI-compat visible;
  hosted radio is harmless without a token but MAY be hidden behind a
  `VITE_ENABLE_HOSTED` flag if it should not appear on Pages — small change in
  `AiAnalysisDialog.tsx`, mirroring the `isDbAgentEnabled()` pattern).
- `oraplanviz-agent` (public): implement the `/api/test/connect|exec|explain|
  disconnect` endpoints per the Phase 3 contract in `ai-plan-analysis.md`
  (separate TEST connection, statement log, never the read-only source
  connection); bump agent version ≥ the frontend's `MIN_AGENT_VERSION`.
- `oraplanviz-cloud` deploy: any small host (Fly.io/Railway/VPS) with
  `ANTHROPIC_API_KEY`, `OPV_TOKENS`, `OPV_ALLOWED_ORIGINS` set; DNS
  `api.oraplanviz.com`; HTTPS termination by the platform.
- Going forward: closed-source-differentiating work (prompt tuning, new
  scenarios/results, SaaS features) is committed ONLY to the private repos.
  New shared/core features land in the public repo and flow downstream via
  the upstream merge.

## Privacy / security invariants (all repos)

- API keys / account tokens: sessionStorage-first in the app
  (`src/lib/ai/secrets.ts`), env-only in the backend; never in settings blobs,
  share URLs, eval results, or logs.
- Cloud backend stores no plan payloads; logs metadata only.
- Agent execution stays localhost-only and per-call user-approved.
