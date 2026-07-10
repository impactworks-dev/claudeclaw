/**
 * obsidian-import.ts
 *
 * Reads JSONL memory records from stdin and writes them to the ClaudeClaw DB.
 * Designed to run on Fly via:
 *
 *   node dist/obsidian-ingest.js --output-json | \
 *     fly ssh console -a claudeclaw-impactworks -C "node /app/dist/obsidian-import.js"
 *
 * Each line of stdin must be a valid JSON MemoryRecord object.
 */

import * as readline from 'node:readline';
import { initDatabase, saveStructuredMemory } from './db.js';

initDatabase();

const rl = readline.createInterface({ input: process.stdin, terminal: false });

let imported = 0;
let failed = 0;

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const rec = JSON.parse(trimmed);
    saveStructuredMemory(
      rec.chatId ?? 'obsidian-ingest',
      rec.rawText,
      rec.summary,
      rec.entities ?? [],
      rec.topics ?? [],
      rec.importance ?? 0.5,
      rec.source ?? 'obsidian',
      rec.agentId ?? 'main',
    );
    imported++;
    process.stderr.write(`✓ ${rec.summary?.slice(0, 60)}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`✗ Failed to import record: ${err}\n`);
  }
});

rl.on('close', () => {
  process.stderr.write(`\nImport complete: ${imported} saved, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
