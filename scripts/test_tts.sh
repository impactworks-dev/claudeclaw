#!/bin/bash
TOKEN=$(grep DASHBOARD_TOKEN /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
echo "POSTing to /api/chat/tts..."
HTTP=$(curl -sS -o /tmp/tts.mp3 -w '%{http_code}' \
  -X POST "https://claudeclaw.impactworks.com/api/chat/tts?token=${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"text":"Hey Dante, this is Amelia speaking from the dashboard. Same voice as Telegram now."}')
echo "HTTP ${HTTP} → $(wc -c < /tmp/tts.mp3 | tr -d ' ') bytes"
if [ "${HTTP}" != "200" ]; then
  echo "Body:"; head -c 400 /tmp/tts.mp3
  exit 1
fi
echo "Playing through Amelia..."
afplay /tmp/tts.mp3
