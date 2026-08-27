---
title: Operating Memory System
tags:
  - operating-memory
  - context-pack
  - g-brain
  - obsidian
status: active
last_verified: 2026-08-27
---

# Operating Memory System

This folder is the lightweight source-backed context layer for ImpactWorks, Rocket Local, Codex/Nikki, ClickUp Brain, and G-Brain.

It is not the private Obsidian vault and it is not a replacement for Unabyss. It is a compiled, safe, agent-readable package that can be synced into Obsidian or G-Brain when useful.

## System roles

- Obsidian: canonical private knowledge and sensitive source material.
- Unabyss: shared cross-agent context layer.
- ClickUp: operational system of record for tasks, statuses, approvals, project execution, and CRM workflow.
- G-Brain: queryable brain/context runtime for recall, context packs, sources, and agent-facing pages.
- Codex/Nikki: compiler, validator, builder, and operator.

## Required files

- [[SOURCE-MANIFEST]]: source registry and provenance.
- [[INGESTION-LOG]]: append-only record of what was compiled.
- `state.json`: current phase, blockers, validation status, and next actions.
- [[VALIDATION-REPORT]]: latest validation results.
- [[COMPLETION-AUDIT]]: requirement-by-requirement status.

## Required folders

- `Context Packs/`: compact briefings for agents and workflows.
- `Projects/`: canonical project notes.
- `Companies/`: canonical company/client notes.
- `People/`: canonical people notes.
- `Decisions/`: durable decisions and rationale.
- `Procedures/`: reusable operating procedures.
- `Sources/`: source-trace notes and source summaries.
- `_tools/`: local validators and helper scripts.

## Operating rule

Do not ingest broad private sources or external connectors without explicit approval. Use small smoke passes, source-backed summaries, and validation before broader ingestion.

