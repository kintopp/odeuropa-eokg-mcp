import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparqlString, scopedLuceneQuery } from '../src/sparql/lucene.js';
import { searchCountQuery } from '../src/sparql/queries/search.js';
import { ToolError } from '../src/lib/errors.js';

test('sparqlString escapes backslash, quote and control characters', () => {
  assert.equal(sparqlString('a"b\\c'), 'a\\"b\\\\c');
  assert.equal(sparqlString('a\nb\rc\td'), 'a\\nb\\rc\\td');
});

test('a field prefix is rejected, also after + - ! ( and whitespace', () => {
  for (const t of ['title:rose', 'rose AND source_value:x', '(title:rose)', '+title:rose', 'a -title:b']) {
    assert.throws(() => scopedLuceneQuery(t), (e) => e instanceof ToolError && /Field prefixes/.test(e.message), t);
  }
});

test('colons inside quotes or URLs are not field prefixes', () => {
  assert.equal(scopedLuceneQuery('"title: rose"'), 'source_value:("title: rose")');
  assert.equal(scopedLuceneQuery('http://x'), 'source_value:(http://x)');
  assert.equal(scopedLuceneQuery('"see: the garden" AND rose'), 'source_value:("see: the garden" AND rose)');
});

test('scopes to excerpt, title or both', () => {
  const t = 'rose AND (garden OR jardin)';
  assert.equal(scopedLuceneQuery(t, 'excerpt'), `source_value:(${t})`);
  assert.equal(scopedLuceneQuery(t, 'title'), `source_label:(${t})`);
  assert.equal(scopedLuceneQuery(t, 'both'), `source_value:(${t}) || source_label:(${t})`);
  assert.equal(scopedLuceneQuery(t), `source_value:(${t})`);
});

test('empty, over-long and wildcard-only text is rejected', () => {
  for (const t of ['', '   ', 'x'.repeat(501), '*', '?*', ' * ']) {
    assert.throws(() => scopedLuceneQuery(t), ToolError, JSON.stringify(t).slice(0, 20));
  }
});

test('an injection attempt stays inside the SPARQL literal', () => {
  const lq = scopedLuceneQuery('"} } DROP ALL #');
  const q = searchCountQuery(lq);
  assert.ok(q.includes(`luc:query "source_value:(\\"} } DROP ALL #)"`));
});
