#!/bin/bash
# Preview a voice tuning BEFORE deploy. Hits ElevenLabs directly with
# the same params we'd bake into voice.ts.
set -euo pipefail

KEY=$(grep '^ELEVENLABS_API_KEY=' /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
VOICE_ID="${1:-ZF6FPAbjXT4488VcRRnw}"
OUT=/tmp/nikki_default.mp3
TEXT="Hey Dante. It's Nikki, back to normal. This is how I'll sound now — natural inflection, normal speed, nothing stylized. Let me know if this is the baseline you wanted."

# Revert to ElevenLabs balanced defaults (natural delivery)
HTTP=$(curl -sS -o "$OUT" -w '%{http_code}' \
  -X POST "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" \
  -H "xi-api-key: ${KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"text\": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$TEXT"), \"model_id\": \"eleven_multilingual_v2\", \"voice_settings\": {\"stability\": 0.5, \"similarity_boost\": 0.75, \"style\": 0, \"use_speaker_boost\": true, \"speed\": 1.0}}")

echo "HTTP ${HTTP} → $(wc -c < "$OUT" | tr -d ' ') bytes"
if [ "${HTTP}" != "200" ]; then
  echo "Body:"; head -c 500 "$OUT"; echo
  exit 1
fi

echo "Playing natural defaults..."
/usr/bin/afplay "$OUT"
