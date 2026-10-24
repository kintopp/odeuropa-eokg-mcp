import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparqlString, scopedLuceneQuery, luceneHints } from '../src/sparql/lucene.js';
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

test('a non-reserved colon is escaped, quoted and URL colons are not', () => {
  assert.equal(scopedLuceneQuery('smell: offensive'), 'source_value:(smell\\: offensive)');
  assert.equal(scopedLuceneQuery('"smell: x" AND note: y'), 'source_value:("smell: x" AND note\\: y)');
  assert.equal(scopedLuceneQuery('http://x/y'), 'source_value:(http://x\\/y)');
});

test('a slash outside quotes is escaped, except in ://', () => {
  assert.equal(scopedLuceneQuery('and/or perfume'), 'source_value:(and\\/or perfume)');
  assert.equal(scopedLuceneQuery('"and/or" perfume'), 'source_value:("and/or" perfume)');
});

test('escapes survive the SPARQL literal doubling', () => {
  const q = searchCountQuery(scopedLuceneQuery('a: b'));
  assert.ok(q.includes('source_value:(a\\\\: b)'));
});

test('each reserved field name is rejected in any case', () => {
  const names = ['source_value', 'source_label', 'title', 'excerpt', 'text', 'label', 'lang', 'language',
    'date', 'year', 'dataset', 'author', 'artist', 'source', 'Title', 'DATE'];
  for (const n of names) {
    assert.throws(() => scopedLuceneQuery(`${n}:rose`), (e) => e instanceof ToolError && /Field prefixes/.test(e.message), n);
  }
});

test('a query with only negated terms is rejected', () => {
  for (const t of ['NOT tobacco', '-tobacco', '!tobacco', 'NOT "rose water"', '(NOT a) AND NOT b']) {
    assert.throws(
      () => scopedLuceneQuery(t),
      (e) => e instanceof ToolError && /no positive term/.test(e.message) && /smell NOT tobacco/.test(e.suggestion ?? ''),
      t,
    );
  }
});

test('negation next to a positive term is accepted', () => {
  for (const t of ['tobacco NOT pipe', '+tobacco -pipe', 'NOT tobacco pipe']) {
    assert.doesNotThrow(() => scopedLuceneQuery(t), t);
  }
});

test('luceneHints flags lower-case and/or and hyphenated words', () => {
  const a = luceneHints('tobacco and smoke');
  assert.equal(a.length, 1);
  assert.match(a[0], /Lower-case "and"\/"or" are searched as words/);
  assert.match(a[0], /Write AND\/OR in capitals/);
  const b = luceneHints('eau-de-cologne');
  assert.equal(b.length, 1);
  assert.match(b[0], /eau-de-cologne matches eau OR de OR cologne/);
  assert.match(b[0], /Quote them: "eau de cologne"/);
});

test('luceneHints is quiet for operators and quoted text', () => {
  for (const t of ['tobacco AND smoke', '"tobacco and smoke"', '"eau-de-cologne"', '-pipe tobacco']) {
    assert.deepEqual(luceneHints(t), [], t);
  }
});
