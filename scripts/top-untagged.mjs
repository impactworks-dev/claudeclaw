#!/usr/bin/env node
// Pull top-N most-texted contacts from the iMessage relay, filter out
// anyone already in people-map.json, print a tagging worksheet.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAY_URL = process.env.MESSAGES_RELAY_URL || 'http://localhost:7457';
const RELAY_SECRET = process.env.MESSAGES_RELAY_SECRET || 'e483c9b5e09998ede89afdd312477c34c151aadeabe54181731bd873d3968676';

const peopleMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'relay', 'people-map.json'), 'utf-8'));
const taggedHandles = new Set(Object.keys(peopleMap));
const contacts = JSON.parse(fs.readFileSync(path.join(ROOT, 'relay', 'contacts.json'), 'utf-8'));

// Build handle → contact-name lookup
function normalizeHandle(h) {
  if (!h) return '';
  const stripped = String(h).replace(/\([^)]*\)$/, '').trim();
  if (stripped.includes('@')) return stripped.toLowerCase();
  const digits = stripped.replace(/[^\d+]/g, '');
  return digits;
}
function last10(h) {
  return String(h).replace(/[^\d]/g, '').slice(-10);
}
const nameByHandle = new Map();
const nameByLast10 = new Map();
for (const c of contacts) {
  for (const p of (c.phones || [])) {
    const n = normalizeHandle(p);
    if (n && !nameByHandle.has(n)) nameByHandle.set(n, c.name);
    const l = last10(p);
    if (l && l.length === 10 && !nameByLast10.has(l)) nameByLast10.set(l, c.name);
  }
  for (const e of (c.emails || [])) {
    const n = normalizeHandle(e);
    if (n && !nameByHandle.has(n)) nameByHandle.set(n, c.name);
  }
}
function resolveName(h) {
  const n = normalizeHandle(h);
  if (nameByHandle.has(n)) return nameByHandle.get(n);
  const l = last10(h);
  if (l.length === 10 && nameByLast10.has(l)) return nameByLast10.get(l);
  return null;
}
function isShortCode(h) {
  // SMS short codes / marketing: 5-6 digits, no plus, no @
  if (!h) return false;
  if (h.includes('@')) return false;
  const digits = String(h).replace(/[^\d]/g, '');
  return digits.length <= 6;
}

const limit = Number(process.argv[2] || 30);

const res = await fetch(`${RELAY_URL}/recent?limit=3000`, {
  headers: { Authorization: `Bearer ${RELAY_SECRET}` },
});
if (!res.ok) {
  console.error(`relay /recent failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const j = await res.json();
const msgs = j.messages || [];

// Aggregate by sender handle
const byHandle = new Map();
for (const m of msgs) {
  if (m.isFromMe) continue;
  const h = m.handle;
  if (!h) continue;
  if (isShortCode(h)) continue;  // skip SMS short codes (marketing / 2FA)
  if (taggedHandles.has(h) || taggedHandles.has(normalizeHandle(h))) continue;
  const resolved = m.contactName || resolveName(h);
  const cur = byHandle.get(h) || { handle: h, name: resolved, count: 0, lastDate: m.dateMs || 0 };
  cur.count += 1;
  if (resolved && !cur.name) cur.name = resolved;
  if (m.dateMs > cur.lastDate) cur.lastDate = m.dateMs;
  byHandle.set(h, cur);
}

const ranked = [...byHandle.values()].sort((a, b) => b.count - a.count).slice(0, limit);

console.log(`Top ${ranked.length} untagged contacts (by message count in recent ${msgs.length} messages):\n`);
ranked.forEach((c, i) => {
  const last = c.lastDate ? new Date(c.lastDate).toISOString().slice(0, 10) : 'n/a';
  const name = (c.name || '(unknown)').slice(0, 40);
  console.log(`${String(i + 1).padStart(2)}. ${name.padEnd(40)}  ${c.handle.padEnd(20)}  ${String(c.count).padStart(3)} msgs   last: ${last}`);
});

console.log(`\nTotal handles seen: ${byHandle.size}`);
console.log(`Already tagged: ${taggedHandles.size}`);
