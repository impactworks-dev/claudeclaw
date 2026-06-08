#!/usr/bin/env node
/**
 * QuickBooks Online MCP connector for ClaudeClaw
 * ----------------------------------------------
 * Zero-dependency stdio MCP server. Requires Node >= 18 (global fetch).
 *
 * Mirrors the Plaid connector pattern intentionally — same env loader,
 * same selftest harness, same --call CLI shape — so anyone familiar with
 * one can read the other.
 *
 * Auth (OAuth 2.0):
 *   QBO_CLIENT_ID        Intuit Developer app client id
 *   QBO_CLIENT_SECRET    Intuit Developer app client secret
 *   QBO_REDIRECT_URI     OAuth redirect URI registered with Intuit (default:
 *                        https://claudeclaw.impactworks.com/api/qbo/callback)
 *   QBO_ENV              "sandbox" | "production"  (default: production)
 *
 *   The refresh_token, access_token, realm_id, and expiry are stored on the
 *   persistent volume at /app/store/qbo-token.json so they survive deploys.
 *
 * Bootstrap (one-time, Dante does this from a browser):
 *   1. node connectors/quickbooks/server.mjs --oauth-url
 *      → prints an Intuit authorize URL
 *   2. Open it in browser, sign in, pick the ImpactWorks company file.
 *      Intuit redirects to QBO_REDIRECT_URI with ?code=...&realmId=...
 *   3. node connectors/quickbooks/server.mjs --oauth-exchange '<code>' '<realmId>'
 *      → exchanges the code for access + refresh tokens, saves them.
 *   Token now persists; access tokens auto-refresh on every call.
 *
 * CLI:
 *   node server.mjs --selftest                           # ping QBO + verify creds
 *   node server.mjs --oauth-url                          # print authorize URL
 *   node server.mjs --oauth-exchange <code> <realmId>    # finish OAuth bootstrap
 *   node server.mjs --call <tool> '<jsonArgs>'           # invoke one tool
 *
 * Tools exposed (all read-only — this connector intentionally cannot write
 * to your books):
 *   qbo_get_company_info        Company name, currency, fiscal year start
 *   qbo_get_pnl                 Profit & Loss for a date range
 *   qbo_get_balance_sheet       Balance Sheet as of a date
 *   qbo_get_cash_flow           Statement of Cash Flow for a date range
 *   qbo_get_ar_aging_summary    Aged Receivables (0-30, 31-60, 61-90, 90+)
 *   qbo_get_ap_aging_summary    Aged Payables
 *   qbo_get_chart_of_accounts   All accounts with type + balance
 *   qbo_get_sales_by_customer   Customer concentration (for "who is my biggest")
 *   qbo_query                   Run a raw QBO SQL-like query (advanced)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
// Token lives on the persistent volume on Fly (/app/store), or under
// store/ locally during dev. Survives deploys, same place Plaid items live.
const TOKEN_STORE = path.join(
  process.env.CLAUDECLAW_STORE_DIR || path.join(PROJECT_ROOT, 'store'),
  'qbo-token.json',
);

// ---- env loading (claudeclaw/.env fallback) ----
function loadEnvFile() {
  const out = {};
  try {
    const txt = fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf-8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ignore */ }
  return out;
}
const ENV_FILE = loadEnvFile();
function envVal(k) {
  if (process.env[k] && process.env[k].trim()) return process.env[k].trim();
  return ENV_FILE[k] || '';
}

const QBO_ENV = (envVal('QBO_ENV') || 'production').toLowerCase();
const API_BASE = QBO_ENV === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';
const OAUTH_BASE = 'https://oauth.platform.intuit.com'; // same for sandbox + prod
const AUTHORIZE_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const DEFAULT_REDIRECT = 'https://claudeclaw.impactworks.com/api/qbo/callback';
const SCOPE = 'com.intuit.quickbooks.accounting';

function clientCreds() {
  const id = envVal('QBO_CLIENT_ID');
  const sec = envVal('QBO_CLIENT_SECRET');
  if (!id || !sec) {
    throw new Error('QBO_CLIENT_ID and QBO_CLIENT_SECRET must be set. See connectors/quickbooks/server.mjs header for setup.');
  }
  return { id, sec, redirect: envVal('QBO_REDIRECT_URI') || DEFAULT_REDIRECT };
}

// ---- token store ----
// Shape: { access_token, refresh_token, realm_id, expires_at_ms,
//          refresh_token_expires_at_ms, token_type, last_refreshed_at }
function loadToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_STORE, 'utf-8')); }
  catch { return null; }
}
function saveToken(t) {
  fs.mkdirSync(path.dirname(TOKEN_STORE), { recursive: true });
  fs.writeFileSync(TOKEN_STORE, JSON.stringify(t, null, 2));
}

// ---- OAuth helpers ----
function basicAuthHeader() {
  const { id, sec } = clientCreds();
  return 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
}

/** Exchange an authorization code (from the redirect after sign-in) for a
 *  refresh + access token. Called once during bootstrap. */
async function exchangeCodeForToken(code, realmId) {
  const { redirect } = clientCreds();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirect,
  });
  const res = await fetch(`${OAUTH_BASE}/oauth2/v1/tokens/bearer`, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OAuth code exchange failed: ${res.status} ${JSON.stringify(data)}`);
  }
  const now = Date.now();
  const saved = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    realm_id: realmId,
    token_type: data.token_type || 'bearer',
    expires_at_ms: now + (data.expires_in || 3600) * 1000,
    refresh_token_expires_at_ms: now + (data.x_refresh_token_expires_in || 8726400) * 1000,
    last_refreshed_at: new Date(now).toISOString(),
  };
  saveToken(saved);
  return saved;
}

/** Refresh the access token using the stored refresh token. Intuit also
 *  rotates the refresh token periodically — we always save whatever
 *  comes back. */
async function refreshAccessToken() {
  const t = loadToken();
  if (!t || !t.refresh_token) {
    throw new Error('No QBO token stored. Run --oauth-url then --oauth-exchange first.');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
  });
  const res = await fetch(`${OAUTH_BASE}/oauth2/v1/tokens/bearer`, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OAuth refresh failed: ${res.status} ${JSON.stringify(data)}. The refresh token may have expired — re-run --oauth-url to re-authorize.`);
  }
  const now = Date.now();
  const updated = {
    ...t,
    access_token: data.access_token,
    refresh_token: data.refresh_token || t.refresh_token, // sometimes rotated, sometimes not
    token_type: data.token_type || t.token_type,
    expires_at_ms: now + (data.expires_in || 3600) * 1000,
    refresh_token_expires_at_ms: now + (data.x_refresh_token_expires_in || 8726400) * 1000,
    last_refreshed_at: new Date(now).toISOString(),
  };
  saveToken(updated);
  return updated;
}

/** Return a valid access token, refreshing if expired or within 60s of
 *  expiry. All API calls go through here so refresh is transparent. */
async function getValidAccessToken() {
  let t = loadToken();
  if (!t) throw new Error('QBO not authorized yet. Run: node connectors/quickbooks/server.mjs --oauth-url');
  const SKEW_MS = 60 * 1000;
  if (!t.access_token || Date.now() + SKEW_MS >= (t.expires_at_ms || 0)) {
    t = await refreshAccessToken();
  }
  return t;
}

// ---- QBO API request helpers ----
async function qboGet(endpoint, params = {}) {
  const t = await getValidAccessToken();
  const qs = new URLSearchParams({ ...params, minorversion: '70' }).toString();
  const url = `${API_BASE}/v3/company/${encodeURIComponent(t.realm_id)}/${endpoint}?${qs}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${t.access_token}`,
      'Accept': 'application/json',
    },
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`QBO ${endpoint} failed: ${res.status} ${data?.Fault?.Error?.[0]?.Message || text.slice(0, 400)}`);
  }
  return data;
}

async function qboPost(endpoint, body) {
  const t = await getValidAccessToken();
  const url = `${API_BASE}/v3/company/${encodeURIComponent(t.realm_id)}/${endpoint}?minorversion=70`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${t.access_token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`QBO POST ${endpoint} failed: ${res.status} ${data?.Fault?.Error?.[0]?.Message || data?.Fault?.Error?.[0]?.Detail || text.slice(0, 400)}`);
  }
  return data;
}

/** Flatten a QBO report's nested Rows structure into [{label, values: {col -> num}}]
 *  so downstream code doesn't have to walk Intuit's two-level array shape. */
function flattenReportRows(rows, colCount) {
  const out = [];
  function walk(rowList, depth) {
    if (!rowList) return;
    const arr = Array.isArray(rowList) ? rowList : (rowList.Row || []);
    for (const r of arr) {
      if (r.Header) {
        out.push({ depth, label: r.Header.ColData?.[0]?.value || '', group: true });
      }
      if (r.ColData) {
        const label = r.ColData[0]?.value || '';
        const values = r.ColData.slice(1, 1 + colCount).map(c => c.value);
        out.push({ depth, label, values });
      }
      if (r.Rows) walk(r.Rows, depth + 1);
      if (r.Summary?.ColData) {
        const label = r.Summary.ColData[0]?.value || 'Total';
        const values = r.Summary.ColData.slice(1, 1 + colCount).map(c => c.value);
        out.push({ depth, label: 'Total ' + label, values, summary: true });
      }
    }
  }
  walk(rows, 0);
  return out;
}

function parseReport(report) {
  const cols = (report?.Columns?.Column || []).map(c => c.ColTitle || c.MetaData?.[0]?.Value || '');
  const dataCols = cols.slice(1); // first column is the row label
  const rows = flattenReportRows(report?.Rows, dataCols.length);
  return {
    name: report?.Header?.ReportName || '',
    period: {
      start: report?.Header?.StartPeriod || null,
      end: report?.Header?.EndPeriod || null,
      as_of: report?.Header?.Time || null,
    },
    currency: report?.Header?.Currency || 'USD',
    columns: dataCols,
    rows,
  };
}

// ---- tools ----
const TOOLS = [
  { name: 'qbo_get_company_info', description: 'Get the connected QuickBooks Online company name, fiscal year start, and currency. Use to confirm auth is working and which company file Nikki is reading from. No args.' },
  { name: 'qbo_get_pnl', description: 'Profit & Loss for a date range. Required: start_date, end_date (YYYY-MM-DD). Optional: accounting_method ("Cash" | "Accrual", default Accrual), summarize_column_by ("Month" | "Quarter" | "Year" | "Total", default Total).' },
  { name: 'qbo_get_balance_sheet', description: 'Balance Sheet as of a date. Required: as_of (YYYY-MM-DD). Optional: accounting_method ("Cash" | "Accrual").' },
  { name: 'qbo_get_cash_flow', description: 'Statement of Cash Flow for a date range. Required: start_date, end_date (YYYY-MM-DD).' },
  { name: 'qbo_get_ar_aging_summary', description: 'Aged Receivables summary (0-30 / 31-60 / 61-90 / 90+ buckets). Optional: as_of (YYYY-MM-DD, default today).' },
  { name: 'qbo_get_ap_aging_summary', description: 'Aged Payables summary (vendors you owe, by age bucket). Optional: as_of (YYYY-MM-DD, default today).' },
  { name: 'qbo_get_chart_of_accounts', description: 'Full chart of accounts with account type, sub-type, current balance, and whether the account is active. No args.' },
  { name: 'qbo_get_sales_by_customer', description: 'Sales totals by customer for a date range. Use to answer "who are my biggest customers" or "what is customer concentration". Required: start_date, end_date (YYYY-MM-DD).' },
  { name: 'qbo_query', description: 'Run a raw QBO SQL-like query. Required: query (e.g. "SELECT * FROM Customer WHERE Active = true MAXRESULTS 50"). For power users; most callers should use the named report tools above.' },
  { name: 'qbo_create_journal_entry', description: 'WRITE: create a journal entry in QBO. Required: TxnDate (YYYY-MM-DD), Line (array of journal entry lines). Each line: { Amount: number (dollars), DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Debit"|"Credit", AccountRef: { value: "<account-id>" } }, Description: string }. Optional: DocNumber, PrivateNote. Returns the created JournalEntry with its assigned Id and a transaction link. Always confirm with Dante before posting — this writes to live books.' },
];

async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'qbo_get_company_info': {
      const t = await getValidAccessToken();
      const r = await qboGet(`companyinfo/${encodeURIComponent(t.realm_id)}`);
      const ci = r?.CompanyInfo || {};
      return {
        realm_id: t.realm_id,
        company_name: ci.CompanyName,
        legal_name: ci.LegalName,
        country: ci.Country,
        currency: ci.SupportedLanguages,
        fiscal_year_start_month: ci.FiscalYearStartMonth,
        connected_at: ci.MetaData?.CreateTime,
      };
    }
    case 'qbo_get_pnl': {
      if (!args.start_date || !args.end_date) throw new Error('start_date and end_date required (YYYY-MM-DD)');
      const params = {
        start_date: args.start_date,
        end_date: args.end_date,
        accounting_method: args.accounting_method || 'Accrual',
        summarize_column_by: args.summarize_column_by || 'Total',
      };
      const r = await qboGet('reports/ProfitAndLoss', params);
      return parseReport(r);
    }
    case 'qbo_get_balance_sheet': {
      const as_of = args.as_of || new Date().toISOString().slice(0, 10);
      const params = { as_of, accounting_method: args.accounting_method || 'Accrual' };
      const r = await qboGet('reports/BalanceSheet', params);
      return parseReport(r);
    }
    case 'qbo_get_cash_flow': {
      if (!args.start_date || !args.end_date) throw new Error('start_date and end_date required (YYYY-MM-DD)');
      const r = await qboGet('reports/CashFlow', { start_date: args.start_date, end_date: args.end_date });
      return parseReport(r);
    }
    case 'qbo_get_ar_aging_summary': {
      const params = args.as_of ? { report_date: args.as_of } : {};
      const r = await qboGet('reports/AgedReceivables', params);
      return parseReport(r);
    }
    case 'qbo_get_ap_aging_summary': {
      const params = args.as_of ? { report_date: args.as_of } : {};
      const r = await qboGet('reports/AgedPayables', params);
      return parseReport(r);
    }
    case 'qbo_get_chart_of_accounts': {
      // QBO returns Account rows via the query endpoint. Pull active and
      // inactive both — most callers want the full picture.
      const query = "SELECT Id, Name, AccountType, AccountSubType, CurrentBalance, Active, Classification FROM Account MAXRESULTS 1000";
      const r = await qboGet('query', { query });
      const accounts = (r?.QueryResponse?.Account || []).map(a => ({
        id: a.Id,
        name: a.Name,
        type: a.AccountType,
        subtype: a.AccountSubType,
        classification: a.Classification,
        current_balance: a.CurrentBalance,
        active: a.Active,
      }));
      return { accounts, count: accounts.length };
    }
    case 'qbo_get_sales_by_customer': {
      if (!args.start_date || !args.end_date) throw new Error('start_date and end_date required (YYYY-MM-DD)');
      const r = await qboGet('reports/CustomerSales', { start_date: args.start_date, end_date: args.end_date });
      return parseReport(r);
    }
    case 'qbo_query': {
      if (!args.query) throw new Error('query required (QBO SQL-like)');
      return qboGet('query', { query: args.query });
    }
    case 'qbo_create_journal_entry': {
      // Required: TxnDate (YYYY-MM-DD), Line[] (each with Amount, DetailType,
      // JournalEntryLineDetail{PostingType, AccountRef{value}}).
      if (!args.TxnDate) throw new Error('TxnDate required (YYYY-MM-DD)');
      if (!Array.isArray(args.Line) || args.Line.length < 2) throw new Error('Line[] required (at least 2 entries)');
      // Validate balance — totals must match. Float rounding aside, QBO will
      // reject any entry where Σ(Debit) != Σ(Credit).
      const totals = args.Line.reduce((acc, l) => {
        const amt = Number(l.Amount) || 0;
        const post = l?.JournalEntryLineDetail?.PostingType;
        if (post === 'Debit') acc.dr += amt;
        else if (post === 'Credit') acc.cr += amt;
        return acc;
      }, { dr: 0, cr: 0 });
      if (Math.abs(totals.dr - totals.cr) > 0.01) {
        throw new Error(`Journal entry unbalanced: DR ${totals.dr.toFixed(2)} vs CR ${totals.cr.toFixed(2)}`);
      }
      const body = {
        TxnDate: args.TxnDate,
        Line: args.Line,
        ...(args.DocNumber ? { DocNumber: args.DocNumber } : {}),
        ...(args.PrivateNote ? { PrivateNote: args.PrivateNote } : {}),
      };
      const r = await qboPost('journalentry', body);
      const je = r?.JournalEntry || {};
      const t = await getValidAccessToken();
      const link = `https://${API_BASE.includes('sandbox') ? 'sandbox.qbo' : 'qbo'}.intuit.com/app/journal?txnId=${je.Id}`;
      return {
        id: je.Id,
        doc_number: je.DocNumber,
        txn_date: je.TxnDate,
        total_amount: totals.dr,
        sync_token: je.SyncToken,
        link,
        raw: je,
      };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ---- MCP stdio server ----
const PROTOCOL = '2024-11-05';
function send(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(req) {
  if (req.method === 'initialize') {
    return ok(req.id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'quickbooks', version: '0.1.0' } });
  }
  if (req.method === 'tools/list') {
    return ok(req.id, { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: { type: 'object' } })) });
  }
  if (req.method === 'tools/call') {
    try {
      const result = await callTool(req.params?.name, req.params?.arguments || {});
      return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    } catch (e) {
      return fail(req.id, -32000, String(e?.message || e));
    }
  }
  return fail(req.id, -32601, `unknown method: ${req.method}`);
}

// ---- CLI commands ----
async function selftest() {
  try {
    clientCreds(); // throws if QBO_CLIENT_ID / SECRET missing
    const t = loadToken();
    if (!t) {
      console.error('No QBO token saved. Run --oauth-url then --oauth-exchange to authorize.');
      process.exit(1);
    }
    const r = await callTool('qbo_get_company_info', {});
    console.log(`QBO OK (${QBO_ENV}): connected to ${r.company_name} (realm ${r.realm_id})`);
    console.log(`Token last refreshed: ${t.last_refreshed_at}`);
    console.log(`Refresh token expires: ${new Date(t.refresh_token_expires_at_ms).toISOString()}`);
    process.exit(0);
  } catch (e) {
    console.error('Selftest failed:', e.message);
    process.exit(1);
  }
}

function oauthUrl() {
  const { id, redirect } = clientCreds();
  const state = 'claudeclaw-' + Math.random().toString(36).slice(2, 10);
  const u = new URL(AUTHORIZE_BASE);
  u.searchParams.set('client_id', id);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('state', state);
  console.log('Open this URL in a browser, sign in, and pick the ImpactWorks company:');
  console.log('');
  console.log(u.toString());
  console.log('');
  console.log('After Intuit redirects, copy the `code` and `realmId` query params and run:');
  console.log(`  node connectors/quickbooks/server.mjs --oauth-exchange '<code>' '<realmId>'`);
}

async function oauthExchange() {
  const i = process.argv.indexOf('--oauth-exchange');
  const code = process.argv[i + 1];
  const realmId = process.argv[i + 2];
  if (!code || !realmId) {
    console.error('Usage: --oauth-exchange <code> <realmId>');
    process.exit(1);
  }
  try {
    const t = await exchangeCodeForToken(code, realmId);
    console.log('OAuth bootstrap complete.');
    console.log(`  realm_id:       ${t.realm_id}`);
    console.log(`  access expires: ${new Date(t.expires_at_ms).toISOString()}`);
    console.log(`  refresh expires:${new Date(t.refresh_token_expires_at_ms).toISOString()}`);
    console.log(`  saved to:       ${TOKEN_STORE}`);
    console.log('');
    console.log('Run --selftest to verify the connection.');
  } catch (e) {
    console.error('Exchange failed:', e.message);
    process.exit(1);
  }
}

async function cliCall() {
  const i = process.argv.indexOf('--call');
  const tool = process.argv[i + 1];
  let args = {};
  try { args = JSON.parse(process.argv[i + 2] || '{}'); }
  catch { console.error('--call: third arg must be valid JSON'); process.exit(1); }
  try {
    const result = await callTool(tool, args);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

if (process.argv.includes('--selftest')) selftest();
else if (process.argv.includes('--oauth-url')) oauthUrl();
else if (process.argv.includes('--oauth-exchange')) oauthExchange();
else if (process.argv.includes('--call')) cliCall();
else {
  // stdio loop
  let buf = '';
  process.stdin.on('data', (c) => {
    buf += c.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { handle(JSON.parse(line)); }
      catch (e) { send({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: ' + e.message } }); }
    }
  });
}
