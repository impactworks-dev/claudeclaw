// Latest Morning Brief card for the Founder Dashboard.
//
// Surfaces the most recent brief from the daily_briefs table. Designed to
// pop visually: hero gradient header, big date, "headline" treatment for
// the first line (Nikki's ☀️ line), then prose body with preserved line
// breaks. Action chips for marking acted/ignored, "Generate now" preview
// button, and a strip of recent days.

import { useState, useMemo } from 'preact/hooks';
import { Sunrise, Sun, Sunset, Moon, ArrowRight, Sparkles, Check, X, Loader2, ChevronDown, ChevronUp, MessageCircle } from 'lucide-preact';
import { apiPost } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';

type BriefKind = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

interface DailyBriefRow {
  id: number;
  generated_at: number;
  brief_date: string;
  brief_kind?: BriefKind; // optional for old rows pre-migration
  body: string;
  char_count: number;
  send_status: 'pending' | 'sent' | 'failed' | 'preview';
  telegram_message_id: number | null;
  user_marked: 'acted' | 'ignored' | null;
  marked_at: number | null;
}

interface RecentRow {
  id: number; brief_date: string; generated_at: number; char_count: number;
  brief_kind?: BriefKind;
  send_status: DailyBriefRow['send_status']; user_marked: DailyBriefRow['user_marked'];
}

interface LatestBriefResponse {
  latest: DailyBriefRow | null;
  recent: RecentRow[];
}

// ── Time-of-day theme system ───────────────────────────────────────
// Each kind drives the card hero header's gradient backdrop, decorative
// SVG, icon badge, accent color, and label. The body content itself is
// theme-neutral so prose reads cleanly against any backdrop.

interface BriefTheme {
  label: string;
  gradient: string;          // CSS gradient string for the hero
  decorationColor: string;   // dominant decoration color
  badgeFrom: string;
  badgeTo: string;
  icon: typeof Sunrise;
  decoration: 'sunrays' | 'sunhigh' | 'sunlow' | 'sunset-bands' | 'moon-stars';
  textShadow: string;        // tinted shadow on headline for legibility
  accentRing: string;        // border tint
}

const THEME_BY_KIND: Record<BriefKind, BriefTheme> = {
  morning: {
    label: 'Morning Brief',
    gradient: 'linear-gradient(135deg, #ffb088 0%, #ff8e72 40%, #ffd66e 100%)',
    decorationColor: '#fff5d6',
    badgeFrom: '#fb923c',
    badgeTo: '#f59e0b',
    icon: Sunrise,
    decoration: 'sunrays',
    textShadow: '0 1px 12px rgba(120, 40, 0, 0.25)',
    accentRing: 'rgba(255, 142, 114, 0.6)',
  },
  noon: {
    label: 'Noon Check',
    gradient: 'linear-gradient(135deg, #ffd43b 0%, #ffb347 35%, #7bd3f7 100%)',
    decorationColor: '#ffffff',
    badgeFrom: '#fbbf24',
    badgeTo: '#f97316',
    icon: Sun,
    decoration: 'sunhigh',
    textShadow: '0 1px 12px rgba(80, 50, 0, 0.28)',
    accentRing: 'rgba(251, 191, 36, 0.6)',
  },
  afternoon: {
    label: 'Afternoon Nudge',
    gradient: 'linear-gradient(135deg, #ff9f1c 0%, #ffc75f 50%, #d4955d 100%)',
    decorationColor: '#ffe9c4',
    badgeFrom: '#ea580c',
    badgeTo: '#d97706',
    icon: Sun,
    decoration: 'sunlow',
    textShadow: '0 1px 12px rgba(80, 30, 0, 0.32)',
    accentRing: 'rgba(234, 88, 12, 0.6)',
  },
  evening: {
    label: 'Evening Wind-down',
    gradient: 'linear-gradient(180deg, #7f5af0 0%, #ff6b6b 55%, #ffa94d 100%)',
    decorationColor: '#ffe5b4',
    badgeFrom: '#a855f7',
    badgeTo: '#ec4899',
    icon: Sunset,
    decoration: 'sunset-bands',
    textShadow: '0 1px 14px rgba(40, 20, 80, 0.35)',
    accentRing: 'rgba(168, 85, 247, 0.65)',
  },
  night: {
    label: 'Night Reflection',
    gradient: 'linear-gradient(180deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)',
    decorationColor: '#e0e7ff',
    badgeFrom: '#6366f1',
    badgeTo: '#4338ca',
    icon: Moon,
    decoration: 'moon-stars',
    textShadow: '0 1px 14px rgba(0, 0, 0, 0.5)',
    accentRing: 'rgba(99, 102, 241, 0.7)',
  },
};

/** Decorative SVG layer over the hero gradient. Absolutely positioned, low
 *  opacity, pointer-events-none so it never blocks the chips. Each variant
 *  is a small hand-tuned scene that reads at-a-glance even at low opacity. */
function Decoration({ kind }: { kind: BriefKind }) {
  const theme = THEME_BY_KIND[kind];
  const color = theme.decorationColor;
  switch (theme.decoration) {
    case 'sunrays':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Rising sun bottom-right */}
          <circle cx="340" cy="170" r="48" fill={color} opacity="0.5" />
          <circle cx="340" cy="170" r="32" fill={color} opacity="0.7" />
          {/* Light beams radiating from sun */}
          {[0, 22, 45, 67, 90, 112, 135].map((deg, i) => {
            const rad = (deg * Math.PI) / 180;
            const x2 = 340 - Math.cos(rad) * 200;
            const y2 = 170 - Math.sin(rad) * 200;
            return <line key={i} x1="340" y1="170" x2={x2} y2={y2} stroke={color} strokeWidth="1.5" opacity="0.18">
              <animate attributeName="opacity" values="0.10;0.22;0.10" dur="6s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
            </line>;
          })}
        </svg>
      );
    case 'sunhigh':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Sun high in upper-right */}
          <circle cx="340" cy="60" r="42" fill={color} opacity="0.55" />
          <circle cx="340" cy="60" r="28" fill={color} opacity="0.85" />
          {/* Halo rings */}
          <circle cx="340" cy="60" r="60" fill="none" stroke={color} strokeWidth="1" opacity="0.2">
            <animate attributeName="r" values="55;72;55" dur="5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.1;0.3" dur="5s" repeatCount="indefinite" />
          </circle>
          <circle cx="340" cy="60" r="85" fill="none" stroke={color} strokeWidth="0.8" opacity="0.15" />
        </svg>
      );
    case 'sunlow':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Lowering sun mid-right with long horizontal glow */}
          <ellipse cx="340" cy="120" rx="180" ry="14" fill={color} opacity="0.18" />
          <circle cx="340" cy="120" r="38" fill={color} opacity="0.55" />
          <circle cx="340" cy="120" r="26" fill={color} opacity="0.8" />
        </svg>
      );
    case 'sunset-bands':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Horizontal sky bands suggesting layered dusk */}
          <rect x="0" y="120" width="400" height="6" fill={color} opacity="0.20" />
          <rect x="0" y="138" width="400" height="4" fill={color} opacity="0.16" />
          <rect x="0" y="150" width="400" height="3" fill={color} opacity="0.12" />
          {/* Setting sun at horizon */}
          <circle cx="320" cy="145" r="40" fill={color} opacity="0.45" />
          <circle cx="320" cy="145" r="24" fill={color} opacity="0.75" />
        </svg>
      );
    case 'moon-stars':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Crescent moon: white circle with overlapping dark circle to bite */}
          <defs>
            <mask id="crescent-mask">
              <rect width="400" height="200" fill="white" />
              <circle cx="320" cy="50" r="32" fill="black" />
            </mask>
          </defs>
          <circle cx="340" cy="55" r="32" fill={color} opacity="0.9" mask="url(#crescent-mask)" />
          {/* Scattered stars */}
          {[
            [60, 30, 1.5], [120, 60, 1], [200, 40, 1.8], [260, 90, 1.2],
            [80, 110, 1], [160, 130, 1.4], [240, 150, 1], [40, 80, 1.3],
            [300, 130, 1.6], [180, 90, 0.9], [110, 140, 1.1], [280, 30, 1.4],
          ].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill={color} opacity={0.75}>
              <animate attributeName="opacity" values="0.4;0.9;0.4" dur={`${3 + (i % 3)}s`} begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </svg>
      );
  }
}

/** Pick a default theme based on the user's current local hour. Used for
 *  the "no brief yet" empty state and as a fallback when an old brief
 *  row has no brief_kind. */
function themeFromCurrentHour(): BriefKind {
  const h = new Date().getHours();
  if (h < 11) return 'morning';
  if (h < 14) return 'noon';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
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

// Defensive cleanup for briefs already stored before the server-side fix:
// strips outer quotes and replaces literal `\n` / `\"` / `\\` sequences
// with their real characters. New briefs are already cleaned on the
// server, so this is a no-op for them.
function unescapeBrief(raw: string): string {
  let s = (raw || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  s = s.replace(/\\\\/g, '__BS__')
       .replace(/\\n/g, '\n')
       .replace(/\\t/g, '\t')
       .replace(/\\"/g, '"')
       .replace(/__BS__/g, '\\');
  return s.trim();
}

// Split a brief into (headline, rest). The morning-brief prompt asks for
// a single ☀️-prefixed headline line. We grab the first non-empty line as
// the headline, then return the rest as the body.
function splitBrief(body: string): { headline: string; rest: string } {
  const cleaned = unescapeBrief(body);
  const lines = cleaned.split('\n').map(l => l.trimEnd());
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
  // Tiny kind icon — sun/moon glyph beside the date so you can tell at a
  // glance which of the day's 5 briefs this chip represents.
  const kind = row.brief_kind || 'morning';
  const KindIcon = THEME_BY_KIND[kind].icon;
  const kindColor = THEME_BY_KIND[kind].badgeFrom;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${THEME_BY_KIND[kind].label} · ${label}`}
      class={`group inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
        isActive
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]'
      }`}
    >
      <KindIcon size={10} style={{ color: kindColor }} />
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

  // No saved brief AND no preview → invite the user to generate one,
  // themed to the current time of day so the empty state still looks alive.
  if (!latest && !previewBody) {
    const ekind = themeFromCurrentHour();
    const etheme = THEME_BY_KIND[ekind];
    const EIcon = etheme.icon;
    return (
      <div class="relative rounded-xl border overflow-hidden" style={{ borderColor: etheme.accentRing }}>
        <div class="relative px-6 py-8 text-center overflow-hidden" style={{ background: etheme.gradient }}>
          <Decoration kind={ekind} />
          <EIcon size={28} class="mx-auto text-white mb-2 relative" style={{ filter: 'drop-shadow(0 1px 6px rgba(0,0,0,0.25))' }} />
          <div class="relative text-[14px] font-semibold mb-1" style={{ color: '#ffffff', textShadow: etheme.textShadow }}>
            No {etheme.label.toLowerCase()} yet
          </div>
          <div class="relative text-[11px] mb-4" style={{ color: 'rgba(255,255,255,0.85)', textShadow: etheme.textShadow }}>
            Nikki composes briefs five times a day — morning, noon, afternoon, evening, night.
            Generate one now to preview.
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            class="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: '#1f2937', backdropFilter: 'blur(4px)' }}
          >
            {generating ? <Loader2 size={13} class="animate-spin" /> : <Sparkles size={13} />}
            {generating ? 'Composing…' : 'Generate brief now'}
          </button>
        </div>
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

  // Pick the theme. New brief rows carry brief_kind directly; older rows
  // (pre-migration) fall back to morning. Previews use the current hour
  // so they preview as the right time-of-day theme.
  const kind: BriefKind = previewBody
    ? themeFromCurrentHour()
    : (latest?.brief_kind || 'morning');
  const theme = THEME_BY_KIND[kind];
  const HeroIcon = theme.icon;

  return (
    <div
      class="rounded-xl border overflow-hidden shadow-sm"
      style={{
        borderColor: theme.accentRing,
        boxShadow: `0 1px 2px rgba(0,0,0,0.04), 0 8px 30px ${theme.accentRing.replace('0.6', '0.15').replace('0.65', '0.18').replace('0.7', '0.20')}`,
      }}
    >
      {/* Hero — gradient + decoration + headline */}
      <div class="relative px-5 pt-5 pb-6 overflow-hidden" style={{ background: theme.gradient }}>
        <Decoration kind={kind} />

        <div class="relative flex items-start justify-between mb-3">
          <div class="flex items-center gap-2.5">
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center shadow"
              style={{ background: `linear-gradient(135deg, ${theme.badgeFrom}, ${theme.badgeTo})` }}
            >
              <HeroIcon size={17} class="text-white" />
            </div>
            <div>
              <div
                class="text-[10px] uppercase tracking-[0.14em] font-semibold"
                style={{ color: 'rgba(255,255,255,0.85)', textShadow: theme.textShadow }}
              >
                {previewBody ? `Preview · ${theme.label}` : theme.label}
              </div>
              <div
                class="text-[14px] font-semibold leading-tight"
                style={{ color: '#ffffff', textShadow: theme.textShadow }}
              >
                {weekday}, <span style={{ color: 'rgba(255,255,255,0.78)', fontWeight: 400 }}>{long.replace(weekday + ', ', '')}</span>
              </div>
            </div>
          </div>
          <div class="relative flex items-center gap-2">
            <span
              class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: 'rgba(255,255,255,0.85)',
                color: status.color,
                backdropFilter: 'blur(4px)',
              }}
            >
              <span class="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
              {status.label}
            </span>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              title="Generate a fresh preview"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(255,255,255,0.75)',
                color: '#1f2937',
                backdropFilter: 'blur(4px)',
              }}
            >
              {generating ? <Loader2 size={11} class="animate-spin" /> : <Sparkles size={11} />}
              {generating ? '…' : 'New'}
            </button>
          </div>
        </div>

        {/* Headline — sits on glass overlay so it reads against any backdrop */}
        <div
          class="relative text-[18px] leading-snug font-semibold tracking-[-0.01em]"
          style={{ color: '#ffffff', textShadow: theme.textShadow }}
        >
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

        {(() => {
          // Dedupe the recent strip to one chip per unique date. When a day
          // has multiple briefs (e.g. previews + the real 7am brief), prefer
          // the one with the strongest status: sent > failed > preview > pending.
          // Hide the strip entirely if we only have one unique date so far
          // (otherwise it's just noise — a row of identical "today" chips).
          const STATUS_RANK: Record<DailyBriefRow['send_status'], number> = {
            sent: 4, failed: 3, preview: 2, pending: 1,
          };
          const byDate = new Map<string, RecentRow>();
          for (const r of recent) {
            const existing = byDate.get(r.brief_date);
            if (!existing) { byDate.set(r.brief_date, r); continue; }
            const beatsByStatus = STATUS_RANK[r.send_status] > STATUS_RANK[existing.send_status];
            const beatsByRecency = STATUS_RANK[r.send_status] === STATUS_RANK[existing.send_status]
              && r.generated_at > existing.generated_at;
            if (beatsByStatus || beatsByRecency) byDate.set(r.brief_date, r);
          }
          const uniqueDays = Array.from(byDate.values())
            .sort((a, b) => b.generated_at - a.generated_at);
          if (uniqueDays.length < 2) return null;
          return (
            <div class="flex items-center gap-1.5 flex-wrap pt-2 border-t border-[var(--color-border)]">
              <span class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mr-1">Recent</span>
              {uniqueDays.slice(0, 10).map(r => (
                <RecentChip
                  key={r.id}
                  row={r}
                  isActive={!previewBody && r.id === latest?.id}
                  onClick={() => { /* future: load this brief into the main view */ }}
                />
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
