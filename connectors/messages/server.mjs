#!/usr/bin/env node
/**
 * iMessage MCP connector for ClaudeClaw (Nikki)
 * ----------------------------------------------
 * Zero-dependency stdio MCP server. Requires Node >= 18.
 *
 * Bridges Nikki on Fly → Mac LaunchAgent (messages-relay.ts) via the
 * Cloudflare Tunnel at messages-relay.impactworks.com. Tools cover read
 * paths over Dante's iMessage database (chat.db).
 *
 * The Mac must be on for the relay to respond. If the Mac is asleep or
 * the relay process is down, tools return an error message Nikki can
 * relay to Dante instead of crashing the agent loop.
 *
 * Env:
 *   MESSAGES_RELAY_URL      default https://messages-relay.impactworks.com
 *   MESSAGES_RELAY_SECRET   required — Bearer secret matching the LaunchAgent
 */

const RELAY_URL = (process.env.MESSAGES_RELAY_URL || 'https://messages-relay.impactworks.com').replace(/\/+$/, '');
const SECRET = process.env.MESSAGES_RELAY_SECRET || '';

if (!SECRET && !process.argv.includes('--selftest')) {
  console.error('FATAL: MESSAGES_RELAY_SECRET env var not set');
  process.exit(1);
}

async function relayGet(path) {
  const url = RELAY_URL + path;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const e = new Error(`messages relay ${path} -> ${res.status}`);
    e.status = res.status;
    e.body = data;
    throw e;
  }
  return data;
}

// ── Tool definitions ────────────────────────────────────────────────
const tools = [
  {
    name: 'messages_health',
    description: 'Check whether the iMessage relay on Dante\'s Mac is alive and the chat.db is reachable. Returns { ok, db, messageCount }. Use this if other tools error to confirm whether the Mac is online.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'messages_recent',
    description: 'List the most recent iMessages across ALL chat threads. Returns chronological list with ts, sender handle, text, chatName. Default 20, max 200.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max messages (1-200, default 20)' } },
    },
  },
  {
    name: 'messages_list_chats',
    description: 'List recent active iMessage chat threads with last-message preview. Use to discover which chats exist before calling messages_get_chat. Default 30 chats, max 100.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max chats (1-100, default 30)' } },
    },
  },
  {
    name: 'messages_search',
    description: 'Search iMessage text body (case-insensitive substring). Returns chronological list of matches. Default 20, max 200.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query (substring)' },
        limit: { type: 'integer' },
      },
      required: ['q'],
    },
  },
  {
    name: 'messages_get_chat',
    description: 'Get messages from a single chat thread by GUID (the `chatGuid` returned from messages_list_chats). Default 50, max 500.',
    inputSchema: {
      type: 'object',
      properties: {
        chatGuid: { type: 'string', description: 'The chat GUID, e.g. "iMessage;-;+15551234567"' },
        limit: { type: 'integer' },
      },
      required: ['chatGuid'],
    },
  },
  {
    name: 'messages_get_contact',
    description: 'Get messages with a specific contact handle (phone number or email). Matches exact handle or substring. Default 50, max 500.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Phone (+15551234567) or email' },
        limit: { type: 'integer' },
      },
      required: ['handle'],
    },
  },
];

async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'messages_health':
      return relayGet('/health');
    case 'messages_recent':
      return relayGet(`/recent?limit=${args.limit || 20}`);
    case 'messages_list_chats':
      return relayGet(`/chats?limit=${args.limit || 30}`);
    case 'messages_search':
      return relayGet(`/search?q=${encodeURIComponent(args.q)}&limit=${args.limit || 20}`);
    case 'messages_get_chat':
      return relayGet(`/chat/${encodeURIComponent(args.chatGuid)}?limit=${args.limit || 50}`);
    case 'messages_get_contact':
      return relayGet(`/contact/${encodeURIComponent(args.handle)}?limit=${args.limit || 50}`);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ── CLI mode for testing ────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  (async () => {
    try {
      const h = await callTool('messages_health', {});
      console.log('OK', JSON.stringify(h));
      process.exit(0);
    } catch (e) {
      console.error('FAIL', e.message);
      process.exit(1);
    }
  })();
} else if (process.argv.includes('--call')) {
  const idx = process.argv.indexOf('--call');
  const name = process.argv[idx + 1];
  const args = process.argv[idx + 2] ? JSON.parse(process.argv[idx + 2]) : {};
  (async () => {
    try {
      const out = await callTool(name, args);
      console.log(JSON.stringify(out, null, 2));
    } catch (e) {
      console.error('ERROR', e.status || '', JSON.stringify(e.body || e.message));
      process.exit(1);
    }
  })();
}

// ── Minimal MCP stdio server ────────────────────────────────────────
const PROTOCOL = '2024-11-05';
function send(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'messages', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools });
  if (method === 'tools/call') {
    const { name, arguments: a } = params || {};
    try {
      const out = await callTool(name, a);
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    } catch (e) {
      const detail = e && e.body ? `${e.message}: ${JSON.stringify(e.body).slice(0, 800)}` : (e && e.message) || String(e);
      return ok(id, { content: [{ type: 'text', text: `ERROR: ${detail}` }], isError: true });
    }
  }
  if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
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
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handle(msg).catch((e) => console.error('handler error:', e));
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

if (!process.argv.includes('--selftest') && !process.argv.includes('--call')) {
  startStdio();
}
