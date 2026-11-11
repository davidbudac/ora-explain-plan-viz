# Plan 003: The user is told when autosave is skipped as too large, and an older restored session is labelled as older

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- src/lib/session.ts src/lib/__tests__/session.test.ts src/hooks/usePlanContext.tsx site/docs.html`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `src/hooks/usePlanContext.tsx` is also edited by
> `plans/002-keep-session-on-corrupt-share-link.md` (expected to have landed —
> it adds a `.catch(() => { … })` block in the same startup effect, which you
> leave alone), `plans/004-share-from-single-file-build.md` and
> `plans/005-guard-theme-storage.md`.
>
> **Design note**: this plan deliberately does NOT delete the older snapshot
> (see "Why this matters"); it keeps it and makes both ends of the situation
> visible.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/002-keep-session-on-corrupt-share-link.md` (same startup effect; land it first to avoid a conflict)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

The workspace is autosaved to `localStorage`, but a session over 4 MB (for
example one large SQL Monitor XML report) is skipped — by design, sessions are
never truncated. Today that skip is silent, and the previous, smaller snapshot
stays in storage. So after loading a big plan the user keeps working with no
autosave and no hint, and after a reload the app shows a different, older state
under the message "Restored your previous session". Deleting the older snapshot
would be worse: it can hold notes that exist nowhere else (think three
annotated plans plus one oversized plan opened in a fourth tab). This plan keeps
the snapshot and removes the two lies: a warning toast when autosave stops, and
a truthful restore message when what comes back is an older snapshot.

## Current state

- `src/lib/session.ts` — session persistence. Relevant excerpts:

  `src/lib/session.ts:12-16`
  ```ts
  export const SESSION_KEY = 'oraplanviz.session.v1';
  export const RECENT_KEY = 'oraplanviz.recent.v1';

  /** Autosave is skipped (not truncated) when the serialised session exceeds this many chars. */
  export const MAX_SESSION_CHARS = 4 * 1024 * 1024;
  ```

  `src/lib/session.ts:88-112`
  ```ts
  /**
   * Persist the session. Oversized payloads are skipped and logged at info
   * level; an empty session (no slots) removes the key instead.
   */
  export function saveSession(session: SavedSession, storage: Storage | null = defaultStorage()): SaveSessionResult {
    if (!storage) return { ok: false, reason: 'unavailable' };
    if (session.slots.length === 0) {
      removeKey(storage, SESSION_KEY);
      return { ok: true, chars: 0 };
    }
    const json = serializeSession(session);
    if (json.length > MAX_SESSION_CHARS) {
      console.info(
        `[session] Autosave skipped: session is ${(json.length / 1024 / 1024).toFixed(1)} MB, over the ${MAX_SESSION_CHARS / 1024 / 1024} MB limit.`,
      );
      return { ok: false, reason: 'too-large', chars: json.length };
    }
    try {
      storage.setItem(SESSION_KEY, json);
      return { ok: true, chars: json.length };
    } catch (err) {
      console.info('[session] Autosave failed (storage full or unavailable).', err);
      return { ok: false, reason: 'storage-error', chars: json.length };
    }
  }
  ```

  `src/lib/session.ts:147-149`
  ```ts
  export function clearSession(storage: Storage | null = defaultStorage()): void {
    removeKey(storage, SESSION_KEY);
  }
  ```

  Helpers already in the file: `defaultStorage()` (guarded access to
  `window.localStorage`, may return `null`) and
  `removeKey(storage, key)` (try/catch around `removeItem`).

- `src/lib/__tests__/session.test.ts:85-96` — an existing test pins that the
  previous snapshot is kept; it stays valid:

  ```ts
  it('skips (and logs at info level) payloads over the size limit, keeping the previous save', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    saveSession(session());
    const before = localStorage.getItem(SESSION_KEY);

    const huge = session({ slots: [{ text: 'x'.repeat(MAX_SESSION_CHARS + 10) }] });
    const result = saveSession(huge);

    expect(result).toMatchObject({ ok: false, reason: 'too-large' });
    expect(info).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SESSION_KEY)).toBe(before);
  });
  ```

- `src/hooks/usePlanContext.tsx` — the provider that calls it.

  Imports (`:19-29`): `SESSION_KEY, loadSession, saveSession, clearSession, …` from `'../lib/session'`.

  Refs (`:1205-1209`):
  ```ts
  // Autosave stays off until the startup effect has decided whether to restore.
  const sessionReadyRef = useRef(false);
  const lastSavedSessionRef = useRef<string | null>(null);
  // Content encoded by the share link currently in the address bar, if any.
  const sharedContentRef = useRef<string | null>(null);
  ```

  `persistSessionNow` (`:1913-1925`) — runs 1 s after a change and on `pagehide`:
  ```ts
  const persistSessionNow = useCallback(() => {
    const session = buildSavedSession(stateRef.current);
    if (sharedContentRef.current !== null && sessionContentSignature(session) !== sharedContentRef.current) {
      sharedContentRef.current = null;
      clearPlanFromUrl();
    }
    // Compare without the timestamp so selection-only changes don't rewrite storage.
    const signature = JSON.stringify({ ...session, savedAt: '' });
    if (signature === lastSavedSessionRef.current) return;
    const result = saveSession(session);
    // Remember oversized payloads too, so the skip is logged once per change.
    if (result.ok || result.reason === 'too-large') lastSavedSessionRef.current = signature;
  }, []);
  ```

  Restore on startup (`:2034-2047`):
  ```ts
    // No plan in the URL: bring back the previous session, if any.
    let restored = false;
    if (!loadedFromUrl) {
      const saved = loadSession();
      if (saved && restoreSession(saved)) {
        restored = true;
        toastApi.show({
          tone: 'info',
          message: 'Restored your previous session',
          duration: 8000,
          action: { label: 'Start fresh', onClick: () => { void startFresh(); } },
        });
      }
    }
  ```

  `toastApi` is `useToast()` (`:1174`), a stable object.

- `site/docs.html:472` documents the autosave:
  `…and restored on your next visit, with a "Restored your previous session" toast that offers <em>Start fresh</em>. The <em>Load example</em> menu also lists…`

- Conventions: all `localStorage` access is try/catch-guarded and size-capped;
  oversized sessions are skipped, never truncated (keep that). "Old saved state
  keeps loading" — a new optional storage key is compatible. `toast` is the
  repo's channel for otherwise invisible outcomes. A user-facing behaviour
  change updates `site/docs.html` in the same change. Tests are vitest, no
  Testing Library; provider tests use `renderPlanContext` / `loadPlan` from
  `src/components/ui/__tests__/planContext.tsx`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no output after the script header |
| These tests | `npx vitest run --environment jsdom src/lib/__tests__/session.test.ts src/hooks/__tests__/sessionAutosave.test.tsx` | all pass |
| All tests | `npm test` | builds the core package, then vitest; baseline `Test Files  155 passed (155)`, `Tests  1787 passed (1787)`, ~15 s |

## Scope

**In scope** (the only files you should modify):
- `src/lib/session.ts`
- `src/lib/__tests__/session.test.ts`
- `src/hooks/usePlanContext.tsx` (import list, one new ref, `persistSessionNow`, the restore toast)
- `src/hooks/__tests__/sessionAutosave.test.tsx` (create)
- `site/docs.html` (one sentence)

**Out of scope** (do NOT touch):
- Do NOT remove or overwrite `SESSION_KEY` when a save is too large, and do not
  save a reduced session (dropping slots or trimming text). Both are data loss.
- `MAX_SESSION_CHARS` and the Recent-plans limits.
- The `.catch(() => { … })` block of the `#gz=` branch in the startup effect
  (owned by plan 002).
- `clearPlanFromUrl`, share-link code, the reducer.

## Git workflow

- Branch: `fix/autosave-skip-visible`
- Conventional-commit message, like the repo's
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`. Suggested:
  `fix(session): warn when autosave is skipped and label an older restored session`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `session.ts` — flag a kept snapshot as stale

1. Below `export const SESSION_KEY = …;` add:

   ```ts
   /**
    * Present ('1') while the snapshot under SESSION_KEY is older than the workspace
    * it came from: a later autosave was skipped as too large and left it in place.
    */
   export const SESSION_STALE_KEY = 'oraplanviz.session.stale.v1';
   ```

2. Directly above the doc comment of `saveSession` add:

   ```ts
   /** Flag the existing snapshot (if there is one) as older than the current workspace. */
   function markSessionStale(storage: Storage): void {
     try {
       if (storage.getItem(SESSION_KEY) !== null) storage.setItem(SESSION_STALE_KEY, '1');
     } catch {
       // ignore — storage unavailable
     }
   }

   /** True when the saved session is an older snapshot (a later autosave was skipped as too large). */
   export function isSessionStale(storage: Storage | null = defaultStorage()): boolean {
     if (!storage) return false;
     try {
       return storage.getItem(SESSION_STALE_KEY) === '1';
     } catch {
       return false;
     }
   }
   ```

3. In `saveSession`:
   - empty-session branch: add `removeKey(storage, SESSION_STALE_KEY);` after `removeKey(storage, SESSION_KEY);`
   - too-large branch: add `markSessionStale(storage);` between the `console.info(…);` call and the `return`
   - success branch: add `removeKey(storage, SESSION_STALE_KEY);` after `storage.setItem(SESSION_KEY, json);`
   - update the doc comment to say: oversized payloads are skipped and logged;
     the previous snapshot is kept (it may hold notes that exist nowhere else)
     and flagged as stale.

4. In `clearSession` add `removeKey(storage, SESSION_STALE_KEY);` after the existing `removeKey`.

### Step 2: `session.test.ts` — unit tests

Add `SESSION_STALE_KEY` and `isSessionStale` to the import from `'../session'`.
Directly after the existing test `skips (and logs at info level) payloads over
the size limit, keeping the previous save` (leave that test unchanged) add:

```ts
  it('flags the kept snapshot as stale when a later save is skipped, until a save succeeds', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const huge = session({ slots: [{ text: 'x'.repeat(MAX_SESSION_CHARS + 10) }] });

    // Nothing saved yet: there is no snapshot to flag.
    saveSession(huge);
    expect(isSessionStale()).toBe(false);
    expect(localStorage.getItem(SESSION_STALE_KEY)).toBeNull();

    saveSession(session());
    expect(isSessionStale()).toBe(false);
    saveSession(huge);
    expect(isSessionStale()).toBe(true);
    expect(loadSession()?.slots[0].customLabel).toBe('Before');

    saveSession(session({ slots: [{ text: 'plan C' }] }));
    expect(isSessionStale()).toBe(false);
  });

  it('drops the stale flag together with the session', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const huge = session({ slots: [{ text: 'x'.repeat(MAX_SESSION_CHARS + 10) }] });

    saveSession(session());
    saveSession(huge);
    clearSession();
    expect(isSessionStale()).toBe(false);

    saveSession(session());
    saveSession(huge);
    saveSession(session({ slots: [] }));
    expect(isSessionStale()).toBe(false);
    expect(isSessionStale(null)).toBe(false);
  });
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/session.test.ts` → all pass (2 more than before).

### Step 3: `usePlanContext.tsx` — warn once, restore truthfully

1. Import list from `'../lib/session'`: add `MAX_SESSION_CHARS,` and `isSessionStale,`.

2. Below `const lastSavedSessionRef = useRef<string | null>(null);` add:

   ```ts
   // True once the user has been told this session is too large to autosave;
   // reset by the next successful save so a later oversize episode is announced again.
   const oversizeNotifiedRef = useRef(false);
   ```

3. In `persistSessionNow`, after the line
   `if (result.ok || result.reason === 'too-large') lastSavedSessionRef.current = signature;`
   add the block below, and change the dependency array from `[]` to `[toastApi]`:

   ```ts
    if (result.ok) {
      oversizeNotifiedRef.current = false;
    } else if (result.reason === 'too-large' && !oversizeNotifiedRef.current) {
      oversizeNotifiedRef.current = true;
      const sizeMb = ((result.chars ?? 0) / 1024 / 1024).toFixed(1);
      toastApi.show({
        tone: 'warning',
        title: 'Autosave is off for this session',
        message: `The loaded plans take ${sizeMb} MB, over the ${MAX_SESSION_CHARS / 1024 / 1024} MB autosave limit. Changes from now on are not saved: a reload brings back the last saved state, not this one.`,
        duration: 15000,
      });
    }
   ```

4. In the startup effect's restore block, read the flag before restoring and
   pick the message:

   ```ts
      // Read before restoring: the autosave that follows a restore clears the flag.
      const stale = isSessionStale();
      const saved = loadSession();
      if (saved && restoreSession(saved)) {
        restored = true;
        toastApi.show({
          tone: 'info',
          message: stale
            ? 'Restored an older session: the most recent one was too large to autosave'
            : 'Restored your previous session',
          duration: 8000,
          action: { label: 'Start fresh', onClick: () => { void startFresh(); } },
        });
      }
   ```

**Verify**: `npm run lint` → exit 0 (in particular no `react-hooks/exhaustive-deps` warning); `npm run typecheck` → exit 0.

### Step 4: Provider-level tests

Create `src/hooks/__tests__/sessionAutosave.test.tsx`:

```tsx
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { SIMPLE_PLAN, loadPlan, renderPlanContext } from '../../components/ui/__tests__/planContext';
import { SESSION_KEY, SESSION_STALE_KEY } from '../../lib/session';

// A real oversized session needs > 4 MB of plan text; force the outcome instead.
const control = vi.hoisted(() => ({ tooLarge: false }));
vi.mock('../../lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/session')>();
  return {
    ...actual,
    saveSession: (...args: Parameters<typeof actual.saveSession>) =>
      control.tooLarge
        ? ({ ok: false, reason: 'too-large', chars: 5 * 1024 * 1024 } as const)
        : actual.saveSession(...args),
  };
});

const PLAN_B = SIMPLE_PLAN.replace('1234567890', '987654321').replace('ORDERS', 'ITEMS');
const PLAN_C = SIMPLE_PLAN.replace('1234567890', '555555555').replace('ORDERS', 'CUSTOMERS');
const WARNING_TITLE = 'Autosave is off for this session';

const toastText = () => document.querySelector<HTMLElement>('[data-ui-toast-region]')?.textContent ?? '';
const warningCount = () => toastText().split(WARNING_TITLE).length - 1;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
/** Run the autosave now instead of waiting for its 1 s debounce. */
const autosaveNow = () => act(() => { window.dispatchEvent(new Event('pagehide')); });

beforeEach(() => {
  control.tooLarge = false;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('autosave of an oversized session', () => {
  it('warns once per oversize episode', async () => {
    const handle = renderPlanContext();
    await loadPlan(handle);

    control.tooLarge = true;
    autosaveNow();
    expect(toastText()).toContain(WARNING_TITLE);
    expect(toastText()).toContain('5.0 MB');
    expect(toastText()).toContain('4 MB autosave limit');
    expect(warningCount()).toBe(1);

    // Still too large after another change: no second warning.
    await loadPlan(handle, PLAN_B);
    autosaveNow();
    expect(warningCount()).toBe(1);

    // A successful save re-arms the warning.
    control.tooLarge = false;
    await loadPlan(handle, PLAN_C);
    autosaveNow();
    control.tooLarge = true;
    await loadPlan(handle, SIMPLE_PLAN);
    autosaveNow();
    expect(warningCount()).toBe(2);
  });
});

describe('restore toast', () => {
  function saveSnapshot() {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 1, savedAt: '', activePlanIndex: 0, viewMode: 'hierarchical', slots: [{ text: SIMPLE_PLAN }] }),
    );
  }

  it('says "previous session" for an up-to-date snapshot', async () => {
    saveSnapshot();
    const handle = renderPlanContext();
    await flush();
    expect(handle.current().parsedPlan).not.toBeNull();
    expect(toastText()).toContain('Restored your previous session');
  });

  it('says the snapshot is older when a later autosave was skipped', async () => {
    saveSnapshot();
    localStorage.setItem(SESSION_STALE_KEY, '1');
    const handle = renderPlanContext();
    await flush();
    expect(handle.current().parsedPlan).not.toBeNull();
    expect(toastText()).toContain('Restored an older session: the most recent one was too large to autosave');
    expect(toastText()).not.toContain('Restored your previous session');

    // The restored state is saved again, which clears the flag.
    autosaveNow();
    expect(localStorage.getItem(SESSION_STALE_KEY)).toBeNull();
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/hooks/__tests__/sessionAutosave.test.tsx` → `Tests  3 passed (3)`.

### Step 5: Document it

In `site/docs.html`, in the paragraph that starts `<p>The workspace is autosaved to the browser`,
insert one sentence after `…toast that offers <em>Start fresh</em>.`:

```html
 A workspace over 4 MB is not autosaved: the app says so when that happens, and a reload brings back the last state that was saved.
```

**Verify**: `grep -c "A workspace over 4 MB is not autosaved" site/docs.html` → `1`.

### Step 6: Full gates

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0; `npm test` → all pass, 1 more test file and 5 more tests than before this plan.

## Test plan

- `src/lib/__tests__/session.test.ts` (extend; pattern: the neighbouring tests):
  stale flag set only when an older snapshot exists; cleared by a successful
  save, by `clearSession()` and by an empty-session save; `isSessionStale(null)` is false.
  The existing "keeping the previous save" test must stay green unchanged.
- `src/hooks/__tests__/sessionAutosave.test.tsx` (new; pattern:
  `src/hooks/__tests__/shareLinkRestore.test.tsx`): warning toast shown once
  per oversize episode and again after a successful save in between; restore
  toast text for a fresh and for a stale snapshot; flag cleared by the autosave
  after a restore.
- Verification: the two commands in Steps 2 and 4.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx vitest run --environment jsdom src/lib/__tests__/session.test.ts src/hooks/__tests__/sessionAutosave.test.tsx` → 0 failed
- [ ] `grep -c "keeping the previous save" src/lib/__tests__/session.test.ts` prints `1` (existing test still present)
- [ ] `grep -c "SESSION_STALE_KEY" src/lib/session.ts` prints at least `5`
- [ ] `grep -c "Autosave is off for this session" src/hooks/usePlanContext.tsx` prints `1`
- [ ] `grep -c "A workspace over 4 MB is not autosaved" site/docs.html` prints `1`
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 (baseline + 1 file, + 5 tests)
- [ ] `git status --porcelain` lists only the five in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `saveSession` no longer has the three branches quoted in "Current state"
  (empty / too-large / `setItem`), or already removes the key when too large.
- The existing test "…keeping the previous save" fails after Step 1 — the
  snapshot must not be touched by a skipped save.
- `persistSessionNow` is no longer a `useCallback` with an empty dependency
  array, or adding `toastApi` to it makes any test in
  `src/hooks/__tests__/contextStability.test.tsx` fail.
- You find yourself wanting to shrink, split or truncate the session so it
  fits — that is explicitly not allowed.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The stale flag is a separate tiny key on purpose: rewriting the (up to 4 MB)
  snapshot just to add a field would cost a parse and a write on every skipped save.
- `persistSessionNow` also runs on `pagehide`; a toast shown while the page is
  going away is harmless.
- If `MAX_SESSION_CHARS` ever changes, the toast and the docs sentence quote
  the limit — the toast computes it, the docs sentence is hard-coded "4 MB".
- Reviewer: confirm nothing in this change deletes or rewrites `SESSION_KEY`
  on the too-large path, and that the toast appears once, not on every edit.
- Deferred: offering "Save annotated plan" from the warning toast (an action
  button) so the user has a one-click manual backup; needs a UX decision.
