#!/bin/bash
cd "$HOME/claudeclaw"
DT=$(grep '^DASHBOARD_TOKEN=' .env | cut -d= -f2-)
for i in 1 2 3 4 5 6 7 8; do
  sleep 30
  R=$(curl -sS --http1.1 --max-time 15 -H "Authorization: Bearer $DT" https://claudeclaw.impactworks.com/api/people/stats 2>&1)
  if echo "$R" | grep -q '"peopleMapEntries":[1-9]'; then
    echo "DEPLOYED after $((i*30))s"
    echo "$R"
    exit 0
  fi
  echo "check $i ($((i*30))s): still empty"
done
echo "TIMEOUT — did not see non-zero entries within 4 min"
exit 1
