#!/usr/bin/env node
/**
 * Read-only Google Workspace MCP connector for Nikki's unattended channels.
 * Every tool maps to a fixed executable and argument array; no shell is used.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = process.env.PROJECT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROTOCOL = '2024-11-05';

const tools = [
  { name: 'gmail_search', description: 'Search the owner Gmail account. READ-ONLY.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'] } },
  { name: 'gmail_inbox', description: 'List recent owner Gmail inbox messages. READ-ONLY.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } } },
  { name: 'gmail_read', description: 'Read one owner Gmail message by message id. READ-ONLY.', inputSchema: { type: 'object', properties: { message_id: { type: 'string' } }, required: ['message_id'] } },
  { name: 'calendar_today', description: 'List today’s Google Calendar events. READ-ONLY.', inputSchema: { type: 'object', properties: {} } },
  { name: 'calendar_week', description: 'List the next seven days of Google Calendar events. READ-ONLY.', inputSchema: { type: 'object', properties: {} } },
  { name: 'calendar_list_events', description: 'List Google Calendar events in a date range. READ-ONLY.', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, max: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['from', 'to'] } },
  { name: 'calendar_get_event', description: 'Get one Google Calendar event. READ-ONLY.', inputSchema: { type: 'object', properties: { event_id: { type: 'string' } }, required: ['event_id'] } },
  { name: 'drive_search', description: 'Search Google Drive. READ-ONLY.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'integer', minimum: 1, maximum: 50 }, mime: { type: 'string' } }, required: ['query'] } },
  { name: 'drive_recent', description: 'List recently modified Google Drive files. READ-ONLY.', inputSchema: { type: 'object', properties: { max: { type: 'integer', minimum: 1, maximum: 50 }, mime: { type: 'string' } } } },
  { name: 'drive_get', description: 'Get Google Drive file metadata. READ-ONLY.', inputSchema: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] } },
  { name: 'drive_read', description: 'Read supported Google Drive file content. READ-ONLY.', inputSchema: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] } },
];

function boundedInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
}

function addFlag(args, name, value) {
  if (value === undefined || value === null || value === '') return;
  args.push(`--${name}`, String(value));
}

async function runCli(script, args) {
  const { stdout } = await execFileAsync(process.execPath, [path.join(ROOT, 'dist', script), ...args], {
    cwd: ROOT,
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 90_000,
  });
  return JSON.parse(stdout);
}

async function callTool(name, a = {}) {
  switch (name) {
    case 'gmail_search': return runCli('gmail-cli.js', ['search', String(a.query), '--limit', String(boundedInt(a.limit, 20, 50))]);
    case 'gmail_inbox': return runCli('gmail-cli.js', ['inbox', '--limit', String(boundedInt(a.limit, 20, 50))]);
    case 'gmail_read': return runCli('gmail-cli.js', ['read', String(a.message_id)]);
    case 'calendar_today': return runCli('gcal-cli.js', ['today']);
    case 'calendar_week': return runCli('gcal-cli.js', ['week']);
    case 'calendar_list_events': return runCli('gcal-cli.js', ['list-events', '--from', String(a.from), '--to', String(a.to), '--max', String(boundedInt(a.max, 25, 100))]);
    case 'calendar_get_event': return runCli('gcal-cli.js', ['get-event', String(a.event_id)]);
    case 'drive_search': {
      const args = ['search', String(a.query), '--max', String(boundedInt(a.max, 20, 50))]; addFlag(args, 'mime', a.mime); return runCli('gdrive-cli.js', args);
    }
    case 'drive_recent': {
      const args = ['recent', '--max', String(boundedInt(a.max, 20, 50))]; addFlag(args, 'mime', a.mime); return runCli('gdrive-cli.js', args);
    }
    case 'drive_get': return runCli('gdrive-cli.js', ['get', String(a.file_id)]);
    case 'drive_read': return runCli('gdrive-cli.js', ['read', String(a.file_id)]);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function ok(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function fail(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') return ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'google_workspace_read', version: '1.0.0' } });
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools });
  if (method === 'tools/call') {
    try {
      const out = await callTool(params?.name, params?.arguments || {});
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    } catch (error) {
      const message = error?.stderr?.trim() || error?.message || String(error);
      return ok(id, { content: [{ type: 'text', text: `ERROR: ${message.slice(0, 1500)}` }], isError: true });
    }
  }
  if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    Promise.resolve(handle(msg)).catch((error) => {
      if (msg?.id !== undefined) fail(msg.id, -32603, error?.message || String(error));
    });
  }
});
