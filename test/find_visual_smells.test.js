import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { outputSchema } from '../src/tools/find_visual_smells.js';
import { startStubServer, bindings } from './stub-backend.js';
import { withClient, assertWireValid, LIVE } from './helpers.js';

const KG = 'http://data.odeuropa.eu/';
const ROSE = 'olfactory-objects/138';
const en = (value) => ({ type: 'literal', value, 'xml:lang': 'en' });
const uri = (value) => ({ type: 'uri', value });
const sid = (n) => `${KG}source/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, over = {}) => ({
  source: uri(sid(n)), title: en(`Work ${n}`), image: `https://data.odeuropa.eu/image/img-${n}.jpg`,
  date: '1618', artist: 'Pieter Lastman', best: '1', boxes: '21', ...over,
});
const routes = (rows, total = 4013, hidden = 0) => ({
  visual_count: () => ({ body: bindings([{ n: String(total), hidden: String(hidden) }]) }),
  visual_page: () => ({ body: bindings(rows) }),
  concept_label: () => ({ body: bindings([{ l: en('Rose') }]) }),
});

let stub;
afterEach(async () => { await stub?.close(); stub = null; });

async function call(args, r = routes([row(1)])) {
  stub = await startStubServer(r);
  return withClient('visual', (c) => c.callTool({ name: 'eokg_find_visual_smells', arguments: { concept: ROSE, ...args } }),
    { env: { EOKG_SPARQL_ENDPOINT: stub.url } });
}
const queryOf = (label) => stub.router.calls.find((c) => c.label === label).query;

test('the description tells the model hand-drawn boxes rank first', async () => {
  await withClient('visual', async (c) => {
    const { tools } = await c.listTools();
    const t = tools.find((x) => x.name === 'eokg_find_visual_smells');
    assert.ok(t.description.includes('hand-drawn boxes (score 1) come first'));
    assert.ok(t.description.includes('Images whose boxes all score below min_score (default 0.7) are hidden'));
  });
});

// Failure modes: the cut-off is missing from the count or the page query (total and page disagree);
// a box-less image is dropped; boxes/best_score still count boxes below the cut-off; total still includes
// hidden images or hidden_below_min_score is missing; the default is still 0.5; the filter sits after LIMIT.
test('default cut-off 0.7 filters the ranked images and their box count', async () => {
  await call({});
  assert.ok(queryOf('visual_count').includes('?best < 0.7'));
  const q = queryOf('visual_page');
  assert.ok(q.includes('BIND(IF(?score >= 0.7, ?f, ?unset) AS ?kf)'));
  assert.ok(q.includes('HAVING(!BOUND(?best) || ?best >= 0.7)'));
  const g = q.indexOf('GROUP BY ?source');
  const h = q.indexOf('HAVING(');
  const o = q.indexOf('ORDER BY');
  assert.ok(g >= 0 && h > g && o > h, 'HAVING must sit between GROUP BY and ORDER BY, before LIMIT');
});

test('min_score 0.9 is passed through', async () => {
  await call({ min_score: 0.9 });
  assert.ok(queryOf('visual_count').includes('?best < 0.9'));
  assert.ok(queryOf('visual_page').includes('?best >= 0.9'));
  assert.ok(queryOf('visual_page').includes('?score >= 0.9'));
});

test('hidden images leave total and are reported', async () => {
  const res = await call({}, routes([row(1)], 4013, 529));
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.total, 3484);
  assert.equal(s.hidden_below_min_score, 529);
  assert.equal(s.min_score, 0.7);
  assert.ok(res.content[0].text.includes('529 more images have only boxes scoring below 0.7; pass min_score 0 to include them.'));
});

test('everything hidden: zero total, specific warning', async () => {
  const res = await call({}, routes([], 300, 300));
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.total, 0);
  assert.ok(s.warnings.some((w) => w.includes('All 300 linked images have only boxes scoring below 0.7')));
});

test('min_score out of range is rejected', async () => {
  const res = await call({ min_score: 1.5 });
  assert.equal(res.isError, true);
});

test('page shaping, text and has_more from the extra row', async () => {
  const res = await call({ limit: 2 }, routes([row(1), row(2), row(3)]));
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.total, 4013);
  assert.equal(s.has_more, true);
  assert.equal(s.results.length, 2);
  assert.equal(s.concept.label, 'Rose');
  assert.deepEqual(s.results[0], {
    id: sid(1), title: 'Work 1', artist: 'Pieter Lastman', date: '1618',
    image_url: 'https://data.odeuropa.eu/image/img-1.jpg', best_score: 1, boxes: 21,
  });
  const text = res.content[0].text;
  assert.ok(text.includes('4,013 image sources represent Rose; showing 1–2 (best detection first):'), text);
  assert.ok(text.includes('1. "Work 1", Pieter Lastman (1618) — best 1.00, 21 boxes — id 00000000-0000-4000-8000-000000000001'));
});

test('no more rows: has_more false; offset shifts numbering', async () => {
  const res = await call({ limit: 2, offset: 4 }, routes([row(1)]));
  assert.equal(res.structuredContent.has_more, false);
  assert.ok(res.content[0].text.includes('showing 5–5'));
  assert.ok(queryOf('visual_page').endsWith('LIMIT 3 OFFSET 4'));
});

test('best_score is null without boxes and the work is flagged catalogued only', async () => {
  const bare = row(1, { boxes: '0' });
  delete bare.best;
  const res = await call({}, routes([bare]));
  assert.equal(res.structuredContent.results[0].best_score, null);
  assert.equal(res.structuredContent.results[0].boxes, 0);
  assert.ok(res.content[0].text.includes('catalogued only'));
});

test('long artist notes are truncated', async () => {
  const res = await call({}, routes([row(1, { artist: 'x'.repeat(500) })]));
  assert.ok(res.structuredContent.results[0].artist.length <= 125);
});

test('date and image-host filters appear in both the count and page queries', async () => {
  await call({ year_from: 1600, year_to: 1700 });
  for (const label of ['visual_count', 'visual_page']) {
    const q = queryOf(label);
    assert.ok(q.includes('?vb >= "1600"^^xsd:gYear && ?vb <= "1700"^^xsd:gYear'), label);
    assert.ok(q.includes('STRSTARTS(STR(?img), "https://data.odeuropa.eu/image/")'), label);
    assert.ok(q.includes('FROM onto:explicit'), label);
  }
});

test('only year_from emits only the lower bound; no years emits no date filter', async () => {
  await call({ year_from: 1050 });
  assert.ok(queryOf('visual_count').includes('?vb >= "1050"^^xsd:gYear'));
  assert.ok(!queryOf('visual_count').includes('?vb <='));
  await stub.close();
  await call({});
  assert.ok(!queryOf('visual_count').includes('?vb'));
});

test('year_from after year_to and a fragrant-spaces concept fail with zero queries', async () => {
  let res = await call({ year_from: 1700, year_to: 1600 });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /year_from is after year_to/);
  assert.equal(stub.router.calls.length, 0);
  await stub.close();
  res = await call({ concept: 'fragrant-spaces/27' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Only olfactory-objects concepts have images/);
  assert.equal(stub.router.calls.length, 0);
});

test('live: Rose images', { skip: !LIVE }, async () => {
  const res = await withClient('visual-live', (c) => c.callTool({ name: 'eokg_find_visual_smells', arguments: { concept: ROSE } }));
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.min_score, 0.7);
  assert.ok(s.hidden_below_min_score > 0);
  assert.ok(s.total + s.hidden_below_min_score > 4000);
  assert.ok(s.results[0].image_url.startsWith('https://data.odeuropa.eu/image/'));
});
