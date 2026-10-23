// Queries for eokg_search_smells. `lq` is an already-scoped Lucene string; numbers are pre-validated.
// Language and dataset only ever come from zod enums, so interpolating them is safe.

import { sparqlString } from '../lucene.js';
import { DATASET_GRAPH_BASE, OLFACTORY_OBJECTS_GRAPH } from '../../config.js';

const pad4 = (y) => String(y).padStart(4, '0');

export const searchCountQuery = (lq) => `
SELECT ?total WHERE { ?search a luc-index:search ; luc:query "${sparqlString(lq)}" ; luc:limit "1" ; luc:totalHits ?total ; luc:entities ?id . }`;

// Unfiltered: Lucene pages, so snippets stay cheap.
export const searchPageQuery = (lq, limit, offset) => `
SELECT ?id ?score ?total ?field ?snip WHERE {
  ?search a luc-index:search ; luc:query "${sparqlString(lq)}" ; luc:limit "${limit + 1}" ; luc:offset "${offset}" ;
          luc:totalHits ?total ; luc:entities ?id .
  ?id luc:score ?score .
  OPTIONAL { ?id luc:snippets ?sn . ?sn luc:snippetField ?field ; luc:snippetText ?snip . }
} ORDER BY DESC(?score) ?id`;

// Filtered: window W, no snippets (Lucene computes them for the whole window).
export const searchWindowQuery = (lq, W, { language, yearFrom, yearTo, dataset }, limit, offset) => {
  const dated = yearFrom != null || yearTo != null;
  const bounds = [
    yearFrom != null && `?b >= "${pad4(yearFrom)}"^^xsd:gYear`,
    yearTo != null && `?b <= "${pad4(yearTo)}"^^xsd:gYear`,
  ].filter(Boolean).join(' && ');
  return `
SELECT ?id ?score WHERE {
  { SELECT ?id ?score WHERE { ?search a luc-index:search ; luc:query "${sparqlString(lq)}" ; luc:limit "${W}" ; luc:entities ?id . ?id luc:score ?score . } }
  ${dataset ? `GRAPH <${DATASET_GRAPH_BASE}${dataset}> { ?id a od:L11_Smell }` : ''}
  ${language || dated ? '?source crm:P67_refers_to ?id . FILTER NOT EXISTS { ?source rdf:value [] }' : ''}
  ${language ? `?source schema:inLanguage "${language}" .` : ''}
  ${dated ? `OPTIONAL { ?source schema:dateCreated/time:hasBeginning ?b }
  FILTER(!BOUND(?b) || (${bounds}))` : ''}
} ORDER BY DESC(?score) ?id LIMIT ${limit + 1} OFFSET ${offset}`;
};

// Enrichment for the (at most `limit`) ids of one page.
export const searchEnrichQuery = (ids) => `
SELECT ?id ?graph ?source ?type ?title ?lang ?date ?frag ?text ?cl WHERE {
  VALUES ?id { ${ids.map((i) => `<${i}>`).join(' ')} }
  GRAPH ?graph { ?id a od:L11_Smell }
  ?source crm:P67_refers_to ?id ; a ?type . FILTER NOT EXISTS { ?source rdf:value [] }
  FILTER(?type IN (crm:E33_Linguistic_Object, crm:E36_Visual_Item))
  OPTIONAL { ?source rdfs:label ?title } OPTIONAL { ?source schema:inLanguage ?lang }
  OPTIONAL { ?source schema:dateCreated/rdfs:label ?date }
  OPTIONAL { ?frag crm:P67_refers_to ?id ; rdf:value ?text . }
  OPTIONAL { ?em od:F1_generated ?id ; od:F3_had_source ?c . GRAPH <${OLFACTORY_OBJECTS_GRAPH}> { ?c skos:prefLabel ?cl FILTER(LANG(?cl) = "en") } }
}`;
