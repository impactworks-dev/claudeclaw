#!/usr/bin/env python3
"""Save a high-salience semantic memory into Nikki's DB so she picks it up
on her next session start. CLAUDE.md `checkpoint` pattern."""

import sqlite3, time, os, subprocess

root = '/Users/dantecrescenzi/claudeclaw'
db = sqlite3.connect(os.path.join(root, 'store', 'claudeclaw.db'))
now = int(time.time())

# chat_id from sessions table
chat_id = db.execute('SELECT chat_id FROM sessions LIMIT 1').fetchone()[0]
print(f'chat_id: {chat_id}')

# Big checkpoint covering today's work (2026-06-08)
summary = """SESSION CHECKPOINT 2026-06-08 — major Mission Control upgrade day.

INVESTMENTS TILE (NEW): Plaid-backed portfolio tracking on Founder Dashboard. Sits between cash-pulse and cash-pipeline. Endpoint: /api/investments (30-min cache). Linked tonight: VANGUARD (multiple accounts incl SEP IRA + joint w/ Audra) + STASH (Personal, Smart, Retirement, Cash). Total ~$5,950.57 across 6 accounts. Charles SCHWAB requested via Plaid support case #822382 — expect up to 5 days for approval. Connector auto-resolves institution_name via /institutions/get_by_id and persists.

VENDASTA → QBO SETTLEMENT PIPELINE (NEW): Monthly automation. Per-brand split (pwps=ImpactWorks, default=Rocket Local) computed in src/vendasta-revenue.ts → brands[] array. Settlement Slip generator (scripts/settlement-slip.mjs) creates pending slip + Google Doc + Telegram body with slip ID. Approval flow: Dante replies "post slip <id>" → scripts/post-settlement-slip.mjs calls qbo_create_journal_entry. New QBO COGS accounts created: "ImpactWorks - Vendasta Wholesale" + "Rocket Local - Vendasta Wholesale" (Other Costs of Services - COS). Existing brand-named Income accounts reused. Monthly scheduled task a1f38408 fires 5th @ 9am EST. Test fire 59407a3d set for Jun 9 9am EST (self-deletes).

PEOPLE RESOLVER (NEW): src/people-resolver.ts — central lookup over relay/people-map.json (78 entries) + relay/contacts.json (2,248). 2,326 indexed handles. Wired into Gmail morning brief + Mission Control Inbox tile with category badges (👪 family ⭐ inner-circle 💼 client 🔄 self). Endpoints /api/people/stats and /api/people/resolve.

CRITICAL DISAMBIGUATION: Dante's SON and FATHER are BOTH named "Silvio Vincent Crescenzi". Son goes by Vincent, father by Dad. vincent@impactworks.com belongs to the SON (works at ImpactWorks). svc@cbmcpa.com, svcrescenzi@gmail.com, and vincent@primereset.com / vincent@rocketlocal.io / vincent@pestwebpros.com belong to the FATHER.

OTHER RELATIONSHIPS TAGGED: William Harvey = stepson. Tessa Harvey = stepdaughter. Emily Crescenzi = daughter. Robyn Beaulieu-Dulys = mother (multiple phones+emails). Faith Vanzalen = mother-in-law (Audra's mom). Bill Johnson = uncle (Jennifer Johnson's dad). Jennifer Johnson = cousin. Patty Morrison = aunt (Robyn's sister). Inner circle: Jim Roberts (close friend, NEW founder, ex-roommate), Jeffrey Blanchard (best friend HS), Bill Warner (mentor), Will Wilcox (HS friend), Amy & Cam Matheson (friends, both Audra's bosses, married). Clients: Ralph Caparotti (also business partner), John Fenrich, Ashly @ Reesource Pest, ZAGG Phone Repair.

VENDASTA NAME BACKFILL: revenueByAccount in connector now joins businessLocations to backfill canonical names + strips literal 'null' strings. Recovered ~47 customers (Reesource Pest $539/mo, Data Check Systems, ZAGG Phone Repair, NEATCap Medical, etc.). Top retail customers: ZAGG Downtown Crown $780.58, Reesource Pest $539, Innotech Pest $171.08, Data Check Systems $144, ZAGG Phone Repair $139.

STOCKS PROVIDER SWITCH: Stooq added JavaScript proof-of-work browser challenge (every server fetch 404s). Switched stocks-data.ts to Twelvedata /quote endpoint (same provider already used for chart history). TWELVEDATA_API_KEY in Fly secrets, 800 calls/day free tier.

AI NEWS ICONS: Each item now has iconUrl (Google s2/favicons proxy) + sourceDomain. Frontend renders 28px circular publisher logo with initial fallback. Cache TTL 10 min.

INBOX ENRICHMENT: shapeRow in email-data.ts resolves sender via people-resolver. Mission Control Inbox tile EmailRowView renders category badge + name + (relationship) instead of raw email address.

PLAID DASHBOARD CONFIG: Allowed redirect URIs now includes https://claudeclaw.impactworks.com/cash/connect (was missing pre-cutover claw. only). Required for investments product to work.

DOCKERFILE FIX: Now COPY relay/people-map.json + relay/contacts.json so they ship to Fly. Previously the people-resolver returned 0 entries on Fly because data files weren't in image.

OTHER: Marked 1,764 unread inbox emails as read. QBO Categorization Clean-Up Plan delivered as Google Doc. Vendasta Wholesale vs Retail Margin report delivered as Google Doc."""

short_summary = "Session checkpoint 2026-06-08: Investments tile shipped (Vanguard+Stash linked, Schwab pending Plaid case #822382). Vendasta→QBO settlement pipeline A-E shipped (monthly task a1f38408). People resolver shipped (78 tagged contacts; Vincent=son, Dad=father, SAME NAME). Stocks switched Stooq→Twelvedata. AI News got favicons. Inbox tile shows relationships. 1764 emails marked read."

db.execute(
    'INSERT INTO memories (chat_id, source, raw_text, summary, importance, salience, created_at, accessed_at, agent_id, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    (str(chat_id), 'session_checkpoint', summary, short_summary, 0.95, 5.0, now, now, 'main', 1),
)
db.commit()
print('Checkpoint saved. Nikki will see it on her next session start.')
