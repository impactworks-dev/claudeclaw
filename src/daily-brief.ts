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

const BRIEF_PROMPT = `You are writing a short morning brief for Dante, a serial entrepreneur running ImpactWorks (an AI agency) and Rocket Local (local marketing platform). He starts his day reading this on Telegram.

Goals:
- Surface what ACTUALLY needs attention today, not a generic recap.
- Lead with the single most important item if there is one.
- Be specific, concrete, and short. He has a tight cash position and is running multi-vector growth (ZAGG franchise rollout, BID Traffic Partnership, existing book).
- Tone: direct, no fluff. Like a sharp chief of staff.

Operational context for today:
{OPERATIONAL_CONTEXT}

Today's calendar:
{CALENDAR}

Recent high-importance memories (last 7 days):
{MEMORIES}

Recent consolidations (insights derived from memory clusters):
{CONSOLIDATIONS}

Write the brief in Telegram-friendly format (plain text, no markdown headers, line breaks only). Maximum 1500 characters. Structure:

1. ☀️ One-line "today's headline" — the single biggest thing.
2. 1-3 specific actions for today, each prefixed with "→" and ending with a verb (call X, send Y, decide Z).
3. 1-2 watch-items (things to monitor, not act on yet).
4. End with: a one-line nudge or motivational close that fits the day's reality (no platitudes).

If there is nothing notable, say so plainly. Do not invent priorities.`;

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
async function composeBrief(chatId: string): Promise<string> {
  const memories = getRecentHighImportanceMemories(chatId, 20);
  const consolidations = getRecentConsolidations(chatId, 5);
  const outreachLine = buildOutreachLine();
  const cashLine = await buildCashLine();
  const bidRosterLine = buildBidRosterLine();
  const { summaryLine: calLine, eventsBlock: calEvents } = await buildCalendarBlock();

  const operationalContext = [cashLine, outreachLine, bidRosterLine, calLine].filter(Boolean).join('\n');
  const calendarBlock = calEvents || '(no events today)';
  const memoriesBlock = memories.length === 0
    ? '(none in the last 7 days)'
    : memories.map(m => `[importance ${m.importance.toFixed(2)}] ${m.summary}`).join('\n');
  const consolidationsBlock = consolidations.length === 0
    ? '(none in the last 24h)'
    : consolidations.map(c => `- ${c.insight || c.summary}`).join('\n');

  const prompt = BRIEF_PROMPT
    .replace('{OPERATIONAL_CONTEXT}', operationalContext || '(no operational context available)')
    .replace('{CALENDAR}', calendarBlock)
    .replace('{MEMORIES}', memoriesBlock)
    .replace('{CONSOLIDATIONS}', consolidationsBlock);

  const raw = await generateContent(prompt);
  return cleanGeminiBrief(raw);
}

export async function runDailyBrief(api: Api<RawApi> | null, chatId: string): Promise<void> {
  if (!api || !chatId || !GOOGLE_API_KEY) {
    logger.info('daily-brief: skipped (no api / chatId / GOOGLE_API_KEY)');
    return;
  }

  let brief: string;
  try {
    brief = await composeBrief(chatId);
  } catch (e) {
    logger.error({ err: String((e as Error)?.message || e) }, 'daily-brief: gemini call failed');
    return;
  }

  if (!brief || !brief.trim()) {
    logger.warn('daily-brief: empty brief generated, skipping send');
    return;
  }

  // Persist BEFORE the Telegram send so we keep the body even if send fails.
  const briefId = insertDailyBrief({
    generatedAt: Date.now(),
    briefDate: todayLocalStamp(),
    body: brief,
    sendStatus: 'pending',
  });

  try {
    const sent = await api.sendMessage(chatId, brief.slice(0, 4000));
    markBriefSent(briefId, sent?.message_id ?? null);
    logger.info({ briefId, length: brief.length }, 'daily-brief: sent + archived');
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    markBriefFailed(briefId, msg);
    logger.error({ err: msg, briefId }, 'daily-brief: telegram send failed (archived as failed)');
  }
}

/** Generate-only path used by the Mission Control "Generate now" button.
 *  Skips Telegram, stores as 'preview' so we don't get spammed in the brief
 *  archive with on-demand previews mixed in with the scheduled 7am ones. */
export async function generateBriefPreview(chatId: string): Promise<{ id: number; body: string } | null> {
  if (!chatId || !GOOGLE_API_KEY) return null;
  const body = await composeBrief(chatId);
  if (!body || !body.trim()) return null;
  const id = insertDailyBrief({
    generatedAt: Date.now(),
    briefDate: todayLocalStamp(),
    body,
    sendStatus: 'preview',
  });
  return { id, body };
}

/** Milliseconds until next 7:00 AM local time. */
export function msUntilNext7am(now = new Date()): number {
  const next = new Date(now);
  next.setHours(7, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}
