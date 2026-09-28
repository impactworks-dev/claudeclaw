import { describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  AGENT_MAX_TURNS: 30,
  agentTrustedTools: ['Read', 'WebSearch', 'mcp__clickup'],
}));

import { trustedChannelToolPolicy } from './trusted-tool-policy.js';

describe('trustedChannelToolPolicy', () => {
  it('uses an explicit default-mode allowlist instead of bypassPermissions', () => {
    expect(trustedChannelToolPolicy()).toEqual({
      permissionMode: 'default',
      allowedTools: ['Read', 'WebSearch', 'mcp__clickup'],
      maxTurns: 30,
    });
  });
});
