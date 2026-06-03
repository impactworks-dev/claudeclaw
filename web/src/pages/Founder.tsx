import { useMemo } from 'preact/hooks';
import { RefreshCw, ArrowRight, AlertTriangle, AlertCircle, Info, Crown, Wallet, TrendingUp, Send, Store, LineChart, Newspaper } from 'lucide-preact';
import { Link } from 'wouter-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';

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
interface NewsItem { title: string; link: string; source: string | null; pubDate: number | null; description: string | null; }
interface NewsSummary { asOf: number; query: string; items: NewsItem[]; error?: string | null; }

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

function StockRow({ q }: { q: StockQuote }) {
  const pct = q.changePct;
  const tone = pct == null ? 'faint' : pct > 0 ? 'good' : pct < 0 ? 'bad' : 'faint';
  const arrow = pct == null ? '' : pct > 0 ? '▲' : pct < 0 ? '▼' : '·';
  return (
    <div class="flex items-center justify-between text-[11px] py-1 border-b border-[var(--color-border)] last:border-b-0">
      <div class="min-w-0 flex-1">
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
  return (
    <a href={n.link} target="_blank" rel="noopener noreferrer" class="block py-1.5 hover:bg-[var(--color-elevated)] px-1 -mx-1 rounded border-b border-[var(--color-border)] last:border-b-0">
      <div class="text-[12px] text-[var(--color-text)] font-medium leading-snug line-clamp-2">{n.title}</div>
      <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">
        {n.source ?? 'Source unknown'}
        {n.pubDate ? <span> · {timeAgo(n.pubDate)}</span> : null}
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

  return (
    <div class="flex h-full flex-col">
      <PageHeader
        title="Founder Dashboard"
        subtitle={today + ' · ImpactWorks + Rocket Local'}
        actions={<button type="button" onClick={() => refresh()} disabled={refreshing} class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"><RefreshCw size={12} class={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}</button>}
      />

      <div class="flex-1 overflow-auto p-4 space-y-4">

        {/* Primary attention: the ONE thing right now */}
        {data.primaryAttention && (
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
        )}

        {/* Top row: Cash + Pipeline */}
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

        {/* Middle row: Outreach + Members */}
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

        {/* Stocks + AI News, side-by-side */}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <LineChart size={14} class="text-[var(--color-text-faint)]" />
                <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">Stocks</div>
              </div>
              {stocksFetch.data && (
                <span class="text-[10px] text-[var(--color-text-faint)]">
                  as of {new Date(stocksFetch.data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            {stocksFetch.loading && !stocksFetch.data ? (
              <div class="text-[11px] text-[var(--color-text-faint)]">Loading quotes…</div>
            ) : stocksFetch.error ? (
              <div class="text-[11px] text-[var(--color-text-faint)]">Stocks unavailable ({String(stocksFetch.error)})</div>
            ) : stocksFetch.data && stocksFetch.data.quotes.length > 0 ? (
              <div class="space-y-0">
                {stocksFetch.data.quotes.map(q => <StockRow key={q.symbol} q={q} />)}
              </div>
            ) : (
              <div class="text-[11px] text-[var(--color-text-faint)]">No quote data.</div>
            )}
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2 pt-2 border-t border-[var(--color-border)]">
              Source: Yahoo Finance · Edit STOCK_TICKERS in Fly secrets to change list.
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

        {/* Full attention list (excluding the primary, which is already prominent) */}
        {data.attentionList.length > 1 && (
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)] mb-2">Watchlist</div>
            <div class="space-y-0.5">
              {data.attentionList.slice(1).map((a, i) => <AttentionRow key={i} item={a} />)}
            </div>
          </div>
        )}

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
