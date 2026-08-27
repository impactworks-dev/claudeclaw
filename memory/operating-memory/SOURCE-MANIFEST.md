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
| gdrive-clients-folder-05 | 05 Clients | Google Drive folder | `0B4bblaz25V1sOWRMSWVHZEhSWDg` | inspected-second-pass | client-confidential | Canonical ImpactWorks clients folder checked on 2026-08-27. |
| gdrive-zagg-folder | ZAGG Phone Repair | Google Drive folder | `0B4bblaz25V1sWEdPOWtDeU54Mkk` | inspected-second-pass | client-confidential | Canonical ZAGG folder under 05 Clients. |
| gdrive-zagg-repair-platform-deck | The ZAGG Repair Platform | Google Slides | `1BOmpY0ViLjoAWusq-WFBmQ0lS-RfshTUdMcDG6CWIJk` | ingested-second-pass | client-confidential | Franchise scheduling, AI communication, hosting, and rollout platform deck. |
| gdrive-data-check-folder | Data Check Systems | Google Drive folder | `1qOvzn0HC-I3ZU0XsHKTLdi-EBLK4NYwy` | inspected-second-pass | client-confidential | Canonical Data Check folder under 05 Clients. |
| gdrive-dcs-customer-portal-proposal | DCS Customer Portal Proposal (IMPACTWORKS) | Google Doc | `1BUngsgYwQ5_6H1eGLca2kyaW9amDIhGdU1ViKv9v-xo` | ingested-second-pass | client-confidential | Portal dashboard/redirection/header/report-block scope. |
| gdrive-dcs-website-redesign-realignment | DCS Website Redesign & Realignment (IMPACTWORKS) | Google Doc | `1nVnxEH5EF-mn7caN2UYZb4XsV_nj47HQvbVk7DBFJRg` | ingested-second-pass | client-confidential | Website redesign, CMS, conversion content, SEO, forms, responsive build. |
| gdrive-dcs-web-engineering-meeting | Web Engineering: https://datachecksystems.com/ | Google Doc | `17pNIv_T9JNTGKoLI8JAblM0ZZxTUxhejPTL2lhrgG0k` | ingested-second-pass | client-confidential | Meeting notes for portal reports, uploads, contact forms, search, and WordPress/plugin direction. |
| gdrive-dcs-website-feedback | Website Feedback & Revisions | Google Doc | `1-HD5SMuptgMwKm82pZGR6J9U0dVTTahl9dT_gWmF2xc` | ingested-second-pass | client-confidential | Evidence of website fixes and revision cycle. |
| gdrive-pdg-folder | Preventative Diagnostics Group | Google Drive folder | `1t61yVAy72s38ctoukqdKdAufJu_QbtSv` | inspected-second-pass | client-confidential | Parent client folder containing VascuScreen. |
| gdrive-vascuscreen-folder | Vascuscreen | Google Drive folder | `1hDLDBwhgK9UvSbQFBilkoCoNCRapc2ws` | inspected-second-pass | client-confidential | Child folder under Preventative Diagnostics Group, empty on direct listing. |
| gdrive-vascuscreen-health-intelligence-portal | VascuScreen — Health Intelligence Portal | Google Slides | `1eaRXD_2Okj2-J6HIJ-EkS0Qzn8uQ6KRGGRmIs0uy-yY` | ingested-second-pass | client-confidential | Full-stack AI medical portal deck. |
| gdrive-vascuscreen-content-meeting | Vascuscreen Content and Meeting - 2026/08/20 10:59 EDT - Notes by Gemini | Google Doc | `1RqfciE3HZJikXxPwMtledCiiJOesfP0LLyHhW3exk2s` | ingested-second-pass | client-confidential | AI agent strategy, portal/API discussion, organizational context, meeting-first workflow. |
| gdrive-pdg-three-site-quote | QUOTE__ImpactWorks_-_Preventative_Diagnostics_Group_-_Website_Design___Build | Google Doc | `1hcC16JF2sKfoQfB6quWjYDCNN6uJOfpyZv1wdch81TM` | ingested-second-pass | client-confidential | Three-site WordPress/Elementor scope for VascuScreen, PDG, and IG Biz Advisors. |
| gdrive-iron-gate-folder | Iron Gate Partners | Google Drive folder | `1pGsqeG7ouMmZIBedvtUM-vHJBQMDd_C3` | inspected-second-pass | client-confidential | Client folder containing IG Advisors website copy and sales decks. |
| gdrive-ig-advisors-website-copy | IG Advisors Website Copy.docx | Google Drive DOCX | `1PQXyml92TXfSZBVK8uf6SdQ8zIv0Xda_` | ingested-second-pass | client-confidential | Website copy for tariff recovery and Section 125/FICA optimization. |
| gdrive-reesource-folder | Reesource Pest | Google Drive folder | `1M6Z4fqutTCtBOOEcWinLSGkgnjO43u6B` | inspected-second-pass | client-confidential | Client folder with website assets, AI knowledge, and service recommendations. |
| gdrive-reesource-recommended-services | Reesource Pest Recomended Services | Google Doc | `1PJ_4YJIAL2ryrQ8e4P8WxC2C9LMmujYf3gn-CeTRQvU` | ingested-second-pass | client-confidential | Rocket Local/Vendasta recommended-services stack and 0BYD storefront links. |

## Connector status

| Connector | Connected here | Read observed | Write observed | Notes |
|---|---:|---:|---:|---|
| G-Brain MCP | yes | yes | yes | Published context packs/source manifest/source trace via `put_page`; logged ingest via `log_ingest`; retrieval verified with `search`. |
| ClickUp | no | no | no | No ClickUp connector exposed in this task. Use ClickUp prompts/manual entry unless connected. |
| Unabyss | yes | yes | yes | Stored high-level durable pointers/status facts about operating-memory package, G-Brain sync, and agent retrieval rules. Do not duplicate full context packs into Unabyss. |
| Obsidian filesystem | path known | repo/path only | not used | This implementation avoids writing to the private vault directly. |
