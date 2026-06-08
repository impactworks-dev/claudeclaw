// Central person resolver — given any handle (phone or email), returns
// what Nikki knows about them: name, relationship, organization, notes.
//
// Two data sources, in priority order:
//   1. relay/people-map.json   — manually curated, has relationships
//   2. relay/contacts.json     — exported vCard, has names + handles only
//
// Both files live in the repo and ship to Fly with each deploy. We watch
// mtime and reload — no server restart needed when you edit them.

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';

const PEOPLE_MAP_PATH = path.join(PROJECT_ROOT, 'relay', 'people-map.json');
const CONTACTS_PATH = path.join(PROJECT_ROOT, 'relay', 'contacts.json');

export interface Person {
  name: string;
  relationship?: string;
  org?: string;
  notes?: string;
  source: 'people-map' | 'contacts';
}

// Relationship category — used for grouping/prioritization in briefs.
export type RelationshipCategory =
  | 'family'
  | 'inner-circle'
  | 'self'
  | 'client'
  | 'vendor'
  | 'professional'
  | 'community'
  | 'business-line'
  | 'other';

interface PeopleMapEntry {
  name?: string;
  relationship?: string;
  org?: string;
  notes?: string;
}

interface Contact {
  name: string;
  org?: string | null;
  phones?: string[];
  emails?: string[];
}

// ---- handle normalization ----
// Phone: digits + leading +, OR last-10 fallback for US numbers.
// Email: lowercased, trimmed, no Plus suffix stripping (we want
// dante+ai@impactworks.com to be distinct from dante@impactworks.com).
function normalize(handle: string | null | undefined): string {
  if (!handle) return '';
  const s = String(handle).replace(/\([^)]*\)$/, '').trim();
  if (s.includes('@')) return s.toLowerCase();
  return s.replace(/[^\d+]/g, '');
}

function last10(s: string | null | undefined): string {
  return String(s || '').replace(/[^\d]/g, '').slice(-10);
}

// ---- in-memory cache with mtime watcher ----
interface ResolverCache {
  peopleMap: Record<string, PeopleMapEntry | string>;
  byHandle: Map<string, Person>;
  byLast10: Map<string, Person>;
  peopleMapMtime: number;
  contactsMtime: number;
}

let cache: ResolverCache | null = null;

function loadFile<T>(p: string, fallback: T): { data: T; mtime: number } {
  try {
    const stat = fs.statSync(p);
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
    return { data, mtime: stat.mtimeMs };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err: String((e as Error).message), file: p }, 'people-resolver: file read failed');
    }
    return { data: fallback, mtime: 0 };
  }
}

function rebuild(): ResolverCache {
  const pmLoaded = loadFile<Record<string, PeopleMapEntry | string>>(PEOPLE_MAP_PATH, {});
  const cLoaded = loadFile<Contact[]>(CONTACTS_PATH, []);

  const byHandle = new Map<string, Person>();
  const byLast10 = new Map<string, Person>();

  // Pass 1: people-map (relationships, highest priority)
  for (const [rawHandle, entry] of Object.entries(pmLoaded.data)) {
    if (rawHandle.startsWith('_')) continue;  // comment keys
    const handle = normalize(rawHandle);
    if (!handle) continue;
    const e = typeof entry === 'string' ? { name: entry } : entry;
    if (!e?.name) continue;
    const person: Person = {
      name: e.name,
      source: 'people-map',
      ...(e.relationship ? { relationship: e.relationship } : {}),
      ...(e.org ? { org: e.org } : {}),
      ...(e.notes ? { notes: e.notes } : {}),
    };
    byHandle.set(handle, person);
    const l = last10(handle);
    if (l.length === 10 && !byLast10.has(l)) byLast10.set(l, person);
  }

  // Pass 2: contacts.json (just names, lower priority, only fills gaps)
  for (const c of cLoaded.data) {
    if (!c?.name) continue;
    const person: Person = {
      name: c.name,
      source: 'contacts',
      ...(c.org ? { org: c.org } : {}),
    };
    for (const ph of (c.phones || [])) {
      const h = normalize(ph);
      if (h && !byHandle.has(h)) byHandle.set(h, person);
      const l = last10(ph);
      if (l.length === 10 && !byLast10.has(l)) byLast10.set(l, person);
    }
    for (const em of (c.emails || [])) {
      const h = normalize(em);
      if (h && !byHandle.has(h)) byHandle.set(h, person);
    }
  }

  return {
    peopleMap: pmLoaded.data,
    byHandle,
    byLast10,
    peopleMapMtime: pmLoaded.mtime,
    contactsMtime: cLoaded.mtime,
  };
}

function ensureFresh(): ResolverCache {
  if (!cache) {
    cache = rebuild();
    return cache;
  }
  try {
    const pmStat = fs.statSync(PEOPLE_MAP_PATH);
    const cStat = fs.statSync(CONTACTS_PATH);
    if (pmStat.mtimeMs !== cache.peopleMapMtime || cStat.mtimeMs !== cache.contactsMtime) {
      cache = rebuild();
    }
  } catch { /* mtime check failed — keep current cache */ }
  return cache;
}

// ---- public API ----

/**
 * Resolve any handle (phone, email, or contact-like string) to a Person
 * record. Returns null if the handle is unknown.
 */
export function resolvePerson(handle: string | null | undefined): Person | null {
  if (!handle) return null;
  const c = ensureFresh();
  const norm = normalize(handle);
  if (c.byHandle.has(norm)) return c.byHandle.get(norm)!;
  const l = last10(handle);
  if (l.length === 10 && c.byLast10.has(l)) return c.byLast10.get(l)!;
  return null;
}

/**
 * Classify a person into a high-level category for grouping/prioritization
 * in briefs. Uses the relationship text + heuristics.
 */
export function categorize(person: Person | null): RelationshipCategory {
  if (!person) return 'other';
  const r = (person.relationship || '').toLowerCase();
  if (r === 'self' || r.startsWith('self ')) return 'self';
  if (r.includes('business line') || r.includes('business alias')) return 'business-line';
  if (/wife|husband|spouse|son|daughter|stepson|stepdaughter|mother|father|sister|brother|aunt|uncle|cousin|grand|mother-in-law|father-in-law|in-law|child|parent|sibling/.test(r)) return 'family';
  if (/close friend|best friend|mentor|cofounder|business partner|partner/.test(r)) return 'inner-circle';
  if (r === 'client' || r.includes('client')) return 'client';
  if (/vendor|supplier|contractor/.test(r)) return 'vendor';
  if (/accountant|lawyer|doctor|therapist|advisor|attorney|banker|cpa/.test(r)) return 'professional';
  if (/friend|colleague|associate/.test(r)) return 'inner-circle';
  if (/neighbor|community/.test(r)) return 'community';
  return 'other';
}

/**
 * One-line render of a person for inline display (e.g. "Audra (wife)").
 * Returns the raw handle if person is null so callers don't have to branch.
 */
export function displayName(handle: string, person?: Person | null): string {
  const p = person !== undefined ? person : resolvePerson(handle);
  if (!p) return handle;
  if (p.relationship) return `${p.name} (${p.relationship})`;
  return p.name;
}

/**
 * Convenience: resolve and render in one call. Useful in templates.
 */
export function resolveAndRender(handle: string | null | undefined): string {
  if (!handle) return '';
  const p = resolvePerson(handle);
  return displayName(handle, p);
}

/**
 * Force a cache rebuild — exposed for tests or admin endpoints.
 */
export function invalidateResolverCache(): void {
  cache = null;
}

/**
 * Summary stats — useful for an admin endpoint to confirm the resolver
 * loaded both data files correctly on deploy.
 */
export function resolverStats(): {
  peopleMapEntries: number;
  contactHandles: number;
  totalHandles: number;
  peopleMapMtime: number;
  contactsMtime: number;
} {
  const c = ensureFresh();
  const pm = Object.keys(c.peopleMap).filter(k => !k.startsWith('_')).length;
  const peopleMapHandles = [...c.byHandle.values()].filter(p => p.source === 'people-map').length;
  const contactHandles = c.byHandle.size - peopleMapHandles;
  return {
    peopleMapEntries: pm,
    contactHandles,
    totalHandles: c.byHandle.size,
    peopleMapMtime: c.peopleMapMtime,
    contactsMtime: c.contactsMtime,
  };
}
