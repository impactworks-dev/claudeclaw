#!/usr/bin/env python3
"""Quick view of every linked Plaid account across all items."""
import json, urllib.request

TOKEN = "ef491754f359e14310d9eb0052de453a091b5b89be061f1e"
URL = f"https://claw.impactworks.com/api/cash?token={TOKEN}&force=1"
req = urllib.request.Request(URL, headers={"User-Agent": "ClaudeClaw-Debug/1.0", "Accept": "application/json"})
data = json.loads(urllib.request.urlopen(req, timeout=30).read())

print(f"connectionStatus: {data.get('connectionStatus')}")
print()
print(f"{'INSTITUTION':<14} {'NAME':<32} {'TYPE':<11} {'SUBTYPE':<14} {'MASK':<6} {'BAL':>12}")
print("-" * 95)
for a in data.get("accounts", []):
    inst = (a.get("institution") or "?")[:13]
    name = a.get("name", "")[:31]
    typ = (a.get("type") or "?")[:10]
    sub = (a.get("subtype") or "-")[:13]
    mask = a.get("mask") or "-"
    bal = a.get("balanceCurrent")
    bal_s = f"${bal:,.2f}" if bal is not None else "-"
    print(f"{inst:<14} {name:<32} {typ:<11} {sub:<14} ••{mask:<4} {bal_s:>12}")

print()
print(f"Total depository (cash) cents: {data.get('totalCashCents')}")
mtd = data.get("mtd", {})
print(f"MTD net cents: {mtd.get('netCents')}, MTD revenue cents: {mtd.get('revenueCents')}")
