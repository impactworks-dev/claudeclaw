# BID Traffic Partnership — Campaign Runbook

End-to-end ops doc for the Mission Control campaign tracking added on 2026-05-25.

## What was built

Three new Mission Control pages plus an automated email tracker:

| Page | URL | Purpose |
|---|---|---|
| **Outreach Tracker** | `/outreach` | Per-BID-director funnel: Not contacted → Emailed → Opened → Replied → Webinar Booked → Webinar Held → Endorsed / Declined |
| **Webinars** | `/webinars` | Bi-weekly Discovery Webinars from Google Calendar; per-attendee disposition (Endorsed / Pending / Pass) |
| **BID Members** | `/members` | Tier-2 revenue: member businesses at $169/mo, rolled up per endorsing BID |

Plus a background service:

- **Gmail Watcher** (`src/gmail-watcher.ts`) — polls Gmail every 5 min, auto-flips outreach status when emails are sent (Emailed) or received (Replied).

## One-time setup

### 1. Import the 40 NC BIDs

```bash
# Dry run first to verify parsing:
node scripts/import-bids-to-clickup.mjs \
  --file="/path/to/North Carolina.xlsx" \
  --dry-run

# Live import:
node scripts/import-bids-to-clickup.mjs \
  --file="/path/to/North Carolina.xlsx"
```

What it does:
- Reads the spreadsheet, dedupes (Complete NC + Sheet1 had overlap → 41 unique BIDs)
- Creates a ClickUp task per BID in the **Leads** list (`901326621319`)
- Tags each task with `bid`, `bid-nc`, `campaign:bid-traffic`
- Idempotent: re-running updates existing tasks rather than duplicating
- Writes `store/bid-roster.json` — the canonical roster the rest of Mission Control reads from

### 2. Verify Gmail OAuth

The Gmail watcher uses your existing Google OAuth tokens. If `GOOGLE_OAUTH_CLIENT_ID` and a refresh token are already in `.env`, you're set. Otherwise re-run the Google CLI auth flow.

### 3. Restart the main service

```bash
npm run dev    # or your normal start command
```

You should see in logs:

```
gmail-watcher: starting { intervalMs: 300000 }
gmail-watcher: pass complete { scanned: …, sentLogged: …, repliesLogged: …, promotions: … }
```

## Day-to-day workflow

### Sending outreach

1. Write the email from Gmail as normal. The watcher detects it within 5 minutes.
2. Within 5 min: the BID's status flips from **Not contacted** → **Emailed** in the Outreach Tracker. The "Last sent" column populates with timestamp and subject.
3. When the director replies, the status flips to **Replied** automatically.

### Booking webinars

1. Create a Google Calendar event with "Webinar" in the title (e.g. "BID Traffic Discovery Webinar — Charlotte CCP").
2. Invite the BID director by email.
3. The Webinars page picks it up on next refresh. The BID's outreach status auto-promotes to **Webinar Booked**.
4. After the event date passes, status auto-advances to **Webinar Held**.
5. From the Webinars page, set the post-event disposition: **Endorsed** / **Pending** / **Pass**.
   - **Endorsed** cascades to outreach status = Endorsed AND unlocks the Member sub-pipeline for that BID
   - **Pass** cascades to outreach status = Declined

### Tracking member signups (post-endorsement)

1. Once a BID is Endorsed, it appears in `/members`.
2. Click "Add member" on the BID card to log each member business.
3. Default price is $169/mo; mix is Ads+Bots; status starts at Trial.
4. Move members Trial → Active when they pay. Top-of-page totals update live.

### Manual overrides

Every status is a dropdown — override the watcher anywhere on the Outreach page. Useful for:
- Webinar booked verbally (no calendar event yet)
- A BID that already said yes informally
- Resetting after a misfire

## Data files (`store/`)

| File | Written by | Read by |
|---|---|---|
| `bid-roster.json` | Import script | All campaign pages |
| `email-log.json` | Gmail watcher | Outreach Tracker |
| `outreach-status.json` | UI + watcher + webinars | Outreach, Members |
| `webinar-dispositions.json` | Webinars UI | Webinars |
| `members.json` | Members UI | Members |
| `gmail-watcher-cursor.json` | Gmail watcher | Gmail watcher |

All local JSON, backed up wherever you back up `store/`. None of this gets pushed to ClickUp automatically (yet) — the ClickUp mirror still only handles outreach status tags via the existing `pipeline-data.ts` plumbing.

## Pricing reference (from `Final BID Pricing.xlsx`)

| Member count | Ads price | Bots price |
|---:|---:|---:|
| 1 | $25 | $20 |
| 5 | $115 | $90 |
| 10 | $200 | $160 |
| 25 | $500 | $375 |
| 50 | $1,000 | $750 |
| 50+ | +$20 each | +$15 each |

Constants live in `src/members-data.ts` (`ADS_TIERS` / `BOTS_TIERS`). The `priceForAds(n)` and `priceForBots(n)` helpers return the right cents for any member count.

Standard member-direct price is `$169/mo` (`BID_MEMBER_PRICE_CENTS = 16900`). That's what gets prefilled when you add a member.

## Known limits / next iterations

- **Open tracking** isn't wired yet. Sent and Replied work via Gmail headers; "Opened" needs a 1×1 tracking pixel (Apollo, Mailtrack, or a small endpoint on this server). Plug-in point is `recordEmailEvent({ ..., opened: true })` in `src/outreach-data.ts`.
- **ClickUp write-back for new statuses** — `pipeline-data.ts` currently mirrors statuses via `outreach:<status>` tags on the Accounts list. The new statuses (Webinar Booked / Held / Endorsed / Declined) will create new tags on first use; the existing mirror code already handles this. Verify by checking that the BID tasks in ClickUp get the new tags after a status change.
- **Vendasta sync** — the existing `vendasta-clickup-sync.mjs` doesn't know about BIDs as a separate campaign yet. If you want BIDs to flow into Vendasta as Leads too, extend the routing logic in that script.
- **Member auto-import** — for now members are added manually. Once volume grows, sync from QuickBooks subscriptions or Vendasta accounts.

## Files changed today

```
src/pipeline-data.ts             — extended OUTREACH_STATUSES to 8-stage BID funnel
src/outreach-data.ts             — NEW data layer for the Outreach Tracker
src/webinars-data.ts             — NEW data layer for Webinars view
src/members-data.ts              — NEW data layer for Tier-2 member rollups
src/gmail-watcher.ts             — NEW background email poller
src/google-api.ts                — exposed getOAuthClient for cross-module use
src/dashboard.ts                 — added /api/outreach, /api/webinars, /api/members endpoints
src/index.ts                     — auto-start Gmail watcher in main process

web/src/lib/routes.ts            — added /outreach, /webinars, /members sidebar entries
web/src/App.tsx                  — wired routes
web/src/pages/Pipeline.tsx       — updated STATUS_TONE for new statuses
web/src/pages/Outreach.tsx       — NEW page
web/src/pages/Webinars.tsx       — NEW page
web/src/pages/Members.tsx        — NEW page

scripts/import-bids-to-clickup.mjs — NEW: imports BIDs from xlsx into ClickUp Leads list
docs/BID-CAMPAIGN-RUNBOOK.md     — this file
```
