// In-process server: IMAGE_URL_RE is a security boundary with no override, so the image host can't
// be pointed at a loopback stub. Instead fetch is wrapped: image URLs go to a per-test handler,
// everything else to the SPARQL stub router.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.js';
import { outputSchema } from '../src/tools/inspect_image.js';
import { clearSparqlCache } from '../src/sparql/client.js';
import { clearImageCache } from '../src/image/client.js';
import { MAX_IMAGE_BYTES } from '../src/config.js';
import { installFetchStub, bindings } from './stub-backend.js';
import { assertWireValid, makeJpeg, withClient, LIVE } from './helpers.js';
import { FRAGMENT_ROWS, MANUAL, IMAGE_SOURCE, uri } from './source-fixtures.js';

const TYPE_TEXT = 'http://erlangen-crm.org/current/E33_Linguistic_Object';
const TYPE_IMAGE = 'http://erlangen-crm.org/current/E36_Visual_Item';
const IMAGE_URL = 'https://data.odeuropa.eu/image/e90fb725-7275-db43-a805-c109d9b4f9c3.jpg';
const RKD_URL = 'https://images.rkd.nl/rkd/thumb/650x650/e90fb725-7275-db43-a805-c109d9b4f9c3.jpg';

const imageMeta = (...images) => bindings(images.map((image) => ({
  type: uri(TYPE_IMAGE), title: 'Still life with fruit', artist: 'Pieter van den Bosch', date: '1650/55XX', image,
  url: 'https://rkd.nl/explore/images/56354',
})));

const jpegResponse = (w = 650, h = 568, init = {}) => new Response(makeJpeg(w, h), {
  status: 200, headers: { 'content-type': 'image/jpeg' }, ...init,
});

let stub;
let imageCalls;
let imageHandler;
let client;
let fragRows;
let meta;
let smellSource;
let fragCalls;

async function connect() {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(st);
  client = new Client({ name: 'inspect-image-test', version: '0.0.0' });
  await client.connect(ct);
}

beforeEach(async () => {
  clearSparqlCache();
  clearImageCache();
  imageCalls = [];
  fragCalls = 0;
  fragRows = FRAGMENT_ROWS;
  meta = imageMeta(IMAGE_URL, RKD_URL);
  smellSource = null;
  imageHandler = async () => jpegResponse();
  stub = installFetchStub({
    source_meta: (q) => ({ body: q.includes('source/096b7995-234f-5a7a-bd30-4dc4add02486') ? bindings([]) : meta }),
    smell_source: () => ({ body: bindings(smellSource ? [{ source: uri(smellSource) }] : []) }),
    image_fragments: () => { fragCalls++; return { body: bindings(fragRows) }; },
  });
  const sparqlFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    // Anything that is not the SPARQL endpoint counts as an image fetch, third-party hosts included.
    if (!String(url).startsWith('https://data.odeuropa.eu/repositories/')) {
      imageCalls.push({ url: String(url), init });
      return imageHandler(url, init);
    }
    return sparqlFetch(url, init);
  };
  await connect();
});

afterEach(async () => {
  await client?.close();
  stub.restore();
  clearSparqlCache();
  clearImageCache();
});

const inspect = (args = {}) => client.callTool({ name: 'eokg_inspect_image', arguments: { id: IMAGE_SOURCE, ...args } });

test('percent boxes are 100 * px / dimensions rounded to 2 decimals, in score order', async () => {
  const res = await inspect({ min_score: 0 });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.width, 650);
  assert.equal(s.height, 568);
  assert.equal(s.objects.length, 6);
  assert.deepEqual(s.objects[5].box_pct, { x: 21.23, y: 66.55, w: 15.69, h: 21.13 });
  assert.deepEqual(s.objects[5].box_px, { x: 138, y: 378, w: 102, h: 120 });
  assert.equal(s.objects[0].label, 'Lemon');
  assert.ok(s.objects.every((o) => o.origin === 'detector'));
  assert.equal(s.warnings, undefined);
  const text = res.content[1].text;
  assert.ok(text.includes('"Still life with fruit" by Pieter van den Bosch (1650/55XX), 650×568 px'));
  assert.ok(text.includes('- Lemon 0.95 (detector) — 48.15,78.35,13.54,9.86'));
  assert.equal(imageCalls.length, 1);
  assert.equal(imageCalls[0].init.redirect, 'error');
});

// Failure modes:
// - the record page or original image is dropped from the text the model reads;
// - a link line appears with `undefined` when the source has no record page;
// - the "user cannot see it" note is missing from the text channel;
// - structured output omits url/original_image_url, or emits them empty;
// - the text result still invites embedding the image (no plain-link instruction).
test('links: record page, hosted image and original appear in text and structured output', async () => {
  const res = await inspect();
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.url, 'https://rkd.nl/explore/images/56354');
  assert.equal(s.original_image_url, RKD_URL);
  const text = res.content[1].text;
  assert.ok(text.includes('Record: https://rkd.nl/explore/images/56354'));
  assert.ok(text.includes(`Image: ${IMAGE_URL}`));
  assert.ok(text.includes(`Original: ${RKD_URL}`));
  assert.ok(text.includes('the user does not see it'));
  assert.ok(text.includes('call eokg_view_image'));
  assert.ok(text.includes('never embed these links as Markdown images'));
});

test('links: a source without record page or original prints only the hosted image', async () => {
  meta = bindings([{ type: uri(TYPE_IMAGE), title: 'Untitled', image: IMAGE_URL }]);
  const res = await inspect();
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.url, undefined);
  assert.equal(s.original_image_url, undefined);
  const text = res.content[1].text;
  assert.ok(!text.includes('Record:'));
  assert.ok(!text.includes('Original:'));
  assert.ok(text.includes(`Image: ${IMAGE_URL}`));
  assert.ok(!text.includes('undefined'));
});

test('content[0] is the image; structuredContent carries no image bytes', async () => {
  const res = await inspect();
  assert.equal(res.content[0].type, 'image');
  assert.equal(res.content[0].mimeType, 'image/jpeg');
  assert.equal(res.content[0].annotations, undefined); // an audience annotation could hide the tool-card thumbnail
  assert.deepEqual([...Buffer.from(res.content[0].data, 'base64').subarray(0, 2)], [0xFF, 0xD8]);
  assert.ok(JSON.stringify(res.structuredContent).length < 10000);
  assert.ok(!JSON.stringify(res.structuredContent).includes(res.content[0].data));
});

// Failure modes:
// - the description still says "may not render", which lets the model try an embed;
// - the Markdown-image prohibition or the pointer to eokg_view_image is missing from the description.
test('the description forbids Markdown image embeds and points to eokg_view_image', async () => {
  const { tools } = await client.listTools();
  const d = tools.find((x) => x.name === 'eokg_inspect_image').description;
  assert.ok(d.includes('never embed an image URL as a Markdown image'));
  assert.ok(d.includes('call eokg_view_image'));
  assert.ok(!d.includes('may not render'));
});

test('min_score 0.94 keeps the three top boxes and counts the rest as hidden', async () => {
  const res = await inspect({ min_score: 0.94 });
  const s = res.structuredContent;
  assert.deepEqual(s.objects.map((o) => o.label), ['Lemon', 'Peach', 'Grape']);
  assert.equal(s.hidden_below_min_score, 3);
  assert.ok(res.content[1].text.includes('3 lower-scoring detections hidden.'));
});

// Failure modes: the default is still 0.5 (0.6 box shown); the default is too high (0.75 box hidden);
// hidden_below_min_score ignores the default cut-off.
test('default min_score hides a 0.6 detector box and keeps a 0.75 one', async () => {
  fragRows = [...FRAGMENT_ROWS, { ...FRAGMENT_ROWS[0], score: '0.75' }, { ...FRAGMENT_ROWS[0], score: '0.6' }];
  const res = await inspect();
  const s = res.structuredContent;
  assert.equal(s.min_score, 0.7);
  assert.equal(s.hidden_below_min_score, 1);
  assert.equal(s.objects.filter((o) => o.score === 0.75).length, 1);
  assert.equal(s.objects.filter((o) => o.score === 0.6).length, 0);
});

test('origin: manual prints (manual) without a score; unbound provenance is unknown; twins dropped', async () => {
  const noProv = { ...FRAGMENT_ROWS[1] };
  delete noProv.prov;
  fragRows = [
    { ...FRAGMENT_ROWS[0], score: '1', prov: uri(MANUAL) },
    noProv,
    { ...FRAGMENT_ROWS[2], body: uri('http://www.wikidata.org/entity/Q13191') },
  ];
  const res = await inspect();
  const s = res.structuredContent;
  assert.deepEqual(s.objects.map((o) => o.origin), ['manual', 'unknown']);
  const text = res.content[1].text;
  assert.ok(text.includes('- Lemon (manual) — '));
  assert.ok(text.includes('- Peach 0.95 (unknown) — '));
});

test('an unknown id that is no smell either is "No source found", after the main query', async () => {
  meta = bindings([]);
  const res = await inspect();
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No source found/);
  const labels = stub.router.calls.map((c) => c.label);
  assert.ok(labels.indexOf('source_meta') >= 0 && labels.indexOf('source_meta') < labels.indexOf('smell_source'));
  assert.equal(imageCalls.length, 0);
});

test('a smell id is followed to its image source with a warning in both channels', async () => {
  smellSource = IMAGE_SOURCE;
  const res = await inspect({ id: '096b7995-234f-5a7a-bd30-4dc4add02486' });
  assert.notEqual(res.isError, true, res.content?.[1]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.id, IMAGE_SOURCE);
  const w = '096b7995-234f-5a7a-bd30-4dc4add02486 is a smell id; showing its source 00721405-98be-5795-ac1d-3510448af60a.';
  assert.ok(s.warnings.includes(w));
  assert.ok(res.content[1].text.includes(w));
});

test('a text source is refused with zero image fetches', async () => {
  meta = bindings([{ type: uri(TYPE_TEXT), title: 'The Art of Perfumery' }]);
  const res = await inspect();
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('not an image'));
  assert.equal(imageCalls.length, 0);
  assert.equal(fragCalls, 0);
});

test('a source whose only image is third-party is refused with zero image fetches', async () => {
  meta = imageMeta(RKD_URL);
  const res = await inspect();
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('No locally hosted image'));
  assert.ok(res.content[0].text.includes(RKD_URL));
  assert.equal(imageCalls.length, 0);
});

test('a non-image content type is an error', async () => {
  imageHandler = async () => new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const res = await inspect();
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('text/html instead of an image'));
});

test('content-length above the limit is refused without reading the body', async () => {
  let pulled = false;
  imageHandler = async () => new Response(
    new ReadableStream({ pull() { pulled = true; } }, { highWaterMark: 0 }),
    { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(MAX_IMAGE_BYTES + 1) } },
  );
  const res = await inspect();
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('over the 4.5 MB'));
  assert.ok(res.content[0].text.includes(`Open ${IMAGE_URL} in a browser`));
  assert.equal(pulled, false);
});

test('a chunked body over the limit (no content-length) is refused', async () => {
  imageHandler = async () => new Response(Buffer.concat([makeJpeg(650, 568), Buffer.alloc(MAX_IMAGE_BYTES)]), {
    status: 200, headers: { 'content-type': 'image/jpeg' },
  });
  const res = await inspect();
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('over the 4.5 MB'));
});

test('a refused redirect / network failure reads as an unexpected redirect', async () => {
  imageHandler = async () => { throw new TypeError('fetch failed'); };
  const res = await inspect();
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('unexpected redirect'));
});

test('a 2000×2326 image gets the downscale warning', async () => {
  imageHandler = async () => jpegResponse(2000, 2326);
  const res = await inspect();
  assert.ok(res.structuredContent.warnings.some((w) => w.includes('2000×2326') && w.includes('may downscale')));
  assert.ok(res.content[1].text.includes('⚠ This image is 2000×2326 px'));
});

test('boxes past the image edge warn and are clamped to 100%', async () => {
  imageHandler = async () => jpegResponse(300, 300);
  const res = await inspect({ min_score: 0 });
  const s = res.structuredContent;
  assert.ok(s.warnings.some((w) => w.includes('extend past the image edge')));
  assert.ok(s.objects.every((o) => Object.values(o.box_pct).every((n) => n >= 0 && n <= 100)));
});

test('unreadable dimensions: pixel boxes only, with a warning', async () => {
  imageHandler = async () => new Response(Buffer.from('not a jpeg at all'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  const res = await inspect();
  const s = res.structuredContent;
  assert.equal(s.width, undefined);
  assert.equal(s.objects[0].box_pct, undefined);
  assert.ok(s.warnings.some((w) => w.includes('boxes are given in pixels only')));
});

test('live: the RKD still life', { skip: !LIVE }, async () => {
  stub.restore();
  await withClient('inspect-image-live', async (c) => {
    const res = await c.callTool({ name: 'eokg_inspect_image', arguments: { id: IMAGE_SOURCE, min_score: 0 } });
    assert.notEqual(res.isError, true, res.content?.[1]?.text ?? res.content?.[0]?.text);
    const s = assertWireValid(outputSchema, res.structuredContent);
    assert.equal(s.width, 650);
    assert.equal(s.height, 568);
    assert.equal(s.objects.length, 6);
    const labels = s.objects.map((o) => o.label);
    assert.ok(labels.includes('Lemon') && labels.includes('Peach'));
    assert.ok(s.objects.every((o) => o.origin === 'detector'));
    const bytes = Buffer.from(res.content[0].data, 'base64');
    assert.deepEqual([...bytes.subarray(0, 2)], [0xFF, 0xD8]);
  });
});
