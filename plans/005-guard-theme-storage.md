# Plan 005: The app starts and switches theme when `localStorage` is blocked

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- src/hooks/usePlanContext.tsx src/hooks/__tests__`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first and
> shifted line numbers; match on the quoted code, not the line number.
> `src/hooks/usePlanContext.tsx` is also edited by
> `plans/002-keep-session-on-corrupt-share-link.md`,
> `plans/003-flag-stale-session-when-autosave-skipped.md` and
> `plans/004-share-from-single-file-build.md` (other regions of the file).

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (`plans/001-typecheck-tests.md` first is recommended, not required)
- **Category**: bug
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

Browsers throw on `localStorage` access when site data is blocked (Chrome
"don't allow sites to save data", cookies blocked in Firefox or Safari, a
sandboxed iframe, some `file://` setups — relevant for the single-file release).
The project rule is that every `localStorage` access is try/catch-guarded so
that such a browser only loses persistence. Two accesses for the theme are not
guarded, and the first one runs while the global state is being created: the
whole app fails to mount and the user sees only the error fallback. After this
plan the app starts with the system colour scheme and theme switching works for
the visit; nothing else changes.

## Current state

- `src/hooks/usePlanContext.tsx` — global state provider (`PlanProvider`).

  `src/hooks/usePlanContext.tsx:250-255` — runs inside the `useReducer`
  initialiser (`getInitialState()` at `:404-406` calls it):
  ```ts
  const getInitialTheme = (): Theme => {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  ```

  `src/hooks/usePlanContext.tsx:1760-1775` — the theme effect:
  ```ts
  // Apply theme + app palette to document
  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    // 'slate' is the built-in look: drop the attribute so no palette block matches.
    if (state.palette === 'slate') {
      delete root.dataset.palette;
    } else {
      root.dataset.palette = state.palette;
    }
    localStorage.setItem('theme', state.theme);
  }, [state.theme, state.palette]);
  ```

  These are the only two code lines in the file that touch `localStorage`
  directly (`grep -n "localStorage" src/hooks/usePlanContext.tsx` shows them
  plus two comments).

- The pattern to match — every other storage access in the repo is guarded, e.g.
  `src/lib/settings.ts:170-171`:
  ```ts
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
  ```
  and `src/lib/session.ts:6-7`: "All storage access is wrapped in try/catch:
  private windows, disabled site data and quota errors must never break the
  app, only skip persistence."

- Test environment facts: `vitest.setup.ts` installs a `window.matchMedia` stub
  that never matches, so the fallback theme in tests is `'light'`. Tests stub
  the storage global with `vi.stubGlobal('localStorage', …)` and undo it with
  `vi.unstubAllGlobals()` (see `src/lib/__tests__/settings.test.ts:5-13`).
  Provider tests render the real `PlanProvider` with `renderPlanContext()` from
  `src/components/ui/__tests__/planContext.tsx`; the handle's `current()`
  returns the context value, which has `theme` and `setTheme(theme)`.

- Conventions: TypeScript strict; `import type` for type-only imports; tests
  are vitest (`import { describe, it, expect } from 'vitest'`), no Testing Library.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0, no output after the script header |
| This test file | `npx vitest run --environment jsdom src/hooks/__tests__/themeStorage.test.tsx` | all pass |
| All tests | `npm test` | builds the core package, then vitest; baseline `Test Files  155 passed (155)`, `Tests  1787 passed (1787)`, ~15 s |

## Scope

**In scope** (the only files you should modify):
- `src/hooks/usePlanContext.tsx` (`getInitialTheme` and the one `setItem` line)
- `src/hooks/__tests__/themeStorage.test.tsx` (create)

**Out of scope** (do NOT touch):
- A shared storage helper module (`src/lib/storage.ts` or similar) and the
  other, already guarded, `localStorage` call sites (`TabularView.tsx`,
  `PlanTextView.tsx`, `FlameView.tsx`, `settings.ts`, `session.ts`) — a
  consolidation is a separate refactor.
- The storage key name `'theme'` — existing users have it saved.
- The palette / `data-palette` logic in the same effect.
- `site/docs.html` — no documented behaviour changes.

## Git workflow

- Branch: `fix/guard-theme-storage`
- Conventional-commit message, like the repo's
  `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`. Suggested:
  `fix(theme): guard the theme localStorage read and write`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the failing test

Create `src/hooks/__tests__/themeStorage.test.tsx`:

```tsx
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '../../components/ui/__tests__/testUtils';
import { renderPlanContext } from '../../components/ui/__tests__/planContext';

/** localStorage as browsers expose it when site data is blocked: every call throws. */
function blockedStorage(): Storage {
  const deny = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return { length: 0, clear: deny, getItem: deny, key: deny, removeItem: deny, setItem: deny };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
  localStorage.clear();
});

describe('theme persistence', () => {
  it('remembers the chosen theme across mounts', () => {
    const first = renderPlanContext();
    expect(first.current().theme).toBe('light');
    act(() => first.current().setTheme('dark'));
    expect(localStorage.getItem('theme')).toBe('dark');
    cleanup();

    const second = renderPlanContext();
    expect(second.current().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('starts and switches theme when localStorage is blocked', () => {
    vi.stubGlobal('localStorage', blockedStorage());

    const handle = renderPlanContext();
    // vitest.setup.ts stubs matchMedia to never match, so the fallback is light.
    expect(handle.current().theme).toBe('light');

    act(() => handle.current().setTheme('dark'));
    expect(handle.current().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/hooks/__tests__/themeStorage.test.tsx`
→ 1 failed, 1 passed. The failing one is
`starts and switches theme when localStorage is blocked`, with
`SecurityError: The operation is insecure.` and `getInitialTheme` in the stack.
`remembers the chosen theme across mounts` passes (it pins today's behaviour).

### Step 2: Guard the read

Replace `getInitialTheme` with:

```ts
const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Storage blocked (site data disabled, sandboxed iframe): use the system preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
```

### Step 3: Guard the write

In the theme effect replace the single line

```ts
    localStorage.setItem('theme', state.theme);
```

with

```ts
    try {
      localStorage.setItem('theme', state.theme);
    } catch {
      // Storage blocked or full: the theme still applies for this visit.
    }
```

Do not change the effect's dependency array or anything above that line.

**Verify**: `npx vitest run --environment jsdom src/hooks/__tests__/themeStorage.test.tsx`
→ `Tests  2 passed (2)`.

### Step 4: Full gates

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0;
`npm test` → all pass, 1 more test file and 2 more tests than before this plan.

## Test plan

- New file `src/hooks/__tests__/themeStorage.test.tsx` (code in Step 1;
  structural pattern: `src/hooks/__tests__/shareLinkRestore.test.tsx` for the
  provider rendering, `src/lib/__tests__/settings.test.ts` for stubbing storage):
  1. *remembers the chosen theme across mounts* — unchanged behaviour with
     working storage (write on change, read on next mount, `dark` class applied);
  2. *starts and switches theme when localStorage is blocked* — **the
     regression test**: provider mounts, falls back to the system preference,
     and `setTheme` still works although the write throws.
- Verification: `npx vitest run --environment jsdom src/hooks/__tests__/themeStorage.test.tsx` → 2 passed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx vitest run --environment jsdom src/hooks/__tests__/themeStorage.test.tsx` → 2 passed, 0 failed
- [ ] `grep -n "localStorage\.\(getItem\|setItem\)" src/hooks/usePlanContext.tsx` prints exactly 2 lines, and each is the first statement inside a `try {` block (check the line above each)
- [ ] `grep -c "localStorage.getItem('theme')" src/hooks/usePlanContext.tsx` prints `1` (key name unchanged)
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 (baseline + 1 file, + 2 tests)
- [ ] `git status --porcelain` lists only `src/hooks/usePlanContext.tsx` and `src/hooks/__tests__/themeStorage.test.tsx` (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `getInitialTheme` or the `localStorage.setItem('theme', state.theme);` line
  quoted in "Current state" is no longer in `src/hooks/usePlanContext.tsx`
  (for example the theme moved into `src/lib/settings.ts`).
- In Step 1 the "blocked" test passes before the fix, or the "remembers" test fails.
- After the fix the "blocked" test still throws from somewhere other than the
  two lines you changed — report the stack; it means another unguarded storage
  access exists and this plan's scope is too narrow.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Any new direct `localStorage` use in `usePlanContext.tsx` must be guarded the
  same way; the "blocked" test only catches accesses on the mount and
  theme-switch paths.
- If the raw call sites across the app are later routed through one guarded
  helper, fold these two in and keep the test.
- Reviewer: the key stays `'theme'` and the fallback order stays "stored value,
  else system preference".
