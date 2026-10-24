import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { outputSchema } from '../src/tools/get_source.js';
import { EXCERPT_INJECTION_BOUNDARY } from '../src/config.js';
import { startStubServer, bindings } from './stub-backend.js';
import { withClient, assertWireValid, LIVE } from './helpers.js';
import { FRAGMENT_ROWS, MANUAL, IMAGE_SOURCE, uri } from './source-fixtures.js';

const KG = 'http://data.odeuropa.eu/';
const TEXT_SOURCE = `${KG}source/638ff424-2531-5bc8-959e-9951e2c42697`;
const TYPE_TEXT = 'http://erlangen-crm.org/current/E33_Linguistic_Object';
const TYPE_IMAGE = 'http://erlangen-crm.org/current/E36_Visual_Item';
const en = (value) => ({ type: 'literal', value, 'xml:lang': 'en' });

const textMeta = bindings([
  { type: uri(TYPE_TEXT), title: en('The Art of Perfumery'), url: 'https://www.gutenberg.org/ebooks/16378',
    lang: 'en', date: '1857', begin: '1857', author: 'G. W. Septimus Piesse', place: 'London' },
  { type: uri(TYPE_TEXT), title: 'The Art of Perfumery', url: 'https://www.gutenberg.org/ebooks/16378',
    lang: 'en', date: '1857', begin: '1857', author: 'G. W. Septimus Piesse', place: 'London' },
]);
const imageMeta = bindings([
  { type: uri(TYPE_IMAGE), title: 'Still life with fruit', artist: 'Pieter van den Bosch', date: '1650/55XX',
    image: 'https://images.rkd.nl/rkd/thumb/650x650/e90fb725-7275-db43-a805-c109d9b4f9c3.jpg' },
  { type: uri(TYPE_IMAGE), title: 'Still life with fruit', artist: 'Pieter van den Bosch', date: '1650/55XX',
    image: 'https://data.odeuropa.eu/image/e90fb725-7275-db43-a805-c109d9b4f9c3.jpg' },
]);
const count = (n) => bindings([{ n: { type: 'literal', value: String(n), datatype: 'http://www.w3.org/2001/XMLSchema#integer' } }]);
const page = bindings([
  { smell: uri(`${KG}smell/a1`), excerpt: 'Lavender water is sold cheap. '.repeat(30), concepts: 'Lavender|Rose' },
  { smell: uri(`${KG}smell/a2`), concepts: '' },
]);

function routes(meta, counter = { frag: 0 }, fragRows = FRAGMENT_ROWS) {
  return {
    source_meta: () => ({ body: meta }),
    source_smell_count: () => ({ body: count(609) }),
    source_smell_page: () => ({ body: page }),
    image_fragments: () => { counter.frag++; return { body: bindings(fragRows) }; },
  };
}

async function call(stub, args) {
  return withClient('get-source', (c) => c.callTool({ name: 'eokg_get_source', arguments: args }),
    { env: { EOKG_SPARQL_ENDPOINT: stub.url } });
}

let stub;
afterEach(async () => { await stub?.close(); stub = null; });

test('text source: metadata, paging, no detected_objects, image_fragments never queried', async () => {
  const counter = { frag: 0 };
  stub = await startStubServer(routes(textMeta, counter));
  const res = await call(stub, { id: TEXT_SOURCE, limit: 20 });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.type, 'text');
  assert.equal(s.title, 'The Art of Perfumery');
  assert.equal(s.year, 1857);
  assert.equal(s.author, 'G. W. Septimus Piesse');
  assert.equal(s.place_created, 'London');
  assert.equal(s.smell_count, 609);
  assert.equal(s.has_more, true);
  assert.equal(s.detected_objects, undefined);
  assert.equal(counter.frag, 0);
  assert.deepEqual(s.smells[0].concepts, ['Lavender', 'Rose']);
  assert.ok(s.smells[0].excerpt.length <= 305);
  assert.deepEqual(s.smells[1], { id: `${KG}smell/a2`, concepts: [] });
  const text = res.content[0].text;
  assert.ok(text.includes('609 smells (showing 1–2)'));
  assert.ok(text.includes('a1 [Lavender, Rose] «'));
  assert.ok(text.includes(EXCERPT_INJECTION_BOUNDARY));
  assert.ok(text.indexOf(EXCERPT_INJECTION_BOUNDARY) < text.indexOf('a1 ['));
});

test('has_more is false on the last page', async () => {
  stub = await startStubServer(routes(textMeta));
  const res = await call(stub, { id: TEXT_SOURCE, limit: 100, offset: 600 });
  assert.equal(res.structuredContent.has_more, false);
});

test('image source: detected objects by score, twin dropped, origin mapped, image urls split', async () => {
  const rows = [
    ...FRAGMENT_ROWS,
    { ...FRAGMENT_ROWS[0], body: uri('http://www.wikidata.org/entity/Q13191') },
    { ...FRAGMENT_ROWS[1], score: '1', prov: uri(MANUAL) },
    { ...FRAGMENT_ROWS[2], score: '0.5', prov: undefined },
  ].map((r) => Object.fromEntries(Object.entries(r).filter(([, x]) => x !== undefined)));
  stub = await startStubServer(routes(imageMeta, { frag: 0 }, rows));
  const res = await call(stub, { id: IMAGE_SOURCE });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.type, 'image');
  assert.equal(s.image_url, 'https://data.odeuropa.eu/image/e90fb725-7275-db43-a805-c109d9b4f9c3.jpg');
  assert.ok(s.original_image_url.startsWith('https://images.rkd.nl/'));
  assert.equal(s.detected_objects.length, 8);
  assert.ok(!JSON.stringify(s).includes('wikidata'));
  assert.equal(s.detected_objects.find((o) => o.score === 1).origin, 'manual');
  assert.equal(s.detected_objects.find((o) => o.score === 0.5).origin, 'unknown');
  assert.equal(s.detected_objects.find((o) => o.label === 'Lemon' && o.score < 1).origin, 'detector');
  assert.deepEqual(s.detected_objects.find((o) => o.label === 'Lemon').box_px, { x: 313, y: 445, w: 88, h: 56 });
  assert.ok(res.content[0].text.includes('Detected objects: Lemon 0.949'));
});

const SMELL_UUID = '096b7995-234f-5a7a-bd30-4dc4add02486';

test('unknown source id is an error result', async () => {
  stub = await startStubServer({ ...routes(bindings([])), smell_source: () => ({ body: bindings([]) }) });
  const res = await call(stub, { id: TEXT_SOURCE });
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('No source found'));
  const labels = stub.router.calls.map((c) => c.label);
  assert.ok(labels.indexOf('source_meta') >= 0 && labels.indexOf('source_meta') < labels.indexOf('smell_source'));
});

test('a smell id is followed to its source, with a warning', async () => {
  const meta = (q) => ({ body: q.includes(`<${TEXT_SOURCE}>`) ? textMeta : bindings([]) });
  stub = await startStubServer({
    ...routes(textMeta), source_meta: meta,
    smell_source: () => ({ body: bindings([{ source: uri(TEXT_SOURCE) }]) }),
  });
  const res = await call(stub, { id: SMELL_UUID });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.id, TEXT_SOURCE);
  assert.equal(s.title, 'The Art of Perfumery');
  const w = `${SMELL_UUID} is a smell id; showing its source 638ff424-2531-5bc8-959e-9951e2c42697.`;
  assert.ok(s.warnings.includes(w));
  assert.ok(res.content[0].text.includes(w));
  assert.ok(stub.router.calls.find((c) => c.label === 'smell_source').query.includes(`<${KG}smell/${SMELL_UUID}>`));
});

test('an offset past the last smell warns', async () => {
  stub = await startStubServer(routes(textMeta));
  const res = await call(stub, { id: TEXT_SOURCE, offset: 700 });
  assert.ok(res.structuredContent.warnings.includes('Offset 700 is past the last smell (609).'));
  assert.ok(res.content[0].text.includes('Offset 700 is past the last smell (609).'));
  const inRange = await call(stub, { id: TEXT_SOURCE, offset: 600 });
  assert.equal(inRange.structuredContent.warnings, undefined);
});

test('a fragment id is rejected before any query', async () => {
  stub = await startStubServer(routes(textMeta));
  const res = await call(stub, { id: `${IMAGE_SOURCE}#xywh=1,2,3,4` });
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('Not a valid source id'));
  assert.equal(stub.router.calls.length, 0);
});

test('live: The Art of Perfumery', { skip: !LIVE }, async () => {
  const res = await withClient('get-source-live', (c) => c.callTool({
    name: 'eokg_get_source', arguments: { id: TEXT_SOURCE, limit: 5 },
  }));
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.ok(s.smell_count >= 600);
  assert.equal(s.title, 'The Art of Perfumery');
});
