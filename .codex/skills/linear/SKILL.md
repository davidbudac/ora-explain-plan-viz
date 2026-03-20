---
name: linear
description: |
  Use Symphony's `linear_graphql` client tool for raw Linear GraphQL
  operations such as comment editing and upload flows.
---

# Linear GraphQL

Use this skill for raw Linear GraphQL work during Symphony app-server sessions.

## Primary tool

Use the `linear_graphql` client tool exposed by Symphony's app-server session.

Tool input:
  {
    "query": "query or mutation document",
    "variables": { "optional": "graphql variables object" }
  }

## Discovering unfamiliar operations

Use targeted introspection through `linear_graphql` (list mutations, inspect
input types, etc.).

## Common workflows

- Query an issue by key, identifier, or id
- Query team workflow states for an issue
- Edit an existing comment (commentUpdate)
- Create a comment (commentCreate)
- Move an issue to a different state (issueUpdate)
- Attach a GitHub PR to an issue (attachmentLinkGitHubPR)
- Upload a video to a comment (fileUpload + curl + commentCreate)
- Introspection patterns for schema discovery

## Usage rules

- Use `linear_graphql` for comment edits, uploads, and ad-hoc Linear API queries.
- Prefer the narrowest issue lookup that matches what you already know.
- For state transitions, fetch team states first and use exact `stateId`.
- Prefer `attachmentLinkGitHubPR` over generic URL attachment for GitHub PRs.
- Do not introduce new raw-token shell helpers for GraphQL access.
