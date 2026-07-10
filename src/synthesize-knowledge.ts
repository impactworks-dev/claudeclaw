/**
 * synthesize-knowledge.ts
 *
 * Self-improving knowledge loop for ClaudeClaw.
 *
 * What it does:
 *  1. Pulls recent hive_mind activity (configurable window, default 7 days)
 *  2. Uses Gemini to cluster entries by theme and identify recurring patterns
 *  3. Compares clusters against existing Obsidian vault notes to find gaps
 *  4. Auto-drafts new Obsidian notes for patterns with no existing coverage
 *  5. Writes synthesis memories to the DB (source='synthesis') for insights
 *  6. Reinforces salience on memories whose topics match active themes
 *
 * Scheduled: weekly (Sunday 6pm) via schedule-cli.
 * Kill-switch: respects LLM_SPAWN_ENABLED.
 *
 * CLI usage:
 *   npx tsx src/synthesize-knowledge.ts [--days N] [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateContent, parseJsonResponse } from './gemini.js';
import {
  initDatabase,
  getHiveMindEntries,
  getPersonalMemories,
  saveStructuredMemory,
  touchMemory,
} from './db.js';
import type { HiveMindEntry } from './db.js';
import { requireEnabled } from './kill-switches.js';
import { logger } from './logger.js';

// ── Types ───────────────────────────────────────────────────────────────────

interface ThemeCluster {
  /** Short label, e.g. "Rocket Local SEO pipeline" */
  label: string;
  /** 2-3 sentence summary of the pattern */
  summary: string;
  /** Key entities/topics involved */
  entities: string[];
  /** Topics for memory tagging */
  topics: string[];
  /** IDs of hive_mind entries that belong to this cluster */
  entry_ids: number[];
  /** Suggested Obsidian note title */
  note_title: string;
  /** Suggested sub-folder inside vault (e.g. "Business/Synthesis") */
  note_folder: string;
  /** 0–1: how novel this is (1 = no existing notes cover it) */
  novelty_score: number;
}

interface GeminiSynthesisResult {
  clusters: ThemeCluster[];
  global_insight: string;
  knowledge_gaps: string[];
}

interface VaultNote {
  title: string;
  folder: string;
  path: string;
}

// ── Config ──────────────────────────────────────────────────────────────────

const SYNTHESIS_SYSTEM_ID = 'synthesis';
const SYNTHESIS_AGENT_ID = 'main';
const SYNTHESIS_NOTE_FOLDER = 'Synthesis';
const MIN_CLUSTER_ENTRIES = 2;   // ignore themes with < 2 supporting entries
const MAX_NOTES_PER_RUN = 5;     // cap auto-creation to avoid vault spam
const SALIENCE_THRESHOLD = 0.4;  // memories below this won't get bumped

// ── Vault path resolution ────────────────────────────────────────────────────

function resolveVaultPath(): string {
  const env = process.env.OBSIDIAN_VAULT_PATH;
  if (env && env.trim()) return env.trim();
  // Fly: Syncthing-synced copy
  const flyDefault = '/app/store/obsidian-brain';
  if (fs.existsSync(flyDefault)) return flyDefault;
  // Dev/Mac fallback
  const macDefault = '/Users/dantecrescenzi/Documents/Claude/Obsidian Brain/Obsidian Brain';
  if (fs.existsSync(macDefault)) return macDefault;
  return flyDefault;
}

// ── Vault scanner ─────────────────────────────────────────────────────────

function scanVault(vaultPath: string): VaultNote[] {
  if (!fs.existsSync(vaultPath)) return [];
  const notes: VaultNote[] = [];

  function walk(dir: string, relFolder = '') {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, relFolder ? `${relFolder}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md')) {
        notes.push({
          title: entry.name.replace(/\.md$/, ''),
          folder: relFolder,
          path: full,
        });
      }
    }
  }
  walk(vaultPath);
  return notes;
}

// ── Keyword overlap scorer ───────────────────────────────────────────────────

function extractWords(s: string): Set<string> {
  const stopWords = new Set([
    'a','an','the','is','are','was','were','be','been','have','has','had',
    'do','does','did','will','would','could','should','may','might','can',
    'to','of','in','for','on','with','at','by','from','as','and','or','but',
    'not','this','that','it','its','we','our','you','your','they','their',
    'he','she','him','her','get','got','use','make','know','also',
  ]);
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 4 && !stopWords.has(w)),
  );
}

function overlapScore(a: string, b: string): number {
  const wa = extractWords(a);
  const wb = extractWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

// ── Gemini prompt ─────────────────────────────────────────────────────────

const SYNTHESIS_PROMPT = `You are Nikki, Dante's AI system analyst. Analyze these recent HiveMind activity entries from Dante's AI agents (ClaudeClaw) and identify meaningful recurring patterns, themes, and knowledge worth capturing as long-term notes.

Activity entries (last {DAYS} days):
{ENTRIES}

Existing Obsidian vault notes (titles only):
{VAULT_NOTES}

Your job:
1. Cluster the activity entries into 3-8 meaningful THEMES (not just action categories — actual business/operational patterns)
2. For each theme, check if an existing vault note already covers it well
3. Assign novelty_score: 1.0 = no existing note covers it, 0.5 = partially covered, 0.0 = well covered
4. Suggest natural note titles and folders (use: Business, Decisions, System, People, Principles, or Synthesis for new AI-generated notes)
5. Identify a global insight that emerges across all the activity
6. List any notable knowledge gaps — areas with active work but no documentation

IMPORTANT: Only flag themes as high-novelty if the pattern is genuinely recurring (2+ entries) and strategically useful to remember. Don't create notes for one-off tasks.

Return JSON exactly:
{
  "clusters": [
    {
      "label": "Short theme label",
      "summary": "2-3 sentence description of the pattern and why it matters",
      "entities": ["entity1", "entity2"],
      "topics": ["topic1", "topic2"],
      "entry_ids": [1, 2, 3],
      "note_title": "Suggested Note Title",
      "note_folder": "Synthesis",
      "novelty_score": 0.8
    }
  ],
  "global_insight": "One overarching insight about how the HiveMind is operating",
  "knowledge_gaps": ["gap1", "gap2"]
}`;

// ── Note writer ───────────────────────────────────────────────────────────

function buildNoteContent(cluster: ThemeCluster, entries: HiveMindEntry[], globalInsight: string): string {
  const now = new Date().toISOString().split('T')[0];
  const entryDetails = entries
    .filter(e => cluster.entry_ids.includes(e.id))
    .map(e => `- [${e.agent_id}] ${e.action}: ${e.summary}`)
    .join('\n');

  return `---
title: ${cluster.note_title}
created: ${now}
source: synthesis
tags: [synthesis, ai-generated]
entities: [${cluster.entities.join(', ')}]
topics: [${cluster.topics.join(', ')}]
---

# ${cluster.note_title}

${cluster.summary}

## Supporting Activity

${entryDetails}

## Context

This note was auto-generated by the ClaudeClaw knowledge synthesis system based on recurring patterns in HiveMind activity. Review and edit as needed.

*Global insight: ${globalInsight}*

---
*Generated: ${now}*
`;
}

function writeNoteToVault(vaultPath: string, cluster: ThemeCluster, content: string, dryRun: boolean): string | null {
  const folder = path.join(vaultPath, cluster.note_folder);
  const filename = `${cluster.note_title.replace(/[/\\:*?"<>|]/g, '-')}.md`;
  const fullPath = path.join(folder, filename);

  if (dryRun) {
    logger.info({ path: fullPath }, '[DRY RUN] Would write note');
    return fullPath;
  }

  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    logger.info({ path: fullPath }, 'Wrote synthesis note to vault');
    return fullPath;
  } catch (err) {
    logger.error({ err, path: fullPath }, 'Failed to write note to vault');
    return null;
  }
}

// ── Main synthesis function ──────────────────────────────────────────────

export async function runSynthesis(opts: {
  days?: number;
  dryRun?: boolean;
  reinforceOnly?: boolean;  // bump salience but skip note creation
  limit?: number;
} = {}): Promise<{
  clusters: number;
  notesWritten: number;
  memoriesSaved: number;
  globalInsight: string;
  gaps: string[];
}> {
  requireEnabled('LLM_SPAWN_ENABLED');

  const days = opts.days ?? 7;
  const dryRun = opts.dryRun ?? false;
  const reinforceOnly = opts.reinforceOnly ?? false;
  const limit = opts.limit ?? 300;

  // Pull recent hive_mind entries
  const cutoff = Math.floor(Date.now() / 1000) - (days * 86400);
  // getHiveMindEntries doesn't filter by time — do it client-side
  const allEntries = getHiveMindEntries(limit);
  const entries = allEntries.filter(e => e.created_at >= cutoff);

  if (entries.length < MIN_CLUSTER_ENTRIES) {
    logger.info({ count: entries.length, days }, 'Not enough hive_mind entries for synthesis');
    return { clusters: 0, notesWritten: 0, memoriesSaved: 0, globalInsight: '', gaps: [] };
  }

  logger.info({ count: entries.length, days }, 'Starting knowledge synthesis');

  // Scan vault for existing notes
  const vaultPath = resolveVaultPath();
  const vaultNotes = scanVault(vaultPath);
  const vaultTitles = vaultNotes.map(n => n.title).join('\n');

  // Format entries for Gemini
  const entriesForGemini = entries.map(e => ({
    id: e.id,
    agent: e.agent_id,
    action: e.action,
    summary: e.summary,
    when: new Date(e.created_at * 1000).toISOString().split('T')[0],
  }));

  const prompt = SYNTHESIS_PROMPT
    .replace('{DAYS}', String(days))
    .replace('{ENTRIES}', JSON.stringify(entriesForGemini, null, 2))
    .replace('{VAULT_NOTES}', vaultTitles || '(none)');

  // Call Gemini
  const raw = await generateContent(prompt);
  const result = parseJsonResponse<GeminiSynthesisResult>(raw);

  if (!result || !result.clusters) {
    logger.warn({ raw: raw.slice(0, 300) }, 'Synthesis produced invalid result');
    return { clusters: 0, notesWritten: 0, memoriesSaved: 0, globalInsight: '', gaps: [] };
  }

  const { clusters, global_insight, knowledge_gaps } = result;
  logger.info({ clusterCount: clusters.length, insight: global_insight.slice(0, 100) }, 'Gemini synthesis done');

  // Filter to high-novelty clusters with enough supporting entries
  const newClusters = clusters
    .filter(c => c.novelty_score >= 0.6 && c.entry_ids.length >= MIN_CLUSTER_ENTRIES)
    .sort((a, b) => b.novelty_score - a.novelty_score)
    .slice(0, MAX_NOTES_PER_RUN);

  let notesWritten = 0;
  let memoriesSaved = 0;

  for (const cluster of clusters) {
    // Save a synthesis memory for every cluster (regardless of novelty)
    if (!dryRun) {
      saveStructuredMemory(
        SYNTHESIS_SYSTEM_ID,
        cluster.summary,
        cluster.summary,
        cluster.entities,
        cluster.topics,
        0.7,            // importance — synthesis memories are useful but not critical
        'synthesis',
        SYNTHESIS_AGENT_ID,
      );
      memoriesSaved++;
    } else {
      logger.info({ label: cluster.label }, '[DRY RUN] Would save synthesis memory');
      memoriesSaved++;
    }
  }

  // Write notes for novel clusters (skip if reinforce-only mode)
  for (const cluster of reinforceOnly ? [] : newClusters) {
    // Double-check: is there already a note with very similar title?
    const alreadyCovered = vaultNotes.some(
      n => overlapScore(n.title, cluster.note_title) > 0.7,
    );
    if (alreadyCovered) {
      logger.debug({ title: cluster.note_title }, 'Skipping — vault already has similar note');
      continue;
    }

    const content = buildNoteContent(cluster, entries, global_insight);
    const written = writeNoteToVault(vaultPath, cluster, content, dryRun);
    if (written) notesWritten++;
  }

  // Save a global insight memory
  if (global_insight && !dryRun) {
    saveStructuredMemory(
      SYNTHESIS_SYSTEM_ID,
      global_insight,
      global_insight,
      [],
      ['synthesis', 'global-insight'],
      0.8,
      'synthesis',
      SYNTHESIS_AGENT_ID,
    );
    memoriesSaved++;
  }

  // Reinforce salience on memories matching active themes
  try {
    const activeTopics = new Set<string>();
    for (const c of clusters) {
      for (const t of c.topics) activeTopics.add(t.toLowerCase());
      for (const e of c.entities) activeTopics.add(e.toLowerCase());
      for (const w of extractWords(c.label)) activeTopics.add(w);
    }
    const memories = getPersonalMemories(200);
    let bumped = 0;
    for (const mem of memories) {
      if (mem.salience < SALIENCE_THRESHOLD) continue;
      const topicsArr: string[] = JSON.parse(mem.topics ?? '[]');
      const memText = `${mem.summary} ${topicsArr.join(' ')}`.toLowerCase();
      let hasOverlap = false;
      for (const topic of activeTopics) {
        if (memText.includes(topic)) { hasOverlap = true; break; }
      }
      if (hasOverlap) {
        if (!dryRun) touchMemory(mem.id);
        bumped++;
      }
    }
    logger.info({ bumped, dryRun }, 'Salience reinforcement done');
  } catch (err) {
    logger.warn({ err }, 'Salience reinforcement failed (non-critical)');
  }

  const summary = {
    clusters: clusters.length,
    notesWritten,
    memoriesSaved,
    globalInsight: global_insight,
    gaps: knowledge_gaps ?? [],
  };
  logger.info(summary, 'Knowledge synthesis complete');
  return summary;
}

// ── CLI entrypoint ───────────────────────────────────────────────────────

const isMain = process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
   process.argv[1].endsWith('synthesize-knowledge.ts') ||
   process.argv[1].endsWith('synthesize-knowledge.js'));

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reinforceOnly = args.includes('--reinforce-only');
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;

  initDatabase();

  console.log(`Running knowledge synthesis (days=${days}, dryRun=${dryRun})...`);
  runSynthesis({ days, dryRun, reinforceOnly })
    .then(result => {
      console.log('\n=== Synthesis Result ===');
      console.log(`Clusters found: ${result.clusters}`);
      console.log(`Notes written: ${result.notesWritten}`);
      console.log(`Memories saved: ${result.memoriesSaved}`);
      console.log(`Global insight: ${result.globalInsight}`);
      if (result.gaps.length > 0) {
        console.log(`Knowledge gaps:\n${result.gaps.map(g => `  - ${g}`).join('\n')}`);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('Synthesis failed:', err);
      process.exit(1);
    });
}
