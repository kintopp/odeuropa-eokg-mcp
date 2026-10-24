// In-process server with a wrapped fetch, as in inspect_image.test.js: IMAGE_URL_RE has no env override.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.js';
import { outputSchema } from '../src/tools/view_image.js';
import { clearSparqlCache } from '../src/sparql/client.js';
import { clearImageCache } from '../src/image/client.js';
import { installFetchStub, bindings } from './stub-backend.js';
import { assertWireValid } from './helpers.js';
import { FRAGMENT_ROWS, MANUAL, IMAGE_SOURCE, uri } from './source-fixtures.js';

const TYPE_TEXT = 'http://erlangen-crm.org/current/E33_Linguistic_Object';
const TYPE_IMAGE = 'http://erlangen-crm.org/current/E36_Visual_Item';
const IMAGE_URL = 'https://data.odeuropa.eu/image/e90fb725-7275-db43-a805-c109d9b4f9c3.jpg';
const RKD_URL = 'https://images.rkd.nl/rkd/thumb/650x650/e90fb725-7275-db43-a805-c109d9b4f9c3.jpg';

const imageMeta = (...images) => bindings(images.map((image) => ({
  type: uri(TYPE_IMAGE), title: 'Still life with fruit', artist: 'Pieter van den Bosch', date: '1650/55XX', image,
  url: 'https://rkd.nl/explore/images/56354',
})));

let stub;
let imageCalls;
let client;
let fragRows;
let meta;
let smellSource;

beforeEach(async () => {
  clearSparqlCache();
  clearImageCache();
  imageCalls = [];
  fragRows = FRAGMENT_ROWS;
  meta = imageMeta(IMAGE_URL, RKD_URL);
  smellSource = null;
  stub = installFetchStub({
    source_meta: (q) => ({ body: q.includes('source/096b7995-234f-5a7a-bd30-4dc4add02486') ? bindings([]) : meta }),
    smell_source: () => ({ body: bindings(smellSource ? [{ source: uri(smellSource) }] : []) }),
    image_fragments: () => ({ body: bindings(fragRows) }),
  });
  const sparqlFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://data.odeuropa.eu/repositories/')) {
      imageCalls.push(String(url));
      return new Response('x', { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return sparqlFetch(url, init);
  };
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createServer().connect(st);
  client = new Client({ name: 'view-image-test', version: '0.0.0' });
  await client.connect(ct);
});

afterEach(async () => {
  await client?.close();
  stub.restore();
  clearSparqlCache();
  clearImageCache();
});

const view = (args = {}) => client.callTool({ name: 'eokg_view_image', arguments: { id: IMAGE_SOURCE, ...args } });

// Failure modes:
// - the tool downloads the image;
// - low-score boxes leak through;
// - a text source or foreign image host is accepted;
// - the stdio fallback block is missing;
// - _meta.ui.resourceUri is missing.

test('boxes are hidden by default; the objects are still delivered', async () => {
  fragRows = [...FRAGMENT_ROWS, { ...FRAGMENT_ROWS[0], score: '1', prov: uri(MANUAL) }];
  const res = await view();
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  assert.equal(res.structuredContent.show_boxes, false);
  assert.equal(res.structuredContent.objects.length, 7);
  const text = res.content[0].text;
  assert.ok(text.includes('boxes hidden'));
  assert.ok(text.includes('not shown to the user'));
  assert.ok(text.includes('Boxes button'));
  assert.ok(text.includes('only if the user asks'));
  assert.ok(text.includes('Grape ×2, Lemon ×2, Peach ×2, Glass with stem.'));
});

test('show_boxes true is reflected in the structure and the text', async () => {
  const res = await view({ show_boxes: true });
  assert.equal(res.structuredContent.show_boxes, true);
  const text = res.content[0].text;
  assert.ok(text.includes('boxes shown'));
  assert.ok(!text.includes('not shown to the user'));
  assert.ok(text.includes('hide them with the viewer'));
});

test('an image source: wire-valid, filtered at 0.7, links in the text, no image request', async () => {
  fragRows = [...FRAGMENT_ROWS, { ...FRAGMENT_ROWS[0], score: '0.6' }];
  const res = await view();
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.min_score, 0.7);
  assert.equal(s.objects.length, 6);
  assert.ok(s.objects.every((o) => o.score >= 0.7));
  assert.equal(s.hidden_below_min_score, 1);
  assert.equal(s.image_url, IMAGE_URL);
  assert.equal(s.original_image_url, RKD_URL);
  assert.equal(imageCalls.length, 0);
  const text = res.content[0].text;
  assert.ok(text.includes('opened in the image viewer'));
  assert.ok(text.includes('Record: https://rkd.nl/explore/images/56354'));
  assert.ok(text.includes(`Image: ${IMAGE_URL}`));
  assert.ok(text.includes('1 lower-scoring detections hidden'));
});

test('manual-only labels are marked in the text', async () => {
  fragRows = [{ ...FRAGMENT_ROWS[0], score: '1', prov: uri(MANUAL) }];
  const res = await view();
  assert.ok(res.content[0].text.includes('Lemon (manual)'));
});

test('a text source is refused', async () => {
  meta = bindings([{ type: uri(TYPE_TEXT), title: 'The Art of Perfumery' }]);
  const res = await view();
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
  assert.ok(res.content[0].text.includes('not an image'));
});

test('an image on a foreign host is refused', async () => {
  meta = imageMeta(RKD_URL);
  const res = await view();
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
  assert.ok(res.content[0].text.includes('No locally hosted image'));
  assert.equal(imageCalls.length, 0);
});

test('an unknown id is an error without structuredContent', async () => {
  meta = bindings([]);
  const res = await view();
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
  assert.ok(res.content[0].text.includes('No source found'));
});

test('an unknown id that is no smell either runs the main query first, then the smell lookup', async () => {
  meta = bindings([]);
  await view();
  const labels = stub.router.calls.map((c) => c.label);
  assert.ok(labels.indexOf('source_meta') >= 0 && labels.indexOf('source_meta') < labels.indexOf('smell_source'));
});

test('a smell id is followed to its image source with a warning', async () => {
  smellSource = IMAGE_SOURCE;
  const res = await view({ id: '096b7995-234f-5a7a-bd30-4dc4add02486' });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.id, IMAGE_SOURCE);
  const w = '096b7995-234f-5a7a-bd30-4dc4add02486 is a smell id; showing its source 00721405-98be-5795-ac1d-3510448af60a.';
  assert.ok(s.warnings.includes(w));
  assert.ok(res.content[0].text.includes(w));
  assert.deepEqual(JSON.parse(res.content[1].text), res.structuredContent);
});

test('stdio fallback: content[1] is the structured result as JSON', async () => {
  const res = await view();
  assert.equal(res.content.length, 2);
  assert.deepEqual(JSON.parse(res.content[1].text), res.structuredContent);
});

test('the tool points at the viewer resource', async () => {
  const { tools } = await client.listTools();
  const t = tools.find((x) => x.name === 'eokg_view_image');
  assert.equal(t._meta.ui.resourceUri, 'ui://odeuropa/image-viewer.html');
  assert.ok(t.description.includes('Boxes button'));
});
