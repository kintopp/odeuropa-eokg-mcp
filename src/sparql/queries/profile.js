// Queries for eokg_smell_profile. Every aggregate starts from `anchorPattern`, which binds ?smell, ?emission and ?c.
// Concept URIs come from parseId; `scheme` from vocabOf (never user text); `language`, years and `bucketYears` from zod.

import { KG_BASE } from '../../lib/ids.js';
import {
  DATASET_GRAPH_BASE, FRAGRANT_SPACES_BASE, FRAGRANT_SPACES_GRAPH, OLFACTORY_OBJECTS_BASE, OLFACTORY_OBJECTS_GRAPH,
} from '../../config.js';
import { yearBounds } from './years.js';

// Keyed by the VOCABS `anchor` of the concept's vocabulary.
const ANCHOR_BODY = {
  source: '?emission od:F3_had_source ?c ; od:F1_generated ?smell .',
  place: '?place crm:P137_exemplifies ?c . ?emission crm:P7_took_place_at ?place ; od:F1_generated ?smell .',
  gesture: '?ex od:F5_involved_gesture ?c ; od:F2_perceived ?smell . ?emission od:F1_generated ?smell .',
};

/** The graph pattern binding ?smell for a concept whose vocabulary has the VOCABS `anchor` given. */
export function anchorPattern(conceptUri, anchor, { narrower = false, language, yearFrom, yearTo } = {}) {
  // Fragrant-spaces states its hierarchy in either direction; the others use skos:broader only.
  const path = anchor === 'place' ? '(skos:broader|^skos:narrower)*' : 'skos:broader*';
  const head = narrower ? `?c ${path} <${conceptUri}> .` : `VALUES ?c { <${conceptUri}> }`;
  const bounds = yearBounds('?yb', yearFrom, yearTo);
  const years = bounds ? ` ?ysrc crm:P67_refers_to ?smell ; schema:dateCreated/time:hasBeginning ?yb . FILTER(${bounds})` : '';
  const filters = (language ? ` ?lsrc crm:P67_refers_to ?smell ; schema:inLanguage "${language}" .` : '') + years;
  return `${head} ${ANCHOR_BODY[anchor]}${filters}`;
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
// the WHERE clause, so sameAs twins cannot take a top-N slot (smell_sources filters to olfactory-objects the same way).
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
  FILTER(STRSTARTS(STR(?space), "${FRAGRANT_SPACES_BASE}"))
  OPTIONAL { GRAPH <${FRAGRANT_SPACES_GRAPH}> { ?space skos:prefLabel ?sl FILTER(LANG(?sl) = "en") } }`,
    'space', top, '(SAMPLE(?sl) AS ?label)'),
  smell_sources: (a, { top, exclude }) => topN(a,
    `?emission od:F3_had_source ?o .
  FILTER(STRSTARTS(STR(?o), "${OLFACTORY_OBJECTS_BASE}")${exclude ? ` && ?o != <${exclude}>` : ''})
  OPTIONAL { GRAPH <${OLFACTORY_OBJECTS_GRAPH}> { ?o skos:prefLabel ?ol FILTER(LANG(?ol) = "en") } }`,
    'o', top, '(SAMPLE(?ol) AS ?label)'),
  // MAX, where lowercase sorts last, shows "the room" over "The room" and leaves a name that only occurs capitalised alone.
  places: (a, { top }) => topN(a, '?ex od:F2_perceived ?smell ; crm:P7_took_place_at ?p . ?p rdfs:label ?pl . BIND(LCASE(STR(?pl)) AS ?folded)', 'folded', top, '(MAX(STR(?pl)) AS ?label)'),
  // Raw words are lowercased so that MIN, where capitals sort first, shows a concept's label over a word with the same text.
  carriers: (a, { top }) => topN(a,
    `?emission od:F4_had_carrier ?car .
  { ?car rdfs:label ?word FILTER(STRSTARTS(STR(?car), "${KG_BASE}object/")) BIND(LCASE(STR(?word)) AS ?cl) }
  UNION { GRAPH <${OLFACTORY_OBJECTS_GRAPH}> { ?car skos:prefLabel ?cl FILTER(LANG(?cl) = "en") } }
  UNION { GRAPH <${FRAGRANT_SPACES_GRAPH}> { ?car skos:prefLabel ?cl FILTER(LANG(?cl) = "en") } }
  BIND(LCASE(STR(?cl)) AS ?folded)`,
    'folded', top, '(MIN(STR(?cl)) AS ?label)'),
};

/** `exclude` is the concept URI to leave out of smell_sources (the anchor's own object concept). */
export function profileFacetQuery(facet, anchor, { bucketYears = 20, top = 10, exclude } = {}) {
  const build = FACETS[facet];
  if (!build) throw new Error(`Unknown profile facet: ${facet}`);
  return build(anchor, { bucketYears, top, exclude });
}
