#!/usr/bin/env python3
"""Confirm Apple Card transactions now show up in /api/cash output."""
import json, urllib.request

TOKEN = "ef491754f359e14310d9eb0052de453a091b5b89be061f1e"
URL = f"https://claw.impactworks.com/api/cash?token={TOKEN}&force=1"
req = urllib.request.Request(URL, headers={"User-Agent": "dbg"})
d = json.loads(urllib.request.urlopen(req, timeout=30).read())

recent = d.get("recent", [])
print(f"Recent transactions returned: {len(recent)}")
apple = [t for t in recent if (t.get("account_id") or "").startswith("manual_")]
print(f"Apple Card transactions in recent: {len(apple)}")
print()

if apple:
    print("APPLE CARD TRANSACTIONS NOW VISIBLE:")
    print(f"  {'DATE':<10} | {'NAME':<48} | {'BUCKET':<28} | {'AMOUNT':>10}")
    print("  " + "-" * 105)
    for t in sorted(apple, key=lambda x: x["date"]):
        n = t["name"][:48]
        b = t["bucket"][:28]
        print(f"  {t['date']:<10} | {n:<48} | {b:<28} | ${t['amount']:>9.2f}")

print()
print(f"MTD revenue:        ${d['mtd']['revenueCents']/100:>10.2f}")
print(f"MTD net:            ${d['mtd']['netCents']/100:>10.2f}")
print(f"Last 30d net:       ${d['last30']['netCents']/100:>10.2f}")
print(f"Total cash:         ${d.get('totalCashCents', 0)/100:>10.2f}")
