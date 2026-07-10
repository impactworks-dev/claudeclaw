#!/bin/bash
echo "=== Total rows in token_usage ==="
sqlite3 /app/store/claudeclaw.db "SELECT COUNT(*) FROM token_usage;"

echo ""
echo "=== Last 10 rows (newest first) ==="
sqlite3 -header /app/store/claudeclaw.db <<SQL
.mode column
.headers on
SELECT
  datetime(created_at/1000, 'unixepoch', 'localtime') AS when_local,
  chat_id,
  agent_id,
  input_tokens AS in_tok,
  output_tokens AS out_tok,
  context_tokens AS ctx,
  cache_read AS cache,
  ROUND(cost_usd, 4) AS cost
FROM token_usage
ORDER BY created_at DESC
LIMIT 10;
SQL

echo ""
echo "=== Today's rows (last 24h, by chat_id) ==="
sqlite3 /app/store/claudeclaw.db <<SQL
SELECT chat_id, agent_id, COUNT(*) AS turns, SUM(input_tokens+output_tokens) AS total_tokens
FROM token_usage
WHERE created_at > strftime('%s', 'now', '-1 day') * 1000
GROUP BY chat_id, agent_id;
SQL

echo ""
echo "=== Current local time on container vs unix-ms boundary used by 'today' filter ==="
date
sqlite3 /app/store/claudeclaw.db "SELECT strftime('%s', 'now', 'start of day') * 1000 AS start_of_today_ms, strftime('%s','now') * 1000 AS now_ms;"
