#!/bin/bash
cd "$HOME/claudeclaw"
DT=$(grep '^DASHBOARD_TOKEN=' .env | cut -d= -f2-)
curl -sS --http1.1 --max-time 30 -H "Authorization: Bearer $DT" "https://claudeclaw.impactworks.com/api/vendasta/revenue?full=1" > /tmp/check.json
SIZE=$(wc -c < /tmp/check.json)
HAS_CUST=$(grep -c '"customers"' /tmp/check.json)
echo "size=$SIZE has_customers=$HAS_CUST"
head -c 200 /tmp/check.json
