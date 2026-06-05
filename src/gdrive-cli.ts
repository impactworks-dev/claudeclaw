#!/usr/bin/env node
/**
 * ClaudeClaw Google Drive CLI
 *
 * Mirrors the Gmail / Calendar CLI pattern. Used by Nikki via the Bash
 * tool to search and read Google Drive files without a stdio MCP server.
 *
 * Uses GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET +
 * GOOGLE_REFRESH_TOKEN (falls back to GMAIL_REFRESH_TOKEN — same token
 * works for all Google APIs as long as the drive scope was authorized
 * via src/gmail-auth.ts).
 *
 * Commands:
 *   node dist/gdrive-cli.js search "QUERY"           Drive search
 *   node dist/gdrive-cli.js recent [--max N]         recently modified
 *   node dist/gdrive-cli.js get FILE_ID              file metadata
 *   node dist/gdrive-cli.js read FILE_ID             file content as text
 *   node dist/gdrive-cli.js status                   verify auth
 *
 * Flags:
 *   --max N        max results (default: 20)
 *   --mime TYPE    filter by mime type (search/recent)
 *
 * All commands print clean JSON to stdout. Errors print JSON to stderr
 * and exit non-zero.
 */

import { OAuth2Client } from 'google-auth-library';
import { google, type drive_v3 } from 'googleapis';

import { readEnvFile } from './env.js';

// ── OAuth client (lazy singleton) ────────────────────────────────────

let cachedClient: OAuth2Client | null = null;

function getOAuthClient(): OAuth2Client {
  if (cachedClient) return cachedClient;
  const env = readEnvFile([
    'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN', 'GMAIL_REFRESH_TOKEN',
  ]);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  const refreshToken =
    process.env.GOOGLE_REFRESH_TOKEN || env.GOOGLE_REFRESH_TOKEN ||
    process.env.GMAIL_REFRESH_TOKEN || env.GMAIL_REFRESH_TOKEN || '';
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth not configured: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET missing.');
  }
  if (!refreshToken) {
    throw new Error('GOOGLE_REFRESH_TOKEN / GMAIL_REFRESH_TOKEN is not set. Run `npx tsx src/gmail-auth.ts` locally to mint one with drive scope.');
  }
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  cachedClient = client;
  return client;
}

function getDriveApi(): drive_v3.Drive {
  return google.drive({ version: 'v3', auth: getOAuthClient() });
}

// ── Helpers ──────────────────────────────────────────────────────────

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}
function getNumFlag(name: string, fallback: number): number {
  const v = getFlag(name);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function positional(): string[] {
  const FLAGS = new Set(['max', 'mime']);
  const skip = new Set<number>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--') && FLAGS.has(a.slice(2))) { skip.add(i); skip.add(i + 1); }
  }
  return process.argv.filter((_, i) => i >= 2 && !skip.has(i));
}
function out(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + '\n'); }
function fail(message: string, code = 1): never {
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + '\n');
  process.exit(code);
}

function fmtFile(f: drive_v3.Schema$File): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    createdTime: f.createdTime,
    owners: (f.owners || []).map(o => ({ name: o.displayName, email: o.emailAddress })),
    webViewLink: f.webViewLink,
    parents: f.parents,
    size: f.size,
  };
}

// Google Docs / Sheets / Slides need export rather than direct download.
// Map mime to export-as-plaintext where applicable; everything else uses get.media.
const EXPORT_MAP: Record<string, string> = {
  'application/vnd.google-apps.document':     'text/plain',
  'application/vnd.google-apps.spreadsheet':  'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

// ── Commands ─────────────────────────────────────────────────────────

async function cmdSearch(query: string): Promise<void> {
  if (!query) fail('search requires a query');
  const drive = getDriveApi();
  const max = getNumFlag('max', 20);
  const mime = getFlag('mime');
  // Build a Drive Search query. Default behavior: fulltext + name contains.
  const q = [
    `(fullText contains '${query.replace(/'/g, "\\'")}' or name contains '${query.replace(/'/g, "\\'")}')`,
    mime ? `mimeType = '${mime}'` : '',
    `trashed = false`,
  ].filter(Boolean).join(' and ');
  try {
    const r = await drive.files.list({
      q,
      orderBy: 'modifiedTime desc',
      pageSize: max,
      fields: 'files(id,name,mimeType,modifiedTime,createdTime,owners(displayName,emailAddress),webViewLink,parents,size)',
    });
    const files = (r.data.files || []).map(fmtFile);
    out({ ok: true, query, count: files.length, files });
  } catch (err) {
    fail(`drive search failed: ${(err as Error).message}`);
  }
}

async function cmdRecent(): Promise<void> {
  const drive = getDriveApi();
  const max = getNumFlag('max', 20);
  const mime = getFlag('mime');
  const q = [mime ? `mimeType = '${mime}'` : '', `trashed = false`].filter(Boolean).join(' and ') || 'trashed = false';
  try {
    const r = await drive.files.list({
      q,
      orderBy: 'modifiedTime desc',
      pageSize: max,
      fields: 'files(id,name,mimeType,modifiedTime,createdTime,owners(displayName,emailAddress),webViewLink,parents,size)',
    });
    const files = (r.data.files || []).map(fmtFile);
    out({ ok: true, count: files.length, files });
  } catch (err) {
    fail(`recent files failed: ${(err as Error).message}`);
  }
}

async function cmdGet(fileId: string): Promise<void> {
  if (!fileId) fail('file id required');
  const drive = getDriveApi();
  try {
    const r = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,modifiedTime,createdTime,owners(displayName,emailAddress),webViewLink,parents,size,description',
    });
    out({ ok: true, file: fmtFile(r.data) });
  } catch (err) {
    fail(`get file failed: ${(err as Error).message}`);
  }
}

async function cmdRead(fileId: string): Promise<void> {
  if (!fileId) fail('file id required');
  const drive = getDriveApi();
  try {
    const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType' });
    const mimeType = meta.data.mimeType || '';
    const exportMime = EXPORT_MAP[mimeType];
    let text: string;
    if (exportMime) {
      const r = await drive.files.export({ fileId, mimeType: exportMime }, { responseType: 'text' });
      text = String(r.data);
    } else if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
      const r = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
      text = String(r.data);
    } else {
      fail(`unsupported mimeType for text read: ${mimeType}. Try cmdGet for metadata + webViewLink.`);
    }
    // Cap at 50K chars so we don't blow Nikki's prompt
    const truncated = text.length > 50_000;
    out({
      ok: true,
      fileId,
      name: meta.data.name,
      mimeType,
      length: text.length,
      truncated,
      content: text.slice(0, 50_000),
    });
  } catch (err) {
    fail(`read file failed: ${(err as Error).message}`);
  }
}

async function cmdStatus(): Promise<void> {
  try {
    const drive = getDriveApi();
    const r = await drive.about.get({ fields: 'user(emailAddress,displayName),storageQuota(limit,usage)' });
    out({ ok: true, authorized: true, user: r.data.user, storage: r.data.storageQuota });
  } catch (err) {
    fail(`status failed: ${(err as Error).message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pos = positional();
  const command = pos[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`Google Drive CLI

  node dist/gdrive-cli.js search QUERY     fulltext + name search
  node dist/gdrive-cli.js recent           recently modified files
  node dist/gdrive-cli.js get FILE_ID      file metadata
  node dist/gdrive-cli.js read FILE_ID     file content as text (Docs/Sheets/Slides auto-exported)
  node dist/gdrive-cli.js status           verify auth

Flags:
  --max N         max results (default: 20)
  --mime TYPE     mimeType filter for search/recent (e.g. application/vnd.google-apps.document)
`);
    process.exit(0);
  }

  try {
    if (command === 'search') await cmdSearch(pos.slice(1).join(' '));
    else if (command === 'recent') await cmdRecent();
    else if (command === 'get') await cmdGet(pos[1]);
    else if (command === 'read') await cmdRead(pos[1]);
    else if (command === 'status') await cmdStatus();
    else fail(`unknown command: ${command}`);
  } catch (err) {
    fail((err as Error).message);
  }
}

main().catch(err => fail(err.message));
