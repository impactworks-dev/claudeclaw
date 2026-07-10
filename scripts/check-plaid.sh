#!/bin/bash
echo "=== Plaid items (one row per linked bank) ==="
python3 <<PY
import json, datetime
with open("/app/store/plaid-items.json") as f:
    items = json.load(f)
print(f"{'Institution':22s} {'Item ID':16s} {'Last sync':22s} {'Status':10s} {'Error'}")
print("-" * 90)
def short(s, n):
    s = str(s or "")
    return s if len(s) <= n else s[:n-1] + "…"
for item in items.get("items", []) if isinstance(items, dict) else items:
    inst = item.get("institutionName") or item.get("institution") or "?"
    iid  = short(item.get("itemId") or item.get("item_id") or "?", 16)
    last = item.get("lastSyncedAt") or item.get("lastSuccessfulSync") or 0
    if last:
        try:
            last_str = datetime.datetime.fromtimestamp(last/1000).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            last_str = str(last)
    else:
        last_str = "(never recorded)"
    status = item.get("status", "ok")
    err    = item.get("error") or item.get("plaidError") or ""
    print(f"{short(inst,22):22s} {iid:16s} {last_str:22s} {status:10s} {err}")
PY

echo ""
echo "=== File mtimes (when state was last touched) ==="
ls -la /app/store/plaid-items.json /app/store/manual-accounts.json /app/store/manual-transactions.json 2>/dev/null
