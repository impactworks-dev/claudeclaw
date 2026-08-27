---
title: SOURCE-MANIFEST
tags:
  - operating-memory
  - source-manifest
status: active
last_verified: 2026-08-27
---

# SOURCE-MANIFEST

This manifest tracks sources approved for the compiled operating-memory package.

| Source ID | Source | Type | Location | Status | Sensitivity | Notes |
|---|---|---:|---|---|---|---|
| source-claudeclaw-repo | ClaudeClaw repository | repo | `/Users/dantecrescenzi/claudeclaw` | approved-smoke | internal | Used for public/general agent operating docs, not private Obsidian content. |
| source-memory-summary | Codex memory summary | memory | Codex memory context | approved-smoke | internal | Used to seed high-level roles and known current architecture. Verify mutable facts before acting. |
| source-gbrain-health | G-Brain MCP health/catalog | mcp | `mcp__gbrain.get_health`, `mcp__gbrain.list_skills` | approved-smoke | internal | Read-only check confirmed G-Brain is reachable and advertises context-pack/source tools. |
| source-obsidian-path | Local Obsidian vault path config | repo-config | `CLAUDE.md`, `docs/SETUP_NOTES.md`, `src/brain-data.ts` | approved-reference | private-path | Confirms vault path only. Do not copy sensitive vault contents into this package. |
| gdrive-impactworks-automation-services | ImpactWorks Automation Services.pdf | Google Drive PDF | `1xtLInyFYZiRM2E9B95g_i5bjSY4YvU6v` | ingested-smoke | business-public | Offer sheet for automation services. |
| gdrive-impactworks-project-management-services | ImpactWorks Project Management Services.pdf | Google Drive PDF | `1X7oxU4xWQkezJ5mfo3YJ7KFy-VvL0elJ` | ingested-smoke | business-public | Offer sheet for project management services. |
| gdrive-impactworks-integration-services | ImpactWorks Integration Services.pdf | Google Drive PDF | `1oMs8w3sqryEH1WyaBBc2sfgJJwbXizZs` | ingested-smoke | business-public | Offer sheet for systems integration services. |
| gdrive-ai-consulting-blueprint-2026 | AI Consulting Blueprint 2026 | Google Doc | `1gwR9tEI3sMuu0E0r8Bb5hlVTkTTzut__NWaFCE3Bk9I` | ingested-smoke | external/reference | Reference/template material for AI consulting, Upwork, proposals, onboarding, delivery, and retention. |
| gdrive-fishbat-ai-platform-proposal | fishbat-ai-platform-proposal | Google Slides | `1SNivQ5JrIihnuj3oiTz7pOH4z6xC43rUVxAb6880XSI` | ingested-smoke | client-confidential | Proposal for Fishbat AI operating model and client-facing expansion. |
| gdrive-conversations-ai-presentation | Conversations AI Presentation - Dante Crescenzi | Google Slides | `1HUA7fMocbrv1RDP10v8CnDmgTHAQFoFyxB5Phd3JhzU` | ingested-smoke | business-public | Rocket Local AI / Conversations AI sales deck. |
| gdrive-zagg-revenue-sharing-redline | ZAGG-Revenue-Sharing-Agreement-Redline.docx | Google Drive DOCX | `1rMY4vTa6EwbIWDDRZqq34GxaGCqZ2R1_` | ingested-smoke | sensitive-legal | Redline agreement for ZAGG Phone Repair Platform. Summarize only; do not expose full terms in broad context. |
| gdrive-impactworks-portfolio-pdf | ImpactWorks Portfolio.pdf | Google Drive PDF | `1nrdKvaeLCq2FC-W1VuaFBTZf4l7tFtib` | referenced-existing | large-portfolio | Large Figma portfolio export; use existing local extraction rather than broad raw ingest. |

## Connector status

| Connector | Connected here | Read observed | Write observed | Notes |
|---|---:|---:|---:|---|
| G-Brain MCP | yes | yes | yes | Published context packs/source manifest/source trace via `put_page`; logged ingest via `log_ingest`; retrieval verified with `search`. |
| ClickUp | no | no | no | No ClickUp connector exposed in this task. Use ClickUp prompts/manual entry unless connected. |
| Unabyss | yes | yes | yes | Stored high-level durable pointers/status facts about operating-memory package, G-Brain sync, and agent retrieval rules. Do not duplicate full context packs into Unabyss. |
| Obsidian filesystem | path known | repo/path only | not used | This implementation avoids writing to the private vault directly. |
