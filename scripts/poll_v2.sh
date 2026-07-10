#!/bin/bash
TOKEN=$(grep DASHBOARD_TOKEN /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
BASE="https://claudeclaw.impactworks.com"
echo "=== GET /api/stocks/tickers ==="
curl -sS -m 10 "${BASE}/api/stocks/tickers?token=${TOKEN}" | python3 -m json.tool
echo ""
echo "=== POST /api/stocks/tickers ANTH (add test) ==="
curl -sS -m 10 -X POST -H "content-type: application/json" -d '{"symbol":"ANTH"}' \
  "${BASE}/api/stocks/tickers?token=${TOKEN}" | python3 -m json.tool
echo ""
echo "=== DELETE /api/stocks/tickers/ANTH (remove test) ==="
curl -sS -m 10 -X DELETE "${BASE}/api/stocks/tickers/ANTH?token=${TOKEN}" | python3 -m json.tool
echo ""
echo "=== GET /api/stocks/history/NVDA?period=1M ==="
curl -sS -m 15 "${BASE}/api/stocks/history/NVDA?period=1M&token=${TOKEN}" -o /tmp/hist.json -w "HTTP %{http_code} size=%{size_download} time=%{time_total}\n"
python3 -c "
import json
d = json.load(open('/tmp/hist.json'))
print('symbol:', d.get('symbol'), 'period:', d.get('period'), 'interval:', d.get('interval'))
print('bars:', len(d.get('bars', [])))
err = d.get('error')
if err: print('ERROR:', err)
bars = d.get('bars', [])
if bars:
    print('first bar:', bars[0])
    print('last  bar:', bars[-1])
"
