---
title: Build Source-Backed Context Pack
tags:
  - procedure
  - context-pack
  - operating-memory
status: active
last_verified: 2026-08-27
---

# Build Source-Backed Context Pack

## Purpose

Create compact, reusable, source-backed context for agents without dumping an entire vault or connector history.

## Steps

1. Define the bounded task scope.
2. Identify approved sources.
3. Add or update source rows in [[SOURCE-MANIFEST]].
4. Read only the smallest useful source set.
5. Extract durable facts, decisions, procedures, open loops, and source references.
6. Write one context pack under `Context Packs/`.
7. Link every important claim to a source note, manifest row, or system of record.
8. Run `npm run context:validate`.
9. Update [[INGESTION-LOG]], [[VALIDATION-REPORT]], [[COMPLETION-AUDIT]], and `state.json`.
10. Sync to G-Brain only after validation passes and the source scope is approved.

## Output shape

Each context pack should include:

- `Use this when`
- `Essential context`
- `Current state`
- `Decisions`
- `Open loops`
- `Agent instructions`
- `Source references`
- `Staleness / verification notes`

## Stop conditions

Pause before:

- Broad Gmail, Calendar, Drive, ClickUp, Vendasta, or CRM ingestion.
- Deep historical import.
- External writes or mutations.
- Copying private raw notes into compiled context.
- Any expensive, slow, or privacy-sensitive ingestion.

