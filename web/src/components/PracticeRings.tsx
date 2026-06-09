// Three concentric-ish progress rings — Gratitude, Sit, Reflect.
// Apple Watch-esque visual, but in zen sage/gold/mauve. Each ring fills
// as today's practice in that category completes.
//
// Gratitude: morning section completed (any of 3 gratitude lines)
// Sit:       meditation_sessions > 0 (any sit logged today)
// Reflect:   evening section completed (any of 3 highlights or learned)

interface Props {
  gratitude: boolean;
  sit: boolean;
  reflect: boolean;
  /** Optional: 0–1 partial fill for sit if minutes < target. */
  sitProgress?: number;
}

function Ring({ kind, filled, partial = 1 }: { kind: 'gratitude' | 'sit' | 'reflect'; filled: boolean; partial?: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const ratio = filled ? Math.min(1, Math.max(0.08, partial)) : 0;
  const dashOffset = c * (1 - ratio);
  const label = kind === 'gratitude' ? 'gratitude' : kind === 'sit' ? 'sit' : 'reflect';
  return (
    <div class={`practice-ring ${kind}`} title={`${label}: ${filled ? 'done' : 'pending'}`}>
      <svg class="practice-ring-svg" viewBox="0 0 44 44">
        <circle class="practice-ring-track" cx="22" cy="22" r={r} />
        <circle
          class="practice-ring-fill"
          cx="22" cy="22" r={r}
          stroke-dasharray={c}
          stroke-dashoffset={dashOffset}
        />
      </svg>
      <span class="practice-ring-label">{label}</span>
    </div>
  );
}

export function PracticeRings({ gratitude, sit, reflect, sitProgress = 1 }: Props) {
  return (
    <div class="practice-rings">
      <Ring kind="gratitude" filled={gratitude} />
      <Ring kind="sit" filled={sit} partial={sitProgress} />
      <Ring kind="reflect" filled={reflect} />
    </div>
  );
}
