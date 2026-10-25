// A canned SPARQL backend for offline tests: ONE routing table, TWO transports.
//
// `makeRouter` owns the fixtures; `installFetchStub` (replaces globalThis.fetch)
// and `startStubServer` (a real loopback socket) are thin adapters over it, so
// the two transports cannot drift apart. Subprocess tests need the socket: the
// server runs as a child, so nothing in this process can stub its fetch.
//
// Routes are keyed by the `eokg:<name>` label on the first line of the posted
// query. A route is `(queryText) => ({ status?, body })` or a Promise of it
// (body: object → JSON, string → raw text), so a test can hold a response open.
// `stall: true` (installFetchStub only) sends the status, headers and body, then never ends the
// body: a body read hangs until the request is aborted.
//
// IMPORTANT — the endpoint is read at MODULE LOAD (src/config.js). In-process
// tests use installFetchStub, which matches by shape, not host. Subprocess tests
// use startStubServer and pass EOKG_SPARQL_ENDPOINT in the child's env.
//
// A request with no `query` form field whose URL path ends in `/search` (a Skosmos GET) goes to
// `routes.skosmos_search(fullUrl)` and is recorded as `{ label: 'skosmos_search', url }`.
//
// Unrouted requests are a hard failure, never a silent empty result: a test that
// accidentally reaches the real network must break loudly.

import { createServer } from 'node:http';
import { once } from 'node:events';

// [limit, offset] from a query's trailing `LIMIT n OFFSET m`.
export const limitOffset = (query) => /LIMIT (\d+) OFFSET (\d+)/.exec(query).slice(1).map(Number);

// A SPARQL JSON results body from [{ x: 'literal' | { type: 'uri', value } }].
export function bindings(rows) {
  const term = (t) => (typeof t === 'string' ? { type: 'literal', value: t } : t);
  return {
    head: { vars: [...new Set(rows.flatMap((r) => Object.keys(r)))] },
    results: {
      bindings: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, t]) => [k, term(t)]))),
    },
  };
}

const LABEL_RE = /^# eokg:([a-z][a-z0-9_]*)/;

export function makeRouter(routes) {
  const calls = [];
  async function handle(query, url) {
    if (query == null && /\/search$/.test(new URL(url ?? 'http://stub/').pathname)) {
      calls.push({ label: 'skosmos_search', url: String(url) });
      if (!routes.skosmos_search) throw new Error('stub-backend: unrouted Skosmos search');
      const { status = 200, body } = await routes.skosmos_search(String(url));
      return { status, body: typeof body === 'string' ? body : JSON.stringify(body) };
    }
    const label = LABEL_RE.exec(query ?? '')?.[1];
    calls.push({ label, query });
    const route = label && routes[label];
    if (!route) throw new Error(`stub-backend: unrouted SPARQL query "${label ?? '(no label)'}"`);
    const { status = 200, body = '', stall = false } = await route(query);
    return { status, stall, body: typeof body === 'string' ? body : JSON.stringify(body) };
  }
  return { calls, handle };
}

const failResponse = (err) => ({ status: 599, body: String(err.message) });

// Like undici, a body read rejects with the signal's AbortError once the request is aborted.
function stalledStream(prefix, signal) {
  return new ReadableStream({
    start(controller) {
      if (prefix) controller.enqueue(new TextEncoder().encode(prefix));
      signal?.addEventListener('abort', () => {
        controller.error(new DOMException('This operation was aborted', 'AbortError'));
      }, { once: true });
    },
  });
}

// Replace globalThis.fetch with a stub over `routes`. Returns { router, restore }.
export function installFetchStub(routes) {
  const router = makeRouter(routes);
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const query = new URLSearchParams(String(init.body ?? '')).get('query');
    const signal = init.signal;
    if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' });
    const pending = router.handle(query, String(url));
    const aborted = new Promise((_, reject) => {
      signal?.addEventListener('abort', () => {
        reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
    const { status, body, stall } = await Promise.race([pending, aborted]);
    return new Response(stall ? stalledStream(body, signal) : body, { status, headers: { 'content-type': 'application/json' } });
  };
  return { router, restore: () => { globalThis.fetch = original; } };
}

// Start a loopback HTTP server over `routes`. Returns { url, close, router }.
export async function startStubServer(routes) {
  const router = makeRouter(routes);
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const query = new URLSearchParams(Buffer.concat(chunks).toString()).get('query');
    let out;
    try { out = await router.handle(query, `http://${req.headers.host}${req.url}`); } catch (err) { out = failResponse(err); }
    res.writeHead(out.status, { 'content-type': 'application/json' });
    res.end(out.body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/repositories/odeuropa`,
    router,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
