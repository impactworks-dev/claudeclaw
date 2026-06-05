# ClaudeClaw Recall Relay

Mac-side HTTPS bridge that lets Nikki (on Fly) talk to Recall's MCP server. Recall is OAuth-only; Fly is headless. This relay handles the browser OAuth flow on the Mac once, persists a refresh token, and forwards MCP calls from Fly through a Cloudflare Tunnel.

```
Fly (Nikki) ─HTTPS─▶ recall-relay.impactworks.com ─cloudflared─▶ 127.0.0.1:7456 (this relay) ─MCP─▶ backend.getrecall.ai/mcp
```

## One-time setup

### 1. Install + build

```bash
cd ~/claudeclaw/relay
npm install
npm run build
```

### 2. Generate the shared secret

The Mac relay only accepts calls that present this secret. It also goes onto Fly as `RECALL_RELAY_SECRET`.

```bash
openssl rand -hex 32   # copy the output
```

Add to `~/claudeclaw/relay/.env`:

```
RELAY_SHARED_SECRET=<paste here>
```

(The `.env` is read by the LaunchAgent via a wrapper script — see Step 4.)

### 3. Auth with Recall (browser flow)

```bash
cd ~/claudeclaw/relay
npm run auth
```

This opens Recall's consent page, captures the refresh token, and writes it to:

```
~/Library/Application Support/claudeclaw-relay/recall-token.json
```

If Recall doesn't support Dynamic Client Registration, set `RECALL_CLIENT_ID` + `RECALL_CLIENT_SECRET` (from a manually-registered OAuth app in Recall settings) before running auth.

### 4. Install the LaunchAgent

```bash
cp ~/claudeclaw/relay/com.impactworks.recall-relay.plist \
   ~/Library/LaunchAgents/

# Export the shared secret for this and future logins:
launchctl setenv RELAY_SHARED_SECRET "<the secret>"

# Load and start:
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.impactworks.recall-relay.plist
```

Verify:

```bash
curl http://127.0.0.1:7456/health
# {"ok":true,"has_token":true,...}
```

### 5. Expose via Cloudflare Tunnel

```bash
brew install cloudflared   # if not already

cloudflared tunnel login   # opens browser; pick impactworks.com zone

cloudflared tunnel create recall-relay
# Captures a tunnel ID — note it.

# Add hostname (manual in Cloudflare dashboard, OR via API):
#   recall-relay.impactworks.com → cname → <tunnel-id>.cfargotunnel.com

# Config at ~/.cloudflared/config.yml:
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <tunnel-id>
credentials-file: /Users/dantecrescenzi/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: recall-relay.impactworks.com
    service: http://127.0.0.1:7456
  - service: http_status:404
EOF

# Install as a launchd service (auto-starts on login):
sudo cloudflared service install
```

Verify:

```bash
curl https://recall-relay.impactworks.com/health
# Should return the same JSON as the localhost call.
```

### 6. Wire Fly to use it

Set the Fly secret:

```bash
flyctl secrets set RECALL_RELAY_SECRET=<same as RELAY_SHARED_SECRET> \
                   RECALL_RELAY_URL=https://recall-relay.impactworks.com \
  -a claudeclaw-impactworks
```

The Fly side discovers the relay via `RECALL_RELAY_URL` and proves itself with `RECALL_RELAY_SECRET`. Nikki gains `recall.tools/list` and `recall.tools/call` via this bridge.

## API

All endpoints except `/health` and `/` require `Authorization: Bearer <RELAY_SHARED_SECRET>`.

- `GET /health` — `{ ok, has_token, obtained_at, scope, recall_base }`
- `POST /mcp/tools/list` — lists Recall's MCP tools
- `POST /mcp/tools/call` — body is the standard MCP tools/call params
- `POST /mcp/raw` — pass-through for any MCP JSON-RPC method

## Troubleshooting

- `has_token: false` → run `npm run auth`
- `401` from Recall → token expired AND refresh token rejected; re-run auth
- `connection refused` from Fly → Cloudflare Tunnel isn't running; check `cloudflared tunnel info recall-relay`
- LaunchAgent not picking up `RELAY_SHARED_SECRET` → use `launchctl setenv` BEFORE `bootstrap`, or add an EnvironmentVariables key with the secret value (not recommended for shared machines)
