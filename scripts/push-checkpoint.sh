#!/usr/bin/env bash
# Push a session checkpoint directly to Nikki's memory DB on Fly via the
# /api/memory/import-checkpoint endpoint. Reads DASHBOARD_TOKEN from
# .env so it works the same locally as on the CI runner.
#
# Usage:
#   scripts/push-checkpoint.sh "<short summary>" "<full raw_text>"
#   scripts/push-checkpoint.sh --file path/to/raw_text.md "<short summary>"
#
# Env overrides:
#   DASHBOARD_URL  default https://claudeclaw.impactworks.com
#   AGENT_ID       default main
#   CHAT_ID        default value of ALLOWED_CHAT_ID on the server side

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

URL="${DASHBOARD_URL:-https://claudeclaw.impactworks.com}/api/memory/import-checkpoint"
TOKEN="${DASHBOARD_TOKEN:?DASHBOARD_TOKEN not set}"

SUMMARY=""
RAW_TEXT=""
RAW_TEXT_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --file) RAW_TEXT_FILE="$2"; shift 2 ;;
    --chat-id) CHAT_ID="$2"; shift 2 ;;
    --agent) AGENT_ID="$2"; shift 2 ;;
    *)
      if [ -z "$SUMMARY" ]; then SUMMARY="$1"
      elif [ -z "$RAW_TEXT" ]; then RAW_TEXT="$1"
      fi
      shift
      ;;
  esac
done

if [ -n "$RAW_TEXT_FILE" ]; then
  RAW_TEXT="$(cat "$RAW_TEXT_FILE")"
fi
[ -z "$RAW_TEXT" ] && RAW_TEXT="$SUMMARY"

[ -z "$SUMMARY" ] && { echo "usage: $0 \"<summary>\" \"<raw_text>\"" >&2; exit 1; }

PAYLOAD=$(jq -n \
  --arg summary "$SUMMARY" \
  --arg raw_text "$RAW_TEXT" \
  --arg agent_id "${AGENT_ID:-main}" \
  --arg chat_id "${CHAT_ID:-}" \
  '{summary:$summary, raw_text:$raw_text, agent_id:$agent_id} +
   (if $chat_id == "" then {} else {chat_id:$chat_id} end)')

curl -fsS -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
echo
