// Calendar tile for the Founder Dashboard. Shows today's events from the
// Google Calendar API (via the gcal-cli backend). Click an event title to
// open the underlying Google Calendar entry in a new tab.

import { Calendar, ArrowRight, Users, MapPin, ExternalLink } from 'lucide-preact';
import { Link } from 'wouter-preact';
import { useFetch } from '@/lib/useFetch';

interface CalEvent {
  id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  status: string | null;
  organizer: string | null;
  attendees: Array<{ email: string | null; name: string | null; response: string | null }>;
  hangoutLink: string | null;
  htmlLink: string | null;
}

interface CalendarSummary {
  asOf: number;
  configured: boolean;
  connectionStatus: 'ok' | 'no-credentials' | 'error';
  connectionMessage: string | null;
  range: 'today' | 'week';
  count: number;
  events: CalEvent[];
}

function fmtTime(iso: string | null, allDay: boolean): string {
  if (allDay) return 'All day';
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtRange(start: string | null, end: string | null, allDay: boolean): string {
  if (allDay) return 'All day';
  if (!start) return '—';
  const s = new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!end) return s;
  const e = new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${s} – ${e}`;
}

function CalRow({ ev }: { ev: CalEvent }) {
  const attendees = ev.attendees.filter(a => a.email || a.name).slice(0, 2);
  const titleEl = ev.htmlLink ? (
    <a
      href={ev.htmlLink}
      target="_blank"
      rel="noopener noreferrer"
      class="text-[var(--color-text)] font-semibold hover:underline truncate inline-flex items-center gap-1"
    >
      {ev.title || '(untitled)'}
      <ExternalLink size={9} class="text-[var(--color-text-faint)] shrink-0" />
    </a>
  ) : (
    <span class="text-[var(--color-text)] font-semibold truncate">{ev.title || '(untitled)'}</span>
  );

  return (
    <div class="py-1.5 px-1 -mx-1 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-elevated)] rounded">
      <div class="flex items-baseline justify-between gap-2">
        <div class="text-[11px] text-[var(--color-text-muted)] tabular-nums shrink-0 w-[78px]">
          {fmtRange(ev.start, ev.end, ev.allDay)}
        </div>
        <div class="flex-1 min-w-0 text-[12px] truncate">{titleEl}</div>
        {ev.hangoutLink && (
          <a
            href={ev.hangoutLink}
            target="_blank"
            rel="noopener noreferrer"
            class="text-[10px] text-[var(--color-accent)] hover:underline shrink-0"
          >
            join
          </a>
        )}
      </div>
      {(attendees.length > 0 || ev.location) && (
        <div class="ml-[78px] text-[10px] text-[var(--color-text-faint)] mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {attendees.length > 0 && (
            <span class="inline-flex items-center gap-1 min-w-0">
              <Users size={10} />
              <span class="truncate">{attendees.map(a => a.name || a.email).join(', ')}</span>
            </span>
          )}
          {ev.location && (
            <span class="inline-flex items-center gap-1 min-w-0">
              <MapPin size={10} />
              <span class="truncate">{ev.location.slice(0, 32)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function CalendarTile() {
  const { data, loading, error } = useFetch<CalendarSummary>('/api/calendar', 2 * 60_000);

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Calendar size={14} class="text-[var(--color-text-faint)]" />
          <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Today's Calendar
          </div>
        </div>
        <div class="flex items-center gap-2">
          {data && (
            <span class="text-[10px] text-[var(--color-text-faint)]">
              {data.count} event{data.count === 1 ? '' : 's'}
            </span>
          )}
          <Link href="/scheduled">
            <a class="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
              week <ArrowRight size={10} />
            </a>
          </Link>
        </div>
      </div>

      {loading && !data ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">Loading calendar…</div>
      ) : error ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">Calendar unavailable ({String(error)})</div>
      ) : data && data.connectionStatus === 'no-credentials' ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">
          Google Calendar not authorized yet.
        </div>
      ) : data && data.connectionStatus === 'error' ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">
          Calendar error: {data.connectionMessage}
        </div>
      ) : data && data.events.length > 0 ? (
        <div class="space-y-0 max-h-[260px] overflow-auto">
          {data.events.map((ev, i) => <CalRow key={ev.id || i} ev={ev} />)}
        </div>
      ) : (
        <div class="text-[11px] text-[var(--color-text-faint)]">No events on the books today.</div>
      )}

      <div class="text-[10px] text-[var(--color-text-faint)] mt-2 pt-2 border-t border-[var(--color-border)]">
        Source: Google Calendar (dante@impactworks.com) · refreshes every 2 min · click a title to open in Google.
      </div>
    </div>
  );
}
