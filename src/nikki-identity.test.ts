import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendNikkiIdentityContract,
  loadNikkiIdentityContract,
  REQUIRED_NIKKI_CONTRACT_MARKERS,
} from './nikki-identity.js';

const tempDirs: string[] = [];

function completeContract(): string {
  return REQUIRED_NIKKI_CONTRACT_MARKERS.join('\n\n') + '\n\nFull relationship and operating content.';
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Nikki identity contract', () => {
  it('injects the complete canonical file without truncation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nikki-identity-'));
    tempDirs.push(dir);
    const contractPath = path.join(dir, 'contract.md');
    const contract = completeContract();
    fs.writeFileSync(contractPath, contract);

    const result = appendNikkiIdentityContract('Base persona', { path: contractPath });

    expect(result.identity?.content).toBe(contract);
    expect(result.systemPrompt).toContain(contract);
    expect(result.identity?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when a required identity section is missing', () => {
    const partial = Buffer.from('# Nikki Identity and Operating Contract\n## Identity').toString('base64');
    expect(() => loadNikkiIdentityContract({ base64: partial })).toThrow(/incomplete/);
  });
});
