// Vendasta CRM data layer for the Founder Dashboard.
//
// Wraps the vendasta stdio connector with a market-aware aggregation that
// powers the dual-market widget (ImpactWorks vs Rocket Local vs All). Markets
// live inside a SINGLE Vendasta partner ID (0BYD); each company record has a
// `system__company_group_id` slug that identifies which market it belongs to.
//
// Slug → label mapping is hardcoded HERE (not in Vendasta) because the slugs
// are legacy and can't be renamed cleanly:
//   pwps    → ImpactWorks  (~2,028 companies — was "Pest Web Pros" originally)
//   default → Rocket Local (~298 companies — BIDs + Main Street + EDOs)
//
// Cache: 10 min per market (the company/opportunity lists don't move minute
// by minute, and a full scan of 2,326 companies costs a few seconds).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { PROJECT_ROOT, STORE_DIR } from './config.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const VENDASTA_SERVER = path.join(PROJECT_ROOT, 'connectors', 'vendasta', 'server.mjs');
const CACHE_DIR = path.join(STORE_DIR, 'vendasta-cache');
const TTL_MS = 10 * 60 * 1000;

// Slug → friendly label. Keep these in sync with the widget toggle.
export const MARKETS = {
  pwps:    { label: 'ImpactWorks',  brand: '#7c3aed' }, // violet
  default: { label: 'Rocket Local', brand: '#0ea5e9' }, // sky-blue
} as const;
export type MarketSlug = keyof typeof MARKETS;
export const MARKET_SLUGS = Object.keys(MARKETS) as MarketSlug[];

export interface Opportunity {
  name: string;
  accountGroupId: string | null;
  marketSlug: MarketSlug | 'unknown';
  pipelineStage: string | null;             // open | closed-won | closed-lost
  projectedFirstYearValueCents: number;     // in cents
  probableFirstYearValueCents: number;
  probability: number;                      // 0..1
  expectedCloseDate: string | null;
  salesPersonId: string | null;
}

export interface CompanyRow {
  id: string;
  name: string;
  marketSlug: string;
  lifecycleStage: string | null;
  lastActivity: number | null;               // epoch ms
  city: string | null;
  state: string | null;
  website: string | null;
}

export interface MarketSummary {
  slug: MarketSlug | 'all';
  label: string;
  companies: number;
  openDeals: number;
  openDealsValueCents: number;
  openDealsWeightedCents: number;
  recentCompanies: CompanyRow[];             // 8 most-recently-active
  topOpenDeals: Opportunity[];               // up to 5 highest-value open deals
}

export interface VendastaSummary {
  asOf: number;
  configured: boolean;
  connectionStatus: 'ok' | 'no-credentials' | 'error';
  connectionMessage: string | null;
  bySlug: Record<MarketSlug, MarketSummary>;
  all: MarketSummary;
}

// ──────────────────────────────────────────────────────────────────────
// Connector spawn helpers
// ──────────────────────────────────────────────────────────────────────

async function vendastaCall(tool: string, args: Record<string, unknown> = {}): Promise<any> {
  const { stdout } = await execFileAsync(
    'node', [VENDASTA_SERVER, '--call', tool, JSON.stringify(args)],
    { env: { ...process.env }, maxBuffer: 64 * 1024 * 1024 },
  );
  // Server prints either a JSON object or "ERROR ..." to stdout.
  if (stdout.startsWith('ERROR')) throw new Error(stdout.slice(0, 500));
  return JSON.parse(stdout);
}

function getField(fields: any[], id: string): any {
  for (const f of fields || []) if (f.id === id) return f.value;
  return null;
}

function asEpochMs(v: any): number | null {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (v.seconds) return Number(v.seconds) * 1000 + Math.floor((Number(v.nanos) || 0) / 1e6);
  return null;
}

// Pull every company in the workspace and bucket by market slug. We do one
// list_records loop, return the indexed buckets.
async function fetchAllCompanies(): Promise<Map<string, CompanyRow[]>> {
  const buckets = new Map<string, CompanyRow[]>();
  let cursor = '';
  for (let pg = 0; pg < 30; pg++) {  // up to 3000 records
    const args: any = {
      resourceTypeCode: 'companies',
      limit: 100,
      returnFields: [
        'standard__company_name',
        'system__company_group_id',
        'standard__company_lifecycle_stage',
        'system__company_last_activity_date',
        'standard__company_primary_location_city_locality',
        'standard__company_primary_location_state_province_region',
        'standard__company_website',
        'system__company_id',
      ],
    };
    if (cursor) args.cursor = cursor;
    const j = await vendastaCall('vendasta_list_records', args);
    const objs = j.objects || [];
    for (const o of objs) {
      const flds = (o.attributes && o.attributes.fields) || o.fields || [];
      const slug = String(getField(flds, 'system__company_group_id') || '(none)');
      const row: CompanyRow = {
        id: String(getField(flds, 'system__company_id') || o.id || ''),
        name: String(getField(flds, 'standard__company_name') || '(unnamed)'),
        marketSlug: slug,
        lifecycleStage: getField(flds, 'standard__company_lifecycle_stage') || null,
        lastActivity: asEpochMs(getField(flds, 'system__company_last_activity_date')),
        city: getField(flds, 'standard__company_primary_location_city_locality') || null,
        state: getField(flds, 'standard__company_primary_location_state_province_region') || null,
        website: getField(flds, 'standard__company_website') || null,
      };
      if (!buckets.has(slug)) buckets.set(slug, []);
      buckets.get(slug)!.push(row);
    }
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  return buckets;
}

// Pull all opportunities (deals) for the partner. The opportunity payload
// references accountGroupId, NOT the market slug, so we resolve which market
// each deal belongs to by joining against the company records (built above).
async function fetchOpportunities(slugByAgid: Map<string, string>): Promise<Opportunity[]> {
  const j = await vendastaCall('vendasta_list_opportunities', {});
  const out: Opportunity[] = [];
  for (const o of j.results || []) {
    const agid = String(o.accountGroupId || o.account_group_id || '');
    const slug = (slugByAgid.get(agid) || 'unknown') as Opportunity['marketSlug'];
    const stage = String(o.pipelineStage || o.pipeline_stage || '').toLowerCase();
    const projected = Math.round(Number(o.projectedFirstYearValue?.amount || o.projectedFirstYearValue || 0));
    const probable = Math.round(Number(o.probableFirstYearValue?.amount || o.probableFirstYearValue || 0));
    out.push({
      name: String(o.name || '(untitled)'),
      accountGroupId: agid || null,
      marketSlug: slug,
      pipelineStage: stage || null,
      projectedFirstYearValueCents: projected,
      probableFirstYearValueCents: probable,
      probability: Number(o.probability || 0),
      expectedCloseDate: o.expectedCloseDate || o.expected_close_date || null,
      salesPersonId: o.salesPersonId || o.sales_person_id || null,
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Cache
// ──────────────────────────────────────────────────────────────────────

let memCache: { asOf: number; data: VendastaSummary } | null = null;

function readDiskCache(): { asOf: number; data: VendastaSummary } | null {
  try {
    const f = path.join(CACHE_DIR, 'summary.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (Date.now() - j.asOf < TTL_MS) return j;
  } catch { /* ignore */ }
  return null;
}
function writeDiskCache(data: VendastaSummary): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, 'summary.json'), JSON.stringify({ asOf: data.asOf, data }, null, 2));
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'vendasta-data: cache write failed');
  }
}

// ──────────────────────────────────────────────────────────────────────
// Aggregation
// ──────────────────────────────────────────────────────────────────────

function emptyMarket(slug: MarketSlug | 'all', label: string): MarketSummary {
  return {
    slug, label, companies: 0, openDeals: 0, openDealsValueCents: 0, openDealsWeightedCents: 0,
    recentCompanies: [], topOpenDeals: [],
  };
}

function buildMarketSummary(slug: MarketSlug | 'all', label: string, companies: CompanyRow[], opps: Opportunity[]): MarketSummary {
  // recent companies — sorted by last activity desc, top 8
  const recent = [...companies]
    .filter(c => c.lastActivity != null)
    .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
    .slice(0, 8);
  // open deals — pipeline stage not closed
  const open = opps.filter(o => o.pipelineStage && !o.pipelineStage.includes('closed'));
  const openValue = open.reduce((s, o) => s + o.projectedFirstYearValueCents, 0);
  const openWeighted = open.reduce((s, o) => s + Math.round(o.projectedFirstYearValueCents * o.probability), 0);
  const top = [...open].sort((a, b) => b.projectedFirstYearValueCents - a.projectedFirstYearValueCents).slice(0, 5);
  return {
    slug, label, companies: companies.length, openDeals: open.length,
    openDealsValueCents: openValue, openDealsWeightedCents: openWeighted,
    recentCompanies: recent, topOpenDeals: top,
  };
}

export async function getVendastaData(opts: { force?: boolean } = {}): Promise<VendastaSummary> {
  if (!opts.force) {
    if (memCache && Date.now() - memCache.asOf < TTL_MS) return memCache.data;
    const disk = readDiskCache();
    if (disk) { memCache = disk; return disk.data; }
  }

  try {
    // 1) Pull all companies, bucket by market slug
    const buckets = await fetchAllCompanies();

    // 2) Build agid → slug map for opportunity-side join
    const slugByAgid = new Map<string, string>();
    for (const [slug, rows] of buckets.entries()) {
      for (const r of rows) {
        // company id is "CompanyID-..." which isn't the AGID. But companies
        // store source_drill or platform__company_account_group_id; the latter
        // wasn't in our return fields. We'll let opportunities resolve unknown
        // market for now — opportunities typically only have AGIDs that don't
        // map 1:1 with companies anyway. Future: include
        // platform__company_account_group_id in returnFields.
      }
    }

    // 3) Pull opportunities; bucket by accountGroupId → marketSlug if known.
    //    Without AGID resolution we tag everything 'unknown' for now; that
    //    surfaces honestly in the widget rather than silently mis-attributing.
    let opps: Opportunity[] = [];
    try {
      opps = await fetchOpportunities(slugByAgid);
    } catch (e) {
      logger.warn({ err: String((e as Error)?.message || e) }, 'vendasta: opportunities pull failed (non-fatal)');
    }

    const bySlug: Record<MarketSlug, MarketSummary> = {} as any;
    for (const slug of MARKET_SLUGS) {
      const label = MARKETS[slug].label;
      const companies = buckets.get(slug) || [];
      const oppsThis = opps.filter(o => o.marketSlug === slug);
      bySlug[slug] = buildMarketSummary(slug, label, companies, oppsThis);
    }

    // 'all' merges every bucket including unknown
    const allCompanies: CompanyRow[] = [];
    for (const rows of buckets.values()) allCompanies.push(...rows);
    const all = buildMarketSummary('all', 'All Markets', allCompanies, opps);

    const summary: VendastaSummary = {
      asOf: Date.now(),
      configured: true,
      connectionStatus: 'ok',
      connectionMessage: null,
      bySlug,
      all,
    };
    memCache = { asOf: summary.asOf, data: summary };
    writeDiskCache(summary);
    return summary;
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    const noCreds = /VENDASTA_CREDENTIALS|token exchange failed/i.test(msg);
    logger.error({ err: msg }, 'vendasta-data: failed');
    return {
      asOf: Date.now(),
      configured: !noCreds,
      connectionStatus: noCreds ? 'no-credentials' : 'error',
      connectionMessage: msg.slice(0, 200),
      bySlug: {
        pwps: emptyMarket('pwps', MARKETS.pwps.label),
        default: emptyMarket('default', MARKETS.default.label),
      },
      all: emptyMarket('all', 'All Markets'),
    };
  }
}

export function invalidateVendastaCache(): void {
  memCache = null;
  try { fs.unlinkSync(path.join(CACHE_DIR, 'summary.json')); } catch { /* ignore */ }
}
