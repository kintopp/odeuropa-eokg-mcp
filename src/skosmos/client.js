// Skosmos REST client (vocab.odeuropa.eu) for label search. Skosmos answers an unknown
// vocab id with HTTP 200 and an HTML PHP fatal error, so the body is checked as well.

import { SKOSMOS_BASE, SPARQL_CACHE_TTL_MS } from '../config.js';
import { fetchWithRetry } from '../lib/http.js';
import { createAsyncCache } from '../lib/cache.js';
import { ToolError } from '../lib/errors.js';

const SUGGESTION = 'The vocabulary service may be down; retry later. eokg_get_concept still works for a known concept id.';
const cache = createAsyncCache({ max: 128, ttlMs: SPARQL_CACHE_TTL_MS });

// Test seam: drop cached responses.
export function clearSkosmosCache() { cache.clear(); }

const makeError = (message) => new ToolError(message, SUGGESTION);

async function fetchResults(url, signal) {
  try {
    return await fetchWithRetry(url, {
      signal,
      service: 'The Odeuropa vocabulary service (Skosmos)',
      makeError,
      fetchOptions: { method: 'GET', headers: { Accept: 'application/json' } },
      onOk: async (res) => {
        const text = await res.text();
        if (!(res.headers.get('content-type') ?? '').includes('json') || text.trimStart().startsWith('<')) {
          throw new ToolError('The vocabulary service returned an error page instead of results.', SUGGESTION);
        }
        return JSON.parse(text).results ?? [];
      },
    });
  } catch (err) {
    if (err?.name === 'TypeError') throw new ToolError('Could not reach the Odeuropa vocabulary service.', SUGGESTION);
    throw err;
  }
}

/** Search concepts by label. `vocabs` are Skosmos ids. Returns the raw results array. */
export async function skosmosSearch({ query, vocabs, lang, maxhits }, { signal } = {}) {
  const url = new URL('search', SKOSMOS_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('vocab', vocabs.join(' '));
  if (lang) url.searchParams.set('lang', lang);
  url.searchParams.set('maxhits', String(maxhits));
  const key = url.toString();
  const rows = await cache.fetchCached(key, (loaderSignal) => fetchResults(key, loaderSignal), { signal });
  return structuredClone(rows);
}
