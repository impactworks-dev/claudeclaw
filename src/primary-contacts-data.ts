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
  fieldIds: {
    contactName: string | null;
    email: string | null;
    phone: string | null;
  };
}

export interface ContactReviewDraft {
  selections: Record<string, string>;
  manualContacts: Record<string, ManualContactDraft>;
  updatedAt: number;
}

export interface ManualContactDraft {
  name: string;
  email: string | null;
  phone: string | null;
}

export interface PrimaryContactApplyItem {
  clickupTaskId: string;
  companyName: string;
  status: 'updated' | 'unchanged' | 'skipped' | 'failed';
  contactName?: string;
  email?: string | null;
  phone?: string | null;
  reason?: string;
}

export interface PrimaryContactApplyResult {
  appliedAt: number;
  totals: Record<PrimaryContactApplyItem['status'], number>;
  items: PrimaryContactApplyItem[];
}

function fieldMap(row: any): Record<string, any> {
  return Object.fromEntries((row?.fields || []).map((f: any) => [f.id, f.value]));
}

function customField(task: any, name: string): any {
  return (task.custom_fields || []).find((f: any) => f.name === name)?.value ?? null;
}

function customFieldId(task: any, name: string): string | null {
  return (task.custom_fields || []).find((f: any) => f.name === name)?.id || null;
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
    return {
      selections: parsed.selections || {},
      manualContacts: parsed.manualContacts || {},
      updatedAt: Number(parsed.updatedAt || 0),
    };
  } catch {
    return { selections: {}, manualContacts: {}, updatedAt: 0 };
  }
}

function writeDraft(draft: ContactReviewDraft): ContactReviewDraft {
  draft.updatedAt = Date.now();
  fs.mkdirSync(path.dirname(DRAFT_FILE), { recursive: true });
  fs.writeFileSync(DRAFT_FILE, JSON.stringify(draft, null, 2));
  return draft;
}

export function savePrimaryContactSelection(
  clickupTaskId: string,
  contactId: string,
  manualContact?: ManualContactDraft,
): ContactReviewDraft {
  if (!clickupTaskId || !contactId) throw new Error('clickupTaskId and contactId are required');
  const draft = loadDraft();
  if (contactId.startsWith('manual:')) {
    const name = String(manualContact?.name || '').trim();
    const email = String(manualContact?.email || '').trim() || null;
    const phone = String(manualContact?.phone || '').trim() || null;
    if (!name) throw new Error('A name is required for a manual contact');
    draft.manualContacts[clickupTaskId] = { name, email, phone };
  } else {
    delete draft.manualContacts[clickupTaskId];
  }
  draft.selections[clickupTaskId] = contactId;
  return writeDraft(draft);
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
  const contactByEmail = new Map<string, { candidate: ContactCandidate; companyId: string }>();
  const contactById = new Map<string, ContactCandidate>();
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
    contactById.set(id, candidate);
    if (candidate.email) {
      contactByEmail.set(candidate.email.toLowerCase(), { candidate, companyId });
    }
  }

  const draft = loadDraft();
  let draftChanged = false;
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
    const selectedContactId = draft.selections[task.id];
    const selectedContact = selectedContactId && !selectedContactId.startsWith('__')
      && !selectedContactId.startsWith('manual:')
      && !selectedContactId.startsWith('clickup:')
      ? contactById.get(selectedContactId)
      : null;
    if (selectedContact && !candidates.some(c => c.id === selectedContact.id)) {
      candidates.push(selectedContact);
    }
    const currentVendastaContact = currentEmail
      ? contactByEmail.get(String(currentEmail).toLowerCase())
      : null;
    if (!company && currentVendastaContact) {
      const domain = String(currentEmail).split('@')[1]?.toLowerCase();
      candidates = (contactsByCompany.get(currentVendastaContact.companyId) || [])
        .filter(c => !domain || c.email?.split('@')[1]?.toLowerCase() === domain);
    }
    const manual = draft.manualContacts[task.id];
    const existingManualContact = manual?.email
      ? contactByEmail.get(manual.email.toLowerCase())
      : null;
    if (existingManualContact && !candidates.some(c => c.id === existingManualContact.candidate.id)) {
      candidates.push(existingManualContact.candidate);
    }
    if (draft.selections[task.id]?.startsWith('manual:') && existingManualContact) {
      draft.selections[task.id] = existingManualContact.candidate.id;
      delete draft.manualContacts[task.id];
      draftChanged = true;
    }
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
      fieldIds: {
        contactName: customFieldId(task, 'Contact Name'),
        email: customFieldId(task, 'Email'),
        phone: customFieldId(task, 'Phone'),
      },
    };
  }).sort((a: ContactReviewAccount, b: ContactReviewAccount) => a.companyName.localeCompare(b.companyName));

  cache = { at: Date.now(), accounts };
  if (draftChanged) writeDraft(draft);
  return { generatedAt: cache.at, accounts, draft };
}

function normalized(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePhoneForClickUp(value: unknown): string {
  const raw = normalized(value);
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  throw new Error(`Phone number is not valid E.164: ${raw}`);
}

export async function applyPrimaryContactSelections(
  confirmation: string,
  taskIds?: string[],
): Promise<PrimaryContactApplyResult> {
  if (confirmation !== 'APPLY_PRIMARY_CONTACTS') {
    throw new Error('Explicit confirmation is required');
  }

  const review = await getPrimaryContactReview(true);
  const items: PrimaryContactApplyItem[] = [];
  const targets = taskIds?.length ? new Set(taskIds.filter(Boolean)) : null;
  if (targets) {
    const known = new Set(review.accounts.map(account => account.clickupTaskId));
    const unknown = [...targets].filter(taskId => !known.has(taskId));
    if (unknown.length) throw new Error(`Unknown ClickUp task ID: ${unknown.join(', ')}`);
  }

  for (const account of review.accounts) {
    if (targets && !targets.has(account.clickupTaskId)) continue;
    const selection = review.draft.selections[account.clickupTaskId];
    if (!selection) {
      items.push({
        clickupTaskId: account.clickupTaskId,
        companyName: account.companyName,
        status: 'skipped',
        reason: 'Not reviewed',
      });
      continue;
    }
    if (selection === '__inactive__' || selection === '__none__' || selection === '__review_later__') {
      const reasons: Record<string, string> = {
        __inactive__: 'Customer marked inactive',
        __none__: 'Correct contact is missing',
        __review_later__: 'Marked for later review',
      };
      items.push({
        clickupTaskId: account.clickupTaskId,
        companyName: account.companyName,
        status: 'skipped',
        reason: reasons[selection],
      });
      continue;
    }

    const contact = selection.startsWith('manual:')
      ? review.draft.manualContacts[account.clickupTaskId]
      : account.candidates.find(candidate => candidate.id === selection);
    if (!contact) {
      items.push({
        clickupTaskId: account.clickupTaskId,
        companyName: account.companyName,
        status: 'failed',
        reason: 'Selected contact could not be resolved',
      });
      continue;
    }

    const desired = {
      name: normalized(contact.name),
      email: normalized(contact.email),
      phone: normalizePhoneForClickUp(contact.phone),
    };
    const current = {
      name: normalized(account.currentName),
      email: normalized(account.currentEmail),
      phone: '',
    };

    try {
      const task = await connector(CLICKUP_SERVER, 'clickup_get_task', {
        task_id: account.clickupTaskId,
      }, clickupEnv());
      current.phone = normalizePhoneForClickUp(customField(task, 'Phone'));
      const fieldIds = {
        contactName: customFieldId(task, 'Contact Name') || account.fieldIds.contactName,
        email: customFieldId(task, 'Email') || account.fieldIds.email,
        phone: customFieldId(task, 'Phone') || account.fieldIds.phone,
      };
      const changes = [
        { label: 'Contact Name', id: fieldIds.contactName, value: desired.name, current: current.name },
        { label: 'Email', id: fieldIds.email, value: desired.email, current: current.email },
        { label: 'Phone', id: fieldIds.phone, value: desired.phone, current: current.phone },
      ].filter(field => field.value !== field.current);

      const missing = changes.filter(field => !field.id).map(field => field.label);
      if (missing.length) throw new Error(`Missing ClickUp custom field: ${missing.join(', ')}`);

      for (const field of changes) {
        await connector(CLICKUP_SERVER, 'clickup_set_custom_field', {
          task_id: account.clickupTaskId,
          field_id: field.id,
          value: field.value,
        }, clickupEnv());
      }

      const verified = await connector(CLICKUP_SERVER, 'clickup_get_task', {
        task_id: account.clickupTaskId,
      }, clickupEnv());
      const actual = {
        name: normalized(customField(verified, 'Contact Name')),
        email: normalized(customField(verified, 'Email')),
        phone: normalizePhoneForClickUp(customField(verified, 'Phone')),
      };
      const mismatches = Object.keys(desired).filter(
        key => desired[key as keyof typeof desired] !== actual[key as keyof typeof actual],
      );
      if (mismatches.length) throw new Error(`Verification failed for: ${mismatches.join(', ')}`);

      items.push({
        clickupTaskId: account.clickupTaskId,
        companyName: account.companyName,
        status: changes.length ? 'updated' : 'unchanged',
        contactName: desired.name,
        email: desired.email || null,
        phone: desired.phone || null,
      });
    } catch (error) {
      items.push({
        clickupTaskId: account.clickupTaskId,
        companyName: account.companyName,
        status: 'failed',
        contactName: desired.name,
        email: desired.email || null,
        phone: desired.phone || null,
        reason: String((error as Error)?.message || error),
      });
    }
  }

  const totals: PrimaryContactApplyResult['totals'] = {
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  };
  for (const item of items) totals[item.status] += 1;
  cache = null;
  return { appliedAt: Date.now(), totals, items };
}

export async function retryPrimaryContactPhoneFormats(
  confirmation: string,
  taskIds: string[],
): Promise<PrimaryContactApplyResult> {
  if (confirmation !== 'RETRY_PRIMARY_CONTACT_PHONES') {
    throw new Error('Explicit phone-retry confirmation is required');
  }
  const targets = new Set((taskIds || []).filter(Boolean));
  if (!targets.size) throw new Error('At least one explicit task ID is required');

  const review = await getPrimaryContactReview(true);
  const accountsById = new Map(review.accounts.map(account => [account.clickupTaskId, account]));
  const items: PrimaryContactApplyItem[] = [];

  for (const taskId of targets) {
    const account = accountsById.get(taskId);
    if (!account) {
      items.push({ clickupTaskId: taskId, companyName: taskId, status: 'failed', reason: 'Account is not active' });
      continue;
    }
    const selection = review.draft.selections[taskId];
    if (!selection || selection.startsWith('__')) {
      items.push({
        clickupTaskId: taskId,
        companyName: account.companyName,
        status: 'skipped',
        reason: 'Record is not an approved contact selection',
      });
      continue;
    }
    const contact = selection.startsWith('manual:')
      ? review.draft.manualContacts[taskId]
      : account.candidates.find(candidate => candidate.id === selection);
    if (!contact) {
      items.push({
        clickupTaskId: taskId,
        companyName: account.companyName,
        status: 'failed',
        reason: 'Selected contact could not be resolved',
      });
      continue;
    }

    try {
      const desired = {
        name: normalized(contact.name),
        email: normalized(contact.email),
        phone: normalizePhoneForClickUp(contact.phone),
      };
      if (!desired.phone) throw new Error('Selected contact has no phone number to retry');
      const task = await connector(CLICKUP_SERVER, 'clickup_get_task', { task_id: taskId }, clickupEnv());
      const currentName = normalized(customField(task, 'Contact Name'));
      const currentEmail = normalized(customField(task, 'Email'));
      if (currentName !== desired.name || currentEmail.toLowerCase() !== desired.email.toLowerCase()) {
        throw new Error('Safety check failed: ClickUp name or email does not match the approved contact');
      }
      const phoneFieldId = customFieldId(task, 'Phone') || account.fieldIds.phone;
      if (!phoneFieldId) throw new Error('Missing ClickUp custom field: Phone');
      const currentPhone = normalizePhoneForClickUp(customField(task, 'Phone'));

      if (currentPhone === desired.phone) {
        items.push({
          clickupTaskId: taskId,
          companyName: account.companyName,
          status: 'unchanged',
          contactName: desired.name,
          email: desired.email || null,
          phone: desired.phone,
        });
        continue;
      }

      await connector(CLICKUP_SERVER, 'clickup_set_custom_field', {
        task_id: taskId,
        field_id: phoneFieldId,
        value: desired.phone,
      }, clickupEnv());
      const verified = await connector(CLICKUP_SERVER, 'clickup_get_task', { task_id: taskId }, clickupEnv());
      const actualPhone = normalizePhoneForClickUp(customField(verified, 'Phone'));
      if (actualPhone !== desired.phone) throw new Error('Phone verification failed after ClickUp update');

      items.push({
        clickupTaskId: taskId,
        companyName: account.companyName,
        status: 'updated',
        contactName: desired.name,
        email: desired.email || null,
        phone: desired.phone,
      });
    } catch (error) {
      items.push({
        clickupTaskId: taskId,
        companyName: account.companyName,
        status: 'failed',
        reason: String((error as Error)?.message || error),
      });
    }
  }

  const totals: PrimaryContactApplyResult['totals'] = { updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  for (const item of items) totals[item.status] += 1;
  cache = null;
  return { appliedAt: Date.now(), totals, items };
}
