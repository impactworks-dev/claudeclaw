#!/bin/bash
TOKEN=$(grep DASHBOARD_TOKEN /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
BASE="https://claudeclaw.impactworks.com/api/brain"

echo "=== stats ==="
curl -sS -m 15 "${BASE}/stats?token=${TOKEN}" | python3 -m json.tool

echo ""
echo "=== first 5 notes ==="
curl -sS -m 15 "${BASE}/notes?token=${TOKEN}&limit=5" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('total:', d.get('total'))
for n in d.get('notes', []):
    print(f\"  • {n.get('title'):40s} folder={n.get('folder'):15s} links={n.get('linkCount')} backlinks={n.get('backlinkCount')}\")
"

echo ""
echo "=== search 'BID' ==="
curl -sS -m 15 "${BASE}/search?q=BID&token=${TOKEN}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('hits:', len(d.get('results', [])))
for r in d.get('results', [])[:5]:
    print(f\"  • {r.get('title'):40s} score={r.get('score')} snippet={r.get('snippet','')[:60]}\")
"

echo ""
echo "=== full graph (counts only) ==="
curl -sS -m 15 "${BASE}/graph?token=${TOKEN}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('nodes:', len(d.get('nodes', [])), 'edges:', len(d.get('edges', [])))
"
