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

// ── Write commands ───────────────────────────────────────────────────
//
// Scope is drive.file — Nikki can create new files and modify files she
// created (or files Dante explicitly hands her by ID via Drive UI). She
// CANNOT modify random pre-existing files she didn't create.

async function cmdUpload(): Promise<void> {
  const localPath = getFlag('file');
  const contentFlag = getFlag('content');
  const name = getFlag('name');
  const parentId = getFlag('parent');
  const mimeOverride = getFlag('mime');
  if (!name) fail('upload requires --name (the Drive filename)');
  if (!localPath && !contentFlag) fail('upload requires --file PATH or --content STRING');
  const drive = getDriveApi();
  try {
    let body: NodeJS.ReadableStream | string;
    let mimeType = mimeOverride;
    if (localPath) {
      const fs = await import('node:fs');
      body = fs.createReadStream(localPath);
      if (!mimeType) {
        // Crude extension → mime mapping; users can override with --mime
        const ext = localPath.split('.').pop()?.toLowerCase() || '';
        const map: Record<string, string> = {
          pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
          csv: 'text/csv', json: 'application/json', html: 'text/html',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        };
        mimeType = map[ext] || 'application/octet-stream';
      }
    } else {
      body = contentFlag!;
      mimeType = mimeType || 'text/plain';
    }
    const r = await drive.files.create({
      requestBody: {
        name: name!,
        ...(parentId ? { parents: [parentId] } : {}),
      },
      media: { mimeType, body },
      fields: 'id,name,mimeType,webViewLink,createdTime',
    });
    out({ ok: true, action: 'uploaded', file: r.data });
  } catch (err) {
    fail(`upload failed: ${(err as Error).message}`);
  }
}

async function cmdCreateDoc(): Promise<void> {
  const name = getFlag('name');
  const content = getFlag('content');
  const parentId = getFlag('parent');
  if (!name) fail('create-doc requires --name');
  const drive = getDriveApi();
  try {
    const r = await drive.files.create({
      requestBody: {
        name: name!,
        mimeType: 'application/vnd.google-apps.document',
        ...(parentId ? { parents: [parentId] } : {}),
      },
      media: content ? { mimeType: 'text/plain', body: content } : undefined,
      fields: 'id,name,mimeType,webViewLink,createdTime',
    });
    out({ ok: true, action: 'created', file: r.data });
  } catch (err) {
    fail(`create-doc failed: ${(err as Error).message}`);
  }
}

async function cmdCreateSheet(): Promise<void> {
  const name = getFlag('name');
  const csv = getFlag('csv'); // initial CSV content
  const parentId = getFlag('parent');
  if (!name) fail('create-sheet requires --name');
  const drive = getDriveApi();
  try {
    const r = await drive.files.create({
      requestBody: {
        name: name!,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        ...(parentId ? { parents: [parentId] } : {}),
      },
      media: csv ? { mimeType: 'text/csv', body: csv } : undefined,
      fields: 'id,name,mimeType,webViewLink,createdTime',
    });
    out({ ok: true, action: 'created', file: r.data });
  } catch (err) {
    fail(`create-sheet failed: ${(err as Error).message}`);
  }
}

async function cmdCreateFolder(): Promise<void> {
  const name = getFlag('name');
  const parentId = getFlag('parent');
  if (!name) fail('create-folder requires --name');
  const drive = getDriveApi();
  try {
    const r = await drive.files.create({
      requestBody: {
        name: name!,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: 'id,name,webViewLink',
    });
    out({ ok: true, action: 'created', folder: r.data });
  } catch (err) {
    fail(`create-folder failed: ${(err as Error).message}`);
  }
}

async function cmdUpdateContent(fileId: string): Promise<void> {
  if (!fileId) fail('file id required');
  const localPath = getFlag('file');
  const content = getFlag('content');
  const mimeOverride = getFlag('mime');
  if (!localPath && !content) fail('update-content requires --file PATH or --content STRING');
  const drive = getDriveApi();
  try {
    let body: NodeJS.ReadableStream | string;
    let mimeType = mimeOverride || 'text/plain';
    if (localPath) {
      const fs = await import('node:fs');
      body = fs.createReadStream(localPath);
    } else {
      body = content!;
    }
    const r = await drive.files.update({
      fileId,
      media: { mimeType, body },
      fields: 'id,name,mimeType,modifiedTime,webViewLink',
    });
    out({ ok: true, action: 'updated', file: r.data });
  } catch (err) {
    fail(`update-content failed: ${(err as Error).message}`);
  }
}

async function cmdRename(fileId: string): Promise<void> {
  if (!fileId) fail('file id required');
  const name = getFlag('name');
  if (!name) fail('rename requires --name');
  const drive = getDriveApi();
  try {
    const r = await drive.files.update({
      fileId,
      requestBody: { name: name! },
      fields: 'id,name,modifiedTime',
    });
    out({ ok: true, action: 'renamed', file: r.data });
  } catch (err) {
    fail(`rename failed: ${(err as Error).message}`);
  }
}

async function cmdDelete(fileId: string): Promise<void> {
  if (!fileId) fail('file id required');
  const drive = getDriveApi();
  try {
    await drive.files.delete({ fileId });
    out({ ok: true, action: 'deleted', fileId });
  } catch (err) {
    fail(`delete failed: ${(err as Error).message}`);
  }
}

async function cmdShare(fileId: string): Promise<void> {
  if (!fileId) fail('file id required');
  const email = getFlag('email');
  const role = getFlag('role') || 'reader'; // reader | commenter | writer
  const type = getFlag('type') || 'user';   // user | group | anyone
  const notify = (getFlag('notify') || 'false') === 'true';
  const drive = getDriveApi();
  try {
    const r = await drive.permissions.create({
      fileId,
      requestBody: {
        role,
        type,
        ...(type !== 'anyone' && email ? { emailAddress: email } : {}),
      },
      sendNotificationEmail: notify,
      fields: 'id,role,type,emailAddress',
    });
    out({ ok: true, action: 'shared', permission: r.data });
  } catch (err) {
    fail(`share failed: ${(err as Error).message}`);
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

READ:
  node dist/gdrive-cli.js search QUERY     fulltext + name search
  node dist/gdrive-cli.js recent           recently modified files
  node dist/gdrive-cli.js get FILE_ID      file metadata
  node dist/gdrive-cli.js read FILE_ID     file content as text (Docs/Sheets/Slides auto-exported)
  node dist/gdrive-cli.js status           verify auth

WRITE (drive.file scope — limited to files Nikki creates):
  node dist/gdrive-cli.js upload --name N (--file PATH | --content STR) [--mime T] [--parent FOLDER_ID]
  node dist/gdrive-cli.js create-doc --name N [--content "initial text"] [--parent FOLDER_ID]
  node dist/gdrive-cli.js create-sheet --name N [--csv "a,b\\n1,2"] [--parent FOLDER_ID]
  node dist/gdrive-cli.js create-folder --name N [--parent FOLDER_ID]
  node dist/gdrive-cli.js update-content FILE_ID (--file PATH | --content STR) [--mime T]
  node dist/gdrive-cli.js rename FILE_ID --name N
  node dist/gdrive-cli.js delete FILE_ID
  node dist/gdrive-cli.js share FILE_ID --email a@b.com [--role reader|commenter|writer] [--notify true]

Flags:
  --max N         max results (default: 20)
  --mime TYPE     mimeType filter for search/recent OR override for write commands
  --parent ID     Drive folder ID to place a created file under
`);
    process.exit(0);
  }

  try {
    if (command === 'search') await cmdSearch(pos.slice(1).join(' '));
    else if (command === 'recent') await cmdRecent();
    else if (command === 'get') await cmdGet(pos[1]);
    else if (command === 'read') await cmdRead(pos[1]);
    else if (command === 'upload') await cmdUpload();
    else if (command === 'create-doc') await cmdCreateDoc();
    else if (command === 'create-sheet') await cmdCreateSheet();
    else if (command === 'create-folder') await cmdCreateFolder();
    else if (command === 'update-content') await cmdUpdateContent(pos[1]);
    else if (command === 'rename') await cmdRename(pos[1]);
    else if (command === 'delete') await cmdDelete(pos[1]);
    else if (command === 'share') await cmdShare(pos[1]);
    else if (command === 'status') await cmdStatus();
    else fail(`unknown command: ${command}`);
  } catch (err) {
    fail((err as Error).message);
  }
}

main().catch(err => fail(err.message));
