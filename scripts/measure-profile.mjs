// Times the eokg_smell_profile aggregates against the live endpoint, one query at a time.
// Re-run after a KG reload: `node scripts/measure-profile.mjs`. Prints `<label>\t<ms>\t<rows>`.

import { SPARQL_ENDPOINT, PROFILE_FACETS } from '../src/config.js';
import { vocabOf } from '../src/lib/ids.js';
import { PREFIXES } from '../src/sparql/prefixes.js';
import { anchorPattern, profileFacetQuery, profileTotalQuery } from '../src/sparql/queries/profile.js';

const V = 'http://data.odeuropa.eu/vocabulary/';

async function run(label, body) {
  const t0 = Date.now();
  let rows;
  try {
    const res = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
      body: new URLSearchParams({ query: `# eokg:measure\n${PREFIXES}${body}` }).toString(),
      signal: AbortSignal.timeout(65_000),
    });
    rows = res.ok ? (await res.json()).results.bindings.length : `HTTP ${res.status}`;
  } catch (err) {
    rows = `ERR ${err.message}`;
  }
  console.log(`${label}\t${Date.now() - t0}\t${rows}`);
}

const plan = [
  ['rose', `${V}olfactory-objects/138`, false, ['total', ...PROFILE_FACETS]],
  ['flower-narrower', `${V}olfactory-objects/72`, true, ['total', 'timeline', 'languages', 'datasets']],
  ['garden', `${V}fragrant-spaces/27`, false, ['total', ...PROFILE_FACETS.filter((f) => f !== 'fragrant_spaces')]],
  ['garden-narrower', `${V}fragrant-spaces/27`, true, ['total', 'timeline']],
];

for (const [name, concept, narrower, names] of plan) {
  const vocab = vocabOf(concept);
  const anchor = anchorPattern(concept, vocab.anchor, { narrower });
  const exclude = vocab.anchor === 'source' ? concept : undefined;
  for (const f of names) await run(`${name}/${f}`, f === 'total' ? profileTotalQuery(anchor) : profileFacetQuery(f, anchor, { exclude }));
}
