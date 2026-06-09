// Five-Minute Journal card for the Founder Dashboard.
//
// Compact morning entry surface: today's quote + the three gratitude lines.
// Autosaves on blur. A streak indicator + "Open full journal" link nudge
// Dante toward the standalone /journal page when there's more time.
//
// Visual goal: light, whimsical, almost paper-like — a soft contrast against
// the dense data tiles around it.

import { useState, useEffect } from 'preact/hooks';
import { Sparkles, ChevronRight, Leaf } from 'lucide-preact';
import { useFetch } from '@/lib/useFetch';
import { apiPost } from '@/lib/api';
import { PracticeRings } from './PracticeRings';
import { MeditationSession } from './MeditationSession';

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
  meditation_minutes: number;
  meditation_sessions: number;
  meditation_last_at: number | null;
}

interface Streak {
  current: number;
  longest: number;
  lastEntryDate: string | null;
  journal?: { current: number; longest: number };
  meditation?: { current: number; longest: number };
  practice?: { current: number; longest: number };
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

  const practice = data?.streak?.practice || { current: 0, longest: 0 };
  const morningDone = !!data?.entry?.morning_completed_at;
  const eveningDone = !!data?.entry?.evening_completed_at;
  const sitDone = (data?.entry?.meditation_sessions || 0) > 0;
  const [meditationOpen, setMeditationOpen] = useState(false);

  return (
    <div class="journal-card rounded-lg overflow-hidden">
      {/* Hero strip — soft mist + quote */}
      <div class="journal-hero relative px-5 pt-5 pb-4">
        <div class="absolute top-3 right-4 opacity-55">
          <Leaf size={18} class="journal-icon" />
        </div>
        <div class="flex items-center gap-2 mb-2">
          <Sparkles size={11} class="journal-accent" />
          <div class="text-[10.5px] uppercase journal-label">Practice</div>
          {practice.current > 0 && (
            <span class="ml-auto text-[11px] journal-streak italic" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
              {practice.current} day{practice.current === 1 ? '' : 's'} in a row
            </span>
          )}
        </div>
        {data?.quote && (
          <blockquote class="journal-quote italic text-[12.5px] leading-[1.55] pr-6">
            "{data.quote.text}"
            <div class="not-italic text-[10.5px] mt-1 opacity-70">— {data.quote.author}</div>
          </blockquote>
        )}
        <div class="mt-4 flex items-center justify-center">
          <PracticeRings
            gratitude={morningDone}
            sit={sitDone}
            reflect={eveningDone}
          />
        </div>
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

      {/* Footer — meta + link + sit button */}
      <div class="journal-footer px-5 py-2.5 flex items-center justify-between text-[10.5px]">
        <button
          type="button"
          onClick={() => setMeditationOpen(true)}
          class="italic journal-link"
          style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 12 }}
        >
          {sitDone ? 'sit again' : 'begin a sit'}
        </button>
        <a
          href="/journal"
          class="inline-flex items-center gap-1 journal-link italic"
          style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 12 }}
        >
          open journal <ChevronRight size={11} />
        </a>
      </div>

      {meditationOpen && (
        <MeditationSession
          date={data?.date || new Date().toISOString().slice(0, 10)}
          onClose={() => setMeditationOpen(false)}
          onLogged={() => { refresh(); }}
        />
      )}
    </div>
  );
}
