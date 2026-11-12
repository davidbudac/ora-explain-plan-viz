# Plan 007: Page-view analytics load only in the GitHub Pages build

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- index.html vite.config.ts package.json src/App.tsx site/docs.html`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first
> and shifted line numbers; match on the quoted code, not the line number.
> `plans/019-security-docs-match-code.md` also edits the privacy section of
> `site/docs.html` and must run **after** this plan.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

`index.html` contains a static GoatCounter `<script>` tag, and only the
single-file build strips it. So every other build — the Docker image, a plain
`npm run build`, the dev server, and the DB-connector build — loads a
third-party script and reports page views of private, self-hosted instances to
the maintainer's analytics account. The docs say only "the public deployment"
counts page views and tell users with sensitive plans to self-host because
"the behavior is identical". The script URL is also protocol-relative
(`//gc.zgo.at/…`), so an instance served over plain HTTP fetches executable
code over plain HTTP. After this plan the tag is injected at build time only
when the GitHub Pages build asks for it, over `https://`, and a test keeps
`index.html` free of third-party scripts.

## Current state

The app is a client-side React 19 + TypeScript + Vite 7 app with no backend.
It is built three ways:

| Build | Command | Output | Used by |
|---|---|---|---|
| Hosted (GitHub Pages) | `npm run build:pages` | `dist/` | `.github/workflows/deploy.yml` |
| Self-hosted / Docker | `npm run build` | `dist/` | `Dockerfile` line 17 (`RUN npm run build`), `docker-compose.yml` |
| Single file | `npm run build:single` | `dist-single/index.html` | `.github/workflows/release.yml` |

Files and what they hold today:

- `index.html` — the app shell. Line 17 is the analytics tag:
  ```html
  16	  <body>
  17	    <script data-goatcounter="https://davidbudac.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
  18	    <div id="root"></div>
  19	    <script type="module" src="/src/main.tsx"></script>
  ```
- `vite.config.ts` — Vite config. The single-file plugin strips the tag
  (line 66); nothing else does:
  ```ts
  55	// `vite build --mode single`: one self-contained index.html for release
  56	// downloads. Drops what only makes sense on a hosted origin (service worker,
  57	// manifest, analytics) and inlines the icon.
  58	function singleFileHtml(): Plugin {
  59	  const icon = readFileSync('public/icon.svg', 'utf8')
  60	  return {
  61	    name: 'single-file-html',
  62	    apply: 'build',
  63	    transformIndexHtml: (html) =>
  64	      html
  65	        .replace(/\s*<link rel="(apple-touch-icon|manifest)"[^>]*>/g, '')
  66	        .replace(/\s*<script data-goatcounter[^>]*><\/script>/, '')
  67	        .replace('href="/icon.svg"', `href="data:image/svg+xml,${encodeURIComponent(icon)}"`),
  68	  }
  69	}
  70	
  71	export default defineConfig(({ mode }) => {
  72	  const single = mode === 'single'
  73	  return {
  74	    plugins: single
  75	      ? [react(), tailwindcss(), singleFileHtml(), viteSingleFile()]
  76	      : [react(), tailwindcss(), serviceWorkerBuildId()],
  77	    base: single ? './' : normalizeBasePath(process.env.APP_BASE_PATH),
  ```
  The config already reads build flags from `process.env` (`APP_BASE_PATH`,
  `PORT`); follow that pattern. The file uses no semicolons and single
  quotes — match it.
- `package.json` line 12 — the Pages build script:
  ```json
  12	    "build:pages": "APP_BASE_PATH=/ora-explain-plan-viz/ npm run build",
  ```
- `src/App.tsx` lines 800–804 — start-screen footer text shown in every build:
  ```tsx
  800	              <p className="max-w-3xl">
  801	                Everything runs in your browser: plans are never uploaded. Your last session and recent plans are kept
  802	                only in this browser&apos;s local storage. The public build counts anonymous page views with GoatCounter
  803	                and sends no plan data.
  804	              </p>
  ```
- `site/docs.html` — user documentation, privacy section:
  ```html
  1055	        <li><strong>Page views.</strong> The public deployment counts anonymous page views with GoatCounter. No plan data is sent.</li>
  ...
  1062	      <p>Plans often contain object names and literal values from predicates. If that is sensitive, self-host the app on your own network; the behavior is identical.</p>
  ```

Project rules that apply (from `CLAUDE.md` / `CONTRIBUTING.md`):

- "**Nothing leaves the browser.** The app has no backend. Don't add network
  calls, analytics or third-party scripts".
- "User-facing feature ships or changes → `site/docs.html`" in the same change.
- Style: TypeScript strict, `import type` for type-only imports.
- Tests are vitest with explicit imports, no Testing Library. Tests that read
  repository files use `node:fs` and `__dirname`; exemplar
  `src/lib/__tests__/planToJsonScript.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';

  const scripts = join(__dirname, '../../../scripts');
  ...
      const script = readFileSync(join(scripts, 'plan_to_json.sql'), 'utf-8');
  ```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Lint | `npm run lint` | exit 0, no output after the `eslint .` line |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| All tests | `npm test` | builds the core package, then vitest: all files pass (baseline at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`, about 15 s) |
| One test file | `npx vitest run --environment jsdom src/lib/__tests__/indexHtml.test.ts` | all pass |
| Self-host build | `npm run build` | exit 0, writes `dist/` (git-ignored) |
| Pages build | `npm run build:pages` | exit 0, writes `dist/` (git-ignored) |
| Single-file build | `npm run build:single` | exit 0, writes `dist-single/index.html` (git-ignored) |

## Scope

**In scope** (the only files you should modify):

- `index.html`
- `vite.config.ts`
- `package.json` (the `build:pages` script line only)
- `src/App.tsx` (the one footer sentence quoted above)
- `site/docs.html` (the "Page views" bullet and the paragraph after the list)
- `src/lib/__tests__/indexHtml.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):

- `Dockerfile`, `docker-compose.yml`, `.github/workflows/*.yml` — they must
  keep NOT setting the analytics flag; `deploy.yml` already calls
  `npm run build:pages`, which is where the flag goes.
- The Google Fonts `<link>` tags in `index.html` and the `@import` in
  `src/index.css` — fonts stay as they are (their documentation is handled in
  `plans/019-security-docs-match-code.md`).
- `CONTRIBUTING.md`, `CLAUDE.md`, `SECURITY.md` — handled in plan 019.
- `public/sw.js`, `nginx.conf`, `.env.example`.
- Do not add a Subresource Integrity (`integrity=`) attribute: `count.js` is
  an unversioned file that its host updates in place, so a pinned hash would
  break counting without notice.

## Git workflow

- Branch: `fix/analytics-pages-only`
- One commit is fine; message in the repo's conventional-commit style, e.g.
  `fix(privacy): load page-view analytics only in the GitHub Pages build`
  (compare `git log`: `fix(lint): satisfy eslint-plugin-react-hooks 7.1 / react-refresh 0.5`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the failing test

Create `src/lib/__tests__/indexHtml.test.ts` with exactly this content:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const read = (file: string) => readFileSync(join(root, file), 'utf-8');

describe('third-party scripts', () => {
  it('index.html loads no script from another host', () => {
    const external = [...read('index.html').matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi)].map(
      (m) => m[1],
    );
    expect(external).toEqual([]);
  });

  it('only the GitHub Pages build switches page-view counting on', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(Object.keys(scripts).filter((name) => scripts[name].includes('APP_ANALYTICS'))).toEqual(['build:pages']);
    for (const file of ['Dockerfile', 'docker-compose.yml', '.github/workflows/release.yml']) {
      expect(read(file), file).not.toContain('APP_ANALYTICS');
    }
  });
});
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/indexHtml.test.ts`
→ `Tests 2 failed (2)`. The first failure shows `"//gc.zgo.at/count.js"`, the
second shows expected `["build:pages"]` versus received `[]`.

### Step 2: Remove the tag from `index.html`

Delete line 17 (the whole `<script data-goatcounter=… ></script>` line).
`<body>` must then read:

```html
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
```

**Verify**: `grep -c "goatcounter" index.html` → prints `0`.

### Step 3: Inject the tag from `vite.config.ts` only when asked

In `vite.config.ts`:

1. In `singleFileHtml()`, delete the line
   `.replace(/\s*<script data-goatcounter[^>]*><\/script>/, '')` (nothing is
   left to strip) and change the comment above the function from
   `(service worker,` / `// manifest, analytics) and inlines the icon.` to
   `(service worker,` / `// manifest) and inlines the icon.`
2. Add this plugin directly above `export default defineConfig(`:

   ```ts
   // Page-view counting (GoatCounter) is injected only when APP_ANALYTICS=1, which
   // only the GitHub Pages build sets (package.json `build:pages`). Self-hosted,
   // Docker, dev-server and single-file builds never load a third-party script.
   function pagesAnalytics(): Plugin {
     return {
       name: 'pages-analytics',
       apply: 'build',
       transformIndexHtml: () => [
         {
           tag: 'script',
           attrs: {
             'data-goatcounter': 'https://davidbudac.goatcounter.com/count',
             async: true,
             src: 'https://gc.zgo.at/count.js',
           },
           injectTo: 'body',
         },
       ],
     }
   }
   ```

   (`Plugin` is already imported as a type at the top of the file.)
3. Change the start of the `defineConfig` callback to:

   ```ts
   export default defineConfig(({ mode }) => {
     const single = mode === 'single'
     const analytics = !single && process.env.APP_ANALYTICS === '1'
     return {
       plugins: single
         ? [react(), tailwindcss(), singleFileHtml(), viteSingleFile()]
         : [react(), tailwindcss(), serviceWorkerBuildId(), ...(analytics ? [pagesAnalytics()] : [])],
   ```

   Leave the remaining properties (`base`, `publicDir`, `build`, `server`,
   `preview`) unchanged.

**Verify**: `npm run typecheck` → exit 0. `grep -c "goatcounter" vite.config.ts` → `1`.

### Step 4: Set the flag in the Pages build script only

In `package.json` change line 12 to:

```json
    "build:pages": "APP_BASE_PATH=/ora-explain-plan-viz/ APP_ANALYTICS=1 npm run build",
```

**Verify**: `npx vitest run --environment jsdom src/lib/__tests__/indexHtml.test.ts`
→ `Tests 2 passed (2)`.

### Step 5: Prove each build's output

Run each build and check its HTML. `grep -c` prints the number of matching
lines (and exits 1 when that number is 0 — that is expected here).

1. `npm run build` then `grep -c "goatcounter\|gc.zgo.at" dist/index.html` → `0`
2. `npm run build:pages` then:
   - `grep -c "gc.zgo.at" dist/index.html` → `1`
   - `grep -o '<script[^>]*goatcounter[^>]*></script>' dist/index.html` → exactly
     `<script data-goatcounter="https://davidbudac.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`
   - `grep -c 'src="//gc' dist/index.html` → `0` (no protocol-relative URL)
3. `npm run build:single` then `grep -c "goatcounter\|gc.zgo.at" dist-single/index.html` → `0`
4. `npm run build` once more, so `dist/` is left as a plain self-host build.

**Verify**: all four results as stated.

### Step 6: Make the user-facing text say which builds count page views

1. `src/App.tsx` — replace the sentence
   `The public build counts anonymous page views with GoatCounter and sends no plan data.`
   (it spans two source lines) with:
   `The hosted copy at davidbudac.github.io counts anonymous page views with GoatCounter and sends no plan data; self-hosted and downloaded copies load no analytics.`
   Keep the surrounding `<p className="max-w-3xl">`, keep `&apos;` in the
   sentence before it, and wrap lines at about 120 characters like the
   neighbouring text.
2. `site/docs.html` — replace the "Page views" list item with:
   ```html
           <li><strong>Page views.</strong> The hosted copy on GitHub Pages counts anonymous page views with GoatCounter; no plan data is sent. Only that build includes the counter: the Docker image, your own <code>npm run build</code> and the single-file release load no analytics script.</li>
   ```
   and replace the paragraph after the list with:
   ```html
         <p>Plans often contain object names and literal values from predicates. If that is sensitive, self-host the app on your own network: it behaves the same, without the page-view counter.</p>
   ```

**Verify**: `grep -c "The public build counts" src/App.tsx` → `0`;
`grep -c "GoatCounter" src/App.tsx` → `1`;
`grep -c "load no analytics script" site/docs.html` → `1`;
`grep -c "the behavior is identical" site/docs.html` → `0`.

### Step 7: Full check

**Verify**: `npm run lint` → exit 0; `npm run typecheck` → exit 0; `npm test`
→ all files pass, with one more test file and two more tests than before you
started (at the planned commit: `Test Files 156 passed (156)`, `Tests 1789 passed (1789)`).

## Test plan

- New file `src/lib/__tests__/indexHtml.test.ts` (content in Step 1), two tests:
  - `index.html loads no script from another host` — the regression test for
    this plan.
  - `only the GitHub Pages build switches page-view counting on` — guards the
    Docker, compose and release paths against gaining the flag.
- Structural pattern: `src/lib/__tests__/planToJsonScript.test.ts` (reads
  repository files with `node:fs`).
- The built output is not covered by a unit test (a build takes seconds and
  writes `dist/`); Step 5 is the manual proof and its greps are repeated in
  the done criteria.

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 and includes `indexHtml.test.ts` with 2 passing tests
- [ ] `grep -c "goatcounter" index.html` prints `0`
- [ ] After `npm run build:pages`: `grep -c 'src="https://gc.zgo.at/count.js"' dist/index.html` prints `1`
- [ ] After `npm run build`: `grep -c "goatcounter\|gc.zgo.at" dist/index.html` prints `0`
- [ ] After `npm run build:single`: `grep -c "goatcounter\|gc.zgo.at" dist-single/index.html` prints `0`
- [ ] `grep -rn "APP_ANALYTICS" Dockerfile docker-compose.yml .github` prints nothing
- [ ] `git status --porcelain` lists only the six in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `index.html` line 17 or the `singleFileHtml()` body does not match the
  excerpts (the code has drifted).
- `npm run build:pages` produces a `dist/index.html` with zero or more than
  one analytics tag, or the tag is not inside `<body>`.
- Any build fails after Step 3 with an error mentioning `transformIndexHtml`
  or `pagesAnalytics` and one fix attempt does not resolve it.
- You find the analytics flag would have to be set in `Dockerfile`,
  `docker-compose.yml` or a workflow to make something pass — that is the
  opposite of this plan's intent.

## Maintenance notes

- The first deploy from `main` after this lands is the real proof that
  counting still works: open the hosted app once and confirm a page view
  arrives in the GoatCounter dashboard. If none arrives, check that
  `.github/workflows/deploy.yml` still runs `npm run build:pages`.
- `APP_ANALYTICS` lives in the `build:pages` npm script, so anyone who runs
  that script (for example a fork that deploys its own Pages copy) builds
  with the upstream counter. If that ever matters, move the flag into the
  `Build` step of `deploy.yml` (`env: APP_ANALYTICS: '1'`), which already runs
  only in the upstream repository, and update the test in Step 1.
- No `integrity` attribute on purpose (see Scope). If analytics must be
  tamper-evident, self-host a pinned copy of `count.js` under `public/`
  instead.
- Reviewers: check that no build other than Pages sets the flag and that the
  docs sentences match what the builds really do.
- Deferred: the Google Fonts requests made by every build are unchanged here;
  documenting them accurately is part of `plans/019-security-docs-match-code.md`.
