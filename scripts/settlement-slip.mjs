#!/usr/bin/env node
// Vendasta Settlement Slip generator.
//
// Once a month (5th, scheduled), Nikki computes the per-brand split from
// Vendasta and outputs a "slip" — a journal entry the bookkeeper can post
// to QBO. Phase E adds Telegram-approved auto-posting.
//
// Usage:
//   node scripts/settlement-slip.mjs               # previous month
//   node scripts/settlement-slip.mjs --month 2026-05
//   node scripts/settlement-slip.mjs --dry-run     # don't save pending or call Drive
//
// Output (always):
//   - Pretty Telegram-format summary printed to stdout
//   - Google Doc created in user's Drive (unless --dry-run)
//   - Pending slip saved to store/pending-slips.json (unless --dry-run)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = path.join(ROOT, 'store');
const PENDING_FILE = path.join(STORE, 'pending-slips.json');
const ACCOUNTS_CACHE = path.join(STORE, 'qbo-accounts-cache.json');

// --- env / config ---
const ENV = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf-8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const DASHBOARD_URL = ENV.DASHBOARD_URL || 'https://claudeclaw.impactworks.com';
const DASHBOARD_TOKEN = ENV.DASHBOARD_TOKEN;

// Account-name patterns we resolve against /api/qb/accounts. Match is first
// account whose name === target OR whose lowercased name matches.
const ACCOUNT_TARGETS = {
  bank: 'Novo Business Checking',
  impactworksIncome: 'ImpactWorks',
  rocketlocalIncome: 'Rocket Local',
  impactworksCogs: 'ImpactWorks - Vendasta Wholesale',
  rocketlocalCogs: 'Rocket Local - Vendasta Wholesale',
};

// --- arg parsing ---
const args = process.argv.slice(2);
const argv = {
  month: null,
  dryRun: false,
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--month') argv.month = args[++i];
  else if (args[i] === '--dry-run') argv.dryRun = true;
}

function previousMonthIso() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

const month = argv.month || previousMonthIso();
if (!/^\d{4}-\d{2}$/.test(month)) {
  console.error('Invalid --month, expected YYYY-MM');
  process.exit(2);
}
const [yr, mo] = month.split('-').map(Number);
const lastDay = new Date(Date.UTC(yr, mo, 0)).toISOString().slice(0, 10);
const monthLabel = new Date(Date.UTC(yr, mo - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// --- helpers ---
const dollars = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fromDollars = (n) => Math.round(Number(n) * 100);
const dollarsFloat = (cents) => Number((cents / 100).toFixed(2));

async function curl(url, opts = {}) {
  const args = ['-sS', '--http1.1', '--max-time', String(opts.timeout || 60), '-H', `Authorization: Bearer ${DASHBOARD_TOKEN}`, url];
  const { stdout } = await exec('curl', args, { maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// --- fetch revenue ---
console.error(`Generating slip for ${monthLabel} (${month})`);
console.error(`Fetching revenue split...`);
const rev = await curl(`${DASHBOARD_URL}/api/vendasta/revenue?full=1`, { timeout: 240 });
if (!rev.brands || rev.brands.length === 0) {
  console.error('No brands[] in response. Per-market data layer not deployed yet.');
  process.exit(3);
}
const pwps = rev.brands.find(b => b.slug === 'pwps') || { customerRetailMRR: 0, wholesaleMonthly: 0 };
const dft = rev.brands.find(b => b.slug === 'default') || { customerRetailMRR: 0, wholesaleMonthly: 0 };
const unknown = rev.brands.find(b => b.slug === 'unknown');
if (unknown && unknown.customerRetailMRR > 0) {
  console.error(`Note: $${(unknown.customerRetailMRR/100).toFixed(2)}/mo customer retail is currently untagged (no market slug) and excluded from the slip. Investigate ${unknown.customerCount} accounts.`);
}

// --- compute journal entry ---
// Pattern: gross booking. Customer retail is income credit per brand.
// Wholesale cost is COGS debit per brand. Difference = net bank deposit.
const impactworksRetail = pwps.customerRetailMRR;
const rocketlocalRetail = dft.customerRetailMRR;
const impactworksCogs = pwps.wholesaleMonthly;
const rocketlocalCogs = dft.wholesaleMonthly;
const totalRetail = impactworksRetail + rocketlocalRetail;
const totalCogs = impactworksCogs + rocketlocalCogs;
const netDeposit = totalRetail - totalCogs;

// --- fetch QBO accounts to resolve IDs ---
console.error('Fetching QBO account IDs...');
let accountsResp;
try {
  accountsResp = await curl(`${DASHBOARD_URL}/api/qb/accounts`, { timeout: 60 });
} catch (e) {
  // Try cache as fallback
  if (fs.existsSync(ACCOUNTS_CACHE)) {
    console.error('Live fetch failed, using cached accounts');
    accountsResp = loadJson(ACCOUNTS_CACHE, { accounts: [] });
  } else {
    throw e;
  }
}
saveJson(ACCOUNTS_CACHE, accountsResp);

const accountIds = {};
const acctMatch = (target) => {
  const exact = accountsResp.accounts.find(a => a.name === target && a.active !== false);
  if (exact) return exact.id;
  const fuzzy = accountsResp.accounts.find(a => a.name?.toLowerCase() === target.toLowerCase() && a.active !== false);
  return fuzzy ? fuzzy.id : null;
};
for (const [key, target] of Object.entries(ACCOUNT_TARGETS)) {
  accountIds[key] = acctMatch(target);
  if (!accountIds[key]) console.error(`! Could not find QBO account: "${target}"`);
}

// --- build the QBO JournalEntry payload ---
const lines = [];
const addLine = (account, postingType, amount, description) => {
  if (amount <= 0) return;
  lines.push({
    Description: description,
    Amount: dollarsFloat(amount),
    DetailType: 'JournalEntryLineDetail',
    JournalEntryLineDetail: {
      PostingType: postingType,
      AccountRef: { value: accountIds[account] },
    },
  });
};
addLine('bank', 'Debit', netDeposit, `Vendasta net deposit ${monthLabel}`);
addLine('impactworksCogs', 'Debit', impactworksCogs, `ImpactWorks wholesale ${monthLabel}`);
addLine('rocketlocalCogs', 'Debit', rocketlocalCogs, `Rocket Local wholesale ${monthLabel}`);
addLine('impactworksIncome', 'Credit', impactworksRetail, `ImpactWorks customer revenue ${monthLabel}`);
addLine('rocketlocalIncome', 'Credit', rocketlocalRetail, `Rocket Local customer revenue ${monthLabel}`);

const slipId = crypto.randomBytes(4).toString('hex');
const journalEntry = {
  TxnDate: lastDay,
  DocNumber: `VEN-${month}`,
  PrivateNote: `Vendasta settlement ${monthLabel} — generated by Nikki (slip ${slipId})`,
  Line: lines,
};

// --- format the slip body ---
const slipBody = `VENDASTA SETTLEMENT SLIP — ${monthLabel.toUpperCase()}
Slip ID: ${slipId}
Generated: ${new Date().toISOString()}
Source: Vendasta Platform API, current MRR snapshot (used as proxy for ${monthLabel} settlement)

=========================================
BRAND SPLIT
=========================================

ImpactWorks
  Retail (customers paid):       ${dollars(impactworksRetail)}
  Wholesale (you paid Vendasta): ${dollars(impactworksCogs)}
  Net margin:                    ${dollars(impactworksRetail - impactworksCogs)}

Rocket Local
  Retail (customers paid):       ${dollars(rocketlocalRetail)}
  Wholesale (you paid Vendasta): ${dollars(rocketlocalCogs)}
  Net margin:                    ${dollars(rocketlocalRetail - rocketlocalCogs)}

=========================================
JOURNAL ENTRY TO POST IN QBO
=========================================

Date:        ${lastDay}
Doc number:  VEN-${month}
Memo:        Vendasta settlement ${monthLabel}

  DR  Novo Business Checking ......................... ${dollars(netDeposit).padStart(12)}
  DR  ImpactWorks - Vendasta Wholesale ............... ${dollars(impactworksCogs).padStart(12)}
  DR  Rocket Local - Vendasta Wholesale .............. ${dollars(rocketlocalCogs).padStart(12)}
      CR  Income: ImpactWorks ........................ ${dollars(impactworksRetail).padStart(12)}
      CR  Income: Rocket Local ....................... ${dollars(rocketlocalRetail).padStart(12)}

Total debits:  ${dollars(netDeposit + impactworksCogs + rocketlocalCogs)}
Total credits: ${dollars(impactworksRetail + rocketlocalRetail)}

=========================================
TO POST THIS IN QBO
=========================================

Reply to Nikki in Telegram:    post slip ${slipId}
…and she'll create the journal entry directly in QuickBooks
(Phase E flow). Or post it manually in QBO using the table above.

QBO account IDs resolved:
  ${Object.entries(accountIds).map(([k, v]) => `${k.padEnd(20)} → ${v || 'NOT FOUND'}`).join('\n  ')}
`;

console.log(slipBody);

// --- save pending slip + Drive doc + Telegram summary ---
if (argv.dryRun) {
  console.error('\n[--dry-run] not saving pending slip or creating Drive doc.');
  process.exit(0);
}

const pendingList = loadJson(PENDING_FILE, []);
pendingList.unshift({
  id: slipId,
  month,
  asOf: Date.now(),
  status: 'pending',
  amounts: {
    netDeposit, impactworksRetail, rocketlocalRetail,
    impactworksCogs, rocketlocalCogs,
  },
  journalEntry,
});
saveJson(PENDING_FILE, pendingList);
console.error(`Saved pending slip ${slipId} → ${PENDING_FILE}`);

// Create Google Doc
const docName = `Vendasta Settlement Slip — ${monthLabel}`;
console.error(`Creating Google Doc "${docName}"...`);
try {
  const { stdout: out } = await exec('/usr/local/bin/node', [
    path.join(ROOT, 'dist', 'gdrive-cli.js'),
    'create-doc',
    '--name', docName,
    '--content', slipBody,
  ], { maxBuffer: 5 * 1024 * 1024 });
  const r = JSON.parse(out);
  console.error(`Drive doc: ${r.file.webViewLink}`);
  console.log(`\n📄 Doc: ${r.file.webViewLink}`);
} catch (e) {
  console.error(`Drive doc creation failed: ${e.message}`);
}
