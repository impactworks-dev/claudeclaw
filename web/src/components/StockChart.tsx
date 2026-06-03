// Candle chart for a single ticker, with 1D/1W/1M/3M/1Y timeframe buttons.
// Mounts a TradingView Lightweight Chart imperatively into a ref'd div.
// Data comes from /api/stocks/history/:symbol?period=...
//
// Used by the Stocks tile in the Founder Dashboard when the user clicks
// a row to expand. Hot-swaps the chart in place when the timeframe
// changes; tears down and rebuilds when the symbol changes.

import { useEffect, useRef, useState } from 'preact/hooks';
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { apiGet } from '@/lib/api';

type Period = '1D' | '1W' | '1M' | '3M' | '1Y';
const PERIODS: Period[] = ['1D', '1W', '1M', '3M', '1Y'];

interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; }
interface HistoryResponse {
  symbol: string;
  period: Period;
  asOf: number;
  interval: string;
  bars: Bar[];
  error?: string;
}

interface Props {
  symbol: string;
  onClose?: () => void;
}

// Read CSS custom properties at runtime so the chart matches the theme.
// Lightweight Charts wants hex/rgb strings, not CSS variables.
function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

export function StockChart({ symbol, onClose }: Props) {
  const [period, setPeriod] = useState<Period>('1M');
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Fetch when symbol or period changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    apiGet<HistoryResponse>(`/api/stocks/history/${encodeURIComponent(symbol)}?period=${period}`)
      .then((d) => {
        if (cancelled) return;
        if (d.error) setErr(d.error);
        setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(String(e?.message || e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, period]);

  // Build/teardown chart on mount + symbol changes
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const textColor = cssVar('--color-text-muted', '#9ca3af');
    const gridColor = cssVar('--color-border', '#27272a');

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 240,
      layout: { background: { color: 'transparent' }, textColor },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      rightPriceScale: { borderColor: gridColor },
      timeScale: { borderColor: gridColor, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderUpColor: '#16a34a',
      borderDownColor: '#dc2626',
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
    });
    chartRef.current = chart;
    seriesRef.current = candles;

    // Resize on container width changes
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [symbol]);

  // Push data when the response arrives
  useEffect(() => {
    if (!seriesRef.current || !data || !data.bars.length) return;
    // Lightweight Charts wants `time` in epoch seconds. Our Bar.t is already
    // epoch seconds (from Yahoo). Sort to be safe — TradingView requires
    // strictly increasing time.
    const sorted = [...data.bars].sort((a, b) => a.t - b.t);
    seriesRef.current.setData(sorted.map(b => ({
      time: b.t as any,
      open: b.o, high: b.h, low: b.l, close: b.c,
    })));
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return (
    <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
      <div class="flex items-center justify-between mb-2">
        <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
          {symbol} · candles
        </div>
        <div class="flex items-center gap-1">
          {PERIODS.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              class={`px-1.5 py-0.5 rounded text-[10px] tabular-nums ${
                period === p
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]'
              }`}
            >
              {p}
            </button>
          ))}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              class="ml-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
              aria-label="Close chart"
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} class="w-full" style={{ height: '240px' }} />
      <div class="text-[10px] text-[var(--color-text-faint)] mt-1">
        {loading
          ? `Loading ${period} bars…`
          : err
            ? `History unavailable: ${err}`
            : data
              ? `${data.bars.length} bars · ${data.interval} interval · refreshed ${new Date(data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : ''}
      </div>
    </div>
  );
}
