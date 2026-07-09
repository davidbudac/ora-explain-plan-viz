# Plan: v1.0.0 Rollout — polish, release, announce

Status: **approved plan, not yet executed** (2026-07-08)

## Context

The app is already *deployed*: the repo is public, `.github/workflows/deploy.yml`
auto-builds (`npm run build:pages`) and publishes to GitHub Pages on every push to
`main`, and https://davidbudac.github.io/ora-explain-plan-viz/ is live. This plan is
about making it *shipped*: clean, versioned, discoverable, and announced.

Verified state as of 2026-07-08:

| Check | Result |
|---|---|
| `npm run build` | ✓ passes (1.09s) |
| `npx vitest run --environment jsdom` | ✓ 887 tests, 51 files, all green |
| `npm run lint` | ✗ 131 errors, 17 warnings (see Phase 1) |
| `main` vs `origin/main` | in sync |
| Pages deployment | live, HTTP 200 |
| `package.json` version | `0.0.0` — never versioned |
| Branches | ~80 local, ~50 remote, nearly all merged/abandoned |

## How agents should execute this plan

- **You (the agent reading this) are the implementer.** Do the work in this plan
  yourself with your own tools. Do NOT delegate phases to further subagents — a
  facilitator/orchestrator has already decided who runs what.
- Phases must run **in order**; each phase's Gate must pass before the next starts.
  Exception: Phase 5 (announcement drafts) may be prepared in parallel with
  Phases 1–4, since it touches no code.
- **Hard stops** (🛑) require explicit user approval before proceeding. Never skip
  them: they cover irreversible or outward-facing actions (publishing a release,
  deleting remote branches, posting announcements).
- After every phase, run the full Gate even if the change "obviously" can't break
  anything, and record the result in the rollout log (bottom of this file).
- If a Gate fails, fix forward within the phase; do not proceed with a failing gate.
- Environment note: `gh` CLI calls failed once in a sandboxed session with a TLS
  certificate error (`x509: OSStatus -26276`). If `gh` fails, retry outside the
  sandbox; if it still fails, hand the exact command to the user to run.

### Orchestration guidance (for the facilitating session)

Per the user's global model policy:

| Phase | Nature | Model |
|---|---|---|
| 1 (lint) | mechanical code cleanup | sonnet-5 subagent; escalate to opus-4.8 only if React-hooks fixes get subtle |
| 2 (bundle) | mechanical, clear spec | sonnet-5 subagent |
| 3 (release) | mostly commands + user-facing release notes | main loop; opus-4.8 for release-notes copy |
| 4 (branches) | mechanical + destructive | main loop (needs the 🛑 conversation) |
| 5 (announce) | user-facing copy, taste-critical | opus-4.8 draft, fable-5 final polish pass only |
| 6 (post-launch) | monitoring | main loop, low effort |

Review of Phase 1/2 diffs before merge: fable-5 or opus-4.8.

---

## Phase 1 — Lint to zero errors

The 131-error count is inflated: ESLint also scans stale agent worktrees under
`.claude/worktrees/`, so each real error appears 3–4×.

### Steps

1. **Scope ESLint correctly.** In `eslint.config.js`, add global ignores for
   `.claude/**`, `dist/**`, `site/**`, and `livetests/**` (check each actually
   exists / contains JS-TS before adding). Re-run `npm run lint` to get the true
   error count — expect roughly 30–45.
2. **Auto-fix the trivial tier:** `npx eslint . --fix` handles `prefer-const` and
   similar (7 were reported auto-fixable). Then hand-remove unused imports/vars
   (`@typescript-eslint/no-unused-vars`, e.g. `beforeEach` in
   `src/lib/__tests__/url.test.ts:1`, `downloadFilename` in
   `src/lib/metadata/__tests__/gatherScript.test.ts:6`).
3. **Fix `no-case-declarations`** (two spots, lines ~111–112 of one file): wrap the
   case body in `{ }`.
4. **Fix the React correctness tier — carefully, these change runtime behavior:**
   - "Calling setState synchronously within an effect" (3 distinct sites): prefer
     deriving state during render or computing the value with `useMemo`; if the
     effect reacts to an external store/event, keep the effect but make it
     idempotent. Do not blindly wrap in `queueMicrotask` to silence the rule.
   - "Cannot access refs during render" (~3 distinct sites around lines 371–376 of
     one component): move ref reads into effects/handlers, or convert the value to
     state if the render output genuinely depends on it.
   - `react-refresh/only-export-components` (1 site, line ~845): move the
     non-component export to its own module.
   Each fix in this tier needs a manual smoke test of the affected view in the dev
   server (use the preview tools: load an example plan, exercise the specific
   interaction the component owns).
5. **Warnings (17):** fix the cheap ones; suppress with a targeted
   `eslint-disable-next-line` + one-line justification only where a fix would be a
   refactor. Zero *errors* is the bar; zero warnings is nice-to-have.

### Gate

```
npm run lint          # 0 errors
npx vitest run --environment jsdom   # 887+ tests pass
npm run build         # clean build
```

Plus: dev-server smoke test of every view whose component was touched in step 4
(hierarchical, sankey, plan text, compare, metadata — load example plans, click
nodes, switch tabs). Commit on a branch (`chore/lint-zero`), open a PR, get it
reviewed (fable-5 or opus-4.8), merge to `main`.

---

## Phase 2 — Bundle size (optional but recommended)

Single JS chunk is 1,177 kB (306 kB gzip); Vite warns above 500 kB. This is a
nice-to-have — **skip if it turns into a fight**, it must not block the release.

### Steps

1. Lazy-load the heavy, not-first-paint dependencies with `React.lazy` +
   `Suspense` (a lightweight "loading view…" fallback matching the slate design):
   - `SankeyView` (pulls d3-sankey/d3-force)
   - the Plan Text view's `highlight.js` usage (or switch to a core build with
     only the SQL language registered)
   - `html-to-image` (import dynamically inside the export handler)
2. Check `@xyflow/react` stays in the entry chunk — it *is* first-paint (the
   default hierarchical view); don't split it.
3. Verify chunking with `npm run build` output; target: entry chunk under
   ~700 kB raw, no behavior change.

### Gate

Build + tests as in Phase 1, plus dev-server check that each lazily loaded view
renders on first click (Sankey tab, Plan Text tab with syntax highlighting, PNG
export). Same PR/review/merge flow.

---

## Phase 3 — Version, tag, release, repo metadata

### Steps

1. **Bump version:** `package.json` `"version": "1.0.0"` (keep `"private": true`
   — it's not an npm package). Commit to `main` (via PR or direct, user's call —
   ask once).
2. **Wait for the Pages deploy** triggered by the merge; verify the live site
   loads and parses an example (`curl` for 200 + a manual example-load check).
3. **Draft release notes** (opus-4.8 for copy). Source material: `git log
   --oneline` since repo start, `README.md` feature list, `changelog_claude.md`.
   Structure: one-paragraph pitch (client-side, no data leaves the browser),
   then grouped highlights — Input formats (DBMS_XPLAN, SQL Monitor text/XML,
   JSON V$SQL_PLAN, XBI), Views (hierarchical/sankey/text/compare/metadata),
   Analysis (cardinality mismatch, hotspots, spill warnings), Sharing
   (gzip hash-fragment URLs, annotations export), Deployment (Pages + Docker).
   🛑 **User reviews the notes before publishing.**
4. **Tag and publish:**
   ```
   git tag -a v1.0.0 -m "v1.0.0"
   git push origin v1.0.0
   gh release create v1.0.0 --title "v1.0.0" --notes-file <notes>
   ```
5. **Repo metadata** (discoverability):
   ```
   gh repo edit davidbudac/ora-explain-plan-viz \
     --description "Interactive Oracle execution plan visualizer — paste DBMS_XPLAN or SQL Monitor output, nothing leaves your browser" \
     --homepage "https://davidbudac.github.io/ora-explain-plan-viz/" \
     --add-topic oracle --add-topic oracle-database --add-topic execution-plan \
     --add-topic dbms-xplan --add-topic sql-monitor --add-topic sql-tuning \
     --add-topic visualization --add-topic react
   ```
6. **README badge row** (optional): deploy-workflow status badge + link to release.

### Gate

`gh release view v1.0.0` shows the release; repo page shows description/topics;
live site still serves the new build.

---

## Phase 4 — Branch hygiene

~50 remote branches, nearly all merged. A tidy branch list reads as "maintained".

### Steps

1. List merged remote branches:
   `git branch -r --merged origin/main | grep -v 'origin/main\|origin/HEAD'`
2. Also list *unmerged* remote branches with their last-commit date
   (`git for-each-ref --sort=committerdate refs/remotes --format='%(committerdate:short) %(refname:short)'`)
   and split into "stale experiment, delete" vs "keep" candidates.
3. 🛑 **Show both lists to the user and get explicit approval of the exact
   delete list.** Remote branch deletion is destructive; never infer approval.
4. Delete approved branches: `git push origin --delete <branch>...` (batch).
5. Local cleanup (safe, still confirm): `git branch --merged main` minus `main`,
   delete with `git branch -d`; leave `worktree-*` branches that back existing
   worktrees under `.claude/worktrees/` alone unless the user wants the
   worktrees removed too.

### Gate

`git branch -r` shows only `main` + explicitly kept branches; no worktree is
broken (`git worktree list` reports no prunable errors, or has been pruned
deliberately).

---

## Phase 5 — Announcement (can be drafted in parallel; publishing is last)

The audience is Oracle DBAs/performance engineers. Core pitch: *"Paste your
DBMS_XPLAN or SQL Monitor output, get an interactive visualization — hotspots,
cardinality mismatches, plan diffs. 100% client-side: no upload, no account,
production plans never leave your browser."* The privacy line is the hook — DBAs
sit on confidential production plans. XBI support is a credibility signal for the
Tanel Poder-adjacent crowd.

### Steps

1. **Visuals:** generate fresh screenshots with `scripts/capture-screenshots.mjs`
   (see `scripts/README.md` / showcase-site notes for its gotchas). Produce:
   hierarchical view with a hotspot ring, compare view, cardinality-mismatch
   detail panel. Optionally a short GIF of paste→parse→explore.
2. **Draft per-channel copy** (opus-4.8; fable-5 polish pass at the end —
   polish only, no rewrite):
   - **r/oracle** — text post, practitioner tone, lead with a screenshot and the
     privacy line; include the live URL + repo. No marketing voice.
   - **LinkedIn** — 2–3 short paragraphs, personal "I built this" framing,
     1–2 images.
   - **X/Twitter** — thread of 3–4 posts: hook + GIF, formats supported,
     compare/annotation feature, link.
   - **oracle-l mailing list** — plain text, understated, tool-announcement
     etiquette (one short paragraph + links).
   Each draft ends with the two links (app, repo) and mentions it's open source.
3. 🛑 **User reviews every draft and posts them himself** (accounts are his).
   Deliver the drafts as ready-to-paste text blocks plus the image files via
   file attachments. Suggested order: r/oracle and oracle-l first (feedback-rich),
   LinkedIn/X after any quick fixes that feedback triggers.

### Gate

User has the drafts + images in hand and has confirmed they're ready to use.

---

## Phase 6 — Post-launch watch (first ~2 weeks)

1. Enable GitHub Issues templates? Optional — plain issues are fine at this scale.
2. When the user reports announcement feedback: triage bug reports into GitHub
   issues; parse failures on real-world plans are the most likely and most
   valuable category (each one is a parser test case — reproduce, add to
   `src/lib/parser/__tests__/`, fix).
3. Fast-follow release `v1.0.1` if a parse-breaking bug shows up; same Phase 3
   mechanics, no announcement needed.

---

## Rollout log

Agents: append a dated line per phase — result of the Gate, PR link, anything a
later phase needs to know.

- 2026-07-08 — plan written; Phases 0-state verified (build ✓, 887 tests ✓,
  lint 131 errors, Pages live).
- 2026-07-09 — Phase 1 (lint) implemented (branch `chore/lint-zero`). True error
  count after ignoring `.claude/worktrees/` was 40 (not 131). Gate: **lint 0
  errors ✓, build clean ✓, 887/887 tests ✓**, full manual diff review ✓ (all 14
  files correct; SankeyView correct-but-inelegant). **STILL PENDING before
  merge:** interactive dev-server smoke test of touched views + independent AI
  review — both blocked by a sustained opus-4.8 classifier outage (preview MCP,
  agent spawns, and mutating Bash all unavailable). User chose **direct-to-main**
  (no PR); push auto-deploys, so smoke test must pass first. Paused mid-Phase-1;
  see [`rollout-v1-handoff.md`](rollout-v1-handoff.md).
