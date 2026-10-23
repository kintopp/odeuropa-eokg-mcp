// The one fetch-with-retry loop shared by every HTTP client in src/.
// Handles per-request timeout, external abort propagation,
// capped exponential backoff on transient failures, and RFC-9110 `Retry-After`
// (honored verbatim under RETRY_MAX_DELAY_MS, failed fast above it). Each client
// supplies only what differs: its fetch options, a success extractor (`onOk`),
// and an error factory (`makeError(message, { status })`).

import { REQUEST_TIMEOUT_MS, MAX_RETRIES, RETRY_MAX_DELAY_MS, userAgent } from '../config.js';
import { abortableSleep, throwIfAborted } from './async.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const backoffMs = (attempt) => Math.min(1000 * 2 ** attempt, RETRY_MAX_DELAY_MS); // 1s, 2s, 4s, … capped

// A non-2xx body is never read (only its status/headers are), so cancel it —
// undici keeps the connection busy until the body is consumed, cancelled, or
// GC'd, which delays reuse across retries. Best-effort by design: a disposal
// failure (or a body-less stub in tests) must never mask the service error
// about to be surfaced.
export function discardBody(res) {
  try { res.body?.cancel().catch(() => {}); } catch { /* best-effort */ }
}

// Parse an HTTP `Retry-After` header (RFC 9110) into milliseconds, or undefined
// when it is absent or unparseable. Accepts both wire forms: delta-seconds
// ("120") and an HTTP-date ("Wed, 21 Oct 2025 07:28:00 GMT"); a date already in
// the past yields 0 (retry now). Takes the Response so callers don't repeat the
// header read.
export function parseRetryAfter(res) {
  const raw = res?.headers?.get?.('retry-after');
  if (!raw) return undefined;
  const secs = Number(raw); // delta-seconds form (spec: an integer)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(raw); // HTTP-date form
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return undefined;
}

/**
 * Fetch `url` with timeout + retry. Returns `await onOk(res)` on a 2xx.
 * @param {string} url
 * @param {object} cfg
 * @param {AbortSignal} [cfg.signal]         caller cancellation
 * @param {object}      [cfg.fetchOptions]   method/headers/body (signal is added)
 * @param {string}       cfg.service         human label for error messages
 * @param {(msg: string, meta?: {status?: number, body?: string}) => Error} cfg.makeError
 * @param {(res: Response) => Promise<any>}  cfg.onOk  success-body extractor
 * @param {Set<number>} [cfg.retryableStatus]  statuses worth retrying (default RETRYABLE_STATUS)
 * @param {boolean}     [cfg.retryTimeouts=true]  retry attempts that died to our own timer
 * @param {boolean}     [cfg.readErrorBody=false]  for a non-ok, non-retryable response, read up to
 *   4096 chars of the body and pass it as `makeError(msg, { status, body })`
 * @param {number}      [cfg.timeoutMs]  per-attempt timeout (default REQUEST_TIMEOUT_MS)
 */
export async function fetchWithRetry(url, {
  signal, fetchOptions = {}, service, makeError, onOk,
  retryableStatus = RETRYABLE_STATUS, retryTimeouts = true, readErrorBody = false,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  // Set here, not per client, so no client can go out unidentified — including
  // the collection client, whose no-auth policy doesn't extend to this header.
  fetchOptions = { ...fetchOptions, headers: { ...fetchOptions.headers, 'User-Agent': userAgent() } };
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    throwIfAborted(signal); // caller cancelled during a prior backoff
    const controller = new AbortController();
    // Track whether OUR timer fired: a local timeout and a caller cancel both
    // surface as AbortError, but only the former should ever be relabelled.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let res;
    try {
      res = await fetch(url, { ...fetchOptions, signal: controller.signal });
      if (!res.ok) {
        const retryable = retryableStatus.has(res.status);
        let body;
        if (readErrorBody && !retryable) {
          try { body = (await res.text()).slice(0, 4096); } catch { body = ''; }
        } else {
          discardBody(res); // every other non-ok path leaves the body unread
        }
        const retryAfter = retryable ? parseRetryAfter(res) : undefined;
        // Above the ceiling, retrying sooner than the server permits just burns
        // an attempt — fail fast with actionable text instead.
        if (retryAfter != null && retryAfter > RETRY_MAX_DELAY_MS) {
          throw makeError(
            `${service} is rate-limited (HTTP ${res.status}); it asked to wait ` +
            `${Math.ceil(retryAfter / 1000)}s, beyond the ${RETRY_MAX_DELAY_MS / 1000}s retry ceiling.`,
            { status: res.status },
          );
        }
        if (retryable && attempt < MAX_RETRIES) {
          lastError = makeError(`HTTP ${res.status}`, { status: res.status });
          // Honor a Retry-After under the ceiling; otherwise exponential backoff.
          await abortableSleep(retryAfter ?? backoffMs(attempt), signal);
          continue;
        }
        throw makeError(`${service} returned HTTP ${res.status}`, { status: res.status, ...(body !== undefined && { body }) });
      }
      return await onOk(res);
    } catch (err) {
      // An onOk throw abandons its 2xx response — cancel any body it left
      // undrained, or a transient retry re-fetches while the old connection
      // stays pinned. (Non-ok bodies were already discarded above.)
      if (res?.ok) discardBody(res);
      throwIfAborted(signal, err); // a caller cancel surfaces as AbortError too; never retry it
      // Network failure (TypeError) or our own timeout (AbortError) → retry.
      // Errors we threw above (via makeError / onOk) carry other names and fall
      // through — unless the thrower opted in by setting `err.transient = true`
      // (e.g. a 2xx whose body failed to parse: likely a proxy flake).
      const ownTimeout = timedOut && err.name === 'AbortError';
      const transient = err.transient === true || err.name === 'TypeError' ||
        (err.name === 'AbortError' && (!ownTimeout || retryTimeouts));
      if (transient && attempt < MAX_RETRIES) {
        lastError = err;
        await abortableSleep(backoffMs(attempt), signal);
        continue;
      }
      // Terminal, and the caller didn't cancel (ruled out above): if this
      // attempt died to OUR timer, the bare "operation was aborted" AbortError
      // would be indistinguishable from a deliberate cancel and names neither
      // the service nor the limit — relabel it as a typed timeout error.
      if (ownTimeout) {
        throw makeError(
          `${service} timed out after ${timeoutMs / 1000}s ` +
          `(${attempt + 1} attempt${attempt ? 's' : ''}). The backend may be slow or unreachable; ` +
          'EOKG_TIMEOUT_MS raises the per-attempt limit.',
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  // Unreachable by construction — the final attempt always returns or throws
  // above (`continue` is gated on attempt < MAX_RETRIES). Kept as a guard so a
  // future edit to the retry conditions fails loudly instead of resolving to
  // `undefined`.
  throw lastError || makeError(`${service} request failed after retries`);
}
