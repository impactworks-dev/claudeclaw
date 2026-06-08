#!/usr/bin/env node
// Smoke-test the people-resolver against a sample of handles.

import { resolvePerson, categorize, resolverStats, displayName } from '../dist/people-resolver.js';

console.log('Resolver stats:', resolverStats());
console.log();

const tests = [
  '+19055999012',          // Audra (wife)
  'audra@impactworks.com',  // Audra email
  '+15144447578',          // Vincent (son)
  'vincent@impactworks.com', // son's work email
  '+13017045015',          // Dad
  'svc@cbmcpa.com',        // Dad email
  '+19194284957',          // Jim Roberts
  '+12408203396',          // ZAGG Phone Repair
  'caparottir@gmail.com',   // Ralph email
  '+18446771959',          // unknown marketing number
  'random@nobody.com',      // unknown
  'dante+ai@impactworks.com', // self
];

console.log('Handle'.padEnd(35), 'Person'.padEnd(40), 'Category');
console.log('-'.repeat(85));
for (const h of tests) {
  const p = resolvePerson(h);
  const c = categorize(p);
  const rendered = displayName(h, p);
  console.log(h.padEnd(35), (rendered).padEnd(40).slice(0, 40), c);
}
