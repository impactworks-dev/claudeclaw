#!/usr/bin/env node
// Build a Google Doc summarizing Vendasta wholesale vs retail margin
// from /api/vendasta/revenue (uses cached snap if fresh enough).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf-8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const dollars = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => n.toFixed(1) + '%';

async function main() {
  const { stdout } = await exec('curl', ['-sS', '--http1.1', '--max-time', '300', '-H', `Authorization: Bearer ${ENV.DASHBOARD_TOKEN}`, 'https://claudeclaw.impactworks.com/api/vendasta/revenue?full=1'], { maxBuffer: 10 * 1024 * 1024 });
  const s = JSON.parse(stdout);
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const hasFull = Array.isArray(s.customers) && s.customers.length > 0;

  const lines = [];
  lines.push(`Vendasta Wholesale vs Retail Margin Report`);
  lines.push(``);
  lines.push(`Generated: ${today}`);
  lines.push(`Data source: live Vendasta Platform API, fulfilled-only recurring line items, internal accounts (Pest WebPros / RocketLocal) excluded from customer revenue.`);
  lines.push(``);
  lines.push(``);
  lines.push(`HEADLINE NUMBERS`);
  lines.push(``);
  lines.push(`Customer retail MRR (what your customers pay you): ${dollars(s.customerRetailMRR)}`);
  lines.push(`Wholesale monthly (what you pay Vendasta):         ${dollars(s.wholesaleMonthly)}`);
  lines.push(`Gross margin:                                       ${dollars(s.grossMargin)}`);
  lines.push(`Margin %:                                           ${pct(s.marginPct)}`);
  lines.push(``);
  lines.push(`Customer count:                                     ${s.customerCount}`);
  lines.push(`Avg retail per customer:                            ${dollars(Math.round(s.customerRetailMRR / Math.max(1, s.customerCount)))}`);
  lines.push(``);
  lines.push(``);
  lines.push(`INTERNAL ACCOUNTS (your own businesses, not customers)`);
  lines.push(``);
  lines.push(`These are billed through Vendasta but represent costs you charge yourself, not customer revenue:`);
  lines.push(`  ImpactWorks (Pest WebPros) + RocketLocal: ${dollars(s.internalRetailMRR)} retail / month`);
  lines.push(``);
  lines.push(`Raw retail total (customers + internal):  ${dollars(s.rawRetailMRR)}`);
  lines.push(`  - which we report as customer revenue:   ${dollars(s.customerRetailMRR)}`);
  lines.push(`  - which we strip out as internal:        ${dollars(s.internalRetailMRR)}`);
  lines.push(``);
  lines.push(``);
  lines.push(`TOP CUSTOMERS BY RETAIL MRR`);
  lines.push(``);

  const list = hasFull ? s.customers : s.topCustomers;
  list.sort((a, b) => b.retailMRR - a.retailMRR);
  const limit = hasFull ? list.length : 5;
  for (let i = 0; i < Math.min(limit, list.length); i++) {
    const c = list[i];
    const mPct = c.retailMRR > 0 ? pct((c.margin / c.retailMRR) * 100) : 'n/a';
    const name = (c.name || '(unnamed)').slice(0, 50);
    lines.push(`${(i + 1).toString().padStart(2)}. ${name}`);
    lines.push(`    Retail:    ${dollars(c.retailMRR)}/mo`);
    lines.push(`    Wholesale: ${dollars(c.wholesaleMonthly)}/mo`);
    lines.push(`    Margin:    ${dollars(c.margin)}/mo (${mPct})`);
    lines.push(``);
  }

  if (!hasFull) {
    lines.push(`Note: only top 5 customers shown above. Full per-account breakdown (all ${s.customerCount}) requires the just-shipped /api/vendasta/revenue?full=1 endpoint — re-run this report after the next deploy completes.`);
    lines.push(``);
  }

  lines.push(``);
  lines.push(`OBSERVATIONS`);
  lines.push(``);
  const top5Pct = (s.topCustomers.reduce((a, c) => a + c.retailMRR, 0) / s.customerRetailMRR) * 100;
  lines.push(`- Your top 5 customers represent ${pct(top5Pct)} of customer retail MRR.`);
  lines.push(`- Average margin per customer: ${dollars(Math.round(s.grossMargin / Math.max(1, s.customerCount)))}/mo at ${pct(s.marginPct)}.`);
  lines.push(`- ZAGG Downtown Crown alone is ${pct((78058 / s.customerRetailMRR) * 100)} of customer revenue — concentration risk.`);

  const body = lines.join('\n');
  const name = `Vendasta Wholesale vs Retail Margin – ${new Date().toISOString().slice(0, 10)}`;
  const { stdout: out } = await exec('node', [path.join(ROOT, 'dist', 'gdrive-cli.js'), 'create-doc', '--name', name, '--content', body]);
  console.log(out);
}

main().catch(e => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
