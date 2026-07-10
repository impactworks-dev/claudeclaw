#!/bin/bash
# Generate a Nikki voice sample via ElevenLabs using whichever voice ID
# is currently configured as ELEVENLABS_VOICE_ID. Keeps the API key off
# stdout. Used to verify a voice swap before relying on it.
set -euo pipefail

KEY=$(grep '^ELEVENLABS_API_KEY=' /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
# Default to the currently-configured voice. Override by passing a voice id arg.
VOICE_ID="${1:-ZF6FPAbjXT4488VcRRnw}"
OUT=/tmp/nikki_sample.mp3
TEXT="Hey Dante, this is Nikki with the new voice. Same voice across Telegram and the dashboard from now on. Let me know if you like it or want to try a different one."

if [ -z "$KEY" ]; then
  echo "ERROR: ELEVENLABS_API_KEY not found in ~/claudeclaw/.env"
  exit 1
fi

HTTP=$(curl -sS -o "$OUT" -w '%{http_code}' \
  -X POST "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}" \
  -H "xi-api-key: ${KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"text\": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$TEXT"), \"model_id\": \"eleven_multilingual_v2\", \"voice_settings\": {\"stability\": 0.5, \"similarity_boost\": 0.75}}")

echo "Voice: ${VOICE_ID}"
echo "HTTP ${HTTP} → $(wc -c < "$OUT" | tr -d ' ') bytes"
if [ "$HTTP" != "200" ]; then
  echo "Body:"; head -c 500 "$OUT"; echo
  exit 1
fi

echo "Playing…"
/usr/bin/afplay "$OUT"
echo "Done. File at: $OUT"
