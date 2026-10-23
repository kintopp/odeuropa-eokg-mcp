import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseId, isLocal, uuidOf, explorerUrl } from '../src/lib/ids.js';
import { ToolError } from '../src/lib/errors.js';

const U = '7e932a9d-fcd7-5192-a678-ae760d6306ad';
const CANON = `http://data.odeuropa.eu/smell/${U}`;

test('all accepted smell shapes normalise to the canonical URI', () => {
  for (const input of [
    CANON, `https://data.odeuropa.eu/smell/${U}`, U, `  ${U.toUpperCase()} `,
    `https://explorer.odeuropa.eu/smells/${U}`,
  ]) assert.equal(parseId('smell', input), CANON, input);
});

test('Explorer links are not source ids', () => {
  assert.throws(() => parseId('source', `https://explorer.odeuropa.eu/smells/${U}`), ToolError);
  assert.equal(parseId('source', U), `http://data.odeuropa.eu/source/${U}`);
});

test('fragment URIs and injection attempts are rejected', () => {
  for (const bad of [
    `http://data.odeuropa.eu/source/${U}/fragment/${U}`,
    '<http://x> } ; DROP', 'smell/../', '', `${U}0`, `${CANON}> .`,
  ]) {
    assert.throws(() => parseId('source', bad), ToolError, bad);
    assert.throws(() => parseId('smell', bad), ToolError, bad);
  }
  assert.throws(() => parseId('smell', undefined), /Not a valid smell id/);
});

test('helpers', () => {
  assert.equal(isLocal('http://www.wikidata.org/entity/Q171892'), false);
  assert.equal(isLocal(CANON), true);
  assert.equal(uuidOf(CANON), U);
  assert.equal(explorerUrl('smell', CANON), `https://explorer.odeuropa.eu/smells/${U}`);
  assert.equal(explorerUrl('source', `http://data.odeuropa.eu/source/${U}`), null);
});
