#!/usr/bin/env tsx
// ClaudeClaw → Recall relay daemon.
//
// Runs on the Mac (LaunchAgent), listens on 127.0.0.1:7456, exposes:
//   - GET  /health                      liveness + token state
//   - POST /mcp/tools/list              list MCP tools at Recall
//   - POST /mcp/tools/call              forward an MCP tools/call to Recall
//   - GET  /                            simple status page
//
// Fly-side ClaudeClaw reaches this via the Cloudflare Tunnel hostname
// recall-relay.impactworks.com → cloudflared → localhost:7456.
//
// Authentication: a shared bearer secret (RELAY_SHARED_SECRET) gates access
// so anyone who finds the public hostname can't just call our Recall.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { TokenStore } from './recall-token-store.js';

const PORT = parseInt(process.env.RELAY_PORT || '7456', 10);
const SHARED_SECRET = process.env.RELAY_SHARED_SECRET || '';
const RECALL_MCP_BASE = (process.env.RECALL_MCP_BASE || 'https://backend.getrecall.ai/mcp').replace(/\/+$/, '');
const LOG_DIR = path.join(os.homedir(), 'Library', 'Logs', 'claudeclaw-relay');

if (!SHARED_SECRET) {
  console.error('FATAL: RELAY_SHARED_SECRET env var is required.');
  console.error('Generate one with: openssl rand -hex 32');
  process.exit(1);
}

fs.mkdirSync(LOG_DIR, { recursive: true });

const store = new TokenStore();
const app = new Hono();

// ── Bearer auth middleware ────────────────────────────────────────────
app.use('*', async (c, next) => {
  if (c.req.path === '/health' || c.req.path === '/') return next();
  const auth = c.req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== SHARED_SECRET) return c.json({ error: 'unauthorized' }, 401);
  return next();
});

// ── Health ────────────────────────────────────────────────────────────
app.get('/health', (c) => {
  const persisted = store.load();
  return c.json({
    ok: true,
    has_token: !!persisted,
    obtained_at: persisted?.obtained_at || null,
    scope: persisted?.scope || null,
    recall_base: RECALL_MCP_BASE,
  });
});

app.get('/', (c) => {
  const persisted = store.load();
  return c.html(`<!DOCTYPE html><html><head><title>ClaudeClaw Recall Relay</title>
<style>body{font-family:system-ui;max-width:540px;margin:40px auto;color:#222}h1{font-size:18px}code{background:#eee;padding:2px 6px;border-radius:3px}</style>
</head><body>
<h1>ClaudeClaw → Recall Relay</h1>
<p>Status: ${persisted ? '<b style="color:#16a34a">authorized</b>' : '<b style="color:#dc2626">no token</b> — run <code>npm run auth</code>'}</p>
<p>Recall: <code>${RECALL_MCP_BASE}</code></p>
<p>POST /mcp/tools/list and /mcp/tools/call with Bearer auth.</p>
</body></html>`);
});

// ── MCP forwarding ────────────────────────────────────────────────────
async function forwardMcp(method: string, params: unknown): Promise<unknown> {
  const access = await store.getAccessToken();
  const rpcBody = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e9),
    method,
    params,
  };
  const res = await fetch(RECALL_MCP_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify(rpcBody),
  });
  if (res.status === 401) {
    // Access token might be stale even after refresh; invalidate and retry once.
    store.invalidateAccess();
    const retry = await store.getAccessToken();
    const r2 = await fetch(RECALL_MCP_BASE, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${retry}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(rpcBody),
    });
    return await r2.json();
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Recall MCP ${method} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  // Recall returns either JSON or SSE depending on negotiation. Parse both.
  const ctype = res.headers.get('content-type') || '';
  if (ctype.includes('text/event-stream')) {
    const raw = await res.text();
    // SSE frames look like "event: message\ndata: {...}\n\n"; grab the first JSON payload.
    const dataMatch = raw.match(/data:\s*(.+)/);
    if (dataMatch) {
      try { return JSON.parse(dataMatch[1]); } catch { return { raw }; }
    }
    return { raw };
  }
  return await res.json();
}

app.post('/mcp/tools/list', async (c) => {
  try {
    const r = await forwardMcp('tools/list', {});
    return c.json(r as any);
  } catch (e) { return c.json({ error: (e as Error).message }, 500); }
});

app.post('/mcp/tools/call', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const r = await forwardMcp('tools/call', body);
    return c.json(r as any);
  } catch (e) { return c.json({ error: (e as Error).message }, 500); }
});

// Generic JSON-RPC passthrough for anything else MCP-shaped.
app.post('/mcp/raw', async (c) => {
  try {
    const body = await c.req.json();
    const r = await forwardMcp(body.method, body.params);
    return c.json(r as any);
  } catch (e) { return c.json({ error: (e as Error).message }, 500); }
});

// ── Boot ──────────────────────────────────────────────────────────────
serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`Recall relay listening on http://127.0.0.1:${info.port}`);
});
