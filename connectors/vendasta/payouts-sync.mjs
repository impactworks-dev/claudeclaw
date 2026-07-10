#!/usr/bin/env node
/**
 * vendasta-payouts-sync.mjs
 *
 * Polls Vendasta billing API for recent retail payouts and POSTs any new
 * ones to the Make.com webhook → "Vendasta Payout → QBO Sales Receipts" scenario.
 *
 * Auth: same JWT-bearer (RFC 7523) pattern as server.mjs.
 * Protocol: Connect JSON (same as sales-opportunities endpoint).
 * Dedup: stores sent payout IDs in store/vendasta-payouts-sent.json.
 *
 * Usage:
 *   node connectors/vendasta/payouts-sync.mjs           # dry-run (print only)
 *   node connectors/vendasta/payouts-sync.mjs --send    # actually POST to webhook
 *   node connectors/vendasta/payouts-sync.mjs --days 14 # look back 14 days (default 7)
 *
 * Env vars (loaded from .env automatically):
 *   VENDASTA_CREDENTIALS   path to service-account JSON (required)
 *   VENDASTA_NAMESPACE     partner namespace, e.g. "0BYD" (required)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ── Config ────────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Load .env manually (no dotenv dep required)
try {
  const envText = fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf-8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env optional */ }

const STORE_DIR = process.env.CLAUDECLAW_STORE_DIR
  ? path.resolve(process.env.CLAUDECLAW_STORE_DIR)
  : path.join(PROJECT_ROOT, 'store');
const DEDUP_FILE  = path.join(STORE_DIR, 'vendasta-payouts-sent.json');
const LEDGER_FILE = path.join(STORE_DIR, 'vendasta-payouts-ledger.json');
const MAKE_WEBHOOK = 'https://hook.us2.make.com/y9xeg296ff6qmg5u2hfp5d1epy8yyi9o';

// Billing endpoint — Connect JSON protocol (same pattern as sales-opportunities)
const BILLING_URL = 'https://billing-prod.apigateway.co/billing.v1.MerchantService/ListRetailPayouts';

// Market slug → QBO entity label (used by the Make router)
const MARKET_TO_ENTITY = {
  pwps: 'ImpactWorks',
  default: 'Rocket Local',
};

// Parse CLI flags
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--send');
const DAYS_BACK = parseInt(args[args.indexOf('--days') + 1] || '7', 10) || 7;
const PARTNER_NS = process.env.VENDASTA_NAMESPACE || '0BYD';

// ── JWT Auth ──────────────────────────────────────────────────────────────────
const CREDS_PATH = process.env.VENDASTA_CREDENTIALS;
if (!CREDS_PATH) throw new Error('VENDASTA_CREDENTIALS env var not set');
const CREDS = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

const _tokenCache = new Map(); // scope → { token, exp }

async function getToken(scope = 'billing') {
  const now = Math.floor(Date.now() / 1000);
  const cached = _tokenCache.get(scope);
  if (cached && cached.exp - 60 > now) return cached.token;

  const ap = CREDS.assertionPayloadData || {};
  const ah = CREDS.assertionHeaderData || {};
  const aud = ap.aud || 'https://iam-prod.apigateway.co';
  const iss = ap.iss || CREDS.client_email;
  const sub = ap.sub || CREDS.client_email;
  const kid = ah.kid || CREDS.private_key_id;

  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload = { aud, iss, sub, scope, iat: now, exp: now + 600 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = b64url(signer.sign(CREDS.private_key));
  const assertion = `${signingInput}.${signature}`;

  const tokenUri = CREDS.token_uri || ap.token_uri || 'https://iam-prod.apigateway.co/oauth2/token';
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (scope=${scope}): ${res.status} ${text.slice(0, 300)}`);
  }
  const j = await res.json();
  _tokenCache.set(scope, { token: j.access_token, exp: now + (j.expires_in || 600) });
  return j.access_token;
}

// ── Billing API ───────────────────────────────────────────────────────────────
async function listPayouts({ partnerId, startDate, endDate, cursor } = {}) {
  // Try billing scope first; fall back to financial if 403
  for (const scope of ['billing', 'financial', 'partner:read']) {
    let token;
    try { token = await getToken(scope); } catch (e) {
      console.error(`  [auth] scope=${scope} failed: ${e.message}`);
      continue;
    }

    const body = { partnerId: partnerId || PARTNER_NS };
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    if (cursor) body.cursor = cursor;

    const res = await fetch(BILLING_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (res.status === 403 || res.status === 401) {
      console.error(`  [billing] scope=${scope} -> ${res.status}, trying next scope`);
      continue;
    }
    if (!res.ok) {
      console.error(`  [billing] ${res.status}: ${text.slice(0, 400)}`);
      throw new Error(`ListRetailPayouts failed: ${res.status}`);
    }

    console.error(`  [billing] scope=${scope} -> 200 OK`);
    try {
      return JSON.parse(text);
    } catch {
      // Binary protobuf response — Connect JSON not supported on this endpoint
      console.error('  [billing] Response is binary protobuf, not JSON. Connect JSON unsupported.');
      console.error('  Raw (first 200 bytes):', Buffer.from(text).slice(0, 200).toString('hex'));
      throw new Error('Billing endpoint returned binary protobuf — JSON transcoding not available');
    }
  }
  throw new Error('All scopes exhausted. Check service account permissions for billing API.');
}

// ── Dedup ─────────────────────────────────────────────────────────────────────
function loadSent() {
  try { return new Set(JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf-8'))); }
  catch { return new Set(); }
}

function saveSent(set) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(DEDUP_FILE, JSON.stringify([...set], null, 2));
}

function appendToLedger(payout) {
  let ledger = [];
  try { ledger = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8')); } catch { /* new file */ }
  // Avoid duplicates in case of retry
  if (!ledger.find((r) => r.payout_id === payout.payout_id)) {
    ledger.push({ ...payout, recorded_at: new Date().toISOString() });
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
  }
}

// ── Payout normaliser ─────────────────────────────────────────────────────────
// Vendasta's Connect response may use camelCase protobuf field names.
// We try multiple candidate keys for each logical field.
function normalise(raw, defaultEntity = 'Rocket Local') {
  const id = raw.payoutId || raw.id || raw.payout_id;
  if (!id) return null;

  const date = raw.payoutDate || raw.date || raw.payout_date || '';
  // Amount fields: Vendasta might return cents (integer) or decimal strings
  const toCents = (v) => {
    if (v == null) return 0;
    if (typeof v === 'object' && v.units != null) return Number(v.units) * 100 + (Number(v.nanos || 0) / 1e7);
    return Math.round(parseFloat(v) * 100);
  };
  const grossCents = toCents(raw.grossAmount ?? raw.gross_amount ?? raw.amount);
  const feeCents   = toCents(raw.processingFee ?? raw.processing_fee ?? raw.fee ?? 0);
  const netCents   = toCents(raw.netAmount ?? raw.net_amount ?? (grossCents - feeCents));

  // Entity: derive from market slug if present, otherwise use default
  const slug = raw.marketSlug || raw.market_slug || raw.market || '';
  const entity = MARKET_TO_ENTITY[slug] || defaultEntity;

  // Client name
  const clientName = raw.clientName || raw.client_name || raw.accountName || raw.name || 'Unknown';

  return {
    payout_id: id,
    payout_date: date.slice(0, 10), // YYYY-MM-DD
    client_name: clientName,
    gross_amount: grossCents / 100,
    processing_fee: feeCents / 100,
    net_amount: netCents / 100,
    entity,
    _raw_slug: slug || '(none)',
  };
}

// ── Make webhook ──────────────────────────────────────────────────────────────
async function postToWebhook(payout) {
  const res = await fetch(MAKE_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payout),
  });
  if (!res.ok) throw new Error(`Webhook POST failed: ${res.status} ${await res.text()}`);
  return res.text();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nVendasta Payouts Sync`);
  console.log(`  Look-back: ${DAYS_BACK} days | Mode: ${DRY_RUN ? 'DRY RUN (pass --send to post)' : 'LIVE'}`);
  console.log(`  Webhook: ${MAKE_WEBHOOK}`);
  console.log('');

  // Date range
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - DAYS_BACK);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);
  console.log(`  Date range: ${startDate} → ${endDate}`);

  // Fetch payouts
  let rawResponse;
  try {
    rawResponse = await listPayouts({ startDate, endDate });
  } catch (err) {
    console.error('\n[FATAL]', err.message);
    console.error('\nThis likely means one of:');
    console.error('  1. The billing API uses binary protobuf (not JSON transcoding)');
    console.error('  2. The service account lacks billing scope — contact Vendasta support');
    console.error('  3. A different scope name is needed (try checking Vendasta API docs)');
    process.exit(1);
  }

  console.log('\nRaw API response:');
  console.log(JSON.stringify(rawResponse, null, 2).slice(0, 2000));

  const rawPayouts = rawResponse.payouts || rawResponse.results || rawResponse.items || [];
  if (!rawPayouts.length) {
    console.log(`\nNo payouts returned for date range.`);
    return;
  }

  // Normalise
  const payouts = rawPayouts.map((r) => normalise(r)).filter(Boolean);
  console.log(`\nFound ${payouts.length} payouts:`);
  for (const p of payouts) {
    console.log(`  ${p.payout_id} | ${p.payout_date} | ${p.entity} | net $${p.net_amount.toFixed(2)} | slug: ${p._raw_slug}`);
  }

  // Dedup
  const sent = loadSent();
  const toSend = payouts.filter((p) => !sent.has(p.payout_id));
  const alreadySent = payouts.length - toSend.length;
  console.log(`\n  Already sent: ${alreadySent} | New to send: ${toSend.length}`);

  if (!toSend.length) {
    console.log('  Nothing new to send.');
    return;
  }

  // Send
  for (const payout of toSend) {
    const { _raw_slug, ...payload } = payout;
    if (DRY_RUN) {
      console.log(`\n[DRY RUN] Would POST: ${JSON.stringify(payload)}`);
    } else {
      process.stdout.write(`  Posting ${payout.payout_id}... `);
      const reply = await postToWebhook(payload);
      console.log(`OK (${reply})`);
      sent.add(payout.payout_id);
      saveSent(sent);
      appendToLedger(payload);
    }
  }

  if (!DRY_RUN) {
    console.log(`\nDone. ${toSend.length} payout(s) posted to Make webhook.`);
  } else {
    console.log(`\nDry run complete. Run with --send to post.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
