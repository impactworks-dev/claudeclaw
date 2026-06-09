#!/usr/bin/env node
/**
 * Vendasta CRM MCP connector for ClaudeClaw (Nikki)
 * -------------------------------------------------
 * Zero-dependency stdio MCP server. Requires Node >= 18 (global fetch + crypto).
 *
 * Auth: Vendasta 2-legged OAuth (RFC 7523 JWT-bearer) using a service-account key.
 *   1. Build an RS256-signed JWT assertion from the downloaded credential JSON.
 *   2. POST it to token_uri to get a short-lived access token (cached in-memory).
 *   3. Call the CRM REST API with `Authorization: Bearer <token>`.
 *
 * Env:
 *   VENDASTA_CREDENTIALS  absolute path to the service-account JSON (required)
 *   VENDASTA_NAMESPACE    default namespace = PID or AGID (e.g. "0BYD")
 *   VENDASTA_BASE_URL     default "https://prod.apigateway.co/org"
 *   VENDASTA_SCOPE        default "customers"
 *   VENDASTA_AUD          override audience (default taken from credential)
 *
 * CLI: `node server.mjs --selftest` runs auth + a read-only probe and exits.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const CREDS_PATH = process.env.VENDASTA_CREDENTIALS;
const DEFAULT_NS = process.env.VENDASTA_NAMESPACE || '';
const BASE_URL = (process.env.VENDASTA_BASE_URL || 'https://prod.apigateway.co/org').replace(/\/+$/, '');
const SCOPE = process.env.VENDASTA_SCOPE || 'customers';
const USERINFO_URL = 'https://sso-api-prod.apigateway.co/oauth2/user-info';

let _creds = null;
function creds() {
  if (_creds) return _creds;
  if (!CREDS_PATH) throw new Error('VENDASTA_CREDENTIALS env var not set');
  _creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
  return _creds;
}

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- Access-token cache (JWT-bearer exchange), keyed per scope ----
const _tokens = new Map(); // scope -> { access_token, exp }
async function getAccessToken(scope = SCOPE) {
  const now = Math.floor(Date.now() / 1000);
  const cached = _tokens.get(scope);
  if (cached && cached.exp - 60 > now) return cached.access_token;
  const c = creds();
  const ap = c.assertionPayloadData || {};
  const ah = c.assertionHeaderData || {};
  const aud = process.env.VENDASTA_AUD || ap.aud || 'https://iam-prod.apigateway.co';
  const iss = ap.iss || c.client_email;
  const sub = ap.sub || c.client_email;
  const kid = ah.kid || c.private_key_id;

  const header = { alg: 'RS256', typ: 'JWT', kid };
  const payload = { aud, iss, sub, scope, iat: now, exp: now + 600 };
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
  const res = await fetch(c.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  const ttl = json.expires_in || 3600;
  _tokens.set(scope, { access_token: json.access_token, exp: now + ttl });
  return json.access_token;
}

// ---- Platform API (billing/financial) — different base + per-scope tokens ----
const PLATFORM_BASE = process.env.VENDASTA_PLATFORM_URL || 'https://prod.apigateway.co/platform';
const PARTNER_ID = () => process.env.VENDASTA_NAMESPACE || '0BYD';

async function platformGet(path, scope) {
  const token = await getAccessToken(scope);
  const res = await fetch(PLATFORM_BASE + path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) { const e = new Error(`Vendasta GET ${path} -> ${res.status}`); e.status = res.status; e.body = data; throw e; }
  return data;
}

function nextCursor(j) {
  const n = j && j.links && j.links.next;
  if (!n) return null;
  const m = String(n).match(/page\[cursor\]=([^&]*)/);
  const cur = m ? decodeURIComponent(m[1]) : null;
  return cur || null;
}

// Aggregate per-account retail (orders) + wholesale (purchases) for a partner.
// Amounts are returned in cents. retailMRR = sum of monthly line-item amounts
// (annual normalized to /12). wholesaleLifetime = all purchase line totals;
// wholesaleMonthly = purchase line totals in the trailing 31 days.
// Paginate the CRM companies endpoint and build an AGID → market-slug map.
// Vendasta tags every company with `system__company_group_id` ("pwps" =
// ImpactWorks customers, "default" = Rocket Local). The Platform API revenue
// endpoints don't carry this tag, so we join against the CRM record here.
async function fetchAgidToMarketSlug() {
  const slugByAgid = new Map();
  let cursor = '';
  for (let pg = 0; pg < 30; pg++) {  // covers ~3000 records
    const body = {
      returnFields: [
        'platform__company_account_group_id',
        'system__company_group_id',
      ],
      page: { limit: 100, ...(cursor ? { cursor } : {}) },
    };
    const j = await api('POST', `/list/${enc(ns({}))}/${enc('companies')}`, { body });
    for (const o of (j.objects || [])) {
      const flds = (o.attributes && o.attributes.fields) || o.fields || [];
      let agid = '', slug = '';
      for (const f of flds) {
        if (f.id === 'platform__company_account_group_id') agid = String(f.value || '');
        if (f.id === 'system__company_group_id') slug = String(f.value || '');
      }
      if (agid && slug) slugByAgid.set(agid, slug);
    }
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  return slugByAgid;
}

async function revenueByAccount(partnerId) {
  const acct = {};
  const ensure = (id) => (acct[id] ||= { name: null, marketSlug: null, retailMRR: 0, wholesaleLifetime: 0, wholesaleMonthly: 0 });
  const pidQ = `filter[partner.id]=${encodeURIComponent(partnerId)}`;

  // Retail — orders (scope: order)
  let cursor = '';
  for (let pg = 0; pg < 50; pg++) {
    const q = `${pidQ}&page[limit]=100${cursor ? `&page[cursor]=${encodeURIComponent(cursor)}` : ''}`;
    const j = await platformGet(`/orders?${q}`, 'order');
    for (const o of (j.data || [])) {
      const a = o.attributes || {};
      // Only count fulfilled orders toward MRR. draft / processing /
      // declined / error orders are NOT live revenue. Empirically (audit
      // 2026-06-07) these inflate MRR by ~$2,780/mo (44% of total).
      const status = String(a.statusCode || '').toLowerCase();
      if (status !== 'fulfilled') continue;
      let agid = (o.relationships && o.relationships.businessLocation && o.relationships.businessLocation.data && o.relationships.businessLocation.data.id) || null;
      let name = null;
      for (const form of (a.orderForms || [])) {
        for (const f of (form.fields || [])) {
          if (!agid && f.id === 'business_account_group_id') agid = String(f.value || '').replace(/"/g, '');
          if (f.id === 'business_name') name = String(f.value || '').replace(/"/g, '');
        }
      }
      if (!agid && o.id) { const m = String(o.id).match(/^(AG-[A-Z0-9]+):/); if (m) agid = m[1]; }
      if (!agid) continue;
      const e = ensure(agid);
      // Treat literal "null"/"undefined"/empty as no name. Some order forms
      // had those values written verbatim by upstream tooling.
      const bad = new Set(['', 'null', 'undefined', 'NULL', 'Null']);
      if (name && !bad.has(name.trim())) e.name = name;
      for (const li of (a.lineItems || [])) {
        let amt = li.amount || 0;
        const iv = (li.intervalCode || 'monthly').toLowerCase();
        // Skip one-time charges — they're install / setup fees, not MRR
        if (iv === 'onetime' || iv === 'one-time' || iv === 'one_time') continue;
        if (iv === 'annually' || iv === 'yearly') amt = Math.round(amt / 12);
        e.retailMRR += amt;
      }
    }
    cursor = nextCursor(j);
    if (!cursor) break;
  }

  // Wholesale — purchases (scope: financial)
  const monthAgo = Date.now() - 31 * 24 * 3600 * 1000;
  cursor = '';
  for (let pg = 0; pg < 50; pg++) {
    const q = `${pidQ}&page[limit]=100${cursor ? `&page[cursor]=${encodeURIComponent(cursor)}` : ''}`;
    const j = await platformGet(`/purchases?${q}`, 'financial');
    for (const p of (j.data || [])) {
      const a = p.attributes || {};
      const created = a.createdAt ? Date.parse(a.createdAt) : 0;
      for (const li of (a.lineItems || [])) {
        const cid = li.customerId;
        if (!cid || !String(cid).startsWith('AG-')) continue;
        const e = ensure(cid);
        const t = li.total || 0;
        e.wholesaleLifetime += t;
        if (created >= monthAgo) e.wholesaleMonthly += t;
      }
    }
    cursor = nextCursor(j);
    if (!cursor) break;
  }

  // Backfill names from the canonical businessLocations resource. Order forms
  // often have business_name blank (customer didn't fill it in), but every
  // AG-ID has an attributes.name on its businessLocation. We paginate the
  // full businessLocations list filtered by partner and merge names by AG-ID.
  // ~3-5 page hits for an average partner, dwarfed by orders/purchases pagination.
  try {
    let cursorBL = '';
    for (let pg = 0; pg < 50; pg++) {
      const q = `filter[businessPartner.id]=${encodeURIComponent(partnerId)}&page[limit]=200${cursorBL ? `&page[cursor]=${encodeURIComponent(cursorBL)}` : ''}`;
      const j = await platformGet(`/businessLocations?${q}`, 'business:read');
      for (const bl of (j.data || [])) {
        const blId = bl.id;
        if (!blId || !acct[blId]) continue;
        const canonicalName = bl.attributes?.name || (bl.attributes?.commonNames || [])[0] || null;
        // Canonical name always wins — overrides any name set from order forms,
        // which can be "null"/empty or stale customer-typed input.
        if (canonicalName && canonicalName.trim()) acct[blId].name = canonicalName.trim();
      }
      cursorBL = nextCursor(j);
      if (!cursorBL) break;
    }
  } catch (e) {
    // Name backfill is best-effort; don't fail the whole rollup if this errors
  }

  // Market attribution — join AGID → marketSlug from the CRM company list so
  // every revenue line carries 'pwps' (ImpactWorks) or 'default' (Rocket Local).
  try {
    const slugByAgid = await fetchAgidToMarketSlug();
    for (const id of Object.keys(acct)) {
      const slug = slugByAgid.get(id);
      if (slug) acct[id].marketSlug = slug;
    }
  } catch (e) {
    // Best effort — if CRM is down, accounts simply lack marketSlug
  }

  // Per-market aggregation: surface as `byMarket` so the downstream cleaner
  // can render the ImpactWorks vs Rocket Local split without re-walking.
  const byMarket = {};
  const ensureMarket = (slug) => (byMarket[slug] ||= {
    retailMRR: 0, wholesaleMonthly: 0, wholesaleLifetime: 0, accounts: 0, accountsWithRetail: 0,
  });
  let totRetailMRR = 0, totWholesaleMonthly = 0;
  for (const id of Object.keys(acct)) {
    const a = acct[id];
    totRetailMRR += a.retailMRR;
    totWholesaleMonthly += a.wholesaleMonthly;
    const slug = a.marketSlug || 'unknown';
    const m = ensureMarket(slug);
    m.retailMRR += a.retailMRR;
    m.wholesaleMonthly += a.wholesaleMonthly;
    m.wholesaleLifetime += a.wholesaleLifetime;
    m.accounts += 1;
    if (a.retailMRR > 0) m.accountsWithRetail += 1;
  }
  return {
    byAccount: acct,
    byMarket,
    totals: { retailMRR: totRetailMRR, wholesaleMonthly: totWholesaleMonthly, accounts: Object.keys(acct).length },
    currency: 'USD', unit: 'cents',
  };
}

// ---- Platform admin helpers — list/create/update on JSON:API endpoints ----
// Many platform resources share the same shape: paginated lists with optional
// filter[] params, a single GET-by-id, and POST/PATCH for write. These helpers
// keep the per-resource tools small.

function buildPlatformQuery(args) {
  const qs = new URLSearchParams();
  if (args.limit) qs.set('page[limit]', String(args.limit));
  if (args.cursor) qs.set('page[cursor]', args.cursor);
  if (args.filters && typeof args.filters === 'object') {
    for (const [k, v] of Object.entries(args.filters)) qs.set(`filter[${k}]`, String(v));
  }
  if (args.include) qs.set('include', args.include);
  // Auto-inject partner filter under the right key. Most endpoints use
  // `filter[partner.id]`, but some use `filter[businessPartner.id]` and
  // automations want `filter[namespace]`. Tools pass partnerFilterKey to
  // override (default 'partner.id' is fine for most).
  const partnerId = args.partnerId;
  const key = args.partnerFilterKey || 'partner.id';
  if (partnerId && key && !qs.has(`filter[${key}]`)) {
    qs.set(`filter[${key}]`, partnerId);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function platformList(resource, scope, args = {}) {
  const path = `/${resource}${buildPlatformQuery(args)}`;
  return platformGet(path, scope);
}

async function platformGetById(resource, scope, id) {
  return platformGet(`/${resource}/${enc(id)}`, scope);
}

async function platformWrite(method, resource, scope, body, id) {
  const token = await getAccessToken(scope);
  const url = id ? `${PLATFORM_BASE}/${resource}/${enc(id)}` : `${PLATFORM_BASE}/${resource}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const e = new Error(`Vendasta ${method} ${resource} -> ${res.status}`);
    e.status = res.status; e.body = data; throw e;
  }
  return data;
}

// ---- Sales opportunities (deal pipeline) — Connect/gRPC endpoint, scope sales.opportunity ----
const SALES_OPP_URL = 'https://sales-opportunities-prod.apigateway.co/salesopportunities.v1.SalesOpportunities/ListOpportunities';
async function listOpportunities(partnerId) {
  const token = await getAccessToken('sales.opportunity');
  let all = [];
  let cursor = '';
  for (let pg = 0; pg < 30; pg++) {
    const body = cursor ? { partnerId, cursor } : { partnerId };
    const res = await fetch(SALES_OPP_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) { const e = new Error(`ListOpportunities -> ${res.status}`); e.status = res.status; e.body = text.slice(0, 300); throw e; }
    const j = JSON.parse(text);
    all = all.concat(j.results || []);
    cursor = j.nextCursor;
    if (!cursor) break;
  }
  return { results: all, count: all.length };
}

// ---- Generic CRM API call ----
async function api(method, path, { query, body } = {}) {
  const token = await getAccessToken();
  let url = BASE_URL + path;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += `?${qs}`;
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(`Vendasta ${method} ${path} -> ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function ns(args) {
  const n = (args && args.namespace) || DEFAULT_NS;
  if (!n) throw new Error('namespace required: set VENDASTA_NAMESPACE or pass `namespace`');
  return n;
}
function rt(args) { return (args && args.resourceTypeCode) || 'contacts'; }
const enc = encodeURIComponent;

// ---- Tool definitions ----
const tools = [
  {
    name: 'vendasta_whoami',
    description: 'Validate Vendasta auth and return the service-account user-info. Use to confirm the connector is working.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'vendasta_list_field_schema',
    description: 'List the field schema (field ids, names, types) for a CRM resource type. Call this first to discover valid field ids before filtering or writing.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceTypeCode: { type: 'string', description: 'contacts | companies | activities (default contacts)' },
        namespace: { type: 'string', description: 'PID or AGID; defaults to configured namespace' },
      },
    },
  },
  {
    name: 'vendasta_list_field_options',
    description: 'List the allowed options for a single-select field (e.g. lifecycle stage) on a CRM resource type. Use to get the exact configured pipeline stages for this account.',
    inputSchema: {
      type: 'object',
      properties: {
        fieldId: { type: 'string', description: 'Field id, e.g. standard__company_lifecycle_stage' },
        resourceTypeCode: { type: 'string' },
        namespace: { type: 'string' },
      },
      required: ['fieldId'],
    },
  },
  {
    name: 'vendasta_revenue_by_account',
    description: 'Per-client financials for the partner: retail MRR (from orders) + wholesale monthly/lifetime cost (from purchases), keyed by account-group id (AG-...). Amounts in cents.',
    inputSchema: { type: 'object', properties: { partnerId: { type: 'string', description: 'Partner ID; defaults to configured namespace' } } },
  },
  {
    name: 'vendasta_list_opportunities',
    description: 'List sales opportunities (deals) for the partner. Returns name, accountGroupId, pipelineStage (open/closed-won/closed-lost), projectedFirstYearValue + probableFirstYearValue (cents), probability, expectedCloseDate, salesPersonId.',
    inputSchema: { type: 'object', properties: { partnerId: { type: 'string', description: 'Partner ID; defaults to configured namespace' } } },
  },
  {
    name: 'vendasta_list_records',
    description: 'List/search CRM records (contacts, companies, activities). Supports field filters, selecting return fields, and cursor pagination. Returns { objects, next_cursor, total_objects, has_more }.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceTypeCode: { type: 'string', description: 'contacts | companies | activities (default contacts)' },
        namespace: { type: 'string' },
        subtype: { type: 'string' },
        filters: {
          type: 'array',
          description: 'Filter clauses. Each: { id: fieldId, value, operation }. operation is a Vendasta filter op (e.g. EQUALS, CONTAINS).',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, value: {}, operation: { type: 'string' } },
            required: ['id', 'operation'],
          },
        },
        returnFields: { type: 'array', items: { type: 'string' }, description: 'Field ids to include in the response' },
        limit: { type: 'integer', description: 'Page size' },
        cursor: { type: 'string', description: 'Pagination cursor from a prior next_cursor' },
      },
    },
  },
  {
    name: 'vendasta_get_record',
    description: 'Get a single CRM record by id. Returns { type, id, attributes }.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        resourceTypeCode: { type: 'string' },
        namespace: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'vendasta_update_record',
    description: 'Update a single CRM record by id (WRITE). Provide `fields` as [{id, value}] to change on the record.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        fields: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, value: {} }, required: ['id', 'value'] } },
        resourceTypeCode: { type: 'string' },
        namespace: { type: 'string' },
      },
      required: ['id', 'fields'],
    },
  },
  {
    name: 'vendasta_upsert_record',
    description: 'Create or update a CRM record (WRITE). Matches existing records via `searchExisting` lookup fields (e.g. ["standard__email"]); updates the match if found, otherwise creates a new record. Provide `fields` as an array of { id, value }. Call vendasta_list_field_schema first for valid field ids. Defaults searchExisting to ["standard__email"] when an email field is present.',
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          description: 'Values to set. Each: { id: fieldId, value }.',
          items: { type: 'object', properties: { id: { type: 'string' }, value: {} }, required: ['id', 'value'] },
        },
        searchExisting: {
          type: 'array',
          items: { type: 'string' },
          description: 'Field ids used to find an existing record to update (e.g. ["standard__email"]). Match -> update; no match -> create.',
        },
        returnFields: { type: 'array', items: { type: 'string' } },
        subtype: { type: 'string' },
        resourceTypeCode: { type: 'string' },
        namespace: { type: 'string' },
      },
      required: ['fields'],
    },
  },

  // ── Platform Admin (Partner Center) — read tools ──────────────────
  // These hit the Platform API (https://prod.apigateway.co/platform) which
  // covers org-level admin: your Partner Center config, team members,
  // subscriptions, orders, automations, business taxonomy. All read tools
  // accept optional { limit, cursor, filters, partnerId } for pagination
  // and scoping. partnerId defaults to VENDASTA_NAMESPACE.

  {
    name: 'vendasta_platform_list_users',
    description: 'List admin users / team members on your Partner Center. Returns { data, links } JSON:API. Each user has roles, email, name, status.',
    inputSchema: {
      type: 'object',
      properties: {
        partnerId: { type: 'string' },
        limit: { type: 'integer' },
        cursor: { type: 'string' },
        filters: { type: 'object', description: 'JSON:API filters, e.g. { "status": "active" }' },
      },
    },
  },
  {
    name: 'vendasta_platform_list_sales_accounts',
    description: 'List sales accounts at the admin level (which sales reps / sales account groupings exist in your Partner Center).',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object' } },
    },
  },
  {
    name: 'vendasta_platform_list_subscriptions',
    description: 'List subscriptions on a single business location (customer). Required: businessLocationId (AG-...). Use vendasta_platform_list_business_locations first to find IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        businessLocationId: { type: 'string', description: 'AG-... business location ID' },
        limit: { type: 'integer' },
        cursor: { type: 'string' },
        filters: { type: 'object' },
      },
      required: ['businessLocationId'],
    },
  },
  {
    name: 'vendasta_platform_list_subscription_assignments',
    description: 'List subscription assignments on a single business location (customer). Required: businessLocationId (AG-...). Use vendasta_platform_list_business_locations first to find IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        businessLocationId: { type: 'string', description: 'AG-... business location ID' },
        limit: { type: 'integer' },
        cursor: { type: 'string' },
        filters: { type: 'object' },
      },
      required: ['businessLocationId'],
    },
  },
  {
    name: 'vendasta_platform_list_orders',
    description: 'List orders flowing through your Partner Center (retail customer orders). Returns JSON:API list with attributes incl. lineItems, orderForms, status.',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object', description: 'e.g. { "status": "pending" } or { "businessLocation.id": "AG-..." }' } },
    },
  },
  {
    name: 'vendasta_platform_list_purchases',
    description: 'List wholesale purchase records — what your Partner Center owes Vendasta. Pairs with vendasta_revenue_by_account for margin analysis.',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object' } },
    },
  },
  {
    name: 'vendasta_platform_list_activatable_products',
    description: 'List products YOUR Partner Center can activate (the catalog you have access to). Use this to see what extra products are available to add to your offering.',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object' } },
    },
  },
  {
    name: 'vendasta_platform_list_automations',
    description: 'List workflow automations configured at the Partner Center level (e.g. lifecycle emails, fulfillment triggers).',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object' } },
    },
  },
  // ── Marketing Campaigns + Email + Automation Runs (added 2026-06-09) ──
  // Surfaces Dante's outbound marketing engine into Mission Control. These
  // hit Vendasta Platform API resources whose exact paths we're probing —
  // if the API returns 404 / unknown resource, adjust the resource string.
  {
    name: 'vendasta_platform_list_campaigns',
    description: 'List marketing campaigns at the Partner Center level. Each campaign has name, status (draft/published/ongoing), tag(s), recipient counts, opens, clicks (CTOR). Use this to surface outbound marketing activity in Mission Control.',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object', description: 'e.g. { "status": "published" } or { "tag": "Partnerships" }' } },
    },
  },
  {
    name: 'vendasta_platform_get_campaign',
    description: 'Get one marketing campaign by id — includes full stats: totalRecipients, activeRecipients, emailsDelivered, openRate, ctor, steps, lastUpdated.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', description: 'Campaign id' } },
    },
  },
  {
    name: 'vendasta_platform_list_email_templates',
    description: 'List email templates available at the Partner Center level (the template library that powers campaign sends).',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object' } },
    },
  },
  {
    name: 'vendasta_platform_list_automation_runs',
    description: 'List automation execution history at the Partner Center level (which automation fired when, with what outcome). Pair with vendasta_platform_list_automations to see what each automation was configured to do.',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object', description: 'e.g. { "automationId": "..." } or { "status": "success" }' } },
    },
  },
  {
    name: 'vendasta_platform_list_business_categories',
    description: 'List the business category taxonomy (industries / verticals) available in your Partner Center.',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object' } },
    },
  },
  {
    name: 'vendasta_platform_list_business_locations',
    description: 'List business locations registered in your Partner Center (the AG-... accounts your customers represent).',
    inputSchema: {
      type: 'object',
      properties: { partnerId: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' }, filters: { type: 'object' } },
    },
  },
  // ── Platform Admin (Partner Center) — write tools ─────────────────
  // CONFIRMATION REQUIRED: Nikki MUST present the exact payload to Dante
  // and wait for explicit "yes" before invoking any of these. Modifies
  // real Partner Center state.

  {
    name: 'vendasta_platform_create_user',
    description: '(WRITE — confirm with Dante first) Create a new admin user / team member in Partner Center. Pass { attributes: { firstName, lastName, email, roles: [...] }, partnerId? }. Returns the created user.',
    inputSchema: {
      type: 'object',
      properties: {
        partnerId: { type: 'string' },
        attributes: {
          type: 'object',
          description: 'User attributes per Vendasta Platform API schema. Required at minimum: firstName, lastName, email, roles.',
        },
      },
      required: ['attributes'],
    },
  },
  {
    name: 'vendasta_platform_update_user',
    description: '(WRITE — confirm with Dante first) Update an existing admin user. Pass { id, attributes: { ... } }.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'User ID' },
        attributes: { type: 'object', description: 'Fields to change' },
        partnerId: { type: 'string' },
      },
      required: ['id', 'attributes'],
    },
  },
  {
    name: 'vendasta_platform_create_order',
    description: '(WRITE — confirm with Dante first) Create a new order in Partner Center. Pass full JSON:API order payload as { attributes, relationships }.',
    inputSchema: {
      type: 'object',
      properties: {
        partnerId: { type: 'string' },
        attributes: { type: 'object' },
        relationships: { type: 'object' },
      },
      required: ['attributes'],
    },
  },
  {
    name: 'vendasta_platform_assign_subscription',
    description: '(WRITE — confirm with Dante first) Assign a subscription to a customer (creates a subscriptionAssignment).',
    inputSchema: {
      type: 'object',
      properties: {
        partnerId: { type: 'string' },
        attributes: { type: 'object', description: 'Assignment attrs (start date, etc.)' },
        relationships: { type: 'object', description: 'Required: subscription, customer (business location).' },
      },
      required: ['relationships'],
    },
  },
  {
    name: 'vendasta_platform_unassign_subscription',
    description: '(WRITE — confirm with Dante first) Remove a subscription assignment by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Subscription Assignment ID to delete' },
        partnerId: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'vendasta_platform_activate_product',
    description: '(WRITE — confirm with Dante first) Activate a product on your Partner Center (add it to your sellable catalog). Pass { productId, partnerId? }.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        partnerId: { type: 'string' },
      },
      required: ['productId'],
    },
  },
];

async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'vendasta_whoami': {
      const token = await getAccessToken();
      const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      if (!res.ok) throw new Error(`user-info ${res.status}: ${text.slice(0, 300)}`);
      return JSON.parse(text);
    }
    case 'vendasta_list_field_schema':
      return api('GET', `/${enc(ns(args))}/${enc(rt(args))}/meta/fields`);
    case 'vendasta_list_field_options':
      return api('GET', `/${enc(ns(args))}/${enc(rt(args))}/meta/fields/${enc(args.fieldId)}/options`);
    case 'vendasta_revenue_by_account':
      return revenueByAccount(args.partnerId || PARTNER_ID());
    case 'vendasta_list_opportunities':
      return listOpportunities(args.partnerId || PARTNER_ID());
    case 'vendasta_list_records': {
      const body = {};
      if (args.subtype) body.subtype = args.subtype;
      if (args.filters) body.fields = args.filters;
      if (args.returnFields) body.returnFields = args.returnFields;
      const page = {};
      if (args.limit) page.limit = args.limit;
      if (args.cursor) page.cursor = args.cursor;
      if (Object.keys(page).length) body.page = page;
      return api('POST', `/list/${enc(ns(args))}/${enc(rt(args))}`, { body });
    }
    case 'vendasta_get_record':
      return api('GET', `/${enc(ns(args))}/${enc(rt(args))}/${enc(args.id)}`);
    case 'vendasta_update_record':
      return api('PATCH', `/${enc(ns(args))}/${enc(rt(args))}/${enc(args.id)}`, { body: { data: { fields: args.fields } } });
    case 'vendasta_upsert_record': {
      const body = { fields: args.fields };
      let se = args.searchExisting;
      if (!se) {
        const hasEmail = (args.fields || []).some((f) => f.id === 'standard__email');
        if (hasEmail) se = ['standard__email'];
      }
      if (se) body.searchExisting = se;
      if (args.returnFields) body.returnFields = args.returnFields;
      if (args.subtype) body.subtype = args.subtype;
      return api('PATCH', `/${enc(ns(args))}/${enc(rt(args))}`, { body });
    }

    // ── Platform Admin reads ─────────────────────────────────────────
    // Scopes confirmed empirically from Vendasta API 403 messages. They
    // are wildly inconsistent (some use `:read`, some bare, some `.list`)
    // so the per-endpoint mapping is a literal lookup, not a pattern.
    case 'vendasta_platform_list_users':
      return platformList('users', 'user.list', { ...args, partnerId: args.partnerId || PARTNER_ID() });
    case 'vendasta_platform_list_sales_accounts':
      return platformList('salesAccounts', 'sales.account', { ...args, partnerId: args.partnerId || PARTNER_ID(), partnerFilterKey: 'businessPartner.id' });
    case 'vendasta_platform_list_subscriptions': {
      // Per Vendasta: subscriptions are per-customer, requires businessLocation.id
      if (!args.businessLocationId) {
        throw new Error('vendasta_platform_list_subscriptions requires businessLocationId (AG-...). Use vendasta_platform_list_business_locations to find IDs.');
      }
      return platformList('subscriptions', 'sales.account', { ...args, partnerId: null, filters: { ...args.filters, 'businessLocation.id': args.businessLocationId } });
    }
    case 'vendasta_platform_list_subscription_assignments': {
      // Per Vendasta: requires filter[businessLocationId]; not a partner-wide list
      if (!args.businessLocationId) {
        throw new Error('vendasta_platform_list_subscription_assignments requires businessLocationId (AG-...). Use vendasta_platform_list_business_locations to find IDs.');
      }
      return platformList('subscriptionAssignments', 'sales.account', { ...args, partnerId: null, filters: { ...args.filters, businessLocationId: args.businessLocationId } });
    }
    case 'vendasta_platform_list_orders':
      return platformList('orders', 'order:read', { ...args, partnerId: args.partnerId || PARTNER_ID() });
    case 'vendasta_platform_list_purchases':
      return platformList('purchases', 'financial', { ...args, partnerId: args.partnerId || PARTNER_ID() });
    case 'vendasta_platform_list_activatable_products':
      return platformList('partnerActivatableProducts', 'partner:read', { ...args, partnerId: args.partnerId || PARTNER_ID() });
    case 'vendasta_platform_list_automations':
      return platformList('automations', 'automation:read', { ...args, partnerId: args.partnerId || PARTNER_ID(), partnerFilterKey: 'namespace' });
    // Vendasta Marketing Campaigns are NOT exposed via the public Partner
    // Platform REST API (confirmed 2026-06-09: docs sidebar at
    // developers.vendasta.com lists Platform/Business/CRM/Advertising/Social
    // /Customer Voice/Local SEO/Reputation/SCIM but no Marketing Campaigns
    // surface). These tools return a documented error rather than 404 noise.
    case 'vendasta_platform_list_campaigns':
    case 'vendasta_platform_get_campaign':
    case 'vendasta_platform_list_email_templates':
      return { error: 'unsupported_by_vendasta_public_api', detail: 'Marketing campaign + email template endpoints are not part of the public Partner Platform REST API. View campaigns at partners.vendasta.com/marketing/campaigns/all instead, or infer activity from CRM activities via vendasta_list_records.' };
    case 'vendasta_platform_list_automation_runs':
      // Automation runs MAY work since /automations itself does. Probe + fall back if 404.
      return platformList('automationRuns', 'automation:read', { ...args, partnerId: args.partnerId || PARTNER_ID(), partnerFilterKey: 'namespace' });
    case 'vendasta_platform_list_business_categories':
      return platformList('businessCategories', 'business', { ...args, partnerId: args.partnerId || PARTNER_ID() });
    case 'vendasta_platform_list_business_locations':
      return platformList('businessLocations', 'business:read', { ...args, partnerId: args.partnerId || PARTNER_ID(), partnerFilterKey: 'businessPartner.id' });
    // ── Platform Admin writes (Nikki MUST confirm with Dante first) ──
    case 'vendasta_platform_create_user': {
      const partnerId = args.partnerId || PARTNER_ID();
      const body = { data: { type: 'users', attributes: args.attributes, relationships: { partner: { data: { type: 'partners', id: partnerId } } } } };
      return platformWrite('POST', 'users', 'user.admin', body);
    }
    case 'vendasta_platform_update_user': {
      const body = { data: { type: 'users', id: args.id, attributes: args.attributes } };
      return platformWrite('PATCH', 'users', 'user.admin', body, args.id);
    }
    case 'vendasta_platform_create_order': {
      const partnerId = args.partnerId || PARTNER_ID();
      const relationships = args.relationships || {};
      relationships.partner = relationships.partner || { data: { type: 'partners', id: partnerId } };
      const body = { data: { type: 'orders', attributes: args.attributes, relationships } };
      return platformWrite('POST', 'orders', 'order', body);
    }
    case 'vendasta_platform_assign_subscription': {
      const partnerId = args.partnerId || PARTNER_ID();
      const relationships = args.relationships || {};
      relationships.partner = relationships.partner || { data: { type: 'partners', id: partnerId } };
      const body = { data: { type: 'subscriptionAssignments', attributes: args.attributes || {}, relationships } };
      return platformWrite('POST', 'subscriptionAssignments', 'sales.account', body);
    }
    case 'vendasta_platform_unassign_subscription':
      return platformWrite('DELETE', 'subscriptionAssignments', 'sales.account', undefined, args.id);
    case 'vendasta_platform_activate_product': {
      const partnerId = args.partnerId || PARTNER_ID();
      const body = {
        data: {
          type: 'partnerActivatableProducts',
          attributes: { activated: true },
          relationships: {
            partner: { data: { type: 'partners', id: partnerId } },
            product: { data: { type: 'products', id: args.productId } },
          },
        },
      };
      return platformWrite('POST', 'partnerActivatableProducts', 'partner', body);
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ---- Minimal MCP stdio server (JSON-RPC 2.0, newline-delimited) ----
const PROTOCOL = '2024-11-05';
function send(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'vendasta-crm', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools });
  if (method === 'tools/call') {
    const { name, arguments: a } = params || {};
    try {
      const out = await callTool(name, a);
      return ok(id, { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] });
    } catch (e) {
      const detail = e && e.body ? `${e.message}: ${JSON.stringify(e.body).slice(0, 800)}` : (e && e.message) || String(e);
      return ok(id, { content: [{ type: 'text', text: `ERROR: ${detail}` }], isError: true });
    }
  }
  if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
}

function startStdio() {
  let buf = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      Promise.resolve(handle(msg)).catch((err) => {
        if (msg && msg.id !== undefined) fail(msg.id, -32603, String((err && err.message) || err));
      });
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

async function selfTest() {
  const log = (...a) => console.error('[selftest]', ...a);
  try {
    log('Requesting access token...');
    await getAccessToken();
    log('OK: token acquired.');
    log('whoami -> (optional; needs openid/email/profile scope)');
    try {
      console.error(JSON.stringify(await callTool('vendasta_whoami', {}), null, 2));
    } catch (e) { log('whoami skipped:', (e && e.message) || String(e)); }
    log(`field schema for contacts (namespace=${DEFAULT_NS || '(unset)'}) ->`);
    try {
      const fs2 = await callTool('vendasta_list_field_schema', { resourceTypeCode: 'contacts' });
      console.error(JSON.stringify(fs2, null, 2).slice(0, 2000));
    } catch (e) { log('field schema error:', e.status, JSON.stringify(e.body || e.message).slice(0, 500)); }
    log('list contacts (limit 3) ->');
    try {
      const recs = await callTool('vendasta_list_records', { resourceTypeCode: 'contacts', limit: 3 });
      console.error(JSON.stringify(recs, null, 2).slice(0, 2500));
    } catch (e) { log('list error:', e.status, JSON.stringify(e.body || e.message).slice(0, 500)); }
  } catch (e) {
    log('FATAL:', (e && e.message) || String(e));
    process.exit(1);
  }
  process.exit(0);
}

async function cliCall() {
  const i = process.argv.indexOf('--call');
  const name = process.argv[i + 1];
  let args = {};
  try { args = JSON.parse(process.argv[i + 2] || '{}'); }
  catch { console.error('--call: second arg must be valid JSON'); process.exit(1); }
  try {
    const out = await callTool(name, args);
    const text = (typeof out === 'string' ? out : JSON.stringify(out, null, 2)) + '\n';
    // Flush before exit — process.exit(0) right after console.log truncates
    // large stdout on a pipe (~64KB), which breaks programmatic callers.
    process.stdout.write(text, () => process.exit(0));
  } catch (e) {
    process.stderr.write(`ERROR ${e.status || ''} ${JSON.stringify(e.body || e.message || String(e))}\n`, () => process.exit(1));
  }
}

if (process.argv.includes('--selftest')) selfTest();
else if (process.argv.includes('--call')) cliCall();
else startStdio();
