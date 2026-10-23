import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLabel, labelFromUri, collectByUri, uniqueStrings } from '../src/lib/rdf.js';

const lit = (value, l) => ({ type: 'literal', value, ...(l && { 'xml:lang': l }) });

test('pickLabel prefers en, then untagged, then first', () => {
  assert.equal(pickLabel([lit('a', 'fr'), lit('b'), lit(' c ', 'en')]), 'c');
  assert.equal(pickLabel([lit('a', 'fr'), lit('b')]), 'b');
  assert.equal(pickLabel([lit('a', 'fr'), lit('z', 'de')]), 'a');
  assert.equal(pickLabel([]), undefined);
});

test('labelFromUri', () => {
  assert.equal(labelFromUri('http://data.odeuropa.eu/vocabulary/vdi-hedonic/04n'), '04n');
  assert.equal(labelFromUri('http://data.odeuropa.eu/emotion-type/nostalgia'), 'nostalgia');
  assert.equal(labelFromUri('http://data.odeuropa.eu/attribute/liquid_en'), 'liquid en');
});

test('collectByUri drops twins and keeps order', () => {
  const rows = [
    { v: { value: 'http://www.wikidata.org/entity/Q1' }, l: lit('x') },
    { v: { value: 'https://www.wikidata.org/wiki/Q2' }, l: lit('y') },
    { v: { value: 'http://data.odeuropa.eu/vocabulary/b/2' }, l: lit('B', 'fr') },
    { v: { value: 'http://data.odeuropa.eu/vocabulary/a/1' } },
    { v: { value: 'http://data.odeuropa.eu/vocabulary/b/2' }, l: lit('Bee', 'en') },
  ];
  assert.deepEqual(collectByUri(rows, 'v', 'l'), [
    { id: 'http://data.odeuropa.eu/vocabulary/b/2', label: 'Bee' },
    { id: 'http://data.odeuropa.eu/vocabulary/a/1', label: '1' },
  ]);
});

test('uniqueStrings', () => {
  assert.deepEqual(uniqueStrings(['a', ' a ', '', 'A', undefined, 'b']), ['a', 'A', 'b']);
});
