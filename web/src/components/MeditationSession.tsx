// Meditation session modal: durations preset + start → breath orb +
// running timer → on natural finish or early "done", log the sit.
//
// Breath pattern: 4s inhale, 2s hold, 4s exhale. Calmer than the typical
// 4-7-8; aligned with The Way app's gentle pace.
//
// Bell: a soft Tone.js sine sweep at start and end so it's not jarring.
// Audio is best-effort — if Tone fails to load, the timer still works.

import { useState, useEffect, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import { apiPost } from '@/lib/api';

interface Props {
  date: string;
  onClose: () => void;
  onLogged: () => void;
}

const DURATIONS = [3, 5, 10, 15, 20] as const;

function fmt(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Play a soft bell via the Web Audio API. No external lib needed; a single
// sine wave with exponential gain fade gives the right "singing bowl" feel.
function playBell() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 440;
    o.type = 'sine';
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 3.0);
    o.start();
    o.stop(ctx.currentTime + 3.1);
    // Soft overtone for depth.
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.frequency.value = 660;
    o2.type = 'sine';
    o2.connect(g2); g2.connect(ctx.destination);
    g2.gain.setValueAtTime(0.001, ctx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.10, ctx.currentTime + 0.06);
    g2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.4);
    o2.start();
    o2.stop(ctx.currentTime + 2.5);
  } catch { /* audio not available — silent fallback is fine */ }
}

type Phase = 'idle' | 'inhale' | 'hold' | 'exhale';

export function MeditationSession({ date, onClose, onLogged }: Props) {
  const [duration, setDuration] = useState<number>(5);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const startedAtRef = useRef<number>(0);

  // Breath loop while running: 4s in → 2s hold → 4s out
  useEffect(() => {
    if (!running) { setPhase('idle'); return; }
    let cancelled = false;
    let timeoutId: number | null = null;
    const loop = () => {
      if (cancelled) return;
      setPhase('inhale');
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        setPhase('hold');
        timeoutId = window.setTimeout(() => {
          if (cancelled) return;
          setPhase('exhale');
          timeoutId = window.setTimeout(() => {
            if (cancelled) return;
            loop();
          }, 4000);
        }, 2000);
      }, 4000);
    };
    loop();
    return () => { cancelled = true; if (timeoutId) window.clearTimeout(timeoutId); };
  }, [running]);

  // Countdown timer
  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          window.clearInterval(tick);
          finishSession(duration);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [running]);

  async function logSit(minutes: number) {
    try {
      await apiPost(`/api/journal/meditation/${date}`, { minutes });
      onLogged();
    } catch (e) {
      console.error('meditation log failed', e);
    }
  }

  function start() {
    playBell();
    setRunning(true);
    setRemaining(duration * 60);
    startedAtRef.current = Date.now();
  }

  function finishSession(loggedMinutes: number) {
    playBell();
    setRunning(false);
    setPhase('idle');
    logSit(loggedMinutes).then(() => {
      // Give the bell ~1.2s to ring before closing the modal.
      window.setTimeout(() => onClose(), 1400);
    });
  }

  function endEarly() {
    const elapsedSec = Math.round((Date.now() - startedAtRef.current) / 1000);
    const minutes = Math.max(1, Math.round(elapsedSec / 60));
    finishSession(minutes);
  }

  function cancel() {
    setRunning(false);
    onClose();
  }

  return (
    <div class="breath-overlay" onClick={!running ? onClose : undefined}>
      <div class="breath-panel" onClick={(e: any) => e.stopPropagation()}>
        {!running ? (
          <>
            <div style={{ textAlign: 'center', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: '22px', letterSpacing: '0.08em', opacity: 0.92 }}>
              Sit with the breath
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {DURATIONS.map(d => (
                <button
                  key={d}
                  type="button"
                  class={`duration-chip ${duration === d ? 'active' : ''}`}
                  onClick={() => setDuration(d)}
                >
                  {d} min
                </button>
              ))}
            </div>
            <button type="button" class="meditation-start-btn" onClick={start}>
              begin
            </button>
            <button type="button" onClick={cancel} style={{ background: 'transparent', border: 'none', color: '#f4ede0', opacity: 0.65, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <X size={14} /> close
            </button>
          </>
        ) : (
          <>
            <div class="breath-stage">
              <div class={`breath-orb ${phase}`} />
              <div class="breath-cue">
                {phase === 'inhale' ? 'breathe in' : phase === 'hold' ? 'hold' : 'breathe out'}
              </div>
            </div>
            <div class="breath-timer">{fmt(remaining)}</div>
            <button type="button" class="meditation-end-btn" onClick={endEarly}>
              done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
