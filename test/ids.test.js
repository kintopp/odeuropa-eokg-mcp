import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseId, isLocal, uuidOf, explorerUrl, schemeOf, vocabOf } from '../src/lib/ids.js';
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

test('concept ids: URI, https, short form, nested path', () => {
  const C = 'http://data.odeuropa.eu/vocabulary/olfactory-objects/138';
  for (const input of [C, 'https://data.odeuropa.eu/vocabulary/olfactory-objects/138/', 'olfactory-objects/138', ` ${C} `]) {
    assert.equal(parseId('concept', input), C, input);
  }
  const T = 'http://data.odeuropa.eu/vocabulary/expert-taxonomy/flower/other_flowers/rose';
  assert.equal(parseId('concept', 'expert-taxonomy/flower/other_flowers/rose'), T);
  assert.equal(schemeOf(T), 'expert-taxonomy');
  assert.equal(vocabOf(T).name, 'expert-taxonomy');
  assert.equal(vocabOf('http://data.odeuropa.eu/vocabulary/nope/1'), null);
});

test('concept ids: Explorer smell-sources and fragrant-spaces links', () => {
  const V = 'http://data.odeuropa.eu/vocabulary/';
  assert.equal(parseId('concept', 'https://explorer.odeuropa.eu/smell-sources/227'), `${V}olfactory-objects/227`);
  assert.equal(parseId('concept', 'http://explorer.odeuropa.eu/fragrant-spaces/32/'), `${V}fragrant-spaces/32`);
  for (const bad of [
    'https://explorer.odeuropa.eu/smell-sources/abc', 'https://explorer.odeuropa.eu/smell-sources/',
    `https://explorer.odeuropa.eu/smells/${U}`, 'https://explorer.odeuropa.eu/smell-sources/12/../3',
  ]) assert.throws(() => parseId('concept', bad), ToolError, bad);
});

test('the concept rejection names concept id forms, not a uuid', () => {
  assert.throws(
    () => parseId('concept', 'nope'),
    (e) => !e.suggestion.includes('<uuid>') && /olfactory-objects\/138/.test(e.suggestion) && /Explorer smell-sources/.test(e.suggestion),
  );
  assert.throws(() => parseId('smell', 'nope'), (e) => e.suggestion.includes('<uuid>'));
});

test('concept ids: traversal, injection and whitespace rejected', () => {
  for (const bad of [
    'http://data.odeuropa.eu/vocabulary/x/../y', 'x/../y', 'x/./y', 'olfactory-objects/138>',
    'olfactory-objects/13 8', 'http://data.odeuropa.eu/vocabulary/olfactory-objects/138> } #', '', 'olfactory-objects',
  ]) assert.throws(() => parseId('concept', bad), ToolError, bad);
});

test('concept explorer urls', () => {
  const base = 'http://data.odeuropa.eu/vocabulary/';
  assert.equal(explorerUrl('concept', `${base}olfactory-objects/138`), 'https://explorer.odeuropa.eu/smell-sources/138');
  assert.equal(explorerUrl('concept', `${base}fragrant-spaces/27`), 'https://explorer.odeuropa.eu/fragrant-spaces/27');
  assert.equal(explorerUrl('concept', `${base}expert-taxonomy/flower/rose`), null);
});
