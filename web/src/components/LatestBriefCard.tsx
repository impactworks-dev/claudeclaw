// Latest Morning Brief card for the Founder Dashboard.
//
// Surfaces the most recent brief from the daily_briefs table. Designed to
// pop visually: hero gradient header, big date, "headline" treatment for
// the first line (Nikki's ☀️ line), then prose body with preserved line
// breaks. Action chips for marking acted/ignored, "Generate now" preview
// button, and a strip of recent days.

import { useState, useMemo } from 'preact/hooks';
import { Sunrise, ArrowRight, Sparkles, Check, X, Loader2, ChevronDown, ChevronUp, MessageCircle } from 'lucide-preact';
import { apiPost } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';

interface DailyBriefRow {
  id: number;
  generated_at: number;
  brief_date: string;
  body: string;
  char_count: number;
  send_status: 'pending' | 'sent' | 'failed' | 'preview';
  telegram_message_id: number | null;
  user_marked: 'acted' | 'ignored' | null;
  marked_at: number | null;
}

interface RecentRow {
  id: number; brief_date: string; generated_at: number; char_count: number;
  send_status: DailyBriefRow['send_status']; user_marked: DailyBriefRow['user_marked'];
}

interface LatestBriefResponse {
  latest: DailyBriefRow | null;
  recent: RecentRow[];
}

const STATUS_LABEL: Record<DailyBriefRow['send_status'], { label: string; color: string }> = {
  sent:    { label: 'Delivered',  color: '#16a34a' },
  pending: { label: 'Sending…',   color: '#ca8a04' },
  failed:  { label: 'Send failed', color: '#dc2626' },
  preview: { label: 'Preview',    color: '#7c3aed' },
};

function fmtDate(dateStr: string): { weekday: string; long: string } {
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  return {
    weekday: dt.toLocaleDateString('en-US', { weekday: 'long' }),
    long: dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

function relTime(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Split a brief into (headline, rest). The morning-brief prompt asks for
// a single ☀️-prefixed headline line. We grab the first non-empty line as
// the headline, then return the rest as the body.
function splitBrief(body: string): { headline: string; rest: string } {
  const lines = body.split('\n').map(l => l.trimEnd());
  let headlineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { headlineIdx = i; break; }
  }
  if (headlineIdx === -1) return { headline: body.trim(), rest: '' };
  const headline = lines[headlineIdx].replace(/^[☀️🌅✨\s]+/, '').trim();
  const rest = lines.slice(headlineIdx + 1).join('\n').trim();
  return { headline, rest };
}

// Render the brief body with gentle structure: arrow-prefixed action lines
// get an accent, bullet lines get a subtle bullet, everything else is prose.
function BriefBody({ body }: { body: string }) {
  const lines = useMemo(() => body.split('\n'), [body]);
  return (
    <div class="text-[13px] text-[var(--color-text)] leading-relaxed space-y-1.5">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return <div key={i} class="h-1" />;
        if (line.startsWith('→') || line.startsWith('->')) {
          return (
            <div key={i} class="flex items-start gap-2">
              <ArrowRight size={13} class="text-[var(--color-accent)] shrink-0 mt-1" />
              <span class="text-[var(--color-text)]">{line.replace(/^[→>\-]+\s*/, '')}</span>
            </div>
          );
        }
        if (/^[•\-\*]\s/.test(line)) {
          return (
            <div key={i} class="flex items-start gap-2">
              <span class="text-[var(--color-text-faint)] mt-0.5">·</span>
              <span class="text-[var(--color-text-muted)]">{line.replace(/^[•\-\*]\s+/, '')}</span>
            </div>
          );
        }
        return <div key={i} class="text-[var(--color-text-muted)]">{line}</div>;
      })}
    </div>
  );
}

function MarkChip({ label, icon: Icon, active, color, onClick }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
        active
          ? 'border-transparent text-white'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]'
      }`}
      style={active ? { backgroundColor: color } : undefined}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

function RecentChip({ row, isActive, onClick }: { row: RecentRow; isActive: boolean; onClick: () => void }) {
  const [y, m, d] = row.brief_date.split('-').map(n => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  const label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const status = STATUS_LABEL[row.send_status];
  return (
    <button
      type="button"
      onClick={onClick}
      class={`group inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
        isActive
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]'
      }`}
    >
      <span class="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {label}
      {row.user_marked === 'acted' && <Check size={10} class="text-[#16a34a]" />}
    </button>
  );
}

export function LatestBriefCard() {
  const { data, loading, error, refresh } = useFetch<LatestBriefResponse>('/api/brief/latest', 60_000);
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewedId, setPreviewedId] = useState<number | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);

  const latest = previewBody
    ? null  // showing a fresh preview, hide the archive view
    : data?.latest || null;

  async function handleGenerate() {
    setGenerating(true);
    try {
      const r = await apiPost<{ ok: boolean; id: number; body: string }>('/api/brief/run', {});
      setPreviewedId(r.id);
      setPreviewBody(r.body);
      setExpanded(true);
      refresh();
    } catch (e) {
      console.error('brief generate', e);
    } finally {
      setGenerating(false);
    }
  }

  async function handleMark(action: 'acted' | 'ignored' | null) {
    if (!latest) return;
    try {
      await apiPost(`/api/brief/${latest.id}/mark`, { action });
      refresh();
    } catch (e) { console.error('mark brief', e); }
  }

  if (loading && !data) {
    return (
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-8 text-center text-[11px] text-[var(--color-text-faint)]">
        Loading morning brief…
      </div>
    );
  }
  if (error) {
    return (
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-[11px] text-[var(--color-text-faint)]">
        Brief unavailable ({String(error)})
      </div>
    );
  }

  // No saved brief AND no preview → invite the user to generate one
  if (!latest && !previewBody) {
    return (
      <div class="rounded-xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-card)] to-[var(--color-elevated)] p-6 text-center">
        <Sunrise size={28} class="mx-auto text-[var(--color-text-faint)] mb-2" />
        <div class="text-[13px] font-semibold text-[var(--color-text)] mb-1">No morning brief yet</div>
        <div class="text-[11px] text-[var(--color-text-muted)] mb-4">
          Nikki composes a brief every day at 7:00 AM. Generate one now to preview the format.
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {generating ? <Loader2 size={13} class="animate-spin" /> : <Sparkles size={13} />}
          {generating ? 'Composing…' : 'Generate brief now'}
        </button>
      </div>
    );
  }

  // Determine which brief we're rendering (preview takes precedence)
  const displayBody = previewBody ?? latest!.body;
  const displayDate = previewBody
    ? new Date().toISOString().slice(0, 10)
    : latest!.brief_date;
  const displayGeneratedAt = previewBody ? Date.now() : latest!.generated_at;
  const displayStatus: DailyBriefRow['send_status'] = previewBody ? 'preview' : latest!.send_status;
  const displayUserMarked = previewBody ? null : latest!.user_marked;

  const { headline, rest } = splitBrief(displayBody);
  const { weekday, long } = fmtDate(displayDate);
  const status = STATUS_LABEL[displayStatus];
  const recent = data?.recent || [];

  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden shadow-sm">
      {/* Hero gradient header */}
      <div
        class="relative px-5 pt-5 pb-6"
        style={{
          background: 'linear-gradient(135deg, rgba(251,146,60,0.15) 0%, rgba(124,58,237,0.08) 50%, rgba(14,165,233,0.10) 100%)',
        }}
      >
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-full bg-gradient-to-br from-[#fb923c] to-[#f59e0b] flex items-center justify-center shadow-sm">
              <Sunrise size={17} class="text-white" />
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-faint)] font-medium">
                {previewBody ? 'Preview Brief' : 'Morning Brief'}
              </div>
              <div class="text-[14px] font-semibold text-[var(--color-text)] leading-tight">
                {weekday}, <span class="text-[var(--color-text-muted)] font-normal">{long.replace(weekday + ', ', '')}</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: status.color + '20', color: status.color }}
            >
              <span class="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
              {status.label}
            </span>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              title="Generate a fresh preview"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-50"
            >
              {generating ? <Loader2 size={11} class="animate-spin" /> : <Sparkles size={11} />}
              {generating ? '…' : 'New'}
            </button>
          </div>
        </div>

        {/* Headline */}
        <div class="text-[18px] leading-snug font-semibold text-[var(--color-text)] tracking-[-0.01em]">
          {headline}
        </div>
      </div>

      {/* Body */}
      <div class="px-5 py-4">
        {rest && (
          <>
            {(!expanded && rest.length > 320) ? (
              <>
                <BriefBody body={rest.slice(0, 320) + '…'} />
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  class="mt-3 inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  <ChevronDown size={12} /> Read full brief
                </button>
              </>
            ) : (
              <>
                <BriefBody body={rest} />
                {rest.length > 320 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    class="mt-3 inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    <ChevronUp size={12} /> Collapse
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer: marks + meta + recent strip */}
      <div class="px-5 pb-4 pt-3 border-t border-[var(--color-border)] bg-[color:rgb(255_255_255_/_2%)]">
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div class="flex items-center gap-1.5">
            {!previewBody && (
              <>
                <MarkChip
                  label="I acted on this"
                  icon={Check}
                  color="#16a34a"
                  active={displayUserMarked === 'acted'}
                  onClick={() => handleMark(displayUserMarked === 'acted' ? null : 'acted')}
                />
                <MarkChip
                  label="Ignored"
                  icon={X}
                  color="#6b7280"
                  active={displayUserMarked === 'ignored'}
                  onClick={() => handleMark(displayUserMarked === 'ignored' ? null : 'ignored')}
                />
              </>
            )}
            {previewBody && (
              <button
                type="button"
                onClick={() => { setPreviewBody(null); setPreviewedId(null); refresh(); }}
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
              >
                Close preview
              </button>
            )}
          </div>
          <div class="flex items-center gap-3 text-[10px] text-[var(--color-text-faint)]">
            {!previewBody && latest?.telegram_message_id && (
              <span class="inline-flex items-center gap-1">
                <MessageCircle size={10} /> Telegram
              </span>
            )}
            <span>{relTime(displayGeneratedAt)}</span>
            <span class="tabular-nums">{displayBody.length} chars</span>
          </div>
        </div>

        {recent.length > 1 && (
          <div class="flex items-center gap-1.5 flex-wrap pt-2 border-t border-[var(--color-border)]">
            <span class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mr-1">Recent</span>
            {recent.slice(0, 10).map(r => (
              <RecentChip
                key={r.id}
                row={r}
                isActive={!previewBody && r.id === latest?.id}
                onClick={() => { /* future: load this brief into the main view */ }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
