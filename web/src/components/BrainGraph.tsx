import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { X, Search, RotateCw, Sparkles, ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-preact';
import { formatRelativeTime } from '@/lib/format';

// ── Public types ─────────────────────────────────────────────────────

export interface NoteNode {
  id: string;
  title: string;
  folder: string;
  type?: string;
  linkCount: number;
}

interface HiveEntry {
  id: number;
  agent_id: string;
  chat_id: string;
  action: string;
  summary: string;
  artifacts: string | null;
  created_at: number;
}

interface Props {
  entries: HiveEntry[];
  /** Obsidian vault notes to overlay on the brain. Optional — omit for pure activity view. */
  notes?: NoteNode[];
  /** Top-level agent tab — 'all' or an agent id. Acts as a hard filter. */
  agentFilter: string;
  /** Per-agent dot color (defaults supplied by the parent). */
  agentColors: Record<string, string>;
  blurOn: boolean;
}

// ── Brain shape ─────────────────────────────────────────────────────
const VIEW_W = 900;
const VIEW_H = 520;

const CEREBRUM_PATH =
  'M 450,72 ' +
  'C 492,56 540,58 575,82 ' +
  'C 628,86 678,116 707,162 ' +
  'C 736,202 745,254 730,304 ' +
  'C 717,352 686,392 645,416 ' +
  'C 610,432 572,442 530,442 ' +
  'C 508,452 480,458 460,455 ' +
  'C 452,460 448,460 440,455 ' +
  'C 420,458 392,452 370,442 ' +
  'C 328,442 290,432 255,416 ' +
  'C 214,392 183,352 170,304 ' +
  'C 155,254 164,202 193,162 ' +
  'C 222,116 272,86 325,82 ' +
  'C 360,58 408,56 450,72 Z';

const FISSURE_PATH = 'M 450,74 C 446,170 454,290 450,455';

const SULCI_LEFT = [
  'M 282,118 C 270,148 268,178 280,208',
  'M 232,148 C 224,180 220,210 228,240',
  'M 320,108 C 318,140 322,172 332,200',
  'M 300,178 C 285,210 282,250 295,290',
  'M 250,210 C 240,240 240,275 252,302',
  'M 195,280 C 220,295 250,302 285,300',
  'M 215,330 C 245,348 280,360 320,358',
  'M 350,250 C 340,278 340,310 352,338',
  'M 280,360 C 300,378 332,392 365,392',
  'M 320,400 C 348,418 380,428 412,425',
  'M 270,250 C 282,272 280,300 268,322',
  'M 380,180 C 372,210 372,238 382,265',
];

const SULCI_RIGHT = [
  'M 618,118 C 630,148 632,178 620,208',
  'M 668,148 C 676,180 680,210 672,240',
  'M 580,108 C 582,140 578,172 568,200',
  'M 600,178 C 615,210 618,250 605,290',
  'M 650,210 C 660,240 660,275 648,302',
  'M 705,280 C 680,295 650,302 615,300',
  'M 685,330 C 655,348 620,360 580,358',
  'M 550,250 C 560,278 560,310 548,338',
  'M 620,360 C 600,378 568,392 535,392',
  'M 580,400 C 552,418 520,428 488,425',
  'M 630,250 C 618,272 620,300 632,322',
  'M 520,180 C 528,210 528,238 518,265',
];

// ── Lobes ────────────────────────────────────────────────────────────

interface Lobe {
  id: string;
  label: string;
  color: string;
  rect: [number, number, number, number];
  labelAt: [number, number];
}

const LOBES: Lobe[] = [
  { id: 'frontal',   label: 'Frontal',   color: '#5eb6ff', rect: [200,  80, 500, 110], labelAt: [450,  98] },
  { id: 'parietal',  label: 'Parietal',  color: '#10b981', rect: [240, 190, 420, 100], labelAt: [450, 240] },
  { id: 'temporal',  label: 'Temporal',  color: '#f59e0b', rect: [165, 280, 570,  90], labelAt: [240, 350] },
  { id: 'occipital', label: 'Occipital', color: '#a78bfa', rect: [280, 370, 340,  80], labelAt: [450, 410] },
];

const LOBE_BY_ID = LOBES.reduce<Record<string, Lobe>>((acc, l) => { acc[l.id] = l; return acc; }, {});

// ── Agent → lobe (semantic neuroscience mapping) ─────────────────────

const AGENT_LOBE: Record<string, string> = {
  main:     'frontal',     // executive, planning
  research: 'parietal',    // sensing & integration
  comms:    'temporal',    // language & memory
  content:  'occipital',   // visual / creative output
  ops:      'parietal',    // coordination
  meta:     'frontal',     // system-level
};

function lobeFor(entry: HiveEntry): Lobe {
  return LOBE_BY_ID[AGENT_LOBE[entry.agent_id] || 'frontal'];
}

// ── Obsidian folder → lobe mapping ───────────────────────────────────
// Mirrors the agent mapping: folders land in whichever lobe
// best represents their cognitive function.

const NOTE_LOBE: Record<string, string> = {
  business:   'frontal',    // planning, strategy, executive
  decisions:  'frontal',    // executive function
  system:     'frontal',    // meta / system-level
  root:       'frontal',    // uncategorized → frontal
  clippings:  'parietal',   // external info integrated & stored
  principles: 'occipital',  // core values / worldview / vision
  people:     'temporal',   // language, social memory, names
};

// Warm, distinct palette that reads against the cool lobe glow colors.
const NOTE_PALETTE: Record<string, string> = {
  business:   '#fb7185',   // rose
  decisions:  '#e879f9',   // fuchsia
  system:     '#38bdf8',   // sky
  root:       '#94a3b8',   // slate
  clippings:  '#4ade80',   // green
  principles: '#facc15',   // yellow
  people:     '#f97316',   // orange
};

// ── PRNG + layout ────────────────────────────────────────────────────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pt { x: number; y: number }
type LobePools = Record<string, Pt[]>;

function generateLobePools(
  cerebrum: SVGPathElement,
  seed = 0xb14b,
  target = 140,
  minDist = 13,
): LobePools {
  const pools: LobePools = {};
  const r = rng(seed);
  for (const lobe of LOBES) {
    const pts: Pt[] = [];
    let tries = 0;
    while (pts.length < target && tries < target * 60) {
      tries++;
      const [x0, y0, w, h] = lobe.rect;
      const x = x0 + r() * w;
      const y = y0 + r() * h;
      if (!(cerebrum as any).isPointInFill({ x, y })) continue;
      if (Math.abs(x - 450) < 10) continue;
      let tooClose = false;
      for (const p of pts) {
        const dx = p.x - x, dy = p.y - y;
        if (dx * dx + dy * dy < minDist * minDist) { tooClose = true; break; }
      }
      if (!tooClose) pts.push({ x, y });
    }
    pools[lobe.id] = pts;
  }
  return pools;
}

// ── Semantic matching ─────────────────────────────────────────────────

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'been', 'will', 'were',
  'they', 'them', 'their', 'what', 'when', 'where', 'which', 'would',
  'could', 'should', 'about', 'into', 'than', 'then', 'some', 'more',
  'also', 'here', 'there', 'your', 'make', 'just', 'over', 'each',
  'time', 'work', 'used', 'using', 'task', 'file', 'data',
]);

function extractWords(s: string): string[] {
  return s.toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !STOPWORDS.has(w));
}

// ── Internal types ────────────────────────────────────────────────────

type PlacedEntry = HiveEntry & { pt: Pt; lobe: string };
type PlacedNote  = NoteNode  & { pt: Pt; lobe: string; color: string };

// ── Filter state ─────────────────────────────────────────────────────

interface BrainFilters {
  query: string;
  hiddenAgents: Set<string>;
  hiddenLobes: Set<string>;
  nodeSize: number;
  edgeOpacity: number;
  tilt: number;
  showNotes: boolean;
  showSemanticEdges: boolean;
}

const DEFAULT_FILTERS: BrainFilters = {
  query: '',
  hiddenAgents: new Set(),
  hiddenLobes: new Set(),
  nodeSize: 1,
  edgeOpacity: 0.4,
  tilt: 0,
  showNotes: true,
  showSemanticEdges: true,
};

// ── Component ────────────────────────────────────────────────────────

export function BrainGraph({ entries, notes = [], agentFilter, agentColors, blurOn }: Props) {
  const cerebrumRef  = useRef<SVGPathElement>(null);
  const wrapRef      = useRef<HTMLDivElement>(null);

  const [agentPools, setAgentPools] = useState<LobePools>({});
  const [notePools,  setNotePools]  = useState<LobePools>({});

  const [hovered,      setHovered]      = useState<number | null>(null);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [hoverLobe,    setHoverLobe]    = useState<string | null>(null);
  const [mousePos,     setMousePos]     = useState<{ x: number; y: number } | null>(null);
  const [selected,     setSelected]     = useState<PlacedEntry | null>(null);
  const [selectedNote, setSelectedNote] = useState<PlacedNote | null>(null);
  const [filters,      setFilters]      = useState<BrainFilters>(DEFAULT_FILTERS);
  const [animateNonce, setAnimateNonce] = useState(0);
  const [panelOpen,    setPanelOpen]    = useState(false);

  useEffect(() => {
    if (!cerebrumRef.current) return;
    // Agent pools: large, well-spaced
    setAgentPools(generateLobePools(cerebrumRef.current, 0xb14b, 140, 13));
    // Note pools: different seed → different positions within same lobe regions
    setNotePools(generateLobePools(cerebrumRef.current, 0xDEAD, 90, 10));
  }, []);

  useEffect(() => { if (selected || selectedNote) setPanelOpen(true); }, [selected, selectedNote]);

  // Place HiveMind entries
  const placed = useMemo<PlacedEntry[]>(() => {
    const lobeIndex: Record<string, number> = {};
    const out: PlacedEntry[] = [];
    for (const e of entries) {
      const lobe = lobeFor(e);
      const pool = agentPools[lobe.id];
      if (!pool || pool.length === 0) continue;
      const idx = lobeIndex[lobe.id] = (lobeIndex[lobe.id] ?? -1) + 1;
      out.push({ ...e, pt: pool[idx % pool.length], lobe: lobe.id });
    }
    return out;
  }, [entries, agentPools]);

  // Place Obsidian notes
  const placedNotes = useMemo<PlacedNote[]>(() => {
    if (!notes.length || !Object.keys(notePools).length) return [];
    const lobeIndex: Record<string, number> = {};
    const out: PlacedNote[] = [];
    for (const note of notes) {
      const lobeId = NOTE_LOBE[note.folder] || 'frontal';
      const pool = notePools[lobeId];
      if (!pool || pool.length === 0) continue;
      const idx = lobeIndex[lobeId] = (lobeIndex[lobeId] ?? -1) + 1;
      out.push({
        ...note,
        pt:    pool[idx % pool.length],
        lobe:  lobeId,
        color: NOTE_PALETTE[note.folder] || '#94a3b8',
      });
    }
    return out;
  }, [notes, notePools]);

  // Chat-session edges between agent entries
  const edges = useMemo(() => {
    const out: Array<{ a: number; b: number; agent: string }> = [];
    const byChat = new Map<string, number[]>();
    placed.forEach((e, i) => {
      const arr = byChat.get(e.chat_id);
      if (arr) arr.push(i); else byChat.set(e.chat_id, [i]);
    });
    for (const idxs of byChat.values()) {
      if (idxs.length < 2) continue;
      const sorted = idxs.slice().sort((a, b) => placed[a].created_at - placed[b].created_at);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        if (placed[b].created_at - placed[a].created_at <= 1800)
          out.push({ a, b, agent: placed[a].agent_id });
      }
    }
    return out;
  }, [placed]);

  // Semantic edges: note title words ↔ agent summary words
  const semanticEdges = useMemo(() => {
    if (!placedNotes.length || !placed.length) return [];
    const out: Array<{ ni: number; ei: number; score: number }> = [];
    for (let ni = 0; ni < placedNotes.length; ni++) {
      const note = placedNotes[ni];
      const noteWords = new Set(extractWords(note.title));
      if (noteWords.size === 0) continue;
      const matches: Array<{ idx: number; score: number }> = [];
      for (let ei = 0; ei < placed.length; ei++) {
        const e = placed[ei];
        const score = extractWords(e.summary + ' ' + e.action).filter(w => noteWords.has(w)).length;
        if (score > 0) matches.push({ idx: ei, score });
      }
      matches.sort((a, b) => b.score - a.score);
      for (const m of matches.slice(0, 5)) out.push({ ni, ei: m.idx, score: m.score });
    }
    return out;
  }, [placedNotes, placed]);

  function isVisible(e: PlacedEntry): boolean {
    if (filters.hiddenAgents.has(e.agent_id)) return false;
    if (filters.hiddenLobes.has(e.lobe)) return false;
    if (agentFilter !== 'all' && e.agent_id !== agentFilter) return false;
    if (filters.query) {
      const q = filters.query.toLowerCase();
      if (!e.summary.toLowerCase().includes(q) && !e.action.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  function handleMove(e: MouseEvent) {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const hoveredEntry   = hovered      !== null ? placed.find(e => e.id === hovered) ?? null : null;
  const hoveredNoteObj = hoveredNoteId !== null ? placedNotes.find(n => n.id === hoveredNoteId) ?? null : null;

  const visibleAgents = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.agent_id] = (counts[e.agent_id] || 0) + 1;
    return counts;
  }, [entries]);

  const visibleEntryCount = useMemo(() => placed.filter(isVisible).length, [placed, filters, agentFilter]);

  function update<K extends keyof BrainFilters>(key: K, value: BrainFilters[K]) {
    setFilters(f => ({ ...f, [key]: value }));
  }
  function toggleHidden(set: 'hiddenAgents' | 'hiddenLobes', id: string) {
    setFilters(f => {
      const next = new Set(f[set]);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...f, [set]: next };
    });
  }

  // Semantic connections for the selected note
  const noteConnections = useMemo(() => {
    if (!selectedNote) return [];
    return semanticEdges
      .filter(e => placedNotes[e.ni]?.id === selectedNote.id)
      .map(e => placed[e.ei])
      .filter(Boolean) as PlacedEntry[];
  }, [selectedNote, semanticEdges, placedNotes, placed]);

  return (
    <div class="flex-1 flex min-h-0 relative">
      <div
        ref={wrapRef}
        class="brain-stage flex-1 relative overflow-hidden"
        style={{
          background:
            'radial-gradient(ellipse 80% 70% at 50% 45%, color-mix(in srgb, var(--color-accent) 9%, transparent), transparent 75%), radial-gradient(ellipse 40% 30% at 30% 70%, color-mix(in srgb, #5eb6ff 4%, transparent), transparent 70%), var(--color-bg)',
        }}
        onMouseMove={handleMove}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          class="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
          style={{ transform: `rotateY(${filters.tilt}deg)` }}
        >
          <defs>
            <radialGradient id="brainFill" cx="50%" cy="42%" r="60%">
              <stop offset="0%"   stop-color="color-mix(in srgb, var(--color-accent) 32%, transparent)" />
              <stop offset="55%"  stop-color="color-mix(in srgb, var(--color-accent) 10%, transparent)" />
              <stop offset="100%" stop-color="transparent" />
            </radialGradient>
            <radialGradient id="brainHalo" cx="50%" cy="48%" r="70%">
              <stop offset="0%"   stop-color="var(--color-accent)" stop-opacity="0.16" />
              <stop offset="100%" stop-color="transparent" />
            </radialGradient>
            <filter id="dotGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3.2" />
            </filter>
            <filter id="noteGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="2.6" />
            </filter>
            <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.4" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {LOBES.map(l => (
              <radialGradient key={l.id} id={`lobeGlow-${l.id}`} cx="50%" cy="50%" r="55%">
                <stop offset="0%"   stop-color={l.color} stop-opacity="0.24" />
                <stop offset="100%" stop-color={l.color} stop-opacity="0" />
              </radialGradient>
            ))}
            <clipPath id="brainClip">
              <path d={CEREBRUM_PATH} />
            </clipPath>
          </defs>

          {/* Backlit halo */}
          <ellipse cx={VIEW_W / 2} cy={250} rx={340} ry={230} fill="url(#brainHalo)" />

          {/* Lobe glows on hover */}
          <g clip-path="url(#brainClip)">
            {LOBES.map(l => (
              <ellipse
                key={l.id}
                cx={l.rect[0] + l.rect[2] / 2}
                cy={l.rect[1] + l.rect[3] / 2}
                rx={l.rect[2] * 0.7}
                ry={l.rect[3] * 0.95}
                fill={`url(#lobeGlow-${l.id})`}
                opacity={hoverLobe === l.id ? 1 : 0}
                style={{ transition: 'opacity 220ms ease-out' }}
              />
            ))}
          </g>

          {/* Brain silhouette fill */}
          <path ref={cerebrumRef} d={CEREBRUM_PATH} fill="url(#brainFill)" />

          {/* Sulci */}
          <g clip-path="url(#brainClip)" opacity="0.55">
            {[...SULCI_LEFT, ...SULCI_RIGHT].map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="color-mix(in srgb, var(--color-accent) 42%, var(--color-text-faint))"
                stroke-width="0.9"
                stroke-linecap="round"
              />
            ))}
          </g>

          {/* Longitudinal fissure */}
          <path
            d={FISSURE_PATH}
            fill="none"
            stroke="color-mix(in srgb, var(--color-accent) 50%, var(--color-text-faint))"
            stroke-width="1.1"
            stroke-linecap="round"
            opacity="0.7"
          />

          {/* Brain outline */}
          <path
            d={CEREBRUM_PATH}
            fill="none"
            stroke="color-mix(in srgb, var(--color-accent) 70%, var(--color-text))"
            stroke-width="1.2"
            opacity="0.85"
            class="brain-outline-anim"
          />

          {/* Lobe labels */}
          {LOBES.map(l => {
            const hidden = filters.hiddenLobes.has(l.id);
            return (
              <text
                key={l.id}
                x={l.labelAt[0]}
                y={l.labelAt[1]}
                text-anchor="middle"
                class={'brain-lobe-label ' + (hoverLobe === l.id ? 'is-active' : (hidden ? 'is-dim' : ''))}
                style={{ cursor: 'pointer', pointerEvents: 'auto', fill: hoverLobe === l.id ? l.color : undefined }}
                onMouseEnter={() => setHoverLobe(l.id)}
                onMouseLeave={() => setHoverLobe(h => h === l.id ? null : h)}
                onClick={() => toggleHidden('hiddenLobes', l.id)}
              >
                {l.label}
              </text>
            );
          })}

          {/* Semantic edges (note ↔ agent) — rendered first, below everything */}
          {filters.showNotes && filters.showSemanticEdges && (
            <g>
              {semanticEdges.map((edge, i) => {
                const note  = placedNotes[edge.ni];
                const entry = placed[edge.ei];
                if (!note || !entry) return null;
                if (!isVisible(entry)) return null;
                if (filters.hiddenLobes.has(note.lobe)) return null;

                const isHighlighted =
                  hoveredNoteId === note.id ||
                  hovered === entry.id ||
                  selectedNote?.id === note.id ||
                  selected?.id === entry.id;

                // Bow outward from center (opposite of agent-agent edges)
                const mx = (note.pt.x + entry.pt.x) / 2;
                const my = (note.pt.y + entry.pt.y) / 2;
                const dx = mx - VIEW_W / 2;
                const dy = my - VIEW_H / 2;
                const cpx = mx + dx * 0.38;
                const cpy = my + dy * 0.38;

                return (
                  <path
                    key={i}
                    d={`M ${note.pt.x},${note.pt.y} Q ${cpx},${cpy} ${entry.pt.x},${entry.pt.y}`}
                    fill="none"
                    stroke={note.color}
                    stroke-width={isHighlighted ? 0.9 : 0.5}
                    opacity={isHighlighted ? 0.72 : 0.09}
                    style={{ transition: 'opacity 200ms, stroke-width 200ms' }}
                  />
                );
              })}
            </g>
          )}

          {/* Agent chat-session edges */}
          <g style={{ opacity: filters.edgeOpacity }}>
            {edges.map((edge, i) => {
              const a = placed[edge.a], b = placed[edge.b];
              if (!a || !b) return null;
              const visible = isVisible(a) && isVisible(b);
              const color = agentColors[edge.agent] || 'var(--color-text-muted)';
              const mx = (a.pt.x + b.pt.x) / 2;
              const my = (a.pt.y + b.pt.y) / 2;
              const cx = mx + (VIEW_W / 2 - mx) * 0.18;
              const cy = my + (250 - my) * 0.18;
              return (
                <path
                  key={i}
                  d={`M ${a.pt.x},${a.pt.y} Q ${cx},${cy} ${b.pt.x},${b.pt.y}`}
                  fill="none"
                  stroke={color}
                  stroke-width={visible ? 0.85 : 0.4}
                  opacity={visible ? 1 : 0.18}
                  filter="url(#softGlow)"
                />
              );
            })}
          </g>

          {/* Obsidian note nodes — diamonds */}
          {filters.showNotes && (
            <g>
              {placedNotes.map(note => {
                const isHovered  = hoveredNoteId === note.id;
                const isSelected = selectedNote?.id === note.id;
                const visible    = !filters.hiddenLobes.has(note.lobe);
                const r  = (isHovered || isSelected ? 6.0 : 3.8) * filters.nodeSize;
                const { x, y } = note.pt;
                const color = note.color;
                const pts  = (size: number) =>
                  `${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`;
                // specular top-left facet
                const spPts = `${x},${y - r * 0.55} ${x + r * 0.3},${y - r * 0.25} ${x},${y} ${x - r * 0.3},${y - r * 0.25}`;

                return (
                  <g
                    key={note.id}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredNoteId(note.id)}
                    onMouseLeave={() => setHoveredNoteId(h => h === note.id ? null : h)}
                    onClick={() => {
                      setSelected(null);
                      setSelectedNote(isSelected ? null : note);
                    }}
                  >
                    {/* Glow halo */}
                    <polygon
                      points={pts(r * 3.2)}
                      fill={color}
                      opacity={visible ? (isHovered ? 0.38 : 0.15) : 0.03}
                      filter="url(#noteGlow)"
                      style={{ pointerEvents: 'none', transition: 'opacity 200ms' }}
                    />
                    {/* Diamond body */}
                    <polygon
                      points={pts(r)}
                      fill={color}
                      opacity={visible ? 0.92 : 0.15}
                      stroke={isHovered || isSelected ? 'white' : 'none'}
                      stroke-width={isHovered || isSelected ? 0.85 : 0}
                      style={{ transition: 'opacity 200ms' }}
                    />
                    {/* Specular facet */}
                    <polygon
                      points={spPts}
                      fill="white"
                      opacity={visible ? (isHovered ? 0.82 : 0.42) : 0.08}
                      style={{ pointerEvents: 'none', transition: 'opacity 200ms' }}
                    />
                  </g>
                );
              })}
            </g>
          )}

          {/* Agent dots — on top */}
          <g key={animateNonce}>
            {placed.map((entry, i) => {
              const visible    = isVisible(entry);
              const isHovered  = hovered === entry.id;
              const isSelected = selected?.id === entry.id;
              const color = agentColors[entry.agent_id] || 'var(--color-text-muted)';
              const r = (isHovered || isSelected ? 5.4 : 3.5) * filters.nodeSize;
              return (
                <g
                  key={entry.id}
                  class="brain-dot-bloom"
                  style={{ animationDelay: `${Math.min(i * 16, 2200)}ms` }}
                  onMouseEnter={() => setHovered(entry.id)}
                  onMouseLeave={() => setHovered(h => h === entry.id ? null : h)}
                  onClick={() => {
                    setSelectedNote(null);
                    setSelected(entry);
                  }}
                >
                  <circle
                    cx={entry.pt.x}
                    cy={entry.pt.y}
                    r={r * 3.2}
                    fill={color}
                    opacity={visible ? (isHovered ? 0.4 : 0.18) : 0.04}
                    filter="url(#dotGlow)"
                    style={{ transition: 'opacity 200ms', pointerEvents: 'none' }}
                  />
                  <circle
                    cx={entry.pt.x}
                    cy={entry.pt.y}
                    r={r}
                    fill={color}
                    opacity={visible ? 0.95 : 0.18}
                    stroke={isHovered || isSelected ? 'white' : 'none'}
                    stroke-width={isHovered || isSelected ? 0.9 : 0}
                    style={{ cursor: 'pointer', transition: 'r 180ms, opacity 200ms' }}
                  />
                  <circle
                    cx={entry.pt.x - r * 0.3}
                    cy={entry.pt.y - r * 0.3}
                    r={r * 0.36}
                    fill="white"
                    opacity={visible ? (isHovered ? 0.9 : 0.55) : 0.1}
                    style={{ pointerEvents: 'none', transition: 'opacity 200ms' }}
                  />
                </g>
              );
            })}
          </g>
        </svg>

        {/* Agent entry tooltip */}
        {hoveredEntry && mousePos && !selected && !selectedNote && (
          <div
            class="absolute pointer-events-none bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-xl px-3 py-2 text-[11.5px] text-[var(--color-text)] max-w-[320px] z-10"
            style={{
              left: Math.min(mousePos.x + 14, (wrapRef.current?.clientWidth || 800) - 340),
              top:  Math.min(mousePos.y + 14, (wrapRef.current?.clientHeight || 500) - 110),
              backdropFilter: 'blur(8px)',
            }}
          >
            <div class="flex items-center gap-2 mb-1">
              <span
                class="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: agentColors[hoveredEntry.agent_id] || 'var(--color-text-muted)' }}
              />
              <span class="font-mono text-[10.5px] text-[var(--color-text-muted)]">
                @{hoveredEntry.agent_id} · {hoveredEntry.action}
              </span>
              <span class="text-[10px] text-[var(--color-text-faint)] ml-auto tabular-nums">
                {formatRelativeTime(hoveredEntry.created_at)}
              </span>
            </div>
            <div class={'leading-snug ' + (blurOn ? 'privacy-blur revealed' : '')}>
              {hoveredEntry.summary}
            </div>
          </div>
        )}

        {/* Note tooltip */}
        {hoveredNoteObj && !hoveredEntry && mousePos && !selected && !selectedNote && (
          <div
            class="absolute pointer-events-none bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-xl px-3 py-2 text-[11.5px] text-[var(--color-text)] max-w-[280px] z-10"
            style={{
              left: Math.min(mousePos.x + 14, (wrapRef.current?.clientWidth || 800) - 300),
              top:  Math.min(mousePos.y + 14, (wrapRef.current?.clientHeight || 500) - 90),
              backdropFilter: 'blur(8px)',
            }}
          >
            <div class="flex items-center gap-2 mb-1">
              <span
                class="inline-block w-2.5 h-2.5 shrink-0"
                style={{
                  backgroundColor: hoveredNoteObj.color,
                  clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                }}
              />
              <span class="text-[10.5px] text-[var(--color-text-muted)]">
                {hoveredNoteObj.folder} · {hoveredNoteObj.linkCount} links
              </span>
            </div>
            <div class="font-medium text-[var(--color-text)] leading-snug">{hoveredNoteObj.title}</div>
          </div>
        )}

        {/* Legend */}
        <div class="absolute bottom-4 left-4 flex items-center gap-4 text-[10.5px] text-[var(--color-text-faint)] pointer-events-none select-none">
          <span class="flex items-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-accent)', opacity: 0.8 }} />
            Activity
          </span>
          {placedNotes.length > 0 && filters.showNotes && (
            <span class="flex items-center gap-1.5">
              <span
                class="inline-block w-2.5 h-2.5"
                style={{
                  backgroundColor: '#fb7185',
                  clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                  opacity: 0.9,
                }}
              />
              Knowledge
            </span>
          )}
          {filters.showNotes && filters.showSemanticEdges && semanticEdges.length > 0 && (
            <span class="flex items-center gap-1.5">
              <span class="inline-block w-5 h-px" style={{ backgroundColor: '#fb7185', opacity: 0.6 }} />
              Connections
            </span>
          )}
        </div>

        {/* Floating filter button */}
        {!panelOpen && (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            class="absolute top-4 right-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-card)]/90 backdrop-blur border border-[var(--color-border)] hover:border-[var(--color-accent)] text-[11.5px] text-[var(--color-text)] shadow-lg transition-colors"
            style={{ backdropFilter: 'blur(8px)' }}
          >
            <SlidersHorizontal size={12} />
            Filters
            <span class="text-[10.5px] text-[var(--color-text-faint)] tabular-nums">
              {visibleEntryCount}
            </span>
          </button>
        )}
      </div>

      {/* Right-side panel */}
      <aside
        class={[
          'absolute top-0 right-0 bottom-0 w-[320px] bg-[var(--color-card)] border-l border-[var(--color-border)] flex flex-col min-h-0 shadow-2xl z-20',
          'transition-transform duration-300 ease-out',
          panelOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        style={{ backdropFilter: 'blur(8px)' }}
      >
        {selectedNote ? (
          <NoteDetailPanel
            note={selectedNote}
            connections={noteConnections}
            agentColors={agentColors}
            onClose={() => { setSelectedNote(null); setPanelOpen(false); }}
          />
        ) : selected ? (
          <DetailPanel
            entry={selected}
            color={agentColors[selected.agent_id] || 'var(--color-text-muted)'}
            blurOn={blurOn}
            lobeLabel={LOBE_BY_ID[AGENT_LOBE[selected.agent_id] || 'frontal']?.label}
            onClose={() => { setSelected(null); setPanelOpen(false); }}
          />
        ) : (
          <FilterPanel
            filters={filters}
            update={update}
            toggleHidden={toggleHidden}
            visibleAgents={visibleAgents}
            agentColors={agentColors}
            noteCount={placedNotes.length}
            semanticEdgeCount={semanticEdges.length}
            onAnimate={() => setAnimateNonce(n => n + 1)}
            onReset={() => setFilters(DEFAULT_FILTERS)}
            totalEntries={entries.length}
            visibleEntries={visibleEntryCount}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </aside>
    </div>
  );
}

// ── Note detail panel ─────────────────────────────────────────────────

function NoteDetailPanel({ note, connections, agentColors, onClose }: {
  note: PlacedNote;
  connections: PlacedEntry[];
  agentColors: Record<string, string>;
  onClose: () => void;
}) {
  return (
    <>
      <header class="flex items-center px-4 py-3 border-b border-[var(--color-border)] gap-2">
        <span
          class="inline-block w-3 h-3 shrink-0"
          style={{
            backgroundColor: note.color,
            clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
          }}
        />
        <span class="text-[12.5px] font-semibold text-[var(--color-text)] truncate flex-1">
          {note.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          class="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <X size={13} />
        </button>
      </header>
      <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <Field label="Folder">
          <span class="text-[12px] font-medium" style={{ color: note.color }}>{note.folder}</span>
        </Field>
        <Field label="Region">
          <span class="text-[12px] text-[var(--color-text)]">
            {LOBE_BY_ID[note.lobe]?.label ?? note.lobe} lobe
          </span>
        </Field>
        <Field label="Vault connections">
          <span class="text-[12px] text-[var(--color-text)]">{note.linkCount} linked notes</span>
        </Field>
        {connections.length > 0 && (
          <Field label={`Agent activity (${connections.length})`}>
            <div class="space-y-2 mt-1">
              {connections.map(e => (
                <div
                  key={e.id}
                  class="text-[11.5px] border border-[var(--color-border)] rounded-lg p-2 bg-[var(--color-elevated)]"
                >
                  <div class="flex items-center gap-1.5 mb-1">
                    <span
                      class="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: agentColors[e.agent_id] || 'var(--color-text-muted)' }}
                    />
                    <span class="font-mono text-[10.5px] text-[var(--color-text-muted)]">@{e.agent_id}</span>
                    <span class="font-mono text-[10.5px] text-[var(--color-text-faint)] ml-1">{e.action}</span>
                    <span class="text-[10px] text-[var(--color-text-faint)] ml-auto tabular-nums">
                      {formatRelativeTime(e.created_at)}
                    </span>
                  </div>
                  <div class="text-[11px] text-[var(--color-text-muted)] line-clamp-3 leading-relaxed">
                    {e.summary}
                  </div>
                </div>
              ))}
            </div>
          </Field>
        )}
        {connections.length === 0 && (
          <div class="text-[11px] text-[var(--color-text-faint)] italic">
            No agent activity matched this note's title keywords.
          </div>
        )}
      </div>
    </>
  );
}

// ── Agent detail panel ────────────────────────────────────────────────

function DetailPanel({ entry, color, blurOn, lobeLabel, onClose }: {
  entry: HiveEntry;
  color: string;
  blurOn: boolean;
  lobeLabel?: string;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <>
      <header class="flex items-center px-4 py-3 border-b border-[var(--color-border)] gap-2">
        <span class="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span class="font-mono text-[12px] text-[var(--color-text)]">@{entry.agent_id}</span>
        {lobeLabel && (
          <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] ml-1">{lobeLabel}</span>
        )}
        <span class="text-[10.5px] text-[var(--color-text-faint)] ml-auto tabular-nums">
          {formatRelativeTime(entry.created_at)}
        </span>
        <button
          type="button"
          onClick={onClose}
          class="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <X size={13} />
        </button>
      </header>
      <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <Field label="Action">
          <span class="font-mono text-[11.5px] text-[var(--color-text)]">{entry.action}</span>
        </Field>
        <Field label="Summary">
          <div
            class={'text-[12.5px] text-[var(--color-text)] leading-relaxed ' +
              (blurOn && !revealed ? 'privacy-blur' : (blurOn && revealed ? 'privacy-blur revealed' : ''))}
            onClick={() => blurOn && setRevealed(v => !v)}
          >
            {entry.summary}
          </div>
        </Field>
        {entry.artifacts && (
          <Field label="Artifacts">
            <div class="font-mono text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap break-words">
              {entry.artifacts}
            </div>
          </Field>
        )}
        <Field label="Chat">
          <div class="font-mono text-[11px] text-[var(--color-text-muted)] truncate">{entry.chat_id}</div>
        </Field>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">{label}</div>
      {children}
    </div>
  );
}

// ── Filter panel ──────────────────────────────────────────────────────

function FilterPanel({
  filters, update, toggleHidden, visibleAgents, agentColors,
  noteCount, semanticEdgeCount,
  onAnimate, onReset, totalEntries, visibleEntries, onClose,
}: {
  filters: BrainFilters;
  update: <K extends keyof BrainFilters>(key: K, value: BrainFilters[K]) => void;
  toggleHidden: (set: 'hiddenAgents' | 'hiddenLobes', id: string) => void;
  visibleAgents: Record<string, number>;
  agentColors: Record<string, string>;
  noteCount: number;
  semanticEdgeCount: number;
  onAnimate: () => void;
  onReset: () => void;
  totalEntries: number;
  visibleEntries: number;
  onClose: () => void;
}) {
  const [openSection, setOpenSection] = useState({ agents: true, lobes: false, knowledge: noteCount > 0, display: false });
  return (
    <>
      <header class="flex items-center px-4 py-3 border-b border-[var(--color-border)] gap-2">
        <Sparkles size={13} class="text-[var(--color-accent)]" />
        <span class="text-[12.5px] font-semibold text-[var(--color-text)]">Filters</span>
        <span class="text-[10.5px] text-[var(--color-text-faint)] ml-auto tabular-nums">
          {visibleEntries} / {totalEntries}
        </span>
        <button
          type="button"
          onClick={onReset}
          class="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          title="Reset all filters"
        >
          <RotateCw size={11} />
        </button>
        <button
          type="button"
          onClick={onClose}
          class="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          title="Close panel"
        >
          <X size={13} />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <div class="relative">
            <Search size={12} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
            <input
              value={filters.query}
              onInput={e => update('query', (e.target as HTMLInputElement).value)}
              placeholder="Search summaries…"
              class="w-full pl-7 pr-2.5 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none text-[12px] text-[var(--color-text)]"
            />
          </div>
        </div>

        <Section
          label="Agents"
          open={openSection.agents}
          onToggle={() => setOpenSection(s => ({ ...s, agents: !s.agents }))}
        >
          <div class="space-y-1">
            {Object.entries(visibleAgents).sort((a, b) => b[1] - a[1]).map(([id, count]) => {
              const on    = !filters.hiddenAgents.has(id);
              const color = agentColors[id] || 'var(--color-text-muted)';
              const lobe  = LOBE_BY_ID[AGENT_LOBE[id] || 'frontal'];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleHidden('hiddenAgents', id)}
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-elevated)] transition-colors text-left"
                >
                  <span
                    class="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color, boxShadow: on ? `0 0 6px ${color}` : 'none' }}
                  />
                  <span class={'font-mono text-[11.5px] ' + (on ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)]')}>
                    @{id}
                  </span>
                  {lobe && (
                    <span class="text-[10px]" style={{ color: on ? lobe.color : 'var(--color-text-faint)', opacity: on ? 0.75 : 0.4 }}>
                      {lobe.label.toLowerCase()}
                    </span>
                  )}
                  <span class="ml-auto text-[10.5px] tabular-nums text-[var(--color-text-faint)]">{count}</span>
                  <span class={'brain-switch ' + (on ? 'is-on' : '')} />
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          label="Regions"
          open={openSection.lobes}
          onToggle={() => setOpenSection(s => ({ ...s, lobes: !s.lobes }))}
        >
          <div class="space-y-1">
            {LOBES.map(l => {
              const on = !filters.hiddenLobes.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleHidden('hiddenLobes', l.id)}
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-elevated)] transition-colors text-left"
                >
                  <span
                    class="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: l.color, opacity: on ? 1 : 0.3, boxShadow: on ? `0 0 6px ${l.color}` : 'none' }}
                  />
                  <span class={'text-[12px] ' + (on ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)]')}>
                    {l.label}
                  </span>
                  <span class={'brain-switch ml-auto ' + (on ? 'is-on' : '')} />
                </button>
              );
            })}
          </div>
        </Section>

        {noteCount > 0 && (
          <Section
            label="Knowledge"
            open={openSection.knowledge}
            onToggle={() => setOpenSection(s => ({ ...s, knowledge: !s.knowledge }))}
          >
            <div class="space-y-2">
              <button
                type="button"
                onClick={() => update('showNotes', !filters.showNotes)}
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-elevated)] transition-colors text-left"
              >
                <span
                  class="inline-block w-2.5 h-2.5 shrink-0"
                  style={{
                    backgroundColor: '#fb7185',
                    clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                    opacity: filters.showNotes ? 1 : 0.3,
                  }}
                />
                <span class={'text-[12px] ' + (filters.showNotes ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)]')}>
                  Notes
                </span>
                <span class="text-[10.5px] text-[var(--color-text-faint)] tabular-nums">{noteCount}</span>
                <span class={'brain-switch ml-auto ' + (filters.showNotes ? 'is-on' : '')} />
              </button>
              <button
                type="button"
                onClick={() => update('showSemanticEdges', !filters.showSemanticEdges)}
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-elevated)] transition-colors text-left"
                disabled={!filters.showNotes}
              >
                <span
                  class="inline-block w-5 h-px"
                  style={{ backgroundColor: '#fb7185', opacity: filters.showNotes && filters.showSemanticEdges ? 0.8 : 0.2 }}
                />
                <span class={'text-[12px] ' + (filters.showNotes && filters.showSemanticEdges ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)]')}>
                  Connections
                </span>
                <span class="text-[10.5px] text-[var(--color-text-faint)] tabular-nums">{semanticEdgeCount}</span>
                <span class={'brain-switch ml-auto ' + (filters.showNotes && filters.showSemanticEdges ? 'is-on' : '')} />
              </button>
            </div>
          </Section>
        )}

        <Section
          label="Display"
          open={openSection.display}
          onToggle={() => setOpenSection(s => ({ ...s, display: !s.display }))}
        >
          <div class="space-y-3">
            <SliderRow
              label="Node size"
              value={filters.nodeSize}
              min={0.5} max={2} step={0.05}
              onInput={v => update('nodeSize', v)}
            />
            <SliderRow
              label="Edge opacity"
              value={filters.edgeOpacity}
              min={0} max={1} step={0.05}
              onInput={v => update('edgeOpacity', v)}
            />
            <SliderRow
              label="Tilt"
              value={filters.tilt}
              min={-25} max={25} step={1}
              onInput={v => update('tilt', v)}
              fmt={v => `${v}°`}
            />
            <button
              type="button"
              onClick={onAnimate}
              class="w-full py-1.5 mt-1 rounded bg-[var(--color-elevated)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text)] hover:text-[var(--color-accent)] text-[11.5px] transition-colors flex items-center justify-center gap-1.5"
            >
              <Sparkles size={11} /> Animate
            </button>
          </div>
        </Section>
      </div>
    </>
  );
}

function Section({ label, open, onToggle, children }: {
  label: string; open: boolean; onToggle: () => void; children: any;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        class="w-full flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] mb-1.5"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {label}
      </button>
      {open && children}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onInput, fmt }: {
  label: string; value: number; min: number; max: number; step: number;
  onInput: (v: number) => void; fmt?: (v: number) => string;
}) {
  return (
    <div>
      <div class="flex items-center justify-between mb-1">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <span class="text-[10.5px] text-[var(--color-text-faint)] tabular-nums">
          {fmt ? fmt(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        class="brain-slider"
        min={min} max={max} step={step}
        value={value}
        onInput={e => onInput(parseFloat((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}
