#!/bin/bash
# Pull QBO chart of accounts via the Fly connector and dump it.
cd "$HOME/claudeclaw"
fly ssh console -a claudeclaw-impactworks -C "node /app/connectors/quickbooks/server.mjs --call qbo_get_chart_of_accounts {}" 2>/tmp/coa.err > /tmp/coa.json
echo "exit:$?"
wc -c /tmp/coa.json
