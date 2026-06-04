// The "second brain" / Obsidian-wiki page in Mission Control.
//
// Three-column layout:
//   1. Vault tree (left)   — folder + note list with search
//   2. Link graph (middle) — wikilink graph centered on the selected note
//   3. Note detail (right) — content + backlinks + open-in-obsidian
//
// Reads from /api/brain/*. All requests use the standard DASHBOARD_TOKEN
// auth via useFetch/apiGet.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { Library, RefreshCw, Search, ExternalLink, Pin, FolderClosed, FileText, Sparkles } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiGet, apiPost } from '@/lib/api';

interface BrainStats {
  vaultPath: string;
  exists: boolean;
  noteCount: number;
  linkCount: number;
  brokenLinkCount: number;
  tagCount: number;
  asOf: number;
}

interface NoteSummary {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  linkCount: number;
  backlinkCount: number;
  wordCount: number;
  mtime: number;
}

interface NoteDetail extends NoteSummary {
  content: string;
  aliases: string[];
  links: NoteSummary[];
  brokenLinks: string[];
  backlinks: NoteSummary[];
}

interface SearchResult extends NoteSummary { score: number; snippet: string; }

interface GraphNode { id: string; title: string; folder: string; type: string; linkCount: number; }
interface GraphEdge { source: string; target: string; }
interface GraphResp { nodes: GraphNode[]; edges: GraphEdge[]; center: string | null; }

// ---- Helpers ----

function fmtTime(ms: number): string {
  const delta = Date.now() - ms;
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function shortFolder(folder: string): string {
  return folder === 'root' ? '—' : folder;
}

// Linkify the markdown body so [[wikilinks]] become clickable. We keep
// the rest of the markdown as plain text (we render it in a <pre>-ish
// block for the v1 — full markdown rendering can come later if needed).
function renderContent(content: string, onLinkClick: (target: string) => void): any[] {
  const out: any[] = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push(content.slice(last, m.index));
    const target = m[1].trim();
    const display = (m[2] || target).trim();
    out.push(
      <button
        type="button"
        key={`l-${key++}`}
        onClick={() => onLinkClick(target)}
        class="text-[var(--color-accent)] hover:underline"
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
      >{display}</button>
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push(content.slice(last));
  return out;
}

export function Brain() {
  const stats = useFetch<BrainStats>('/api/brain/stats', 60_000);
  const notes = useFetch<{ notes: NoteSummary[]; total: number }>('/api/brain/notes?limit=500');

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [graph, setGraph] = useState<GraphResp | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);

  const [reindexing, setReindexing] = useState(false);

  // ---- Search ----
  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return; }
    const handle = setTimeout(() => {
      apiGet<{ results: SearchResult[] }>(`/api/brain/search?q=${encodeURIComponent(query)}&limit=30`)
        .then(d => setSearchResults(d.results))
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  // ---- Auto-select first note on load ----
  useEffect(() => {
    if (!selectedPath && notes.data?.notes.length) {
      setSelectedPath(notes.data.notes[0].path);
    }
  }, [notes.data, selectedPath]);

  // ---- Load detail when selection changes ----
  useEffect(() => {
    if (!selectedPath) { setDetail(null); return; }
    setDetailLoading(true);
    apiGet<NoteDetail>(`/api/brain/note?path=${encodeURIComponent(selectedPath)}`)
      .then(d => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));

    setGraphLoading(true);
    apiGet<GraphResp>(`/api/brain/graph?center=${encodeURIComponent(selectedPath)}&hops=1`)
      .then(d => setGraph(d))
      .catch(() => setGraph(null))
      .finally(() => setGraphLoading(false));
  }, [selectedPath]);

  // ---- Group notes by folder for the tree ----
  const tree = useMemo(() => {
    const groups: Record<string, NoteSummary[]> = {};
    for (const n of notes.data?.notes ?? []) {
      (groups[n.folder] ??= []).push(n);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [notes.data]);

  async function handleReindex() {
    setReindexing(true);
    try {
      await apiPost('/api/brain/reindex');
      stats.refresh();
      notes.refresh();
    } finally {
      setReindexing(false);
    }
  }

  if (stats.error && !stats.data) return <PageState>Error: {String(stats.error)}</PageState>;

  const s = stats.data;

  return (
    <div class="flex h-full flex-col">
      <PageHeader
        title="Brain"
        subtitle={s
          ? `${s.noteCount} notes · ${s.linkCount} links · ${s.brokenLinkCount} broken · ${s.tagCount} tags · ${fmtTime(s.asOf)}`
          : 'Obsidian wiki — second brain'}
        actions={
          <button
            type="button"
            onClick={handleReindex}
            disabled={reindexing}
            class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-60"
          >
            <RefreshCw size={12} class={reindexing ? 'animate-spin' : ''} />
            {reindexing ? 'Reindexing…' : 'Reindex'}
          </button>
        }
      />

      <div class="flex-1 overflow-hidden p-4 grid grid-cols-1 lg:grid-cols-12 gap-3">

        {/* Left: vault tree + search */}
        <div class="lg:col-span-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-col min-h-0">
          <div class="flex items-center gap-2 mb-2 bg-[var(--color-elevated)] rounded px-2 py-1">
            <Search size={11} class="text-[var(--color-text-faint)]" />
            <input
              type="text"
              value={query}
              onInput={(e: any) => setQuery(e.target.value)}
              placeholder="search vault…"
              class="flex-1 bg-transparent border-0 outline-none text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]"
            />
          </div>

          <div class="flex-1 overflow-auto text-[11px] -mx-1 px-1">
            {searchResults ? (
              <div>
                <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] px-1 py-1">
                  {searchResults.length} matches
                </div>
                {searchResults.map(r => (
                  <button
                    key={r.path}
                    type="button"
                    onClick={() => setSelectedPath(r.path)}
                    class={`block w-full text-left px-1.5 py-1 rounded ${selectedPath === r.path ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]'}`}
                  >
                    <div class="flex items-center gap-1.5 truncate">
                      <FileText size={11} class="shrink-0" />
                      <span class="truncate font-medium">{r.title}</span>
                    </div>
                    {r.snippet && <div class="text-[10px] text-[var(--color-text-faint)] ml-4 truncate">{r.snippet}</div>}
                  </button>
                ))}
                {searchResults.length === 0 && (
                  <div class="text-[var(--color-text-faint)] px-1 py-2">No matches.</div>
                )}
              </div>
            ) : tree.length === 0 ? (
              <div class="text-[var(--color-text-faint)] px-1 py-2">
                Vault empty. Waiting for Syncthing to pull notes from your Mac.
              </div>
            ) : (
              tree.map(([folder, notes]) => (
                <div key={folder} class="mb-2">
                  <div class="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] px-1 py-1">
                    <FolderClosed size={10} />
                    {shortFolder(folder)} <span class="ml-auto">{notes.length}</span>
                  </div>
                  {notes.map(n => (
                    <button
                      key={n.path}
                      type="button"
                      onClick={() => setSelectedPath(n.path)}
                      class={`block w-full text-left px-1.5 py-1 rounded ${selectedPath === n.path ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]'}`}
                    >
                      <div class="flex items-center gap-1.5">
                        <FileText size={11} class="shrink-0" />
                        <span class="truncate">{n.title}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Middle: graph */}
        <div class="lg:col-span-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-col min-h-0">
          <div class="flex items-center justify-between mb-2">
            <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
              Link graph {detail ? `· 1-hop from ${detail.title}` : ''}
            </div>
            {graph && <div class="text-[10px] text-[var(--color-text-faint)]">{graph.nodes.length} nodes · {graph.edges.length} edges</div>}
          </div>
          <div class="flex-1 flex items-center justify-center text-[var(--color-text-faint)] text-[11px]">
            {graphLoading ? 'Loading graph…' : graph && graph.nodes.length > 0 ? (
              <BrainGraphSvg graph={graph} centerPath={selectedPath} onNodeClick={setSelectedPath} />
            ) : 'Pick a note to see its graph.'}
          </div>
        </div>

        {/* Right: note detail */}
        <div class="lg:col-span-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-col min-h-0">
          {detailLoading && !detail ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">Loading note…</div>
          ) : !detail ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">Select a note from the vault.</div>
          ) : (
            <>
              <div class="flex items-center gap-1.5 mb-1">
                <FileText size={13} class="text-[var(--color-accent)]" />
                <div class="text-[13px] font-semibold text-[var(--color-text)] truncate">{detail.title}</div>
              </div>
              <div class="text-[10px] text-[var(--color-text-faint)] mb-2">
                {shortFolder(detail.folder)} · {detail.wordCount} words · edited {fmtTime(detail.mtime)}
              </div>

              {detail.tags.length > 0 && (
                <div class="flex flex-wrap gap-1 mb-2">
                  {detail.tags.slice(0, 8).map(t => (
                    <span key={t} class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-text-muted)]">#{t}</span>
                  ))}
                </div>
              )}

              <div class="flex-1 overflow-auto text-[12px] text-[var(--color-text-muted)] leading-relaxed whitespace-pre-wrap border-t border-[var(--color-border)] pt-2 mb-2">
                {detail.content
                  ? renderContent(detail.content.slice(0, 4000), setSelectedPath)
                  : <span class="text-[var(--color-text-faint)] italic">Empty note.</span>}
                {detail.content && detail.content.length > 4000 && (
                  <div class="text-[10px] text-[var(--color-text-faint)] italic mt-2">… truncated, open in Obsidian for full content.</div>
                )}
              </div>

              {(detail.backlinks.length > 0 || detail.brokenLinks.length > 0) && (
                <div class="border-t border-[var(--color-border)] pt-2 text-[11px]">
                  {detail.backlinks.length > 0 && (
                    <div class="mb-1">
                      <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-0.5">Backlinks ({detail.backlinks.length})</div>
                      {detail.backlinks.slice(0, 8).map(b => (
                        <button
                          key={b.path}
                          type="button"
                          onClick={() => setSelectedPath(b.path)}
                          class="block text-left text-[var(--color-accent)] hover:underline truncate w-full"
                          style={{ background: 'transparent', border: 'none', padding: '1px 0', cursor: 'pointer' }}
                        >[[{b.title}]]</button>
                      ))}
                    </div>
                  )}
                  {detail.brokenLinks.length > 0 && (
                    <div>
                      <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-0.5">Broken ({detail.brokenLinks.length})</div>
                      {detail.brokenLinks.slice(0, 4).map(b => (
                        <div key={b} class="text-[var(--color-text-faint)] italic truncate">[[{b}]]</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div class="border-t border-[var(--color-border)] pt-2 mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => window.open(`obsidian://open?vault=Obsidian%20Brain&file=${encodeURIComponent(detail.path.replace(/\.md$/, ''))}`, '_blank')}
                  class="flex-1 inline-flex items-center justify-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  <ExternalLink size={10} /> Obsidian
                </button>
                <button
                  type="button"
                  class="flex-1 inline-flex items-center justify-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  <Pin size={10} /> Pin
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div class="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-faint)] flex items-center gap-2">
        <Sparkles size={10} class="text-[var(--color-accent)]" />
        Promotion proposals will surface here once Phase 3 wires the consolidation loop.
      </div>
    </div>
  );
}

// ---- Inline SVG graph viz ----

function BrainGraphSvg({ graph, centerPath, onNodeClick }: { graph: GraphResp; centerPath: string | null; onNodeClick: (p: string) => void }) {
  // Lay out nodes: center in the middle, others on a circle around it.
  const { nodes, edges } = graph;
  const W = 460, H = 320, CX = W / 2, CY = H / 2;
  const others = nodes.filter(n => n.id !== centerPath);
  const positions = new Map<string, { x: number; y: number }>();
  if (centerPath) positions.set(centerPath, { x: CX, y: CY });
  const R = Math.min(130, 40 + others.length * 6);
  others.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, others.length) - Math.PI / 2;
    positions.set(n.id, { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) });
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="w-full h-full" role="img" aria-label="Note link graph">
      {edges.map((e, i) => {
        const s = positions.get(e.source);
        const t = positions.get(e.target);
        if (!s || !t) return null;
        return <line key={`e-${i}`} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="var(--color-border)" stroke-width="1" />;
      })}
      {nodes.map(n => {
        const p = positions.get(n.id);
        if (!p) return null;
        const isCenter = n.id === centerPath;
        return (
          <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => onNodeClick(n.id)}>
            <circle cx={p.x} cy={p.y} r={isCenter ? 18 : 11}
              fill={isCenter ? 'var(--color-accent)' : 'var(--color-accent-soft)'}
              stroke="var(--color-accent)" stroke-width={isCenter ? 0 : 0.8}
            />
            <text x={p.x} y={p.y + (isCenter ? 30 : 22)} text-anchor="middle"
              font-size={isCenter ? 11 : 9}
              fill={'var(--color-text-muted)'}
            >{n.title.length > 16 ? n.title.slice(0, 14) + '…' : n.title}</text>
          </g>
        );
      })}
    </svg>
  );
}
