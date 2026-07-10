/**
 * clickup-ingest.ts
 *
 * Fetches tasks from all ClickUp spaces, extracts structured knowledge via
 * Gemini, and saves to the ClaudeClaw memory DB with source='clickup'.
 *
 * Covers: task name, description, status, assignees, due date, tags, list/folder.
 * Index: store/clickup-index.json { taskId → { updatedAt, memoryId } }
 *
 * CLI: npx tsx src/clickup-ingest.ts [--limit N] [--dry-run] [--reset]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { generateContent, parseJsonResponse } from './gemini.js';
import { initDatabase, saveStructuredMemory } from './db.js';
import { requireEnabled } from './kill-switches.js';
import { logger } from './logger.js';
import { CLICKUP_API_TOKEN } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CUTask {
  id: string;
  name: string;
  description?: string;
  status?: { status: string; color: string };
  assignees?: Array<{ username: string; email: string }>;
  tags?: Array<{ name: string }>;
  due_date?: string | null;
  date_updated?: string;
  date_created?: string;
  url?: string;
  list?: { name: string };
  folder?: { name: string };
  space?: { id: string };
  priority?: { priority: string } | null;
}

interface ExtractionResult {
  summary: string;
  key_facts: string[];
  entities: string[];
  topics: string[];
  importance: number;
}

interface IndexEntry {
  dateUpdated: string;
  memoryId: number;
  ingestedAt: string;
  name: string;
}

interface IngestIndex {
  [taskId: string]: IndexEntry;
}

// ── Config ────────────────────────────────────────────────────────────────────

const CU_API = 'https://api.clickup.com/api/v2';
const TEAM_ID = '10584109'; // Dante's workspace

// Statuses to skip — completed/archived work adds noise
const SKIP_STATUSES = new Set(['complete', 'closed', 'cancelled', 'done', 'archived']);

// ── API helpers ───────────────────────────────────────────────────────────────

async function cuFetch(endpoint: string): Promise<unknown> {
  const res = await fetch(`${CU_API}${endpoint}`, {
    headers: { Authorization: CLICKUP_API_TOKEN },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ClickUp API ${endpoint} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getSpaces(): Promise<Array<{ id: string; name: string }>> {
  const data = await cuFetch(`/team/${TEAM_ID}/space?archived=false`) as { spaces?: Array<{ id: string; name: string }> };
  return data.spaces ?? [];
}

async function getTasksFromSpace(spaceId: string, page = 0): Promise<CUTask[]> {
  // Team-level task endpoint with space filter — /space/{id}/task doesn't exist in v2
  const data = await cuFetch(
    `/team/${TEAM_ID}/task?page=${page}&space_ids[]=${spaceId}&subtasks=true&include_closed=false&order_by=updated&reverse=true`,
  ) as { tasks?: CUTask[] };
  return data.tasks ?? [];
}

// ── Index helpers ─────────────────────────────────────────────────────────────

function resolveStorePath(): string {
  if (process.env.STORE_DIR) return process.env.STORE_DIR;
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    return path.join(root, 'store');
  } catch {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'store');
  }
}

function loadIndex(indexPath: string): IngestIndex {
  try { return JSON.parse(fs.readFileSync(indexPath, 'utf8')); }
  catch { return {}; }
}

function saveIndex(indexPath: string, index: IngestIndex): void {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// ── Gemini extraction ─────────────────────────────────────────────────────────

function taskToText(task: CUTask, spaceName: string): string {
  const lines: string[] = [
    `Task: ${task.name}`,
    `Space: ${spaceName}`,
    `List: ${task.list?.name ?? 'unknown'}`,
    `Folder: ${task.folder?.name ?? 'unknown'}`,
    `Status: ${task.status?.status ?? 'unknown'}`,
    `Priority: ${task.priority?.priority ?? 'none'}`,
    `Assignees: ${task.assignees?.map(a => a.username).join(', ') || 'none'}`,
    `Tags: ${task.tags?.map(t => t.name).join(', ') || 'none'}`,
  ];
  if (task.due_date) {
    lines.push(`Due: ${new Date(parseInt(task.due_date)).toISOString().split('T')[0]}`);
  }
  if (task.description?.trim()) {
    lines.push('', 'Description:', task.description.slice(0, 2000));
  }
  return lines.join('\n');
}

function buildPrompt(taskText: string): string {
  return `Extract structured knowledge from this project management task. Return a JSON object with:
- summary (string): one-sentence description of what this task is / what needs to happen
- key_facts (array of strings): 2-6 key facts about this task (status, who owns it, what it involves, deadline). Each must be a single plain text string with no newlines.
- entities (array of strings): people, companies, projects, or tools mentioned
- topics (array of strings): topic tags (e.g. "client-work", "marketing", "development", "operations")
- importance (number 0-1): business importance of this task

CRITICAL: All string values must be single-line with no embedded newlines.

Task data:
${taskText}`;
}

// ── Main export ────────────────────────────────────────────────────────────────

export interface ClickUpIngestResult {
  scanned: number;
  skipped: number;
  processed: number;
  failed: number;
  memoriesSaved: number;
}

export async function runClickUpIngest(opts: {
  limit?: number;
  dryRun?: boolean;
  reset?: boolean;
  delayMs?: number;
} = {}): Promise<ClickUpIngestResult> {
  requireEnabled('LLM_SPAWN_ENABLED');

  if (!CLICKUP_API_TOKEN) {
    logger.warn('ClickUp ingest: CLICKUP_API_TOKEN not set, skipping');
    return { scanned: 0, skipped: 0, processed: 0, failed: 0, memoriesSaved: 0 };
  }

  const { limit = 100, dryRun = false, reset = false, delayMs = 1500 } = opts;
  const storePath = resolveStorePath();
  const indexPath = path.join(storePath, 'clickup-index.json');

  if (reset) {
    try { fs.unlinkSync(indexPath); } catch { /* ok */ }
    logger.info('ClickUp ingest: index reset');
  }

  const index = loadIndex(indexPath);
  initDatabase();

  const result: ClickUpIngestResult = { scanned: 0, skipped: 0, processed: 0, failed: 0, memoriesSaved: 0 };

  // Fetch all spaces
  let spaces: Array<{ id: string; name: string }>;
  try {
    spaces = await getSpaces();
    logger.info({ spaces: spaces.length }, 'ClickUp ingest: fetched spaces');
  } catch (err) {
    logger.error({ err }, 'ClickUp ingest: failed to fetch spaces');
    return result;
  }

  const chatId = 'clickup-ingest';
  const toProcess: Array<{ task: CUTask; spaceName: string }> = [];

  // Collect tasks from all spaces
  for (const space of spaces) {
    if (toProcess.length >= limit) break;
    try {
      const tasks = await getTasksFromSpace(space.id);
      for (const task of tasks) {
        if (toProcess.length >= limit) break;
        result.scanned++;

        const status = task.status?.status?.toLowerCase() ?? '';
        if (SKIP_STATUSES.has(status)) {
          result.skipped++;
          continue;
        }

        // Check index — skip if not updated since last ingest
        const existing = index[task.id];
        if (existing && existing.dateUpdated === task.date_updated) {
          result.skipped++;
          continue;
        }

        toProcess.push({ task, spaceName: space.name });
      }
    } catch (err) {
      logger.warn({ err, space: space.name }, 'ClickUp ingest: failed to fetch tasks for space');
    }
  }

  logger.info({ toProcess: toProcess.length }, 'ClickUp ingest: processing tasks');

  for (const { task, spaceName } of toProcess) {
    try {
      const taskText = taskToText(task, spaceName);
      const prompt = buildPrompt(taskText);
      const raw = await generateContent(prompt);
      const extracted = parseJsonResponse<ExtractionResult>(raw);

      if (!extracted?.summary) {
        logger.warn({ task: task.name }, 'ClickUp ingest: extraction returned null');
        result.failed++;
        continue;
      }

      if (!dryRun) {
        const memoryId = saveStructuredMemory(
          chatId,
          taskText,
          extracted.summary,
          extracted.entities,
          extracted.topics,
          extracted.importance,
          'clickup',
          'main',
        );

        index[task.id] = {
          dateUpdated: task.date_updated ?? '',
          memoryId,
          ingestedAt: new Date().toISOString(),
          name: task.name,
        };
        saveIndex(indexPath, index);
        result.memoriesSaved++;
        logger.info({ task: task.name, memoryId }, 'ClickUp ingest: ✓ saved');
      } else {
        logger.info({ task: task.name, summary: extracted.summary }, 'ClickUp ingest: dry-run ✓');
        result.memoriesSaved++;
      }

      result.processed++;
    } catch (err) {
      logger.warn({ err, task: task.name }, 'ClickUp ingest: task failed');
      result.failed++;
    }

    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }

  logger.info(result, 'ClickUp ingest: complete');
  return result;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\.ts$/, '.js'));

if (isMain) {
  const args = process.argv.slice(2);
  const limit = parseInt(args[args.indexOf('--limit') + 1] ?? '100', 10) || 100;
  const dryRun = args.includes('--dry-run');
  const reset = args.includes('--reset');

  runClickUpIngest({ limit, dryRun, reset, delayMs: 2000 })
    .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
