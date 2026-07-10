#!/bin/bash
cd "$HOME/claudeclaw"
set -a; . .env; set +a
echo "=== P&L YTD ==="
/usr/local/bin/node connectors/quickbooks/server.mjs --call qbo_get_pnl '{"start_date":"2026-01-01","end_date":"2026-06-08","accounting_method":"Accrual","summarize_column_by":"Total"}' > /tmp/pnl.json 2>&1
echo "size:"
wc -c /tmp/pnl.json
echo ""
echo "=== Chart of Accounts ==="
/usr/local/bin/node connectors/quickbooks/server.mjs --call qbo_get_chart_of_accounts '{}' > /tmp/coa.json 2>&1
echo "size:"
wc -c /tmp/coa.json
