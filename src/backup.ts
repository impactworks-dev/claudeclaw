// Off-Fly nightly backup of the SQLite memory DB to Google Drive.
//
// Why: Fly's automatic volume snapshots live in the same region (iad). A Fly
// regional incident or account compromise takes the volume and snapshots
// together. This module pushes a consistent snapshot of claudeclaw.db to
// Google Drive nightly so we have an independent off-Fly recovery point.
//
// Schedule: 2:00 AM local time, daily. Same setTimeout pattern as
// runDailyBrief(). Wired up in src/index.ts.
//
// Backup procedure:
//   1. Run `sqlite3 .backup` against the live DB into a temp file. This is
//      the SQLite-recommended way to copy a busy database — never a raw
//      filesystem copy, which can produce a torn page mid-write.
//   2. gzip the snapshot.
//   3. Upload to Google Drive into a "ClaudeClaw Backups" folder (created
//      on first run). Filename: claudeclaw-YYYY-MM-DD.db.gz
//   4. Rotate: delete dailies older than 30 days that aren't first-of-month.
//      First-of-month files survive as monthlies; delete monthlies older
//      than 365 days.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

import { OAuth2Client } from 'google-auth-library';
import { google, type drive_v3 } from 'googleapis';

import { STORE_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

const DB_PATH = path.join(STORE_DIR, 'claudeclaw.db');
const BACKUP_FOLDER_NAME = 'ClaudeClaw Backups';
const DAILY_RETENTION_DAYS = 30;
const MONTHLY_RETENTION_DAYS = 365;
const BACKUP_FILE_RE = /^claudeclaw-(\d{4})-(\d{2})-(\d{2})\.db\.gz$/;

// ── OAuth setup (mirrors gdrive-cli) ──────────────────────────────────

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
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth not fully configured (need CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN).');
  }
  const c = new OAuth2Client(clientId, clientSecret);
  c.setCredentials({ refresh_token: refreshToken });
  cachedClient = c;
  return c;
}
function getDriveApi(): drive_v3.Drive {
  return google.drive({ version: 'v3', auth: getOAuthClient() });
}

// ── Drive helpers ─────────────────────────────────────────────────────

async function ensureBackupFolder(drive: drive_v3.Drive): Promise<string> {
  // Look for an existing folder owned by us with the canonical name.
  const r = await drive.files.list({
    q: `name = '${BACKUP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    pageSize: 5,
    fields: 'files(id,name)',
  });
  const existing = (r.data.files || [])[0];
  if (existing && existing.id) return existing.id;
  const created = await drive.files.create({
    requestBody: {
      name: BACKUP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  if (!created.data.id) throw new Error('Failed to create backup folder.');
  logger.info({ folderId: created.data.id }, 'backup: created ClaudeClaw Backups folder in Drive');
  return created.data.id;
}

async function listBackups(drive: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const all: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 100,
      fields: 'nextPageToken, files(id,name,createdTime,size)',
      pageToken,
    });
    all.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return all;
}

// ── Backup execution ──────────────────────────────────────────────────

function todayStamp(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function snapshotSqlite(srcDb: string, destFile: string): Promise<void> {
  // `sqlite3 file.db ".backup 'out.db'"` produces a consistent copy even
  // while writes are happening. Requires the sqlite3 CLI in PATH (baked
  // into the Fly Docker image).
  await execFileAsync('sqlite3', [srcDb, `.backup '${destFile}'`], {
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function gzipFile(src: string, dest: string): Promise<void> {
  await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(dest));
}

async function uploadBackup(drive: drive_v3.Drive, folderId: string, filePath: string, name: string): Promise<string> {
  const r = await drive.files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType: 'application/gzip', body: createReadStream(filePath) },
    fields: 'id,name,size',
  });
  return r.data.id || '';
}

interface RotationReport {
  kept: number;
  deletedDailies: number;
  deletedMonthlies: number;
  errors: string[];
}

async function rotate(drive: drive_v3.Drive, folderId: string): Promise<RotationReport> {
  const report: RotationReport = { kept: 0, deletedDailies: 0, deletedMonthlies: 0, errors: [] };
  const now = Date.now();
  const dailyCutoff = now - DAILY_RETENTION_DAYS * 24 * 3600 * 1000;
  const monthlyCutoff = now - MONTHLY_RETENTION_DAYS * 24 * 3600 * 1000;

  const files = await listBackups(drive, folderId);
  for (const f of files) {
    const m = (f.name || '').match(BACKUP_FILE_RE);
    if (!m || !f.id) { report.kept++; continue; } // Leave non-matching files alone
    const [, y, mo, d] = m;
    const date = Date.parse(`${y}-${mo}-${d}T00:00:00Z`);
    const isFirstOfMonth = d === '01';
    const tooOldDaily = !isFirstOfMonth && date < dailyCutoff;
    const tooOldMonthly = isFirstOfMonth && date < monthlyCutoff;
    if (tooOldDaily || tooOldMonthly) {
      try {
        await drive.files.delete({ fileId: f.id });
        if (isFirstOfMonth) report.deletedMonthlies++; else report.deletedDailies++;
      } catch (e) {
        report.errors.push(`delete ${f.name}: ${(e as Error).message}`);
      }
    } else {
      report.kept++;
    }
  }
  return report;
}

// ── Public entry point ────────────────────────────────────────────────

export interface BackupResult {
  ok: boolean;
  fileName: string;
  driveFileId: string | null;
  bytes: number;
  durationMs: number;
  rotation: RotationReport | null;
  error?: string;
}

export async function runBackup(): Promise<BackupResult> {
  const started = Date.now();
  const stamp = todayStamp();
  const fileName = `claudeclaw-${stamp}.db.gz`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-backup-'));
  const snapshotPath = path.join(tmpDir, 'claudeclaw.db');
  const gzPath = path.join(tmpDir, fileName);

  try {
    if (!fs.existsSync(DB_PATH)) {
      throw new Error(`source DB missing at ${DB_PATH}`);
    }
    logger.info('backup: snapshotting sqlite');
    await snapshotSqlite(DB_PATH, snapshotPath);
    const snapBytes = fs.statSync(snapshotPath).size;

    logger.info({ snapBytes }, 'backup: gzipping');
    await gzipFile(snapshotPath, gzPath);
    const gzBytes = fs.statSync(gzPath).size;

    logger.info({ gzBytes }, 'backup: uploading to Drive');
    const drive = getDriveApi();
    const folderId = await ensureBackupFolder(drive);
    const driveFileId = await uploadBackup(drive, folderId, gzPath, fileName);

    const rotation = await rotate(drive, folderId);

    logger.info(
      { fileName, driveFileId, gzBytes, rotation },
      'backup: complete',
    );
    return {
      ok: true,
      fileName,
      driveFileId,
      bytes: gzBytes,
      durationMs: Date.now() - started,
      rotation,
    };
  } catch (e) {
    const err = String((e as Error)?.message || e);
    logger.error({ err }, 'backup: failed');
    return {
      ok: false, fileName, driveFileId: null, bytes: 0,
      durationMs: Date.now() - started, rotation: null, error: err,
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** Milliseconds until next 2:00 AM local time. */
export function msUntilNext2am(now = new Date()): number {
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}
