#!/usr/bin/env node
/**
 * Vendasta -> ClickUp CRM Sync
 * ----------------------------
 * Standalone batch sync script. Pulls records from Vendasta,
 * routes them to the correct ClickUp list based on lifecycle stage,
 * creates or updates tasks with enriched data.
 *
 * Usage:
 *   node scripts/vendasta-clickup-sync.mjs              # full sync
 *   node scripts/vendasta-clickup-sync.mjs --dry-run     # preview without writing
 *   node scripts/vendasta-clickup-sync.mjs --stage=Customer  # sync only one stage
 *
 * Env (from .env):
 *   VENDASTA_CREDENTIALS   path to service-account JSON
 *   VENDASTA_NAMESPACE     partner namespace (e.g. "0BYD")
 *   CLICKUP_API_TOKEN      ClickUp personal API token
 *
 * Run via cron or scheduled task for automated sync.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---- Load .env ----
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ---- Config ----
const VENDASTA_CREDS_PATH = process.env.VENDASTA_CREDENTIALS || path.join(PROJECT_ROOT, 'secrets/vendasta-nikki-service-account.json');
const VENDASTA_NS = process.env.VENDASTA_NAMESPACE || '0BYD';
const VENDASTA_BASE = (process.env.VENDASTA_BASE_URL || 'https://prod.apigateway.co/org').replace(/\/+$/, '');
const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_BASE = 'https://api.clickup.com/api/v2';
const DRY_RUN = process.argv.includes('--dry-run');
const STAGE_FILTER = process.argv.find(a => a.startsWith('--stage='))?.split('=')[1] || null;

// ---- ClickUp list IDs and field mappings ----
const LISTS = {
  leads:    '901326621319',
  deals:    '901326621326',
  accounts: '901326621325',
  contacts: '901326621321',
  partners: '901327326147',
};

const CUSTOM_FIELDS = {
  crmItemType:  '710b495b-dd0e-4926-ae28-8a5e88e0d67d',
  contactName:  'd2c566f2-89f8-4566-82ec-d9d37e444de3',
  email:        '6f837bd4-1887-44ae-b7d6-20999021dabd',
  phone:        '3d46faf3-d93e-42fe-90ee-891222d1bd21',
  industry:     '92f93df0-793c-445f-bd44-5d05f5d007fe',
  salesStage:   '50904828-fa61-4de2-b938-0a4097112172',
};

// CRM Item Type dropdown option IDs
const CRM_TYPES = {
  Lead:    '22a80f62-e7b9-4a77-bfed-4938413f4a89',
  Deal:    '35f314c3-dbde-4cc0-9350-4c4b3a83b5ac',
  Account: '10372b7a-8708-4954-87ae-b0304a3408cc',
  Contact: '3c352f1c-eba8-415d-a0ba-203f37a7b3e2',
};

// Industry dropdown option IDs
const INDUSTRIES = {
  Construction:          '8d8c48d8-6458-4b14-9168-2f8688121294',
  Education:             '05fc41aa-66f5-46c7-90c2-d7d07bd9c00a',
  Entertainment:         'b1edb923-d0c2-4aa2-bea2-096e44cc5fba',
  'Financial Services':  'daf357f0-5261-40b6-901d-3c586fc3ebd9',
  'Food and Beverage':   'bcb5bf97-eb30-42c7-8adf-de69dbbefd14',
  Healthcare:            '1b12e563-26a3-442a-b0bb-2ce390c28149',
  Hospitality:           '5e317cc1-5af9-4fef-9540-7b603ac14d2c',
  'IT / Technology':     '908b2202-b713-4204-8201-a4d88556dca9',
  Manufacturing:         '7e74c12b-63bf-460b-9504-5a7b8c8c06f3',
  'Professional Services': 'ae6daf70-b347-427d-b650-cd3c205ed335',
  'Real Estate':         'b07c1bea-9f16-4a72-af80-892de2dd4a04',
  Retail:                '25f0659c-3d36-497f-982c-97b700221981',
  Telecom:               '86e4cf20-405f-486b-b49c-f4c12ba52269',
  Transportation:        '867c489f-b35d-45b7-be29-1aa0f9f1e008',
  Other:                 '5f059a78-d618-4f6d-9afc-acb785287fe7',
};

// Internal / own accounts to skip (Vendasta AG IDs)
const SKIP_AG_IDS = new Set([
  'AG-ZL42WQZHPS',  // ImpactWorks Marketing Automation
  'AG-PDN4DDQS4X',  // Rocket Local AI
  'AG-SFVBPB2DK5',  // Dante Crescenzi
  'AG-6664H74XJ7',  // ImpactWorks (alt)
]);

// Vendasta category -> ClickUp industry mapping
const CATEGORY_MAP = {
  dentist: 'Healthcare', doctor: 'Healthcare', hospital: 'Healthcare',
  medical: 'Healthcare', periodontics: 'Healthcare', wellness: 'Healthcare',
  health: 'Healthcare', pharmacy: 'Healthcare', veterinary: 'Healthcare',
  restaurant: 'Food and Beverage', cafe: 'Food and Beverage', bar: 'Food and Beverage',
  food: 'Food and Beverage', bakery: 'Food and Beverage',
  hotel: 'Hospitality', lodging: 'Hospitality', resort: 'Hospitality',
  real_estate: 'Real Estate', property: 'Real Estate', realtor: 'Real Estate',
  construction: 'Construction', contractor: 'Construction', plumber: 'Construction',
  hvac: 'Construction', roofing: 'Construction', electrician: 'Construction',
  school: 'Education', university: 'Education', education: 'Education',
  retail: 'Retail', store: 'Retail', shop: 'Retail',
  technology: 'IT / Technology', software: 'IT / Technology', it: 'IT / Technology',
  telecom: 'Telecom', telecommunications: 'Telecom',
  financial: 'Financial Services', bank: 'Financial Services', insurance: 'Financial Services',
  accounting: 'Financial Services', investment: 'Financial Services',
  manufacturing: 'Manufacturing', factory: 'Manufacturing',
  law: 'Professional Services', legal: 'Professional Services', consulting: 'Professional Services',
  transport: 'Transportation', logistics: 'Transportation', shipping: 'Transportation',
  entertainment: 'Entertainment', music: 'Entertainment', theater: 'Entertainment',
};

// ---- Routing rules: Vendasta stage/status -> ClickUp list + status ----
function routeRecord(lifecycleStage, customStatus) {
  const stage = (lifecycleStage || '').toLowerCase();
  const status = (customStatus || '').toLowerCase();

  // Custom status takes priority (more specific)
  if (status === 'warm' || status === 'warm (appointment set)') {
    return { list: LISTS.leads, clickupStatus: 'qualified', crmType: 'Lead' };
  }
  if (status === 'hot' || status === 'hot (demo completed)') {
    return { list: LISTS.deals, clickupStatus: 'open', crmType: 'Deal' };
  }
  if (status === 'closed') {
    return { list: LISTS.deals, clickupStatus: 'closed', crmType: 'Deal' };
  }

  // Fall back to lifecycle stage
  if (stage === 'customer') {
    return { list: LISTS.accounts, clickupStatus: 'active', crmType: 'Account' };
  }
  if (stage === 'former customer') {
    return { list: LISTS.accounts, clickupStatus: 'churned', crmType: 'Account' };
  }
  if (stage === 'sales qualified lead' || stage === 'prospect') {
    return { list: LISTS.leads, clickupStatus: 'qualified', crmType: 'Lead' };
  }
  if (stage === 'marketing qualified lead') {
    return { list: LISTS.leads, clickupStatus: 'new lead', crmType: 'Lead' };
  }

  // Default: skip leads at generic "Lead" stage (too many, low quality)
  return null;
}

// ============================================================
//  VENDASTA API CLIENT
// ============================================================

let _vendastaCreds = null;
function vendastaCreds() {
  if (_vendastaCreds) return _vendastaCreds;
  _vendastaCreds = JSON.parse(fs.readFileSync(VENDASTA_CREDS_PATH, 'utf-8'));
  return _vendastaCreds;
}

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let _vendastaToken = null;
async function getVendastaToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_vendastaToken && _vendastaToken.exp - 60 > now) return _vendastaToken.access_token;

  const c = vendastaCreds();
  const ap = c.assertionPayloadData || {};
  const ah = c.assertionHeaderData || {};
  const aud = ap.aud || 'https://iam-prod.apigateway.co';
  const iss = ap.iss || c.client_email;
  const sub = ap.sub || c.client_email;
  const kid = ah.kid || c.private_key_id;

  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload = { aud, iss, sub, scope: 'customers', iat: now, exp: now + 600 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = b64url(signer.sign(c.private_key));
  const assertion = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetch(c.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`Vendasta token exchange failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  _vendastaToken = { access_token: json.access_token, exp: now + (json.expires_in || 3600) };
  return _vendastaToken.access_token;
}

async function vendastaAPI(method, path, body) {
  const token = await getVendastaToken();
  const url = VENDASTA_BASE + path;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`Vendasta ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function vendastaListAll(filters = [], returnFields = [], pageSize = 100) {
  const all = [];
  let cursor = null;
  let page = 0;
  do {
    const body = { returnFields };
    if (filters.length) body.fields = filters;
    body.page = { limit: pageSize };
    if (cursor) body.page.cursor = cursor;

    const res = await vendastaAPI('POST', `/list/${VENDASTA_NS}/companies`, body);
    const records = (res.objects || []).map(obj => {
      const rec = { id: null, fields: {} };
      for (const f of (obj.fields || [])) {
        rec.fields[f.id] = f.value;
        if (f.id === 'system__company_id') rec.id = f.value;
      }
      return rec;
    });
    all.push(...records);
    cursor = res.next_cursor || null;
    page++;
    if (page % 5 === 0) log(`  ... pulled ${all.length} records (page ${page})`);
  } while (cursor);
  return all;
}

// ============================================================
//  CLICKUP API CLIENT
// ============================================================

async function clickupAPI(method, path, body) {
  if (!CLICKUP_TOKEN) throw new Error('CLICKUP_API_TOKEN not set in .env');
  const url = CLICKUP_BASE + path;
  const headers = { Authorization: CLICKUP_TOKEN, 'Content-Type': 'application/json' };
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickUp ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function clickupGetTasks(listId) {
  const tasks = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await clickupAPI('GET', `/list/${listId}/task?page=${page}&subtasks=false&include_closed=true`);
    tasks.push(...(res.tasks || []));
    hasMore = (res.tasks || []).length > 0;
    page++;
  }
  return tasks;
}

async function clickupCreateTask(listId, data) {
  return clickupAPI('POST', `/list/${listId}/task`, data);
}

async function clickupUpdateTask(taskId, data) {
  return clickupAPI('PUT', `/task/${taskId}`, data);
}

// ============================================================
//  SYNC LOGIC
// ============================================================

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function extractField(rec, fieldId) {
  return rec.fields[fieldId] || null;
}

function guessIndustry(categories) {
  if (!categories || !Array.isArray(categories)) return null;
  for (const cat of categories) {
    const lower = (cat || '').toLowerCase();
    for (const [keyword, industry] of Object.entries(CATEGORY_MAP)) {
      if (lower.includes(keyword)) return industry;
    }
  }
  return null;
}

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function buildCustomFields(rec, crmType) {
  const fields = [];

  // CRM Item Type
  if (CRM_TYPES[crmType]) {
    fields.push({ id: CUSTOM_FIELDS.crmItemType, value: CRM_TYPES[crmType] });
  }

  // Email
  const email = extractField(rec, 'standard__company_email');
  if (email) fields.push({ id: CUSTOM_FIELDS.email, value: email });

  // Phone
  const phone = extractField(rec, 'standard__company_phone_number');
  if (phone) fields.push({ id: CUSTOM_FIELDS.phone, value: phone });

  // Industry from categories
  const cats = extractField(rec, 'standard__company_category_ids');
  const industry = guessIndustry(cats);
  if (industry && INDUSTRIES[industry]) {
    fields.push({ id: CUSTOM_FIELDS.industry, value: INDUSTRIES[industry] });
  }

  return fields;
}

async function sync() {
  log('=== Vendasta -> ClickUp Sync ===');
  if (DRY_RUN) log('** DRY RUN MODE - no writes **');

  // 1. Pull relevant Vendasta records
  log('Pulling Vendasta companies...');
  const returnFields = [
    'system__company_id',
    'standard__company_name',
    'standard__company_phone_number',
    'standard__company_website',
    'standard__company_email',
    'standard__company_lifecycle_stage',
    'standard__company_primary_location_city_locality',
    'standard__company_primary_location_state_province_region',
    'standard__company_category_ids',
    'standard__company_tags',
    'platform__company_account_group_id',
    'status',
  ];

  let filters = [];
  if (STAGE_FILTER) {
    filters = [{ id: 'standard__company_lifecycle_stage', value: STAGE_FILTER, operation: 'EQUALS' }];
    log(`Filtering to stage: ${STAGE_FILTER}`);
  }

  const vendastaRecords = await vendastaListAll(filters, returnFields);
  log(`Pulled ${vendastaRecords.length} Vendasta records`);

  // 2. Route records to appropriate lists
  const routed = { leads: [], deals: [], accounts: [] };
  let skipped = 0;
  for (const rec of vendastaRecords) {
    const name = extractField(rec, 'standard__company_name');
    const lifecycle = extractField(rec, 'standard__company_lifecycle_stage');
    const status = extractField(rec, 'status');
    const tags = extractField(rec, 'standard__company_tags') || [];
    const agId = extractField(rec, 'platform__company_account_group_id') || '';

    // Skip internal/own accounts
    if (SKIP_AG_IDS.has(agId)) { skipped++; continue; }

    // Skip records tagged for deletion
    if (Array.isArray(tags) && tags.includes('DUPLICATE-DELETE')) { skipped++; continue; }
    if (typeof tags === 'string' && tags.includes('DUPLICATE-DELETE')) { skipped++; continue; }

    const route = routeRecord(lifecycle, status);
    if (!route) { skipped++; continue; }

    rec._route = route;
    rec._name = name;
    rec._agId = agId;

    if (route.list === LISTS.leads) routed.leads.push(rec);
    else if (route.list === LISTS.deals) routed.deals.push(rec);
    else if (route.list === LISTS.accounts) routed.accounts.push(rec);
  }

  log(`Routed: ${routed.leads.length} leads, ${routed.deals.length} deals, ${routed.accounts.length} accounts | Skipped: ${skipped}`);

  if (!CLICKUP_TOKEN) {
    log('CLICKUP_API_TOKEN not set. Showing what WOULD sync:');
    for (const [listName, records] of Object.entries(routed)) {
      if (records.length === 0) continue;
      log(`\n--- ${listName.toUpperCase()} (${records.length}) ---`);
      for (const rec of records.slice(0, 10)) {
        log(`  ${rec._name} -> ${rec._route.clickupStatus}`);
      }
      if (records.length > 10) log(`  ... and ${records.length - 10} more`);
    }
    log('\nSet CLICKUP_API_TOKEN in .env to enable writes.');
    return;
  }

  // 3. Pull existing ClickUp tasks for matching
  log('Pulling existing ClickUp tasks...');
  const existingByList = {};
  for (const [name, listId] of Object.entries(LISTS)) {
    if (['leads', 'deals', 'accounts'].includes(name)) {
      existingByList[listId] = await clickupGetTasks(listId);
      log(`  ${name}: ${existingByList[listId].length} existing tasks`);
    }
  }

  // Build lookups: primary by AG ID (from task description), fallback by normalized name
  const existingByAgId = {};
  const existingByName = {};
  for (const [listId, tasks] of Object.entries(existingByList)) {
    for (const task of tasks) {
      // Extract AG ID from description (format: "Vendasta AG: AG-XXXXX")
      const agMatch = (task.description || '').match(/Vendasta AG:\s*(AG-[A-Z0-9]+)/i);
      if (agMatch) {
        const agKey = agMatch[1].toUpperCase();
        if (!existingByAgId[agKey]) existingByAgId[agKey] = [];
        existingByAgId[agKey].push({ ...task, _listId: listId });
      }
      // Also index by normalized name as fallback
      const key = normalizeName(task.name);
      if (!existingByName[key]) existingByName[key] = [];
      existingByName[key].push({ ...task, _listId: listId });
    }
  }
  log(`  AG ID index: ${Object.keys(existingByAgId).length} tasks | Name index: ${Object.keys(existingByName).length} tasks`);

  // 4. Sync each routed record
  const stats = { created: 0, updated: 0, skipped: 0, errors: 0 };

  for (const [listName, records] of Object.entries(routed)) {
    for (const rec of records) {
      const name = rec._name;
      const route = rec._route;
      const agId = rec._agId;
      const vendastaId = rec.id;
      const website = extractField(rec, 'standard__company_website') || '';
      const city = extractField(rec, 'standard__company_primary_location_city_locality') || '';
      const state = extractField(rec, 'standard__company_primary_location_state_province_region') || '';

      try {
        // Match existing task: AG ID first, then normalized name fallback
        const agMatches = agId ? existingByAgId[agId.toUpperCase()] : null;
        const nameMatches = existingByName[normalizeName(name)];
        const existing = (agMatches && agMatches.length > 0) ? agMatches : nameMatches;
        const matchedBy = (agMatches && agMatches.length > 0) ? 'ag' : 'name';
        const customFields = buildCustomFields(rec, route.crmType);

        if (existing && existing.length > 0) {
          // Update existing task
          const task = existing[0];
          if (DRY_RUN) {
            log(`  [UPDATE] ${name} in ${listName} (${task.id}) matched by ${matchedBy}`);
          } else {
            await clickupUpdateTask(task.id, {
              status: route.clickupStatus,
              custom_fields: customFields,
            });
            log(`  [UPDATED] ${name} (${task.id}) matched by ${matchedBy}`);
          }
          stats.updated++;
        } else {
          // Create new task
          const description = [
            city ? `Location: ${city}, ${state}` : '',
            website ? `Website: ${website}` : '',
            agId ? `Vendasta AG: ${agId}` : '',
            vendastaId ? `Vendasta ID: ${vendastaId}` : '',
            `Source: Vendasta Customer sync`,
            `Synced: ${new Date().toISOString()}`,
          ].filter(Boolean).join('\n');

          if (DRY_RUN) {
            log(`  [CREATE] ${name} -> ${listName} (${route.clickupStatus}) AG: ${agId}`);
          } else {
            const created = await clickupCreateTask(route.list, {
              name,
              status: route.clickupStatus,
              description,
              custom_fields: customFields,
            });
            log(`  [CREATED] ${name} -> ${listName} (${created?.id || 'no-id'}) AG: ${agId}`);
            // Add to AG index so subsequent records in same batch don't dupe
            if (agId && created?.id) {
              if (!existingByAgId[agId.toUpperCase()]) existingByAgId[agId.toUpperCase()] = [];
              existingByAgId[agId.toUpperCase()].push({ id: created.id, name, _listId: route.list });
            }
          }
          stats.created++;
        }
      } catch (err) {
        log(`  [ERROR] ${name}: ${err.message}`);
        stats.errors++;
      }
    }
  }

  // 5. Summary
  log('\n=== Sync Complete ===');
  log(`Created: ${stats.created} | Updated: ${stats.updated} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`);

  // Write log file
  const logEntry = {
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    vendastaTotal: vendastaRecords.length,
    routed: { leads: routed.leads.length, deals: routed.deals.length, accounts: routed.accounts.length },
    skipped,
    stats,
  };
  const logDir = path.join(PROJECT_ROOT, 'store', 'sync-logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `sync-${new Date().toISOString().slice(0, 10)}.json`);
  const existing = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf-8')) : [];
  existing.push(logEntry);
  fs.writeFileSync(logFile, JSON.stringify(existing, null, 2));
  log(`Log written to ${logFile}`);
}

// ---- Run ----
sync().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
