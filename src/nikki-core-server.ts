import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { initDatabase } from './db.js';
import { logger } from './logger.js';
import {
  authenticateNikkiCore,
  configureStandaloneNikkiCore,
  normalizeNikkiCoreRequest,
  reasonWithNikkiCore,
} from './nikki-core.js';
import { NIKKI_CORE_TOKEN } from './config.js';

if (!NIKKI_CORE_TOKEN) throw new Error('NIKKI_CORE_TOKEN or macOS Keychain service nikki-core-bridge is required');
configureStandaloneNikkiCore();
initDatabase();

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', service: 'nikki-core' }));
app.post('/internal/nikki-core/reason', async (c) => {
  if (!authenticateNikkiCore(c.req.header('Authorization'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  try {
    const request = normalizeNikkiCoreRequest(await c.req.json());
    return c.json(await reasonWithNikkiCore(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nikki Core failed';
    const status = /required|valid|too large/i.test(message) ? 400 : 500;
    logger.warn({ err: message }, 'Standalone Nikki Core request failed');
    return c.json({ error: message }, status);
  }
});

const port = Math.max(1, Number(process.env.NIKKI_CORE_PORT || 3141));
serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, 'Standalone Nikki Core listening');
});
