# Plan 019: The published security promises match the code, and a test keeps network access inside an allow-list

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- src/lib/ai/secrets.ts src/lib/ai/__tests__/secrets.test.ts src/components/AiAnalysisDialog.tsx src/lib/agent/client.ts CLAUDE.md CONTRIBUTING.md site/docs.html index.html src/index.css`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first
> and shifted line numbers; match on the quoted code, not the line number.
> `plans/007-analytics-only-in-pages-build.md` **must already be done** (it
> removes the analytics `<script>` from `index.html` and rewrites the "Page
> views" bullet of the privacy section in `site/docs.html`; a changed
> `index.html` and "Page views" bullet are therefore expected in the drift
> check). `plans/017-remove-dead-code-and-deps.md` may have changed
> `src/lib/ai/provider.ts`; this plan does not edit that file.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/007-analytics-only-in-pages-build.md
- **Category**: security
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

Three statements that users and reviewers rely on are not true of the code:

1. `SECURITY.md` and the docs say API keys are stored only in
   `sessionStorage` and that `localStorage` "never holds API keys" — but the
   AI dialog has a "Remember on this device" checkbox that copies the key to
   `localStorage`, where it outlives the tab and is readable by every script
   on the origin.
2. `CLAUDE.md`, `CONTRIBUTING.md` and a source comment say
   `src/lib/agent/client.ts` is "the only HTTP module" — but three AI
   provider modules also talk to the network, and nothing fails when a new
   network call is added anywhere.
3. The docs say the single-file build's only outside request is "the Manrope
   web font" — it also loads Inter and Fira Code from Google Fonts.

The project's core promise is "nothing leaves the browser". After this plan
the key storage matches the published policy, the invariant is written as an
explicit allow-list, a test enforces that allow-list, and the font requests
are documented accurately. (The AI "Run" button is currently hard-disabled,
so removing the checkbox breaks no user flow.)

## Current state

### (a) API-key storage

- `SECURITY.md:19` lists as a vulnerability: "API keys being written anywhere
  other than `sessionStorage` (for example into `localStorage`, share URLs or
  exports)."
- `site/docs.html` privacy section: the localStorage bullet ends "It never
  holds API keys."; the AI bullet says "Keys live in sessionStorage for the
  tab's lifetime."
- `src/lib/ai/secrets.ts` (84 lines) does otherwise:
  ```ts
  4	 * Follows the ConnectPanel convention: keys live in sessionStorage by default
  5	 * (gone when the tab closes); an opt-in "remember on this device" mirrors the
  6	 * key to localStorage. Reads fall back sessionStorage -> localStorage.
  ...
  49	/** Read a secret: sessionStorage first, then localStorage, then memory. */
  50	export function getAiSecret(key: AiSecretKey): string | null {
  51	  const storageKey = STORAGE_KEYS[key];
  52	  const session = safeGet(() => sessionStorage, storageKey);
  53	  if (session !== null) return session;
  54	  const local = safeGet(() => localStorage, storageKey);
  55	  if (local !== null) return local;
  56	  return memoryStore.get(storageKey) ?? null;
  57	}
  ...
  63	export function setAiSecret(key: AiSecretKey, value: string, remember: boolean): void {
  64	  const storageKey = STORAGE_KEYS[key];
  65	  const wroteSession = safeSet(() => sessionStorage, storageKey, value);
  66	  if (!wroteSession) {
  67	    memoryStore.set(storageKey, value);
  68	  } else {
  69	    memoryStore.delete(storageKey);
  70	  }
  71	  if (remember) {
  72	    safeSet(() => localStorage, storageKey, value);
  73	  } else {
  74	    safeRemove(() => localStorage, storageKey);
  75	  }
  76	}
  ```
  The storage key names are `oraplanviz.aiAnthropicKey` and
  `oraplanviz.aiOpenAiKey` (`STORAGE_KEYS`, lines 16–19). Helpers `safeGet`,
  `safeSet`, `safeRemove` and `clearAiSecret` stay as they are.
- The only callers are in `src/components/AiAnalysisDialog.tsx`:
  ```tsx
  98	  const [rememberKey, setRememberKey] = useState(false);
  ...
  199	      setAiSecret('anthropic', anthropicKey.trim(), rememberKey);
  ...
  202	      setAiSecret('openai', openAiKey.trim(), rememberKey);
  ```
  and the same checkbox block appears twice (near lines 327–334 and 377–384):
  ```tsx
                <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-400">
                  <input
                    type="checkbox"
                    checked={rememberKey}
                    onChange={(e) => setRememberKey(e.target.checked)}
                  />
                  Remember on this device
                </label>
  ```
- `src/lib/ai/__tests__/secrets.test.ts` (83 lines) has tests that assert the
  old behaviour (`mirrors to localStorage when remember=true`,
  `falls back to localStorage when sessionStorage has no value`, …). No other
  test mentions the checkbox.

### (b) "Only HTTP module"

- `CLAUDE.md` line 41 (one long bullet), beginning:
  "- **Nothing leaves the browser.** `src/lib/agent/client.ts` is the only HTTP module (local DB connector, build-gated on `VITE_ENABLE_DB_AGENT=1`; Pages build never sets it). AI sends only on explicit Run, to the chosen provider; API keys live in sessionStorage (`lib/ai/secrets.ts`), never in settings or share URLs. …"
- `CONTRIBUTING.md` line 37:
  "- **Nothing leaves the browser.** The app has no backend. Don't add network calls, analytics or third-party scripts; the only HTTP module is the optional local DB connector client."
- `src/lib/agent/client.ts` line 5: " * This module is the app's only HTTP module. The agent is a small local"
- What the code really contains (every network API use outside tests, in
  `src/` and `packages/ora-plan-core/src/`):
  - `src/lib/agent/client.ts:191` — `fetch` (local DB connector)
  - `src/lib/ai/providers/agent.ts:77` — `fetch` (AI through the connector)
  - `src/lib/ai/providers/openaiCompat.ts:61` — `fetch` (endpoint the user typed)
  - `src/lib/ai/providers/anthropic.ts:1` — `import Anthropic from '@anthropic-ai/sdk'`
  No `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource` or
  `new Image(` anywhere. (`public/sw.js` uses `fetch` for same-origin static
  files; it is outside `src/` and outside this guard.)

### (c) Fonts

- `index.html` lines 11–13 load Manrope from `fonts.googleapis.com`;
  `src/index.css` line 1 is
  `@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');`.
  Every build (hosted, Docker, single-file) therefore requests two Google
  Fonts stylesheets.
- `site/docs.html`, "Option 0 — one HTML file" paragraph, says: "It needs no
  network; the only outside request is the Manrope web font, which falls back
  to a system font when offline."

### Conventions

TypeScript strict; `import type` for type-only imports; vitest with explicit
imports, no Testing Library. Tests that read repository files use `node:fs`
and `__dirname` (exemplar: `src/lib/__tests__/planToJsonScript.test.ts`, which
does `const scripts = join(__dirname, '../../../scripts');` and
`readFileSync(join(scripts, 'plan_to_json.sql'), 'utf-8')`). All
`localStorage`/`sessionStorage` access is wrapped in try/catch — keep using
the existing `safeGet` / `safeSet` / `safeRemove` helpers. User-facing changes
update `site/docs.html` in the same change.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | all files pass (baseline at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`; other plans may have added tests) |
| Secrets tests | `npx vitest run --environment jsdom src/lib/ai/__tests__/secrets.test.ts` | all pass |
| Guard test | `npx vitest run --environment jsdom src/lib/__tests__/networkBoundary.test.ts` | 3 pass |
| Dialog tests | `npx vitest run --environment jsdom src/components/__tests__/modals.test.tsx` | all pass |

## Scope

**In scope** (the only files you should modify):

- `src/lib/ai/secrets.ts`
- `src/lib/ai/__tests__/secrets.test.ts`
- `src/components/AiAnalysisDialog.tsx` (remove the checkbox and its state; adjust two calls)
- `src/lib/__tests__/networkBoundary.test.ts` (create)
- `src/lib/agent/client.ts` (header comment only)
- `CLAUDE.md` (the "Nothing leaves the browser" bullet only)
- `CONTRIBUTING.md` (the "Nothing leaves the browser" bullet only)
- `site/docs.html` (one sentence in "Option 0", one new bullet in the privacy list)

**Out of scope** (do NOT touch, even though they look related):

- How fonts are loaded (`index.html`, `src/index.css`) — documented here, not
  changed.
- `SECURITY.md` — it is correct once step 2 lands.
- `src/lib/ai/providers/*`, `src/lib/ai/provider.ts`, `src/hooks/useAiAnalysis.tsx`
  and the disabled Run button — the AI feature itself is not changed.
- `src/components/ConnectPanel.tsx` and the connector token storage.
- `public/sw.js`.
- The rest of `CLAUDE.md` / `CONTRIBUTING.md`.

## Git workflow

- Branch: `fix/security-docs-match-code`
- Commit per part, conventional-commit style, e.g.
  `fix(ai): keep API keys in sessionStorage only, as SECURITY.md states`,
  `test: guard the network allow-list`,
  `docs: state the network allow-list and the font requests accurately`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rewrite the storage tests to the published policy (they fail first)

In `src/lib/ai/__tests__/secrets.test.ts`:

1. Replace the five tests from `'stores session-only when remember=false'`
   through `'prefers sessionStorage over localStorage'` with:

   ```ts
     it('stores the key in sessionStorage only', () => {
       setAiSecret('anthropic', 'test-key-1');
       expect(getAiSecret('anthropic')).toBe('test-key-1');
       expect(sessionStorage.getItem(ANTHROPIC_KEY)).toBe('test-key-1');
       expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
     });

     it('never writes a key to localStorage', () => {
       const setItem = vi.spyOn(Storage.prototype, 'setItem');
       setAiSecret('anthropic', 'test-key-1');
       setAiSecret('openai', 'test-key-2');
       getAiSecret('anthropic');
       getAiSecret('openai');
       expect(localStorage.length).toBe(0);
       // every write went to sessionStorage
       expect(setItem.mock.contexts.every((storage) => storage === sessionStorage)).toBe(true);
     });

     it('setAiSecret deletes a copy an older version left in localStorage', () => {
       localStorage.setItem(ANTHROPIC_KEY, 'old-remembered');
       setAiSecret('anthropic', 'new');
       expect(getAiSecret('anthropic')).toBe('new');
       expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
     });

     it('getAiSecret ignores and deletes a copy an older version left in localStorage', () => {
       localStorage.setItem(ANTHROPIC_KEY, 'old-remembered');
       expect(getAiSecret('anthropic')).toBeNull();
       expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
     });

     it('reads sessionStorage and drops a stale localStorage copy', () => {
       localStorage.setItem(OPENAI_KEY, 'local-value');
       sessionStorage.setItem(OPENAI_KEY, 'session-value');
       expect(getAiSecret('openai')).toBe('session-value');
       expect(localStorage.getItem(OPENAI_KEY)).toBeNull();
     });
   ```

2. In the remaining tests remove the third argument of every `setAiSecret(…)`
   call (`, false` / `, true`).
3. Replace the `clearAiSecret` test body with one that plants the old copy
   by hand:

   ```ts
     it('removes the session copy and any old local copy', () => {
       setAiSecret('anthropic', 'test-key-3');
       localStorage.setItem(ANTHROPIC_KEY, 'old-remembered');
       clearAiSecret('anthropic');
       expect(sessionStorage.getItem(ANTHROPIC_KEY)).toBeNull();
       expect(localStorage.getItem(ANTHROPIC_KEY)).toBeNull();
       expect(getAiSecret('anthropic')).toBeNull();
     });
   ```

**Verify**: `npx vitest run --environment jsdom src/lib/ai/__tests__/secrets.test.ts`
→ fails (at least `getAiSecret ignores and deletes…` and
`reads sessionStorage and drops…` fail), and
`grep -c ", true)\|, false)" src/lib/ai/__tests__/secrets.test.ts` → `0`.

### Step 2: Make key storage session-only

In `src/lib/ai/secrets.ts`:

1. Replace comment lines 4–6 with:
   ```ts
    * Keys live in sessionStorage only (gone when the tab closes), as SECURITY.md
    * promises. Earlier versions could mirror a key to localStorage ("remember on
    * this device"); any such copy is deleted, unused, on the next read or write.
   ```
2. Replace `getAiSecret` with:
   ```ts
   /** Read a secret: sessionStorage first, then memory. */
   export function getAiSecret(key: AiSecretKey): string | null {
     const storageKey = STORAGE_KEYS[key];
     // Drop a copy left behind by the old "remember on this device" option.
     safeRemove(() => localStorage, storageKey);
     const session = safeGet(() => sessionStorage, storageKey);
     if (session !== null) return session;
     return memoryStore.get(storageKey) ?? null;
   }
   ```
3. Replace `setAiSecret` (and its doc comment) with:
   ```ts
   /** Store a secret for this session (sessionStorage, or memory when storage is unavailable). */
   export function setAiSecret(key: AiSecretKey, value: string): void {
     const storageKey = STORAGE_KEYS[key];
     const wroteSession = safeSet(() => sessionStorage, storageKey, value);
     if (!wroteSession) {
       memoryStore.set(storageKey, value);
     } else {
       memoryStore.delete(storageKey);
     }
     safeRemove(() => localStorage, storageKey);
   }
   ```
   A previously remembered key is deleted, not migrated: it must not be used
   silently after the policy says it is not stored.

In `src/components/AiAnalysisDialog.tsx`:

4. Delete the line `const [rememberKey, setRememberKey] = useState(false);`.
5. Change the two calls to `setAiSecret('anthropic', anthropicKey.trim());`
   and `setAiSecret('openai', openAiKey.trim());`.
6. Delete both `<label …>…Remember on this device</label>` blocks (8 lines
   each, quoted in "Current state").

**Verify**:
- `npx vitest run --environment jsdom src/lib/ai/__tests__/secrets.test.ts` → `Tests 9 passed (9)`
- `npm run typecheck` → exit 0
- `grep -c "rememberKey\|Remember on this device" src/components/AiAnalysisDialog.tsx` → `0`
- `grep -c "localStorage" src/lib/ai/secrets.ts` → `4` (one comment line and three `safeRemove(() => localStorage, …)` calls — no `safeGet`/`safeSet` on localStorage)
- `npx vitest run --environment jsdom src/components/__tests__/modals.test.tsx` → all pass

### Step 3: Add the network allow-list test

Create `src/lib/__tests__/networkBoundary.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');

/** Every non-test source file under the given repo-relative directory. */
function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|bench)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const FILES = [...sourceFiles('src'), ...sourceFiles('packages/ora-plan-core/src')];

/** The only modules allowed to talk to the network (see "Nothing leaves the browser" in CLAUDE.md). */
const NETWORK_MODULES = [
  'src/lib/agent/client.ts', // local DB connector
  'src/lib/ai/providers/agent.ts', // AI through the local DB connector
  'src/lib/ai/providers/anthropic.ts', // Anthropic SDK
  'src/lib/ai/providers/openaiCompat.ts', // OpenAI-compatible endpoint the user typed
];

const NETWORK_API =
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b|\bnew\s+Image\s*\(|(?:from|import\()\s*['"]@anthropic-ai\/sdk/;

describe('network boundary', () => {
  it('scans a plausible number of files', () => {
    expect(FILES.length).toBeGreaterThan(150);
    for (const file of NETWORK_MODULES) expect(FILES, file).toContain(file);
  });

  it('uses network APIs only in the allow-listed modules', () => {
    const offenders = FILES.filter((file) => !NETWORK_MODULES.includes(file)).filter((file) =>
      NETWORK_API.test(readFileSync(join(root, file), 'utf-8')),
    );
    expect(offenders).toEqual([]);
  });

  it('loads third-party resources only from the font hosts', () => {
    const hosts = new Set<string>();
    for (const file of ['index.html', 'src/index.css']) {
      const text = readFileSync(join(root, file), 'utf-8');
      for (const m of text.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.add(m[1].toLowerCase());
    }
    expect([...hosts].sort()).toEqual(['fonts.googleapis.com', 'fonts.gstatic.com']);
  });
});
```

The scan is textual on purpose: a comment that says `fetch(` in another file
also fails it, which keeps the rule simple — reword the comment.

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/networkBoundary.test.ts`
→ `Tests 3 passed (3)`. If the third test reports extra hosts
(`gc.zgo.at`, `davidbudac.goatcounter.com`), plan 007 has not been applied —
that is a STOP condition, not something to allow-list.

Then prove the guard bites: temporarily add the line
`export const probe = () => fetch('/x');` to the end of `src/lib/ids.ts`, run
the test (→ `uses network APIs only…` fails and lists `src/lib/ids.ts`), then
remove the line again (`git checkout -- src/lib/ids.ts`) and re-run (→ 3 pass).

### Step 4: State the invariant as an allow-list

1. `CLAUDE.md` — in the "Nothing leaves the browser" bullet, replace the two
   sentences from `` `src/lib/agent/client.ts` is the only HTTP module `` up to
   and including `never in settings or share URLs.` with:

   > Network code lives in four modules only, enforced by `src/lib/__tests__/networkBoundary.test.ts`: `src/lib/agent/client.ts` (local DB connector, build-gated on `VITE_ENABLE_DB_AGENT=1`; Pages build never sets it) and the AI providers `src/lib/ai/providers/{anthropic,openaiCompat,agent}.ts`. The only third-party resources a page loads are Google Fonts stylesheets (`index.html`, `src/index.css`) and, in the GitHub Pages build only, the GoatCounter page-view script (`APP_ANALYTICS=1`). AI sends only on explicit Run, to the chosen provider; API keys live in sessionStorage only (`lib/ai/secrets.ts`), never in localStorage, settings or share URLs.

   Keep the bullet's opening `- **Nothing leaves the browser.**` and the
   sentences that follow (AI-suggested SQL, service worker) unchanged, all on
   the same line as today.
2. `CONTRIBUTING.md` — replace the bullet with:

   > - **Nothing leaves the browser.** The app has no backend. Don't add network calls, analytics or third-party scripts. Network code is limited to the optional local DB connector client (`src/lib/agent/client.ts`) and the AI providers (`src/lib/ai/providers/`), which send only when the user clicks Run; `src/lib/__tests__/networkBoundary.test.ts` fails if a network API appears anywhere else.

3. `src/lib/agent/client.ts` — replace the comment sentence
   `This module is the app's only HTTP module.` with
   `This module and the AI providers (src/lib/ai/providers/) are the app's only network code; src/lib/__tests__/networkBoundary.test.ts enforces that.`
   (re-wrap the comment lines at about 75 characters; keep the ` * ` prefix).

**Verify**: `grep -rn "only HTTP module" CLAUDE.md CONTRIBUTING.md src` → no
output; `grep -c "networkBoundary.test.ts" CLAUDE.md CONTRIBUTING.md` → `1`
for each file.

### Step 5: Document the font requests

In `site/docs.html`:

1. In the "Option 0 — one HTML file" paragraph replace
   `It needs no network; the only outside request is the Manrope web font, which falls back to a system font when offline.`
   (it spans two source lines) with
   `It needs no network; the only outside requests are for web fonts from Google Fonts (Manrope, Inter, Fira Code), which fall back to system fonts when offline.`
2. In the privacy list, directly after the "Page views" list item, add:
   ```html
           <li><strong>Web fonts.</strong> Every copy of the app (hosted, self-hosted, single-file) loads its fonts from Google Fonts, so Google receives a font request (IP address, browser) when the app opens. No plan data is part of it, and the app works without it.</li>
   ```

**Verify**: `grep -c "the only outside request is the Manrope" site/docs.html`
→ `0`; `grep -c "<strong>Web fonts.</strong>" site/docs.html` → `1`.

### Step 6: Full check

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0; `npm test`
→ all pass, with one more test file and three more tests than before this plan.

## Test plan

- `src/lib/ai/__tests__/secrets.test.ts` — rewritten to the session-only
  policy (Step 1); 9 tests in total, including the regression test
  `never writes a key to localStorage` and the clean-up of copies left by the
  old option.
- `src/lib/__tests__/networkBoundary.test.ts` — new, 3 tests (Step 3): file
  scan sanity, network API allow-list, third-party host allow-list. Pattern:
  `src/lib/__tests__/planToJsonScript.test.ts` for reading repository files.
- Existing `src/components/__tests__/modals.test.tsx` must stay green (it
  renders the AI dialog).

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `networkBoundary.test.ts` (3 tests) and `secrets.test.ts` (9 tests) pass
- [ ] `grep -rn "safeSet(() => localStorage\|safeGet(() => localStorage" src/lib/ai/secrets.ts` prints nothing
- [ ] `grep -rn "Remember on this device" src --include=*.tsx` prints nothing
- [ ] `grep -rn "only HTTP module" CLAUDE.md CONTRIBUTING.md src` prints nothing
- [ ] `grep -c "<strong>Web fonts.</strong>" site/docs.html` prints `1`
- [ ] `git status --porcelain` lists only the eight in-scope files (`src/lib/ids.ts` is unchanged)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `index.html` still contains a `goatcounter` script (plan 007 not applied).
- `grep -rn "setAiSecret\|getAiSecret" src --include=*.ts --include=*.tsx | grep -v __tests__`
  shows a caller other than `src/components/AiAnalysisDialog.tsx` and
  `src/lib/ai/secrets.ts` itself.
- The network guard test (second test) lists an offending file at Step 3
  before you added the probe — a real network call exists outside the
  allow-list. Report the file and line; do not add it to `NETWORK_MODULES`
  on your own.
- The AI Run button in `src/components/AiAnalysisDialog.tsx` is no longer
  hard-disabled (search for `AI_COMING_SOON_LABEL`): then real users may rely
  on "Remember on this device" and removing it is a product decision for the
  maintainer.
- A dialog test fails because it expects the checkbox.

## Maintenance notes

- Adding a network-capable module from now on means editing
  `NETWORK_MODULES` in the guard test **and** the allow-list sentence in
  `CLAUDE.md` in the same change — reviewers should treat a change to that
  array as a security review trigger.
- The guard is textual and covers `src/` and `packages/ora-plan-core/src/`
  only. It does not see `public/sw.js`, the `site/` pages, or network access
  hidden inside a dependency.
- If remembering a key across sessions is wanted when the AI feature ships,
  that is a policy change: update `SECURITY.md`, the docs and this code
  together, rather than re-adding the mirror quietly.
- Follow-up worth considering (not done here): bundle the three font
  families with the app (for example as local `woff2` files) so that no
  build contacts a third party at all; then tighten the third test to expect
  an empty host list and delete the "Web fonts" bullet.
- The "Page views" bullet and the GoatCounter wording belong to
  `plans/007-analytics-only-in-pages-build.md`; this plan adds its bullet
  after it and must not reword it.
