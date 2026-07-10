// Brain.tsx — Obsidian vault knowledge graph for Mission Control.
//
// Layout:
//   Left sidebar  — collapsible note list + search
//   Center        — full-vault circular graph (THE HERO)
//   Right panel   — note detail (slides in on node click)
//
// Visual approach: all nodes sit on one large circle, grouped by folder into
// consecutive arcs. Folder arcs are labelled. Edges are chord-style cubic
// bezier curves that arc through the center — like a Circos diagram.

import { useEffect, useMemo, useRef, useState, useCallback } from 'preact/hooks';
import {
  Library, RefreshCw, Search, ExternalLink, FolderClosed,
  FileText, X, ChevronLeft, ChevronRight, ZapOff,
} from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiGet, apiPost } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BrainStats {
  vaultPath: string; exists: boolean;
  noteCount: number; linkCount: number; brokenLinkCount: number; tagCount: number; asOf: number;
}
interface NoteSummary {
  path: string; title: string; folder: string; tags: string[];
  linkCount: number; backlinkCount: number; wordCount: number; mtime: number;
}
interface NoteDetail extends NoteSummary {
  content: string; aliases: string[];
  links: NoteSummary[]; brokenLinks: string[]; backlinks: NoteSummary[];
}
interface SearchResult extends NoteSummary { score: number; snippet: string; }
interface GraphNode { id: string; title: string; folder: string; type: string; linkCount: number; }
interface GraphEdge { source: string; target: string; }
interface GraphResp { nodes: GraphNode[]; edges: GraphEdge[]; center: string | null; }

// ── Palette ───────────────────────────────────────────────────────────────────

const FOLDER_PALETTE: Record<string, { fill: string; glow: string }> = {
  business:   { fill: '#a78bfa', glow: '#a78bfa55' },
  clippings:  { fill: '#fbbf24', glow: '#fbbf2455' },
  decisions:  { fill: '#22d3ee', glow: '#22d3ee55' },
  people:     { fill: '#fb7185', glow: '#fb718555' },
  principles: { fill: '#34d399', glow: '#34d39955' },
  system:     { fill: '#60a5fa', glow: '#60a5fa55' },
  root:       { fill: '#94a3b8', glow: '#94a3b855' },
};

function folderPalette(folder: string) {
  return FOLDER_PALETTE[folder.toLowerCase()] ?? FOLDER_PALETTE.root;
}

// ── Circular layout ───────────────────────────────────────────────────────────
//
// All nodes are placed on a single ring, grouped by folder into consecutive
// arcs separated by small angular gaps. The most-linked node in each folder
// sits at the centre of its arc. Returns node positions + arc metadata for
// the visual folder decorations.

interface FolderArc {
  folder: string;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  nodeCount: number;
}

interface CircleLayout {
  positions: Map<string, { x: number; y: number }>;
  folderArcs: FolderArc[];
}

// Main ring radius — fits comfortably inside the 1100×720 SVG canvas.
const CIRCLE_R  = 248;
const ARC_R     = CIRCLE_R + 22;   // coloured folder arc ring
const LABEL_R   = CIRCLE_R + 42;   // folder name labels

function runCircleLayout(nodes: GraphNode[], W: number, H: number): CircleLayout {
  if (!nodes.length) return { positions: new Map(), folderArcs: [] };

  const cx = W / 2, cy = H / 2;

  // Group by folder
  const folderGroups = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const f = n.folder || 'root';
    if (!folderGroups.has(f)) folderGroups.set(f, []);
    folderGroups.get(f)!.push(n);
  }

  // Sort folders alphabetically for a stable, predictable layout
  const folders = Array.from(folderGroups.keys()).sort();

  // Within each folder: rotate the sorted array so the most-linked node lands
  // at the midpoint of the arc (most prominent position).
  for (const [, ns] of folderGroups) {
    ns.sort((a, b) => b.linkCount - a.linkCount);
    if (ns.length > 2) {
      const half = Math.floor(ns.length / 2);
      ns.unshift(...ns.splice(half));
    }
  }

  const total       = nodes.length;
  const GAP_FRAC    = 0.028;   // fraction of full circle used as inter-folder gap
  const totalGapFrac = GAP_FRAC * folders.length;
  const usableFrac  = 1 - totalGapFrac;

  const TWO_PI          = 2 * Math.PI;
  const ANGLE_PER_NODE  = (TWO_PI * usableFrac) / total;
  const GAP_ANGLE       = TWO_PI * GAP_FRAC;

  const positions = new Map<string, { x: number; y: number }>();
  const folderArcs: FolderArc[] = [];

  let θ = -Math.PI / 2;   // start from the top of the circle

  for (const folder of folders) {
    const ns    = folderGroups.get(folder)!;
    const count = ns.length;

    const startAngle = θ;
    ns.forEach((n, i) => {
      const angle = startAngle + (i + 0.5) * ANGLE_PER_NODE;
      positions.set(n.id, {
        x: cx + CIRCLE_R * Math.cos(angle),
        y: cy + CIRCLE_R * Math.sin(angle),
      });
    });

    const endAngle = startAngle + ANGLE_PER_NODE * count;
    folderArcs.push({ folder, startAngle, endAngle, midAngle: (startAngle + endAngle) / 2, nodeCount: count });
    θ = endAngle + GAP_ANGLE;
  }

  return { positions, folderArcs };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  const delta = Date.now() - ms;
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function nodeRadius(n: GraphNode): number {
  return Math.max(5, Math.min(18, 6 + Math.sqrt(n.linkCount) * 2.2));
}

function renderWikiContent(content: string, onLinkClick: (t: string) => void): any[] {
  const out: any[] = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
  let last = 0, m: RegExpExecArray | null, key = 0;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push(content.slice(last, m.index));
    const target = m[1].trim(), display = (m[2] || m[1]).trim();
    out.push(
      <button key={`l-${key++}`} type="button" onClick={() => onLinkClick(target)}
        class="text-[var(--color-accent)] hover:underline"
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}>
        {display}
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push(content.slice(last));
  return out;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Brain() {
  const stats  = useFetch<BrainStats>('/api/brain/stats', 60_000);
  const notes  = useFetch<{ notes: NoteSummary[]; total: number }>('/api/brain/notes?limit=500');
  const graph  = useFetch<GraphResp>('/api/brain/graph');   // full vault graph

  const [selectedPath, setSelectedPath]     = useState<string | null>(null);
  const [detail, setDetail]                 = useState<NoteDetail | null>(null);
  const [detailLoading, setDetailLoading]   = useState(false);
  const [query, setQuery]                   = useState('');
  const [searchResults, setSearchResults]   = useState<SearchResult[] | null>(null);
  const [sidebarOpen, setSidebarOpen]       = useState(true);
  const [reindexing, setReindexing]         = useState(false);

  // Search
  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return; }
    const h = setTimeout(() => {
      apiGet<{ results: SearchResult[] }>(`/api/brain/search?q=${encodeURIComponent(query)}&limit=30`)
        .then(d => setSearchResults(d.results)).catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(h);
  }, [query]);

  // Load detail when selection changes
  useEffect(() => {
    if (!selectedPath) { setDetail(null); return; }
    setDetailLoading(true);
    apiGet<NoteDetail>(`/api/brain/note?path=${encodeURIComponent(selectedPath)}`)
      .then(d => setDetail(d)).catch(() => setDetail(null)).finally(() => setDetailLoading(false));
  }, [selectedPath]);

  // Folder tree for sidebar
  const tree = useMemo(() => {
    const groups: Record<string, NoteSummary[]> = {};
    for (const n of notes.data?.notes ?? []) (groups[n.folder] ??= []).push(n);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [notes.data]);

  async function handleReindex() {
    setReindexing(true);
    try { await apiPost('/api/brain/reindex'); stats.refresh(); notes.refresh(); graph.refresh(); }
    finally { setReindexing(false); }
  }

  const s = stats.data;

  return (
    <div class="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Brain"
        subtitle={s
          ? `${s.noteCount} notes · ${s.linkCount} links · ${s.tagCount} tags`
          : 'Obsidian knowledge graph'}
        actions={
          <div class="flex items-center gap-2">
            <button type="button" onClick={() => setSidebarOpen(o => !o)}
              class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]">
              {sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
              {sidebarOpen ? 'Hide' : 'Notes'}
            </button>
            <button type="button" onClick={handleReindex} disabled={reindexing}
              class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-60">
              <RefreshCw size={12} class={reindexing ? 'animate-spin' : ''} />
              {reindexing ? 'Reindexing…' : 'Reindex'}
            </button>
          </div>
        }
      />

      <div class="flex-1 overflow-hidden flex min-h-0">

        {/* ── Left sidebar ── */}
        {sidebarOpen && (
          <aside class="w-52 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-card)] flex flex-col min-h-0">
            <div class="p-2 border-b border-[var(--color-border)]">
              <div class="flex items-center gap-2 bg-[var(--color-elevated)] rounded px-2 py-1.5">
                <Search size={11} class="text-[var(--color-text-faint)] shrink-0" />
                <input type="text" value={query} onInput={(e: any) => setQuery(e.target.value)}
                  placeholder="search vault…"
                  class="flex-1 bg-transparent border-0 outline-none text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]" />
                {query && (
                  <button type="button" onClick={() => setQuery('')} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
                    <X size={10} />
                  </button>
                )}
              </div>
            </div>

            <div class="flex-1 overflow-auto text-[11px] p-1">
              {searchResults ? (
                <div>
                  <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] px-1.5 py-1">
                    {searchResults.length} matches
                  </div>
                  {searchResults.map(r => (
                    <NoteRow key={r.path} note={r} selected={selectedPath === r.path}
                      onClick={() => setSelectedPath(r.path)} snippet={r.snippet} />
                  ))}
                  {!searchResults.length && (
                    <div class="text-[var(--color-text-faint)] px-1.5 py-2 text-[11px]">No matches.</div>
                  )}
                </div>
              ) : tree.length === 0 ? (
                <div class="text-[var(--color-text-faint)] px-1.5 py-4 text-[11px] text-center">
                  <ZapOff size={20} class="mx-auto mb-2 opacity-30" />
                  Vault empty
                </div>
              ) : (
                tree.map(([folder, ns]) => (
                  <div key={folder} class="mb-1">
                    <div class="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] px-1.5 py-1.5">
                      <span class="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: folderPalette(folder).fill }} />
                      <FolderClosed size={9} />
                      <span class="truncate">{folder === 'root' ? '—' : folder}</span>
                      <span class="ml-auto tabular-nums">{ns.length}</span>
                    </div>
                    {ns.map(n => (
                      <NoteRow key={n.path} note={n} selected={selectedPath === n.path}
                        onClick={() => setSelectedPath(n.path)} />
                    ))}
                  </div>
                ))
              )}
            </div>
          </aside>
        )}

        {/* ── Graph hero ── */}
        <div class="flex-1 relative min-h-0 min-w-0 overflow-hidden"
          style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 50%, color-mix(in srgb, var(--color-accent) 7%, transparent), var(--color-bg) 72%)' }}>
          {graph.loading && !graph.data ? (
            <div class="absolute inset-0 flex items-center justify-center text-[var(--color-text-faint)] text-[13px]">
              Building graph…
            </div>
          ) : graph.data && graph.data.nodes.length > 0 ? (
            <VaultGraph
              graph={graph.data}
              selectedPath={selectedPath}
              onSelect={(path) => setSelectedPath(path === selectedPath ? null : path)}
            />
          ) : (
            <div class="absolute inset-0 flex flex-col items-center justify-center text-[var(--color-text-faint)] text-[13px] gap-2">
              <Library size={32} class="opacity-20" />
              <div>No notes indexed yet.</div>
            </div>
          )}

          {/* Folder legend */}
          {graph.data && graph.data.nodes.length > 0 && (
            <FolderLegend nodes={graph.data.nodes} />
          )}

          {/* Stats chip */}
          {graph.data && (
            <div class="absolute top-3 right-3 flex items-center gap-2 rounded-full px-3 py-1 text-[10.5px] text-[var(--color-text-faint)] tabular-nums"
              style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', backdropFilter: 'blur(8px)' }}>
              {graph.data.nodes.length} nodes · {graph.data.edges.length} edges
            </div>
          )}
        </div>

        {/* ── Right detail panel ── */}
        <aside
          class={[
            'shrink-0 bg-[var(--color-card)] border-l border-[var(--color-border)] flex flex-col min-h-0 overflow-hidden',
            'transition-all duration-300 ease-out',
            selectedPath ? 'w-80' : 'w-0',
          ].join(' ')}
          style={{ backdropFilter: 'blur(8px)' }}
        >
          {selectedPath && (
            <NoteDetailPanel
              path={selectedPath}
              detail={detail}
              loading={detailLoading}
              onClose={() => setSelectedPath(null)}
              onNavigate={setSelectedPath}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// ── NoteRow ───────────────────────────────────────────────────────────────────

function NoteRow({ note, selected, onClick, snippet }: {
  note: NoteSummary; selected: boolean; onClick: () => void; snippet?: string;
}) {
  const { fill } = folderPalette(note.folder);
  return (
    <button type="button" onClick={onClick}
      class={[
        'block w-full text-left px-1.5 py-1 rounded transition-colors',
        selected
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]',
      ].join(' ')}>
      <div class="flex items-center gap-1.5 truncate">
        <span class="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: fill }} />
        <span class="truncate font-medium text-[11px]">{note.title}</span>
      </div>
      {snippet && (
        <div class="text-[10px] text-[var(--color-text-faint)] ml-3 truncate">{snippet}</div>
      )}
    </button>
  );
}

// ── Folder legend ─────────────────────────────────────────────────────────────

function FolderLegend({ nodes }: { nodes: GraphNode[] }) {
  const folders = useMemo(() => {
    const seen = new Map<string, number>();
    for (const n of nodes) seen.set(n.folder, (seen.get(n.folder) ?? 0) + 1);
    return Array.from(seen.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);

  return (
    <div class="absolute bottom-3 left-3 flex flex-col gap-1 rounded-xl px-3 py-2"
      style={{ background: 'color-mix(in srgb, var(--color-card) 85%, transparent)', border: '1px solid var(--color-border)', backdropFilter: 'blur(8px)' }}>
      {folders.map(([folder, count]) => {
        const { fill } = folderPalette(folder);
        return (
          <div key={folder} class="flex items-center gap-2 text-[10.5px] text-[var(--color-text-muted)]">
            <span class="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: fill, boxShadow: `0 0 5px ${fill}` }} />
            <span class="capitalize">{folder === 'root' ? 'Uncategorized' : folder}</span>
            <span class="ml-auto text-[var(--color-text-faint)] tabular-nums">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── VaultGraph — circular chord diagram ───────────────────────────────────────

const GW  = 1100;
const GH  = 720;
const GCX = GW / 2;
const GCY = GH / 2;

function VaultGraph({ graph, selectedPath, onSelect }: {
  graph: GraphResp;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const { nodes, edges } = graph;

  // Compute circular layout — deterministic, no simulation needed
  const { positions, folderArcs } = useMemo(() => runCircleLayout(nodes, GW, GH), [nodes]);

  // Adjacency map for hover highlighting
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const e of edges) {
      adj.get(e.source)?.add(e.target);
      adj.get(e.target)?.add(e.source);
    }
    return adj;
  }, [nodes, edges]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const focusId        = hoveredId ?? selectedPath;
  const focusNeighbors = focusId ? (adjacency.get(focusId) ?? new Set<string>()) : new Set<string>();
  const hoveredNode    = hoveredId ? nodes.find(n => n.id === hoveredId) : null;

  function nodeOpacity(n: GraphNode): number {
    if (!focusId) return 1;
    if (n.id === focusId) return 1;
    if (focusNeighbors.has(n.id)) return 0.9;
    return 0.14;
  }

  function edgeOpacity(e: GraphEdge): number {
    if (!focusId) return 0.16;
    if (e.source === focusId || e.target === focusId) return 0.82;
    return 0.03;
  }

  function edgeWidth(e: GraphEdge): number {
    if (!focusId) return 0.65;
    if (e.source === focusId || e.target === focusId) return 1.8;
    return 0.3;
  }

  // Per-edge colour gradients
  const edgeGradients = useMemo(() => {
    return edges.map((e, i) => {
      const srcColor = folderPalette(nodes.find(n => n.id === e.source)?.folder ?? '').fill;
      const tgtColor = folderPalette(nodes.find(n => n.id === e.target)?.folder ?? '').fill;
      return { id: `eg-${i}`, srcColor, tgtColor };
    });
  }, [edges, nodes]);

  // SVG arc path helper
  function arcPath(r: number, a1: number, a2: number, cx = GCX, cy = GCY) {
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = (a2 - a1) > Math.PI ? 1 : 0;
    return `M ${x1},${y1} A ${r},${r} 0 ${large} 1 ${x2},${y2}`;
  }

  return (
    <svg
      viewBox={`0 0 ${GW} ${GH}`}
      class="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      onMouseLeave={() => setHoveredId(null)}
      style={{ cursor: 'default' }}
    >
      <defs>
        {/* Node glow */}
        <filter id="vg-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Strong glow for selected/hovered */}
        <filter id="vg-glow-strong" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Edge glow */}
        <filter id="vg-edge-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        {/* Background atmosphere */}
        <radialGradient id="vg-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="var(--color-accent)" stop-opacity="0.055" />
          <stop offset="100%" stop-color="transparent" />
        </radialGradient>
        {/* Per-edge gradients using user-space coordinates */}
        {edgeGradients.map(({ id, srcColor, tgtColor }, i) => {
          const src = positions.get(edges[i].source);
          const tgt = positions.get(edges[i].target);
          if (!src || !tgt) return null;
          return (
            <linearGradient key={id} id={id}
              gradientUnits="userSpaceOnUse"
              x1={src.x} y1={src.y}
              x2={tgt.x} y2={tgt.y}>
              <stop offset="0%"   stop-color={srcColor} />
              <stop offset="100%" stop-color={tgtColor} />
            </linearGradient>
          );
        })}
      </defs>

      {/* Background atmosphere */}
      <ellipse cx={GCX} cy={GCY} rx={GW * 0.52} ry={GH * 0.52} fill="url(#vg-bg)" />

      {/* Guide ring — the faint track all nodes sit on */}
      <circle cx={GCX} cy={GCY} r={CIRCLE_R}
        fill="none" stroke="var(--color-border)" stroke-width="0.5" opacity="0.25" />

      {/* Folder arc segments — coloured rings just outside the node ring */}
      <g>
        {folderArcs.map(({ folder, startAngle, endAngle, midAngle }) => {
          const { fill } = folderPalette(folder);
          const INSET = 0.012;  // trim arc ends slightly so they don't touch
          const a1 = startAngle + INSET;
          const a2 = endAngle   - INSET;
          if (a2 <= a1) return null;

          const lx   = GCX + LABEL_R * Math.cos(midAngle);
          const ly   = GCY + LABEL_R * Math.sin(midAngle);
          const cos  = Math.cos(midAngle);
          const anchor = cos > 0.22 ? 'start' : cos < -0.22 ? 'end' : 'middle';
          const label  = folder === 'root' ? 'other' : folder;

          return (
            <g key={folder}>
              {/* Arc stroke */}
              <path d={arcPath(ARC_R, a1, a2)}
                fill="none" stroke={fill} stroke-width="4"
                stroke-linecap="round" opacity="0.42" />
              {/* Soft outer glow on the arc */}
              <path d={arcPath(ARC_R, a1, a2)}
                fill="none" stroke={fill} stroke-width="8"
                stroke-linecap="round" opacity="0.12"
                filter="url(#vg-edge-glow)" />
              {/* Folder label */}
              <text
                x={lx} y={ly + 3.5}
                text-anchor={anchor}
                font-size="9.5"
                font-weight="500"
                letter-spacing="0.08em"
                fill={fill}
                opacity="0.8"
                style={{ textTransform: 'uppercase', pointerEvents: 'none' }}>
                {label}
              </text>
            </g>
          );
        })}
      </g>

      {/* Edges — chord-style cubic bezier arcs curving through center */}
      <g>
        {edges.map((e, i) => {
          const src = positions.get(e.source);
          const tgt = positions.get(e.target);
          if (!src || !tgt) return null;

          const op        = edgeOpacity(e);
          const w         = edgeWidth(e);
          const isFocused = !!focusId && (e.source === focusId || e.target === focusId);

          // Control points: 85 % of the way from node toward the canvas centre
          // This creates pronounced arcs that converge through the hub area.
          const cp1x = GCX + (src.x - GCX) * 0.15;
          const cp1y = GCY + (src.y - GCY) * 0.15;
          const cp2x = GCX + (tgt.x - GCX) * 0.15;
          const cp2y = GCY + (tgt.y - GCY) * 0.15;

          return (
            <path key={i}
              d={`M ${src.x},${src.y} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${tgt.x},${tgt.y}`}
              fill="none"
              stroke={isFocused ? `url(#${edgeGradients[i].id})` : 'var(--color-text-faint)'}
              stroke-width={w}
              opacity={op}
              filter={isFocused ? 'url(#vg-edge-glow)' : undefined}
              style={{ transition: 'opacity 180ms, stroke-width 180ms' }}
            />
          );
        })}
      </g>

      {/* Nodes */}
      <g>
        {nodes.map(n => {
          const p = positions.get(n.id);
          if (!p) return null;

          const { fill, glow } = folderPalette(n.folder);
          const r          = nodeRadius(n);
          const isSelected = n.id === selectedPath;
          const isHovered  = n.id === hoveredId;
          const isFocus    = isSelected || isHovered;
          const isNeighbor = focusNeighbors.has(n.id);
          const op         = nodeOpacity(n);
          const displayR   = isFocus ? r * 1.4 : isNeighbor ? r * 1.12 : r;

          // Show label for hubs (≥3 links), focused node, and neighbours
          const showLabel = isFocus || isNeighbor || n.linkCount >= 3;

          // Place label radially outward from the circle
          const nodeAngle = Math.atan2(p.y - GCY, p.x - GCX);
          const labelDist = displayR + 13;
          const lx        = p.x + Math.cos(nodeAngle) * labelDist;
          const ly        = p.y + Math.sin(nodeAngle) * labelDist;
          const cos       = Math.cos(nodeAngle);
          const anchor    = cos > 0.2 ? 'start' : cos < -0.2 ? 'end' : 'middle';

          return (
            <g key={n.id} style={{ cursor: 'pointer' }}
              onClick={() => onSelect(n.id)}
              onMouseEnter={() => setHoveredId(n.id)}
              onMouseLeave={() => setHoveredId(id => id === n.id ? null : id)}>

              {/* Outer glow halo */}
              <circle cx={p.x} cy={p.y} r={displayR * 2.8}
                fill={glow}
                opacity={isFocus ? 0.38 : isNeighbor ? 0.16 : 0}
                style={{ transition: 'opacity 200ms', pointerEvents: 'none' }}
                filter="url(#vg-glow)" />

              {/* Dashed selection ring */}
              {isSelected && (
                <circle cx={p.x} cy={p.y} r={displayR + 4.5}
                  fill="none" stroke={fill} stroke-width="1.5"
                  opacity="0.85" stroke-dasharray="3 2.5" />
              )}

              {/* Main node body */}
              <circle cx={p.x} cy={p.y} r={displayR}
                fill={fill}
                opacity={op}
                filter={isFocus ? 'url(#vg-glow-strong)' : 'url(#vg-glow)'}
                style={{ transition: 'r 160ms, opacity 180ms' }} />

              {/* Specular highlight */}
              <circle cx={p.x - displayR * 0.28} cy={p.y - displayR * 0.3} r={displayR * 0.36}
                fill="white" opacity={isFocus ? 0.72 * op : 0.48 * op}
                style={{ pointerEvents: 'none', transition: 'opacity 180ms' }} />

              {/* Label — always outward from the ring */}
              {showLabel && (
                <text
                  x={lx} y={ly + 3.5}
                  text-anchor={anchor}
                  font-size={isFocus ? 11.5 : 9.5}
                  font-weight={isFocus ? '600' : '400'}
                  fill={isFocus ? fill : 'var(--color-text-muted)'}
                  opacity={isFocus ? 1 : 0.78 * op}
                  style={{ pointerEvents: 'none', transition: 'opacity 180ms, font-size 160ms' }}>
                  {n.title.length > 22 ? n.title.slice(0, 20) + '…' : n.title}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Hover tooltip — positioned in SVG user-space near the node */}
      {hoveredNode && hoveredId !== selectedPath && (() => {
        const p        = positions.get(hoveredNode.id)!;
        const { fill } = folderPalette(hoveredNode.folder);
        // Put tooltip outside the ring from the node
        const angle  = Math.atan2(p.y - GCY, p.x - GCX);
        const tipW   = 185, tipH = 54;
        // Offset from node toward outside
        const outDist = nodeRadius(hoveredNode) + 16;
        let tx = p.x + Math.cos(angle) * outDist;
        let ty = p.y + Math.sin(angle) * outDist - tipH / 2;
        // Flip to other side if would clip SVG
        if (Math.cos(angle) >= 0) {
          // right half — tooltip goes right
          tx = p.x + outDist;
        } else {
          // left half — tooltip goes left
          tx = p.x - tipW - outDist;
        }
        tx = Math.max(6, Math.min(GW - tipW - 6, tx));
        ty = Math.max(6, Math.min(GH - tipH - 6, ty));

        return (
          <foreignObject x={tx} y={ty} width={tipW} height={tipH}
            style={{ pointerEvents: 'none', overflow: 'visible' }}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{
              background: 'var(--color-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '7px 10px',
              fontSize: 11,
              lineHeight: 1.45,
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
              width: tipW + 'px',
              boxSizing: 'border-box' as any,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: fill, flexShrink: 0, boxShadow: `0 0 6px ${fill}` }} />
                <span style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 11.5 }}>{hoveredNode.title}</span>
              </div>
              <div style={{ color: 'var(--color-text-faint)', fontSize: 10.5 }}>
                {hoveredNode.folder === 'root' ? 'other' : hoveredNode.folder} · {hoveredNode.linkCount} links
              </div>
            </div>
          </foreignObject>
        );
      })()}
    </svg>
  );
}

// ── Note detail panel ─────────────────────────────────────────────────────────

function NoteDetailPanel({ path, detail, loading, onClose, onNavigate }: {
  path: string;
  detail: NoteDetail | null;
  loading: boolean;
  onClose: () => void;
  onNavigate: (p: string) => void;
}) {
  if (loading && !detail) {
    return (
      <div class="flex items-center justify-center h-full text-[11px] text-[var(--color-text-faint)]">
        Loading…
      </div>
    );
  }
  if (!detail) return null;

  const { fill } = folderPalette(detail.folder);

  return (
    <div class="flex flex-col h-full">
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)] shrink-0">
        <span class="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fill, boxShadow: `0 0 6px ${fill}` }} />
        <div class="flex-1 min-w-0">
          <div class="text-[12.5px] font-semibold text-[var(--color-text)] truncate">{detail.title}</div>
          <div class="text-[10px] text-[var(--color-text-faint)]">
            {detail.folder === 'root' ? '—' : detail.folder} · {detail.wordCount} words · {fmtTime(detail.mtime)}
          </div>
        </div>
        <button type="button" onClick={onClose}
          class="shrink-0 p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* Tags */}
      {detail.tags.length > 0 && (
        <div class="flex flex-wrap gap-1 px-3 py-1.5 border-b border-[var(--color-border)] shrink-0">
          {detail.tags.slice(0, 10).map(t => (
            <span key={t} class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-text-muted)]">#{t}</span>
          ))}
        </div>
      )}

      {/* Content */}
      <div class="flex-1 overflow-auto px-3 py-2 text-[11.5px] text-[var(--color-text-muted)] leading-relaxed whitespace-pre-wrap">
        {detail.content
          ? renderWikiContent(detail.content.slice(0, 4000), (t) => { onNavigate(t); })
          : <span class="text-[var(--color-text-faint)] italic">Empty note.</span>}
        {detail.content.length > 4000 && (
          <div class="text-[10px] text-[var(--color-text-faint)] italic mt-2">… open in Obsidian for full content</div>
        )}
      </div>

      {/* Backlinks + outlinks */}
      {(detail.backlinks.length > 0 || detail.links.length > 0) && (
        <div class="border-t border-[var(--color-border)] px-3 py-2 shrink-0 text-[11px] space-y-2">
          {detail.links.length > 0 && (
            <div>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1">Links → ({detail.links.length})</div>
              {detail.links.slice(0, 6).map(l => (
                <button key={l.path} type="button" onClick={() => onNavigate(l.path)}
                  class="block text-left text-[var(--color-accent)] hover:underline truncate w-full"
                  style={{ background: 'transparent', border: 'none', padding: '1px 0', cursor: 'pointer' }}>
                  [[{l.title}]]
                </button>
              ))}
            </div>
          )}
          {detail.backlinks.length > 0 && (
            <div>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1">← Backlinks ({detail.backlinks.length})</div>
              {detail.backlinks.slice(0, 6).map(b => (
                <button key={b.path} type="button" onClick={() => onNavigate(b.path)}
                  class="block text-left text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:underline truncate w-full"
                  style={{ background: 'transparent', border: 'none', padding: '1px 0', cursor: 'pointer' }}>
                  [[{b.title}]]
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div class="border-t border-[var(--color-border)] px-3 py-2 shrink-0 flex gap-2">
        <button type="button"
          onClick={() => window.open(`obsidian://open?vault=Obsidian%20Brain&file=${encodeURIComponent(detail.path.replace(/\.md$/, ''))}`, '_blank')}
          class="flex-1 inline-flex items-center justify-center gap-1.5 rounded border border-[var(--color-border)] px-2 py-1.5 text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors">
          <ExternalLink size={10} /> Open in Obsidian
        </button>
      </div>
    </div>
  );
}
