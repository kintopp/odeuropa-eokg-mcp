// Streamable HTTP entry (src/http.js) over raw fetch, against a stub SPARQL backend.
// Raw fetch on purpose: the SDK client cannot speak the 2026-07-28 wire.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { ROOT } from './helpers.js';
import { startStubServer, bindings } from './stub-backend.js';

const HTTP_ENTRY = join(ROOT, 'src', 'http.js');
const MODERN = '2026-07-28';
const LEGACY = '2025-06-18';
const SMELL = 'http://data.odeuropa.eu/smell/7e932a9d-fcd7-5192-a678-ae760d6306ad';
const TOOL_COUNT = 10;

let stub;
let stubDelayMs = 2000;
const children = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  const slow = async () => { await sleep(stubDelayMs); return { body: bindings([]) }; };
  stub = await startStubServer({ smell_core: slow, smell_excerpts: slow, smell_roles: slow });
});

after(async () => {
  for (const child of children) child.kill('SIGKILL');
  await stub?.close();
});

// Spawns src/http.js on a free port and resolves once it prints its listening line.
async function boot(env = {}) {
  const child = spawn(process.execPath, [HTTP_ENTRY], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', EOKG_SPARQL_ENDPOINT: stub.url, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.add(child);
  let stderr = '';
  const exited = once(child, 'exit');
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start in 10 s; stderr: ${stderr}`)), 10_000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const m = /listening on (http:\/\/\S+)/.exec(stderr);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.on('exit', () => { clearTimeout(timer); reject(new Error(`server exited early; stderr: ${stderr}`)); });
  });
  return {
    url,
    mcp: `${url}/mcp`,
    child,
    stderr: () => stderr,
    exited: exited.then(([code]) => code),
    stop: async () => { child.kill('SIGKILL'); await exited; },
  };
}

async function withServer(env, fn) {
  const server = await boot(env);
  try { return await fn(server); } finally { await server.stop(); }
}

function parseBody(text) {
  try { return JSON.parse(text.replace(/^event:.*\ndata: /m, '')); } catch { return null; }
}

async function post(server, headers, body, extra = {}) {
  const res = await fetch(server.mcp, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
    ...extra,
  });
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get('content-type'), headers: res.headers, body: parseBody(text) };
}

const envelope = () => ({
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': { name: 'http-transport-test', version: '0.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
});

const modernHeaders = (method, name) => ({
  'mcp-protocol-version': MODERN, 'mcp-method': method, ...(name && { 'mcp-name': name }),
});
const modernList = (server) => post(server, modernHeaders('tools/list'),
  { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: envelope() } });
const modernCall = (server, name, args, extra) => post(server, modernHeaders('tools/call', name),
  { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: envelope() } }, extra);
const legacyHeaders = { 'mcp-protocol-version': LEGACY };
const legacyCall = (server, name, args) => post(server, legacyHeaders,
  { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
const getSmell = { id: SMELL };

test('2025 wire: initialize, tools/list and a tool call work statelessly', async () => {
  await withServer({}, async (server) => {
    const init = await post(server, {}, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: 't', version: '0' } },
    });
    assert.equal(init.status, 200);
    assert.equal(init.body?.result?.serverInfo?.name, 'odeuropa-eokg-mcp');

    const list = await post(server, legacyHeaders, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.equal(list.body?.result?.tools?.length, TOOL_COUNT);

    const call = await legacyCall(server, 'eokg_list_datasets', {});
    assert.equal(call.status, 200);
    assert.notEqual(call.body?.result?.isError, true, JSON.stringify(call.body));
    assert.ok(call.body?.result?.structuredContent, 'tool result carries structuredContent');
  });
});

test('2026-07-28 wire: server/discover and enveloped tools/list answer as JSON', async () => {
  await withServer({}, async (server) => {
    const discover = await post(server, { 'mcp-protocol-version': MODERN, 'mcp-method': 'server/discover' }, {
      jsonrpc: '2.0', id: 1, method: 'server/discover',
      params: { supportedVersions: [MODERN], _meta: envelope() },
    });
    assert.equal(discover.status, 200);
    assert.ok(discover.body?.result?.supportedVersions?.includes(MODERN));

    const list = await modernList(server);
    assert.equal(list.status, 200);
    assert.match(list.contentType, /^application\/json/);
    assert.equal(list.body?.result?.tools?.length, TOOL_COUNT);
  });
});

test('GET /mcp is 405 and carries X-Accel-Buffering', async () => {
  await withServer({}, async (server) => {
    const res = await fetch(server.mcp);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('x-accel-buffering'), 'no');
  });
});

test('POST /mcp responses carry X-Accel-Buffering: no', async () => {
  await withServer({}, async (server) => {
    const res = await modernList(server);
    assert.equal(res.headers.get('x-accel-buffering'), 'no');
  });
});

test('Origin: a foreign Origin is 403, Origin: null is not, a malformed Origin is 403', async () => {
  await withServer({}, async (server) => {
    const denied = await post(server, { ...modernHeaders('tools/list'), origin: 'https://evil.example' },
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: envelope() } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('x-accel-buffering'), 'no', 'error responses are unbuffered too');
    assert.equal((await post(server, { ...modernHeaders('tools/list'), origin: 'null' },
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: envelope() } })).status, 200);
    assert.equal((await post(server, { ...modernHeaders('tools/list'), origin: 'https://claude.ai' },
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: envelope() } })).status, 200);
    assert.equal((await post(server, { ...modernHeaders('tools/list'), origin: 'not a url' },
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: envelope() } })).status, 403);
  });
});

test('Origin preflight: allowed origin gets 204, a foreign one 403', async () => {
  await withServer({}, async (server) => {
    const ok = await fetch(server.mcp, { method: 'OPTIONS', headers: { origin: 'https://claude.ai' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://claude.ai');
    const bad = await fetch(server.mcp, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
});

test('Host: with MCP_ALLOWED_HOSTS set, a foreign Host is 403 and the allowed Host passes', async () => {
  await withServer({ MCP_ALLOWED_HOSTS: 'example.org' }, async (server) => {
    // fetch() forbids overriding Host, so speak HTTP over a raw request.
    const { request } = await import('node:http');
    const status = (host) => new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: envelope() } });
      const req = request(server.mcp, {
        method: 'POST',
        headers: { ...modernHeaders('tools/list'), host, 'content-type': 'application/json',
          accept: 'application/json, text/event-stream', 'content-length': Buffer.byteLength(body) },
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.end(body);
    });
    assert.equal(await status('evil.org'), 403);
    assert.equal(await status('example.org'), 200);
    assert.equal(await status('example.org:8443'), 200);
    assert.equal((await fetch(`${server.url}/health`)).status, 200, '/health is exempt from the Host check');
  });
});

test('/health has status, server, version, commit and node', async () => {
  await withServer({}, async (server) => {
    const res = await fetch(`${server.url}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['commit', 'node', 'server', 'status', 'version']);
    assert.equal(body.status, 'ok');
    assert.equal(body.server, 'odeuropa-eokg-mcp');
  });
});

test('unknown paths are 404', async () => {
  await withServer({}, async (server) => {
    assert.equal((await fetch(`${server.url}/nope`)).status, 404);
  });
});

test('a body over 1 MiB is 413', async () => {
  await withServer({}, async (server) => {
    const res = await post(server, modernHeaders('tools/list'),
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(1_500_000) } });
    assert.equal(res.status, 413);
  });
});

test('response guard: a slow 2026-07-28 call is cut with 504 JSON', async () => {
  stubDelayMs = 2000;
  await withServer({ EOKG_HTTP_RESPONSE_TIMEOUT_MS: '300' }, async (server) => {
    const started = Date.now();
    const res = await modernCall(server, 'eokg_get_smell', getSmell);
    assert.equal(res.status, 504, `content-type: ${res.contentType}`);
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
    assert.deepEqual(res.body, { error: 'Request timeout' });
  });
});

test('response guard: a slow 2025 SSE answer is cut and the stream ends', async () => {
  stubDelayMs = 2000;
  await withServer({ EOKG_HTTP_RESPONSE_TIMEOUT_MS: '300' }, async (server) => {
    const started = Date.now();
    const res = await fetch(server.mcp, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...legacyHeaders },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'eokg_get_smell', arguments: getSmell } }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    const reader = res.body.getReader();
    // A destroyed socket surfaces as a read error: still the end of the stream.
    await (async () => { for (;;) { const { done } = await reader.read(); if (done) return; } })().catch(() => {});
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  });
});

test('in-flight cap: the second slow call is 503 with Retry-After, and the slot is released afterwards', async () => {
  stubDelayMs = 1000;
  await withServer({ EOKG_HTTP_MAX_INFLIGHT: '1' }, async (server) => {
    const first = modernCall(server, 'eokg_get_smell', getSmell);
    await sleep(250);
    const second = await modernCall(server, 'eokg_get_smell', getSmell);
    assert.equal(second.status, 503);
    assert.equal(second.headers.get('retry-after'), '5');
    assert.equal((await first).status, 200);
    assert.equal((await modernCall(server, 'eokg_list_datasets', {})).status, 200);
  });
});

test('in-flight cap: a client disconnect releases the slot', async () => {
  stubDelayMs = 3000;
  await withServer({ EOKG_HTTP_MAX_INFLIGHT: '1' }, async (server) => {
    const ctl = new AbortController();
    const dropped = modernCall(server, 'eokg_get_smell', getSmell, { signal: ctl.signal }).catch(() => {});
    await sleep(250);
    ctl.abort();
    await dropped;
    await sleep(100);
    assert.equal((await modernCall(server, 'eokg_list_datasets', {})).status, 200);
  });
});

test('SIGTERM during a slow call lets it finish with 200, then exits 0', async () => {
  stubDelayMs = 1000;
  const server = await boot();
  try {
    const call = modernCall(server, 'eokg_get_smell', getSmell);
    await sleep(250);
    server.child.kill('SIGTERM');
    assert.equal((await call).status, 200);
    assert.equal(await server.exited, 0);
  } finally {
    await server.stop();
  }
});

test('EOKG_LOG omits tool input on HTTP unless EOKG_LOG_INPUT=1', async () => {
  stubDelayMs = 0;
  await withServer({ EOKG_LOG: '1' }, async (server) => {
    await modernCall(server, 'eokg_get_smell', getSmell);
    assert.ok(server.stderr().includes('"tool":"eokg_get_smell"'), server.stderr());
    assert.ok(!server.stderr().includes('"input"'), 'search text is user content');
  });
  await withServer({ EOKG_LOG: '1', EOKG_LOG_INPUT: '1' }, async (server) => {
    await modernCall(server, 'eokg_get_smell', getSmell);
    assert.ok(server.stderr().includes('"input"'));
  });
});
