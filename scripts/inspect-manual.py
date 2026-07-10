#!/usr/bin/env python3
"""Inspect manual transactions — date range, counts, filter status."""
import json, os
from datetime import date, timedelta

p = os.path.expanduser("~/claudeclaw/store/manual-transactions.json")
try:
    txns = json.load(open(p))
except Exception as e:
    print("error reading file:", e); raise SystemExit

print(f"Total manual transactions: {len(txns)}")
if not txns:
    raise SystemExit

cutoff = (date.today() - timedelta(days=30)).isoformat()
print(f"30-day cutoff for /api/cash visibility: {cutoff}")
print()

dates = sorted(t["date"] for t in txns)
print(f"Date range in file: {dates[0]} to {dates[-1]}")
in_window = [t for t in txns if t["date"] >= cutoff]
out_window = [t for t in txns if t["date"] < cutoff]
print(f"In 30-day window: {len(in_window)} transactions")
print(f"Out of window (older): {len(out_window)} transactions")
print()

print("BREAKDOWN BY ACCOUNT:")
by_acc = {}
for t in txns:
    by_acc.setdefault(t["account_id"], []).append(t)
for acc, ts in by_acc.items():
    in_w = sum(1 for x in ts if x["date"] >= cutoff)
    total = sum(x["amount"] for x in ts)
    print(f"  {acc}: {len(ts)} total, {in_w} in 30d window, period sum=${total:.2f}")

print()
print("FIRST 10 TRANSACTIONS (oldest):")
for t in sorted(txns, key=lambda x: x["date"])[:10]:
    flag = "  IN" if t["date"] >= cutoff else "OUT "
    name = t["name"][:48]
    print(f"  [{flag}] {t['date']} | {name:48s} | ${t['amount']:>9.2f}")

print()
print("LAST 10 TRANSACTIONS (newest):")
for t in sorted(txns, key=lambda x: x["date"])[-10:]:
    flag = "  IN" if t["date"] >= cutoff else "OUT "
    name = t["name"][:48]
    print(f"  [{flag}] {t['date']} | {name:48s} | ${t['amount']:>9.2f}")
