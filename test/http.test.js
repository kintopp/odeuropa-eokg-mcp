// fetchWithRetry options: retryableStatus, retryTimeouts, readErrorBody, timeoutMs.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../src/lib/http.js';
import { MAX_RETRIES } from '../src/config.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const base = (extra = {}) => ({
  service: 'Svc',
  makeError: (message, meta = {}) => Object.assign(new Error(message), { meta }),
  onOk: async () => 'ok',
  ...extra,
});

// A fetch that never resolves but honours the abort signal.
const hangingFetch = (counter) => (_url, init) => {
  counter.n++;
  return new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
};

test('retryableStatus overrides the default set', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('x', { status: 500 }); };
  // 500 is retryable by default; with an empty set it fails at once.
  await assert.rejects(fetchWithRetry('http://x', base({ retryableStatus: new Set() })), /HTTP 500/);
  assert.equal(calls, 1);
});

test('retryTimeouts:false makes one call and reports a timeout', async () => {
  const c = { n: 0 };
  globalThis.fetch = hangingFetch(c);
  await assert.rejects(
    fetchWithRetry('http://x', base({ retryTimeouts: false, timeoutMs: 50 })),
    (e) => /timed out/.test(e.message) && /1 attempt\)/.test(e.message),
  );
  assert.equal(c.n, 1);
});

test('retryTimeouts defaults to true: MAX_RETRIES + 1 calls', { timeout: 20000 }, async () => {
  const c = { n: 0 };
  globalThis.fetch = hangingFetch(c);
  await assert.rejects(fetchWithRetry('http://x', base({ timeoutMs: 20 })), /timed out/);
  assert.equal(c.n, MAX_RETRIES + 1);
});

test('readErrorBody passes the body of a non-retryable error to makeError', async () => {
  globalThis.fetch = async () => new Response('Cannot parse Lucene query [x]', { status: 500 });
  await assert.rejects(
    fetchWithRetry('http://x', base({ retryableStatus: new Set([503]), readErrorBody: true })),
    (e) => e.meta.status === 500 && e.meta.body === 'Cannot parse Lucene query [x]',
  );
});

test('readErrorBody truncates the body to 4096 characters', async () => {
  globalThis.fetch = async () => new Response('y'.repeat(10000), { status: 500 });
  await assert.rejects(
    fetchWithRetry('http://x', base({ retryableStatus: new Set(), readErrorBody: true })),
    (e) => e.meta.body.length === 4096,
  );
});

test('without readErrorBody no body is passed', async () => {
  globalThis.fetch = async () => new Response('secret', { status: 500 });
  await assert.rejects(
    fetchWithRetry('http://x', base({ retryableStatus: new Set() })),
    (e) => e.meta.status === 500 && e.meta.body === undefined,
  );
});

test('a retryable status body is discarded, not read', async () => {
  let readCalls = 0;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const res = new Response('busy', { status: 503 });
    const text = res.text.bind(res);
    res.text = () => { readCalls++; return text(); };
    return res;
  };
  await assert.rejects(
    fetchWithRetry('http://x', base({ retryableStatus: new Set([503]), readErrorBody: true })),
    (e) => e.meta.status === 503 && e.meta.body === undefined,
  );
  assert.equal(calls, MAX_RETRIES + 1);
  assert.equal(readCalls, 0);
});
