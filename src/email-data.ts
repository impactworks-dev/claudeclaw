// Gmail data layer for Mission Control.
//
// Thin wrapper around dist/gmail-cli.js — the CLI already returns clean
// JSON, so this module mostly caches + shapes for UI + provides helpers
// for heartbeat / brief enrichment.
//
// Cache: 2 minutes for inbox (mailbox moves), 10 minutes per thread
// (thread bodies are stable).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const GMAIL_CLI = path.join(PROJECT_ROOT, 'dist', 'gmail-cli.js');

const INBOX_TTL_MS = 2 * 60 * 1000;
const THREAD_TTL_MS = 10 * 60 * 1000;
const KNOWN_CONTACT_TTL_MS = 30 * 60 * 1000;

export interface EmailRow {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  date: string;
  receivedAt: number;       // epoch ms
  unread: boolean;
  ageHours: number;
  hasUrgentKeyword: boolean;
}

export interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string;
}

export interface ThreadDetail {
  threadId: string;
  messages: ThreadMessage[];
}

// ── Helpers ──────────────────────────────────────────────────────────

// Urgency detection. Word-boundary regex matches only — single bare words
// like "today" caused false positives ("Game of Thrones is available now —
// today!"). Phrase-only matches for the noisiest words.
const URGENT_REGEX = [
  /\burgent\b/i,
  /\basap\b/i,
  /\boverdue\b/i,
  /\bpast\s+due\b/i,
  /\bunpaid\s+invoice\b/i,
  /\binvoice\s+(due|overdue|attached)\b/i,
  /\bpayment\s+(due|overdue|required|reminder|failed)\b/i,
  /\bcontract\s+(attached|to\s+sign|review|expir|signed)\b/i,
  /\bsignature\s+(required|requested|needed)\b/i,
  /\b(needs|need|requires)\s+(your\s+)?signature\b/i,
  /\bplease\s+sign\b/i,
  /\bdeadline\b/i,
  /\bexpir(es?|ing|ed)\s+(today|tomorrow|in)\b/i,
  /\bdue\s+(today|tomorrow|by)\b/i,
  /\bby\s+(eod|cob|end\s+of\s+day|end\s+of\s+business)\b/i,
  /\bfinal\s+notice\b/i,
  /\baction\s+required\b/i,
  /\bresponse\s+needed\b/i,
  /\bplease\s+confirm\b/i,
  /\bfollow[\s-]?up\b/i,
  /\btime[\s-]?sensitive\b/i,
];

// Senders we exclude from urgency entirely — newsletters, marketing,
// receipts. These almost never carry real-action emails.
const MARKETING_SENDER_RE = /(noreply|no-reply|notifications|donotreply|do-not-reply|@email\.|@mail\.|@news\.|newsletter|marketing|updates|alerts)/i;

function parseFromHeader(from: string): { name: string; email: string } {
  // "Dante Crescenzi <dante@impactworks.com>" → { name: "Dante Crescenzi", email: "dante@impactworks.com" }
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  // Just an email
  const e = from.match(/[\w.+-]+@[\w.-]+/);
  return { name: '', email: e ? e[0].toLowerCase() : from.toLowerCase().trim() };
}

function parseGmailDate(s: string): number {
  const t = Date.parse(s);
  return isNaN(t) ? Date.now() : t;
}

function hasUrgent(subject: string, snippet: string, fromHeader: string): boolean {
  // Marketing senders never count as urgent, regardless of content
  if (MARKETING_SENDER_RE.test(fromHeader)) return false;
  const blob = `${subject} ${snippet}`;
  return URGENT_REGEX.some(re => re.test(blob));
}

function shapeRow(raw: any): EmailRow {
  const { name, email } = parseFromHeader(raw.from || '');
  const receivedAt = parseGmailDate(raw.date || '');
  const ageHours = (Date.now() - receivedAt) / 3600000;
  return {
    id: raw.id,
    threadId: raw.threadId || raw.id,
    snippet: (raw.snippet || '').slice(0, 280),
    from: raw.from || '',
    fromName: name,
    fromEmail: email,
    to: raw.to || '',
    subject: raw.subject || '(no subject)',
    date: raw.date || '',
    receivedAt,
    unread: !!raw.unread,
    ageHours,
    hasUrgentKeyword: hasUrgent(raw.subject || '', raw.snippet || '', raw.from || ''),
  };
}

async function gmailCall(cmd: string, args: string[] = []): Promise<any> {
  const { stdout } = await execFileAsync('node', [GMAIL_CLI, cmd, ...args], {
    env: { ...process.env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

// ── Inbox ────────────────────────────────────────────────────────────

let inboxCache: { asOf: number; data: EmailRow[] } | null = null;

export async function getInbox(opts: { limit?: number; force?: boolean } = {}): Promise<{ asOf: number; emails: EmailRow[]; configured: boolean; error?: string }> {
  const limit = opts.limit || 25;
  if (!opts.force && inboxCache && Date.now() - inboxCache.asOf < INBOX_TTL_MS) {
    return { asOf: inboxCache.asOf, emails: inboxCache.data.slice(0, limit), configured: true };
  }
  try {
    const j = await gmailCall('inbox', ['--limit', String(limit * 2)]);
    if (!j.ok) {
      return { asOf: Date.now(), emails: [], configured: false, error: j.error || 'gmail-cli returned not-ok' };
    }
    const rows = (j.results || []).map(shapeRow);
    // Unread first, then by date desc
    rows.sort((a: EmailRow, b: EmailRow) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      return b.receivedAt - a.receivedAt;
    });
    inboxCache = { asOf: Date.now(), data: rows };
    return { asOf: inboxCache.asOf, emails: rows.slice(0, limit), configured: true };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    const noCreds = /not.set|not configured|REFRESH_TOKEN/i.test(msg);
    logger.warn({ err: msg }, 'email-data: inbox fetch failed');
    return { asOf: Date.now(), emails: [], configured: !noCreds, error: msg.slice(0, 200) };
  }
}

export function invalidateInboxCache(): void { inboxCache = null; }

// ── Thread ───────────────────────────────────────────────────────────

const threadCache = new Map<string, { asOf: number; data: ThreadDetail }>();

export async function getThread(threadId: string, force = false): Promise<ThreadDetail | { error: string }> {
  if (!force) {
    const cached = threadCache.get(threadId);
    if (cached && Date.now() - cached.asOf < THREAD_TTL_MS) return cached.data;
  }
  try {
    // The gmail-cli has a `read` command for a single message; we use `read`
    // on the threadId because Gmail's read endpoint accepts message IDs and
    // returns the body. For a full thread, we'd use a separate `thread`
    // command — for now, fetch the single primary message.
    const j = await gmailCall('read', [threadId]);
    if (!j.ok && !j.id) {
      return { error: j.error || 'read failed' };
    }
    const detail: ThreadDetail = {
      threadId,
      messages: [{
        id: j.id || threadId,
        from: j.from || '',
        to: j.to || '',
        subject: j.subject || '',
        date: j.date || '',
        bodyText: j.bodyText || null,
        bodyHtml: j.bodyHtml || null,
        snippet: j.snippet || '',
      }],
    };
    threadCache.set(threadId, { asOf: Date.now(), data: detail });
    return detail;
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 200) };
  }
}

// ── Helpers for heartbeat + morning brief ────────────────────────────

/** Build a Set of known-client email domains by reading Vendasta companies'
 *  website hostnames. Cached because Vendasta + parsing is non-trivial. */
let knownDomainsCache: { asOf: number; domains: Set<string> } | null = null;
export async function getKnownClientDomains(): Promise<Set<string>> {
  if (knownDomainsCache && Date.now() - knownDomainsCache.asOf < KNOWN_CONTACT_TTL_MS) {
    return knownDomainsCache.domains;
  }
  const out = new Set<string>();
  try {
    const { getVendastaData } = await import('./vendasta-data.js');
    const v = await getVendastaData({ force: false });
    if (v.connectionStatus !== 'ok') {
      knownDomainsCache = { asOf: Date.now(), domains: out };
      return out;
    }
    const collect = (rows: Array<{ website: string | null }>) => {
      for (const r of rows) {
        if (!r.website) continue;
        try {
          const u = new URL(r.website.startsWith('http') ? r.website : 'https://' + r.website);
          const host = u.hostname.toLowerCase().replace(/^www\./, '');
          if (host && host.includes('.')) out.add(host);
        } catch { /* skip malformed */ }
      }
    };
    collect(v.bySlug.pwps.recentCompanies as any);
    collect(v.bySlug.default.recentCompanies as any);
    // Also pull the broader list via top-deal companies if surfaced
    knownDomainsCache = { asOf: Date.now(), domains: out };
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'email-data: known-domain build failed');
  }
  return out;
}

/** Unread emails older than `minHours`, optionally only from known-client
 *  domains or with urgency keywords. */
export async function findStaleImportantEmails(opts: { minHours: number; knownOnly?: boolean }): Promise<EmailRow[]> {
  const inbox = await getInbox({ limit: 50 });
  if (!inbox.emails.length) return [];
  const knownDomains = opts.knownOnly ? await getKnownClientDomains() : null;
  const out: EmailRow[] = [];
  for (const r of inbox.emails) {
    if (!r.unread) continue;
    if (r.ageHours < opts.minHours) continue;
    const fromDomain = r.fromEmail.includes('@') ? r.fromEmail.split('@')[1] : '';
    const matchesKnown = knownDomains ? knownDomains.has(fromDomain) : false;
    if (opts.knownOnly && !matchesKnown && !r.hasUrgentKeyword) continue;
    out.push(r);
  }
  return out;
}

/** Top N unreplied / unread emails for the morning brief, formatted as a
 *  short context block. */
export async function buildBriefEmailBlock(limit = 3): Promise<string> {
  const inbox = await getInbox({ limit: 25 });
  if (!inbox.emails.length) return '';
  const unread = inbox.emails.filter(e => e.unread).slice(0, limit);
  if (unread.length === 0) return 'Inbox: zero unread.';
  const lines = unread.map(e => {
    const who = e.fromName || e.fromEmail;
    const age = e.ageHours > 24 ? `${Math.round(e.ageHours / 24)}d` : `${Math.round(e.ageHours)}h`;
    return `  · ${who} (${age} old): ${e.subject}`;
  });
  return `Inbox: ${unread.length} unread worth eyeing.\n${lines.join('\n')}`;
}
