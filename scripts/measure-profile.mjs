// Times the eokg_smell_profile aggregates against the live endpoint, one query at a time.
// Re-run after a KG reload: `node scripts/measure-profile.mjs`. Prints `<label>\t<ms>\t<rows>`.

import { SPARQL_ENDPOINT, DATASET_GRAPH_BASE } from '../src/config.js';
import { PREFIXES } from '../src/sparql/prefixes.js';

const V = 'http://data.odeuropa.eu/vocabulary/';
const SPACES = `${V}fragrant-spaces/`;
const BUCKET = 20;
const TOP = 10;

const anchor = (c, scheme, narrower) => {
  if (scheme === 'olfactory-objects') {
    return `${narrower ? `?c skos:broader* <${c}> .` : `VALUES ?c { <${c}> }`} ?emission od:F3_had_source ?c ; od:F1_generated ?smell .`;
  }
  const tail = '?place crm:P137_exemplifies ?c . ?emission crm:P7_took_place_at ?place ; od:F1_generated ?smell .';
  return `${narrower ? `?c (skos:broader|^skos:narrower)* <${c}> .` : `VALUES ?c { <${c}> }`} ${tail}`;
};

const timeline = (a, path) => `SELECT ?start (COUNT(DISTINCT ?smell) AS ?n) WHERE { ${a} ${path} ?b .
  BIND(FLOOR(YEAR(?b)/${BUCKET})*${BUCKET} AS ?start) } GROUP BY ?start ORDER BY ?start`;
const top = (a, body, key, extra = '') => `SELECT ?${key} ${extra} (COUNT(DISTINCT ?smell) AS ?n) WHERE { ${a} ${body} }
  GROUP BY ?${key} ORDER BY DESC(?n) LIMIT ${TOP}`;

const FACETS = {
  timeline: (a) => timeline(a, '?src crm:P67_refers_to ?smell ; schema:dateCreated/time:hasBeginning'),
  emission_timeline: (a) => timeline(a, '?emission time:hasTime/time:hasBeginning'),
  languages: (a) => top(a, '?src crm:P67_refers_to ?smell ; schema:inLanguage ?lang .', 'lang'),
  datasets: (a) => top(a, `GRAPH ?g { ?smell a od:L11_Smell } FILTER(STRSTARTS(STR(?g), "${DATASET_GRAPH_BASE}"))`, 'g'),
  qualities: (a) => top(a, '?a crm:P140_assigned_attribute_to ?smell ; crm:P141_assigned ?q . OPTIONAL { ?q rdfs:label ?ql }', 'q', '(SAMPLE(?ql) AS ?label)'),
  emotions: (a) => top(a, '?ex od:F2_perceived ?smell . ?emo reo:readP27 ?ex ; rdfs:label ?word .', 'word'),
  fragrant_spaces: (a) => top(a, `?emission crm:P7_took_place_at ?fplace . ?fplace crm:P137_exemplifies ?space .
    FILTER(STRSTARTS(STR(?space), "${SPACES}")) OPTIONAL { ?space skos:prefLabel ?sl FILTER(LANG(?sl) = "en") }`, 'space', '(SAMPLE(?sl) AS ?label)'),
  places: (a) => top(a, '?ex od:F2_perceived ?smell ; crm:P7_took_place_at ?p . ?p rdfs:label ?pl .', 'pl'),
  carriers: (a) => top(a, `?emission od:F4_had_carrier ?car .
    { ?car rdfs:label ?cl FILTER(STRSTARTS(STR(?car), "http://data.odeuropa.eu/object/")) }
    UNION { ?car skos:prefLabel ?cl FILTER(LANG(?cl) = "en") }`, 'cl'),
};
const total = (a) => `SELECT (COUNT(DISTINCT ?smell) AS ?n) WHERE { ${a} }`;

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
  ['rose', `${V}olfactory-objects/138`, 'olfactory-objects', false, ['total', ...Object.keys(FACETS)]],
  ['flower-narrower', `${V}olfactory-objects/72`, 'olfactory-objects', true, ['total', 'timeline', 'languages', 'datasets']],
  ['garden', `${SPACES}27`, 'fragrant-spaces', false, ['total', ...Object.keys(FACETS).filter((f) => f !== 'fragrant_spaces')]],
  ['garden-narrower', `${SPACES}27`, 'fragrant-spaces', true, ['total', 'timeline']],
];

for (const [name, concept, scheme, narrower, names] of plan) {
  const a = anchor(concept, scheme, narrower);
  for (const f of names) await run(`${name}/${f}`, f === 'total' ? total(a) : FACETS[f](a));
}
