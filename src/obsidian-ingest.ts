/**
 * obsidian-ingest.ts
 *
 * Scans the local Obsidian vault, extracts structured knowledge from each
 * note via Gemini, and saves it to the ClaudeClaw memory DB.
 *
 * Two modes:
 *   --output-json   Write extracted memories as JSONL to stdout (for piping to Fly)
 *   (default)       Write directly to the local store DB
 *
 * Index file: store/obsidian-index.json (tracks path → { mtime, memoryId, ingestedAt })
 * Re-runs are idempotent — files are skipped if mtime hasn't changed.
 *
 * CLI usage:
 *   npx tsx src/obsidian-ingest.ts [--limit N] [--delay-ms N] [--dry-run] [--reset] [--output-json]
 *
 * Pipe to Fly:
 *   node dist/obsidian-ingest.js --output-json | fly ssh console -a claudeclaw-impactworks -C "node /app/dist/obsidian-import.js"
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { generateContent, parseJsonResponse } from './gemini.js';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtractionResult {
  summary: string;
  key_facts: string[];
  entities: string[];
  topics: string[];
  importance: number;
  document_type: string;
}

interface IndexEntry {
  mtime: number;
  memoryId: number;
  ingestedAt: string;
  title: string;
}

interface IngestIndex {
  [filePath: string]: IndexEntry;
}

export interface MemoryRecord {
  chatId: string;
  rawText: string;
  summary: string;
  entities: string[];
  topics: string[];
  importance: number;
  source: string;
  agentId: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_CONTENT_CHARS = 35_000;
const SOURCE_TAG = 'obsidian';

// Files/folders to skip
const SKIP_PATTERNS = [
  /^\./,              // hidden files
  /\.canvas$/,        // Obsidian canvas files (JSON, not prose)
  /^Untitled/i,       // empty untitled notes
  /node_modules/,
  /\.obsidian/,
];

function resolveVaultPath(): string {
  const env = process.env.OBSIDIAN_VAULT_PATH;
  if (env?.trim()) return env.trim();
  if (fs.existsSync('/app/store/obsidian-brain')) return '/app/store/obsidian-brain';
  const mac = '/Users/dantecrescenzi/Documents/Claude/Obsidian Brain/Obsidian Brain';
  if (fs.existsSync(mac)) return mac;
  throw new Error('Obsidian vault not found. Set OBSIDIAN_VAULT_PATH env var.');
}

function resolveStorePath(): string {
  if (fs.existsSync('/app/store')) return '/app/store';
  const local = path.join(process.cwd(), 'store');
  if (!fs.existsSync(local)) fs.mkdirSync(local, { recursive: true });
  return local;
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
  const p = path.join(storePath, 'obsidian-index.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function saveIndex(storePath: string, index: IngestIndex): void {
  const p = path.join(storePath, 'obsidian-index.json');
  fs.writeFileSync(p, JSON.stringify(index, null, 2), 'utf8');
}

// ── Vault scanner ─────────────────────────────────────────────────────────────

interface VaultFile {
  absPath: string;
  relPath: string;
  title: string;
  mtime: number;
}

function scanVault(vaultPath: string): VaultFile[] {
  const files: VaultFile[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      const relPath = path.relative(vaultPath, absPath);

      if (SKIP_PATTERNS.some(p => p.test(entry.name) || p.test(relPath))) continue;

      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.name.endsWith('.md')) {
        try {
          const stat = fs.statSync(absPath);
          files.push({
            absPath,
            relPath,
            title: entry.name.replace(/\.md$/, ''),
            mtime: Math.floor(stat.mtimeMs),
          });
        } catch {
          // broken symlink or race condition — skip silently
        }
      }
    }
  }

  walk(vaultPath);
  return files.sort((a, b) => b.mtime - a.mtime); // newest first
}

// ── Gemini extraction ─────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are analyzing a note from Dante Crescenzi's personal Obsidian knowledge base. Dante is a serial entrepreneur running ImpactWorks (AI/digital agency) and Rocket Local (AI local marketing). Extract structured knowledge worth storing long-term in his AI assistant's memory.

Note title: {TITLE}
Note path: {PATH}
Last modified: {DATE}

Content:
{CONTENT}

Extract what's useful. Focus on:
- Business decisions, strategy, or goals
- Client/partner names and relationship context
- Projects and their status
- Personal principles, frameworks, or mental models
- Financial context (revenue, costs, targets)
- Action items or commitments
- Ideas or opportunities worth tracking

Skip if this is just a template, empty note, or daily log with no meaningful content.

Return JSON:
{
  "summary": "1-2 sentence description of what this note is and why it matters",
  "key_facts": ["fact 1", "fact 2", ...],
  "entities": ["Person", "Company", "Project", "Amount", ...],
  "topics": ["strategy", "client", "finance", "personal", "project", ...],
  "importance": 0.0-1.0,
  "document_type": "strategy|reference|meeting_notes|project|personal|framework|other"
}

If the note has no useful content, return importance: 0.1 and minimal output.`;

async function extractFromNote(file: VaultFile, content: string): Promise<ExtractionResult | null> {
  const truncated = content.slice(0, MAX_CONTENT_CHARS);
  const modDate = new Date(file.mtime).toISOString().split('T')[0];

  const prompt = EXTRACTION_PROMPT
    .replace('{TITLE}', file.title)
    .replace('{PATH}', file.relPath)
    .replace('{DATE}', modDate)
    .replace('{CONTENT}', truncated);

  try {
    const raw = await generateContent(prompt);
    return parseJsonResponse<ExtractionResult>(raw);
  } catch (err) {
    logger.warn({ err, title: file.title }, 'Gemini extraction failed');
    return null;
  }
}

// ── Sleep ─────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Main ingest ───────────────────────────────────────────────────────────────

export async function runObsidianIngest(opts: {
  limit?: number;
  delayMs?: number;
  dryRun?: boolean;
  reset?: boolean;
  outputJson?: boolean;
} = {}): Promise<{
  scanned: number;
  skipped: number;
  processed: number;
  failed: number;
  memoriesSaved: number;
}> {
  const limit = opts.limit ?? 0; // 0 = all
  const delayMs = opts.delayMs ?? 1500;
  const dryRun = opts.dryRun ?? false;
  const outputJson = opts.outputJson ?? false;
  const storePath = resolveStorePath();

  let vaultPath: string;
  try {
    vaultPath = resolveVaultPath();
  } catch (err) {
    logger.warn({ err }, 'Obsidian vault not found, skipping ingest');
    return { scanned: 0, skipped: 0, processed: 0, failed: 0, memoriesSaved: 0 };
  }

  const index = opts.reset ? {} : loadIndex(storePath);
  if (opts.reset) logger.info('Obsidian index reset — will re-process all notes');

  if (!outputJson) console.log(`Scanning vault: ${vaultPath}`);
  const allFiles = scanVault(vaultPath);
  if (!outputJson) console.log(`Found ${allFiles.length} markdown files`);

  const toProcess = allFiles.filter(f => {
    const entry = index[f.relPath];
    if (!entry) return true; // new file
    return entry.mtime !== f.mtime; // modified
  });

  const batch = limit > 0 ? toProcess.slice(0, limit) : toProcess;
  const skipped = allFiles.length - batch.length;

  if (!outputJson) {
    console.log(`Already indexed: ${skipped}`);
    console.log(`Processing: ${batch.length}\n`);
  }

  // Only import saveStructuredMemory when writing to local DB
  let saveMemory: ((chatId: string, rawText: string, summary: string, entities: string[], topics: string[], importance: number, source: string, agentId: string) => number) | null = null;
  if (!outputJson && !dryRun) {
    const { saveStructuredMemory } = await import('./db.js');
    saveMemory = saveStructuredMemory;
  }

  let processed = 0;
  let failed = 0;
  let memoriesSaved = 0;
  const outputRecords: MemoryRecord[] = [];

  for (const file of batch) {
    const label = `[${processed + 1}/${batch.length}] ${file.title.slice(0, 60)}`;
    if (!outputJson) process.stdout.write(`${label}... `);

    // Read file
    let content: string;
    try {
      content = fs.readFileSync(file.absPath, 'utf8');
    } catch (err) {
      if (!outputJson) process.stdout.write('(read error, skip)\n');
      failed++;
      continue;
    }

    if (content.trim().length < 30) {
      if (!outputJson) process.stdout.write('(empty, skip)\n');
      index[file.relPath] = { mtime: file.mtime, memoryId: -1, ingestedAt: new Date().toISOString(), title: file.title };
      if (!dryRun) saveIndex(storePath, index);
      processed++;
      continue;
    }

    // Extract via Gemini
    const result = await extractFromNote(file, content);
    if (!result) {
      if (!outputJson) process.stdout.write('(extraction failed)\n');
      failed++;
      await sleep(delayMs);
      continue;
    }

    if (result.importance < 0.2) {
      if (!outputJson) process.stdout.write(`(low importance ${result.importance}, skip)\n`);
      index[file.relPath] = { mtime: file.mtime, memoryId: -1, ingestedAt: new Date().toISOString(), title: file.title };
      if (!dryRun) saveIndex(storePath, index);
      processed++;
      await sleep(Math.floor(delayMs / 4));
      continue;
    }

    const rawText = [
      `[Obsidian: ${file.title}]`,
      `Path: ${file.relPath}`,
      `Type: ${result.document_type}`,
      `Modified: ${new Date(file.mtime).toISOString().split('T')[0]}`,
      '',
      result.summary,
      '',
      'Key facts:',
      ...result.key_facts.map(f => `- ${f}`),
    ].join('\n');

    const memRecord: MemoryRecord = {
      chatId: 'obsidian-ingest',
      rawText,
      summary: result.summary,
      entities: result.entities,
      topics: result.topics,
      importance: result.importance,
      source: SOURCE_TAG,
      agentId: 'main',
    };

    if (outputJson) {
      outputRecords.push(memRecord);
    } else if (!dryRun && saveMemory) {
      const memoryId = saveMemory(
        memRecord.chatId, memRecord.rawText, memRecord.summary,
        memRecord.entities, memRecord.topics, memRecord.importance,
        memRecord.source, memRecord.agentId,
      );
      index[file.relPath] = { mtime: file.mtime, memoryId, ingestedAt: new Date().toISOString(), title: file.title };
      saveIndex(storePath, index);
      memoriesSaved++;
    } else {
      memoriesSaved++; // dry run count
    }

    if (!outputJson) {
      process.stdout.write(`✓ (importance: ${result.importance}, ${result.key_facts.length} facts)\n`);
    }

    processed++;
    await sleep(delayMs);
  }

  if (outputJson) {
    // Write JSONL to stdout for piping to fly ssh console
    for (const rec of outputRecords) {
      process.stdout.write(JSON.stringify(rec) + '\n');
    }
    memoriesSaved = outputRecords.length;
  }

  if (!outputJson) {
    console.log('\n=== Obsidian Ingest Complete ===');
    console.log(`Scanned:         ${allFiles.length}`);
    console.log(`Already indexed: ${skipped}`);
    console.log(`Processed:       ${processed}`);
    console.log(`Failed/skipped:  ${failed}`);
    console.log(`Memories saved:  ${memoriesSaved}`);
  }

  return { scanned: allFiles.length, skipped, processed, failed, memoriesSaved };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

const isMain = process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
   process.argv[1].endsWith('obsidian-ingest.ts') ||
   process.argv[1].endsWith('obsidian-ingest.js'));

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reset = args.includes('--reset');
  const outputJson = args.includes('--output-json');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;
  const delayArg = args.find(a => a.startsWith('--delay-ms='));
  const delayMs = delayArg ? parseInt(delayArg.split('=')[1], 10) : 1500;

  if (!outputJson) {
    console.log('Obsidian Vault Ingest');
    console.log(`  limit:    ${limit === 0 ? 'all' : limit}`);
    console.log(`  delay:    ${delayMs}ms`);
    console.log(`  dry-run:  ${dryRun}`);
    console.log(`  reset:    ${reset}`);
    console.log('');
  }

  if (!outputJson) {
    // Only init DB when writing locally
    const { initDatabase } = await import('./db.js');
    initDatabase();
  }

  runObsidianIngest({ limit, delayMs, dryRun, reset, outputJson })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Obsidian ingest failed:', err);
      process.exit(1);
    });
}
