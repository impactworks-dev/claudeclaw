#!/bin/bash
# Poll for stocks + ai-news endpoints coming up after deploy.
# Used by Nikki to verify a deploy. Safe to delete after.
set -euo pipefail
TOKEN=$(grep DASHBOARD_TOKEN /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
URL_BASE="https://claudeclaw.impactworks.com"
for i in $(seq 1 25); do
  CODE=$(curl -sS -m 10 -o /tmp/stocks_check.json -w '%{http_code}' \
    -H "Cookie: token=${TOKEN}" "${URL_BASE}/api/stocks" 2>/dev/null || echo "000")
  SIZE=$(wc -c < /tmp/stocks_check.json 2>/dev/null | tr -d ' ')
  echo "poll ${i}: HTTP ${CODE} size=${SIZE}"
  if [ "${CODE}" = "200" ] && [ "${SIZE}" -gt 100 ]; then
    echo "STOCKS LIVE"
    head -c 800 /tmp/stocks_check.json
    echo ""
    echo "---NEWS---"
    curl -sS -m 10 -H "Cookie: token=${TOKEN}" "${URL_BASE}/api/ai-news" \
      | head -c 1200
    echo ""
    exit 0
  fi
  sleep 15
done
echo "TIMEOUT after 25 polls"
exit 1
