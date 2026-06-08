#!/usr/bin/env node
// Post a pending Vendasta Settlement Slip to QBO as a journal entry.
//
// Usage:
//   node scripts/post-settlement-slip.mjs <slip-id>   # post a specific slip
//   node scripts/post-settlement-slip.mjs latest      # post the most recent pending slip
//   node scripts/post-settlement-slip.mjs list        # show pending slips
//
// Called by Nikki when Dante replies "post slip <id>" in Telegram.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_FILE = path.join(ROOT, 'store', 'pending-slips.json');
const QBO_SERVER = path.join(ROOT, 'connectors', 'quickbooks', 'server.mjs');

const target = process.argv[2];
if (!target) {
  console.error('Usage: post-settlement-slip.mjs <slip-id|latest|list>');
  process.exit(2);
}

function loadPending() {
  try { return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8')); } catch { return []; }
}
function savePending(list) {
  fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true });
  fs.writeFileSync(PENDING_FILE, JSON.stringify(list, null, 2));
}

const pending = loadPending();

if (target === 'list') {
  if (pending.length === 0) { console.log('No pending slips.'); process.exit(0); }
  console.log(`${pending.length} pending slip(s):`);
  for (const s of pending) {
    const status = s.status === 'pending' ? '⏳' : '✅';
    console.log(`  ${status} ${s.id} — ${s.month} — net $${(s.amounts.netDeposit / 100).toFixed(2)} — ${s.status}`);
  }
  process.exit(0);
}

let slip;
if (target === 'latest') {
  slip = pending.find(s => s.status === 'pending');
  if (!slip) { console.error('No pending slips to post.'); process.exit(3); }
} else {
  slip = pending.find(s => s.id === target);
  if (!slip) { console.error(`Slip ${target} not found.`); process.exit(3); }
  if (slip.status !== 'pending') {
    console.error(`Slip ${target} status is "${slip.status}", not pending. (QBO entry: ${slip.qboJournalEntryId || 'n/a'})`);
    process.exit(4);
  }
}

console.error(`Posting slip ${slip.id} (${slip.month})...`);

// Sanity check: all account IDs resolved
const unresolved = slip.journalEntry.Line.filter(l => !l?.JournalEntryLineDetail?.AccountRef?.value);
if (unresolved.length > 0) {
  console.error(`${unresolved.length} journal entry lines missing AccountRef. Slip was generated with incomplete account ID lookup — regenerate after /api/qb/accounts resolves correctly.`);
  process.exit(5);
}

// Call the QBO connector
const { stdout } = await exec('/usr/local/bin/node', [
  QBO_SERVER, '--call', 'qbo_create_journal_entry', JSON.stringify(slip.journalEntry),
], { env: process.env, maxBuffer: 32 * 1024 * 1024 });

let result;
try { result = JSON.parse(stdout); } catch (e) { console.error('Connector returned non-JSON:', stdout.slice(0, 500)); process.exit(6); }

if (!result.id) {
  console.error('No journal entry ID returned. Result:', JSON.stringify(result, null, 2));
  process.exit(7);
}

// Update the slip status
slip.status = 'posted';
slip.qboJournalEntryId = result.id;
slip.qboLink = result.link;
slip.postedAt = Date.now();
savePending(pending);

console.log(`✅ Posted slip ${slip.id} as QBO journal entry ${result.id}`);
console.log(`Doc number: ${result.doc_number}`);
console.log(`Date: ${result.txn_date}`);
console.log(`Amount: $${result.total_amount.toFixed(2)}`);
console.log(`View in QBO: ${result.link}`);
