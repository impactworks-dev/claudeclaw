#!/bin/sh
# Bridge Fly-injected environment secrets to /app/.env at container boot.
#
# Why: the app's readEnvFile() function (src/env.ts) reads secrets from a
# .env file on disk rather than process.env, by design — to keep secrets
# from leaking into child processes. On Fly, secrets are injected as env
# vars, so we materialize them into /app/.env here.
#
# Exclusions: system vars (PATH, HOME, LANG, etc.), Fly platform vars
# (FLY_*, PRIMARY_REGION), and Node-internal vars (NODE_VERSION etc.).
# Everything else with an uppercase A-Z key is treated as app config.

set -e

ENV_FILE=/app/.env

env \
  | grep -E '^[A-Z][A-Z0-9_]*=' \
  | grep -vE '^(PATH|HOME|HOSTNAME|SHELL|PWD|USER|LANG|TERM|LC_|LD_|TINI_|FLY_|PRIMARY_REGION|NODE_VERSION|YARN_VERSION|TZDATA)=' \
  > "$ENV_FILE"

# Make sure it's only readable by the app user
chmod 600 "$ENV_FILE"

# ── Materialize Vendasta service-account JSON from Fly secret ─────────
# Vendasta connector needs the GCP service account file on disk. The image
# layer is ephemeral, so we stash the JSON content as a Fly secret
# (VENDASTA_SERVICE_ACCOUNT_JSON) and write it out at boot.
if [ -n "${VENDASTA_SERVICE_ACCOUNT_JSON:-}" ]; then
  mkdir -p /app/secrets
  printf '%s' "$VENDASTA_SERVICE_ACCOUNT_JSON" > /app/secrets/vendasta-nikki-service-account.json
  chmod 600 /app/secrets/vendasta-nikki-service-account.json
  echo "Restored Vendasta service account → /app/secrets/"
fi

# ── MCP server config for the Claude Code subprocess ────────────────────
# The bot's loadMcpServers() reads ~/.claude/settings.json + project
# .claude/settings.json. Image is ephemeral, so we materialize the file
# here. Each connector is a stdio MCP server in /app/connectors/.
# Add new connectors here as we build them (e.g. quickbooks below).
CLAUDE_HOME="${HOME:-/home/node}/.claude"
mkdir -p "$CLAUDE_HOME"

# Build the MCP config as JSON. Notion is added only when NOTION_API_KEY
# is present so the agent doesn't fail at startup when it isn't.
NOTION_BLOCK=""
if [ -n "${NOTION_API_KEY:-}" ]; then
  NOTION_BLOCK=",
    \"notion\": {
      \"command\": \"npx\",
      \"args\": [\"-y\", \"@notionhq/notion-mcp-server\"],
      \"env\": {
        \"OPENAPI_MCP_HEADERS\": \"{\\\"Authorization\\\": \\\"Bearer ${NOTION_API_KEY}\\\", \\\"Notion-Version\\\": \\\"2022-06-28\\\"}\"
      }
    }"
fi

# Recall is reached via the Mac-side relay daemon over Cloudflare Tunnel.
# Both RECALL_RELAY_URL and RECALL_RELAY_SECRET must be set; otherwise the
# block stays empty and the agent boots without Recall.
RECALL_BLOCK=""
if [ -n "${RECALL_RELAY_URL:-}" ] && [ -n "${RECALL_RELAY_SECRET:-}" ]; then
  RECALL_BLOCK=",
    \"recall\": {
      \"command\": \"node\",
      \"args\": [\"/app/connectors/recall-relay-client/server.mjs\"],
      \"env\": {
        \"RECALL_RELAY_URL\": \"${RECALL_RELAY_URL}\",
        \"RECALL_RELAY_SECRET\": \"${RECALL_RELAY_SECRET}\"
      }
    }"
fi

# iMessage relay is reached via the Mac-side relay daemon over Cloudflare
# Tunnel (messages-relay.impactworks.com). Both MESSAGES_RELAY_URL and
# MESSAGES_RELAY_SECRET must be set; otherwise the block stays empty and
# Nikki boots without iMessage tools.
MESSAGES_BLOCK=""
if [ -n "${MESSAGES_RELAY_URL:-}" ] && [ -n "${MESSAGES_RELAY_SECRET:-}" ]; then
  MESSAGES_BLOCK=",
    \"messages\": {
      \"command\": \"node\",
      \"args\": [\"/app/connectors/messages/server.mjs\"],
      \"env\": {
        \"MESSAGES_RELAY_URL\": \"${MESSAGES_RELAY_URL}\",
        \"MESSAGES_RELAY_SECRET\": \"${MESSAGES_RELAY_SECRET}\"
      }
    }"
fi

cat > "$CLAUDE_HOME/settings.json" <<EOF
{
  "mcpServers": {
    "clickup": {
      "command": "node",
      "args": ["/app/connectors/clickup/server.mjs"]
    },
    "vendasta-crm": {
      "command": "node",
      "args": ["/app/connectors/vendasta/server.mjs"]
    },
    "quickbooks": {
      "command": "node",
      "args": ["/app/connectors/quickbooks/server.mjs"]
    }${NOTION_BLOCK}${RECALL_BLOCK}${MESSAGES_BLOCK}
  }
}
EOF
chmod 600 "$CLAUDE_HOME/settings.json"
echo "Wrote MCP server config → $CLAUDE_HOME/settings.json"
if [ -n "${NOTION_API_KEY:-}" ]; then
  echo "  notion MCP enabled (NOTION_API_KEY present)"
else
  echo "  notion MCP skipped (NOTION_API_KEY not set)"
fi
if [ -n "${RECALL_RELAY_URL:-}" ] && [ -n "${RECALL_RELAY_SECRET:-}" ]; then
  echo "  recall MCP enabled (relay at ${RECALL_RELAY_URL})"
else
  echo "  recall MCP skipped (RECALL_RELAY_URL / RECALL_RELAY_SECRET not set)"
fi
if [ -n "${MESSAGES_RELAY_URL:-}" ] && [ -n "${MESSAGES_RELAY_SECRET:-}" ]; then
  echo "  messages MCP enabled (relay at ${MESSAGES_RELAY_URL})"
else
  echo "  messages MCP skipped (MESSAGES_RELAY_URL / MESSAGES_RELAY_SECRET not set)"
fi

# ── Restore Claude Code credentials from persistent volume ───────────────
# Claude Code CLI reads OAuth creds from $HOME/.claude/.credentials.json.
# The image filesystem is ephemeral, so we persist the file in /app/store
# (Fly volume) and re-link it on each boot. We place it in the current
# user's home dir (node, not root — Claude Code refuses to run the
# bot's --dangerously-skip-permissions flag as root).
CLAUDE_DIR="${HOME:-/home/node}/.claude"
mkdir -p "$CLAUDE_DIR"

if [ -f /app/store/claude-credentials.json ]; then
  ln -sf /app/store/claude-credentials.json "$CLAUDE_DIR/.credentials.json"
  echo "Restored Claude Code credentials → $CLAUDE_DIR/.credentials.json"
fi

# Persist Claude Code session state across container restarts.
# Without this, every deploy wipes ~/.claude/projects/* and the bot's stored
# sessionIds become orphan ("No conversation found"), forcing a manual
# DELETE FROM sessions on every redeploy. Symlink onto the Fly volume.
mkdir -p /app/store/claude-projects
if [ ! -L "$CLAUDE_DIR/projects" ]; then
  rm -rf "$CLAUDE_DIR/projects"
  ln -s /app/store/claude-projects "$CLAUDE_DIR/projects"
  echo "Linked Claude Code project state → /app/store/claude-projects (persistent)"
fi

# ── Start Syncthing in the background ────────────────────────────────────
# Syncthing handles Obsidian-vault sync between this machine and Dante's Mac.
# Config + state live on the Fly volume so device IDs and pairings survive
# container restarts. GUI is exposed on port 8384 (internal); we expose it
# externally only during pairing setup.
SYNCTHING_HOME=/app/store/syncthing-config
mkdir -p "$SYNCTHING_HOME"

# First boot: generate config + cert+key; this is what gives us our device ID.
if [ ! -f "$SYNCTHING_HOME/config.xml" ]; then
  syncthing --generate="$SYNCTHING_HOME" 2>&1 | head -5 || true
fi

# Launch syncthing in background. We bind the GUI to 0.0.0.0 so Fly's
# private network or an ssh-tunnel can reach it for initial pairing.
syncthing serve \
  --home="$SYNCTHING_HOME" \
  --no-browser \
  --no-restart \
  --gui-address=0.0.0.0:8384 \
  >/app/store/logs/syncthing.log 2>&1 &

echo "Started syncthing in background (PID $!)"

# ── Startup sequencing: main FIRST, sub-agents after DB is ready ─────────
# Root cause of prior crashes: all five agents (main + 4 sub) hit
# initDatabase() simultaneously on boot, racing on WAL writes with no
# busy_timeout set. Fix is two-pronged:
#   1. db.ts sets busy_timeout=30000 so SQLite retries on SQLITE_BUSY.
#   2. Main agent starts first and owns schema init; sub-agents start 5s
#      later when the DB is guaranteed ready.
mkdir -p /app/store/logs

# Checkpoint any WAL left from a prior unclean shutdown before anyone opens
# the DB. sqlite3 CLI is installed in the image (Dockerfile line 71).
DB_PATH="${CLAUDECLAW_STORE_DIR:-/app/store}/claudeclaw.db"
if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);" \
    && echo "WAL checkpoint: done" \
    || echo "WAL checkpoint: failed (non-fatal, DB still safe)"
else
  echo "WAL checkpoint: no DB yet (first boot), skipping"
fi

# Start main agent first — it runs initDatabase(), creates schema, migrations
node dist/index.js &
MAIN_PID=$!
echo "Started main agent (PID $MAIN_PID)"

# Give main time to finish DB initialization before sub-agents connect.
# Schema creation + migrations complete in well under 1s; 5s is conservative.
sleep 5

# Spawn sub-agents now that the DB schema is stable
for AGENT in comms content ops research; do
  CLAUDECLAW_AGENT_ID="$AGENT" node dist/index.js --agent "$AGENT" \
    >> /app/store/logs/agent-$AGENT.log 2>&1 &
  echo "Spawned sub-agent '$AGENT' (PID $!)"
done

# Wait for the main agent. When it exits, tini reaps background children
# and Fly's supervisor restarts the container — same behavior as exec "$@"
# but main gets exclusive DB access on boot.
wait $MAIN_PID
