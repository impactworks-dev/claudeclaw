#!/bin/bash
cd "$HOME/claudeclaw"
DT=$(grep '^DASHBOARD_TOKEN=' .env | cut -d= -f2-)
curl -sS --http1.1 --max-time 90 -H "Authorization: Bearer $DT" "https://claudeclaw.impactworks.com/api/vendasta" > /tmp/vd.json 2>&1
wc -c /tmp/vd.json
