// Memory-driven morning brief. Runs at 7am local time every day.
//
// Pulls signal from:
//   - Recent high-importance memories (last 7 days, importance >= 0.6)
//   - Recent consolidations (last 24 hours)
//   - BID outreach state (untouched + needs-followup from store/bid-roster +
//     store/outreach-status)
//   - Cash position (current totals from /api/cash via the same data layer)
//   - Open mission tasks blocked or aging
//
// Composes a short Telegram brief with Gemini, focused on "what changed
// overnight" and "what needs attention today". Skips quietly if the LLM call
// fails so a bad morning doesn't crash the agent.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Api, RawApi } from 'grammy';

import { ALLOWED_CHAT_ID, GOOGLE_API_KEY, PROJECT_ROOT } from './config.js';
import { getRecentHighImportanceMemories, getRecentConsolidations, insertDailyBrief, markBriefSent, markBriefFailed } from './db.js';
import { generateContent } from './gemini.js';
import { logger } from './logger.js';
import { getCashData } from './cash-data.js';
import { getOutreachData } from './outreach-data.js';
import { buildBriefEmailBlock } from './email-data.js';

const execFileAsync = promisify(execFile);
const GCAL_CLI = path.join(PROJECT_ROOT, 'dist', 'gcal-cli.js');

const ROSTER_FILE = path.join(PROJECT_ROOT, 'store', 'bid-roster.json');

function buildOutreachLine(): string {
  try {
    const data = getOutreachData();
    if (data.rows.length === 0) return 'Outreach: BID roster not loaded yet.';
    const untouched = data.rows.filter(r => r.status === 'Not contacted').length;
    const replied = data.rows.filter(r => r.status === 'Replied').length;
    const booked = data.rows.filter(r => r.status === 'Webinar Booked').length;
    const endorsed = data.rows.filter(r => r.status === 'Endorsed').length;
    const followUps = data.rows.filter(r => r.nextAction.toLowerCase().startsWith('follow-up')).length;
    return `Outreach: ${data.rows.length} BIDs total · ${untouched} untouched · ${replied} replied · ${booked} webinar booked · ${endorsed} endorsed${followUps ? ` · ${followUps} need follow-up` : ''}.`;
  } catch (e) { return 'Outreach: data unavailable.'; }
}

async function buildCashLine(): Promise<string> {
  try {
    const cash = await getCashData(false);
    if (cash.connectionStatus !== 'ok') return `Cash: ${cash.connectionStatus}.`;
    const total = (cash.totalCashCents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const netCents = cash.mtd.netCents;
    const netStr = (Math.abs(netCents) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const sign = netCents >= 0 ? '+' : '-';
    const runway = cash.runwayDays == null ? 'cash flow positive' : `${cash.runwayDays}d runway`;
    return `Cash: $${total} in checking · MTD net ${sign}$${netStr} · ${runway}.`;
  } catch (e) { return 'Cash: data unavailable.'; }
}

interface CalEvent {
  id?: string; title?: string; start?: string; end?: string;
  allDay?: boolean; location?: string; attendees?: Array<{ name?: string; email?: string }>;
}

/** Pull today's calendar via the gcal CLI. Returns a one-line summary
 *  plus a block of formatted events for the brief prompt. Silent skip
 *  if the CLI isn't built or the token doesn't authorize calendar yet. */
async function buildCalendarBlock(): Promise<{ summaryLine: string; eventsBlock: string }> {
  if (!fs.existsSync(GCAL_CLI)) {
    return { summaryLine: 'Calendar: gcal-cli not built yet.', eventsBlock: '' };
  }
  try {
    const { stdout } = await execFileAsync('node', [GCAL_CLI, 'today'], {
      env: { ...process.env },
      maxBuffer: 4 * 1024 * 1024,
    });
    const j = JSON.parse(stdout) as { ok: boolean; count?: number; events?: CalEvent[]; error?: string };
    if (!j.ok || !Array.isArray(j.events)) {
      return { summaryLine: `Calendar: ${j.error || 'unknown error'}`, eventsBlock: '' };
    }
    if (j.events.length === 0) {
      return { summaryLine: 'Calendar: no events today.', eventsBlock: '' };
    }
    const fmt = (e: CalEvent) => {
      const startTime = e.start && !e.allDay
        ? new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : (e.allDay ? 'all day' : '?');
      const who = e.attendees && e.attendees.length > 0
        ? ` w/ ${e.attendees.slice(0, 3).map(a => a.name || a.email).filter(Boolean).join(', ')}`
        : '';
      const where = e.location ? ` @ ${e.location.slice(0, 40)}` : '';
      return `  ${startTime} — ${e.title || '(untitled)'}${who}${where}`;
    };
    return {
      summaryLine: `Calendar: ${j.events.length} event${j.events.length === 1 ? '' : 's'} today.`,
      eventsBlock: j.events.map(fmt).join('\n'),
    };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 120);
    return { summaryLine: `Calendar: cli failed (${msg})`, eventsBlock: '' };
  }
}

function buildBidRosterLine(): string {
  try {
    const j = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf-8'));
    return `BID roster: ${(j.bids || []).length} entities loaded.`;
  } catch { return ''; }
}

// ── Kind-specific prompts ───────────────────────────────────────────
// Each kind shapes Gemini's voice, length, and structure to fit the
// moment of the day. The operational context block is shared — the
// difference is what we ask Gemini to do with it.

type BriefKind = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

const SHARED_PERSONA = `You are writing for Dante, a serial entrepreneur running ImpactWorks (an AI agency) and Rocket Local (local marketing platform). He reads this on Telegram. Tone: direct, no fluff, sharp chief of staff. No platitudes. He has a tight cash position and is running multi-vector growth (ZAGG franchise rollout, BID Traffic Partnership, existing book).`;

const SHARED_CONTEXT = `Operational context:
{OPERATIONAL_CONTEXT}

Today's calendar:
{CALENDAR}

Recent high-importance memories (last 7 days):
{MEMORIES}

Recent consolidations (insights from memory clusters):
{CONSOLIDATIONS}`;

const PROMPTS: Record<BriefKind, string> = {
  morning: `${SHARED_PERSONA}

This is the MORNING BRIEF. Time of day: 7am EST. He's just starting his day.

${SHARED_CONTEXT}

Write the morning brief in Telegram-friendly plain text (no markdown headers). Maximum 1500 characters. Structure:
1. ☀️ One-line "today's headline" — the single biggest thing.
2. 1-3 specific actions for today, each prefixed with "→" and ending with a verb (call X, send Y, decide Z).
3. 1-2 watch-items (things to monitor, not act on yet).
4. End with a one-line motivational close that fits today's reality.

If nothing is notable, say so plainly. Do not invent priorities.`,

  noon: `${SHARED_PERSONA}

This is the NOON CHECK. Time of day: 12pm EST. He's halfway through the workday.

${SHARED_CONTEXT}

Write the noon check in Telegram-friendly plain text. Maximum 900 characters. Structure:
1. 🌞 One-line midday status — what landed since morning, what's still open.
2. 1-2 specific things to land before close-of-business (prefixed with "→").
3. 1 watch-item if relevant.

Be tight. He's mid-flow — don't drag attention away. If everything is on track, say so in one line.`,

  afternoon: `${SHARED_PERSONA}

This is the AFTERNOON NUDGE. Time of day: 3pm EST. The day is closing fast.

${SHARED_CONTEXT}

Write the afternoon nudge in Telegram-friendly plain text. Maximum 700 characters. Structure:
1. 🔥 One-line: what MUST close today.
2. 1-2 specific tactical moves before EOD (prefixed with "→") — calls, emails, decisions.
3. Skip the watch list. This is action-only.

Be punchy. If the day's already done, say so and tell him to put it down.`,

  evening: `${SHARED_PERSONA}

This is the EVENING WIND-DOWN. Time of day: 6pm EST. He's wrapping the workday.

${SHARED_CONTEXT}

Write the evening wind-down in Telegram-friendly plain text. Maximum 1000 characters. Structure:
1. 🌇 One-line: how the day landed — biggest win or biggest miss.
2. Recap: 2-3 bullet lines on what moved, what stalled.
3. Tomorrow's top priority — one sentence, set the table.
4. End with a restful line. Encourage closing the laptop.`,

  night: `${SHARED_PERSONA}

This is the NIGHT REFLECTION. Time of day: 10pm EST. He's heading to bed.

${SHARED_CONTEXT}

Write the night reflection in Telegram-friendly plain text. Maximum 600 characters. Structure:
1. 🌙 One-line: anything overnight to flag (a fire that could land while he sleeps, a contract auto-renewing, a meeting at 8am tomorrow he hasn't prepped for).
2. 1-line: one thing to feel good about from today.

Keep it brief. He needs sleep. If nothing is urgent overnight, tell him explicitly "Nothing on fire — rest." End with a calm sign-off.`,
};

function todayLocalStamp(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Strip JSON-string artifacts from Gemini's response.
 *
 * Gemini sometimes returns the brief wrapped in quotes with literal `\n`
 * (backslash + n) sequences instead of actual newlines. Strip the
 * surrounding quotes and unescape `\n`, `\"`, and `\\` so the body
 * renders as natural prose. */
function cleanGeminiBrief(raw: string): string {
  let s = (raw || '').trim();
  // Trim a single layer of surrounding double or single quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  // Replace literal escapes that Gemini emitted as text instead of as
  // actual control chars. Order matters: handle \\ before \" and \n so we
  // don't accidentally rewrite an already-escaped backslash.
  s = s.replace(/\\\\/g, '__BACKSLASH__')
       .replace(/\\n/g, '\n')
       .replace(/\\t/g, '\t')
       .replace(/\\"/g, '"')
       .replace(/__BACKSLASH__/g, '\\');
  return s.trim();
}

/** Build the brief prompt + call Gemini. Pure generation, no Telegram, no DB. */
async function composeBrief(chatId: string, kind: BriefKind): Promise<string> {
  const memories = getRecentHighImportanceMemories(chatId, 20);
  const consolidations = getRecentConsolidations(chatId, 5);
  const outreachLine = buildOutreachLine();
  const cashLine = await buildCashLine();
  const bidRosterLine = buildBidRosterLine();
  const { summaryLine: calLine, eventsBlock: calEvents } = await buildCalendarBlock();
  let emailBlock = '';
  try { emailBlock = await buildBriefEmailBlock(3); } catch { /* non-fatal */ }

  const operationalContext = [cashLine, outreachLine, bidRosterLine, calLine, emailBlock].filter(Boolean).join('\n');
  const calendarBlock = calEvents || '(no events today)';
  const memoriesBlock = memories.length === 0
    ? '(none in the last 7 days)'
    : memories.map(m => `[importance ${m.importance.toFixed(2)}] ${m.summary}`).join('\n');
  const consolidationsBlock = consolidations.length === 0
    ? '(none in the last 24h)'
    : consolidations.map(c => `- ${c.insight || c.summary}`).join('\n');

  const prompt = PROMPTS[kind]
    .replace('{OPERATIONAL_CONTEXT}', operationalContext || '(no operational context available)')
    .replace('{CALENDAR}', calendarBlock)
    .replace('{MEMORIES}', memoriesBlock)
    .replace('{CONSOLIDATIONS}', consolidationsBlock);

  const raw = await generateContent(prompt, 'gemini-2.5-flash', 'text/plain');
  return cleanGeminiBrief(raw);
}

export async function runDailyBrief(api: Api<RawApi> | null, chatId: string, kind: BriefKind = 'morning'): Promise<void> {
  if (!api || !chatId || !GOOGLE_API_KEY) {
    logger.info({ kind }, 'daily-brief: skipped (no api / chatId / GOOGLE_API_KEY)');
    return;
  }

  let brief: string;
  try {
    brief = await composeBrief(chatId, kind);
  } catch (e) {
    logger.error({ err: String((e as Error)?.message || e), kind }, 'daily-brief: gemini call failed');
    return;
  }

  if (!brief || !brief.trim()) {
    logger.warn({ kind }, 'daily-brief: empty brief generated, skipping send');
    return;
  }

  // Persist BEFORE the Telegram send so we keep the body even if send fails.
  const briefId = insertDailyBrief({
    generatedAt: Date.now(),
    briefDate: todayLocalStamp(),
    briefKind: kind,
    body: brief,
    sendStatus: 'pending',
  });

  try {
    const sent = await api.sendMessage(chatId, brief.slice(0, 4000));
    markBriefSent(briefId, sent?.message_id ?? null);
    logger.info({ briefId, length: brief.length, kind }, 'daily-brief: sent + archived');
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    markBriefFailed(briefId, msg);
    logger.error({ err: msg, briefId, kind }, 'daily-brief: telegram send failed (archived as failed)');
  }
}

/** Generate-only path used by the Mission Control "Generate now" button.
 *  Skips Telegram, stores as 'preview'. Defaults to morning; pass a different
 *  kind to preview the noon/afternoon/evening/night variant. */
export async function generateBriefPreview(chatId: string, kind: BriefKind = 'morning'): Promise<{ id: number; body: string; kind: BriefKind } | null> {
  if (!chatId || !GOOGLE_API_KEY) return null;
  const body = await composeBrief(chatId, kind);
  if (!body || !body.trim()) return null;
  const id = insertDailyBrief({
    generatedAt: Date.now(),
    briefDate: todayLocalStamp(),
    briefKind: kind,
    body,
    sendStatus: 'preview',
  });
  return { id, body, kind };
}

// ── EST-aware scheduling ────────────────────────────────────────────
// All briefs fire at fixed America/New_York wall-clock hours. We use
// Intl.DateTimeFormat to read the current hour/minute in EST regardless
// of what timezone the host machine uses (Fly runs UTC). That handles
// DST transitions automatically — Spring Forward 7am EDT and Fall Back
// 7am EST both compute correctly.

/** Hour-of-day in EST (0-23) and corresponding kind. Kept in one place so
 *  the dashboard, scheduler, and prompt-picker stay in sync. */
const BRIEF_SLOTS: Array<{ hour: number; kind: BriefKind }> = [
  { hour: 7,  kind: 'morning' },
  { hour: 12, kind: 'noon' },
  { hour: 15, kind: 'afternoon' },
  { hour: 18, kind: 'evening' },
  { hour: 22, kind: 'night' },
];

/** Compute the current hour + minute in America/New_York for a given Date. */
function estClock(at: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

/** Return ms until the next BRIEF_SLOTS firing in EST, along with the kind
 *  that will fire. The host clock may be UTC — this still resolves correctly
 *  by stepping minute-by-minute through wall-clock EST and asking
 *  Intl.DateTimeFormat what the EST hour is at each candidate.
 *
 *  We binary-search forward by adding fixed UTC ms increments and checking
 *  what EST hour those land at — DST transitions just collapse or duplicate
 *  one hour, which is fine because we fire at most 5 times anyway.
 */
export function msUntilNextBriefSlot(now = new Date()): { delayMs: number; kind: BriefKind } {
  const todayEst = estClock(now);
  const minutesSinceMidnightEst = todayEst.hour * 60 + todayEst.minute;

  // Find the next slot today (EST) that's strictly after now.
  for (const slot of BRIEF_SLOTS) {
    const slotMinutes = slot.hour * 60;
    if (slotMinutes > minutesSinceMidnightEst) {
      // Step forward by 1 min increments until EST hour matches slot.hour
      // and minute reads 0. Worst case: ~24h * 60 = 1440 iterations.
      const start = now.getTime();
      for (let m = 1; m <= 24 * 60; m++) {
        const candidate = new Date(start + m * 60 * 1000);
        const c = estClock(candidate);
        if (c.hour === slot.hour && c.minute === 0) {
          return { delayMs: candidate.getTime() - start, kind: slot.kind };
        }
      }
    }
  }
  // All slots for today already passed — find tomorrow's morning slot.
  const start = now.getTime();
  for (let m = 1; m <= 36 * 60; m++) {
    const candidate = new Date(start + m * 60 * 1000);
    const c = estClock(candidate);
    if (c.hour === BRIEF_SLOTS[0].hour && c.minute === 0) {
      return { delayMs: candidate.getTime() - start, kind: BRIEF_SLOTS[0].kind };
    }
  }
  // Safety fallback — shouldn't happen.
  return { delayMs: 24 * 60 * 60 * 1000, kind: 'morning' };
}

/** Back-compat shim so existing callers of `msUntilNext7am` still link.
 *  Returns the same number as the first morning slot from msUntilNextBriefSlot. */
export function msUntilNext7am(now = new Date()): number {
  // Walk forward to find the next morning slot specifically (skip non-morning).
  const start = now.getTime();
  for (let m = 1; m <= 36 * 60; m++) {
    const candidate = new Date(start + m * 60 * 1000);
    const c = estClock(candidate);
    if (c.hour === 7 && c.minute === 0) {
      return candidate.getTime() - start;
    }
  }
  return 24 * 60 * 60 * 1000;
}
