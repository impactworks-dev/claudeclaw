#!/usr/bin/env node
// Parse a .vcf (vCard) file exported from Contacts.app and emit
// ~/claudeclaw/relay/contacts.json that the messages relay reads.
//
// Usage: node import-vcard.mjs /path/to/All\ Contacts.vcf

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const INPUT = process.argv[2];
if (!INPUT) {
  console.error('Usage: node import-vcard.mjs /path/to/vcards.vcf');
  process.exit(1);
}
const OUT = path.join(os.homedir(), 'claudeclaw', 'relay', 'contacts.json');

// Decode quoted-printable encoded text (used in older vCard exports for non-ASCII)
function decodeQP(s) {
  return s.replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Parse vCard format. Handle BEGIN:VCARD ... END:VCARD blocks, line unfolding
// (continuation lines start with space/tab), and key parameter notation.
function parseVCards(text) {
  // Unfold continuation lines (RFC 2426 §2.1.1)
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const cards = [];
  let current = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^BEGIN:VCARD/i.test(line)) {
      current = { name: '', org: '', phones: new Set(), emails: new Set() };
      continue;
    }
    if (/^END:VCARD/i.test(line)) {
      if (current) cards.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    // Split "PROP[;params]:value"
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const keyWithParams = line.slice(0, colonIdx);
    let value = line.slice(colonIdx + 1);

    const [keyRaw, ...paramParts] = keyWithParams.split(';');
    const key = keyRaw.toUpperCase();
    const params = paramParts.map(p => p.toUpperCase());
    if (params.some(p => p.includes('ENCODING=QUOTED-PRINTABLE'))) {
      value = decodeQP(value);
    }

    if (key === 'FN' && !current.name) {
      current.name = value;
    } else if (key === 'N' && !current.name) {
      // N: family;given;additional;prefix;suffix
      const parts = value.split(';');
      const given = parts[1] || '';
      const family = parts[0] || '';
      const composed = `${given} ${family}`.trim();
      if (composed) current.name = composed;
    } else if (key === 'ORG' && !current.org) {
      current.org = value.split(';')[0].trim();
    } else if (key === 'TEL') {
      const normalized = value.replace(/[^\d+]/g, '');
      if (normalized) current.phones.add(normalized);
    } else if (key === 'EMAIL') {
      const email = value.trim().toLowerCase();
      if (email && email.includes('@')) current.emails.add(email);
    }
  }
  return cards;
}

const text = fs.readFileSync(INPUT, 'utf-8');
const cards = parseVCards(text);

const out = [];
for (const c of cards) {
  if (!c.name || (!c.phones.size && !c.emails.size)) continue;
  out.push({
    name: c.name,
    org: c.org || null,
    phones: Array.from(c.phones),
    emails: Array.from(c.emails),
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`imported ${cards.length} vCards → ${out.length} usable contacts → ${OUT}`);
