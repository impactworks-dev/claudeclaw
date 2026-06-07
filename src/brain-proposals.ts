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
    const cutoff = Math.floor(Date.now() / 1000) - 14 * 86400;

    // Pull recent high-importance memories.
    // Topics is stored as a JSON array of strings.
    const rows = db.prepare(
      `SELECT topics, summary, importance, created_at
         FROM memories
        WHERE importance >= 0.6 AND created_at >= ?
        ORDER BY importance DESC, accessed_at DESC
        LIMIT 200`,
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

    _cache = { asOf: Date.now(), proposals: proposals.slice(0, 10) };
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
