// A minimal async cache: LRU eviction + TTL expiry + in-flight de-duplication
// (concurrent misses for the same key share one loader call). Used by every
// HTTP client in src/.
//
// Cancellation semantics: de-duplication must not couple callers' lifetimes.
// The shared loader runs on its OWN AbortSignal (passed to the loader as its
// argument), not on any single caller's. A caller's `signal` detaches only THAT
// caller; the loader's signal fires only when every attached caller has aborted.
// So one cancelled tool call can never fail an unrelated call waiting on the
// same key — and a request nobody wants anymore is still torn down.
//
// Retirement: when the last waiter aborts (or clear() runs), the in-flight
// entry is removed from the map immediately, so a same-key caller arriving
// before the doomed loader settles starts a fresh load instead of joining the
// aborted promise. The retired loader still runs to completion in the
// background, but identity guards keep it from publishing its value or
// deleting the entry that replaced it.

import { throwIfAborted, abortError } from './async.js';

export function createAsyncCache({ max = 16, ttlMs = 5 * 60 * 1000 } = {}) {
  const entries = new Map(); // key → { value, expires }; Map preserves insertion order (LRU)
  const inflight = new Map(); // key → { promise, controller, waiters }

  function get(key) {
    const e = entries.get(key);
    if (!e) return undefined;
    if (e.expires <= Date.now()) { entries.delete(key); return undefined; }
    entries.delete(key); // re-insert to mark most-recently-used
    entries.set(key, e);
    return e.value;
  }

  function set(key, value) {
    entries.set(key, { value, expires: Date.now() + ttlMs });
    while (entries.size > max) entries.delete(entries.keys().next().value); // evict oldest
  }

  /**
   * Return the cached value, join an in-flight load, or invoke `loader` once.
   * @param {string} key
   * @param {(signal: AbortSignal) => Promise<any>} loader  receives the shared
   *   internal signal (aborted only when all waiters have aborted)
   * @param {{signal?: AbortSignal}} [opts]  this caller's own cancellation
   */
  async function fetchCached(key, loader, { signal } = {}) {
    throwIfAborted(signal);
    const hit = get(key);
    if (hit !== undefined) return hit;

    let entry = inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const newEntry = { promise: null, controller, waiters: 0 };
      newEntry.promise = (async () => {
        try {
          const value = await loader(controller.signal);
          // Only the CURRENT entry may publish. A retired loader (all waiters
          // aborted, or clear()) settling late must not overwrite a
          // replacement's value or repopulate a cleared cache.
          if (inflight.get(key) === newEntry) set(key, value);
          return value;
        } finally {
          // Same identity guard: after retirement, this slot may already hold
          // a replacement entry that a stale delete would kill.
          if (inflight.get(key) === newEntry) inflight.delete(key);
        }
      })();
      // If every waiter detaches, the shared rejection has no consumer left —
      // mark it handled so it can't surface as an unhandledRejection.
      newEntry.promise.catch(() => {});
      entry = newEntry;
      inflight.set(key, entry);
    }

    entry.waiters += 1;
    // A caller without a signal can never abort, so it pins the loader alive.
    if (!signal) return entry.promise;

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        entry.waiters -= 1;
        if (entry.waiters === 0) {
          // Retire the entry BEFORE aborting: the loader settles (and cleans
          // up) asynchronously, so a same-key caller arriving in that gap
          // would otherwise join the already-aborted promise and fail without
          // its loader ever running.
          if (inflight.get(key) === entry) inflight.delete(key);
          entry.controller.abort(signal.reason);
        }
        reject(abortError(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
        (err) => { signal.removeEventListener('abort', onAbort); reject(err); },
      );
    });
  }

  // Drop every entry and retire all in-flight loaders (their identity guards
  // then keep late completions from repopulating what was cleared). Used by
  // tests that reuse a key across cases and need each to observe a fresh load.
  function clear() { entries.clear(); inflight.clear(); }

  return { get, set, fetchCached, clear };
}
