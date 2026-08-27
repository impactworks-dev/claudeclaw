---
title: G-Brain Sync Procedure
tags:
  - procedure
  - g-brain
  - context-pack
status: active
last_verified: 2026-08-27
---

# G-Brain Sync Procedure

## Purpose

Push validated operating-memory context packs into G-Brain so G-Brain-aware agents can retrieve compact, source-backed context.

## Preflight

- Run `npm run context:validate`.
- Confirm [[VALIDATION-REPORT]] has no failures.
- Confirm the source scope is approved in [[SOURCE-MANIFEST]].
- Confirm G-Brain write tools are available in the current environment.

## Suggested sync order

1. [[SOURCE-MANIFEST]]
2. [[ImpactWorks Rocket Local Agent Brief]]
3. Workflow-specific context packs.
4. Project-specific context packs.

## G-Brain page metadata

Use tags that make retrieval obvious:

- `context-pack`
- `source-backed`
- `impactworks`
- `rocket-local`
- workflow tag, for example `portfolio`, `proposal`, `crm`, or `delivery`

## Agent retrieval rule

Agents should query G-Brain for the narrowest relevant context pack before starting a project-specific task. They should not pull broad memory unless the narrow pack is insufficient.

## Verification rule

G-Brain context is a briefing layer. Verify mutable state in the relevant system of record before acting:

- ClickUp for tasks, statuses, CRM workflow, and project execution.
- Vendasta for current account/product/company records.
- Drive/Figma/filesystem for current assets.
- Gmail/Calendar for current communications and scheduling.

