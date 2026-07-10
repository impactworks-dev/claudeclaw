// Promotion proposals: detect high-importance recurring memory themes
// that don't yet have a matching wiki note, and surface them so Dante
// can promote them to canon with one click.
//
// Strategy v1 (heuristic, no LLM call):
//   - Pull top-N high-importance memories from the past 14 days
//   - Group by overlapping topic strings
//   - For each topic group, check if a wiki note exists by title or alias
//   - If no match, emit a proposal {topic, hit_count, example_summaries}
//
// Cached for 15 min — the surfacing is purely informational, doesn't
// need to be instant.

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

interface BrainProposal {
  topic: string;
  hitCount: number;
  importance: number;
  examples: string[];
  suggestedNoteName: string;
}

interface ProposalCache {
  asOf: number;
  proposals: BrainProposal[];
}

const TTL_MS = 15 * 60 * 1000;
let _cache: ProposalCache | null = null;

function getDb(): Database.Database | null {
  try {
    const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
    if (!fs.existsSync(dbPath)) return null;
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'brain-proposals: db open failed');
    return null;
  }
}

function getWriteDb(): Database.Database | null {
  try {
    const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
    if (!fs.existsSync(dbPath)) return null;
    return new Database(dbPath, { readonly: false, fileMustExist: true });
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'brain-proposals: db open (write) failed');
    return null;
  }
}

function fetchWikiTitles(): Set<string> {
  // Lazy import to avoid circular deps
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { listNotes } = require('./brain-data.js');
    const list = (listNotes({ limit: 500 }).notes || []) as Array<{ title: string }>;
    return new Set(list.map(n => n.title.toLowerCase()));
  } catch {
    return new Set();
  }
}

/** Filter a proposal list against the current wiki state. Cache may be
 *  up to 15min old, but wiki state changes the moment a user clicks
 *  "Add to wiki", so we always re-check live before returning. Matches
 *  case-insensitively against both the raw topic and the title-cased
 *  suggested note name so newly-added notes disappear immediately. */
function filterAgainstLiveWiki(proposals: BrainProposal[]): BrainProposal[] {
  const wikiTitles = fetchWikiTitles();
  if (wikiTitles.size === 0) return proposals;
  return proposals.filter((p) => {
    const t = p.topic.toLowerCase();
    const s = p.suggestedNoteName.toLowerCase();
    return !wikiTitles.has(t) && !wikiTitles.has(s);
  });
}

export function getBrainProposals(opts: { force?: boolean } = {}): BrainProposal[] {
  if (!opts.force && _cache && Date.now() - _cache.asOf < TTL_MS) {
    return filterAgainstLiveWiki(_cache.proposals);
  }

  const db = getDb();
  if (!db) return [];

  try {
    const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;

    // Pull recent high-importance memories.
    // Topics is stored as a JSON array of strings.
    const rows = db.prepare(
      `SELECT topics, summary, importance, created_at
         FROM memories
        WHERE importance >= 0.6 AND created_at >= ?
        ORDER BY importance DESC, accessed_at DESC
        LIMIT 400`,
    ).all(cutoff) as Array<{ topics: string; summary: string; importance: number; created_at: number }>;

    if (rows.length === 0) {
      _cache = { asOf: Date.now(), proposals: [] };
      return [];
    }

    const wikiTitles = fetchWikiTitles();

    // Group memories by topic keywords. Each memory may have multiple topics.
    const groups = new Map<string, { count: number; totalImportance: number; examples: string[] }>();
    for (const r of rows) {
      let topics: string[] = [];
      try { topics = JSON.parse(r.topics || '[]'); } catch { /* ignore */ }
      if (!Array.isArray(topics) || topics.length === 0) continue;
      for (const raw of topics) {
        const topic = String(raw).trim();
        if (!topic || topic.length < 3) continue;
        const lower = topic.toLowerCase();
        // Skip if a wiki note with this title (or close to it) already exists
        if (wikiTitles.has(lower)) continue;
        const g = groups.get(lower) || { count: 0, totalImportance: 0, examples: [] };
        g.count++;
        g.totalImportance += r.importance;
        if (g.examples.length < 3) g.examples.push(r.summary.slice(0, 120));
        groups.set(lower, g);
      }
    }

    // Only surface topics with multiple hits — singletons are noise.
    const proposals: BrainProposal[] = [];
    for (const [topic, g] of groups.entries()) {
      if (g.count < 2) continue;
      proposals.push({
        topic,
        hitCount: g.count,
        importance: g.totalImportance / g.count,
        examples: g.examples,
        suggestedNoteName: topic.charAt(0).toUpperCase() + topic.slice(1),
      });
    }
    proposals.sort((a, b) => b.hitCount - a.hitCount || b.importance - a.importance);

    _cache = { asOf: Date.now(), proposals: proposals.slice(0, 20) };
    return filterAgainstLiveWiki(_cache.proposals);
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'brain-proposals: scan failed');
    return [];
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Force-bust the cache. Called when a new wiki note is created so the
 *  proposal that triggered it disappears from the list immediately. */
export function invalidateProposalsCache(): void {
  _cache = null;
}

/** Fetch all memories that match a given topic string.
 *  Used by the review modal so the user can inspect the full set before
 *  committing to a wiki note. Returns id so the frontend can reference
 *  specific memories for re-assign / dismiss operations. */
export function getMemoriesForTopic(topic: string): Array<{ id: number; summary: string; importance: number; source: string; created_at: number; topics: string }> {
  const lower = topic.toLowerCase().trim();
  if (!lower) return [];
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(
      `SELECT id, summary, importance, source, created_at, topics
         FROM memories
        WHERE topics LIKE ? AND importance >= 0.5
        ORDER BY importance DESC, created_at DESC
        LIMIT 60`,
    ).all(`%${lower}%`) as Array<{ id: number; summary: string; importance: number; source: string; created_at: number; topics: string }>;
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'getMemoriesForTopic failed');
    return [];
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Update the summary text of a memory. Used by the inline memory editor. */
export function updateMemorySummary(id: number, summary: string): boolean {
  const db = getWriteDb();
  if (!db) return false;
  try {
    db.prepare(`UPDATE memories SET summary = ? WHERE id = ?`).run(summary.trim(), id);
    invalidateProposalsCache();
    return true;
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'updateMemorySummary failed');
    return false;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Replace the full topics array on a memory. Used by the re-assign UI. */
export function updateMemoryTopics(id: number, topics: string[]): boolean {
  const db = getWriteDb();
  if (!db) return false;
  try {
    const json = JSON.stringify(topics.map(t => t.trim()).filter(Boolean));
    db.prepare(`UPDATE memories SET topics = ? WHERE id = ?`).run(json, id);
    invalidateProposalsCache();
    return true;
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'updateMemoryTopics failed');
    return false;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Remove a single topic tag from a memory. Used by the dismiss button. */
export function removeTopicFromMemory(id: number, topic: string): boolean {
  const db = getWriteDb();
  if (!db) return false;
  try {
    const row = db.prepare(`SELECT topics FROM memories WHERE id = ?`).get(id) as { topics: string } | undefined;
    if (!row) return false;
    let topics: string[] = [];
    try { topics = JSON.parse(row.topics || '[]'); } catch { /* ignore */ }
    const lower = topic.toLowerCase().trim();
    const filtered = topics.filter(t => t.toLowerCase().trim() !== lower);
    db.prepare(`UPDATE memories SET topics = ? WHERE id = ?`).run(JSON.stringify(filtered), id);
    invalidateProposalsCache();
    return true;
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'removeTopicFromMemory failed');
    return false;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Rename every occurrence of `fromTopic` to `intoTopic` across all memories.
 *  Used by the merge-proposals feature. Returns count of rows updated. */
export function mergeTopics(fromTopic: string, intoTopic: string): number {
  const from = fromTopic.toLowerCase().trim();
  const into = intoTopic.toLowerCase().trim();
  if (!from || !into || from === into) return 0;
  const db = getWriteDb();
  if (!db) return 0;
  try {
    const rows = db.prepare(
      `SELECT id, topics FROM memories WHERE topics LIKE ?`
    ).all(`%${from}%`) as Array<{ id: number; topics: string }>;
    let updated = 0;
    for (const row of rows) {
      let topics: string[] = [];
      try { topics = JSON.parse(row.topics || '[]'); } catch { continue; }
      const hasFrom = topics.some(t => t.toLowerCase().trim() === from);
      if (!hasFrom) continue;
      const newTopics = topics.map(t => t.toLowerCase().trim() === from ? into : t);
      // Deduplicate in case intoTopic was already in the list
      const deduped = [...new Set(newTopics)];
      db.prepare(`UPDATE memories SET topics = ? WHERE id = ?`).run(JSON.stringify(deduped), row.id);
      updated++;
    }
    invalidateProposalsCache();
    return updated;
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'mergeTopics failed');
    return 0;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
