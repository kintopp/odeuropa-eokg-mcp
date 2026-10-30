// SPARQL SELECT client for the EOKG GraphDB endpoint. The timeout/retry loop lives
// in lib/http.js; this module adds the query envelope, error mapping to ToolError,
// an LRU+TTL response cache (the graph is read-only) and a concurrency cap.
// Retry policy is deliberately asymmetric: 429/502/503 retry, but a 504 or our own
// timeout never does — the gateway's 60 s cut is deterministic for a given query.

import {
  SPARQL_ENDPOINT, SPARQL_RETRYABLE_STATUS, SPARQL_MAX_CONCURRENCY,
  SPARQL_CACHE_MAX, SPARQL_CACHE_TTL_MS,
} from '../config.js';
import { PREFIXES } from './prefixes.js';
import { abortError, throwIfAborted } from '../lib/async.js';
import { fetchWithRetry } from '../lib/http.js';
import { createAsyncCache } from '../lib/cache.js';
import { ToolError } from '../lib/errors.js';

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const NARROW = 'Narrow the request: a more specific query or concept, fewer filters, a smaller page.';
const LUCENE_MARK = 'Cannot parse Lucene query';

const cache = createAsyncCache({ max: SPARQL_CACHE_MAX, ttlMs: SPARQL_CACHE_TTL_MS });

// Test seam: drop cached responses so tests that reuse a query observe a fresh fetch.
export function clearSparqlCache() { cache.clear(); }

// Minimal counting semaphore with a FIFO queue. A queued waiter whose signal
// aborts leaves the queue and rejects.
let active = 0;
const queue = [];
function acquire(signal) {
  throwIfAborted(signal);
  if (active < SPARQL_MAX_CONCURRENCY) { active++; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const waiter = { resolve: null };
    const onAbort = () => {
      const i = queue.indexOf(waiter);
      if (i >= 0) queue.splice(i, 1);
      reject(abortError(signal));
    };
    waiter.resolve = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    queue.push(waiter);
  });
}
function release() {
  const next = queue.shift();
  if (next) next.resolve(); // the slot passes straight to the next waiter
  else active--;
}

// `timeout` lets a profile report the facet as failed instead of failing the call.
function timeoutError(message) {
  const err = new ToolError(message, NARROW);
  err.timeout = true;
  return err;
}

function makeError(message, meta = {}) {
  const { status, body } = meta;
  if (status === 504) return timeoutError('The EOKG SPARQL endpoint timed out (its gateway cuts queries at 60 s).');
  if (status === 500 && typeof body === 'string' && body.includes(LUCENE_MARK)) {
    const detail = body.slice(body.indexOf(LUCENE_MARK) + LUCENE_MARK.length).split('\n')[0].trim().slice(0, 200);
    return new ToolError(
      `The full-text query could not be parsed: ${detail}`,
      'Check quotes and parentheses are balanced; use AND/OR/NOT in capitals; quote phrases with "…".',
    );
  }
  if (status === undefined && /timed out/.test(message)) return timeoutError(message);
  if (status === 429) {
    return new ToolError(message, 'The endpoint is rate-limiting; wait a minute and retry.');
  }
  return new ToolError(message, 'The EOKG endpoint may be down; retry later.');
}

function execute(query, { signal, timeoutMs }) {
  return fetchWithRetry(SPARQL_ENDPOINT, {
    signal,
    service: 'The EOKG SPARQL endpoint',
    makeError,
    retryableStatus: SPARQL_RETRYABLE_STATUS,
    retryTimeouts: false,
    readErrorBody: true,
    ...(timeoutMs !== undefined && { timeoutMs }),
    fetchOptions: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/sparql-results+json',
      },
      body: new URLSearchParams({ query }).toString(),
    },
    onOk: async (res) => {
      let json;
      try {
        json = await res.json();
      } catch (err) {
        // Only a parse failure is relabelled: an AbortError from the body read must reach
        // fetchWithRetry intact, or a timeout is retried and loses its typed label.
        if (err?.name !== 'SyntaxError') throw err;
        const parseError = new Error('The EOKG SPARQL endpoint returned a non-JSON response (unparseable body on HTTP 200).');
        parseError.transient = true;
        throw parseError;
      }
      return json.results.bindings;
    },
  });
}

/**
 * Run a SPARQL SELECT and return its bindings as an array of plain objects
 * { varName: { type, value, lang?, datatype? } }, exactly as in SPARQL JSON results.
 * `name` labels the query: it is prepended as a comment line `# eokg:<name>`, so the
 * offline stub backend can route on it and the endpoint's logs can attribute it.
 * `timeoutMs` bounds each attempt; `deadline` (a Date.now() value) bounds this caller's whole wait.
 */
export async function sparqlSelect(name, body, { signal, timeoutMs, deadline } = {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`Invalid SPARQL query name: ${JSON.stringify(name)}`);
  }
  throwIfAborted(signal);
  const query = `# eokg:${name}\n${PREFIXES}${body}`;
  const scope = deadline === undefined ? { signal, done() {} } : deadlineScope(signal, deadline);
  try {
    const rows = await cache.fetchCached(
      query,
      // The loader runs on the cache's shared signal, never one caller's.
      async (loaderSignal) => {
        await acquire(loaderSignal);
        try {
          return await execute(query, { signal: loaderSignal, timeoutMs });
        } finally {
          release();
        }
      },
      { signal: scope.signal },
    );
    return structuredClone(rows);
  } finally {
    scope.done();
  }
}

// A deadline belongs to one caller, so it is enforced on the caller's side of the cache: at
// expiry the caller detaches with a timeout ToolError. The shared loader is aborted (dequeued or
// cancelled, freeing its slot) only when no other caller still waits on it. `deadline` is an
// absolute Date.now() value, so it covers queueing, retries and backoff alike.
function deadlineScope(signal, deadline) {
  const expiry = new AbortController();
  const expire = () => {
    const err = timeoutError('The time budget for this call ran out before the EOKG SPARQL endpoint answered.');
    err.budget = true; // the caller's shared budget ended, not necessarily this query's own limit
    expiry.abort(err);
  };
  const ms = deadline - Date.now();
  const timer = ms > 0 ? setTimeout(expire, ms) : expire();
  return {
    signal: signal ? AbortSignal.any([signal, expiry.signal]) : expiry.signal,
    done: () => clearTimeout(timer),
  };
}

export const v = (row, key) => row[key]?.value;
export function num(row, key) {
  const raw = row[key]?.value;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}
export const lang = (row, key) => row[key]?.['xml:lang'];
