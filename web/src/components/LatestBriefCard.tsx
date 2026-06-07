// Latest Morning Brief card for the Founder Dashboard.
//
// Surfaces the most recent brief from the daily_briefs table. Designed to
// pop visually: hero gradient header, big date, "headline" treatment for
// the first line (Nikki's ☀️ line), then prose body with preserved line
// breaks. Action chips for marking acted/ignored, "Generate now" preview
// button, and a strip of recent days.

import { useState, useMemo, useEffect } from 'preact/hooks';
import { Sunrise, Sun, Sunset, Moon, ArrowRight, Sparkles, Check, X, Loader2, ChevronDown, ChevronUp, MessageCircle, Cloud, CloudDrizzle, CloudRain, CloudSnow, CloudFog, CloudLightning, MapPin, RefreshCw, Wind, Droplets } from 'lucide-preact';
import { apiPost } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';

type BriefKind = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

interface DailyBriefRow {
  id: number;
  generated_at: number;
  brief_date: string;
  brief_kind?: BriefKind; // optional for old rows pre-migration
  body: string;
  char_count: number;
  send_status: 'pending' | 'sent' | 'failed' | 'preview';
  telegram_message_id: number | null;
  user_marked: 'acted' | 'ignored' | null;
  marked_at: number | null;
}

interface RecentRow {
  id: number; brief_date: string; generated_at: number; char_count: number;
  brief_kind?: BriefKind;
  send_status: DailyBriefRow['send_status']; user_marked: DailyBriefRow['user_marked'];
}

interface LatestBriefResponse {
  latest: DailyBriefRow | null;
  recent: RecentRow[];
}

// ── Time-of-day theme system ───────────────────────────────────────
// Each kind drives the card hero header's gradient backdrop, decorative
// SVG, icon badge, accent color, and label. The body content itself is
// theme-neutral so prose reads cleanly against any backdrop.

interface BriefTheme {
  label: string;
  gradient: string;          // CSS gradient string for the hero
  decorationColor: string;   // dominant decoration color
  badgeFrom: string;
  badgeTo: string;
  icon: typeof Sunrise;
  decoration: 'sunrays' | 'sunhigh' | 'sunlow' | 'sunset-bands' | 'moon-stars';
  textShadow: string;        // tinted shadow on headline for legibility
  accentRing: string;        // border tint
}

const THEME_BY_KIND: Record<BriefKind, BriefTheme> = {
  morning: {
    label: 'Morning Brief',
    // Sky-first: blue top, warm sunrise bottom — feels like the actual sky
    gradient: 'linear-gradient(180deg, #7dd3fc 0%, #fbbf77 60%, #ffd66e 100%)',
    decorationColor: '#fff5d6',
    badgeFrom: '#fb923c',
    badgeTo: '#f59e0b',
    icon: Sunrise,
    decoration: 'sunrays',
    textShadow: '0 1px 12px rgba(40, 80, 120, 0.35)',
    accentRing: 'rgba(125, 211, 252, 0.65)',
  },
  noon: {
    label: 'Noon Check',
    // Strong sky blue dominating, soft warmth at top right
    gradient: 'linear-gradient(180deg, #4dabf7 0%, #74c0fc 40%, #a5d8ff 100%)',
    decorationColor: '#ffffff',
    badgeFrom: '#fbbf24',
    badgeTo: '#f97316',
    icon: Sun,
    decoration: 'sunhigh',
    textShadow: '0 1px 12px rgba(20, 60, 120, 0.4)',
    accentRing: 'rgba(77, 171, 247, 0.65)',
  },
  afternoon: {
    label: 'Afternoon Nudge',
    // Blue sky with warm afternoon glow at bottom
    gradient: 'linear-gradient(180deg, #74c0fc 0%, #ffc75f 65%, #ff9f1c 100%)',
    decorationColor: '#ffe9c4',
    badgeFrom: '#ea580c',
    badgeTo: '#d97706',
    icon: Sun,
    decoration: 'sunlow',
    textShadow: '0 1px 12px rgba(40, 60, 100, 0.35)',
    accentRing: 'rgba(116, 192, 252, 0.65)',
  },
  evening: {
    label: 'Evening Wind-down',
    gradient: 'linear-gradient(180deg, #7f5af0 0%, #ff6b6b 55%, #ffa94d 100%)',
    decorationColor: '#ffe5b4',
    badgeFrom: '#a855f7',
    badgeTo: '#ec4899',
    icon: Sunset,
    decoration: 'sunset-bands',
    textShadow: '0 1px 14px rgba(40, 20, 80, 0.35)',
    accentRing: 'rgba(168, 85, 247, 0.65)',
  },
  night: {
    label: 'Night Reflection',
    gradient: 'linear-gradient(180deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)',
    decorationColor: '#e0e7ff',
    badgeFrom: '#6366f1',
    badgeTo: '#4338ca',
    icon: Moon,
    decoration: 'moon-stars',
    textShadow: '0 1px 14px rgba(0, 0, 0, 0.5)',
    accentRing: 'rgba(99, 102, 241, 0.7)',
  },
};

/** Decorative SVG layer over the hero gradient. Absolutely positioned, low
 *  opacity, pointer-events-none so it never blocks the chips. Each variant
 *  is a small hand-tuned scene that reads at-a-glance even at low opacity. */
function Decoration({ kind }: { kind: BriefKind }) {
  const theme = THEME_BY_KIND[kind];
  const color = theme.decorationColor;
  switch (theme.decoration) {
    case 'sunrays':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Rising sun bottom-right */}
          <circle cx="340" cy="170" r="48" fill={color} opacity="0.5" />
          <circle cx="340" cy="170" r="32" fill={color} opacity="0.7" />
          {/* Light beams radiating from sun */}
          {[0, 22, 45, 67, 90, 112, 135].map((deg, i) => {
            const rad = (deg * Math.PI) / 180;
            const x2 = 340 - Math.cos(rad) * 200;
            const y2 = 170 - Math.sin(rad) * 200;
            return <line key={i} x1="340" y1="170" x2={x2} y2={y2} stroke={color} strokeWidth="1.5" opacity="0.18">
              <animate attributeName="opacity" values="0.10;0.22;0.10" dur="6s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
            </line>;
          })}
        </svg>
      );
    case 'sunhigh':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Sun high in upper-right */}
          <circle cx="340" cy="60" r="42" fill={color} opacity="0.55" />
          <circle cx="340" cy="60" r="28" fill={color} opacity="0.85" />
          {/* Halo rings */}
          <circle cx="340" cy="60" r="60" fill="none" stroke={color} strokeWidth="1" opacity="0.2">
            <animate attributeName="r" values="55;72;55" dur="5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.1;0.3" dur="5s" repeatCount="indefinite" />
          </circle>
          <circle cx="340" cy="60" r="85" fill="none" stroke={color} strokeWidth="0.8" opacity="0.15" />
        </svg>
      );
    case 'sunlow':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Lowering sun mid-right with long horizontal glow */}
          <ellipse cx="340" cy="120" rx="180" ry="14" fill={color} opacity="0.18" />
          <circle cx="340" cy="120" r="38" fill={color} opacity="0.55" />
          <circle cx="340" cy="120" r="26" fill={color} opacity="0.8" />
        </svg>
      );
    case 'sunset-bands':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Horizontal sky bands suggesting layered dusk */}
          <rect x="0" y="120" width="400" height="6" fill={color} opacity="0.20" />
          <rect x="0" y="138" width="400" height="4" fill={color} opacity="0.16" />
          <rect x="0" y="150" width="400" height="3" fill={color} opacity="0.12" />
          {/* Setting sun at horizon */}
          <circle cx="320" cy="145" r="40" fill={color} opacity="0.45" />
          <circle cx="320" cy="145" r="24" fill={color} opacity="0.75" />
        </svg>
      );
    case 'moon-stars':
      return (
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
          {/* Crescent moon: white circle with overlapping dark circle to bite */}
          <defs>
            <mask id="crescent-mask">
              <rect width="400" height="200" fill="white" />
              <circle cx="320" cy="50" r="32" fill="black" />
            </mask>
          </defs>
          <circle cx="340" cy="55" r="32" fill={color} opacity="0.9" mask="url(#crescent-mask)" />
          {/* Scattered stars */}
          {[
            [60, 30, 1.5], [120, 60, 1], [200, 40, 1.8], [260, 90, 1.2],
            [80, 110, 1], [160, 130, 1.4], [240, 150, 1], [40, 80, 1.3],
            [300, 130, 1.6], [180, 90, 0.9], [110, 140, 1.1], [280, 30, 1.4],
          ].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill={color} opacity={0.75}>
              <animate attributeName="opacity" values="0.4;0.9;0.4" dur={`${3 + (i % 3)}s`} begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </svg>
      );
  }
}

// ── Weather overlay system ────────────────────────────────────────
// Layers conditions on top of the time-of-day decoration. Clouds, rain,
// snow, lightning, fog. Drives gradient overrides so an overcast day
// reads gray-blue instead of golden, a rainy night dims the stars, etc.

type WeatherCondition =
  | 'clear' | 'partly-cloudy' | 'cloudy' | 'overcast' | 'fog'
  | 'drizzle' | 'rain' | 'heavy-rain' | 'freezing-rain'
  | 'snow' | 'heavy-snow' | 'showers' | 'thunderstorm' | 'unknown';

interface HourlyPoint {
  time: number;
  hourLabel: string;
  tempF: number | null;
  condition: WeatherCondition;
  isDay: boolean;
  precipChancePct: number | null;
}

interface WeatherSnapshot {
  asOf: number;
  location: { lat: number; lon: number; city: string | null; region: string | null; country: string | null; timezone: string };
  source: 'cf-headers' | 'fallback';
  isDay: boolean;
  tempF: number | null;
  feelsLikeF: number | null;
  highF: number | null;
  lowF: number | null;
  windMph: number | null;
  windGustMph: number | null;
  humidityPct: number | null;
  cloudCoverPct: number | null;
  precipChancePct: number | null;
  precipNext6hPctMax: number | null;
  condition: WeatherCondition;
  conditionLabel: string;
  wmoCode: number | null;
  nowcast: string;
  sunriseTs: number | null;
  sunsetTs: number | null;
  hourly: HourlyPoint[];
}

const CLOUDY_CONDITIONS: WeatherCondition[] = ['cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'heavy-rain', 'showers', 'thunderstorm', 'snow', 'heavy-snow', 'freezing-rain'];
const HEAVY_CONDITIONS: WeatherCondition[] = ['overcast', 'heavy-rain', 'thunderstorm', 'heavy-snow'];

function pickWeatherIcon(c: WeatherCondition): typeof Sun {
  switch (c) {
    case 'clear': return Sun;
    case 'partly-cloudy': return Cloud;
    case 'cloudy': case 'overcast': return Cloud;
    case 'fog': return CloudFog;
    case 'drizzle': return CloudDrizzle;
    case 'rain': case 'showers': case 'heavy-rain': case 'freezing-rain': return CloudRain;
    case 'snow': case 'heavy-snow': return CloudSnow;
    case 'thunderstorm': return CloudLightning;
    default: return Sun;
  }
}

/** Override the time-of-day gradient when weather is heavy/cloudy so the
 *  card reads the weather as much as the time. Clear skies = original
 *  gradient. Cloudy/overcast = grayer muted version. Storm = dark dramatic. */
function gradientForWeather(kind: BriefKind, base: string, weather: WeatherSnapshot | null): string {
  if (!weather || weather.condition === 'clear' || weather.condition === 'partly-cloudy' || weather.condition === 'unknown') return base;
  const c = weather.condition;

  // Thunderstorm — dark dramatic regardless of time
  if (c === 'thunderstorm') {
    return weather.isDay
      ? 'linear-gradient(180deg, #475569 0%, #334155 60%, #1e293b 100%)'
      : 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #334155 100%)';
  }
  // Snow — cool blue-white
  if (c === 'snow' || c === 'heavy-snow' || c === 'freezing-rain') {
    return weather.isDay
      ? 'linear-gradient(180deg, #cbd5e1 0%, #94a3b8 50%, #e2e8f0 100%)'
      : 'linear-gradient(180deg, #1e293b 0%, #334155 50%, #475569 100%)';
  }
  // Rain — muted gray-blue
  if (c === 'rain' || c === 'heavy-rain' || c === 'showers' || c === 'drizzle') {
    return weather.isDay
      ? 'linear-gradient(180deg, #64748b 0%, #475569 50%, #334155 100%)'
      : 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #334155 100%)';
  }
  // Fog — soft white-gray haze
  if (c === 'fog') {
    return weather.isDay
      ? 'linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 50%, #94a3b8 100%)'
      : 'linear-gradient(180deg, #1e293b 0%, #334155 50%, #475569 100%)';
  }
  // Cloudy/overcast — desaturate the base by overlaying gray
  if (c === 'cloudy' || c === 'overcast') {
    // For night kinds keep dark; for day kinds use cooler gray-blue
    if (kind === 'night') return 'linear-gradient(180deg, #1e1b4b 0%, #1e293b 50%, #334155 100%)';
    return 'linear-gradient(180deg, #94a3b8 0%, #64748b 50%, #475569 100%)';
  }
  return base;
}

/** Whether to hide the sun/moon/stars decoration because clouds would
 *  cover them. Returns true for heavy cloud cover and precipitation. */
function decorationDimmedByWeather(weather: WeatherSnapshot | null): boolean {
  if (!weather) return false;
  return CLOUDY_CONDITIONS.includes(weather.condition);
}

/** Weather decoration overlay: drifting clouds, rain streaks, snowflakes,
 *  lightning flash. Stacks ON TOP of (or replaces) the time-of-day decoration.
 *  Pointer-events-none so it never blocks the chips. */
function WeatherOverlay({ weather, briefKind }: { weather: WeatherSnapshot | null; briefKind?: BriefKind }) {
  // Clear daytime: still show 2 wispy white clouds drifting for that
  // Apple-Weather-card sky feel. Doesn't apply at night (stars would
  // be obscured) or unknown weather.
  if (!weather || weather.condition === 'unknown') return null;
  if (weather.condition === 'clear' && weather.isDay && briefKind !== 'night' && briefKind !== 'evening') {
    return (
      <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
        <g opacity="0.55">
          <ellipse cx="80" cy="60" rx="34" ry="11" fill="#ffffff" />
          <ellipse cx="58" cy="64" rx="20" ry="8" fill="#ffffff" />
          <ellipse cx="102" cy="64" rx="20" ry="8" fill="#ffffff" />
          <ellipse cx="72" cy="54" rx="18" ry="8" fill="#ffffff" />
          <animateTransform attributeName="transform" type="translate" values="-20 0; 30 0; -20 0" dur="55s" repeatCount="indefinite" />
        </g>
        <g opacity="0.4">
          <ellipse cx="230" cy="90" rx="40" ry="12" fill="#ffffff" />
          <ellipse cx="200" cy="94" rx="22" ry="9" fill="#ffffff" />
          <ellipse cx="260" cy="94" rx="22" ry="9" fill="#ffffff" />
          <ellipse cx="218" cy="82" rx="20" ry="9" fill="#ffffff" />
          <animateTransform attributeName="transform" type="translate" values="-40 0; 20 0; -40 0" dur="70s" repeatCount="indefinite" />
        </g>
      </svg>
    );
  }
  if (weather.condition === 'clear') return null;
  const c = weather.condition;
  const heavy = HEAVY_CONDITIONS.includes(c);

  // Cloud helper — soft white blob with drift animation
  const CloudPuff = ({ cx, cy, scale, dur, color = '#ffffff', opacity = 0.45 }: { cx: number; cy: number; scale: number; dur: string; color?: string; opacity?: number }) => (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`} opacity={opacity}>
      <ellipse cx="0" cy="0" rx="34" ry="14" fill={color} />
      <ellipse cx="-22" cy="4" rx="20" ry="11" fill={color} />
      <ellipse cx="22" cy="4" rx="20" ry="11" fill={color} />
      <ellipse cx="-8" cy="-10" rx="18" ry="10" fill={color} />
      <ellipse cx="14" cy="-9" rx="16" ry="9" fill={color} />
      <animateTransform attributeName="transform" type="translate" values={`${cx - 30} ${cy}; ${cx + 30} ${cy}; ${cx - 30} ${cy}`} dur={dur} repeatCount="indefinite" additive="sum" />
    </g>
  );

  // Light cloud cover for partly cloudy days
  if (c === 'partly-cloudy') {
    return (
      <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
        <CloudPuff cx={150} cy={45} scale={0.65} dur="40s" opacity={0.5} />
        <CloudPuff cx={280} cy={70} scale={0.55} dur="50s" opacity={0.42} />
        <CloudPuff cx={70} cy={90} scale={0.45} dur="60s" opacity={0.35} />
      </svg>
    );
  }

  // Fog — soft white haze sweeping across
  if (c === 'fog') {
    return (
      <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
        <rect x="0" y="60" width="400" height="30" fill="#ffffff" opacity="0.25" />
        <rect x="0" y="100" width="400" height="35" fill="#ffffff" opacity="0.28" />
        <rect x="0" y="140" width="400" height="40" fill="#ffffff" opacity="0.22" />
      </svg>
    );
  }

  const cloudColor = heavy ? '#cbd5e1' : '#e2e8f0';

  // Cloudy/overcast — full cloud cover, no precipitation
  if (c === 'cloudy' || c === 'overcast') {
    return (
      <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
        <CloudPuff cx={80} cy={50} scale={0.8} dur="50s" color={cloudColor} opacity={heavy ? 0.7 : 0.55} />
        <CloudPuff cx={210} cy={40} scale={0.95} dur="45s" color={cloudColor} opacity={heavy ? 0.75 : 0.6} />
        <CloudPuff cx={340} cy={55} scale={0.75} dur="55s" color={cloudColor} opacity={heavy ? 0.7 : 0.55} />
        <CloudPuff cx={150} cy={85} scale={0.65} dur="60s" color={cloudColor} opacity={heavy ? 0.55 : 0.4} />
        <CloudPuff cx={290} cy={95} scale={0.7} dur="65s" color={cloudColor} opacity={heavy ? 0.55 : 0.4} />
      </svg>
    );
  }

  // Rain (or showers/drizzle) — clouds + falling streaks
  if (c === 'rain' || c === 'heavy-rain' || c === 'showers' || c === 'drizzle' || c === 'freezing-rain') {
    const dropCount = c === 'heavy-rain' || c === 'showers' ? 22 : 14;
    const drops = Array.from({ length: dropCount }).map((_, i) => {
      const x = (i * 23) % 400 + (i % 3) * 7;
      const delay = (i * 0.13) % 2;
      return (
        <line key={i} x1={x} y1={-10} x2={x - 4} y2={10} stroke="#dbeafe" strokeWidth={c === 'drizzle' ? 0.8 : 1.4} strokeLinecap="round" opacity="0.6">
          <animate attributeName="y1" values="-10;210" dur="1.2s" begin={`${delay}s`} repeatCount="indefinite" />
          <animate attributeName="y2" values="10;230" dur="1.2s" begin={`${delay}s`} repeatCount="indefinite" />
        </line>
      );
    });
    return (
      <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
        <CloudPuff cx={100} cy={35} scale={0.9} dur="60s" color={cloudColor} opacity={0.75} />
        <CloudPuff cx={250} cy={28} scale={1.0} dur="55s" color={cloudColor} opacity={0.8} />
        <CloudPuff cx={350} cy={40} scale={0.8} dur="58s" color={cloudColor} opacity={0.75} />
        {drops}
      </svg>
    );
  }

  // Snow — clouds + falling flakes (drift sideways)
  if (c === 'snow' || c === 'heavy-snow') {
    const flakeCount = c === 'heavy-snow' ? 30 : 18;
    const flakes = Array.from({ length: flakeCount }).map((_, i) => {
      const x = (i * 21) % 400 + (i % 4) * 5;
      const delay = (i * 0.17) % 3;
      const size = 1.2 + (i % 3) * 0.4;
      return (
        <circle key={i} cx={x} cy={-5} r={size} fill="#ffffff" opacity="0.85">
          <animate attributeName="cy" values="-5;210" dur={`${3 + (i % 4) * 0.5}s`} begin={`${delay}s`} repeatCount="indefinite" />
          <animate attributeName="cx" values={`${x};${x + 6};${x - 4};${x}`} dur="4s" begin={`${delay}s`} repeatCount="indefinite" />
        </circle>
      );
    });
    return (
      <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
        <CloudPuff cx={120} cy={30} scale={0.85} dur="60s" color="#e2e8f0" opacity={0.6} />
        <CloudPuff cx={280} cy={35} scale={0.95} dur="55s" color="#e2e8f0" opacity={0.65} />
        {flakes}
      </svg>
    );
  }

  // Thunderstorm — dark clouds + intermittent lightning flash + rain
  if (c === 'thunderstorm') {
    return (
      <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
        {/* Lightning flash overlay (flickers) */}
        <rect x="0" y="0" width="400" height="200" fill="#fef9c3" opacity="0">
          <animate attributeName="opacity" values="0;0;0;0;0;0;0.35;0;0.2;0;0;0;0;0" dur="7s" repeatCount="indefinite" />
        </rect>
        <CloudPuff cx={100} cy={35} scale={1.0} dur="50s" color="#475569" opacity={0.85} />
        <CloudPuff cx={260} cy={28} scale={1.15} dur="55s" color="#475569" opacity={0.9} />
        <CloudPuff cx={360} cy={40} scale={0.9} dur="60s" color="#475569" opacity={0.85} />
        {/* Lightning bolt */}
        <path d="M 200 60 L 195 90 L 205 90 L 195 130 L 215 90 L 205 90 L 215 60 Z" fill="#fef3c7" opacity="0">
          <animate attributeName="opacity" values="0;0;0;0;0;0;0.95;0;0.7;0;0;0;0;0" dur="7s" repeatCount="indefinite" />
        </path>
        {/* Rain streaks */}
        {Array.from({ length: 18 }).map((_, i) => {
          const x = (i * 22) % 400 + (i % 3) * 6;
          const delay = (i * 0.11) % 2;
          return (
            <line key={i} x1={x} y1={-10} x2={x - 4} y2={10} stroke="#dbeafe" strokeWidth="1.4" strokeLinecap="round" opacity="0.6">
              <animate attributeName="y1" values="-10;210" dur="1.1s" begin={`${delay}s`} repeatCount="indefinite" />
              <animate attributeName="y2" values="10;230" dur="1.1s" begin={`${delay}s`} repeatCount="indefinite" />
            </line>
          );
        })}
      </svg>
    );
  }

  return null;
}

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Pick a default theme based on the user's current local hour. Used for
 *  the "no brief yet" empty state and as a fallback when an old brief
 *  row has no brief_kind. */
function themeFromCurrentHour(): BriefKind {
  const h = new Date().getHours();
  if (h < 11) return 'morning';
  if (h < 14) return 'noon';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

const STATUS_LABEL: Record<DailyBriefRow['send_status'], { label: string; color: string }> = {
  sent:    { label: 'Delivered',  color: '#16a34a' },
  pending: { label: 'Sending…',   color: '#ca8a04' },
  failed:  { label: 'Send failed', color: '#dc2626' },
  preview: { label: 'Preview',    color: '#7c3aed' },
};

function fmtDate(dateStr: string): { weekday: string; long: string } {
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  return {
    weekday: dt.toLocaleDateString('en-US', { weekday: 'long' }),
    long: dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

function relTime(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Defensive cleanup for briefs already stored before the server-side fix:
// strips outer quotes and replaces literal `\n` / `\"` / `\\` sequences
// with their real characters. New briefs are already cleaned on the
// server, so this is a no-op for them.
function unescapeBrief(raw: string): string {
  let s = (raw || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  s = s.replace(/\\\\/g, '__BS__')
       .replace(/\\n/g, '\n')
       .replace(/\\t/g, '\t')
       .replace(/\\"/g, '"')
       .replace(/__BS__/g, '\\');
  return s.trim();
}

// Split a brief into (headline, rest). The morning-brief prompt asks for
// a single ☀️-prefixed headline line. We grab the first non-empty line as
// the headline, then return the rest as the body.
function splitBrief(body: string): { headline: string; rest: string } {
  const cleaned = unescapeBrief(body);
  const lines = cleaned.split('\n').map(l => l.trimEnd());
  let headlineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { headlineIdx = i; break; }
  }
  if (headlineIdx === -1) return { headline: body.trim(), rest: '' };
  const headline = lines[headlineIdx].replace(/^[☀️🌅✨\s]+/, '').trim();
  const rest = lines.slice(headlineIdx + 1).join('\n').trim();
  return { headline, rest };
}

// Render the brief body with gentle structure: arrow-prefixed action lines
// get an accent, bullet lines get a subtle bullet, everything else is prose.
function BriefBody({ body }: { body: string }) {
  const lines = useMemo(() => body.split('\n'), [body]);
  return (
    <div class="text-[13px] text-[var(--color-text)] leading-relaxed space-y-1.5">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return <div key={i} class="h-1" />;
        if (line.startsWith('→') || line.startsWith('->')) {
          return (
            <div key={i} class="flex items-start gap-2">
              <ArrowRight size={13} class="text-[var(--color-accent)] shrink-0 mt-1" />
              <span class="text-[var(--color-text)]">{line.replace(/^[→>\-]+\s*/, '')}</span>
            </div>
          );
        }
        if (/^[•\-\*]\s/.test(line)) {
          return (
            <div key={i} class="flex items-start gap-2">
              <span class="text-[var(--color-text-faint)] mt-0.5">·</span>
              <span class="text-[var(--color-text-muted)]">{line.replace(/^[•\-\*]\s+/, '')}</span>
            </div>
          );
        }
        return <div key={i} class="text-[var(--color-text-muted)]">{line}</div>;
      })}
    </div>
  );
}

function MarkChip({ label, icon: Icon, active, color, onClick }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
        active
          ? 'border-transparent text-white'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]'
      }`}
      style={active ? { backgroundColor: color } : undefined}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

function RecentChip({ row, isActive, onClick }: { row: RecentRow; isActive: boolean; onClick: () => void }) {
  const [y, m, d] = row.brief_date.split('-').map(n => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  const label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const status = STATUS_LABEL[row.send_status];
  // Tiny kind icon — sun/moon glyph beside the date so you can tell at a
  // glance which of the day's 5 briefs this chip represents.
  const kind = row.brief_kind || 'morning';
  const KindIcon = THEME_BY_KIND[kind].icon;
  const kindColor = THEME_BY_KIND[kind].badgeFrom;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${THEME_BY_KIND[kind].label} · ${label}`}
      class={`group inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
        isActive
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]'
      }`}
    >
      <KindIcon size={10} style={{ color: kindColor }} />
      <span class="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {label}
      {row.user_marked === 'acted' && <Check size={10} class="text-[#16a34a]" />}
    </button>
  );
}

export function LatestBriefCard() {
  const { data, loading, error, refresh } = useFetch<LatestBriefResponse>('/api/brief/latest', 60_000);
  // Weather snapshot — refreshes every 10min (matches server-side cache TTL).
  const { data: weather, refresh: refreshWeather } = useFetch<WeatherSnapshot>('/api/weather', 10 * 60_000);
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewedId, setPreviewedId] = useState<number | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  // Live clock — re-renders every minute so the displayed time stays current.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const latest = previewBody
    ? null  // showing a fresh preview, hide the archive view
    : data?.latest || null;

  async function handleGenerate() {
    setGenerating(true);
    try {
      const r = await apiPost<{ ok: boolean; id: number; body: string }>('/api/brief/run', {});
      setPreviewedId(r.id);
      setPreviewBody(r.body);
      setExpanded(true);
      refresh();
    } catch (e) {
      console.error('brief generate', e);
    } finally {
      setGenerating(false);
    }
  }

  async function handleMark(action: 'acted' | 'ignored' | null) {
    if (!latest) return;
    try {
      await apiPost(`/api/brief/${latest.id}/mark`, { action });
      refresh();
    } catch (e) { console.error('mark brief', e); }
  }

  if (loading && !data) {
    return (
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-8 text-center text-[11px] text-[var(--color-text-faint)]">
        Loading morning brief…
      </div>
    );
  }
  if (error) {
    return (
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-[11px] text-[var(--color-text-faint)]">
        Brief unavailable ({String(error)})
      </div>
    );
  }

  // No saved brief AND no preview → invite the user to generate one,
  // themed to the current time of day so the empty state still looks alive.
  if (!latest && !previewBody) {
    const ekind = themeFromCurrentHour();
    const etheme = THEME_BY_KIND[ekind];
    const EIcon = etheme.icon;
    const eHero = gradientForWeather(ekind, etheme.gradient, weather || null);
    const eHideDeco = decorationDimmedByWeather(weather || null);
    return (
      <div class="relative rounded-xl border overflow-hidden" style={{ borderColor: etheme.accentRing }}>
        <div class="relative px-6 py-8 text-center overflow-hidden" style={{ background: eHero }}>
          {!eHideDeco && <Decoration kind={ekind} />}
          <WeatherOverlay weather={weather || null} briefKind={ekind} />
          <EIcon size={28} class="mx-auto text-white mb-2 relative" style={{ filter: 'drop-shadow(0 1px 6px rgba(0,0,0,0.25))' }} />
          <div class="relative text-[14px] font-semibold mb-1" style={{ color: '#ffffff', textShadow: etheme.textShadow }}>
            No {etheme.label.toLowerCase()} yet
          </div>
          <div class="relative text-[11px] mb-4" style={{ color: 'rgba(255,255,255,0.85)', textShadow: etheme.textShadow }}>
            Nikki composes briefs five times a day — morning, noon, afternoon, evening, night.
            Generate one now to preview.
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            class="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: '#1f2937', backdropFilter: 'blur(4px)' }}
          >
            {generating ? <Loader2 size={13} class="animate-spin" /> : <Sparkles size={13} />}
            {generating ? 'Composing…' : 'Generate brief now'}
          </button>
        </div>
      </div>
    );
  }

  // Determine which brief we're rendering (preview takes precedence)
  const displayBody = previewBody ?? latest!.body;
  const displayDate = previewBody
    ? new Date().toISOString().slice(0, 10)
    : latest!.brief_date;
  const displayGeneratedAt = previewBody ? Date.now() : latest!.generated_at;
  const displayStatus: DailyBriefRow['send_status'] = previewBody ? 'preview' : latest!.send_status;
  const displayUserMarked = previewBody ? null : latest!.user_marked;

  const { headline, rest } = splitBrief(displayBody);
  const { weekday, long } = fmtDate(displayDate);
  const status = STATUS_LABEL[displayStatus];
  const recent = data?.recent || [];

  // Pick the theme. New brief rows carry brief_kind directly; older rows
  // (pre-migration) fall back to morning. Previews use the current hour
  // so they preview as the right time-of-day theme.
  const kind: BriefKind = previewBody
    ? themeFromCurrentHour()
    : (latest?.brief_kind || 'morning');
  const theme = THEME_BY_KIND[kind];
  const HeroIcon = theme.icon;
  // Weather modifies the hero gradient + decides whether to hide the
  // sun/moon decoration (clouds would cover them anyway).
  const heroGradient = gradientForWeather(kind, theme.gradient, weather || null);
  const hideTimeOfDayDecoration = decorationDimmedByWeather(weather || null);
  const WeatherIcon = weather ? pickWeatherIcon(weather.condition) : null;
  // Live clock in the timezone the user is actually in (from CF headers,
  // falls back to America/Toronto when source is fallback).
  const tz = weather?.location.timezone || 'America/Toronto';
  const clockNow = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date());
  const locationLabel = weather?.location.city
    ? `${weather.location.city}${weather.location.region ? `, ${weather.location.region}` : ''}`
    : 'Oakville, ON';

  return (
    <div
      class="rounded-xl border overflow-hidden shadow-sm"
      style={{
        borderColor: theme.accentRing,
        boxShadow: `0 1px 2px rgba(0,0,0,0.04), 0 8px 30px ${theme.accentRing.replace('0.6', '0.15').replace('0.65', '0.18').replace('0.7', '0.20')}`,
      }}
    >
      {/* Hero — gradient + decoration + headline */}
      <div class="relative px-5 pt-5 pb-6 overflow-hidden" style={{ background: heroGradient }}>
        {!hideTimeOfDayDecoration && <Decoration kind={kind} />}
        <WeatherOverlay weather={weather || null} briefKind={kind} />

        <div class="relative flex items-start justify-between mb-3">
          <div class="flex items-center gap-2.5">
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center shadow"
              style={{ background: `linear-gradient(135deg, ${theme.badgeFrom}, ${theme.badgeTo})` }}
            >
              <HeroIcon size={17} class="text-white" />
            </div>
            <div>
              <div
                class="text-[10px] uppercase tracking-[0.14em] font-semibold"
                style={{ color: 'rgba(255,255,255,0.85)', textShadow: theme.textShadow }}
              >
                {previewBody ? `Preview · ${theme.label}` : theme.label}
              </div>
              <div
                class="text-[14px] font-semibold leading-tight"
                style={{ color: '#ffffff', textShadow: theme.textShadow }}
              >
                {weekday}, <span style={{ color: 'rgba(255,255,255,0.78)', fontWeight: 400 }}>{long.replace(weekday + ', ', '')}</span>
              </div>
            </div>
          </div>
          <div class="relative flex items-center gap-2">
            <span
              class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: 'rgba(255,255,255,0.85)',
                color: status.color,
                backdropFilter: 'blur(4px)',
              }}
            >
              <span class="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
              {status.label}
            </span>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              title="Generate a fresh preview"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'rgba(255,255,255,0.75)',
                color: '#1f2937',
                backdropFilter: 'blur(4px)',
              }}
            >
              {generating ? <Loader2 size={11} class="animate-spin" /> : <Sparkles size={11} />}
              {generating ? '…' : 'New'}
            </button>
          </div>
        </div>

        {/* Weather hero — Apple-style. Big temp on left, condition + nowcast + hourly strip in the middle. */}
        {weather && weather.tempF !== null && WeatherIcon && (
          <div class="relative mb-4 flex flex-col gap-2.5">
            <div class="flex items-end gap-3">
              <div class="flex items-baseline gap-2">
                <span
                  class="text-[42px] leading-none font-light tracking-[-0.02em]"
                  style={{ color: '#ffffff', textShadow: theme.textShadow }}
                >
                  {weather.tempF}°
                </span>
                <WeatherIcon size={22} style={{ color: 'rgba(255,255,255,0.9)' }} />
              </div>
              <div class="flex flex-col pb-1">
                <span class="text-[13px] font-semibold leading-tight" style={{ color: '#ffffff', textShadow: theme.textShadow }}>
                  {weather.conditionLabel}
                </span>
                {weather.highF !== null && weather.lowF !== null && (
                  <span class="text-[11px] font-medium opacity-90" style={{ color: '#ffffff', textShadow: theme.textShadow }}>
                    H {weather.highF}° · L {weather.lowF}°{weather.feelsLikeF !== null && weather.feelsLikeF !== weather.tempF ? ` · feels ${weather.feelsLikeF}°` : ''}
                  </span>
                )}
              </div>
            </div>
            {/* Nowcast narrative */}
            {weather.nowcast && (
              <div
                class="text-[11px] font-medium px-2.5 py-1.5 rounded-md inline-block"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  color: 'rgba(255,255,255,0.95)',
                  backdropFilter: 'blur(6px)',
                  textShadow: theme.textShadow,
                }}
              >
                {weather.nowcast}
              </div>
            )}
            {/* Hourly strip — next 6 hours */}
            {weather.hourly.length > 0 && (
              <div
                class="flex items-stretch gap-1 px-2 py-1.5 rounded-md"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  backdropFilter: 'blur(6px)',
                }}
              >
                {weather.hourly.slice(0, 6).map((h, i) => {
                  const HIcon = pickWeatherIcon(h.condition);
                  return (
                    <div key={i} class="flex-1 flex flex-col items-center gap-0.5 text-[10px]" style={{ color: '#ffffff', textShadow: theme.textShadow }}>
                      <span class="font-medium opacity-90">{i === 0 ? 'Now' : h.hourLabel}</span>
                      <HIcon size={14} style={{ color: 'rgba(255,255,255,0.95)' }} />
                      <span class="font-semibold">{h.tempF !== null ? `${h.tempF}°` : '—'}</span>
                      {h.precipChancePct !== null && h.precipChancePct >= 20 && (
                        <span class="text-[8px] font-medium" style={{ color: '#bae6fd' }}>{h.precipChancePct}%</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Wind + precip + sunrise/sunset summary row */}
            <div class="flex items-center gap-3 text-[10px] font-medium opacity-90" style={{ color: '#ffffff', textShadow: theme.textShadow }}>
              {weather.windMph !== null && weather.windMph > 0 && (
                <span class="inline-flex items-center gap-1" title={weather.windGustMph !== null && weather.windGustMph > weather.windMph ? `Gusts to ${weather.windGustMph} mph` : undefined}>
                  <Wind size={10} /> {weather.windMph} mph
                </span>
              )}
              {weather.precipNext6hPctMax !== null && weather.precipNext6hPctMax > 0 && (
                <span class="inline-flex items-center gap-1">
                  <Droplets size={10} /> {weather.precipNext6hPctMax}%
                </span>
              )}
              {weather.sunriseTs && weather.sunsetTs && (() => {
                // Show whichever is next — sunset if it's still ahead, otherwise tomorrow's sunrise
                const now = Date.now();
                const showSunset = weather.sunsetTs > now;
                const label = showSunset ? 'Sunset' : 'Sunrise';
                const ts = showSunset ? weather.sunsetTs : weather.sunriseTs;
                const Icon = showSunset ? Sunset : Sunrise;
                const time = new Intl.DateTimeFormat('en-US', {
                  timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
                }).format(new Date(ts));
                return <span class="inline-flex items-center gap-1"><Icon size={10} /> {label} {time}</span>;
              })()}
            </div>
          </div>
        )}

        {/* Headline — sits on glass overlay so it reads against any backdrop */}
        <div
          class="relative text-[18px] leading-snug font-semibold tracking-[-0.01em]"
          style={{ color: '#ffffff', textShadow: theme.textShadow }}
        >
          {headline}
        </div>

        {/* Footer row — location/clock left, last-refreshed right */}
        <div class="relative mt-4 flex items-end justify-between text-[10px]" style={{ color: 'rgba(255,255,255,0.85)', textShadow: theme.textShadow }}>
          <span class="inline-flex items-center gap-1.5 font-medium">
            <MapPin size={10} />
            {locationLabel} · {clockNow}
            {weather?.source === 'fallback' && (
              <span class="ml-1 px-1 rounded text-[9px]" style={{ backgroundColor: 'rgba(0,0,0,0.25)' }} title="Cloudflare visitor location headers not flowing; using default">
                default
              </span>
            )}
          </span>
          {weather && (
            <button
              type="button"
              onClick={() => refreshWeather()}
              class="inline-flex items-center gap-1 font-medium opacity-90 hover:opacity-100 transition-opacity"
              title="Refresh weather"
            >
              <RefreshCw size={9} />
              Updated {formatRelativeTime(weather.asOf)}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div class="px-5 py-4">
        {rest && (
          <>
            {(!expanded && rest.length > 320) ? (
              <>
                <BriefBody body={rest.slice(0, 320) + '…'} />
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  class="mt-3 inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  <ChevronDown size={12} /> Read full brief
                </button>
              </>
            ) : (
              <>
                <BriefBody body={rest} />
                {rest.length > 320 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    class="mt-3 inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    <ChevronUp size={12} /> Collapse
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer: marks + meta + recent strip */}
      <div class="px-5 pb-4 pt-3 border-t border-[var(--color-border)] bg-[color:rgb(255_255_255_/_2%)]">
        <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div class="flex items-center gap-1.5">
            {!previewBody && (
              <>
                <MarkChip
                  label="I acted on this"
                  icon={Check}
                  color="#16a34a"
                  active={displayUserMarked === 'acted'}
                  onClick={() => handleMark(displayUserMarked === 'acted' ? null : 'acted')}
                />
                <MarkChip
                  label="Ignored"
                  icon={X}
                  color="#6b7280"
                  active={displayUserMarked === 'ignored'}
                  onClick={() => handleMark(displayUserMarked === 'ignored' ? null : 'ignored')}
                />
              </>
            )}
            {previewBody && (
              <button
                type="button"
                onClick={() => { setPreviewBody(null); setPreviewedId(null); refresh(); }}
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
              >
                Close preview
              </button>
            )}
          </div>
          <div class="flex items-center gap-3 text-[10px] text-[var(--color-text-faint)]">
            {!previewBody && latest?.telegram_message_id && (
              <span class="inline-flex items-center gap-1">
                <MessageCircle size={10} /> Telegram
              </span>
            )}
            <span>{relTime(displayGeneratedAt)}</span>
            <span class="tabular-nums">{displayBody.length} chars</span>
          </div>
        </div>

        {(() => {
          // Dedupe the recent strip to one chip per unique date. When a day
          // has multiple briefs (e.g. previews + the real 7am brief), prefer
          // the one with the strongest status: sent > failed > preview > pending.
          // Hide the strip entirely if we only have one unique date so far
          // (otherwise it's just noise — a row of identical "today" chips).
          const STATUS_RANK: Record<DailyBriefRow['send_status'], number> = {
            sent: 4, failed: 3, preview: 2, pending: 1,
          };
          const byDate = new Map<string, RecentRow>();
          for (const r of recent) {
            const existing = byDate.get(r.brief_date);
            if (!existing) { byDate.set(r.brief_date, r); continue; }
            const beatsByStatus = STATUS_RANK[r.send_status] > STATUS_RANK[existing.send_status];
            const beatsByRecency = STATUS_RANK[r.send_status] === STATUS_RANK[existing.send_status]
              && r.generated_at > existing.generated_at;
            if (beatsByStatus || beatsByRecency) byDate.set(r.brief_date, r);
          }
          const uniqueDays = Array.from(byDate.values())
            .sort((a, b) => b.generated_at - a.generated_at);
          if (uniqueDays.length < 2) return null;
          return (
            <div class="flex items-center gap-1.5 flex-wrap pt-2 border-t border-[var(--color-border)]">
              <span class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mr-1">Recent</span>
              {uniqueDays.slice(0, 10).map(r => (
                <RecentChip
                  key={r.id}
                  row={r}
                  isActive={!previewBody && r.id === latest?.id}
                  onClick={() => { /* future: load this brief into the main view */ }}
                />
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
