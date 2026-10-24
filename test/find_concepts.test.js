import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { outputSchema } from '../src/tools/find_concepts.js';
import { startStubServer, bindings } from './stub-backend.js';
import { withClient, assertWireValid, LIVE } from './helpers.js';

const KG = 'http://data.odeuropa.eu/vocabulary/';
const uri = (value) => ({ type: 'uri', value });
const en = (value) => ({ type: 'literal', value, 'xml:lang': 'en' });

const hit = (path, prefLabel, lang, vocab, extra = {}) => ({ uri: `${KG}${path}`, prefLabel, lang, vocab, ...extra });
const ROSE = [
  hit('olfactory-objects/138', 'Rose', 'en', 'olfactory_objects'),
  hit('olfactory-objects/138', 'Rosa', 'it', 'olfactory_objects'),
  hit('olfactory-objects/138', 'Roos', 'nl', 'olfactory_objects'),
];
const TAXON = hit('expert-taxonomy/flower/other_flowers/rose', 'rose', 'en', 'expert-taxonomy');

let stub;
afterEach(async () => { await stub?.close(); stub = null; });

async function call(args, routes) {
  stub = await startStubServer(routes);
  const env = { EOKG_SPARQL_ENDPOINT: stub.url, EOKG_SKOSMOS_BASE: `${new URL(stub.url).origin}/rest/v1/` };
  const res = await withClient('find-concepts', (c) => c.callTool({ name: 'eokg_find_concepts', arguments: args }), { env });
  return res;
}

const searchUrls = () => stub.router.calls.filter((c) => c.label === 'skosmos_search').map((c) => new URL(c.url));
const labelsRoute = () => ({
  body: bindings([
    { c: uri(`${KG}olfactory-objects/138`), l: en('Rose') },
    { c: uri(`${KG}olfactory-objects/72`), l: en('Flower') },
    { c: uri(`${KG}fragrant-spaces/27`), l: en('Garden') },
  ]),
});

test('default vocabs are sent as olfactory_objects, fragrant-spaces and olfactory-gestures; trailing * added', async () => {
  const res = await call({ query: 'rose' }, { skosmos_search: () => ({ body: { results: ROSE } }) });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  const [u] = searchUrls();
  assert.equal(u.searchParams.get('vocab'), 'olfactory_objects fragrant-spaces olfactory-gestures');
  assert.equal(u.searchParams.get('query'), 'rose*');
  assert.equal(res.structuredContent.query, 'rose*');
});

test('an explicit * is not doubled; vocab olfactory-objects sends the underscore id', async () => {
  await call({ query: 'ro*se', vocab: 'olfactory-objects' }, { skosmos_search: () => ({ body: { results: [] } }) });
  const [u] = searchUrls();
  assert.equal(u.searchParams.get('query'), 'ro*se');
  assert.equal(u.searchParams.get('vocab'), 'olfactory_objects');
});

test('vocab all sends every Skosmos id', async () => {
  await call({ query: 'rose', vocab: 'all' }, { skosmos_search: () => ({ body: { results: [] } }) });
  assert.equal(searchUrls()[0].searchParams.get('vocab').split(' ').length, 20);
});

test('Rose is deduped across languages and labelled in the requested lang; linked sort first', async () => {
  const res = await call({ query: 'rose', lang: 'it' }, {
    skosmos_search: () => ({ body: { results: [TAXON, ...ROSE] } }),
    concept_labels: () => ({
      body: bindings([
        { c: uri(`${KG}olfactory-objects/138`), l: en('Rose') },
        { c: uri(`${KG}olfactory-objects/138`), l: { type: 'literal', value: 'Rosa', 'xml:lang': 'it' } },
        { c: uri(`${KG}expert-taxonomy/flower/other_flowers/rose`), l: en('rose') },
      ]),
    }),
  });
  const s = assertWireValid(outputSchema, res.structuredContent);
  assert.equal(s.results.length, 2);
  assert.equal(s.results[0].id, `${KG}olfactory-objects/138`);
  assert.equal(s.results[0].label, 'Rosa');
  assert.equal(s.results[0].vocab, 'olfactory-objects');
  assert.equal(s.results[0].linked_to, 'smells');
  assert.equal(s.results[0].explorer_url, 'https://explorer.odeuropa.eu/smell-sources/138');
  assert.equal(s.results[1].vocab, 'expert-taxonomy');
  assert.equal(s.results[1].linked_to, null);
  assert.equal(s.results[0].lang, 'it');
  assert.equal(s.results[1].label, 'rose', 'no Italian label: the matched label stays');
  assert.ok(res.content[0].text.includes('- Rosa [olfactory-objects/138]'));
  assert.ok(!res.content[0].text.includes('- Rosa [olfactory-objects/138] —'));
});

test('lang never reaches Skosmos: a concept matched only in another language is kept', async () => {
  const tabak = [hit('olfactory-objects/55', 'Tabak', 'nl', 'olfactory_objects')];
  const res = await call({ query: 'Tabak', lang: 'de' }, {
    skosmos_search: () => ({ body: { results: tabak } }),
    concept_labels: () => ({ body: bindings([{ c: uri(`${KG}olfactory-objects/55`), l: en('Tobacco') }]) }),
  });
  assert.equal(searchUrls()[0].searchParams.has('lang'), false);
  const r = res.structuredContent.results[0];
  assert.equal(r.label, 'Tabak', 'no German label: the matched label is shown');
  assert.equal(r.lang, 'nl');
});

test('without lang there is no labels query', async () => {
  await call({ query: 'rose' }, { skosmos_search: () => ({ body: { results: ROSE } }) });
  assert.ok(!stub.router.calls.some((c) => c.label === 'concept_labels'));
});

test('only unlinked vocabularies read "not linked to smells"; "linked to" never appears', async () => {
  const res = await call({ query: 'rose', vocab: 'all' }, { skosmos_search: () => ({ body: { results: [TAXON, ...ROSE] } }) });
  const lines = res.content[0].text.split('\n');
  assert.ok(lines.find((l) => l.includes('olfactory-objects/138')) && !lines.find((l) => l.includes('olfactory-objects/138')).includes('not linked'));
  assert.ok(lines.find((l) => l.includes('expert-taxonomy')).endsWith('— not linked to smells'));
  assert.ok(!/(?<!not )linked to/.test(res.content[0].text));
});

test('a lower-case Iconclass notation is upper-cased outside parentheses', async () => {
  const res = await call({ iconclass: '25g41(rose)' }, { concept_labels: labelsRoute });
  assert.equal(res.structuredContent.iconclass, '25G41(rose)');
  assert.equal(res.structuredContent.results[0].id, `${KG}olfactory-objects/138`);
  await stub.close();
  const bare = await call({ iconclass: '25g41' }, { concept_labels: labelsRoute });
  assert.equal(bare.structuredContent.iconclass, '25G41');
  assert.ok(bare.structuredContent.results.length > 0);
});

test('the lang parameter says labels are shown, matching covers all languages', async () => {
  const stubTools = await withClient('find-concepts', (c) => c.listTools(), { env: {} });
  const t = stubTools.tools.find((x) => x.name === 'eokg_find_concepts');
  assert.match(t.inputSchema.properties.lang.description, /Show labels in this language where the concept has one/);
  assert.match(t.inputSchema.properties.lang.description, /Matching always covers all six languages/);
});

test('without lang, en is preferred', async () => {
  const res = await call({ query: 'ros' }, { skosmos_search: () => ({ body: { results: [ROSE[1], ROSE[0]] } }) });
  assert.equal(res.structuredContent.results[0].label, 'Rose');
});

test('a schema-invalid vocab is an error with zero requests', async () => {
  const res = await call({ query: 'rose', vocab: 'olfactory_objects' }, { skosmos_search: () => ({ body: { results: [] } }) });
  assert.equal(res.isError, true);
  assert.equal(stub.router.calls.length, 0);
});

test('both or neither of query and iconclass is an error with zero requests', async () => {
  for (const args of [{ query: 'rose', iconclass: '25G41' }, {}]) {
    const res = await call(args, {});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /either query or iconclass/);
    assert.equal(stub.router.calls.length, 0);
    await stub.close();
  }
  stub = null;
});

test('iconclass 25G41(ROSE): exact Rose first, broader Flower; no Skosmos request', async () => {
  const res = await call({ iconclass: '25G41(ROSE)' }, { concept_labels: labelsRoute });
  const s = assertWireValid(outputSchema, res.structuredContent);
  const pick = (n) => s.results.find((r) => r.id === `${KG}olfactory-objects/${n}`);
  assert.deepEqual(s.results.filter((r) => r.iconclass_match === 'exact').map((r) => [r.id, r.notation]),
    [[`${KG}olfactory-objects/138`, '25G41(...)']]);
  assert.equal(s.results[0].id, `${KG}olfactory-objects/138`);
  assert.equal(s.results[0].label, 'Rose');
  assert.deepEqual([pick(72).iconclass_match, pick(72).notation], ['broader', '25G41']);
  assert.ok(!s.results.some((r) => r.iconclass_match === 'broader' && r.notation.endsWith('(...)')));
  assert.equal(pick(79), undefined, '25G4(...) is not an ancestor');
  // Placeholder siblings (27, 92, …) are other named notations, not matches at all.
  for (const n of [27, 92, 170, 223, 226, 236, 257, 327, 391]) assert.equal(pick(n), undefined, String(n));
  assert.equal(searchUrls().length, 0);
  assert.ok(res.content[0].text.includes('- Rose [olfactory-objects/138] — 25G41(...) (exact)\n'));
});

test('iconclass 25G41(TULIP): no concept is named Tulip, so only Flower (broader)', async () => {
  const res = await call({ iconclass: '25G41(TULIP)' }, { concept_labels: labelsRoute });
  const { results } = res.structuredContent;
  assert.ok(!results.some((r) => r.iconclass_match === 'exact'));
  assert.ok(!results.some((r) => r.iconclass_match === 'broader' && r.notation.endsWith('(...)')));
  assert.ok(results.some((r) => r.id === `${KG}olfactory-objects/72` && r.iconclass_match === 'broader'));
  assert.ok(!results.some((r) => r.id === `${KG}olfactory-objects/138`));
});

test('iconclass 25G41(...): every placeholder concept is exact', async () => {
  const res = await call({ iconclass: '25G41(...)', limit: 50 }, { concept_labels: labelsRoute });
  const exact = res.structuredContent.results.filter((r) => r.iconclass_match === 'exact');
  assert.deepEqual(exact.map((r) => r.id.split('/').pop()).sort((a, b) => a - b),
    ['27', '92', '138', '170', '223', '226', '236', '257', '327', '391']);
});

test('iconclass 25G4: Flower and Rose are narrower', async () => {
  const res = await call({ iconclass: '25G4', limit: 50 }, { concept_labels: labelsRoute });
  const byId = Object.fromEntries(res.structuredContent.results.map((r) => [r.id, r.iconclass_match]));
  assert.equal(byId[`${KG}olfactory-objects/72`], 'narrower');
  assert.equal(byId[`${KG}olfactory-objects/138`], 'narrower');
  assert.equal(byId[`${KG}olfactory-objects/79`], 'narrower'); // 25G4(...): a named 25G4 is narrower
  // Concepts mapped to 25G4 itself or to 25 are exact and broader matches, so they sort before.
  const order = res.structuredContent.results.map((r) => r.iconclass_match);
  assert.deepEqual(order, [...order].sort((a, b) => ['exact', 'broader', 'narrower'].indexOf(a) - ['exact', 'broader', 'narrower'].indexOf(b)));
});

test('iconclass 25G41: Flower exact, Rose narrower (rule order)', async () => {
  const res = await call({ iconclass: '25G41', limit: 50 }, { concept_labels: labelsRoute });
  const byId = Object.fromEntries(res.structuredContent.results.map((r) => [r.id, r.iconclass_match]));
  assert.equal(byId[`${KG}olfactory-objects/72`], 'exact');
  assert.equal(byId[`${KG}olfactory-objects/138`], 'narrower');
});

test('iconclass 41A6 finds fragrant-spaces/27 exactly', async () => {
  const res = await call({ iconclass: '41A6' }, { concept_labels: labelsRoute });
  const r = res.structuredContent.results.find((x) => x.id === `${KG}fragrant-spaces/27`);
  assert.equal(r.iconclass_match, 'exact');
  assert.equal(r.linked_to, 'places');
});

test('iconclass with no match: empty results, warning, no labels query', async () => {
  const res = await call({ iconclass: '99Z' }, { concept_labels: labelsRoute });
  assert.deepEqual(res.structuredContent.results, []);
  assert.match(res.structuredContent.warnings[0], /No Odeuropa concept is mapped to 99Z/);
  assert.match(res.structuredContent.warnings[0], /Only 252 concepts/);
  assert.equal(stub.router.calls.length, 0);
});

test('iconclass restricted to a vocab without notations yields nothing', async () => {
  const res = await call({ iconclass: '25G41', vocab: 'dravnieks' }, { concept_labels: labelsRoute });
  assert.deepEqual(res.structuredContent.results, []);
  assert.equal(stub.router.calls.length, 0);
});

// ── live ─────────────────────────────────────────────────────────────────────

const live = (args) => withClient('find-concepts-live', (c) => c.callTool({ name: 'eokg_find_concepts', arguments: args }));

test('live: rose (en) puts olfactory-objects/138 first', { skip: !LIVE }, async () => {
  const res = await live({ query: 'rose', lang: 'en' });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  assert.ok(res.structuredContent.results[0].id.endsWith('olfactory-objects/138'));
});

test('live: jardin (fr) includes fragrant-spaces/27', { skip: !LIVE }, async () => {
  const res = await live({ query: 'jardin', lang: 'fr' });
  assert.ok(res.structuredContent.results.some((r) => r.id.endsWith('fragrant-spaces/27')), res.content[0].text);
});

test('live: iconclass 25G41(ROSE) puts Rose first', { skip: !LIVE }, async () => {
  const res = await live({ iconclass: '25G41(ROSE)' });
  const first = res.structuredContent.results[0];
  assert.ok(first.id.endsWith('olfactory-objects/138'));
  assert.equal(first.label, 'Rose');
  assert.equal(first.iconclass_match, 'exact');
  assert.deepEqual(res.structuredContent.results.filter((r) => r.iconclass_match === 'exact').map((r) => r.id), [first.id]);
});
