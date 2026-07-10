#!/usr/bin/env node
/**
 * BID Outreach Import — North Carolina
 * ------------------------------------
 * Reads uploads/North Carolina.xlsx (or a path passed as --file=) and creates
 * one ClickUp task per BID in the Leads list, tagged for the BID Traffic
 * Partnership campaign. Idempotent: if a task with the same BID entity name
 * already exists in the list, it is updated rather than duplicated.
 *
 * Usage:
 *   node scripts/import-bids-to-clickup.mjs --file=/path/to/North\ Carolina.xlsx
 *   node scripts/import-bids-to-clickup.mjs --file=... --dry-run
 *
 * Env (from .env):
 *   CLICKUP_API_TOKEN   ClickUp personal token (pk_...)
 *
 * Tags applied: bid, bid-nc, campaign:bid-traffic
 * List: 901326621319 (Leads)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---- Load .env ----
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
if (!CLICKUP_TOKEN) { console.error('Missing CLICKUP_API_TOKEN'); process.exit(1); }

const LEADS_LIST = '901326621319';
const CAMPAIGN_TAGS = ['bid', 'bid-nc', 'campaign:bid-traffic'];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const fileArg = args.find(a => a.startsWith('--file='));
const FILE = fileArg
  ? fileArg.slice('--file='.length)
  : path.join(PROJECT_ROOT, 'workspace', 'uploads', 'North Carolina.xlsx');

if (!fs.existsSync(FILE)) {
  console.error(`File not found: ${FILE}`);
  console.error('Pass with --file=/absolute/path/to/North Carolina.xlsx');
  process.exit(1);
}

// ---- XLSX reader (minimal, zero-dep — uses unzip + xml regex on sharedStrings + sheet1) ----
// We avoid pulling in xlsx/exceljs as deps. The file is small (~12KB).
async function readBidsFromXlsx(filePath) {
  // Use Node's zlib via a tiny inline unzip. Since xlsx is just a zip,
  // we shell out to `unzip -p` which exists on macOS and Linux.
  const { execFileSync } = await import('node:child_process');
  function unzipMember(member) {
    return execFileSync('unzip', ['-p', filePath, member], { maxBuffer: 16 * 1024 * 1024 }).toString('utf-8');
  }
  const sharedXml = unzipMember('xl/sharedStrings.xml');
  const sheetXml = unzipMember('xl/worksheets/sheet1.xml');

  // Parse shared strings (<si><t>...</t></si>)
  const strings = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRegex.exec(sharedXml)) !== null) {
    // Concatenate all <t> children (handles rich text runs).
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let txt = ''; let tm;
    while ((tm = tRegex.exec(m[1])) !== null) txt += tm[1];
    strings.push(txt.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }

  // Parse rows. Each <row><c r="A1" t="s|str|n"><v>val</v></c>...</row>
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRegex.exec(sheetXml)) !== null) {
    const cells = [];
    const cellRegex = /<c\s+r="([A-Z]+)\d+"(?:\s+s="\d+")?(?:\s+t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRegex.exec(rm[1])) !== null) {
      const col = cm[1];
      const type = cm[2] || 'n';
      const inner = cm[3];
      const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      const tMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let val = null;
      if (vMatch) {
        const raw = vMatch[1];
        if (type === 's') val = strings[parseInt(raw, 10)];
        else if (type === 'b') val = raw === '1';
        else val = isNaN(Number(raw)) ? raw : Number(raw);
      } else if (tMatch) {
        val = tMatch[1];
      }
      cells.push({ col, val });
    }
    rows.push(cells);
  }

  // Convert cell arrays to objects keyed by header.
  if (rows.length < 2) return [];
  const headerCells = rows[0];
  const colToHeader = {};
  for (const c of headerCells) colToHeader[c.col] = String(c.val || '').trim();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    for (const c of rows[i]) {
      const key = colToHeader[c.col];
      if (key) obj[key] = c.val;
    }
    // Skip empty rows.
    if (!obj['Entity/MSD Name'] && !obj['City']) continue;
    out.push(obj);
  }
  return out;
}

// ---- ClickUp API ----
const CU_BASE = 'https://api.clickup.com/api/v2';
async function cu(method, p, body) {
  const res = await fetch(CU_BASE + p, {
    method,
    headers: { Authorization: CLICKUP_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickUp ${method} ${p} failed: ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function fetchExistingTasksByName(listId) {
  // Paginate. ClickUp returns 100 per page.
  const byName = new Map();
  for (let page = 0; page < 30; page++) {
    const data = await cu('GET', `/list/${listId}/task?include_closed=true&page=${page}`);
    const tasks = data.tasks || [];
    for (const t of tasks) byName.set((t.name || '').trim().toLowerCase(), t);
    if (tasks.length < 100) break;
  }
  return byName;
}

async function createTask(listId, name, description, tags) {
  return cu('POST', `/list/${listId}/task`, { name, description, tags });
}
async function updateTaskDescription(taskId, description) {
  return cu('PUT', `/task/${taskId}`, { description });
}
async function addTag(taskId, tag) {
  // Tags auto-create on first use.
  await cu('POST', `/task/${taskId}/tag/${encodeURIComponent(tag)}`).catch(() => {});
}

// ---- Main ----
function descFor(bid) {
  const lines = [
    `**Campaign:** BID Traffic Partnership (NC)`,
    `**City:** ${bid['City'] ?? ''}`,
    `**Director / Primary Contact:** ${bid['Director/Primary Contact'] ?? ''}`,
    `**Email:** ${bid['Email'] ?? ''}`,
    `**Website:** ${bid['Website'] ?? ''}`,
    `**Approx. Member Businesses:** ${bid['Approx. Businesses'] ?? '—'}`,
    ``,
    `**Pitch:** Official BID Member Benefit — $169/mo AI Ads + Chatbot for member businesses. Bi-weekly Discovery Webinar is the conversion event.`,
    ``,
    `Imported ${new Date().toISOString()} from North Carolina.xlsx.`,
  ];
  return lines.join('\n');
}

(async () => {
  console.log(`Reading: ${FILE}`);
  const bids = await readBidsFromXlsx(FILE);

  // Dedupe by entity name (the sheet has some duplicates between "Complete NC" and "Sheet1").
  const seen = new Set();
  const unique = [];
  for (const b of bids) {
    const key = String(b['Entity/MSD Name'] || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(b);
  }
  console.log(`Found ${bids.length} rows → ${unique.length} unique BIDs`);

  if (DRY) {
    console.log('\n--- DRY RUN ---');
    for (const b of unique.slice(0, 10)) {
      console.log(`  ${b['Entity/MSD Name']} | ${b['City']} | ${b['Email']} | ~${b['Approx. Businesses']} members`);
    }
    if (unique.length > 10) console.log(`  ... + ${unique.length - 10} more`);
    console.log(`\nWould create/update ${unique.length} tasks in Leads list ${LEADS_LIST}.`);
    return;
  }

  console.log(`Fetching existing tasks from list ${LEADS_LIST}...`);
  const existing = await fetchExistingTasksByName(LEADS_LIST);
  console.log(`Existing tasks in list: ${existing.size}`);

  let created = 0, updated = 0, errors = 0;
  for (const b of unique) {
    const name = String(b['Entity/MSD Name'] || '').trim();
    if (!name) continue;
    const desc = descFor(b);
    try {
      const found = existing.get(name.toLowerCase());
      let taskId;
      if (found) {
        await updateTaskDescription(found.id, desc);
        taskId = found.id;
        updated++;
        process.stdout.write(`. ${name}\n`);
      } else {
        const created_ = await createTask(LEADS_LIST, name, desc, CAMPAIGN_TAGS);
        taskId = created_.id;
        created++;
        process.stdout.write(`+ ${name}\n`);
      }
      // Always ensure campaign tags are present.
      for (const t of CAMPAIGN_TAGS) await addTag(taskId, t);
    } catch (e) {
      errors++;
      console.error(`  ! ${name}: ${e.message}`);
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated, ${errors} errors`);

  // Also write a local cache the Outreach Tracker can read without hitting ClickUp.
  const cachePath = path.join(PROJECT_ROOT, 'store', 'bid-roster.json');
  fs.writeFileSync(cachePath, JSON.stringify({
    generatedAt: Date.now(),
    campaign: 'BID Traffic Partnership (NC)',
    bids: unique.map(b => ({
      entity: b['Entity/MSD Name'],
      city: b['City'],
      contact: b['Director/Primary Contact'],
      email: b['Email'],
      website: b['Website'],
      members: typeof b['Approx. Businesses'] === 'number' ? b['Approx. Businesses'] : null,
    })),
  }, null, 2));
  console.log(`Roster cached at: ${cachePath}`);
})().catch(e => { console.error(e); process.exit(1); });
