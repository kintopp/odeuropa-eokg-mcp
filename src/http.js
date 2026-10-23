#!/usr/bin/env node
// Entry point: serve the Odeuropa EOKG MCP server over stateless Streamable HTTP.
// Separate from src/index.js (stdio). stdout is unused; all logging goes to stderr.

process.env.EOKG_ENTRY_POINT ??= 'http';

import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer } from './server.js';
import {
  SERVER_NAME, SERVER_VERSION, HTTP_PORT, HTTP_MAX_BODY_BYTES, HTTP_RESPONSE_TIMEOUT_MS,
  HTTP_MAX_INFLIGHT, MCP_ALLOWED_ORIGINS, MCP_ALLOWED_HOSTS,
} from './config.js';
import { parseMcpAllowedOrigins, isAllowedOrigin, isAllowedHost } from './lib/origin.js';
import { readBody, toWebRequest, writeWebResponse } from './lib/webbridge.js';

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

async function handlePost(req, res) {
  if (inflight >= HTTP_MAX_INFLIGHT) {
    sendJson(res, 503, { error: 'Server busy' }, { 'Retry-After': '5' });
    return;
  }
  inflight++;
  const abort = new AbortController();
  // Wall-clock, not res.setTimeout: SSE keep-alive frames would reset an idle timer.
  const guard = setTimeout(() => {
    abort.abort();
    if (!res.headersSent) sendJson(res, 504, { error: 'Request timeout' });
    else res.destroy();
  }, HTTP_RESPONSE_TIMEOUT_MS);
  res.once('close', () => {
    clearTimeout(guard);
    inflight--;
    if (!res.writableFinished) abort.abort();
  });

  try {
    const body = await readBody(req, HTTP_MAX_BODY_BYTES);
    const response = await handler.fetch(toWebRequest(req, body, abort.signal));
    await writeWebResponse(res, response);
  } catch (err) {
    if (err?.status === 413) {
      sendJson(res, 413, { error: 'Request body too large' }, { Connection: 'close' });
    } else if (!abort.signal.aborted) {
      log('request failed:', err);
      if (res.headersSent) res.destroy();
      else sendJson(res, 500, { error: 'Internal server error' });
    }
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
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'GET' || req.method === 'DELETE') {
    try {
      await writeWebResponse(res, await handler.fetch(toWebRequest(req, undefined)));
    } catch (err) {
      log('request failed:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
    return;
  }
  sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
}

let draining = false;

const server = createHttpServer((req, res) => {
  // A kept-alive socket would otherwise hold server.close() open until its idle timeout.
  res.once('close', () => { if (draining) server.closeIdleConnections(); });
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (pathname === '/mcp') {
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
