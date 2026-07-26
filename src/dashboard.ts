import { Api, RawApi } from 'grammy';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';

import fs from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENT_ID, ALLOWED_CHAT_ID, DASHBOARD_PORT, DASHBOARD_TOKEN, DASHBOARD_URL, MESSENGER_TYPE, PROJECT_ROOT, STORE_DIR, WHATSAPP_ENABLED, SLACK_USER_TOKEN, CONTEXT_LIMIT, agentDefaultModel, GOOGLE_API_KEY } from './config.js';
import { readEnvFile } from './env.js';
import crypto from 'crypto';
import { getPrimaryContactReview, savePrimaryContactSelection } from './primary-contacts-data.js';

const execFileAsync = promisify(execFile);
import {
  getAllScheduledTasks,
  deleteScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  updateScheduledTask,
  getConversationPage,
  getDashboardMemoryStats,
  getDashboardPinnedMemories,
  getDashboardLowSalienceMemories,
  getDashboardTopAccessedMemories,
  getDashboardMemoryTimeline,
  getDashboardConsolidations,
  getDashboardMemoriesList,
  getDashboardTokenStats,
  getDashboardCostTimeline,
  getDashboardRecentTokenUsage,
  getSession,
  getSessionTokenUsage,
  getHiveMindEntries,
  getAgentTokenStats,
  getAgentRecentConversation,
  getMissionTasks,
  getMissionTask,
  createMissionTask,
  cancelMissionTask,
  deleteMissionTask,
  reassignMissionTask,
  assignMissionTask,
  updateMissionTaskTimeout,
  getUnassignedMissionTasks,
  getMissionTaskHistory,
  getAuditLog,
  getAuditLogCount,
  getRecentBlockedActions,
  listActiveMeetSessions,
  listRecentMeetSessions,
  getMeetSession,
  type MeetSession,
  createWarRoomMeeting,
  endWarRoomMeeting,
  addWarRoomTranscript,
  getWarRoomMeetings,
  getWarRoomTranscript,
  createTextMeeting,
  getTextMeeting,
  setMeetingPin,
  getOpenTextMeetingIds,
  getTextMeetings,
  clearMeetingSessions,
  setDashboardSetting,
  getAllDashboardSettings,
  insertAgentSuggestion,
  listActiveAgentSuggestions,
  dismissAgentSuggestion,
  markAgentSuggestionActed,
  getRecentlySuggestedSplits,
  insertAuditLog,
} from './db.js';
import * as killSwitches from './kill-switches.js';
import { getWarRoomTextHtml } from './warroom-text-html.js';
import { handleTextTurn, cancelMeetingTurns, getRoster, warmupMeeting, isWarmupDone, getActiveTurnIds, waitForMeetingTurnsIdle } from './warroom-text-orchestrator.js';
import { getChannel, closeChannel, startChannelSweeper } from './warroom-text-events.js';
import { messageQueue } from './message-queue.js';
import { extractViaClaude } from './memory-ingest.js';
const WARROOM_TEXT_ID_RE = /^wr_[a-z0-9_]{4,64}$/i;
const CLIENT_MSG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
import { generateContent, parseJsonResponse } from './gemini.js';
import { computeNextRun } from './scheduler.js';
import { getSecurityStatus } from './security.js';
import {
  listAgentIds,
  loadAgentConfig,
  setAgentModel,
  setAgentDescription,
  getMainDescription,
  setMainDescription,
} from './agent-config.js';
import {
  listTemplates,
  validateAgentId,
  validateBotToken,
  createAgent,
  activateAgent,
  deactivateAgent,
  restartAgent,
  deleteAgent,
  suggestBotNames,
  isAgentRunning,
} from './agent-create.js';
import { dispatchDashboardChatToAgent, processMessageFromDashboard } from './bot.js';
import { getDashboardHtml } from './dashboard-html.js';
import { getPipelineData, updateCard, updateDealSubStage, createLocalLead, updateLocalLead, deleteLocalLead, BRANDS, SUB_STAGES } from './pipeline-data.js';
import { getOutreachData, setOutreachStatus } from './outreach-data.js';
import { getWebinarsData, setWebinarDisposition } from './webinars-data.js';
import { getMembersData, addMember, updateMember } from './members-data.js';
import { getCashData, createLinkToken, exchangePublicToken } from './cash-data.js';
import { getQbData } from './qb-data.js';
import { getStocksData, invalidateStocksCache } from './stocks-data.js';
import { loadTickers, addTicker, removeTicker } from './stocks-tickers.js';
import { getStockHistory, type Period } from './stocks-history.js';
import { getNewsData } from './news-data.js';
import { getWeather } from './weather-data.js';
import { getCleanedRevenue } from './vendasta-revenue.js';
import { getCalendarData, invalidateCalendarCache } from './calendar-data.js';
import { getVendastaData, invalidateVendastaCache } from './vendasta-data.js';
import { runBackup } from './backup.js';
import { getLatestDailyBrief, getRecentDailyBriefs, markBriefUserAction, getDailyBrief, getRecentProactiveAlerts, dismissAlert, snoozeAlert, saveStructuredMemory, pinMemory, getJournalEntry, saveJournalEntry, getRecentJournalEntries, getJournalStreak, logMeditationSession, getPersonalMemories } from './db.js';
import { generateBriefPreview } from './daily-brief.js';
import { runHeartbeatScan, runMoneyIdeas } from './heartbeat.js';
import { getInbox, getThread, invalidateInboxCache } from './email-data.js';
import { synthesizeSpeech } from './voice.js';
import { getElevenLabsVoiceId, setElevenLabsVoiceId } from './voice-config.js';
import { getBrainStats, listNotes, getNote, searchNotes, getGraph, invalidateBrainCache } from './brain-data.js';
import { getBrainProposals, invalidateProposalsCache, getMemoriesForTopic, updateMemoryTopics, removeTopicFromMemory, mergeTopics, updateMemorySummary } from './brain-proposals.js';
import { importCsv, deleteManualAccount, loadManualAccounts } from './manual-cash-data.js';
import { getFounderDashboard } from './founder-data.js';
import { getWarRoomHtml } from './warroom-html.js';
import { WARROOM_ENABLED, WARROOM_PORT } from './config.js';
import { logger } from './logger.js';
import { getTelegramConnected, getBotInfo, chatEvents, getIsProcessing, abortActiveQuery, ChatEvent, readAgentConnState } from './state.js';

async function classifyTaskAgent(prompt: string): Promise<string | null> {
  try {
    const agentIds = listAgentIds();
    const agentDescriptions = agentIds.map((id) => {
      try {
        const config = loadAgentConfig(id);
        return `- ${id}: ${config.description}`;
      } catch { return `- ${id}: (no description)`; }
    });

    const classificationPrompt = `Given these agents and their roles:
- main: Primary assistant, general tasks, anything that doesn't clearly fit another agent
${agentDescriptions.join('\n')}

Which ONE agent is best suited for this task?
Task: "${prompt.slice(0, 500)}"

Reply with JSON: {"agent": "agent_id"}`;

    const response = await generateContent(classificationPrompt);
    const parsed = parseJsonResponse<{ agent: string }>(response);
    if (parsed?.agent) {
      const validAgents = ['main', ...agentIds];
      if (validAgents.includes(parsed.agent)) return parsed.agent;
    }
    return 'main'; // fallback
  } catch (err) {
    logger.error({ err }, 'Auto-assign classification failed');
    return null;
  }
}

// Plaid Link bootstrap HTML. Loads Plaid's official Link JS, generates a
// link_token via /api/cash/link-token, opens the Link modal, and on success
// posts the public_token to /api/cash/exchange for permanent storage.
function plaidConnectHtml(): string {
  // Build identifier — bump when this function changes so we can confirm
  // the running process picked up the latest source. Visible in HTML source
  // and as <meta name="build"> for quick diagnostic checks.
  const BUILD_ID = 'plaidConnect-v3-oauth-2026-05-26';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connect a Bank</title>
<meta name="build" content="${BUILD_ID}">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0f1115; color: #e5e7eb; margin: 0; padding: 0; }
  .wrap { max-width: 520px; margin: 80px auto; padding: 24px; background: #151821; border: 1px solid #232838; border-radius: 12px; }
  h1 { font-size: 20px; margin: 0 0 8px 0; }
  p { color: #9ca3af; line-height: 1.5; }
  button { background: #2563eb; color: white; border: 0; padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status { margin-top: 16px; font-size: 13px; color: #9ca3af; min-height: 20px; }
  .ok { color: #16a34a; }
  .err { color: #dc2626; }
  code { background: #232838; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
</style>
</head><body>
<div class="wrap">
  <h1>Connect a Bank</h1>
  <p>This opens Plaid Link in a modal. Search for <strong>Novo</strong> (or any institution), sign in, and authorize the read-only connection. Your credentials go directly to Plaid — never to this server.</p>
  <button id="connect" disabled>Initializing…</button>
  <div class="status" id="status"></div>
</div>
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
<script>
(async () => {
  const status = document.getElementById('status');
  const btn = document.getElementById('connect');
  function setStatus(msg, cls) { status.textContent = msg; status.className = 'status ' + (cls || ''); }

  // The Mission Control API gates every /api/* route behind ?token=. We
  // accept the token from (1) the URL query string, then (2) localStorage
  // (where the SPA caches it on first load), and (3) fall through with
  // an empty string — the API will then 401 with a clear message.
  function resolveToken() {
    try {
      const url = new URL(window.location.href);
      const t = url.searchParams.get('token');
      if (t) { try { localStorage.setItem('claudeclaw.token', t); } catch {} return t; }
    } catch {}
    try { return localStorage.getItem('claudeclaw.token') || ''; } catch { return ''; }
  }
  function withTok(path) {
    const tok = resolveToken();
    if (!tok) return path;
    return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(tok);
  }

  // OAuth round-trip support. When Plaid Link redirects the user to Novo
  // (or any OAuth bank), Novo returns the user to this page with an
  // oauth_state_id in the URL. We must then re-initialize Plaid Link with
  // the same link_token and received_redirect_uri to complete the flow.
  // We stash link_token in sessionStorage so it survives the redirect.
  const url = new URL(window.location.href);
  const oauthStateId = url.searchParams.get('oauth_state_id');
  const isReturningFromOauth = !!oauthStateId;
  // Plaid requires the redirect_uri sent in /link/token/create to match an
  // entry in the dashboard's "Allowed redirect URIs" EXACTLY (including
  // query string). We register and send the clean URL with no query string.
  // The dashboard token persists via localStorage (set by the SPA on first
  // visit) and the Mission Control session, so we don't need to thread it
  // through the OAuth redirect.
  const redirectUri = window.location.origin + window.location.pathname;

  function buildHandler(linkToken, opts) {
    return Plaid.create({
      token: linkToken,
      receivedRedirectUri: opts && opts.receivedRedirectUri || undefined,
      onSuccess: async (public_token, metadata) => {
        setStatus('Authorizing…');
        try {
          const er = await fetch(withTok('/api/cash/exchange'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token, institution_name: metadata.institution?.name || 'Bank' }),
          });
          const ej = await er.json();
          if (!er.ok) throw new Error(ej.error || 'exchange failed');
          try { sessionStorage.removeItem('claudeclaw.plaid.linkToken'); } catch {}
          setStatus('Connected: ' + (metadata.institution?.name || 'Bank') + ' — close this window and refresh the Cash page.', 'ok');
        } catch (e) { setStatus('Error: ' + e.message, 'err'); }
      },
      onExit: (err) => {
        if (err) setStatus('Closed: ' + (err.error_message || err.error_code), 'err');
      },
    });
  }

  try {
    let handler;
    if (isReturningFromOauth) {
      // We came back from Novo/etc. Pull the saved link_token and resume.
      let saved = '';
      try { saved = sessionStorage.getItem('claudeclaw.plaid.linkToken') || ''; } catch {}
      if (!saved) throw new Error('OAuth return but no saved link_token (sessionStorage cleared?)');
      setStatus('Completing OAuth handoff…');
      handler = buildHandler(saved, { receivedRedirectUri: window.location.href });
      // Auto-open so the user doesn't have to click again after the redirect.
      handler.open();
      btn.disabled = false;
      btn.textContent = 'Resume Plaid Link';
      btn.onclick = () => { setStatus(''); handler.open(); };
    } else {
      const r = await fetch(withTok('/api/cash/link-token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uri: redirectUri }),
      });
      if (!r.ok) throw new Error('link-token: ' + r.status + (r.status === 401 ? ' (missing ?token= in URL — open this page via the Cash tab\\'s Connect button)' : ''));
      const { link_token, error } = await r.json();
      if (error) throw new Error(error);
      try { sessionStorage.setItem('claudeclaw.plaid.linkToken', link_token); } catch {}
      handler = buildHandler(link_token);
      btn.disabled = false;
      btn.textContent = 'Open Plaid Link';
      btn.onclick = () => { setStatus(''); handler.open(); };
    }
  } catch (e) {
    setStatus('Init failed: ' + e.message, 'err');
  }
})();
</script>
</body></html>`;
}

// Constant-time token comparison (audit fix A4E-1, ported from osrepo PR #51).
// Plain `===` leaks timing info that lets a remote attacker recover the token
// one byte at a time. timingSafeEqual takes O(n) regardless of where the
// mismatch occurs. Length pre-check prevents a panic on differing buffers.
function safeTokenEqual(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// Inline token check for handlers that USED to rely on the global middleware
// but now serve the public SPA shell on the same Hono app. Legacy HTML routes
// that embed DASHBOARD_TOKEN in their response body still require this.
function requireToken(c: { req: { query: (k: string) => string | undefined } }): Response | null {
  const token = c.req.query('token');
  if (!safeTokenEqual(token, DASHBOARD_TOKEN)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

export function startDashboard(botApi?: Api<RawApi>): void {
  if (!DASHBOARD_TOKEN) {
    logger.info('DASHBOARD_TOKEN not set, dashboard disabled');
    return;
  }

  const app = new Hono();

  // CORS headers for cross-origin access (Cloudflare tunnel, mobile browsers).
  // Reflect Origin only when it matches a known-good host (audit fix A4E-3,
  // ported from osrepo PR #51). Wildcard `*` is functionally equivalent to
  // "trust anyone" for credentialed reads of authenticated endpoints; pinning
  // to an allowlist closes that surface.
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin) {
      try {
        const host = new URL(origin).hostname;
        const dashHost = DASHBOARD_URL ? new URL(DASHBOARD_URL).hostname : '';
        const allowed =
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '[::1]' ||
          (!!dashHost && host === dashHost) ||
          host.endsWith('.trycloudflare.com');
        if (allowed) {
          c.header('Access-Control-Allow-Origin', origin);
          c.header('Vary', 'Origin');
        }
      } catch { /* malformed Origin — emit no header */ }
    }
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // Global error handler — prevents unhandled throws from killing the server
  app.onError((err, c) => {
    logger.error({ err: err.message }, 'Dashboard request error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Request audit logging — logs method, path, IP, user agent, status, and
  // latency for every inbound request. 401/403 escalate to WARN so suspicious
  // external access stands out in the log stream. Ported from upstream 8329808.
  app.use('*', async (c, next) => {
    const start = Date.now();
    const ip = c.req.header('cf-connecting-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const ua = c.req.header('user-agent') || 'unknown';
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    await next();

    const status = c.res.status;
    const ms = Date.now() - start;
    const level = status === 401 || status === 403 ? 'warn' : 'info';
    logger[level](
      { method, path, status, ip, ua, ms },
      `Dashboard ${method} ${path} ${status}`
    );
  });

  // Token auth middleware — gates ONLY /api/*. The SPA shell at `/` and the
  // Vite-built static assets under `/assets/*` are served unauthenticated so
  // a token-stripped URL still loads the app instead of returning raw 401
  // JSON. The SPA includes the token via three channels (checked in order):
  //   1. ?token= query param  (original mechanism, always present when token known)
  //   2. Authorization: Bearer <token>  header  (sent by api.ts on every fetch)
  //   3. claw_token cookie  (set by api.ts on first authenticated load, survives
  //      across browser sessions — critical for mobile where ITP clears
  //      localStorage after 7 days of inactivity)
  // Legacy HTML routes that embed DASHBOARD_TOKEN in the page source call
  // requireToken() inline (query-param only).
  function parseCookieToken(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === 'claw_token') {
        try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return null; }
      }
    }
    return null;
  }

  app.use('*', async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (!pathname.startsWith('/api/')) {
      await next();
      return;
    }
    const token =
      c.req.query('token') ||
      c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ||
      parseCookieToken(c.req.header('Cookie')) ||
      null;
    if (!safeTokenEqual(token, DASHBOARD_TOKEN)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  // Serve dashboard.
  // Default: the new Vite-built Mission Control SPA at dist/web/index.html.
  // Fallback: set DASHBOARD_LEGACY=true in .env to revert to the legacy
  // single-file template HTML. Also falls back automatically if the SPA
  // hasn't been built yet (dist/web/index.html missing).
  const legacyMode = (process.env.DASHBOARD_LEGACY || '').toLowerCase() === 'true';
  const newDashboardIndex = path.join(PROJECT_ROOT, 'dist', 'web', 'index.html');
  app.get('/', (c) => {
    const chatId = c.req.query('chatId') || '';
    if (legacyMode || !fs.existsSync(newDashboardIndex)) {
      // Legacy path interpolates DASHBOARD_TOKEN into the HTML, so it MUST
      // require the token. SPA path doesn't.
      const denied = requireToken(c); if (denied) return denied;
      return c.html(getDashboardHtml(DASHBOARD_TOKEN, chatId, WARROOM_ENABLED));
    }
    // SPA shell. Read fresh on each request so dev rebuilds appear without
    // restart. The frontend reads ?token= and ?chatId= from window.location,
    // falling back to localStorage. Serving this unauthenticated means a
    // token-stripped URL still loads the app instead of showing raw 401.
    return c.html(fs.readFileSync(newDashboardIndex, 'utf-8'));
  });

  // SPA history fallback. Client-side routes (/mission, /usage, /settings,
  // /agents, etc.) have no matching server route, so a hard refresh or a
  // direct bookmark to a sub-page would 404. Serve the SPA shell for any
  // unmatched non-API GET and let the frontend router resolve it. Unknown
  // /api and /ws paths still return a real 404 instead of HTML.
  app.notFound((c) => {
    const pathname = new URL(c.req.url).pathname;
    const isApiOrWs =
      pathname.startsWith('/api/') ||
      pathname.startsWith('/ws/') ||
      pathname.startsWith('/warroom/');  // only sub-paths; /warroom itself has its own explicit route
    if (
      c.req.method === 'GET' &&
      !isApiOrWs &&
      !legacyMode &&
      fs.existsSync(newDashboardIndex)
    ) {
      return c.html(fs.readFileSync(newDashboardIndex, 'utf-8'));
    }
    return c.text('Not Found', 404);
  });

  // Static asset serving for the Vite-built frontend.
  // Vite emits hashed JS/CSS/source-maps under dist/web/assets/.
  app.get('/assets/*', (c) => {
    const url = new URL(c.req.url);
    const rel = url.pathname.replace(/^\//, '');
    const filePath = path.join(PROJECT_ROOT, 'dist', 'web', rel);
    // Defense in depth: ensure the resolved path stays inside dist/web/.
    const root = path.join(PROJECT_ROOT, 'dist', 'web');
    if (!filePath.startsWith(root + path.sep)) return c.text('', 403);
    if (!fs.existsSync(filePath)) return c.text('', 404);
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ctype = ext === '.js' ? 'application/javascript'
      : ext === '.css' ? 'text/css'
      : ext === '.map' ? 'application/json'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.woff2' ? 'font/woff2'
      : ext === '.woff' ? 'font/woff'
      : ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : 'application/octet-stream';
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': ctype, 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  });

  // Top-level static files copied from web/public/ at Vite build time
  // (e.g. /brain.glb for the 3D Hive Mind view). Stable filenames so they
  // sit at the root, not under /assets/.
  app.get('/:filename{.+\\.(glb|gltf|bin|ktx2|wasm|svg|png|webp|ico|html|jpg|jpeg)}', (c) => {
    const filename = c.req.param('filename');
    const distRoot = path.join(PROJECT_ROOT, 'dist', 'web');
    const storeRoot = STORE_DIR;
    // Look in dist/web/ first (built-in assets), then fall back to /app/store/
    // (Nikki-generated artefacts like onboarding.html, weekly briefs, etc.).
    // The store fallback is what makes Nikki able to "build a page and send
    // the link" in chat — she writes the file under STORE_DIR and it's
    // immediately reachable at /<filename>.
    let filePath = path.join(distRoot, filename);
    let allowedRoot = distRoot;
    if (!fs.existsSync(filePath)) {
      filePath = path.join(storeRoot, filename);
      allowedRoot = storeRoot;
    }
    if (!filePath.startsWith(allowedRoot + path.sep)) return c.text('', 403);
    if (!fs.existsSync(filePath)) return c.text('', 404);
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ctype = ext === '.glb' ? 'model/gltf-binary'
      : ext === '.gltf' ? 'model/gltf+json'
      : ext === '.wasm' ? 'application/wasm'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp'
      : ext === '.ico' ? 'image/x-icon'
      : ext === '.html' ? 'text/html; charset=utf-8'
      : 'application/octet-stream';
    // HTML files (like /auth.html) shouldn't be cached aggressively — we may
    // tweak them between deploys. Binary assets stay on 1-day cache.
    const cache = ext === '.html'
      ? 'no-cache'
      : 'public, max-age=86400';
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': ctype, 'Cache-Control': cache },
    });
  });

  // ── Apple Health ingest ────────────────────────────────────────────────
  // The Health Auto Export iOS app (paid "REST API" automation) POSTs a JSON
  // payload here on a daily schedule. We persist the raw payload (for debugging
  // / re-parsing) plus a normalized summary the Health Profile page renders.
  // Auth reuses the dashboard token via ?token= — the app lets you put the full
  // URL (query string included) in the automation.
  const HEALTH_RAW_PATH = path.join(STORE_DIR, 'health-export.json');
  const HEALTH_DATA_PATH = path.join(STORE_DIR, 'health-data.json');
  // Accumulated nightly sleep history (keyed by wake date) so the Sleep card
  // can browse past nights and show trends. Each daily export only carries one
  // night, so we merge rather than overwrite.
  const HEALTH_SLEEP_PATH = path.join(STORE_DIR, 'health-sleep-history.json');
  // Per-day snapshot of each metric so the whole Health Profile can be
  // filtered by date. A single multi-day export backfills this in one shot.
  const HEALTH_METRIC_HIST_PATH = path.join(STORE_DIR, 'health-metric-history.json');
  // Generic daily log for user-entered data (PT exercise completions today,
  // and reusable for movement goals, BP, etc.). Shape: { kind: { date: { key: value } } }.
  const HEALTH_LOG_PATH = path.join(STORE_DIR, 'health-logs.json');

  // Parse Health Auto Export date strings like "2026-07-10 07:17:56 -0400"
  // into epoch ms. Node's Date.parse is lenient but we normalize the offset
  // to be safe.
  const parseHealthDate = (s: any): number | null => {
    if (!s || typeof s !== 'string') return null;
    const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})?/);
    if (m) { const t = Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4] ?? '00'}`); return isNaN(t) ? null : t; }
    const t2 = Date.parse(s); return isNaN(t2) ? null : t2;
  };

  app.post('/api/health/import', async (c) => {
    const auth = requireToken(c); if (auth) return auth;
    let payload: any;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid JSON body' }, 400);
    }
    try {
      fs.writeFileSync(HEALTH_RAW_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (e: any) {
      return c.json({ ok: false, error: 'write failed: ' + (e?.message || e) }, 500);
    }
    // Health Auto Export shape: { data: { metrics: [ { name, units,
    // data: [ { date, qty|Avg|Min|Max|... } ] } ], workouts: [...] } }.
    // Index every metric by name and compute latest value + a simple average
    // so the page can render whatever the user chose to export without us
    // hardcoding a fixed metric list. Tolerant of top-level `metrics` too.
    const metricsIn = payload?.data?.metrics ?? payload?.metrics;
    const pointVal = (p: any): number | null =>
      typeof p?.qty === 'number' ? p.qty
      : typeof p?.Avg === 'number' ? p.Avg
      : typeof p?.avg === 'number' ? p.avg : null;
    const metrics: Record<string, any> = {};
    if (Array.isArray(metricsIn)) {
      for (const m of metricsIn) {
        if (!m || typeof m.name !== 'string') continue;
        const points = Array.isArray(m.data) ? m.data : [];
        const nums = points.map(pointVal).filter((n: any): n is number => typeof n === 'number');
        const last = points.length ? points[points.length - 1] : null;
        metrics[m.name] = {
          units: m.units ?? null,
          count: points.length,
          latest: last ? pointVal(last) : null,
          latestDate: last?.date ?? null,
          average: nums.length ? nums.reduce((a: number, b: number) => a + b, 0) / nums.length : null,
          // Full last data point — preserves structured sub-fields (e.g. sleep
          // phases: asleep/inBed/deep/rem/core/awake) that don't fit qty/Avg.
          latestPoint: last,
          // Last 7 raw points so the page can compute short trends / weekly
          // averages without us re-deriving them server-side.
          recent: points.slice(-7),
        };
      }
    }
    const summary = {
      updatedAt: new Date().toISOString(),
      metricNames: Object.keys(metrics),
      metrics,
    };
    try {
      fs.writeFileSync(HEALTH_DATA_PATH, JSON.stringify(summary, null, 2), 'utf-8');
    } catch { /* summary is best-effort; raw payload is already saved */ }

    // ── Accumulate nightly sleep history ──────────────────────────────────
    // Build a per-night record (phase totals, in-bed span, efficiency) plus the
    // heart-rate curve during the sleep window, and merge into a keyed history
    // file so the Sleep card can browse past nights and chart trends.
    let nightsAdded = 0;
    try {
      const findMetric = (re: RegExp) =>
        Array.isArray(metricsIn) ? metricsIn.find((m: any) => m && typeof m.name === 'string' && re.test(m.name)) : null;
      const sleepMetric = findMetric(/^sleep_analysis$/i) || findMetric(/sleep_analysis/i);
      const hrMetric = findMetric(/^heart_rate$/i) || findMetric(/heart_rate/i);
      const hrPoints: any[] = hrMetric && Array.isArray(hrMetric.data) ? hrMetric.data : [];

      if (sleepMetric && Array.isArray(sleepMetric.data) && sleepMetric.data.length) {
        let history: Record<string, any> = {};
        try {
          if (fs.existsSync(HEALTH_SLEEP_PATH)) history = JSON.parse(fs.readFileSync(HEALTH_SLEEP_PATH, 'utf-8'));
        } catch { history = {}; }

        for (const p of sleepMetric.data) {
         try {
          const startMs = parseHealthDate(p.inBedStart) ?? parseHealthDate(p.sleepStart);
          const endMs = parseHealthDate(p.inBedEnd) ?? parseHealthDate(p.sleepEnd);
          const key = String(p.sleepEnd || p.date || '').slice(0, 10);
          if (!key) continue;

          const deep = typeof p.deep === 'number' ? p.deep : null;
          const rem = typeof p.rem === 'number' ? p.rem : null;
          const core = typeof p.core === 'number' ? p.core : (typeof p.light === 'number' ? p.light : null);
          const awake = typeof p.awake === 'number' ? p.awake : null;
          let asleep = typeof p.totalSleep === 'number' && p.totalSleep > 0 ? p.totalSleep
            : (typeof p.asleep === 'number' && p.asleep > 0 ? p.asleep : null);
          if (asleep == null && (deep != null || rem != null || core != null))
            asleep = (deep || 0) + (rem || 0) + (core || 0);
          // Skip skeleton entries that have no actual sleep duration data.
          // Health Auto Export sometimes sends these and they overwrite valid nights.
          if (asleep == null || asleep <= 0) continue;
          const inBedHours = (startMs != null && endMs != null && endMs > startMs)
            ? (endMs - startMs) / 3600000
            : (typeof p.inBed === 'number' && p.inBed > 0 ? p.inBed : null);

          // Heart rate during the sleep window.
          let hr: any = null;
          if (startMs != null && endMs != null) {
            const win = hrPoints
              .map((h: any) => ({ t: parseHealthDate(h.date), min: h.Min, max: h.Max, avg: h.Avg }))
              .filter((h: any) => h.t != null && h.t >= startMs && h.t <= endMs)
              .sort((a: any, b: any) => a.t - b.t);
            if (win.length) {
              const mins = win.map((h: any) => h.min).filter((n: any) => typeof n === 'number');
              const maxs = win.map((h: any) => h.max).filter((n: any) => typeof n === 'number');
              const avgs = win.map((h: any) => h.avg).filter((n: any) => typeof n === 'number');
              // Downsample to ~48 points for a compact sparkline.
              const step = Math.max(1, Math.ceil(win.length / 48));
              const series = win.filter((_: any, i: number) => i % step === 0)
                .map((h: any) => ({ t: h.t, v: h.avg }));
              hr = {
                min: mins.length ? Math.min(...mins) : null,
                max: maxs.length ? Math.max(...maxs) : null,
                avg: avgs.length ? Math.round(avgs.reduce((a: number, b: number) => a + b, 0) / avgs.length) : null,
                series,
              };
            }
          }

          // Transparent sleep score (0-100), mirroring the common
          // Duration(/50) + Bedtime(/30) + Interruptions(/20) rubric. This is
          // our own computation from the exported totals, not Apple's or a
          // third-party app's proprietary score. If the payload ever carries a
          // real "sleep score" metric we prefer that (see appleScore below).
          const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
          const hm = String(p.sleepStart || '').match(/ (\d{2}):(\d{2})/);
          const fellHour = hm ? (parseInt(hm[1], 10) + parseInt(hm[2], 10) / 60) : null;
          const durScore = asleep != null ? Math.round(clamp01(asleep / 8) * 50) : 0;
          const awkFrac = (asleep != null && awake != null && (asleep + awake) > 0) ? awake / (asleep + awake) : 0;
          const intScore = Math.round(clamp01(1 - awkFrac / 0.25) * 20);
          let bedScore = 20;
          if (fellHour != null) {
            let dist = Math.abs(fellHour - 23);
            if (fellHour < 12) dist = Math.abs(fellHour + 24 - 23); // after-midnight
            bedScore = Math.round(clamp01(1 - dist / 3) * 30);
          }
          const total = durScore + bedScore + intScore;
          const label = total >= 85 ? 'Excellent' : total >= 70 ? 'Good' : total >= 55 ? 'OK' : total >= 40 ? 'Fair' : 'Low';
          const appleScore = typeof p.sleepScore === 'number' ? p.sleepScore
            : (typeof p.score === 'number' ? p.score : null);

          history[key] = {
            date: key,
            asleep, deep, rem, core, awake,
            inBedHours,
            efficiency: (asleep && inBedHours) ? Math.round((asleep / inBedHours) * 100) : null,
            sleepStart: p.sleepStart ?? null, sleepEnd: p.sleepEnd ?? null,
            inBedStart: p.inBedStart ?? null, inBedEnd: p.inBedEnd ?? null,
            hr,
            score: {
              total, label, appleScore,
              duration: durScore, bedtime: bedScore, interruptions: intScore,
              max: { duration: 50, bedtime: 30, interruptions: 20 },
            },
            updatedAt: summary.updatedAt,
          };
          nightsAdded++;
         } catch (perr) {
           // One malformed night must never abort the whole history write.
           logger.warn({ err: String((perr as Error)?.message || perr), key: String(p?.sleepEnd || p?.date || '').slice(0, 10) }, 'health: skipped a sleep night (per-night error)');
         }
        }

        // Cap to the most recent 180 nights.
        const keys = Object.keys(history).sort();
        if (keys.length > 180) for (const k of keys.slice(0, keys.length - 180)) delete history[k];
        try {
          fs.writeFileSync(HEALTH_SLEEP_PATH, JSON.stringify(history, null, 2), 'utf-8');
        } catch (werr) {
          logger.error({ err: String((werr as Error)?.message || werr), path: HEALTH_SLEEP_PATH, nights: Object.keys(history).length }, 'health: FAILED to write sleep history');
        }
      }
    } catch (herr) { logger.warn({ err: String((herr as Error)?.message || herr) }, 'health: sleep history block failed (best-effort, import continues)'); }

    // ── Accumulate per-day metric history (for the whole-profile date filter) ──
    // Bucket each metric's points by local day and aggregate (sum for counts /
    // energy / distance, average for rates). One multi-day export backfills all.
    let daysTouched = 0;
    try {
      const sumRe = /(step_count|energy|flights|distance|exercise_time|stand_time|daylight)/i;
      let mh: any = { units: {}, days: {} };
      try {
        if (fs.existsSync(HEALTH_METRIC_HIST_PATH)) {
          const parsed = JSON.parse(fs.readFileSync(HEALTH_METRIC_HIST_PATH, 'utf-8'));
          if (parsed && parsed.days) mh = { units: parsed.units || {}, days: parsed.days };
        }
      } catch { mh = { units: {}, days: {} }; }

      if (Array.isArray(metricsIn)) {
        for (const m of metricsIn) {
          if (!m || typeof m.name !== 'string' || !Array.isArray(m.data)) continue;
          if (/sleep/i.test(m.name)) continue; // sleep has its own store
          if (m.units) mh.units[m.name] = m.units;
          const isSum = sumRe.test(m.name);
          const buckets: Record<string, number[]> = {};
          for (const pt of m.data) {
            const day = String(pt.date || '').slice(0, 10); if (!day) continue;
            const v = pointVal(pt); if (typeof v !== 'number') continue;
            (buckets[day] = buckets[day] || []).push(v);
          }
          for (const day of Object.keys(buckets)) {
            const arr = buckets[day];
            const val = isSum ? arr.reduce((a, b) => a + b, 0) : arr.reduce((a, b) => a + b, 0) / arr.length;
            if (!mh.days[day]) { mh.days[day] = {}; daysTouched++; }
            mh.days[day][m.name] = Math.round(val * 100) / 100;
          }
        }
      }
      const dayKeys = Object.keys(mh.days).sort();
      if (dayKeys.length > 180) for (const k of dayKeys.slice(0, dayKeys.length - 180)) delete mh.days[k];
      fs.writeFileSync(HEALTH_METRIC_HIST_PATH, JSON.stringify(mh, null, 2), 'utf-8');
    } catch { /* best-effort */ }

    return c.json({ ok: true, metricsReceived: summary.metricNames.length, nightsAdded, daysTouched, updatedAt: summary.updatedAt });
  });

  app.get('/api/health/data', (c) => {
    const auth = requireToken(c); if (auth) return auth;
    if (!fs.existsSync(HEALTH_DATA_PATH)) return c.json({ ok: true, updatedAt: null, metrics: {} });
    try {
      return c.json(JSON.parse(fs.readFileSync(HEALTH_DATA_PATH, 'utf-8')));
    } catch {
      return c.json({ ok: false, error: 'read failed' }, 500);
    }
  });

  // Nightly sleep history for the Sleep card: date list + full per-night
  // records (phase totals, efficiency, sleep heart-rate series).
  app.get('/api/health/sleep', (c) => {
    const auth = requireToken(c); if (auth) return auth;
    if (!fs.existsSync(HEALTH_SLEEP_PATH)) return c.json({ ok: true, dates: [], latest: null, nights: {} });
    try {
      const nights = JSON.parse(fs.readFileSync(HEALTH_SLEEP_PATH, 'utf-8'));
      const dates = Object.keys(nights).sort();
      return c.json({ ok: true, dates, latest: dates.length ? dates[dates.length - 1] : null, nights });
    } catch {
      return c.json({ ok: false, error: 'read failed' }, 500);
    }
  });

  // Per-day metric history for the whole-profile date filter.
  app.get('/api/health/metrics-history', (c) => {
    const auth = requireToken(c); if (auth) return auth;
    if (!fs.existsSync(HEALTH_METRIC_HIST_PATH)) return c.json({ ok: true, dates: [], latest: null, units: {}, days: {} });
    try {
      const mh = JSON.parse(fs.readFileSync(HEALTH_METRIC_HIST_PATH, 'utf-8'));
      const dates = Object.keys(mh.days || {}).sort();
      return c.json({ ok: true, dates, latest: dates.length ? dates[dates.length - 1] : null, units: mh.units || {}, days: mh.days || {} });
    } catch {
      return c.json({ ok: false, error: 'read failed' }, 500);
    }
  });

  // Generic daily log (PT completions today, and reusable for goals/BP).
  app.get('/api/health/log', (c) => {
    const auth = requireToken(c); if (auth) return auth;
    const kind = c.req.query('kind') || '';
    let all: any = {};
    try { if (fs.existsSync(HEALTH_LOG_PATH)) all = JSON.parse(fs.readFileSync(HEALTH_LOG_PATH, 'utf-8')); } catch { all = {}; }
    return c.json({ ok: true, kind, data: kind ? (all[kind] || {}) : all });
  });

  app.post('/api/health/log', async (c) => {
    const auth = requireToken(c); if (auth) return auth;
    let b: any; try { b = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid JSON' }, 400); }
    const kind = String(b?.kind || '').trim();
    const date = String(b?.date || '').slice(0, 10);
    const key = String(b?.key || '').trim();
    if (!kind || !date || !key) return c.json({ ok: false, error: 'kind, date, key required' }, 400);
    let all: any = {};
    try { if (fs.existsSync(HEALTH_LOG_PATH)) all = JSON.parse(fs.readFileSync(HEALTH_LOG_PATH, 'utf-8')); } catch { all = {}; }
    if (!all[kind]) all[kind] = {};
    if (!all[kind][date]) all[kind][date] = {};
    const v = b.value;
    if (v === 0 || v === false || v === null || v === undefined) delete all[kind][date][key];
    else all[kind][date][key] = v;
    if (Object.keys(all[kind][date]).length === 0) delete all[kind][date];
    try { fs.writeFileSync(HEALTH_LOG_PATH, JSON.stringify(all, null, 2), 'utf-8'); }
    catch { return c.json({ ok: false, error: 'write failed' }, 500); }
    return c.json({ ok: true, kind, date, key, value: v });
  });

  // War Room page. The SPA has its own WarRoom view at /warroom (Preact router).
  // The original /warroom HTML is preserved as the "classic" entry-point for
  // direct legacy access (voice room, deep-links that carry ?token=).
  //
  // Routing logic:
  //   • token present + valid  → legacy War Room HTML  (e.g. "Open in classic"
  //                               card, "Launch voice meeting" button, Telegram
  //                               deep-links that all include ?token=…)
  //   • no token               → SPA shell  (sidebar nav, hard-refresh, bookmark)
  //                               The Preact router then renders <WarRoom />.
  app.get('/warroom', (c) => {
    const token = c.req.query('token');
    if (safeTokenEqual(token, DASHBOARD_TOKEN)) {
      // Valid token in URL — caller wants the legacy embedded HTML.
      const chatId = c.req.query('chatId') || '';
      return c.html(getWarRoomHtml(DASHBOARD_TOKEN, chatId, WARROOM_PORT));
    }
    // No (or invalid) token — serve the SPA shell so the Preact router handles it.
    if (!legacyMode && fs.existsSync(newDashboardIndex)) {
      return c.html(fs.readFileSync(newDashboardIndex, 'utf-8'));
    }
    // Full legacy mode: require the token.
    const denied = requireToken(c); if (denied) return denied;
    return c.html(getWarRoomHtml(DASHBOARD_TOKEN, c.req.query('chatId') || '', WARROOM_PORT));
  });

  // Serve War Room background music (user's custom music.mp3 first, then bundled entrance.mp3)
  app.get('/warroom-music', (c) => {
    const musicPath = path.join(PROJECT_ROOT, 'warroom', 'music.mp3');
    if (!fs.existsSync(musicPath)) return c.text('', 404);
    const data = fs.readFileSync(musicPath);
    return new Response(data, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' },
    });
  });

  // Upload custom War Room entrance music from the dashboard
  app.post('/warroom-music-upload', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!file || typeof file === 'string') return c.json({ error: 'No file uploaded' }, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) return c.json({ error: 'File too large (max 20MB)' }, 400);
    fs.writeFileSync(path.join(PROJECT_ROOT, 'warroom', 'music.mp3'), buf);
    return c.json({ ok: true });
  });

  // Serve War Room test audio for the browser-side autotest harness.
  // Used by the mock microphone in warroom browser tests; served only
  // when the dashboard token matches so it's not a public endpoint.
  app.get('/warroom-test-audio', (c) => {
    const audioPath = path.join(PROJECT_ROOT, 'warroom', 'test-audio.wav');
    if (!fs.existsSync(audioPath)) return c.text('', 404);
    const data = fs.readFileSync(audioPath);
    return new Response(data, {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
    });
  });

  // Serve War Room Pipecat client bundle
  app.get('/warroom-client.js', (c) => {
    const bundlePath = path.join(PROJECT_ROOT, 'warroom', 'client.bundle.js');
    if (!fs.existsSync(bundlePath)) return c.text('// bundle not built', 404);
    const data = fs.readFileSync(bundlePath, 'utf-8');
    return new Response(data, {
      headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=3600' },
    });
  });

  // ── Avatar storage ──────────────────────────────────────────────────
  // Avatars live on the persistent volume at STORE_DIR/avatars so user
  // uploads survive deploys. The baked-in defaults in /warroom/avatars/
  // are seeded into the volume the first time the volume is empty (fresh
  // install / fresh volume) — after that, every change persists.
  //
  // Pre-2026-06-01 fix: avatars were stored in PROJECT_ROOT/warroom/avatars
  // which is part of the Docker image, so every deploy reset Nikki's
  // (and any other custom) avatar back to the default. The user-visible
  // bug was "I uploaded a new avatar and it disappeared 4 minutes later."
  const AVATARS_DIR = path.join(STORE_DIR, 'avatars');
  const AVATAR_SEED_DIR = path.join(PROJECT_ROOT, 'warroom', 'avatars');
  const AVATAR_EXTS = ['png', 'jpg', 'jpeg', 'webp'] as const;
  const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  function seedAvatarsIfEmpty(): void {
    try {
      fs.mkdirSync(AVATARS_DIR, { recursive: true });
      const existing = fs.readdirSync(AVATARS_DIR);
      if (existing.length > 0) return; // already seeded — leave user uploads alone
      if (!fs.existsSync(AVATAR_SEED_DIR)) return;
      let copied = 0;
      for (const f of fs.readdirSync(AVATAR_SEED_DIR)) {
        const src = path.join(AVATAR_SEED_DIR, f);
        const dst = path.join(AVATARS_DIR, f);
        try {
          if (fs.statSync(src).isFile()) { fs.copyFileSync(src, dst); copied++; }
        } catch { /* best-effort per file */ }
      }
      logger.info({ count: copied, from: AVATAR_SEED_DIR, to: AVATARS_DIR }, 'seeded default avatars onto persistent volume');
    } catch (err) {
      logger.warn({ err: String((err as Error)?.message || err) }, 'avatar seed failed');
    }
  }
  seedAvatarsIfEmpty();

  function findAvatarFile(agentId: string): { path: string; ext: string } | null {
    for (const ext of AVATAR_EXTS) {
      const p = path.join(AVATARS_DIR, `${agentId}.${ext}`);
      if (fs.existsSync(p)) return { path: p, ext };
    }
    return null;
  }

  // Serve War Room agent avatars. Scans for any of the supported extensions
  // (png/jpg/jpeg/webp) — previously hardcoded to .png, which broke after a
  // user uploaded a .jpg via the Mission Control avatar UI (the upload code
  // removes other-extension variants, so main.png stopped existing).
  app.get('/warroom-avatar/:id', (c) => {
    const agentId = c.req.param('id').replace(/[^a-z0-9_-]/g, '');
    const hit = findAvatarFile(agentId);
    if (!hit) return c.text('', 404);
    const data = fs.readFileSync(hit.path);
    return new Response(data, {
      headers: { 'Content-Type': MIME_BY_EXT[hit.ext] || 'image/png', 'Cache-Control': 'public, max-age=86400' },
    });
  });

  // ── Mission Control agent avatars ───────────────────────────────────
  // Same backing store as the War Room route — change once, see everywhere.
  // Token-guarded because the GET response embeds an image only the
  // dashboard user should see.

  app.get('/api/agents/:id/avatar', (c) => {
    const auth = requireToken(c); if (auth) return auth;
    const agentId = c.req.param('id').replace(/[^a-z0-9_-]/g, '');
    const hit = findAvatarFile(agentId);
    // 204 means "no avatar set" — the React component treats that as a
    // fallback signal and renders initials. Don't 404, that triggers an
    // error toast in some browsers.
    if (!hit) return new Response(null, { status: 204 });
    const data = fs.readFileSync(hit.path);
    return new Response(data, {
      headers: {
        'Content-Type': MIME_BY_EXT[hit.ext] || 'application/octet-stream',
        // No client-side cache: callers (AgentAvatar) cache-bust via a
        // ?v=<n> query when they change, but other views skip the param,
        // so we'd otherwise serve stale bytes for up to an hour.
        'Cache-Control': 'no-store',
      },
    });
  });

  app.put('/api/agents/:id/avatar', async (c) => {
    const auth = requireToken(c); if (auth) return auth;
    const agentId = c.req.param('id').replace(/[^a-z0-9_-]/g, '');
    if (!agentId) return c.json({ error: 'Invalid agent id' }, 400);

    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch (err: unknown) {
      return c.json({ error: 'Could not parse upload: ' + (err instanceof Error ? err.message : String(err)) }, 400);
    }

    const file = body['image'] as File | string | undefined;
    if (!file || typeof file === 'string') {
      return c.json({ error: 'No `image` field in multipart upload' }, 400);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) return c.json({ error: 'Empty upload' }, 400);
    if (buf.length > 5 * 1024 * 1024) return c.json({ error: 'Image too large (max 5MB)' }, 413);

    // Pick extension from declared MIME, fall back to filename, default to png.
    const mimeType = (file.type || '').toLowerCase();
    let ext: string;
    if (mimeType === 'image/png') ext = 'png';
    else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ext = 'jpg';
    else if (mimeType === 'image/webp') ext = 'webp';
    else {
      const fromName = (file.name || '').toLowerCase().split('.').pop() || '';
      ext = AVATAR_EXTS.includes(fromName as typeof AVATAR_EXTS[number]) ? fromName : 'png';
    }

    fs.mkdirSync(AVATARS_DIR, { recursive: true });

    // Remove any other-extension variants so GET never serves a stale file.
    for (const other of AVATAR_EXTS) {
      if (other === ext) continue;
      const p = path.join(AVATARS_DIR, `${agentId}.${other}`);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* best-effort */ }
      }
    }

    const outPath = path.join(AVATARS_DIR, `${agentId}.${ext}`);
    fs.writeFileSync(outPath, buf);
    logger.info({ agentId, ext, bytes: buf.length }, 'avatar updated');
    return c.json({ ok: true, ext, bytes: buf.length });
  });

  app.delete('/api/agents/:id/avatar', (c) => {
    const auth = requireToken(c); if (auth) return auth;
    const agentId = c.req.param('id').replace(/[^a-z0-9_-]/g, '');
    let removed = 0;
    for (const ext of AVATAR_EXTS) {
      const p = path.join(AVATARS_DIR, `${agentId}.${ext}`);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); removed++; } catch { /* best-effort */ }
      }
    }
    logger.info({ agentId, removed }, 'avatar cleared');
    return c.json({ ok: true, removed });
  });

  // War Room API: meeting state management.
  // We deliberately do NOT return a ws_url here. Older versions of this
  // route sent `ws://localhost:${WARROOM_PORT}`, which broke any
  // Cloudflare-tunneled access since the browser would try to connect to
  // its own localhost instead of the tunnel host. The client-side code
  // in src/warroom-html.ts always has a `window.location.hostname`
  // fallback, so just returning {ok:true} lets the browser build the
  // right WS url on its own.
  app.post('/api/warroom/start', async (c) => {
    if (!WARROOM_ENABLED) {
      return c.json({ error: 'War Room not enabled. Set WARROOM_ENABLED=true in .env with GOOGLE_API_KEY (for live mode) or DEEPGRAM_API_KEY + CARTESIA_API_KEY (for legacy mode).' }, 400);
    }
    // If the pin file was updated recently (agent switch while no meeting
    // was active), the running server has the wrong agent. Kill it so it
    // restarts with the correct persona/voice before we probe readiness.
    try {
      const pinStat = fs.statSync(WARROOM_PIN_PATH);
      const pinAge = Date.now() - pinStat.mtimeMs;
      if (pinAge < 30000) {
        // Pin changed in the last 30 seconds. Kill the server so it
        // picks up the new pin, then poll until it's ready.
        await killWarroomAsync('pin changed recently, restarting for Start Meeting');
        const net = await import('net');
        let serverReady = false;
        for (let attempt = 0; attempt < 15 && !serverReady; attempt++) {
          await new Promise((r) => setTimeout(r, 1000));
          serverReady = await new Promise<boolean>((resolve) => {
            const sock = new net.Socket();
            const t = setTimeout(() => { sock.destroy(); resolve(false); }, 1000);
            sock.connect(WARROOM_PORT, '127.0.0.1', () => { clearTimeout(t); sock.destroy(); resolve(true); });
            sock.on('error', () => { clearTimeout(t); sock.destroy(); resolve(false); });
          });
        }
        if (serverReady) {
          await new Promise((r) => setTimeout(r, 200));
          return c.json({ ok: true, status: 'ready' });
        }
        return c.json({ ok: false, status: 'starting', error: 'War Room server restarting, try again' }, 503);
      }
    } catch { /* pin file might not exist yet, that's fine */ }

    // Probe the Python WebSocket server to verify it's actually accepting
    // connections. Without this, the browser connects before the server is
    // ready and gets silent failures or "only one client allowed" errors.
    try {
      const net = await import('net');
      const ready = await new Promise<boolean>((resolve) => {
        const sock = new net.Socket();
        const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 3000);
        sock.connect(WARROOM_PORT, '127.0.0.1', () => {
          clearTimeout(timer);
          sock.destroy();
          resolve(true);
        });
        sock.on('error', () => { clearTimeout(timer); sock.destroy(); resolve(false); });
      });
      if (!ready) {
        return c.json({ ok: false, status: 'starting', error: 'War Room server not ready yet' }, 503);
      }
      // Small delay after TCP success: the socket may be bound but the
      // Pipecat WebSocket upgrade handler might not be fully initialized.
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      return c.json({ ok: false, status: 'starting', error: 'Could not probe War Room server' }, 503);
    }
    return c.json({ ok: true, status: 'ready' });
  });

  // Return the dynamic agent list for the War Room UI to render cards.
  // Includes main + all configured agents with their display names.
  app.get('/api/warroom/agents', (c) => {
    const ids = ['main', ...listAgentIds().filter((id) => id !== 'main')];
    const agents = ids.map((id) => {
      try {
        const cfg = loadAgentConfig(id);
        return { id, name: cfg.name || id, description: cfg.description || '' };
      } catch {
        // No agent.yaml — use a capitalised fallback (e.g. "main" → "Main")
        const fallbackName = id.charAt(0).toUpperCase() + id.slice(1);
        return { id, name: fallbackName, description: '' };
      }
    });
    return c.json({ agents });
  });

  // ── War Room meeting history & transcript persistence ──────────────
  app.post('/api/warroom/meeting/start', async (c) => {
    const body: { id?: string; mode?: string; agent?: string } = await c.req.json().catch(() => ({}));
    const id = body.id || crypto.randomUUID();
    createWarRoomMeeting(id, body.mode || 'direct', body.agent || 'main');
    return c.json({ ok: true, meetingId: id });
  });

  app.post('/api/warroom/meeting/end', async (c) => {
    const body: { id?: string; entryCount?: number } = await c.req.json().catch(() => ({}));
    if (body.id) endWarRoomMeeting(body.id, body.entryCount || 0);
    return c.json({ ok: true });
  });

  app.post('/api/warroom/meeting/transcript', async (c) => {
    const body: { meetingId?: string; speaker?: string; text?: string } = await c.req.json().catch(() => ({}));
    if (body.meetingId && body.speaker && body.text) {
      addWarRoomTranscript(body.meetingId, body.speaker, body.text);
    }
    return c.json({ ok: true });
  });

  app.get('/api/warroom/meetings', (c) => {
    const limit = parseInt(c.req.query('limit') || '20');
    return c.json({ meetings: getWarRoomMeetings(limit) });
  });

  app.get('/api/warroom/meeting/:id/transcript', (c) => {
    return c.json({ transcript: getWarRoomTranscript(c.req.param('id')) });
  });

  // ── War Room pin: route all voice utterances to a specific agent ──
  // Lives in /tmp so the Python Pipecat server (a separate process) can
  // read the state without needing an IPC bus. router.py checks this
  // file's mtime and reloads only when it changes. Spoken agent prefixes
  // (e.g. "research, find X") still take precedence over the pin.
  const WARROOM_PIN_PATH = '/tmp/warroom-pin.json';
  const VALID_PIN_AGENTS = new Set(['main', ...listAgentIds()]);
  const VALID_PIN_MODES = new Set(['direct', 'auto']);

  // Read current pin state from disk. Returns normalized defaults for
  // missing fields so callers can rely on both agent and mode being set.
  function readPinState(): { agent: string | null; mode: string } {
    try {
      if (fs.existsSync(WARROOM_PIN_PATH)) {
        const raw = JSON.parse(fs.readFileSync(WARROOM_PIN_PATH, 'utf-8'));
        const agent = (raw && typeof raw.agent === 'string' && VALID_PIN_AGENTS.has(raw.agent)) ? raw.agent : null;
        const mode = (raw && typeof raw.mode === 'string' && VALID_PIN_MODES.has(raw.mode)) ? raw.mode : 'direct';
        return { agent, mode };
      }
    } catch { /* fall through to defaults */ }
    return { agent: null, mode: 'direct' };
  }

  app.get('/api/warroom/pin', (c) => {
    const { agent, mode } = readPinState();
    return c.json({ ok: true, agent, mode });
  });

  // Kill the warroom Python subprocess so main's respawn logic in
  // src/index.ts brings up a fresh one with whatever config files
  // (voices.json, pin file, etc.) we just wrote. Runs in the background
  // so the HTTP response doesn't block on the respawn.
  async function killWarroomAsync(reason: string): Promise<number[]> {
    try {
      const { spawn } = await import('child_process');
      const pids: number[] = await new Promise((resolve) => {
        const p = spawn('pgrep', ['-f', 'warroom/server.py']);
        let out = '';
        p.stdout.on('data', (chunk) => { out += chunk.toString(); });
        p.on('close', () => {
          resolve(out.trim().split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)));
        });
        p.on('error', () => resolve([]));
      });
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      }
      if (pids.length > 0) {
        logger.info({ pids, reason }, 'Killed warroom subprocess for respawn');
      }
      return pids;
    } catch (err) {
      logger.warn({ err, reason }, 'killWarroomAsync failed');
      return [];
    }
  }

  app.post('/api/warroom/pin', async (c) => {
    let body: { agent?: string; mode?: string; restart?: boolean } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    // Pin can update agent, mode, or both. Missing fields preserve
    // the current pin file value. An empty body is a noop but still
    // respawns so the caller can force a reload.
    const current = readPinState();
    const nextAgent = body.agent !== undefined ? body.agent : (current.agent ?? 'main');
    const nextMode = body.mode !== undefined ? body.mode : current.mode;

    if (!VALID_PIN_AGENTS.has(nextAgent)) {
      return c.json({ ok: false, error: 'invalid agent; must be one of main, research, comms, content, ops' }, 400);
    }
    if (!VALID_PIN_MODES.has(nextMode)) {
      return c.json({ ok: false, error: 'invalid mode; must be one of direct, auto' }, 400);
    }

    try {
      fs.writeFileSync(
        WARROOM_PIN_PATH,
        JSON.stringify({ agent: nextAgent, mode: nextMode, pinnedAt: Date.now() }),
        'utf-8',
      );
      // Only respawn the server if the caller says a meeting is active.
      // When no meeting is active, the server picks up the new pin on
      // the next Start Meeting click (the health probe triggers it).
      const needsRestart = body.restart !== false;
      if (needsRestart) {
        killWarroomAsync(`pin changed to agent=${nextAgent} mode=${nextMode}`);
      }
      return c.json({ ok: true, agent: nextAgent, mode: nextMode, respawning: needsRestart });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  app.post('/api/warroom/unpin', async (c) => {
    try {
      if (fs.existsSync(WARROOM_PIN_PATH)) fs.unlinkSync(WARROOM_PIN_PATH);
      killWarroomAsync('unpin');
      return c.json({ ok: true, agent: null, mode: 'direct', respawning: true });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // ── War Room voice configuration ──
  // warroom/voices.json carries two voice identifiers per agent:
  //   - gemini_voice:     Gemini Live's built-in voice name (used in live mode)
  //   - voice_id:         Cartesia voice id (used in legacy stitched mode)
  // The Python server reads this file on startup. After editing via the
  // dashboard, POST /api/warroom/voices/apply kickstarts the main agent so
  // its child warroom process respawns with the new config.
  const WARROOM_VOICES_PATH = path.join(PROJECT_ROOT, 'warroom', 'voices.json');

  // Full Gemini Live voice catalog with one-word style descriptors. Matches
  // the 30 voices supported by the gemini-2.5-flash-native-audio-preview model
  // (and other Gemini TTS-capable models). Sourced from Google's docs.
  const GEMINI_VOICE_CATALOG: Array<{ name: string; style: string }> = [
    { name: 'Zephyr', style: 'Bright' },
    { name: 'Puck', style: 'Upbeat' },
    { name: 'Charon', style: 'Informative' },
    { name: 'Kore', style: 'Firm' },
    { name: 'Fenrir', style: 'Excitable' },
    { name: 'Leda', style: 'Youthful' },
    { name: 'Orus', style: 'Firm' },
    { name: 'Aoede', style: 'Breezy' },
    { name: 'Callirrhoe', style: 'Easy-going' },
    { name: 'Autonoe', style: 'Bright' },
    { name: 'Enceladus', style: 'Breathy' },
    { name: 'Iapetus', style: 'Clear' },
    { name: 'Umbriel', style: 'Easy-going' },
    { name: 'Algieba', style: 'Smooth' },
    { name: 'Despina', style: 'Smooth' },
    { name: 'Erinome', style: 'Clear' },
    { name: 'Algenib', style: 'Gravelly' },
    { name: 'Rasalgethi', style: 'Informative' },
    { name: 'Laomedeia', style: 'Upbeat' },
    { name: 'Achernar', style: 'Soft' },
    { name: 'Alnilam', style: 'Firm' },
    { name: 'Schedar', style: 'Even' },
    { name: 'Gacrux', style: 'Mature' },
    { name: 'Pulcherrima', style: 'Forward' },
    { name: 'Achird', style: 'Friendly' },
    { name: 'Zubenelgenubi', style: 'Casual' },
    { name: 'Vindemiatrix', style: 'Gentle' },
    { name: 'Sadachbia', style: 'Lively' },
    { name: 'Sadaltager', style: 'Knowledgeable' },
    { name: 'Sulafat', style: 'Warm' },
  ];
  const GEMINI_VOICE_NAMES = new Set(GEMINI_VOICE_CATALOG.map((v) => v.name));

  // Default voice assignments for agents that don't have an entry yet.
  // This is how a newly-spawned sub-agent gets a voice without any extra
  // setup. We skip Charon (reserved for main) so new agents always sound
  // distinct from the main voice.
  const NEW_AGENT_VOICE_POOL = [
    'Kore', 'Aoede', 'Leda', 'Alnilam', 'Puck',
    'Fenrir', 'Laomedeia', 'Achird', 'Sulafat', 'Vindemiatrix',
  ];

  function readVoicesFile(): Record<string, { voice_id?: string; gemini_voice?: string; name?: string }> {
    try {
      return JSON.parse(fs.readFileSync(WARROOM_VOICES_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }

  function writeVoicesFile(obj: Record<string, unknown>) {
    fs.writeFileSync(WARROOM_VOICES_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  }

  function pickDefaultGeminiVoice(used: Set<string>): string {
    for (const v of NEW_AGENT_VOICE_POOL) {
      if (!used.has(v)) return v;
    }
    return NEW_AGENT_VOICE_POOL[0];
  }

  app.get('/api/warroom/voices', (c) => {
    const configured = readVoicesFile();
    // Return one row per known agent. Agents missing from voices.json get
    // a default Gemini voice suggestion from the pool so the UI can show
    // something reasonable without requiring the user to save first.
    const knownAgents = ['main', ...listAgentIds().filter((id) => id !== 'main')];
    const usedGeminiVoices = new Set(
      Object.values(configured)
        .map((v) => v && typeof v === 'object' ? (v as { gemini_voice?: string }).gemini_voice : undefined)
        .filter((v): v is string => typeof v === 'string'),
    );
    const rows = knownAgents.map((agent) => {
      const entry = configured[agent] || {};
      let geminiVoice = entry.gemini_voice;
      let isDefault = false;
      if (!geminiVoice) {
        geminiVoice = agent === 'main' ? 'Charon' : pickDefaultGeminiVoice(usedGeminiVoices);
        usedGeminiVoices.add(geminiVoice);
        isDefault = true;
      }
      return {
        agent,
        gemini_voice: geminiVoice,
        voice_id: entry.voice_id || '',
        name: entry.name || '',
        is_default: isDefault,
      };
    });
    return c.json({
      ok: true,
      voices: rows,
      gemini_catalog: GEMINI_VOICE_CATALOG,
    });
  });

  app.post('/api/warroom/voices', async (c) => {
    let body: { updates?: Array<{ agent: string; gemini_voice?: string; voice_id?: string; name?: string }> } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const updates = body.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return c.json({ ok: false, error: 'updates must be a non-empty array of {agent, gemini_voice?, voice_id?, name?}' }, 400);
    }

    const configured = readVoicesFile();
    const errors: string[] = [];
    for (const u of updates) {
      if (!u.agent || typeof u.agent !== 'string') {
        errors.push('each update must have an agent id');
        continue;
      }
      const entry = configured[u.agent] || {};
      if (u.gemini_voice !== undefined) {
        if (typeof u.gemini_voice !== 'string' || !GEMINI_VOICE_NAMES.has(u.gemini_voice)) {
          errors.push(`${u.agent}: invalid gemini_voice '${u.gemini_voice}' (must be one of the 30 Gemini voices)`);
          continue;
        }
        entry.gemini_voice = u.gemini_voice;
      }
      if (u.voice_id !== undefined) {
        if (typeof u.voice_id !== 'string') {
          errors.push(`${u.agent}: voice_id must be a string`);
          continue;
        }
        entry.voice_id = u.voice_id;
      }
      if (u.name !== undefined) {
        if (typeof u.name !== 'string') {
          errors.push(`${u.agent}: name must be a string`);
          continue;
        }
        entry.name = u.name;
      }
      configured[u.agent] = entry;
    }
    if (errors.length > 0) {
      return c.json({ ok: false, error: errors.join('; ') }, 400);
    }
    try {
      writeVoicesFile(configured);
      return c.json({ ok: true, voices: configured, applied: false });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  app.post('/api/warroom/voices/apply', async (c) => {
    // Kill the warroom Python subprocess so main's respawn logic in
    // src/index.ts picks up a fresh one that re-reads voices.json.
    // IMPORTANT: we do NOT kickstart the main launchd service here,
    // because that would kill the dashboard process we're currently
    // running inside — the HTTP response would never be delivered.
    try {
      const { spawn } = await import('child_process');
      // pgrep is simpler than parsing ps. Matches any python process
      // whose command line includes "warroom/server.py".
      const pids: number[] = await new Promise((resolve) => {
        const p = spawn('pgrep', ['-f', 'warroom/server.py']);
        let out = '';
        p.stdout.on('data', (chunk) => { out += chunk.toString(); });
        p.on('close', () => {
          resolve(out.trim().split(/\s+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)));
        });
        p.on('error', () => resolve([]));
      });
      if (pids.length === 0) {
        return c.json({ ok: false, error: 'no warroom server process found' }, 500);
      }
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
      }
      logger.info({ pids }, 'Killed warroom subprocess for voice config reload');
      return c.json({
        ok: true,
        applied: true,
        killed_pids: pids,
        note: 'warroom server will be respawned by the main agent in ~0.5s with fresh voices.json',
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // Sales pipeline + accounts (CRM view) — live from Vendasta + ClickUp.
  app.get('/api/pipeline', async (c) => {
    try {
      const data = await getPipelineData(c.req.query('refresh') === '1');
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'pipeline endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Primary-contact review: live Vendasta candidates, draft selections only.
  // This intentionally does not write to ClickUp until a separate approval
  // workflow is added and explicitly confirmed by Dante.
  app.get('/api/primary-contacts', async (c) => {
    try {
      return c.json(await getPrimaryContactReview(c.req.query('refresh') === '1'));
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'primary contacts review failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.put('/api/primary-contacts/:taskId', async (c) => {
    try {
      const clickupTaskId = c.req.param('taskId');
      const body = await c.req.json();
      return c.json({ ok: true, draft: savePrimaryContactSelection(clickupTaskId, body.contactId) });
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'primary contact draft save failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Edit a pipeline card (stage -> Vendasta, contact -> Vendasta, outreach status + notes -> local).
  app.post('/api/pipeline/card', async (c) => {
    try {
      const body = await c.req.json();
      const res = await updateCard(body);
      return c.json(res);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'pipeline card update failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Update deal sub-stage (local store — Lead / Contact / Qualified / Proposal).
  app.post('/api/pipeline/stage', async (c) => {
    try {
      const body = await c.req.json();
      if (!body.id) return c.json({ error: 'id required' }, 400);
      if (!SUB_STAGES.includes(body.subStage)) return c.json({ error: `invalid subStage; must be one of ${SUB_STAGES.join(', ')}` }, 400);
      const res = updateDealSubStage({ id: body.id, subStage: body.subStage, brand: body.brand, source: body.source });
      return c.json(res);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'pipeline stage update failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Create a new local lead (not yet synced to Vendasta).
  app.post('/api/pipeline/lead', async (c) => {
    try {
      const body = await c.req.json();
      if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
      if (!BRANDS.includes(body.brand)) return c.json({ error: `invalid brand; must be one of ${BRANDS.join(', ')}` }, 400);
      const res = createLocalLead(body);
      return c.json(res);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'pipeline create lead failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Update a local lead.
  app.patch('/api/pipeline/lead/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.json();
      const res = updateLocalLead({ id, ...body });
      return c.json(res);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'pipeline update local lead failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Delete a local lead.
  app.delete('/api/pipeline/lead/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const res = deleteLocalLead(id);
      return c.json(res);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'pipeline delete local lead failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Outreach tracker (BID Traffic Partnership + future campaigns).
  app.get('/api/outreach', (c) => {
    try { return c.json(getOutreachData()); }
    catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'outreach endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });
  app.post('/api/outreach/status', async (c) => {
    try {
      const { email, status } = await c.req.json();
      if (!email || typeof email !== 'string') return c.json({ error: 'email required' }, 400);
      setOutreachStatus(email, String(status || ''));
      return c.json({ ok: true });
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'outreach status update failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Webinars (BID Discovery Webinar pipeline).
  app.get('/api/webinars', async (c) => {
    try { return c.json(await getWebinarsData()); }
    catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'webinars endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });
  app.post('/api/webinars/disposition', async (c) => {
    try {
      const { eventId, email, disposition } = await c.req.json();
      setWebinarDisposition({ eventId, email, disposition });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Member sub-pipeline (Tier 2 revenue layer).
  app.get('/api/members', (c) => {
    try { return c.json(getMembersData()); }
    catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'members endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });
  app.post('/api/members', async (c) => {
    try {
      const body = await c.req.json();
      if (!body.bidEmail || !body.businessName) return c.json({ error: 'bidEmail and businessName required' }, 400);
      const m = addMember(body);
      return c.json({ ok: true, member: m });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });
  app.post('/api/members/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const updates = await c.req.json();
      const m = updateMember(id, updates);
      if (!m) return c.json({ error: 'not found' }, 404);
      return c.json({ ok: true, member: m });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // ── Vendasta Payout Ledger ────────────────────────────────────────────
  // Tracks payouts that have been posted to the Make webhook → QBO.
  // GET  /api/payouts           → returns array of ledger entries
  // POST /api/payouts           → adds a payout to ledger + fires Make webhook
  const PAYOUTS_LEDGER_FILE = path.join(STORE_DIR, 'vendasta-payouts-ledger.json');
  const PAYOUTS_SENT_FILE   = path.join(STORE_DIR, 'vendasta-payouts-sent.json');
  const MAKE_PAYOUT_WEBHOOK = 'https://hook.us2.make.com/y9xeg296ff6qmg5u2hfp5d1epy8yyi9o';

  function readPayoutLedger(): unknown[] {
    try { return JSON.parse(fs.readFileSync(PAYOUTS_LEDGER_FILE, 'utf-8')); } catch { return []; }
  }
  function appendPayoutLedger(entry: Record<string, unknown>): void {
    const ledger = readPayoutLedger();
    ledger.push({ ...entry, recorded_at: new Date().toISOString() });
    fs.writeFileSync(PAYOUTS_LEDGER_FILE, JSON.stringify(ledger, null, 2));
    // Also update the dedup set
    try {
      const sent: string[] = JSON.parse(fs.readFileSync(PAYOUTS_SENT_FILE, 'utf-8'));
      if (entry.payout_id && !sent.includes(String(entry.payout_id))) {
        sent.push(String(entry.payout_id));
        fs.writeFileSync(PAYOUTS_SENT_FILE, JSON.stringify(sent, null, 2));
      }
    } catch { /* ignore */ }
  }

  app.get('/api/payouts', (c) => {
    return c.json(readPayoutLedger());
  });

  app.post('/api/payouts', async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>;
      const { payout_id, payout_date, client_name, gross_amount, processing_fee, net_amount, entity } = body;
      if (!payout_id || !entity) return c.json({ error: 'payout_id and entity required' }, 400);

      // Check dedup
      let sent: string[] = [];
      try { sent = JSON.parse(fs.readFileSync(PAYOUTS_SENT_FILE, 'utf-8')); } catch { /* ok */ }
      if (sent.includes(String(payout_id))) {
        return c.json({ ok: true, skipped: true, reason: 'already_sent' });
      }

      // POST to Make webhook
      const payload = { payout_id, payout_date, client_name, gross_amount, processing_fee, net_amount, entity };
      const wr = await fetch(MAKE_PAYOUT_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!wr.ok) return c.json({ error: `Webhook failed: ${wr.status}` }, 502);

      appendPayoutLedger(payload as Record<string, unknown>);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // ── QuickBooks Online OAuth bootstrap ────────────────────────────────
  // The user hits /api/qbo/connect once, gets redirected to Intuit, signs
  // in, picks the company file. Intuit redirects back to /api/qbo/callback
  // with ?code=...&realmId=... — we exchange the code for refresh + access
  // tokens via the stdio connector and persist to /app/store/qbo-token.json.
  // After that, every QBO API call auto-refreshes its access token; the
  // user never needs to touch this again unless the refresh token expires
  // (100 days of non-use).
  const QBO_SERVER = path.join(PROJECT_ROOT, 'connectors', 'quickbooks', 'server.mjs');
  const QBO_STATE_FILE = path.join(STORE_DIR, 'qbo-oauth-state.json');
  function readQboState(): { state: string; created_at: number } | null {
    try { return JSON.parse(fs.readFileSync(QBO_STATE_FILE, 'utf-8')); } catch { return null; }
  }
  function writeQboState(state: string): void {
    fs.mkdirSync(path.dirname(QBO_STATE_FILE), { recursive: true });
    fs.writeFileSync(QBO_STATE_FILE, JSON.stringify({ state, created_at: Date.now() }));
  }

  app.get('/api/qbo/connect', (c) => {
    const auth = requireToken(c); if (auth) return auth;
    const clientId = process.env.QBO_CLIENT_ID
      || readEnvFile(['QBO_CLIENT_ID']).QBO_CLIENT_ID || '';
    const redirectUri = process.env.QBO_REDIRECT_URI
      || readEnvFile(['QBO_REDIRECT_URI']).QBO_REDIRECT_URI
      || 'https://claudeclaw.impactworks.com/api/qbo/callback';
    if (!clientId) {
      return c.json({ error: 'QBO_CLIENT_ID not set. Add it to Fly secrets, then restart.' }, 400);
    }
    const state = 'cc-' + Math.random().toString(36).slice(2, 14);
    writeQboState(state);
    const url = new URL('https://appcenter.intuit.com/connect/oauth2');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return c.redirect(url.toString());
  });

  // OAuth callback — hit by Intuit, not the user directly. CAN'T require a
  // dashboard token here because Intuit doesn't know about our token. The
  // OAuth `state` parameter (CSRF-style) prevents drive-by abuse.
  app.get('/api/qbo/callback', async (c) => {
    const code = c.req.query('code');
    const realmId = c.req.query('realmId');
    const state = c.req.query('state');
    const error = c.req.query('error');
    if (error) {
      return c.html(`<h1>QuickBooks authorization failed</h1><pre>${error}</pre>`, 400);
    }
    if (!code || !realmId || !state) {
      return c.html('<h1>Missing code, realmId, or state in callback</h1>', 400);
    }
    const saved = readQboState();
    if (!saved || saved.state !== state) {
      return c.html('<h1>State mismatch — possible CSRF. Start over from /api/qbo/connect.</h1>', 403);
    }
    // Exchange the code via the connector CLI so the token lands in the
    // same place the MCP server reads from.
    try {
      const { stdout, stderr } = await execFileAsync('node', [QBO_SERVER, '--oauth-exchange', code, realmId], {
        env: { ...process.env },
        maxBuffer: 1024 * 1024,
      });
      logger.info({ realmId, stdout: stdout.slice(0, 200) }, 'qbo oauth exchange success');
      try { fs.unlinkSync(QBO_STATE_FILE); } catch { /* best-effort */ }
      return c.html(`
        <!doctype html><html><head><title>QuickBooks connected</title>
        <style>body{font:14px -apple-system,sans-serif;max-width:540px;margin:60px auto;padding:0 20px;color:#111}
        h1{color:#0a8a4f}pre{background:#f4f4f5;padding:12px;border-radius:6px;font-size:12px;overflow:auto}</style></head>
        <body>
        <h1>✓ QuickBooks connected</h1>
        <p>Realm: <code>${realmId}</code></p>
        <p>Nikki can now query QuickBooks via the <code>quickbooks</code> MCP server. The Cash page will start showing real P&amp;L numbers as soon as it's rebuilt.</p>
        <p><a href="/cash">← Back to Mission Control</a></p>
        <pre>${stdout.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!))}</pre>
        ${stderr ? `<details><summary>stderr</summary><pre>${stderr.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!))}</pre></details>` : ''}
        </body></html>
      `);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'qbo oauth exchange failed');
      return c.html(`<h1>Token exchange failed</h1><pre>${String((e as Error)?.message || e)}</pre>`, 500);
    }
  });

  // Lightweight status endpoint — does the dashboard show a "Connect QB" CTA
  // or "QB connected" badge? Reads the token file (existence check only).
  app.get('/api/qbo/status', (c) => {
    const auth = requireToken(c); if (auth) return auth;
    const tokenPath = path.join(STORE_DIR, 'qbo-token.json');
    if (!fs.existsSync(tokenPath)) {
      return c.json({ connected: false });
    }
    try {
      const t = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
      return c.json({
        connected: true,
        realm_id: t.realm_id,
        last_refreshed_at: t.last_refreshed_at,
        refresh_token_expires_at: t.refresh_token_expires_at_ms
          ? new Date(t.refresh_token_expires_at_ms).toISOString() : null,
      });
    } catch {
      return c.json({ connected: false });
    }
  });

  // Cash / banking (Plaid).
  app.get('/api/cash', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      const data = await getCashData(force);
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'cash endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // QuickBooks P&L (production accounting numbers).
  // Cache: 1hr. ?force=1 bypasses. Optional ?cashCents= for accurate runway.
  app.get('/api/qb', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      const cashStr = c.req.query('cashCents');
      const totalCashCents = cashStr ? parseInt(cashStr, 10) : undefined;
      const data = await getQbData({ force, totalCashCents });
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'qb endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });
  // People resolver — verify the relay/people-map.json + relay/contacts.json
  // loaded correctly and resolve any handle on demand. Useful for confirming
  // a tagging session worked end-to-end without re-running the relay.
  app.get('/api/people/stats', async (c) => {
    const { resolverStats } = await import('./people-resolver.js');
    return c.json(resolverStats());
  });
  app.get('/api/people/resolve', async (c) => {
    const handle = c.req.query('handle');
    if (!handle) return c.json({ error: 'handle query param required' }, 400);
    const { resolvePerson, categorize } = await import('./people-resolver.js');
    const person = resolvePerson(handle);
    return c.json({ handle, person, category: categorize(person) });
  });

  // One-shot import endpoint: push a session checkpoint directly into Nikki's
  // memory table. Used when ending a long working session on Mac/Cowork and
  // we want her to absorb the outcome without waiting for the next message
  // ingestion cycle. Always saves as 'session_checkpoint' source, pinned,
  // with high importance + salience. Body: { summary, raw_text, chat_id?,
  // agent_id?, entities?, topics? }.
  app.post('/api/memory/import-checkpoint', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        summary?: string;
        raw_text?: string;
        chat_id?: string;
        agent_id?: string;
        entities?: string[];
        topics?: string[];
        importance?: number;
      };
      const summary = (body.summary || '').trim();
      const rawText = (body.raw_text || body.summary || '').trim();
      if (!summary || !rawText) {
        return c.json({ error: 'summary and raw_text required' }, 400);
      }
      const chatId = (body.chat_id || ALLOWED_CHAT_ID || '').toString();
      if (!chatId) return c.json({ error: 'chat_id required (no ALLOWED_CHAT_ID default)' }, 400);
      const agentId = body.agent_id || 'main';
      const entities = Array.isArray(body.entities) ? body.entities : [];
      const topics = Array.isArray(body.topics) ? body.topics : ['session_checkpoint'];
      const importance = Math.min(1, Math.max(0, typeof body.importance === 'number' ? body.importance : 0.95));
      const id = saveStructuredMemory(chatId, rawText, summary, entities, topics, importance, 'session_checkpoint', agentId);
      pinMemory(id);
      logger.info({ id, chatId, agentId, importance }, 'checkpoint imported');
      return c.json({ ok: true, id, chat_id: chatId, agent_id: agentId, pinned: true });
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'checkpoint import failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // QuickBooks chart of accounts — used by the Settlement Slip generator to
  // look up account IDs for the journal entry. Returns a slim view: id, name,
  // accountType, balance, active.
  // Investments portfolio summary: total value, day change, per-account
  // breakdown, top holdings. Aggregated across all Plaid items linked with
  // the investments product.
  app.get('/api/investments', async (c) => {
    try {
      const { getInvestmentsData } = await import('./investments-data.js');
      const force = c.req.query('force') === '1';
      const data = await getInvestmentsData({ force });
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'investments endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });
  app.get('/api/qb/accounts', async (c) => {
    try {
      const qboServer = path.join(PROJECT_ROOT, 'connectors', 'quickbooks', 'server.mjs');
      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        execFile('node', [qboServer, '--call', 'qbo_get_chart_of_accounts', '{}'], { env: process.env, maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
          if (err) reject(err); else resolve({ stdout: out });
        });
      });
      const j = JSON.parse(stdout);
      const slim = (j.accounts || []).map((a: { id: string; name: string; type: string; current_balance: number; active: boolean }) => ({
        id: a.id, name: a.name, type: a.type, balance: a.current_balance, active: a.active,
      }));
      return c.json({ asOf: Date.now(), accounts: slim });
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'qb accounts endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });
  // Vendasta "Real MRR" — customer-only retail (internal accounts stripped),
  // fulfilled-only line items, no one-time fees. Cache 30min, ?force=1 bypasses.
  app.get('/api/vendasta/revenue', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      const full = c.req.query('full') === '1';
      const snap = await getCleanedRevenue({ force, full });
      return c.json(snap);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'vendasta revenue endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Vendasta marketing campaigns — pulls the campaign list from Partner Center.
  // Each campaign has name, status, recipients, opens, ctor, tag. Used by the
  // Mission Control CampaignsCard for at-a-glance outreach visibility.
  // Cache 10 min (campaign metrics don't move minute-to-minute).
  app.get('/api/vendasta/campaigns', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      const { getCampaignsSummary } = await import('./vendasta-campaigns.js');
      const data = await getCampaignsSummary({ force });
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'vendasta campaigns endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Weather snapshot driven by Cloudflare's "Add visitor location headers"
  // managed transform. Origin reads cf-iplatitude/lon/city/region/country
  // from the request. Falls back to Oakville, ON if headers are absent.
  // Cache: 10min on volume keyed by rounded coords.
  app.get('/api/weather', async (c) => {
    try {
      const snap = await getWeather({
        lat: c.req.header('cf-iplatitude'),
        lon: c.req.header('cf-iplongitude'),
        city: c.req.header('cf-ipcity'),
        region: c.req.header('cf-ipregion'),
        country: c.req.header('cf-ipcountry'),
        timezone: c.req.header('cf-iptimezone'),
      });
      return c.json(snap);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'weather endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Stocks watchlist (Yahoo Finance v8 chart endpoint, no auth).
  // Cache: 5min. ?force=1 bypasses.
  app.get('/api/stocks', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      const data = await getStocksData({ force });
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'stocks endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Watchlist CRUD — persistent ticker list on Fly volume.
  app.get('/api/stocks/tickers', (c) => {
    return c.json({ tickers: loadTickers() });
  });
  app.post('/api/stocks/tickers', async (c) => {
    try {
      const body = await c.req.json();
      const r = addTicker(String(body?.symbol || ''));
      if (r.ok) invalidateStocksCache();
      return c.json(r, r.ok ? 200 : 400);
    } catch (e) {
      return c.json({ ok: false, tickers: loadTickers(), reason: String((e as Error)?.message || e) }, 400);
    }
  });
  app.delete('/api/stocks/tickers/:symbol', (c) => {
    const r = removeTicker(c.req.param('symbol') || '');
    if (r.ok) invalidateStocksCache();
    return c.json(r, r.ok ? 200 : 400);
  });

  // Stock OHLC history. Cache: 15min per (symbol,period).
  // period = 1D | 1W | 1M | 3M | 1Y
  app.get('/api/stocks/history/:symbol', async (c) => {
    try {
      const symbol = c.req.param('symbol') || '';
      const period = (c.req.query('period') || '1M') as Period;
      const valid: Period[] = ['1D', '1W', '1M', '3M', '1Y'];
      if (!valid.includes(period)) {
        return c.json({ error: `period must be one of ${valid.join(',')}` }, 400);
      }
      const force = c.req.query('force') === '1';
      const data = await getStockHistory({ symbol, period, force });
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'stocks-history endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // AI news, past 24 hours (Google News RSS).
  // Cache: 10min. ?force=1 bypasses.
  app.get('/api/ai-news', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      const limitStr = c.req.query('limit');
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      const data = await getNewsData({ force, limit });
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'ai-news endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Google Calendar — today or next 7 days. Cache: 2 minutes.
  app.get('/api/calendar', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      const range = (c.req.query('range') === 'week' ? 'week' : 'today') as 'today' | 'week';
      if (force) invalidateCalendarCache();
      const data = await getCalendarData({ range, force });
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'calendar endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // ── Daily brief archive ────────────────────────────────────────────
  app.get('/api/brief/latest', (c) => {
    const latest = getLatestDailyBrief();
    const recent = getRecentDailyBriefs(14).map(b => ({
      id: b.id, brief_date: b.brief_date, generated_at: b.generated_at,
      brief_kind: b.brief_kind,
      char_count: b.char_count, send_status: b.send_status, user_marked: b.user_marked,
    }));
    return c.json({ latest, recent });
  });

  app.get('/api/brief/list', (c) => {
    const limit = parseInt(c.req.query('limit') || '30', 10);
    return c.json({ briefs: getRecentDailyBriefs(limit) });
  });

  app.get('/api/brief/:id', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const brief = getDailyBrief(id);
    if (!brief) return c.json({ error: 'not found' }, 404);
    return c.json({ brief });
  });

  app.post('/api/brief/:id/mark', async (c) => {
    try {
      const id = parseInt(c.req.param('id'), 10);
      const body = await c.req.json().catch(() => ({} as any));
      const action = body?.action;
      if (action != null && action !== 'acted' && action !== 'ignored') {
        return c.json({ error: 'action must be "acted", "ignored", or null' }, 400);
      }
      markBriefUserAction(id, action ?? null);

      // Wire the mark into Nikki's memory so the signal isn't just a DB chip.
      // 'acted'   → low-importance memory that the brief drove activity
      //             (lets Nikki point to which briefs worked in retrospectives)
      // 'ignored' → high-importance feedback memory so Nikki notices the
      //             format isn't landing and can propose a rewrite
      if (action && ALLOWED_CHAT_ID) {
        try {
          const brief = getDailyBrief(id);
          const date = brief?.brief_date || new Date().toISOString().slice(0, 10);
          const kind = brief?.brief_kind || 'morning';
          if (action === 'acted') {
            const idMem = saveStructuredMemory(
              String(ALLOWED_CHAT_ID),
              `User marked the ${kind} brief from ${date} as acted-on — the brief drove activity. Brief id=${id}.`,
              `Brief ${date} (${kind}) → acted`,
              [date, kind, 'brief_feedback'],
              ['brief_feedback', 'acted'],
              0.4,
              'brief_mark',
              'main',
            );
            logger.info({ id, memoryId: idMem, action }, 'brief mark → memory saved');
          } else {
            // action === 'ignored'
            const idMem = saveStructuredMemory(
              String(ALLOWED_CHAT_ID),
              `User marked the ${kind} brief from ${date} as ignored — the format or content wasn't useful. Nikki: review what was in this brief and consider whether the format, length, or framing needs to change. Brief id=${id}.`,
              `Brief ${date} (${kind}) → IGNORED (format may need rethink)`,
              [date, kind, 'brief_feedback', 'format_feedback'],
              ['brief_feedback', 'ignored', 'format_feedback'],
              0.85,
              'brief_mark',
              'main',
            );
            pinMemory(idMem);
            logger.info({ id, memoryId: idMem, action }, 'brief mark → high-salience memory pinned');
          }
        } catch (memErr) {
          logger.warn({ err: String((memErr as Error)?.message || memErr) }, 'brief mark → memory write failed (non-fatal)');
        }
      }
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Generate a fresh brief NOW (preview mode — doesn't send to Telegram).
  // Used by the Founder Dashboard "Generate now" button.
  app.post('/api/brief/run', async (c) => {
    try {
      const chatId = ALLOWED_CHAT_ID || '';
      if (!chatId) return c.json({ error: 'ALLOWED_CHAT_ID not configured' }, 400);
      const r = await generateBriefPreview(chatId);
      if (!r) return c.json({ error: 'brief generation returned empty or unconfigured' }, 500);
      return c.json({ ok: true, id: r.id, body: r.body });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // ── Personal inbox (Gmail) ─────────────────────────────────────────
  app.get('/api/email/inbox', async (c) => {
    try {
      const limit = parseInt(c.req.query('limit') || '25', 10);
      const force = c.req.query('force') === '1';
      if (force) invalidateInboxCache();
      const r = await getInbox({ limit, force });
      return c.json(r);
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.get('/api/email/thread/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const force = c.req.query('force') === '1';
      const r = await getThread(id, force);
      if ('error' in r) return c.json(r, 500);
      return c.json(r);
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // ── Five-Minute Journal ────────────────────────────────────────────
  // GET today's entry + the rotating quote + streak in one shot.
  app.get('/api/journal/today', async (c) => {
    try {
      const { quoteForDate, todayDate } = await import('./journal-data.js');
      const date = todayDate();
      const entry = getJournalEntry(date);
      const quote = quoteForDate(date);
      const streak = getJournalStreak();
      return c.json({ date, entry, quote, streak });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.get('/api/journal/entry/:date', async (c) => {
    try {
      const { quoteForDate } = await import('./journal-data.js');
      const date = c.req.param('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
      const entry = getJournalEntry(date);
      const quote = quoteForDate(date);
      return c.json({ date, entry, quote });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.post('/api/journal/entry/:date', async (c) => {
    try {
      const date = c.req.param('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
      const body = await c.req.json().catch(() => ({} as any));
      const entry = saveJournalEntry(date, body || {});
      const streak = getJournalStreak();
      return c.json({ ok: true, entry, streak });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.get('/api/journal/recent', async (c) => {
    try {
      const limit = Math.min(365, Math.max(1, parseInt(c.req.query('limit') || '30', 10)));
      return c.json({ entries: getRecentJournalEntries(limit), streak: getJournalStreak() });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Log a completed meditation sit. Body: { minutes: number }
  // Used by the meditation timer when a session ends naturally OR when
  // Dante taps "done early" — both count as a sit.
  app.post('/api/journal/meditation/:date', async (c) => {
    try {
      const date = c.req.param('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
      const body = await c.req.json().catch(() => ({} as any));
      const minutes = Number(body?.minutes);
      if (!isFinite(minutes) || minutes <= 0) return c.json({ error: 'minutes must be a positive number' }, 400);
      const entry = logMeditationSession(date, minutes);
      const streak = getJournalStreak();
      return c.json({ ok: true, entry, streak });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // ── Proactive heartbeat ────────────────────────────────────────────
  app.get('/api/heartbeat/recent', (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const kind = c.req.query('kind') as 'heartbeat' | 'money_idea' | undefined;
    const alerts = getRecentProactiveAlerts(limit, kind);
    return c.json({ alerts });
  });

  // Manual heartbeat scan. Pass ?send=1 to actually push to Telegram via the
  // bot api injected at startup. Without it, runs in dry mode — checkers
  // execute, alerts persist, but no Telegram ping (good for testing).
  app.post('/api/heartbeat/run', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      const apiRef = c.req.query('send') === '1' ? (botApi || null) : null;
      const r = await runHeartbeatScan(apiRef, ALLOWED_CHAT_ID || '', { force });
      return c.json(r);
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.post('/api/heartbeat/ideas', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      const apiRef = c.req.query('send') === '1' ? (botApi || null) : null;
      const r = await runMoneyIdeas(apiRef, ALLOWED_CHAT_ID || '', { force });
      return c.json(r);
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.post('/api/heartbeat/:id/dismiss', async (c) => {
    try {
      dismissAlert(parseInt(c.req.param('id'), 10));
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: String((e as Error)?.message || e) }, 500); }
  });

  app.post('/api/heartbeat/:id/snooze', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({} as any));
      const hours = parseInt(body?.hours || '24', 10);
      snoozeAlert(parseInt(c.req.param('id'), 10), hours);
      return c.json({ ok: true, hours });
    } catch (e) { return c.json({ error: String((e as Error)?.message || e) }, 500); }
  });

  // Manual trigger for the nightly DB backup. Useful for smoke-testing and
  // for "I'm about to do something risky, backup first" moments.
  app.post('/api/backup/run', async (c) => {
    try {
      const result = await runBackup();
      return c.json(result, result.ok ? 200 : 500);
    } catch (e) {
      return c.json({ ok: false, error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Vendasta — companies + opportunities per market (ImpactWorks / Rocket Local).
  // Cache: 10 minutes on the volume.
  app.get('/api/vendasta', async (c) => {
    try {
      const force = c.req.query('force') === '1';
      if (force) invalidateVendastaCache();
      const data = await getVendastaData({ force });
      return c.json(data);
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'vendasta endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.post('/api/cash/link-token', async (c) => {
    try {
      // Accept redirect_uri in the JSON body so the connect page can pass
      // its own URL through. Required by OAuth institutions (Novo, Chase).
      let redirectUri: string | undefined;
      try { const body = await c.req.json(); redirectUri = body?.redirect_uri; } catch { /* no body */ }
      const r = await createLinkToken('ClaudeClaw Mission Control', redirectUri);
      return c.json(r);
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });
  app.post('/api/cash/exchange', async (c) => {
    try {
      const body = await c.req.json();
      if (!body.public_token) return c.json({ error: 'public_token required' }, 400);
      const r = await exchangePublicToken(body.public_token, body.institution_name || 'Bank');
      return c.json({ ok: true, ...r });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // CSV statement import — Apple Card and any other institution Plaid
  // can't reach. Accepts JSON with base64-encoded CSV text or raw csv_text.
  app.post('/api/cash/import-csv', async (c) => {
    try {
      const body = await c.req.json();
      if (!body.csv_text || typeof body.csv_text !== 'string') {
        return c.json({ error: 'csv_text required (string contents of the CSV file)' }, 400);
      }
      if (!body.institution_name || !body.account_name || !body.mask) {
        return c.json({ error: 'institution_name, account_name, and mask are required' }, 400);
      }
      const result = importCsv({
        institution_name: String(body.institution_name),
        account_name: String(body.account_name),
        mask: String(body.mask),
        account_type: body.account_type,
        account_subtype: body.account_subtype,
        statement_balance: body.statement_balance,
        available_credit: body.available_credit,
        csv_text: body.csv_text,
        billing_period_start: body.billing_period_start,
        billing_period_end: body.billing_period_end,
      });
      // Invalidate the cash cache so the next /api/cash sees the new data.
      try { fs.unlinkSync(path.join(PROJECT_ROOT, 'store', 'cash-cache.json')); } catch { /* ignore */ }
      return c.json({ ok: true, ...result });
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'csv import failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // List manual accounts (so the UI can render them in the disconnect picker).
  app.get('/api/cash/manual-accounts', (c) => {
    try { return c.json({ accounts: loadManualAccounts() }); }
    catch (e) { return c.json({ error: String((e as Error)?.message || e) }, 500); }
  });

  // Remove a manual account + all its transactions (e.g. user uploaded the
  // wrong file). Required: account_id.
  app.post('/api/cash/manual-accounts/:id/delete', (c) => {
    try {
      deleteManualAccount(c.req.param('id'));
      try { fs.unlinkSync(path.join(PROJECT_ROOT, 'store', 'cash-cache.json')); } catch { /* ignore */ }
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: String((e as Error)?.message || e) }, 500); }
  });

  // Plaid Link bootstrap page — opens the official Plaid Link iframe so the
  // user can connect Novo (or any institution). Returns the public_token to
  // /api/cash/exchange for permanent access_token storage.
  app.get('/cash/connect', (c) => {
    return c.html(plaidConnectHtml());
  });

  // Founder Dashboard — single read that fans out to all four data layers.
  app.get('/api/founder', async (c) => {
    try { return c.json(await getFounderDashboard()); }
    catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, 'founder dashboard endpoint failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Scheduled tasks
  app.get('/api/tasks', (c) => {
    const tasks = getAllScheduledTasks();
    return c.json({ tasks });
  });

  // Delete a scheduled task
  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    deleteScheduledTask(id);
    return c.json({ ok: true });
  });

  // Pause a scheduled task
  app.post('/api/tasks/:id/pause', (c) => {
    const id = c.req.param('id');
    pauseScheduledTask(id);
    return c.json({ ok: true });
  });

  // Resume a scheduled task
  app.post('/api/tasks/:id/resume', (c) => {
    const id = c.req.param('id');
    resumeScheduledTask(id);
    return c.json({ ok: true });
  });

  // Edit a scheduled task: prompt, schedule (cron), and/or agent_id.
  // Returns the updated next_run so the UI can reflect the new firing time
  // without waiting for the 30s poll. Ported from upstream a1622fa (osrepo).
  app.patch('/api/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as {
      prompt?: string;
      schedule?: string;
      agent_id?: string;
    };
    const all = getAllScheduledTasks();
    const existing = all.find((t) => t.id === id);
    if (!existing) return c.json({ ok: false, error: 'task not found' }, 404);

    const patch: { prompt?: string; schedule?: string; nextRun?: number; agentId?: string } = {};
    if (typeof body.prompt === 'string') {
      const trimmed = body.prompt.trim();
      if (!trimmed) return c.json({ ok: false, error: 'prompt cannot be empty' }, 400);
      patch.prompt = trimmed;
    }
    if (typeof body.schedule === 'string' && body.schedule.trim() !== existing.schedule) {
      const cron = body.schedule.trim();
      try {
        patch.nextRun = computeNextRun(cron);
        patch.schedule = cron;
      } catch (err: any) {
        return c.json({ ok: false, error: 'invalid cron: ' + (err?.message || String(err)) }, 400);
      }
    }
    if (typeof body.agent_id === 'string') {
      const agentId = body.agent_id.trim();
      if (!agentId) return c.json({ ok: false, error: 'agent_id cannot be empty' }, 400);
      patch.agentId = agentId;
    }

    updateScheduledTask(id, patch);
    const updated = getAllScheduledTasks().find((t) => t.id === id);
    return c.json({ ok: true, task: updated });
  });

  // ── Mission Control endpoints ────────────────────────────────────────

  app.get('/api/mission/tasks', (c) => {
    const agentId = c.req.query('agent') || undefined;
    const status = c.req.query('status') || undefined;
    const tasks = getMissionTasks(agentId, status);
    return c.json({ tasks });
  });

  app.get('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    return c.json({ task });
  });

  app.post('/api/mission/tasks', async (c) => {
    const body = await c.req.json<{
      title?: string;
      prompt?: string;
      assigned_agent?: string;
      priority?: number;
      timeout_ms?: number;
    }>();

    const title = body?.title?.trim();
    const prompt = body?.prompt?.trim();
    const assignedAgent = body?.assigned_agent?.trim() || null;
    const priority = Math.max(0, Math.min(10, body?.priority ?? 0));
    const timeoutMs = body?.timeout_ms ? Math.max(60_000, body.timeout_ms) : null;

    if (!title || title.length > 200) return c.json({ error: 'title required (max 200 chars)' }, 400);
    if (!prompt || prompt.length > 10000) return c.json({ error: 'prompt required (max 10000 chars)' }, 400);

    // Validate agent if provided
    if (assignedAgent) {
      const validAgents = ['main', ...listAgentIds()];
      if (!validAgents.includes(assignedAgent)) {
        return c.json({ error: `Unknown agent: ${assignedAgent}. Valid: ${validAgents.join(', ')}` }, 400);
      }
    }

    const id = crypto.randomBytes(4).toString('hex');
    createMissionTask(id, title, prompt, assignedAgent, 'dashboard', priority, timeoutMs);

    const task = getMissionTask(id);
    return c.json({ task }, 201);
  });

  app.post('/api/mission/tasks/:id/cancel', (c) => {
    const id = c.req.param('id');
    const ok = cancelMissionTask(id);
    return c.json({ ok });
  });

  // Auto-assign a single task via Gemini classification
  app.post('/api/mission/tasks/:id/auto-assign', async (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    if (task.assigned_agent) return c.json({ error: 'Already assigned' }, 400);

    const agent = await classifyTaskAgent(task.prompt);
    if (!agent) return c.json({ error: 'Classification failed' }, 500);

    assignMissionTask(id, agent);
    return c.json({ ok: true, assigned_agent: agent });
  });

  // Auto-assign all unassigned tasks
  app.post('/api/mission/tasks/auto-assign-all', async (c) => {
    const tasks = getUnassignedMissionTasks();
    if (tasks.length === 0) return c.json({ assigned: 0 });

    const results: Array<{ id: string; agent: string }> = [];
    for (const task of tasks) {
      const agent = await classifyTaskAgent(task.prompt);
      if (agent && assignMissionTask(task.id, agent)) {
        results.push({ id: task.id, agent });
      }
    }
    return c.json({ assigned: results.length, results });
  });

  app.patch('/api/mission/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ assigned_agent?: string; timeout_ms?: number }>();

    if (body?.timeout_ms !== undefined) {
      const task = getMissionTask(id);
      if (!task) return c.json({ error: 'Not found' }, 404);
      if (['completed', 'failed', 'cancelled'].includes(task.status)) {
        return c.json({ error: 'Cannot change timeout on a finished task' }, 422);
      }
      const newTimeout = Math.max(60_000, body.timeout_ms);
      const changed = updateMissionTaskTimeout(id, newTimeout);
      if (!changed) return c.json({ error: 'Task is no longer running' }, 422);
      if (!body?.assigned_agent) return c.json({ ok: true, timeout_ms: newTimeout });
    }

    const newAgent = body?.assigned_agent?.trim();
    if (!newAgent) return c.json({ error: 'assigned_agent required' }, 400);
    const validAgents = ['main', ...listAgentIds()];
    if (!validAgents.includes(newAgent)) return c.json({ error: 'Unknown agent' }, 400);
    const ok = reassignMissionTask(id, newAgent);
    return c.json({ ok });
  });

  app.delete('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const ok = deleteMissionTask(id);
    return c.json({ ok });
  });

  app.get('/api/mission/history', (c) => {
    const limit = parseInt(c.req.query('limit') || '30', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    return c.json(getMissionTaskHistory(limit, offset));
  });

  // ── Live Meetings (Pika meet-cli wrapper) ──────────────────────────
  // Three endpoints that shell out to dist/meet-cli.js. Actual join/leave
  // logic lives there so Telegram triggers and the dashboard go through
  // the same code path.

  const MEET_CLI = path.join(PROJECT_ROOT, 'dist', 'meet-cli.js');
  const MEET_URL_RE = /^https:\/\/meet\.google\.com\/[a-z0-9-]+/i;

  // Run meet-cli as a subprocess and parse its final JSON line from stdout.
  async function runMeetCli(args: string[], timeoutMs: number): Promise<{
    ok: boolean;
    data: Record<string, unknown>;
    stderr: string;
    code: number;
  }> {
    if (!fs.existsSync(MEET_CLI)) {
      return { ok: false, data: { error: 'meet-cli not built; run npm run build' }, stderr: '', code: -1 };
    }
    const { spawn } = await import('child_process');
    const proc = spawn(process.execPath, [MEET_CLI, ...args], {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    return await new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch { /* ok */ }
      }, timeoutMs);

      proc.on('close', (code: number | null) => {
        clearTimeout(killTimer);
        // meet-cli emits one JSON object on its final stdout line
        const lines = stdout.trim().split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]) as Record<string, unknown>;
            resolve({ ok: parsed.ok === true, data: parsed, stderr, code: code ?? 1 });
            return;
          } catch { /* try earlier line */ }
        }
        resolve({ ok: false, data: { error: 'no parseable output from meet-cli', stderr: stderr.slice(-400) }, stderr, code: code ?? 1 });
      });
    });
  }

  app.get('/api/meet/sessions', (c) => {
    const active = listActiveMeetSessions();
    const recent = listRecentMeetSessions(15).filter(
      (s: MeetSession) => s.status !== 'joining' && s.status !== 'live',
    );
    return c.json({ ok: true, active, recent });
  });

  app.post('/api/meet/join', async (c) => {
    let body: { agent?: string; meet_url?: string; auto_brief?: boolean; context?: string } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    const agent = body.agent?.trim();
    const meetUrl = body.meet_url?.trim();
    const autoBrief = body.auto_brief !== false; // default true
    const context = body.context?.trim();

    if (!agent) return c.json({ ok: false, error: 'agent required' }, 400);
    if (!meetUrl || !MEET_URL_RE.test(meetUrl)) {
      return c.json({ ok: false, error: 'invalid meet_url (must match https://meet.google.com/...)' }, 400);
    }
    const validAgents = new Set(['main', ...listAgentIds()]);
    if (!validAgents.has(agent)) {
      return c.json({ ok: false, error: `unknown agent: ${agent}` }, 400);
    }

    const args = ['join', '--agent', agent, '--meet-url', meetUrl];
    if (autoBrief) args.push('--auto-brief');
    if (context) args.push('--context', context);

    // Budget: auto-brief (up to 75s) + Pika join (up to 120s) + slack = 220s
    const result = await runMeetCli(args, 220_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  app.post('/api/meet/join-voice', async (c) => {
    let body: { agent?: string; meet_url?: string; auto_brief?: boolean; context?: string } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    const agent = body.agent?.trim();
    const meetUrl = body.meet_url?.trim();
    const autoBrief = body.auto_brief !== false; // default true
    const context = body.context?.trim();

    if (!agent) return c.json({ ok: false, error: 'agent required' }, 400);
    if (!meetUrl || !MEET_URL_RE.test(meetUrl)) {
      return c.json({ ok: false, error: 'invalid meet_url (must match https://meet.google.com/...)' }, 400);
    }
    const validAgents = new Set(['main', ...listAgentIds()]);
    if (!validAgents.has(agent)) {
      return c.json({ ok: false, error: `unknown agent: ${agent}` }, 400);
    }

    const args = ['join-voice', '--agent', agent, '--meet-url', meetUrl];
    if (autoBrief) args.push('--auto-brief');
    if (context) args.push('--context', context);

    // Shorter budget than the avatar path since voice-only skips the
    // Pika upload + worker warmup. Still allows auto-brief to run.
    const result = await runMeetCli(args, 120_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  app.post('/api/meet/join-daily', async (c) => {
    let body: { agent?: string; mode?: string; auto_brief?: boolean; context?: string; ttl_sec?: number } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    const agent = body.agent?.trim();
    const mode = body.mode?.trim() || 'direct';
    const autoBrief = body.auto_brief !== false; // default true
    const context = body.context?.trim();
    const ttlSec = body.ttl_sec;

    if (!agent) return c.json({ ok: false, error: 'agent required' }, 400);
    if (mode !== 'direct' && mode !== 'auto') {
      return c.json({ ok: false, error: 'mode must be direct or auto' }, 400);
    }
    const validAgents = new Set(['main', ...listAgentIds()]);
    if (!validAgents.has(agent)) {
      return c.json({ ok: false, error: `unknown agent: ${agent}` }, 400);
    }

    const args = ['join-daily', '--agent', agent, '--mode', mode];
    if (autoBrief) args.push('--auto-brief');
    if (context) args.push('--context', context);
    if (typeof ttlSec === 'number' && ttlSec > 0) args.push('--ttl-sec', String(ttlSec));

    // Budget: briefing (~75s) + room creation (~2s) + agent spawn (~3s) = ~90s
    const result = await runMeetCli(args, 120_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  app.post('/api/meet/leave', async (c) => {
    let body: { session_id?: string } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }
    const sessionId = body.session_id?.trim();
    if (!sessionId) return c.json({ ok: false, error: 'session_id required' }, 400);
    if (!getMeetSession(sessionId)) {
      return c.json({ ok: false, error: 'session not found' }, 404);
    }
    const result = await runMeetCli(['leave', '--session-id', sessionId], 45_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  // Memory stats — same chatId-default as /api/tokens.
  app.get('/api/memories', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const stats = getDashboardMemoryStats(chatId);
    const fading = getDashboardLowSalienceMemories(chatId, 10);
    const topAccessed = getDashboardTopAccessedMemories(chatId, 5);
    const timeline = getDashboardMemoryTimeline(chatId, 30);
    const consolidations = getDashboardConsolidations(chatId, 5);
    return c.json({ stats, fading, topAccessed, timeline, consolidations });
  });

  // Memory list (for drill-down drawer). Same chatId-fallback rationale as
  // /api/memories and /api/health: the SPA can load without a chatId in the
  // URL, fall back to the primary authorized chat so the page actually
  // shows the user's memories.
  app.get('/api/memories/pinned', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const memories = getDashboardPinnedMemories(chatId);
    return c.json({ memories });
  });

  app.get('/api/memories/list', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const sortBy = (c.req.query('sort') || 'importance') as 'importance' | 'salience' | 'recent';
    const result = getDashboardMemoriesList(chatId, limit, offset, sortBy);
    return c.json(result);
  });

  // System health.
  // Same chatId-default rationale as /api/tokens: the SPA hits this without
  // a chatId param, so we fall back to the primary authorized chat so the
  // Usage page actually shows context %, turns, session age, etc.
  app.get('/api/health', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const sessionId = getSession(chatId);
    let contextPct = 0;
    let turns = 0;
    let compactions = 0;
    let sessionAge = '-';

    if (sessionId) {
      const summary = getSessionTokenUsage(sessionId);
      if (summary) {
        turns = summary.turns;
        compactions = summary.compactions;
        const contextTokens = (summary.lastContextTokens || 0) + (summary.lastCacheRead || 0);
        contextPct = contextTokens > 0 ? Math.round((contextTokens / CONTEXT_LIMIT) * 100) : 0;
        const ageSec = Math.floor(Date.now() / 1000) - summary.firstTurnAt;
        if (ageSec < 3600) sessionAge = Math.floor(ageSec / 60) + 'm';
        else if (ageSec < 86400) sessionAge = Math.floor(ageSec / 3600) + 'h';
        else sessionAge = Math.floor(ageSec / 86400) + 'd';
      }
    }

    return c.json({
      contextPct,
      turns,
      compactions,
      sessionAge,
      model: agentDefaultModel || 'sonnet-4-6',
      messengerType: MESSENGER_TYPE,
      messengerConnected: getTelegramConnected(),
      // Back-compat alias — pre-Signal clients still read telegramConnected.
      telegramConnected: getTelegramConnected(),
      waConnected: WHATSAPP_ENABLED,
      slackConnected: !!SLACK_USER_TOKEN,
      // SPA v2 expects this map (Usage/Settings/Sidebar pages call
      // Object.entries on it). Snapshot doesn't have kill-switches.ts yet,
      // so emit an empty object — the pages render nothing under "Kill
      // switches" instead of crashing on Object.entries(undefined).
      killSwitches: {},
    });
  });

  // Token / cost stats.
  // When called without a chatId (the dashboard's default — Audra / Dante
  // accessing the SPA without a chatId in the URL), default to the primary
  // authorized chat. Without this default the page filters by an empty
  // string and returns all-zero stats even though token_usage has hundreds
  // of rows for the real chat.
  app.get('/api/tokens', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const stats = getDashboardTokenStats(chatId);
    const costTimeline = getDashboardCostTimeline(chatId, 30);
    const recentUsage = getDashboardRecentTokenUsage(chatId, 20);
    return c.json({ stats, costTimeline, recentUsage });
  });

  // Bot info (name, PID, chatId) — reads dynamically from state
  app.get('/api/info', (c) => {
    const chatId = c.req.query('chatId') || '';
    const info = getBotInfo();
    return c.json({
      botName: info.name || 'ClaudeClaw',
      botUsername: info.username || '',
      pid: process.pid,
      chatId: chatId || null,
    });
  });

  // ── Agent endpoints ──────────────────────────────────────────────────

  const agentOrderFile = path.join(STORE_DIR, 'agent-order.json');
  const loadAgentOrder = (): string[] => {
    try {
      const raw = fs.readFileSync(agentOrderFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch { return []; }
  };
  const saveAgentOrder = (order: string[]) => {
    fs.writeFileSync(agentOrderFile, JSON.stringify(order, null, 2));
  };
  const applyAgentOrder = (ids: string[]): string[] => {
    const saved = loadAgentOrder();
    const present = new Set(ids);
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const id of saved) {
      if (present.has(id) && !seen.has(id)) { ordered.push(id); seen.add(id); }
    }
    for (const id of ids) {
      if (!seen.has(id)) { ordered.push(id); seen.add(id); }
    }
    return ordered;
  };

  // Persist the visual order of secondary agents (main is always pinned first)
  app.post('/api/agents/order', async (c) => {
    const body = await c.req.json<{ order?: string[] }>();
    const order = body?.order;
    if (!Array.isArray(order) || !order.every((x) => typeof x === 'string')) {
      return c.json({ error: 'order must be an array of agent ids' }, 400);
    }
    const valid = new Set(listAgentIds());
    const filtered = order.filter((id) => id !== 'main' && valid.has(id));
    saveAgentOrder(filtered);
    return c.json({ ok: true, order: filtered });
  });

  // List all configured agents with status
  app.get('/api/agents', (c) => {
    const agentIds = applyAgentOrder(listAgentIds());
    const agents = agentIds.map((id) => {
      try {
        const config = loadAgentConfig(id);
        // Check if agent process is alive via PID file
        // Main agent uses 'claudeclaw.pid'; others use 'agent-<id>.pid'
        const pidFile = path.join(STORE_DIR, id === 'main' ? 'claudeclaw.pid' : `agent-${id}.pid`);
        let running = false;
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
            process.kill(pid, 0); // signal 0 = check if alive
            running = true;
          } catch { /* process not running */ }
        }
        const stats = getAgentTokenStats(id);
        // Per-agent Telegram state: read from the conn file the agent
        // process writes on setTelegramConnected. Falls back to false
        // when the agent isn't running or hasn't emitted state yet.
        const connState = running ? readAgentConnState(id) : null;
        const telegramConnected = connState?.telegram ?? false;
        return {
          id,
          name: config.name,
          description: config.description,
          model: config.model ?? 'claude-opus-4-6',
          running,
          todayTurns: stats.todayTurns,
          todayCost: stats.todayCost,
          telegramConnected,
        };
      } catch {
        // Belt-and-suspenders: if loadAgentConfig throws (missing agent.yaml,
        // missing token, etc.), still surface the user-facing name. 'main' is
        // Nikki — every other agent capitalizes its id.
        const fallbackName = id === 'main' ? 'Nikki' : id.charAt(0).toUpperCase() + id.slice(1);
        return { id, name: fallbackName, description: '', model: 'unknown', running: false, todayTurns: 0, todayCost: 0, telegramConnected: false };
      }
    });

    // Ensure main is first and not duplicated.
    // main-config.json is the source of truth for main's description (editable via dashboard),
    // so override whatever came from agent.yaml or the fallback with getMainDescription().
    const hasMain = agentIds.includes('main');
    let allAgents = agents;
    if (!hasMain) {
      const mainPidFile = path.join(STORE_DIR, 'claudeclaw.pid');
      let mainRunning = false;
      if (fs.existsSync(mainPidFile)) {
        try {
          const pid = parseInt(fs.readFileSync(mainPidFile, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          mainRunning = true;
        } catch { /* not running */ }
      }
      const mainStats = getAgentTokenStats('main');
      // Main runs the dashboard — in-process getTelegramConnected() is
      // authoritative; no need to go through the conn file for main itself.
      const mainTelegramConnected = mainRunning ? getTelegramConnected() : false;
      allAgents = [
        { id: 'main', name: 'Main', description: getMainDescription(), model: 'claude-opus-4-6', running: mainRunning, todayTurns: mainStats.todayTurns, todayCost: mainStats.todayCost, telegramConnected: mainTelegramConnected },
        ...agents,
      ];
    } else {
      // Main was in listAgentIds; its entry came from the loop above and
      // already has a telegramConnected field. Same for sub-agents.
      // Override main's description and — since main runs the dashboard —
      // its telegramConnected from the in-process getter rather than the
      // conn file (which main also writes, but in-process is zero-latency).
      const mainFromLoop = agents.find((a) => a.id === 'main');
      const mainTelegramConnected = mainFromLoop?.running ? getTelegramConnected() : false;
      allAgents = [
        ...agents
          .filter((a) => a.id === 'main')
          .map((a) => ({ ...a, description: getMainDescription(), telegramConnected: mainTelegramConnected })),
        ...agents.filter((a) => a.id !== 'main'),
      ];
    }

    return c.json({ agents: allAgents });
  });

  // Agent-specific recent conversation
  app.get('/api/agents/:id/conversation', (c) => {
    const agentId = c.req.param('id');
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '4', 10);
    const turns = getAgentRecentConversation(agentId, chatId, limit);
    return c.json({ turns });
  });

  // Agent-specific tasks
  app.get('/api/agents/:id/tasks', (c) => {
    const agentId = c.req.param('id');
    const tasks = getAllScheduledTasks(agentId);
    return c.json({ tasks });
  });

  // Agent-specific token stats
  app.get('/api/agents/:id/tokens', (c) => {
    const agentId = c.req.param('id');
    const stats = getAgentTokenStats(agentId);
    return c.json(stats);
  });

  // Update agent description
  app.patch('/api/agents/:id/description', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{ description?: string }>();
    const description = body?.description?.trim();
    if (!description) return c.json({ error: 'description required' }, 400);
    if (description.length > 500) return c.json({ error: 'description too long (max 500)' }, 400);

    try {
      if (agentId === 'main') {
        setMainDescription(description);
      } else {
        setAgentDescription(agentId, description);
      }
      return c.json({ ok: true, agent: agentId, description });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to update description' }, 500);
    }
  });

  // Update ALL agent models at once. MUST be registered before the
  // parameterized /:id variant below: Hono matches routes first-win, so
  // if this came second, a PATCH /api/agents/model would match the
  // parameterized route with id="model" and the bulk endpoint would be
  // unreachable (the dashboard "Set all" button was silently a no-op).
  app.patch('/api/agents/model', async (c) => {
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    const validModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
    if (!validModels.includes(model)) return c.json({ error: `Invalid model` }, 400);

    const agentIds = listAgentIds();
    const updated: string[] = [];
    for (const id of agentIds) {
      try { setAgentModel(id, model); updated.push(id); } catch {}
    }
    return c.json({ ok: true, model, updated });
  });

  // Update agent model
  app.patch('/api/agents/:id/model', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    const validModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
    if (!validModels.includes(model)) return c.json({ error: `Invalid model. Valid: ${validModels.join(', ')}` }, 400);

    try {
      if (agentId === 'main') {
        // Main agent uses in-memory override (same as /model command)
        const { setMainModelOverride } = await import('./bot.js');
        setMainModelOverride(model);
      } else {
        setAgentModel(agentId, model);
      }
      return c.json({ ok: true, agent: agentId, model });
    } catch (err) {
      return c.json({ error: 'Failed to update model' }, 500);
    }
  });

  // ── Agent Creation & Management ──────────────────────────────────────

  // List available agent templates
  app.get('/api/agents/templates', (c) => {
    return c.json({ templates: listTemplates() });
  });

  // Validate an agent ID (before creation)
  app.get('/api/agents/validate-id', (c) => {
    const id = c.req.query('id') || '';
    const result = validateAgentId(id);
    const suggestions = id ? suggestBotNames(id) : null;
    return c.json({ ...result, suggestions });
  });

  // Validate a bot token
  app.post('/api/agents/validate-token', async (c) => {
    const body = await c.req.json<{ token?: string }>();
    const token = body?.token?.trim();
    if (!token) return c.json({ ok: false, error: 'token required' }, 400);
    const result = await validateBotToken(token);
    return c.json(result);
  });

  // Create a new agent
  app.post('/api/agents/create', async (c) => {
    const body = await c.req.json<{
      id?: string;
      name?: string;
      description?: string;
      model?: string;
      template?: string;
      botToken?: string;
    }>();

    const id = body?.id?.trim();
    const name = body?.name?.trim();
    const description = body?.description?.trim();
    const botToken = body?.botToken?.trim();

    if (!id) return c.json({ error: 'id required' }, 400);
    if (!name) return c.json({ error: 'name required' }, 400);
    if (!description) return c.json({ error: 'description required' }, 400);
    if (!botToken) return c.json({ error: 'botToken required' }, 400);

    try {
      const result = await createAgent({
        id,
        name,
        description,
        model: body?.model?.trim() || undefined,
        template: body?.template?.trim() || undefined,
        botToken,
      });
      return c.json({ ok: true, ...result }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  // Activate an agent (install service + start)
  app.post('/api/agents/:id/activate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot activate main via this endpoint' }, 400);
    const result = activateAgent(agentId);
    return c.json(result);
  });

  // Deactivate an agent (stop + uninstall service)
  app.post('/api/agents/:id/deactivate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot deactivate main via this endpoint' }, 400);
    const result = deactivateAgent(agentId);
    return c.json(result);
  });

  // Restart an agent (kill + relaunch service)
  app.post('/api/agents/:id/restart', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot restart main via this endpoint. Restart the main process manually.' }, 400);
    const result = restartAgent(agentId);
    if (result.ok) {
      return c.json({ ok: true, message: `Agent ${agentId} restarted` });
    }
    return c.json({ error: result.error }, 500);
  });

  // Delete an agent entirely
  app.delete('/api/agents/:id/full', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot delete main' }, 400);
    const result = deleteAgent(agentId);
    if (result.ok) {
      return c.json({ ok: true });
    }
    return c.json({ error: result.error }, 500);
  });

  // Check if a specific agent is running
  app.get('/api/agents/:id/status', (c) => {
    const agentId = c.req.param('id');
    return c.json({ running: isAgentRunning(agentId) });
  });

  // ── Security & Audit ─────────────────────────────────────────────────

  app.get('/api/security/status', (c) => {
    return c.json(getSecurityStatus());
  });

  app.get('/api/audit', (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const agentId = c.req.query('agent') || undefined;
    const entries = getAuditLog(limit, offset, agentId);
    const total = getAuditLogCount(agentId);
    return c.json({ entries, total });
  });

  app.get('/api/audit/blocked', (c) => {
    const limit = parseInt(c.req.query('limit') || '10', 10);
    return c.json({ entries: getRecentBlockedActions(limit) });
  });

  // Hive mind feed
  app.get('/api/hive-mind', (c) => {
    const agentId = c.req.query('agent');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const entries = getHiveMindEntries(limit, agentId || undefined);
    return c.json({ entries });
  });

  // ── Chat endpoints ─────────────────────────────────────────────────

  // SSE stream for real-time chat updates
  app.get('/api/chat/stream', (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial processing state
      const state = getIsProcessing();
      await stream.writeSSE({
        event: 'processing',
        data: JSON.stringify({ processing: state.processing, chatId: state.chatId }),
      });

      // Forward chat events to SSE client
      const handler = async (event: ChatEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // Client disconnected
        }
      };

      chatEvents.on('chat', handler);

      // Keepalive ping every 30s
      const pingInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: 'ping', data: '' });
        } catch {
          clearInterval(pingInterval);
        }
      }, 30_000);

      // Wait until the client disconnects
      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // Expected: client disconnected
      } finally {
        clearInterval(pingInterval);
        chatEvents.off('chat', handler);
      }
    });
  });

  // Chat history (paginated)
  app.get('/api/chat/history', (c) => {
    const chatId = c.req.query('chatId') || '';
    if (!chatId) return c.json({ error: 'chatId required' }, 400);
    const limit = parseInt(c.req.query('limit') || '40', 10);
    const beforeId = c.req.query('beforeId');
    const turns = getConversationPage(chatId, limit, beforeId ? parseInt(beforeId, 10) : undefined);
    return c.json({ turns });
  });

  // Send message from dashboard.
  // If agent_id is omitted or matches the hosting process, run in-process.
  // Otherwise route via the mission-task queue to that agent's process.
  app.post('/api/chat/send', async (c) => {
    if (!botApi) return c.json({ error: 'Bot API not available' }, 503);
    const body = await c.req.json<{ message?: string; agent_id?: string }>();
    const message = body?.message?.trim();
    if (!message) return c.json({ error: 'message required' }, 400);

    const targetAgent = body?.agent_id?.trim() || AGENT_ID;

    // Fire-and-forget: response comes via SSE
    if (targetAgent === AGENT_ID) {
      void processMessageFromDashboard(botApi, message);
    } else {
      dispatchDashboardChatToAgent(message, targetAgent);
    }
    return c.json({ ok: true, agent_id: targetAgent });
  });

  // File upload for the dashboard chat. Accepts multipart form data with
  // a file field plus an optional caption. Saves to STORE_DIR/uploads/,
  // then injects a message into the normal dashboard chat queue so Nikki
  // can read the file (images, PDFs, text) using her filesystem tools.
  app.post('/api/chat/upload', async (c) => {
    if (!botApi) return c.json({ error: 'Bot API not available' }, 503);
    try {
      const uploadsDir = path.join(STORE_DIR, 'uploads');
      await fs.promises.mkdir(uploadsDir, { recursive: true });

      const formData = await c.req.formData();
      const file = formData.get('file') as File | null;
      const caption = (formData.get('caption') as string | null)?.trim() || '';

      if (!file || !file.name) return c.json({ error: 'file required' }, 400);

      // Sanitise filename and prefix with timestamp so uploads never clobber each other.
      const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 120);
      const destName = `${Date.now()}_${safeName}`;
      const destPath = path.join(uploadsDir, destName);

      const buf = Buffer.from(await file.arrayBuffer());
      await fs.promises.writeFile(destPath, buf);

      // Build the injected message. Nikki can use her Read tool to open
      // the file (images as base64, PDFs via text extraction, etc.)
      const mime = file.type || 'application/octet-stream';
      const isImage = mime.startsWith('image/');
      const isPdf   = mime === 'application/pdf';
      const kind = isImage ? 'image' : isPdf ? 'PDF' : 'file';
      const captionLine = caption ? `\nUser caption: "${caption}"` : '';
      const msg = `[Dashboard ${kind} upload]\nPath: ${destPath}\nFilename: ${file.name}\nMIME: ${mime}${captionLine}\n\nPlease review the ${kind} at the path above and respond to it.`;

      void processMessageFromDashboard(botApi, msg);
      return c.json({ ok: true, path: destPath });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Text-to-speech for the dashboard chat. Returns MP3 bytes via the
  // existing voice cascade (ElevenLabs → Gradium → Kokoro → say). The
  // dashboard's NikkiCard plays the response in an <audio> element, so
  // Nikki sounds identical across Telegram, WarRoom, and dashboard.
  app.post('/api/chat/tts', async (c) => {
    try {
      const body = await c.req.json<{ text?: string }>();
      const text = (body?.text || '').trim();
      if (!text) return c.json({ error: 'text required' }, 400);
      if (text.length > 5000) return c.json({ error: 'text too long (max 5000 chars)' }, 400);
      const audio = await synthesizeSpeech(text);
      return new Response(audio, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(audio.length),
          'Cache-Control': 'no-store',
        },
      });
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, '/api/chat/tts failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // List the user's ElevenLabs voices, filtered to female, plus the
  // currently-selected voice ID (from volume override, env fallback).
  // The selected voice is always included at the head of the list even
  // if it's a public-library voice not in the user's account — that way
  // the picker can render it as "current" without a 404.
  app.get('/api/voices/elevenlabs', async (c) => {
    try {
      const env = readEnvFile(['ELEVENLABS_API_KEY']);
      const apiKey = env.ELEVENLABS_API_KEY;
      if (!apiKey) return c.json({ error: 'ELEVENLABS_API_KEY not set', voices: [], selectedVoiceId: '' }, 400);
      const selectedVoiceId = getElevenLabsVoiceId();

      // Fetch the user's account voices
      const r = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey, 'Accept': 'application/json' },
      });
      if (!r.ok) {
        return c.json({ error: `ElevenLabs HTTP ${r.status}`, voices: [], selectedVoiceId }, r.status as 500);
      }
      const j: any = await r.json();
      const all: any[] = j?.voices || [];
      const female = all
        .filter(v => v?.labels?.gender?.toLowerCase() === 'female')
        .map(v => ({
          voiceId: v.voice_id,
          name: v.name,
          category: v.category,
          labels: v.labels,
          previewUrl: v.preview_url || null,
          description: (v.description || '').slice(0, 200),
        }));

      // If the selected voice isn't in the female list, fetch its details
      // separately (works for public-library voices used by direct TTS).
      let needsPin = !!selectedVoiceId && !female.find(v => v.voiceId === selectedVoiceId);
      if (needsPin) {
        try {
          const detail = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(selectedVoiceId)}`, {
            headers: { 'xi-api-key': apiKey, 'Accept': 'application/json' },
          });
          if (detail.ok) {
            const dj: any = await detail.json();
            female.unshift({
              voiceId: dj.voice_id || selectedVoiceId,
              name: dj.name || 'Current voice',
              category: dj.category || 'library',
              labels: dj.labels || {},
              previewUrl: dj.preview_url || null,
              description: (dj.description || '').slice(0, 200),
            });
          } else {
            // Voice not in account — render a placeholder so the user can see it's set.
            female.unshift({
              voiceId: selectedVoiceId,
              name: `Custom voice (${selectedVoiceId.slice(0, 6)}…)`,
              category: 'custom',
              labels: { gender: 'female' },
              previewUrl: null,
              description: '',
            });
          }
        } catch { /* ignore */ }
      }

      return c.json({ voices: female, selectedVoiceId });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e), voices: [], selectedVoiceId: '' }, 500);
    }
  });

  // Persist a new selected ElevenLabs voice ID. Applies instantly to all
  // channels (Telegram, WarRoom, dashboard) — no restart, no redeploy.
  app.post('/api/voices/elevenlabs/selected', async (c) => {
    try {
      const body = await c.req.json<{ voiceId?: string }>();
      const id = (body?.voiceId || '').trim();
      if (!id) return c.json({ error: 'voiceId required' }, 400);
      setElevenLabsVoiceId(id);
      return c.json({ ok: true, selectedVoiceId: id });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // ── Second brain / Obsidian vault ────────────────────────────────────
  // Reads the Syncthing-synced vault at /app/store/obsidian-brain and
  // exposes it as the new Brain page in Mission Control.

  app.get('/api/brain/stats', (c) => {
    try { return c.json(getBrainStats()); }
    catch (e) { return c.json({ error: String((e as Error)?.message || e) }, 500); }
  });

  app.get('/api/brain/notes', (c) => {
    try {
      const folder = c.req.query('folder') || undefined;
      const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
      const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined;
      return c.json(listNotes({ folder, limit, offset }));
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Single note — path is everything after /api/brain/note/ so folders work
  app.get('/api/brain/note', (c) => {
    try {
      const p = c.req.query('path') || '';
      if (!p) return c.json({ error: 'path query required' }, 400);
      const detail = getNote(p);
      if (!detail) return c.json({ error: 'not found', path: p }, 404);
      return c.json(detail);
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.get('/api/brain/search', (c) => {
    try {
      const q = c.req.query('q') || '';
      const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
      return c.json(searchNotes(q, limit));
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  app.get('/api/brain/graph', (c) => {
    try {
      const center = c.req.query('center') || undefined;
      const hops = c.req.query('hops') ? parseInt(c.req.query('hops')!, 10) : undefined;
      return c.json(getGraph({ center, hops }));
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Force-rebuild the in-memory index. Useful after a big vault edit.
  app.post('/api/brain/reindex', (c) => {
    invalidateBrainCache();
    invalidateProposalsCache();
    return c.json({ ok: true, stats: getBrainStats() });
  });

  // Promotion proposals — patterns in the memory DB worth promoting to canon.
  app.get('/api/brain/proposals', (c) => {
    try {
      const force = c.req.query('force') === '1';
      return c.json({ proposals: getBrainProposals({ force }) });
    } catch (e) {
      return c.json({ error: String((e as Error)?.message || e), proposals: [] }, 500);
    }
  });

  // Fetch all memories for a given topic — used by the proposal review modal
  // so the user can see the full set of memories before deciding to add to wiki.
  app.get('/api/brain/proposals/memories', (c) => {
    const topic = (c.req.query('topic') || '').trim();
    if (!topic) return c.json({ memories: [] });
    try {
      const memories = getMemoriesForTopic(topic);
      return c.json({ memories });
    } catch (e) {
      logger.warn({ err: String((e as Error)?.message || e) }, '/api/brain/proposals/memories failed');
      return c.json({ memories: [] });
    }
  });

  // Accept a proposal — create a stub wiki note from the suggested name + examples.
  // The note is written to Decisions/ (or whatever folder the user prefers via
  // body.folder) and Syncthing pushes it back to the Mac.
  // Optional body.content overrides the auto-generated note body so the user
  // can edit the draft in the review modal before saving.
  app.post('/api/brain/proposals/accept', async (c) => {
    try {
      const body = await c.req.json<{ topic?: string; folder?: string; examples?: string[]; content?: string }>();
      const topic = String(body?.topic || '').trim();
      if (!topic) return c.json({ error: 'topic required' }, 400);
      const folder = String(body?.folder || 'Decisions').trim();
      const examples = Array.isArray(body?.examples) ? body!.examples!.slice(0, 5) : [];
      const stats = getBrainStats();
      if (!stats.exists) return c.json({ error: 'vault not present on disk' }, 500);
      const noteName = topic.charAt(0).toUpperCase() + topic.slice(1);
      const dirPath = path.join(stats.vaultPath, folder);
      try { fs.mkdirSync(dirPath, { recursive: true }); } catch { /* ignore */ }
      const filePath = path.join(dirPath, noteName.replace(/[\\/]/g, '-') + '.md');
      if (fs.existsSync(filePath)) {
        // Bust the proposals cache so this stale entry disappears from the
        // next /api/brain/proposals call — otherwise the user could keep
        // hitting the same duplicate for up to 15 min.
        invalidateProposalsCache();
        return c.json({ error: 'note already exists', path: filePath }, 409);
      }
      const today = new Date().toISOString().slice(0, 10);
      // Use caller-supplied content if provided (edited in the review modal),
      // otherwise fall back to the auto-generated stub.
      let content: string;
      if (typeof body?.content === 'string' && body.content.trim().length > 0) {
        content = body.content;
      } else {
        const exampleLines = examples.map(e => `> ${e.replace(/\n+/g, ' ')}`).join('\n\n');
        content = `---\ntitle: ${noteName}\ntags: [proposed, ${today}]\n---\n\n# ${noteName}\n\n*Promoted from memory pattern on ${today}. Edit freely.*\n\n${exampleLines}\n\n## Why this is worth keeping\n\n*Add context here.*\n\n## Related\n\n- *Add wikilinks here*\n`;
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      invalidateBrainCache();
      invalidateProposalsCache();
      return c.json({ ok: true, path: filePath });
    } catch (e) {
      logger.error({ err: String((e as Error)?.message || e) }, '/api/brain/proposals/accept failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Update the summary text of a memory (inline text editing).
  app.patch('/api/brain/memories/:id/summary', async (c) => {
    try {
      const id = Number(c.req.param('id'));
      if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
      const body = await c.req.json<{ summary?: string }>();
      const summary = String(body?.summary || '').trim();
      if (!summary) return c.json({ error: 'summary required' }, 400);
      const ok = updateMemorySummary(id, summary);
      return c.json({ ok });
    } catch (e) {
      logger.warn({ err: String((e as Error)?.message || e) }, 'PATCH /api/brain/memories/:id/summary failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Update the full topics array on a memory (re-assign to different proposals).
  app.patch('/api/brain/memories/:id/topics', async (c) => {
    try {
      const id = Number(c.req.param('id'));
      if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
      const body = await c.req.json<{ topics?: unknown }>();
      if (!Array.isArray(body?.topics)) return c.json({ error: 'topics must be an array' }, 400);
      const topics = (body.topics as unknown[]).map(t => String(t).trim()).filter(Boolean);
      const ok = updateMemoryTopics(id, topics);
      return c.json({ ok });
    } catch (e) {
      logger.warn({ err: String((e as Error)?.message || e) }, 'PATCH /api/brain/memories/:id/topics failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Remove a single topic tag from a memory (dismiss it from a proposal).
  app.delete('/api/brain/memories/:id/topic', async (c) => {
    try {
      const id = Number(c.req.param('id'));
      if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
      const body = await c.req.json<{ topic?: string }>();
      const topic = String(body?.topic || '').trim();
      if (!topic) return c.json({ error: 'topic required' }, 400);
      const ok = removeTopicFromMemory(id, topic);
      return c.json({ ok });
    } catch (e) {
      logger.warn({ err: String((e as Error)?.message || e) }, 'DELETE /api/brain/memories/:id/topic failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Merge one proposal topic into another — renames all matching topic tags
  // across the memories table so the two proposals collapse into one.
  app.post('/api/brain/proposals/merge', async (c) => {
    try {
      const body = await c.req.json<{ from?: string; into?: string }>();
      const from = String(body?.from || '').trim();
      const into = String(body?.into || '').trim();
      if (!from || !into) return c.json({ error: 'from and into required' }, 400);
      if (from.toLowerCase() === into.toLowerCase()) return c.json({ error: 'cannot merge a topic into itself' }, 400);
      const count = mergeTopics(from, into);
      return c.json({ ok: true, updated: count });
    } catch (e) {
      logger.warn({ err: String((e as Error)?.message || e) }, 'POST /api/brain/proposals/merge failed');
      return c.json({ error: String((e as Error)?.message || e) }, 500);
    }
  });

  // Abort current processing
  app.post('/api/chat/abort', (c) => {
    const { chatId } = getIsProcessing();
    if (!chatId) return c.json({ ok: false, reason: 'not_processing' });
    const aborted = abortActiveQuery(chatId);
    return c.json({ ok: aborted });
  });


  // ----- parity helper functions (ported from osrepo/main) -----
  function pickerRedirect(chatId: string) {
    const q = new URLSearchParams({ token: DASHBOARD_TOKEN });
    if (chatId) q.set('chatId', chatId);
    return '/warroom?' + q.toString();
  }

  function requireOpenMeeting(meetingId: string) {
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return { error: 'meeting_not_found' as const, status: 404 as const };
    if (meeting.ended_at !== null) return { error: 'meeting_ended' as const, status: 410 as const };
    return { meeting };
  }

  function requireChatMatches(
    meeting: { chat_id: string },
    requestChatId: string,
  ): { ok: true } | { ok: false; error: string; status: 403 } {
    if (meeting.chat_id === '') return { ok: true };
    if (meeting.chat_id === requestChatId) return { ok: true };
    return { ok: false, error: 'chat_mismatch', status: 403 };
  }

  async function endTextMeeting(meetingId: string): Promise<{ alreadyEnded: boolean; entryCount: number }> {
    const meeting = getTextMeeting(meetingId);
    if (!meeting || meeting.ended_at !== null) {
      const rows = meeting ? getWarRoomTranscript(meetingId) : [];
      return { alreadyEnded: true, entryCount: rows.length };
    }
    const rows = getWarRoomTranscript(meetingId);
    endWarRoomMeeting(meetingId, rows.length);
    if (getActiveTurnIds(meetingId).length > 0) {
      cancelMeetingTurns(meetingId);
      await waitForMeetingTurnsIdle(meetingId, 3000);
    }
    // Clear the SDK sessions tied to this meeting. Without this, every
    // meeting leaves orphan rows in the `sessions` table keyed on
    // warroom-text:<meetingId>:<agentId>; the rows can't be looked up
    // again (UUID-fresh meetingIds) but they accumulate forever. Mirror
    // the /clear endpoint's behavior so /end is a true cleanup.
    try {
      const agents = getRoster().map((a) => a.id);
      clearMeetingSessions(meetingId, agents);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, meetingId },
        'clearMeetingSessions failed during endTextMeeting (non-fatal)',
      );
    }
    // Notify every connected tab BEFORE we close the channel so they can
    // disable their composers and show the "meeting ended" state.
    const channel = getChannel(meetingId);
    channel.emit({
      type: 'meeting_ended',
      meetingId,
      at: Math.floor(Date.now() / 1000),
    });
    // Close the channel after a short grace period so in-flight SSE
    // writes finish draining to clients.
    setTimeout(() => closeChannel(meetingId), 1500);
    return { alreadyEnded: false, entryCount: rows.length };
  }

  function validateStandupConfigJson(value: string): string | null {
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { return 'standup_config: value must be valid JSON'; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'standup_config: value must be a JSON object';
    }
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.agents)) {
      return 'standup_config: agents must be an array';
    }
    for (const a of obj.agents) {
      if (!a || typeof a !== 'object' || typeof (a as { id?: unknown }).id !== 'string') {
        return 'standup_config: each agent entry must be { id: string, enabled?: boolean }';
      }
      const enabled = (a as { enabled?: unknown }).enabled;
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return 'standup_config: agent.enabled must be boolean when present';
      }
    }
    if (typeof obj.maxSpeakers !== 'number' || !Number.isFinite(obj.maxSpeakers)
        || !Number.isInteger(obj.maxSpeakers) || obj.maxSpeakers < 1 || obj.maxSpeakers > 8) {
      return 'standup_config: maxSpeakers must be an integer in [1, 8]';
    }
    return null;
  }

  const ALLOWED_SETTING_KEYS = new Set([
    'workspace_name',
    'hotkey_mod', // 'meta' | 'ctrl' | 'auto'
    'sidebar_collapsed_sections', // JSON array of section ids
    'mission_column_order', // JSON array of agent ids
    'mission_column_widths', // JSON object { id: px }
    // JSON {agents: [{id, enabled}], maxSpeakers}. Drives /standup
    // and /discuss in the text War Room — the user picks who's in,
    // their order, and the cap. Read by pickSlashRoster() in
    // src/warroom-text-orchestrator.ts. UI: web/src/pages/StandupConfig.tsx.
    'standup_config',
  ]);

  const SETTING_VALUE_MAX_BYTES = 4 * 1024;

  const ALLOWED_KILL_SWITCHES = new Set([
    'WARROOM_TEXT_ENABLED',
    'WARROOM_VOICE_ENABLED',
    'LLM_SPAWN_ENABLED',
    'DASHBOARD_MUTATIONS_ENABLED',
    'MISSION_AUTO_ASSIGN_ENABLED',
    'SCHEDULER_ENABLED',
  ]);

  // ===== parity routes ported from osrepo/main (settings, kill-switch, suggestions, war room text) =====
  app.get('/warroom/text', (c) => {
    // Legacy HTML embeds DASHBOARD_TOKEN — gate it inline since the
    // global middleware now only protects /api/*.
    const denied = requireToken(c); if (denied) return denied;
    const chatId = c.req.query('chatId') || '';
    const meetingId = (c.req.query('meetingId') || '').trim();
    const archive = c.req.query('archive') === '1';
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) {
      return c.redirect(pickerRedirect(chatId));
    }
    const existing = getTextMeeting(meetingId);
    if (!existing) {
      return c.redirect(pickerRedirect(chatId));
    }
    if (existing.ended_at !== null && !archive) {
      return c.redirect(pickerRedirect(chatId));
    }
    // Chat-id mismatch: don't render the page (would let a stale meetingId
    // from chat A render under chat B's session). Send them back to the
    // picker for their actual chat. Legacy meetings with chat_id='' bypass
    // this since they pre-date the migration.
    if (existing.chat_id !== '' && existing.chat_id !== chatId) {
      return c.redirect(pickerRedirect(chatId));
    }
    return c.html(getWarRoomTextHtml(DASHBOARD_TOKEN, chatId, meetingId));
  });

  app.get('/api/warroom/text/list', (c) => {
    const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') || '20', 10) || 20));
    // Optional chat-scope: if the picker passes its current chatId, return
    // only meetings for that chat. Picker without chatId (admin/debug or
    // legacy clients) sees everything.
    const chatIdRaw = c.req.query('chatId');
    const chatId = chatIdRaw !== undefined ? chatIdRaw : undefined;
    return c.json({ ok: true, meetings: getTextMeetings(limit, chatId) });
  });

  app.post('/api/warroom/text/new', async (c) => {
    let body: { chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const chatId = (body.chatId || '').trim();
    const id = `wr_${Math.floor(Date.now() / 1000).toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    createTextMeeting(id, chatId);
    // Prime the channel so the SSE emit for meeting_state has a target.
    getChannel(id);
    // Force-end any prior open text meetings IN THE SAME CHAT so a refresh
    // / new visit starts clean WITHOUT clobbering meetings from other
    // chats sharing the box. Fire-and-forget — DB update is synchronous,
    // only the SSE-emit + cancel-turns wait is async, and the response
    // shouldn't block on those.
    const stale = getOpenTextMeetingIds(id, chatId);
    if (stale.length > 0) {
      logger.info({ closing: stale, newMeetingId: id, chatId }, 'auto-ending stale text meetings on /new');
      for (const sid of stale) {
        void endTextMeeting(sid).catch((err) => {
          logger.warn({
            err: err instanceof Error ? err.message : err,
            staleMeetingId: sid,
          }, 'auto-end of stale meeting failed (non-fatal)');
        });
      }
    }
    return c.json({ ok: true, meetingId: id, autoEnded: stale });
  });

  app.post('/api/warroom/text/warmup', async (c) => {
    if (isWarmupDone()) return c.json({ ok: true, already: true });
    // Don't await — the client doesn't need the result, it just wants
    // the server to have started. The promise resolves in the background.
    void warmupMeeting();
    return c.json({ ok: true, started: true });
  });

  app.get('/api/warroom/text/history', (c) => {
    const meetingId = (c.req.query('meetingId') || '').trim();
    const reqChatId = (c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    const limit = Math.max(1, Math.min(500, parseInt(c.req.query('limit') || '200', 10) || 200));
    const beforeTsRaw = c.req.query('beforeTs');
    const beforeIdRaw = c.req.query('beforeId');
    const beforeTs = beforeTsRaw ? parseInt(beforeTsRaw, 10) : undefined;
    const beforeId = beforeIdRaw ? parseInt(beforeIdRaw, 10) : undefined;
    // Capture latestSeq BEFORE the transcript query. If a new row is
    // persisted + emits between these two reads, the transcript query
    // sees the row, and the client connects SSE from a seq that still
    // covers the emit — seenSeqs dedup takes care of duplicates.
    // Reverse order (seq-first, then rows) avoids the opposite race where
    // a row emits after the transcript read but before the seq read,
    // causing the client to advance past a row it never received.
    const latestSeq = getChannel(meetingId).latestSeq();
    const rows = getWarRoomTranscript(meetingId, { limit, beforeTs, beforeId }).reverse();
    return c.json({
      ok: true,
      meetingId,
      transcript: rows,
      pinnedAgent: meeting.pinned_agent,
      meetingStartedAt: meeting.started_at,
      endedAt: meeting.ended_at,
      agents: getRoster(),
      latestSeq,
    });
  });

  app.get('/api/warroom/text/stream', (c) => {
    const meetingId = (c.req.query('meetingId') || '').trim();
    const reqChatId = (c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    // Clients that reconnect to an already-ended meeting still get a
    // stream — we emit a meeting_ended event immediately then close. This
    // lets the UI show the ended state instead of silently hanging.
    const sinceSeq = Math.max(0, parseInt(c.req.query('sinceSeq') || '0', 10) || 0);

    return streamSSE(c, async (stream) => {
      const channel = getChannel(meetingId);

      // 1. Send meeting_state snapshot with the current roster + pin so
      //    the client can render without waiting for the next real event.
      const stateEvent = {
        type: 'meeting_state' as const,
        meetingId,
        pinnedAgent: meeting.pinned_agent,
        agents: getRoster(),
        isFresh: meeting.ended_at === null && meeting.entry_count === 0,
      };
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({ seq: 0, event: stateEvent }),
      });

      // If the meeting already ended when the client connects, tell them
      // immediately so they can render the ended state instead of hanging.
      if (meeting.ended_at !== null) {
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({ seq: 0, event: { type: 'meeting_ended', meetingId, at: meeting.ended_at } }),
        });
        return;
      }

      // 2. Subscribe FIRST so events emitted concurrently with the replay
      //    drain aren't lost in the gap between since() and subscribe().
      //    Writes are serialized through a tiny async queue so rapid
      //    chunks can't reorder (EventEmitter.emit doesn't await our
      //    async handler otherwise).
      const seenSeqs = new Set<number>();
      let writeChain: Promise<void> = Promise.resolve();
      const writeOrdered = (seq: number, event: unknown) => {
        if (seenSeqs.has(seq)) return;
        seenSeqs.add(seq);
        writeChain = writeChain.then(async () => {
          try {
            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({ seq, event }),
            });
          } catch { /* client disconnected */ }
        });
      };

      const unsub = channel.subscribe((entry) => {
        writeOrdered(entry.seq, entry.event);
      });

      // 3. Detect replay gaps. If the client's sinceSeq is older than the
      //    oldest event we still have in the ring buffer, the replay
      //    would silently drop everything between (sinceSeq, oldestSeq).
      //    Tell the client so it can hard-reload the transcript via
      //    /history instead of rendering an inconsistent stream.
      const oldest = channel.oldestSeq();
      const latest = channel.latestSeq();
      if (sinceSeq > 0 && oldest > 0 && sinceSeq < oldest - 1) {
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({
            seq: 0,
            event: { type: 'replay_gap', sinceSeq, oldestSeq: oldest, latestSeq: latest },
          }),
        });
      }

      // 4. Drain the replay window AFTER subscribing. The seenSeqs dedup
      //    set guarantees we never duplicate an event that the live
      //    subscription also caught.
      const missed = channel.since(sinceSeq);
      for (const entry of missed) {
        writeOrdered(entry.seq, entry.event);
      }

      const ping = setInterval(async () => {
        try { await stream.writeSSE({ event: 'ping', data: '' }); }
        catch { clearInterval(ping); }
      }, 30_000);

      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // expected: client disconnected
      } finally {
        clearInterval(ping);
        unsub();
      }
    });
  });

  app.post('/api/warroom/text/send', async (c) => {
    let body: { meetingId?: string; text?: string; clientMsgId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const text = (body.text || '').trim();
    const clientMsgId = (body.clientMsgId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    // DASHBOARD_MUTATIONS_ENABLED + LLM_SPAWN_ENABLED are enforced by
    // global middlewares (mutation middleware above; LLM-spawn refusal
    // happens inside runAgentTurn). Only WARROOM_TEXT_ENABLED is
    // feature-specific and remains here.
    if (!killSwitches.isEnabled('WARROOM_TEXT_ENABLED')) {
      return c.json({ error: 'text war room disabled' }, 503);
    }
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    if (!text) return c.json({ error: 'empty text' }, 400);
    if (text.length > 8000) return c.json({ error: 'text too long (max 8000 chars)' }, 400);
    if (!CLIENT_MSG_ID_RE.test(clientMsgId)) return c.json({ error: 'invalid clientMsgId' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);

    // Fire-and-forget through the per-meeting queue. The client learns
    // about progress via SSE. The handleTextTurn call is wrapped in a
    // hard watchdog: if the whole turn takes longer than TURN_BUDGET_MS,
    // we force the queue to unblock so subsequent sends aren't held
    // hostage by a single hung SDK subprocess. The watchdog fires at
    // the queue level (not inside the orchestrator) so even if the
    // orchestrator never returns, the FIFO drains.
    //
    // Budget derivation:
    //   router (20s) + primary (75s)
    //   + 2 × ( intervention gate (25s) + intervener (45s) )
    //   = 235s of agent work,
    //   + ~30s for SDK cold-start + transcript I/O + queue overhead
    //   = ~265s realistic worst case for a healthy long turn.
    // Set TURN_BUDGET_MS to 300_000 so the budget actually clears the
    // worst case by a comfortable margin. The previous 240s was 5s over
    // the bare math, which meant healthy long turns were getting cut
    // off as "took too long".
    const TURN_BUDGET_MS = 300_000;
    messageQueue.enqueue(`warroom-text:${meetingId}`, async () => {
      let finished = false;
      const turnPromise = handleTextTurn(meetingId, text, clientMsgId).finally(() => { finished = true; });
      await Promise.race([
        turnPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (finished) return;
            // Timed out. Emit a user-visible error via the channel so the
            // UI unfreezes. Use turn_aborted scoped to the actual active
            // turnId(s) — turn_complete with a synthetic 'watchdog' id
            // can't drive turnId-scoped UI cleanup correctly.
            const ch = getChannel(meetingId);
            ch.emit({
              type: 'system_note',
              text: 'That turn took too long to complete and was interrupted. Send again, or end and restart the meeting if this keeps happening.',
              tone: 'warn',
              dismissable: true,
            });
            const activeTurns = getActiveTurnIds(meetingId);
            for (const tid of activeTurns) {
              ch.emit({ type: 'turn_aborted', turnId: tid, clearedAgents: [] });
              // Mark finalized AFTER emitting turn_aborted so the abort
              // event itself reaches the client. From here on, late SDK
              // chunks/agent_done/transcript writes for this turnId are
              // dropped by the channel — they can't leak into the next
              // queued turn's bubbles.
              ch.markTurnFinalized(tid);
            }
            cancelMeetingTurns(meetingId);
            resolve();
          }, TURN_BUDGET_MS);
        }),
      ]);
      // After the race settles (whether the turn finished cleanly or the
      // watchdog fired), give the orchestrator a brief grace window to
      // finish its async cleanup before we let the next queued turn run.
      // This prevents a half-aborted turn's late agent_done from racing
      // with a freshly-started turn's bubbles.
      if (!finished) {
        await Promise.race([
          turnPromise,
          new Promise<void>((r) => setTimeout(r, 2000)),
        ]);
      }
    });
    return c.json({ ok: true, queued: true });
  });

  app.post('/api/warroom/text/abort', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    const count = cancelMeetingTurns(meetingId);
    return c.json({ ok: true, cancelled: count });
  });

  app.post('/api/warroom/text/pin', async (c) => {
    let body: { meetingId?: string; agentId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const agentId = (body.agentId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const rosterIds = new Set(getRoster().map((a) => a.id));
    if (!rosterIds.has(agentId)) return c.json({ error: 'unknown agent' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    setMeetingPin(meetingId, agentId);
    // Tell every connected tab so the pin indicator stays in sync
    // without a reload. Without this, tabs that didn't initiate the
    // pin click rendered the wrong roster state until they reconnected.
    getChannel(meetingId).emit({ type: 'meeting_state_update', pinnedAgent: agentId });
    return c.json({ ok: true, meetingId, pinnedAgent: agentId });
  });

  app.post('/api/warroom/text/unpin', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    setMeetingPin(meetingId, null);
    getChannel(meetingId).emit({ type: 'meeting_state_update', pinnedAgent: null });
    return c.json({ ok: true, meetingId, pinnedAgent: null });
  });

  app.post('/api/warroom/text/clear', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    // Cancel any in-flight turn FIRST and wait for it to exit before we
    // wipe sessions. Otherwise runAgentTurn's setSession() can land after
    // clearMeetingSessions() and resurrect the cleared session id, leaving
    // the user with "memory cleared" UX but the agent still resuming the
    // prior thread.
    if (getActiveTurnIds(meetingId).length > 0) {
      cancelMeetingTurns(meetingId);
      await waitForMeetingTurnsIdle(meetingId, 5000);
    }
    const agents = getRoster().map((a) => a.id);
    const cleared = clearMeetingSessions(meetingId, agents);
    // Persist the divider so reload still shows the marker. Speaker
    // __divider__ is handled client-side to render as a dashed divider.
    addWarRoomTranscript(meetingId, '__divider__', 'Memory cleared — agents start fresh from here');
    const channel = getChannel(meetingId);
    channel.emit({
      type: 'divider',
      kind: 'memory_cleared',
      text: 'Memory cleared — agents start fresh from here',
    });
    channel.emit({
      type: 'system_note',
      text: 'Sessions cleared. Next message starts fresh.',
      tone: 'info',
      dismissable: true,
    });
    return c.json({ ok: true, cleared });
  });

  app.post('/api/warroom/text/end', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    const result = await endTextMeeting(meetingId);
    if (result.alreadyEnded) {
      return c.json({ ok: true, meetingId, alreadyEnded: true });
    }
    return c.json({ ok: true, meetingId, entryCount: result.entryCount });
  });

  app.get('/api/agents/suggestions', (c) => {
    return c.json({ suggestions: listActiveAgentSuggestions() });
  });

  app.post('/api/agents/suggestions/refresh', async (c) => {
    const liveAgents = ['main', ...listAgentIds()];
    const agentMeta: Array<{ id: string; description: string; rawCount: number; recentSummaries: string[] }> = [];
    for (const id of liveAgents) {
      let description = '';
      if (id !== 'main') {
        try { description = loadAgentConfig(id).description || ''; } catch { /* skip */ }
      } else {
        description = 'Primary ClaudeClaw bot — general triage and routing';
      }
      const entries = getHiveMindEntries(200, id);
      const allFiltered = entries
        .map((e) => `[${e.action}] ${e.summary}`)
        .filter((s) => s.length > 0);
      // Sample evenly across the agent's last 200 entries, picking 12
      // representative summaries. We want diversity (different domains,
      // not just the latest cluster) without bloating the prompt past
      // Haiku's comfort zone — total prompt with 6 agents × 12
      // summaries × ~80 chars stays under ~2 KB and typically completes
      // in 15–25s.
      const target = 12;
      const recentSummaries = allFiltered.length <= target
        ? allFiltered
        : allFiltered.filter((_, i) => i % Math.ceil(allFiltered.length / target) === 0).slice(0, target);
      agentMeta.push({ id, description, rawCount: allFiltered.length, recentSummaries });
    }

    // Skip agents with too little signal — splitting an agent that's
    // done 5 things isn't useful, and Haiku will hallucinate splits.
    const eligible = agentMeta.filter((a) => a.rawCount >= 20);
    if (eligible.length === 0) {
      return c.json({ ok: true, suggestions: [], reason: 'not enough hive_mind activity to analyze' });
    }

    const recentlySuggested = new Set(
      getRecentlySuggestedSplits(30).map((r) => `${r.from_agent}::${r.suggested_id}`),
    );

    // Prompt: "for each agent, is one doing many distinct domains?"
    // Constrain the model to suggest AT MOST one split per agent and
    // require activity_share_pct so the user knows whether the
    // suggestion is meaningful (a 5%-share split isn't worth doing).
    const promptParts = [
      'You analyze a multi-agent system to spot when an agent has drifted into doing many distinct things and should be split.',
      '',
      'For each agent below, decide: is there ONE coherent sub-domain handling >= 25% of their recent activity that would benefit from being its own specialized agent? Only suggest a split when the new agent would have a clean scope and the parent agent would be more focused after the split.',
      '',
      'Return JSON with this exact shape:',
      '{ "suggestions": [{ "from_agent": "<id>", "suggested_id": "<lowercase-id>", "suggested_name": "<Title Case>", "suggested_description": "<one-sentence scope, 80 chars max>", "reasoning": "<why now, 200 chars max>", "activity_share_pct": <integer 0-100> }] }',
      '',
      'Rules:',
      '- suggested_id must be lowercase letters, numbers, hyphens; not match an existing agent.',
      '- Suggest at most one split per from_agent.',
      '- Skip suggestions where activity_share_pct < 25.',
      '- If no agent needs splitting, return { "suggestions": [] }.',
      '',
      'Agents:',
    ];
    for (const a of eligible) {
      promptParts.push('');
      promptParts.push(`AGENT: ${a.id}`);
      promptParts.push(`DESCRIPTION: ${a.description || '(no description)'}`);
      promptParts.push('RECENT ACTIVITY:');
      for (const s of a.recentSummaries) {
        promptParts.push(`  - ${s}`);
      }
    }
    const existingIds = new Set(liveAgents);

    let raw = '';
    const promptStr = promptParts.join('\n');
    logger.info({ promptBytes: promptStr.length, agentCount: eligible.length }, 'agent suggestion: starting analysis');
    const t0 = Date.now();
    try {
      // 120s timeout — the dashboard process spawns the SDK subprocess
      // alongside its own busy event loop (war-room polling, memory
      // ingest, scheduler). Cold-starts under load have measured up to
      // 90s in practice, vs 4–5s for a standalone CLI call with the
      // same prompt size. Better to wait than fail spuriously.
      raw = await extractViaClaude(promptStr, 120_000);
      logger.info({ elapsedMs: Date.now() - t0, responseBytes: raw.length }, 'agent suggestion: Haiku replied');
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err, elapsedMs: Date.now() - t0 }, 'agent suggestion analysis failed');
      return c.json({ error: 'analysis failed (Haiku unavailable)' }, 503);
    }
    const parsed = parseJsonResponse<{ suggestions: any[] }>(raw);
    const list = Array.isArray(parsed?.suggestions) ? parsed!.suggestions : [];

    let inserted = 0;
    let skipped = 0;
    for (const s of list) {
      if (!s || typeof s !== 'object') { skipped++; continue; }
      const fromAgent = String(s.from_agent || '').trim();
      const suggestedId = String(s.suggested_id || '').trim().toLowerCase();
      const suggestedName = String(s.suggested_name || '').trim();
      const suggestedDescription = String(s.suggested_description || '').trim();
      const reasoning = String(s.reasoning || '').trim();
      const sharePct = Math.max(0, Math.min(100, Math.round(Number(s.activity_share_pct) || 0)));

      if (!fromAgent || !existingIds.has(fromAgent)) { skipped++; continue; }
      if (!/^[a-z0-9-]{2,32}$/.test(suggestedId)) { skipped++; continue; }
      if (existingIds.has(suggestedId)) { skipped++; continue; }
      if (!suggestedName || !suggestedDescription || !reasoning) { skipped++; continue; }
      if (sharePct < 25) { skipped++; continue; }
      // Don't re-suggest the exact same split we already proposed in
      // the last 30 days (whether dismissed or still active).
      if (recentlySuggested.has(`${fromAgent}::${suggestedId}`)) { skipped++; continue; }

      insertAgentSuggestion({
        from_agent: fromAgent,
        suggested_id: suggestedId,
        suggested_name: suggestedName,
        suggested_description: suggestedDescription.slice(0, 200),
        reasoning: reasoning.slice(0, 500),
        activity_share_pct: sharePct,
      });
      inserted++;
    }
    insertAuditLog('main', '', 'agent_suggestion_refresh', `inserted=${inserted} skipped=${skipped}`, false);
    return c.json({ ok: true, inserted, skipped, suggestions: listActiveAgentSuggestions() });
  });

  app.post('/api/agents/suggestions/:id/dismiss', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const ok = dismissAgentSuggestion(id);
    if (!ok) return c.json({ error: 'not found or already dismissed' }, 404);
    insertAuditLog('main', '', 'agent_suggestion_dismiss', `id=${id}`, false);
    return c.json({ ok: true });
  });

  app.post('/api/agents/suggestions/:id/acted', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const ok = markAgentSuggestionActed(id);
    if (!ok) return c.json({ error: 'not found or already acted' }, 404);
    insertAuditLog('main', '', 'agent_suggestion_acted', `id=${id}`, false);
    return c.json({ ok: true });
  });

  app.get('/api/dashboard/settings', (c) => {
    return c.json(getAllDashboardSettings());
  });

  app.patch('/api/dashboard/settings', async (c) => {
    const body = await c.req.json().catch(() => null) as { key?: string; value?: string } | null;
    if (!body || typeof body.key !== 'string' || typeof body.value !== 'string') {
      return c.json({ error: 'expected { key: string, value: string }' }, 400);
    }
    if (!ALLOWED_SETTING_KEYS.has(body.key)) {
      return c.json({ error: `unknown setting key: ${body.key}` }, 400);
    }
    if (Buffer.byteLength(body.value, 'utf8') > SETTING_VALUE_MAX_BYTES) {
      return c.json({ error: `value exceeds ${SETTING_VALUE_MAX_BYTES} bytes` }, 400);
    }
    if (body.key === 'standup_config') {
      const err = validateStandupConfigJson(body.value);
      if (err) return c.json({ error: err }, 400);
    }
    // Workspace name has its own length cap so the sidebar layout stays
    // sane. Strip control chars + zero-width joiners; trim whitespace.
    let value = body.value;
    if (body.key === 'workspace_name') {
      value = value.replace(/[\u0000-\u001f\u200b-\u200d\ufeff]/g, '').trim();
      if (value.length > 32) value = value.slice(0, 32);
    }
    setDashboardSetting(body.key, value);
    insertAuditLog('main', '', 'dashboard_setting_change', `${body.key}=${value.slice(0, 80)}`, false);
    return c.json({ ok: true, key: body.key, value });
  });

  app.post('/api/security/kill-switch', async (c) => {
    const body = await c.req.json<{ key?: string; enabled?: boolean }>();
    const key = body?.key;
    const enabled = body?.enabled;
    if (!key || typeof enabled !== 'boolean') {
      return c.json({ error: 'key (string) and enabled (boolean) required' }, 400);
    }
    if (!ALLOWED_KILL_SWITCHES.has(key)) {
      return c.json({ error: 'unknown kill switch: ' + key }, 400);
    }
    try {
      const envPath = path.join(PROJECT_ROOT, '.env');
      const { setEnvKey } = await import('./env-write.js');
      setEnvKey(envPath, key, enabled ? 'true' : 'false');
      logger.info({ key, enabled }, 'Kill switch toggled via dashboard');
      return c.json({ ok: true, key, enabled });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'Failed to write .env: ' + msg }, 500);
    }
  });

  // ── Google Drive ingest webhook ──────────────────────────────────────────
  // Called by Make.com when a new or modified file appears in Google Drive.
  // Body: { fileId, fileName, mimeType, modifiedTime, secret }
  // The secret is checked against GDRIVE_WEBHOOK_SECRET env var.
  app.post('/api/gdrive-ingest', async (c) => {
    const secret = process.env.GDRIVE_WEBHOOK_SECRET;
    const body = await c.req.json<{
      fileId?: string;
      fileName?: string;
      mimeType?: string;
      modifiedTime?: string;
      secret?: string;
    }>();

    // Simple shared-secret auth
    if (secret && body.secret !== secret) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { fileId, fileName, mimeType, modifiedTime } = body;
    if (!fileId || !mimeType) {
      return c.json({ error: 'fileId and mimeType are required' }, 400);
    }

    // Only process readable types (no PDFs)
    const READABLE = new Set([
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.presentation',
      'text/plain',
      'text/markdown',
    ]);
    if (!READABLE.has(mimeType)) {
      return c.json({ ok: true, skipped: true, reason: 'unsupported mimeType' });
    }

    logger.info({ fileId, fileName, mimeType }, 'Drive webhook: queuing file for ingest');

    // Run ingest in background — don't block the response
    (async () => {
      try {
        const { runDriveIngest } = await import('./gdrive-ingest.js');
        // Pass a single file via a custom one-shot run
        // We abuse the existing ingest by setting limit=1 and pre-seeding
        // the index to skip everything except this file.
        // Simpler: just call the ingest with typeFilter matching this mimeType,
        // it'll pick up new/modified files not yet in the index.
        await runDriveIngest({ limit: 5, delayMs: 1000 });
      } catch (err) {
        logger.error({ err, fileId }, 'Drive webhook ingest failed');
      }
    })();

    return c.json({ ok: true, queued: true, fileId });
  });

  // Bulk backfill — runs inside the persistent server process so it survives
  // SSH teardown. Hit once to drain the index at limit=500 per call.
  // POST /api/gdrive-backfill  { "secret": "..." }  OR  X-Backfill-Secret header
  app.post('/api/gdrive-backfill', async (c) => {
    const secret = process.env.GDRIVE_WEBHOOK_SECRET;
    const headerSecret = c.req.header('x-backfill-secret');
    const body: { secret?: string; limit?: number } = await c.req.json<{ secret?: string; limit?: number }>().catch(() => ({}));
    const providedSecret = headerSecret ?? body.secret;
    if (secret && providedSecret !== secret) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const limit = typeof body.limit === 'number' ? Math.min(body.limit, 1000) : 500;
    logger.info({ limit }, 'Drive backfill: starting background run');
    (async () => {
      try {
        const { runDriveIngest } = await import('./gdrive-ingest.js');
        const result = await runDriveIngest({ limit, delayMs: 1500 });
        logger.info(result, 'Drive backfill: run complete');
      } catch (err) {
        logger.error({ err }, 'Drive backfill: run failed');
      }
    })();
    return c.json({ ok: true, started: true, limit });
  });

  startChannelSweeper();

  let server: ReturnType<typeof serve>;
  try {
    server = serve({ fetch: app.fetch, port: DASHBOARD_PORT }, () => {
      logger.info({ port: DASHBOARD_PORT }, 'Dashboard server running');
    });
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE') {
      logger.error({ port: DASHBOARD_PORT }, 'Dashboard port already in use. Change DASHBOARD_PORT in .env or kill the process using port %d.', DASHBOARD_PORT);
    } else {
      logger.error({ err }, 'Dashboard server failed to start');
    }
    return;
  }

  // ── Startup Drive backfill ────────────────────────────────────────────────
  // Runs automatically on every server start. Skips already-indexed files so
  // it's safe to run repeatedly. Uses a 10s delay to let the server settle.
  setTimeout(async () => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const storePath = process.env.STORE_DIR ?? '/app/store';
      const indexPath = path.join(storePath, 'gdrive-index.json');
      let indexSize = 0;
      try {
        const raw = fs.readFileSync(indexPath, 'utf8');
        indexSize = Object.keys(JSON.parse(raw)).length;
      } catch { /* index missing or empty */ }
      logger.info({ indexSize }, 'Startup Drive backfill: checking index');

      // Pre-flight: verify Drive auth works before spending 2.5min timing out
      const { execFile: _execFile } = await import('child_process');
      const { promisify: _promisify } = await import('util');
      const _execFileAsync = _promisify(_execFile);
      const cliPath = path.join(process.env.PROJECT_ROOT ?? '/app', 'dist', 'gdrive-cli.js');
      try {
        await _execFileAsync(process.execPath, [cliPath, 'status'], {
          encoding: 'utf8', timeout: 8_000,
        });
      } catch {
        logger.warn('Startup Drive backfill: auth pre-flight failed — skipping ingest this boot');
        return;
      }

      const { runDriveIngest } = await import('./gdrive-ingest.js');
      const result = await runDriveIngest({ limit: 500, delayMs: 1500 });
      logger.info(result, 'Startup Drive backfill: run complete');
      // If there were more files to process, keep going in batches
      if (result.processed >= 490) {
        logger.info('Startup Drive backfill: more files likely remain, scheduling next batch');
        const runBatch = async (): Promise<void> => {
          const r = await runDriveIngest({ limit: 500, delayMs: 1500 });
          logger.info(r, 'Drive backfill batch complete');
          if (r.processed >= 490) {
            await new Promise(res => setTimeout(res, 5000));
            return runBatch();
          }
        };
        await runBatch();
        logger.info('Drive backfill: all batches complete');
      }
    } catch (err) {
      logger.warn({ err }, 'Startup Drive backfill failed');
    }
  }, 10_000);

  // ── Startup Obsidian vault ingest ─────────────────────────────────────────
  // Runs on Fly when /app/store/obsidian-brain exists (synced via Syncthing).
  // Locally, resolveVaultPath() finds the Mac vault path automatically.
  // Safe to run repeatedly -- index skips unchanged files. 15s delay so the
  // Drive backfill gets a head start and the server is fully settled.
  setTimeout(async () => {
    try {
      const { runObsidianIngest } = await import('./obsidian-ingest.js');
      const result = await runObsidianIngest({ limit: 200, delayMs: 1500 });
      logger.info(result, 'Startup Obsidian ingest: run complete');
    } catch (err) {
      logger.warn({ err }, 'Startup Obsidian ingest failed');
    }
  }, 15_000);

  // ── Startup Gmail ingest ──────────────────────────────────────────────────
  // Pulls recent important emails (last 60 days), extracts key facts via
  // Gemini, saves as memories with source='gmail'. Skips newsletters and
  // auto-sends. 20s delay gives Drive + Obsidian a head start.
  setTimeout(async () => {
    try {
      const { runGmailIngest } = await import('./gmail-ingest.js');
      const result = await runGmailIngest({ limit: 50, days: 60, delayMs: 1500 });
      logger.info(result, 'Startup Gmail ingest: run complete');
    } catch (err) {
      logger.warn({ err }, 'Startup Gmail ingest failed');
    }
  }, 20_000);

  // ── Startup ClickUp ingest ────────────────────────────────────────────────
  // Fetches active tasks from all ClickUp spaces, extracts via Gemini,
  // saves as memories with source='clickup'. 25s delay staggers Gemini load.
  setTimeout(async () => {
    try {
      const { runClickUpIngest } = await import('./clickup-ingest.js');
      const result = await runClickUpIngest({ limit: 100, delayMs: 1500 });
      logger.info(result, 'Startup ClickUp ingest: run complete');
    } catch (err) {
      logger.warn({ err }, 'Startup ClickUp ingest failed');
    }
  }, 25_000);

  // DEBUG: catch-all upgrade listener to confirm Node.js receives WS upgrades
  (server as unknown as import('http').Server).on('upgrade', (req: import('http').IncomingMessage) => {
    logger.info({ url: req.url, host: req.headers.host, upgrade: req.headers.upgrade }, 'DEBUG: raw HTTP upgrade event received');
  });

  // ── WebSocket proxy: /ws/warroom → localhost:WARROOM_PORT ──────────
  // Allows the War Room to work through a single Cloudflare tunnel on
  // the dashboard port. Without this, remote/mobile users can't reach
  // the Python WebSocket server on port 7860.
  if (WARROOM_ENABLED) {
    void import('ws').then((wsModule: any) => {
    const WS = wsModule.default?.WebSocket ?? wsModule.WebSocket;
    const WSServer = wsModule.default?.WebSocketServer ?? wsModule.WebSocketServer;

    if (WSServer) {
      const wss = new WSServer({ noServer: true });

      (server as unknown as import('http').Server).on('upgrade', (
        req: import('http').IncomingMessage,
        socket: import('stream').Duplex,
        head: Buffer,
      ) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        if (url.pathname !== '/ws/warroom') return;

        // Token-gate the War Room WebSocket upgrade (audit fix, ported from
        // osrepo PR #51). Without this, anyone who can reach the dashboard
        // port could proxy into the local Pipecat War Room socket with no
        // auth and burn Gemini Live credits or eavesdrop on transcripts.
        const token = url.searchParams.get('token');
        if (!safeTokenEqual(token, DASHBOARD_TOKEN)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (clientWs: any) => {
          const remote = new WS(`ws://127.0.0.1:${WARROOM_PORT}`);
          let remoteReady = false;
          const buffered: (Buffer | ArrayBuffer | string)[] = [];

          remote.on('open', () => {
            remoteReady = true;
            for (const msg of buffered) remote.send(msg);
            buffered.length = 0;
          });
          remote.on('message', (data: Buffer | ArrayBuffer | string) => {
            if (clientWs.readyState === 1) clientWs.send(data);
          });
          remote.on('close', () => clientWs.close());
          remote.on('error', (err: Error) => {
            logger.warn({ err }, 'War Room WS proxy: remote error');
            try { clientWs.close(1011, 'War Room server error'); } catch { /* ok */ }
          });

          clientWs.on('message', (data: Buffer | ArrayBuffer | string) => {
            if (remoteReady) remote.send(data);
            else buffered.push(data);
          });
          clientWs.on('close', () => {
            if (remote.readyState <= 1) remote.close();
          });
        });
      });

      logger.info('War Room WebSocket proxy active at /ws/warroom');
    }
    }).catch((err: unknown) => {
      logger.warn({ err }, 'Could not set up War Room WS proxy');
    });
  }

  // ── Nikki Live: personal context from Obsidian vault ─────────────────────
  // Reads Dante's identity, principles, and preferences from the Obsidian wiki
  // (synced to /app/store/obsidian-brain on Fly). Returns a compact string
  // for injection into the Gemini system prompt at call start.
  function getPersonalContext(): string {
    const parts: string[] = [];

    // 1. Obsidian wiki pages — identity and principles
    const noteKeys = [
      'People/Dante.md',
      'Principles/Democratize technology.md',
      'Principles/Practical over hype.md',
      'Principles/Speed and clarity.md',
    ];
    const wikiSections: string[] = [];
    for (const key of noteKeys) {
      try {
        const note = getNote(key);
        if (note?.content) {
          wikiSections.push(`### ${note.title}\n${note.content.trim()}`);
        }
      } catch {
        // vault not synced or file missing — skip
      }
    }
    if (wikiSections.length > 0) {
      parts.push(`FROM OBSIDIAN WIKI:\n\n${wikiSections.join('\n\n')}`);
    }

    // 2. Interview memories from SQLite — personal identity, family, lifestyle,
    //    health, goals, communication prefs captured during the onboarding session
    try {
      const memories = getPersonalMemories(60);
      if (memories.length > 0) {
        const lines = memories.map(m => `- ${m.summary.trim()}`);
        parts.push(`FROM MEMORY DATABASE (interview + ongoing):\n${lines.join('\n')}`);
      }
    } catch {
      // DB unavailable — skip
    }

    if (parts.length === 0) return '';
    return `DANTE PERSONAL CONTEXT:\n\n${parts.join('\n\n')}`;
  }

  // ── Nikki Live: context snapshot + tool execution ─────────────────────────
  // Fetches a compact snapshot of Dante's current business state.
  // Called immediately when a browser connects — in parallel with the Gemini
  // WS handshake — so context is ready by the time setup needs to be sent.
  async function buildLiveContext(): Promise<string> {
    const now = new Date();
    const timestamp = now.toLocaleString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
    const parts: string[] = [`Context snapshot at ${timestamp}`];

    // Personal context (sync — reads local vault, no network needed)
    const personalCtx = getPersonalContext();
    if (personalCtx) parts.push(personalCtx);

    const [calResult, qbResult, pipelineResult, cashResult, vendastaRevenueResult, inboxResult] = await Promise.allSettled([
      getCalendarData({ range: 'week', force: false }),
      getQbData({ force: false }),
      getPipelineData(false),
      getCashData(false),
      getCleanedRevenue({ force: false }),
      getInbox({ limit: 10, force: false }),
    ]);

    // Calendar
    if (calResult.status === 'fulfilled' && calResult.value.connectionStatus === 'ok') {
      const events = calResult.value.events;
      if (events.length === 0) {
        parts.push('CALENDAR (next 7 days): No events scheduled');
      } else {
        const lines = events.slice(0, 12).map(e => {
          const time = e.allDay
            ? 'all day'
            : e.start
              ? new Date(e.start).toLocaleString('en-GB', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '';
          return `  - ${e.title}${time ? ' (' + time + ')' : ''}${e.location ? ' @ ' + e.location : ''}`;
        });
        parts.push(`CALENDAR (next 7 days — ${events.length} event${events.length !== 1 ? 's' : ''}):\n${lines.join('\n')}`);
      }
    } else {
      parts.push('CALENDAR: unavailable right now');
    }

    // Financials (QuickBooks)
    if (qbResult.status === 'fulfilled' && qbResult.value.connectionStatus === 'ok') {
      const qb = qbResult.value;
      const fmt = (cents: number) =>
        `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}${cents < 0 ? ' (loss)' : ''}`;
      parts.push([
        `FINANCIALS (QuickBooks — ${qb.company.name || 'ImpactWorks'}):`,
        `  - MTD revenue: ${fmt(qb.mtd.revenueCents)}`,
        `  - MTD net: ${fmt(qb.mtd.netCents)}`,
        `  - Last 30 days revenue: ${fmt(qb.last30.revenueCents)}`,
        `  - Last 30 days net: ${fmt(qb.last30.netCents)}`,
        `  - Cash runway: ${qb.runwayDays !== null ? qb.runwayDays + ' days' : 'unknown'}`,
      ].join('\n'));
    } else {
      parts.push('FINANCIALS: unavailable right now');
    }

    // Sales pipeline (CRM)
    if (pipelineResult.status === 'fulfilled') {
      const pipeline = pipelineResult.value as any;
      const cards = Array.isArray(pipeline.cards) ? pipeline.cards : [];
      const active = cards.filter((c: any) => c.stage !== 'closed-won' && c.stage !== 'closed-lost');
      if (active.length === 0) {
        parts.push('SALES PIPELINE: No active deals');
      } else {
        const lines = active.slice(0, 10).map((c: any) =>
          `  - ${c.company || c.name || 'Unknown'}: ${c.stage || 'unknown stage'}${c.mrr ? ` ($${c.mrr}/mo MRR)` : ''}${c.contactName ? ' — ' + c.contactName : ''}`
        );
        parts.push(`SALES PIPELINE (${active.length} active deal${active.length !== 1 ? 's' : ''}):\n${lines.join('\n')}`);
      }
    } else {
      parts.push('SALES PIPELINE: unavailable right now');
    }

    // Cash / Plaid accounts
    if (cashResult.status === 'fulfilled' && cashResult.value.connectionStatus === 'ok') {
      const cash = cashResult.value;
      const fmtD = (cents: number) =>
        `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      const totalLiquid = cash.accounts
        .filter(a => a.type === 'depository')
        .reduce((sum, a) => sum + (a.balanceAvailable ?? a.balanceCurrent ?? 0), 0);
      const acctLines = cash.accounts.slice(0, 8).map(a => {
        const bal = a.balanceAvailable ?? a.balanceCurrent ?? 0;
        return `  - ${a.displayName || a.name}${a.mask ? ' ···' + a.mask : ''}: ${fmtD(bal * 100)} (${a.type}/${a.subtype})`;
      });
      parts.push([
        `BANK ACCOUNTS (Plaid — ${cash.accounts.length} linked):`,
        `  - Total liquid cash: ${fmtD(cash.totalCashCents)}`,
        `  - Cash runway: ${cash.runwayDays !== null ? cash.runwayDays + ' days' : 'unknown'}`,
        ...acctLines,
      ].join('\n'));
    } else {
      parts.push('BANK ACCOUNTS: unavailable right now');
    }

    // Vendasta MRR breakdown
    if (vendastaRevenueResult.status === 'fulfilled') {
      const rev = vendastaRevenueResult.value;
      const fmtD = (cents: number) =>
        `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      const brandLines = (rev.brands || []).slice(0, 5).map((b: any) =>
        `  - ${b.label}: ${fmtD(b.customerRetailMRR)}/mo retail MRR, ${b.customerCount} paying customers, ${Math.round(b.marginPct)}% margin`
      );
      parts.push([
        `VENDASTA MRR (customer revenue, internal accounts excluded):`,
        `  - Total customer retail MRR: ${fmtD(rev.customerRetailMRR)}/mo`,
        `  - Wholesale cost: ${fmtD(rev.wholesaleMonthly)}/mo`,
        `  - Gross margin: ${fmtD(rev.grossMargin)}/mo (${Math.round(rev.marginPct)}%)`,
        `  - Paying customers: ${rev.customerCount}`,
        ...brandLines,
      ].join('\n'));
    } else {
      parts.push('VENDASTA MRR: unavailable right now');
    }

    // Inbox (Gmail)
    if (inboxResult.status === 'fulfilled' && inboxResult.value.configured) {
      const emails = inboxResult.value.emails || [];
      const unread = emails.filter((e: any) => e.unread).length;
      if (emails.length === 0) {
        parts.push('INBOX: No recent emails');
      } else {
        const lines = emails.slice(0, 10).map((e: any) => {
          const from = e.senderPerson?.name || e.fromName || e.fromEmail || 'Unknown';
          const age = e.ageHours > 24 ? `${Math.round(e.ageHours / 24)}d` : `${Math.round(e.ageHours)}h`;
          return `  - ${e.unread ? '[UNREAD] ' : ''}${from} (${age}): ${e.subject || '(no subject)'}`;
        });
        parts.push(`INBOX (${unread} unread of ${emails.length} recent):\n${lines.join('\n')}`);
      }
    } else {
      parts.push('INBOX: unavailable right now');
    }

    return parts.join('\n\n');
  }

  // Execute a tool call issued by Gemini mid-conversation.
  // Returns a plain-text result string (Gemini will speak from this).
  async function executeLiveTool(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      if (name === 'get_calendar') {
        const days = typeof args.days === 'number' ? args.days : 7;
        const range = days <= 2 ? 'today' : 'week';
        const cal = await getCalendarData({ range, force: true });
        if (cal.connectionStatus !== 'ok') return `Calendar unavailable: ${cal.connectionMessage || 'no credentials'}`;
        if (cal.events.length === 0) return 'No events in the requested period.';
        return cal.events.map(e => {
          const time = e.allDay
            ? 'all day'
            : e.start
              ? new Date(e.start).toLocaleString('en-GB', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '';
          return `${e.title}${time ? ' — ' + time : ''}${e.location ? ' @ ' + e.location : ''}`;
        }).join('\n');
      }

      if (name === 'get_financials') {
        const qb = await getQbData({ force: true });
        if (qb.connectionStatus !== 'ok') return `QuickBooks unavailable: ${qb.connectionMessage || 'no credentials'}`;
        const fmt = (cents: number) =>
          `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}${cents < 0 ? ' (loss)' : ''}`;
        return [
          `Company: ${qb.company.name || 'ImpactWorks'}`,
          `MTD revenue: ${fmt(qb.mtd.revenueCents)}`,
          `MTD net: ${fmt(qb.mtd.netCents)}`,
          `Last 30 days revenue: ${fmt(qb.last30.revenueCents)}`,
          `Last 30 days net: ${fmt(qb.last30.netCents)}`,
          `Cash runway: ${qb.runwayDays !== null ? qb.runwayDays + ' days' : 'unknown'}`,
        ].join('\n');
      }

      if (name === 'get_pipeline') {
        const pipeline = await getPipelineData(true) as any;
        const cards = Array.isArray(pipeline.cards) ? pipeline.cards : [];
        if (cards.length === 0) return 'No deals in pipeline.';
        const active = cards.filter((c: any) => c.stage !== 'closed-won' && c.stage !== 'closed-lost');
        const lines = active.slice(0, 15).map((c: any) =>
          `${c.company || c.name || 'Unknown'}: ${c.stage || 'unknown'}${c.mrr ? ` ($${c.mrr}/mo)` : ''}${c.contactName ? ' — contact: ' + c.contactName : ''}`
        );
        return `${active.length} active deal${active.length !== 1 ? 's' : ''}:\n${lines.join('\n')}`;
      }

      if (name === 'get_inbox') {
        try {
          const inbox = await getInbox({ limit: 8, force: true });
          if (!inbox.configured) return `Inbox unavailable: ${inbox.error || 'Gmail not configured'}`;
          const emails = inbox.emails || [];
          const unread = emails.filter((e: any) => e.unread).length;
          if (emails.length === 0) return `Inbox: no recent emails${inbox.error ? ' (error: ' + inbox.error + ')' : ''}.`;
          const lines = emails.slice(0, 8).map((e: any) => {
            const from = e.senderPerson?.name || e.fromName || e.fromEmail || 'Unknown';
            const age = e.ageHours > 24 ? `${Math.round(e.ageHours / 24)}d` : `${Math.round(e.ageHours)}h`;
            return `- ${e.unread ? '[UNREAD] ' : ''}${from} (${age}): ${e.subject || '(no subject)'}`;
          });
          return `Inbox: ${unread} unread\nRecent:\n${lines.join('\n')}`;
        } catch (err) {
          return `Inbox unavailable: ${String((err as Error)?.message || err).slice(0, 100)}`;
        }
      }

      if (name === 'get_cash') {
        const cash = await getCashData(true);
        if (cash.connectionStatus !== 'ok') return `Bank accounts unavailable: ${cash.connectionMessage || 'no credentials'}`;
        const fmtD = (cents: number) =>
          `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        const acctLines = cash.accounts.map(a => {
          const bal = a.balanceAvailable ?? a.balanceCurrent ?? 0;
          return `${a.displayName || a.name}${a.mask ? ' ···' + a.mask : ''}: ${fmtD(bal * 100)} (${a.subtype})`;
        });
        return [
          `Total liquid cash: ${fmtD(cash.totalCashCents)}`,
          `Cash runway: ${cash.runwayDays !== null ? cash.runwayDays + ' days' : 'unknown'}`,
          `Accounts (${cash.accounts.length}):`,
          ...acctLines.map(l => '  ' + l),
        ].join('\n');
      }

      if (name === 'get_vendasta') {
        const [vData, vRev] = await Promise.allSettled([
          getVendastaData({ force: true }),
          getCleanedRevenue({ force: true }),
        ]);
        const lines: string[] = [];
        if (vRev.status === 'fulfilled') {
          const rev = vRev.value;
          const fmtD = (cents: number) =>
            `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
          lines.push(`Customer retail MRR: ${fmtD(rev.customerRetailMRR)}/mo`);
          lines.push(`Wholesale cost: ${fmtD(rev.wholesaleMonthly)}/mo`);
          lines.push(`Gross margin: ${fmtD(rev.grossMargin)}/mo (${Math.round(rev.marginPct)}%)`);
          lines.push(`Paying customers: ${rev.customerCount}`);
          const brands: any[] = rev.brands || [];
          for (const b of brands) {
            lines.push(`  ${b.label}: ${fmtD(b.customerRetailMRR)}/mo, ${b.customerCount} customers, ${Math.round(b.marginPct)}% margin`);
          }
        } else {
          lines.push('Vendasta revenue data unavailable');
        }
        if (vData.status === 'fulfilled' && vData.value.connectionStatus === 'ok') {
          const all = vData.value.all;
          lines.push(`Total companies in CRM: ${all.companies}`);
          lines.push(`Open deals: ${all.openDeals}`);
          const topDeals = all.topOpenDeals.slice(0, 5);
          if (topDeals.length > 0) {
            lines.push('Top open deals:');
            for (const d of topDeals) {
              const val = d.projectedFirstYearValueCents > 0
                ? ` (~$${Math.round(d.projectedFirstYearValueCents / 100).toLocaleString()}/yr projected)`
                : '';
              lines.push(`  - ${d.name}${val} [${d.pipelineStage || 'open'}]`);
            }
          }
        }
        return lines.length > 0 ? lines.join('\n') : 'Vendasta data unavailable right now.';
      }

      if (name === 'get_transactions') {
        const keyword = typeof args.keyword === 'string' ? args.keyword.toLowerCase() : '';
        const limit = typeof args.limit === 'number' ? Math.min(args.limit, 30) : 15;
        const cash = await getCashData(false); // use cache — transactions don't need force refresh
        if (cash.connectionStatus !== 'ok') return `Transactions unavailable: ${cash.connectionMessage || 'no credentials'}`;
        let txns = cash.recent;
        if (keyword) {
          txns = txns.filter(t =>
            t.name.toLowerCase().includes(keyword) ||
            (t.merchant || '').toLowerCase().includes(keyword) ||
            t.bucket.toLowerCase().includes(keyword)
          );
        }
        txns = txns.slice(0, limit);
        if (txns.length === 0) return keyword ? `No transactions matching "${keyword}" found in recent history.` : 'No recent transactions found.';
        const fmtD = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
        const lines = txns.map(t =>
          `${t.date} | ${t.direction === 'in' ? '+' : '-'}${fmtD(Math.abs(t.amount) * 100)} | ${t.merchant || t.name} | ${t.bucket}`
        );
        return `${txns.length} transaction${txns.length !== 1 ? 's' : ''}${keyword ? ` matching "${keyword}"` : ''}:\n${lines.join('\n')}`;
      }

      return `Unknown tool: ${name}`;
    } catch (e) {
      return `Error fetching ${name}: ${(e as Error).message}`;
    }
  }

  // Gemini Live function declarations — what Nikki can look up mid-call.
  const NIKKI_LIVE_TOOLS = [{
    functionDeclarations: [
      {
        name: 'get_calendar',
        description: "Get Dante's upcoming calendar events. Use when asked about schedule, meetings, what's on today, availability, or upcoming appointments.",
        parameters: {
          type: 'OBJECT',
          properties: {
            days: {
              type: 'INTEGER',
              description: 'Number of days to look ahead. 1 = today only, 7 = full week (default).',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_financials',
        description: "Get Dante's current financial data: revenue, profit/loss, cash runway from QuickBooks. Use when asked about money, revenue, profit, how the business is doing financially, or cash runway.",
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'get_pipeline',
        description: "Get Dante's active sales pipeline and CRM deals. Use when asked about prospects, clients, deals, pipeline, who's in the funnel, or sales status.",
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'get_inbox',
        description: "Get a summary of Dante's recent emails and unread count. Use when asked about email, inbox, messages, or what came in.",
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'get_cash',
        description: "Get Dante's bank account balances from Plaid — checking, savings, credit cards, total liquid cash, and cash runway. Use when asked about bank balance, how much cash is in the bank, account balances, or money in checking/savings.",
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'get_vendasta',
        description: "Get Dante's Vendasta platform data: customer MRR by brand (ImpactWorks vs Rocket Local), wholesale costs, gross margin, paying customer count, and top open deals in the CRM. Use when asked about Vendasta revenue, customer MRR, how many clients, or managed services margins.",
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'get_transactions',
        description: "Search Dante's recent bank transactions from Plaid. Use when asked about specific spending, charges, payments, or 'what did I spend on X'. Optionally filter by keyword.",
        parameters: {
          type: 'OBJECT',
          properties: {
            keyword: {
              type: 'STRING',
              description: 'Optional keyword to filter transactions by merchant name, description, or category (e.g. "OpenAI", "Vendasta", "SaaS", "dining").',
            },
            limit: {
              type: 'INTEGER',
              description: 'Max number of transactions to return (default 15, max 30).',
            },
          },
          required: [],
        },
      },
    ],
  }];

  // ── WebSocket: /ws/nikki-live → Gemini Live API ───────────────────────────
  // Real-time duplex voice for the Nikki card on the Founder Dashboard.
  // Browser sends 16kHz raw PCM chunks (base64 JSON), receives 24kHz PCM back.
  // Token-gated exactly like the War Room proxy.
  // Uses raw WebSocket to Gemini (not SDK) for full session lifecycle control.
  void import('ws').then(async (wsModule: any) => {
    const WSServer = wsModule.default?.WebSocketServer ?? wsModule.WebSocketServer;
    const WSClient = wsModule.WebSocket ?? wsModule.default;
    if (!WSServer || !WSClient) return;

    if (!GOOGLE_API_KEY) {
      logger.warn('GOOGLE_API_KEY not set — Nikki Live voice disabled');
      return;
    }

    const nikkiLiveWss = new WSServer({ noServer: true });

    const NIKKI_LIVE_SYSTEM = `You are Nikki — Dante's personal AI assistant and the voice of ClaudeClaw.
You are direct, grounded, and real. You talk like a person, not a language model.
Speak with a warm, British English accent.
Keep responses SHORT — this is voice. 1-3 sentences max unless detail is specifically asked for.
Never say "Certainly!", "Great question!", "I'd be happy to", or similar filler.
Never apologize excessively. If you got something wrong, fix it and move on.
Dante is a serial entrepreneur building AI-powered business automation tools.
He runs ImpactWorks (AI consulting) and Rocket Local AI (local marketing automation).
When you don't know something specific, say so plainly.`;

    (server as unknown as import('http').Server).on('upgrade', (
      req: import('http').IncomingMessage,
      socket: import('stream').Duplex,
      head: Buffer,
    ) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      logger.info({ url: req.url, pathname: url.pathname }, 'Nikki Live: upgrade handler path check');
      if (url.pathname !== '/ws/nikki-live') return;

      const token = url.searchParams.get('token');
      if (!safeTokenEqual(token, DASHBOARD_TOKEN)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      nikkiLiveWss.handleUpgrade(req, socket, head, (clientWs: any) => {
        // Start fetching context immediately — in parallel with the Gemini WS
        // handshake so the snapshot is usually ready before setup needs to send.
        const contextPromise = buildLiveContext().catch(err => {
          logger.warn({ err }, 'Nikki Live: context fetch failed, using base system prompt');
          return '';
        });

        // Raw WebSocket connection directly to Gemini Live API.
        // The @google/genai SDK treats each connection as a single turn and
        // fires onclose after Gemini's first response — raw WS avoids that.
        const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_API_KEY}`;
        const geminiWs = new WSClient(geminiUrl);
        let setupComplete = false;

        geminiWs.on('open', () => {
          // Await the context snapshot (usually already resolved), then send setup.
          (async () => {
            let contextBlock = '';
            try { contextBlock = await contextPromise; } catch { /* already handled */ }

            const systemText = contextBlock
              ? `${NIKKI_LIVE_SYSTEM}\n\n---\nLIVE BUSINESS CONTEXT (use this to answer questions without needing to call tools for common facts):\n${contextBlock}`
              : NIKKI_LIVE_SYSTEM;

            geminiWs.send(JSON.stringify({
              setup: {
                model: 'models/gemini-3.1-flash-live-preview',
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    languageCode: 'en-GB',
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: 'Aoede' },
                    },
                  },
                },
                systemInstruction: {
                  parts: [{ text: systemText }],
                },
                tools: NIKKI_LIVE_TOOLS,
              },
            }));
          })().catch(err => logger.warn({ err }, 'Nikki Live: open handler error'));
        });

        geminiWs.on('message', (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());

            // Setup acknowledgement — session is now live
            if (msg.setupComplete !== undefined || msg.setup_complete !== undefined) {
              setupComplete = true;
              logger.info('Nikki Live: Gemini setup complete, session live');
              // Trigger a proactive greeting from Nikki
              const hour = new Date().getHours();
              const timeCtx = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
              geminiWs.send(JSON.stringify({
                clientContent: {
                  turns: [{
                    role: 'user',
                    parts: [{ text: `[Session connected — ${timeCtx}. Give Dante a short, clever, varied opening greeting. Under 10 words. Feel free to riff on the time of day, what he might be up to, or just sound like yourself. Don't repeat the same greeting each time.]` }],
                  }],
                  turnComplete: true,
                },
              }));
              return;
            }

            if (clientWs.readyState !== 1) return;

            // ── Tool calls from Gemini (mid-conversation data lookups) ──────
            const toolCall = msg?.toolCall ?? msg?.tool_call;
            if (toolCall) {
              const funcCalls: Array<{ id: string; name: string; args?: Record<string, unknown> }> =
                toolCall.functionCalls ?? toolCall.function_calls ?? [];
              logger.info({ tools: funcCalls.map(f => f.name) }, 'Nikki Live: tool call received');

              (async () => {
                const responses = await Promise.all(funcCalls.map(async (fc) => {
                  const result = await executeLiveTool(fc.name, fc.args || {});
                  return { id: fc.id, name: fc.name, response: { result } };
                }));

                if (geminiWs.readyState === 1) {
                  geminiWs.send(JSON.stringify({
                    toolResponse: {
                      functionResponses: responses.map(r => ({
                        id: r.id,
                        name: r.name,
                        response: r.response,
                      })),
                    },
                  }));
                }
              })().catch(err => logger.warn({ err }, 'Nikki Live: tool execution error'));
              return;
            }

            // Audio from Gemini → browser
            const parts = msg?.serverContent?.modelTurn?.parts
              ?? msg?.server_content?.model_turn?.parts;
            const audio = parts?.[0]?.inlineData?.data ?? parts?.[0]?.inline_data?.data;
            if (audio) clientWs.send(JSON.stringify({ audio }));

            // Barge-in / interruption signal
            const interrupted = msg?.serverContent?.interrupted
              ?? msg?.server_content?.interrupted;
            if (interrupted) clientWs.send(JSON.stringify({ interrupted: true }));
          } catch { /* ignore malformed frames */ }
        });

        geminiWs.on('close', (code: number, reason: Buffer) => {
          logger.info({ code, reason: reason?.toString() }, 'Nikki Live: Gemini WS closed');
          try { if (clientWs.readyState <= 1) clientWs.close(); } catch {}
        });

        geminiWs.on('error', (err: unknown) => {
          logger.warn({ err }, 'Nikki Live: Gemini WS error');
          try { if (clientWs.readyState <= 1) clientWs.close(1011, 'Gemini error'); } catch {}
        });

        // Mic audio from browser → Gemini
        clientWs.on('message', (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.audio && geminiWs.readyState === 1 && setupComplete) {
              geminiWs.send(JSON.stringify({
                realtimeInput: {
                  audio: {
                    data: msg.audio,
                    mimeType: 'audio/pcm;rate=16000',
                  },
                },
              }));
            }
          } catch { /* ignore malformed frames */ }
        });

        clientWs.on('close', () => {
          try { geminiWs.close(); } catch {}
        });

        logger.info('Nikki Live: voice session started');
      });
    });

    logger.info('Nikki Live WebSocket active at /ws/nikki-live');
  }).catch((err: unknown) => {
    logger.warn({ err }, 'Could not set up Nikki Live WS');
  });
}
