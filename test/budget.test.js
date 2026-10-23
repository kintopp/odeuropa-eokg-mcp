import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateText, capArrays } from '../src/lib/budget.js';

test('truncateText appends an ellipsis only when cutting', () => {
  assert.equal(truncateText('abc', 3), 'abc');
  assert.equal(truncateText('abcdef', 3), 'abc …');
});

test('capArrays leaves an under-budget object unchanged', () => {
  const o = { a: ['x'], b: [] };
  const out = capArrays(o, ['a', 'b'], 1000);
  assert.deepEqual(out, o);
  assert.ok(!('truncated' in out));
});

test('capArrays trims in order and counts the truncated record', () => {
  const o = { id: 'k', a: Array(50).fill('xxxxxxxxxx'), b: Array(5).fill('yyyyyyyyyy') };
  const budget = 300;
  const out = capArrays(o, ['a', 'b'], budget);
  assert.ok(JSON.stringify(out).length <= budget);
  assert.equal(out.truncated.a, 50);
  assert.ok(out.a.length < 50 && out.a.length > 0);
  assert.equal(o.a.length, 50, 'input not mutated');
});

test('capArrays can trim a field to []', () => {
  const o = { a: Array(10).fill('x'.repeat(100)), b: ['keep'] };
  const out = capArrays(o, ['a'], 120);
  assert.deepEqual(out.a, []);
  assert.deepEqual(out.truncated, { a: 10 });
  assert.ok(JSON.stringify(out).length <= 120);
});
