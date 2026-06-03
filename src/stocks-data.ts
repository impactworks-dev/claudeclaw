// Stocks watchlist data layer.
//
// Pulls live quotes from Yahoo Finance's v8 chart endpoint. No API key
// required — it's the public endpoint that powers the consumer Yahoo
// Finance site. We hit one URL per ticker in parallel.
//
// Cache: 5 minutes on the persistent volume. Quotes do move intraday so
// keep it tight but not so tight that a dashboard refresh blasts Yahoo
// on every click.
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

async function fetchOne(symbol: string): Promise<StockQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  try {
    const r = await fetch(url, {
      headers: {
        // Yahoo's edge sometimes blocks default node UA. Pose as a browser.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept': 'application/json',
      },
    });
    if (!r.ok) {
      return { symbol, shortName: null, price: null, previousClose: null, changeAbs: null, changePct: null, currency: null, marketState: null, error: `HTTP ${r.status}` };
    }
    const j: any = await r.json();
    const result = j?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) {
      return { symbol, shortName: null, price: null, previousClose: null, changeAbs: null, changePct: null, currency: null, marketState: null, error: 'no meta in response' };
    }
    const price: number | null = (typeof meta.regularMarketPrice === 'number') ? meta.regularMarketPrice : null;
    const prev: number | null = (typeof meta.chartPreviousClose === 'number') ? meta.chartPreviousClose
      : (typeof meta.previousClose === 'number') ? meta.previousClose : null;
    const changeAbs = (price != null && prev != null) ? +(price - prev).toFixed(4) : null;
    const changePct = (price != null && prev != null && prev !== 0) ? +(((price - prev) / prev) * 100).toFixed(2) : null;
    return {
      symbol: meta.symbol || symbol,
      shortName: meta.shortName || meta.longName || null,
      price,
      previousClose: prev,
      changeAbs,
      changePct,
      currency: meta.currency || null,
      marketState: meta.marketState || null,
    };
  } catch (e) {
    return { symbol, shortName: null, price: null, previousClose: null, changeAbs: null, changePct: null, currency: null, marketState: null, error: String((e as Error)?.message || e) };
  }
}

// Sleep helper for serialized fetch (Yahoo throttles aggressive parallelism).
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function getStocksData(opts: { force?: boolean } = {}): Promise<StocksSummary> {
  if (!opts.force) {
    const c = readCache();
    if (c) return c;
  }
  const tickers = getTickerList();
  // Serialize the fetches with a small jitter — Yahoo's edge returns
  // HTTP 429 on bursts of 8+ parallel requests to the chart endpoint.
  // 150ms gap × 8 tickers = ~1.2s end-to-end, which is fine since we
  // cache for 5min. One quick retry on 429 with a short backoff.
  const quotes: StockQuote[] = [];
  for (const t of tickers) {
    let q = await fetchOne(t);
    if (q.error && q.error.includes('429')) {
      await sleep(800);
      q = await fetchOne(t);
    }
    quotes.push(q);
    await sleep(150);
  }
  const result: StocksSummary = { asOf: Date.now(), tickers, quotes };

  // Don't write a totally-broken result to cache (would lock us out for 5min).
  // If at least one quote succeeded, cache it; otherwise let the next call retry.
  const anyGood = quotes.some(q => q.price != null);
  if (anyGood) writeCache(result);
  return result;
}
