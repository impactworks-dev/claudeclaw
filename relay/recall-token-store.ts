// Token persistence for the Recall relay.
//
// Stores the OAuth refresh token on disk in the user's app-support dir, so
// the relay survives reboots without re-authing. Access tokens are minted
// from the refresh token on demand and cached in-memory.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_STORE_DIR = path.join(
  os.homedir(),
  'Library', 'Application Support', 'claudeclaw-relay',
);

export interface PersistedToken {
  refresh_token: string;
  client_id: string;
  client_secret?: string;
  token_endpoint: string;
  scope?: string;
  obtained_at: number;
}

export interface CachedAccessToken {
  access_token: string;
  expires_at: number;
}

export class TokenStore {
  private storeDir: string;
  private path: string;
  private cachedAccess: CachedAccessToken | null = null;

  constructor(storeDir = DEFAULT_STORE_DIR) {
    this.storeDir = storeDir;
    this.path = path.join(storeDir, 'recall-token.json');
  }

  ensureDir(): void {
    fs.mkdirSync(this.storeDir, { recursive: true });
  }

  save(token: PersistedToken): void {
    this.ensureDir();
    fs.writeFileSync(this.path, JSON.stringify(token, null, 2), { mode: 0o600 });
  }

  load(): PersistedToken | null {
    try {
      const raw = fs.readFileSync(this.path, 'utf-8');
      return JSON.parse(raw) as PersistedToken;
    } catch {
      return null;
    }
  }

  exists(): boolean {
    return fs.existsSync(this.path);
  }

  // Exchange the refresh token for a fresh access token. Cached in-memory.
  async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedAccess && this.cachedAccess.expires_at - 60 > now) {
      return this.cachedAccess.access_token;
    }
    const persisted = this.load();
    if (!persisted) throw new Error('No Recall refresh token on disk. Run `npm run auth` first.');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: persisted.refresh_token,
      client_id: persisted.client_id,
      ...(persisted.client_secret ? { client_secret: persisted.client_secret } : {}),
      ...(persisted.scope ? { scope: persisted.scope } : {}),
    });
    const res = await fetch(persisted.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Refresh failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const j = await res.json() as { access_token: string; expires_in?: number; refresh_token?: string };
    this.cachedAccess = {
      access_token: j.access_token,
      expires_at: now + (j.expires_in || 3600),
    };
    // Some providers rotate refresh tokens; persist the new one if present.
    if (j.refresh_token && j.refresh_token !== persisted.refresh_token) {
      this.save({ ...persisted, refresh_token: j.refresh_token, obtained_at: Date.now() });
    }
    return this.cachedAccess.access_token;
  }

  invalidateAccess(): void { this.cachedAccess = null; }
}
