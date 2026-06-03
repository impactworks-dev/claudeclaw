// QuickBooks Online P&L data layer.
//
// Pulls Profit & Loss reports from QBO for MTD and last 30 days, plus a
// flat list of line items grouped by QB account name. Used by the Cash
// page in Mission Control to display REAL accounting numbers instead of
// the Plaid-heuristic categorization that cash-data.ts produces.
//
// Cache: 1 hour on the persistent volume (same pattern as cash-data.ts).
// QBO API rate limit is 500 requests/min — caching aggressively keeps us
// well under that even with multiple dashboard refreshes.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { PROJECT_ROOT, STORE_DIR } from './config.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const QBO_SERVER = path.join(PROJECT_ROOT, 'connectors', 'quickbooks', 'server.mjs');
const CACHE_FILE = path.join(STORE_DIR, 'qb-cache.json');
const TTL_MS = 60 * 60 * 1000; // 1 hour — P&L doesn't move much intraday

export interface QbPeriod {
  revenueCents: number;  // Total Income
  cogsCents: number;     // Cost of Goods/Services Sold
  opexCents: number;     // Total Operating Expenses (everything not Revenue or COGS)
  netCents: number;      // Net Income
}

export interface QbLineItem {
  account: string;        // QBO account name (e.g. "Software & Subscriptions")
  amountCents: number;    // Period total
  type: 'revenue' | 'cogs' | 'opex' | 'other';
}

export interface QbSummary {
  asOf: number;
  configured: boolean;        // false if QBO_CLIENT_ID missing
  connectionStatus: 'ok' | 'not-connected' | 'no-credentials' | 'error';
  connectionMessage: string | null;
  company: { name: string | null; realmId: string | null };
  mtd: QbPeriod;
  last30: QbPeriod;
  lineItems: QbLineItem[];    // Last-30 lines for the breakdown table, sorted by magnitude
  runwayDays: number | null;  // cash / (last30 burn / 30)
}

const ZERO_PERIOD: QbPeriod = { revenueCents: 0, cogsCents: 0, opexCents: 0, netCents: 0 };

async function qboCall(tool: string, args: Record<string, unknown> = {}): Promise<any> {
  const { stdout } = await execFileAsync(
    'node',
    [QBO_SERVER, '--call', tool, JSON.stringify(args)],
    { env: { ...process.env }, maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

// ---- Cache ----
function readCache(): { asOf: number; data: QbSummary } | null {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - j.asOf < TTL_MS) return j;
  } catch { /* ignore */ }
  return null;
}
function writeCache(data: QbSummary): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ asOf: data.asOf, data }, null, 2));
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'qb: cache write failed');
  }
}

// ---- Report parsing ----
//
// Intuit P&L reports have a deep nested structure. After flattenReportRows()
// in the connector, each row is { depth, label, values: [string], summary? }.
// The values are dollar strings like "$3,938.55" or "(883.25)". Parse them
// into cents and classify by which section heading they appear under.
//
// QBO P&L section headings (US, standard):
//   Income / Sales        → revenue
//   Cost of Goods Sold    → cogs (also "Cost of Sales", "Cost of Services")
//   Expenses              → opex
//   Other Income          → revenue (rare)
//   Other Expenses        → opex (rare)

function dollarsToCents(s: string | null | undefined): number {
  if (!s) return 0;
  const trimmed = String(s).trim();
  if (!trimmed) return 0;
  // Strip $, commas, surrounding whitespace; preserve negative sign and parens
  let signed = trimmed.replace(/[$,\s]/g, '');
  if (/^\(.+\)$/.test(signed)) signed = '-' + signed.slice(1, -1);
  const n = parseFloat(signed);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

interface ParsedReport {
  totals: { revenue: number; cogs: number; opex: number; net: number };
  lineItems: QbLineItem[];
}

function classifySection(label: string): QbLineItem['type'] {
  const l = label.toLowerCase();
  if (l.includes('income') || l === 'sales' || l.includes('revenue')) return 'revenue';
  if (l.includes('cost of goods') || l.includes('cost of services') || l.includes('cost of sales')) return 'cogs';
  if (l === 'expenses' || l.includes('operating expense')) return 'opex';
  return 'other';
}

function parsePnL(report: any): ParsedReport {
  // The connector's parseReport() shape:
  //   { name, period, currency, columns, rows: [{ depth, label, values?, summary? }, ...] }
  const rows: Array<{ depth: number; label: string; values?: string[]; summary?: boolean; group?: boolean }> =
    report?.rows || [];

  let currentSection: QbLineItem['type'] = 'other';
  const totals = { revenue: 0, cogs: 0, opex: 0, net: 0 };
  const lineItems: QbLineItem[] = [];

  for (const row of rows) {
    const label = row.label || '';
    const firstValue = row.values?.[0];
    const cents = dollarsToCents(firstValue);

    if (row.group) {
      // Section header — update what bucket subsequent rows belong to
      currentSection = classifySection(label);
      continue;
    }

    if (row.summary) {
      // "Total Income", "Total Cost of Goods Sold", "Total Expenses", "Net Income"
      const labelLower = label.toLowerCase();
      if (labelLower.includes('net income') || labelLower.includes('net operating') || labelLower === 'net') {
        totals.net = cents;
      } else if (labelLower.includes('total income') || labelLower.includes('total revenue')) {
        totals.revenue += cents;
      } else if (labelLower.includes('total cost of goods') || labelLower.includes('total cost of services') || labelLower.includes('total cost of sales')) {
        totals.cogs += cents;
      } else if (labelLower.includes('total expense')) {
        totals.opex += cents;
      } else if (labelLower.includes('total other expense')) {
        totals.opex += cents;
      } else if (labelLower.includes('total other income')) {
        totals.revenue += cents;
      }
      continue;
    }

    // Regular line item — add to the breakdown list (skip zero rows, skip
    // the row labeled "" or just whitespace)
    if (!label.trim() || cents === 0) continue;
    lineItems.push({ account: label.trim(), amountCents: Math.abs(cents), type: currentSection });
  }

  // If Intuit didn't surface a Net Income summary row for some reason, compute it
  if (totals.net === 0) totals.net = totals.revenue - totals.cogs - totals.opex;

  return { totals, lineItems };
}

// ---- Date helpers ----
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function startOfMonthUTC(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function daysAgoUTC(n: number): Date { return new Date(Date.now() - n * 24 * 3600 * 1000); }

// ---- Public API ----
export async function getQbData(opts: { force?: boolean; totalCashCents?: number } = {}): Promise<QbSummary> {
  if (!opts.force) {
    const c = readCache();
    if (c) return c.data;
  }

  // Detect missing credentials up front so the UI can show a clean CTA
  const haveCreds =
    !!process.env.QBO_CLIENT_ID ||
    /^QBO_CLIENT_ID=/m.test((() => { try { return fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf-8'); } catch { return ''; } })());
  if (!haveCreds) {
    return emptySummary('no-credentials', 'QBO_CLIENT_ID not set. Set Fly secrets and re-deploy.');
  }

  let companyInfo: any;
  try {
    companyInfo = await qboCall('qbo_get_company_info', {});
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/No QBO token/i.test(msg)) {
      return emptySummary('not-connected', 'No QBO token. Visit /api/qbo/connect to authorize.');
    }
    return emptySummary('error', msg);
  }

  // MTD: first of current month → today.
  // Last30: 30 days ago → today.
  const today = new Date();
  const mtdStart = ymd(startOfMonthUTC(today));
  const last30Start = ymd(daysAgoUTC(30));
  const todayStr = ymd(today);

  let mtdReport: any, last30Report: any;
  try {
    [mtdReport, last30Report] = await Promise.all([
      qboCall('qbo_get_pnl', { start_date: mtdStart, end_date: todayStr, accounting_method: 'Accrual' }),
      qboCall('qbo_get_pnl', { start_date: last30Start, end_date: todayStr, accounting_method: 'Accrual' }),
    ]);
  } catch (e) {
    return emptySummary('error', String((e as Error)?.message || e));
  }

  const mtdParsed = parsePnL(mtdReport);
  const last30Parsed = parsePnL(last30Report);

  const mtd: QbPeriod = {
    revenueCents: mtdParsed.totals.revenue,
    cogsCents: mtdParsed.totals.cogs,
    opexCents: mtdParsed.totals.opex,
    netCents: mtdParsed.totals.net,
  };
  const last30: QbPeriod = {
    revenueCents: last30Parsed.totals.revenue,
    cogsCents: last30Parsed.totals.cogs,
    opexCents: last30Parsed.totals.opex,
    netCents: last30Parsed.totals.net,
  };

  // Sort line items by absolute amount, biggest first — most informative
  // for the breakdown table.
  const lineItems = last30Parsed.lineItems
    .filter(l => l.type !== 'other')
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 40);

  // Runway: cash / (last30 burn / 30). Burn = -netCents over the period.
  // If net is positive (profitable), runway is infinite — represent as null.
  let runwayDays: number | null = null;
  const burnPerDayCents = -last30.netCents / 30;
  if (burnPerDayCents > 0 && opts.totalCashCents && opts.totalCashCents > 0) {
    runwayDays = Math.floor(opts.totalCashCents / burnPerDayCents);
  }

  const result: QbSummary = {
    asOf: Date.now(),
    configured: true,
    connectionStatus: 'ok',
    connectionMessage: null,
    company: { name: companyInfo?.company_name || null, realmId: companyInfo?.realm_id || null },
    mtd, last30, lineItems, runwayDays,
  };
  writeCache(result);
  return result;
}

function emptySummary(status: QbSummary['connectionStatus'], message: string | null): QbSummary {
  return {
    asOf: Date.now(),
    configured: status !== 'no-credentials',
    connectionStatus: status,
    connectionMessage: message,
    company: { name: null, realmId: null },
    mtd: { ...ZERO_PERIOD },
    last30: { ...ZERO_PERIOD },
    lineItems: [],
    runwayDays: null,
  };
}
