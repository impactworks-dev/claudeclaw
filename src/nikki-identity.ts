import crypto from 'node:crypto';
import fs from 'node:fs';

export const REQUIRED_NIKKI_CONTRACT_MARKERS = [
  '# Nikki Identity and Operating Contract',
  '## Identity',
  '## Relational Persona',
  '## Primary Mission',
  '## Operating Rules',
  '## Systems of Record',
  '## One-File Rule',
] as const;

export interface NikkiIdentitySource {
  path?: string;
  base64?: string;
}

export interface LoadedNikkiIdentity {
  content: string;
  sha256: string;
  source: 'path' | 'base64';
}

export function loadNikkiIdentityContract(source: NikkiIdentitySource): LoadedNikkiIdentity | null {
  const content = source.base64
    ? Buffer.from(source.base64, 'base64').toString('utf-8').trim()
    : source.path
      ? fs.readFileSync(source.path, 'utf-8').trim()
      : '';
  if (!content) return null;

  const missing = REQUIRED_NIKKI_CONTRACT_MARKERS.filter((marker) => !content.includes(marker));
  if (missing.length > 0) {
    throw new Error(`Nikki identity contract is incomplete; missing: ${missing.join(', ')}`);
  }

  return {
    content,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    source: source.base64 ? 'base64' : 'path',
  };
}

export function appendNikkiIdentityContract(
  systemPrompt: string | undefined,
  source: NikkiIdentitySource,
): { systemPrompt: string | undefined; identity: LoadedNikkiIdentity | null } {
  const identity = loadNikkiIdentityContract(source);
  if (!identity) return { systemPrompt, identity: null };
  return {
    systemPrompt: [
      systemPrompt?.trimEnd(),
      '',
      '[Canonical Nikki Identity and Operating Contract]',
      identity.content,
      '[End Canonical Nikki Identity and Operating Contract]',
      '',
    ].filter((part) => part !== undefined).join('\n'),
    identity,
  };
}
