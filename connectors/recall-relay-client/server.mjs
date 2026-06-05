#!/usr/bin/env node
/**
 * Recall MCP client → relay bridge
 * --------------------------------
 * Runs as a stdio MCP server inside the Fly container. When Nikki invokes
 * a Recall tool, this connector forwards the JSON-RPC call to the Mac-side
 * relay daemon over HTTPS (Cloudflare Tunnel), which holds the OAuth token.
 *
 * Why: Recall's MCP server is OAuth-only. Fly is headless and can't run a
 * browser to complete the auth dance. The Mac handles OAuth once, this
 * client forwards calls.
 *
 * Env:
 *   RECALL_RELAY_URL      e.g. https://recall-relay.impactworks.com (required)
 *   RECALL_RELAY_SECRET   shared bearer secret matching the relay (required)
 *
 * Zero deps. Uses Node 18+ global fetch.
 */

const RELAY_URL = (process.env.RECALL_RELAY_URL || '').replace(/\/+$/, '');
const RELAY_SECRET = process.env.RECALL_RELAY_SECRET || '';

if (!RELAY_URL || !RELAY_SECRET) {
  process.stderr.write('FATAL: RECALL_RELAY_URL and RECALL_RELAY_SECRET must be set.\n');
  process.exit(1);
}

const PROTOCOL = '2024-11-05';
function send(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function relayPost(path, body) {
  const res = await fetch(RELAY_URL + path, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RELAY_SECRET}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`relay ${path} (${res.status}): ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Cached Recall tool list (loaded on first tools/list call, then re-served).
let cachedTools = null;

async function getRecallTools() {
  if (cachedTools) return cachedTools;
  const r = await relayPost('/mcp/tools/list', {});
  // Relay forwards Recall's JSON-RPC reply. Tools live under r.result.tools.
  const tools = (r && r.result && r.result.tools) || r.tools || [];
  // Namespace every tool name with `recall_` so they don't collide with
  // other MCP servers that might expose `search`, `get_document_content`, etc.
  cachedTools = tools.map(t => ({ ...t, name: 'recall_' + t.name }));
  return cachedTools;
}

async function handle(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'recall-relay-client', version: '0.1.0' },
      });
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'ping') return ok(id, {});

    if (method === 'tools/list') {
      const tools = await getRecallTools();
      return ok(id, { tools });
    }
    if (method === 'tools/call') {
      const name = (params && params.name) || '';
      const args = (params && params.arguments) || {};
      // Strip our recall_ prefix before forwarding
      const recallName = name.startsWith('recall_') ? name.slice(7) : name;
      const r = await relayPost('/mcp/tools/call', { name: recallName, arguments: args });
      // Forward the result/content payload through unchanged.
      const result = (r && r.result) || r;
      return ok(id, result);
    }
    if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    const msgText = (e && e.message) || String(e);
    if (id !== undefined) {
      // Return as a "tools/call" error result so Nikki sees it, not a hard fail
      if (method === 'tools/call') {
        return ok(id, { content: [{ type: 'text', text: 'ERROR: ' + msgText }], isError: true });
      }
      fail(id, -32603, msgText);
    }
  }
}

function startStdio() {
  let buf = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      Promise.resolve(handle(m)).catch(err => {
        if (m && m.id !== undefined) fail(m.id, -32603, String((err && err.message) || err));
      });
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

startStdio();
