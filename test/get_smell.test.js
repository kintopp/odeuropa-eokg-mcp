import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { outputSchema } from '../src/tools/get_smell.js';
import { EXCERPT_INJECTION_BOUNDARY } from '../src/config.js';
import { startStubServer, bindings } from './stub-backend.js';
import { withClient, assertWireValid, LIVE, KNOWN_SMELL } from './helpers.js';

const KG = 'http://data.odeuropa.eu/';
const uri = (value) => ({ type: 'uri', value });
const en = (value) => ({ type: 'literal', value, 'xml:lang': 'en' });
const SMELL = `${KG}smell/7e932a9d-fcd7-5192-a678-ae760d6306ad`;
const GASCOIGNE = `${KG}smell/a47e9127-2546-54ea-ad14-49363b8a42a3`;
const IMAGE_SMELL = `${KG}smell/7c03d698-57c5-55a8-b089-cf388bbd8ecf`;
const EXCERPT = 'All the inferior descriptions of oil of lavender are sold cheap.';

const textCore = bindings([
  { graph: uri(`${KG}gutenberg`), source: uri(`${KG}source/638ff424-2531-5bc8-959e-9951e2c42697`),
    type: uri('http://erlangen-crm.org/current/E33_Linguistic_Object'), title: en('The Art of Perfumery'),
    url: 'https://www.gutenberg.org/ebooks/16378', lang: 'en', date: '1857', author: 'G. W. Septimus Piesse' },
  { graph: uri(`${KG}gutenberg`), source: uri(`${KG}source/638ff424-2531-5bc8-959e-9951e2c42697`),
    type: uri('http://erlangen-crm.org/current/E33_Linguistic_Object'), title: 'The Art of Perfumery',
    url: 'https://www.gutenberg.org/ebooks/16378', lang: 'en', date: '1857', author: 'G. W. Septimus Piesse' },
]);
const textRoles = bindings([
  { role: 'source', val: uri(`${KG}vocabulary/olfactory-objects/415`), valLabel: en('Lavender') },
  { role: 'source', val: uri(`${KG}object/6aac8590-0000-0000-0000-000000000000`), valLabel: en('essence of lavender') },
  { role: 'source', val: uri('http://www.wikidata.org/entity/Q171892'), valLabel: en('lavender') },
  { role: 'time', val: uri(`${KG}time/1857`), valLabel: '1857' },
  { role: 'quality', val: uri(`${KG}attribute/liquid_en`), valLabel: en('liquid') },
]);
const excerpts = (...texts) => bindings(texts.map((t, i) => ({ frag: uri(`${KG}frag/${i}`), text: t })));

function routes(core, ex, roles, counter) {
  const wrap = (b) => () => { counter && counter.n++; return { body: b }; };
  return { smell_core: wrap(core), smell_excerpts: wrap(ex), smell_roles: wrap(roles) };
}

async function call(stub, id) {
  return withClient('get-smell', (c) => c.callTool({ name: 'eokg_get_smell', arguments: { id } }),
    { env: { EOKG_SPARQL_ENDPOINT: stub.url } });
}

let stub;
afterEach(async () => { await stub?.close(); stub = null; });

test('text smell: shaped fields, twin dropped, title collapsed, boundary before excerpt', async () => {
  stub = await startStubServer(routes(textCore, excerpts(EXCERPT), textRoles));
  const res = await call(stub, SMELL);
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.dataset, 'gutenberg');
  assert.equal(s.source.type, 'text');
  assert.equal(s.source.title, 'The Art of Perfumery');
  assert.equal(s.source.author, 'G. W. Septimus Piesse');
  assert.deepEqual(s.smell_sources, [{ id: `${KG}vocabulary/olfactory-objects/415`, label: 'Lavender' }]);
  assert.deepEqual(s.mentions, ['essence of lavender']);
  assert.deepEqual(s.times, ['1857']);
  assert.deepEqual(s.qualities, [{ id: `${KG}attribute/liquid_en`, label: 'liquid' }]);
  assert.deepEqual(s.excerpts, [EXCERPT]);
  assert.ok(!JSON.stringify(s).includes('wikidata'));
  const text = res.content[0].text;
  assert.ok(!text.includes('wikidata'));
  assert.ok(text.includes('Lavender [olfactory-objects/415]; words used: "essence of lavender"'));
  assert.ok(text.indexOf(EXCERPT_INJECTION_BOUNDARY) !== -1);
  assert.ok(text.indexOf(EXCERPT_INJECTION_BOUNDARY) < text.indexOf(EXCERPT));
  assert.ok(text.includes(`Explorer: https://explorer.odeuropa.eu/smells/7e932a9d-fcd7-5192-a678-ae760d6306ad`));
});

test('emotion/place fixture: unlabelled emotions and qualities fall back to the URI', async () => {
  const roles = bindings([
    { role: 'place', val: uri(`${KG}place/c4690f3d-3290-58ea-a6cb-3a7f5235904c`), valLabel: 'the ballroom' },
    { role: 'emotion', val: uri(`${KG}emotion-type/nostalgia`), valLabel: 'nostalgia' },
    { role: 'emotion', val: uri(`${KG}emotion-type/envy`), valLabel: 'envy' },
    { role: 'quality', val: uri(`${KG}vocabulary/vdi-hedonic/04n`) },
  ]);
  stub = await startStubServer(routes(textCore, excerpts(EXCERPT), roles));
  const res = await call(stub, GASCOIGNE);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.deepEqual(s.emotions, ['nostalgia', 'envy']);
  assert.equal(s.places[0].label, 'the ballroom');
  assert.equal(s.qualities[0].label, '04n');
  assert.ok(res.content[0].text.includes('Emotions (machine-inferred): nostalgia, envy'));
});

test('image smell: no excerpt, image warning, kg image copy first', async () => {
  const core = bindings([{
    graph: uri(`${KG}odor`), source: uri(`${KG}source/00721405-98be-5795-ac1d-3510448af60a`),
    type: uri('http://erlangen-crm.org/current/E36_Visual_Item'), title: 'Still life',
    image: 'https://example.org/orig.jpg',
  }, {
    graph: uri(`${KG}odor`), source: uri(`${KG}source/00721405-98be-5795-ac1d-3510448af60a`),
    type: uri('http://erlangen-crm.org/current/E36_Visual_Item'), title: 'Still life',
    image: 'https://data.odeuropa.eu/image/abc.jpg',
  }]);
  stub = await startStubServer(routes(core, excerpts(), bindings([])));
  const res = await call(stub, IMAGE_SMELL);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.source.type, 'image');
  assert.deepEqual(s.excerpts, []);
  assert.ok(s.source.images[0].startsWith('https://data.odeuropa.eu/image/'));
  assert.ok(s.warnings.some((w) => w.includes('detected in an image')));
  assert.ok(res.content[0].text.includes('detected in an image'));
});

test('too many excerpts warns', async () => {
  stub = await startStubServer(routes(textCore, excerpts('1', '2', '3', '4', '5', '6'), textRoles));
  const res = await call(stub, SMELL);
  assert.equal(res.structuredContent.excerpts.length, 5);
  assert.ok(res.structuredContent.warnings[0].includes('More than 5 excerpts'));
});

test('not found: zero core rows is an error', async () => {
  stub = await startStubServer({
    ...routes(bindings([]), excerpts(), bindings([])), source_exists: () => ({ body: bindings([]) }),
  });
  const res = await call(stub, SMELL);
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No smell found/);
  assert.equal(stub.router.calls.find((c) => c.label === 'smell_core') !== undefined, true);
});

test('a source id passed as a smell id is named as such', async () => {
  const hit = bindings([{ t: uri('http://erlangen-crm.org/current/E33_Linguistic_Object') }]);
  stub = await startStubServer({
    ...routes(bindings([]), excerpts(), bindings([])), source_exists: () => ({ body: hit }),
  });
  const res = await call(stub, '638ff424-2531-5bc8-959e-9951e2c42697');
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
  assert.match(res.content[0].text, /638ff424-2531-5bc8-959e-9951e2c42697 is a source id, not a smell id/);
  assert.match(res.content[0].text, /Use eokg_get_source to list its smells/);
  const labels = stub.router.calls.map((c) => c.label);
  assert.ok(labels.indexOf('smell_core') >= 0 && labels.indexOf('smell_core') < labels.indexOf('source_exists'));
  assert.ok(stub.router.calls.find((c) => c.label === 'source_exists').query
    .includes('<http://data.odeuropa.eu/source/638ff424-2531-5bc8-959e-9951e2c42697>'));
});

test('a found smell never runs the source check', async () => {
  stub = await startStubServer(routes(textCore, excerpts(EXCERPT), textRoles));
  await call(stub, SMELL);
  assert.ok(!stub.router.calls.some((c) => c.label === 'source_exists'));
});

test('invalid id: error and no request reaches the backend', async () => {
  const counter = { n: 0 };
  stub = await startStubServer(routes(textCore, excerpts(), textRoles, counter));
  const res = await call(stub, '<http://x> } ; DROP');
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Not a valid smell id/);
  assert.equal(stub.router.calls.length, 0);
  assert.equal(counter.n, 0);
});

test('Explorer permalink resolves to the canonical id', async () => {
  stub = await startStubServer(routes(textCore, excerpts(EXCERPT), textRoles));
  const res = await call(stub, 'https://explorer.odeuropa.eu/smells/7E932A9D-fcd7-5192-a678-ae760d6306ad');
  assert.equal(res.structuredContent.id, SMELL);
  assert.ok(stub.router.calls.every((c) => c.query.includes(`<${SMELL}>`)));
});

// Failure modes: a gesture stays invisible on the record it was found by; vocabulary carriers have no rdfs:label, so they
// vanish; a sameAs twin's rdfs:label takes the place of the vocabulary label.
test('gestures and vocabulary carriers reach the record and its text; no gesture gives an empty list', async () => {
  const roles = bindings([
    { role: 'gesture', val: uri(`${KG}vocabulary/olfactory-gestures/2`), valLabel: en("Holding one's nose") },
    { role: 'carrier', val: uri(`${KG}vocabulary/olfactory-objects/28`), valLabel: en('Cassolette') },
    { role: 'carrier', val: uri(`${KG}object/6aac8590-0000-0000-0000-000000000001`), valLabel: en('the sheets') },
  ]);
  stub = await startStubServer(routes(textCore, excerpts(EXCERPT), roles));
  const res = await call(stub, SMELL);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.deepEqual(s.gestures, [{ id: `${KG}vocabulary/olfactory-gestures/2`, label: "Holding one's nose" }]);
  assert.deepEqual(s.carriers, ['Cassolette', 'the sheets']);
  const text = res.content[0].text;
  assert.ok(text.includes("Gesture: Holding one's nose"));
  assert.ok(text.includes('Carrier: Cassolette, the sheets'));
  await stub.close();

  stub = await startStubServer(routes(textCore, excerpts(EXCERPT), textRoles));
  const plain = await call(stub, SMELL);
  assert.deepEqual(assertWireValid(outputSchema, plain.structuredContent).gestures, []);
  assert.ok(!plain.content[0].text.includes('Gesture:'));
});

test('role labels for gestures and carriers come from the vocabulary graphs, and words only from object URIs', async () => {
  stub = await startStubServer(routes(textCore, excerpts(EXCERPT), textRoles));
  await call(stub, SMELL);
  const q = stub.router.calls.find((c) => c.label === 'smell_roles').query;
  // Gestures hang off the experience, not the emission.
  assert.ok(q.includes('?ex od:F2_perceived ?id ; od:F5_involved_gesture ?val'));
  const graphLabel = (name) => `GRAPH <${KG}vocabulary/${name}> { ?val skos:prefLabel ?valLabel FILTER(LANG(?valLabel) = "en") }`;
  assert.ok(q.includes(graphLabel('olfactory-gestures')));
  const carrier = q.slice(q.indexOf('od:F4_had_carrier'), q.indexOf('BIND("time"'));
  assert.ok(carrier.includes(graphLabel('olfactory-objects')));
  assert.ok(carrier.includes(graphLabel('fragrant-spaces')));
  // Inference copies twin labels onto vocabulary concepts, so rdfs:label is read for the raw words only.
  assert.match(carrier, /\?val rdfs:label \?valLabel FILTER\(STRSTARTS\(STR\(\?val\), "http:\/\/data\.odeuropa\.eu\/object\/"\)\)/);
});

test('live: a gesture smell on an image shows its gesture', { skip: !LIVE }, async () => {
  const res = await withClient('get-smell-live', (c) => c.callTool({ name: 'eokg_get_smell', arguments: { id: '49f4042a-40f7-5666-b92a-321d64afafc0' } }));
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.deepEqual(s.gestures, [{ id: `${KG}vocabulary/olfactory-gestures/2`, label: "Holding one's nose" }]);
});

test('live: a vocabulary carrier and a text gesture appear on the Blégny smell', { skip: !LIVE }, async () => {
  const res = await withClient('get-smell-live', (c) => c.callTool({ name: 'eokg_get_smell', arguments: { id: '885cde94-f3cd-591b-b627-be16c6c9480a' } }));
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.deepEqual(s.carriers, ['Cassolette']);
  assert.deepEqual(s.gestures.map((g) => g.label), ['Perfuming']);
});

test('live: KNOWN_SMELL resolves with concept and mention', { skip: !LIVE }, async () => {
  const res = await withClient('get-smell-live', (c) => c.callTool({ name: 'eokg_get_smell', arguments: { id: KNOWN_SMELL } }));
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.dataset, 'gutenberg');
  assert.ok(s.source.title.includes('Art of Perfumery'));
  assert.ok(s.smell_sources.some((c) => c.id === `${KG}vocabulary/olfactory-objects/415`));
  assert.ok(s.mentions.includes('essence of lavender'));
  assert.ok(!JSON.stringify(s).includes('wikidata'));
});

test('live: Rose fixture has the nostalgia emotion', { skip: !LIVE }, async () => {
  const res = await withClient('get-smell-live', (c) => c.callTool({ name: 'eokg_get_smell', arguments: { id: GASCOIGNE } }));
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.ok(s.emotions.includes('nostalgia'));
  assert.equal(s.places[0].label, 'the ballroom');
});
