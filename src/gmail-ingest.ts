/**
 * gmail-ingest.ts
 *
 * Fetches recent important emails, extracts structured knowledge via Gemini,
 * and saves to the ClaudeClaw memory DB with source='gmail'.
 *
 * Skips: newsletters, automated alerts, already-ingested threads.
 * Index: store/gmail-index.json  { threadId → { lastMessageId, ingestedAt } }
 *
 * CLI: npx tsx src/gmail-ingest.ts [--limit N] [--days N] [--dry-run] [--reset]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { generateContent, parseJsonResponse } from './gemini.js';
import { initDatabase, saveStructuredMemory } from './db.js';
import { requireEnabled } from './kill-switches.js';
import { logger } from './logger.js';
import { searchEmails, readEmail, type EmailSummary } from './gmail.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtractionResult {
  summary: string;
  key_facts: string[];
  entities: string[];
  topics: string[];
  importance: number;
  email_type: string; // 'client', 'vendor', 'internal', 'lead', 'misc'
}

interface IndexEntry {
  lastMessageId: string;
  ingestedAt: string;
  subject: string;
}

interface IngestIndex {
  [threadId: string]: IndexEntry;
}

// ── Config ────────────────────────────────────────────────────────────────────

// Trusted sender domains — emails from these domains are always ingested.
// Add client/partner/vendor domains here as they come up.
const TRUSTED_DOMAINS = new Set([
  // Dante's own companies
  'impactworks.com',
  'rocketlocal.ai',

  // Known clients & partners (add more as needed)
  'scentco.com',
  'vascuscreen.com',
  'pickmypaintup.com',
  'renfrowdata.com',
  'cybergl.com',
  'neatcapmedical.com',
  'dundasmatheson.com',
  'summerfieldcw.com',
  'wallaceperiodontics.com',
  'vendasta.com',
  'clickup.com',

  // Tools & services that send actionable emails
  'fly.io',
  'github.com',
  'stripe.com',
  'quickbooks.intuit.com',
]);

// Extract domain from a "Name <email@domain.com>" or "email@domain.com" string
function senderDomain(from: string): string {
  const match = from.match(/@([\w.-]+)/);
  return match ? match[1].toLowerCase() : '';
}

function isTrustedSender(email: EmailSummary): boolean {
  const domain = senderDomain(email.from);
  if (!domain) return false;
  // Exact domain match or subdomain match (e.g. mail.impactworks.com)
  return [...TRUSTED_DOMAINS].some(d => domain === d || domain.endsWith('.' + d));
}

// Hard block: automated system mail we never want regardless of domain
const ALWAYS_SKIP_FROM = [
  /noreply@/i,
  /no-reply@/i,
  /donotreply@/i,
  /bounce@/i,
  /mailer-daemon@/i,
];

function shouldSkip(email: EmailSummary): boolean {
  // Block obvious automated senders first
  if (ALWAYS_SKIP_FROM.some(p => p.test(email.from))) return true;
  // Only keep trusted-domain senders
  return !isTrustedSender(email);
}

// ── Index helpers ─────────────────────────────────────────────────────────────

function resolveStorePath(): string {
  if (process.env.STORE_DIR) return process.env.STORE_DIR;
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    return path.join(root, 'store');
  } catch {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'store');
  }
}

function loadIndex(indexPath: string): IngestIndex {
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveIndex(indexPath: string, index: IngestIndex): void {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// ── Gemini extraction ─────────────────────────────────────────────────────────

function buildPrompt(email: EmailSummary, bodyText: string): string {
  const snippet = bodyText.slice(0, 4000);
  return `Extract structured knowledge from this email. Return a JSON object with:
- summary (string): one-sentence summary of what this email is about
- key_facts (array of strings): 3-8 key facts, decisions, action items, or information from this email. Each must be a single plain text string with no newlines.
- entities (array of strings): people, companies, products, or tools mentioned
- topics (array of strings): topic tags (e.g. "client", "proposal", "invoice", "partnership")
- importance (number 0-1): how important/relevant this email is to business operations
- email_type (string): one of "client", "vendor", "internal", "lead", "misc"

CRITICAL: All string values must be single-line with no embedded newlines.

From: ${email.from}
To: ${email.to}
Subject: ${email.subject}
Date: ${email.date}

Body:
${snippet}`;
}

// ── Main export ────────────────────────────────────────────────────────────────

export interface GmailIngestResult {
  scanned: number;
  skipped: number;
  processed: number;
  failed: number;
  memoriesSaved: number;
}

export async function runGmailIngest(opts: {
  limit?: number;
  days?: number;
  dryRun?: boolean;
  reset?: boolean;
  delayMs?: number;
} = {}): Promise<GmailIngestResult> {
  requireEnabled('LLM_SPAWN_ENABLED');

  const { limit = 50, days = 60, dryRun = false, reset = false, delayMs = 1500 } = opts;
  const storePath = resolveStorePath();
  const indexPath = path.join(storePath, 'gmail-index.json');

  if (reset) {
    try { fs.unlinkSync(indexPath); } catch { /* ok */ }
    logger.info('Gmail ingest: index reset');
  }

  const index = loadIndex(indexPath);
  const db = initDatabase();

  const result: GmailIngestResult = { scanned: 0, skipped: 0, processed: 0, failed: 0, memoriesSaved: 0 };

  // category:primary = Gmail's Primary tab only (excludes Promotions, Social, Updates, Forums)
  const query = `category:primary -in:spam -in:trash newer_than:${days}d`;
  logger.info({ query, limit, days }, 'Gmail ingest: starting');

  let emails: EmailSummary[];
  try {
    emails = await searchEmails(query, Math.min(limit * 2, 200));
  } catch (err) {
    logger.error({ err }, 'Gmail ingest: searchEmails failed');
    return result;
  }

  // Group by threadId to avoid ingesting the same thread twice
  const seen = new Set<string>();
  const toProcess: EmailSummary[] = [];

  for (const email of emails) {
    if (seen.has(email.threadId)) continue;
    seen.add(email.threadId);
    result.scanned++;

    if (shouldSkip(email)) {
      result.skipped++;
      continue;
    }

    // Already indexed and we have the same message → skip
    const existing = index[email.threadId];
    if (existing && existing.lastMessageId === email.id) {
      result.skipped++;
      continue;
    }

    toProcess.push(email);
    if (toProcess.length >= limit) break;
  }

  logger.info({ toProcess: toProcess.length }, 'Gmail ingest: processing threads');

  const chatId = 'gmail-ingest';

  for (const email of toProcess) {
    try {
      // Fetch full body
      const full = await readEmail(email.id);
      const bodyText = full.bodyText || full.bodyHtml.replace(/<[^>]+>/g, '') || email.snippet;

      const prompt = buildPrompt(email, bodyText);
      const raw = await generateContent(prompt);
      const extracted = parseJsonResponse<ExtractionResult>(raw);

      if (!extracted || !extracted.summary) {
        logger.warn({ subject: email.subject }, 'Gmail ingest: extraction returned null');
        result.failed++;
        continue;
      }

      const rawText = [
        `From: ${email.from}`,
        `To: ${email.to}`,
        `Subject: ${email.subject}`,
        `Date: ${email.date}`,
        '',
        bodyText.slice(0, 2000),
      ].join('\n');

      if (!dryRun) {
        const memoryId = saveStructuredMemory(
          chatId,
          rawText,
          extracted.summary,
          extracted.entities,
          extracted.topics,
          extracted.importance,
          'gmail',
          'main',
        );

        index[email.threadId] = {
          lastMessageId: email.id,
          ingestedAt: new Date().toISOString(),
          subject: email.subject,
        };
        saveIndex(indexPath, index);
        result.memoriesSaved++;
        logger.info({ subject: email.subject, memoryId }, 'Gmail ingest: ✓ saved');
      } else {
        logger.info({ subject: email.subject, summary: extracted.summary }, 'Gmail ingest: dry-run ✓');
        result.memoriesSaved++;
      }

      result.processed++;
    } catch (err) {
      logger.warn({ err, subject: email.subject }, 'Gmail ingest: thread failed');
      result.failed++;
    }

    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }

  logger.info(result, 'Gmail ingest: complete');
  return result;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\.ts$/, '.js'));

if (isMain) {
  const args = process.argv.slice(2);
  const limit = parseInt(args[args.indexOf('--limit') + 1] ?? '50', 10) || 50;
  const days = parseInt(args[args.indexOf('--days') + 1] ?? '60', 10) || 60;
  const dryRun = args.includes('--dry-run');
  const reset = args.includes('--reset');

  runGmailIngest({ limit, days, dryRun, reset, delayMs: 2000 })
    .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
