import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSnippet } from '../src/lib/snippet.js';
import { SNIPPET_CHARS } from '../src/config.js';

const filler = (n) => 'x '.repeat(n / 2);

test('a mid-text match is centred, highlighted and cut on both sides', () => {
  const text = `${filler(600)}the scent of lavender fills${filler(600)}`;
  const s = makeSnippet(text, 'lavender');
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok(s.includes('<em>lavender</em>'));
  assert.ok(s.length <= SNIPPET_CHARS + 2 + '<em></em>'.length);
  const at = s.indexOf('<em>');
  assert.ok(Math.abs(at - s.length / 2) < 40);
});

test('a quoted phrase highlights each word', () => {
  const s = makeSnippet('a smell of rotten eggs here', '"rotten eggs"');
  assert.equal(s, 'a smell of <em>rotten</em> <em>eggs</em> here');
});

test('a trailing wildcard highlights the whole word', () => {
  assert.equal(makeSnippet("l'odeur de lavande", 'lavand*'), "l'odeur de <em>lavande</em>");
});

test('operators are not terms; no match gives a prefix', () => {
  const text = 'z'.repeat(500);
  const s = makeSnippet(text, 'rose AND NOT garden');
  assert.equal(s, `${'z'.repeat(SNIPPET_CHARS)}…`);
});

test('regex-special terms do not throw', () => {
  assert.equal(makeSnippet('the c++ code', 'c++'), 'the <em>c++</em> code');
  assert.doesNotThrow(() => makeSnippet('abc', '[(a'));
});
