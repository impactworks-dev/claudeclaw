# Cash Integration Setup — Plaid → Novo → Mission Control

End-to-end setup for the Mission Control Cash page added on 2026-05-25.

## What this gives you

A `/cash` page in Mission Control that shows:
- Real-time bank balances across all your Novo accounts (and any other bank you link)
- MTD revenue, COGS, SaaS spend, other spend, net
- 30-day breakdown by business-meaningful category (not Plaid's generic ones)
- Runway estimate in days at your current 30-day burn rate
- Recent transactions with corrected categorization (Vendasta deposits = Revenue, Vendasta charges = COGS, etc.)

Data source is **Plaid**, not Era. We own the connection, the access token, and the categorization rules. No tier walls.

## One-time setup (5 minutes)

### 1. Create a Plaid developer account

1. Go to [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup)
2. Sign up (free). Use your business email.
3. After signup you'll land in the **Development** environment with 100 free items. That's way more than you need.

### 2. Grab your credentials

From the Plaid dashboard sidebar:
- **Team Settings → Keys**
- Copy your `client_id`
- Copy your `Development` secret (the **`sandbox`** secret won't work against real banks)

### 3. Add to `.env`

In `claudeclaw/.env`, add:

```
PLAID_CLIENT_ID=your_client_id_here
PLAID_SECRET=your_development_secret_here
PLAID_ENV=development
```

### 4. Verify the connector

```bash
node connectors/plaid/server.mjs --selftest
```

Should print:

```
Plaid OK (development): /categories/get returned 644 entries
Stored items: 0
```

If you see an auth error, double-check the secret matches the env (`development` secret for `PLAID_ENV=development`).

### 5. Restart Mission Control

```bash
npm run build
# restart your normal start command
```

### 6. Connect Novo

1. Open Mission Control → navigate to **Cash** (sidebar) → click **Connect bank** in the header
2. Or go directly to `http://localhost:PORT/cash/connect`
3. Plaid Link opens in a modal
4. Search for **Novo**
5. Sign in with your Novo credentials (goes directly to Plaid/Novo's OAuth, never to ClaudeClaw)
6. Select which Novo accounts to share (recommendation: select all checking + lending)
7. When the modal closes successfully, return to the Cash page and click Refresh

You should now see your live balance, MTD numbers, and recent transactions with categories like "Revenue: Vendasta," "COGS: Vendasta," "SaaS Stack," etc.

## How the categorization works

`src/cash-data.ts` contains rules that rewrite Plaid's generic categories into business-meaningful buckets. The rules tuned for your specific transaction patterns observed on 2026-05-25:

| Bucket | Matches | Why |
|---|---|---|
| **Revenue: Vendasta** | Inflows matching `Vendasta Transfer*` | AR collections from clients via Vendasta billing |
| **Revenue: Direct** | Inflows matching `PayPal Transfer`, `Venmo`, `Retry Payment*` | Direct client payments |
| **Revenue: Other** | Other Plaid-classified deposits/transfers in | Catch-all for unmatched income |
| **COGS: Vendasta** | Outflows starting with `Vendasta` (not transfers) | Wholesale per-client/per-service costs |
| **SaaS Stack** | OpenAI, ClickUp, Replit, Lindy, Gamma, Perplexity, Apify, Paddle, Loom, Wispr, Patreon, Netflix, Amazon Prime, etc. | Recurring business tools |
| **Utilities** | AT&T, GoDaddy, Verizon | Communications + domain |
| **Credit Card Payment** | Capital One, Credit One Bank, Chase CC, Amex, Discover | Card paydowns |
| **Transfers Out: PayPal/Venmo** | Outbound to PayPal/Venmo | Owner draws or cross-account moves |
| **Dining / Travel / Entertainment** | Plaid category passthrough | Personal but stays visible |

To add a new merchant to a bucket, edit the `SAAS_MERCHANTS` / `UTILITIES_MERCHANTS` sets or the `RULES` array in `src/cash-data.ts`.

## Files

```
connectors/plaid/server.mjs        — Plaid stdio MCP connector (auth + Plaid API client)
src/cash-data.ts                   — Data layer + categorization rules
src/dashboard.ts                   — /api/cash, /api/cash/link-token, /api/cash/exchange, /cash/connect
web/src/pages/Cash.tsx             — Mission Control page
web/src/lib/routes.ts              — Sidebar entry
store/plaid-items.json             — Stored access_tokens (one per linked bank)
store/cash-cache.json              — 5-minute response cache to spare Plaid rate limits
```

## Common tasks

**Connect another bank** (e.g. a personal checking, Chase, etc.):
- Same flow: `/cash/connect` → Plaid Link → pick institution → done
- All linked banks roll up into one Cash view

**Disconnect a bank:**
- Delete the relevant entry from `store/plaid-items.json` and restart
- The cache will rebuild on next page load

**Force a fresh balance fetch** (skip cache):
- Click Refresh in the Cash page header
- Or hit `/api/cash?force=1` directly

**Re-tune categorization:**
- Edit rules in `src/cash-data.ts`
- Rebuild + restart
- Hit refresh — cache invalidates and all 30 days re-categorize

## Moving from Development to Production

Plaid's **Development** environment is free and supports up to 100 connected items (banks). You'll hit this only if you start connecting many accounts. To go to Production:

1. Plaid dashboard → request Production access (they review business use case; usually 1-3 days)
2. Get your `production` secret
3. Update `.env`: `PLAID_ENV=production` and `PLAID_SECRET=<production_secret>`
4. Re-connect your banks (Production has its own item store)

Pricing for Production is per-API-call. For 1-2 personal/business accounts hit once every 5 min, it's roughly $5-20/month. Way cheaper than Era's paid tier and you own the data flow.

## Troubleshooting

**"Plaid not configured" callout on Cash page**
→ `PLAID_CLIENT_ID` or `PLAID_SECRET` missing from `.env`. Check the file and restart.

**"No banks connected" callout**
→ Either you haven't run the Connect flow yet, or `store/plaid-items.json` is empty/corrupt. Visit `/cash/connect`.

**Plaid Link UI shows "INVALID_API_KEYS"**
→ The secret in `.env` doesn't match the `PLAID_ENV`. Double-check that a development secret pairs with `PLAID_ENV=development`.

**Categories look wrong**
→ Edit `src/cash-data.ts` to add merchant names to the relevant set or add a new rule. Each rule is one regex/match function.

**Vendasta deposits showing as outflows**
→ Plaid's sign convention: positive amount = outflow, negative = inflow. If a Vendasta inflow has a positive amount in the data, that's a Plaid classification issue and we should check the Plaid response shape. File the transaction id and we'll add a rule.

**Cash balance shows $0 but bank says otherwise**
→ Check that the account type is `depository` or `cash` (visible via `node connectors/plaid/server.mjs --call plaid_list_accounts '{}'`). The Cash total only sums depository/cash accounts; lending/credit accounts are tracked separately as liabilities.
