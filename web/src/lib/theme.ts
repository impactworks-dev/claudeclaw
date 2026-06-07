import { signal, effect } from '@preact/signals';

/** Light/dark canvas mode. Sets the background, card, text, and border
 *  CSS variables. Independent from the accent palette. */
export type ThemeMode = 'dark' | 'light';

/** Accent palette. Sets the --color-accent / -hover / -soft variables.
 *  Independent from light/dark mode — so you can have Light + Midnight or
 *  Dark + Crimson, etc. */
export type ThemeAccent = 'graphite' | 'midnight' | 'crimson';

/** Backwards-compatible name kept for callers that still import it. The
 *  old single-key theme was either graphite|midnight|crimson (all dark)
 *  or light (light+graphite). New code should prefer { mode, accent }. */
export type ThemeName = ThemeAccent | 'light';

const MODE_KEY = 'claudeclaw.theme.mode';
const ACCENT_KEY = 'claudeclaw.theme.accent';
const LEGACY_THEME_KEY = 'claudeclaw.theme'; // pre-split single-axis key
const CUSTOM_ACCENT_KEY = 'claudeclaw.theme.customAccent';
const SCALE_KEY = 'claudeclaw.uiScale';
const SHOW_COSTS_KEY = 'claudeclaw.showCosts';

function loadInitialMode(): ThemeMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === 'dark' || m === 'light') return m;
    // Migrate from legacy single-axis key. Old 'light' → light mode.
    // 'graphite' / 'midnight' / 'crimson' → dark mode.
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light') return 'light';
  } catch {}
  return 'dark';
}

function loadInitialAccent(): ThemeAccent {
  try {
    const a = localStorage.getItem(ACCENT_KEY);
    if (a === 'graphite' || a === 'midnight' || a === 'crimson') return a;
    // Migrate from legacy single-axis key. 'graphite' / 'midnight' /
    // 'crimson' map straight across; 'light' was light+graphite.
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'graphite' || legacy === 'midnight' || legacy === 'crimson') return legacy;
  } catch {}
  return 'graphite';
}

function loadCustomAccent(): string | null {
  try {
    const v = localStorage.getItem(CUSTOM_ACCENT_KEY);
    if (v && /^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  } catch {}
  return null;
}

function loadScale(): number {
  try {
    const v = parseFloat(localStorage.getItem(SCALE_KEY) || '');
    if (Number.isFinite(v) && v >= 0.8 && v <= 1.6) return v;
  } catch {}
  return 1.0;
}

function loadShowCosts(): boolean {
  try {
    const v = localStorage.getItem(SHOW_COSTS_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch {}
  return false;
}

export const mode = signal<ThemeMode>(loadInitialMode());
export const accent = signal<ThemeAccent>(loadInitialAccent());

/** Backwards-compatible single-signal shim. Reads return the closest
 *  legacy theme name; writes split into mode + accent. Kept so existing
 *  imports (`theme`, `setTheme`, `themeMeta`) keep working. */
export const theme = signal<ThemeName>(deriveLegacyName(mode.value, accent.value));
effect(() => { theme.value = deriveLegacyName(mode.value, accent.value); });

function deriveLegacyName(m: ThemeMode, a: ThemeAccent): ThemeName {
  if (m === 'light') return 'light';
  return a; // dark + accent → just the accent name
}

/** Custom accent override (hex). When set, it overrides the active
 *  accent palette's --color-accent (and derives --color-accent-soft /
 *  -hover from it) via inline style on <html>. Null restores default. */
export const customAccent = signal<string | null>(loadCustomAccent());

/** Global UI zoom factor. Applied via CSS `zoom` on root. */
export const uiScale = signal<number>(loadScale());

/** Whether to surface per-agent / per-session cost figures. */
export const showCosts = signal<boolean>(loadShowCosts());

export const modeMeta: Record<ThemeMode, { label: string; swatch: string }> = {
  dark:  { label: 'Dark',  swatch: '#1a1a1c' },
  light: { label: 'Light', swatch: '#ffffff' },
};

export const accentMeta: Record<ThemeAccent, { label: string; swatch: string }> = {
  graphite: { label: 'Graphite', swatch: '#8b8af0' },
  midnight: { label: 'Midnight', swatch: '#5eb6ff' },
  crimson:  { label: 'Crimson',  swatch: '#ff5e6e' },
};

/** Backwards-compatible meta — exposed by name like the old single-axis
 *  picker. Kept so any caller still using `themeMeta` keeps working. */
export const themeMeta: Record<ThemeName, { label: string; swatch: string }> = {
  graphite: accentMeta.graphite,
  midnight: accentMeta.midnight,
  crimson:  accentMeta.crimson,
  light:    modeMeta.light,
};

// Apply mode + accent to <html> whenever signals change. Persist each.
effect(() => {
  const m = mode.value;
  document.documentElement.setAttribute('data-mode', m);
  try { localStorage.setItem(MODE_KEY, m); } catch {}
});

effect(() => {
  const a = accent.value;
  document.documentElement.setAttribute('data-accent', a);
  try { localStorage.setItem(ACCENT_KEY, a); } catch {}
});

effect(() => {
  const acc = customAccent.value;
  const root = document.documentElement;
  if (acc) {
    root.style.setProperty('--color-accent', acc);
    root.style.setProperty(
      '--color-accent-soft',
      `color-mix(in srgb, ${acc} 18%, transparent)`,
    );
    root.style.setProperty('--color-accent-hover', shadeHex(acc, mode.value === 'light' ? -15 : 10));
    try { localStorage.setItem(CUSTOM_ACCENT_KEY, acc); } catch {}
  } else {
    root.style.removeProperty('--color-accent');
    root.style.removeProperty('--color-accent-soft');
    root.style.removeProperty('--color-accent-hover');
    try { localStorage.removeItem(CUSTOM_ACCENT_KEY); } catch {}
  }
});

effect(() => {
  const s = uiScale.value;
  document.documentElement.style.zoom = String(s);
  try { localStorage.setItem(SCALE_KEY, String(s)); } catch {}
});

effect(() => {
  try { localStorage.setItem(SHOW_COSTS_KEY, showCosts.value ? 'on' : 'off'); } catch {}
});

export function setMode(next: ThemeMode) {
  mode.value = next;
}

export function setAccent(next: ThemeAccent) {
  accent.value = next;
}

/** Backwards-compatible setter. Accepts the legacy single-key form. */
export function setTheme(next: ThemeName) {
  if (next === 'light') {
    mode.value = 'light';
  } else {
    mode.value = 'dark';
    accent.value = next;
  }
}

export function setCustomAccent(hex: string | null) {
  if (hex && !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  customAccent.value = hex ? hex.toLowerCase() : null;
}

export function setUiScale(next: number) {
  uiScale.value = Math.max(0.8, Math.min(1.6, next));
}

export function setShowCosts(next: boolean) {
  showCosts.value = next;
}

// Lighten/darken a hex color by `pct` percent (-100..100). Used to
// derive the hover variant from the user's accent.
function shadeHex(hex: string, pct: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct) / 100;
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
