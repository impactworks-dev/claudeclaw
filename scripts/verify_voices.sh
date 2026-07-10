#!/bin/bash
TOKEN=$(grep DASHBOARD_TOKEN /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
curl -sS -m 30 -o /tmp/v.json -w 'HTTP %{http_code} bytes=%{size_download}\n' \
  "https://claudeclaw.impactworks.com/api/voices/elevenlabs?token=${TOKEN}"
echo "---"
python3 -c "
import json
d = json.load(open('/tmp/v.json'))
print('selected voice ID:', d.get('selectedVoiceId'))
print('female voices:', len(d.get('voices', [])))
for v in d.get('voices', [])[:10]:
    vid = (v.get('voiceId') or '')[:14]
    print(f\"  • {v.get('name'):30s} id={vid:14s} cat={v.get('category')} gender={v.get('labels', {}).get('gender')}\")
err = d.get('error')
if err: print('ERROR:', err)
"
