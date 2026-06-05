// Google Calendar data layer for the Founder Dashboard.
//
// Thin wrapper around dist/gcal-cli.js that the dashboard server calls. CLI
// already returns clean JSON, so this file mostly caches + shapes for UI.
//
// Cache: 2 minutes — calendar moves intra-day (new invites, declines) but
// not constantly. Refresh button bypasses with ?force=1.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const GCAL_CLI = path.join(PROJECT_ROOT, 'dist', 'gcal-cli.js');
const TTL_MS = 2 * 60 * 1000;

export interface CalEvent {
  id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start: string | null;        // ISO
  end: string | null;
  allDay: boolean;
  status: string | null;
  organizer: string | null;
  attendees: Array<{ email: string | null; name: string | null; response: string | null }>;
  hangoutLink: string | null;
  htmlLink: string | null;
}

export interface CalendarSummary {
  asOf: number;
  configured: boolean;
  connectionStatus: 'ok' | 'no-credentials' | 'error';
  connectionMessage: string | null;
  range: 'today' | 'week';
  count: number;
  events: CalEvent[];
}

let cache: { asOf: number; range: 'today' | 'week'; data: CalendarSummary } | null = null;

async function pullEvents(range: 'today' | 'week'): Promise<CalendarSummary> {
  const asOf = Date.now();
  try {
    const { stdout } = await execFileAsync('node', [GCAL_CLI, range], {
      env: { ...process.env },
      maxBuffer: 8 * 1024 * 1024,
    });
    const j = JSON.parse(stdout);
    if (!j.ok) {
      return {
        asOf, configured: true, connectionStatus: 'error',
        connectionMessage: j.error || 'unknown error', range, count: 0, events: [],
      };
    }
    return {
      asOf, configured: true, connectionStatus: 'ok', connectionMessage: null,
      range, count: j.count || 0, events: (j.events || []) as CalEvent[],
    };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    const noCreds = /not.set|not configured|REFRESH_TOKEN/i.test(msg);
    logger.warn({ err: msg }, 'calendar-data: gcal-cli failed');
    return {
      asOf,
      configured: !noCreds,
      connectionStatus: noCreds ? 'no-credentials' : 'error',
      connectionMessage: msg.slice(0, 200),
      range, count: 0, events: [],
    };
  }
}

export async function getCalendarData(opts: { range?: 'today' | 'week'; force?: boolean } = {}): Promise<CalendarSummary> {
  const range = opts.range || 'today';
  if (!opts.force && cache && cache.range === range && Date.now() - cache.asOf < TTL_MS) {
    return cache.data;
  }
  const data = await pullEvents(range);
  cache = { asOf: data.asOf, range, data };
  return data;
}

export function invalidateCalendarCache(): void { cache = null; }
