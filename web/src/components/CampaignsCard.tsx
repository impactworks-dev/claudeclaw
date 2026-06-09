// Marketing Campaigns card for the Founder Dashboard.
//
// At-a-glance view of Vendasta Partner Center campaigns: total active
// campaigns, total reach (recipients delivered), weighted open rate, +
// top 3 performers. Clicking through goes to Vendasta's full campaigns
// page since the source of truth lives there.

import { Megaphone, ExternalLink, RefreshCw, TrendingUp } from 'lucide-preact';
import { useFetch } from '@/lib/useFetch';

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  tag: string | null;
  totalRecipients: number;
  activeRecipients: number;
  emailsDelivered: number;
  openRate: number | null;
  ctor: number | null;
}

interface CampaignsSummary {
  asOf: number;
  configured: boolean;
  totalCampaigns: number;
  publishedCount: number;
  ongoingCount: number;
  draftCount: number;
  totalRecipients: number;
  totalEmailsDelivered: number;
  avgOpenRate: number | null;
  topCampaigns: CampaignRow[];
  error?: string;
}

const VENDASTA_URL = 'https://partners.vendasta.com/marketing/campaigns/all';

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

export function CampaignsCard() {
  const { data, loading, error, refresh, refreshing } = useFetch<CampaignsSummary>('/api/vendasta/campaigns', 10 * 60_000);

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Megaphone size={14} class="text-[var(--color-text-faint)]" />
          <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">Campaigns</div>
          {data && data.configured && (
            <span class="text-[10px] text-[var(--color-text-faint)]">
              · {data.totalCampaigns} total · {data.publishedCount + data.ongoingCount} live
            </span>
          )}
        </div>
        <div class="flex items-center gap-2">
          <a
            href={VENDASTA_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
          >
            Open in Vendasta <ExternalLink size={10} />
          </a>
          <button
            type="button"
            onClick={() => refresh()}
            disabled={refreshing}
            class="text-[var(--color-text-faint)] hover:text-[var(--color-text)] disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={11} class={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">Loading…</div>
      ) : data && data.error ? (
        <div class="text-[11px] text-[var(--color-text-muted)]">
          <div class="mb-1">Couldn't load campaigns.</div>
          <div class="text-[10px] text-[var(--color-text-faint)] line-clamp-2">{data.error}</div>
        </div>
      ) : !data || !data.configured ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">
          Vendasta Campaigns not yet wired. Confirm the connector resource path or check API access.
          {error && <div class="mt-1 text-[10px]">{String(error)}</div>}
        </div>
      ) : (
        <>
          {/* Hero stats */}
          <div class="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-[var(--color-border)]">
            <div>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Reach</div>
              <div class="text-[20px] font-semibold text-[var(--color-text)] tabular-nums leading-tight">
                {fmtNum(data.totalEmailsDelivered)}
              </div>
              <div class="text-[10px] text-[var(--color-text-faint)]">emails delivered</div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Open Rate</div>
              <div class="text-[20px] font-semibold text-[var(--color-text)] tabular-nums leading-tight">
                {data.avgOpenRate != null ? `${data.avgOpenRate.toFixed(1)}%` : '—'}
              </div>
              <div class="text-[10px] text-[var(--color-text-faint)]">weighted avg</div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Recipients</div>
              <div class="text-[20px] font-semibold text-[var(--color-text)] tabular-nums leading-tight">
                {fmtNum(data.totalRecipients)}
              </div>
              <div class="text-[10px] text-[var(--color-text-faint)]">{fmtNum(data.totalActiveRecipients ?? 0)} active</div>
            </div>
          </div>

          {/* Top performers */}
          {data.topCampaigns.length > 0 ? (
            <div>
              <div class="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-2">
                <TrendingUp size={10} /> Top campaigns
              </div>
              <div class="space-y-1.5">
                {data.topCampaigns.slice(0, 3).map(c => (
                  <div key={c.id} class="text-[11px] flex items-baseline gap-2">
                    <div class="min-w-0 flex-1 truncate text-[var(--color-text)]">
                      {c.name}
                      {c.tag && <span class="ml-1 text-[10px] text-[var(--color-text-faint)]">· {c.tag}</span>}
                    </div>
                    <div class="text-[var(--color-text-muted)] tabular-nums whitespace-nowrap">
                      {fmtNum(c.emailsDelivered)} sent
                      {c.openRate != null && <span class="ml-2 text-[var(--color-accent)]">{c.openRate.toFixed(0)}% open</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div class="text-[11px] text-[var(--color-text-faint)]">No active campaigns with delivered metrics yet.</div>
          )}
        </>
      )}
    </div>
  );
}
