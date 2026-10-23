// Small async helpers shared by the HTTP clients.

// An AbortError-shaped Error so callers that branch on `err.name` treat a
// cancelled sleep the same as a cancelled fetch.
export function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

// Bail out of a retry loop when the caller has cancelled. Pass the in-flight
// error at a catch site (rethrown as-is), or omit it at the loop top to throw a
// fresh AbortError.
export function throwIfAborted(signal, err) {
  if (signal?.aborted) throw err || abortError(signal);
}

// Whether a caught error is the caller's cancellation, which a degrade-to-
// fallback catch must rethrow rather than swallow.
export function isAbort(err, signal) {
  return err?.name === 'AbortError' || Boolean(signal?.aborted);
}

// Map `items` through `fn` with at most `limit` calls in flight, in input order.
// A rejection stops further launches and rejects the whole map.
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        next = items.length;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Sleep that settles early (rejecting with an AbortError) if `signal` fires, so
// a cancelled request doesn't sit through the full retry backoff before giving
// up. Resolves normally after `ms` when there is no signal or it never aborts.
// Both settle paths detach from the signal: a retry-heavy request reuses ONE
// signal for every backoff, so a listener left behind by each completed sleep
// would accumulate for the signal's lifetime (and can trip Node's
// MaxListenersExceededWarning under a retry storm).
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError(signal)); return; }
    if (!signal) { setTimeout(resolve, ms); return; }
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
