#!/usr/bin/env node
// Marks every unread inbox message as read via Gmail batchModify.
// Uses the same OAuth refresh token as gmail-cli.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf-8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const CLIENT_ID = ENV.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = ENV.GOOGLE_OAUTH_CLIENT_SECRET;
const REFRESH_TOKEN = ENV.GMAIL_REFRESH_TOKEN || ENV.GOOGLE_REFRESH_TOKEN;

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error('Token refresh failed: ' + r.status + ' ' + await r.text());
  return (await r.json()).access_token;
}

async function listUnreadInboxIds(token) {
  const ids = [];
  let pageToken;
  let pages = 0;
  do {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', 'in:inbox is:unread');
    url.searchParams.set('maxResults', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('list failed: ' + r.status + ' ' + await r.text());
    const j = await r.json();
    for (const m of (j.messages || [])) ids.push(m.id);
    pageToken = j.nextPageToken;
    pages++;
  } while (pageToken && pages < 100);
  return ids;
}

async function batchMarkRead(token, ids) {
  // Gmail caps batchModify at 1000 IDs per request.
  let updated = 0;
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: chunk, removeLabelIds: ['UNREAD'] }),
    });
    if (!r.ok) throw new Error('batchModify failed: ' + r.status + ' ' + await r.text());
    updated += chunk.length;
    console.error(`  batch ${i / 1000 + 1}: marked ${chunk.length} as read (running total: ${updated})`);
  }
  return updated;
}

const token = await getAccessToken();
console.error('Fetching unread inbox message IDs...');
const ids = await listUnreadInboxIds(token);
console.error('Found ' + ids.length + ' unread inbox messages');
if (ids.length === 0) {
  console.log(JSON.stringify({ marked: 0, message: 'No unread inbox messages.' }));
  process.exit(0);
}
const updated = await batchMarkRead(token, ids);
console.log(JSON.stringify({ marked: updated }));
