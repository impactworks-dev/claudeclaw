// Inline Nikki chat card for the Founder Dashboard.
//
// Sits beside the Stocks + News tiles in the same row. Shows her avatar,
// online status, headline stats, the last few exchanges in this chat,
// and a one-line input that fires a /api/chat/send and watches for her
// reply on the existing chat SSE stream.
//
// Voice mode (toggle in the header):
//   • mic button — tap to start, tap to stop. Uses the browser's Web
//     Speech API (SpeechRecognition / webkitSpeechRecognition). Final
//     transcript fills the input box; user can review and hit send,
//     or auto-send when the recogniser closes (we let the user decide
//     by pressing the send button — keeps voice friendly without
//     surprises).
//   • speaker toggle — when on, Nikki's replies are read aloud via
//     SpeechSynthesisUtterance. State persists in localStorage.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Send, RotateCcw, ExternalLink, Loader2, Mic, MicOff, Volume2, VolumeX, Settings, Play } from 'lucide-preact';
import { Link } from 'wouter-preact';
import { AgentAvatar } from '@/components/AgentAvatar';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiGet, chatId } from '@/lib/api';
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

interface HistoryTurn { role: 'user' | 'assistant'; content: string; source?: string; created_at?: number; }

interface ChatMsg {
  id: string;            // local id for keying + de-dupe
  role: 'user' | 'assistant';
  text: string;
  ts: number;            // epoch ms
}

const NIKKI_ID = 'main';
const LS_SPEAKER = 'claudeclaw.nikki.speaker';
const LS_VOICE = 'claudeclaw.nikki.voice';

// Try to pick a sensible default voice. Strategy:
//   1. macOS "Premium" / "Enhanced" voices sound dramatically better than the
//      defaults and are usually pre-installed (or one-tap downloaded). Prefer
//      them when available.
//   2. Known-good named voices (Samantha, Ava, Karen, Daniel) — Apple ships
//      these as quality defaults.
//   3. Any other English voice.
//   4. Whatever the browser thinks is default.
function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter(v => /^en/i.test(v.lang));
  const pool = en.length ? en : voices;
  const premium = pool.find(v => /\b(premium|enhanced|neural)\b/i.test(v.name));
  if (premium) return premium;
  const named = pool.find(v => /(Samantha|Ava|Karen|Daniel|Alex|Serena|Moira)/i.test(v.name));
  if (named) return named;
  const def = pool.find(v => v.default);
  if (def) return def;
  return pool[0];
}

// Short model label for the stats strip.
function shortModel(m: string): string {
  if (!m) return '—';
  return m
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/^opus/, 'Opus')
    .replace(/^sonnet/, 'Sonnet')
    .replace(/^haiku/, 'Haiku');
}

// Strip markdown that doesn't read well aloud (links, code fences, bold/italic/code).
function plainForSpeech(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Lazily resolve the SpeechRecognition constructor with a webkit fallback.
function getSpeechRecognition(): any | null {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
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

  // Voice state
  const [speakerOn, setSpeakerOn] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_SPEAKER) === '1'; } catch { return false; }
  });
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // TTS voice picker
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_VOICE); } catch { return null; }
  });
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  // Track the last assistant message we've already spoken so a re-render
  // (or history hydration) doesn't replay everything.
  const lastSpokenIdRef = useRef<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);

  // -------- History hydration (so a page refresh keeps the convo) --------
  useEffect(() => {
    let cancelled = false;
    apiGet<{ turns: HistoryTurn[] }>(`/api/chat/history?chatId=${encodeURIComponent(chatId)}&limit=20`)
      .then((d) => {
        if (cancelled) return;
        const seeded: ChatMsg[] = (d.turns || []).map((t, i) => ({
          id: `h-${i}-${t.created_at ?? i}`,
          role: t.role,
          text: t.content,
          ts: (t.created_at ?? Date.now() / 1000) * 1000,
        }));
        setMessages(seeded);
        // Mark the most recent assistant message as "already spoken" so
        // turning the speaker on later doesn't replay history.
        const lastAssistant = [...seeded].reverse().find(m => m.role === 'assistant');
        if (lastAssistant) lastSpokenIdRef.current = lastAssistant.id;
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, []);

  // -------- Live chat SSE stream --------
  useEffect(() => {
    const unsubscribe = subscribeChatStream((eventName, data) => {
      if (eventName === 'processing') {
        if (data?.processing !== undefined) setProcessing(!!data.processing);
      } else if (eventName === 'user_message') {
        const text = String(data?.content || '').trim();
        if (!text) return;
        setMessages(prev => [
          ...prev,
          { id: `u-${Date.now()}-${Math.random()}`, role: 'user', text, ts: Date.now() },
        ]);
      } else if (eventName === 'assistant_message') {
        const text = String(data?.content || '').trim();
        if (!text) return;
        const msg: ChatMsg = {
          id: `a-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          text,
          ts: Date.now(),
        };
        setMessages(prev => [...prev, msg]);
        setProcessing(false);
        // Refresh stats after a reply (turn count and context %).
        agents.refresh();
        health.refresh();
      }
    });
    return unsubscribe;
  }, []);

  // -------- Voice list loading --------
  //
  // SpeechSynthesis.getVoices() returns [] synchronously on Chrome before
  // the voiceschanged event fires. Safari populates immediately. We listen
  // for both cases so the dropdown is correct as soon as voices arrive.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    function refreshVoices() {
      const list = window.speechSynthesis.getVoices() || [];
      setVoices(list);
      // If no saved choice yet, seed with a sensible default
      if (list.length && !selectedVoiceURI) {
        const def = pickDefaultVoice(list);
        if (def) {
          setSelectedVoiceURI(def.voiceURI);
          try { localStorage.setItem(LS_VOICE, def.voiceURI); } catch {}
        }
      }
    }
    refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
  }, []);

  // Resolve the SpeechSynthesisVoice for the user's saved selection
  const selectedVoice = useMemo(() => {
    if (!voices.length) return null;
    if (selectedVoiceURI) {
      const hit = voices.find(v => v.voiceURI === selectedVoiceURI);
      if (hit) return hit;
    }
    return pickDefaultVoice(voices);
  }, [voices, selectedVoiceURI]);

  // English-only voice list for the picker (most voices on a Mac are non-English)
  const englishVoices = useMemo(() => {
    const en = voices.filter(v => /^en/i.test(v.lang));
    // Sort: enhanced/premium first, then alphabetical
    return en.sort((a, b) => {
      const aP = /\b(premium|enhanced|neural)\b/i.test(a.name) ? 0 : 1;
      const bP = /\b(premium|enhanced|neural)\b/i.test(b.name) ? 0 : 1;
      if (aP !== bP) return aP - bP;
      return a.name.localeCompare(b.name);
    });
  }, [voices]);

  function speak(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.0;
      utter.pitch = 1.0;
      if (selectedVoice) utter.voice = selectedVoice;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn('TTS failed', e);
    }
  }

  function pickVoice(voiceURI: string) {
    setSelectedVoiceURI(voiceURI);
    try { localStorage.setItem(LS_VOICE, voiceURI); } catch {}
    // Preview the newly-picked voice immediately
    const v = voices.find(x => x.voiceURI === voiceURI);
    if (v && speakerOn) {
      const utter = new SpeechSynthesisUtterance(`Hi, I'm Nikki. ${v.name.split(' ')[0]} speaking.`);
      utter.voice = v;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }
  }

  // -------- TTS: speak new assistant messages when speakerOn --------
  useEffect(() => {
    if (!speakerOn) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return;
    if (lastSpokenIdRef.current === lastAssistant.id) return;
    lastSpokenIdRef.current = lastAssistant.id;
    speak(plainForSpeech(lastAssistant.text));
  }, [messages, speakerOn, selectedVoice]);

  // Cancel any in-flight speech when toggling speaker off or unmounting
  useEffect(() => {
    if (!speakerOn && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [speakerOn]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages.length, processing]);

  // -------- Send message --------
  async function handleSend(textOverride?: string) {
    const text = (textOverride ?? draft).trim();
    if (!text || sending) return;
    setSending(true);
    setMessages(prev => [
      ...prev,
      { id: `u-local-${Date.now()}`, role: 'user', text, ts: Date.now() },
    ]);
    if (!textOverride) setDraft('');
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

  // -------- Voice input via Web Speech API --------
  function toggleSpeaker() {
    setSpeakerOn(v => {
      const next = !v;
      try { localStorage.setItem(LS_SPEAKER, next ? '1' : '0'); } catch {}
      return next;
    });
  }

  function startListening() {
    setVoiceError(null);
    const SR = getSpeechRecognition();
    if (!SR) {
      setVoiceError('Voice input not supported in this browser. Try Chrome or Safari.');
      return;
    }
    try {
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = '';
      rec.onresult = (ev: any) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        setDraft((finalText + interim).trim());
      };
      rec.onerror = (ev: any) => {
        setVoiceError(ev?.error ? `Voice: ${ev.error}` : 'Voice error');
        setListening(false);
      };
      rec.onend = () => {
        setListening(false);
        // If we got a final transcript, auto-send to feel like Telegram voice.
        const t = finalText.trim();
        if (t) {
          handleSend(t);
          setDraft('');
        }
      };
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch (e: any) {
      setVoiceError(e?.message || 'Could not start voice input');
      setListening(false);
    }
  }
  function stopListening() {
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
  }

  // De-dupe consecutive identical messages from the same role (optimistic + SSE echo)
  const visibleMessages = useMemo(() => {
    const out: ChatMsg[] = [];
    for (const m of messages) {
      const last = out[out.length - 1];
      if (last && last.role === m.role && last.text === m.text && Math.abs(m.ts - last.ts) < 10_000) continue;
      out.push(m);
    }
    return out.slice(-30);
  }, [messages]);

  const running = !!nikki?.running;
  const online = running && (nikki?.telegramConnected ?? true);
  const voiceSupported = getSpeechRecognition() != null;
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col" style={{ minHeight: '440px' }}>
      {/* Header: avatar + name + online dot + speaker toggle + ext link */}
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
        {ttsSupported && (
          <div class="relative">
            <button
              type="button"
              onClick={toggleSpeaker}
              onContextMenu={(e: any) => { e.preventDefault(); setVoicePickerOpen(v => !v); }}
              class={`inline-flex items-center justify-center w-7 h-7 rounded transition-colors ${
                speakerOn
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
              }`}
              title={`${speakerOn ? 'Voice ON' : 'Voice OFF'} (right-click to choose voice)`}
              aria-label={speakerOn ? 'Disable voice replies' : 'Enable voice replies'}
            >
              {speakerOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
            {speakerOn && (
              <button
                type="button"
                onClick={() => setVoicePickerOpen(v => !v)}
                class="ml-1 inline-flex items-center justify-center w-5 h-7 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] align-middle"
                title="Choose voice"
                aria-label="Choose voice"
              >
                <Settings size={11} />
              </button>
            )}
          </div>
        )}
        <Link href="/chat">
          <a class="text-[var(--color-text-faint)] hover:text-[var(--color-text)] inline-flex items-center" title="Open full chat">
            <ExternalLink size={14} />
          </a>
        </Link>
      </div>

      {/* Voice picker — opens when user clicks the settings cog next to the speaker */}
      {voicePickerOpen && ttsSupported && (
        <div class="mb-3 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] p-2">
          <div class="flex items-center justify-between mb-1.5">
            <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
              Voice ({englishVoices.length} available)
            </div>
            <button
              type="button"
              onClick={() => setVoicePickerOpen(false)}
              class="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
            >
              close
            </button>
          </div>
          {englishVoices.length === 0 ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">Loading voices…</div>
          ) : (
            <div class="flex items-center gap-1.5">
              <select
                value={selectedVoiceURI || ''}
                onChange={(e: any) => pickVoice(e.target.value)}
                class="flex-1 bg-[var(--color-card)] border border-[var(--color-border)] rounded px-1.5 py-1 text-[11px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              >
                {englishVoices.map(v => {
                  const enhanced = /\b(premium|enhanced|neural)\b/i.test(v.name);
                  return (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {enhanced ? '✨ ' : ''}{v.name} ({v.lang})
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => selectedVoice && speak(`Hi, I'm Nikki. ${selectedVoice.name.split(' ')[0]} speaking.`)}
                disabled={!selectedVoice}
                class="inline-flex items-center justify-center w-6 h-6 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:opacity-80 disabled:opacity-40"
                title="Preview"
                aria-label="Preview voice"
              >
                <Play size={11} />
              </button>
            </div>
          )}
          <div class="text-[10px] text-[var(--color-text-faint)] mt-1.5">
            ✨ = system-enhanced voice. macOS users: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices to download more.
          </div>
        </div>
      )}

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

      {/* Voice error banner */}
      {voiceError && (
        <div class="text-[10px] text-[#dc2626] mb-1">{voiceError}</div>
      )}

      {/* Input row: mic + text + send */}
      <div class="flex items-center gap-2 border-t border-[var(--color-border)] pt-2">
        {voiceSupported && (
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={!running || sending}
            class={`inline-flex items-center justify-center w-7 h-7 rounded transition-colors ${
              listening
                ? 'bg-[#dc2626] text-white animate-pulse'
                : 'bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={listening ? 'Stop listening' : 'Start voice input'}
            aria-label={listening ? 'Stop listening' : 'Start voice input'}
          >
            {listening ? <MicOff size={13} /> : <Mic size={13} />}
          </button>
        )}
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
          placeholder={listening ? 'Listening…' : running ? 'Ask Nikki…' : 'Nikki is offline'}
          disabled={!running || sending}
          class="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1.5 text-[12px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => handleSend()}
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
