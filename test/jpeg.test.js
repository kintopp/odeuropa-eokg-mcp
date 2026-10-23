import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jpegDimensions } from '../src/lib/jpeg.js';
import { makeJpeg } from './helpers.js';

test('reads width and height from the SOF marker after an APP0 segment', () => {
  assert.deepEqual(jpegDimensions(makeJpeg(650, 568)), { width: 650, height: 568 });
  assert.deepEqual(jpegDimensions(makeJpeg(2000, 2326)), { width: 2000, height: 2326 });
});

test('returns null for a PNG header, truncated input and non-buffers', () => {
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
  assert.equal(jpegDimensions(png), null);
  assert.equal(jpegDimensions(makeJpeg(650, 568).subarray(0, 12)), null);
  assert.equal(jpegDimensions('nope'), null);
});
