#!/usr/bin/env node
// Vendasta order audit — pulls every order for partner 0BYD, dumps a CSV
// of order-level detail with MRR classification + suspect flags.
//
// Reads VENDASTA_CREDENTIALS from .env (same as the connector).
//
// Output: /tmp/vendasta-orders-audit.csv + console summary.

import fs from 'node:fs';
import crypto from 'node:crypto';

const CREDS_PATH = process.env.VENDASTA_CREDENTIALS;
const PARTNER_ID = process.env.VENDASTA_NAMESPACE || '0BYD';
const BASE = 'https://prod.apigateway.co/platform';

const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
const ap = creds.assertionPayloadData || {};
const ah = creds.assertionHeaderData || {};

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getToken(scope) {
  const now = Math.floor(Date.now() / 1000);
  const aud = ap.aud || 'https://iam-prod.apigateway.co';
  const header = { alg: 'RS256', typ: 'JWT', kid: ah.kid || creds.private_key_id };
  const payload = { aud, iss: ap.iss || creds.client_email, sub: ap.sub || creds.client_email, scope, iat: now, exp: now + 600 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256'); signer.update(signingInput); signer.end();
  const assertion = `${signingInput}.${b64url(signer.sign(creds.private_key))}`;
  const res = await fetch(creds.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

function nextCursor(j) {
  const n = j?.links?.next;
  if (!n) return null;
  const m = String(n).match(/page\[cursor\]=([^&]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function pullAllOrders() {
  const token = await getToken('order');
  const orders = [];
  let cursor = '';
  for (let pg = 0; pg < 100; pg++) {
    const q = `filter[partner.id]=${PARTNER_ID}&page[limit]=100${cursor ? `&page[cursor]=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(`${BASE}/orders?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`orders ${res.status}: ${await res.text()}`);
    const j = await res.json();
    orders.push(...(j.data || []));
    cursor = nextCursor(j);
    process.stderr.write(`\rfetched ${orders.length} orders (page ${pg + 1})...`);
    if (!cursor) break;
  }
  process.stderr.write('\n');
  return orders;
}

function getFormField(orderForms, id) {
  for (const f of (orderForms || [])) {
    for (const fld of (f.fields || [])) {
      if (fld.id === id) return String(fld.value || '').replace(/^"|"$/g, '').replace(/\\"/g, '"');
    }
  }
  return null;
}

const orders = await pullAllOrders();

// Build CSV
const rows = [];
let totalRecurringMRR = 0;
let totalOnetime = 0;
const statusCounts = {};
const suspectsByCategory = { cancelled_with_value: [], free_internal: [], stale_no_invoice_likely: [] };

for (const o of orders) {
  const a = o.attributes || {};
  const status = (a.statusCode || 'unknown').toLowerCase();
  statusCounts[status] = (statusCounts[status] || 0) + 1;
  const businessName = getFormField(a.orderForms, 'business_name') || '';
  const agid = getFormField(a.orderForms, 'business_account_group_id') ||
               o.relationships?.businessLocation?.data?.id ||
               (String(o.id).match(/^(AG-[A-Z0-9]+):/) || [])[1] || '';
  const tags = (a.tags || []).join(';');

  for (const li of (a.lineItems || [])) {
    const interval = (li.intervalCode || 'monthly').toLowerCase();
    let monthlyAmount = li.amount || 0;
    let recurring = true;
    if (interval === 'onetime' || interval === 'one-time' || interval === 'one_time') {
      recurring = false;
      totalOnetime += monthlyAmount;
    } else if (interval === 'annually' || interval === 'yearly') {
      monthlyAmount = Math.round(monthlyAmount / 12);
    }

    if (recurring) totalRecurringMRR += monthlyAmount;

    // Suspect classifiers
    let suspect = '';
    if (status !== 'fulfilled' && monthlyAmount > 0 && recurring) {
      suspect = `${status}_with_value`;
      suspectsByCategory.cancelled_with_value.push({ ord: o.id, agid, name: businessName, status, monthlyAmount, sku: li.sku, tags });
    } else if (recurring && monthlyAmount === 0) {
      suspect = 'free_zero';
    }

    rows.push({
      orderId: o.id,
      agid,
      businessName,
      status,
      tags,
      sku: li.sku || '',
      productName: li.productName || '',
      interval,
      lineAmountCents: li.amount || 0,
      monthlyMRRCents: recurring ? monthlyAmount : 0,
      onetimeCents: recurring ? 0 : monthlyAmount,
      suspect,
    });
  }
}

// Write CSV
const headers = Object.keys(rows[0] || {});
const csv = [headers.join(',')];
for (const r of rows) {
  csv.push(headers.map(h => {
    const v = r[h] ?? '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(','));
}
fs.writeFileSync('/tmp/vendasta-orders-audit.csv', csv.join('\n'));

const fmt = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log('');
console.log('VENDASTA ORDER AUDIT — partner ' + PARTNER_ID);
console.log('  Total orders:                 ' + orders.length);
console.log('  Total line items:             ' + rows.length);
console.log('');
console.log('STATUS BREAKDOWN');
for (const [s, n] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + s.padEnd(20) + ' ' + n);
}
console.log('');
console.log('SUSPECT 1: non-fulfilled orders that still have $$ counted toward MRR');
console.log('  Total suspects: ' + suspectsByCategory.cancelled_with_value.length);
const susMRR = suspectsByCategory.cancelled_with_value.reduce((s, x) => s + x.monthlyAmount, 0);
console.log('  Their summed monthly: ' + fmt(susMRR));
console.log('');
console.log('  Top 10 by amount:');
const topSuspects = suspectsByCategory.cancelled_with_value.sort((a, b) => b.monthlyAmount - a.monthlyAmount).slice(0, 10);
for (const s of topSuspects) {
  console.log('    ' + (s.name || s.agid).slice(0, 36).padEnd(36) + ' ' + fmt(s.monthlyAmount).padStart(10) + '/mo  status=' + s.status.padEnd(10) + ' tags="' + s.tags + '"');
}
console.log('');
console.log('GROSS RECURRING MRR ALL ORDERS (incl. non-fulfilled): ' + fmt(totalRecurringMRR));
console.log('TOTAL ONETIME (excluded from MRR): ' + fmt(totalOnetime));
console.log('');
console.log('CSV written to: /tmp/vendasta-orders-audit.csv');
