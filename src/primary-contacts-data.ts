import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_ROOT, STORE_DIR } from './config.js';
import { readEnvFile } from './env.js';

const execFileAsync = promisify(execFile);
const CLICKUP_SERVER = path.join(PROJECT_ROOT, 'connectors', 'clickup', 'server.mjs');
const VENDASTA_SERVER = path.join(PROJECT_ROOT, 'connectors', 'vendasta', 'server.mjs');
const ACCOUNTS_LIST_ID = '901326621325';
const DRAFT_FILE = path.join(STORE_DIR, 'primary-contact-review.json');
const CACHE_MS = 10 * 60 * 1000;

export interface ContactCandidate {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
}

export interface ContactReviewAccount {
  clickupTaskId: string;
  companyId: string | null;
  companyName: string;
  displayName: string;
  currentName: string | null;
  currentEmail: string | null;
  candidates: ContactCandidate[];
}

export interface ContactReviewDraft {
  selections: Record<string, string>;
  updatedAt: number;
}

function fieldMap(row: any): Record<string, any> {
  return Object.fromEntries((row?.fields || []).map((f: any) => [f.id, f.value]));
}

function customField(task: any, name: string): any {
  return (task.custom_fields || []).find((f: any) => f.name === name)?.value ?? null;
}

function norm(value: string | null | undefined): string {
  return (value || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(llc|inc|corp|corporation|company|co|ltd|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function connector(server: string, tool: string, args: Record<string, unknown>, env: Record<string, string>): Promise<any> {
  const { stdout } = await execFileAsync('node', [server, '--call', tool, JSON.stringify(args)], {
    env: { ...process.env, ...env },
    maxBuffer: 48 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function clickupEnv(): Record<string, string> {
  const e = readEnvFile(['CLICKUP_API_TOKEN', 'CLICKUP_TEAM_ID']);
  return {
    CLICKUP_API_TOKEN: e.CLICKUP_API_TOKEN || process.env.CLICKUP_API_TOKEN || '',
    CLICKUP_TEAM_ID: e.CLICKUP_TEAM_ID || process.env.CLICKUP_TEAM_ID || '10584109',
  };
}

function vendastaEnv(): Record<string, string> {
  const e = readEnvFile(['VENDASTA_CREDENTIALS', 'VENDASTA_NAMESPACE']);
  return {
    VENDASTA_CREDENTIALS: e.VENDASTA_CREDENTIALS || path.join(PROJECT_ROOT, 'secrets', 'vendasta-nikki-service-account.json'),
    VENDASTA_NAMESPACE: e.VENDASTA_NAMESPACE || '0BYD',
  };
}

async function allVendastaRecords(resourceTypeCode: 'companies' | 'contacts', args: Record<string, unknown>): Promise<any[]> {
  const rows: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await connector(VENDASTA_SERVER, 'vendasta_list_records', {
      resourceTypeCode,
      ...args,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }, vendastaEnv());
    rows.push(...(page.objects || []));
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return rows;
}

function loadDraft(): ContactReviewDraft {
  try {
    const parsed = JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf8'));
    return { selections: parsed.selections || {}, updatedAt: Number(parsed.updatedAt || 0) };
  } catch {
    return { selections: {}, updatedAt: 0 };
  }
}

export function savePrimaryContactSelection(clickupTaskId: string, contactId: string): ContactReviewDraft {
  if (!clickupTaskId || !contactId) throw new Error('clickupTaskId and contactId are required');
  const draft = loadDraft();
  draft.selections[clickupTaskId] = contactId;
  draft.updatedAt = Date.now();
  fs.mkdirSync(path.dirname(DRAFT_FILE), { recursive: true });
  fs.writeFileSync(DRAFT_FILE, JSON.stringify(draft, null, 2));
  return draft;
}

let cache: { at: number; accounts: ContactReviewAccount[] } | null = null;

export async function getPrimaryContactReview(force = false): Promise<{
  generatedAt: number;
  accounts: ContactReviewAccount[];
  draft: ContactReviewDraft;
}> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return { generatedAt: cache.at, accounts: cache.accounts, draft: loadDraft() };
  }

  const [clickup, companies, contacts] = await Promise.all([
    connector(CLICKUP_SERVER, 'clickup_get_tasks', {
      list_id: ACCOUNTS_LIST_ID, include_closed: true, page: 0,
    }, clickupEnv()),
    allVendastaRecords('companies', {
      filters: [{ id: 'standard__company_lifecycle_stage', value: 'Customer', operation: 'IS' }],
      returnFields: ['system__company_id', 'standard__company_name', 'standard__company_email'],
    }),
    allVendastaRecords('contacts', {
      returnFields: [
        'system__contact_id', 'platform__user_id', 'standard__first_name', 'standard__last_name',
        'standard__email', 'standard__phone_number', 'standard__contact_primary_company_id',
        'standard__contact_source_name',
      ],
    }),
  ]);

  const companyById = new Map<string, any>();
  const companyByName = new Map<string, any>();
  for (const row of companies) {
    const f = fieldMap(row);
    const id = String(f.system__company_id || '');
    if (id) companyById.set(id, f);
    const key = norm(f.standard__company_name);
    if (key && !companyByName.has(key)) companyByName.set(key, f);
  }

  const contactsByCompany = new Map<string, ContactCandidate[]>();
  for (const row of contacts) {
    const f = fieldMap(row);
    const companyId = String(f.standard__contact_primary_company_id || '');
    const id = String(f.system__contact_id || '');
    const name = `${f.standard__first_name || ''} ${f.standard__last_name || ''}`.trim();
    if (!companyId || !id || (!name && !f.standard__email)) continue;
    const candidate: ContactCandidate = {
      id,
      userId: f.platform__user_id || null,
      name: name || String(f.standard__email),
      email: f.standard__email || null,
      phone: f.standard__phone_number || null,
      source: f.standard__contact_source_name || null,
    };
    const bucket = contactsByCompany.get(companyId) || [];
    const duplicate = bucket.some(c =>
      c.id === id
      || (candidate.userId && c.userId === candidate.userId)
      || (candidate.email && c.email?.toLowerCase() === candidate.email.toLowerCase())
      || (!candidate.email && c.name.toLowerCase() === candidate.name.toLowerCase())
    );
    if (!duplicate) bucket.push(candidate);
    contactsByCompany.set(companyId, bucket);
  }

  const activeTasks = (clickup.tasks || []).filter((t: any) => String(t.status?.status || '').toLowerCase() === 'active');
  const accounts: ContactReviewAccount[] = activeTasks.map((task: any) => {
    const explicitId = String(customField(task, 'Vendasta Company ID') || '');
    const currentName = customField(task, 'Contact Name');
    const currentEmail = customField(task, 'Email');
    let company = explicitId ? companyById.get(explicitId) : null;
    if (!company) {
      const variants = [
        task.name,
        String(task.name || '').split(/[—–]/).pop(),
        String(task.name || '').split(/\s+-\s+/).pop(),
      ];
      company = variants.map(v => companyByName.get(norm(v))).find(Boolean) || null;
    }
    const companyId = company?.system__company_id || explicitId || null;
    let candidates = companyId ? [...(contactsByCompany.get(companyId) || [])] : [];
    if (currentEmail && !candidates.some(c => c.email?.toLowerCase() === String(currentEmail).toLowerCase())) {
      candidates.unshift({
        id: `clickup:${task.id}`,
        userId: null,
        name: currentName || String(task.name || '').split(/[—–]/)[0].trim() || currentEmail,
        email: currentEmail,
        phone: customField(task, 'Phone'),
        source: 'Current ClickUp record',
      });
    }
    candidates.sort((a, b) => {
      const currentA = currentEmail && a.email?.toLowerCase() === String(currentEmail).toLowerCase() ? -1 : 0;
      const currentB = currentEmail && b.email?.toLowerCase() === String(currentEmail).toLowerCase() ? -1 : 0;
      return currentA - currentB || a.name.localeCompare(b.name);
    });
    return {
      clickupTaskId: task.id,
      companyId,
      companyName: company?.standard__company_name || task.name,
      displayName: task.name,
      currentName: currentName || null,
      currentEmail: currentEmail || null,
      candidates,
    };
  }).sort((a, b) => a.companyName.localeCompare(b.companyName));

  cache = { at: Date.now(), accounts };
  return { generatedAt: cache.at, accounts, draft: loadDraft() };
}
