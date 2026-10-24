import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorPattern, profileTotalQuery, profileFacetQuery, conceptLabelQuery,
} from '../src/sparql/queries/profile.js';
import { PROFILE_FACETS } from '../src/config.js';

const ROSE = 'http://data.odeuropa.eu/vocabulary/olfactory-objects/138';
const GARDEN = 'http://data.odeuropa.eu/vocabulary/fragrant-spaces/27';
const anchor = anchorPattern(ROSE, 'olfactory-objects');

const DISTINCT = {
  timeline: 'schema:dateCreated/time:hasBeginning',
  emission_timeline: 'time:hasTime/time:hasBeginning',
  languages: 'schema:inLanguage ?lang',
  datasets: 'GRAPH ?g',
  qualities: 'crm:P141_assigned ?q',
  emotions: 'reo:readP27',
  fragrant_spaces: 'crm:P137_exemplifies ?space',
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
  assert.ok(anchorPattern(ROSE, 'olfactory-objects', { narrower: true }).includes(`?c skos:broader* <${ROSE}>`));
  const g = anchorPattern(GARDEN, 'fragrant-spaces');
  assert.ok(g.includes('crm:P137_exemplifies ?c') && g.includes('od:F1_generated ?smell'));
  assert.ok(anchorPattern(GARDEN, 'fragrant-spaces', { narrower: true }).includes('(skos:broader|^skos:narrower)*'));
});

test('language appears only as a quoted literal', () => {
  const a = anchorPattern(ROSE, 'olfactory-objects', { language: 'fr' });
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
