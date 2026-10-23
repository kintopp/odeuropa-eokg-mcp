// Fetches image bytes from the Odeuropa image server (data.odeuropa.eu/image/…). The URL comes
// from KG data, so IMAGE_URL_RE is enforced here as a backstop and redirects are refused.

import { IMAGE_URL_RE, IMAGE_CACHE_MAX, MAX_IMAGE_BYTES, SPARQL_CACHE_TTL_MS } from '../config.js';
import { createAsyncCache } from '../lib/cache.js';
import { fetchWithRetry } from '../lib/http.js';
import { ToolError } from '../lib/errors.js';

const SUGGESTION = 'The Odeuropa image server may be down; retry later, or open image_url in a browser.';

const cache = createAsyncCache({ max: IMAGE_CACHE_MAX, ttlMs: SPARQL_CACHE_TTL_MS });

// Test seam: the cache outlives a single call.
export function clearImageCache() { cache.clear(); }

const tooLarge = (url, bytes) => new ToolError(
  `The image is ${(bytes / 1e6).toFixed(1)} MB, over the ${(MAX_IMAGE_BYTES / 1e6).toFixed(1)} MB a client accepts.`,
  `Open ${url} in a browser instead.`,
);

async function download(url, signal) {
  try {
    return await fetchWithRetry(url, {
      signal,
      service: 'The EOKG image server',
      makeError: (message) => new ToolError(message, SUGGESTION),
      fetchOptions: { redirect: 'error', headers: { Accept: 'image/*' } },
      onOk: async (res) => {
        // A 200 that isn't an image (an HTML error page) must not be cached or handed over as pixels.
        const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim() || 'image/jpeg';
        if (!mimeType.startsWith('image/')) {
          throw new ToolError(`The EOKG image server returned ${mimeType} instead of an image.`, SUGGESTION);
        }
        const declared = Number(res.headers.get('content-length'));
        if (declared > MAX_IMAGE_BYTES) throw tooLarge(url, declared); // before the body is read
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > MAX_IMAGE_BYTES) throw tooLarge(url, buffer.length); // chunked: no content-length
        return { buffer, mimeType };
      },
    });
  } catch (err) {
    // TypeError: network failure, or a redirect refused by `redirect: 'error'`.
    if (err?.name === 'TypeError') {
      throw new ToolError(
        'Could not fetch the image from the EOKG image server (network error or an unexpected redirect).',
        'Retry later, or open image_url in a browser.',
      );
    }
    throw err;
  }
}

/** Fetch a KG-hosted image (cached). Returns { buffer, mimeType }. */
export async function fetchKgImage(url, { signal } = {}) {
  if (!IMAGE_URL_RE.test(url)) throw new Error(`Refusing to fetch non-KG image URL: ${String(url).slice(0, 200)}`);
  const { buffer, mimeType } = await cache.fetchCached(url, (loaderSignal) => download(url, loaderSignal), { signal });
  return { buffer: Buffer.from(buffer), mimeType }; // per-caller copy
}
