#!/bin/bash
TOKEN=$(grep DASHBOARD_TOKEN /Users/dantecrescenzi/claudeclaw/.env | head -1 | cut -d= -f2)
echo "--- /api/stocks?force=1 ---"
curl -sS -m 45 -w '\nHTTP %{http_code} size=%{size_download} time=%{time_total}\n' \
  "https://claudeclaw.impactworks.com/api/stocks?token=${TOKEN}&force=1" \
  -o /tmp/sc.json 2>&1
echo "First 700 bytes:"
head -c 700 /tmp/sc.json
echo ""
echo ""
echo "--- price summary ---"
python3 -c "
import json
try:
  d = json.load(open('/tmp/sc.json'))
  for q in d.get('quotes', []):
    price = q.get('price')
    chg = q.get('changePct')
    err = q.get('error')
    print(f\"  {q['symbol']:6s} \" + (f'\${price:.2f}  chg={chg}%' if price else f'ERROR={err}'))
except Exception as e:
  print('parse error:', e)
"
