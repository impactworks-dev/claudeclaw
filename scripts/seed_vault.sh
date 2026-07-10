#!/bin/bash
# Seed Dante's Obsidian vault with canonical wiki notes.
# Drops 16 anchor notes organized into Business/People/System/Principles folders.
set -e

VAULT="/Users/dantecrescenzi/Documents/Claude/Obsidian Brain/Obsidian Brain"
mkdir -p "$VAULT/Business" "$VAULT/People" "$VAULT/System" "$VAULT/Principles"

# ---- People ----
cat > "$VAULT/People/Dante.md" <<'NOTE'
---
title: Dante
aliases: [Dante Crescenzi, me, founder]
tags: [identity, primary]
---

# Dante Crescenzi

Serial entrepreneur and technologist focused on democratizing AI for real businesses. Currently running two ventures in parallel: [[ImpactWorks]] and [[Rocket Local AI]].

## Core thesis
Most companies are drowning in manual busywork that AI can handle. The biggest wins come from outcome-first automation, not technology-for-its-own-sake.

## How I think
- Practicality over hype
- Outcome-first — measurable results beat shiny tech
- Democratize so non-technical founders can own and understand their own solutions
- Transparency over "black box" magic
- Human-centric AI: automate the grunt work, keep customer-facing output personal
- Speed and clarity over analysis paralysis

## Communication style
Direct, concise, professional but friendly. Hate sycophancy, fluff, and AI clichés. When I ask for something I want the output, not a plan.

## Day-to-day stack
- [[ClaudeClaw]] is my personal AI assistant via Telegram + [[Mission Control]]
- [[Nikki]] is the main agent identity
- [[Founder Dashboard]] is my morning glance

## Key relationships
- [[Audra]] — partner
NOTE

cat > "$VAULT/People/Audra.md" <<'NOTE'
---
title: Audra
aliases: [partner]
tags: [people, primary]
---

# Audra

My partner. Reviews briefings, runs operational rhythms with me. The [[Audra weekly brief]] is a recurring deliverable Nikki helps produce.

## Cadence
Audra typically reviews briefings before 9am ET — pattern observed across multiple weeks.

## Context
- Co-driver on operational decisions for [[ImpactWorks]] and [[Rocket Local AI]]
- Recipient of the weekly prep brief Nikki generates
NOTE

cat > "$VAULT/People/Nikki.md" <<'NOTE'
---
title: Nikki
aliases: [ClaudeClaw, main agent, the bot]
tags: [identity, system, primary]
---

# Nikki

The personal AI assistant I run. Accessible via Telegram, [[Mission Control]] dashboard chat, and War Room voice meetings — same persona on every channel.

## Personality
Chill, grounded, straight up. Talks like a real person, not a language model. No em dashes, no AI clichés, no sycophancy. Only pushes back when there's a real reason.

## Voice
Currently using ElevenLabs voice **Amelia** (ID `ZF6FPAbjXT4488VcRRnw`). See [[Voice config]].

## Where she lives
- Telegram bot (primary)
- [[Mission Control]] chat card on the [[Founder Dashboard]]
- WarRoom voice rooms
- 4 sub-agents (comms, content, ops, research) for delegated work

## Architecture
Built on the [[ClaudeClaw]] system. SQLite memory DB for cross-session recall, [[Brain]] page for canonical wiki context (this vault).

## Model
Default is `claude-opus-4-6`. Can be swapped per agent.
NOTE

# ---- Business ----
cat > "$VAULT/Business/ImpactWorks.md" <<'NOTE'
---
title: ImpactWorks
aliases: [ImpactWorks LLC, IW]
tags: [business, agency, primary]
---

# ImpactWorks

Specialized digital agency doing AI strategy, workflow automation (Zapier / Make / Airtable), agentic AI development, and full-stack digital services. impactworks.com.

## Flagship offering
**AI Automation Audit** — the lead product. Outcome-first analysis that shows clients exactly which manual workflows AI can take over and what the ROI is.

## Adjacent product
**Gearbox** — proprietary local-SEO and Google Business Profile management platform.

## Delivery model
3-week fixed-scope sprints. "Speed with certainty."

## 5-phase methodology
1. Discovery
2. Design
3. Implementation
4. Capacity Building
5. Sustainability

## ICP
Ambitious SMB to mid-market brands, multi-location enterprises, e-commerce/SaaS.

## Social impact pledge
ImpactWorks Collective donates 10% of consulting earnings to local orgs.

## Related
- [[Rocket Local AI]]
- [[Q3 strategic plan]]
- [[BID partnership campaign]]
- [[Dante]]
NOTE

cat > "$VAULT/Business/Rocket Local AI.md" <<'NOTE'
---
title: Rocket Local AI
aliases: [Rocket Local, RL]
tags: [business, agency, primary]
---

# Rocket Local AI

AI-powered local marketing and business automation agency. rocketlocal.ai.

## Services
- AI-Powered Local SEO
- Reputation management automation
- AI marketing execution
- Hyperlocal optimization (neighborhood-level, not just city-level)
- Business operations AI

## Primary ICP
- Home service providers (roofing, HVAC, plumbing)
- Medical practices
- Boutique retail
- Multi-location brands that live or die by the Google Map Pack

## Distribution play
[[BID partnership campaign]] — partner with North Carolina Business Improvement Districts to deliver Tier 1 (free baseline) and Tier 2 ($169/mo) services to their member businesses.

## Related
- [[ImpactWorks]]
- [[Dante]]
- [[Q3 strategic plan]]
NOTE

cat > "$VAULT/Business/BID partnership campaign.md" <<'NOTE'
---
title: BID partnership campaign
aliases: [BID campaign, BIDs, NC BIDs]
tags: [business, distribution, active]
---

# BID partnership campaign

Distribution funnel for [[Rocket Local AI]] via North Carolina Business Improvement Districts.

## The play
BID directors get a free tool that helps their member businesses, which makes the BID look good. We get warm intros to the member businesses, who then become Tier 2 paid customers.

## Roster
41 NC BIDs imported to ClickUp. Each one represents a portfolio of member businesses behind them.

## Two-tier funnel
- **Tier 1** — free baseline service offered to all BID members.
- **Tier 2** — $169/mo. The actual monetization.

## Outreach flow
Initial email → reply → Discovery Webinar booked → Endorsed → member onboarding

## Current state
Outreach Tracker page in [[Mission Control]] is the live dashboard. Top-3 priority BIDs are typically Charlotte, Raleigh, and Greensboro (highest member counts).

## Where deals die
Replies without webinar bookings. The Founder Dashboard flags this as a critical attention item.

## Related
- [[Rocket Local AI]]
- [[Q3 strategic plan]]
NOTE

cat > "$VAULT/Business/Q3 strategic plan.md" <<'NOTE'
---
title: Q3 strategic plan
aliases: [Q3 plan, Q3 strategy]
tags: [strategy, active, primary]
---

# Q3 strategic plan

## Top-line pushes
1. **AI Automation Audit as flagship** for [[ImpactWorks]] — make it the lead conversation, not "we do AI stuff."
2. **Scale [[Rocket Local AI]]** via the [[BID partnership campaign]] funnel.
3. **Two-tier monetization** — $169/mo Tier 2 is the unit economics core for the BID-driven distribution.

## Operating principles for the quarter
- Outcome-first ROI in every audit deliverable
- Speed with certainty: 3-week fixed-scope sprints win
- BID partnerships are the cheapest acquisition channel — protect that funnel

## Watch items
- Replies-without-webinars conversion gap on the BID side
- Cash runway — see [[Cash & QuickBooks]]
- Sub-agent reliability — Nikki sub-agents (comms/content/ops/research) need to be available 100% of the time

## Cross-links
[[ImpactWorks]] · [[Rocket Local AI]] · [[BID partnership campaign]] · [[Founder Dashboard]]
NOTE

# ---- System ----
cat > "$VAULT/System/ClaudeClaw.md" <<'NOTE'
---
title: ClaudeClaw
aliases: [the system, AI infrastructure]
tags: [system, architecture, primary]
---

# ClaudeClaw

The Node.js Telegram bot + Hono dashboard server running on Fly.io that powers [[Nikki]] and [[Mission Control]].

## Where it runs
- **Fly.io app:** `claudeclaw-impactworks`
- **Live domain:** `claudeclaw.impactworks.com`
- **Persistent volume:** memory DB, voice config, Obsidian vault (Syncthing), agent state

## Code
- Repo: `impactworks-dev/claudeclaw` on GitHub
- Auto-deploys via GitHub Actions on push to `main`
- Direct deploy fallback via `flyctl deploy --remote-only`

## Sub-agents
4 background agents in the same container, each with own Telegram bot token:
- **comms** — outbound messaging, customer comms
- **content** — content drafts
- **ops** — operational checks, status
- **research** — deep dives, market intel

## Connectors
Gmail, Google Calendar, Google Drive, Notion, HubSpot, ClickUp, Canva, Make, Supabase, Vercel, Gamma, Figma. Plus the local Obsidian vault (this one), accessed via Syncthing -> [[Brain]] page.

## Related
- [[Mission Control]]
- [[Nikki]]
- [[Voice config]]
- [[Brain]]
- [[Founder Dashboard]]
NOTE

cat > "$VAULT/System/Mission Control.md" <<'NOTE'
---
title: Mission Control
aliases: [the dashboard, MC]
tags: [system, ui, primary]
---

# Mission Control

The web dashboard at claudeclaw.impactworks.com. Single sign-on via `DASHBOARD_TOKEN` — first visit you land via Telegram deep link, after that the cookie keeps you in.

## Pages
**Workspace**
- [[Founder Dashboard]] — home, daily glance
- Mission Control task board
- Scheduled — cron-driven recurring jobs
- Agents — running state of [[Nikki]] + sub-agents
- Sales Pipeline
- Outreach Tracker — [[BID partnership campaign]] state
- Webinars
- BID Members
- Cash — banking + QBO (see [[Cash & QuickBooks]])
- Chat — full Nikki chat thread

**Intelligence**
- [[Brain]] — Obsidian wiki (this vault)
- Memories — SQLite memory DB
- Hive Mind — agent activity feed
- Usage — token + cost stats
- Audit — security log

**Collaborate**
- War Room — voice meetings with Nikki

**Configure**
- Settings

## Built by
Original Mission Control v1 by GitHub user `promptadvisers` (initial release Feb 2026, Mission Control commit Mar 1 2026). [[Dante]] ported to v2 Vite + Preact and has been extending since May 2026.
NOTE

cat > "$VAULT/System/Founder Dashboard.md" <<'NOTE'
---
title: Founder Dashboard
aliases: [founder home, /founder]
tags: [system, ui, daily-use]
---

# Founder Dashboard

The home page at /founder. The single glance I take every morning.

## What's on it
**Attention strip** — the ONE thing that needs me right now.

**Row 1: Cash + Sales Pipeline**
- Cash: Total Cash, MTD Revenue, MTD Net, Runway. When QB connected, MTD numbers come from real accounting (not Plaid heuristics).
- Pipeline: Open Deals, Pipeline Value, Weighted, Customers + MRR

**Row 2: Outreach + Members**
- Outreach: [[BID partnership campaign]] funnel + top-3 priority BIDs
- Members: BID Members (Tier 2) MRR + pipeline ceiling

**Row 3: Stocks + AI News + [[Nikki]] (3/3/2 split)**
- Stocks watchlist with add/remove, click for candle chart
- AI News past 24h via Google News RSS
- Nikki card: avatar + online status + chat input with mic + speaker toggle

**Watchlist** — remaining attention items ranked by severity.

## Related
- [[Mission Control]]
- [[Cash & QuickBooks]]
- [[BID partnership campaign]]
- [[Nikki]]
NOTE

cat > "$VAULT/System/Voice config.md" <<'NOTE'
---
title: Voice config
aliases: [Nikki voice, TTS]
tags: [system, voice]
---

# Voice config

[[Nikki]]'s voice is unified across Telegram, WarRoom, and [[Mission Control]] dashboard chat.

## Current voice
**Amelia — young and enthusiastic** (ElevenLabs voice ID `ZF6FPAbjXT4488VcRRnw`, professional category).

## Voice settings (ElevenLabs balanced defaults)
- stability 0.5
- similarity_boost 0.75
- style 0
- speed 1.0
- use_speaker_boost true
- model `eleven_multilingual_v2`

Reverted to defaults after trying sultry/warm tunings — those made her sound mechanical.

## Where the voice ID lives
- Volume override: `/app/store/voice-config.json` on the Fly volume — this wins
- Env var fallback: `ELEVENLABS_VOICE_ID` Fly secret
- Picker in Mission Control [[Founder Dashboard]] Nikki card updates the volume override -> applies to all channels without restart

## TTS cascade
ElevenLabs -> Gradium -> Kokoro (local) -> macOS say. Failures fall through.

## STT
Groq Whisper (primary) -> local whisper-cpp fallback.
NOTE

cat > "$VAULT/System/Cash & QuickBooks.md" <<'NOTE'
---
title: Cash & QuickBooks
aliases: [Cash page, QBO, banking]
tags: [system, finance]
---

# Cash & QuickBooks

Two data sources, layered.

## Plaid (banking)
- Connected to Novo (production) plus 4 credit cards
- Source of truth for **Total Cash** + **cash burn**
- Categorization is Plaid heuristics — okay for cash flow, not great for P&L

## QuickBooks Online (accounting)
- ImpactWorks production realm `9130353734958806`
- Source of truth for **MTD Revenue**, **MTD Net**, **Runway** when connected
- Pulled via the QBO stdio MCP connector

## On the [[Founder Dashboard]]
Cash tile shows totals from Plaid. When QB connected, MTD Rev / MTD Net / Runway overlay from QB. Title gets a "QB · ImpactWorks" badge.

## Credit cards
4 cards via Plaid. Pay-bill links in the Cash page tiles. Do NOT touch them when refactoring.

## Endpoints
- `/api/cash` — Plaid summary, 5min cache
- `/api/qb` — QuickBooks P&L, 1hr cache
- `/api/cash/import-csv` — manual upload (Apple Card)

## Related
- [[Founder Dashboard]]
NOTE

cat > "$VAULT/System/Brain.md" <<'NOTE'
---
title: Brain
aliases: [Obsidian brain, second brain, wiki]
tags: [system, ui]
---

# Brain

The Brain page in [[Mission Control]] (`/brain`) renders this Obsidian vault as a structured, searchable, link-aware knowledge base.

## Architecture
- Vault on Mac: `~/Documents/Claude/Obsidian Brain/Obsidian Brain`
- Syncthing mirrors to Fly: `/app/store/obsidian-brain`
- Backend `src/brain-data.ts` walks the vault, parses frontmatter + `[[wikilinks]]` + `#tags`, builds the link graph, 5min cache
- Frontend renders 3 panes: vault tree, link graph, note detail

## Why
Karpathy's argument: opaque vector-DB memory is hard to debug and edit. A wiki of curated markdown files is the canonical source-of-truth — version-controlled, portable, you take it with you.

## Two-tier memory architecture
- **Canonical truth (this wiki)** -> strategic plans, identity, decisions, principles
- **Auto-captured (SQLite memory DB)** -> raw conversations, ephemeral facts

Phase 3 wires both into [[Nikki]]'s context injection with source attribution.

## What belongs here vs. memory DB
| Belongs in wiki | Belongs in memory DB |
|---|---|
| [[Q3 strategic plan]] | Today's standup notes |
| [[ImpactWorks]] positioning | Random fact from a call |
| Strategic meeting summaries | Raw meeting transcripts |
| ClickUp Docs (long-form) | Individual ClickUp task fluff |

## Status
- Phase 1: backend data layer + API endpoints — shipped
- Phase 2: Brain page in Mission Control — shipped
- Phase 3: wire into Nikki context injection + promotion-proposal feed — pending
NOTE

# ---- Principles ----
cat > "$VAULT/Principles/Practical over hype.md" <<'NOTE'
---
title: Practical over hype
aliases: [practical AI, outcome first]
tags: [principles, primary]
---

# Practical over hype

Core operating principle for both [[ImpactWorks]] and [[Rocket Local AI]] — and for how I use [[Nikki]] personally.

## What it means
- Measurable outcomes beat impressive demos
- "AI" in a pitch isn't a feature — the outcome it produces is
- Don't ship technology that needs explaining; ship results clients can see
- Pre-built playbooks > bespoke novelty

## How it shows up in product
- [[ImpactWorks]] flagship is the AI Automation Audit — explicitly outcome-first
- 3-week fixed-scope sprints (speed with certainty)
- [[Rocket Local AI]] sells outcomes: better Map Pack ranking, more 5-star reviews

## How it shows up in my AI assistant
- [[Nikki]] no AI clichés, no narration, execute -> output -> confirm

## Related
- [[Democratize technology]]
- [[Speed and clarity]]
NOTE

cat > "$VAULT/Principles/Democratize technology.md" <<'NOTE'
---
title: Democratize technology
aliases: [democratization, non-technical founders]
tags: [principles, primary]
---

# Democratize technology

Non-technical founders deserve to OWN their own solutions and understand them — not be vendor-locked into black-box services they can't audit, edit, or take with them.

## What it means
- Tools clients can read, edit, and version themselves
- Open-source over proprietary where reasonable
- Explain the mechanism, don't just sell the magic
- Build infrastructure clients can ABSORB, not just rent

## Why this matters
If only technical people can navigate AI, the gap between haves and have-nots widens. That's the opposite of the mission.

## How it shows up
- [[ImpactWorks]] methodology has a Capacity Building phase — explicit knowledge transfer
- [[Rocket Local AI]] dashboards show WHY ranking moved, not just that it did
- [[ClaudeClaw]] / [[Mission Control]] is itself an example: a personal AI system I OWN, not rent
- This [[Brain]] vault is plain markdown — portable, editable, takeable

## Related
- [[Practical over hype]]
- ImpactWorks Collective — 10% donation pledge
NOTE

cat > "$VAULT/Principles/Speed and clarity.md" <<'NOTE'
---
title: Speed and clarity
aliases: [speed with certainty, decisive]
tags: [principles]
---

# Speed and clarity

Bias toward shipping. Analysis paralysis is the enemy.

## What it means
- 3-week fixed-scope sprints over open-ended discovery (the [[ImpactWorks]] model)
- Direct communication over hedged caveats
- Decisions made with available info, revised when better info arrives
- Outline plan -> execute -> confirm; don't loop on planning

## How [[Nikki]] reflects this
- "Just do it" mode by default
- One short clarifying question if a request is genuinely ambiguous, then execute
- No narration of what she's about to do
- Push back only when there's a real risk I might not have considered

## Related
- [[Practical over hype]]
- [[Democratize technology]]
NOTE

# ---- Welcome (overwrite the existing placeholder) ----
cat > "$VAULT/Welcome.md" <<'NOTE'
---
title: Welcome
tags: [meta]
---

# Welcome to the Brain

This vault is my **canonical second brain** — curated truth that [[Nikki]] reads as context on every conversation.

## How to use it
- Drop new notes anywhere. Use `[[wikilinks]]` to connect them.
- Sub-folders organize: **Business**, **People**, **System**, **Principles**.
- Whatever lands here syncs to Fly in seconds via Syncthing -> the [[Brain]] page in [[Mission Control]] picks it up.

## What lives where
- **Canonical, curated** -> here
- **Auto-captured, ephemeral** -> the SQLite memory DB (runs on its own)

## Anchor notes to start from
- [[Dante]] — me
- [[Nikki]] — the assistant
- [[ImpactWorks]] / [[Rocket Local AI]] — the two businesses
- [[Q3 strategic plan]] — current quarter focus
- [[BID partnership campaign]] — active distribution play
- [[ClaudeClaw]] — the system
- [[Mission Control]] — the dashboard
- [[Founder Dashboard]] — daily glance
- [[Cash & QuickBooks]] — money
- [[Voice config]] — how Nikki talks
- [[Brain]] — what this whole thing IS

## Seeded
Nikki seeded this vault on 2026-06-04 with 15 anchor notes from existing context. Edit freely — any change syncs to Fly within seconds.
NOTE

echo "Seed complete."
echo ""
echo "=== Vault contents ==="
find "$VAULT" -type f -name '*.md' | sort
echo ""
echo "Total notes: $(find "$VAULT" -type f -name '*.md' | wc -l | tr -d ' ')"
