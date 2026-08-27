---
title: Google Drive Smoke Ingest 2026-08-27
tags:
  - source-trace
  - google-drive
  - smoke-ingest
source_status: source-backed
last_verified: 2026-08-27
---

# Google Drive Smoke Ingest 2026-08-27

## Scope

Controlled first pass over high-signal Google Drive files for ImpactWorks, Rocket Local, portfolio, proposal, and client-project memory.

## Ingested sources

### ImpactWorks Automation Services.pdf

- Source ID: `gdrive-impactworks-automation-services`
- Drive ID: `1xtLInyFYZiRM2E9B95g_i5bjSY4YvU6v`
- Modified: 2026-08-26
- Summary: ImpactWorks offers automation services that map business processes, build workflows in Make, Zapier, n8n, or ClickUp, and monitor/optimize with error handling, alerts, reporting, retries, and dead-letter handling.
- Extracted offer themes: lead follow-up, client onboarding, invoicing and billing, reporting, email sequences, task creation, notifications, and data sync.

### ImpactWorks Project Management Services.pdf

- Source ID: `gdrive-impactworks-project-management-services`
- Drive ID: `1X7oxU4xWQkezJ5mfo3YJ7KFy-VvL0elJ`
- Modified: 2026-08-26
- Summary: ImpactWorks offers project management setup and optimization: workspace architecture, sprint planning, dashboards, resource planning, SOPs/templates, time tracking, custom views, reporting, training, and support.
- Extracted offer themes: replace spreadsheet chaos with shared priorities, ownership, reusable templates, and leadership visibility.

### ImpactWorks Integration Services.pdf

- Source ID: `gdrive-impactworks-integration-services`
- Drive ID: `1oMs8w3sqryEH1WyaBBc2sfgJJwbXizZs`
- Modified: 2026-08-26
- Summary: ImpactWorks offers systems integration services connecting Google Workspace, Microsoft 365, CRM/Vendasta, Twilio/voice, Make/Zapier, custom APIs, ClickUp, AI agents, and bots.
- Extracted offer themes: eliminate duplicate data entry, automate triggers and follow-up, keep data consistent, and build monitored unattended integrations.

### AI Consulting Blueprint 2026

- Source ID: `gdrive-ai-consulting-blueprint-2026`
- Drive ID: `1gwR9tEI3sMuu0E0r8Bb5hlVTkTTzut__NWaFCE3Bk9I`
- Modified: 2025-10-01
- Summary: Reference material for AI consulting agency operations across marketing, sales, onboarding, fulfillment, and retention. Includes Upwork profile templates, proposal scripts, Loom scripts, kickoff SOPs, client update templates, delivery email templates, walkthrough scripts, reactivation templates, and workflow library references.
- Sensitivity: external/reference. Use as inspiration and workflow pattern material, not as ImpactWorks-owned proof.

### fishbat-ai-platform-proposal

- Source ID: `gdrive-fishbat-ai-platform-proposal`
- Drive ID: `1SNivQ5JrIihnuj3oiTz7pOH4z6xC43rUVxAb6880XSI`
- Modified: 2026-07-28
- Summary: ImpactWorks/Fishbat proposal positioning an AI operating model for faster response, consistent execution, clearer visibility, and a repeatable platform layer across Fishbat's portfolio. Includes Conversations AI, CRM AI, Social AI, Reputation AI, Local SEO, WordPress Hosting, Campaigns Pro, Advanced Reporting, and optional Fishbat-branded client dashboard.
- Sensitivity: client-confidential. Use for internal proposal/project context, not public claims without approval.

### Conversations AI Presentation - Dante Crescenzi

- Source ID: `gdrive-conversations-ai-presentation`
- Drive ID: `1HUA7fMocbrv1RDP10v8CnDmgTHAQFoFyxB5Phd3JhzU`
- Modified: 2026-07-16
- Summary: Rocket Local AI sales deck describing an AI-native customer acquisition and engagement platform. Core ideas: acquire and engage customers with an AI workforce, personalize engagement using business data, scale through automation and insights, never miss leads, support 24/7 engagement, and manage local growth products including CRM, Campaigns, Local SEO, Advertising Intelligence, Multi-Location LaunchPad, and Mission Reports.
- Note: One extracted slide contains a typo in the email address. Do not promote that typo into canonical contact details.

### ZAGG-Revenue-Sharing-Agreement-Redline.docx

- Source ID: `gdrive-zagg-revenue-sharing-redline`
- Drive ID: `1rMY4vTa6EwbIWDDRZqq34GxaGCqZ2R1_`
- Modified: 2026-08-11
- Summary: Sensitive legal/business agreement draft around the ZAGG Phone Repair Platform. It confirms the project scope includes participating ZAGG franchise locations, Protection Pass, repair packages, AI voice/chat, WordPress, Repair Plugin, Vendasta, hosting, automation, integrations, and collaborative responsibilities between ZAGG Phone Repair/Ralph and Rocket Local/ImpactWorks/Dante.
- Sensitivity: sensitive-legal. Do not expose full agreement language, signatures, legal terms, or financial details in broad context packs. Use only high-level project facts unless Dante explicitly asks for agreement analysis.

### ImpactWorks Portfolio.pdf

- Source ID: `gdrive-impactworks-portfolio-pdf`
- Drive ID: `1nrdKvaeLCq2FC-W1VuaFBTZf4l7tFtib`
- Modified: 2026-08-26
- Summary: Large PDF export of ImpactWorks Figma portfolio. It is already represented by the local portfolio inventory workflow and should not be re-ingested raw in this smoke pass.

## Excluded from this pass

- Broad Gmail.
- Broad Drive history.
- Private Obsidian vault content.
- Full ZAGG legal text.
- Large portfolio PDF raw content.
- Old unrelated PDF templates and third-party reference PDFs.

