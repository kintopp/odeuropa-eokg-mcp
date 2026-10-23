// One realistic call per tool through a real stdio client, plus a dataset-snapshot check.
// Live only: durations are reported per tool; run sequentially and never retry a 504.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATASETS, PER_CHANNEL_RESULT_BUDGET } from '../src/config.js';
import { sparqlSelect, num } from '../src/sparql/client.js';
import { outputSchema as listDatasets } from '../src/tools/list_datasets.js';
import { outputSchema as searchSmells } from '../src/tools/search_smells.js';
import { outputSchema as getSmell } from '../src/tools/get_smell.js';
import { outputSchema as getSource } from '../src/tools/get_source.js';
import { outputSchema as inspectImage } from '../src/tools/inspect_image.js';
import { outputSchema as findConcepts } from '../src/tools/find_concepts.js';
import { outputSchema as getConcept } from '../src/tools/get_concept.js';
import { outputSchema as smellProfile } from '../src/tools/smell_profile.js';
import { outputSchema as findVisualSmells } from '../src/tools/find_visual_smells.js';
import { withClient, assertWireValid, LIVE, KNOWN_SMELL } from './helpers.js';

const TEXT_SOURCE = 'http://data.odeuropa.eu/source/638ff424-2531-5bc8-959e-9951e2c42697'; // The Art of Perfumery
const IMAGE_SOURCE = 'http://data.odeuropa.eu/source/00721405-98be-5795-ac1d-3510448af60a'; // RKD still life
const ROSE = 'olfactory-objects/138';

// [tool, arguments, outputSchema, duration limit in ms]
const CALLS = [
  ['eokg_list_datasets', {}, listDatasets, 20_000],
  ['eokg_search_smells', { text: 'lavender' }, searchSmells, 20_000],
  ['eokg_get_smell', { id: KNOWN_SMELL }, getSmell, 20_000],
  ['eokg_get_source', { id: TEXT_SOURCE, limit: 5 }, getSource, 20_000],
  ['eokg_inspect_image', { id: IMAGE_SOURCE }, inspectImage, 20_000],
  ['eokg_find_concepts', { query: 'rose' }, findConcepts, 20_000],
  ['eokg_get_concept', { id: ROSE }, getConcept, 20_000],
  ['eokg_smell_profile', { concept: ROSE }, smellProfile, 30_000],
  ['eokg_find_visual_smells', { concept: ROSE }, findVisualSmells, 20_000],
];

test('live sweep: one call per tool, in budget and wire-valid', { skip: !LIVE, timeout: 300_000 }, async () => {
  await withClient('eokg-live-sweep', async (client) => {
    for (const [name, args, schema, limitMs] of CALLS) {
      const t0 = performance.now();
      const res = await client.callTool({ name, arguments: args });
      const ms = Math.round(performance.now() - t0);
      console.error(`[live-sweep] ${name}: ${ms} ms`);
      const text = res.content.filter((c) => c.type === 'text');
      assert.notEqual(res.isError, true, `${name}: ${text[0]?.text}`);
      assertWireValid(schema, res.structuredContent);
      const chars = text.reduce((n, c) => n + c.text.length, 0);
      assert.ok(chars <= PER_CHANNEL_RESULT_BUDGET, `${name}: text channel ${chars} > ${PER_CHANNEL_RESULT_BUDGET}`);
      assert.ok(ms < limitMs, `${name}: ${ms} ms >= ${limitMs} ms`);
    }
  });
});

test('live: the rijksmuseum dataset count matches the snapshot', { skip: !LIVE }, async () => {
  const rows = await sparqlSelect('live_rijks_count',
    'SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { GRAPH <http://data.odeuropa.eu/rijksmuseum> { ?s a od:L11_Smell } }');
  const expected = DATASETS.find((d) => d.name === 'rijksmuseum').smells;
  assert.equal(num(rows[0], 'n'), expected, 'KG reloaded? refresh DATASETS');
});
