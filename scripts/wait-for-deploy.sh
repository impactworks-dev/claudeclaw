#!/bin/bash
# Poll Fly for the new build by checking if ?full=1 returns customers[]
cd "$HOME/claudeclaw"
DT=$(grep '^DASHBOARD_TOKEN=' .env | cut -d= -f2-)
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 20
  RESP=$(curl -sS --http1.1 --max-time 30 -H "Authorization: Bearer $DT" "https://claudeclaw.impactworks.com/api/vendasta/revenue?full=1" 2>&1)
  if echo "$RESP" | grep -q '"customers"'; then
    echo "DEPLOYED after ${i}*20s"
    exit 0
  fi
  echo "check $i: not deployed yet"
done
echo "TIMEOUT"
exit 1
