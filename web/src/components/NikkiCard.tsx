// Inline Nikki chat card for the Founder Dashboard.
//
// Now wired to the same ElevenLabs cascade Telegram and WarRoom use, so
// Nikki sounds the same on every channel. The voice picker lists the
// user's ElevenLabs female voices (plus the currently-selected one even
// if it lives in the public library). Picking a voice updates the
// stored selection on the Fly volume — applies instantly to Telegram
// and WarRoom too.
//
// Voice flow:
//   • mic button — Web Speech API, transcribes locally, auto-sends on stop.
//   • speaker toggle — when on, /api/chat/tts converts her latest reply to
//     MP3 via the cascade and plays it through an <audio> element.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Send, RotateCcw, ExternalLink, Loader2, Mic, MicOff, Volume2, VolumeX, Settings, Play } from 'lucide-preact';
import { Link } from 'wouter-preact';
import { AgentAvatar } from '@/components/AgentAvatar';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiGet, chatId, dashboardToken } from '@/lib/api';
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
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

interface ElevenVoice {
  voiceId: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  previewUrl: string | null;
  description: string;
}
interface VoiceListResp {
  voices: ElevenVoice[];
  selectedVoiceId: string;
  error?: string;
}

const NIKKI_ID = 'main';
const LS_SPEAKER = 'claudeclaw.nikki.speaker';

function shortModel(m: string): string {
  if (!m) return '—';
  return m
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/^opus/, 'Opus')
    .replace(/^sonnet/, 'Sonnet')
    .replace(/^haiku/, 'Haiku');
}

function plainForSpeech(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSpeechRecognition(): any | null {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function NikkiCard() {
  const agents = useFetch<{ agents: Agent[] }>('/api/agents', 30_000);
  const health = useFetch<Health>('/api/health', 30_000);
  const voiceList = useFetch<VoiceListResp>('/api/voices/elevenlabs', 0);

  const nikki = useMemo(
    () => agents.data?.agents.find(a => a.id === NIKKI_ID),
    [agents.data],
  );

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [speakerOn, setSpeakerOn] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_SPEAKER) === '1'; } catch { return false; }
  });
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [voiceSwitching, setVoiceSwitching] = useState(false);

  const lastSpokenIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // -------- History hydration --------
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
        const lastAssistant = [...seeded].reverse().find(m => m.role === 'assistant');
        if (lastAssistant) lastSpokenIdRef.current = lastAssistant.id;
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, []);

  // -------- Live SSE --------
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
        setMessages(prev => [
          ...prev,
          { id: `a-${Date.now()}-${Math.random()}`, role: 'assistant', text, ts: Date.now() },
        ]);
        setProcessing(false);
        agents.refresh();
        health.refresh();
      }
    });
    return unsubscribe;
  }, []);

  // -------- TTS playback via /api/chat/tts --------
  async function speak(text: string) {
    if (typeof window === 'undefined') return;
    try {
      // Stop any in-flight audio + reuse the same element
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      } else {
        audioRef.current = new Audio();
      }
      const r = await fetch(`/api/chat/tts?token=${encodeURIComponent(dashboardToken)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) {
        const err = await r.text().catch(() => `HTTP ${r.status}`);
        setVoiceError(`TTS failed: ${err.slice(0, 120)}`);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = audioRef.current!;
      audio.src = url;
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => { URL.revokeObjectURL(url); setVoiceError('Audio playback failed'); };
      await audio.play();
    } catch (e: any) {
      setVoiceError(`Voice playback error: ${e?.message || e}`);
    }
  }

  // Auto-speak new assistant messages when speaker is on
  useEffect(() => {
    if (!speakerOn) return;
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return;
    if (lastSpokenIdRef.current === lastAssistant.id) return;
    lastSpokenIdRef.current = lastAssistant.id;
    speak(plainForSpeech(lastAssistant.text));
  }, [messages, speakerOn]);

  // Stop any audio when speaker is turned off / unmount
  useEffect(() => {
    if (!speakerOn && audioRef.current) {
      audioRef.current.pause();
    }
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    };
  }, [speakerOn]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages.length, processing]);

  // -------- Send --------
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

  // -------- Voice input --------
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

  // -------- Voice picker actions --------
  async function selectVoice(voiceId: string) {
    setVoiceSwitching(true);
    setVoiceError(null);
    try {
      await apiPost('/api/voices/elevenlabs/selected', { voiceId });
      voiceList.refresh();
      // Preview the new voice immediately if speaker is on
      if (speakerOn) {
        const v = voiceList.data?.voices.find(x => x.voiceId === voiceId);
        const name = v?.name?.split(' ')[0] || 'this voice';
        await speak(`Hi, I'm Nikki, now using ${name}.`);
      }
    } catch (e: any) {
      setVoiceError(`Could not switch voice: ${e?.message || e}`);
    } finally {
      setVoiceSwitching(false);
    }
  }

  async function previewVoice(voiceId: string) {
    // Optimistically switch + speak; user can switch back if they don't like it
    await selectVoice(voiceId);
  }

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
  const voices = voiceList.data?.voices || [];
  const selectedVoiceId = voiceList.data?.selectedVoiceId || '';
  const selectedVoice = voices.find(v => v.voiceId === selectedVoiceId);

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col" style={{ minHeight: '440px' }}>
      {/* Header */}
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
          <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5 truncate">
            Personal AI · {selectedVoice ? `voice: ${selectedVoice.name}` : 'Telegram + dashboard'}
          </div>
        </div>
        <div class="relative inline-flex items-center gap-0.5">
          <button
            type="button"
            onClick={toggleSpeaker}
            onContextMenu={(e: any) => { e.preventDefault(); setVoicePickerOpen(v => !v); }}
            class={`inline-flex items-center justify-center w-7 h-7 rounded transition-colors ${
              speakerOn
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
            }`}
            title={`${speakerOn ? 'Voice ON' : 'Voice OFF'} (right-click for voice picker)`}
            aria-label={speakerOn ? 'Disable voice replies' : 'Enable voice replies'}
          >
            {speakerOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button
            type="button"
            onClick={() => setVoicePickerOpen(v => !v)}
            class="inline-flex items-center justify-center w-5 h-7 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
            title="Choose voice"
            aria-label="Choose voice"
          >
            <Settings size={11} />
          </button>
        </div>
        <Link href="/chat">
          <a class="text-[var(--color-text-faint)] hover:text-[var(--color-text)] inline-flex items-center" title="Open full chat">
            <ExternalLink size={14} />
          </a>
        </Link>
      </div>

      {/* Voice picker (ElevenLabs female voices) */}
      {voicePickerOpen && (
        <div class="mb-3 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] p-2">
          <div class="flex items-center justify-between mb-1.5">
            <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
              ElevenLabs · female voices ({voices.length})
            </div>
            <button
              type="button"
              onClick={() => setVoicePickerOpen(false)}
              class="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
            >
              close
            </button>
          </div>
          {voiceList.loading && !voiceList.data ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">Loading voices…</div>
          ) : voiceList.error ? (
            <div class="text-[11px] text-[#dc2626]">Voice list unavailable ({String(voiceList.error)})</div>
          ) : voices.length === 0 ? (
            <div class="text-[11px] text-[var(--color-text-faint)]">
              No female voices in your ElevenLabs library. Add some at elevenlabs.io → Voices → Library.
            </div>
          ) : (
            <div class="flex items-center gap-1.5">
              <select
                value={selectedVoiceId}
                onChange={(e: any) => selectVoice(e.target.value)}
                disabled={voiceSwitching}
                class="flex-1 bg-[var(--color-card)] border border-[var(--color-border)] rounded px-1.5 py-1 text-[11px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
              >
                {voices.map(v => {
                  const accent = v.labels?.accent ? ` · ${v.labels.accent}` : '';
                  const age = v.labels?.age ? ` · ${v.labels.age}` : '';
                  return (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name}{accent}{age}{v.category === 'custom' ? ' (current)' : ''}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => selectedVoiceId && previewVoice(selectedVoiceId)}
                disabled={!selectedVoiceId || voiceSwitching}
                class="inline-flex items-center justify-center w-6 h-6 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:opacity-80 disabled:opacity-40"
                title="Preview & lock in"
                aria-label="Preview"
              >
                {voiceSwitching ? <Loader2 size={11} class="animate-spin" /> : <Play size={11} />}
              </button>
            </div>
          )}
          <div class="text-[10px] text-[var(--color-text-faint)] mt-1.5">
            Change applies instantly to Telegram, WarRoom, and dashboard chat.
          </div>
        </div>
      )}

      {/* Stats */}
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
          <div class="text-[11px] text-[var(--color-text-faint)] italic">No recent exchange. Say hi 👋</div>
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

      {voiceError && <div class="text-[10px] text-[#dc2626] mb-1">{voiceError}</div>}

      {/* Input row */}
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
          onClick={() => { setMessages([]); agents.refresh(); health.refresh(); voiceList.refresh(); }}
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
