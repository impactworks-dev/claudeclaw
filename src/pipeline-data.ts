// Sales pipeline + accounts data for Mission Control.
//
// Architecture:
//   - Opportunities from Vendasta (open / closed-won / closed-lost)
//   - Local sub-stages: Lead | Contact | Qualified | Proposal
//     stored in store/pipeline-stages.json keyed by opp ID
//   - Locally-created leads (not yet in Vendasta) also in pipeline-stages.json
//     with isLocal:true and a generated "local-" id
//   - Won / Lost always come from Vendasta live API
//   - Customer column: lifecycle Customer accounts with revenue overlay
//
// Stage SOP (gospel):
//   Lead     → entry, company + contact + problem defined, source tagged
//   Contact  → first real conversation, discovery call booked / completed
//   Qualified → ICP fit + BANT confirmed (Budget / Authority / Need / Timeline)
//   Proposal → proposal sent or presentation scheduled, close date = decision date

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { readEnvFile } from './env.js';
import { PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const VENDASTA_SERVER = path.join(PROJECT_ROOT, 'connectors', 'vendasta', 'server.mjs');
const NOTES_FILE = path.join(PROJECT_ROOT, 'store', 'pipeline-notes.json');
const STATUS_FILE = path.join(PROJECT_ROOT, 'store', 'pipeline-status.json');
const STAGES_FILE = path.join(PROJECT_ROOT, 'store', 'pipeline-stages.json');
const TTL_MS = 3 * 60 * 1000;
const REVENUE_TTL_MS = 30 * 60 * 1000;

export const SUB_STAGES = ['Lead', 'Contact', 'Qualified', 'Proposal'] as const;
export type SubStage = typeof SUB_STAGES[number];
export const BRANDS = ['Rocket Local', 'ImpactWorks'] as const;
export type Brand = typeof BRANDS[number];
export const SOURCES = ['BID', 'Inbound', 'Referral', 'Cold outreach', 'Event', 'Partner'] as const;
export type Source = typeof SOURCES[number];

// Per-customer outreach status (account-management touches). Local store, like notes.
// Extended for BID Traffic Partnership campaign: 8-stage funnel ending at Endorsed.
export const OUTREACH_STATUSES = [
  'Not contacted',
  'Emailed',
  'Opened',
  'Replied',
  'Webinar Booked',
  'Webinar Held',
  'Endorsed',
  'Declined',
] as const;
const DEFAULT_STATUS = 'Not contacted';

function env() { return readEnvFile(['VENDASTA_CREDENTIALS', 'VENDASTA_NAMESPACE']); }

async function vendastaCall(tool: string, args: Record<string, unknown>): Promise<any> {
  const e = env();
  const creds = e.VENDASTA_CREDENTIALS || path.join(PROJECT_ROOT, 'secrets', 'vendasta-nikki-service-account.json');
  const ns = e.VENDASTA_NAMESPACE || '0BYD';
  const { stdout } = await execFileAsync('node', [VENDASTA_SERVER, '--call', tool, JSON.stringify(args)], {
    env: { ...process.env, VENDASTA_CREDENTIALS: creds, VENDASTA_NAMESPACE: ns },
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function obj(o: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of (o.fields || [])) out[f.id] = f.value;
  return out;
}

// ---- ClickUp mirror (outreach status -> ImpactWorks ▸ CRM ▸ Accounts task tags) ----
const CLICKUP_SERVER = path.join(PROJECT_ROOT, 'connectors', 'clickup', 'server.mjs');
const CLICKUP_ACCOUNTS_LIST_ID = '901326621325';
const TAG_PREFIX = 'outreach:';
const CU_MAP_TTL_MS = 10 * 60 * 1000;

function clickupEnv() { return readEnvFile(['CLICKUP_API_TOKEN', 'CLICKUP_TEAM_ID']); }
async function clickupCall(tool: string, args: Record<string, unknown>): Promise<any> {
  const e = clickupEnv();
  const { stdout } = await execFileAsync('node', [CLICKUP_SERVER, '--call', tool, JSON.stringify(args)], {
    env: {
      ...process.env,
      CLICKUP_API_TOKEN: e.CLICKUP_API_TOKEN || process.env.CLICKUP_API_TOKEN || '',
      CLICKUP_TEAM_ID: e.CLICKUP_TEAM_ID || process.env.CLICKUP_TEAM_ID || '10584109',
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function statusSlug(status: string): string | null {
  if (!status || status === DEFAULT_STATUS) return null;
  return TAG_PREFIX + status.toLowerCase().replace(/\s+/g, '-');
}
function normName(s: string | null | undefined): string {
  return (s || '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(llc|inc|co|corp|ltd|the|company|group)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

let cuMap: { at: number; byName: Record<string, string> } | null = null;
async function clickupAccountsMap(): Promise<Record<string, string>> {
  if (cuMap && Date.now() - cuMap.at < CU_MAP_TTL_MS) return cuMap.byName;
  const byName: Record<string, string> = {};
  try {
    for (let page = 0; page < 10; page++) {
      const res = await clickupCall('clickup_get_tasks', { list_id: CLICKUP_ACCOUNTS_LIST_ID, include_closed: true, page });
      const tasks: any[] = res.tasks || [];
      for (const t of tasks) { const n = normName(t.name); if (n && !byName[n]) byName[n] = t.id; }
      if (tasks.length < 100 || res.last_page) break;
    }
    cuMap = { at: Date.now(), byName };
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'pipeline: clickup accounts map failed');
    return cuMap?.byName || {};
  }
  return byName;
}

async function mirrorToClickup(companyName: string | null, status: string): Promise<'updated' | 'no-match' | 'error'> {
  if (!companyName) return 'no-match';
  try {
    const map = await clickupAccountsMap();
    const taskId = map[normName(companyName)];
    if (!taskId) return 'no-match';
    const task = await clickupCall('clickup_get_task', { task_id: taskId });
    const stale: string[] = (task.tags || []).map((t: any) => t.name).filter((n: string) => typeof n === 'string' && n.startsWith(TAG_PREFIX));
    for (const tag of stale) { try { await clickupCall('clickup_remove_tag', { task_id: taskId, tag_name: tag }); } catch { /* ignore */ } }
    const slug = statusSlug(status);
    if (slug) await clickupCall('clickup_add_tag', { task_id: taskId, tag_name: slug });
    return 'updated';
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'pipeline: clickup status mirror failed');
    return 'error';
  }
}

async function mirrorStatus(companyId: string, nameHint: string | null, status: string): Promise<string[]> {
  const applied: string[] = [];
  let name = nameHint;
  try {
    const r = await vendastaCall('vendasta_list_records', {
      resourceTypeCode: 'companies',
      filters: [{ id: 'system__company_id', value: companyId, operation: 'IS' }],
      returnFields: ['standard__company_name', 'standard__company_tags'],
      limit: 1,
    });
    const cur = (r.objects && r.objects[0]) ? obj(r.objects[0]) : {};
    if (!name) name = cur.standard__company_name ?? null;
    const raw = cur.standard__company_tags;
    const existing: string[] = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const kept = existing.filter((t) => typeof t === 'string' && !t.startsWith(TAG_PREFIX));
    const slug = statusSlug(status);
    const next = slug ? [...kept, slug] : kept;
    await vendastaCall('vendasta_upsert_record', {
      resourceTypeCode: 'companies',
      searchExisting: ['system__company_id'],
      fields: [
        { id: 'system__company_id', value: companyId },
        { id: 'standard__company_tags', value: next },
      ],
    });
    applied.push('vendasta');
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'pipeline: vendasta status mirror failed');
  }
  const cu = await mirrorToClickup(name, status);
  if (cu === 'updated') applied.push('clickup');
  else if (cu === 'no-match') applied.push('clickup:no-match');
  return applied;
}

function loadNotes(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8')); } catch { return {}; }
}
function saveNote(id: string, note: string): void {
  const n = loadNotes();
  if (note && note.trim()) n[id] = note; else delete n[id];
  try { fs.mkdirSync(path.dirname(NOTES_FILE), { recursive: true }); } catch { /* ignore */ }
  fs.writeFileSync(NOTES_FILE, JSON.stringify(n, null, 2));
}

function loadStatuses(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); } catch { return {}; }
}
function saveStatus(id: string, status: string): void {
  const s = loadStatuses();
  if (status && status.trim() && status !== DEFAULT_STATUS) s[id] = status; else delete s[id];
  try { fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true }); } catch { /* ignore */ }
  fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2));
}

// ---- Sub-stage + brand local store (keyed by opp id or "local-uuid") ----
interface StageRecord {
  subStage: SubStage;
  brand: Brand;
  source?: string | null;
  // Local-only lead fields (not synced to Vendasta yet)
  isLocal?: true;
  name?: string;
  accountName?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  value?: number;          // cents
  notes?: string | null;
  addedAt?: number;
}

function loadStages(): Record<string, StageRecord> {
  try { return JSON.parse(fs.readFileSync(STAGES_FILE, 'utf-8')); } catch { return {}; }
}
function saveStageRecord(id: string, record: StageRecord | null): void {
  const s = loadStages();
  if (record) s[id] = record; else delete s[id];
  try { fs.mkdirSync(path.dirname(STAGES_FILE), { recursive: true }); } catch { /* ignore */ }
  fs.writeFileSync(STAGES_FILE, JSON.stringify(s, null, 2));
}

// ---- Revenue (background-refreshed) ----
interface RevenueRow { retailMRR: number; wholesaleMonthly: number; wholesaleLifetime: number; }
interface RevenueData { byAccount: Record<string, RevenueRow>; totals: { retailMRR: number; wholesaleMonthly: number; accounts: number }; }
let revenueState: { at: number; data: RevenueData | null; refreshing: boolean } = { at: 0, data: null, refreshing: false };
async function refreshRevenue() {
  if (revenueState.refreshing) return;
  revenueState.refreshing = true;
  try {
    const r = await vendastaCall('vendasta_revenue_by_account', {});
    revenueState = { at: Date.now(), data: r, refreshing: false };
  } catch (e) {
    revenueState.refreshing = false;
    logger.warn({ err: String((e as Error)?.message || e) }, 'pipeline: revenue refresh failed');
  }
}
function getRevenue(): RevenueData | null {
  const fresh = revenueState.data && Date.now() - revenueState.at < REVENUE_TTL_MS;
  if (!fresh && !revenueState.refreshing) { void refreshRevenue(); }
  return revenueState.data;
}

export interface DealCard {
  id: string;
  name: string;
  accountName: string | null;
  accountGroupId: string | null;
  value: number;            // projected first-year value, cents
  weighted: number;         // probable first-year value, cents
  probability: number | null;
  expectedCloseDate: string | null;
  stage: string;            // raw Vendasta pipelineStage: open | closed-won | closed-lost
  subStage: SubStage;       // local sub-stage: Lead | Contact | Qualified | Proposal
  brand: Brand;             // Rocket Local | ImpactWorks
  source: string | null;    // BID | Inbound | Referral | etc.
  isLocal: boolean;         // true = local lead not yet in Vendasta
  contactName?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
}

export interface AccountCard {
  id: string;
  accountGroupId: string | null;
  name: string;
  website: string | null;
  reviewScore: number | null;
  reviewCount: number | null;
  websiteGrade: string | null;
  listingsAccuracy: number | null;
  notes: string | null;
  outreachStatus: string;
  retailMRR: number | null;
  wholesaleMonthly: number | null;
  wholesaleLifetime: number | null;
  margin: number | null;
}

interface StageTotal { count: number; value: number; weighted: number; }

export interface PipelineData {
  generatedAt: number;
  deals: {
    lead: DealCard[];
    contact: DealCard[];
    qualified: DealCard[];
    proposal: DealCard[];
    won: DealCard[];
    lost: DealCard[];
  };
  dealTotals: {
    lead: StageTotal;
    contact: StageTotal;
    qualified: StageTotal;
    proposal: StageTotal;
    won: StageTotal;
    lost: StageTotal;
    openTotal: StageTotal;  // sum of all open sub-stages
  };
  customers: AccountCard[];
  revenue: { ready: boolean; currency: string; totalRetailMRR: number | null; totalWholesaleMonthly: number | null; asOf: number | null };
  outreachStatuses: string[];
  subStages: readonly string[];
  brands: readonly string[];
  sources: readonly string[];
}

let cache: { at: number; data: PipelineData } | null = null;

async function byStage(stage: string, limit = 100): Promise<any[]> {
  const res = await vendastaCall('vendasta_list_records', {
    resourceTypeCode: 'companies',
    filters: [{ id: 'standard__company_lifecycle_stage', value: stage, operation: 'IS' }],
    limit,
  });
  return (res.objects || []).map(obj);
}

async function build(): Promise<PipelineData> {
  // Opportunities (deals) — live from Vendasta
  const oppRes = await vendastaCall('vendasta_list_opportunities', {});
  const opps: any[] = oppRes.results || [];
  const dealAgs = [...new Set(opps.map((o: any) => o.accountGroupId).filter(Boolean))];

  // Resolve deal account names
  const agName: Record<string, string> = {};
  if (dealAgs.length) {
    try {
      const r = await vendastaCall('vendasta_list_records', {
        resourceTypeCode: 'companies',
        filters: [{ id: 'platform__company_account_group_id', value: dealAgs, operation: 'IS_ANY' }],
        returnFields: ['standard__company_name', 'platform__company_account_group_id'],
        limit: 200,
      });
      for (const o of (r.objects || [])) {
        const f = obj(o);
        if (f.platform__company_account_group_id) agName[f.platform__company_account_group_id] = f.standard__company_name;
      }
    } catch (e) {
      logger.warn({ err: String((e as Error)?.message || e) }, 'pipeline: deal account name lookup failed');
    }
  }

  // Load local stage/brand/source overrides
  const stages = loadStages();

  const toDeal = (o: any): DealCard => {
    const sr = stages[o.opportunityId] as StageRecord | undefined;
    return {
      id: o.opportunityId,
      name: o.name || '(unnamed deal)',
      accountName: (o.accountGroupId && agName[o.accountGroupId]) || null,
      accountGroupId: o.accountGroupId || null,
      value: Number(o.projectedFirstYearValue || 0),
      weighted: Number(o.probableFirstYearValue || 0),
      probability: o.probability != null ? o.probability : null,
      expectedCloseDate: o.expectedCloseDate || null,
      stage: o.pipelineStage || 'open',
      subStage: sr?.subStage ?? 'Lead',
      brand: sr?.brand ?? 'Rocket Local',
      source: sr?.source ?? null,
      isLocal: false,
    };
  };

  const lead: DealCard[] = [], contact: DealCard[] = [], qualified: DealCard[] = [], proposal: DealCard[] = [];
  const won: DealCard[] = [], lost: DealCard[] = [];

  for (const o of opps) {
    const st = (o.pipelineStage || '').toLowerCase();
    // Skip legacy closed opps — hidden pending manual cleanup in Vendasta Partner Center.
    // Won/Lost columns will populate naturally as real deals close going forward.
    if (st === 'closed-won' || st === 'closed-lost') continue;
    const card = toDeal(o);
    // Open opp — route to sub-stage column
    const sub = card.subStage;
    if (sub === 'Contact') contact.push(card);
    else if (sub === 'Qualified') qualified.push(card);
    else if (sub === 'Proposal') proposal.push(card);
    else lead.push(card);
  }

  // Local leads (not yet in Vendasta)
  for (const [id, sr] of Object.entries(stages)) {
    if (!sr.isLocal) continue;
    const card: DealCard = {
      id,
      name: sr.name || '(unnamed lead)',
      accountName: sr.accountName || null,
      accountGroupId: null,
      value: sr.value ?? 0,
      weighted: sr.value ?? 0,
      probability: null,
      expectedCloseDate: null,
      stage: 'open',
      subStage: sr.subStage,
      brand: sr.brand,
      source: sr.source ?? null,
      isLocal: true,
      contactName: sr.contactName ?? null,
      contactEmail: sr.contactEmail ?? null,
      notes: sr.notes ?? null,
    };
    if (sr.subStage === 'Contact') contact.push(card);
    else if (sr.subStage === 'Qualified') qualified.push(card);
    else if (sr.subStage === 'Proposal') proposal.push(card);
    else lead.push(card);
  }

  const sortByVal = (a: DealCard, b: DealCard) => b.value - a.value;
  lead.sort(sortByVal); contact.sort(sortByVal);
  qualified.sort(sortByVal); proposal.sort(sortByVal);
  won.sort(sortByVal); lost.sort(sortByVal);

  const sum = (arr: DealCard[]): StageTotal => ({
    count: arr.length,
    value: arr.reduce((s, c) => s + c.value, 0),
    weighted: arr.reduce((s, c) => s + c.weighted, 0),
  });

  const allOpen = [...lead, ...contact, ...qualified, ...proposal];
  const openTotal = sum(allOpen);

  // Customers (lifecycle Customer accounts)
  const customerRecs = await byStage('Customer');
  const notes = loadNotes();
  const statuses = loadStatuses();
  const customers: AccountCard[] = customerRecs.map((r: any) => ({
    id: r.system__company_id,
    accountGroupId: r.platform__company_account_group_id ?? null,
    name: r.standard__company_name,
    website: r.standard__company_website ?? null,
    reviewScore: r.standard__company_average_review_score ?? null,
    reviewCount: r.standard__company_number_of_reviews ?? null,
    websiteGrade: r.standard__company_website_grade ?? null,
    listingsAccuracy: r.standard__company_listings_percentage_of_accurate_listings ?? null,
    notes: notes[r.system__company_id] ?? null,
    outreachStatus: statuses[r.system__company_id] ?? DEFAULT_STATUS,
    retailMRR: null, wholesaleMonthly: null, wholesaleLifetime: null, margin: null,
  }));

  return {
    generatedAt: Date.now(),
    deals: { lead, contact, qualified, proposal, won, lost },
    dealTotals: { lead: sum(lead), contact: sum(contact), qualified: sum(qualified), proposal: sum(proposal), won: sum(won), lost: sum(lost), openTotal },
    customers,
    revenue: { ready: false, currency: 'USD', totalRetailMRR: null, totalWholesaleMonthly: null, asOf: null },
    outreachStatuses: [...OUTREACH_STATUSES],
    subStages: SUB_STAGES,
    brands: BRANDS,
    sources: SOURCES,
  };
}

function overlayRevenue(data: PipelineData): void {
  const rev = getRevenue();
  const map = rev?.byAccount || {};
  for (const c of data.customers) {
    const r = c.accountGroupId ? map[c.accountGroupId] : undefined;
    c.retailMRR = r ? r.retailMRR : null;
    c.wholesaleMonthly = r ? r.wholesaleMonthly : null;
    c.wholesaleLifetime = r ? r.wholesaleLifetime : null;
    c.margin = r ? r.retailMRR - r.wholesaleMonthly : null;
  }
  data.revenue = {
    ready: !!rev, currency: 'USD',
    totalRetailMRR: rev?.totals?.retailMRR ?? null,
    totalWholesaleMonthly: rev?.totals?.wholesaleMonthly ?? null,
    asOf: revenueState.at || null,
  };
}

export async function getPipelineData(force = false): Promise<PipelineData> {
  if (force || !cache || Date.now() - cache.at >= TTL_MS) {
    const data = await build();
    cache = { at: Date.now(), data };
  }
  overlayRevenue(cache.data);
  return cache.data;
}

// ---- Writes: Customer accounts (notes, contact, stage, outreach status) ----
export interface CardUpdate {
  companyId: string;
  companyName?: string;
  stage?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  outreachStatus?: string;
}

export async function updateCard(u: CardUpdate): Promise<{ ok: true; applied: string[] }> {
  const applied: string[] = [];
  if (!u.companyId) throw new Error('companyId required');

  if (u.stage) {
    await vendastaCall('vendasta_upsert_record', {
      resourceTypeCode: 'companies',
      searchExisting: ['system__company_id'],
      fields: [
        { id: 'system__company_id', value: u.companyId },
        { id: 'standard__company_lifecycle_stage', value: u.stage },
      ],
    });
    applied.push('stage');
  }
  if (u.contactName !== undefined || u.contactEmail !== undefined) {
    const fields: any[] = [{ id: 'standard__contact_primary_company_id', value: u.companyId }];
    if (u.contactName !== undefined) {
      const parts = String(u.contactName).trim().split(/\s+/);
      fields.push({ id: 'standard__first_name', value: parts.shift() || '' });
      fields.push({ id: 'standard__last_name', value: parts.join(' ') });
    }
    if (u.contactEmail !== undefined) fields.push({ id: 'standard__email', value: u.contactEmail });
    await vendastaCall('vendasta_upsert_record', { resourceTypeCode: 'contacts', searchExisting: ['standard__contact_primary_company_id'], fields });
    applied.push('contact');
  }
  if (u.notes !== undefined) { saveNote(u.companyId, u.notes); applied.push('notes'); }
  if (u.outreachStatus !== undefined) {
    saveStatus(u.companyId, u.outreachStatus);
    applied.push('status');
    const mirrored = await mirrorStatus(u.companyId, u.companyName ?? null, u.outreachStatus);
    applied.push(...mirrored);
  }

  cache = null;
  return { ok: true, applied };
}

// ---- Writes: Deal sub-stage (local store only) ----
export interface DealStageUpdate {
  id: string;
  subStage: SubStage;
  brand?: Brand;
  source?: string | null;
}

export function updateDealSubStage(u: DealStageUpdate): { ok: true } {
  if (!u.id) throw new Error('id required');
  if (!SUB_STAGES.includes(u.subStage)) throw new Error(`invalid subStage: ${u.subStage}`);
  const stages = loadStages();
  const existing = stages[u.id] || {};
  stages[u.id] = {
    ...existing,
    subStage: u.subStage,
    ...(u.brand ? { brand: u.brand } : {}),
    ...(u.source !== undefined ? { source: u.source } : {}),
  };
  try { fs.mkdirSync(path.dirname(STAGES_FILE), { recursive: true }); } catch { /* ignore */ }
  fs.writeFileSync(STAGES_FILE, JSON.stringify(stages, null, 2));
  cache = null;
  return { ok: true };
}

// ---- Writes: Create a local lead ----
export interface NewLead {
  name: string;          // deal/opp name (e.g. "ABC Roofing – Local SEO")
  accountName?: string;  // company name
  brand: Brand;
  subStage?: SubStage;   // default: Lead
  source?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  value?: number;        // estimated value in dollars (will be converted to cents)
  notes?: string | null;
}

export function createLocalLead(lead: NewLead): { ok: true; id: string } {
  if (!lead.name?.trim()) throw new Error('name required');
  if (!BRANDS.includes(lead.brand)) throw new Error(`invalid brand: ${lead.brand}`);
  const id = 'local-' + crypto.randomBytes(6).toString('hex');
  const record: StageRecord = {
    isLocal: true,
    subStage: lead.subStage ?? 'Lead',
    brand: lead.brand,
    source: lead.source ?? null,
    name: lead.name.trim(),
    accountName: lead.accountName?.trim() || lead.name.trim(),
    contactName: lead.contactName ?? null,
    contactEmail: lead.contactEmail ?? null,
    phone: lead.phone ?? null,
    value: lead.value != null ? Math.round(lead.value * 100) : 0,
    notes: lead.notes ?? null,
    addedAt: Date.now(),
  };
  saveStageRecord(id, record);
  cache = null;
  return { ok: true, id };
}

// ---- Writes: Update local lead ----
export interface LocalLeadUpdate {
  id: string;
  name?: string;
  accountName?: string;
  brand?: Brand;
  subStage?: SubStage;
  source?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  value?: number;
  notes?: string | null;
}

export function updateLocalLead(u: LocalLeadUpdate): { ok: true } {
  if (!u.id) throw new Error('id required');
  const stages = loadStages();
  const existing = stages[u.id];
  if (!existing || !existing.isLocal) throw new Error('local lead not found: ' + u.id);
  const updated: StageRecord = {
    ...existing,
    ...(u.name !== undefined ? { name: u.name } : {}),
    ...(u.accountName !== undefined ? { accountName: u.accountName } : {}),
    ...(u.brand !== undefined ? { brand: u.brand } : {}),
    ...(u.subStage !== undefined ? { subStage: u.subStage } : {}),
    ...(u.source !== undefined ? { source: u.source } : {}),
    ...(u.contactName !== undefined ? { contactName: u.contactName } : {}),
    ...(u.contactEmail !== undefined ? { contactEmail: u.contactEmail } : {}),
    ...(u.phone !== undefined ? { phone: u.phone } : {}),
    ...(u.value !== undefined ? { value: Math.round(u.value * 100) } : {}),
    ...(u.notes !== undefined ? { notes: u.notes } : {}),
  };
  saveStageRecord(u.id, updated);
  cache = null;
  return { ok: true };
}

// ---- Writes: Remove a local lead ----
export function deleteLocalLead(id: string): { ok: true } {
  const stages = loadStages();
  if (!stages[id]?.isLocal) throw new Error('local lead not found: ' + id);
  delete stages[id];
  fs.writeFileSync(STAGES_FILE, JSON.stringify(stages, null, 2));
  cache = null;
  return { ok: true };
}
