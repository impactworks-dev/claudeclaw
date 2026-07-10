#!/bin/bash
TOKEN=$(grep DASHBOARD_TOKEN /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
curl -sS -m 15 "https://claudeclaw.impactworks.com/api/stocks/debug?token=${TOKEN}" \
  -o /tmp/stocks_debug.json -w 'HTTP %{http_code}\n' 2>&1
echo "---"
python3 -c "
import json
d = json.load(open('/tmp/stocks_debug.json'))
print('URL:', d.get('url'))
print('status:', d.get('status'))
print('content-type:', d.get('contentType'))
print('body length:', d.get('bodyLength'))
print('body:')
print(d.get('body', '')[:1500])
print('---error---')
print(d.get('error'))
"
