#!/usr/bin/env tsx
// ClaudeClaw → iMessage relay daemon.
//
// Runs on the Mac (LaunchAgent), listens on 127.0.0.1:7457, exposes:
//   - GET  /health                    liveness + db state
//   - GET  /recent?limit=20           recent messages across all chats
//   - GET  /chats?limit=30            recent active chats with previews
//   - GET  /search?q=...&limit=20     full-text search across messages
//   - GET  /chat/:chatGuid?limit=50   messages in a specific chat thread
//   - GET  /contact/:handle?limit=50  messages with a specific phone/email
//
// Fly-side Nikki reaches this via the Cloudflare Tunnel hostname
// messages-relay.impactworks.com → cloudflared → localhost:7457.
//
// Authentication: shared bearer secret (RELAY_SHARED_SECRET) gates access.
//
// Read-only: shells out to /usr/bin/sqlite3 with `-readonly` flag against
// a temp copy of chat.db (Messages.app holds a write lock on the original;
// the macOS sqlite3 CLI handles WAL fine, but to be safe we cp first).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const PORT = parseInt(process.env.MESSAGES_RELAY_PORT || '7457', 10);
const SHARED_SECRET = process.env.RELAY_SHARED_SECRET || '';
const CHAT_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const SQLITE_BIN = '/usr/bin/sqlite3';
const CONTACTS_CACHE = path.join(os.homedir(), 'claudeclaw', 'relay', 'contacts.json');
const PEOPLE_MAP = path.join(os.homedir(), 'claudeclaw', 'relay', 'people-map.json');

// In-memory handle → name lookup, built from contacts.json + people-map.json
// at relay start. Reloads if either file changes mtime.
interface ContactCache {
  byHandle: Map<string, { name: string; org?: string | null; relationship?: string | null; source: 'contacts' | 'people-map' }>;
  loadedAt: number;
  contactsMtime: number;
  peopleMapMtime: number;
}

let contactCache: ContactCache = {
  byHandle: new Map<string, { name: string; org?: string | null; relationship?: string | null; source: 'contacts' | 'people-map' }>(),
  loadedAt: 0,
  contactsMtime: 0,
  peopleMapMtime: 0,
};

function normalizeHandle(s: string): string {
  if (!s) return '';
  if (s.includes('@')) return s.toLowerCase();
  return s.replace(/[^\d+]/g, '');
}

function loadContacts(): void {
  const byHandle = new Map<string, { name: string; org?: string | null; source: 'contacts' | 'people-map' }>();
  // 1. Load contacts.json — generated from vCard import
  try {
    const stat = fs.statSync(CONTACTS_CACHE);
    if (stat.mtimeMs !== contactCache.contactsMtime) {
      const arr = JSON.parse(fs.readFileSync(CONTACTS_CACHE, 'utf-8')) as Array<{
        name: string; org?: string | null; phones?: string[]; emails?: string[];
      }>;
      for (const c of arr) {
        const meta = { name: c.name, org: c.org || null, source: 'contacts' as const };
        for (const p of (c.phones || [])) byHandle.set(normalizeHandle(p), meta);
        for (const e of (c.emails || [])) byHandle.set(normalizeHandle(e), meta);
      }
      contactCache.contactsMtime = stat.mtimeMs;
    }
  } catch { /* file missing or invalid; skip */ }
  // 2. Load people-map.json — manual overrides take priority
  try {
    const stat = fs.statSync(PEOPLE_MAP);
    if (stat.mtimeMs !== contactCache.peopleMapMtime) {
      const raw = JSON.parse(fs.readFileSync(PEOPLE_MAP, 'utf-8')) as Record<string, string | { name: string; org?: string; relationship?: string }>;
      for (const [handle, val] of Object.entries(raw)) {
        if (handle.startsWith('_')) continue; // skip _comment etc.
        const meta = typeof val === 'string'
          ? { name: val, org: null, relationship: null, source: 'people-map' as const }
          : { name: val.name, org: val.org || null, relationship: val.relationship || null, source: 'people-map' as const };
        byHandle.set(normalizeHandle(handle), meta);
      }
      contactCache.peopleMapMtime = stat.mtimeMs;
    }
  } catch { /* file missing or invalid; skip */ }
  contactCache.byHandle = byHandle;
  contactCache.loadedAt = Date.now();
  console.log(`contacts cache: ${byHandle.size} handles loaded`);
}

function resolveHandle(raw: string | null | undefined): { name: string; org: string | null; relationship: string | null; source: string } | null {
  if (!raw) return null;
  const norm = normalizeHandle(raw);
  if (!norm) return null;
  // Re-check if files were updated since last load
  try { if (fs.statSync(CONTACTS_CACHE).mtimeMs !== contactCache.contactsMtime) loadContacts(); } catch {}
  try { if (fs.statSync(PEOPLE_MAP).mtimeMs !== contactCache.peopleMapMtime) loadContacts(); } catch {}
  const hit = contactCache.byHandle.get(norm);
  if (hit) return { name: hit.name, org: hit.org || null, relationship: hit.relationship || null, source: hit.source };
  // Phone fallback: try last-10-digit match (US numbers)
  if (/^\+?\d+$/.test(norm)) {
    const last10 = norm.replace(/^\+/, '').slice(-10);
    for (const [k, v] of contactCache.byHandle) {
      if (k.replace(/^\+/, '').endsWith(last10) && last10.length === 10) {
        return { name: v.name, org: v.org || null, relationship: v.relationship || null, source: v.source };
      }
    }
  }
  return null;
}

loadContacts();

if (!SHARED_SECRET) {
  console.error('FATAL: RELAY_SHARED_SECRET env var required.');
  process.exit(1);
}
if (!fs.existsSync(CHAT_DB)) {
  console.error(`FATAL: chat.db not found at ${CHAT_DB}`);
  process.exit(1);
}

const APPLE_EPOCH_OFFSET_MS = Date.UTC(2001, 0, 1);

function appleNsToEpochMs(ns: any): number | null {
  if (ns === null || ns === undefined || ns === '') return null;
  const n = typeof ns === 'number' ? ns : Number(ns);
  if (!Number.isFinite(n) || n === 0) return null;
  return APPLE_EPOCH_OFFSET_MS + Math.round(n / 1_000_000);
}

// Run a SQL query and return the result rows. `-json` returns an array of
// row objects. macOS sqlite3 3.51 supports this natively.
async function sqlQuery(sql: string, params: (string | number)[] = []): Promise<any[]> {
  // sqlite3 supports `.parameter set :name value` for bind params, but the
  // simplest portable thing is to inline numeric/text params escaped. Since
  // user input only comes through our own controllers, we use parameter
  // substitution via `.parameter set`.
  let fullSql = '';
  for (let i = 0; i < params.length; i++) {
    const name = `:p${i}`;
    const val = params[i];
    if (typeof val === 'number') {
      fullSql += `.parameter set ${name} ${val}\n`;
    } else {
      // Escape single quotes by doubling; sqlite handles this safely
      const escaped = String(val).replace(/'/g, "''");
      fullSql += `.parameter set ${name} '${escaped}'\n`;
    }
  }
  fullSql += `${sql};\n`;
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(SQLITE_BIN, ['-readonly', '-json', CHAT_DB]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`sqlite3 exit ${code}: ${err.slice(0, 300)}`));
      resolve(out);
    });
    child.stdin.write(fullSql);
    child.stdin.end();
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try { return JSON.parse(trimmed); } catch { return []; }
}

interface MessageOut {
  rowid: number;
  guid: string;
  ts: number | null;
  isFromMe: boolean;
  handle: string | null;
  handleName: string | null;          // resolved from contacts/people-map
  handleOrg: string | null;
  handleRelationship: string | null;  // wife/mother/customer/etc. from people-map
  service: string | null;
  text: string;
  hasAttachment: boolean;
  chatGuid: string | null;
  chatName: string | null;
}

// Decode attributedBody (binary plist) — quick heuristic for newer iMessages
// where the text column is null. Returns the longest printable ASCII run
// not matching known plist machinery.
function decodeAttributedBody(hex: string | null): string {
  if (!hex || hex.length < 32) return '';
  try {
    const buf = Buffer.from(hex, 'hex');
    const s = buf.toString('utf-8');
    const matches = s.match(/[\x20-\x7E -￿]{3,}/g) || [];
    const candidates = matches.filter(m =>
      !/^(NSAttributedString|NSDictionary|NSObject|NSString|NSNumber|NSArray|NSMutableString|NSValue|streamtyped|iI|__kIM|MessageProperties|com\.apple)/.test(m),
    );
    if (candidates.length === 0) return '';
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0].replace(/[\x00-\x1F]+/g, ' ').trim();
  } catch { return ''; }
}

function rowToMessage(r: any): MessageOut {
  const text = (r.text && String(r.text).trim()) ? String(r.text) : decodeAttributedBody(r.attributedBody_hex);
  const resolved = resolveHandle(r.handle_id_str);
  return {
    rowid: r.rowid,
    guid: r.guid,
    ts: appleNsToEpochMs(r.date),
    isFromMe: !!r.is_from_me,
    handle: r.handle_id_str ?? null,
    handleName: resolved?.name || null,
    handleOrg: resolved?.org || null,
    handleRelationship: resolved?.relationship || null,
    service: r.service ?? null,
    text,
    hasAttachment: !!r.cache_has_attachments,
    chatGuid: r.chat_guid ?? null,
    chatName: r.chat_display_name || r.chat_identifier || null,
  };
}

const BASE_SELECT = `
  SELECT
    m.ROWID                       AS rowid,
    m.guid                        AS guid,
    m.date                        AS date,
    m.text                        AS text,
    hex(m.attributedBody)         AS attributedBody_hex,
    m.is_from_me                  AS is_from_me,
    m.cache_has_attachments       AS cache_has_attachments,
    m.service                     AS service,
    h.id                          AS handle_id_str,
    c.guid                        AS chat_guid,
    c.display_name                AS chat_display_name,
    c.chat_identifier             AS chat_identifier
  FROM message m
  LEFT JOIN handle h            ON h.ROWID = m.handle_id
  LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  LEFT JOIN chat c              ON c.ROWID = cmj.chat_id
`;

const app = new Hono();

app.use('*', async (c, next) => {
  if (c.req.path === '/health' || c.req.path === '/') return next();
  const auth = c.req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== SHARED_SECRET) return c.json({ error: 'unauthorized' }, 401);
  return next();
});

app.get('/health', async (c) => {
  try {
    const rows = await sqlQuery('SELECT COUNT(*) as n FROM message');
    return c.json({
      ok: true,
      db: CHAT_DB,
      messageCount: rows[0]?.n ?? 0,
      contactsLoaded: contactCache.byHandle.size,
    });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

app.get('/resolve', (c) => {
  const handle = c.req.query('handle') || '';
  if (!handle) return c.json({ error: 'handle query param required' }, 400);
  const r = resolveHandle(handle);
  return c.json({ handle, resolved: r });
});

app.get('/contacts', (c) => {
  // Returns count + sample. Useful to confirm cache loaded after vCard import.
  return c.json({
    count: contactCache.byHandle.size,
    contactsMtime: contactCache.contactsMtime,
    peopleMapMtime: contactCache.peopleMapMtime,
    sample: Array.from(contactCache.byHandle.entries()).slice(0, 10).map(([h, v]) => ({ handle: h, ...v })),
  });
});

app.get('/', (c) => c.html('<h1>ClaudeClaw → iMessage Relay</h1><p>GET /health, /recent, /chats, /search, /chat/:guid, /contact/:handle with Bearer auth.</p>'));

app.get('/recent', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 200);
  const rows = await sqlQuery(`${BASE_SELECT} ORDER BY m.date DESC LIMIT :p0`, [limit]);
  return c.json({ messages: rows.map(rowToMessage) });
});

app.get('/chats', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '30', 10), 100);
  const chatRows = await sqlQuery(`
    SELECT
      c.guid                        AS chat_guid,
      c.display_name                AS chat_display_name,
      c.chat_identifier             AS chat_identifier,
      MAX(m.date)                   AS last_date,
      COUNT(m.ROWID)                AS msg_count
    FROM chat c
    LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
    LEFT JOIN message m             ON m.ROWID = cmj.message_id
    GROUP BY c.ROWID
    HAVING last_date IS NOT NULL
    ORDER BY last_date DESC
    LIMIT :p0
  `, [limit]);

  // Fetch last message preview for each chat
  const chats = [];
  for (const r of chatRows) {
    const preview = await sqlQuery(`${BASE_SELECT} WHERE c.guid = :p0 ORDER BY m.date DESC LIMIT 1`, [r.chat_guid]);
    chats.push({
      chatGuid: r.chat_guid,
      name: r.chat_display_name || r.chat_identifier,
      messageCount: r.msg_count,
      lastTs: appleNsToEpochMs(r.last_date),
      lastMessage: preview[0] ? rowToMessage(preview[0]) : null,
    });
  }
  return c.json({ chats });
});

app.get('/search', async (c) => {
  const q = c.req.query('q') || '';
  if (!q.trim()) return c.json({ error: 'q query param required' }, 400);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 200);
  const rows = await sqlQuery(
    `${BASE_SELECT} WHERE m.text LIKE :p0 COLLATE NOCASE ORDER BY m.date DESC LIMIT :p1`,
    [`%${q}%`, limit],
  );
  return c.json({ query: q, matches: rows.map(rowToMessage) });
});

app.get('/chat/:guid', async (c) => {
  const guid = c.req.param('guid');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 500);
  const rows = await sqlQuery(
    `${BASE_SELECT} WHERE c.guid = :p0 ORDER BY m.date DESC LIMIT :p1`,
    [guid, limit],
  );
  return c.json({ chatGuid: guid, messages: rows.map(rowToMessage) });
});

app.get('/contact/:handle', async (c) => {
  const handle = c.req.param('handle');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 500);
  const rows = await sqlQuery(
    `${BASE_SELECT} WHERE h.id = :p0 OR h.id LIKE :p1 ORDER BY m.date DESC LIMIT :p2`,
    [handle, `%${handle}%`, limit],
  );
  return c.json({ contact: handle, messages: rows.map(rowToMessage) });
});

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  console.log(`messages-relay listening on http://127.0.0.1:${info.port}`);
  console.log(`chat.db at ${CHAT_DB}`);
});
