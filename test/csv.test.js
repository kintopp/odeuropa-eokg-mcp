import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/lib/csv.js';

test('plain rows, LF and CRLF, final line with or without newline', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('quoted fields: commas, newlines, escaped quotes', () => {
  assert.deepEqual(parseCsv('"a,b","c\nd","e ""q"""\n'), [['a,b', 'c\nd', 'e "q"']]);
  assert.deepEqual(parseCsv('"x\r\ny",z\r\n'), [['x\r\ny', 'z']]);
});

test('empty fields, empty input and BOM', () => {
  assert.deepEqual(parseCsv('﻿ID,X\n1,\n,\n'), [['ID', 'X'], ['1', ''], ['', '']]);
  assert.deepEqual(parseCsv(''), []);
});
