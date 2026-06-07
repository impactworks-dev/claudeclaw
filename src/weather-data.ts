// Weather data layer for the daily-brief hero card.
//
// Pulls current conditions + 24h forecast from Open-Meteo (free, no key,
// no rate-limiting from datacenter IPs). Caches keyed by (lat,lon) rounded
// to 2 decimal places (~1km) for 10 minutes on the persistent volume.
//
// Location resolution priority:
//   1. Cloudflare Managed Transform headers: cf-iplatitude / cf-iplongitude /
//      cf-ipcity / cf-ipregion / cf-ipcountry (visible to the origin when
//      "Add visitor location headers" is on in CF dash). These move with the
//      user's IP — VPN switch, travel, etc. all update automatically.
//   2. Static fallback to Oakville, Ontario (Dante's location).
//
// We never log or persist the visitor's IP — only the rounded coords.

import path from 'node:path';
import fs from 'node:fs';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const CACHE_FILE = path.join(STORE_DIR, 'weather-cache.json');
const TTL_MS = 10 * 60 * 1000;
const OAKVILLE: WeatherLocation = {
  lat: 43.45,
  lon: -79.68,
  city: 'Oakville',
  region: 'Ontario',
  country: 'CA',
  timezone: 'America/Toronto',
};

export interface WeatherLocation {
  lat: number;
  lon: number;
  city: string | null;
  region: string | null;
  country: string | null;
  timezone: string;
}

export type WeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavy-rain'
  | 'freezing-rain'
  | 'snow'
  | 'heavy-snow'
  | 'showers'
  | 'thunderstorm'
  | 'unknown';

export interface WeatherSnapshot {
  asOf: number;                     // epoch ms when we fetched from Open-Meteo
  location: WeatherLocation;
  source: 'cf-headers' | 'fallback';
  isDay: boolean;
  tempF: number | null;
  feelsLikeF: number | null;
  highF: number | null;             // next 24h high
  lowF: number | null;              // next 24h low
  windMph: number | null;
  humidityPct: number | null;
  precipChancePct: number | null;   // next-hour probability
  condition: WeatherCondition;
  conditionLabel: string;           // human-readable, e.g., "Partly cloudy"
  wmoCode: number | null;           // raw WMO weather code from Open-Meteo
}

interface CacheRow {
  key: string;
  snapshot: WeatherSnapshot;
}

interface CacheFile {
  rows: CacheRow[];
}

function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function readCache(): CacheFile {
  try {
    const txt = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed?.rows)) return parsed;
  } catch { /* ignore */ }
  return { rows: [] };
}

function writeCache(cache: CacheFile): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf-8');
  } catch (err) {
    logger.warn({ err }, 'weather: failed to write cache');
  }
}

function lookupCache(lat: number, lon: number): WeatherSnapshot | null {
  const key = coordKey(lat, lon);
  const cache = readCache();
  const row = cache.rows.find(r => r.key === key);
  if (!row) return null;
  if (Date.now() - row.snapshot.asOf > TTL_MS) return null;
  return row.snapshot;
}

function saveToCache(snapshot: WeatherSnapshot): void {
  const key = coordKey(snapshot.location.lat, snapshot.location.lon);
  const cache = readCache();
  const idx = cache.rows.findIndex(r => r.key === key);
  if (idx >= 0) cache.rows[idx] = { key, snapshot };
  else cache.rows.push({ key, snapshot });
  // Trim to most recent 20 locations
  if (cache.rows.length > 20) cache.rows.splice(0, cache.rows.length - 20);
  writeCache(cache);
}

// WMO weather interpretation codes → our condition enum + human label.
// Reference: https://open-meteo.com/en/docs (Weather variable documentation).
function interpretWMO(code: number, isDay: boolean): { condition: WeatherCondition; label: string } {
  // 0 — clear sky
  if (code === 0) return { condition: 'clear', label: isDay ? 'Clear' : 'Clear night' };
  // 1 — mainly clear, 2 — partly cloudy
  if (code === 1) return { condition: 'clear', label: 'Mostly clear' };
  if (code === 2) return { condition: 'partly-cloudy', label: 'Partly cloudy' };
  // 3 — overcast
  if (code === 3) return { condition: 'overcast', label: 'Overcast' };
  // 45, 48 — fog
  if (code === 45 || code === 48) return { condition: 'fog', label: 'Fog' };
  // 51, 53, 55 — drizzle
  if (code === 51) return { condition: 'drizzle', label: 'Light drizzle' };
  if (code === 53) return { condition: 'drizzle', label: 'Drizzle' };
  if (code === 55) return { condition: 'drizzle', label: 'Heavy drizzle' };
  // 56, 57 — freezing drizzle
  if (code === 56 || code === 57) return { condition: 'freezing-rain', label: 'Freezing drizzle' };
  // 61, 63, 65 — rain
  if (code === 61) return { condition: 'rain', label: 'Light rain' };
  if (code === 63) return { condition: 'rain', label: 'Rain' };
  if (code === 65) return { condition: 'heavy-rain', label: 'Heavy rain' };
  // 66, 67 — freezing rain
  if (code === 66 || code === 67) return { condition: 'freezing-rain', label: 'Freezing rain' };
  // 71, 73, 75 — snow
  if (code === 71) return { condition: 'snow', label: 'Light snow' };
  if (code === 73) return { condition: 'snow', label: 'Snow' };
  if (code === 75) return { condition: 'heavy-snow', label: 'Heavy snow' };
  // 77 — snow grains
  if (code === 77) return { condition: 'snow', label: 'Snow grains' };
  // 80, 81, 82 — rain showers
  if (code === 80) return { condition: 'showers', label: 'Light showers' };
  if (code === 81) return { condition: 'showers', label: 'Showers' };
  if (code === 82) return { condition: 'showers', label: 'Heavy showers' };
  // 85, 86 — snow showers
  if (code === 85) return { condition: 'snow', label: 'Snow showers' };
  if (code === 86) return { condition: 'heavy-snow', label: 'Heavy snow showers' };
  // 95 — thunderstorm
  if (code === 95) return { condition: 'thunderstorm', label: 'Thunderstorm' };
  // 96, 99 — thunderstorm with hail
  if (code === 96 || code === 99) return { condition: 'thunderstorm', label: 'Thunderstorm + hail' };
  return { condition: 'unknown', label: 'Unknown' };
}

function cToF(c: number | null | undefined): number | null {
  if (c === null || c === undefined || Number.isNaN(c)) return null;
  return Math.round((c * 9) / 5 + 32);
}

function kmhToMph(k: number | null | undefined): number | null {
  if (k === null || k === undefined || Number.isNaN(k)) return null;
  return Math.round(k * 0.621371);
}

interface OpenMeteoResponse {
  current?: {
    time?: string;
    interval?: number;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    is_day?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
  timezone?: string;
}

async function fetchFromOpenMeteo(location: WeatherLocation): Promise<WeatherSnapshot> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.lat));
  url.searchParams.set('longitude', String(location.lon));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m');
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('timezone', location.timezone || 'auto');
  url.searchParams.set('forecast_days', '1');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`open-meteo http ${res.status}`);
  }
  const j = (await res.json()) as OpenMeteoResponse;
  const cur = j.current || {};
  const daily = j.daily || {};
  const isDay = cur.is_day === 1;
  const wmo = typeof cur.weather_code === 'number' ? cur.weather_code : null;
  const { condition, label } = wmo === null
    ? { condition: 'unknown' as WeatherCondition, label: 'Unknown' }
    : interpretWMO(wmo, isDay);

  return {
    asOf: Date.now(),
    location,
    source: 'fallback', // overwritten by caller based on how location was resolved
    isDay,
    tempF: cToF(cur.temperature_2m),
    feelsLikeF: cToF(cur.apparent_temperature),
    highF: daily.temperature_2m_max?.[0] !== undefined ? cToF(daily.temperature_2m_max[0]) : null,
    lowF: daily.temperature_2m_min?.[0] !== undefined ? cToF(daily.temperature_2m_min[0]) : null,
    windMph: kmhToMph(cur.wind_speed_10m),
    humidityPct: cur.relative_humidity_2m !== undefined ? Math.round(cur.relative_humidity_2m) : null,
    precipChancePct: daily.precipitation_probability_max?.[0] !== undefined ? daily.precipitation_probability_max[0] : null,
    condition,
    conditionLabel: label,
    wmoCode: wmo,
  };
}

// Headers come from Hono context (lowercase). All optional — if any are
// missing or malformed we fall back to Oakville.
export interface CloudflareGeoHeaders {
  lat?: string | null;
  lon?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  timezone?: string | null;
}

export function locationFromCfHeaders(h: CloudflareGeoHeaders): WeatherLocation | null {
  const lat = h.lat ? parseFloat(h.lat) : NaN;
  const lon = h.lon ? parseFloat(h.lon) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null; // CF sends 0,0 when geolocation is unavailable
  return {
    lat: Math.round(lat * 100) / 100,
    lon: Math.round(lon * 100) / 100,
    city: h.city || null,
    region: h.region || null,
    country: h.country || null,
    timezone: h.timezone || 'auto',
  };
}

/**
 * Resolve location from CF headers if available, else fall back to Oakville.
 * Returns the snapshot with `source` set accordingly.
 */
export async function getWeather(cfHeaders: CloudflareGeoHeaders): Promise<WeatherSnapshot> {
  const cfLoc = locationFromCfHeaders(cfHeaders);
  const location = cfLoc || OAKVILLE;
  const source: WeatherSnapshot['source'] = cfLoc ? 'cf-headers' : 'fallback';

  const cached = lookupCache(location.lat, location.lon);
  if (cached) {
    return { ...cached, source };
  }

  try {
    const snap = await fetchFromOpenMeteo(location);
    snap.source = source;
    saveToCache(snap);
    return snap;
  } catch (err) {
    logger.warn({ err, lat: location.lat, lon: location.lon }, 'weather: open-meteo fetch failed');
    // Return a sentinel "unknown" snapshot so the UI can still render the
    // location label and fall back to time-of-day-only theming.
    return {
      asOf: Date.now(),
      location,
      source,
      isDay: true,
      tempF: null, feelsLikeF: null, highF: null, lowF: null,
      windMph: null, humidityPct: null, precipChancePct: null,
      condition: 'unknown',
      conditionLabel: 'Unavailable',
      wmoCode: null,
    };
  }
}
