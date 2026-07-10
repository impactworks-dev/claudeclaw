#!/usr/bin/env bash
# DNS deliverability audit — SPF / DKIM / DMARC / MX / domain age
set +e

DOMAINS=("impactworks.com" "rocketlocal.ai" "rocketlocal.io")
# Common DKIM selectors to probe — most providers publish under a known one
SELECTORS=("google" "default" "selector1" "selector2" "vendasta" "vendasta1" "apollo" "key1" "k1" "mailgun" "s1" "smtpapi")

for D in "${DOMAINS[@]}"; do
  echo "================================================================"
  echo "DOMAIN: $D"
  echo "================================================================"

  echo "--- MX (mail providers) ---"
  dig +short MX "$D"
  echo

  echo "--- SPF (TXT v=spf1) ---"
  dig +short TXT "$D" | grep -i 'v=spf1' || echo "(no SPF record found)"
  echo

  echo "--- DMARC (_dmarc.$D) ---"
  dig +short TXT "_dmarc.$D" || echo "(no DMARC record)"
  if [ -z "$(dig +short TXT "_dmarc.$D")" ]; then
    echo "(NO DMARC POLICY)"
  fi
  echo

  echo "--- DKIM selectors probed ---"
  found=0
  for S in "${SELECTORS[@]}"; do
    R=$(dig +short TXT "${S}._domainkey.$D" 2>/dev/null)
    if [ -n "$R" ]; then
      echo "  ✓ $S._domainkey.$D : $(echo "$R" | head -c 80)..."
      found=$((found+1))
    fi
  done
  if [ "$found" = "0" ]; then
    echo "  (no DKIM keys found at common selectors)"
  fi
  echo

  echo "--- WHOIS creation date (domain age) ---"
  whois "$D" 2>/dev/null | grep -iE 'Creation Date|Created On|created:' | head -1
  echo

  echo "--- A record + nameservers ---"
  echo "A: $(dig +short A "$D" | head -1)"
  echo "NS: $(dig +short NS "$D" | head -2 | tr '\n' ' ')"
  echo
done
