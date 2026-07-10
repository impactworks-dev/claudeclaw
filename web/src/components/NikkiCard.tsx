// Inline Nikki chat card for the Founder Dashboard.
//
// Voice modes:
//   • mic button (Web Speech API) — transcribes locally, auto-sends on stop.
//   • speaker toggle — ElevenLabs TTS plays her latest reply as MP3.
//   • Live button — full-duplex Gemini Live voice: 16kHz PCM mic → WebSocket
//     → Gemini Live → 24kHz PCM playback with jitter-free scheduling.

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Send, RotateCcw, ExternalLink, Loader2, Mic, MicOff, Volume2, VolumeX, Settings, Play, Paperclip, X, Phone, PhoneOff } from 'lucide-preact';
import { Link } from 'wouter-preact';
import { AgentAvatar } from '@/components/AgentAvatar';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiGet, chatId, dashboardToken } from '@/lib/api';
import { subscribeChatStream } from '@/lib/chat-stream';
import { renderMarkdown } from '@/lib/markdown';

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
  sources?: { wikiPaths?: string[]; memoryIds?: number[] };
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

// ── Liquid blob visualizer ──────────────────────────────────────────────────
function drawLiveBlob(
  ctx2d: CanvasRenderingContext2D,
  w: number,
  h: number,
  playAmp: number,
  micAmp: number,
) {
  const t = Date.now();
  ctx2d.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const baseR = Math.min(w, h) * 0.34;
  const nikkiTalking = playAmp > 0.008;
  const micActive = micAmp > 0.005;

  const pts = 10;
  const coords: [number, number][] = [];
  for (let i = 0; i < pts; i++) {
    const angle = (i / pts) * Math.PI * 2 - Math.PI / 2;
    const phase = i * 2.39996; // golden angle for even distribution
    const morph =
      Math.sin(t / 700 + phase) * 0.55 +
      Math.sin(t / 430 + phase * 1.7) * 0.35 +
      Math.cos(t / 290 + phase * 0.8) * 0.10;

    let drive: number;
    if (nikkiTalking)  drive = playAmp * 95 + micAmp * 30;
    else if (micActive) drive = micAmp * 55;
    else               drive = 5; // gentle idle breathing

    const r = baseR + morph * (drive + 6);
    coords.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }

  // Catmull-Rom → bezier: smooth closed organic curve
  ctx2d.beginPath();
  for (let i = 0; i < pts; i++) {
    const p0 = coords[(i - 1 + pts) % pts];
    const p1 = coords[i];
    const p2 = coords[(i + 1) % pts];
    const p3 = coords[(i + 2) % pts];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    if (i === 0) ctx2d.moveTo(p1[0], p1[1]);
    ctx2d.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
  ctx2d.closePath();

  // Radial fill — brighter purple when Nikki speaks
  const intensity = nikkiTalking ? 0.95 : micActive ? 0.75 : 0.60;
  const grd = ctx2d.createRadialGradient(cx, cy - baseR * 0.15, baseR * 0.05, cx, cy, baseR * 1.35);
  grd.addColorStop(0,    `rgba(216, 180, 254, ${intensity})`);          // purple-300
  grd.addColorStop(0.45, `rgba(167, 139, 250, ${intensity * 0.88})`);   // violet-400
  grd.addColorStop(0.80, `rgba(109,  77, 198, ${intensity * 0.60})`);
  grd.addColorStop(1,    `rgba( 79,  40, 140, 0)`);
  ctx2d.fillStyle = grd;
  ctx2d.fill();

  // Gloss highlight
  const gls = ctx2d.createRadialGradient(cx - baseR * 0.22, cy - baseR * 0.28, 0, cx, cy, baseR * 0.65);
  gls.addColorStop(0, 'rgba(255,255,255,0.30)');
  gls.addColorStop(1, 'rgba(255,255,255,0)');
  ctx2d.fillStyle = gls;
  ctx2d.fill();
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
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [speakerOn, setSpeakerOn] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_SPEAKER) === '1'; } catch { return false; }
  });
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [voiceSwitching, setVoiceSwitching] = useState(false);

  const lastSpokenIdRef = useRef<string | null>(null);
  // Web Audio API — much more reliable than <audio>.play() for autoplay
  // after async SSE events. Once AudioContext.resume() runs in a user
  // gesture, the context stays active for the page lifetime and future
  // plays go through regardless of how long since the gesture.
  const ctxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const pendingAudioBufRef = useRef<AudioBuffer | null>(null);  // queued when ctx still suspended
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // -------- Gemini Live voice state --------
  const [liveMode, setLiveMode] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle');
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveWsRef = useRef<WebSocket | null>(null);
  const liveMicCtxRef = useRef<AudioContext | null>(null);
  const livePlayCtxRef = useRef<AudioContext | null>(null);
  const liveNextStartRef = useRef<number>(0);
  const liveMicStreamRef = useRef<MediaStream | null>(null);
  const liveProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const liveAnimRef = useRef<number>(0);
  const liveAnalyserRef = useRef<AnalyserNode | null>(null);
  const livePlayAnalyserRef = useRef<AnalyserNode | null>(null);
  const liveBlobCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // PCM helpers
  const floatTo16bit = useCallback((f32: Float32Array): ArrayBuffer => {
    const buf = new ArrayBuffer(f32.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }, []);

  const bufToBase64 = useCallback((buf: ArrayBuffer): string => {
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }, []);

  const base64To16bitPCM = useCallback((b64: string): Float32Array => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768.0;
    return f32;
  }, []);

  // Enqueue a 24kHz audio chunk into the live playback context
  const enqueueLiveChunk = useCallback((b64: string) => {
    const ctx = livePlayCtxRef.current;
    if (!ctx) return;
    const samples = base64To16bitPCM(b64);
    const buf = ctx.createBuffer(1, samples.length, 24000);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Route through play analyser so the blob reacts to Nikki's voice
    if (!livePlayAnalyserRef.current || livePlayAnalyserRef.current.context !== ctx) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(ctx.destination);
      livePlayAnalyserRef.current = analyser;
    }
    src.connect(livePlayAnalyserRef.current);
    const now = ctx.currentTime;
    if (liveNextStartRef.current < now) liveNextStartRef.current = now + 0.05;
    src.start(liveNextStartRef.current);
    liveNextStartRef.current += buf.duration;
  }, [base64To16bitPCM]);

  // Flush live playback (on interruption)
  const flushLiveAudio = useCallback(() => {
    try { livePlayCtxRef.current?.close(); } catch {}
    livePlayAnalyserRef.current = null; // recreated on next chunk
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    livePlayCtxRef.current = new Ctx({ sampleRate: 24000 });
    liveNextStartRef.current = 0;
  }, []);

  // Blob animation loop — reads both mic and playback analysers, draws imperatively
  const startWaveformLoop = useCallback(() => {
    const tick = () => {
      let micAmp = 0;
      if (liveAnalyserRef.current) {
        const data = new Float32Array(liveAnalyserRef.current.fftSize);
        liveAnalyserRef.current.getFloatTimeDomainData(data);
        micAmp = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
      }
      let playAmp = 0;
      if (livePlayAnalyserRef.current) {
        const data = new Float32Array(livePlayAnalyserRef.current.fftSize);
        livePlayAnalyserRef.current.getFloatTimeDomainData(data);
        playAmp = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
      }
      const canvas = liveBlobCanvasRef.current;
      if (canvas) {
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) drawLiveBlob(ctx2d, canvas.width, canvas.height, playAmp, micAmp);
      }
      liveAnimRef.current = requestAnimationFrame(tick);
    };
    liveAnimRef.current = requestAnimationFrame(tick);
  }, []);

  const stopLive = useCallback(() => {
    cancelAnimationFrame(liveAnimRef.current);
    try { liveProcessorRef.current?.disconnect(); } catch {}
    try { liveMicStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    try { liveMicCtxRef.current?.close(); } catch {}
    try { livePlayCtxRef.current?.close(); } catch {}
    try { liveWsRef.current?.close(); } catch {}
    liveProcessorRef.current = null;
    liveMicStreamRef.current = null;
    liveMicCtxRef.current = null;
    livePlayCtxRef.current = null;
    liveWsRef.current = null;
    liveNextStartRef.current = 0;
    livePlayAnalyserRef.current = null;
    setLiveStatus('idle');
    setLiveMode(false);
  }, []);

  const startLive = useCallback(async () => {
    setLiveError(null);
    setLiveStatus('connecting');
    setLiveMode(true);

    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/nikki-live?token=${encodeURIComponent(dashboardToken)}`;

      // Start getUserMedia BEFORE creating the WS so the permission prompt
      // shows immediately — but do NOT await it yet. We need to wire all WS
      // handlers synchronously (no awaits in between) so they're in place
      // before the connection can fire onopen/onerror/onclose.
      const streamPromise = navigator.mediaDevices.getUserMedia({ audio: true });

      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      livePlayCtxRef.current = new Ctx({ sampleRate: 24000 });

      const ws = new WebSocket(wsUrl);
      liveWsRef.current = ws;

      // ALL handlers wired synchronously — no await between here and onclose.
      ws.onopen = async () => {
        // Now it's safe to await the mic stream; the WS is already open.
        let stream: MediaStream;
        try {
          stream = await streamPromise;
        } catch (e: any) {
          setLiveError(e?.message || 'Mic access denied');
          setLiveStatus('error');
          ws.close();
          return;
        }
        liveMicStreamRef.current = stream;
        setLiveStatus('active');

        // 16kHz mic capture
        const micCtx = new Ctx({ sampleRate: 16000 });
        liveMicCtxRef.current = micCtx;

        // Analyser for waveform
        const analyser = micCtx.createAnalyser();
        analyser.fftSize = 256;
        liveAnalyserRef.current = analyser;

        const source = micCtx.createMediaStreamSource(stream);
        const processor = micCtx.createScriptProcessor(2048, 1, 1);
        liveProcessorRef.current = processor;

        source.connect(analyser);
        source.connect(processor);
        processor.connect(micCtx.destination);

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const raw = e.inputBuffer.getChannelData(0);
          const pcm = floatTo16bit(raw);
          const b64 = bufToBase64(pcm);
          ws.send(JSON.stringify({ audio: b64 }));
        };

        startWaveformLoop();
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.audio) enqueueLiveChunk(msg.audio);
          if (msg.interrupted) flushLiveAudio();
        } catch {}
      };

      ws.onerror = () => {
        setLiveError('WebSocket error — check console');
        setLiveStatus('error');
      };

      ws.onclose = (ev) => {
        if (ev.code !== 1000 && ev.code !== 1001) {
          setLiveError(`Disconnected (${ev.code})`);
          setLiveStatus('error');
        }
        stopLive();
      };

    } catch (e: any) {
      setLiveError(e?.message || 'Failed to start live voice');
      setLiveStatus('error');
      stopLive();
    }
  }, [floatTo16bit, bufToBase64, enqueueLiveChunk, flushLiveAudio, startWaveformLoop, stopLive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (liveMode) stopLive();
    };
  }, [liveMode, stopLive]);

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
          {
            id: `a-${Date.now()}-${Math.random()}`,
            role: 'assistant',
            text,
            ts: Date.now(),
            sources: data?.sources,
          },
        ]);
        setProcessing(false);
        agents.refresh();
        health.refresh();
      }
    });
    return unsubscribe;
  }, []);

  // Get-or-create the AudioContext. Created lazily so the FIRST resume()
  // happens inside a user gesture (toggleSpeaker).
  function getAudioContext(): AudioContext {
    if (!ctxRef.current) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new Ctx();
    }
    return ctxRef.current!;
  }

  // Activate the AudioContext during the user gesture. After resume()
  // succeeds here, the context stays in the 'running' state for the
  // entire page lifetime — async SSE-driven plays work without any
  // further gesture.
  async function unlockAudio() {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
    } catch (e) {
      console.warn('AudioContext resume failed', e);
    }
  }

  function stopCurrent() {
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch {}
      try { currentSourceRef.current.disconnect(); } catch {}
      currentSourceRef.current = null;
    }
  }

  // Actually play a decoded AudioBuffer through the context.
  function playBuffer(buffer: AudioBuffer) {
    const ctx = getAudioContext();
    stopCurrent();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (currentSourceRef.current === source) {
        currentSourceRef.current = null;
      }
    };
    source.start();
    currentSourceRef.current = source;
  }

  // -------- TTS playback via /api/chat/tts --------
  async function speak(text: string) {
    if (typeof window === 'undefined') return;
    setVoiceError(null);
    try {
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
      const arrayBuf = await r.arrayBuffer();
      const ctx = getAudioContext();
      // Decode the MP3 into raw PCM AudioBuffer
      const audioBuf = await new Promise<AudioBuffer>((resolve, reject) => {
        // decodeAudioData supports promise + callback forms; use callback for
        // best Safari compatibility (Safari only added promise form recently).
        ctx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
      });

      // If the context is somehow still suspended (rare — only if user
      // never clicked speaker), queue and surface tap-to-play.
      if (ctx.state !== 'running') {
        pendingAudioBufRef.current = audioBuf;
        setNeedsTapToPlay(true);
        setVoiceError(null);
        return;
      }

      playBuffer(audioBuf);
      setNeedsTapToPlay(false);
    } catch (e: any) {
      setVoiceError(`Voice playback error: ${e?.message || e}`);
    }
  }

  // Tap-to-play fallback: resume context and play any queued buffer.
  async function resumeAudio() {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const buf = pendingAudioBufRef.current;
      if (buf) {
        playBuffer(buf);
        pendingAudioBufRef.current = null;
      }
      setNeedsTapToPlay(false);
      setVoiceError(null);
    } catch (e: any) {
      setVoiceError(`Still blocked: ${e?.message || e}`);
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
    if (!speakerOn) stopCurrent();
    return () => {
      stopCurrent();
      // Don't close the AudioContext on speaker-off — we want to keep it
      // running so the next speaker-on doesn't require a fresh gesture.
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

  // -------- File upload --------
  function handleFileChange(e: any) {
    const file: File | null = e.target.files?.[0] ?? null;
    if (file) setAttachedFile(file);
    e.target.value = '';
  }

  async function handleUpload() {
    if (!attachedFile || uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', attachedFile);
      if (draft.trim()) form.append('caption', draft.trim());
      const res = await fetch(`/api/chat/upload?token=${encodeURIComponent(dashboardToken)}`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      setAttachedFile(null);
      setDraft('');
    } catch (e: any) {
      setMessages(prev => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', text: `(upload failed: ${e?.message || e})`, ts: Date.now() },
      ]);
    } finally {
      setUploading(false);
    }
  }

  // -------- Voice input --------
  async function toggleSpeaker() {
    const wasOn = speakerOn;
    const next = !wasOn;
    try { localStorage.setItem(LS_SPEAKER, next ? '1' : '0'); } catch {}
    setSpeakerOn(next);
    if (next) {
      // Turning ON happens via user click → resume the AudioContext.
      // After this, future SSE-driven plays go through without issues.
      await unlockAudio();
      if (pendingAudioBufRef.current) {
        await resumeAudio();
      }
    } else {
      stopCurrent();
      pendingAudioBufRef.current = null;
      setNeedsTapToPlay(false);
    }
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
          {/* Live voice button */}
          <button
            type="button"
            onClick={() => liveMode ? stopLive() : startLive()}
            disabled={!running}
            class={`inline-flex items-center justify-center w-7 h-7 rounded transition-colors ${
              liveMode
                ? 'bg-[#dc2626] text-white animate-pulse'
                : liveStatus === 'connecting'
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] animate-pulse'
                : 'text-[var(--color-text-faint)] hover:text-[var(--color-accent)] disabled:opacity-40'
            }`}
            title={liveMode ? 'End live voice call' : 'Start live voice (Gemini Live)'}
            aria-label={liveMode ? 'End live voice' : 'Start live voice'}
          >
            {liveMode ? <PhoneOff size={13} /> : <Phone size={13} />}
          </button>
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

      {/* Gemini Live overlay — liquid blob visualizer */}
      {liveMode && (
        <div class="flex-1 flex flex-col items-center justify-center gap-2 border-t border-[var(--color-border)] pt-3 pb-1" style={{ minHeight: '180px' }}>
          <canvas ref={liveBlobCanvasRef} width={160} height={160} style={{ display: 'block' }} />
          <div class="text-[11px] text-[var(--color-text-faint)]">
            {liveStatus === 'connecting' && <span class="flex items-center gap-1"><Loader2 size={10} class="animate-spin" /> Connecting…</span>}
            {liveStatus === 'active' && <span style={{ color: '#a78bfa' }}>● Live · Gemini</span>}
            {liveStatus === 'error' && <span style={{ color: '#dc2626' }}>{liveError || 'Error'}</span>}
          </div>
          <button
            type="button"
            onClick={stopLive}
            class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#dc2626] text-white text-[11px] font-medium hover:opacity-80 transition-opacity"
          >
            <PhoneOff size={11} /> End call
          </button>
        </div>
      )}

      {/* Chat thread */}
      <div class="relative" style={{ minHeight: '120px', maxHeight: '260px' }}>
      {!liveMode && (
        <button
          type="button"
          onClick={startLive}
          disabled={!running}
          style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}
          class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#7c3aed] text-white hover:bg-[#6d28d9] active:scale-95 transition-all shadow-xl disabled:opacity-40 disabled:cursor-not-allowed"
          title="Call Nikki (Gemini Live)"
          aria-label="Call Nikki"
        >
          <Phone size={24} />
        </button>
      )}
      <div
        ref={scrollerRef}
        class={`flex-1 overflow-y-auto border-t border-[var(--color-border)] pt-2 mb-2 space-y-2${liveMode ? ' hidden' : ''}`}
        style={{ minHeight: '120px', maxHeight: '260px' }}
      >
        {visibleMessages.length === 0 ? (
          <div class="text-[11px] text-[var(--color-text-faint)] italic">No recent exchange. Say hi 👋</div>
        ) : (
          visibleMessages.map(m => (
            <div
              key={m.id}
              class={`text-[12px] leading-snug ${m.role === 'user' ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}
              style={{ userSelect: 'text', cursor: 'text' }}
            >
              <span class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mr-1.5">
                {m.role === 'user' ? 'You' : 'Nikki'}
              </span>
              {m.role === 'user' ? (
                m.text
              ) : (
                <div class="nikki-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
              )}
              {m.role === 'assistant' && m.sources && (m.sources.wikiPaths?.length || m.sources.memoryIds?.length) ? (
                <div class="text-[9px] text-[var(--color-text-faint)] mt-1 pl-7" title="Context Nikki had access to for this reply">
                  ⌬ {m.sources.wikiPaths && m.sources.wikiPaths.length > 0 && (
                    <span>{m.sources.wikiPaths.map(p => p.split('/').pop()?.replace(/\.md$/, '')).filter(Boolean).slice(0, 3).join(' · ')}{m.sources.wikiPaths.length > 3 ? ` +${m.sources.wikiPaths.length - 3}` : ''}</span>
                  )}
                  {m.sources.wikiPaths && m.sources.wikiPaths.length > 0 && m.sources.memoryIds && m.sources.memoryIds.length > 0 ? ' · ' : ''}
                  {m.sources.memoryIds && m.sources.memoryIds.length > 0 && (
                    <span>{m.sources.memoryIds.length} {m.sources.memoryIds.length === 1 ? 'memory' : 'memories'}</span>
                  )}
                </div>
              ) : null}
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
      </div>

      {needsTapToPlay && (
        <button
          type="button"
          onClick={resumeAudio}
          class="mb-1 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)] text-[11px] font-medium hover:opacity-80"
        >
          <Play size={11} /> Tap to play Nikki's reply
        </button>
      )}
      {voiceError && !needsTapToPlay && <div class="text-[10px] text-[#dc2626] mb-1">{voiceError}</div>}

      {/* Attachment preview */}
      {attachedFile && (
        <div class="flex items-center gap-2 mb-1.5 px-2 py-1 rounded bg-[var(--color-elevated)] border border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)]">
          <Paperclip size={11} class="shrink-0" />
          <span class="flex-1 truncate">{attachedFile.name}</span>
          <button
            type="button"
            onClick={() => setAttachedFile(null)}
            class="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
            aria-label="Remove attachment"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Input row */}
      <div class="flex items-center gap-2 border-t border-[var(--color-border)] pt-2">
        <input
          ref={fileInputRef}
          type="file"
          class="hidden"
          onChange={handleFileChange}
          accept="image/*,application/pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!running || uploading}
          class="inline-flex items-center justify-center w-7 h-7 rounded transition-colors bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed"
          title="Attach file"
          aria-label="Attach file"
        >
          <Paperclip size={13} />
        </button>
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
              attachedFile ? handleUpload() : handleSend();
            }
          }}
          placeholder={listening ? 'Listening…' : attachedFile ? 'Add a caption (optional)…' : running ? 'Ask Nikki…' : 'Nikki is offline'}
          disabled={!running || sending || uploading}
          class="flex-1 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1.5 text-[12px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => attachedFile ? handleUpload() : handleSend()}
          disabled={!running || sending || uploading || (!draft.trim() && !attachedFile)}
          class="inline-flex items-center justify-center w-7 h-7 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={attachedFile ? 'Send file' : 'Send'}
        >
          {(sending || uploading) ? <Loader2 size={13} class="animate-spin" /> : <Send size={13} />}
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
