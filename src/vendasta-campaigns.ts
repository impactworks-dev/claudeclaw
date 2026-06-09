// Vendasta marketing campaigns data layer.
//
// Calls the vendasta_platform_list_campaigns connector tool, normalizes
// the campaign list, computes aggregates (active campaigns count, total
// recipients in last N days, avg open rate, top performer), and caches
// the result for 10 minutes. Surfaced by /api/vendasta/campaigns and
// the Mission Control CampaignsCard.
//
// NOTE: The Vendasta Platform API resource path for campaigns is a guess
// from naming conventions (`marketingCampaigns`). If the connector returns
// 404 or "unknown resource", probe the response shape and adjust the
// resource string in connectors/vendasta/server.mjs.

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { STORE_DIR, PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';

const CACHE_FILE = path.join(STORE_DIR, 'vendasta-campaigns-cache.json');
const TTL_MS = 10 * 60 * 1000;
const VENDASTA_SERVER = path.join(PROJECT_ROOT, 'connectors', 'vendasta', 'server.mjs');

export interface CampaignRow {
  id: string;
  name: string;
  status: string;             // 'Published' | 'Ongoing' | 'Draft' | etc.
  tag: string | null;
  totalRecipients: number;
  activeRecipients: number;
  emailsDelivered: number;
  openRate: number | null;    // 0-100
  ctor: number | null;        // 0-100
  lastUpdated: string | null;
}

export interface CampaignsSummary {
  asOf: number;
  configured: boolean;
  totalCampaigns: number;
  publishedCount: number;
  ongoingCount: number;
  draftCount: number;
  totalRecipients: number;
  totalActiveRecipients: number;
  totalEmailsDelivered: number;
  avgOpenRate: number | null;       // weighted by delivered
  topCampaigns: CampaignRow[];      // top 5 by activity
  allCampaigns: CampaignRow[];      // full list
  error?: string;
}

function callConnector(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [VENDASTA_SERVER, '--call', tool, JSON.stringify(args)], { env: process.env });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`vendasta ${tool} exit ${code}: ${err.slice(0, 400)}`));
      const jsonStart = out.indexOf('{');
      if (jsonStart < 0) return reject(new Error(`${tool} returned no JSON`));
      try { resolve(JSON.parse(out.slice(jsonStart))); } catch (e) { reject(e); }
    });
  });
}

/** JSON:API responses wrap items in { data: [{ id, attributes: {...} }, ...] }.
 *  We normalize that into a flat CampaignRow[]. Field names are best-guess
 *  matches against the UI we saw — adjust once we see real API output. */
function shapeCampaign(item: any): CampaignRow {
  const a = item?.attributes || item || {};
  const pct = (v: any): number | null => {
    if (v == null) return null;
    const n = typeof v === 'string' ? parseFloat(v.replace('%', '')) : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: String(item?.id ?? a.id ?? ''),
    name: String(a.name ?? a.title ?? '(unnamed)'),
    status: String(a.status ?? a.state ?? 'unknown'),
    tag: (Array.isArray(a.tags) ? a.tags[0] : a.tag) || null,
    totalRecipients: Number(a.totalRecipients ?? a.recipientCount ?? 0),
    activeRecipients: Number(a.activeRecipients ?? 0),
    emailsDelivered: Number(a.emailsDelivered ?? a.delivered ?? 0),
    openRate: pct(a.openRate),
    ctor: pct(a.ctor ?? a.clickToOpenRate),
    lastUpdated: a.lastUpdated ?? a.updatedAt ?? null,
  };
}

function aggregate(campaigns: CampaignRow[]): Omit<CampaignsSummary, 'asOf' | 'configured' | 'allCampaigns' | 'topCampaigns'> {
  let totalRecipients = 0, totalActiveRecipients = 0, totalEmailsDelivered = 0;
  let publishedCount = 0, ongoingCount = 0, draftCount = 0;
  let weightedOpenNum = 0, weightedOpenDen = 0;
  for (const c of campaigns) {
    totalRecipients += c.totalRecipients;
    totalActiveRecipients += c.activeRecipients;
    totalEmailsDelivered += c.emailsDelivered;
    const s = c.status.toLowerCase();
    if (s.includes('publish')) publishedCount++;
    else if (s.includes('ongoing')) ongoingCount++;
    else if (s.includes('draft')) draftCount++;
    if (c.openRate != null && c.emailsDelivered > 0) {
      weightedOpenNum += c.openRate * c.emailsDelivered;
      weightedOpenDen += c.emailsDelivered;
    }
  }
  return {
    totalCampaigns: campaigns.length,
    publishedCount, ongoingCount, draftCount,
    totalRecipients, totalActiveRecipients, totalEmailsDelivered,
    avgOpenRate: weightedOpenDen > 0 ? +(weightedOpenNum / weightedOpenDen).toFixed(2) : null,
  };
}

function readCache(): CampaignsSummary | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CampaignsSummary;
    if (Date.now() - j.asOf < TTL_MS) return j;
  } catch { /* empty */ }
  return null;
}

function writeCache(s: CampaignsSummary): void {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(s), 'utf-8'); }
  catch (err) { logger.warn({ err }, 'vendasta-campaigns: cache write failed'); }
}

export async function getCampaignsSummary(opts: { force?: boolean } = {}): Promise<CampaignsSummary> {
  if (!opts.force) {
    const cached = readCache();
    if (cached) return cached;
  }
  try {
    const raw = await callConnector('vendasta_platform_list_campaigns', { limit: 200 }) as any;
    // Connector now returns { error: 'unsupported_by_vendasta_public_api' } because
    // Marketing Campaigns are not part of Vendasta's public Partner Platform REST API.
    if (raw?.error === 'unsupported_by_vendasta_public_api') {
      return {
        asOf: Date.now(),
        configured: false,
        totalCampaigns: 0, publishedCount: 0, ongoingCount: 0, draftCount: 0,
        totalRecipients: 0, totalActiveRecipients: 0, totalEmailsDelivered: 0,
        avgOpenRate: null,
        topCampaigns: [], allCampaigns: [],
        error: 'Vendasta Marketing Campaigns are not exposed via the public Partner Platform REST API. View at partners.vendasta.com/marketing/campaigns/all.',
      };
    }
    // JSON:API: items in `data`; raw connector may also wrap as { data: [...] } or { items: [...] }
    const items: any[] = raw?.data || raw?.items || raw?.campaigns || [];
    const campaigns = items.map(shapeCampaign);
    // Sort by emailsDelivered desc for "top performers"
    const top = [...campaigns]
      .filter(c => c.emailsDelivered > 0 || c.activeRecipients > 0)
      .sort((a, b) => b.emailsDelivered - a.emailsDelivered)
      .slice(0, 5);
    const agg = aggregate(campaigns);
    const summary: CampaignsSummary = {
      asOf: Date.now(),
      configured: true,
      ...agg,
      topCampaigns: top,
      allCampaigns: campaigns,
    };
    writeCache(summary);
    return summary;
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    logger.warn({ err: msg }, 'vendasta-campaigns: fetch failed');
    return {
      asOf: Date.now(),
      configured: false,
      totalCampaigns: 0, publishedCount: 0, ongoingCount: 0, draftCount: 0,
      totalRecipients: 0, totalActiveRecipients: 0, totalEmailsDelivered: 0,
      avgOpenRate: null,
      topCampaigns: [], allCampaigns: [],
      error: msg.slice(0, 300),
    };
  }
}
