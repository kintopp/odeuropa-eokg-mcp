// In-process server (like inspect_image.test.js) so the deadline test can fake Date.now and the
// concurrency test can watch the stub. The SPARQL stub routes on the `eokg:<label>` of each query.

import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.js';
import { outputSchema } from '../src/tools/smell_profile.js';
import { clearSparqlCache, sparqlSelect } from '../src/sparql/client.js';
import { installFetchStub, bindings } from './stub-backend.js';
import { assertWireValid, LIVE } from './helpers.js';

const KG = 'http://data.odeuropa.eu/';
const ROSE = 'olfactory-objects/138';
const GARDEN = 'fragrant-spaces/27';
const en = (value) => ({ type: 'literal', value, 'xml:lang': 'en' });
const uri = (value) => ({ type: 'uri', value });
const ok = (rows) => () => ({ body: bindings(rows) });

const FACET_ROWS = {
  timeline: [{ start: '1800', n: '120' }, { start: '1820', n: '80' }],
  emission_timeline: [{ start: '1850', n: '5' }],
  languages: [{ lang: 'en', n: '300' }, { lang: 'fr', n: '100' }],
  datasets: [{ g: uri(`${KG}gallica`), n: '90' }, { g: uri(`${KG}eebo`), n: '10' }],
  qualities: [
    { q: uri(`${KG}vocabulary/vdi-hedonic/11n`), label: en('Sweet'), n: '40' },
    { q: uri(`${KG}attribute/fragrant_en`), rlabel: en('fragrant'), n: '30' },
    { q: uri(`${KG}vocabulary/edwards/aromatic`), label: en('Aromatic'), rlabel: en('aromatic (old)'), n: '20' },
    { q: uri(`${KG}vocabulary/historic-book/7`), n: '10' },
  ],
  emotions: [{ word: 'nostalgia', n: '7' }],
  fragrant_spaces: [{ space: uri(`${KG}vocabulary/fragrant-spaces/27`), label: en('Garden'), n: '50' }],
  smell_sources: [
    { o: uri(`${KG}vocabulary/olfactory-objects/20`), label: en('Gas'), n: '16' },
    { o: uri(`${KG}vocabulary/olfactory-objects/72`), label: en('Flower  \n pot'), n: '10' },
  ],
  places: [{ pl: 'jardin', n: '4' }],
  carriers: [{ cl: 'the', n: '3' }],
};

const facetRoutes = (over = {}) => Object.fromEntries(
  Object.entries(FACET_ROWS).map(([f, rows]) => [`profile_${f}`, ok(rows)]).concat(Object.entries(over)),
);
const baseRoutes = (over = {}) => ({
  profile_total: ok([{ n: '29243' }]),
  concept_label: ok([{ l: en('Rose') }]),
  ...facetRoutes(),
  ...over,
});

let stub;
let client;

async function start(routes) {
  stub = installFetchStub(routes);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createServer().connect(st);
  client = new Client({ name: 'profile-test', version: '0.0.0' });
  await client.connect(ct);
}

beforeEach(() => clearSparqlCache());
afterEach(async () => {
  mock.restoreAll();
  await client?.close();
  client = null;
  stub?.restore();
  stub = null;
  clearSparqlCache();
});

const profile = (args = {}) => client.callTool({ name: 'eokg_smell_profile', arguments: { concept: ROSE, ...args } });
const labels = () => stub.router.calls.map((c) => c.label);
const facetLabels = () => labels().filter((l) => l.startsWith('profile_') && l !== 'profile_total');
const valid = (res) => {
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  return assertWireValid(outputSchema, res.structuredContent);
};

test('default facets: six facet queries plus total and label; shaped and wire-valid', async () => {
  await start(baseRoutes());
  const s = valid(await profile());
  assert.equal(labels().length, 8);
  assert.deepEqual(facetLabels().sort(), ['profile_datasets', 'profile_emotions', 'profile_fragrant_spaces', 'profile_languages', 'profile_qualities', 'profile_timeline']);
  assert.equal(labels().filter((l) => l === 'concept_label').length, 1);
  assert.equal(s.total_smells, 29243);
  assert.equal(s.concept.label, 'Rose');
  assert.equal(s.concept.id, `${KG}vocabulary/${ROSE}`);
  assert.deepEqual(s.timeline, {
    basis: 'document_date', bucket_years: 20, buckets: [{ start: 1800, count: 120 }, { start: 1820, count: 80 }],
    out_of_range: 0, dated: 200,
  });
  assert.deepEqual(s.languages, [{ label: 'en', count: 300 }, { label: 'fr', count: 100 }]);
  assert.deepEqual(s.datasets.map((d) => d.label), ['gallica', 'eebo']);
  assert.deepEqual(s.emotions, [{ label: 'nostalgia', count: 7 }]);
  assert.deepEqual(s.fragrant_spaces, [{ id: 'fragrant-spaces/27', label: 'Garden', lang: 'en', count: 50 }]);
  assert.equal(s.emission_timeline, undefined);
  assert.equal(s.failed_facets, undefined);
});

// Failure modes: a prefLabel-only concept (VDI) shows its URI tail; an rdfs:label-only word loses its label or lang;
// a concept with neither label crashes or disappears; rdfs:label beats prefLabel when both are present.
test('qualities: prefLabel, then rdfs:label, then the URI tail', async () => {
  await start(baseRoutes());
  const s = valid(await profile({ facets: ['qualities'] }));
  assert.deepEqual(s.qualities, [
    { id: 'vdi-hedonic/11n', label: 'Sweet', lang: 'en', count: 40 },
    { label: 'fragrant', lang: 'en', count: 30 },
    { id: 'edwards/aromatic', label: 'Aromatic', lang: 'en', count: 20 },
    { id: 'historic-book/7', label: '7', count: 10 },
  ]);
  const q = stub.router.calls.find((c) => c.label === 'profile_qualities').query;
  // Labels are joined outside the top-N subquery, so a multi-label concept cannot change the counts or the ranking.
  assert.ok(q.indexOf('LIMIT') >= 0 && q.indexOf('LIMIT') < q.indexOf('skos:prefLabel'));
});

test('text channel: header, compact timeline, labelled lists', async () => {
  await start(baseRoutes());
  const res = await profile({ language: 'fr' });
  const text = res.content[0].text;
  assert.ok(text.startsWith('Rose [olfactory-objects/138]: 29,243 smells, in fr'), text);
  assert.ok(text.includes('1800–1819 120 · 1820–1839 80'));
  assert.ok(text.includes('Emotions (machine-inferred): nostalgia 7'));
  assert.ok(text.includes('Fragrant spaces: Garden 50'));
  assert.ok(text.includes('Qualities: Sweet 40 · fragrant 30 · Aromatic 20 · 7 10'), text);
  assert.ok(stub.router.calls.find((c) => c.label === 'profile_timeline').query.includes('schema:inLanguage "fr"'));
});

test('timeline noise years go to out_of_range and are not listed', async () => {
  const rows = [-1000, 180, 1800, 2100, 4820].map((start) => ({ start: String(start), n: '10' }));
  await start(baseRoutes({ profile_timeline: ok(rows) }));
  const s = valid(await profile({ facets: ['timeline'] }));
  assert.deepEqual(s.timeline.buckets, [{ start: 1800, count: 10 }]);
  assert.equal(s.timeline.out_of_range, 40);
  assert.equal(s.timeline.dated, 50);
  assert.ok((await profile({ facets: ['timeline'], bucket_years: 50 })).content[0].text.includes('1800–1849 10'));
});

test('bucket_years reaches the query', async () => {
  await start(baseRoutes());
  valid(await profile({ facets: ['timeline'], bucket_years: 50 }));
  assert.ok(stub.router.calls.find((c) => c.label === 'profile_timeline').query.includes('/50)*50'));
});

test('fragrant_spaces: the STRSTARTS filter is in the query and the shaper drops twins that slip through', async () => {
  const rows = [
    { space: uri('http://www.wikidata.org/entity/Q1'), label: en('Garden'), n: '99' },
    { space: uri('https://www.wikidata.org/wiki/Q1'), n: '98' },
    ...FACET_ROWS.fragrant_spaces,
  ];
  await start(baseRoutes({ profile_fragrant_spaces: ok(rows) }));
  const s = valid(await profile({ facets: ['fragrant_spaces'] }));
  assert.deepEqual(s.fragrant_spaces.map((x) => x.label), ['Garden']);
  assert.ok(JSON.stringify(s).indexOf('wikidata') === -1);
  const q = stub.router.calls.find((c) => c.label === 'profile_fragrant_spaces').query;
  const at = q.indexOf('STRSTARTS(STR(?space), "http://data.odeuropa.eu/vocabulary/fragrant-spaces/")');
  assert.ok(at >= 0 && at < q.indexOf('LIMIT'));
});

test('a 504 on one facet degrades to failed_facets with a warning; the others are returned', async () => {
  await start(baseRoutes({ profile_qualities: () => ({ status: 504, body: '<html>Gateway Time-out</html>' }) }));
  const res = await profile();
  const s = valid(res);
  assert.deepEqual(s.failed_facets, ['qualities']);
  assert.equal(s.qualities, undefined);
  assert.ok(s.languages && s.timeline && s.emotions);
  assert.ok(s.warnings.includes('The qualities facet timed out; repeating the same request is likely to time out again, so try with a narrower concept.'));
  assert.ok(res.content[0].text.includes('The qualities facet timed out'));
  assert.equal(labels().filter((l) => l === 'profile_qualities').length, 1, '504 is never retried');
});

// Failure modes: a 504 is advised to be re-sent as is; the advice names an option the call did not use,
// or leaves out the one that made the query heavier.
test('a facet timeout names only the options this call can drop', async () => {
  const timedOut = async (args) => {
    await start(baseRoutes({ profile_languages: () => ({ status: 504, body: '<html>Gateway Time-out</html>' }) }));
    const s = valid(await profile({ facets: ['languages'], ...args }));
    await client.close();
    stub.restore();
    clearSparqlCache();
    assert.deepEqual(s.failed_facets, ['languages']);
    return s.warnings;
  };
  const prefix = 'The languages facet timed out; repeating the same request is likely to time out again, so try';
  assert.ok((await timedOut({ include_narrower: true })).includes(`${prefix} without include_narrower or with a narrower concept.`));
  assert.ok((await timedOut({ language: 'fr' })).includes(`${prefix} without the language or year filter or with a narrower concept.`));
  assert.ok((await timedOut({ year_from: 1800 })).includes(`${prefix} without the language or year filter or with a narrower concept.`));
  assert.ok((await timedOut({ include_narrower: true, year_to: 1900 })).includes(`${prefix} without include_narrower, without the language or year filter, or with a narrower concept.`));
});

test('a facet whose 200 body stalls past its timeout degrades to failed_facets, sent once', async () => {
  // Shorten only the per-request timers (5–45 s); backoff sleeps and the client's own 60 s timeout keep their length.
  const realSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, 'setTimeout', (fn, ms, ...rest) => realSetTimeout(fn, ms >= 5000 && ms <= 45_000 ? 30 : ms, ...rest));
  await start(baseRoutes({ profile_qualities: () => ({ stall: true, body: '{"head":' }) }));
  const res = await profile();
  const s = valid(res);
  assert.deepEqual(s.failed_facets, ['qualities']);
  assert.ok(s.languages && s.timeline && s.emotions);
  assert.ok(s.warnings.includes('The qualities facet timed out; repeating the same request is likely to time out again, so try with a narrower concept.'));
  assert.equal(labels().filter((l) => l === 'profile_qualities').length, 1, 'a timed-out body read is never retried');
});

test('carriers are described as a mix of concepts and raw words', async () => {
  await start(baseRoutes());
  const res = await profile({ facets: ['carriers'] });
  assert.ok(res.content[0].text.includes('Carriers (vocabulary concepts and raw words): the 3'));
  const t = (await client.listTools()).tools.find((x) => x.name === 'eokg_smell_profile');
  assert.match(t.description, /carriers \(vocabulary concepts mixed with raw words\)/);
});

test('a non-timeout facet error fails the whole call', async () => {
  await start(baseRoutes({ profile_languages: () => ({ status: 400, body: 'bad query' }) }));
  const res = await profile();
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent, undefined);
});

test('a timed-out total fails the call', async () => {
  await start(baseRoutes({ profile_total: () => ({ status: 504, body: '<html>Gateway Time-out</html>' }) }));
  assert.equal((await profile()).isError, true);
  assert.deepEqual(facetLabels(), []);
});

test('total 0 returns early with empty facets and no facet queries', async () => {
  await start(baseRoutes({ profile_total: ok([{ n: '0' }]) }));
  const s = valid(await profile());
  assert.equal(s.total_smells, 0);
  assert.deepEqual(facetLabels(), []);
  assert.deepEqual(s.languages, []);
  assert.equal(s.timeline.dated, 0);
  assert.ok(s.warnings.includes('No smells are linked to this concept.'));
});

// Failure mode: an empty period reads as if the concept had no smells at all.
test('total 0 within a year range names the range', async () => {
  await start(baseRoutes({ profile_total: ok([{ n: '0' }]) }));
  const s = valid(await profile({ year_from: 1300, year_to: 1400 }));
  assert.ok(s.warnings.includes('No smells dated 1300–1400 are linked to this concept.'));
  assert.ok(!s.warnings.includes('No smells are linked to this concept.'));
});

test('include_narrower: facets run one at a time, default set is the three narrower facets', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const slow = (rows) => async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 25));
    inFlight--;
    return { body: bindings(rows) };
  };
  await start(baseRoutes(Object.fromEntries(Object.entries(FACET_ROWS).map(([f, rows]) => [`profile_${f}`, slow(rows)]))));
  const s = valid(await profile({ include_narrower: true }));
  assert.equal(maxInFlight, 1);
  assert.deepEqual(facetLabels().sort(), ['profile_datasets', 'profile_languages', 'profile_timeline']);
  assert.equal(s.include_narrower, true);
  assert.ok(stub.router.calls.find((c) => c.label === 'profile_total').query.includes('skos:broader*'));
  assert.ok(s.languages && s.datasets && s.timeline);

  // Without include_narrower the default facets do overlap.
  maxInFlight = 0;
  clearSparqlCache();
  valid(await profile());
  assert.ok(maxInFlight > 1);
});

test('deadline: a facet that would start with under 5 s left is skipped, not sent', async () => {
  let clock = 1_000_000;
  mock.method(Date, 'now', () => clock);
  await start(baseRoutes({
    profile_timeline: () => { clock += 46_000; return { body: bindings(FACET_ROWS.timeline) }; },
  }));
  const res = await profile({ include_narrower: true });
  const s = valid(res);
  assert.ok(s.timeline);
  assert.deepEqual(s.failed_facets, ['languages', 'datasets']);
  assert.deepEqual(facetLabels(), ['profile_timeline']);
  assert.ok(s.warnings.includes('The languages facet was skipped (time budget); request it on its own.'));
  assert.ok(res.content[0].text.includes('time budget'));
});

test('deadline: no query waits longer than the time left', async () => {
  let clock = 1_000_000;
  mock.method(Date, 'now', () => clock);
  const timeouts = [];
  const realSetTimeout = globalThis.setTimeout;
  mock.method(globalThis, 'setTimeout', (fn, ms, ...rest) => {
    if (ms > 1000) timeouts.push(ms);
    return realSetTimeout(fn, ms, ...rest);
  });
  await start(baseRoutes({
    profile_timeline: () => { clock += 20_000; return { body: bindings(FACET_ROWS.timeline) }; },
  }));
  valid(await profile({ include_narrower: true }));
  // total + label: the 45 s per-attempt timer; languages and datasets: a deadline timer for the 30 s left.
  assert.ok(timeouts.includes(45_000));
  assert.ok(timeouts.includes(30_000), `got ${timeouts}`);
});

// Failure modes: time queued for a SPARQL slot is not charged to the 50 s budget, so a profile
// outlives it; a query is sent after the deadline once a slot frees; a facet starved of a slot
// fails the whole call instead of landing in failed_facets.
async function saturated(fn) {
  const realSetTimeout = globalThis.setTimeout;
  const settle = () => new Promise((r) => realSetTimeout(r, 20));
  const releases = [];
  const holdRoute = () => new Promise((resolve) => releases.push(() => resolve({ body: bindings([]) })));
  // Outlasts every tick, so the slots stay taken until the test releases them.
  const hold = (n) => Array.from({ length: n }, (_, i) => sparqlSelect('hold', `SELECT * { BIND(${i} AS ?h) }`, { timeoutMs: 600_000 }).catch(() => {}));
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    await fn({ holdRoute, hold, settle });
  } finally {
    releases.forEach((r) => r());
    mock.timers.reset();
  }
}

const race = (p, settle) => Promise.race([p, settle().then(() => 'pending')]);

test('deadline: with every SPARQL slot taken, the profile fails at 50 s and never sends its total', async () => {
  await saturated(async ({ holdRoute, hold, settle }) => {
    await start(baseRoutes({ hold: holdRoute }));
    hold(4);
    await settle();
    const call = profile();
    await settle();
    mock.timers.tick(49_000);
    assert.equal(await race(call, settle), 'pending', 'settled before its deadline');
    mock.timers.tick(1_000);
    const res = await race(call, settle);
    assert.notEqual(res, 'pending', 'still running past its 50 s deadline');
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /time budget/);
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!labels().includes('profile_total'), 'the total was sent after the deadline');
});

test('deadline: facets starved of a slot land in failed_facets at 50 s; total and label are kept', async () => {
  await saturated(async ({ holdRoute, hold, settle }) => {
    // Once total and label hold two slots, take the other two and queue two more ahead of the facets.
    await start(baseRoutes({
      hold: holdRoute,
      profile_total: () => { hold(4); return { body: bindings([{ n: '29243' }]) }; },
    }));
    const call = profile();
    await settle();
    mock.timers.tick(50_000);
    const res = await race(call, settle);
    assert.notEqual(res, 'pending', 'still running past its 50 s deadline');
    const s = valid(res);
    assert.equal(s.total_smells, 29243);
    assert.equal(s.concept.label, 'Rose');
    assert.deepEqual([...s.failed_facets].sort(), ['datasets', 'emotions', 'fragrant_spaces', 'languages', 'qualities', 'timeline']);
    assert.deepEqual(facetLabels(), [], 'a facet was sent after the deadline');
    assert.ok(s.warnings.includes('The qualities facet ran out of the time budget it shares with the other facets; request it on its own.'));
  });
});

test('deadline: a facet requested alone is never told to request it on its own', async () => {
  await saturated(async ({ holdRoute, hold, settle }) => {
    await start(baseRoutes({
      hold: holdRoute,
      profile_total: () => { hold(4); return { body: bindings([{ n: '29243' }]) }; },
    }));
    const call = profile({ facets: ['qualities'] });
    await settle();
    mock.timers.tick(50_000);
    const res = await race(call, settle);
    assert.notEqual(res, 'pending', 'still running past its 50 s deadline');
    const s = valid(res);
    assert.deepEqual(s.failed_facets, ['qualities']);
    assert.deepEqual(s.warnings, ['The qualities facet ran out of the time budget; the endpoint may be busy, so try again later or with a narrower concept.']);
  });
});

test('deadline: a lone facet skipped for lack of budget is told to try later', async () => {
  let clock = 1_000_000;
  mock.method(Date, 'now', () => clock);
  await start(baseRoutes({
    profile_total: () => { clock += 46_000; return { body: bindings([{ n: '29243' }]) }; },
  }));
  const s = valid(await profile({ facets: ['languages'] }));
  assert.deepEqual(s.failed_facets, ['languages']);
  assert.deepEqual(s.warnings, ['The languages facet was skipped (time budget); the endpoint may be busy, so try again later or with a narrower concept.']);
});

test('input rules fail before any query', async () => {
  await start(baseRoutes());
  const cases = [
    [{ concept: 'expert-taxonomy/rose' }, /not linked to smells/],
    [{ include_narrower: true, language: 'fr' }, /language/],
    [{ include_narrower: true, facets: ['timeline', 'languages', 'datasets', 'qualities'] }, /at most 3 facets/],
    [{ concept: 'not a concept' }, /Not a valid concept id/],
  ];
  for (const [args, re] of cases) {
    const res = await profile(args);
    assert.equal(res.isError, true, JSON.stringify(args));
    assert.match(res.content[0].text, re);
  }
  assert.deepEqual(labels(), []);
});

test('fragrant-spaces concept: anchored through the place, the fragrant_spaces facet is dropped with a warning', async () => {
  await start(baseRoutes());
  const s = valid(await profile({ concept: GARDEN }));
  assert.equal(s.concept.vocab, 'fragrant-spaces');
  assert.equal(s.fragrant_spaces, undefined);
  assert.ok(!facetLabels().includes('profile_fragrant_spaces'));
  assert.ok(s.warnings.some((w) => w.includes('fragrant_spaces facet was dropped')));
  assert.ok(stub.router.calls.find((c) => c.label === 'profile_total').query.includes('crm:P137_exemplifies ?c'));
});

test('live: Rose default profile', { skip: !LIVE }, async () => {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createServer().connect(st);
  client = new Client({ name: 'profile-live', version: '0.0.0' });
  await client.connect(ct);
  const t0 = Date.now();
  const s = valid(await profile());
  const ms = Date.now() - t0;
  console.error(`live rose profile: ${ms} ms, total ${s.total_smells}`);
  assert.ok(ms < 15_000, `took ${ms} ms`);
  assert.ok(s.total_smells > 20000);
  assert.ok(['en', 'fr'].includes(s.languages[0].label));
  assert.ok(s.emotions.some((e) => e.label === 'nostalgia'));
  assert.ok(s.fragrant_spaces.some((e) => e.label === 'Garden'));
  assert.doesNotMatch(JSON.stringify(s), /wikidata/);
});

test('live: Garden profile drops the fragrant_spaces facet', { skip: !LIVE }, async () => {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createServer().connect(st);
  client = new Client({ name: 'profile-live', version: '0.0.0' });
  await client.connect(ct);
  const t0 = Date.now();
  const s = valid(await profile({ concept: GARDEN }));
  console.error(`live garden profile: ${Date.now() - t0} ms, total ${s.total_smells}`);
  assert.ok(s.total_smells > 3000);
  assert.equal(s.fragrant_spaces, undefined);
  assert.ok(s.warnings.some((w) => w.includes('fragrant_spaces')));
});

test('zero smells with language names the language', async () => {
  await start(baseRoutes({ profile_total: ok([{ n: '0' }]) }));
  const res = await profile({ language: 'nl' });
  const s = valid(res);
  assert.ok(s.warnings.includes('No Dutch smells are linked to this concept.'));
  assert.ok(res.content[0].text.includes('No Dutch smells are linked to this concept.'));
  assert.ok(!s.warnings.includes('No smells are linked to this concept.'));
});

test('multi-line facet labels are collapsed to single spaces', async () => {
  await start(baseRoutes({
    profile_fragrant_spaces: ok([{ space: uri(`${KG}vocabulary/fragrant-spaces/14`), label: en('seat of a first-order\n            administrative   division'), n: '24' }]),
    profile_places: ok([{ pl: 'the\n  garden', n: '4' }]),
  }));
  const s = valid(await profile({ facets: ['fragrant_spaces', 'places'] }));
  assert.equal(s.fragrant_spaces[0].label, 'seat of a first-order administrative division');
  assert.equal(s.places[0].label, 'the garden');
});

test('the description carries the language-facet and emission-date caveats', async () => {
  await start(baseRoutes());
  const t = (await client.listTools()).tools.find((x) => x.name === 'eokg_smell_profile');
  assert.match(t.description, /languages facet counts text smells only; image smells are in the total and the timeline but have no language/);
  assert.match(t.description, /in almost every record equals the document date, so emission_timeline rarely differs from timeline/);
  assert.match(t.description, /listed in failed_facets, also without include_narrower; a warning for each says what to try next/);
  assert.match(t.inputSchema.properties.bucket_years.description, /Timeline bucket width: 10, 20 or 50 years\./);
});

const GESTURE = 'olfactory-gestures/2';

// Failure modes: the vocabulary is still rejected; the default facets are the object ones (languages, qualities);
// the reason languages are missing is not stated; the label comes from the wrong graph.
test('a gesture concept profiles with timeline, languages, datasets, smell_sources and emotions', async () => {
  await start(baseRoutes({ concept_label: ok([{ l: en("Holding one's nose") }]) }));
  const s = valid(await profile({ concept: GESTURE }));
  assert.deepEqual(facetLabels().sort(), ['profile_datasets', 'profile_emotions', 'profile_languages', 'profile_smell_sources', 'profile_timeline']);
  assert.equal(s.concept.vocab, 'olfactory-gestures');
  assert.ok(!(s.warnings ?? []).some((w) => /from images/.test(w)));
  const anchored = stub.router.calls.filter((c) => c.label.startsWith('profile_'));
  assert.ok(anchored.every((c) => c.query.includes('od:F5_involved_gesture')));
  assert.ok(stub.router.calls.find((c) => c.label === 'concept_label').query.includes('vocabulary/olfactory-gestures>'));
});

test('a gesture profile still computes languages when asked, without the explanation', async () => {
  await start(baseRoutes());
  const s = valid(await profile({ concept: GESTURE, facets: ['languages'] }));
  assert.ok(s.languages.length > 0);
  assert.ok(!(s.warnings ?? []).some((w) => w.includes('no language')));
});

// Failure modes: the filter reaches the total but not a facet (facet counts exceed the total); a bound is dropped;
// undated sources slip in; the inverted range reaches the backend.
test('year range is part of the anchor of the total and of every facet query', async () => {
  await start(baseRoutes());
  const s = valid(await profile({ year_from: 1700, year_to: 1799, facets: ['timeline', 'languages', 'datasets', 'qualities', 'emotions', 'fragrant_spaces'] }));
  const queries = stub.router.calls.filter((c) => c.label.startsWith('profile_'));
  assert.equal(queries.length, 7);
  for (const c of queries) {
    assert.ok(c.query.includes('?ysrc crm:P67_refers_to ?smell ; schema:dateCreated/time:hasBeginning ?yb'), c.label);
    assert.ok(c.query.includes('?yb >= "1700"^^xsd:gYear && ?yb <= "1799"^^xsd:gYear'), c.label);
  }
  assert.equal(s.year_from, 1700);
  assert.equal(s.year_to, 1799);
});

test('a single bound and the absence of bounds', async () => {
  await start(baseRoutes());
  valid(await profile({ year_to: 1799, facets: ['timeline'] }));
  const q = stub.router.calls.find((c) => c.label === 'profile_total').query;
  assert.ok(q.includes('?yb <= "1799"^^xsd:gYear') && !q.includes('?yb >='));
  stub.router.calls.length = 0;
  clearSparqlCache();
  const s = valid(await profile({ facets: ['timeline'] }));
  assert.ok(stub.router.calls.every((c) => !c.query.includes('?ysrc')));
  assert.equal(s.year_from, undefined);
  assert.equal(s.year_to, undefined);
});

test('year_from after year_to fails before any query', async () => {
  await start(baseRoutes());
  const res = await profile({ year_from: 1800, year_to: 1700 });
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('`year_from` is later than `year_to`.'));
  assert.equal(stub.router.calls.length, 0);
});

test('the heading states the period', async () => {
  await start(baseRoutes({ profile_total: ok([{ n: '1479' }]) }));
  const both = (await profile({ year_from: 1700, year_to: 1799, facets: ['timeline'] })).content[0].text;
  assert.ok(both.startsWith('Rose [olfactory-objects/138]: 1,479 smells, dated 1700–1799'), both);
  clearSparqlCache();
  const from = (await profile({ year_from: 1700, facets: ['timeline'] })).content[0].text;
  assert.ok(from.startsWith('Rose [olfactory-objects/138]: 1,479 smells, dated 1700 or later'), from);
});

// Boundary: a quarter exactly is not "more than a quarter". Failure mode: counting only odor misses europeana, nuk
// and rijksmuseum, which also hold only images.
test('image-share warning sums all image datasets: 251 of 1000 warns, 250 of 1000 and an absent datasets facet do not', async () => {
  const datasets = (odor) => ok([
    { g: uri(`${KG}odor`), n: String(odor - 111) }, { g: uri(`${KG}gallica`), n: '500' },
    { g: uri(`${KG}europeana`), n: '100' }, { g: uri(`${KG}nuk`), n: '10' }, { g: uri(`${KG}rijksmuseum`), n: '1' },
  ]);
  await start(baseRoutes({ profile_total: ok([{ n: '1000' }]), profile_datasets: datasets(251) }));
  const s = valid(await profile({ facets: ['datasets'] }));
  assert.ok(s.warnings.includes('251 of these smells come from images (odor, europeana, nuk, rijksmuseum); compare text and image evidence separately.'), String(s.warnings));
  clearSparqlCache();
  stub.restore();
  await client.close();
  await start(baseRoutes({ profile_total: ok([{ n: '1000' }]), profile_datasets: datasets(250) }));
  assert.equal(valid(await profile({ facets: ['datasets'] })).warnings, undefined);
  clearSparqlCache();
  assert.equal(valid(await profile({ facets: ['timeline'] })).warnings, undefined);
});

test('smell_sources: shaped with ids and collapsed labels, twins dropped, rendered, concept excluded only for objects', async () => {
  const rows = [{ o: uri('http://www.wikidata.org/entity/Q5'), n: '99' }, ...FACET_ROWS.smell_sources];
  await start(baseRoutes({ profile_smell_sources: ok(rows) }));
  const res = await profile({ facets: ['smell_sources'] });
  const s = valid(res);
  assert.deepEqual(s.smell_sources, [
    { id: 'olfactory-objects/20', label: 'Gas', lang: 'en', count: 16 },
    { id: 'olfactory-objects/72', label: 'Flower pot', lang: 'en', count: 10 },
  ]);
  assert.ok(res.content[0].text.includes('Smell sources in the same smells: Gas 16 · Flower pot 10'), res.content[0].text);
  const q = stub.router.calls.find((c) => c.label === 'profile_smell_sources').query;
  assert.ok(q.includes(`?o != <${KG}vocabulary/${ROSE}>`));

  clearSparqlCache();
  stub.router.calls.length = 0;
  valid(await profile({ concept: GARDEN, facets: ['smell_sources'] }));
  assert.ok(!stub.router.calls.find((c) => c.label === 'profile_smell_sources').query.includes('?o !='));
});

test('smell_sources is opt-in for objects and spaces and named in the facets description', async () => {
  await start(baseRoutes());
  valid(await profile());
  assert.ok(!facetLabels().includes('profile_smell_sources'));
  const { tools } = await client.listTools();
  const d = tools.find((t) => t.name === 'eokg_smell_profile').inputSchema.properties.facets.description;
  assert.ok(d.includes('smell_sources') && d.includes('other smell sources extracted from the same smell events'));
});
