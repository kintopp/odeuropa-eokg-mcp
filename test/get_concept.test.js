import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { outputSchema } from '../src/tools/get_concept.js';
import { startStubServer, bindings } from './stub-backend.js';
import { withClient, assertWireValid, LIVE, KNOWN_CONCEPT_ROSE } from './helpers.js';

const KG = 'http://data.odeuropa.eu/vocabulary/';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const uri = (value) => ({ type: 'uri', value });
const lit = (value, l) => ({ type: 'literal', value, ...(l && { 'xml:lang': l }) });
const G = uri(`${KG}olfactory-objects`);
const row = (p, o, olabel) => ({ g: G, p: uri(`${SKOS}${p}`), o, ...(olabel && { olabel }) });

const ROSE = `${KG}olfactory-objects/138`;
const roseDetail = bindings([
  ...[['de', 'Rose'], ['en', 'Rose'], ['fr', 'Rose'], ['it', 'Rosa'], ['nl', 'Roos'], ['sl', 'Vrtnica']]
    .map(([l, t]) => row('prefLabel', lit(t, l))),
  row('broader', uri(`${KG}olfactory-objects/72`), lit('Flower', 'en')),
  row('broader', uri(`${KG}olfactory-objects/560`), lit('Flora', 'en')),
  { g: G, p: uri('https://schema.org/image'), o: uri('https://example.org/rose.jpg') },
]);
const none = bindings([]);

const GARDEN = `${KG}fragrant-spaces/27`;
const GS = uri(`${KG}fragrant-spaces`);
const gardenDetail = bindings([
  { g: GS, p: uri(`${SKOS}prefLabel`), o: lit('Garden', 'en') },
  { g: GS, p: uri(`${SKOS}narrower`), o: uri(`${KG}fragrant-spaces/84`), olabel: lit('Herb garden', 'en') },
]);
const gardenNarrower = bindings([
  { n: uri(`${KG}fragrant-spaces/84`), l: lit('Herb garden', 'en') },
  { n: uri(`${KG}fragrant-spaces/72`), l: lit('Kitchen garden', 'en') },
  { n: uri(`${KG}fragrant-spaces/81`), l: lit('Orchard', 'en') },
]);

let stub;
afterEach(async () => { await stub?.close(); stub = null; });

async function call(id, routes) {
  stub = await startStubServer(routes);
  return withClient('get-concept', (c) => c.callTool({ name: 'eokg_get_concept', arguments: { id } }),
    { env: { EOKG_SPARQL_ENDPOINT: stub.url } });
}
const labelsSent = () => stub.router.calls.map((c) => c.label);

const roseRoutes = {
  concept_detail: () => ({ body: roseDetail }),
  concept_narrower: () => ({ body: none }),
  concept_smell_count: () => ({ body: bindings([{ smells: { type: 'literal', value: '29243' } }]) }),
  concept_image_count: () => ({ body: bindings([{ images: { type: 'literal', value: '4013' } }]) }),
};

test('Rose: labels, hierarchy, placeholder iconclass with candidate, counts, explorer url', async () => {
  const res = await call('olfactory-objects/138', roseRoutes);
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.id, ROSE);
  assert.equal(Object.keys(s.labels).length, 6);
  assert.equal(s.labels.sl, 'Vrtnica');
  assert.deepEqual(s.broader.map((b) => b.label), ['Flower', 'Flora']);
  assert.deepEqual(s.iconclass[0], { notation: '25G41(...)', placeholder: true, candidate: '25G41(ROSE)' });
  assert.equal(s.smell_count, 29243);
  assert.equal(s.image_source_count, 4013);
  assert.equal(s.explorer_url, 'https://explorer.odeuropa.eu/smell-sources/138');
  assert.equal(s.image, 'https://example.org/rose.jpg');
  const text = res.content[0].text;
  assert.ok(text.includes('Linked: 29,243 smells, 4,013 image sources'));
  assert.ok(text.includes('Iconclass: 25G41(...) — placeholder for a name; candidate 25G41(ROSE) (unverified)'));
  assert.ok(text.includes('Broader: Flower, Flora · Narrower: (none)'));
});

test('Garden: plain iconclass, place count query, explicit narrower', async () => {
  const res = await call(GARDEN, {
    concept_detail: () => ({ body: gardenDetail }),
    concept_narrower: () => ({ body: gardenNarrower }),
    space_smell_count: () => ({ body: bindings([{ smells: { type: 'literal', value: '3818' } }]) }),
  });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.deepEqual(s.iconclass, [{ notation: '41A6', placeholder: false }]);
  assert.equal(s.smell_count, 3818);
  assert.equal(s.image_source_count, undefined);
  assert.equal(s.narrower_count, 3);
  assert.deepEqual(s.narrower.map((n) => n.label), ['Herb garden', 'Kitchen garden', 'Orchard']);
  assert.equal(s.explorer_url, 'https://explorer.odeuropa.eu/fragrant-spaces/27');
  assert.ok(!labelsSent().includes('concept_smell_count'));
});

// Failure modes: the gesture is counted through od:F3_had_source (0 smells) or the image count is skipped.
test('a gesture counts smells through its experiences and images through P138', async () => {
  const res = await call('olfactory-gestures/2', {
    concept_detail: () => ({ body: bindings([{ g: uri(`${KG}olfactory-gestures`), p: uri(`${SKOS}prefLabel`), o: lit("Holding one's nose", 'en') }]) }),
    concept_narrower: () => ({ body: none }),
    gesture_smell_count: () => ({ body: bindings([{ smells: lit('415') }]) }),
    concept_image_count: () => ({ body: bindings([{ images: lit('415') }]) }),
  });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.linked_to, 'smells');
  assert.equal(s.smell_count, 415);
  assert.equal(s.image_source_count, 415);
  assert.equal(s.explorer_url, undefined);
  assert.ok(!labelsSent().includes('concept_smell_count'));
  const q = stub.router.calls.find((c) => c.label === 'gesture_smell_count').query;
  assert.ok(q.includes('od:F5_involved_gesture <http://data.odeuropa.eu/vocabulary/olfactory-gestures/2>') && q.includes('od:F2_perceived ?smell'));
});

test('a malformed olfactory_objects related URI is mapped to olfactory-objects with its label', async () => {
  const HOSPITAL = `${KG}fragrant-spaces/32`;
  const detail = bindings([
    { g: GS, p: uri(`${SKOS}prefLabel`), o: lit('Hospital', 'en') },
    { g: GS, p: uri(`${SKOS}related`), o: uri('http://data.odeuropa.eu/olfactory_objects/248') },
  ]);
  const res = await call(HOSPITAL, {
    concept_detail: () => ({ body: detail }),
    concept_narrower: () => ({ body: none }),
    space_smell_count: () => ({ body: bindings([{ smells: lit('5') }]) }),
    concept_labels: () => ({
      body: bindings([
        { c: uri(`${KG}olfactory-objects/248`), l: lit('Acide carbolique', 'fr') },
        { c: uri(`${KG}olfactory-objects/248`), l: lit('Carbolic acid', 'en') },
      ]),
    }),
  });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.deepEqual(s.related, [{ id: `${KG}olfactory-objects/248`, label: 'Carbolic acid' }]);
  assert.ok(res.content[0].text.includes('Related: Carbolic acid'));
  assert.ok(stub.router.calls.find((c) => c.label === 'concept_labels').query.includes(`<${KG}olfactory-objects/248>`));
});

test('without a malformed URI no labels query runs', async () => {
  await call(GARDEN, {
    concept_detail: () => ({ body: gardenDetail }),
    concept_narrower: () => ({ body: gardenNarrower }),
    space_smell_count: () => ({ body: bindings([{ smells: lit('1') }]) }),
  });
  assert.ok(!labelsSent().includes('concept_labels'));
});

test('expert-taxonomy concept: no counts query, no iconclass, no explorer url', async () => {
  const T = `${KG}expert-taxonomy/flower/other_flowers/rose`;
  const res = await call(T, {
    concept_detail: () => ({ body: bindings([{ g: uri(`${KG}expert-taxonomy`), p: uri(`${SKOS}prefLabel`), o: lit('rose', 'en') }]) }),
    concept_narrower: () => ({ body: none }),
  });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.vocab, 'expert-taxonomy');
  assert.equal(s.linked_to, null);
  assert.equal(s.iconclass, undefined);
  assert.equal(s.explorer_url, undefined);
  assert.deepEqual(labelsSent().sort(), ['concept_detail', 'concept_narrower']);
});

test('closeMatch never appears in any query sent', async () => {
  await call('olfactory-objects/138', roseRoutes);
  const queries = stub.router.calls.map((c) => c.query);
  assert.ok(queries.length >= 4);
  assert.ok(queries.every((q) => !q.includes('closeMatch')));
});

test('an unknown concept is an error naming the id', async () => {
  const res = await call('olfactory-objects/99999', { ...roseRoutes, concept_detail: () => ({ body: none }) });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No concept found with id/);
});

test('an invalid id never reaches the backend', async () => {
  const res = await call('olfactory-objects/../x', roseRoutes);
  assert.equal(res.isError, true);
  assert.equal(stub.router.calls.length, 0);
});

// ── live ─────────────────────────────────────────────────────────────────────

const live = (id) => withClient('get-concept-live', (c) => c.callTool({ name: 'eokg_get_concept', arguments: { id } }));

test('live: Rose has > 20000 smells and a Slovene label', { skip: !LIVE }, async () => {
  const res = await live(KNOWN_CONCEPT_ROSE);
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  assert.ok(res.structuredContent.smell_count > 20000);
  assert.equal(res.structuredContent.labels.sl, 'Vrtnica');
});

test('live: Flower has at least 50 narrower concepts', { skip: !LIVE }, async () => {
  const res = await live('olfactory-objects/72');
  assert.ok(res.structuredContent.narrower_count >= 50, String(res.structuredContent.narrower_count));
});
