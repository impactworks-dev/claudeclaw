// Vendasta "Real MRR" data layer for the Founder Dashboard tile.
//
// Calls the existing vendasta_revenue_by_account MCP tool, then strips
// out Dante's own internal accounts (Pest WebPros = ImpactWorks; RocketLocal)
// so the customer-revenue picture is honest. Numbers come from the
// connector which already filters to fulfilled+recurring line items
// (one-time fees and draft/declined/error orders are excluded upstream).
//
// Cache: 30 minutes on disk. The revenue rollup is slow (~40s) because
// it paginates through every order + purchase in the partner, so we
// don't want to re-run it on every dashboard hit.

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { STORE_DIR, PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';

const CACHE_FILE = path.join(STORE_DIR, 'vendasta-revenue-cache.json');
const TTL_MS = 30 * 60 * 1000;
const VENDASTA_SERVER = path.join(PROJECT_ROOT, 'connectors', 'vendasta', 'server.mjs');

// Internal account AG-IDs to exclude from customer revenue totals.
// These are Dante's own companies (Pest WebPros => ImpactWorks rename,
// and RocketLocal). They produce billing line items in Vendasta but are
// not external customer revenue.
const INTERNAL_AG_IDS = new Set([
  'AG-TH5BR7824X', // ImpactWorks / Pest WebPros
  'AG-PDN4DDQS4X', // RocketLocal
]);

interface AccountTotals {
  name: string | null;
  marketSlug: string | null;  // 'pwps' = ImpactWorks, 'default' = Rocket Local
  retailMRR: number;       // cents
  wholesaleLifetime: number;
  wholesaleMonthly: number;
}

interface MarketTotals {
  retailMRR: number;
  wholesaleMonthly: number;
  wholesaleLifetime: number;
  accounts: number;
  accountsWithRetail: number;
}

interface RevenueResponse {
  byAccount: Record<string, AccountTotals>;
  byMarket?: Record<string, MarketTotals>;
  totals: { retailMRR: number; wholesaleMonthly: number; accounts: number };
  currency: string;
  unit: string;
}

export interface BrandTotals {
  // 'ImpactWorks' (pwps) or 'Rocket Local' (default)
  label: string;
  slug: string;
  customerRetailMRR: number;
  wholesaleMonthly: number;
  grossMargin: number;
  marginPct: number;
  customerCount: number;
  retailShare: number;   // % of total customer retail attributable to this brand
}

export interface CleanedRevenue {
  asOf: number;
  currency: 'USD';
  unit: 'cents';
  customerRetailMRR: number;   // excluding internal accounts
  internalRetailMRR: number;   // sum of Pest WebPros + RocketLocal
  rawRetailMRR: number;        // total from Vendasta (= customer + internal)
  wholesaleMonthly: number;    // pass-through, doesn't subtract internal
  grossMargin: number;         // customerRetailMRR - wholesaleMonthly
  marginPct: number;           // 0-100
  customerCount: number;       // accounts with retail > 0, excluding internals
  // Per-market split for QBO Class-based booking. Internal AG-IDs are
  // excluded from this aggregation just like the top-line numbers.
  brands?: BrandTotals[];
  topCustomers: Array<{
    agid: string;
    name: string | null;
    retailMRR: number;
    wholesaleMonthly: number;
    margin: number;
  }>;
  // Full customer list with retail + wholesale + margin per account.
  // Populated only when getCleanedRevenue({ full: true }) is called; omitted
  // from the default cached payload to keep dashboard hits cheap.
  customers?: Array<{
    agid: string;
    name: string | null;
    retailMRR: number;
    wholesaleMonthly: number;
    margin: number;
  }>;
}

function readCache(): CleanedRevenue | null {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - j.asOf < TTL_MS) return j;
  } catch { /* ignore */ }
  return null;
}

function writeCache(snap: CleanedRevenue): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(snap), 'utf-8');
  } catch (err) {
    logger.warn({ err }, 'vendasta-revenue: failed to write cache');
  }
}

function callConnector(): Promise<RevenueResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [VENDASTA_SERVER, '--call', 'vendasta_revenue_by_account', '{}'], {
      env: process.env,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`vendasta connector exit ${code}: ${err.slice(0, 500)}`));
      try {
        // Strip any potential prefix the connector adds before JSON
        const jsonStart = out.indexOf('{');
        if (jsonStart < 0) return reject(new Error('connector returned no JSON'));
        resolve(JSON.parse(out.slice(jsonStart)) as RevenueResponse);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Vendasta CRM slugs → brand labels used in QBO Classes.
const MARKET_LABELS: Record<string, string> = {
  pwps: 'ImpactWorks',
  default: 'Rocket Local',
};

function clean(raw: RevenueResponse, opts: { full?: boolean } = {}): CleanedRevenue {
  let customerRetailMRR = 0;
  let internalRetailMRR = 0;
  let customerCount = 0;
  const customers: Array<{ agid: string; name: string | null; retailMRR: number; wholesaleMonthly: number; margin: number }> = [];

  // Accumulate per-market totals as we walk byAccount, so we don't iterate twice.
  const perBrand: Record<string, { retail: number; wholesale: number; count: number }> = {};
  const bumpBrand = (slug: string, retail: number, wholesale: number) => {
    const key = slug || 'unknown';
    if (!perBrand[key]) perBrand[key] = { retail: 0, wholesale: 0, count: 0 };
    perBrand[key].retail += retail;
    perBrand[key].wholesale += wholesale;
    if (retail > 0) perBrand[key].count += 1;
  };

  for (const [agid, totals] of Object.entries(raw.byAccount || {})) {
    if (INTERNAL_AG_IDS.has(agid)) {
      internalRetailMRR += totals.retailMRR;
      continue;
    }
    // Bucket every customer (even zero-retail) into its brand so the count
    // matches what's on the Vendasta CRM widget.
    bumpBrand(totals.marketSlug || 'unknown', totals.retailMRR, totals.wholesaleMonthly);
    if ((totals.retailMRR || 0) <= 0) continue;
    customerRetailMRR += totals.retailMRR;
    customerCount += 1;
    customers.push({
      agid,
      name: totals.name,
      retailMRR: totals.retailMRR,
      wholesaleMonthly: totals.wholesaleMonthly,
      margin: (totals.retailMRR || 0) - (totals.wholesaleMonthly || 0),
    });
  }

  customers.sort((a, b) => b.retailMRR - a.retailMRR);
  const topCustomers = customers.slice(0, 5);

  const wholesaleMonthly = raw.totals.wholesaleMonthly || 0;
  const grossMargin = customerRetailMRR - wholesaleMonthly;
  const marginPct = customerRetailMRR > 0 ? (grossMargin / customerRetailMRR) * 100 : 0;

  // Build the per-brand split. Only emit the known brands (pwps, default) so
  // 'unknown' (untagged customers) gets surfaced as its own row for triage.
  const brands: BrandTotals[] = [];
  for (const slug of Object.keys(perBrand)) {
    const p = perBrand[slug];
    const margin = p.retail - p.wholesale;
    brands.push({
      label: MARKET_LABELS[slug] || (slug === 'unknown' ? 'Unknown / untagged' : slug),
      slug,
      customerRetailMRR: p.retail,
      wholesaleMonthly: p.wholesale,
      grossMargin: margin,
      marginPct: p.retail > 0 ? (margin / p.retail) * 100 : 0,
      customerCount: p.count,
      retailShare: customerRetailMRR > 0 ? (p.retail / customerRetailMRR) * 100 : 0,
    });
  }
  // Sort so ImpactWorks > Rocket Local > Unknown by retail
  brands.sort((a, b) => b.customerRetailMRR - a.customerRetailMRR);

  return {
    asOf: Date.now(),
    currency: 'USD',
    unit: 'cents',
    customerRetailMRR,
    internalRetailMRR,
    rawRetailMRR: raw.totals.retailMRR || 0,
    wholesaleMonthly,
    grossMargin,
    marginPct,
    customerCount,
    brands,
    topCustomers,
    ...(opts.full ? { customers } : {}),
  };
}

export async function getCleanedRevenue(opts: { force?: boolean; full?: boolean } = {}): Promise<CleanedRevenue> {
  if (!opts.force && !opts.full) {
    const cached = readCache();
    if (cached) return cached;
  }
  const raw = await callConnector();
  const snap = clean(raw, { full: opts.full });
  // Only cache the slim version (without customers[]) to keep the cache file small.
  const slim = { ...snap, customers: undefined };
  delete (slim as { customers?: unknown }).customers;
  writeCache(slim as CleanedRevenue);
  return snap;
}
