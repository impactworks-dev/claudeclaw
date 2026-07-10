#!/bin/bash
TOKEN=$(grep DASHBOARD_TOKEN /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
BASE="https://claudeclaw.impactworks.com/api/brain"
echo "=== reindexing ==="
curl -sS -m 10 -X POST "${BASE}/reindex?token=${TOKEN}" | python3 -m json.tool
echo ""
echo "=== stats ==="
curl -sS -m 10 "${BASE}/stats?token=${TOKEN}" | python3 -m json.tool
echo ""
echo "=== sample search: 'Q3' ==="
curl -sS -m 10 "${BASE}/search?q=Q3&token=${TOKEN}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', [])[:5]:
    print(f\"  • {r.get('title'):40s} score={r.get('score')}\")
"
