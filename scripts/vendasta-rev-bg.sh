#!/bin/bash
set -a; . ~/claudeclaw/.env; set +a
rm -f /tmp/vendasta-rev.json
nohup /usr/local/bin/node ~/claudeclaw/connectors/vendasta/server.mjs --call vendasta_revenue_by_account '{}' > /tmp/vendasta-rev.json 2>&1 &
echo $!
