#!/usr/bin/env node
// Pull full /api/vendasta/revenue?full=1 from Fly, build a Google Sheet
// with per-customer wholesale-vs-retail breakdown, upload to Drive.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, '.env');
const ENV = Object.fromEntries(
  fs.readFileSync(ENV_PATH, 'utf-8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const fmt = (cents) => (cents / 100).toFixed(2);
const csvEscape = (v) => {
  const s = String(v ?? '');
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  console.log('Fetching full revenue breakdown from Fly...');
  const url = 'https://claudeclaw.impactworks.com/api/vendasta/revenue?force=1&full=1';
  const { stdout } = await exec('curl', ['-sS', '--http1.1', '--max-time', '300', '-H', `Authorization: Bearer ${ENV.DASHBOARD_TOKEN}`, url]);
  const snap = JSON.parse(stdout);
  if (!snap.customers || !Array.isArray(snap.customers)) {
    throw new Error('No customers[] in response. Got: ' + JSON.stringify(snap).slice(0, 300));
  }
  console.log(`Got ${snap.customers.length} customers, totals retail $${fmt(snap.customerRetailMRR)}, wholesale $${fmt(snap.wholesaleMonthly)}`);

  const sorted = [...snap.customers].sort((a,b) => b.retailMRR - a.retailMRR);
  const lines = [];
  lines.push(['Rank', 'Account Name', 'AG-ID', 'Retail MRR (you charge)', 'Wholesale Monthly (your cost)', 'Margin $', 'Margin %'].map(csvEscape).join(','));
  sorted.forEach((c, i) => {
    const marginPct = c.retailMRR > 0 ? ((c.margin / c.retailMRR) * 100).toFixed(1) + '%' : 'n/a';
    lines.push([
      i + 1,
      c.name || '(unnamed)',
      c.agid,
      fmt(c.retailMRR),
      fmt(c.wholesaleMonthly),
      fmt(c.margin),
      marginPct,
    ].map(csvEscape).join(','));
  });
  lines.push('');
  lines.push(['', 'TOTALS (customer-only)', '', fmt(snap.customerRetailMRR), fmt(snap.wholesaleMonthly), fmt(snap.grossMargin), snap.marginPct.toFixed(1) + '%'].map(csvEscape).join(','));
  lines.push(['', 'Internal accounts retail', '', fmt(snap.internalRetailMRR), '', '', ''].map(csvEscape).join(','));
  lines.push(['', 'Raw retail (includes internal)', '', fmt(snap.rawRetailMRR), '', '', ''].map(csvEscape).join(','));
  const csv = lines.join('\n');

  const csvPath = '/tmp/vendasta-margin-report.csv';
  fs.writeFileSync(csvPath, csv);
  console.log(`Wrote CSV: ${csvPath} (${csv.length} bytes)`);

  const today = new Date().toISOString().slice(0, 10);
  const name = `Vendasta Margin Breakdown ${today}`;
  console.log(`Uploading to Drive as "${name}"...`);
  const gdriveCli = path.join(ROOT, 'dist', 'gdrive-cli.js');
  const { stdout: createOut } = await exec('node', [gdriveCli, 'create-sheet', '--name', name, '--csv', csv]);
  const created = JSON.parse(createOut);
  console.log(`Created: ${created.webViewLink || created.id}`);
  console.log(JSON.stringify({ id: created.id, link: created.webViewLink, name, customers: snap.customers.length }, null, 2));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
