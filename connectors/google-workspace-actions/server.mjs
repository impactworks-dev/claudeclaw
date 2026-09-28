#!/usr/bin/env node
/**
 * Guarded Google Workspace write tools for Nikki's explicitly prefixed owner
 * emails. This server intentionally omits delete, share, permission, and bulk
 * operations. It never invokes a shell.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = process.env.PROJECT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROTOCOL = '2024-11-05';

const tools = [
  { name: 'gmail_create_draft', description: 'Create, but never send, one Gmail draft requested with Nikki DRAFT:.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, cc: { type: 'string' }, bcc: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
  { name: 'gmail_send', description: 'Send one explicitly addressed email requested with Nikki SEND NOW:.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, cc: { type: 'string' }, bcc: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
  { name: 'gmail_reply', description: 'Reply once to an explicitly identified Gmail message and thread requested with Nikki SEND NOW:.', inputSchema: { type: 'object', properties: { message_id: { type: 'string' }, thread_id: { type: 'string' }, to: { type: 'string' }, cc: { type: 'string' }, body: { type: 'string' } }, required: ['message_id', 'thread_id', 'body'] } },
  { name: 'calendar_create_event', description: 'Create one Google Calendar event requested with Nikki CAL:.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' }, attendees: { type: 'string' }, all_day: { type: 'boolean' }, timezone: { type: 'string' } }, required: ['title', 'start', 'end'] } },
  { name: 'calendar_update_event', description: 'Update one explicitly identified Google Calendar event requested with Nikki CAL:. Deletion is unavailable.', inputSchema: { type: 'object', properties: { event_id: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' }, all_day: { type: 'boolean' }, timezone: { type: 'string' } }, required: ['event_id'] } },
  { name: 'calendar_respond', description: 'Accept, decline, or tentatively accept one event requested with Nikki CAL:.', inputSchema: { type: 'object', properties: { event_id: { type: 'string' }, response: { type: 'string', enum: ['accepted', 'declined', 'tentative'] } }, required: ['event_id', 'response'] } },
  { name: 'drive_create_doc', description: 'Create one Google Doc requested with Nikki DRIVE:.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' }, parent: { type: 'string' } }, required: ['name'] } },
  { name: 'drive_create_sheet', description: 'Create one Google Sheet from CSV requested with Nikki DRIVE:.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, csv: { type: 'string' }, parent: { type: 'string' } }, required: ['name'] } },
  { name: 'drive_create_folder', description: 'Create one Google Drive folder requested with Nikki DRIVE:.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, parent: { type: 'string' } }, required: ['name'] } },
  { name: 'drive_upload_text', description: 'Upload text as one new Drive file requested with Nikki DRIVE:.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' }, mime: { type: 'string' }, parent: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'drive_update_content', description: 'Replace content of one explicitly identified file Nikki can edit, requested with Nikki DRIVE:.', inputSchema: { type: 'object', properties: { file_id: { type: 'string' }, content: { type: 'string' }, mime: { type: 'string' } }, required: ['file_id', 'content'] } },
  { name: 'drive_rename', description: 'Rename one explicitly identified Drive file Nikki can edit, requested with Nikki DRIVE:. Deletion and sharing are unavailable.', inputSchema: { type: 'object', properties: { file_id: { type: 'string' }, name: { type: 'string' } }, required: ['file_id', 'name'] } },
];

function addFlag(args, name, value) {
  if (value === undefined || value === null || value === '') return;
  args.push(`--${name}`, String(value));
}

function compactText(value, max, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} is too long (max ${max} characters)`);
  return text;
}

function optionalCompactText(value, max, label) {
  if (value === undefined || value === null || value === '') return undefined;
  return compactText(value, max, label);
}

function assertRecipientCount(a) {
  const recipients = [a.to, a.cc, a.bcc]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  if (recipients.length === 0) throw new Error('At least one explicit recipient is required');
  if (recipients.length > 5) throw new Error('At most five explicit recipients are allowed per owner command');
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
    case 'gmail_create_draft': {
      assertRecipientCount(a);
      const args = ['draft', '--to', String(a.to), '--subject', compactText(a.subject, 300, 'subject'), '--body-text', compactText(a.body, 12000, 'body')];
      addFlag(args, 'cc', a.cc); addFlag(args, 'bcc', a.bcc); return runCli('gmail-cli.js', args);
    }
    case 'gmail_send': {
      assertRecipientCount(a);
      const args = ['send', '--to', String(a.to), '--subject', compactText(a.subject, 300, 'subject'), '--body-text', compactText(a.body, 12000, 'body')];
      addFlag(args, 'cc', a.cc); addFlag(args, 'bcc', a.bcc); return runCli('gmail-cli.js', args);
    }
    case 'gmail_reply': {
      const args = ['reply', '--id', String(a.message_id), '--thread', String(a.thread_id), '--body-text', compactText(a.body, 12000, 'body')];
      if (a.to || a.cc) assertRecipientCount(a);
      addFlag(args, 'to', a.to); addFlag(args, 'cc', a.cc); return runCli('gmail-cli.js', args);
    }
    case 'calendar_create_event': {
      const args = ['create-event', '--title', compactText(a.title, 300, 'title'), '--start', String(a.start), '--end', String(a.end)];
      compactText(a.start, 80, 'start'); compactText(a.end, 80, 'end');
      addFlag(args, 'description', optionalCompactText(a.description, 4000, 'description')); addFlag(args, 'location', optionalCompactText(a.location, 500, 'location')); addFlag(args, 'attendees', optionalCompactText(a.attendees, 1000, 'attendees')); addFlag(args, 'all-day', a.all_day); addFlag(args, 'timezone', optionalCompactText(a.timezone, 80, 'timezone') || 'America/Toronto'); return runCli('gcal-cli.js', args);
    }
    case 'calendar_update_event': {
      compactText(a.event_id, 300, 'event_id');
      const changed = ['title', 'start', 'end', 'description', 'location', 'all_day', 'timezone'].some((key) => a[key] !== undefined && a[key] !== null && a[key] !== '');
      if (!changed) throw new Error('calendar_update_event requires at least one field to update');
      const args = ['update-event', String(a.event_id)];
      addFlag(args, 'title', optionalCompactText(a.title, 300, 'title')); addFlag(args, 'start', optionalCompactText(a.start, 80, 'start')); addFlag(args, 'end', optionalCompactText(a.end, 80, 'end')); addFlag(args, 'description', optionalCompactText(a.description, 4000, 'description')); addFlag(args, 'location', optionalCompactText(a.location, 500, 'location')); addFlag(args, 'all-day', a.all_day); addFlag(args, 'timezone', optionalCompactText(a.timezone, 80, 'timezone') || 'America/Toronto'); return runCli('gcal-cli.js', args);
    }
    case 'calendar_respond': return runCli('gcal-cli.js', ['respond-to-event', compactText(a.event_id, 300, 'event_id'), '--response', compactText(a.response, 20, 'response')]);
    case 'drive_create_doc': {
      const args = ['create-doc', '--name', compactText(a.name, 180, 'name')]; addFlag(args, 'content', a.content ? compactText(a.content, 50000, 'content') : a.content); addFlag(args, 'parent', a.parent); return runCli('gdrive-cli.js', args);
    }
    case 'drive_create_sheet': {
      const args = ['create-sheet', '--name', compactText(a.name, 180, 'name')]; addFlag(args, 'csv', optionalCompactText(a.csv, 50000, 'csv')); addFlag(args, 'parent', a.parent); return runCli('gdrive-cli.js', args);
    }
    case 'drive_create_folder': {
      const args = ['create-folder', '--name', compactText(a.name, 180, 'name')]; addFlag(args, 'parent', a.parent); return runCli('gdrive-cli.js', args);
    }
    case 'drive_upload_text': {
      const args = ['upload', '--name', compactText(a.name, 180, 'name'), '--content', compactText(a.content, 50000, 'content'), '--mime', optionalCompactText(a.mime, 120, 'mime') || 'text/plain']; addFlag(args, 'parent', a.parent); return runCli('gdrive-cli.js', args);
    }
    case 'drive_update_content': {
      const args = ['update-content', compactText(a.file_id, 300, 'file_id'), '--content', compactText(a.content, 50000, 'content'), '--mime', optionalCompactText(a.mime, 120, 'mime') || 'text/plain']; return runCli('gdrive-cli.js', args);
    }
    case 'drive_rename': return runCli('gdrive-cli.js', ['rename', compactText(a.file_id, 300, 'file_id'), '--name', compactText(a.name, 180, 'name')]);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function ok(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function fail(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') return ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'google_workspace_actions', version: '1.0.0' } });
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
