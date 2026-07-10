/**
 * goldfish-sse-proxy.ts
 *
 * A minimal MCP SSE proxy that wraps the goldfish-mcp stdio binary.
 * Spawns a fresh goldfish-mcp child process per SSE connection so
 * concurrent / reconnecting clients never hit "Already connected" errors.
 *
 * Usage:  node dist/goldfish-sse-proxy.js [--port 3334]
 * Env:    GOLDFISH_MCP_BIN  (default: /Applications/Goldfish.app/Contents/MacOS/goldfish-mcp)
 *         GOLDFISH_SSE_PORT (default: 3334)
 */

import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

const BIN =
  process.env.GOLDFISH_MCP_BIN ||
  '/Applications/Goldfish.app/Contents/MacOS/goldfish-mcp';
const PORT = parseInt(
  process.argv.find((a, i) => process.argv[i - 1] === '--port') ||
    process.env.GOLDFISH_SSE_PORT ||
    '3334',
  10,
);

function log(...args: unknown[]) {
  console.log(`[goldfish-sse]`, ...args);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // --- Health check ---
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // --- SSE endpoint: open a persistent stream, spawn a child ---
  if (url.pathname === '/sse' && req.method === 'GET') {
    const sessionId = randomUUID();
    const messageUrl = `/message?sessionId=${sessionId}`;

    log(`New SSE connection (session ${sessionId})`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send the endpoint event immediately so the client knows where to POST
    res.write(`event: endpoint\ndata: ${messageUrl}\n\n`);

    // Spawn fresh goldfish-mcp child
    let child: ChildProcess | null = spawn(BIN, [], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env },
    });

    if (!child.stdout || !child.stdin) {
      log('Failed to spawn goldfish-mcp');
      res.end();
      return;
    }

    // Buffer for assembling newline-delimited JSON from child stdout
    let buf = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Forward each JSON-RPC message to the SSE client as a "message" event
        res.write(`event: message\ndata: ${trimmed}\n\n`);
      }
    });

    child.on('exit', (code) => {
      log(`Child exited (code ${code}, session ${sessionId})`);
      if (!res.writableEnded) res.end();
      child = null;
    });

    // Store in session map so the POST handler can write to stdin
    sessions.set(sessionId, child);

    req.on('close', () => {
      log(`SSE connection closed (session ${sessionId})`);
      sessions.delete(sessionId);
      if (child && !child.killed) child.kill();
      child = null;
    });

    return;
  }

  // --- Message endpoint: forward JSON body to child stdin ---
  if (url.pathname === '/message' && req.method === 'POST') {
    const sessionId = url.searchParams.get('sessionId') || '';
    const child = sessions.get(sessionId);

    if (!child || !child.stdin || child.killed) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('session not found');
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk.toString()));
    req.on('end', () => {
      try {
        // goldfish-mcp expects newline-delimited JSON on stdin
        child!.stdin!.write(body.trim() + '\n');
        res.writeHead(202, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        });
        res.end('accepted');
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`error: ${e}`);
      }
    });
    return;
  }

  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

// Session map: sessionId → child process
const sessions = new Map<string, ChildProcess>();

server.listen(PORT, () => {
  log(`Listening on port ${PORT}`);
  log(`SSE endpoint:   http://localhost:${PORT}/sse`);
  log(`POST messages:  http://localhost:${PORT}/message`);
  log(`Binary:         ${BIN}`);
});

process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down');
  for (const [, child] of sessions) {
    if (!child.killed) child.kill();
  }
  server.close();
});
