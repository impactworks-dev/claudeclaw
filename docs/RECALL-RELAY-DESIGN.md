# Phase 4 — Mac-side Recall MCP relay

**Status:** Designed, not yet implemented. Tomorrow's session.

## Problem

Recall's MCP server (`https://backend.getrecall.ai/mcp/`) is OAuth-only. There's no API-key path. Fly runs headless — no browser, no way to complete the OAuth dance. So Nikki on Fly can't talk to Recall directly.

## Solution

A small Node service running on Dante's Mac that acts as an authenticated proxy between Fly and Recall. The Mac handles OAuth once via a browser window; Fly talks to the relay over a Cloudflare Tunnel that's already configured on the network.

```
Fly (Nikki) ──HTTPS──▶ Cloudflare Tunnel ──▶ Mac relay ──MCP/OAuth──▶ Recall
```

The relay is added to Nikki's MCP config as a stdio server that hits `https://recall-relay.impactworks.com/mcp/`. Same four tools as Recall's native MCP (`search`, `filter_by_metadata`, `get_document_content`, `explore_kb`) — the relay just forwards calls.

## Components

### 1. Mac-side relay (`relay/recall-relay.ts`)

- Express or Hono server, listens on `localhost:7456`
- One-time browser OAuth flow on first start — opens Recall's auth page, captures the token, persists to `~/Library/Application Support/claudeclaw-relay/recall-token.json`
- Refreshes token automatically when it expires
- Exposes an MCP-compatible HTTP endpoint that forwards tool calls to `https://backend.getrecall.ai/mcp/` with the stored token
- LaunchAgent plist so it auto-starts on login (`~/Library/LaunchAgents/com.impactworks.recall-relay.plist`)

### 2. Cloudflare Tunnel hostname

- Add `recall-relay.impactworks.com` to the existing Cloudflare config
- Points at the local relay (`localhost:7456`)
- Same auth model as the rest of the ImpactWorks setup (Cloudflare Access if we want extra protection — Fly is the only consumer)

### 3. Fly-side MCP config

Add to `docker-entrypoint.sh` MCP server materialization:
```json
"recall": {
  "type": "sse",
  "url": "https://recall-relay.impactworks.com/mcp"
}
```

Nikki and the four sub-agents (comms, content, ops, research) all gain four new tools.

## How Nikki uses it

Once wired, Nikki can call:

- `recall.explore_kb({action: 'get_stats'})` — what's in Dante's Recall
- `recall.search({queries: ['BID partnerships'], mode: 'focused'})` — find relevant clips
- `recall.get_document_content({card_id: '...', focus_query: 'pricing'})` — read a specific clip
- `recall.filter_by_metadata({tag_ids: ['marketing'], date_from: '...'})` — list by metadata

Tool calls happen on-demand — Nikki decides when to look something up rather than us prepending Recall content into every prompt. Keeps context budget sane while making the whole Recall library accessible.

## Promotion path

If a Recall clip turns out to be canonical (Dante keeps citing it), the existing promotion-proposal feed on the Founder Dashboard can detect it: any Recall card cited by Nikki in 3+ conversations becomes a candidate for promotion to a wiki note. The Mac relay can also expose a `recall.export_to_markdown` endpoint that writes the clip's content as a wiki note in the Obsidian vault.

## Ship checklist

- [ ] `relay/recall-relay.ts` — server + OAuth flow + token persistence
- [ ] `relay/package.json` + build script
- [ ] LaunchAgent plist
- [ ] Cloudflare Tunnel hostname `recall-relay.impactworks.com`
- [ ] Update `docker-entrypoint.sh` mcpServers config
- [ ] Smoke test: Nikki calls `recall.explore_kb` from Telegram

## Estimate

~2-3 hours of focused work.
