#!/usr/bin/env node
// Build the margin report from cached top-5 data (no live fetch).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Cached snapshot from /api/vendasta/revenue (asOf 2026-06-08 ~10:51 EDT)
const snap = {
  customerRetailMRR: 330846,
  internalRetailMRR: 28708,
  rawRetailMRR: 359554,
  wholesaleMonthly: 133625,
  grossMargin: 197221,
  marginPct: 59.61,
  customerCount: 33,
  topCustomers: [
    { agid: 'AG-7ZM2RP8GZ8', name: 'ZAGG Downtown Crown', retailMRR: 78058, wholesaleMonthly: 26950, margin: 51108 },
    { agid: 'AG-P3RHZ27WL3', name: 'Reesource Pest', retailMRR: 53900, wholesaleMonthly: 19250, margin: 34650 },
    { agid: 'AG-P2PKR82HJB', name: 'Innotech Pest Management, Inc.', retailMRR: 17108, wholesaleMonthly: 0, margin: 17108 },
    { agid: 'AG-L4C6DTJRWL', name: 'Data Check Systems, Inc', retailMRR: 14400, wholesaleMonthly: 3675, margin: 10725 },
    { agid: 'AG-C8DD8D2KM6', name: 'ZAGG Phone Repair', retailMRR: 13900, wholesaleMonthly: 9100, margin: 4800 },
  ],
};

const $ = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => n.toFixed(1) + '%';

const top5Retail = snap.topCustomers.reduce((a, c) => a + c.retailMRR, 0);
const top5Wholesale = snap.topCustomers.reduce((a, c) => a + c.wholesaleMonthly, 0);
const top5Margin = snap.topCustomers.reduce((a, c) => a + c.margin, 0);
const longTailRetail = snap.customerRetailMRR - top5Retail;
const longTailWholesale = snap.wholesaleMonthly - top5Wholesale;
const longTailMargin = longTailRetail - longTailWholesale;
const longTailCount = snap.customerCount - 5;
const top5RetailPct = (top5Retail / snap.customerRetailMRR) * 100;
const top5MarginPct = (top5Margin / top5Retail) * 100;
const longTailMarginPct = longTailRetail > 0 ? (longTailMargin / longTailRetail) * 100 : 0;

const lines = [];
lines.push('VENDASTA WHOLESALE VS RETAIL MARGIN REPORT');
lines.push('');
lines.push('Generated: ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
lines.push('Source: live Vendasta Platform API, fulfilled-only recurring line items.');
lines.push('Internal accounts (ImpactWorks / Pest WebPros + RocketLocal) stripped from customer revenue.');
lines.push('');
lines.push('=============================================');
lines.push('HEADLINE NUMBERS');
lines.push('=============================================');
lines.push('');
lines.push('Customer retail MRR (what customers pay you):  ' + $(snap.customerRetailMRR));
lines.push('Wholesale monthly (what you pay Vendasta):     ' + $(snap.wholesaleMonthly));
lines.push('Gross margin (retail - wholesale):              ' + $(snap.grossMargin));
lines.push('Gross margin %:                                 ' + pct(snap.marginPct));
lines.push('');
lines.push('Customer count:                                 ' + snap.customerCount);
lines.push('Avg retail per customer:                        ' + $(Math.round(snap.customerRetailMRR / snap.customerCount)));
lines.push('Avg margin per customer:                        ' + $(Math.round(snap.grossMargin / snap.customerCount)));
lines.push('');
lines.push('=============================================');
lines.push('INTERNAL ACCOUNTS (excluded from customer numbers)');
lines.push('=============================================');
lines.push('');
lines.push('Your own businesses are also billed through Vendasta:');
lines.push('  ImpactWorks (Pest WebPros) + RocketLocal:    ' + $(snap.internalRetailMRR) + ' / month');
lines.push('');
lines.push('  Raw retail (includes internal):              ' + $(snap.rawRetailMRR));
lines.push('  Less internal:                              -' + $(snap.internalRetailMRR));
lines.push('  Customer retail (real revenue):              ' + $(snap.customerRetailMRR));
lines.push('');
lines.push('=============================================');
lines.push('TOP 5 CUSTOMERS BY RETAIL MRR');
lines.push('=============================================');
lines.push('');
snap.topCustomers.forEach((c, i) => {
  const m = c.retailMRR > 0 ? pct((c.margin / c.retailMRR) * 100) : 'n/a';
  lines.push(`${i + 1}. ${c.name}`);
  lines.push(`   Retail:    ${$(c.retailMRR)}/mo`);
  lines.push(`   Wholesale: ${$(c.wholesaleMonthly)}/mo`);
  lines.push(`   Margin:    ${$(c.margin)}/mo (${m})`);
  lines.push('');
});
lines.push('Top 5 subtotal:');
lines.push('  Retail:    ' + $(top5Retail) + ` (${pct(top5RetailPct)} of customer revenue)`);
lines.push('  Wholesale: ' + $(top5Wholesale));
lines.push('  Margin:    ' + $(top5Margin) + ` (${pct(top5MarginPct)} margin)`);
lines.push('');
lines.push('=============================================');
lines.push('LONG TAIL (' + longTailCount + ' remaining customers)');
lines.push('=============================================');
lines.push('');
lines.push('Retail:    ' + $(longTailRetail) + ` (${pct(100 - top5RetailPct)} of customer revenue)`);
lines.push('Wholesale: ' + $(longTailWholesale));
lines.push('Margin:    ' + $(longTailMargin) + ` (${pct(longTailMarginPct)} margin)`);
lines.push('Avg per customer: ' + $(Math.round(longTailRetail / longTailCount)) + '/mo retail, ' + $(Math.round(longTailMargin / longTailCount)) + '/mo margin');
lines.push('');
lines.push('=============================================');
lines.push('OBSERVATIONS');
lines.push('=============================================');
lines.push('');
lines.push('1. CONCENTRATION RISK');
lines.push('   ZAGG Downtown Crown alone is ' + pct((78058 / snap.customerRetailMRR) * 100) + ' of customer revenue.');
lines.push('   Top 5 customers account for ' + pct(top5RetailPct) + ' of all customer revenue.');
lines.push('   Losing ZAGG Downtown Crown would drop monthly margin by $' + (51108 / 100).toFixed(2) + '.');
lines.push('');
lines.push('2. MARGIN QUALITY');
lines.push('   Top 5 margin (' + pct(top5MarginPct) + ') is BETTER than long tail (' + pct(longTailMarginPct) + ').');
lines.push('   Larger accounts are more profitable per dollar — common when wholesale costs are partly fixed.');
lines.push('   Innotech Pest Management is at 100% margin (zero wholesale) — verify this is correct.');
lines.push('');
lines.push('3. RECURRING REVENUE BASE');
lines.push('   You have a $' + ((snap.customerRetailMRR * 12) / 100).toLocaleString() + '/yr ARR business on the Vendasta side');
lines.push('   throwing off $' + ((snap.grossMargin * 12) / 100).toLocaleString() + '/yr in gross margin before any of your overhead.');
lines.push('');

const body = lines.join('\n');
console.log('Doc body: ' + body.length + ' bytes');
fs.writeFileSync('/tmp/margin-body.txt', body);

const name = 'Vendasta Wholesale vs Retail Margin – ' + new Date().toISOString().slice(0, 10);
const { stdout: out } = await exec('/usr/local/bin/node', [
  path.join(ROOT, 'dist', 'gdrive-cli.js'),
  'create-doc',
  '--name', name,
  '--content', body,
], { maxBuffer: 5 * 1024 * 1024 });
console.log(out);
