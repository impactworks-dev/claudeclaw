#!/bin/bash
echo "=== token_usage schema ==="
sqlite3 /app/store/claudeclaw.db ".schema token_usage"

echo ""
echo "=== Raw created_at values from latest 5 rows ==="
sqlite3 /app/store/claudeclaw.db "SELECT created_at, typeof(created_at) FROM token_usage ORDER BY created_at DESC LIMIT 5;"

echo ""
echo "=== Same rows, multiple time interpretations ==="
sqlite3 /app/store/claudeclaw.db <<SQL
SELECT
  created_at AS raw,
  datetime(created_at, 'unixepoch') AS as_seconds,
  datetime(created_at/1000, 'unixepoch') AS as_ms_div_1000,
  datetime(created_at/1000000, 'unixepoch') AS as_us_div_1000000
FROM token_usage
ORDER BY created_at DESC
LIMIT 3;
SQL

echo ""
echo "=== current_ms baseline + delta from latest row ==="
sqlite3 /app/store/claudeclaw.db <<SQL
SELECT
  strftime('%s', 'now') * 1000 AS now_ms,
  (SELECT MAX(created_at) FROM token_usage) AS latest_created_at,
  strftime('%s', 'now') * 1000 - (SELECT MAX(created_at) FROM token_usage) AS delta_if_ms,
  strftime('%s', 'now') - (SELECT MAX(created_at) FROM token_usage) AS delta_if_seconds;
SQL
