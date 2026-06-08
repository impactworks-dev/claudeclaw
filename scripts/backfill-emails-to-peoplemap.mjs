#!/usr/bin/env node
// For every entry in people-map.json whose value has a phone-shaped key,
// look up that phone in contacts.json. If the matched contact has email
// addresses, add them as additional people-map handles with the same
// relationship, name, and org.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PEOPLE_MAP = path.join(ROOT, 'relay', 'people-map.json');
const CONTACTS = path.join(ROOT, 'relay', 'contacts.json');

const peopleMap = JSON.parse(fs.readFileSync(PEOPLE_MAP, 'utf-8'));
const contacts = JSON.parse(fs.readFileSync(CONTACTS, 'utf-8'));

// Build last10-digits → contact lookup so we match across format variations
function last10(s) { return String(s || '').replace(/[^\d]/g, '').slice(-10); }

const contactByLast10 = new Map();
for (const c of contacts) {
  for (const p of (c.phones || [])) {
    const l = last10(p);
    if (l && l.length === 10 && !contactByLast10.has(l)) {
      contactByLast10.set(l, c);
    }
  }
}

let added = 0;
const additions = {};
const skipNames = new Set(['Dad', 'Mom', 'ImpactWorks Marketing Line']);

for (const [handle, entry] of Object.entries(peopleMap)) {
  if (handle.startsWith('_')) continue;
  if (typeof entry !== 'object' || !entry?.name) continue;
  // Only process phone handles
  if (handle.includes('@')) continue;
  const l = last10(handle);
  if (l.length !== 10) continue;

  const contact = contactByLast10.get(l);
  if (!contact) continue;

  // Don't override our preferred names like "Dad" with the contact's display name
  const name = skipNames.has(entry.name) ? entry.name : (entry.name || contact.name);

  for (const email of (contact.emails || [])) {
    const e = String(email).toLowerCase().trim();
    if (!e) continue;
    if (peopleMap[e]) continue;  // already mapped
    if (additions[e]) continue;
    additions[e] = { name, relationship: entry.relationship };
    if (entry.org) additions[e].org = entry.org;
    if (entry.notes) additions[e].notes = entry.notes;
    added++;
  }
}

console.log(`Found ${Object.keys(additions).length} new email handles to add:`);
for (const [email, info] of Object.entries(additions)) {
  console.log(`  ${email.padEnd(45)} → ${info.name} (${info.relationship})`);
}

if (Object.keys(additions).length === 0) {
  console.log('Nothing to add.');
  process.exit(0);
}

// Merge & write
const merged = { ...peopleMap, ...additions };
fs.writeFileSync(PEOPLE_MAP, JSON.stringify(merged, null, 2));
console.log(`\nWrote ${PEOPLE_MAP} with ${added} new entries.`);
