#!/bin/bash
set -a; . ~/claudeclaw/.env; set +a
cd ~/claudeclaw
for t in vendasta_platform_list_users vendasta_platform_list_sales_accounts vendasta_platform_list_subscriptions vendasta_platform_list_subscription_assignments vendasta_platform_list_orders vendasta_platform_list_purchases vendasta_platform_list_activatable_products vendasta_platform_list_automations vendasta_platform_list_business_categories vendasta_platform_list_business_locations; do
  RES=$(/usr/local/bin/node connectors/vendasta/server.mjs --call "$t" '{"limit":1}' 2>&1 | head -1)
  if echo "$RES" | /usr/bin/grep -q '"errors"\|ERROR'; then
    DETAIL=$(echo "$RES" | /usr/bin/grep -o '"detail":"[^"]*' | /usr/bin/head -1 | /usr/bin/cut -c1-100)
    printf '%-55s FAIL %s\n' "$t" "$DETAIL"
  else
    printf '%-55s OK\n' "$t"
  fi
done
