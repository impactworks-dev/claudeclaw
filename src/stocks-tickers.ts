// Persistent stocks watchlist.
//
// The list of tickers lives on the Fly volume so edits survive deploys
// and are not lost when Dante swaps STOCK_TICKERS Fly secrets. Falls back
// to STOCK_TICKERS env var (legacy), then to a hardcoded default set.
//
// File location: /app/store/stocks-tickers.json
// Format: { "tickers": ["NVDA", "MSFT", ...] }

import fs from 'node:fs';
import path from 'node:path';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const FILE = path.join(STORE_DIR, 'stocks-tickers.json');

const DEFAULTS = ['NVDA', 'MSFT', 'GOOGL', 'META', 'AAPL', 'AMZN', 'TSLA', 'PLTR'];

// Lightly validate a ticker: 1-6 letters/digits/dots/dashes, uppercase normalize.
const TICKER_RE = /^[A-Z0-9.\-]{1,6}$/;

function envTickers(): string[] | null {
  const env = process.env.STOCK_TICKERS;
  if (!env || !env.trim()) return null;
  const list = env.split(',').map(s => s.trim().toUpperCase()).filter(t => TICKER_RE.test(t));
  return list.length ? list : null;
}

interface Storage { tickers: string[] }

function readFile(): Storage | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    if (Array.isArray(parsed?.tickers)) {
      const cleaned = (parsed.tickers as unknown[])
        .map(t => String(t || '').trim().toUpperCase())
        .filter(t => TICKER_RE.test(t));
      return { tickers: cleaned };
    }
  } catch (e) {
    logger.warn({ err: String((e as Error)?.message || e) }, 'stocks-tickers: read failed');
  }
  return null;
}

function writeFile(data: Storage): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.error({ err: String((e as Error)?.message || e) }, 'stocks-tickers: write failed');
    throw e;
  }
}

/**
 * Get the active watchlist.
 * Priority: persisted file → STOCK_TICKERS env var → DEFAULTS.
 * The first call after a fresh deploy will seed the file from env/defaults
 * so subsequent edits land in the file (not the env), giving us a single
 * source of truth.
 */
export function loadTickers(): string[] {
  const fromFile = readFile();
  if (fromFile && fromFile.tickers.length) return fromFile.tickers;

  const fromEnv = envTickers();
  const seed = fromEnv ?? DEFAULTS;
  // Seed the file so the UI can edit going forward.
  try { writeFile({ tickers: seed }); } catch { /* non-fatal */ }
  return seed;
}

export function addTicker(symbol: string): { ok: boolean; tickers: string[]; reason?: string } {
  const clean = String(symbol || '').trim().toUpperCase();
  if (!TICKER_RE.test(clean)) {
    return { ok: false, tickers: loadTickers(), reason: 'Invalid symbol. Use 1-6 letters/digits.' };
  }
  const current = loadTickers();
  if (current.includes(clean)) {
    return { ok: false, tickers: current, reason: `${clean} is already in the list.` };
  }
  if (current.length >= 30) {
    return { ok: false, tickers: current, reason: 'Watchlist cap is 30 tickers.' };
  }
  const next = [...current, clean];
  writeFile({ tickers: next });
  return { ok: true, tickers: next };
}

export function removeTicker(symbol: string): { ok: boolean; tickers: string[]; reason?: string } {
  const clean = String(symbol || '').trim().toUpperCase();
  const current = loadTickers();
  const next = current.filter(t => t !== clean);
  if (next.length === current.length) {
    return { ok: false, tickers: current, reason: `${clean} is not in the list.` };
  }
  writeFile({ tickers: next });
  return { ok: true, tickers: next };
}

/** Replace the entire list. Used by future bulk-edit UI. */
export function setTickers(tickers: string[]): { ok: boolean; tickers: string[]; reason?: string } {
  const cleaned = [...new Set(tickers.map(t => String(t).trim().toUpperCase()))]
    .filter(t => TICKER_RE.test(t));
  if (!cleaned.length) {
    return { ok: false, tickers: loadTickers(), reason: 'Need at least one valid ticker.' };
  }
  if (cleaned.length > 30) {
    return { ok: false, tickers: loadTickers(), reason: 'Cap is 30 tickers.' };
  }
  writeFile({ tickers: cleaned });
  return { ok: true, tickers: cleaned };
}
