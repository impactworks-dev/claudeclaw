// Investments data layer.
//
// Aggregates portfolio holdings across every Plaid item that was linked
// with the `investments` product. Returns:
//   - totalValue            total portfolio value in cents
//   - totalDayChange        net day P/L (sum of holding-level price * qty deltas)
//   - perAccount            per-institution + per-account breakdown
//   - topHoldings           top N positions sorted by current value
//
// Cache: 30 minutes on the persistent volume. Plaid /investments/holdings/get
// is the slowest endpoint we use (~3-5s per item), so caching aggressively
// keeps the dashboard snappy without hammering the Plaid API.

import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { STORE_DIR, PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const PLAID_SERVER = path.join(PROJECT_ROOT, 'connectors', 'plaid', 'server.mjs');
const CACHE_FILE = path.join(STORE_DIR, 'investments-cache.json');
const TTL_MS = 30 * 60 * 1000;

export interface InvestmentAccount {
  item_id: string;
  institution_name: string | null;
  account_id: string;
  name: string;
  type: string | null;          // 'investment' | 'brokerage' | 'depository' (some institutions)
  subtype: string | null;       // '401k', 'ira', 'brokerage', etc.
  mask: string | null;
  currentValue: number;         // cents
  dayChange: number;            // cents (current - previous)
}

export interface TopHolding {
  ticker: string | null;
  name: string;
  type: string | null;          // 'equity', 'etf', 'mutual fund', 'cash', 'crypto', ...
  quantity: number;
  pricePerShare: number;        // cents
  currentValue: number;         // cents
  costBasis: number | null;     // cents
  dayChange: number;            // cents (estimated from close vs prev)
  weight: number;               // 0–100, percentage of total portfolio
}

export interface InvestmentsSummary {
  asOf: number;
  configured: boolean;
  error?: string;
  totalValue: number;           // cents
  totalDayChange: number;       // cents
  totalDayChangePct: number;    // 0-100, ignoring sign convention
  accountCount: number;
  perAccount: InvestmentAccount[];
  topHoldings: TopHolding[];    // top N by currentValue
  institutionErrors: Array<{ institution_name: string | null; error: string }>;
}

function emptySummary(reason: string, error?: string): InvestmentsSummary {
  return {
    asOf: Date.now(),
    configured: reason !== 'no-credentials',
    error,
    totalValue: 0,
    totalDayChange: 0,
    totalDayChangePct: 0,
    accountCount: 0,
    perAccount: [],
    topHoldings: [],
    institutionErrors: [],
  };
}

function readCache(): InvestmentsSummary | null {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - j.asOf < TTL_MS) return j;
  } catch { /* ignore */ }
  return null;
}

function writeCache(data: InvestmentsSummary): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'investments: cache write failed');
  }
}

async function plaidCall(tool: string, args: Record<string, unknown> = {}): Promise<any> {
  const { stdout } = await execFileAsync('node', [PLAID_SERVER, '--call', tool, JSON.stringify(args)], {
    env: { ...process.env },
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

const toCents = (n: number | null | undefined): number => {
  if (n == null || !isFinite(n)) return 0;
  return Math.round(n * 100);
};

export function invalidateInvestmentsCache(): void {
  try { fs.unlinkSync(CACHE_FILE); } catch { /* ignore */ }
}

export async function getInvestmentsData(opts: { force?: boolean } = {}): Promise<InvestmentsSummary> {
  if (!opts.force) {
    const c = readCache();
    if (c) return c;
  }

  // Plaid's connector returns a soft-failure shape (item_errors) rather than
  // throwing when no investment items exist. Handle the missing-API case
  // (no Plaid credentials) explicitly here.
  let raw;
  try {
    raw = await plaidCall('plaid_get_holdings', {});
  } catch (e) {
    const err = String((e as Error)?.message || e);
    if (err.includes('PLAID') && err.includes('credentials')) {
      return emptySummary('no-credentials', 'Plaid not configured');
    }
    return emptySummary('error', err);
  }

  const accounts = (raw.accounts || []) as Array<{ account_id: string; item_id: string; institution_name: string | null; name: string; type: string | null; subtype: string | null; mask: string | null; balances: { current: number | null; iso_currency_code: string | null } }>;
  const holdings = (raw.holdings || []) as Array<{ account_id: string; security_id: string; quantity: number; institution_value: number | null; institution_price: number | null; cost_basis: number | null; institution_price_as_of?: string | null }>;
  const securities = (raw.securities || []) as Array<{ security_id: string; ticker_symbol: string | null; name: string; type: string | null; close_price: number | null; close_price_as_of: string | null }>;

  if (accounts.length === 0 && holdings.length === 0) {
    const errs = (raw.item_errors || []).map((e: { institution_name: string | null; error: string }) => e.error).join(' | ');
    const summary = emptySummary(
      'no-investments-linked',
      errs ? `No investment accounts linked. Last attempt: ${errs.slice(0, 200)}` : 'No investment accounts linked. Open the Plaid Link flow and select an investment institution (Schwab, Vanguard, Stash, etc.).'
    );
    summary.institutionErrors = (raw.item_errors || []).map((e: { institution_name: string | null; error: string }) => ({
      institution_name: e.institution_name,
      error: e.error,
    }));
    return summary;
  }

  // Index securities for fast lookup.
  const securityById = new Map(securities.map(s => [s.security_id, s]));
  const accountById = new Map(accounts.map(a => [a.account_id, a]));

  // Aggregate per-account value + day change. Plaid balances.current is the
  // institution's reported account value. For day-change we sum the holding-
  // level (current price - close price) * quantity across the account.
  const accountAgg = new Map<string, { currentValue: number; dayChange: number }>();
  // Aggregate holdings by security across accounts.
  const holdingAgg = new Map<string, TopHolding>();

  for (const h of holdings) {
    const sec = securityById.get(h.security_id);
    if (!sec) continue;
    const value = toCents(h.institution_value);
    const pricePerShare = toCents(h.institution_price);
    const closePrice = toCents(sec.close_price);
    const dayDelta = (pricePerShare && closePrice) ? Math.round((pricePerShare - closePrice) * h.quantity) : 0;

    // Per-account totals
    const a = accountAgg.get(h.account_id) || { currentValue: 0, dayChange: 0 };
    a.currentValue += value;
    a.dayChange += dayDelta;
    accountAgg.set(h.account_id, a);

    // Per-security totals (in case the same ticker is held across accounts)
    const key = sec.security_id;
    const existing = holdingAgg.get(key);
    if (existing) {
      existing.quantity += h.quantity;
      existing.currentValue += value;
      existing.dayChange += dayDelta;
      if (h.cost_basis != null) existing.costBasis = (existing.costBasis || 0) + toCents(h.cost_basis);
    } else {
      holdingAgg.set(key, {
        ticker: sec.ticker_symbol,
        name: sec.name,
        type: sec.type,
        quantity: h.quantity,
        pricePerShare,
        currentValue: value,
        costBasis: h.cost_basis != null ? toCents(h.cost_basis) : null,
        dayChange: dayDelta,
        weight: 0,
      });
    }
  }

  // Compose per-account list, preferring Plaid's reported balance.current
  // when present (it's the "official" balance the institution reports).
  // Fall back to holding-sum when missing.
  const perAccount: InvestmentAccount[] = accounts.map(a => {
    const agg = accountAgg.get(a.account_id) || { currentValue: 0, dayChange: 0 };
    const officialValue = toCents(a.balances?.current);
    return {
      item_id: a.item_id,
      institution_name: a.institution_name,
      account_id: a.account_id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
      currentValue: officialValue || agg.currentValue,
      dayChange: agg.dayChange,
    };
  });

  // Sort: biggest accounts first
  perAccount.sort((x, y) => y.currentValue - x.currentValue);

  const totalValue = perAccount.reduce((s, a) => s + a.currentValue, 0);
  const totalDayChange = perAccount.reduce((s, a) => s + a.dayChange, 0);
  const prevValue = totalValue - totalDayChange;
  const totalDayChangePct = prevValue > 0 ? +((totalDayChange / prevValue) * 100).toFixed(2) : 0;

  // Top holdings (top 10 by value; UI can slice to 5 for the dashboard tile)
  const topHoldings = [...holdingAgg.values()]
    .filter(h => h.currentValue > 0)
    .sort((a, b) => b.currentValue - a.currentValue)
    .slice(0, 10)
    .map(h => ({
      ...h,
      weight: totalValue > 0 ? +((h.currentValue / totalValue) * 100).toFixed(2) : 0,
    }));

  const summary: InvestmentsSummary = {
    asOf: Date.now(),
    configured: true,
    totalValue,
    totalDayChange,
    totalDayChangePct,
    accountCount: perAccount.length,
    perAccount,
    topHoldings,
    institutionErrors: (raw.item_errors || []).map((e: { institution_name: string | null; error: string }) => ({
      institution_name: e.institution_name,
      error: e.error,
    })),
  };
  writeCache(summary);
  return summary;
}
