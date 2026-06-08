#!/bin/bash
cd "$HOME/claudeclaw"
DT=$(grep '^DASHBOARD_TOKEN=' .env | cut -d= -f2-)
echo "Hitting cached /api/vendasta/revenue ..."
time curl -sS --http1.1 --max-time 60 -H "Authorization: Bearer $DT" "https://claudeclaw.impactworks.com/api/vendasta/revenue" -o /tmp/rev.json
echo ""
echo "Size: $(wc -c < /tmp/rev.json) bytes"
echo "Has brands[]: $(grep -c '"brands"' /tmp/rev.json)"
head -c 250 /tmp/rev.json
