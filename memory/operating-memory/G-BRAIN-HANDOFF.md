---
title: G-BRAIN-HANDOFF
tags:
  - operating-memory
  - g-brain
  - handoff
status: active
last_verified: 2026-08-27
---

# G-BRAIN-HANDOFF

Use this when syncing the compiled operating-memory package into G-Brain.

## Current observed state

- G-Brain MCP is reachable from Codex.
- Health check returned a valid dashboard.
- Skill catalog is reachable.
- This Codex task exposed write-side G-Brain tools after tool discovery.
- Published pages with `put_page`.
- Logged the ingest with `log_ingest`.
- Verified retrieval with `search`.

## Synced pages

- `context-packs/impactworks-rocket-local-agent-brief`
- `context-packs/google-drive-ingest-brief-2026-08-27`
- `operating-memory/source-manifest`
- `sources/google-drive-smoke-ingest-2026-08-27`

## First page to retrieve

```text
ImpactWorks Rocket Local Agent Brief
```

Suggested tags:

```text
impactworks, rocket-local, context-pack, agent-brief, source-backed
```

## Runtime instruction for G-Brain-aware agents

```text
Before answering questions about ImpactWorks, Rocket Local, project portfolio, proposals, client work, or agent responsibilities, retrieve the "ImpactWorks Rocket Local Agent Brief" context pack from G-Brain. Treat it as a high-level routing brief, not as proof of mutable current state. Verify live statuses in ClickUp, Vendasta, Drive, Gmail, Calendar, or the relevant system of record before making consequential claims or changes.
```

## Sync rule

Do not sync raw private Obsidian notes, Gmail threads, calendar events, credentials, relationship-sensitive notes, or client-private source material into G-Brain unless Dante explicitly approves that source and scope.
