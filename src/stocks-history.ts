// Stock price history (OHLC) for the candle chart on the Founder
// Dashboard stocks tile.
//
// Source: Yahoo Finance v8 chart endpoint. We bind a single URL per call
// (one ticker, one period) rather than burst-fetching all tickers, so
// Yahoo's edge throttle (which 429s us on parallel quote bursts) doesn't
// fire on history requests. If a 429 does come back we surface it
// gracefully — the chart shows "history unavailable" and the page
// continues to work.
//
// Cache: 15 minutes per (symbol, period) on the Fly volume. Daily bars
// don't move intraday and even 5-min intraday bars from earlier today
// are stable. ?force=1 bypasses.

import fs from 'node:fs';
import path from 'node:path';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const CACHE_DIR = path.join(STORE_DIR, 'stocks-history');
const TTL_MS = 15 * 60 * 1000;

export type Period = '1D' | '1W' | '1M' | '3M' | '1Y';

export interface Bar {
  t: number;   // epoch seconds (UTC) — TradingView Lightweight Charts uses this format
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface HistorySummary {
  symbol: string;
  period: Period;
  asOf: number;
  interval: string;       // '5m' | '15m' | '1d'
  currency: string | null;
  bars: Bar[];
  error?: string;
}

// Yahoo chart endpoint mapping per period.
//   interval: bar resolution
//   range: how far back
// 1D uses 5min intraday, 1W uses 15min (or daily if intraday capped),
// 1M+ use daily bars — gives a nice candle density without huge payloads.
const PARAMS: Record<Period, { interval: string; range: string }> = {
  '1D': { interval: '5m',  range: '1d' },
  '1W': { interval: '15m', range: '5d' },
  '1M': { interval: '1d',  range: '1mo' },
  '3M': { interval: '1d',  range: '3mo' },
  '1Y': { interval: '1d',  range: '1y' },
};

function cacheFile(symbol: string, period: Period): string {
  return path.join(CACHE_DIR, `${symbol.toUpperCase()}_${period}.json`);
}

function readCache(symbol: string, period: Period): HistorySummary | null {
  try {
    const file = cacheFile(symbol, period);
    if (!fs.existsSync(file)) return null;
    const j = JSON.parse(fs.readFileSync(file, 'utf-8')) as HistorySummary;
    if (Date.now() - j.asOf < TTL_MS) return j;
  } catch { /* ignore */ }
  return null;
}
function writeCache(data: HistorySummary): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile(data.symbol, data.period), JSON.stringify(data));
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'stocks-history: cache write failed');
  }
}

export async function getStockHistory(opts: { symbol: string; period: Period; force?: boolean }): Promise<HistorySummary> {
  const symbol = String(opts.symbol || '').trim().toUpperCase();
  if (!symbol) {
    return { symbol, period: opts.period, asOf: Date.now(), interval: '', currency: null, bars: [], error: 'No symbol provided' };
  }

  if (!opts.force) {
    const c = readCache(symbol, opts.period);
    if (c) return c;
  }

  const { interval, range } = PARAMS[opts.period];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;

  try {
    const r = await fetch(url, {
      headers: {
        // Browser-shape UA — Yahoo refuses default node UA.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Accept': 'application/json',
      },
    });
    if (!r.ok) {
      const err = `HTTP ${r.status}${r.status === 429 ? ' (rate-limited)' : ''}`;
      return { symbol, period: opts.period, asOf: Date.now(), interval, currency: null, bars: [], error: err };
    }
    const j: any = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) {
      return { symbol, period: opts.period, asOf: Date.now(), interval, currency: null, bars: [], error: 'no chart in response' };
    }
    const ts: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens: (number | null)[] = quote.open || [];
    const highs: (number | null)[] = quote.high || [];
    const lows:  (number | null)[] = quote.low  || [];
    const closes:(number | null)[] = quote.close|| [];
    const vols:  (number | null)[] = quote.volume || [];

    const bars: Bar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
      // Yahoo nulls out bars during gaps (e.g. market close); skip them.
      if (o == null || h == null || l == null || c == null) continue;
      bars.push({
        t: ts[i],
        o, h, l, c,
        v: typeof vols[i] === 'number' ? (vols[i] as number) : 0,
      });
    }

    const summary: HistorySummary = {
      symbol,
      period: opts.period,
      asOf: Date.now(),
      interval,
      currency: result.meta?.currency || null,
      bars,
    };
    writeCache(summary);
    return summary;
  } catch (e) {
    return { symbol, period: opts.period, asOf: Date.now(), interval, currency: null, bars: [], error: String((e as Error)?.message || e) };
  }
}
