import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../src/data/iconclass.json' with { type: 'json' };

test('sidecar has the pinned commit and expected counts', () => {
  assert.equal(data.commit, 'aa586b1e74864c8befbf614c21bf0ffa6e8b4608');
  assert.equal(Object.keys(data['olfactory-objects']).length, 181);
  assert.equal(Object.keys(data['fragrant-spaces']).length, 71);
});

test('known mappings', () => {
  assert.deepEqual(data['olfactory-objects']['138'], ['25G41(...)']);
  assert.deepEqual(data['fragrant-spaces']['27'], ['41A6']);
});

test('no non-code values survive', () => {
  for (const scheme of ['olfactory-objects', 'fragrant-spaces']) {
    for (const codes of Object.values(data[scheme])) {
      for (const c of codes) assert.ok(!/[X?\s]/.test(c), c);
    }
  }
});
