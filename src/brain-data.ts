// "Second brain" / wiki data layer.
//
// Reads Dante's Obsidian vault (synced into /app/store/obsidian-brain via
// Syncthing), parses every markdown file's frontmatter + headers + wiki-
// style [[links]], and builds an in-memory index so the dashboard can
// browse the vault, search across notes, and render the link graph.
//
// Cache strategy: lazy load on first request, refresh when any file's
// mtime changes or after TTL (5 min). The whole vault is small enough
// (hundreds of notes, low MB) that a full re-read is cheap.
//
// Vault path override: OBSIDIAN_VAULT_PATH env var. Default falls back
// to /app/store/obsidian-brain (Fly) or a Mac-side mirror in dev.

import fs from 'node:fs';
import path from 'node:path';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const TTL_MS = 5 * 60 * 1000;

function resolveVaultPath(): string {
  const env = process.env.OBSIDIAN_VAULT_PATH;
  if (env && env.trim()) return env.trim();
  // Fly default — Syncthing-synced location.
  const flyDefault = path.join(STORE_DIR, 'obsidian-brain');
  if (fs.existsSync(flyDefault)) return flyDefault;
  // Dev fallback — Dante's Mac path. Useful when running the server outside Fly.
  const macDefault = '/Users/dantecrescenzi/Documents/Claude/Obsidian Brain/Obsidian Brain';
  if (fs.existsSync(macDefault)) return macDefault;
  return flyDefault; // even if missing, return so error messages point somewhere real
}

export interface BrainNote {
  /** Relative path inside the vault, used as the canonical id. e.g. "Business/ImpactWorks.md" */
  path: string;
  /** Display title — frontmatter `title` if present, else basename without extension. */
  title: string;
  /** Aliases (frontmatter `aliases:`), lowercased. */
  aliases: string[];
  /** First-level folder, used for the tree view. */
  folder: string;
  /** Tags from frontmatter `tags:` and inline `#tag` mentions. */
  tags: string[];
  /** Outbound wikilinks — the canonical paths they resolve to (or the raw target if unresolved). */
  links: string[];
  /** Unresolved link targets (notes referenced that don't exist yet). */
  brokenLinks: string[];
  /** Notes that link TO this note. */
  backlinks: string[];
  /** Word count (rough). */
  wordCount: number;
  /** File mtime. */
  mtime: number;
  /** Raw markdown content. Loaded lazily — null for list views. */
  content?: string | null;
}

interface VaultIndex {
  vaultPath: string;
  /** path → note */
  byPath: Map<string, BrainNote>;
  /** lowercased title or alias → path (first match wins) */
  byTitle: Map<string, string>;
  /** Sorted list for stable order */
  noteList: BrainNote[];
  /** Aggregate stats */
  totals: { noteCount: number; linkCount: number; brokenLinkCount: number; tagCount: number };
  /** Last full scan ms */
  asOf: number;
}

let indexCache: VaultIndex | null = null;

// ---- Markdown parsing helpers ----

function parseFrontmatter(text: string): { fm: Record<string, any>; body: string } {
  if (!text.startsWith('---')) return { fm: {}, body: text };
  // Find the closing --- at the start of a line within the first 4KB
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { fm: {}, body: text };
  const block = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\n/, '');
  const fm: Record<string, any> = {};
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Very forgiving key: value parser — Obsidian frontmatter is shallow YAML
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    let value: any = line.slice(colon + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // List form: comma-separated or inline [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((s: string) => s.trim()).filter(Boolean);
    } else if (key === 'aliases' || key === 'tags') {
      // Allow comma form too even without brackets
      value = String(value).split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    fm[key] = value;
  }
  return { fm, body };
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
const INLINE_TAG_RE = /(?:^|\s)#([A-Za-z0-9][\w/-]+)/g;

function extractWikilinks(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const target = m[1].trim();
    if (target) out.push(target);
  }
  return out;
}

function extractInlineTags(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  INLINE_TAG_RE.lastIndex = 0;
  while ((m = INLINE_TAG_RE.exec(body)) !== null) {
    out.push(m[1].toLowerCase());
  }
  return out;
}

// ---- Vault walker ----

function* walkMarkdown(dir: string, rel = ''): Generator<{ abs: string; rel: string; mtime: number }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;             // skip .obsidian, .git, etc.
    if (ent.name === 'node_modules') continue;
    const absChild = path.join(dir, ent.name);
    const relChild = rel ? path.posix.join(rel, ent.name) : ent.name;
    if (ent.isDirectory()) {
      yield* walkMarkdown(absChild, relChild);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      try {
        const stat = fs.statSync(absChild);
        yield { abs: absChild, rel: relChild, mtime: stat.mtimeMs };
      } catch { /* ignore */ }
    }
  }
}

// ---- Build the index ----

function buildIndex(): VaultIndex {
  const vaultPath = resolveVaultPath();
  const byPath = new Map<string, BrainNote>();
  const byTitle = new Map<string, string>();

  // First pass — parse every file
  if (fs.existsSync(vaultPath)) {
    for (const { abs, rel, mtime } of walkMarkdown(vaultPath)) {
      let raw = '';
      try { raw = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
      const { fm, body } = parseFrontmatter(raw);
      const basename = path.basename(rel, '.md');
      const title = (fm.title && String(fm.title)) || basename;
      const aliasesRaw = Array.isArray(fm.aliases) ? fm.aliases : (fm.aliases ? [String(fm.aliases)] : []);
      const aliases = aliasesRaw.map((a: any) => String(a).toLowerCase());
      const folder = rel.includes('/') ? rel.split('/')[0] : 'root';
      const fmTags = Array.isArray(fm.tags) ? fm.tags.map((t: any) => String(t)) : (fm.tags ? [String(fm.tags)] : []);
      const tags = Array.from(new Set([...fmTags, ...extractInlineTags(body)].map(t => t.replace(/^#/, '').toLowerCase())));
      const linksRaw = extractWikilinks(body);
      const wordCount = body.split(/\s+/).filter(Boolean).length;

      const note: BrainNote = {
        path: rel,
        title,
        aliases,
        folder,
        tags,
        links: linksRaw,         // resolved below
        brokenLinks: [],
        backlinks: [],
        wordCount,
        mtime,
        content: null,
      };
      byPath.set(rel, note);
      byTitle.set(title.toLowerCase(), rel);
      for (const a of aliases) byTitle.set(a, rel);
    }
  }

  // Second pass — resolve wikilink targets + compute backlinks
  let totalLinks = 0;
  let totalBroken = 0;
  for (const note of byPath.values()) {
    const resolved: string[] = [];
    const broken: string[] = [];
    for (const raw of note.links) {
      const key = raw.toLowerCase();
      const target = byTitle.get(key);
      if (target && target !== note.path) {
        resolved.push(target);
      } else {
        broken.push(raw);
      }
    }
    note.links = Array.from(new Set(resolved));
    note.brokenLinks = Array.from(new Set(broken));
    totalLinks += note.links.length;
    totalBroken += note.brokenLinks.length;
    for (const tgt of note.links) {
      const tgtNote = byPath.get(tgt);
      if (tgtNote && !tgtNote.backlinks.includes(note.path)) {
        tgtNote.backlinks.push(note.path);
      }
    }
  }

  // Aggregate tag count
  const allTags = new Set<string>();
  for (const n of byPath.values()) for (const t of n.tags) allTags.add(t);

  const noteList = Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  return {
    vaultPath,
    byPath,
    byTitle,
    noteList,
    totals: {
      noteCount: noteList.length,
      linkCount: totalLinks,
      brokenLinkCount: totalBroken,
      tagCount: allTags.size,
    },
    asOf: Date.now(),
  };
}

function getIndex(force = false): VaultIndex {
  if (!force && indexCache && (Date.now() - indexCache.asOf < TTL_MS)) return indexCache;
  try {
    indexCache = buildIndex();
  } catch (e) {
    logger.error({ err: String((e as Error)?.message || e) }, 'brain: index build failed');
    if (!indexCache) {
      // Empty index so endpoints don't crash
      indexCache = {
        vaultPath: resolveVaultPath(),
        byPath: new Map(),
        byTitle: new Map(),
        noteList: [],
        totals: { noteCount: 0, linkCount: 0, brokenLinkCount: 0, tagCount: 0 },
        asOf: Date.now(),
      };
    }
  }
  return indexCache!;
}

// ---- Public API ----

export interface BrainStats {
  vaultPath: string;
  exists: boolean;
  noteCount: number;
  linkCount: number;
  brokenLinkCount: number;
  tagCount: number;
  asOf: number;
}

export function getBrainStats(): BrainStats {
  const idx = getIndex();
  return {
    vaultPath: idx.vaultPath,
    exists: fs.existsSync(idx.vaultPath),
    noteCount: idx.totals.noteCount,
    linkCount: idx.totals.linkCount,
    brokenLinkCount: idx.totals.brokenLinkCount,
    tagCount: idx.totals.tagCount,
    asOf: idx.asOf,
  };
}

export interface BrainNoteSummary {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  linkCount: number;
  backlinkCount: number;
  wordCount: number;
  mtime: number;
}

export function listNotes(opts: { folder?: string; limit?: number; offset?: number } = {}): { notes: BrainNoteSummary[]; total: number } {
  const idx = getIndex();
  let filtered = idx.noteList;
  if (opts.folder) filtered = filtered.filter(n => n.folder.toLowerCase() === opts.folder!.toLowerCase());
  const total = filtered.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 200;
  const sliced = filtered.slice(offset, offset + limit);
  return {
    notes: sliced.map(n => ({
      path: n.path,
      title: n.title,
      folder: n.folder,
      tags: n.tags,
      linkCount: n.links.length,
      backlinkCount: n.backlinks.length,
      wordCount: n.wordCount,
      mtime: n.mtime,
    })),
    total,
  };
}

export interface BrainNoteDetail extends BrainNoteSummary {
  content: string;
  aliases: string[];
  links: BrainNoteSummary[];
  brokenLinks: string[];
  backlinks: BrainNoteSummary[];
}

export function getNote(relPath: string): BrainNoteDetail | null {
  const idx = getIndex();
  const note = idx.byPath.get(relPath);
  if (!note) return null;
  // Lazy-read content if not cached
  let content = note.content;
  if (content == null) {
    try {
      const abs = path.join(idx.vaultPath, relPath);
      const raw = fs.readFileSync(abs, 'utf-8');
      content = parseFrontmatter(raw).body;
      note.content = content; // memoize
    } catch {
      content = '';
    }
  }
  const summarize = (p: string): BrainNoteSummary | null => {
    const n = idx.byPath.get(p);
    return n ? {
      path: n.path, title: n.title, folder: n.folder, tags: n.tags,
      linkCount: n.links.length, backlinkCount: n.backlinks.length,
      wordCount: n.wordCount, mtime: n.mtime,
    } : null;
  };
  return {
    path: note.path,
    title: note.title,
    folder: note.folder,
    tags: note.tags,
    linkCount: note.links.length,
    backlinkCount: note.backlinks.length,
    wordCount: note.wordCount,
    mtime: note.mtime,
    content,
    aliases: note.aliases,
    links: note.links.map(summarize).filter(Boolean) as BrainNoteSummary[],
    brokenLinks: note.brokenLinks,
    backlinks: note.backlinks.map(summarize).filter(Boolean) as BrainNoteSummary[],
  };
}

export function searchNotes(query: string, limit = 30): { results: Array<BrainNoteSummary & { score: number; snippet: string }>; query: string } {
  const idx = getIndex();
  const q = query.trim().toLowerCase();
  if (!q) return { results: [], query };
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<BrainNoteSummary & { score: number; snippet: string }> = [];
  for (const note of idx.noteList) {
    let score = 0;
    const title = note.title.toLowerCase();
    for (const tok of tokens) {
      if (title.includes(tok)) score += 4;
      if (note.aliases.some(a => a.includes(tok))) score += 3;
      if (note.tags.some(t => t.includes(tok))) score += 2;
    }
    // Body match — only loaded lazily; skim content if any token isn't in title/tags
    let snippet = '';
    if (score === 0 || tokens.some(t => !title.includes(t))) {
      try {
        const abs = path.join(idx.vaultPath, note.path);
        const raw = fs.readFileSync(abs, 'utf-8').toLowerCase();
        for (const tok of tokens) {
          const at = raw.indexOf(tok);
          if (at >= 0) {
            score += 1;
            if (!snippet) {
              const start = Math.max(0, at - 40);
              snippet = raw.slice(start, Math.min(raw.length, at + 80)).replace(/\s+/g, ' ').trim();
            }
          }
        }
      } catch { /* ignore */ }
    }
    if (score > 0) {
      scored.push({
        path: note.path, title: note.title, folder: note.folder, tags: note.tags,
        linkCount: note.links.length, backlinkCount: note.backlinks.length,
        wordCount: note.wordCount, mtime: note.mtime,
        score, snippet,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { results: scored.slice(0, limit), query };
}

export interface GraphNode { id: string; title: string; folder: string; type: 'wiki'; linkCount: number; }
export interface GraphEdge { source: string; target: string; }

export function getGraph(opts: { center?: string; hops?: number } = {}): { nodes: GraphNode[]; edges: GraphEdge[]; center: string | null } {
  const idx = getIndex();
  if (!opts.center) {
    // Full graph
    const nodes = idx.noteList.map(n => ({ id: n.path, title: n.title, folder: n.folder, type: 'wiki' as const, linkCount: n.links.length }));
    const edges: GraphEdge[] = [];
    for (const n of idx.noteList) for (const tgt of n.links) edges.push({ source: n.path, target: tgt });
    return { nodes, edges, center: null };
  }
  // BFS from center to N hops (default 1)
  const center = idx.byPath.get(opts.center);
  if (!center) return { nodes: [], edges: [], center: null };
  const hops = opts.hops ?? 1;
  const visited = new Set<string>([center.path]);
  let frontier = [center.path];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const p of frontier) {
      const n = idx.byPath.get(p);
      if (!n) continue;
      for (const tgt of [...n.links, ...n.backlinks]) {
        if (!visited.has(tgt)) { visited.add(tgt); next.push(tgt); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const p of visited) {
    const n = idx.byPath.get(p);
    if (!n) continue;
    nodes.push({ id: n.path, title: n.title, folder: n.folder, type: 'wiki', linkCount: n.links.length });
    for (const tgt of n.links) if (visited.has(tgt)) edges.push({ source: n.path, target: tgt });
  }
  return { nodes, edges, center: center.path };
}

export function invalidateBrainCache(): void {
  indexCache = null;
}
