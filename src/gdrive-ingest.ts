/**
 * gdrive-ingest.ts
 *
 * One-time (and re-runnable) backfill: scans Google Drive, reads every
 * readable document, extracts structured knowledge via Gemini, and saves
 * it to the ClaudeClaw memory DB + Obsidian vault.
 *
 * Readable types: Google Docs, Sheets, Slides, PDFs, plain text
 * Skips: binary files, already-ingested files (by fileId + modifiedTime)
 * Rate limiting: configurable delay between Gemini calls (default 2s)
 *
 * Index file: /app/store/gdrive-index.json (or local store/)
 * Tracks fileId → { modifiedTime, memoryId, ingestedAt } so re-runs are idempotent.
 *
 * CLI usage:
 *   npx tsx src/gdrive-ingest.ts [--limit N] [--delay-ms N] [--dry-run] [--reset]
 *   --limit N      max files to process this run (default: 50, use 0 for all)
 *   --delay-ms N   ms between Gemini calls (default: 2000)
 *   --dry-run      fetch + extract but don't write to DB or vault
 *   --reset        clear the index and re-process everything
 *   --type T       only process: doc | sheet | slide | pdf (default: all)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

import { generateContent, parseJsonResponse } from './gemini.js';
import { initDatabase, saveStructuredMemory } from './db.js';
import { requireEnabled } from './kill-switches.js';
import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  createdTime: string;
  webViewLink: string;
  parents?: string[];
  size?: string;
}

interface ExtractionResult {
  summary: string;
  key_facts: string[];
  entities: string[];
  topics: string[];
  importance: number;
  document_type: string;
}

interface IndexEntry {
  modifiedTime: string;
  memoryId: number;
  ingestedAt: string;
  name: string;
}

interface IngestIndex {
  [fileId: string]: IndexEntry;
}

// ── Config ────────────────────────────────────────────────────────────────────

const READABLE_MIMES: Record<string, string> = {
  'application/vnd.google-apps.document':     'doc',
  'application/vnd.google-apps.spreadsheet':  'sheet',
  'application/vnd.google-apps.presentation': 'slide',
  // PDFs are excluded: gdrive-cli can't read them as text (returns unsupported mimeType error)
  'text/plain':                                'text',
  'text/markdown':                             'text',
};

// Files to skip — junk that won't have useful business content
const SKIP_NAME_PATTERNS = [
  /\.(sqlite|db|shm|wal|log|lock|tmp)$/i,
  /^Receipt-/i,
  /^invoice-#\d/i,
  /untitled/i,
];

const MAX_CONTENT_CHARS = 40_000;   // Gemini context budget per doc
const OBSIDIAN_DRIVE_FOLDER = 'Drive';
const SOURCE_TAG = 'gdrive';

function resolveStorePath(): string {
  if (fs.existsSync('/app/store')) return '/app/store';
  // Local dev fallback
  const local = path.join(process.cwd(), 'store');
  if (!fs.existsSync(local)) fs.mkdirSync(local, { recursive: true });
  return local;
}

function resolveVaultPath(): string {
  const env = process.env.OBSIDIAN_VAULT_PATH;
  if (env?.trim()) return env.trim();
  if (fs.existsSync('/app/store/obsidian-brain')) return '/app/store/obsidian-brain';
  const mac = '/Users/dantecrescenzi/Documents/Claude/Obsidian Brain/Obsidian Brain';
  if (fs.existsSync(mac)) return mac;
  return '/app/store/obsidian-brain';
}

function getProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

// ── Index helpers ─────────────────────────────────────────────────────────────

function loadIndex(storePath: string): IngestIndex {
  const p = path.join(storePath, 'gdrive-index.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function saveIndex(storePath: string, index: IngestIndex): void {
  const p = path.join(storePath, 'gdrive-index.json');
  fs.writeFileSync(p, JSON.stringify(index, null, 2), 'utf8');
}

function isAlreadyIngested(index: IngestIndex, file: DriveFile): boolean {
  const entry = index[file.id];
  if (!entry) return false;
  return entry.modifiedTime === file.modifiedTime;
}

// ── Drive CLI wrappers ────────────────────────────────────────────────────────

function getCliPath(): string {
  const root = getProjectRoot();
  return path.join(root, 'dist', 'gdrive-cli.js');
}

async function listDriveFiles(mimeType: string, maxFiles: number): Promise<DriveFile[]> {
  const cli = getCliPath();
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cli, 'recent', '--max', String(maxFiles), '--mime', mimeType],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: 5 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout);
    return data.files ?? [];
  } catch (err) {
    logger.warn({ err, mimeType }, 'Failed to list Drive files');
    return [];
  }
}

async function readDriveFile(fileId: string): Promise<string | null> {
  const cli = getCliPath();
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cli, 'read', fileId],
      { encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
    // gdrive-cli wraps content in JSON: { ok, content } or just returns text
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.content) return parsed.content;
      if (parsed.text) return parsed.text;
      // If it parsed but no content field, maybe error
      if (!parsed.ok) return null;
    } catch {
      // Not JSON — raw text content returned directly
      return stdout;
    }
    return stdout;
  } catch (err) {
    logger.warn({ err, fileId }, 'Failed to read Drive file');
    return null;
  }
}

// ── Gemini extraction ─────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are an AI analyst reading a business document for Dante Crescenzi, a serial entrepreneur running ImpactWorks (AI/digital agency) and Rocket Local (AI local marketing). Extract structured knowledge from this document that will help Dante's AI assistant understand his business, relationships, finances, and decisions.

Document name: {NAME}
Document type: {TYPE}
Date modified: {DATE}

Content:
{CONTENT}

Extract what's worth remembering long-term. Focus on:
- Business decisions, agreements, or commitments
- Financial figures (revenue, costs, contracts, invoices)
- Client/partner names and relationship context
- Project status, timelines, or deliverables
- Strategic insights or problems being solved
- Legal/operational facts (entity names, filings, terms)

Skip boilerplate, filler content, template text, and trivial meeting chit-chat.

Return JSON:
{
  "summary": "2-3 sentence description of what this document is and why it matters",
  "key_facts": ["fact 1", "fact 2", ...],
  "entities": ["Person Name", "Company", "Project", "$amount", ...],
  "topics": ["finance", "client", "legal", "operations", "marketing", ...],
  "importance": 0.0-1.0,
  "document_type": "meeting_notes|contract|proposal|financial|strategy|reference|other"
}

If the document has no useful business content, return importance: 0.1 and minimal facts.`;

async function extractFromContent(
  file: DriveFile,
  content: string,
  fileType: string,
): Promise<ExtractionResult | null> {
  const truncated = content.slice(0, MAX_CONTENT_CHARS);
  const prompt = EXTRACTION_PROMPT
    .replace('{NAME}', file.name)
    .replace('{TYPE}', fileType)
    .replace('{DATE}', file.modifiedTime.split('T')[0])
    .replace('{CONTENT}', truncated);

  try {
    const raw = await generateContent(prompt);
    const result = parseJsonResponse<ExtractionResult>(raw);
    return result;
  } catch (err) {
    logger.warn({ err, fileName: file.name }, 'Gemini extraction failed');
    return null;
  }
}

// ── Obsidian note writer ───────────────────────────────────────────────────────

function writeObsidianNote(
  vaultPath: string,
  file: DriveFile,
  result: ExtractionResult,
  fileType: string,
  dryRun: boolean,
): void {
  const folder = path.join(vaultPath, OBSIDIAN_DRIVE_FOLDER, result.document_type ?? fileType);
  const safeName = file.name.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100);
  const notePath = path.join(folder, `${safeName}.md`);

  const content = `---
title: "${file.name.replace(/"/g, "'")}"
source: gdrive
gdrive_id: ${file.id}
gdrive_type: ${fileType}
document_type: ${result.document_type}
modified: ${file.modifiedTime.split('T')[0]}
importance: ${result.importance}
tags: [gdrive, ${result.document_type}, ai-ingested]
entities: [${result.entities.map(e => `"${e.replace(/"/g, "'")}"` ).join(', ')}]
topics: [${result.topics.join(', ')}]
---

# ${file.name}

${result.summary}

## Key Facts

${result.key_facts.map(f => `- ${f}`).join('\n')}

## Source

[Open in Google Drive](${file.webViewLink})
*Ingested: ${new Date().toISOString().split('T')[0]}*
`;

  if (dryRun) {
    logger.info({ path: notePath }, '[DRY RUN] Would write Obsidian note');
    return;
  }

  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(notePath, content, 'utf8');
  } catch (err) {
    logger.warn({ err, path: notePath }, 'Failed to write Obsidian note');
  }
}

// ── Sleep helper ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Main ingest function ──────────────────────────────────────────────────────

export async function runDriveIngest(opts: {
  limit?: number;
  delayMs?: number;
  dryRun?: boolean;
  reset?: boolean;
  typeFilter?: string;
  verbose?: boolean;
} = {}): Promise<{
  scanned: number;
  skipped: number;
  processed: number;
  failed: number;
  memoriesSaved: number;
}> {
  requireEnabled('LLM_SPAWN_ENABLED');

  const limit = opts.limit ?? 50;
  const delayMs = opts.delayMs ?? 2000;
  const dryRun = opts.dryRun ?? false;
  const typeFilter = opts.typeFilter ?? null;
  const storePath = resolveStorePath();
  const vaultPath = resolveVaultPath();

  const index = opts.reset ? {} : loadIndex(storePath);
  if (opts.reset) logger.info('Index reset — will re-process all files');

  // Collect all readable files across types
  const mimeTypes = Object.entries(READABLE_MIMES)
    .filter(([, label]) => !typeFilter || typeFilter === label);

  const perTypeCap = limit > 0 ? Math.ceil(limit * 1.5) : 500; // fetch extra to account for skips
  const allFiles: Array<DriveFile & { fileType: string }> = [];

  console.log('Scanning Drive...');
  for (const [mimeType, fileType] of mimeTypes) {
    const files = await listDriveFiles(mimeType, perTypeCap);
    console.log(`  ${fileType}: ${files.length} files found`);
    for (const f of files) {
      allFiles.push({ ...f, fileType });
    }
  }

  // Sort by modifiedTime desc (most recent first)
  allFiles.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));

  // Filter junk
  const candidates = allFiles.filter(f => {
    if (SKIP_NAME_PATTERNS.some(p => p.test(f.name))) return false;
    return true;
  });

  console.log(`\nTotal candidates: ${candidates.length}`);
  console.log(`Already ingested (up to date): ${candidates.filter(f => isAlreadyIngested(index, f)).length}`);

  const toProcess = candidates.filter(f => !isAlreadyIngested(index, f));
  const batch = limit > 0 ? toProcess.slice(0, limit) : toProcess;

  console.log(`Processing this run: ${batch.length}\n`);

  let processed = 0;
  let failed = 0;
  let memoriesSaved = 0;
  const skipped = candidates.length - batch.length;

  for (const file of batch) {
    const label = `[${processed + 1}/${batch.length}] ${file.name.slice(0, 60)}`;
    process.stdout.write(`${label}... `);

    // Read content
    const content = await readDriveFile(file.id);
    if (!content || content.trim().length < 50) {
      process.stdout.write('(no content, skip)\n');
      failed++;
      continue;
    }

    // Extract via Gemini
    const result = await extractFromContent(file, content, file.fileType);
    if (!result) {
      process.stdout.write('(extraction failed)\n');
      failed++;
      await sleep(delayMs);
      continue;
    }

    // Skip low-importance docs (junk, templates, etc.)
    if (result.importance < 0.2) {
      process.stdout.write(`(low importance ${result.importance}, skip)\n`);
      // Still mark as indexed so we don't retry
      index[file.id] = {
        modifiedTime: file.modifiedTime,
        memoryId: -1,
        ingestedAt: new Date().toISOString(),
        name: file.name,
      };
      if (!dryRun) saveIndex(storePath, index);
      processed++;
      await sleep(Math.floor(delayMs / 4));
      continue;
    }

    // Build memory content
    const rawText = [
      `[Google Drive: ${file.name}]`,
      `Type: ${result.document_type}`,
      `Modified: ${file.modifiedTime.split('T')[0]}`,
      `URL: ${file.webViewLink}`,
      '',
      result.summary,
      '',
      'Key facts:',
      ...result.key_facts.map(f => `- ${f}`),
    ].join('\n');

    // Save to memory DB
    let memoryId = -1;
    if (!dryRun) {
      memoryId = saveStructuredMemory(
        'gdrive-ingest',
        rawText,
        result.summary,
        result.entities,
        result.topics,
        result.importance,
        SOURCE_TAG,
        'main',
      );
      memoriesSaved++;
    } else {
      memoriesSaved++; // count for dry-run reporting
    }

    // Write Obsidian note
    if (result.importance >= 0.4) {
      writeObsidianNote(vaultPath, file, result, file.fileType, dryRun);
    }

    // Update index
    index[file.id] = {
      modifiedTime: file.modifiedTime,
      memoryId,
      ingestedAt: new Date().toISOString(),
      name: file.name,
    };
    if (!dryRun) saveIndex(storePath, index);

    process.stdout.write(`✓ (importance: ${result.importance}, ${result.key_facts.length} facts)\n`);
    processed++;

    await sleep(delayMs);
  }

  const summary = {
    scanned: candidates.length,
    skipped,
    processed,
    failed,
    memoriesSaved,
  };

  console.log('\n=== Drive Ingest Complete ===');
  console.log(`Scanned:         ${summary.scanned}`);
  console.log(`Already indexed: ${summary.skipped}`);
  console.log(`Processed:       ${summary.processed}`);
  console.log(`Failed/skipped:  ${summary.failed}`);
  console.log(`Memories saved:  ${summary.memoriesSaved}`);

  return summary;
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

const isMain = process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
   process.argv[1].endsWith('gdrive-ingest.ts') ||
   process.argv[1].endsWith('gdrive-ingest.js'));

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reset = args.includes('--reset');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;
  const delayArg = args.find(a => a.startsWith('--delay-ms='));
  const delayMs = delayArg ? parseInt(delayArg.split('=')[1], 10) : 2000;
  const typeArg = args.find(a => a.startsWith('--type='));
  const typeFilter = typeArg ? typeArg.split('=')[1] : undefined;

  initDatabase();

  console.log(`Google Drive Ingest`);
  console.log(`  limit:    ${limit === 0 ? 'all' : limit}`);
  console.log(`  delay:    ${delayMs}ms`);
  console.log(`  dry-run:  ${dryRun}`);
  console.log(`  reset:    ${reset}`);
  console.log(`  type:     ${typeFilter ?? 'all'}`);
  console.log('');

  runDriveIngest({ limit, delayMs, dryRun, reset, typeFilter })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Ingest failed:', err);
      process.exit(1);
    });
}
