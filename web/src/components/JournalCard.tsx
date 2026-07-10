// Five-Minute Journal card for the Founder Dashboard.
//
// Progressive reveal — sections unlock as the day unfolds and stay visible:
//   Always (morning)  → gratitude + what would make today great + affirmation + quote
//   12:00+  (noon)    → + sit with breath
//   17:00+  (evening) → + highlights of the day + what did I learn

import { useState, useEffect } from 'preact/hooks';
import { Sparkles, ChevronRight, Sun, Wind, Moon } from 'lucide-preact';
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

// ── Helpers defined OUTSIDE the component so Preact never remounts them ──────

function JournalInput({ idx, val, onInput, onBlur }: {
  idx: number;
  val: string;
  onInput: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
      <span class="journal-numeral" style={{ fontSize: '13px', opacity: 0.5, flexShrink: 0 }}>
        {idx}.
      </span>
      <input
        type="text"
        value={val}
        onInput={(e: any) => onInput(e.currentTarget.value)}
        onBlur={onBlur}
        placeholder="…"
        class="journal-input"
      />
    </div>
  );
}

function SectionDivider({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
      <Icon size={11} class="journal-accent" style={{ opacity: 0.6 }} />
      <div class="journal-label" style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.7 }}>
        {label}
      </div>
      <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function JournalCard() {
  const { data, loading, refresh } = useFetch<TodayPayload>('/api/journal/today', 60_000);
  const hour = new Date().getHours();
  const showNoon    = hour >= 12;
  const showEvening = hour >= 17;

  // Morning fields
  const [g1, setG1] = useState('');
  const [g2, setG2] = useState('');
  const [g3, setG3] = useState('');
  const [gt1, setGt1] = useState('');
  const [gt2, setGt2] = useState('');
  const [gt3, setGt3] = useState('');
  const [aff, setAff] = useState('');

  // Evening fields
  const [hl1, setHl1] = useState('');
  const [hl2, setHl2] = useState('');
  const [hl3, setHl3] = useState('');
  const [learned, setLearned] = useState('');

  const [meditationOpen, setMeditationOpen] = useState(false);

  useEffect(() => {
    if (data?.entry) {
      setG1(data.entry.gratitude_1 || '');
      setG2(data.entry.gratitude_2 || '');
      setG3(data.entry.gratitude_3 || '');
      setGt1(data.entry.great_today_1 || '');
      setGt2(data.entry.great_today_2 || '');
      setGt3(data.entry.great_today_3 || '');
      setAff(data.entry.affirmation || '');
      setHl1(data.entry.highlight_1 || '');
      setHl2(data.entry.highlight_2 || '');
      setHl3(data.entry.highlight_3 || '');
      setLearned(data.entry.learned || '');
    }
  }, [data?.entry?.date]);

  async function saveField(field: string, value: string) {
    if (!data?.date) return;
    await apiPost(`/api/journal/entry/${data.date}`, { [field]: value });
    refresh();
  }

  const practice    = data?.streak?.practice || { current: 0, longest: 0 };
  const morningDone = !!data?.entry?.morning_completed_at;
  const eveningDone = !!data?.entry?.evening_completed_at;
  const sitDone     = (data?.entry?.meditation_sessions || 0) > 0;
  const sitCount    = data?.entry?.meditation_sessions || 0;


  return (
    <div class="journal-card rounded-lg overflow-hidden">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div class="journal-hero relative px-5 pt-5 pb-4">
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
          <blockquote class="journal-quote italic text-[12.5px] leading-[1.55] pr-4">
            "{data.quote.text}"
            <div class="not-italic text-[10.5px] mt-1 opacity-70">— {data.quote.author}</div>
          </blockquote>
        )}

        <div class="mt-4 flex items-center justify-center">
          <PracticeRings gratitude={morningDone} sit={sitDone} reflect={eveningDone} />
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div class="journal-body px-5 py-4 space-y-5">

        {/* MORNING — always visible */}
        <SectionDivider icon={Sun} label="Morning" />

        <div>
          <div class="text-center italic journal-section-header mb-3" style={{ fontSize: '14px' }}>
            I am grateful for…
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <JournalInput idx={1} val={g1} onInput={setG1}
              onBlur={() => { if ((data?.entry?.gratitude_1 || '') !== g1) saveField('gratitude_1', g1); }} />
            <JournalInput idx={2} val={g2} onInput={setG2}
              onBlur={() => { if ((data?.entry?.gratitude_2 || '') !== g2) saveField('gratitude_2', g2); }} />
            <JournalInput idx={3} val={g3} onInput={setG3}
              onBlur={() => { if ((data?.entry?.gratitude_3 || '') !== g3) saveField('gratitude_3', g3); }} />
          </div>
        </div>

        <div>
          <div class="text-center italic journal-section-header mb-3" style={{ fontSize: '14px' }}>
            What would make today great?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <JournalInput idx={1} val={gt1} onInput={setGt1}
              onBlur={() => { if ((data?.entry?.great_today_1 || '') !== gt1) saveField('great_today_1', gt1); }} />
            <JournalInput idx={2} val={gt2} onInput={setGt2}
              onBlur={() => { if ((data?.entry?.great_today_2 || '') !== gt2) saveField('great_today_2', gt2); }} />
            <JournalInput idx={3} val={gt3} onInput={setGt3}
              onBlur={() => { if ((data?.entry?.great_today_3 || '') !== gt3) saveField('great_today_3', gt3); }} />
          </div>
        </div>

        <div>
          <div class="text-center italic journal-section-header mb-2" style={{ fontSize: '14px' }}>
            Daily affirmation
          </div>
          <textarea
            value={aff}
            rows={2}
            onInput={(e: any) => setAff(e.currentTarget.value)}
            onBlur={() => { if ((data?.entry?.affirmation || '') !== aff) saveField('affirmation', aff); }}
            placeholder="I am…"
            class="journal-input"
            style={{ resize: 'none' }}
          />
        </div>

        {/* NOON — unlocks at 12pm */}
        {showNoon && (
          <>
            <SectionDivider icon={Wind} label="Noon check-in" />

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', paddingTop: '4px', textAlign: 'center' }}>
              <p class="journal-quote italic leading-[1.55]" style={{ fontSize: '13px', maxWidth: '220px' }}>
                Pause. Breathe. Come back to now.
              </p>
              {sitCount > 0 && (
                <div class="journal-streak italic" style={{ fontSize: '11px' }}>
                  {sitCount} sit{sitCount === 1 ? '' : 's'} today
                  {data?.entry?.meditation_minutes ? ` · ${data.entry.meditation_minutes} min` : ''}
                </div>
              )}
              <button
                type="button"
                onClick={() => setMeditationOpen(true)}
                class="journal-link italic"
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: '13px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  borderRadius: '999px',
                  padding: '5px 20px',
                }}
              >
                {sitDone ? 'sit again' : 'begin a sit'}
              </button>
            </div>
          </>
        )}

        {/* EVENING — unlocks at 5pm */}
        {showEvening && (
          <>
            <SectionDivider icon={Moon} label="Evening" />

            <div>
              <div class="text-center italic journal-section-header mb-3" style={{ fontSize: '14px' }}>
                Highlights of the day
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <JournalInput idx={1} val={hl1} onInput={setHl1}
                  onBlur={() => { if ((data?.entry?.highlight_1 || '') !== hl1) saveField('highlight_1', hl1); }} />
                <JournalInput idx={2} val={hl2} onInput={setHl2}
                  onBlur={() => { if ((data?.entry?.highlight_2 || '') !== hl2) saveField('highlight_2', hl2); }} />
                <JournalInput idx={3} val={hl3} onInput={setHl3}
                  onBlur={() => { if ((data?.entry?.highlight_3 || '') !== hl3) saveField('highlight_3', hl3); }} />
              </div>
            </div>

            <div>
              <div class="text-center italic journal-section-header mb-2" style={{ fontSize: '14px' }}>
                What did I learn today?
              </div>
              <textarea
                value={learned}
                rows={3}
                onInput={(e: any) => setLearned(e.currentTarget.value)}
                onBlur={() => { if ((data?.entry?.learned || '') !== learned) saveField('learned', learned); }}
                placeholder="…"
                class="journal-input"
                style={{ resize: 'none' }}
              />
            </div>
          </>
        )}

      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div class="journal-footer px-5 py-2.5 flex items-center justify-between text-[10.5px]">
        {!showNoon ? (
          <button
            type="button"
            onClick={() => setMeditationOpen(true)}
            class="italic journal-link"
            style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '12px' }}
          >
            {sitDone ? 'sit again' : 'begin a sit'}
          </button>
        ) : <span />}
        <a
          href="/journal"
          class="inline-flex items-center gap-1 journal-link italic"
          style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '12px' }}
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
