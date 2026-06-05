// Vendasta widget for the Founder Dashboard.
//
// Toggles between ImpactWorks (slug=pwps), Rocket Local (slug=default), and
// All. Shows for the selected market: total companies, open deal count +
// pipeline value, top-5 open deals, and 8 most-recently-active companies.
//
// Slug → label mapping is server-side (see src/vendasta-data.ts MARKETS).

import { useState } from 'preact/hooks';
import { Briefcase, ArrowRight, ExternalLink } from 'lucide-preact';
import { useFetch } from '@/lib/useFetch';

type MarketSlug = 'pwps' | 'default';
type MarketKey = MarketSlug | 'all';

interface Opportunity {
  name: string;
  accountGroupId: string | null;
  marketSlug: MarketSlug | 'unknown';
  pipelineStage: string | null;
  projectedFirstYearValueCents: number;
  probableFirstYearValueCents: number;
  probability: number;
  expectedCloseDate: string | null;
  salesPersonId: string | null;
}
interface CompanyRow {
  id: string;
  name: string;
  marketSlug: string;
  lifecycleStage: string | null;
  lastActivity: number | null;
  city: string | null;
  state: string | null;
  website: string | null;
}
interface MarketSummary {
  slug: MarketKey;
  label: string;
  companies: number;
  openDeals: number;
  openDealsValueCents: number;
  openDealsWeightedCents: number;
  recentCompanies: CompanyRow[];
  topOpenDeals: Opportunity[];
}
interface VendastaSummary {
  asOf: number;
  configured: boolean;
  connectionStatus: 'ok' | 'no-credentials' | 'error';
  connectionMessage: string | null;
  bySlug: Record<MarketSlug, MarketSummary>;
  all: MarketSummary;
}

const SLUG_BADGE: Record<MarketSlug | 'all', string> = {
  pwps: '#7c3aed', default: '#0ea5e9', all: 'var(--color-text-faint)',
};
const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });

function timeAgo(ms: number | null): string {
  if (ms == null) return '—';
  const delta = Math.max(0, Date.now() - ms);
  const m = Math.floor(delta / 60000);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}

function Tab({ active, color, label, count, onClick }: { active: boolean; color: string; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
        active
          ? 'bg-[var(--color-elevated)] text-[var(--color-text)] border border-[var(--color-border)]'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent'
      }`}
    >
      <span class="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
      <span class="text-[10px] tabular-nums text-[var(--color-text-faint)]">{count}</span>
    </button>
  );
}

function OppRow({ o }: { o: Opportunity }) {
  return (
    <div class="flex items-center justify-between text-[11px] py-1 border-b border-[var(--color-border)] last:border-b-0">
      <div class="min-w-0 flex-1 truncate">
        <span class="text-[var(--color-text)] font-medium">{o.name}</span>
        {o.expectedCloseDate && (
          <span class="text-[var(--color-text-faint)] ml-1">· close {o.expectedCloseDate.slice(0, 10)}</span>
        )}
      </div>
      <div class="text-right tabular-nums shrink-0 ml-2">
        <span class="text-[var(--color-text)]">{money(o.projectedFirstYearValueCents)}</span>
        {o.probability > 0 && (
          <span class="text-[var(--color-text-faint)] ml-1">@{Math.round(o.probability * 100)}%</span>
        )}
      </div>
    </div>
  );
}

function CompanyRowView({ c }: { c: CompanyRow }) {
  const loc = [c.city, c.state].filter(Boolean).join(', ');
  return (
    <div class="flex items-center justify-between text-[11px] py-1 border-b border-[var(--color-border)] last:border-b-0">
      <div class="min-w-0 flex-1 truncate">
        {c.website ? (
          <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer"
             class="text-[var(--color-text)] font-medium hover:underline inline-flex items-center gap-1">
            {c.name}<ExternalLink size={9} class="text-[var(--color-text-faint)]" />
          </a>
        ) : (
          <span class="text-[var(--color-text)] font-medium">{c.name}</span>
        )}
        {loc && <span class="text-[var(--color-text-faint)] ml-1">· {loc}</span>}
      </div>
      <div class="text-right shrink-0 ml-2 text-[var(--color-text-faint)] tabular-nums">
        {c.lifecycleStage && <span class="mr-2">{c.lifecycleStage}</span>}
        {timeAgo(c.lastActivity)}
      </div>
    </div>
  );
}

export function VendastaTile() {
  const { data, loading, error } = useFetch<VendastaSummary>('/api/vendasta', 10 * 60_000);
  const [active, setActive] = useState<MarketKey>('all');

  const summary: MarketSummary | null = data
    ? active === 'all'
      ? data.all
      : data.bySlug[active]
    : null;

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Briefcase size={14} class="text-[var(--color-text-faint)]" />
          <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Vendasta CRM
          </div>
        </div>
        {data && (
          <span class="text-[10px] text-[var(--color-text-faint)]">
            updated {new Date(data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Market toggle */}
      {data && data.connectionStatus === 'ok' && (
        <div class="flex items-center gap-1.5 mb-3">
          <Tab active={active === 'all'} color={SLUG_BADGE.all} label="All" count={data.all.companies} onClick={() => setActive('all')} />
          <Tab active={active === 'pwps'} color={SLUG_BADGE.pwps} label={data.bySlug.pwps.label} count={data.bySlug.pwps.companies} onClick={() => setActive('pwps')} />
          <Tab active={active === 'default'} color={SLUG_BADGE.default} label={data.bySlug.default.label} count={data.bySlug.default.companies} onClick={() => setActive('default')} />
        </div>
      )}

      {loading && !data ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">Loading Vendasta…</div>
      ) : error ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">Vendasta unavailable ({String(error)})</div>
      ) : data && data.connectionStatus === 'no-credentials' ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">
          Vendasta service-account credentials missing.
        </div>
      ) : data && data.connectionStatus === 'error' ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">
          Vendasta error: {data.connectionMessage}
        </div>
      ) : summary ? (
        <>
          {/* Top stats */}
          <div class="grid grid-cols-3 gap-3 mb-3">
            <div>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Companies</div>
              <div class="text-[16px] font-bold tabular-nums">{summary.companies.toLocaleString()}</div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Open Deals</div>
              <div class="text-[16px] font-bold tabular-nums">{summary.openDeals.toLocaleString()}</div>
              {summary.openDealsValueCents > 0 && (
                <div class="text-[10px] text-[var(--color-text-faint)]">{money(summary.openDealsValueCents)} pipeline</div>
              )}
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Weighted</div>
              <div class="text-[16px] font-bold tabular-nums" style={{ color: '#ca8a04' }}>{money(summary.openDealsWeightedCents)}</div>
            </div>
          </div>

          {/* Top open deals */}
          {summary.topOpenDeals.length > 0 ? (
            <div class="mb-3">
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1">Top open deals</div>
              <div class="space-y-0">
                {summary.topOpenDeals.map((o, i) => <OppRow key={i} o={o} />)}
              </div>
            </div>
          ) : (
            <div class="mb-3 text-[10px] text-[var(--color-text-faint)] italic">
              No open deals tracked in this market yet.
            </div>
          )}

          {/* Recent companies */}
          {summary.recentCompanies.length > 0 && (
            <div>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1">Recent activity</div>
              <div class="space-y-0 max-h-[160px] overflow-auto">
                {summary.recentCompanies.map(c => <CompanyRowView key={c.id} c={c} />)}
              </div>
            </div>
          )}
        </>
      ) : null}

      <div class="text-[10px] text-[var(--color-text-faint)] mt-2 pt-2 border-t border-[var(--color-border)] flex items-center justify-between">
        <span>Source: Vendasta CRM · PID 0BYD · 10-min cache</span>
        <a href="https://partners.vendasta.com" target="_blank" rel="noopener noreferrer"
           class="inline-flex items-center gap-0.5 hover:text-[var(--color-text)]">
          open <ArrowRight size={9} />
        </a>
      </div>
    </div>
  );
}
