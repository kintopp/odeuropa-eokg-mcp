// docs/tools.md quotes the server's wire text — the MCP `instructions`, and each
// tool's `description` and parameter table — inside generated blocks that
// `npm run build:docs` renders from a live listTools. Asserted against the REAL
// wire: the server is spawned over stdio, so this checks what a client is
// actually told. Offline — initialize and listTools make no backend call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withClient } from './helpers.js';
import { DOC_PATH, renderToolsDoc } from '../scripts/build-docs.mjs';

const DOC = readFileSync(DOC_PATH, 'utf8');
const wire = withClient('eokg-docs', async (client) => ({
  instructions: client.getInstructions(),
  tools: (await client.listTools()).tools,
}));

test('docs/tools.md\'s generated blocks match the wire', async () => {
  assert.equal(DOC, renderToolsDoc(DOC, await wire),
    'docs/tools.md is stale — run `npm run build:docs` and commit the result');
});

test('no parameter row has an undefined type', () => {
  assert.doesNotMatch(DOC, /^\| `\w+` \| [^|]*undefined/m);
  assert.match(DOC, /^\| `bucket_years` \| enum: `10` · `20` · `50` \|/m);
});
