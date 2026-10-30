// SPARQL client: query envelope, error mapping, retry policy, cache, concurrency.
// All offline, in-process through installFetchStub.

import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sparqlSelect, v, num, lang, clearSparqlCache } from '../src/sparql/client.js';
import { ToolError, formatErrorText } from '../src/lib/errors.js';
import { installFetchStub, bindings } from './stub-backend.js';

let stub;
beforeEach(() => clearSparqlCache());
afterEach(() => { stub?.restore(); stub = undefined; });

const OK = () => ({ body: bindings([{ x: 'a' }]) });

test('query text starts with the eokg label and carries the verified prefixes', async () => {
  stub = installFetchStub({ q_one: OK });
  await sparqlSelect('q_one', 'SELECT ?x WHERE { ?x ?p ?o } LIMIT 1');
  const { query } = stub.router.calls[0];
  assert.ok(query.startsWith('# eokg:q_one\n'));
  assert.ok(query.includes('PREFIX schema: <https://schema.org/>'));
  assert.ok(query.endsWith('LIMIT 1'));
});

test('an invalid query name throws a plain Error before any request', async () => {
  stub = installFetchStub({});
  for (const bad of ['', 'Bad', '1x', 'has space', 'a-b', 'x'.repeat(65)]) {
    await assert.rejects(() => sparqlSelect(bad, 'SELECT * {}'), (e) => !(e instanceof ToolError) && /Invalid SPARQL query name/.test(e.message));
  }
  assert.equal(stub.router.calls.length, 0);
});

test('a 200 returns bindings and v/num/lang read them', async () => {
  stub = installFetchStub({
    q_read: () => ({
      body: bindings([{
        s: { type: 'uri', value: 'http://x/1' },
        n: { type: 'literal', value: '42' },
        bad: { type: 'literal', value: 'abc' },
        t: { type: 'literal', value: 'Rose', 'xml:lang': 'en' },
      }]),
    }),
  });
  const rows = await sparqlSelect('q_read', 'SELECT * {}');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(v(r, 's'), 'http://x/1');
  assert.equal(v(r, 'missing'), undefined);
  assert.equal(num(r, 'n'), 42);
  assert.equal(num(r, 'bad'), undefined);
  assert.equal(num(r, 'missing'), undefined);
  assert.equal(lang(r, 't'), 'en');
  assert.equal(lang(r, 'n'), undefined);
});

test('an identical second call is served from the cache', async () => {
  stub = installFetchStub({ q_cache: OK });
  await sparqlSelect('q_cache', 'SELECT * {}');
  await sparqlSelect('q_cache', 'SELECT * {}');
  assert.equal(stub.router.calls.length, 1);
});

// Failure mode: every tool is told to add a year range, which adds a join and makes a query slower.
test('the timeout hint suggests fewer filters, not a year range', async () => {
  stub = installFetchStub({ q_hint: () => ({ status: 504, body: '<title>504 Gateway Time-out</title>' }) });
  await assert.rejects(() => sparqlSelect('q_hint', 'SELECT * {}'), (e) => {
    assert.match(e.suggestion, /fewer filters/);
    assert.doesNotMatch(e.suggestion, /year range/);
    return true;
  });
});

test('a 504 is NOT retried and maps to a timeout ToolError', async () => {
  stub = installFetchStub({ q_504: () => ({ status: 504, body: '<title>504 Gateway Time-out</title>' }) });
  await assert.rejects(() => sparqlSelect('q_504', 'SELECT * {}'), (e) => {
    assert.ok(e instanceof ToolError);
    assert.equal(e.timeout, true);
    assert.ok(e.message.includes('60 s'));
    return true;
  });
  assert.equal(stub.router.calls.length, 1);
});

test('our own timeout is one call and a timeout ToolError', async () => {
  stub = installFetchStub({ q_slow: () => new Promise(() => {}) });
  await assert.rejects(() => sparqlSelect('q_slow', 'SELECT * {}', { timeoutMs: 50 }), (e) => {
    assert.ok(e instanceof ToolError);
    assert.equal(e.timeout, true);
    return true;
  });
  assert.equal(stub.router.calls.length, 1);
});

test('our own timeout while reading a 200 body is one call and a timeout ToolError', async () => {
  stub = installFetchStub({ q_stall: () => ({ stall: true, body: '{"head":' }) });
  await assert.rejects(() => sparqlSelect('q_stall', 'SELECT * {}', { timeoutMs: 25 }), (e) => {
    assert.ok(e instanceof ToolError);
    assert.equal(e.timeout, true);
    assert.doesNotMatch(e.message, /non-JSON/);
    return true;
  });
  assert.equal(stub.router.calls.length, 1);
});

test('a caller cancel while reading a 200 body is one call and an AbortError', async () => {
  stub = installFetchStub({ q_stall_cancel: () => ({ stall: true }) });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 25);
  await assert.rejects(() => sparqlSelect('q_stall_cancel', 'SELECT * {}', { signal: ac.signal }), { name: 'AbortError' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(stub.router.calls.length, 1);
});

test('a malformed JSON body on HTTP 200 is retried as transient, then reported as non-JSON', async (t) => {
  // Shorten only the 1 s and 2 s retry backoffs.
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...rest) => realSetTimeout(fn, ms === 1000 || ms === 2000 ? 1 : ms, ...rest));
  stub = installFetchStub({ q_garbled: () => ({ body: '<html>proxy error</html>' }) });
  await assert.rejects(() => sparqlSelect('q_garbled', 'SELECT * {}'), /non-JSON response/);
  assert.equal(stub.router.calls.length, 3);
});

test('a 502 on every attempt ends in a ToolError that says to retry later', async () => {
  stub = installFetchStub({ q_502: () => ({ status: 502, body: 'bad gateway' }) });
  await assert.rejects(() => sparqlSelect('q_502', 'SELECT * {}'), (e) => {
    assert.ok(e instanceof ToolError);
    assert.match(e.suggestion, /retry later/);
    return true;
  });
  assert.equal(stub.router.calls.length, 3);
});

test('a 503 is retried, then succeeds', async () => {
  let n = 0;
  stub = installFetchStub({ q_503: () => (++n === 1 ? { status: 503, body: 'busy' } : OK()) });
  const rows = await sparqlSelect('q_503', 'SELECT * {}');
  assert.equal(rows.length, 1);
  assert.equal(stub.router.calls.length, 2);
});

test('a Lucene parse error (HTTP 500) becomes a correctable ToolError', async () => {
  stub = installFetchStub({
    q_lucene: () => ({
      status: 500,
      body: 'Query evaluation error: com.ontotext.trree.sdk.InternalServerErrorException: Cannot parse Lucene query [source_value:(rose]: Encountered "<EOF>" at line 1, column 18.',
    }),
  });
  await assert.rejects(() => sparqlSelect('q_lucene', 'SELECT * {}'), (e) => {
    assert.ok(e instanceof ToolError);
    const text = formatErrorText(e);
    assert.match(text, /could not be parsed/);
    assert.ok(text.includes('[source_value:(rose]'));
    return true;
  });
  assert.equal(stub.router.calls.length, 1);
});

test('at most 4 requests are in flight; the rest queue', async () => {
  let inFlight = 0;
  let peak = 0;
  const releases = [];
  stub = installFetchStub({
    q_conc: () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => releases.push(() => { inFlight--; resolve(OK()); }));
    },
  });
  const all = Array.from({ length: 6 }, (_, i) => sparqlSelect('q_conc', `SELECT * { BIND(${i} AS ?i) }`));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(releases.length, 4);
  assert.equal(peak, 4);
  while (releases.length) {
    releases.shift()();
    await new Promise((r) => setTimeout(r, 10));
  }
  await Promise.all(all);
  assert.equal(peak, 4);
  assert.equal(stub.router.calls.length, 6);
});

test('an aborted signal while queued rejects with AbortError', async () => {
  const releases = [];
  stub = installFetchStub({
    q_queue: () => new Promise((resolve) => releases.push(() => resolve(OK()))),
  });
  const holders = Array.from({ length: 4 }, (_, i) => sparqlSelect('q_queue', `SELECT * { BIND(${i} AS ?i) }`));
  await new Promise((r) => setTimeout(r, 20));
  const ac = new AbortController();
  const queued = sparqlSelect('q_queue', 'SELECT * { BIND(99 AS ?i) }', { signal: ac.signal });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stub.router.calls.length, 4, 'the fifth call must still be queued');
  ac.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  releases.forEach((r) => r());
  await Promise.all(holders);
  assert.equal(stub.router.calls.length, 4, 'the aborted call never reached the network');
});

// Failure modes (deadline): time spent queued for a slot is not counted; a query whose only caller
// has given up is still sent once a slot frees; the expiry reads as a cancel rather than a timeout;
// one caller's deadline cancels the shared query another caller still waits on; a slot leaks.
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('a deadline that passes while queued is a timeout ToolError, and the query is never sent', { timeout: 5000 }, async () => {
  const releases = [];
  stub = installFetchStub({
    q_hold: () => new Promise((resolve) => releases.push(() => resolve(OK()))),
    q_late: OK,
    q_after: OK,
  });
  const holders = Array.from({ length: 4 }, (_, i) => sparqlSelect('q_hold', `SELECT * { BIND(${i} AS ?i) }`));
  await tick(20);
  await assert.rejects(sparqlSelect('q_late', 'SELECT * {}', { deadline: Date.now() + 30 }), (e) => {
    assert.ok(e instanceof ToolError);
    assert.equal(e.timeout, true);
    return true;
  });
  releases.forEach((r) => r());
  await Promise.all(holders);
  assert.equal((await sparqlSelect('q_after', 'SELECT * {}')).length, 1, 'capacity recovers');
  await tick(20);
  assert.ok(!stub.router.calls.some((c) => c.label === 'q_late'), 'work launched after its deadline');
});

test('a deadline already past fails before any request', async () => {
  stub = installFetchStub({ q_past: OK });
  await assert.rejects(sparqlSelect('q_past', 'SELECT * {}', { deadline: Date.now() - 1 }), (e) => e.timeout === true);
  assert.equal(stub.router.calls.length, 0);
});

test('a caller cancel before its deadline stays an AbortError', async () => {
  stub = installFetchStub({ q_cancel_first: () => new Promise(() => {}) });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(
    sparqlSelect('q_cancel_first', 'SELECT * {}', { signal: ac.signal, deadline: Date.now() + 5000 }),
    { name: 'AbortError' },
  );
});

test('a short-deadline caller detaches from a shared query without cancelling the other caller', { timeout: 5000 }, async () => {
  for (const shortFirst of [true, false]) {
    clearSparqlCache();
    let release;
    stub?.restore();
    stub = installFetchStub({ q_shared: () => new Promise((resolve) => { release = () => resolve(OK()); }) });
    const short = () => sparqlSelect('q_shared', 'SELECT * {}', { deadline: Date.now() + 20 });
    const long = () => sparqlSelect('q_shared', 'SELECT * {}', { deadline: Date.now() + 5000 });
    let shortCall;
    let longCall;
    if (shortFirst) { shortCall = short(); longCall = long(); } else { longCall = long(); shortCall = short(); }
    await assert.rejects(shortCall, (e) => e.timeout === true);
    await tick(10);
    release();
    assert.equal((await longCall).length, 1, `shortFirst=${shortFirst}`);
    assert.equal(stub.router.calls.length, 1, 'one shared request');
  }
});

test('retry backoff does not stretch a deadline', { timeout: 5000 }, async () => {
  stub = installFetchStub({ q_busy: () => ({ status: 503, body: 'busy' }) });
  const t0 = Date.now();
  await assert.rejects(sparqlSelect('q_busy', 'SELECT * {}', { deadline: Date.now() + 50 }), (e) => e.timeout === true);
  // Backoff alone is 1 s before the second attempt.
  assert.ok(Date.now() - t0 < 900, `settled after ${Date.now() - t0} ms`);
});
