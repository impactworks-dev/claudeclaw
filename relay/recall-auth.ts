#!/usr/bin/env tsx
// Interactive OAuth bootstrap for Recall.
//
// Run this on the Mac with `npm run auth`. It:
//   1. Loads the MCP server's OAuth discovery doc to learn endpoints + scopes
//      (or falls back to RECALL_TOKEN_URL + RECALL_AUTH_URL env vars)
//   2. Performs MCP Dynamic Client Registration if the server supports it
//      (RFC 7591), otherwise uses RECALL_CLIENT_ID / RECALL_CLIENT_SECRET
//   3. Opens the browser to the Recall consent page (PKCE flow)
//   4. Captures the authorization code at http://localhost:7457/callback
//   5. Exchanges the code for a refresh token
//   6. Writes the refresh token to ~/Library/Application Support/claudeclaw-relay/recall-token.json
//
// You should only need to run this once per machine.

import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import open from 'open';
import { TokenStore } from './recall-token-store.js';

const MCP_BASE = process.env.RECALL_MCP_BASE || 'https://backend.getrecall.ai/mcp';
const DEFAULT_REDIRECT = 'http://localhost:7457/callback';
const CALLBACK_PORT = 7457;

function b64urlencode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function genPkce(): { verifier: string; challenge: string } {
  const verifier = b64urlencode(crypto.randomBytes(48));
  const challenge = b64urlencode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

interface OAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

// Discover OAuth endpoints via the MCP `.well-known/oauth-authorization-server`
// metadata document. Falls back to environment-variable overrides if discovery
// fails.
async function discoverOAuth(): Promise<OAuthMetadata> {
  // RFC 8414 puts metadata at the issuer's well-known URL. MCP servers expose
  // it relative to the MCP base.
  const candidates = [
    `${MCP_BASE.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
    `${new URL(MCP_BASE).origin}/.well-known/oauth-authorization-server`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const meta = await res.json() as OAuthMetadata;
        console.error(`[auth] Discovered OAuth metadata at ${url}`);
        return meta;
      }
    } catch { /* try next */ }
  }
  console.error('[auth] Discovery failed, using env-var fallbacks.');
  return {
    authorization_endpoint: process.env.RECALL_AUTH_URL || '',
    token_endpoint: process.env.RECALL_TOKEN_URL || '',
    registration_endpoint: process.env.RECALL_REGISTRATION_URL,
  };
}

// MCP Dynamic Client Registration (RFC 7591). Returns the assigned
// client_id/secret. If the server doesn't support DCR or the call fails,
// the caller must provide RECALL_CLIENT_ID via env.
async function registerClient(registrationEndpoint: string): Promise<{ client_id: string; client_secret?: string }> {
  const body = {
    client_name: 'ClaudeClaw Relay (Nikki)',
    redirect_uris: [DEFAULT_REDIRECT],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
    application_type: 'native',
  };
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dynamic Client Registration failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const j = await res.json() as { client_id: string; client_secret?: string };
  console.error(`[auth] Registered new OAuth client: ${j.client_id}`);
  return { client_id: j.client_id, client_secret: j.client_secret };
}

interface CallbackResult { code: string; state: string; }

function awaitCallback(expectedState: string): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith('/callback')) {
        res.writeHead(404).end('Not the callback path.');
        return;
      }
      const u = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      const err = u.searchParams.get('error');
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end(`OAuth error: ${err}`);
        server.close();
        reject(new Error(`Recall returned error: ${err}`));
        return;
      }
      if (!code || !state) {
        res.writeHead(400).end('Missing code/state.');
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400).end('State mismatch — possible CSRF.');
        server.close();
        reject(new Error('OAuth state mismatch'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        '<h1>Recall connected to ClaudeClaw.</h1><p>You can close this tab.</p>',
      );
      server.close();
      resolve({ code, state });
    });
    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      console.error(`[auth] Listening on http://localhost:${CALLBACK_PORT}/callback`);
    });
  });
}

async function main(): Promise<void> {
  const meta = await discoverOAuth();
  if (!meta.authorization_endpoint || !meta.token_endpoint) {
    throw new Error('Could not discover OAuth endpoints. Set RECALL_AUTH_URL + RECALL_TOKEN_URL.');
  }

  // Determine client_id/secret. Order of preference:
  //   1. RECALL_CLIENT_ID env var (manually pre-registered app)
  //   2. Dynamic Client Registration if supported
  let clientId = process.env.RECALL_CLIENT_ID || '';
  let clientSecret = process.env.RECALL_CLIENT_SECRET;
  if (!clientId && meta.registration_endpoint) {
    const r = await registerClient(meta.registration_endpoint);
    clientId = r.client_id;
    clientSecret = r.client_secret;
  }
  if (!clientId) {
    throw new Error('No OAuth client. Set RECALL_CLIENT_ID or enable Dynamic Client Registration.');
  }

  const state = b64urlencode(crypto.randomBytes(24));
  const { verifier, challenge } = genPkce();
  const scopes = process.env.RECALL_SCOPES || (meta.scopes_supported || []).join(' ') || 'mcp:read';

  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', DEFAULT_REDIRECT);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.error('\nOpening browser to:\n  ' + authUrl.toString() + '\n');
  const callbackPromise = awaitCallback(state);
  try { await open(authUrl.toString()); } catch { /* user can paste manually */ }

  const { code } = await callbackPromise;

  // Exchange code for tokens
  const tokenRes = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: DEFAULT_REDIRECT,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 400)}`);
  }
  const tok = await tokenRes.json() as {
    access_token: string; refresh_token: string; expires_in?: number; scope?: string;
  };
  if (!tok.refresh_token) {
    console.error('\nWARNING: Recall did not return a refresh_token. The access token will expire and need re-auth.');
  }

  const store = new TokenStore();
  store.save({
    refresh_token: tok.refresh_token || tok.access_token,  // fallback for non-refresh flows
    client_id: clientId,
    client_secret: clientSecret,
    token_endpoint: meta.token_endpoint,
    scope: tok.scope || scopes,
    obtained_at: Date.now(),
  });

  console.error('\n✓ Recall token persisted.');
  console.error('  Refresh token (first 12 chars): ' + (tok.refresh_token || '').slice(0, 12) + '...');
  console.error('  Stored at: ~/Library/Application Support/claudeclaw-relay/recall-token.json');
  console.error('\nNext: start the relay daemon with `npm start` (or install the LaunchAgent).');
}

main().catch(err => {
  console.error('\n✗ Auth failed:', err.message);
  process.exit(1);
});
