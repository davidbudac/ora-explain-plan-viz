---
name: pull
description:
  Pull latest origin/main into the current local branch and resolve merge
  conflicts (aka update-branch). Use when Codex needs to sync a feature branch
  with origin, perform a merge-based update (not rebase), and guide conflict
  resolution best practices.
---

# Pull

## Workflow

1. Verify git status is clean or commit/stash changes before merging.
2. Ensure rerere is enabled locally.
3. Confirm remotes and branches.
4. Fetch latest refs: `git fetch origin`
5. Sync the remote feature branch first:
   `git pull --ff-only origin $(git branch --show-current)`
6. Merge in order:
   Prefer `git -c merge.conflictstyle=zdiff3 merge origin/main` for clearer
   conflict context.
7. If conflicts appear, resolve them, then:
   `git add <files>` and `git commit` (or `git merge --continue`)
8. Verify with project checks.
9. Summarize the merge.

## Conflict Resolution Guidance (Best Practices)

- Inspect context before editing (git status, git diff, zdiff3 markers).
- Summarize the intent of both changes, decide the semantically correct outcome.
- Prefer minimal, intention-preserving edits.
- Resolve one file at a time and rerun tests after each logical batch.
- Use ours/theirs only when certain one side should win entirely.
- For generated files, resolve non-generated conflicts first, then regenerate.
- For import conflicts, accept both sides first, then lint to remove unused.
- After resolving, ensure no conflict markers remain: `git diff --check`

## When To Ask The User (Keep To A Minimum)

Ask only when:
- The correct resolution depends on product intent not inferable from code.
- The conflict crosses a user-visible contract or API surface.
- A conflict requires selecting between two mutually exclusive designs.
- The merge introduces data loss or irreversible side effects.
- The branch is not the intended target.

Otherwise, proceed with the merge, explain the decision briefly, and leave a
clear, reviewable commit history.
