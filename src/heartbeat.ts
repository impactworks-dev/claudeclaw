// Proactive heartbeat loop.
//
// Two independent schedules drive Nikki's unprompted Telegram outreach:
//
//  1. runHeartbeatScan(): every hour during waking hours (7am-9pm local).
//     Calls a battery of per-signal checkers using data we already have
//     native (cash, outreach, briefs, scheduler, Vendasta). Each checker
//     decides whether to emit an Alert (severity + title + body). All
//     emitted alerts pass through dedupAndShouldFire() — same signal_key
//     won't re-fire within its cooldown window. Surviving alerts batch
//     into ONE coherent Telegram message so we don't ping Dante 4 times
//     in a row.
//
//  2. runMoneyIdeas(): once daily at 10am. Gathers memory + consolidations
//     + canonical wiki context + current pipeline state, hands to Gemini
//     with a prompt asking for 1-2 concrete revenue opportunities Dante
//     isn't already working on. Same cleanGemini path as the morning brief.
//
// Quiet hours (22:00-07:00 local) and "Dante is in a meeting right now"
// suppress all heartbeat sends. Money ideas only fire during waking hours
// by virtue of their fixed 10am slot.
//
// Anti-spam:
//   - Each signal has a stable signal_key + per-signal cooldown
//   - Default cooldown 24h
//   - Dismissed signals blocked for 7 days
//   - Snoozed signals respect snoozed_until
//   - Max 3 alerts per heartbeat cycle (avoid wall-of-text)

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Api, RawApi } from 'grammy';

import {
  ALLOWED_CHAT_ID, GOOGLE_API_KEY, PROJECT_ROOT,
} from './config.js';
import {
  shouldFireSignal, insertProactiveAlert, markAlertSent,
  getRecentHighImportanceMemories, getRecentConsolidations,
} from './db.js';
import { generateContent } from './gemini.js';
import { logger } from './logger.js';
import { getCashData } from './cash-data.js';
import { getOutreachData } from './outreach-data.js';
import { getQbData } from './qb-data.js';
import { getVendastaData } from './vendasta-data.js';
import { buildWikiContext } from './brain-data.js';
import { findStaleImportantEmails } from './email-data.js';

const execFileAsync = promisify(execFile);
const GCAL_CLI = path.join(PROJECT_ROOT, 'dist', 'gcal-cli.js');

// ── Time helpers ─────────────────────────────────────────────────────

function nowLocalHour(): number { return new Date().getHours(); }
function isQuietHours(now = new Date()): boolean {
  const h = now.getHours();
  return h < 7 || h >= 22;
}

async function isInMeetingNow(): Promise<boolean> {
  if (!fs.existsSync(GCAL_CLI)) return false;
  try {
    const { stdout } = await execFileAsync('node', [GCAL_CLI, 'today'], {
      env: { ...process.env }, maxBuffer: 4 * 1024 * 1024,
    });
    const j = JSON.parse(stdout) as { ok: boolean; events?: Array<{ start?: string; end?: string; allDay?: boolean }> };
    if (!j.ok || !j.events) return false;
    const now = Date.now();
    for (const e of j.events) {
      if (e.allDay) continue;
      const s = e.start ? new Date(e.start).getTime() : 0;
      const en = e.end ? new Date(e.end).getTime() : 0;
      if (s && en && s <= now && now <= en) return true;
    }
  } catch { /* gcal failure non-fatal */ }
  return false;
}

// ── Alert primitive ──────────────────────────────────────────────────

interface Alert {
  signalKey: string;
  severity: 'critical' | 'warn' | 'info';
  title: string;
  body: string;
  cooldownMs: number;
  emoji?: string;
}

// ── Signal checkers ──────────────────────────────────────────────────

const HR = 60 * 60 * 1000;
const DAY = 24 * HR;

/** Cash runway: low total cash OR runway < 60 days OR MTD net dropping hard. */
async function checkCashHealth(): Promise<Alert[]> {
  const out: Alert[] = [];
  try {
    const cash = await getCashData(false);
    if (cash.connectionStatus !== 'ok') return out;
    const cashTotal = cash.totalCashCents / 100;
    if (cashTotal < 5000) {
      out.push({
        signalKey: 'cash_total_under_5k',
        severity: 'critical',
        title: 'Cash under $5k',
        body: `Total checking is $${Math.round(cashTotal).toLocaleString()}. Time to chase outstanding invoices or run the call list.`,
        cooldownMs: 12 * HR,
        emoji: '💸',
      });
    } else if (cashTotal < 15000) {
      out.push({
        signalKey: 'cash_total_under_15k',
        severity: 'warn',
        title: 'Cash trending low',
        body: `Total checking is $${Math.round(cashTotal).toLocaleString()}. Worth eyeing AR.`,
        cooldownMs: DAY,
      });
    }
    if (cash.runwayDays != null && cash.runwayDays > 0 && cash.runwayDays < 60) {
      out.push({
        signalKey: `cash_runway_under_60`,
        severity: cash.runwayDays < 30 ? 'critical' : 'warn',
        title: `Runway: ${cash.runwayDays} days`,
        body: `At current 30-day burn, runway is ${cash.runwayDays} days. Decide: cut costs, raise prices, or close pipeline faster.`,
        cooldownMs: DAY,
        emoji: '⏳',
      });
    }
  } catch (e) { logger.warn({ err: String((e as Error)?.message || e) }, 'heartbeat: cash check failed'); }
  return out;
}

/** QB MTD net: alert if YoY-ish month is materially worse than last 30 days. */
async function checkQbMtd(): Promise<Alert[]> {
  const out: Alert[] = [];
  try {
    const qb = await getQbData({ force: false });
    if (qb.connectionStatus !== 'ok') return out;
    const mtdNet = qb.mtd.netCents / 100;
    const last30Net = qb.last30.netCents / 100;
    if (mtdNet < -3000 && mtdNet < last30Net - 2000) {
      out.push({
        signalKey: 'qb_mtd_worse_than_last30',
        severity: 'warn',
        title: 'MTD net trending down',
        body: `Month-to-date net is -$${Math.abs(Math.round(mtdNet)).toLocaleString()} vs last-30 -$${Math.abs(Math.round(last30Net)).toLocaleString()}. Investigate what shifted.`,
        cooldownMs: 2 * DAY,
        emoji: '📉',
      });
    }
  } catch (e) { logger.warn({ err: String((e as Error)?.message || e) }, 'heartbeat: qb check failed'); }
  return out;
}

/** BID outreach: flag if N+ entities marked for follow-up are aging. */
function checkOutreachOverdue(): Alert[] {
  const out: Alert[] = [];
  try {
    const data = getOutreachData();
    const needFollowup = data.rows.filter(r => r.nextAction.toLowerCase().startsWith('follow-up'));
    if (needFollowup.length >= 5) {
      out.push({
        signalKey: 'outreach_followup_backlog',
        severity: needFollowup.length >= 10 ? 'warn' : 'info',
        title: `${needFollowup.length} BIDs need follow-up`,
        body: `${needFollowup.slice(0, 3).map(r => r.entity).join(', ')}${needFollowup.length > 3 ? `, +${needFollowup.length - 3} more` : ''}. Block 30 min today to clear the queue.`,
        cooldownMs: 2 * DAY,
        emoji: '📬',
      });
    }
    const untouched = data.rows.filter(r => r.status === 'Not contacted').length;
    if (untouched > 0 && data.rows.length > 0 && untouched / data.rows.length > 0.5) {
      out.push({
        signalKey: 'outreach_majority_untouched',
        severity: 'info',
        title: `${untouched} BIDs never contacted`,
        body: `Over half the roster is untouched. The campaign won't compound until outreach catches up.`,
        cooldownMs: 3 * DAY,
      });
    }
  } catch (e) { logger.warn({ err: String((e as Error)?.message || e) }, 'heartbeat: outreach check failed'); }
  return out;
}

/** Morning briefs Nikki sent that Dante never marked acted/ignored. */
function checkUnactedBriefs(): Alert[] {
  const out: Alert[] = [];
  try {
    // Look for sent briefs from 3+ days ago with NO user mark.
    const stale = (require('./db.js') as typeof import('./db.js'))
      .getRecentDailyBriefs(30)
      .filter(b => b.send_status === 'sent' && !b.user_marked && Date.now() - b.generated_at > 3 * DAY);
    if (stale.length >= 3) {
      out.push({
        signalKey: 'briefs_unacted_3plus',
        severity: 'info',
        title: `${stale.length} morning briefs unreviewed`,
        body: `Briefs from ${new Date(stale[stale.length - 1].generated_at).toLocaleDateString()} onward have no acted/ignored tag. Either the briefs aren't useful or the loop isn't closing.`,
        cooldownMs: 4 * DAY,
        emoji: '🌅',
      });
    }
  } catch (e) { logger.warn({ err: String((e as Error)?.message || e) }, 'heartbeat: briefs check failed'); }
  return out;
}

/** Unread emails 24h+ from known clients or with urgency keywords. */
async function checkStaleImportantEmails(): Promise<Alert[]> {
  const out: Alert[] = [];
  try {
    const stale = await findStaleImportantEmails({ minHours: 24, knownOnly: true });
    if (stale.length === 0) return out;
    const top = stale.slice(0, 3);
    const lines = top.map(e => {
      const who = e.fromName || e.fromEmail;
      const ageStr = e.ageHours > 24 ? `${Math.round(e.ageHours / 24)}d` : `${Math.round(e.ageHours)}h`;
      const tag = e.hasUrgentKeyword ? '⚠️ ' : '';
      return `${tag}${who} (${ageStr}): ${e.subject.slice(0, 60)}`;
    });
    out.push({
      signalKey: 'email_stale_important',
      severity: top.some(t => t.hasUrgentKeyword) ? 'warn' : 'info',
      title: `${stale.length} unread email${stale.length === 1 ? '' : 's'} need${stale.length === 1 ? 's' : ''} a look`,
      body: lines.join('\n'),
      cooldownMs: 12 * HR,
      emoji: '📨',
    });
  } catch (e) { logger.warn({ err: String((e as Error)?.message || e) }, 'heartbeat: email check failed'); }
  return out;
}

/** Vendasta market quiet: flag if a market hasn't logged activity in 14+ days. */
async function checkVendastaQuiet(): Promise<Alert[]> {
  const out: Alert[] = [];
  try {
    const v = await getVendastaData({ force: false });
    if (v.connectionStatus !== 'ok') return out;
    for (const slug of Object.keys(v.bySlug) as Array<keyof typeof v.bySlug>) {
      const m = v.bySlug[slug];
      const mostRecent = m.recentCompanies[0]?.lastActivity || 0;
      const ageDays = mostRecent ? (Date.now() - mostRecent) / DAY : Infinity;
      if (ageDays > 14 && m.companies > 10) {
        out.push({
          signalKey: `vendasta_quiet_${slug}`,
          severity: 'info',
          title: `${m.label} CRM quiet for ${Math.round(ageDays)} days`,
          body: `No activity logged on any ${m.label} account in over two weeks. Worth a touch sweep or you'll lose top-of-mind.`,
          cooldownMs: 5 * DAY,
        });
      }
    }
  } catch (e) { logger.warn({ err: String((e as Error)?.message || e) }, 'heartbeat: vendasta check failed'); }
  return out;
}

// ── Heartbeat scan ───────────────────────────────────────────────────

const MAX_ALERTS_PER_SCAN = 3;

const SEVERITY_EMOJI: Record<Alert['severity'], string> = {
  critical: '🔴', warn: '🟡', info: '🔵',
};

function formatBatch(alerts: Alert[]): string {
  const lines = ['🩺 Nikki check-in', ''];
  for (const a of alerts) {
    const e = a.emoji || SEVERITY_EMOJI[a.severity];
    lines.push(`${e} *${a.title}*`);
    lines.push(a.body);
    lines.push('');
  }
  lines.push('_Reply "snooze [number]" or "ignore [number]" to mute, otherwise these will recheck on their cooldowns._');
  return lines.join('\n');
}

export async function runHeartbeatScan(api: Api<RawApi> | null, chatId: string, opts: { force?: boolean } = {}): Promise<{ checked: number; emitted: number; sent: number; alerts?: Array<{ id: number; signalKey: string; title: string; body: string }>; reason?: string }> {
  if (!chatId) return { checked: 0, emitted: 0, sent: 0, reason: 'no chatId' };
  if (!opts.force && isQuietHours()) return { checked: 0, emitted: 0, sent: 0, reason: 'quiet hours (use force=true to override)' };
  if (!opts.force && await isInMeetingNow()) return { checked: 0, emitted: 0, sent: 0, reason: 'in meeting (use force=true to override)' };

  // Run all signal checkers in parallel.
  const buckets = await Promise.all([
    checkCashHealth(),
    checkQbMtd(),
    Promise.resolve(checkOutreachOverdue()),
    Promise.resolve(checkUnactedBriefs()),
    checkVendastaQuiet(),
    checkStaleImportantEmails(),
  ]);
  const allEmitted = buckets.flat();

  // Filter via cooldown / dismissed.
  const eligible: Alert[] = [];
  for (const a of allEmitted) {
    const { fire, reason } = shouldFireSignal(a.signalKey, a.cooldownMs);
    if (fire) eligible.push(a);
    else logger.info({ signalKey: a.signalKey, reason }, 'heartbeat: signal suppressed');
  }

  // Cap at MAX_ALERTS_PER_SCAN, prioritized by severity.
  const severityRank = { critical: 3, warn: 2, info: 1 };
  eligible.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
  const toSend = eligible.slice(0, MAX_ALERTS_PER_SCAN);

  if (toSend.length === 0) {
    return { checked: allEmitted.length, emitted: 0, sent: 0, reason: 'no eligible alerts' };
  }

  // Persist first so we always have a record, even if Telegram fails.
  const ids: number[] = toSend.map(a => insertProactiveAlert({
    signalKey: a.signalKey, severity: a.severity, kind: 'heartbeat', title: a.title, body: a.body,
  }));

  const message = formatBatch(toSend);
  const alertsOut = toSend.map((a, i) => ({ id: ids[i], signalKey: a.signalKey, title: a.title, body: a.body }));

  // No api → dry run, return what would have been sent without firing Telegram.
  if (!api) {
    logger.info({ count: toSend.length, signals: toSend.map(a => a.signalKey) }, 'heartbeat: dry run (no api)');
    return { checked: allEmitted.length, emitted: eligible.length, sent: 0, alerts: alertsOut, reason: 'dry run (no api)' };
  }

  try {
    const sent = await api.sendMessage(chatId, message.slice(0, 4000), { parse_mode: 'Markdown' });
    for (const id of ids) markAlertSent(id, sent?.message_id ?? null);
    logger.info({ ids, count: toSend.length, signals: toSend.map(a => a.signalKey) }, 'heartbeat: batch sent');
    return { checked: allEmitted.length, emitted: eligible.length, sent: toSend.length, alerts: alertsOut };
  } catch (e) {
    logger.error({ err: String((e as Error)?.message || e) }, 'heartbeat: telegram send failed');
    return { checked: allEmitted.length, emitted: eligible.length, sent: 0, alerts: alertsOut, reason: 'telegram send failed' };
  }
}

// ── Money ideas ──────────────────────────────────────────────────────

const MONEY_IDEAS_PROMPT = `You are Nikki, chief of staff to Dante Crescenzi. Dante runs:
- ImpactWorks (AI agency, custom automation, AI strategy)
- Rocket Local AI (local marketing for home services, GBP optimization, multi-location brands)

He has a tight cash position and is running BID Traffic Partnership outreach to NC downtown associations + a ZAGG franchise rollout.

Your job RIGHT NOW: suggest 1-2 concrete revenue opportunities he ISN'T already working on. Constraints:
- Each idea must be specific: name a client or vertical, name a service or offer, propose a $ amount or rough deal size, and give a concrete first action he can take TODAY.
- Reject ideas that are already in his active pipeline (you'll see them in the context — don't repeat).
- Reject vague platitudes ("focus on revenue") or generic content marketing tips.
- Lean into his actual skills: AI automation, local SEO, web platforms, agency services.
- If the context shows recent client wins or stalled deals, ride that signal.

Tone: direct, concise, like a sharp partner texting him. Telegram-friendly.

OUTPUT FORMAT — STRICT RULES:
- Plain text only. NOT JSON. NOT markdown headers. NOT code blocks.
- Real newlines between sections (do not use the literal characters backslash-n).
- Maximum 700 characters total.
- Exact structure:

💡 [Idea 1 headline in one line]
→ Concrete action
→ Concrete action (optional)
Why now: [1-2 sentences]

💡 [Idea 2 headline in one line]
→ Concrete action
Why now: [1-2 sentences]

If you genuinely don't have a good idea given the context, respond with the single line: "Nothing sharp today — context is thin."

OPERATING CONTEXT:
{OPERATIONAL_CONTEXT}

CANONICAL BUSINESS NOTES (Dante's wiki):
{WIKI_CONTEXT}

RECENT HIGH-IMPORTANCE MEMORIES:
{MEMORIES}

RECENT INSIGHTS (consolidations):
{CONSOLIDATIONS}`;

function cleanGemini(raw: string): string {
  let s = (raw || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  s = s.replace(/\\\\/g, '__BS__').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/__BS__/g, '\\');
  return s.trim();
}

export async function runMoneyIdeas(api: Api<RawApi> | null, chatId: string, opts: { force?: boolean } = {}): Promise<{ ok: boolean; id?: number; body?: string; reason?: string }> {
  if (!chatId || !GOOGLE_API_KEY) return { ok: false, reason: 'unconfigured' };
  if (!opts.force && isQuietHours()) return { ok: false, reason: 'quiet hours (use force=true to override)' };

  // Build context
  const memories = getRecentHighImportanceMemories(chatId, 25);
  const consolidations = getRecentConsolidations(chatId, 8);
  let opContext = '';
  try {
    const cash = await getCashData(false);
    const v = await getVendastaData({ force: false });
    if (cash.connectionStatus === 'ok') {
      opContext += `Cash: $${Math.round(cash.totalCashCents / 100).toLocaleString()} checking · ${cash.runwayDays != null ? cash.runwayDays + 'd runway' : 'profitable'}\n`;
    }
    if (v.connectionStatus === 'ok') {
      opContext += `Pipeline: ImpactWorks ${v.bySlug.pwps.companies} accounts (${v.bySlug.pwps.openDeals} open deals), Rocket Local ${v.bySlug.default.companies} accounts (${v.bySlug.default.openDeals} open deals)\n`;
    }
    const outreach = getOutreachData();
    if (outreach.rows.length > 0) {
      opContext += `Outreach: ${outreach.rows.length} BIDs · ${outreach.rows.filter(r => r.status === 'Replied').length} replied · ${outreach.rows.filter(r => r.status === 'Webinar Booked').length} booked webinars\n`;
    }
  } catch { /* op context is best-effort */ }

  let wikiContext = '';
  try {
    const wiki = buildWikiContext('revenue opportunities client services agency offerings');
    if (wiki.contextText) {
      wikiContext = wiki.contextText.slice(0, 1500);
    }
  } catch { /* wiki best-effort */ }

  const memoriesBlock = memories.length
    ? memories.map(m => `- [imp ${m.importance.toFixed(2)}] ${m.summary}`).join('\n')
    : '(none yet)';
  const consolidationsBlock = consolidations.length
    ? consolidations.map(c => `- ${c.insight || c.summary}`).join('\n')
    : '(none yet)';

  const prompt = MONEY_IDEAS_PROMPT
    .replace('{OPERATIONAL_CONTEXT}', opContext || '(unavailable)')
    .replace('{WIKI_CONTEXT}', wikiContext || '(no relevant wiki notes)')
    .replace('{MEMORIES}', memoriesBlock)
    .replace('{CONSOLIDATIONS}', consolidationsBlock);

  let body: string;
  try {
    body = cleanGemini(await generateContent(prompt));
  } catch (e) {
    logger.error({ err: String((e as Error)?.message || e) }, 'money-ideas: gemini failed');
    return { ok: false, reason: 'gemini failed' };
  }
  if (!body || body.trim().length < 30) {
    return { ok: false, reason: 'empty body from gemini' };
  }

  // Cooldown gate: don't fire money ideas more than once per 20h regardless.
  if (!opts.force) {
    const { fire, reason } = shouldFireSignal('money_idea_daily', 20 * HR);
    if (!fire) return { ok: false, body, reason: `cooldown: ${reason}` };
  }

  const id = insertProactiveAlert({
    signalKey: 'money_idea_daily',
    severity: 'info',
    kind: 'money_idea',
    title: 'Daily revenue idea',
    body,
  });

  if (!api) {
    return { ok: true, id, body, reason: 'dry run (no api)' };
  }

  try {
    const sent = await api.sendMessage(chatId, body.slice(0, 4000));
    markAlertSent(id, sent?.message_id ?? null);
    logger.info({ id, length: body.length }, 'money-ideas: sent');
    return { ok: true, id, body };
  } catch (e) {
    logger.error({ err: String((e as Error)?.message || e), id }, 'money-ideas: telegram send failed');
    return { ok: false, id, body, reason: 'telegram send failed' };
  }
}

// ── Schedulers ───────────────────────────────────────────────────────

/** Next pulse: top of next hour, but never earlier than 7am or later than 9pm. */
export function msUntilNextHeartbeat(now = new Date()): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  if (next.getHours() < 7) next.setHours(7);
  if (next.getHours() >= 22) {
    next.setDate(next.getDate() + 1);
    next.setHours(7);
  }
  return next.getTime() - now.getTime();
}

/** Next money-ideas pulse: 10:00 local. */
export function msUntilNextMoneyIdeas(now = new Date()): number {
  const next = new Date(now);
  next.setHours(10, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}
