# Plan 018: Release, Pages and Docker builds run on Node 22 with least-privilege workflow tokens

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b5635d8..HEAD -- .github/workflows .github/dependabot.yml Dockerfile site/docs.html`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Other plans may have landed first
> and shifted line numbers; match on the quoted code, not the line number.
> Several other plans edit `site/docs.html`; this plan changes one sentence
> in its Docker section only.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (configuration only — but it cannot be executed locally; see "Maintenance notes" for the first real run)
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `b5635d8`, 2026-11-11

## Why this matters

CI tests the code on Node 22, but the two workflows that produce what users
actually run — the GitHub Pages deploy and the release of the single-file
HTML — build (and, for the release, test) on Node 20, which reached
end-of-life on 2026-04-30; the Docker image builds on `node:20-alpine` too. So
shipped artifacts come from a runtime that no longer gets security fixes and
that CI never exercises. Separately, the release workflow gives a
repository-write token to the same job that runs `npm ci` and `npm test`
(third-party code): a malicious dependency could alter the repository or the
published file that DBAs open from disk with production plans, and users have
no checksum to verify the download. After this plan every build uses Node 22,
jobs that run third-party code have read-only tokens, the release publishes a
`.sha256` next to the HTML, and Dependabot watches the Docker base images.

## Current state

- `.github/workflows/ci.yml` — lint, typecheck, tests on PRs and pushes to
  `main`. No `permissions:` block. Already on Node 22:
  ```yaml
  8	concurrency:
  9	  group: ci-${{ github.ref }}
  10	  cancel-in-progress: true
  ...
  37	        uses: actions/setup-node@v7
  38	        with:
  39	          node-version: 22
  40	          cache: npm
  ```
- `.github/workflows/deploy.yml` — builds and deploys GitHub Pages:
  ```yaml
  14	permissions:
  15	  contents: read
  16	  pages: write
  17	  id-token: write
  ...
  23	jobs:
  24	  build:
  25	    # Only the upstream repo has a Pages site; forks must not try to deploy.
  26	    if: github.repository == 'davidbudac/ora-explain-plan-viz'
  27	    runs-on: ubuntu-latest
  28	    steps:
  29	      - name: Checkout
  30	        uses: actions/checkout@v7
  31	
  32	      - name: Setup Node.js
  33	        uses: actions/setup-node@v7
  34	        with:
  35	          node-version: 20
  36	          cache: npm
  ...
  47	      - name: Setup Pages
  48	        uses: actions/configure-pages@v6
  49	
  50	      - name: Upload artifact
  51	        uses: actions/upload-pages-artifact@v5
  ...
  55	  deploy:
  56	    environment:
  57	      name: github-pages
  58	      url: ${{ steps.deployment.outputs.page_url }}
  59	    runs-on: ubuntu-latest
  60	    needs: build
  61	    steps:
  62	      - name: Deploy to GitHub Pages
  63	        id: deployment
  64	        uses: actions/deploy-pages@v5
  ```
- `.github/workflows/release.yml` — one job, write token, Node 20
  (the file is 54 lines; lines 14–54 shown):
  ```yaml
  14	permissions:
  15	  contents: write
  16	
  17	jobs:
  18	  release:
  19	    if: github.repository == 'davidbudac/ora-explain-plan-viz'
  20	    runs-on: ubuntu-latest
  21	    env:
  22	      TAG: ${{ inputs.tag || github.ref_name }}
  23	    steps:
  24	      - name: Checkout
  25	        uses: actions/checkout@v7
  26	        with:
  27	          ref: ${{ env.TAG }}
  28	
  29	      - name: Setup Node.js
  30	        uses: actions/setup-node@v7
  31	        with:
  32	          node-version: 20
  33	          cache: npm
  34	
  35	      - name: Install dependencies
  36	        run: npm ci
  37	
  38	      - name: Test
  39	        run: npm test
  40	
  41	      - name: Build single file
  42	        run: |
  43	          npm run build:single
  44	          cp dist-single/index.html "oraplanviz-$TAG.html"
  45	
  46	      - name: Publish release
  47	        env:
  48	          GH_TOKEN: ${{ github.token }}
  49	        run: |
  50	          if gh release view "$TAG" >/dev/null 2>&1; then
  51	            gh release upload "$TAG" "oraplanviz-$TAG.html" --clobber
  52	          else
  53	            gh release create "$TAG" "oraplanviz-$TAG.html" --title "$TAG" --generate-notes
  54	          fi
  ```
  Lines 1–12 (name, comment, `on:` with `push: tags: ['v*']` and
  `workflow_dispatch` input `tag`) stay unchanged.
- `Dockerfile` — `1  FROM node:20-alpine AS builder` … `19  FROM nginx:1.27-alpine AS runtime`.
- `.github/dependabot.yml` — two `updates` entries (`npm`, `github-actions`);
  no `docker` entry. The npm entry ignores major versions on purpose:
  ```yaml
  8	    # Major upgrades (TypeScript, ESLint, React, …) are done on purpose, not by bot.
  9	    ignore:
  10	      - dependency-name: "*"
  11	        update-types: ["version-update:semver-major"]
  ```
- `site/docs.html` line 284 documents the image:
  `(Node 20 build → nginx 1.27 runtime)`.
- `CONTRIBUTING.md` already says "Node 22 (what CI uses)".

Action versions to use (latest majors of the first-party actions, checked on
2026-11-11; the repo already uses `actions/checkout@v7` and
`actions/setup-node@v7`): `actions/upload-artifact@v7` (inputs `name`, `path`,
`if-no-files-found`) and `actions/download-artifact@v8` (inputs `name`,
`path`).

Repo conventions: workflow files use two-space YAML indentation, a blank line
between steps, and short `#` comments that explain *why*.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| YAML syntax | `node -e "const y=require('js-yaml'),fs=require('fs');for(const f of process.argv.slice(1)){y.load(fs.readFileSync(f,'utf8'));console.log('ok',f)}" .github/workflows/ci.yml .github/workflows/deploy.yml .github/workflows/release.yml .github/dependabot.yml` | four `ok …` lines, exit 0 |
| YAML syntax (fallback if `js-yaml` is missing) | `python3 -c "import sys,yaml;[yaml.safe_load(open(f)) for f in sys.argv[1:]];print('ok')" .github/workflows/*.yml .github/dependabot.yml` | `ok` |
| Structure check | the long `node -e` command in Step 5 | the exact JSON shown there |
| Lint / typecheck / tests | `npm run lint`, `npm run typecheck`, `npm test` | exit 0 (baseline at `b5635d8`: `Test Files 155 passed (155)`, `Tests 1787 passed (1787)`) |
| Docker build (only if `docker info` exits 0) | `docker build -t ora-explain-plan-viz:plan018 .` | exit 0 |

Run all commands from the repository root (the `node -e` commands resolve
`js-yaml` from `./node_modules`, where it is installed as a dependency of
ESLint).

## Scope

**In scope** (the only files you should modify):

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/release.yml`
- `.github/dependabot.yml`
- `Dockerfile` (line 1 only)
- `site/docs.html` (the one "Node 20 build" sentence)

**Out of scope** (do NOT touch, even though they look related):

- The `nginx:1.27-alpine` tag — do not guess a newer tag; the new Dependabot
  entry will propose one.
- Pinning actions to commit SHAs, build-provenance attestations — deferred
  (see "Maintenance notes").
- The `on:` triggers, `concurrency`, `paths-ignore` and the
  `if: github.repository == …` guards of every workflow.
- The "Docs-only change?" step in `ci.yml`.
- `package.json` `engines`, `.nvmrc` — not introduced here.
- `docker-compose.yml`, `nginx.conf`.

## Git workflow

- Branch: `ci/node-22-release-hardening`
- Conventional-commit messages in the repo's style
  (`ci: skip the work on docs-only PRs; don't redeploy for docs-only pushes`), e.g.
  `ci: build releases and Pages on Node 22 with read-only build jobs`,
  `chore(docker): build on node:22-alpine; let Dependabot watch base images`.
- Do NOT push, tag, or open a PR unless the operator instructed it. **Never
  create or push a `v*` tag and never start the release workflow yourself.**

## Steps

### Step 1: `ci.yml` — read-only token

Insert between the `on:` block and `concurrency:`:

```yaml
permissions:
  contents: read

```

**Verify**: the YAML syntax command prints `ok .github/workflows/ci.yml`.

### Step 2: `deploy.yml` — Node 22, write access only on the deploy job

1. Replace the workflow-level block (lines 14–17) with:
   ```yaml
   # Read-only by default; each job below asks for exactly what it needs.
   permissions:
     contents: read
   ```
2. In the `build` job, add after `runs-on: ubuntu-latest`:
   ```yaml
       # Installs and runs third-party code: no write access here.
       permissions:
         contents: read
         pages: read
   ```
   (`pages: read` is for `actions/configure-pages`, which reads the Pages
   site settings.)
3. In the `build` job change `node-version: 20` to `node-version: 22`.
4. In the `deploy` job, add after `needs: build`:
   ```yaml
       permissions:
         pages: write
         id-token: write
   ```

**Verify**: the YAML syntax command prints `ok .github/workflows/deploy.yml`.

### Step 3: `release.yml` — split into a read-only build job and a publish job

Keep lines 1–12 as they are and replace everything from `permissions:` to
the end of the file with:

```yaml
# Read-only by default: the job that installs and runs third-party code (npm ci,
# tests, build) gets no write token. Only `publish` may write the release.
permissions:
  contents: read

jobs:
  build:
    if: github.repository == 'davidbudac/ora-explain-plan-viz'
    runs-on: ubuntu-latest
    env:
      TAG: ${{ inputs.tag || github.ref_name }}
    steps:
      - name: Checkout
        uses: actions/checkout@v7
        with:
          ref: ${{ env.TAG }}
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Test
        run: npm test

      - name: Build single file
        run: |
          npm run build:single
          mkdir release
          cp dist-single/index.html "release/oraplanviz-$TAG.html"
          cd release
          sha256sum "oraplanviz-$TAG.html" > "oraplanviz-$TAG.html.sha256"

      - name: Upload build
        uses: actions/upload-artifact@v7
        with:
          name: single-file
          path: release/
          if-no-files-found: error

  publish:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    env:
      TAG: ${{ inputs.tag || github.ref_name }}
      GH_TOKEN: ${{ github.token }}
      # No checkout in this job, so tell gh which repository to act on.
      GH_REPO: ${{ github.repository }}
    steps:
      - name: Download build
        uses: actions/download-artifact@v8
        with:
          name: single-file
          path: release

      - name: Publish release
        working-directory: release
        run: |
          if gh release view "$TAG" >/dev/null 2>&1; then
            gh release upload "$TAG" "oraplanviz-$TAG.html" "oraplanviz-$TAG.html.sha256" --clobber
          else
            gh release create "$TAG" "oraplanviz-$TAG.html" "oraplanviz-$TAG.html.sha256" --title "$TAG" --generate-notes
          fi
```

Notes on why it is shaped this way (do not "simplify" these away):
- `publish` has no `if:`; it is skipped automatically when `build` is skipped
  (forks), because of `needs: build`.
- The checksum is written from inside `release/` so the `.sha256` file names
  the bare file and `sha256sum -c oraplanviz-<tag>.html.sha256` works for a
  user who downloaded both files into one folder.
- The asset name `oraplanviz-$TAG.html` must not change: the README and docs
  refer to it.

**Verify**: the YAML syntax command prints `ok .github/workflows/release.yml`;
`grep -c "contents: write" .github/workflows/release.yml` → `1`.

### Step 4: Docker base image and Dependabot

1. `Dockerfile` line 1: `FROM node:22-alpine AS builder`. Leave line 19 as is.
2. Append to `.github/dependabot.yml` (same indentation as the other entries):
   ```yaml
     - package-ecosystem: docker
       directory: /
       schedule:
         interval: weekly
       # The Node major is chosen on purpose and kept equal to node-version in the workflows.
       ignore:
         - dependency-name: node
           update-types: ["version-update:semver-major"]
   ```
3. `site/docs.html`: change `(Node 20 build → nginx 1.27 runtime)` to
   `(Node 22 build → nginx 1.27 runtime)`.

**Verify**:
- `grep -c "node:22-alpine" Dockerfile` → `1`; `grep -c "node:20\|Node 20" Dockerfile site/docs.html` → `0` for both files
- the YAML syntax command prints `ok .github/dependabot.yml`
- `grep -c "package-ecosystem" .github/dependabot.yml` → `3`

### Step 5: Check the structure of all three workflows mechanically

Run from the repository root (one line):

```bash
node -e "const yaml=require('js-yaml'),fs=require('fs');const load=f=>yaml.load(fs.readFileSync('.github/workflows/'+f,'utf8'));const [ci,dep,rel]=['ci.yml','deploy.yml','release.yml'].map(load);const nodeVersions=[ci,dep,rel].flatMap(w=>Object.values(w.jobs).flatMap(j=>(j.steps||[]).filter(s=>String(s.uses||'').startsWith('actions/setup-node')).map(s=>s.with['node-version'])));console.log(JSON.stringify({nodeVersions,workflowPermissions:[ci.permissions,dep.permissions,rel.permissions],deployBuild:dep.jobs.build.permissions,deployDeploy:dep.jobs.deploy.permissions,releaseJobs:Object.keys(rel.jobs),releaseBuild:rel.jobs.build.permissions||null,releasePublish:rel.jobs.publish.permissions,persistCredentials:rel.jobs.build.steps[0].with['persist-credentials']}))"
```

**Verify**: the output is exactly

```json
{"nodeVersions":[22,22,22],"workflowPermissions":[{"contents":"read"},{"contents":"read"},{"contents":"read"}],"deployBuild":{"contents":"read","pages":"read"},"deployDeploy":{"pages":"write","id-token":"write"},"releaseJobs":["build","publish"],"releaseBuild":null,"releasePublish":{"contents":"write"},"persistCredentials":false}
```

### Step 6: Local checks that are possible

1. `npm run lint && npm run typecheck && npm test` → all exit 0 (nothing in
   the app changed; this confirms the tree is otherwise intact).
2. `npm run build:single && (cd dist-single && sha256sum index.html)` → prints
   a 64-hex-digit checksum (confirms the build command the release job runs).
3. Docker, **only if** `docker info >/dev/null 2>&1` exits 0:
   `docker build -t ora-explain-plan-viz:plan018 .` → exit 0, then
   `docker image rm ora-explain-plan-viz:plan018`. If `docker info` fails,
   skip this sub-step and write "Docker build not verified (no Docker
   daemon)" in your report — do not install Docker.

**Verify**: sub-steps 1 and 2 succeed; sub-step 3 succeeds or is reported as skipped.

## Test plan

There is no unit-test surface: these are CI configuration files. Verification
is (a) YAML syntax, (b) the structural JSON check in Step 5, (c) the local
build/test commands the workflows invoke, (d) an optional local Docker build.
None of this executes the workflows. The first real proof happens on GitHub
and belongs to the operator — see "Maintenance notes".

## Done criteria

- [ ] YAML syntax command prints four `ok` lines
- [ ] Step 5 command prints exactly the expected JSON
- [ ] `grep -rn "node-version: 20\|node:20" .github Dockerfile` prints nothing
- [ ] `grep -c "persist-credentials: false" .github/workflows/release.yml` prints `1`
- [ ] `grep -c "sha256" .github/workflows/release.yml` prints at least `3`
- [ ] `grep -c "package-ecosystem: docker" .github/dependabot.yml` prints `1`
- [ ] `npm run lint`, `npm run typecheck`, `npm test` exit 0
- [ ] `git status --porcelain` lists only the six in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any workflow no longer matches the excerpts (for example the release job
  was already split, or action versions differ from `checkout@v7` /
  `setup-node@v7`).
- You are tempted to trigger a workflow to "test" it: do not run
  `gh workflow run`, do not push a tag, do not re-run the release workflow
  for an existing tag — a re-run replaces the published release asset
  (`--clobber`).
- `docker build` fails with an error that comes from the Node 22 base image
  (not from network access or a missing daemon).
- `npm test` or the builds fail locally — unrelated to this plan, but the
  release job would fail the same way; report it.

## Maintenance notes

- **Operator follow-up (required, cannot be done by the executor):**
  1. After merge, the push to `main` runs CI and "Deploy to GitHub Pages".
     Watch both. If the Pages `build` job fails in "Setup Pages" or "Upload
     artifact" with a permission error, its `permissions:` block is the
     cause; if `deploy` fails with a permission error, check that it has
     `pages: write` and `id-token: write`. Reverting this commit restores the
     previous behaviour.
  2. The release workflow is first exercised by the **next** version tag.
     Check that the release then carries both `oraplanviz-<tag>.html` and
     `oraplanviz-<tag>.html.sha256`. Do not use `workflow_dispatch` on an old
     tag to try it out unless replacing that release's asset is acceptable.
- Node 22 leaves maintenance in April 2027. The Node major now appears in four
  places that must move together: `ci.yml`, `deploy.yml`, `release.yml`
  (`node-version`) and `Dockerfile` (`node:<major>-alpine`), plus the sentence
  in `site/docs.html`. A single `.nvmrc` read through `node-version-file`
  would reduce that to two; deferred.
- Deferred hardening: pin actions to commit SHAs (Dependabot's
  `github-actions` entry keeps SHA pins current), and attach a build
  provenance attestation to the release asset (`actions/attest-build-provenance`,
  needs `id-token: write` and `attestations: write` on the build job).
- The checksum protects against a corrupted or swapped download from a
  mirror; it does not protect against a compromised release job, because it
  is produced by the same job as the file.
- Dependabot will now open weekly PRs for `nginx` (and Node minor/patch
  tags). When it bumps nginx, update the "nginx 1.27 runtime" wording in
  `site/docs.html`.
- Reviewers: confirm no job that runs `npm ci` holds a write permission, and
  that the `publish` job runs no repository code (no checkout, no npm).
