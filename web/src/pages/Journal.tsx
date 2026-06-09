// Five-Minute Journal full page. Mirrors intelligentchange.com layout —
// morning section (gratitude + great-today + affirmation) and evening
// section (highlights + learned). Light, whimsical aesthetic via CSS class
// .journal-page (defined in main.css): handwritten-feel font, parchment
// background, sun + moon decorations.

import { useState, useEffect } from 'preact/hooks';
import { Sun, Moon, ChevronLeft, ChevronRight, Sparkles } from 'lucide-preact';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiGet } from '@/lib/api';

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

interface Quote { text: string; author: string }

interface DayPayload {
  date: string;
  entry: JournalEntry | null;
  quote: Quote;
  streak?: { current: number; longest: number; lastEntryDate: string | null };
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function JournalPage() {
  const [currentDate, setCurrentDate] = useState(todayLocal());
  const [data, setData] = useState<DayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  // Local form state — flushed on blur.
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { data: streakData } = useFetch<{ entries: JournalEntry[]; streak: any }>('/api/journal/recent?limit=30', 5 * 60_000);

  async function load(date: string) {
    setLoading(true);
    try {
      const r = await apiGet<DayPayload>(`/api/journal/entry/${date}`);
      setData(r);
      const e = r.entry || ({} as any);
      setForm({
        gratitude_1: e.gratitude_1 || '',
        gratitude_2: e.gratitude_2 || '',
        gratitude_3: e.gratitude_3 || '',
        great_today_1: e.great_today_1 || '',
        great_today_2: e.great_today_2 || '',
        great_today_3: e.great_today_3 || '',
        affirmation: e.affirmation || '',
        highlight_1: e.highlight_1 || '',
        highlight_2: e.highlight_2 || '',
        highlight_3: e.highlight_3 || '',
        learned: e.learned || '',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(currentDate); }, [currentDate]);

  async function saveField(field: string, value: string) {
    setSaving(true);
    try {
      await apiPost(`/api/journal/entry/${currentDate}`, { [field]: value });
      setSavedAt(Date.now());
      // Refresh the canonical row so completion flags update.
      const r = await apiGet<DayPayload>(`/api/journal/entry/${currentDate}`);
      setData(r);
    } finally {
      setSaving(false);
    }
  }

  function onField(field: string) {
    return {
      value: form[field] || '',
      onInput: (e: any) => setForm(prev => ({ ...prev, [field]: e.currentTarget.value })),
      onBlur: (e: any) => {
        const v = e.currentTarget.value;
        if ((data?.entry?.[field as keyof JournalEntry] || '') !== v) {
          saveField(field, v);
        }
      },
      class: 'journal-input',
      placeholder: '…',
    };
  }

  const isToday = currentDate === todayLocal();
  const isFuture = currentDate > todayLocal();
  const streak = streakData?.streak?.current || 0;
  const longest = streakData?.streak?.longest || 0;

  return (
    <div class="journal-page min-h-screen pb-12">
      {/* Page header — date navigation */}
      <div class="max-w-3xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCurrentDate(shiftDate(currentDate, -1))}
          class="journal-nav-btn"
          aria-label="Previous day"
        >
          <ChevronLeft size={16} />
        </button>
        <div class="text-center">
          <div class="text-[13px] uppercase tracking-[0.2em] opacity-60 journal-label">Five-Minute Journal</div>
          <div class="text-[19px] mt-1 journal-date">{fmtDate(currentDate)}</div>
          <div class="text-[11px] mt-1 opacity-60">
            {streak > 0 && <span>🔥 {streak}-day streak</span>}
            {longest > 0 && streak !== longest && <span class="ml-2">· best: {longest}</span>}
            {!isToday && (
              <button
                type="button"
                onClick={() => setCurrentDate(todayLocal())}
                class="ml-3 underline opacity-80 hover:opacity-100"
              >
                Jump to today
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCurrentDate(shiftDate(currentDate, 1))}
          class="journal-nav-btn"
          disabled={isFuture}
          aria-label="Next day"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Page body */}
      <div class="max-w-3xl mx-auto px-6">
        {/* Morning section */}
        <section class="journal-section morning-section relative px-8 py-8 mb-6">
          <Sun class="journal-deco-sun" size={26} />
          {data?.quote && (
            <blockquote class="journal-quote text-center italic text-[15px] leading-[1.6] px-4 pb-1">
              "{data.quote.text}"
              <div class="not-italic text-[11px] mt-2 opacity-70">— {data.quote.author}</div>
            </blockquote>
          )}

          <h3 class="journal-section-header text-center italic text-[16px] mt-7 mb-3">I am grateful for…</h3>
          <div class="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} class="flex items-baseline gap-3">
                <span class="journal-numeral text-[13px]">{i}.</span>
                <input type="text" {...onField(`gratitude_${i}`)} />
              </div>
            ))}
          </div>

          <h3 class="journal-section-header text-center italic text-[16px] mt-8 mb-3">What would make today great?</h3>
          <div class="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} class="flex items-baseline gap-3">
                <span class="journal-numeral text-[13px]">{i}.</span>
                <input type="text" {...onField(`great_today_${i}`)} />
              </div>
            ))}
          </div>

          <h3 class="journal-section-header text-center italic text-[16px] mt-8 mb-3">Daily affirmation</h3>
          <div class="space-y-3">
            <input type="text" {...onField('affirmation')} />
          </div>

          <div class="journal-meta-footer mt-6 text-[10.5px] text-center opacity-60">
            {data?.entry?.morning_completed_at
              ? `Morning completed · saved ${saving ? 'now' : savedAt ? 'just now' : ''}`
              : 'Morning section'}
          </div>
        </section>

        {/* Evening section */}
        <section class="journal-section evening-section relative px-8 py-8">
          <Moon class="journal-deco-moon" size={22} />
          <h3 class="journal-section-header text-center italic text-[16px] mb-3 mt-2">
            <Sparkles size={11} class="inline opacity-50 mr-1" />
            Highlights of the Day
          </h3>
          <div class="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} class="flex items-baseline gap-3">
                <span class="journal-numeral text-[13px]">{i}.</span>
                <input type="text" {...onField(`highlight_${i}`)} />
              </div>
            ))}
          </div>

          <h3 class="journal-section-header text-center italic text-[16px] mt-8 mb-3">What did I learn today?</h3>
          <div class="space-y-3">
            <textarea
              value={form.learned || ''}
              onInput={(e: any) => setForm(prev => ({ ...prev, learned: e.currentTarget.value }))}
              onBlur={(e: any) => {
                const v = e.currentTarget.value;
                if ((data?.entry?.learned || '') !== v) saveField('learned', v);
              }}
              placeholder="…"
              rows={2}
              class="journal-input journal-textarea w-full"
            />
          </div>

          <div class="journal-meta-footer mt-6 text-[10.5px] text-center opacity-60">
            {data?.entry?.evening_completed_at ? 'Evening completed' : 'Evening section'}
          </div>
        </section>

        {loading && (
          <div class="text-center py-4 opacity-60 text-[12px]">Loading…</div>
        )}
      </div>
    </div>
  );
}
