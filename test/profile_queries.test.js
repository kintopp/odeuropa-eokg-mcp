import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorPattern, profileTotalQuery, profileFacetQuery, conceptLabelQuery,
} from '../src/sparql/queries/profile.js';
import { PROFILE_FACETS } from '../src/config.js';

const ROSE = 'http://data.odeuropa.eu/vocabulary/olfactory-objects/138';
const GARDEN = 'http://data.odeuropa.eu/vocabulary/fragrant-spaces/27';
const anchor = anchorPattern(ROSE, 'source');

const DISTINCT = {
  timeline: 'schema:dateCreated/time:hasBeginning',
  emission_timeline: 'time:hasTime/time:hasBeginning',
  languages: 'schema:inLanguage ?lang',
  datasets: 'GRAPH ?g',
  qualities: 'crm:P141_assigned ?q',
  emotions: 'reo:readP27',
  fragrant_spaces: 'crm:P137_exemplifies ?space',
  smell_sources: 'od:F3_had_source ?o',
  places: 'od:F2_perceived ?smell ; crm:P7_took_place_at ?p',
  carriers: 'od:F4_had_carrier',
};

test('each facet query carries its distinguishing predicate, the anchor and a distinct smell count', () => {
  assert.deepEqual(Object.keys(DISTINCT), [...PROFILE_FACETS]);
  for (const f of PROFILE_FACETS) {
    const q = profileFacetQuery(f, anchor, { bucketYears: 20, top: 10 });
    assert.ok(q.includes(DISTINCT[f]), `${f}: ${q}`);
    assert.ok(q.includes(anchor), f);
    assert.ok(q.includes('COUNT(DISTINCT ?smell) AS ?n'), f);
    assert.ok(/GROUP BY/.test(q), f);
  }
});

test('top-N facets end in LIMIT, timelines do not', () => {
  assert.match(profileFacetQuery('languages', anchor, { top: 7 }), /LIMIT 7$/);
  assert.ok(!/LIMIT/.test(profileFacetQuery('timeline', anchor, { bucketYears: 20 })));
  assert.ok(!/LIMIT/.test(profileFacetQuery('emission_timeline', anchor, { bucketYears: 20 })));
});

test('fragrant_spaces and datasets filter to local URIs inside the WHERE clause, before LIMIT', () => {
  const sp = profileFacetQuery('fragrant_spaces', anchor, { top: 10 });
  assert.ok(sp.includes('STRSTARTS(STR(?space), "http://data.odeuropa.eu/vocabulary/fragrant-spaces/")'));
  assert.ok(sp.indexOf('STRSTARTS') < sp.indexOf('LIMIT'));
  const ds = profileFacetQuery('datasets', anchor, { top: 10 });
  assert.ok(ds.includes('STRSTARTS(STR(?g), "http://data.odeuropa.eu/")'));
  assert.ok(ds.indexOf('STRSTARTS') < ds.indexOf('LIMIT'));
});

test('anchors: exact, narrower, fragrant-spaces', () => {
  assert.ok(anchor.includes(`VALUES ?c { <${ROSE}> }`));
  assert.ok(!anchor.includes('skos:broader*'));
  assert.ok(anchorPattern(ROSE, 'source', { narrower: true }).includes(`?c skos:broader* <${ROSE}>`));
  const g = anchorPattern(GARDEN, 'place');
  assert.ok(g.includes('crm:P137_exemplifies ?c') && g.includes('od:F1_generated ?smell'));
  assert.ok(anchorPattern(GARDEN, 'place', { narrower: true }).includes('(skos:broader|^skos:narrower)*'));
});

test('language appears only as a quoted literal', () => {
  const a = anchorPattern(ROSE, 'source', { language: 'fr' });
  assert.ok(a.includes('schema:inLanguage "fr"'));
  assert.equal(a.match(/\bfr\b/g).length, 1);
  assert.ok(!anchor.includes('inLanguage'));
});

test('bucketYears is interpolated into the bucket arithmetic', () => {
  assert.ok(profileFacetQuery('timeline', anchor, { bucketYears: 50 }).includes('/50)*50'));
  assert.ok(profileFacetQuery('emission_timeline', anchor, { bucketYears: 10 }).includes('/10)*10'));
});

test('total and concept label queries', () => {
  assert.ok(profileTotalQuery(anchor).includes('COUNT(DISTINCT ?smell)'));
  const l = conceptLabelQuery(ROSE, 'olfactory-objects');
  assert.ok(l.includes('GRAPH <http://data.odeuropa.eu/vocabulary/olfactory-objects>'));
  assert.ok(l.includes('LANG(?l) = "en"') && l.includes('LIMIT 1'));
});

test('unknown facet throws', () => {
  assert.throws(() => profileFacetQuery('nope', anchor), /Unknown profile facet/);
});

test('fragrant_spaces binds the label inside the fragrant-spaces graph, so sameAs twin labels cannot reach the facet', () => {
  const sp = profileFacetQuery('fragrant_spaces', anchor, { top: 10 });
  assert.match(sp, /GRAPH <http:\/\/data\.odeuropa\.eu\/vocabulary\/fragrant-spaces> \{ \?space skos:prefLabel \?sl FILTER\(LANG\(\?sl\) = "en"\) \}/);
  assert.equal(sp.match(/\?space skos:prefLabel/g).length, 1, 'no second, ungraphed label pattern');
});

// Invariant: a gesture count is anchored on the concept through experiences, never on od:F3_had_source (0 rows for gestures).
test('gesture anchor binds the experience to the gesture and the smell it perceived', () => {
  const G = 'http://data.odeuropa.eu/vocabulary/olfactory-gestures/2';
  const a = anchorPattern(G, 'gesture');
  assert.ok(a.includes(`VALUES ?c { <${G}> }`));
  assert.ok(a.includes('od:F5_involved_gesture ?c') && a.includes('od:F2_perceived ?smell'));
  assert.ok(a.includes('od:F1_generated ?smell'));
  assert.ok(!a.includes('F3_had_source'));
  assert.ok(anchorPattern(G, 'gesture', { narrower: true }).includes(`?c skos:broader* <${G}>`));
  assert.ok(anchorPattern(G, 'gesture', { language: 'fr' }).includes('schema:inLanguage "fr"'));
});

// Failure modes: a wikidata twin takes a top-N slot (the filter sits after LIMIT or is missing); the concept ranks
// against itself; a fragrant space or gesture is asked to exclude an object that is not its own.
test('smell_sources: anchored, filtered to olfactory-objects before GROUP BY, graph-bound label', () => {
  const q = profileFacetQuery('smell_sources', anchor, { top: 10, exclude: ROSE });
  assert.ok(q.includes(anchor));
  const at = q.indexOf('STRSTARTS(STR(?o), "http://data.odeuropa.eu/vocabulary/olfactory-objects/")');
  assert.ok(at >= 0 && at < q.indexOf('GROUP BY') && at < q.indexOf('LIMIT'));
  assert.ok(q.includes('GRAPH <http://data.odeuropa.eu/vocabulary/olfactory-objects> { ?o skos:prefLabel ?ol FILTER(LANG(?ol) = "en") }'));
  assert.equal(q.match(/\?o skos:prefLabel/g).length, 1);
});

test('smell_sources excludes the concept itself only when asked', () => {
  assert.ok(profileFacetQuery('smell_sources', anchor, { top: 10, exclude: ROSE }).includes(`?o != <${ROSE}>`));
  const g = anchorPattern(GARDEN, 'place');
  assert.ok(!profileFacetQuery('smell_sources', g, { top: 10 }).includes('?o !='));
});
