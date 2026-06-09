// Five-Minute Journal card for the Founder Dashboard.
//
// Compact morning entry surface: today's quote + the three gratitude lines.
// Autosaves on blur. A streak indicator + "Open full journal" link nudge
// Dante toward the standalone /journal page when there's more time.
//
// Visual goal: light, whimsical, almost paper-like — a soft contrast against
// the dense data tiles around it.

import { useState, useEffect } from 'preact/hooks';
import { Sparkles, ChevronRight, Sun } from 'lucide-preact';
import { useFetch } from '@/lib/useFetch';
import { apiPost } from '@/lib/api';

interface JournalEntry {
  date: string;
  gratitude_1: string;
  gratitude_2: string;
  gratitude_3: string;
  great_today_1: string;
  great_today_2: string;
  great_today_3: string;
  affirmation: string;
  highlight_1: string;
  highlight_2: string;
  highlight_3: string;
  learned: string;
  morning_completed_at: number | null;
  evening_completed_at: number | null;
}

interface Streak {
  current: number;
  longest: number;
  lastEntryDate: string | null;
}

interface TodayPayload {
  date: string;
  entry: JournalEntry | null;
  quote: { text: string; author: string };
  streak: Streak;
}

export function JournalCard() {
  const { data, loading, refresh } = useFetch<TodayPayload>('/api/journal/today', 60_000);
  const [g1, setG1] = useState('');
  const [g2, setG2] = useState('');
  const [g3, setG3] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (data?.entry) {
      setG1(data.entry.gratitude_1 || '');
      setG2(data.entry.gratitude_2 || '');
      setG3(data.entry.gratitude_3 || '');
    }
  }, [data?.entry?.date]);

  async function saveField(field: string, value: string) {
    if (!data?.date) return;
    setSaving(true);
    try {
      await apiPost(`/api/journal/entry/${data.date}`, { [field]: value });
      setSavedAt(Date.now());
      refresh();
    } finally {
      setSaving(false);
    }
  }

  const streak = data?.streak?.current || 0;
  const morningDone = !!data?.entry?.morning_completed_at;

  return (
    <div class="journal-card rounded-lg border border-[var(--color-border)] overflow-hidden">
      {/* Hero strip — sunrise gradient + quote */}
      <div class="journal-hero relative px-5 pt-5 pb-4">
        <div class="absolute top-3 right-4 opacity-50">
          <Sun size={20} class="journal-icon" />
        </div>
        <div class="flex items-center gap-2 mb-2">
          <Sparkles size={12} class="journal-accent" />
          <div class="text-[11px] uppercase tracking-[0.18em] journal-label">Today's Journal</div>
          {streak > 0 && (
            <span class="ml-auto inline-flex items-center gap-1 text-[11px] journal-streak">
              🔥 {streak}-day streak
            </span>
          )}
        </div>
        {data?.quote && (
          <blockquote class="journal-quote italic text-[12.5px] leading-[1.55] pr-6">
            "{data.quote.text}"
            <div class="not-italic text-[10.5px] mt-1 opacity-70">— {data.quote.author}</div>
          </blockquote>
        )}
      </div>

      {/* Body — gratitude entry */}
      <div class="journal-body px-5 py-4">
        <div class="text-center italic text-[13px] journal-section-header mb-3">
          I am grateful for…
        </div>
        <div class="space-y-2.5">
          {[
            { idx: 1, val: g1, set: setG1, field: 'gratitude_1' },
            { idx: 2, val: g2, set: setG2, field: 'gratitude_2' },
            { idx: 3, val: g3, set: setG3, field: 'gratitude_3' },
          ].map(row => (
            <div key={row.idx} class="flex items-baseline gap-2">
              <span class="journal-numeral text-[12px]">{row.idx}.</span>
              <input
                type="text"
                value={row.val}
                onInput={(e: any) => row.set(e.currentTarget.value)}
                onBlur={(e: any) => {
                  if (data?.entry?.[row.field as keyof JournalEntry] !== row.val) {
                    saveField(row.field, row.val);
                  }
                }}
                placeholder="…"
                class="flex-1 journal-input"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Footer — meta + link */}
      <div class="journal-footer px-5 py-2.5 flex items-center justify-between text-[10.5px]">
        <span class="opacity-70">
          {loading ? 'Loading…' :
           saving ? 'Saving…' :
           savedAt ? '✓ Saved' :
           morningDone ? '✓ Morning logged' :
           'Awaiting today’s entry'}
        </span>
        <a
          href="/journal"
          class="inline-flex items-center gap-1 journal-link"
        >
          Full journal <ChevronRight size={11} />
        </a>
      </div>
    </div>
  );
}
