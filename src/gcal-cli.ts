#!/usr/bin/env node
/**
 * ClaudeClaw Google Calendar CLI
 *
 * Mirrors the Gmail CLI pattern. Used by Nikki (the Telegram bot) via the
 * Bash tool to pull calendar data without needing a stdio MCP server.
 *
 * Uses GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET +
 * GOOGLE_REFRESH_TOKEN (falls back to GMAIL_REFRESH_TOKEN — same Google
 * OAuth token works for both APIs as long as the calendar scopes were
 * authorized via src/gmail-auth.ts).
 *
 * Commands:
 *   node dist/gcal-cli.js today                    today's events
 *   node dist/gcal-cli.js week                     next 7 days
 *   node dist/gcal-cli.js list-events --from "2026-06-04" --to "2026-06-11"
 *                                                  custom range
 *   node dist/gcal-cli.js get-event <eventId>      one event in full
 *   node dist/gcal-cli.js calendars                list connected calendars
 *   node dist/gcal-cli.js status                   verify auth
 *
 * Optional flags:
 *   --calendar <id>     calendar id (default: "primary")
 *   --max <n>           max events (default: 25)
 *
 * All commands print clean JSON to stdout. Errors print JSON to stderr
 * and exit non-zero.
 */

import { OAuth2Client } from 'google-auth-library';
import { google, type calendar_v3 } from 'googleapis';

import { readEnvFile } from './env.js';

// ── OAuth client (lazy singleton) ────────────────────────────────────

let cachedClient: OAuth2Client | null = null;

function getOAuthClient(): OAuth2Client {
  if (cachedClient) return cachedClient;

  const env = readEnvFile([
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'GMAIL_REFRESH_TOKEN',
  ]);
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  // GOOGLE_REFRESH_TOKEN is the new name (covers all scopes); we fall back to
  // GMAIL_REFRESH_TOKEN so this works the moment Dante re-auths even if he
  // doesn't update the secret name.
  const refreshToken =
    process.env.GOOGLE_REFRESH_TOKEN || env.GOOGLE_REFRESH_TOKEN ||
    process.env.GMAIL_REFRESH_TOKEN || env.GMAIL_REFRESH_TOKEN || '';

  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth not configured: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET missing.',
    );
  }
  if (!refreshToken) {
    throw new Error(
      'GOOGLE_REFRESH_TOKEN / GMAIL_REFRESH_TOKEN is not set. Run `npx tsx src/gmail-auth.ts` locally to mint one with calendar scopes.',
    );
  }

  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  cachedClient = client;
  return client;
}

function getCalendarApi(): calendar_v3.Calendar {
  return google.calendar({ version: 'v3', auth: getOAuthClient() });
}

// ── Helpers ──────────────────────────────────────────────────────────

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function getNumFlag(name: string, fallback: number): number {
  const v = getFlag(name);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function positional(): string[] {
  const FLAGS = new Set(['calendar', 'max', 'from', 'to']);
  const skip = new Set<number>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--') && FLAGS.has(a.slice(2))) {
      skip.add(i); skip.add(i + 1);
    }
  }
  return process.argv.filter((_, i) => i >= 2 && !skip.has(i));
}

function out(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function fail(message: string, code = 1): never {
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + '\n');
  process.exit(code);
}

// Format a Google Calendar event into a Nikki-friendly compact shape.
function fmtEvent(e: calendar_v3.Schema$Event): Record<string, unknown> {
  const start = e.start?.dateTime || e.start?.date || null;
  const end = e.end?.dateTime || e.end?.date || null;
  return {
    id: e.id,
    title: e.summary,
    description: e.description ? e.description.slice(0, 500) : null,
    location: e.location,
    start,
    end,
    allDay: !!e.start?.date && !e.start?.dateTime,
    status: e.status,
    organizer: e.organizer?.email,
    attendees: (e.attendees || []).map(a => ({ email: a.email, name: a.displayName, response: a.responseStatus })),
    hangoutLink: e.hangoutLink,
    htmlLink: e.htmlLink,
    recurringEventId: e.recurringEventId,
  };
}

// ── Commands ─────────────────────────────────────────────────────────

async function cmdToday(): Promise<void> {
  const calendarId = getFlag('calendar') || 'primary';
  const max = getNumFlag('max', 25);
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  await listRange(calendarId, start, end, max, "today");
}

async function cmdWeek(): Promise<void> {
  const calendarId = getFlag('calendar') || 'primary';
  const max = getNumFlag('max', 50);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  await listRange(calendarId, start, end, max, "next 7 days");
}

async function cmdListEvents(): Promise<void> {
  const calendarId = getFlag('calendar') || 'primary';
  const max = getNumFlag('max', 25);
  const fromStr = getFlag('from');
  const toStr = getFlag('to');
  if (!fromStr || !toStr) fail('list-events requires --from and --to (ISO date or YYYY-MM-DD)');
  const start = new Date(fromStr!);
  const end = new Date(toStr!);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) fail('--from / --to must be valid dates');
  await listRange(calendarId, start, end, max, `${fromStr} to ${toStr}`);
}

async function listRange(calendarId: string, start: Date, end: Date, max: number, label: string): Promise<void> {
  const cal = getCalendarApi();
  try {
    const r = await cal.events.list({
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: max,
    });
    const events = (r.data.items || []).map(fmtEvent);
    out({ ok: true, calendarId, range: label, count: events.length, events });
  } catch (err) {
    fail(`list events failed: ${(err as Error).message}`);
  }
}

async function cmdGetEvent(eventId: string): Promise<void> {
  if (!eventId) fail('event id required');
  const calendarId = getFlag('calendar') || 'primary';
  const cal = getCalendarApi();
  try {
    const r = await cal.events.get({ calendarId, eventId });
    out({ ok: true, event: fmtEvent(r.data) });
  } catch (err) {
    fail(`get event failed: ${(err as Error).message}`);
  }
}

async function cmdCalendars(): Promise<void> {
  const cal = getCalendarApi();
  try {
    const r = await cal.calendarList.list();
    const calendars = (r.data.items || []).map(c => ({
      id: c.id, summary: c.summary, primary: !!c.primary, accessRole: c.accessRole, timeZone: c.timeZone,
    }));
    out({ ok: true, count: calendars.length, calendars });
  } catch (err) {
    fail(`list calendars failed: ${(err as Error).message}`);
  }
}

async function cmdStatus(): Promise<void> {
  try {
    const cal = getCalendarApi();
    const r = await cal.calendarList.list({ maxResults: 1 });
    const primary = (r.data.items || []).find(c => c.primary);
    out({ ok: true, authorized: true, primaryCalendar: primary?.id || null });
  } catch (err) {
    fail(`status failed: ${(err as Error).message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pos = positional();
  const command = pos[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`Google Calendar CLI

  node dist/gcal-cli.js today                                today's events on primary calendar
  node dist/gcal-cli.js week                                 next 7 days
  node dist/gcal-cli.js list-events --from DATE --to DATE    custom range (ISO date or YYYY-MM-DD)
  node dist/gcal-cli.js get-event EVENT_ID                   one event in full
  node dist/gcal-cli.js calendars                            list your calendars
  node dist/gcal-cli.js status                               verify auth

Flags:
  --calendar ID   non-primary calendar (default: primary)
  --max N         max events to return (default: 25)
`);
    process.exit(0);
  }

  try {
    if (command === 'today') await cmdToday();
    else if (command === 'week') await cmdWeek();
    else if (command === 'list-events') await cmdListEvents();
    else if (command === 'get-event') await cmdGetEvent(pos[1]);
    else if (command === 'calendars') await cmdCalendars();
    else if (command === 'status') await cmdStatus();
    else fail(`unknown command: ${command}`);
  } catch (err) {
    fail((err as Error).message);
  }
}

main().catch(err => fail(err.message));
