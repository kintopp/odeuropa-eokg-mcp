import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { skosmosSearch, clearSkosmosCache } from '../src/skosmos/client.js';
import { ToolError } from '../src/lib/errors.js';
import { installFetchStub } from './stub-backend.js';

let stub;
beforeEach(() => clearSkosmosCache());
afterEach(() => { stub?.restore(); stub = null; });

const args = { query: 'rose*', vocabs: ['olfactory_objects', 'fragrant-spaces'], lang: 'en', maxhits: 5 };

test('vocab ids are joined with + in the requested URL', async () => {
  let seen;
  stub = installFetchStub({ skosmos_search: (url) => { seen = url; return { body: { results: [] } }; } });
  await skosmosSearch(args);
  assert.ok(seen.includes('vocab=olfactory_objects+fragrant-spaces'), seen);
  assert.ok(seen.includes('lang=en') && seen.includes('maxhits=5'), seen);
});

test('a JSON body returns its results', async () => {
  stub = installFetchStub({ skosmos_search: () => ({ body: { results: [{ uri: 'u', prefLabel: 'Rose' }] } }) });
  assert.deepEqual(await skosmosSearch(args), [{ uri: 'u', prefLabel: 'Rose' }]);
});

test('an HTML PHP error on HTTP 200 becomes a ToolError', async () => {
  stub = installFetchStub({
    skosmos_search: () => ({ body: '<br />\n<b>Fatal error</b>: Uncaught Exception in /var/www/x.php' }),
  });
  await assert.rejects(skosmosSearch(args), (e) => e instanceof ToolError && /error page/.test(e.message));
});

test('HTTP 503 after retries is a ToolError pointing at eokg_get_concept', async () => {
  stub = installFetchStub({ skosmos_search: () => ({ status: 503, body: 'down' }) });
  await assert.rejects(skosmosSearch(args), (e) => e instanceof ToolError && /eokg_get_concept/.test(e.suggestion));
});
