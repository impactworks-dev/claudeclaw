import type { AgentToolPolicy } from './agent.js';
import { AGENT_MAX_TURNS, agentTrustedTools } from './config.js';

/**
 * Trusted channels have no interactive SDK permission dialog. Keep their
 * capabilities explicit in agent.yaml instead of inheriting every installed
 * built-in and MCP tool through bypassPermissions.
 */
export function trustedChannelToolPolicy(): AgentToolPolicy | undefined {
  if (!agentTrustedTools || agentTrustedTools.length === 0) return undefined;
  return {
    permissionMode: 'default',
    allowedTools: [...agentTrustedTools],
    maxTurns: AGENT_MAX_TURNS,
  };
}
