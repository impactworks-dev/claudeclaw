#!/usr/bin/env node
/**
 * Extract wholesale pricing per SKU from Vendasta purchases endpoint.
 * Paginates all purchases for partner 0BYD and builds a map of SKU -> unitAmount.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const CREDS_PATH = '/Users/dantecrescenzi/claudeclaw/secrets/vendasta-nikki-service-account.json';
const PLATFORM_BASE = 'https://prod.apigateway.co/platform';
const PARTNER_ID = '0BYD';

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let _token = null;
let _tokenExp = 0;
async function getToken(scope = 'financial') {
  const now = Math.floor(Date.now() / 1000);
  if (_token && _tokenExp - 60 > now) return _token;
  const c = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
  const ap = c.assertionPayloadData || {};
  const ah = c.assertionHeaderData || {};
  const aud = ap.aud || 'https://iam-prod.apigateway.co';
  const header = { alg: 'RS256', typ: 'JWT', kid: ah.kid || c.private_key_id };
  const payload = { aud, iss: ap.iss || c.client_email, sub: ap.sub || c.client_email, scope, iat: now, exp: now + 600 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = b64url(signer.sign(c.private_key));
  const assertion = `${signingInput}.${sig}`;
  const res = await fetch(c.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const j = JSON.parse(await res.text());
  _token = j.access_token;
  _tokenExp = now + (j.expires_in || 3600);
  return _token;
}

async function fetchPage(cursor) {
  const token = await getToken('financial');
  let url = `${PLATFORM_BASE}/purchases?filter[partner.id]=${PARTNER_ID}&page[limit]=100`;
  if (cursor) url += `&page[cursor]=${encodeURIComponent(cursor)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  return JSON.parse(await res.text());
}

async function main() {
  const skuMap = {}; // sku -> { unitAmounts: Set, maxUnitAmount, count }
  let cursor = '';
  let pages = 0;
  let totalLineItems = 0;

  console.error('Paginating purchases...');
  while (true) {
    const j = await fetchPage(cursor);
    pages++;
    for (const purchase of (j.data || [])) {
      for (const li of (purchase.attributes?.lineItems || [])) {
        if (!li.sku) continue;
        totalLineItems++;
        const sku = li.sku;
        if (!skuMap[sku]) skuMap[sku] = { unitAmounts: new Set(), count: 0 };
        if (li.unitAmount > 0) skuMap[sku].unitAmounts.add(li.unitAmount);
        skuMap[sku].count++;
      }
    }

    // Get next cursor from links.next
    const nextUrl = j.links?.next;
    if (!nextUrl) break;
    const m = nextUrl.match(/page\[cursor\]=([^&]*)/);
    cursor = m ? decodeURIComponent(m[1]) : null;
    if (!cursor) break;
    if (pages >= 200) { console.error('Hit 200-page limit'); break; }
    process.stderr.write(`  page ${pages}, ${Object.keys(skuMap).length} unique SKUs so far...\r`);
  }

  console.error(`\nDone. ${pages} pages, ${totalLineItems} line items, ${Object.keys(skuMap).length} unique SKUs.`);

  // Output as JSON
  const result = {};
  for (const [sku, data] of Object.entries(skuMap)) {
    const amounts = [...data.unitAmounts].sort((a, b) => a - b);
    result[sku] = {
      unitAmountCents: amounts.length > 0 ? amounts[0] : 0, // min non-zero amount
      allAmounts: amounts,
      activeCount: data.count,
    };
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
