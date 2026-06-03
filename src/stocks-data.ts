// Stocks watchlist data layer.
//
// Pulls quotes from Stooq's free public CSV endpoint. One HTTP call
// fetches all tickers at once, no auth, no API key, no rate-limiting
// issues from datacenter IPs (Yahoo Finance throttles Fly's outbound
// IPs hard — 429s every request — so we route around it).
//
// Quotes are EOD or ~15min delayed during market hours, which is fine
// for a founder-dashboard sidebar where we care about the day's move,
// not tick-by-tick precision.
//
// Cache: 5 minutes on the persistent volume.
//
// Default tickers can be overridden by setting STOCK_TICKERS=NVDA,AAPL,...
// in /app/.env (Fly secret). Per Dante: defaults until told otherwise.

import path from 'node:path';
import fs from 'node:fs';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const CACHE_FILE = path.join(STORE_DIR, 'stocks-cache.json');
const TTL_MS = 5 * 60 * 1000;

const DEFAULT_TICKERS = ['NVDA', 'MSFT', 'GOOGL', 'META', 'AAPL', 'AMZN', 'TSLA', 'PLTR'];

export interface StockQuote {
  symbol: string;
  shortName: string | null;
  price: number | null;
  previousClose: number | null;
  changeAbs: number | null;       // price - previousClose
  changePct: number | null;       // (price - previousClose) / previousClose * 100
  currency: string | null;
  marketState: string | null;     // REGULAR | PRE | POST | CLOSED
  error?: string;
}

export interface StocksSummary {
  asOf: number;
  tickers: string[];
  quotes: StockQuote[];
}

function readCache(): StocksSummary | null {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - j.asOf < TTL_MS) return j;
  } catch { /* ignore */ }
  return null;
}

function writeCache(data: StocksSummary): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'stocks: cache write failed');
  }
}

function getTickerList(): string[] {
  const env = process.env.STOCK_TICKERS;
  if (env && env.trim()) {
    return env.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  return DEFAULT_TICKERS;
}

// Stooq returns CSV with header row. Fields requested via the `f=` param:
//   s = symbol, d2 = date, t2 = time, o/h/l/c = OHLC, v = volume,
//   n = name, p = previous close.
// Sample response:
//   Symbol,Date,Time,Open,High,Low,Close,Volume,Name,PrevClose
//   NVDA.US,2026-06-03,15:30:00,1234.50,1245.00,1230.00,1240.75,1234567,NVIDIA Corp,1200.00
//
// "N/D" appears for missing fields (e.g. after-hours when intraday data
// isn't ready). We treat any non-numeric value as null.

function parseStooqNum(s: string | undefined): number | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed || trimmed === 'N/D' || trimmed.toUpperCase() === 'N/A') return null;
  const n = parseFloat(trimmed);
  return isFinite(n) ? n : null;
}

function parseStooqCsv(csv: string): Record<string, Partial<StockQuote>> {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return {};
  const header = lines[0].split(',').map(h => h.trim());
  const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iSym = idx('Symbol');
  const iClose = idx('Close');
  const iPrev = idx('PrevClose');
  const iName = idx('Name');

  const out: Record<string, Partial<StockQuote>> = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const stooqSym = cols[iSym]?.trim() || '';
    if (!stooqSym) continue;
    // Strip the `.US` suffix to match user-facing ticker
    const sym = stooqSym.replace(/\.US$/i, '').toUpperCase();
    const price = parseStooqNum(cols[iClose]);
    const prev = parseStooqNum(cols[iPrev]);
    const changeAbs = (price != null && prev != null) ? +(price - prev).toFixed(4) : null;
    const changePct = (price != null && prev != null && prev !== 0) ? +(((price - prev) / prev) * 100).toFixed(2) : null;
    out[sym] = {
      symbol: sym,
      shortName: (iName >= 0 ? cols[iName]?.trim() : null) || null,
      price,
      previousClose: prev,
      changeAbs,
      changePct,
      currency: 'USD',
      marketState: null,
    };
  }
  return out;
}

export async function getStocksData(opts: { force?: boolean } = {}): Promise<StocksSummary> {
  if (!opts.force) {
    const c = readCache();
    if (c) return c;
  }
  const tickers = getTickerList();

  // Stooq multi-ticker URL: all symbols, lowercase, .us suffix, comma-joined.
  // f=sd2t2ohlcvnp requests Symbol,Date,Time,OHLC,Volume,Name,PrevClose.
  // h header line, e=csv format.
  const symParam = tickers.map(t => t.toLowerCase() + '.us').join(',');
  const url = `https://stooq.com/q/l/?s=${symParam}&f=sd2t2ohlcvnp&h&e=csv`;

  let parsed: Record<string, Partial<StockQuote>> = {};
  let fetchError: string | null = null;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept': 'text/csv, */*',
      },
    });
    if (!r.ok) {
      fetchError = `HTTP ${r.status}`;
    } else {
      const csv = await r.text();
      parsed = parseStooqCsv(csv);
    }
  } catch (e) {
    fetchError = String((e as Error)?.message || e);
  }

  // Assemble in the requested ticker order. Tickers we couldn't fetch get
  // an error stub so the UI shows them with a "—" rather than dropping.
  const quotes: StockQuote[] = tickers.map(t => {
    const p = parsed[t.toUpperCase()];
    if (p && p.price != null) {
      return {
        symbol: p.symbol || t,
        shortName: p.shortName || null,
        price: p.price ?? null,
        previousClose: p.previousClose ?? null,
        changeAbs: p.changeAbs ?? null,
        changePct: p.changePct ?? null,
        currency: p.currency || 'USD',
        marketState: p.marketState || null,
      };
    }
    return {
      symbol: t,
      shortName: null,
      price: null,
      previousClose: null,
      changeAbs: null,
      changePct: null,
      currency: null,
      marketState: null,
      error: fetchError || 'no data in feed',
    };
  });

  const result: StocksSummary = { asOf: Date.now(), tickers, quotes };

  // Don't write a totally-broken result to cache (would lock us out for 5min).
  const anyGood = quotes.some(q => q.price != null);
  if (anyGood) writeCache(result);
  return result;
}
