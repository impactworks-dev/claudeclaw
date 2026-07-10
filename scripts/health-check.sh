#!/bin/bash
# Full system health check — runs from local Mac, hits Fly + Telegram + APIs
# Color-codes pass/fail for quick scanning.

set +e
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0; FAIL=0; WARN=0

check() {
  local name="$1"; local cmd="$2"; local expected="$3"
  local result
  result=$(eval "$cmd" 2>&1)
  if [[ "$expected" == "nonempty" ]]; then
    if [[ -n "$result" ]]; then
      printf "${GREEN}✓${NC} %-45s %s\n" "$name" "${result:0:80}"
      PASS=$((PASS+1))
    else
      printf "${RED}✗${NC} %-45s (empty)\n" "$name"
      FAIL=$((FAIL+1))
    fi
  elif [[ "$result" == *"$expected"* ]]; then
    printf "${GREEN}✓${NC} %-45s %s\n" "$name" "${result:0:80}"
    PASS=$((PASS+1))
  else
    printf "${RED}✗${NC} %-45s got: %s\n" "$name" "${result:0:120}"
    FAIL=$((FAIL+1))
  fi
}

warn() {
  local name="$1"; local result="$2"
  printf "${YELLOW}⚠${NC} %-45s %s\n" "$name" "${result:0:80}"
  WARN=$((WARN+1))
}

TOKEN="ef491754f359e14310d9eb0052de453a091b5b89be061f1e"
URL="https://claudeclaw.impactworks.com"

echo "════════════════════════════════════════════════════════════════"
echo "  ClaudeClaw Full Health Check"
echo "════════════════════════════════════════════════════════════════"

echo ""
echo "── Infrastructure ──────────────────────────────────────────────"
check "DNS resolves"        "dig +short claudeclaw.impactworks.com | head -1" "."
check "TLS cert"            "echo | openssl s_client -servername claudeclaw.impactworks.com -connect claudeclaw.impactworks.com:443 2>/dev/null | openssl x509 -noout -subject" "claudeclaw.impactworks.com"
check "Site responds 200"   "curl -s -o /dev/null -w %{http_code} --max-time 10 $URL/" "200"
check "Fly machine started" "fly machines list -a claudeclaw-impactworks 2>/dev/null | grep started | head -1" "started"
check "Volume mounted"      "fly ssh console -a claudeclaw-impactworks --command 'df -h /app/store' 2>&1 | grep '/dev/vdc'" "/app/store"

echo ""
echo "── Agents (5 expected) ─────────────────────────────────────────"
AGENTS=$(fly ssh console -a claudeclaw-impactworks --command '/bin/bash /app/check-agents.sh' 2>&1 | grep -c "ClaudeClaw agent .* online")
if [[ "$AGENTS" -ge 4 ]]; then
  printf "${GREEN}✓${NC} %-45s %s sub-agents online + main\n" "Sub-agents running" "$AGENTS"
  PASS=$((PASS+1))
else
  printf "${RED}✗${NC} %-45s only %s sub-agents online\n" "Sub-agents running" "$AGENTS"
  FAIL=$((FAIL+1))
fi

echo ""
echo "── Mission Control API ─────────────────────────────────────────"
for ep in cash pipeline outreach webinars members founder; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL/api/$ep?token=$TOKEN")
  if [[ "$STATUS" == "200" ]]; then
    DATA=$(curl -s --max-time 10 "$URL/api/$ep?token=$TOKEN" | head -c 200)
    if echo "$DATA" | grep -qiE 'error|ENOENT|fail'; then
      warn "/api/$ep returns 200 but has error" "$DATA"
    else
      printf "${GREEN}✓${NC} %-45s %s\n" "/api/$ep" "200 OK ($(echo "$DATA" | wc -c | tr -d ' ') bytes)"
      PASS=$((PASS+1))
    fi
  else
    printf "${RED}✗${NC} %-45s HTTP %s\n" "/api/$ep" "$STATUS"
    FAIL=$((FAIL+1))
  fi
done

echo ""
echo "── Memory system ──────────────────────────────────────────────"
MEM_COUNT=$(fly ssh console -a claudeclaw-impactworks --command "sqlite3 /app/store/claudeclaw.db 'SELECT COUNT(*) FROM memories;'" 2>&1 | grep -E '^[0-9]+$' | head -1)
check "Memories table count"  "echo $MEM_COUNT"             "nonempty"
CONS_COUNT=$(fly ssh console -a claudeclaw-impactworks --command "sqlite3 /app/store/claudeclaw.db 'SELECT COUNT(*) FROM consolidations;'" 2>&1 | grep -E '^[0-9]+$' | head -1)
check "Consolidations table"  "echo ${CONS_COUNT:-0}"        "nonempty"
SESS_COUNT=$(fly ssh console -a claudeclaw-impactworks --command "sqlite3 /app/store/claudeclaw.db 'SELECT COUNT(*) FROM sessions;'" 2>&1 | grep -E '^[0-9]+$' | head -1)
check "Active sessions"       "echo $SESS_COUNT"             "nonempty"

echo ""
echo "── Claude Code subprocess auth ─────────────────────────────────"
CLAUDE_TEST=$(fly ssh console -a claudeclaw-impactworks --command 'claude --print --model claude-haiku-4-5 hello' 2>&1 | tail -1)
if [[ -n "$CLAUDE_TEST" ]] && [[ ! "$CLAUDE_TEST" =~ "logged in" ]] && [[ ! "$CLAUDE_TEST" =~ "error" ]]; then
  printf "${GREEN}✓${NC} %-45s %s\n" "Claude Code auth works (haiku)" "${CLAUDE_TEST:0:60}"
  PASS=$((PASS+1))
else
  printf "${RED}✗${NC} %-45s %s\n" "Claude Code auth" "$CLAUDE_TEST"
  FAIL=$((FAIL+1))
fi

echo ""
echo "── External integrations ──────────────────────────────────────"
PIPE_DATA=$(curl -s --max-time 15 "$URL/api/pipeline?token=$TOKEN")
if echo "$PIPE_DATA" | grep -qE 'opportunities|deals|customers'; then
  printf "${GREEN}✓${NC} %-45s\n" "Vendasta (Sales Pipeline)"
  PASS=$((PASS+1))
else
  printf "${RED}✗${NC} %-45s %s\n" "Vendasta" "${PIPE_DATA:0:100}"
  FAIL=$((FAIL+1))
fi

CASH_DATA=$(curl -s --max-time 15 "$URL/api/cash?token=$TOKEN")
if echo "$CASH_DATA" | grep -qE 'totalCashCents|accounts'; then
  printf "${GREEN}✓${NC} %-45s\n" "Plaid (Cash)"
  PASS=$((PASS+1))
else
  printf "${RED}✗${NC} %-45s %s\n" "Plaid" "${CASH_DATA:0:100}"
  FAIL=$((FAIL+1))
fi

GMAIL_STATUS=$(fly logs -a claudeclaw-impactworks --no-tail 2>&1 | grep -E 'gmail-watcher: (pass complete|scan complete)' | tail -1)
if [[ -n "$GMAIL_STATUS" ]]; then
  printf "${GREEN}✓${NC} %-45s\n" "Gmail watcher (OAuth)"
  PASS=$((PASS+1))
else
  warn "Gmail watcher" "no recent pass complete log"
fi

echo ""
echo "── Background services ────────────────────────────────────────"
CONS_LOG=$(fly logs -a claudeclaw-impactworks --no-tail 2>&1 | grep "Memory consolidation" | tail -1)
check "Memory consolidation scheduled"  "echo '$CONS_LOG'" "consolidation enabled"
BRIEF_LOG=$(fly logs -a claudeclaw-impactworks --no-tail 2>&1 | grep "Daily brief" | tail -1)
check "Daily brief armed (7am)"         "echo '$BRIEF_LOG'" "Daily brief scheduled"
WARROOM_LOG=$(fly logs -a claudeclaw-impactworks --no-tail 2>&1 | grep "War Room WebSocket" | tail -1)
check "War Room WebSocket"              "echo '$WARROOM_LOG'" "War Room WebSocket proxy active"

echo ""
echo "── Persistent state ───────────────────────────────────────────"
CLAUDE_PROJECTS=$(fly ssh console -a claudeclaw-impactworks --command 'ls -la /home/node/.claude/projects' 2>&1 | grep '\->')
check "Claude Code project symlink"     "echo '$CLAUDE_PROJECTS'" "/app/store/claude-projects"
VENDASTA_FILE=$(fly ssh console -a claudeclaw-impactworks --command 'ls /app/secrets/vendasta-nikki-service-account.json' 2>&1)
check "Vendasta service account file"   "echo '$VENDASTA_FILE'" "vendasta"
GOOGLE_TOKENS=$(fly ssh console -a claudeclaw-impactworks --command 'ls /app/store/google-tokens.json' 2>&1)
check "Google OAuth tokens"              "echo '$GOOGLE_TOKENS'" "google-tokens"

echo ""
echo "── Syncthing (Obsidian) ───────────────────────────────────────"
FLY_FILES=$(fly ssh console -a claudeclaw-impactworks --command 'find /app/store/obsidian-brain -type f | wc -l' 2>&1 | grep -E '^[0-9]+$' | head -1)
if [[ "${FLY_FILES:-0}" -gt 0 ]]; then
  printf "${GREEN}✓${NC} %-45s %s files synced\n" "Obsidian Brain synced to Fly" "$FLY_FILES"
  PASS=$((PASS+1))
else
  warn "Obsidian sync" "0 files in /app/store/obsidian-brain"
fi
MAC_API="AXFdJYGQj4WDmShzs6ZcwUgMQUjMF5Ma"
MAC_CONN=$(curl -s "http://localhost:8384/rest/system/connections" -H "X-API-Key: $MAC_API" 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print(any(v.get('connected') for v in d.get('connections',{}).values()))" 2>&1)
check "Mac ↔ Fly Syncthing connected" "echo $MAC_CONN" "True"

echo ""
echo "── CI/CD ──────────────────────────────────────────────────────"
LAST_RUN=$(gh run list --repo impactworks-dev/claudeclaw --limit 1 --json status,conclusion 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(d['status'], d['conclusion'])")
check "Latest CI run"  "echo '$LAST_RUN'" "success"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$WARN warnings${NC}"
echo "════════════════════════════════════════════════════════════════"
