// Stock price history (OHLC) for the candle chart on the Founder
// Dashboard stocks tile.
//
// Source: Twelvedata REST API. Yahoo Finance returns HTTP 429 from
// Fly's outbound IPs; Stooq's free historical CSV requires a per-symbol
// captcha. Twelvedata is the practical free option — 800 requests/day
// on the free tier, more than enough for one dashboard with aggressive
// per-(symbol, period) caching.
//
// Auth: TWELVEDATA_API_KEY env var (Fly secret).
// Cache: 15 minutes per (symbol, period) on the Fly volume.

import fs from 'node:fs';
import path from 'node:path';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const CACHE_DIR = path.join(STORE_DIR, 'stocks-history');
const TTL_MS = 15 * 60 * 1000;

export type Period = '1D' | '1W' | '1M' | '3M' | '1Y';

export interface Bar {
  t: number;   // epoch seconds (UTC) — TradingView Lightweight Charts format
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
  interval: string;       // '5min' | '15min' | '1day'
  currency: string | null;
  bars: Bar[];
  error?: string;
}

// Twelvedata interval + output size per period.
//   1D: 5min × ~78 bars (one US trading day)
//   1W: 15min × 5 sessions worth (~140 bars; Twelvedata caps at the actual count)
//   1M-1Y: daily bars
const PARAMS: Record<Period, { interval: string; outputsize: number }> = {
  '1D': { interval: '5min',  outputsize: 78  },
  '1W': { interval: '15min', outputsize: 140 },
  '1M': { interval: '1day',  outputsize: 30  },
  '3M': { interval: '1day',  outputsize: 90  },
  '1Y': { interval: '1day',  outputsize: 252 },
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

// Twelvedata returns datetimes as either 'YYYY-MM-DD' (daily) or
// 'YYYY-MM-DD HH:MM:SS' (intraday, US/Eastern). We treat intraday as
// local-to-Eastern but parse as UTC for the epoch — fine for chart
// display since the relative ordering and spacing are preserved.
function parseTd(ts: string): number {
  // Replace space with T so Date.parse interprets as ISO-ish
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
  // Treat as UTC if no timezone info present
  const withZ = /[+\-Z]/.test(iso.slice(10)) ? iso : iso + 'Z';
  const ms = Date.parse(withZ);
  return Math.floor(ms / 1000);
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

  const apikey = process.env.TWELVEDATA_API_KEY;
  if (!apikey) {
    return { symbol, period: opts.period, asOf: Date.now(), interval: '', currency: null, bars: [], error: 'TWELVEDATA_API_KEY not set' };
  }

  const { interval, outputsize } = PARAMS[opts.period];
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${apikey}&format=JSON`;

  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) {
      return { symbol, period: opts.period, asOf: Date.now(), interval, currency: null, bars: [], error: `HTTP ${r.status}` };
    }
    const j: any = await r.json();
    // Twelvedata error shape: { code, status: "error", message }
    if (j?.status === 'error') {
      return { symbol, period: opts.period, asOf: Date.now(), interval, currency: null, bars: [], error: String(j.message || `code ${j.code}`) };
    }
    const values: any[] = j?.values || [];
    if (!values.length) {
      return { symbol, period: opts.period, asOf: Date.now(), interval, currency: j?.meta?.currency || null, bars: [], error: 'no bars in response' };
    }
    // Twelvedata returns NEWEST first. Lightweight Charts wants OLDEST first.
    const bars: Bar[] = values
      .map(v => ({
        t: parseTd(v.datetime),
        o: parseFloat(v.open),
        h: parseFloat(v.high),
        l: parseFloat(v.low),
        c: parseFloat(v.close),
        v: v.volume != null ? parseFloat(v.volume) : 0,
      }))
      .filter(b => Number.isFinite(b.t) && Number.isFinite(b.o) && Number.isFinite(b.c))
      .sort((a, b) => a.t - b.t);

    const summary: HistorySummary = {
      symbol,
      period: opts.period,
      asOf: Date.now(),
      interval,
      currency: j?.meta?.currency || null,
      bars,
    };
    writeCache(summary);
    return summary;
  } catch (e) {
    return { symbol, period: opts.period, asOf: Date.now(), interval, currency: null, bars: [], error: String((e as Error)?.message || e) };
  }
}
