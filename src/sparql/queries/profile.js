// Queries for eokg_smell_profile. Every aggregate starts from `anchorPattern`, which binds ?smell, ?emission and ?c.
// Concept URIs come from parseId; `scheme` from vocabOf (never user text); `language` and `bucketYears` from zod.

import { KG_BASE } from '../../lib/ids.js';
import { DATASET_GRAPH_BASE, FRAGRANT_SPACES_BASE } from '../../config.js';

/** The graph pattern binding ?smell for a concept. `scheme` is 'olfactory-objects' or 'fragrant-spaces'. */
export function anchorPattern(conceptUri, scheme, { narrower = false, language } = {}) {
  const lang = language ? ` ?lsrc crm:P67_refers_to ?smell ; schema:inLanguage "${language}" .` : '';
  if (scheme === 'fragrant-spaces') {
    const head = narrower ? `?c (skos:broader|^skos:narrower)* <${conceptUri}> .` : `VALUES ?c { <${conceptUri}> }`;
    return `${head} ?place crm:P137_exemplifies ?c . ?emission crm:P7_took_place_at ?place ; od:F1_generated ?smell .${lang}`;
  }
  const head = narrower ? `?c skos:broader* <${conceptUri}> .` : `VALUES ?c { <${conceptUri}> }`;
  return `${head} ?emission od:F3_had_source ?c ; od:F1_generated ?smell .${lang}`;
}

export const profileTotalQuery = (anchor) => `
SELECT (COUNT(DISTINCT ?smell) AS ?n) WHERE { ${anchor} }`;

export const conceptLabelQuery = (conceptUri, scheme) => `
SELECT ?l WHERE { GRAPH <${KG_BASE}vocabulary/${scheme}> { <${conceptUri}> skos:prefLabel ?l FILTER(LANG(?l) = "en") } } LIMIT 1`;

const timeline = (anchor, path, bucketYears) => `
SELECT ?start (COUNT(DISTINCT ?smell) AS ?n) WHERE { ${anchor} ${path} ?b .
  BIND(FLOOR(YEAR(?b)/${bucketYears})*${bucketYears} AS ?start) } GROUP BY ?start ORDER BY ?start`;

const topN = (anchor, body, key, top, extra = '') => `
SELECT ?${key} ${extra} (COUNT(DISTINCT ?smell) AS ?n) WHERE { ${anchor} ${body} }
GROUP BY ?${key} ORDER BY DESC(?n) LIMIT ${top}`;

// Each template selects ?n = COUNT(DISTINCT ?smell). The fragrant-spaces and datasets filters sit in
// the WHERE clause, so sameAs twins cannot take a top-N slot.
const FACETS = {
  timeline: (a, { bucketYears }) => timeline(a, '?src crm:P67_refers_to ?smell ; schema:dateCreated/time:hasBeginning', bucketYears),
  emission_timeline: (a, { bucketYears }) => timeline(a, '?emission time:hasTime/time:hasBeginning', bucketYears),
  languages: (a, { top }) => topN(a, '?src crm:P67_refers_to ?smell ; schema:inLanguage ?lang .', 'lang', top),
  datasets: (a, { top }) => topN(a, `GRAPH ?g { ?smell a od:L11_Smell } FILTER(STRSTARTS(STR(?g), "${DATASET_GRAPH_BASE}"))`, 'g', top),
  qualities: (a, { top }) => `
SELECT ?q ?n (SAMPLE(?pl) AS ?label) (SAMPLE(?rl) AS ?rlabel) WHERE {
  { SELECT ?q (COUNT(DISTINCT ?smell) AS ?n) WHERE { ${a} ?a crm:P140_assigned_attribute_to ?smell ; crm:P141_assigned ?q . }
    GROUP BY ?q ORDER BY DESC(?n) LIMIT ${top} }
  OPTIONAL { ?q skos:prefLabel ?pl FILTER(LANG(?pl) = "en") }
  OPTIONAL { ?q rdfs:label ?rl }
} GROUP BY ?q ?n ORDER BY DESC(?n)`,
  emotions: (a, { top }) => topN(a, '?ex od:F2_perceived ?smell . ?emo reo:readP27 ?ex ; rdfs:label ?word .', 'word', top),
  fragrant_spaces: (a, { top }) => topN(a,
    `?emission crm:P7_took_place_at ?fplace . ?fplace crm:P137_exemplifies ?space .
  FILTER(STRSTARTS(STR(?space), "${FRAGRANT_SPACES_BASE}")) OPTIONAL { ?space skos:prefLabel ?sl FILTER(LANG(?sl) = "en") }`,
    'space', top, '(SAMPLE(?sl) AS ?label)'),
  places: (a, { top }) => topN(a, '?ex od:F2_perceived ?smell ; crm:P7_took_place_at ?p . ?p rdfs:label ?pl .', 'pl', top),
  carriers: (a, { top }) => topN(a, '?emission od:F4_had_carrier ?car . ?car rdfs:label ?cl .', 'cl', top),
};

export function profileFacetQuery(facet, anchor, { bucketYears = 20, top = 10 } = {}) {
  const build = FACETS[facet];
  if (!build) throw new Error(`Unknown profile facet: ${facet}`);
  return build(anchor, { bucketYears, top });
}
