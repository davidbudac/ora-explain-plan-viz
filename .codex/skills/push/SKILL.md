---
name: push
description:
  Push current branch changes to origin and create or update the corresponding
  pull request; use when asked to push, publish updates, or create pull request.
---

# Push

## Prerequisites

- `gh` CLI is installed and available in PATH.
- `gh auth status` succeeds for GitHub operations in this repo.

## Goals

- Push current branch changes to `origin` safely.
- Create a PR if none exists for the branch, otherwise update the existing PR.
- Keep branch history clean when remote has moved.

## Related Skills

- `pull`: use this when push is rejected or sync is not clean.

## Steps

1. Identify current branch and confirm remote state.
2. Run local validation (`npm run build && npx vitest run --environment jsdom`) before pushing.
3. Push branch to `origin` with upstream tracking if needed.
4. If push is rejected:
   - For non-fast-forward/sync problems, run the `pull` skill.
   - For auth/permissions/workflow restrictions, stop and surface the error.
5. Ensure a PR exists for the branch:
   - If no PR exists, create one.
   - If a PR exists and is open, update it.
   - If branch is tied to a closed/merged PR, create a new branch + PR.
   - Write a proper PR title that clearly describes the change outcome.
6. Write/update PR body with a clear summary of changes.
7. Reply with the PR URL from `gh pr view`.

## Notes

- Do not use `--force`; only use `--force-with-lease` as a last resort.
- Distinguish sync problems from remote auth/permission problems.
