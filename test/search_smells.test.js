import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { outputSchema } from '../src/tools/search_smells.js';
import { EXCERPT_INJECTION_BOUNDARY } from '../src/config.js';
import { startStubServer, bindings } from './stub-backend.js';
import { withClient, assertWireValid, LIVE } from './helpers.js';

const KG = 'http://data.odeuropa.eu/';
const uri = (value) => ({ type: 'uri', value });
const en = (value) => ({ type: 'literal', value, 'xml:lang': 'en' });
const sid = (n) => `${KG}smell/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (n) => Array.from({ length: n }, (_, i) => sid(i + 1));

const enrichRoute = (query) => {
  const found = [...query.matchAll(/<(http:\/\/data\.odeuropa\.eu\/smell\/[^>]+)>/g)].map((m) => m[1]);
  return {
    body: bindings(found.map((id) => ({
      id: uri(id), graph: uri(`${KG}gallica`), source: uri(`${KG}source/s-${id.slice(-4)}`),
      type: uri('http://erlangen-crm.org/current/E33_Linguistic_Object'), title: en('Le Jardin'),
      lang: 'fr', date: '1850', text: 'Le parfum de la lavande emplit le jardin.', cl: en('Lavender'),
    }))),
  };
};

const windowRows = (n) => ({ body: bindings(ids(n).map((id, i) => ({ id: uri(id), score: String(1 - i / 100) }))) });
const countRoute = (total) => () => ({ body: bindings([{ total: String(total) }]) });

async function call(stub, args) {
  return withClient('search', (c) => c.callTool({ name: 'eokg_search_smells', arguments: args }),
    { env: { EOKG_SPARQL_ENDPOINT: stub.url } });
}
const labels = (stub) => stub.router.calls.map((c) => c.label);

let stub;
afterEach(async () => { await stub?.close(); stub = null; });

test('unfiltered: Lucene paging and snippets, exact total, no window or count query', async () => {
  const rows = ids(3).flatMap((id, i) => [{
    id: uri(id), score: String(1 - i / 10), total: '12120', field: 'source_value',
    snip: 'scent of <em>lavender</em> here',
  }]);
  stub = await startStubServer({ search_page: () => ({ body: bindings(rows) }), search_enrich: enrichRoute });
  const res = await call(stub, { text: 'lavender', limit: 2 });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.total_hits, 12120);
  assert.equal(s.filtered, false);
  assert.equal(s.has_more, true);
  assert.equal(s.results.length, 2);
  assert.deepEqual(s.results[0].snippets, ['scent of <em>lavender</em> here']);
  assert.deepEqual(s.results[0].concepts, ['Lavender']);
  assert.equal(s.query, 'source_value:(lavender)');
  assert.ok(res.content[0].text.includes('12,120 full-text hits for source_value:(lavender)'));
  assert.ok(res.content[0].text.includes(EXCERPT_INJECTION_BOUNDARY));
  assert.deepEqual(labels(stub), ['search_page', 'search_enrich']);
});

test('unfiltered: 0 hits gives total 0 and the no-hits warning', async () => {
  stub = await startStubServer({ search_page: () => ({ body: bindings([]) }) });
  const res = await call(stub, { text: 'zzzz' });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.total_hits, 0);
  assert.equal(s.has_more, false);
  assert.ok(s.warnings[0].startsWith('No hits.'));
  assert.deepEqual(labels(stub), ['search_page']);
});

test('unfiltered: empty page at offset > 0 takes the total from a count query', async () => {
  stub = await startStubServer({ search_page: () => ({ body: bindings([]) }), search_count: countRoute(12120) });
  const res = await call(stub, { text: 'lavender', offset: 20 });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.total_hits, 12120);
  assert.equal(s.warnings, undefined);
  assert.deepEqual(labels(stub), ['search_page', 'search_count']);
});

test('unfiltered: a title-only hit falls back to a code-side snippet', async () => {
  const rows = [{ id: uri(sid(1)), score: '0.5', total: '3' }];
  stub = await startStubServer({ search_page: () => ({ body: bindings(rows) }), search_enrich: enrichRoute });
  const res = await call(stub, { text: 'lavande', in: 'title' });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.match(s.results[0].snippets[0], /<em>lavande<\/em>/);
});

test('filtered, enough matches in the first window: one window, non-exhaustive warning', async () => {
  stub = await startStubServer({
    search_window: () => windowRows(4), search_count: countRoute(12120), search_enrich: enrichRoute,
  });
  const res = await call(stub, { text: 'lavande', language: 'fr', limit: 3 });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(labels(stub).filter((l) => l === 'search_window').length, 1);
  assert.ok(stub.router.calls.find((c) => c.label === 'search_window').query.includes('luc:limit "1000"'));
  assert.equal(s.total_hits, 12120);
  assert.equal(s.scanned, 1000);
  assert.equal(s.exhaustive, false);
  assert.equal(s.has_more, true);
  assert.equal(s.results.length, 3);
  assert.match(s.warnings[0], /Filters were applied to the 1,000 most relevant of 12,120 full-text hits/);
  assert.match(s.results[0].snippets[0], /<em>lavande<\/em>/);
});

test('filtered and sparse: widens through 1000, 5000 and 20000', async () => {
  stub = await startStubServer({
    search_window: (q) => (q.includes('luc:limit "20000"') ? windowRows(5) : windowRows(1)),
    search_count: countRoute(90000), search_enrich: enrichRoute,
  });
  const res = await call(stub, { text: 'rose', language: 'it', limit: 3 });
  const s = assertWireValid(outputSchema, res.structuredContent);
  const windows = stub.router.calls.filter((c) => c.label === 'search_window').map((c) => c.query);
  assert.equal(windows.length, 3);
  assert.ok(windows[0].includes('luc:limit "1000"'));
  assert.ok(windows[1].includes('luc:limit "5000"'));
  assert.ok(windows[2].includes('luc:limit "20000"'));
  assert.equal(s.scanned, 20000);
  assert.equal(s.exhaustive, false);
});

test('filtered with fewer total hits than the first window: exhaustive, no warning', async () => {
  stub = await startStubServer({
    search_window: () => windowRows(2), search_count: countRoute(300), search_enrich: enrichRoute,
  });
  const res = await call(stub, { text: 'rose', language: 'fr' });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(labels(stub).filter((l) => l === 'search_window').length, 1);
  assert.equal(s.scanned, 300);
  assert.equal(s.exhaustive, true);
  assert.equal(s.has_more, false);
  assert.equal(s.warnings, undefined);
});

test('window queries never ask Lucene for snippets', async () => {
  stub = await startStubServer({
    search_window: () => windowRows(0), search_count: countRoute(90000), search_enrich: enrichRoute,
  });
  await call(stub, { text: 'rose', language: 'it' });
  const windows = stub.router.calls.filter((c) => c.label === 'search_window');
  assert.equal(windows.length, 3);
  for (const w of windows) {
    assert.ok(!w.query.includes('luc:snippets'));
    assert.ok(w.query.includes('SELECT DISTINCT ?id ?score'));
  }
});

test('year and dataset filters reach the window query', async () => {
  stub = await startStubServer({
    search_window: () => windowRows(1), search_count: countRoute(50), search_enrich: enrichRoute,
  });
  await call(stub, { text: 'rose', year_from: 1800, year_to: 1850, dataset: 'gallica' });
  const q = stub.router.calls.find((c) => c.label === 'search_window').query;
  assert.ok(q.includes('"1800"^^xsd:gYear') && q.includes('"1850"^^xsd:gYear'));
  assert.ok(q.includes('!BOUND(?b)'));
  assert.ok(q.includes('GRAPH <http://data.odeuropa.eu/gallica>'));
});

test('filtered offset + limit beyond 1000 is an error with no backend calls', async () => {
  stub = await startStubServer({});
  const res = await call(stub, { text: 'rose', language: 'fr', offset: 995, limit: 10 });
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
  assert.equal(stub.router.calls.length, 0);
});

test('a field prefix in text is an error with no backend calls', async () => {
  stub = await startStubServer({});
  const res = await call(stub, { text: 'title:rose' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Field prefixes/);
  assert.equal(stub.router.calls.length, 0);
});

test('year_from after year_to is an error', async () => {
  stub = await startStubServer({});
  const res = await call(stub, { text: 'rose', year_from: 1900, year_to: 1800 });
  assert.equal(res.isError, true);
  assert.equal(stub.router.calls.length, 0);
});

const SRC = '11111111-2222-4333-8444-555555555555';
const customEnrich = (over) => (query) => {
  const found = [...query.matchAll(/<(http:\/\/data\.odeuropa\.eu\/smell\/[^>]+)>/g)].map((m) => m[1]);
  return {
    body: bindings(found.map((id) => ({
      id: uri(id), graph: uri(`${KG}gallica`), source: uri(`${KG}source/${SRC}`),
      type: uri('http://erlangen-crm.org/current/E33_Linguistic_Object'), title: en('Le Jardin'),
      lang: 'fr', date: '1850', text: 'Le parfum de la lavande.', cl: en('Lavender'), ...over,
    }))),
  };
};
const pageRows = (n) => ({ body: bindings(ids(n).map((id, i) => ({ id: uri(id), score: String(1 - i / 10), total: String(n) }))) });

// A Lucene page over `n` hits that honours luc:limit and luc:offset.
const pagedSearch = (n) => (query) => {
  const limit = Number(/luc:limit "(\d+)"/.exec(query)[1]);
  const offset = Number(/luc:offset "(\d+)"/.exec(query)[1]);
  return {
    body: bindings(ids(n).slice(offset, offset + limit).map((id, i) => ({
      id: uri(id), score: String(1 - (offset + i) / 1000), total: String(n),
    }))),
  };
};
const titledEnrich = (titleOf) => (query) => {
  const found = [...query.matchAll(/<(http:\/\/data\.odeuropa\.eu\/smell\/[^>]+)>/g)].map((m) => m[1]);
  return {
    body: bindings(found.map((id) => ({
      id: uri(id), graph: uri(`${KG}gallica`), source: uri(`${KG}source/${SRC}`),
      type: uri('http://erlangen-crm.org/current/E33_Linguistic_Object'), title: en(titleOf(id)),
      lang: 'fr', date: '1850', text: 'Le parfum de la lavande.', cl: en('Lavender'),
    }))),
  };
};

// Follows next_offset until has_more is false; returns every page.
async function allPages(args) {
  const pages = [];
  let offset = args.offset ?? 0;
  for (let guard = 0; guard < 20; guard++) {
    const res = await call(stub, { ...args, offset });
    const s = assertWireValid(outputSchema, res.structuredContent);
    pages.push({ s, text: res.content[0].text });
    if (!s.has_more) return pages;
    assert.equal(typeof s.next_offset, 'number', 'has_more without next_offset');
    assert.ok(s.next_offset > offset, `next_offset ${s.next_offset} does not advance past ${offset}`);
    offset = s.next_offset;
  }
  throw new Error('pagination did not terminate');
}

test('a page trimmed to the output budget continues at next_offset with nothing skipped or repeated', async () => {
  stub = await startStubServer({ search_page: pagedSearch(50), search_enrich: titledEnrich(() => 'T'.repeat(2000)) });
  const pages = await allPages({ text: 'lavande', limit: 50 });
  const first = pages[0].s;
  assert.ok(first.results.length < 50, 'the fixture must overflow one page');
  assert.equal(first.has_more, true);
  assert.equal(first.next_offset, first.results.length);
  assert.ok(pages[0].text.includes(`offset ${first.next_offset}`), 'the text channel names the continuation');
  assert.deepEqual(pages.flatMap((p) => p.s.results.map((r) => r.id)), ids(50));
  for (const { s } of pages) assert.ok(JSON.stringify(s).length <= 60_000, 'over the per-channel budget');
  assert.equal(pages.at(-1).s.next_offset, undefined);
});

test('a hit too large for the budget on its own is returned shortened, so paging advances', async () => {
  const huge = ids(1)[0];
  stub = await startStubServer({
    search_page: pagedSearch(2),
    search_enrich: titledEnrich((id) => (id === huge ? 'H'.repeat(200_000) : 'Le Jardin')),
  });
  const pages = await allPages({ text: 'lavande', limit: 2 });
  assert.deepEqual(pages.flatMap((p) => p.s.results.map((r) => r.id)), ids(2));
  const shortened = pages[0].s.results[0];
  assert.equal(shortened.id, huge);
  assert.ok(shortened.title.length < 200_000);
  assert.ok(JSON.stringify(pages[0].s).length <= 60_000, 'over the per-channel budget');
});

test('the text names the source id next to the smell id', async () => {
  stub = await startStubServer({ search_page: () => pageRows(1), search_enrich: customEnrich({}) });
  const res = await call(stub, { text: 'lavande' });
  assert.match(res.content[0].text, new RegExp(`id: 00000000-0000-4000-8000-000000000001 · source: ${SRC}\\b`));
  assert.ok(!res.content[0].text.includes('image source'));
});

test('an image hit names its source for the image tools', async () => {
  stub = await startStubServer({
    search_page: () => pageRows(1),
    search_enrich: customEnrich({ type: uri('http://erlangen-crm.org/current/E36_Visual_Item') }),
  });
  const res = await call(stub, { text: 'lavande' });
  assert.ok(res.content[0].text.includes(`image source: ${SRC} (for eokg_view_image / eokg_inspect_image)`));
});

test('missing and EDTF dates read as undated, the raw date stays in structuredContent', async () => {
  for (const [date, raw] of [[undefined, undefined], ['XXXX-09-08', 'XXXX-09-08']]) {
    stub = await startStubServer({ search_page: () => pageRows(1), search_enrich: customEnrich({ date }) });
    const res = await call(stub, { text: 'lavande' });
    assert.match(res.content[0].text, /\(undated, fr, gallica\)/);
    assert.equal(res.structuredContent.results[0].date, raw);
    await stub.close();
  }
  stub = null;
});

test('the undated warning appears only with a year filter', async () => {
  stub = await startStubServer({
    search_page: () => pageRows(1), search_window: () => windowRows(1), search_count: countRoute(1),
    search_enrich: customEnrich({ date: 'XXXX-09-08' }),
  });
  const plain = await call(stub, { text: 'lavande' });
  assert.ok(!plain.content[0].text.includes('undated; year filters keep undated sources'));
  const filtered = await call(stub, { text: 'lavande', year_from: 1800 });
  assert.match(filtered.content[0].text, /1 of the 1 results on this page are undated; year filters keep undated sources\. Check each date/);
  assert.match(filtered.structuredContent.warnings.join(' '), /1 of the 1 results/);
});

test('Lucene hints reach warnings', async () => {
  stub = await startStubServer({ search_page: () => pageRows(1), search_enrich: customEnrich({}) });
  const res = await call(stub, { text: 'tobacco and smoke' });
  assert.match(res.structuredContent.warnings.join(' '), /Write AND\/OR in capitals/);
});

test('the parameter descriptions carry the query-writing rules', async () => {
  const tools = await withClient('search', (c) => c.listTools(), { env: {} });
  const t = tools.tools.find((x) => x.name === 'eokg_search_smells');
  const p = t.inputSchema.properties;
  assert.match(p.text.description, /Words without an operator are OR-ed/);
  assert.match(p.text.description, /write AND\/OR\/NOT in capitals/);
  assert.match(p.text.description, /Accents and umlauts must match exactly/);
  assert.match(p.year_from.description, /1616\/1678 counts by its first year/);
  assert.match(p.year_to.description, /Undated sources are kept/);
});

test('a Lucene parse error surfaces as a correctable tool error', async () => {
  stub = await startStubServer({
    search_page: () => ({ status: 500, body: 'Cannot parse Lucene query [source_value:(rose]: Encountered "<EOF>"' }),
  });
  const res = await call(stub, { text: '(rose' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /could not be parsed/);
});

test('live: lavender unfiltered', { skip: !LIVE }, async () => {
  const res = await withClient('live', (c) => c.callTool({ name: 'eokg_search_smells', arguments: { text: 'lavender' } }));
  const s = assertWireValid(outputSchema, res.structuredContent);
  console.error(`live total_hits(lavender)=${s.total_hits}`);
  assert.ok(s.total_hits > 10000);
  assert.ok(s.results[0].snippets[0].includes('<em>'));
});

test('live: lavande, fr, 1800-1900', { skip: !LIVE }, async () => {
  const t0 = Date.now();
  const res = await withClient('live', (c) => c.callTool({
    name: 'eokg_search_smells', arguments: { text: 'lavande', language: 'fr', year_from: 1800, year_to: 1900 },
  }));
  console.error(`live lavande fr ${Date.now() - t0} ms`);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.ok(s.results.length >= 1);
  assert.ok(s.results.every((r) => r.language === 'fr'));
  assert.ok(s.scanned !== undefined);
});

test('live: sparse rose/it/1600-1800 is non-exhaustive with a warning', { skip: !LIVE }, async () => {
  const t0 = Date.now();
  const res = await withClient('live', (c) => c.callTool({
    name: 'eokg_search_smells', arguments: { text: 'rose', language: 'it', year_from: 1600, year_to: 1800 },
  }));
  const ms = Date.now() - t0;
  console.error(`live rose it sparse ${ms} ms`);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.exhaustive, false);
  assert.ok(s.warnings?.length);
  assert.ok(ms < 10000, `took ${ms} ms`);
});

test('live: perfumery in title', { skip: !LIVE }, async () => {
  const res = await withClient('live', (c) => c.callTool({
    name: 'eokg_search_smells', arguments: { text: 'perfumery', in: 'title' },
  }));
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.match(s.results[0].title, /perfumery/i);
});
