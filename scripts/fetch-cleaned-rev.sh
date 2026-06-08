#!/bin/bash
set -e
cd "$HOME/claudeclaw"
DT=$(grep '^DASHBOARD_TOKEN=' .env | cut -d= -f2-)
rm -f /tmp/cleaned.json
curl -sS --http1.1 --max-time 180 -H "Authorization: Bearer $DT" "https://claudeclaw.impactworks.com/api/vendasta/revenue" > /tmp/cleaned.json 2>/tmp/cleaned.err
echo "exit:$?"
wc -c /tmp/cleaned.json
