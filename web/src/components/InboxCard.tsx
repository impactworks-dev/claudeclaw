// Inbox card for the Founder Dashboard.
//
// Shows the top N unread emails with sender, subject, snippet, age.
// Click any row to open the thread in a modal. Read-only — no sending.
// "All inbox" link in the header points to a future /inbox page (TBD).

import { useState } from 'preact/hooks';
import { Inbox, Mail, AlertTriangle, ExternalLink, X, Clock, RefreshCw } from 'lucide-preact';
import { useFetch } from '@/lib/useFetch';
import { apiGet } from '@/lib/api';

interface EmailRow {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  date: string;
  receivedAt: number;
  unread: boolean;
  ageHours: number;
  hasUrgentKeyword: boolean;
}

interface InboxResponse {
  asOf: number;
  emails: EmailRow[];
  configured: boolean;
  error?: string;
}

interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string;
}
interface ThreadDetail { threadId: string; messages: ThreadMessage[] }

function relTime(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  const m = Math.floor(delta / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function EmailRowView({ e, onClick }: { e: EmailRow; onClick: () => void }) {
  const who = e.fromName || e.fromEmail.split('@')[0];
  return (
    <button
      type="button"
      onClick={onClick}
      class={`group w-full text-left flex items-start gap-2.5 py-2 px-2 -mx-2 rounded hover:bg-[var(--color-elevated)] border-b border-[var(--color-border)] last:border-b-0 transition-colors`}
    >
      <span class={`mt-1 shrink-0 inline-block w-1.5 h-1.5 rounded-full ${e.unread ? 'bg-[var(--color-accent)]' : 'bg-transparent'}`} />
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline justify-between gap-2">
          <div class={`text-[12px] truncate ${e.unread ? 'font-semibold text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>
            {who}
          </div>
          <div class="text-[10px] text-[var(--color-text-faint)] tabular-nums shrink-0 inline-flex items-center gap-1">
            {e.hasUrgentKeyword && <AlertTriangle size={9} class="text-[#ca8a04]" />}
            {relTime(e.receivedAt)}
          </div>
        </div>
        <div class={`text-[11px] truncate ${e.unread ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>
          {e.subject || '(no subject)'}
        </div>
        <div class="text-[10px] text-[var(--color-text-faint)] truncate">
          {e.snippet}
        </div>
      </div>
    </button>
  );
}

function ThreadModal({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch on mount
  if (loading && !thread && !error) {
    apiGet<ThreadDetail>(`/api/email/thread/${encodeURIComponent(threadId)}`)
      .then((r) => { setThread(r); setLoading(false); })
      .catch((e) => { setError(String(e?.message || e)); setLoading(false); });
  }

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col shadow-xl"
        onClick={(e: any) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div class="text-[12px] uppercase tracking-wide text-[var(--color-text-faint)]">Email Thread</div>
          <button type="button" onClick={onClose} class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            <X size={16} />
          </button>
        </div>
        <div class="flex-1 overflow-auto p-4">
          {loading && <div class="text-[12px] text-[var(--color-text-faint)]">Loading…</div>}
          {error && <div class="text-[12px] text-[#dc2626]">Error: {error}</div>}
          {thread && thread.messages.map((m, i) => (
            <div key={m.id} class={i > 0 ? 'mt-4 pt-4 border-t border-[var(--color-border)]' : ''}>
              <div class="text-[13px] font-semibold text-[var(--color-text)] mb-1">{m.subject || '(no subject)'}</div>
              <div class="text-[11px] text-[var(--color-text-muted)] mb-2">
                <span class="font-medium text-[var(--color-text)]">{m.from}</span> · {m.date}
              </div>
              {m.bodyText ? (
                <pre class="text-[12px] text-[var(--color-text)] whitespace-pre-wrap font-sans leading-relaxed">{m.bodyText.slice(0, 8000)}</pre>
              ) : m.bodyHtml ? (
                <div class="text-[12px] text-[var(--color-text)] leading-relaxed" dangerouslySetInnerHTML={{ __html: m.bodyHtml.slice(0, 50000) }} />
              ) : (
                <div class="text-[12px] text-[var(--color-text-muted)] italic">{m.snippet || '(no body)'}</div>
              )}
            </div>
          ))}
        </div>
        <div class="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-faint)] flex items-center justify-between">
          <span>Read-only · Reply from Gmail directly</span>
          <a
            href={`https://mail.google.com/mail/u/0/#inbox/${threadId}`}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
          >
            Open in Gmail <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  );
}

export function InboxCard() {
  const { data, loading, error, refresh, refreshing } = useFetch<InboxResponse>('/api/email/inbox?limit=15', 2 * 60_000);
  const [openThread, setOpenThread] = useState<string | null>(null);

  const emails = data?.emails || [];
  const unreadCount = emails.filter(e => e.unread).length;

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Inbox size={14} class="text-[var(--color-text-faint)]" />
          <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">Inbox</div>
          {unreadCount > 0 && (
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div class="flex items-center gap-2">
          {data && (
            <span class="text-[10px] text-[var(--color-text-faint)]">
              updated {new Date(data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={() => refresh()}
            disabled={refreshing}
            class="text-[var(--color-text-faint)] hover:text-[var(--color-text)] disabled:opacity-50"
            title="Refresh inbox"
          >
            <RefreshCw size={11} class={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">Loading inbox…</div>
      ) : error ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">Inbox unavailable ({String(error)})</div>
      ) : data && !data.configured ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">Gmail not configured yet.</div>
      ) : data && data.error ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">Inbox error: {data.error}</div>
      ) : emails.length === 0 ? (
        <div class="text-[11px] text-[var(--color-text-faint)] flex items-center gap-2 py-4 justify-center">
          <Mail size={14} /> Inbox zero. Beautiful.
        </div>
      ) : (
        <div class="space-y-0 max-h-[360px] overflow-auto">
          {emails.map(e => (
            <EmailRowView key={e.id} e={e} onClick={() => setOpenThread(e.threadId)} />
          ))}
        </div>
      )}

      <div class="text-[10px] text-[var(--color-text-faint)] mt-2 pt-2 border-t border-[var(--color-border)] flex items-center justify-between">
        <span class="inline-flex items-center gap-1"><Clock size={10} /> 2 min cache · read-only</span>
        <a
          href="https://mail.google.com/mail/u/0/#inbox"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
        >
          Gmail <ExternalLink size={10} />
        </a>
      </div>

      {openThread && <ThreadModal threadId={openThread} onClose={() => setOpenThread(null)} />}
    </div>
  );
}
