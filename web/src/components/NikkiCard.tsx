// Inline Nikki chat card for the Founder Dashboard.
//
// Sits beside the Stocks + News tiles in the same row. Shows her avatar,
// online status, headline stats, the last few exchanges in this chat,
// and a one-line input that fires a /api/chat/send and watches for her
// reply on the existing chat SSE stream.
//
// Reuses the same auth + chat plumbing as the Mission Control page —
// nothing new server-side. Stats come from /api/agents (turns, model,
// running, telegramConnected) and /api/health (contextPct).

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Send, RotateCcw, ExternalLink, Loader2 } from 'lucide-preact';
import { Link } from 'wouter-preact';
import { AgentAvatar } from '@/components/AgentAvatar';
import { useFetch } from '@/lib/useFetch';
import { apiPost, dashboardToken } from '@/lib/api';
import { subscribeChatStream } from '@/lib/chat-stream';

interface Agent {
  id: string;
  name: string;
  model: string;
  running: boolean;
  todayTurns: number;
  todayCost: number;
  telegramConnected: boolean;
}
interface Health { contextPct: number; turns: number; }

interface ChatMsg {
  id: string;            // local id for keying
  role: 'user' | 'assistant';
  text: string;
  ts: number;            // epoch ms
}

const NIKKI_ID = 'main';

// Short model label for the status strip.
function shortModel(m: string): string {
  if (!m) return '—';
  return m
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/^opus/, 'Opus')
    .replace(/^sonnet/, 'Sonnet')
    .replace(/^haiku/, 'Haiku');
}

export function NikkiCard() {
  const agents = useFetch<{ agents: Agent[] }>('/api/agents', 30_000);
  const health = useFetch<Health>('/api/health', 30_000);

  const nikki = useMemo(
    () => agents.data?.agents.find(a => a.id === NIKKI_ID),
    [agents.data],
  );

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);

  // Subscribe to the global chat SSE stream
  useEffect(() => {
    const unsubscribe = subscribeChatStream((eventName, data) => {
      if (eventName === 'processing') {
        setProcessing(!!data?.processing);
      } else if (eventName === 'user_message') {
        const text = String(data?.message || data?.text || '').trim();
        if (!text) return;
        setMessages(prev => [
          ...prev,
          { id: `u-${Date.now()}-${Math.random()}`, role: 'user', text, ts: Date.now() },
        ]);
      } else if (eventName === 'assistant_message') {
        const text = String(data?.message || data?.text || '').trim();
        if (!text) return;
        setMessages(prev => [
          ...prev,
          { id: `a-${Date.now()}-${Math.random()}`, role: 'assistant', text, ts: Date.now() },
        ]);
      }
    });
    return unsubscribe;
  }, []);

  // Auto-scroll on new messages or processing flip
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages.length, processing]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Optimistic append — the SSE user_message event will also fire,
    // but we want instant feedback. The de-dupe below catches the echo.
    const localId = `u-local-${Date.now()}`;
    setMessages(prev => [...prev, { id: localId, role: 'user', text, ts: Date.now() }]);
    setDraft('');
    try {
      await apiPost('/api/chat/send', { message: text, agent_id: NIKKI_ID });
    } catch (e: any) {
      setMessages(prev => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', text: `(send failed: ${e?.message || e})`, ts: Date.now() },
      ]);
    } finally {
      setSending(false);
    }
  }

  // De-dupe consecutive identical user messages (optimistic + SSE echo)
  const visibleMessages = useMemo(() => {
    const out: ChatMsg[] = [];
    for (const m of messages) {
      const last = out[out.length - 1];
      if (last && last.role === m.role && last.text === m.text && Math.abs(m.ts - last.ts) < 5_000) continue;
      out.push(m);
    }
    return out.slice(-20);
  }, [messages]);

  const running = !!nikki?.running;
  const online = running && (nikki?.telegramConnected ?? true);

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col" style={{ minHeight: '420px' }}>
      {/* Header: avatar + name + online dot */}
      <div class="flex items-start gap-3 mb-3">
        <AgentAvatar agentId={NIKKI_ID} name={nikki?.name || 'Nikki'} size={44} running={running} />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <div class="text-[14px] font-semibold text-[var(--color-text)]">{nikki?.name || 'Nikki'}</div>
            <span
              class="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: online ? '#16a34a' : '#9ca3af' }}
              title={online ? 'Online' : running ? 'Running, Telegram offline' : 'Offline'}
            />
            <span class="text-[10px] uppercase tracking-wide" style={{ color: online ? '#16a34a' : 'var(--color-text-faint)' }}>
              {online ? 'online' : running ? 'partial' : 'offline'}
            </span>
          </div>
          <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5 truncate">Personal AI · Telegram + dashboard</div>
        </div>
        <Link href="/chat">
          <a class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]" title="Open full chat">
            <ExternalLink size={14} />
          </a>
        </Link>
      </div>

      {/* Stats strip */}
      <div class="grid grid-cols-3 gap-2 mb-3 text-center">
        <div>
          <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Model</div>
          <div class="text-[12px] font-semibold text-[var(--color-text)] tabular-nums">{shortModel(nikki?.model || '')}</div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Context</div>
          <div class="text-[12px] font-semibold text-[var(--color-text)] tabular-nums">
            {health.data ? `${health.data.contextPct}%` : '—'}
          </div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Today</div>
          <div class="text-[12px] font-semibold text-[var(--color-text)] tabular-nums">
            {nikki?.todayTurns ?? 0} turns
          </div>
        </div>
      </div>

      {/* Chat thread */}
      <div
        ref={scrollerRef}
        class="flex-1 overflow-y-auto border-t border-[var(--color-border)] pt-2 mb-2 space-y-2"
        style={{ minHeight: '120px', maxHeight: '260px' }}
      >
        {visibleMessages.length === 0 ? (
          <div class="text-[11px] text-[var(--color-text-faint)] italic">
            No recent exchange. Say hi 👋
          </div>
        ) : (
          visibleMessages.map(m => (
            <div
              key={m.id}
              class={`text-[12px] leading-snug ${m.role === 'user' ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}
            >
              <span class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mr-1.5">
                {m.role === 'user' ? 'You' : 'Nikki'}
              </span>
              {m.text}
            </div>
          ))
        )}
        {processing && (
          <div class="text-[11px] text-[var(--color-text-faint)] flex items-center gap-1.5">
            <Loader2 size={11} class="animate-spin" />
            Nikki is thinking…
          </div>
        )}
      </div>

      {/* Input */}
      <div class="flex items-center gap-2 border-t border-[var(--color-border)] pt-2">
        <input
          type="text"
          value={draft}
          onInput={(e: any) => setDraft(e.target.value)}
          onKeyDown={(e: any) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={running ? 'Ask Nikki…' : 'Nikki is offline'}
          disabled={!running || sending}
          class="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1.5 text-[12px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!running || sending || !draft.trim()}
          class="inline-flex items-center justify-center w-7 h-7 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Send"
        >
          {sending ? <Loader2 size={13} class="animate-spin" /> : <Send size={13} />}
        </button>
      </div>
      <div class="text-[10px] text-[var(--color-text-faint)] mt-1.5 flex items-center justify-between">
        <span>{nikki?.telegramConnected ? 'Telegram connected' : 'Telegram offline'}</span>
        <button
          type="button"
          onClick={() => { setMessages([]); agents.refresh(); health.refresh(); }}
          class="text-[var(--color-text-faint)] hover:text-[var(--color-text)] inline-flex items-center gap-1"
          title="Clear & refresh"
        >
          <RotateCcw size={10} />
          clear
        </button>
      </div>
    </div>
  );
}
