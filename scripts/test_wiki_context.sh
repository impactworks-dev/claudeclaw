#!/bin/bash
# Sanity-check that the wiki context builder works end-to-end on Fly.
# Pokes the brain stats endpoint (should still work), then sends a test
# message to Nikki referencing a wiki concept ("Q3 plan") and looks at
# the Fly logs for the [Wiki context] block.
set +e
TOKEN=$(grep DASHBOARD_TOKEN /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)

echo "=== brain stats (sanity) ==="
curl -sS -m 10 "https://claudeclaw.impactworks.com/api/brain/stats?token=${TOKEN}" | python3 -m json.tool
