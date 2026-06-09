import { useEffect, useMemo, useState } from 'preact/hooks';
import { RefreshCw, ArrowRight, AlertTriangle, AlertCircle, Info, Crown, Wallet, TrendingUp, Send, Store, LineChart, Newspaper, Plus, X, Sparkles, Library, RotateCcw, Receipt } from 'lucide-preact';
import { Link } from 'wouter-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiDelete } from '@/lib/api';
import { pushToast } from '@/lib/toasts';
import { StockChart } from '@/components/StockChart';
import { NikkiCard } from '@/components/NikkiCard';
import { JournalCard } from '@/components/JournalCard';
import { CalendarTile } from '@/components/CalendarTile';
import { VendastaTile } from '@/components/VendastaTile';
import { LatestBriefCard } from '@/components/LatestBriefCard';
import { InboxCard } from '@/components/InboxCard';
import { SortableSection } from '@/components/SortableSection';

// Default order of the Founder Dashboard sections. The user can drag-reorder
// them; the chosen order is persisted in localStorage under SECTION_ORDER_KEY.
// To add a new section: add an id here, then add a matching entry to the
// `sections` object inside the component.
const DEFAULT_SECTION_ORDER = [
  'brief',
  'nikki',
  'journal',
  'attention',
  'real-mrr',
  'cash-pulse',
  'investments',
  'cash-pipeline',
  'outreach-members',
  'stocks-news',
  'cal-vendasta',
  'inbox',
  'brain-proposals',
  'watchlist',
] as const;
// v5 adds the `journal` Five-Minute Journal tile.
const SECTION_ORDER_KEY = 'founder-section-order-v5';

function loadSectionOrder(): string[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SECTION_ORDER_KEY) : null;
    if (!raw) return [...DEFAULT_SECTION_ORDER];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some(x => typeof x !== 'string')) return [...DEFAULT_SECTION_ORDER];
    // Append any sections the user hasn't seen yet (handles forward-compat
    // when we add a new section to DEFAULT_SECTION_ORDER).
    const known = new Set(parsed);
    const merged = [...parsed];
    for (const id of DEFAULT_SECTION_ORDER) if (!known.has(id)) merged.push(id);
    // Drop any ids no longer recognized (handles removed sections).
    const valid = new Set(DEFAULT_SECTION_ORDER as readonly string[]);
    return merged.filter(id => valid.has(id));
  } catch { return [...DEFAULT_SECTION_ORDER]; }
}

function saveSectionOrder(order: string[]): void {
  try { localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(order)); } catch { /* private mode etc */ }
}

interface BrainProposal { topic: string; hitCount: number; importance: number; examples: string[]; suggestedNoteName: string; }

interface Section<T> { ok: boolean; error: string | null; data: T | null; }
interface AttentionItem { severity: 'critical' | 'warn' | 'info'; source: 'cash' | 'pipeline' | 'outreach' | 'members'; title: string; detail: string; href: string; }

// QB summary (mirror of src/qb-data.ts QbSummary shape — only the fields the Founder page consumes)
interface QbPeriod { revenueCents: number; cogsCents: number; opexCents: number; netCents: number; }
interface QbSummary {
  configured: boolean;
  connectionStatus: 'ok' | 'not-connected' | 'no-credentials' | 'error';
  company: { name: string | null; realmId: string | null };
  mtd: QbPeriod;
  last30: QbPeriod;
  runwayDays: number | null;
}

// Stocks
interface StockQuote {
  symbol: string;
  shortName: string | null;
  price: number | null;
  changeAbs: number | null;
  changePct: number | null;
  currency: string | null;
  marketState: string | null;
  error?: string;
}
interface StocksSummary { asOf: number; tickers: string[]; quotes: StockQuote[]; }

// AI news
interface NewsItem { title: string; link: string; source: string | null; pubDate: number | null; description: string | null; iconUrl?: string | null; sourceDomain?: string | null; }
interface NewsSummary { asOf: number; query: string; items: NewsItem[]; error?: string | null; }

interface InvestmentAccount { item_id: string; institution_name: string | null; account_id: string; name: string; type: string | null; subtype: string | null; mask: string | null; currentValue: number; dayChange: number; }
interface TopHolding { ticker: string | null; name: string; type: string | null; quantity: number; pricePerShare: number; currentValue: number; costBasis: number | null; dayChange: number; weight: number; }
interface InvestmentsSummary { asOf: number; configured: boolean; error?: string; totalValue: number; totalDayChange: number; totalDayChangePct: number; accountCount: number; perAccount: InvestmentAccount[]; topHoldings: TopHolding[]; institutionErrors: Array<{ institution_name: string | null; error: string }>; }

interface FounderData {
  generatedAt: number;
  cash: Section<{ totalCashCents: number; mtdRevenueCents: number; mtdNetCents: number; runwayDays: number | null; last30NetCents: number; connectionStatus: string }>;
  pipeline: Section<{ openDealsCount: number; openDealsValueCents: number; openDealsWeightedCents: number; customersCount: number; customersMRRCents: number | null; customersWholesaleMonthlyCents: number | null }>;
  outreach: Section<{ totalBids: number; membersBehindThem: number; notContacted: number; emailed: number; replied: number; webinarBooked: number; endorsed: number; declined: number; needsFollowupCount: number; topPriority: Array<{ entity: string; city: string | null; email: string; status: string; daysSinceLastTouch: number | null; nextAction: string }> }>;
  members: Section<{ bidsEndorsed: number; activeMembers: number; totalMRRCents: number; pipelineCeilingCents: number }>;
  primaryAttention: AttentionItem | null;
  attentionList: AttentionItem[];
}

const TONE: Record<string, string> = { good: '#16a34a', warn: '#ca8a04', bad: '#dc2626', faint: 'var(--color-text-faint)' };
const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
const moneySigned = (c: number) => (c >= 0 ? '+' : '') + '$' + Math.abs(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });

const SEV_TONE: Record<AttentionItem['severity'], string> = { critical: 'bad', warn: 'warn', info: 'faint' };
const SEV_ICON: Record<AttentionItem['severity'], any> = { critical: AlertCircle, warn: AlertTriangle, info: Info };

function Tile({ icon: Icon, title, children, href }: { icon: any; title: string; href: string; children: any }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Icon size={14} class="text-[var(--color-text-faint)]" />
          <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">{title}</div>
        </div>
        <Link href={href} class="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
          open <ArrowRight size={10} />
        </Link>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: any; tone?: string; sub?: string }) {
  return (
    <div>
      <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</div>
      <div class="text-[16px] font-bold tabular-nums" style={tone ? { color: TONE[tone] } : undefined}>{value}</div>
      {sub && <div class="text-[10px] text-[var(--color-text-faint)]">{sub}</div>}
    </div>
  );
}

// ── Cash Pulse card ────────────────────────────────────────────────────────
// Compact 3-stat health view: balance (Plaid), burn/mo (QB or Plaid est.),
// runway in months. Designed to be scanned in 2 seconds.
interface CashPulseProps {
  cash: { totalCashCents: number; last30NetCents: number; connectionStatus: string } | null;
  qb: QbSummary | null;
}
function CashPulseTile({ cash, qb }: CashPulseProps) {
  const plaidOk = cash?.connectionStatus === 'ok';
  const qbOk   = qb?.connectionStatus  === 'ok';

  // Monthly burn (positive = spending more than earning).
  // Prefer QB 30-day net; fall back to Plaid heuristic when QB not wired.
  const burnMoCents: number | null = qbOk
    ? -qb!.last30.netCents
    : plaidOk
    ? -cash!.last30NetCents
    : null;

  const isBurning    = burnMoCents != null && burnMoCents > 0;
  const balanceCents = cash?.totalCashCents ?? 0;

  // Runway in months (null = cash-flow positive, show "Cash+")
  const runwayMonths: number | null =
    isBurning && balanceCents > 0
      ? balanceCents / burnMoCents!
      : null;

  const runwayTone =
    runwayMonths == null ? 'good'
    : runwayMonths >= 6  ? 'good'
    : runwayMonths >= 3  ? 'warn'
    : 'bad';

  const burnTone =
    !isBurning            ? 'good'
    : burnMoCents! > 500000 ? 'bad'   // > $5k/mo
    : 'warn';

  return (
    <Tile icon={Wallet} title="Cash Pulse" href="/cash">
      {!plaidOk ? (
        /* Bank not connected yet */
        <div class="text-[12px] text-[var(--color-text-muted)]">
          No bank connected.{' '}
          <Link href="/cash"><a class="underline">Set up Cash →</a></Link>
        </div>
      ) : (
        <>
          <div class="grid grid-cols-3 gap-4">
            <Stat
              label="Balance"
              value={money(balanceCents)}
              tone="good"
              sub="bank"
            />
            <Stat
              label="Burn / mo"
              value={isBurning ? money(burnMoCents!) : '—'}
              tone={isBurning ? burnTone : 'good'}
              sub={qbOk ? 'QB 30d' : 'Plaid est.'}
            />
            <Stat
              label="Runway"
              value={runwayMonths == null ? 'Cash+' : runwayMonths.toFixed(1) + ' mo'}
              tone={runwayTone}
            />
          </div>
          {!qbOk && (
            <div class="mt-2.5 text-[10.5px] text-[var(--color-text-faint)]">
              Using Plaid estimates ·{' '}
              <Link href="/settings">
                <a class="underline hover:text-[var(--color-text-muted)]">Connect QuickBooks for accounting-grade numbers</a>
              </Link>
            </div>
          )}
        </>
      )}
    </Tile>
  );
}

// ── Real MRR tile ─────────────────────────────────────────────────────────
// Vendasta customer-only retail MRR vs wholesale Vendasta cost. Strips
// out Dante's own internal accounts (Pest WebPros = ImpactWorks, RocketLocal)
// and filters to fulfilled + recurring line items only. Big top-line:
// customer MRR + margin. Below: top 5 paying customers with margin each.

interface RealMrrSnapshot {
  asOf: number;
  customerRetailMRR: number;
  internalRetailMRR: number;
  rawRetailMRR: number;
  wholesaleMonthly: number;
  grossMargin: number;
  marginPct: number;
  customerCount: number;
  topCustomers: Array<{ agid: string; name: string | null; retailMRR: number; wholesaleMonthly: number; margin: number }>;
}

function RealMrrTile({ snap }: { snap: RealMrrSnapshot | null }) {
  if (!snap) {
    return (
      <Tile icon={Receipt} title="Real MRR · Vendasta" href="/cash">
        <div class="text-[12px] text-[var(--color-text-faint)]">Loading…</div>
      </Tile>
    );
  }
  const marginTone = snap.marginPct >= 60 ? 'good' : snap.marginPct >= 40 ? 'warn' : 'bad';
  return (
    <Tile icon={Receipt} title="Real MRR · Vendasta" href="/cash">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat
          label="Customer MRR"
          value={money(snap.customerRetailMRR)}
          tone="good"
          sub={`${snap.customerCount} paying`}
        />
        <Stat
          label="Vendasta Cost"
          value={money(snap.wholesaleMonthly)}
          tone="warn"
          sub="wholesale 31d"
        />
        <Stat
          label="Gross Margin"
          value={moneySigned(snap.grossMargin)}
          tone={marginTone}
          sub={`${snap.marginPct.toFixed(0)}%`}
        />
        <Stat
          label="Internal"
          value={money(snap.internalRetailMRR)}
          tone="faint"
          sub="excluded"
        />
      </div>
      {snap.topCustomers.length > 0 && (
        <div class="mt-3 pt-3 border-t border-[var(--color-border)]">
          <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1.5">Top customers</div>
          <div class="space-y-1">
            {snap.topCustomers.map((c) => (
              <div key={c.agid} class="flex items-center justify-between text-[11px]">
                <span class="truncate text-[var(--color-text-muted)] flex-1 mr-2">{c.name || c.agid}</span>
                <span class="tabular-nums text-[var(--color-text)] font-medium">{money(c.retailMRR)}</span>
                <span class="tabular-nums text-[var(--color-text-faint)] ml-2 w-14 text-right">
                  +{money(c.margin)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Tile>
  );
}

function StockRow({
  q, expanded, onToggle, onRemove,
}: {
  q: StockQuote;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const pct = q.changePct;
  const tone = pct == null ? 'faint' : pct > 0 ? 'good' : pct < 0 ? 'bad' : 'faint';
  const arrow = pct == null ? '' : pct > 0 ? '▲' : pct < 0 ? '▼' : '·';
  return (
    <div
      onClick={onToggle}
      class={`group flex items-center justify-between text-[11px] py-1.5 px-1 -mx-1 rounded cursor-pointer hover:bg-[var(--color-elevated)] border-b border-[var(--color-border)] last:border-b-0 ${expanded ? 'bg-[var(--color-elevated)]' : ''}`}
    >
      <div class="min-w-0 flex-1 flex items-center gap-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          class="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-text-faint)] hover:text-[var(--color-text)] mr-1"
          aria-label={`Remove ${q.symbol}`}
        >
          <X size={11} />
        </button>
        <span class="text-[var(--color-text)] font-semibold tabular-nums">{q.symbol}</span>
        {q.shortName && <span class="text-[var(--color-text-faint)] ml-1 truncate">· {q.shortName}</span>}
      </div>
      <div class="text-right shrink-0 ml-2 tabular-nums">
        <span class="text-[var(--color-text)]">{q.price != null ? '$' + q.price.toFixed(2) : '—'}</span>
        <span class="ml-2" style={{ color: TONE[tone] }}>
          {pct != null ? `${arrow} ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}
        </span>
      </div>
    </div>
  );
}

function timeAgo(ms: number | null): string {
  if (ms == null) return '';
  const delta = Math.max(0, Date.now() - ms);
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function NewsRow({ n }: { n: NewsItem }) {
  // Publisher initials for the avatar fallback (used when no icon URL OR
  // when the favicon proxy returns the generic globe — onError swap below).
  const fallbackInitial = (n.source || n.sourceDomain || '?').trim().charAt(0).toUpperCase();
  return (
    <a href={n.link} target="_blank" rel="noopener noreferrer" class="flex items-start gap-2 py-1.5 hover:bg-[var(--color-elevated)] px-1 -mx-1 rounded border-b border-[var(--color-border)] last:border-b-0">
      {/* Circular publisher icon */}
      <div class="shrink-0 mt-0.5 w-7 h-7 rounded-full overflow-hidden bg-[var(--color-elevated)] border border-[var(--color-border)] flex items-center justify-center text-[10px] text-[var(--color-text-muted)] font-semibold">
        {n.iconUrl ? (
          <img
            src={n.iconUrl}
            alt={n.source || ''}
            class="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={(e) => {
              // Hide the broken image so the initial fallback shows through
              const img = e.currentTarget as HTMLImageElement;
              img.style.display = 'none';
            }}
          />
        ) : null}
        {/* Initial sits underneath; the img covers it when loaded. If img fails
            (onError above), it's hidden and the initial becomes visible. */}
        {!n.iconUrl && <span>{fallbackInitial}</span>}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[12px] text-[var(--color-text)] font-medium leading-snug line-clamp-2">{n.title}</div>
        <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">
          {n.source ?? 'Source unknown'}
          {n.pubDate ? <span> · {timeAgo(n.pubDate)}</span> : null}
        </div>
      </div>
    </a>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = SEV_ICON[item.severity];
  const tone = SEV_TONE[item.severity];
  return (
    <Link href={item.href}>
      <a class="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-[var(--color-elevated)] cursor-pointer">
        <Icon size={14} class="shrink-0 mt-0.5" style={{ color: TONE[tone] }} />
        <div class="flex-1 min-w-0">
          <div class="text-[12px] font-semibold text-[var(--color-text)]">{item.title}</div>
          <div class="text-[11px] text-[var(--color-text-muted)]">{item.detail}</div>
        </div>
        <span class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mt-0.5">{item.source}</span>
      </a>
    </Link>
  );
}

export function Founder() {
  const { data, loading, refreshing, error, refresh } = useFetch<FounderData>('/api/founder');
  // QB, Stocks, AI News run in parallel — they don't block the page if /api/founder
  // resolves first. Each degrades independently (matches the existing pattern).
  const qbFetch = useFetch<QbSummary>('/api/qb');
  const stocksFetch = useFetch<StocksSummary>('/api/stocks');
  const newsFetch = useFetch<NewsSummary>('/api/ai-news');
  const investmentsFetch = useFetch<InvestmentsSummary>('/api/investments');
  const proposalsFetch = useFetch<{ proposals: BrainProposal[] }>('/api/brain/proposals', 5 * 60_000);
  // 30-min cache server-side; refetch hourly client-side is plenty.
  const realMrrFetch = useFetch<RealMrrSnapshot>('/api/vendasta/revenue', 60 * 60_000);

  // Promotion accept/dismiss state — local-only dismiss for now
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<string | null>(null);

  const today = useMemo(() => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), [data]);

  if (loading && !data) return <PageState>Loading dashboard…</PageState>;
  if (error) return <PageState>Error: {String(error)}</PageState>;
  if (!data) return null;

  const cash = data.cash.data;
  const pipe = data.pipeline.data;
  const outr = data.outreach.data;
  const memb = data.members.data;
  const qb = qbFetch.data;
  const qbConnected = !!(qb && qb.connectionStatus === 'ok');

  // QB-derived runway: compute locally so we don't need a second /api/qb call
  // with cashCents in the URL. burn = -last30.netCents / 30; if profitable,
  // runway is null ("Cash+").
  let qbRunwayDays: number | null = null;
  if (qbConnected && cash && cash.totalCashCents > 0 && qb!.last30.netCents < 0) {
    qbRunwayDays = Math.floor(cash.totalCashCents / (-qb!.last30.netCents / 30));
  }

  // Overlay: when QB connected, use QB numbers for MTD revenue/net + runway.
  // Total cash always comes from Plaid (QB doesn't see bank balances).
  const displayMtdRevenueCents = qbConnected ? qb!.mtd.revenueCents : (cash?.mtdRevenueCents ?? 0);
  const displayMtdNetCents = qbConnected ? qb!.mtd.netCents : (cash?.mtdNetCents ?? 0);
  const displayRunwayDays = qbConnected ? qbRunwayDays : (cash?.runwayDays ?? null);

  const netMTDTone = displayMtdNetCents >= 0 ? 'good' : 'bad';
  const runwayTone = displayRunwayDays == null ? 'good'
    : displayRunwayDays > 90 ? 'good'
      : displayRunwayDays > 30 ? 'warn' : 'bad';

  // Stocks tile state — expanded row (chart open) + add-ticker input
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [addingTicker, setAddingTicker] = useState(false);
  const [newTicker, setNewTicker] = useState('');
  const [tickerError, setTickerError] = useState<string | null>(null);

  // Section-order state for drag-and-drop reordering. Loaded from localStorage
  // on mount; persisted on every change. `draggingId` is the id of the section
  // currently being dragged (null when nothing is in flight).
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => loadSectionOrder());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  useEffect(() => { saveSectionOrder(sectionOrder); }, [sectionOrder]);

  function handleReorder(fromId: string, toId: string) {
    setSectionOrder(prev => {
      const fromIdx = prev.indexOf(fromId);
      const toIdx = prev.indexOf(toId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
      const next = [...prev];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, fromId);
      return next;
    });
  }

  function resetSectionOrder() {
    setSectionOrder([...DEFAULT_SECTION_ORDER]);
  }

  async function handleAddTicker() {
    const sym = newTicker.trim().toUpperCase();
    if (!sym) return;
    try {
      await apiPost('/api/stocks/tickers', { symbol: sym });
      setNewTicker('');
      setAddingTicker(false);
      setTickerError(null);
      stocksFetch.refresh();
    } catch (e: any) {
      // ApiError stores the server JSON in body
      const reason = e?.body?.reason || e?.message || 'Add failed';
      setTickerError(String(reason));
    }
  }

  async function handleRemoveTicker(symbol: string) {
    try {
      await apiDelete(`/api/stocks/tickers/${encodeURIComponent(symbol)}`);
      if (expandedTicker === symbol) setExpandedTicker(null);
      stocksFetch.refresh();
    } catch (e: any) {
      setTickerError(String(e?.body?.reason || e?.message || 'Remove failed'));
    }
  }

  // Brain proposals accept handler — declared here so the JSX in sectionContent
  // can reference it. Wrapped in an IIFE in the old layout, hoisted here so the
  // section map stays readable.
  async function acceptProposal(p: BrainProposal) {
    setAccepting(p.topic);
    try {
      await apiPost('/api/brain/proposals/accept', {
        topic: p.suggestedNoteName,
        folder: 'Decisions',
        examples: p.examples,
      });
      setDismissed(prev => { const next = new Set(prev); next.add(p.topic); return next; });
      proposalsFetch.refresh();
      pushToast({
        tone: 'success',
        title: `Added "${p.suggestedNoteName}" to wiki`,
        description: 'Created in Decisions/ — Syncthing will push it to Obsidian shortly.',
        durationMs: 5000,
      });
    } catch (e: any) {
      const status = e?.status;
      if (status === 409) {
        pushToast({
          tone: 'warn',
          title: 'Already in wiki',
          description: `"${p.suggestedNoteName}" already exists in the vault.`,
          durationMs: 6000,
        });
        setDismissed(prev => { const next = new Set(prev); next.add(p.topic); return next; });
      } else {
        pushToast({
          tone: 'error',
          title: 'Failed to add to wiki',
          description: e?.message || String(e),
          durationMs: 8000,
        });
      }
      console.error('accept proposal', e);
    } finally { setAccepting(null); }
  }

  // Map of section id → JSX content. Null entries are filtered out so empty
  // sections (no primary attention, no proposals, etc.) don't show as empty
  // draggable holes.
  const brainProposalsList = (proposalsFetch.data?.proposals || []).filter(p => !dismissed.has(p.topic));
  const sectionContent: Record<string, any> = {
    'brief': <LatestBriefCard />,

    // Nikki broken out as her own full-width tile right under the daily brief,
    // separate from the Stocks + News row below.
    'nikki': <NikkiCard />,
    'journal': <JournalCard />,

    'attention': data.primaryAttention ? (
      <Link href={data.primaryAttention.href}>
        <a class="block rounded-lg border-2 p-4 cursor-pointer hover:bg-[var(--color-elevated)]"
           style={{ borderColor: TONE[SEV_TONE[data.primaryAttention.severity]] }}>
          <div class="flex items-start gap-3">
            {(() => { const Icon = SEV_ICON[data.primaryAttention.severity]; return <Icon size={20} class="shrink-0 mt-0.5" style={{ color: TONE[SEV_TONE[data.primaryAttention.severity]] }} />; })()}
            <div class="flex-1">
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1">What needs your attention</div>
              <div class="text-[16px] font-bold text-[var(--color-text)]">{data.primaryAttention.title}</div>
              <div class="text-[12px] text-[var(--color-text-muted)] mt-1">{data.primaryAttention.detail}</div>
            </div>
            <ArrowRight size={18} class="text-[var(--color-text-faint)] mt-1" />
          </div>
        </a>
      </Link>
    ) : null,

    'real-mrr': <RealMrrTile snap={realMrrFetch.data || null} />,

    'cash-pulse': <CashPulseTile cash={cash} qb={qb} />,

    // Investments — Plaid-backed portfolio across Schwab / Vanguard / Stash
    // / Robinhood / etc. Shows total portfolio value + day change, per-account
    // list, and top 5 holdings. Empty-state nudges the user to /cash/connect
    // to link an investment institution via the existing Plaid Link flow.
    'investments': (() => {
      const data = investmentsFetch.data;
      const fmtMoney = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtDelta = (cents: number, pct?: number) => {
        const sign = cents >= 0 ? '+' : '';
        const main = `${sign}${fmtMoney(Math.abs(cents) * (cents < 0 ? -1 : 1))}`;
        return pct != null ? `${main} (${sign}${pct.toFixed(2)}%)` : main;
      };
      const positive = (cents: number) => cents >= 0;
      return (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <LineChart size={14} class="text-[var(--color-text-faint)]" />
              <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">Investments</div>
            </div>
            {data && data.totalValue > 0 && (
              <span class="text-[10px] text-[var(--color-text-faint)]">
                {data.accountCount} {data.accountCount === 1 ? 'account' : 'accounts'} · as of {new Date(data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          {investmentsFetch.loading && !data ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">Loading portfolio…</div>
          ) : !data?.configured || (data && data.totalValue === 0) ? (
            <div class="text-[11px] text-[var(--color-text-muted)]">
              <div class="mb-2">No investment accounts linked yet.</div>
              <div class="text-[var(--color-text-faint)]">
                Open <a href="/cash/connect" class="text-[var(--color-accent)] hover:underline">/cash/connect</a> and search for your brokerage (Schwab, Vanguard, Stash, Robinhood, Fidelity, etc.). Plaid Link will request investment-account permissions. The tile auto-populates after you authorize.
              </div>
              {data?.error && (
                <div class="mt-2 text-[10px] text-[var(--color-text-faint)] line-clamp-2">{data.error}</div>
              )}
            </div>
          ) : (
            <>
              {/* Hero: total portfolio value + day change */}
              <div class="mb-3">
                <div class="text-[24px] font-semibold text-[var(--color-text)] leading-none tabular-nums">
                  {fmtMoney(data.totalValue)}
                </div>
                <div class={`text-[11px] mt-1 ${positive(data.totalDayChange) ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
                  Today: {fmtDelta(data.totalDayChange, data.totalDayChangePct)}
                </div>
              </div>
              {/* Per-account list, grouped by institution. Each row shows
                  the institution name prominently up top, then the brokerage
                  account name and subtype underneath. */}
              <div class="space-y-2.5 mb-3 pb-3 border-b border-[var(--color-border)]">
                {(() => {
                  // Group accounts by institution_name for display
                  const groups = new Map<string, typeof data.perAccount>();
                  for (const a of data.perAccount.slice(0, 12)) {
                    const key = a.institution_name || 'Unknown institution';
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(a);
                  }
                  const groupArr = [...groups.entries()].sort(([, ax], [, bx]) => {
                    const aTotal = ax.reduce((s, x) => s + x.currentValue, 0);
                    const bTotal = bx.reduce((s, x) => s + x.currentValue, 0);
                    return bTotal - aTotal;
                  });
                  return groupArr.map(([inst, accounts]) => {
                    const instTotal = accounts.reduce((s, a) => s + a.currentValue, 0);
                    return (
                      <div>
                        <div class="flex items-baseline justify-between gap-2 mb-0.5">
                          <div class="text-[11px] font-semibold text-[var(--color-text)] uppercase tracking-wide">{inst}</div>
                          <div class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{fmtMoney(instTotal)}</div>
                        </div>
                        {accounts.map(a => (
                          <div class="flex items-center justify-between gap-2 text-[11px] pl-2">
                            <div class="min-w-0 flex-1">
                              <div class="text-[var(--color-text-muted)] truncate">
                                {a.name}
                                <span class="text-[var(--color-text-faint)] ml-1">
                                  · {a.subtype || a.type}{a.mask ? ` · …${a.mask}` : ''}
                                </span>
                              </div>
                            </div>
                            <div class="text-right shrink-0">
                              <div class="text-[var(--color-text-muted)] tabular-nums">{fmtMoney(a.currentValue)}</div>
                              {a.dayChange !== 0 && (
                                <div class={`text-[10px] tabular-nums ${positive(a.dayChange) ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
                                  {fmtDelta(a.dayChange)}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  });
                })()}
              </div>
              {/* Top holdings */}
              {data.topHoldings.length > 0 && (
                <div>
                  <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1.5">Top holdings</div>
                  <div class="space-y-1">
                    {data.topHoldings.slice(0, 5).map(h => (
                      <div class="flex items-center justify-between gap-2 text-[11px]">
                        <div class="min-w-0 flex-1 flex items-baseline gap-1.5">
                          <span class="font-medium text-[var(--color-text)]">{h.ticker || h.name.slice(0, 8)}</span>
                          <span class="text-[var(--color-text-faint)] truncate text-[10px]">{h.name}</span>
                        </div>
                        <div class="text-right shrink-0 tabular-nums">
                          <span class="text-[var(--color-text)]">{fmtMoney(h.currentValue)}</span>
                          <span class="text-[var(--color-text-faint)] ml-2">{h.weight.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      );
    })(),

    'cash-pipeline': (
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Tile icon={Wallet} title={qbConnected ? `Cash · QB (${qb!.company.name || 'ImpactWorks'})` : 'Cash'} href="/cash">
          {data.cash.ok && cash ? (
            cash.connectionStatus !== 'ok' ? (
              <div class="text-[12px] text-[var(--color-text-muted)]">
                Plaid not connected yet. <Link href="/cash"><a class="underline">Set up Cash →</a></Link>
              </div>
            ) : (
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Total Cash" value={money(cash.totalCashCents)} tone="good" />
                <Stat label={qbConnected ? 'MTD Revenue · QB' : 'MTD Revenue'} value={money(displayMtdRevenueCents)} tone="good" />
                <Stat label={qbConnected ? 'MTD Net · QB' : 'MTD Net'} value={moneySigned(displayMtdNetCents)} tone={netMTDTone} />
                <Stat label="Runway" value={displayRunwayDays == null ? 'Cash+' : displayRunwayDays + 'd'} tone={runwayTone} sub={qbConnected ? 'QB 30d burn' : 'at 30d burn'} />
              </div>
            )
          ) : (
            <div class="text-[12px] text-[var(--color-text-faint)]">Cash data unavailable {data.cash.error ? '(' + data.cash.error + ')' : ''}</div>
          )}
        </Tile>
        <Tile icon={TrendingUp} title="Sales Pipeline" href="/pipeline">
          {data.pipeline.ok && pipe ? (
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Open Deals" value={pipe.openDealsCount} />
              <Stat label="Pipeline Value" value={money(pipe.openDealsValueCents)} />
              <Stat label="Weighted" value={money(pipe.openDealsWeightedCents)} tone="warn" />
              <Stat label="Customers" value={pipe.customersCount} sub={pipe.customersMRRCents != null ? money(pipe.customersMRRCents) + '/mo MRR' : undefined} />
            </div>
          ) : (
            <div class="text-[12px] text-[var(--color-text-faint)]">Pipeline data unavailable {data.pipeline.error ? '(' + data.pipeline.error + ')' : ''}</div>
          )}
        </Tile>
      </div>
    ),

    'outreach-members': (
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Tile icon={Send} title="BID Outreach" href="/outreach">
          {data.outreach.ok && outr ? (
            <>
              <div class="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-3">
                <Stat label="Total" value={outr.totalBids} />
                <Stat label="Untouched" value={outr.notContacted} tone={outr.notContacted > 0 ? 'warn' : 'faint'} />
                <Stat label="Emailed" value={outr.emailed} tone="warn" />
                <Stat label="Replied" value={outr.replied} tone="good" />
                <Stat label="Webinar Booked" value={outr.webinarBooked} tone="good" />
                <Stat label="Endorsed" value={outr.endorsed} tone="good" />
              </div>
              {outr.topPriority.length > 0 && (
                <div class="border-t border-[var(--color-border)] pt-2">
                  <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1">Top priority today</div>
                  {outr.topPriority.slice(0, 3).map(p => (
                    <div key={p.email} class="flex items-center justify-between text-[11px] py-1">
                      <div class="min-w-0 truncate">
                        <span class="text-[var(--color-text)] font-medium">{p.entity}</span>
                        {p.city && <span class="text-[var(--color-text-faint)]"> · {p.city}</span>}
                      </div>
                      <span class="text-[var(--color-text-muted)] shrink-0 ml-2">{p.nextAction}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div class="text-[12px] text-[var(--color-text-faint)]">Outreach data unavailable {data.outreach.error ? '(' + data.outreach.error + ')' : ''}</div>
          )}
        </Tile>
        <Tile icon={Store} title="BID Members (Tier 2)" href="/members">
          {data.members.ok && memb ? (
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="BIDs Endorsed" value={memb.bidsEndorsed} />
              <Stat label="Active Members" value={memb.activeMembers} />
              <Stat label="Current MRR" value={money(memb.totalMRRCents)} tone="good" />
              <Stat label="Pipeline Ceiling" value={money(memb.pipelineCeilingCents)} sub="at $169/mo × NC roster" />
            </div>
          ) : (
            <div class="text-[12px] text-[var(--color-text-faint)]">Members data unavailable {data.members.error ? '(' + data.members.error + ')' : ''}</div>
          )}
        </Tile>
      </div>
    ),

    // Stocks + AI News side-by-side. Nikki used to be a third column here —
    // she's now her own full-width section right under the daily brief.
    'stocks-news': (
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <LineChart size={14} class="text-[var(--color-text-faint)]" />
              <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">Stocks</div>
            </div>
            <div class="flex items-center gap-2">
              {stocksFetch.data && (
                <span class="text-[10px] text-[var(--color-text-faint)]">
                  as of {new Date(stocksFetch.data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button
                type="button"
                onClick={() => { setAddingTicker(v => !v); setTickerError(null); }}
                class="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
                aria-label="Add ticker"
                title="Add ticker"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
          {addingTicker && (
            <div class="mb-2 flex items-center gap-2">
              <input
                type="text"
                value={newTicker}
                onInput={(e: any) => setNewTicker(e.target.value.toUpperCase())}
                onKeyDown={(e: any) => {
                  if (e.key === 'Enter') handleAddTicker();
                  if (e.key === 'Escape') { setAddingTicker(false); setNewTicker(''); setTickerError(null); }
                }}
                placeholder="e.g. ANTH"
                maxLength={6}
                autoFocus
                class="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1 text-[12px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              <button type="button" onClick={handleAddTicker} class="px-2 py-1 rounded text-[11px] bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:opacity-80">Add</button>
              <button type="button" onClick={() => { setAddingTicker(false); setNewTicker(''); setTickerError(null); }} class="px-2 py-1 rounded text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
            </div>
          )}
          {tickerError && <div class="mb-2 text-[10px] text-[#dc2626]">{tickerError}</div>}
          {stocksFetch.loading && !stocksFetch.data ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">Loading quotes…</div>
          ) : stocksFetch.error ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">Stocks unavailable ({String(stocksFetch.error)})</div>
          ) : stocksFetch.data && stocksFetch.data.quotes.length > 0 ? (
            <div class="space-y-0">
              {stocksFetch.data.quotes.map(q => (
                <div key={q.symbol}>
                  <StockRow q={q} expanded={expandedTicker === q.symbol} onToggle={() => setExpandedTicker(expandedTicker === q.symbol ? null : q.symbol)} onRemove={() => handleRemoveTicker(q.symbol)} />
                  {expandedTicker === q.symbol && <StockChart symbol={q.symbol} onClose={() => setExpandedTicker(null)} />}
                </div>
              ))}
            </div>
          ) : (
            <div class="text-[11px] text-[var(--color-text-faint)]">No tickers in your watchlist. Click + to add.</div>
          )}
          <div class="text-[10px] text-[var(--color-text-faint)] mt-2 pt-2 border-t border-[var(--color-border)]">
            Quotes from Stooq · Candles from Yahoo · Click a row to view candles · Edits persist on the Fly volume.
          </div>
        </div>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Newspaper size={14} class="text-[var(--color-text-faint)]" />
              <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">AI News · Past 24h</div>
            </div>
            {newsFetch.data && (
              <span class="text-[10px] text-[var(--color-text-faint)]">
                refreshed {new Date(newsFetch.data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          {newsFetch.loading && !newsFetch.data ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">Loading news…</div>
          ) : newsFetch.error ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">News unavailable ({String(newsFetch.error)})</div>
          ) : newsFetch.data && newsFetch.data.items.length > 0 ? (
            <div class="space-y-0 max-h-[260px] overflow-auto">
              {newsFetch.data.items.slice(0, 8).map((n, i) => <NewsRow key={i} n={n} />)}
            </div>
          ) : (
            <div class="text-[11px] text-[var(--color-text-faint)]">No news in the last 24h.</div>
          )}
          <div class="text-[10px] text-[var(--color-text-faint)] mt-2 pt-2 border-t border-[var(--color-border)]">
            Source: Google News · Query: "artificial intelligence" OR "AI", last 24 hours.
          </div>
        </div>
      </div>
    ),

    'cal-vendasta': (
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CalendarTile />
        <VendastaTile />
      </div>
    ),

    'inbox': <InboxCard />,

    'brain-proposals': brainProposalsList.length > 0 ? (
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
        <div class="flex items-center gap-2 mb-2">
          <Sparkles size={14} class="text-[var(--color-accent)]" />
          <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Brain proposals · {brainProposalsList.length}
          </div>
          <Link href="/brain">
            <a class="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)] ml-auto inline-flex items-center gap-0.5">
              open Brain <ArrowRight size={10} />
            </a>
          </Link>
        </div>
        <div class="space-y-1.5">
          {brainProposalsList.slice(0, 4).map(p => (
            <div key={p.topic} class="flex items-start gap-2 text-[11px] py-1.5 px-2 rounded bg-[var(--color-elevated)]">
              <Library size={12} class="text-[var(--color-accent)] mt-0.5 shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-[var(--color-text)] font-medium">{p.suggestedNoteName}</div>
                <div class="text-[10px] text-[var(--color-text-faint)] truncate">
                  Seen in {p.hitCount} memories · avg importance {p.importance.toFixed(1)} · e.g. "{p.examples[0]?.slice(0, 80)}…"
                </div>
              </div>
              <button type="button" onClick={() => acceptProposal(p)} disabled={accepting === p.topic} class="text-[10px] px-2 py-1 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:opacity-80 disabled:opacity-40 shrink-0">
                {accepting === p.topic ? 'Adding…' : 'Add to wiki'}
              </button>
              <button type="button" onClick={() => setDismissed(prev => { const n = new Set(prev); n.add(p.topic); return n; })} class="text-[10px] px-1.5 py-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] shrink-0" aria-label="Dismiss">×</button>
            </div>
          ))}
        </div>
      </div>
    ) : null,

    'watchlist': data.attentionList.length > 1 ? (
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
        <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)] mb-2">Watchlist</div>
        <div class="space-y-0.5">
          {data.attentionList.slice(1).map((a, i) => <AttentionRow key={i} item={a} />)}
        </div>
      </div>
    ) : null,
  };

  return (
    <div class="flex h-full flex-col">
      <PageHeader
        title="Founder Dashboard"
        subtitle={today + ' · ImpactWorks + Rocket Local'}
        actions={<div class="flex items-center gap-2">
          <button
            type="button"
            onClick={resetSectionOrder}
            disabled={JSON.stringify(sectionOrder) === JSON.stringify([...DEFAULT_SECTION_ORDER])}
            class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            title="Reset card order to default"
          >
            <RotateCcw size={12} /> Reset layout
          </button>
          <button type="button" onClick={() => refresh()} disabled={refreshing} class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"><RefreshCw size={12} class={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>}
      />

      <div class="flex-1 overflow-auto p-4 space-y-4">

        {/* Reorderable sections — drag a section's grip handle to move it.
            Order persists per-browser in localStorage (founder-section-order-v1).
            Reset via the "Reset layout" button in the page header. */}
        {sectionOrder.map(id => {
          const content = sectionContent[id];
          if (!content) return null;
          return (
            <SortableSection
              key={id}
              id={id}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              onReorder={handleReorder}
            >
              {content}
            </SortableSection>
          );
        })}


        {/* Quick links footer */}
        <div class="flex flex-wrap gap-3 text-[11px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] pt-3 mt-2">
          <Link href="/cash"><a class="hover:text-[var(--color-text)]">Cash →</a></Link>
          <Link href="/pipeline"><a class="hover:text-[var(--color-text)]">Pipeline →</a></Link>
          <Link href="/outreach"><a class="hover:text-[var(--color-text)]">Outreach →</a></Link>
          <Link href="/webinars"><a class="hover:text-[var(--color-text)]">Webinars →</a></Link>
          <Link href="/members"><a class="hover:text-[var(--color-text)]">Members →</a></Link>
          <Link href="/mission"><a class="hover:text-[var(--color-text)]">Mission Control →</a></Link>
        </div>
      </div>

      <div class="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-faint)]">
        Last refreshed {new Date(data.generatedAt).toLocaleTimeString()} · Single read across Cash + Pipeline + Outreach + Members. Each section degrades independently if data unavailable.
      </div>
    </div>
  );
}
