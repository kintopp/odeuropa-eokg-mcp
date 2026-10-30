#!/usr/bin/env node
// Entry point: serve the Odeuropa EOKG MCP server over stateless Streamable HTTP.
// Separate from src/index.js (stdio). stdout is unused; all logging goes to stderr.

process.env.EOKG_ENTRY_POINT ??= 'http';

import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createServer } from './server.js';
import {
  SERVER_NAME, SERVER_VERSION, HTTP_PORT, HTTP_MAX_BODY_BYTES, HTTP_RESPONSE_TIMEOUT_MS,
  HTTP_MAX_INFLIGHT, MCP_ALLOWED_ORIGINS, MCP_ALLOWED_HOSTS,
} from './config.js';
import { parseMcpAllowedOrigins, isAllowedOrigin, isAllowedHost } from './lib/origin.js';

const log = (...args) => console.error('[odeuropa-eokg-mcp]', ...args);

const allowedOrigins = parseMcpAllowedOrigins(MCP_ALLOWED_ORIGINS);
// Host check only when the operator configured a host; it fails open, Origin never does.
const configuredHosts = [
  ...(MCP_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  process.env.RAILWAY_PUBLIC_DOMAIN?.trim(),
].filter(Boolean);
const allowedHosts = configuredHosts.length ? [...configuredHosts, 'localhost', '127.0.0.1', '[::1]'] : [];

const handler = createMcpHandler(() => createServer(), {
  maxRequestBodySize: HTTP_MAX_BODY_BYTES,
  onerror: (err) => log('transport error:', err),
});

const handleRequest = toNodeHandler({
  fetch: async (request, options) => {
    const response = await handler.fetch(request, options);
    // Nobody reads a response that arrives after the guard answered, and an unread SSE body
    // queues keep-alive chunks forever. An already-aborted signal does not tear it down either.
    if (request.signal.aborted) response.body?.cancel().catch(() => {});
    return response;
  },
}, {
  maxRequestBodySize: HTTP_MAX_BODY_BYTES,
  // ECONNRESET is the client dropping the socket while sending its body, not a server failure.
  onerror: (err) => { if (err.code !== 'ECONNRESET') log('request failed:', err); },
});

let inflight = 0;

function sendJson(res, status, body, headers = {}) {
  if (res.headersSent || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function handlePreflight(req, res) {
  const requested = req.headers['access-control-request-headers'];
  res.writeHead(204, {
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': requested ?? 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
    'Access-Control-Max-Age': '600',
  });
  res.end();
}

// toNodeHandler never flushes, and a 2025 SSE answer writes nothing until the tool result or
// the keep-alive; the headers must commit before that for the client and the proxy.
function flushOnWriteHead(res) {
  const { writeHead } = res;
  res.writeHead = (...args) => {
    writeHead.apply(res, args);
    res.flushHeaders();
    return res;
  };
}

async function handleTransport(req, res) {
  // Nothing here decodes bodies; refusing them keeps any later decoder off the request path.
  const encoding = req.headers['content-encoding']?.trim().toLowerCase();
  if (encoding && encoding !== 'identity') {
    sendJson(res, 415, { error: 'Compressed request bodies are not accepted' }, { 'Accept-Encoding': 'identity', Connection: 'close' });
    return;
  }
  if (inflight >= HTTP_MAX_INFLIGHT) {
    sendJson(res, 503, { error: 'Server busy' }, { 'Retry-After': '5' });
    return;
  }
  inflight++;
  let timedOut = false;
  // Wall-clock, not res.setTimeout: SSE keep-alive frames would reset an idle timer.
  const guard = setTimeout(() => {
    timedOut = true;
    if (!res.headersSent) sendJson(res, 504, { error: 'Request timeout' });
    else res.destroy();
  }, HTTP_RESPONSE_TIMEOUT_MS);
  res.once('close', () => {
    clearTimeout(guard);
    inflight--;
  });

  flushOnWriteHead(res);
  try {
    await handleRequest(req, res);
  } catch (err) {
    // After a 504, toNodeHandler's unconditional writeHead throws ERR_HTTP_HEADERS_SENT.
    if (!timedOut || err.code !== 'ERR_HTTP_HEADERS_SENT') throw err;
  }
}

async function handleMcp(req, res) {
  res.setHeader('X-Accel-Buffering', 'no');
  if (!isAllowedHost(req.headers.host, allowedHosts)) {
    sendJson(res, 403, { error: 'Forbidden host' });
    return;
  }
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin, allowedOrigins)) {
    sendJson(res, 403, { error: 'Forbidden origin' });
    return;
  }
  if (origin !== undefined && origin !== 'null') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return handlePreflight(req, res);
  if (['POST', 'GET', 'DELETE'].includes(req.method)) return handleTransport(req, res);
  sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
}

let draining = false;

const server = createHttpServer((req, res) => {
  // A kept-alive socket would otherwise hold server.close() open until its idle timeout.
  res.once('close', () => { if (draining) server.closeIdleConnections(); });
  // Node's parser accepts targets such as `//%` that URL rejects; a throw here would kill the process.
  const pathname = URL.parse(req.url ?? '/', 'http://localhost')?.pathname;
  if (pathname === undefined) {
    sendJson(res, 400, { error: 'Bad request target' });
  } else if (pathname === '/mcp') {
    handleMcp(req, res).catch((err) => {
      log('unhandled:', err);
      if (res.headersSent) res.destroy();
      else sendJson(res, 500, { error: 'Internal server error' });
    });
  } else if (pathname === '/health' && req.method === 'GET') {
    // No Host check: platform health probes use their own Host.
    sendJson(res, 200, {
      status: 'ok',
      server: SERVER_NAME,
      version: SERVER_VERSION,
      commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? 'unknown',
      node: process.version,
    });
  } else {
    sendJson(res, 404, { error: 'Not found' });
  }
});

server.listen(HTTP_PORT, '0.0.0.0');
await once(server, 'listening');
log(`listening on http://127.0.0.1:${server.address().port}`);

process.once('SIGTERM', () => {
  log('SIGTERM: draining');
  draining = true;
  setTimeout(() => process.exit(0), 10_000).unref();
  server.closeIdleConnections();
  server.close(async () => {
    await handler.close();
    process.exit(0);
  });
});
