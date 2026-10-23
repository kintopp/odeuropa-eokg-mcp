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
